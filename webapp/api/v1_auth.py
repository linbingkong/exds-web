# -*- coding: utf-8 -*-
"""
认证与授权管理 API
路径前缀：/api/v1/auth
"""
import logging
import random
import re
from datetime import datetime, timedelta
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pymongo.errors import DuplicateKeyError

from webapp.tools.mongo import DATABASE as db, get_config
from webapp.tools.ip_region import resolve_ip_city
from webapp.tools.notification import send_email
from webapp.tools.security import (
    get_current_active_user, get_password_hash, validate_password_strength, verify_password,
    IDLE_TIMEOUT_MINUTES, User, close_session, get_current_token_data, ensure_auth_session_indexes,
    ACCESS_TOKEN_EXPIRE_MINUTES, cleanup_stale_active_sessions, close_security_challenge,
    create_access_token, create_auth_session, ensure_auth_security_indexes, enforce_single_active_session,
    find_active_session, get_required_security_actions, get_security_challenge_by_token,
    hash_verification_code, kick_active_sessions, trust_device,
)
from webapp.models.auth import (
    CurrentUserContext, UserInfo, Permission, Role,
    CreateUserRequest, UpdateUserRolesRequest, UpdateUserStatusRequest, UpdateUserEmailMfaRequest,
    ResetPasswordRequest, CreateRoleRequest, UpdateRoleRequest,
    UpdateRolePermissionsRequest, UpdateMyProfileRequest, ChangeMyPasswordRequest,
    ChallengeTokenRequest, SecurityBindEmailRequest, SecurityChangePasswordRequest,
    SecurityCompleteRequest, SecurityVerifyEmailRequest,
    ForgotPasswordResetRequest, ForgotPasswordSendCodeRequest,
)
from webapp.api.dependencies.authz import (
    get_current_user_context, require_permission, require_any_permission
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["认证与授权"])
public_router = APIRouter(prefix="/auth", tags=["认证与授权-公开"])

EMAIL_CODE_EXPIRE_MINUTES = int(get_config("AUTH", "email_code_expire_minutes", "10"))
EMAIL_CODE_SEND_INTERVAL_SECONDS = int(get_config("AUTH", "email_code_send_interval_seconds", "60"))
EMAIL_CODE_MAX_SEND_COUNT = int(get_config("AUTH", "email_code_max_send_count", "5"))
EMAIL_CODE_MAX_VERIFY_ATTEMPTS = int(get_config("AUTH", "email_code_max_verify_attempts", "5"))
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_SCENE_FIRST_LOGIN = "first_login_verify_email"
EMAIL_SCENE_FORGOT_PASSWORD = "forgot_password"
EMAIL_SCENE_LOGIN_NEW_DEVICE = "login_new_device"
SECURITY_ACTION_LOGIN_EMAIL_VERIFY = "LOGIN_EMAIL_VERIFY"


def _get_default_user_password() -> str:
    return get_config("AUTH", "default_password", "0000aaaa....")


# ==================== 工具函数 ====================

def _write_audit_log(event: str, operator: str, target: Optional[str] = None,
                     detail: Optional[dict] = None):
    """写入审计日志"""
    try:
        db.auth_audit_logs.insert_one({
            "event": event,
            "operator": operator,
            "target": target,
            "detail": detail or {},
            "created_at": datetime.now().isoformat(),
        })
    except Exception as e:
        logger.error(f"审计日志写入失败: {e}")


def _get_real_ip(request: Request) -> str:
    if "x-forwarded-for" in request.headers:
        return request.headers["x-forwarded-for"].split(",")[0].strip()
    return (request.client.host if request.client else "") or ""


def _build_request_geo_detail(request: Request) -> dict:
    login_ip = _get_real_ip(request)
    return {
        "login_ip": login_ip,
        "login_city": resolve_ip_city(login_ip) if login_ip else None,
    }


def _build_security_status(user_doc: dict, required_actions: List[str]) -> dict:
    return {
        "username": user_doc.get("username"),
        "display_name": user_doc.get("display_name"),
        "email": user_doc.get("email"),
        "email_verified": bool(user_doc.get("email_verified")),
        "email_mfa_enabled": bool(user_doc.get("email_mfa_enabled")),
        "required_actions": required_actions,
    }


def _load_challenge_user(challenge_token: str) -> tuple[dict, dict]:
    challenge_doc = get_security_challenge_by_token(challenge_token)
    user_doc = db.users.find_one({"username": challenge_doc.get("username")})
    if not user_doc:
        close_security_challenge(challenge_doc.get("cid"), status_value="failed")
        raise HTTPException(status_code=404, detail="用户不存在")
    return challenge_doc, user_doc


