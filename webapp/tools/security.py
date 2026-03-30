import re
import os
import logging
import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pymongo.errors import OperationFailure
from pydantic import BaseModel

# This is a relative import, assuming the mongo tool is in the same 'tools' directory
from .mongo import DATABASE as db, get_config

logger = logging.getLogger(__name__)

# --- Password Hashing ---
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a hashed one."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hashes a password."""
    return pwd_context.hash(password)

def validate_password_strength(password: str) -> (bool, str): # type: ignore
    """
    Validates the password strength.
    Returns a tuple (is_valid, message).
    """
    if len(password) < 8:
        return False, "密码长度至少 8 位。"
    
    checks = {
        "uppercase": re.search(r"[A-Z]", password),
        "lowercase": re.search(r"[a-z]", password),
        "digit": re.search(r"\d", password),
        "special": re.search(r"[!@#$%^&*.]", password),
    }
    
    met_criteria_count = sum(1 for check in checks.values() if check)
    
    if met_criteria_count < 3:
        return False, "密码需至少满足以下四类中的三类：大写字母、小写字母、数字、特殊字符（!@#$%^&*.）。"
        
    return True, "密码格式有效。"

# --- Security & Config Constants ---
# SECRET_KEY 从 .exds/config.ini [JWT] 段读取。若未配置则使用不安全的默认值并打印警告。
_secret_key_from_config = get_config('JWT', 'secret_key', default_value=None)
if _secret_key_from_config:
    SECRET_KEY = _secret_key_from_config
