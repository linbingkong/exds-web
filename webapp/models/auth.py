# -*- coding: utf-8 -*-
"""
认证与授权相关的 Pydantic 数据模型
"""
from typing import List, Optional
from pydantic import BaseModel


class Permission(BaseModel):
    """权限点定义"""
    code: str                          # 唯一编码，格式：{domain}:{resource}:{action}
    name: str                          # 显示名称
    module: str                        # 所属模块（如 customer、system）
    action: str                        # 动作类型（read/create/update/delete/import/export/manage/recalc等）
    description: Optional[str] = None # 描述
    is_active: bool = True


class Role(BaseModel):
    """角色定义"""
    code: str                          # 唯一编码（如 super_admin、viewer）
    name: str                          # 显示名称
    description: Optional[str] = None
    permissions: List[str] = []       # 权限码列表（内嵌，而非绑定表）
    is_system: bool = False            # 系统内置角色，不允许删除
    is_active: bool = True


class CurrentUserContext(BaseModel):
    """当前登录用户的权限上下文，每次鉴权时由服务端组装"""
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    role_codes: List[str] = []
    permission_codes: List[str] = []
    is_super_admin: bool = False       # 是否超管，超管跳过所有权限检查


class UserInfo(BaseModel):
    """用于 /auth/me 接口返回的用户信息"""
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    roles: List[str] = []
    permissions: List[str] = []
    is_super_admin: bool = False
    idle_timeout_minutes: int = 15     # 前端用于配置空闲超时


# ---- 管理接口请求/响应模型 ----

class CreateUserRequest(BaseModel):
    username: str
    password: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    require_email_verification: bool = True
    email_mfa_enabled: bool = False
    roles: List[str] = []

class UpdateUserRolesRequest(BaseModel):
    roles: List[str]                   # 全量覆盖

class UpdateUserStatusRequest(BaseModel):
    is_active: bool


class UpdateUserEmailMfaRequest(BaseModel):
    email_mfa_enabled: bool

class ResetPasswordRequest(BaseModel):
    new_password: Optional[str] = None

class UpdateMyProfileRequest(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None

class ChangeMyPasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ChallengeTokenRequest(BaseModel):
    challenge_token: str


class SecurityChangePasswordRequest(ChallengeTokenRequest):
    new_password: str


class SecurityBindEmailRequest(ChallengeTokenRequest):
    email: str


class SecurityVerifyEmailRequest(ChallengeTokenRequest):
    code: str


class SecurityCompleteRequest(ChallengeTokenRequest):
    force: bool = False


class ForgotPasswordSendCodeRequest(BaseModel):
    username: str
    email: str


class ForgotPasswordResetRequest(BaseModel):
    username: str
    email: str
    code: str
    new_password: str

class CreateRoleRequest(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    permissions: List[str] = []

class UpdateRoleRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class UpdateRolePermissionsRequest(BaseModel):
    permissions: List[str]             # 全量覆盖
