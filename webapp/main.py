import random
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from webapp.tools.mongo import DATABASE as db, get_config
from webapp.tools.ip_region import resolve_ip_city
from webapp.tools.logging_config import configure_logging
from webapp.tools.notification import send_email
from webapp.api import v1
from webapp.scheduler import setup_scheduler

# Import security functions and models from the new security tool
from webapp.tools.security import (
    Token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    authenticate_user,
    cleanup_stale_active_sessions,
    create_security_challenge,
    create_access_token,
    create_auth_session,
    ensure_auth_session_indexes,
    get_required_security_actions,
    enforce_single_active_session,
    find_active_session,
    get_current_active_user,
    get_user,
    has_active_trusted_device,
    hash_verification_code,
    is_trusted_device,
    kick_active_sessions,
    normalize_device_fingerprint,
    touch_trusted_device,
    trust_device,
)

# --- Initialization ---

# 全局日志初始化（方案A）
configure_logging()


def _now_local_iso() -> str:
    return datetime.now().isoformat()


LOGIN_MAX_FAILED_ATTEMPTS = int(get_config("AUTH", "login_max_failed_attempts", "5"))
LOGIN_LOCK_MINUTES = int(get_config("AUTH", "login_lock_minutes", "15"))
EMAIL_CODE_EXPIRE_MINUTES = int(get_config("AUTH", "email_code_expire_minutes", "10"))
EMAIL_CODE_SEND_INTERVAL_SECONDS = int(get_config("AUTH", "email_code_send_interval_seconds", "60"))
EMAIL_CODE_MAX_SEND_COUNT = int(get_config("AUTH", "email_code_max_send_count", "5"))
EMAIL_SCENE_LOGIN_NEW_DEVICE = "login_new_device"


def get_real_ip(request: Request) -> str:
    if "x-forwarded-for" in request.headers:
        return request.headers["x-forwarded-for"].split(',')[0].strip()
    return get_remote_address(request)

limiter = Limiter(key_func=get_real_ip, default_limits=["1000 per minute"])