else:
    SECRET_KEY = "a_very_secret_key_that_should_be_changed"
    logger.warning(
        "⚠️  JWT SECRET_KEY 使用了不安全的默认值！"
        "请在 ~/.exds/config.ini 的 [JWT] 段配置 secret_key，例如：\n"
        "[JWT]\nsecret_key = <your-random-secret>"
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(get_config('JWT', 'access_token_expire_minutes', default_value='180'))
SECURITY_CHALLENGE_EXPIRE_MINUTES = int(get_config('AUTH', 'security_challenge_expire_minutes', default_value='30'))
TRUSTED_DEVICE_DAYS = int(get_config('AUTH', 'trusted_device_days', default_value='30'))

# 无操作空闲超时（分钟），从配置读取，默认 30 分钟
IDLE_TIMEOUT_MINUTES = int(get_config('AUTH', 'idle_timeout_minutes', default_value='15'))

# 授权开关：从 .exds/config.ini [AUTH] enabled 读取，默认开启
_auth_enabled_str = get_config('AUTH', 'enabled', default_value='true')
AUTH_ENABLED = str(_auth_enabled_str).strip().lower() not in ('false', '0', 'no')
if not AUTH_ENABLED:
    logger.warning("⚠️  权限校验已通过配置禁用（AUTH_ENABLED=false），仅限开发调试使用！")

# --- Pydantic Models ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    sid: Optional[str] = None  # 会话ID，阶段 1.5 预留


class ChallengeTokenData(BaseModel):
    username: Optional[str] = None
    cid: Optional[str] = None
    token_type: Optional[str] = None

class User(BaseModel):
    username: str
    is_active: Optional[bool] = None
    display_name: Optional[str] = None
    roles: Optional[List[str]] = []
    email: Optional[str] = None

class UserInDB(User):
    hashed_password: str

# --- OAuth2 Scheme ---
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Database & Auth Functions ---
def _find_user_doc_for_login(db_session, identifier: str):
    value = (identifier or "").strip()
    if not value:
        return None

    user = db_session.users.find_one({"username": value})
    if user:
        return user

    if "@" not in value:
        return None

    email_matches = list(
        db_session.users.find(
            {"email": {"$regex": f"^{re.escape(value)}$", "$options": "i"}},
        ).limit(2)
    )
    if len(email_matches) > 1:
        logger.warning("检测到重复邮箱，无法按邮箱登录: %s", value)
        return None
    return email_matches[0] if email_matches else None


def get_user(db_session, identifier: str):
    user = _find_user_doc_for_login(db_session, identifier)
    if user:
        return UserInDB(
            username=user.get("username"),
            is_active=user.get("is_active", True),
            hashed_password=user.get("hashed_password", ""),
            display_name=user.get("display_name") or user.get("full_name"),
            roles=user.get("roles", []),
            email=user.get("email"),
        )

def authenticate_user(db_session, identifier: str, password: str):
    user = get_user(db_session, identifier)
    if not user or not user.is_active:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    # 登录成功后立刻刷新活跃时间，避免“首个受保护请求”被空闲超时误判
    try:
        db_session.users.update_one(
            {"username": user.username},
            {"$set": {"last_active_at": datetime.now().isoformat()}}
        )
    except Exception as e:
        logger.warning(f"登录后更新 last_active_at 失败（非致命）: {e}")
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now() + expires_delta
    else:
        expire = datetime.now() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_challenge_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.now() + (expires_delta or timedelta(minutes=SECURITY_CHALLENGE_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "token_type": "security_challenge"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_challenge_token(token: str) -> ChallengeTokenData:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        token_type = payload.get("token_type")
        if token_type != "security_challenge":
            raise ValueError("invalid token type")
        username: str = payload.get("sub")
        cid: str = payload.get("cid")
        if not username or not cid:
            raise ValueError("invalid token payload")
        return ChallengeTokenData(username=username, cid=cid, token_type=token_type)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="安全验证凭证无效或已过期")


def get_required_security_actions(user_doc: Optional[dict]) -> List[str]:
    if not user_doc:
        return []

    actions: List[str] = []
    if bool(user_doc.get("must_change_password")):
        actions.append("CHANGE_PASSWORD")

    email = str(user_doc.get("email") or "").strip()
    email_verified = bool(user_doc.get("email_verified"))
    if not email:
        actions.append("BIND_EMAIL")
    elif not email_verified:
        actions.append("VERIFY_EMAIL")

    return actions


def ensure_auth_security_indexes():
    db.auth_security_challenges.create_index([("cid", 1)], unique=True)
    db.auth_security_challenges.create_index([("username", 1), ("status", 1), ("created_at", -1)])
    db.auth_security_challenges.create_index([("expires_at", 1)])
    db.auth_email_challenges.create_index([("challenge_id", 1)], unique=True)
    db.auth_email_challenges.create_index([("username", 1), ("email", 1), ("used_at", 1), ("expire_at", -1)])
    db.auth_trusted_devices.create_index([("username", 1), ("device_fingerprint", 1)], unique=True)
    db.auth_trusted_devices.create_index([("username", 1), ("is_active", 1), ("last_seen_at", -1)])
    db.auth_trusted_devices.create_index([("trust_expire_at", 1)])


def _challenge_now() -> datetime:
    return datetime.now()


def create_security_challenge(
    username: str,
    required_actions: List[str],
    login_ip: Optional[str] = None,
    login_city: Optional[str] = None,
    email_mfa_required: bool = False,
    device_fingerprint: Optional[str] = None,
    device_name: Optional[str] = None,
) -> str:
    ensure_auth_security_indexes()
    now = _challenge_now()
    cid = uuid.uuid4().hex
    expires_at = now + timedelta(minutes=max(5, SECURITY_CHALLENGE_EXPIRE_MINUTES))
    db.auth_security_challenges.update_many(
        {"username": username, "status": "active"},
        {"$set": {"status": "replaced", "updated_at": now.isoformat(), "invalidated_at": now.isoformat()}},
    )
    db.auth_security_challenges.insert_one({
        "cid": cid,
        "username": username,
        "required_actions": required_actions,
        "status": "active",
        "email_mfa_required": email_mfa_required,
        "email_mfa_verified": False,
        "device_fingerprint": device_fingerprint,
        "device_name": device_name,
        "login_ip": login_ip,
        "login_city": login_city,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
    })
    return create_challenge_token(
        {"sub": username, "cid": cid},
        expires_delta=timedelta(minutes=max(5, SECURITY_CHALLENGE_EXPIRE_MINUTES)),
    )


def get_security_challenge_by_token(token: str) -> dict:
    token_data = decode_challenge_token(token)
    doc = db.auth_security_challenges.find_one({"cid": token_data.cid, "username": token_data.username})
    if not doc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="安全验证会话不存在")

    if doc.get("status") != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="安全验证会话已失效，请重新登录")

    expires_at = _parse_iso_datetime(doc.get("expires_at"))
    if expires_at and datetime.now() > expires_at:
        db.auth_security_challenges.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "expired", "updated_at": datetime.now().isoformat(), "invalidated_at": datetime.now().isoformat()}},
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="安全验证会话已过期，请重新登录")

    return doc


