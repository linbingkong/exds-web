# -*- coding: utf-8 -*-
"""
权限依赖注入模块
提供：
  - get_current_user_context()：组装当前用户的角色与权限集合
  - require_permission(code)：单权限校验，无权限返回 403
  - require_any_permission([...])：任一权限满足即通过
"""
import logging
from functools import lru_cache
from typing import List

from fastapi import Depends, HTTPException, status

from webapp.tools.mongo import DATABASE as db
from webapp.tools.security import get_current_active_user, AUTH_ENABLED, User
from webapp.models.auth import CurrentUserContext

logger = logging.getLogger(__name__)

SUPER_ADMIN_ROLE = "super_admin"
VIEW_REAL_CUSTOMER_NAME_PERMISSION = "data:customer_name:view_real"


def _build_user_context(user: User) -> CurrentUserContext:
    """
    从数据库聚合用户的角色和权限，构建 CurrentUserContext。
    每次请求实时查库（无缓存），保证权限变更即时生效。
    """
    role_codes: List[str] = user.roles or []
    permission_codes: List[str] = []
    is_super_admin = False

    if SUPER_ADMIN_ROLE in role_codes:
        is_super_admin = True
    else:
        # 查询所有角色的权限集合
        if role_codes:
            roles_docs = db.auth_roles.find(
                {"code": {"$in": role_codes}, "is_active": True},
                {"permissions": 1}
            )
            for role_doc in roles_docs:
                for perm in role_doc.get("permissions", []):
                    if perm not in permission_codes:
                        permission_codes.append(perm)

    can_view_real_customer_name = is_super_admin or VIEW_REAL_CUSTOMER_NAME_PERMISSION in permission_codes

    return CurrentUserContext(
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        role_codes=role_codes,
        permission_codes=permission_codes,
        is_super_admin=is_super_admin,
        can_view_real_customer_name=can_view_real_customer_name,
    )


async def get_current_user_context(
    current_user: User = Depends(get_current_active_user),
) -> CurrentUserContext:
    """FastAPI 依赖：返回当前用户的权限上下文"""
    return _build_user_context(current_user)


def require_permission(permission_code: str):
    """
    工厂函数，返回一个 FastAPI 依赖，校验当前用户是否拥有指定权限。
    若 AUTH_ENABLED=false，跳过权限校验（仅限调试）。

    用法：
        @router.post("/xxx")
        async def create_something(ctx: CurrentUserContext = Depends(require_permission("domain:resource:action"))):
            ...
    """
    async def _dependency(
        ctx: CurrentUserContext = Depends(get_current_user_context),
    ) -> CurrentUserContext:
        if not AUTH_ENABLED:
            return ctx
        if ctx.is_super_admin:
            return ctx
        if permission_code not in ctx.permission_codes:
            logger.warning(
                f"权限拒绝: 用户 {ctx.username} 缺少权限 [{permission_code}]，"
                f"当前权限: {ctx.permission_codes}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要：{permission_code}",
            )
        return ctx

    return _dependency


def require_any_permission(permission_codes: List[str]):
    """
    工厂函数，返回一个 FastAPI 依赖，校验当前用户是否拥有列表中任意一个权限。

    用法：
        @router.delete("/xxx/{id}")
        async def delete_something(ctx = Depends(require_any_permission(["domain:resource:delete", "super:all"]))):
            ...
    """
    async def _dependency(
        ctx: CurrentUserContext = Depends(get_current_user_context),
    ) -> CurrentUserContext:
        if not AUTH_ENABLED:
            return ctx
        if ctx.is_super_admin:
            return ctx
        if not any(code in ctx.permission_codes for code in permission_codes):
            logger.warning(
                f"权限拒绝: 用户 {ctx.username} 缺少权限 {permission_codes}，"
                f"当前权限: {ctx.permission_codes}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要以下权限之一：{', '.join(permission_codes)}",
            )
        return ctx

    return _dependency