app = FastAPI(
    title="电力交易辅助分析系统API",
    description="为前端提供数据接口服务",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Scheduler ---
setup_scheduler(app)

# --- API Routes ---


def _write_auth_audit_log(
    event: str,
    operator: str,
    target: Optional[str] = None,
    detail: Optional[dict] = None,
):
    try:
        db.auth_audit_logs.insert_one({
            "event": event,
            "operator": operator,
            "target": target,
            "detail": detail or {},
            "created_at": _now_local_iso(),
        })
    except Exception:
        # 审计日志失败不影响主流程
        pass


def _build_login_geo_detail(request: Request) -> dict:
    login_ip = get_real_ip(request)
    return {
        "login_ip": login_ip,
        "login_city": resolve_ip_city(login_ip),
    }


def _get_device_fingerprint(request: Request) -> Optional[str]:
    return normalize_device_fingerprint(request.headers.get("x-device-fingerprint"))


def _get_device_name(request: Request) -> str:
    user_agent = (request.headers.get("user-agent") or "").strip()
    if not user_agent:
        return "未知设备"
    return user_agent[:200]


def _parse_local_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _issue_login_email_code(username: str, email: str, request_ip: str) -> dict:
    now = datetime.now()
    active_doc = db.auth_email_challenges.find_one(
        {"username": username, "email": email, "used_at": None, "scene": EMAIL_SCENE_LOGIN_NEW_DEVICE},
        sort=[("created_at", -1)],
    )
    if active_doc:
        last_sent_at = _parse_local_iso(active_doc.get("last_sent_at"))
        if last_sent_at:
            elapsed = (now - last_sent_at).total_seconds()
            if elapsed < max(1, EMAIL_CODE_SEND_INTERVAL_SECONDS):
                wait_seconds = max(1, int(EMAIL_CODE_SEND_INTERVAL_SECONDS - elapsed))
                raise HTTPException(status_code=429, detail=f"验证码发送过于频繁，请 {wait_seconds} 秒后再试")

        send_count = int(active_doc.get("send_count", 0) or 0)
        created_dt = _parse_local_iso(active_doc.get("created_at"))
        if created_dt and (now - created_dt).total_seconds() < 3600 and send_count >= max(1, EMAIL_CODE_MAX_SEND_COUNT):
            raise HTTPException(status_code=429, detail="验证码发送次数过多，请稍后再试")

    code = f"{random.randint(0, 999999):06d}"
    challenge_id = ObjectId()
    expire_at = now.replace(microsecond=0) + timedelta(minutes=max(5, EMAIL_CODE_EXPIRE_MINUTES))
    send_count = 1 if not active_doc else int(active_doc.get("send_count", 0) or 0) + 1
    doc = {
        "_id": challenge_id,
        "challenge_id": str(challenge_id),
        "username": username,
        "email": email,
        "scene": EMAIL_SCENE_LOGIN_NEW_DEVICE,
        "code_hash": hash_verification_code(code),
        "expire_at": expire_at.isoformat(),
        "used_at": None,
        "send_count": send_count,
        "verify_failed_count": 0,
        "last_sent_at": now.isoformat(),
        "request_ip": request_ip,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    if active_doc:
        update_doc = {k: v for k, v in doc.items() if k != "_id"}
        update_doc["challenge_id"] = active_doc.get("challenge_id") or str(active_doc["_id"])
        db.auth_email_challenges.update_one({"_id": active_doc["_id"]}, {"$set": update_doc})
    else:
        db.auth_email_challenges.insert_one(doc)

    subject = "电力交易辅助分析系统新设备登录验证码"
    body = (
        f"您的新设备登录验证码为：{code}\n"
        f"有效期 {max(5, EMAIL_CODE_EXPIRE_MINUTES)} 分钟。\n"
        "如非本人操作，请立即修改密码并联系管理员。"
    )
    if not send_email(subject=subject, body=body, recipients=[email]):
        raise HTTPException(status_code=503, detail="验证码发送失败，请联系管理员检查邮件配置")

    return {"expire_at": expire_at.isoformat(), "send_count": send_count}


def _check_locked_user(identifier: str):
    now = datetime.now()
    resolved_user = get_user(db, identifier)
    username = resolved_user.username if resolved_user else identifier
    user_doc = db.users.find_one(
        {"username": username},
        {"username": 1, "is_active": 1, "login_failed_count": 1, "login_locked_until": 1},
    )
    if not user_doc or not user_doc.get("is_active", True):
        return user_doc, None

    locked_until_raw = user_doc.get("login_locked_until")
    locked_until_dt = _parse_local_iso(locked_until_raw if isinstance(locked_until_raw, str) else None)
    if locked_until_dt and now < locked_until_dt:
        remaining_seconds = max(1, int((locked_until_dt - now).total_seconds()))
        return user_doc, {
            "locked": True,
            "locked_until": locked_until_dt.isoformat(),
            "remaining_seconds": remaining_seconds,
        }

    if locked_until_dt and now >= locked_until_dt:
        db.users.update_one(
            {"username": username},
            {"$unset": {"login_locked_until": ""}, "$set": {"login_failed_count": 0}},
        )

    return user_doc, None


def _register_login_failed(identifier: str) -> dict:
    now = datetime.now()
    resolved_user = get_user(db, identifier)
    username = resolved_user.username if resolved_user else identifier
    user_doc = db.users.find_one(
        {"username": username},
        {"username": 1, "is_active": 1, "login_failed_count": 1},
    )
    if not user_doc or not user_doc.get("is_active", True):
        return {"tracked": False}

    old_count = int(user_doc.get("login_failed_count", 0) or 0)
    new_count = old_count + 1
    update_fields = {
        "login_failed_count": new_count,
        "last_login_failed_at": now.isoformat(),
    }
    locked = False
    locked_until = None
    if new_count >= max(1, LOGIN_MAX_FAILED_ATTEMPTS):
        locked = True
        locked_until_dt = now + timedelta(minutes=max(1, LOGIN_LOCK_MINUTES))
        locked_until = locked_until_dt.isoformat()
        update_fields["login_locked_until"] = locked_until

    db.users.update_one({"username": username}, {"$set": update_fields})
    return {
        "tracked": True,
        "username": username,
        "failed_count": new_count,
        "locked": locked,
        "locked_until": locked_until,
    }

@app.post("/api/v1/token", tags=["Authentication"])
@limiter.limit("5/minute")
async def login_for_access_token(
    request: Request,
    force: bool = False,
    form_data: OAuth2PasswordRequestForm = Depends()
):
    geo_detail = _build_login_geo_detail(request)
    device_fingerprint = _get_device_fingerprint(request)
    device_name = _get_device_name(request)
    _, lock_state = _check_locked_user(form_data.username)
    if lock_state:
        locked_target = lock_state.get("username") if isinstance(lock_state, dict) else form_data.username
        _write_auth_audit_log(
            event="AUTH_LOGIN_BLOCKED_LOCKED",
            operator=form_data.username,
            target=locked_target,
            detail={
                **geo_detail,
                **lock_state,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "ACCOUNT_LOCKED",
                "message": "密码连续输入错误，账号已被临时锁定，请稍后重试",
                **lock_state,
            },
        )

    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        fail_state = _register_login_failed(form_data.username)
        failed_target = fail_state.get("username") if isinstance(fail_state, dict) else form_data.username
        _write_auth_audit_log(
            event="AUTH_LOGIN_FAILED",
            operator=form_data.username,
            target=failed_target,
            detail={
                **geo_detail,
                **fail_state,
            },
        )
        if fail_state.get("locked"):
            _write_auth_audit_log(
                event="AUTH_LOGIN_LOCKED",
                operator=form_data.username,
                target=failed_target,
                detail={
                    **geo_detail,
                    **fail_state,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail={
                    "code": "ACCOUNT_LOCKED",
                    "message": "密码连续输入错误，账号已被临时锁定，请稍后重试",
                    "locked_until": fail_state.get("locked_until"),
                },
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_doc = db.users.find_one(
        {"username": user.username},
        {
            "username": 1,
            "must_change_password": 1,
            "email": 1,
            "email_verified": 1,
            "email_mfa_enabled": 1,
        },
    ) or {}
    required_actions = get_required_security_actions(user_doc)
    has_trusted_device = has_active_trusted_device(user.username)
    email_mfa_required = (
        bool(device_fingerprint)
        and
        bool(user_doc.get("email_mfa_enabled"))
        and bool(user_doc.get("email"))
        and bool(user_doc.get("email_verified"))
        and has_trusted_device
        and not is_trusted_device(user.username, device_fingerprint)
    )
    if required_actions:
        challenge_token = create_security_challenge(
            user.username,
            required_actions,
            login_ip=geo_detail.get("login_ip"),
            login_city=geo_detail.get("login_city"),
            email_mfa_required=False,
            device_fingerprint=device_fingerprint,
            device_name=device_name,
        )
        _write_auth_audit_log(
            event="AUTH_REQUIRED_ACTIONS_TRIGGERED",
            operator=user.username,
            target=user.username,
            detail={
                "required_actions": required_actions,
                **geo_detail,
            },
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "challenge_token": challenge_token,
                "required_actions": required_actions,
                "token_type": "challenge",
            },
        )

    if email_mfa_required:
        challenge_token = create_security_challenge(
            user.username,
            [],
            login_ip=geo_detail.get("login_ip"),
            login_city=geo_detail.get("login_city"),
            email_mfa_required=True,
            device_fingerprint=device_fingerprint,
            device_name=device_name,
        )
        issue_result = _issue_login_email_code(user.username, str(user_doc.get("email") or "").strip(), geo_detail.get("login_ip") or "")
        _write_auth_audit_log(
            event="AUTH_LOGIN_EMAIL_MFA_REQUIRED",
            operator=user.username,
            target=user.username,
            detail={
                "challenge_token_issued": True,
                "expire_at": issue_result.get("expire_at"),
                "send_count": issue_result.get("send_count"),
                "device_name": device_name,
                **geo_detail,
            },
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "challenge_token": challenge_token,
                "required_actions": ["LOGIN_EMAIL_VERIFY"],
                "token_type": "challenge",
            },
        )

    ensure_auth_session_indexes()
    cleanup_stale_active_sessions(user.username)

    active_session = find_active_session(user.username)
    if active_session and not force:
        _write_auth_audit_log(
            event="AUTH_LOGIN_CONFLICT",
            operator=user.username,
            target=user.username,
            detail={
                "active_sid": active_session.get("sid"),
                **geo_detail,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "LOGIN_CONFLICT",
                "message": "账号已在其他会话登录，确认后将踢下线旧会话",
            }
        )

    if force:
        kicked_sid = active_session.get("sid") if active_session else None
        kick_active_sessions(user.username, reason="force_login")
        _write_auth_audit_log(
            event="AUTH_SESSION_KICKED",
            operator=user.username,
            target=user.username,
            detail={
                "kicked_sid": kicked_sid,
                "reason": "force_login",
                **geo_detail,
            },
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    sid = None
    for _ in range(2):
        try:
            sid = create_auth_session(
                user.username,
                ACCESS_TOKEN_EXPIRE_MINUTES,
                login_ip=geo_detail.get("login_ip"),
                login_city=geo_detail.get("login_city"),
            )
            break
        except DuplicateKeyError:
            cleanup_stale_active_sessions(user.username)
            if force:
                kick_active_sessions(user.username, reason="force_login_retry")
                continue
            latest_active = find_active_session(user.username)
            if latest_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "LOGIN_CONFLICT",
                        "message": "账号已在其他会话登录，确认后将踢下线旧会话",
                    }
                )
    if not sid:
        raise HTTPException(status_code=503, detail="登录会话创建失败，请稍后重试")

    db.users.update_one(
        {"username": user.username},
        {
            "$set": {"current_session_sid": sid, "login_failed_count": 0},
            "$unset": {"login_locked_until": "", "last_login_failed_at": ""},
        }
    )
    if device_fingerprint:
        trust_device(user.username, device_fingerprint, device_name=device_name)
    else:
        touch_trusted_device(user.username, device_fingerprint, device_name=device_name)
    enforce_single_active_session(user.username, sid)
    access_token = create_access_token(
        data={"sub": user.username, "sid": sid}, expires_delta=access_token_expires
    )
    _write_auth_audit_log(
        event="AUTH_LOGIN_SUCCESS",
        operator=user.username,
        target=user.username,
        detail={
            "sid": sid,
            "force_login": bool(force),
            **geo_detail,
        },
    )
    return {"access_token": access_token, "token_type": "bearer"}

# Include v1 routers
app.include_router(v1.public_router)
app.include_router(v1.router, dependencies=[Depends(get_current_active_user)])



@app.get("/", tags=["Root"], summary="应用根路径")
def read_root():
    return {"message": "欢迎使用电力交易辅助分析系统API"}

# Trigger reload 2