def _build_effective_security_actions(user_doc: dict, challenge_doc: Optional[dict] = None) -> List[str]:
    actions = list(get_required_security_actions(user_doc))
    if challenge_doc and bool(challenge_doc.get("email_mfa_required")) and not bool(challenge_doc.get("email_mfa_verified")):
        actions.append(SECURITY_ACTION_LOGIN_EMAIL_VERIFY)
    return actions


def _validate_email_address(email: str) -> str:
    value = (email or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="请输入邮箱地址")
    if not EMAIL_PATTERN.match(value):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    return value


def _ensure_email_unique(email: Optional[str], exclude_username: Optional[str] = None) -> Optional[str]:
    value = ((email or "").strip() or None)
    if not value:
        return None

    query = {
        "email": {
            "$regex": f"^{re.escape(value)}$",
            "$options": "i",
        }
    }
    if exclude_username:
        query["username"] = {"$ne": exclude_username}

    exists = db.users.find_one(query, {"username": 1, "email": 1})
    if exists:
        raise HTTPException(status_code=400, detail="该邮箱已被其他账户绑定")
    return value


def _issue_email_verification_code(username: str, email: str, request_ip: str, scene: str = EMAIL_SCENE_FIRST_LOGIN) -> dict:
    ensure_auth_security_indexes()
    now = datetime.now()
    active_doc = db.auth_email_challenges.find_one(
        {"username": username, "email": email, "used_at": None, "scene": scene},
        sort=[("created_at", -1)],
    )
    if active_doc:
        last_sent_at = active_doc.get("last_sent_at")
        if isinstance(last_sent_at, str):
            try:
                last_sent_dt = datetime.fromisoformat(last_sent_at)
                if last_sent_dt.tzinfo is not None:
                    last_sent_dt = last_sent_dt.astimezone().replace(tzinfo=None)
                elapsed = (now - last_sent_dt).total_seconds()
                if elapsed < max(1, EMAIL_CODE_SEND_INTERVAL_SECONDS):
                    wait_seconds = max(1, int(EMAIL_CODE_SEND_INTERVAL_SECONDS - elapsed))
                    raise HTTPException(status_code=429, detail=f"验证码发送过于频繁，请 {wait_seconds} 秒后再试")
            except HTTPException:
                raise
            except Exception:
                pass

        send_count = int(active_doc.get("send_count", 0) or 0)
        created_at_raw = active_doc.get("created_at")
        if isinstance(created_at_raw, str):
            try:
                created_dt = datetime.fromisoformat(created_at_raw)
                if created_dt.tzinfo is not None:
                    created_dt = created_dt.astimezone().replace(tzinfo=None)
                if (now - created_dt).total_seconds() < 3600 and send_count >= max(1, EMAIL_CODE_MAX_SEND_COUNT):
                    raise HTTPException(status_code=429, detail="验证码发送次数过多，请稍后再试")
            except HTTPException:
                raise
            except Exception:
                pass

    code = f"{random.randint(0, 999999):06d}"
    challenge_id = ObjectId()
    expire_at = now.replace(microsecond=0)
    expire_at = expire_at + timedelta(minutes=max(5, EMAIL_CODE_EXPIRE_MINUTES))
    send_count = 1 if not active_doc else int(active_doc.get("send_count", 0) or 0) + 1
    doc = {
        "_id": challenge_id,
        "challenge_id": str(challenge_id),
        "username": username,
        "email": email,
        "scene": scene,
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
        db.auth_email_challenges.update_one(
            {"_id": active_doc["_id"]},
            {"$set": update_doc},
        )
        doc["challenge_id"] = active_doc.get("challenge_id") or str(active_doc["_id"])
    else:
        db.auth_email_challenges.insert_one(doc)

    subject = "电力交易辅助分析系统邮箱验证码"
    body = (
        f"您的邮箱验证码为：{code}\n"
        f"有效期 {max(5, EMAIL_CODE_EXPIRE_MINUTES)} 分钟。\n"
        "如非本人操作，请忽略此邮件。"
    )
    if not send_email(subject=subject, body=body, recipients=[email]):
        raise HTTPException(status_code=503, detail="验证码发送失败，请联系管理员检查邮件配置")

    return {"email": email, "expire_at": expire_at.isoformat(), "send_count": send_count, "scene": scene}


def _issue_login_email_mfa_code(challenge_doc: dict, user_doc: dict, request_ip: str) -> dict:
    email = _validate_email_address(str(user_doc.get("email") or ""))
    if not bool(user_doc.get("email_verified")):
        raise HTTPException(status_code=400, detail="当前用户邮箱未验证，无法启用新设备邮件验证")
    return _issue_email_verification_code(
        username=user_doc["username"],
        email=email,
        request_ip=request_ip,
        scene=EMAIL_SCENE_LOGIN_NEW_DEVICE,
    )


def _verify_email_code(username: str, email: str, code: str, scene: str = EMAIL_SCENE_FIRST_LOGIN) -> None:
    now = datetime.now()
    doc = db.auth_email_challenges.find_one(
        {"username": username, "email": email, "used_at": None, "scene": scene},
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=400, detail="请先获取邮箱验证码")

    expire_at = doc.get("expire_at")
    expire_dt = datetime.fromisoformat(expire_at) if isinstance(expire_at, str) else None
    if expire_dt and expire_dt.tzinfo is not None:
        expire_dt = expire_dt.astimezone().replace(tzinfo=None)
    if expire_dt and now > expire_dt:
        raise HTTPException(status_code=400, detail="验证码已过期，请重新发送")

    failed_count = int(doc.get("verify_failed_count", 0) or 0)
    if failed_count >= max(1, EMAIL_CODE_MAX_VERIFY_ATTEMPTS):
        raise HTTPException(status_code=400, detail="验证码错误次数过多，请重新发送")

    if hash_verification_code((code or "").strip()) != doc.get("code_hash"):
        db.auth_email_challenges.update_one(
            {"_id": doc["_id"]},
            {"$set": {"verify_failed_count": failed_count + 1, "updated_at": now.isoformat()}},
        )
        remaining = max(0, EMAIL_CODE_MAX_VERIFY_ATTEMPTS - failed_count - 1)
        if remaining > 0:
            raise HTTPException(status_code=400, detail=f"验证码错误，还可重试 {remaining} 次")
        raise HTTPException(status_code=400, detail="验证码错误次数过多，请重新发送")

    db.auth_email_challenges.update_one(
        {"_id": doc["_id"]},
        {"$set": {"used_at": now.isoformat(), "updated_at": now.isoformat()}},
    )


def _forgot_password_send_response(expire_at: Optional[str] = None) -> dict:
    return {
        "message": "如果账户与邮箱匹配，验证码已发送",
        "expire_at": expire_at,
    }




# ==================== 当前用户信息 ====================

@router.get("/me", response_model=UserInfo, summary="获取当前用户信息与权限")
async def get_me(
    ctx: CurrentUserContext = Depends(get_current_user_context),
):
    """
    登录后前端拉取此接口，获取：
    - 当前用户基本信息
    - 角色列表
    - 权限码列表
    - 空闲超时配置（供前端空闲计时器使用）
    """
    return UserInfo(
        username=ctx.username,
        display_name=ctx.display_name,
        email=ctx.email,
        roles=ctx.role_codes,
        permissions=ctx.permission_codes,
        is_super_admin=ctx.is_super_admin,
        idle_timeout_minutes=IDLE_TIMEOUT_MINUTES,
    )


@router.put("/me/profile", summary="更新当前用户资料")
async def update_my_profile(
    body: UpdateMyProfileRequest,
    current_user: User = Depends(get_current_active_user),
    _: CurrentUserContext = Depends(require_any_permission(["module:dashboard_overview:view", "system:auth:manage"])),
):
    next_email = (body.email or "").strip() or None
    _ensure_email_unique(next_email, exclude_username=current_user.username)
    update_fields = {
        "display_name": (body.display_name or "").strip() or None,
        "email": next_email,
    }
    db.users.update_one(
        {"username": current_user.username},
        {"$set": update_fields}
    )
    _write_audit_log("SELF_PROFILE_UPDATED", current_user.username, current_user.username, update_fields)
    return {"message": "个人资料更新成功"}


@router.put("/me/password", summary="修改当前用户密码")
async def change_my_password(
    body: ChangeMyPasswordRequest,
    current_user: User = Depends(get_current_active_user),
    _: CurrentUserContext = Depends(require_any_permission(["module:dashboard_overview:view", "system:auth:manage"])),
):
    user_doc = db.users.find_one({"username": current_user.username})
    if not user_doc:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(body.old_password, user_doc.get("hashed_password", "")):
        raise HTTPException(status_code=400, detail="旧密码错误")
    is_valid, msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    db.users.update_one(
        {"username": current_user.username},
        {"$set": {
            "hashed_password": get_password_hash(body.new_password),
            "must_change_password": False,
            "password_changed_at": datetime.now().isoformat(),
        }}
    )
    _write_audit_log("SELF_PASSWORD_CHANGED", current_user.username, current_user.username)
    return {"message": "密码修改成功"}


@router.post("/logout", summary="当前用户主动登出")
async def logout_me(
    current_user: User = Depends(get_current_active_user),
    token_data = Depends(get_current_token_data),
):
    sid = token_data.sid
    if sid:
        close_session(sid, status="logout", reason="user_logout")
    _write_audit_log("AUTH_LOGOUT", current_user.username, current_user.username, {"sid": sid})
    return {"message": "登出成功"}


@public_router.post("/password/forgot/send-code", summary="忘记密码-发送邮箱验证码")
async def forgot_password_send_code(body: ForgotPasswordSendCodeRequest, request: Request):
    username = (body.username or "").strip()
    email = (body.email or "").strip()
    request_ip = _get_real_ip(request)
    if not username or not email or not EMAIL_PATTERN.match(email):
        return _forgot_password_send_response()

    user_doc = db.users.find_one(
        {"username": username, "is_active": True},
        {"username": 1, "email": 1, "email_verified": 1, "is_active": 1},
    )
    if not user_doc:
        return _forgot_password_send_response()

    bound_email = str(user_doc.get("email") or "").strip()
    if not bound_email or bound_email.lower() != email.lower() or not bool(user_doc.get("email_verified")):
        return _forgot_password_send_response()

    try:
        send_result = _issue_email_verification_code(
            username=user_doc["username"],
            email=bound_email,
            request_ip=request_ip,
            scene=EMAIL_SCENE_FORGOT_PASSWORD,
        )
        _write_audit_log(
            "AUTH_FORGOT_PASSWORD_CODE_SENT",
            user_doc["username"],
            user_doc["username"],
            {
                "email": bound_email,
                "expire_at": send_result.get("expire_at"),
                "send_count": send_result.get("send_count"),
                "request_ip": request_ip,
            },
        )
        return _forgot_password_send_response(send_result.get("expire_at"))
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        logger.warning("忘记密码验证码发送失败: username=%s error=%s", username, exc.detail)
        return _forgot_password_send_response()


@public_router.post("/password/forgot/reset", summary="忘记密码-重置密码")
async def forgot_password_reset(body: ForgotPasswordResetRequest, request: Request):
    username = (body.username or "").strip()
    email = _validate_email_address(body.email)
    code = (body.code or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="请输入账户")
    if not code:
        raise HTTPException(status_code=400, detail="请输入邮箱验证码")

    user_doc = db.users.find_one(
        {"username": username, "is_active": True},
        {"username": 1, "email": 1, "hashed_password": 1, "is_active": 1},
    )
    if not user_doc:
        _write_audit_log("AUTH_FORGOT_PASSWORD_RESET_FAILED", username, username, {"reason": "user_not_found", "request_ip": _get_real_ip(request)})
        raise HTTPException(status_code=400, detail="账户或邮箱不匹配")

    bound_email = str(user_doc.get("email") or "").strip()
    if bound_email.lower() != email.lower():
        _write_audit_log("AUTH_FORGOT_PASSWORD_RESET_FAILED", username, username, {"reason": "email_mismatch", "request_ip": _get_real_ip(request)})
        raise HTTPException(status_code=400, detail="账户或邮箱不匹配")

    is_valid, msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    if verify_password(body.new_password, user_doc.get("hashed_password", "")):
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    _verify_email_code(username, bound_email, code, scene=EMAIL_SCENE_FORGOT_PASSWORD)
    now = datetime.now().isoformat()
    db.users.update_one(
        {"username": username},
        {"$set": {
            "hashed_password": get_password_hash(body.new_password),
            "must_change_password": False,
            "password_changed_at": now,
            "updated_at": now,
        }},
    )
    kick_active_sessions(username, reason="forgot_password_reset")
    db.users.update_one({"username": username}, {"$unset": {"current_session_sid": ""}})
    db.auth_email_challenges.update_many(
        {"username": username, "email": bound_email, "scene": EMAIL_SCENE_FORGOT_PASSWORD, "used_at": None},
        {"$set": {"used_at": now, "updated_at": now}},
    )
    _write_audit_log(
        "AUTH_FORGOT_PASSWORD_RESET_SUCCESS",
        username,
        username,
        {"email": bound_email, "request_ip": _get_real_ip(request)},
    )
    return {"message": "密码重置成功，请重新登录"}


@public_router.post("/security/status", summary="查询首登安全动作状态")
async def get_security_status(body: ChallengeTokenRequest):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    required_actions = _build_effective_security_actions(user_doc, challenge_doc)
    return _build_security_status(user_doc, required_actions)


@public_router.post("/security/change-password", summary="首登安全流程-修改密码")
async def change_password_by_required_action(body: SecurityChangePasswordRequest):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    is_valid, msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    if verify_password(body.new_password, user_doc.get("hashed_password", "")):
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    now = datetime.now().isoformat()
    db.users.update_one(
        {"username": user_doc["username"]},
        {"$set": {
            "hashed_password": get_password_hash(body.new_password),
            "must_change_password": False,
            "password_changed_at": now,
            "updated_at": now,
            "security_actions_completed_at": None,
        }},
    )
    updated_user = db.users.find_one({"username": user_doc["username"]}) or user_doc
    required_actions = _build_effective_security_actions(updated_user, challenge_doc)
    _write_audit_log(
        "AUTH_PASSWORD_CHANGED_BY_REQUIRED_ACTION",
        updated_user["username"],
        updated_user["username"],
        {"required_actions": required_actions, "challenge_id": challenge_doc.get("cid")},
    )
    return {
        "message": "密码修改成功",
        **_build_security_status(updated_user, required_actions),
    }


@public_router.post("/security/bind-email", summary="首登安全流程-绑定邮箱并发送验证码")
async def bind_email_by_required_action(body: SecurityBindEmailRequest, request: Request):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    email = _validate_email_address(body.email)
    _ensure_email_unique(email, exclude_username=user_doc["username"])
    request_ip = _get_real_ip(request)
    now = datetime.now().isoformat()
    db.users.update_one(
        {"username": user_doc["username"]},
        {"$set": {
            "email": email,
            "email_verified": False,
            "updated_at": now,
            "security_actions_completed_at": None,
        }},
    )
    send_result = _issue_email_verification_code(user_doc["username"], email, request_ip)
    updated_user = db.users.find_one({"username": user_doc["username"]}) or user_doc
    required_actions = _build_effective_security_actions(updated_user, challenge_doc)
    _write_audit_log(
        "AUTH_EMAIL_BIND_SENT",
        updated_user["username"],
        updated_user["username"],
        {
            "email": email,
            "challenge_id": challenge_doc.get("cid"),
            "expire_at": send_result.get("expire_at"),
            "send_count": send_result.get("send_count"),
            "request_ip": request_ip,
        },
    )
    return {
        "message": "验证码已发送，请查收邮箱",
        **_build_security_status(updated_user, required_actions),
    }


@public_router.post("/security/verify-email", summary="首登安全流程-校验邮箱验证码")
async def verify_email_by_required_action(body: SecurityVerifyEmailRequest):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    email = _validate_email_address(str(user_doc.get("email") or ""))
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="请输入邮箱验证码")

    now = datetime.now().isoformat()
    if bool(challenge_doc.get("email_mfa_required")) and not bool(challenge_doc.get("email_mfa_verified")):
        _verify_email_code(user_doc["username"], email, code, scene=EMAIL_SCENE_LOGIN_NEW_DEVICE)
        db.auth_security_challenges.update_one(
            {"cid": challenge_doc.get("cid")},
            {"$set": {"email_mfa_verified": True, "email_mfa_verified_at": now, "updated_at": now}},
        )
        _write_audit_log(
            "AUTH_LOGIN_EMAIL_MFA_VERIFIED",
            user_doc["username"],
            user_doc["username"],
            {"email": email, "challenge_id": challenge_doc.get("cid")},
        )
        refreshed_challenge, updated_user = _load_challenge_user(body.challenge_token)
        required_actions = _build_effective_security_actions(updated_user, refreshed_challenge)
        return {
            "message": "新设备邮件验证码校验成功",
            **_build_security_status(updated_user, required_actions),
        }

    _verify_email_code(user_doc["username"], email, code)
    db.users.update_one(
        {"username": user_doc["username"]},
        {"$set": {
            "email_verified": True,
            "updated_at": now,
        }},
    )
    updated_user = db.users.find_one({"username": user_doc["username"]}) or user_doc
    required_actions = _build_effective_security_actions(updated_user, challenge_doc)
    _write_audit_log(
        "AUTH_EMAIL_VERIFIED",
        updated_user["username"],
        updated_user["username"],
        {"email": email, "challenge_id": challenge_doc.get("cid")},
    )
    return {
        "message": "邮箱验证成功",
        **_build_security_status(updated_user, required_actions),
    }