def close_security_challenge(cid: str, status_value: str = "completed"):
    now = datetime.now().isoformat()
    db.auth_security_challenges.update_one(
        {"cid": cid},
        {"$set": {"status": status_value, "updated_at": now, "invalidated_at": now}},
    )


def normalize_device_fingerprint(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > 256:
        text = text[:256]
    return text


def is_trusted_device(username: str, device_fingerprint: Optional[str]) -> bool:
    fingerprint = normalize_device_fingerprint(device_fingerprint)
    if not username or not fingerprint:
        return False

    doc = db.auth_trusted_devices.find_one(
        {"username": username, "device_fingerprint": fingerprint, "is_active": True},
        {"trust_expire_at": 1},
    )
    if not doc:
        return False

    expire_dt = _parse_iso_datetime(doc.get("trust_expire_at"))
    if expire_dt and datetime.now() > expire_dt:
        db.auth_trusted_devices.update_one(
            {"username": username, "device_fingerprint": fingerprint},
            {"$set": {"is_active": False, "updated_at": datetime.now().isoformat()}},
        )
        return False
    return True


def has_active_trusted_device(username: str) -> bool:
    if not username:
        return False
    now = datetime.now().isoformat()
    doc = db.auth_trusted_devices.find_one(
        {
            "username": username,
            "is_active": True,
            "trust_expire_at": {"$gt": now},
        },
        {"_id": 1},
    )
    return bool(doc)


def touch_trusted_device(
    username: str,
    device_fingerprint: Optional[str],
    device_name: Optional[str] = None,
) -> None:
    fingerprint = normalize_device_fingerprint(device_fingerprint)
    if not username or not fingerprint:
        return
    now = datetime.now().isoformat()
    update_fields = {
        "last_seen_at": now,
        "updated_at": now,
    }
    if device_name:
        update_fields["device_name"] = device_name
    db.auth_trusted_devices.update_one(
        {"username": username, "device_fingerprint": fingerprint},
        {"$set": update_fields},
    )


def trust_device(
    username: str,
    device_fingerprint: Optional[str],
    device_name: Optional[str] = None,
    trust_days: Optional[int] = None,
) -> None:
    fingerprint = normalize_device_fingerprint(device_fingerprint)
    if not username or not fingerprint:
        return
    ensure_auth_security_indexes()
    now_dt = datetime.now()
    now = now_dt.isoformat()
    expire_dt = now_dt + timedelta(days=max(1, trust_days or TRUSTED_DEVICE_DAYS))
    db.auth_trusted_devices.update_one(
        {"username": username, "device_fingerprint": fingerprint},
        {"$set": {
            "username": username,
            "device_fingerprint": fingerprint,
            "device_name": device_name,
            "last_seen_at": now,
            "updated_at": now,
            "trust_expire_at": expire_dt.isoformat(),
            "is_active": True,
        }, "$setOnInsert": {
            "first_seen_at": now,
        }},
        upsert=True,
    )


def hash_verification_code(code: str) -> str:
    payload = f"{SECRET_KEY}:{code}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        # 统一转换为 naive 本地时间，兼容历史带时区字符串。
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _duration_seconds(start: Optional[datetime], end: Optional[datetime]) -> Optional[int]:
    if not start or not end:
        return None
    return max(0, int((end - start).total_seconds()))


def create_auth_session(
    username: str,
    expire_minutes: int,
    login_ip: Optional[str] = None,
    login_city: Optional[str] = None,
) -> str:
    """
    创建并登记会话，返回 sid。
    """
    sid = uuid.uuid4().hex
    now = datetime.now()
    expires_at = now + timedelta(minutes=expire_minutes)
    db.auth_sessions.insert_one({
        "username": username,
        "sid": sid,
        "status": "active",
        "login_at": now.isoformat(),
        "login_ip": login_ip,
        "login_city": login_city,
        "created_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
    })
    return sid


def find_active_session(username: str):
    return db.auth_sessions.find_one(
        {"username": username, "status": "active"},
        sort=[("last_seen_at", -1)]
    )


def cleanup_stale_active_sessions(username: str) -> int:
    """
    登录冲突判断前即时清理该用户已过期/超时但仍标记为 active 的会话。
    返回清理数量。
    """
    now = datetime.now()
    cleaned = 0
    cursor = db.auth_sessions.find(
        {"username": username, "status": "active"},
        {"sid": 1, "expires_at": 1, "last_seen_at": 1}
    )
    for doc in cursor:
        sid = doc.get("sid")
        if not sid:
            db.auth_sessions.update_one(
                {"_id": doc.get("_id")},
                {"$set": {
                    "status": "expired",
                    "logout_reason": "invalid_session_record",
                    "updated_at": now.isoformat(),
                }}
            )
            cleaned += 1
            continue

        expires_at = _parse_iso_datetime(doc.get("expires_at"))
        if expires_at and now > expires_at:
            close_session(sid, status="expired", reason="token_expired_login_check")
            cleaned += 1
            continue

        last_seen_at = _parse_iso_datetime(doc.get("last_seen_at"))
        if last_seen_at and IDLE_TIMEOUT_MINUTES > 0:
            idle_seconds = (now - last_seen_at).total_seconds()
            if idle_seconds > IDLE_TIMEOUT_MINUTES * 60:
                close_session(sid, status="expired", reason="idle_timeout_login_check")
                cleaned += 1

    return cleaned


def close_session(sid: str, status: str, reason: Optional[str] = None):
    session_doc = db.auth_sessions.find_one({"sid": sid})
    if not session_doc:
        return
    now = datetime.now()
    login_at = _parse_iso_datetime(session_doc.get("login_at") or session_doc.get("created_at"))
    update_fields = {
        "status": status,
        "logout_at": now.isoformat(),
        "duration_seconds": _duration_seconds(login_at, now),
        "updated_at": now.isoformat(),
    }
    if reason:
        update_fields["logout_reason"] = reason
    if status == "kicked":
        update_fields["kicked_at"] = now.isoformat()
        update_fields["kicked_reason"] = reason or "force_login"
    db.auth_sessions.update_one({"sid": sid}, {"$set": update_fields})

    username = session_doc.get("username")
    if username:
        db.users.update_one(
            {"username": username, "current_session_sid": sid},
            {"$unset": {"current_session_sid": ""}}
        )


def kick_active_sessions(username: str, reason: str = "login_conflict"):
    active_sessions = list(db.auth_sessions.find({"username": username, "status": "active"}, {"sid": 1}))
    for item in active_sessions:
        sid = item.get("sid")
        if sid:
            close_session(sid, status="kicked", reason=reason)
        else:
            db.auth_sessions.update_one(
                {"_id": item.get("_id")},
                {"$set": {
                    "status": "expired",
                    "logout_reason": "invalid_session_record",
                    "updated_at": datetime.now().isoformat(),
                }}
            )


def enforce_single_active_session(username: str, current_sid: str):
    """
    强制单会话：保留 current_sid，其余 active 会话全部关闭。
    """
    active_sessions = list(
        db.auth_sessions.find(
            {"username": username, "status": "active", "sid": {"$ne": current_sid}},
            {"sid": 1}
        )
    )
    for item in active_sessions:
        sid = item.get("sid")
        if sid:
            close_session(sid, status="kicked", reason="single_session_enforced")
        else:
            db.auth_sessions.update_one(
                {"_id": item.get("_id")},
                {"$set": {
                    "status": "expired",
                    "logout_reason": "invalid_session_record",
                    "updated_at": datetime.now().isoformat(),
                }}
            )


def _collapse_duplicate_active_sessions():
    """
    索引创建前收敛历史脏数据：同一 username 仅保留 1 条 active（优先保留最近且 sid 有效）。
    """
    active_docs = list(
        db.auth_sessions.find(
            {"status": "active"},
            {"_id": 1, "username": 1, "sid": 1, "last_seen_at": 1, "created_at": 1}
        ).sort([("username", 1), ("last_seen_at", -1), ("created_at", -1)])
    )

    by_user = {}
    for doc in active_docs:
        username = doc.get("username")
        if not username:
            sid = doc.get("sid")
            if sid:
                close_session(sid, status="expired", reason="invalid_session_record")
            else:
                db.auth_sessions.update_one(
                    {"_id": doc.get("_id")},
                    {"$set": {
                        "status": "expired",
                        "logout_reason": "invalid_session_record",
                        "updated_at": datetime.now().isoformat(),
                    }}
                )
            continue
        by_user.setdefault(username, []).append(doc)

    for username, docs in by_user.items():
        keep_doc = next((d for d in docs if d.get("sid")), None)
        if not keep_doc:
            for d in docs:
                db.auth_sessions.update_one(
                    {"_id": d.get("_id")},
                    {"$set": {
                        "status": "expired",
                        "logout_reason": "invalid_session_record",
                        "updated_at": datetime.now().isoformat(),
                    }}
                )
            continue

        for d in docs:
            if d.get("_id") == keep_doc.get("_id"):
                continue
            sid = d.get("sid")
            if sid:
                close_session(sid, status="kicked", reason="active_dedup")
            else:
                db.auth_sessions.update_one(
                    {"_id": d.get("_id")},
                    {"$set": {
                        "status": "expired",
                        "logout_reason": "invalid_session_record",
                        "updated_at": datetime.now().isoformat(),
                    }}
                )


def ensure_auth_session_indexes():
    _collapse_duplicate_active_sessions()
    db.auth_sessions.create_index([("username", 1), ("status", 1)])
    db.auth_sessions.create_index([("sid", 1)], unique=True)
    db.auth_sessions.create_index([("expires_at", 1)])
    db.auth_sessions.create_index([("login_at", -1)])
    expected_name = "uniq_active_session_per_user"
    expected_key = [("username", 1)]
    expected_partial = {"status": "active", "username": {"$type": "string"}}
    index_info = db.auth_sessions.index_information()
    existing = index_info.get(expected_name)
    if existing:
        existing_key = existing.get("key")
        existing_unique = existing.get("unique", False)
        existing_partial = existing.get("partialFilterExpression")
        if existing_key != expected_key or not existing_unique or existing_partial != expected_partial:
            db.auth_sessions.drop_index(expected_name)

    try:
        db.auth_sessions.create_index(
            expected_key,
            unique=True,
            name=expected_name,
            partialFilterExpression=expected_partial,
        )
    except OperationFailure as e:
        logger.warning(f"创建单活会话唯一索引失败（非致命）: {e}")


def _throttled_touch_session(sid: str):
    now = datetime.now()
    session_doc = db.auth_sessions.find_one({"sid": sid}, {"last_seen_at": 1})
    if session_doc:
        last_seen = session_doc.get("last_seen_at")
        if last_seen and isinstance(last_seen, str):
            try:
                last_seen = datetime.fromisoformat(last_seen)
                if last_seen.tzinfo is not None:
                    last_seen = last_seen.astimezone().replace(tzinfo=None)
            except ValueError:
                last_seen = None
        if last_seen and (now - last_seen).total_seconds() < 60:
            return
    db.auth_sessions.update_one(
        {"sid": sid, "status": "active"},
        {"$set": {"last_seen_at": now.isoformat(), "updated_at": now.isoformat()}}
    )

def _throttled_update_last_active(username: str):
    """
    节流写入 last_active_at：仅当距上次更新超过 1 分钟时才写库，避免高频写入。
    """
    now = datetime.now()
    user_doc = db.users.find_one({"username": username}, {"last_active_at": 1})
    if user_doc:
        last_active = user_doc.get("last_active_at")
        if last_active:
            if isinstance(last_active, str):
                try:
                    last_active = datetime.fromisoformat(last_active)
                    if last_active.tzinfo is not None:
                        last_active = last_active.astimezone().replace(tzinfo=None)
                except ValueError:
                    last_active = None
            if last_active and (now - last_active).total_seconds() < 60:
                return  # 距上次更新不足 1 分钟，跳过写入
        db.users.update_one(
            {"username": username},
            {"$set": {"last_active_at": now.isoformat()}}
        )

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username, sid=payload.get("sid"))
    except JWTError:
        raise credentials_exception
    
    user = get_user(db, token_data.username)
    
    if user is None:
        raise credentials_exception

    sid = token_data.sid
    if not sid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired, please login again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_session_doc = db.users.find_one({"username": username}, {"current_session_sid": 1})
    current_session_sid = (user_session_doc or {}).get("current_session_sid")
    if current_session_sid and sid != current_session_sid:
        # 旧会话被新会话替换时，立即落库关闭，避免 active 脏会话残留。
        close_session(sid, status="kicked", reason="replaced_by_new_login")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session replaced by a newer login",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session_doc = db.auth_sessions.find_one({"sid": sid, "username": username})
    if not session_doc or session_doc.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session revoked, please login again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
            if expires_at.tzinfo is not None:
                expires_at = expires_at.astimezone().replace(tzinfo=None)
        except ValueError:
            expires_at = None
    if expires_at and datetime.now() > expires_at:
        close_session(sid, status="expired", reason="token_expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired, please login again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 空闲超时校验（AUTH_ENABLED 开关控制）
    if AUTH_ENABLED and IDLE_TIMEOUT_MINUTES > 0:
        user_doc = db.users.find_one({"username": username}, {"last_active_at": 1})
        if user_doc:
            last_active = user_doc.get("last_active_at")
            if last_active:
                if isinstance(last_active, str):
                    try:
                        last_active = datetime.fromisoformat(last_active)
                        if last_active.tzinfo is not None:
                            last_active = last_active.astimezone().replace(tzinfo=None)
                    except ValueError:
                        last_active = None
                if last_active:
                    idle_seconds = (datetime.now() - last_active).total_seconds()
                    if idle_seconds > IDLE_TIMEOUT_MINUTES * 60:
                        close_session(sid, status="expired", reason="idle_timeout")
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Session expired due to inactivity",
                            headers={"WWW-Authenticate": "Bearer"},
                        )

    # 节流更新活跃时间
    try:
        _throttled_update_last_active(username)
    except Exception as e:
        logger.warning(f"更新 last_active_at 失败（非致命）: {e}")

    try:
        _throttled_touch_session(sid)
    except Exception as e:
        logger.warning(f"更新 auth_sessions.last_seen_at 失败（非致命）: {e}")

    return user


async def get_current_token_data(token: str = Depends(oauth2_scheme)) -> TokenData:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return TokenData(username=username, sid=payload.get("sid"))
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