@public_router.post("/security/send-login-email-code", summary="登录安全流程-重发新设备邮件验证码")
async def resend_login_email_code(body: ChallengeTokenRequest, request: Request):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    if not bool(challenge_doc.get("email_mfa_required")):
        raise HTTPException(status_code=400, detail="当前安全流程不需要新设备邮件验证")
    if bool(challenge_doc.get("email_mfa_verified")):
        raise HTTPException(status_code=400, detail="当前挑战已完成新设备邮件验证")

    send_result = _issue_login_email_mfa_code(challenge_doc, user_doc, _get_real_ip(request))
    _write_audit_log(
        "AUTH_LOGIN_EMAIL_MFA_CODE_SENT",
        user_doc["username"],
        user_doc["username"],
        {
            "challenge_id": challenge_doc.get("cid"),
            "expire_at": send_result.get("expire_at"),
            "send_count": send_result.get("send_count"),
            "request_ip": _get_real_ip(request),
        },
    )
    return {
        "message": "验证码已重新发送，请查收邮箱",
        **_build_security_status(user_doc, _build_effective_security_actions(user_doc, challenge_doc)),
    }


@public_router.post("/security/complete", summary="首登安全流程完成后签发正式登录会话")
async def complete_required_actions(
    body: SecurityCompleteRequest,
    request: Request,
):
    challenge_doc, user_doc = _load_challenge_user(body.challenge_token)
    required_actions = _build_effective_security_actions(user_doc, challenge_doc)
    if required_actions:
        raise HTTPException(status_code=400, detail={"message": "仍有未完成的安全动作", "required_actions": required_actions})

    geo_detail = _build_request_geo_detail(request)
    ensure_auth_session_indexes()
    cleanup_stale_active_sessions(user_doc["username"])

    active_session = find_active_session(user_doc["username"])
    if active_session and not body.force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "LOGIN_CONFLICT",
                "message": "账号已在其他会话登录，确认后将踢下线旧会话",
            },
        )

    if body.force:
        kick_active_sessions(user_doc["username"], reason="force_login")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    sid = None
    for _ in range(2):
        try:
            sid = create_auth_session(
                user_doc["username"],
                ACCESS_TOKEN_EXPIRE_MINUTES,
                login_ip=geo_detail.get("login_ip"),
                login_city=geo_detail.get("login_city"),
            )
            break
        except DuplicateKeyError:
            cleanup_stale_active_sessions(user_doc["username"])
            if body.force:
                kick_active_sessions(user_doc["username"], reason="force_login_retry")
                continue
            latest_active = find_active_session(user_doc["username"])
            if latest_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "LOGIN_CONFLICT",
                        "message": "账号已在其他会话登录，确认后将踢下线旧会话",
                    },
                )

    if not sid:
        raise HTTPException(status_code=503, detail="登录会话创建失败，请稍后重试")

    now = datetime.now().isoformat()
    db.users.update_one(
        {"username": user_doc["username"]},
        {"$set": {
            "current_session_sid": sid,
            "login_failed_count": 0,
            "security_actions_completed_at": now,
            "updated_at": now,
        },
        "$unset": {"login_locked_until": "", "last_login_failed_at": ""}},
    )
    if challenge_doc.get("device_fingerprint"):
        trust_device(
            user_doc["username"],
            challenge_doc.get("device_fingerprint"),
            device_name=challenge_doc.get("device_name"),
        )
    enforce_single_active_session(user_doc["username"], sid)
    close_security_challenge(challenge_doc.get("cid"), status_value="completed")
    access_token = create_access_token(
        data={"sub": user_doc["username"], "sid": sid},
        expires_delta=access_token_expires,
    )
    _write_audit_log(
        "AUTH_REQUIRED_ACTIONS_COMPLETED",
        user_doc["username"],
        user_doc["username"],
        {"sid": sid, "challenge_id": challenge_doc.get("cid"), **geo_detail},
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ==================== 权限点管理 ====================

@router.get("/permissions", summary="获取权限点列表")
async def list_permissions(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取所有权限点定义（供管理页使用）"""
    docs = list(db.auth_permissions.find({}, {"_id": 0}))
    return {"total": len(docs), "permissions": docs}


@router.get("/modules", summary="获取模块定义列表")
async def list_modules(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取模块定义（按菜单顺序）"""
    docs = list(db.auth_modules.find({}, {"_id": 0}).sort([("sort_order", 1), ("module_code", 1)]))
    return {"total": len(docs), "modules": docs}


# ==================== 角色管理 ====================

@router.get("/roles", summary="获取角色列表")
async def list_roles(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取所有角色定义"""
    docs = list(db.auth_roles.find({}, {"_id": 0}))
    return {"total": len(docs), "roles": docs}


@router.post("/roles", summary="创建角色", status_code=status.HTTP_201_CREATED)
async def create_role(
    body: CreateRoleRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    if db.auth_roles.find_one({"code": body.code}):
        raise HTTPException(status_code=400, detail=f"角色编码 {body.code} 已存在")
    doc = {
        "code": body.code,
        "name": body.name,
        "description": body.description,
        "permissions": body.permissions,
        "is_system": False,
        "is_active": True,
        "created_at": datetime.now().isoformat(),
    }
    db.auth_roles.insert_one(doc)
    _write_audit_log("ROLE_CREATED", ctx.username, body.code, {"name": body.name})
    return {"message": "角色创建成功", "code": body.code}


@router.put("/roles/{role_code}", summary="更新角色基本信息")
async def update_role(
    role_code: str,
    body: UpdateRoleRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.get("is_system"):
        raise HTTPException(status_code=400, detail="系统内置角色不允许修改")
    update_fields = {}
    if body.name is not None:
        update_fields["name"] = body.name
    if body.description is not None:
        update_fields["description"] = body.description
    if update_fields:
        db.auth_roles.update_one({"code": role_code}, {"$set": update_fields})
    _write_audit_log("ROLE_UPDATED", ctx.username, role_code, update_fields)
    return {"message": "更新成功"}


@router.put("/roles/{role_code}/permissions", summary="全量覆盖角色权限")
async def update_role_permissions(
    role_code: str,
    body: UpdateRolePermissionsRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    old_perms = role.get("permissions", [])
    db.auth_roles.update_one({"code": role_code}, {"$set": {"permissions": body.permissions}})
    _write_audit_log("ROLE_PERMISSIONS_UPDATED", ctx.username, role_code, {
        "before": old_perms, "after": body.permissions
    })
    return {"message": "权限更新成功"}


@router.delete("/roles/{role_code}", summary="删除角色")
async def delete_role(
    role_code: str,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.get("is_system"):
        raise HTTPException(status_code=400, detail="系统内置角色不允许删除")

    in_use = db.users.count_documents({"roles": role_code})
    if in_use > 0:
        raise HTTPException(status_code=400, detail=f"角色仍被 {in_use} 个用户使用，无法删除")

    db.auth_roles.delete_one({"code": role_code})
    _write_audit_log("ROLE_DELETED", ctx.username, role_code, {"name": role.get("name")})
    return {"message": "角色删除成功"}


# ==================== 用户管理 ====================

@router.get("/users", summary="获取系统用户列表")
async def list_users(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    skip = (page - 1) * page_size
    total = db.users.count_documents({})
    docs = list(db.users.find(
        {},
        {"hashed_password": 0, "last_active_at": 0}
    ).sort([
        ("last_active_at", -1),
        ("created_at", -1),
        ("username", 1),
    ]).skip(skip).limit(page_size))
    for doc in docs:
        doc["_id"] = str(doc["_id"])
    return {"total": total, "users": docs}


@router.post("/users", summary="创建系统用户", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    if db.users.find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail=f"用户名 {body.username} 已存在")
    normalized_email = ((body.email or "").strip() or None)
    _ensure_email_unique(normalized_email)
    password = (body.password or "").strip() or _get_default_user_password()
    is_valid, msg = validate_password_strength(password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    doc = {
        "username": body.username,
        "hashed_password": get_password_hash(password),
        "display_name": body.display_name,
        "email": normalized_email,
        "email_verified": False if body.require_email_verification else bool(normalized_email),
        "email_mfa_enabled": bool(body.email_mfa_enabled),
        "roles": body.roles,
        "is_active": True,
        "must_change_password": True,
        "security_actions_completed_at": None,
        "password_changed_at": None,
        "created_at": datetime.now().isoformat(),
    }
    db.users.insert_one(doc)
    _write_audit_log("USER_CREATED", ctx.username, body.username, {
        "roles": body.roles,
        "used_default_password": not bool((body.password or "").strip()),
        "require_email_verification": body.require_email_verification,
        "email_mfa_enabled": bool(body.email_mfa_enabled),
    })
    return {"message": "用户创建成功", "username": body.username}


@router.put("/users/{username}/roles", summary="全量覆盖用户角色")
async def update_user_roles(
    username: str,
    body: UpdateUserRolesRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    old_roles = user.get("roles", [])
    db.users.update_one({"username": username}, {"$set": {"roles": body.roles}})
    _write_audit_log("USER_ROLES_UPDATED", ctx.username, username, {
        "before": old_roles, "after": body.roles
    })
    return {"message": "角色更新成功"}


@router.put("/users/{username}/status", summary="启用/禁用用户")
async def update_user_status(
    username: str,
    body: UpdateUserStatusRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if username == ctx.username:
        raise HTTPException(status_code=400, detail="不能禁用自己的账号")
    db.users.update_one({"username": username}, {"$set": {"is_active": body.is_active}})
    action = "USER_ENABLED" if body.is_active else "USER_DISABLED"
    _write_audit_log(action, ctx.username, username)
    return {"message": "状态更新成功"}


@router.put("/users/{username}/email-mfa-toggle", summary="启用/关闭新设备邮件验证")
async def update_user_email_mfa(
    username: str,
    body: UpdateUserEmailMfaRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username}, {"email": 1, "email_verified": 1, "email_mfa_enabled": 1})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if body.email_mfa_enabled:
        email = str(user.get("email") or "").strip()
        if not email:
            raise HTTPException(status_code=400, detail="用户未绑定邮箱，无法启用新设备邮件验证")
        if not bool(user.get("email_verified")):
            raise HTTPException(status_code=400, detail="用户邮箱尚未验证，无法启用新设备邮件验证")

    db.users.update_one(
        {"username": username},
        {"$set": {"email_mfa_enabled": body.email_mfa_enabled, "updated_at": datetime.now().isoformat()}},
    )
    _write_audit_log(
        "USER_EMAIL_MFA_UPDATED",
        ctx.username,
        username,
        {"before": bool(user.get("email_mfa_enabled")), "after": body.email_mfa_enabled},
    )
    return {"message": "新设备邮件验证状态已更新"}


@router.put("/users/{username}/password/reset", summary="重置用户密码")
async def reset_user_password(
    username: str,
    body: ResetPasswordRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    new_password = (body.new_password or "").strip() or _get_default_user_password()
    is_valid, msg = validate_password_strength(new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    db.users.update_one({"username": username}, {"$set": {
        "hashed_password": get_password_hash(new_password),
        "must_change_password": True,
        "password_changed_at": datetime.now().isoformat(),
    }})
    _write_audit_log("USER_PASSWORD_RESET", ctx.username, username, {
        "used_default_password": not bool((body.new_password or "").strip()),
    })
    return {"message": "密码重置成功，用户下次登录需修改密码"}


@router.delete("/users/{username}", summary="删除用户")
async def delete_user(
    username: str,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if username == ctx.username:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    if username in {"admin"}:
        raise HTTPException(status_code=400, detail="系统保留账号不允许删除")
    if user.get("is_active", True):
        raise HTTPException(status_code=400, detail="仅允许删除已禁用用户，请先禁用该用户")

    db.users.delete_one({"username": username})
    _write_audit_log("USER_DELETED", ctx.username, username)
    return {"message": "用户删除成功"}


# ==================== 审计日志 ====================

@router.get("/audit-logs", summary="查询审计日志")
async def get_audit_logs(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    operator: Optional[str] = None,
    event: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = {}
    if operator:
        query["operator"] = operator
    if event:
        query["event"] = event
    if date_from or date_to:
        query["created_at"] = {}
        if date_from:
            query["created_at"]["$gte"] = date_from
        if date_to:
            query["created_at"]["$lte"] = date_to + "T23:59:59"

    skip = (page - 1) * page_size
    total = db.auth_audit_logs.count_documents(query)
    docs = list(db.auth_audit_logs.find(query, {"_id": 0})
                .sort("created_at", -1)
                .skip(skip)
                .limit(page_size))
    return {"total": total, "logs": docs}


@router.get("/sessions", summary="查询登录会话记录")
async def get_auth_sessions(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    username: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    ensure_auth_session_indexes()

    query = {}
    if username:
        query["username"] = username
    if status_filter:
        query["status"] = status_filter
    if date_from or date_to:
        query["login_at"] = {}
        if date_from:
            query["login_at"]["$gte"] = date_from
        if date_to:
            query["login_at"]["$lte"] = date_to + "T23:59:59"

    skip = (page - 1) * page_size
    total = db.auth_sessions.count_documents(query)
    docs = list(
        db.auth_sessions.find(query, {"_id": 0})
        .sort("login_at", -1)
        .skip(skip)
        .limit(page_size)
    )
    return {"total": total, "sessions": docs}
