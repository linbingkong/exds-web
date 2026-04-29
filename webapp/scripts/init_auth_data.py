# -*- coding: utf-8 -*-
"""
Initialize auth data for v1.1 permission model.

Run:
  python -m webapp.scripts.init_auth_data
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


MODULE_DEFINITIONS: List[Dict[str, Any]] = [
    {"menu_group": "交易总览", "module_name": "交易总览", "module_code": "dashboard_overview", "route_paths": ["/dashboard"], "sort_order": 10},
    {"menu_group": "客户管理", "module_name": "客户档案管理", "module_code": "customer_profiles", "route_paths": ["/customer/profiles", "/customer/profiles/create", "/customer/profiles/view/:customerId", "/customer/profiles/edit/:customerId"], "sort_order": 20},
    {"menu_group": "客户管理", "module_name": "零售合同管理", "module_code": "customer_retail_contracts", "route_paths": ["/customer/retail-contracts", "/customer/retail-contracts/create", "/customer/retail-contracts/view/:contractId", "/customer/retail-contracts/edit/:contractId"], "sort_order": 21},
    {"menu_group": "客户管理", "module_name": "零售套餐管理", "module_code": "customer_retail_packages", "route_paths": ["/customer/retail-packages", "/customer/retail-packages/create", "/customer/retail-packages/view/:packageId", "/customer/retail-packages/edit/:packageId", "/customer/retail-packages/copy/:packageId"], "sort_order": 22},
    {"menu_group": "客户分析", "module_name": "总体负荷分析", "module_code": "analysis_overall_load", "route_paths": ["/load-forecast/overall-analysis"], "sort_order": 30},
    {"menu_group": "客户分析", "module_name": "客户负荷分析", "module_code": "analysis_customer_load", "route_paths": ["/customer/load-analysis"], "sort_order": 31},
    {"menu_group": "客户分析", "module_name": "用电特征分析", "module_code": "analysis_load_characteristics", "route_paths": ["/customer/load-characteristics", "/customer/load-characteristics/:customerId"], "sort_order": 32},
    {"menu_group": "客户分析", "module_name": "客户收益分析", "module_code": "analysis_customer_profit", "route_paths": ["/settlement/profit-analysis"], "sort_order": 33},
    {"menu_group": "客户分析", "module_name": "意向客户诊断", "module_code": "analysis_intent_customer_diagnosis", "route_paths": ["/customer/external-diagnosis"], "sort_order": 34},
    {"menu_group": "价格分析", "module_name": "现货日内分析", "module_code": "price_spot_intraday", "route_paths": ["/price-analysis/spot-market"], "sort_order": 40},
    {"menu_group": "价格分析", "module_name": "现货趋势分析", "module_code": "price_spot_trend", "route_paths": ["/price-analysis/spot-trend"], "sort_order": 41},
    {"menu_group": "价格分析", "module_name": "中长期日内分析", "module_code": "price_midlong_intraday", "route_paths": ["/price-analysis/mid-long-term"], "sort_order": 42},
    {"menu_group": "价格分析", "module_name": "中长期趋势分析", "module_code": "price_midlong_trend", "route_paths": ["/price-analysis/mid-long-trend"], "sort_order": 43},
    {"menu_group": "市场预测", "module_name": "天气预测数据", "module_code": "forecast_weather_data", "route_paths": ["/basic-data/weather-data"], "sort_order": 50},
    {"menu_group": "市场预测", "module_name": "日前价格预测", "module_code": "forecast_dayahead_price", "route_paths": ["/price-forecast/day-ahead"], "sort_order": 52},
    {"menu_group": "市场预测", "module_name": "D-2价格预测", "module_code": "forecast_d2_price", "route_paths": ["/price-forecast/d-2"], "sort_order": 53},
    {"menu_group": "市场预测", "module_name": "短期负荷预测", "module_code": "forecast_short_term_load", "route_paths": ["/load-forecast/short-term"], "sort_order": 54},
    {"menu_group": "市场预测", "module_name": "中期负荷预测", "module_code": "forecast_mid_term_load", "route_paths": ["/load-forecast/long-term"], "sort_order": 55},
    {"menu_group": "交易策略", "module_name": "月度交易策略", "module_code": "strategy_monthly", "route_paths": ["/trading-strategy/monthly"], "sort_order": 60},
    {"menu_group": "交易策略", "module_name": "月内滚动行情", "module_code": "rolling_match_quotes", "route_paths": ["/strategy/rolling-match-quotes"], "sort_order": 60},
    {"menu_group": "交易策略", "module_name": "月内交易策略", "module_code": "strategy_intra_month", "route_paths": ["/trading-strategy/contract-curve"], "sort_order": 61},
    {"menu_group": "交易策略", "module_name": "日前交易策略", "module_code": "strategy_dayahead", "route_paths": ["/trading-strategy/day-ahead"], "sort_order": 62},
    {"menu_group": "交易复盘", "module_name": "月度交易复盘", "module_code": "review_monthly", "route_paths": ["/trade-review/monthly-review"], "sort_order": 70},
    {"menu_group": "交易复盘", "module_name": "月内交易复盘", "module_code": "review_intra_month", "route_paths": ["/trade-review/monthly-trading-review"], "sort_order": 71},
    {"menu_group": "交易复盘", "module_name": "日前交易复盘", "module_code": "review_dayahead", "route_paths": ["/trade-review/spot-review"], "sort_order": 72},
    {"menu_group": "结算管理", "module_name": "日清结算总览", "module_code": "settlement_daily_overview", "route_paths": ["/settlement/pre-settlement-overview"], "sort_order": 80},
    {"menu_group": "结算管理", "module_name": "日清结算详情", "module_code": "settlement_daily_detail", "route_paths": ["/settlement/pre-settlement-detail"], "sort_order": 81},
    {"menu_group": "结算管理", "module_name": "月度结算总览", "module_code": "settlement_monthly_overview", "route_paths": ["/settlement/monthly-overview"], "sort_order": 82},
    {"menu_group": "结算管理", "module_name": "月度结算详情", "module_code": "settlement_monthly_detail", "route_paths": ["/settlement/monthly-analysis"], "sort_order": 83},
    {"menu_group": "基础数据", "module_name": "国网代理购电", "module_code": "basic_sgcc_price", "route_paths": ["/basic-data/grid-price"], "sort_order": 90},
    {"menu_group": "基础数据", "module_name": "时段电价分布", "module_code": "basic_tou_definition", "route_paths": ["/basic-data/tou-definition"], "sort_order": 91},
    {"menu_group": "基础数据", "module_name": "价格基础数据", "module_code": "forecast_price_baseline", "route_paths": ["/price-forecast/baseline-data"], "sort_order": 92},
    {"menu_group": "基础数据", "module_name": "负荷数据诊断", "module_code": "basic_load_validation", "route_paths": ["/basic-data/load-validation"], "sort_order": 93},
    {"menu_group": "基础数据", "module_name": "基础数据导入", "module_code": "basic_monthly_manual_import", "route_paths": ["/basic-data/monthly-manual-data"], "sort_order": 94},
    {"menu_group": "系统管理", "module_name": "用户与权限", "module_code": "system_user_auth", "route_paths": ["/system-settings/user-permissions"], "sort_order": 100},
    {"menu_group": "系统管理", "module_name": "数据下载监控", "module_code": "system_data_access", "route_paths": ["/system-settings/data-access"], "sort_order": 101},
    {"menu_group": "系统管理", "module_name": "告警与日志", "module_code": "system_logs", "route_paths": ["/system-settings/system-logs"], "sort_order": 102},
]


EXCEPTION_PERMISSIONS: List[Dict[str, str]] = [
    {"code": "customer:profile:delete", "name": "客户删除", "description": "删除客户档案数据"},
    {"code": "customer:contract:delete", "name": "合同删除", "description": "删除零售合同数据"},
    {"code": "customer:package:delete", "name": "套餐删除", "description": "删除零售套餐数据"},
    {"code": "data:customer_name:view_real", "name": "查看真实客户名称", "description": "允许查看真实客户名称，不启用演示脱敏"},
    {"code": "load:data:reaggregate", "name": "负荷数据重新聚合", "description": "执行负荷数据重新聚合任务"},
    {"code": "settlement:recalc:execute", "name": "结算重算执行", "description": "执行大规模结算重算"},
    {"code": "system:auth:manage", "name": "用户与权限管理", "description": "管理用户、角色、权限"},
]


# Keep legacy action permissions that are currently referenced by backend APIs.
LEGACY_ACTION_PERMISSIONS: List[Dict[str, str]] = [
    {"code": "customer:profile:create", "name": "新增客户", "module": "customer", "action": "create"},
    {"code": "customer:profile:update", "name": "编辑客户", "module": "customer", "action": "update"},
    {"code": "customer:profile:delete", "name": "删除客户", "module": "customer", "action": "delete"},
    {"code": "customer:contract:create", "name": "新增合同", "module": "customer", "action": "create"},
    {"code": "customer:contract:update", "name": "编辑合同", "module": "customer", "action": "update"},
    {"code": "customer:contract:delete", "name": "删除合同", "module": "customer", "action": "delete"},
    {"code": "customer:contract:export", "name": "导出合同", "module": "customer", "action": "export"},
    {"code": "customer:package:create", "name": "新增套餐", "module": "customer", "action": "create"},
    {"code": "customer:package:update", "name": "编辑套餐", "module": "customer", "action": "update"},
    {"code": "customer:package:delete", "name": "删除套餐", "module": "customer", "action": "delete"},
    {"code": "forecast:adjust:update", "name": "预测人工调整", "module": "forecast", "action": "update"},
]


LEGACY_BY_MODULE_EDIT: Dict[str, List[str]] = {
    "customer_profiles": ["customer:profile:create", "customer:profile:update", "customer:profile:delete"],
    "customer_retail_contracts": ["customer:contract:create", "customer:contract:update", "customer:contract:delete", "customer:contract:export"],
    "customer_retail_packages": ["customer:package:create", "customer:package:update", "customer:package:delete"],
    "forecast_short_term_load": ["forecast:adjust:update"],
    "system_user_auth": ["system:auth:manage"],
}


ANALYST_EDIT_MODULES = {
    "analysis_overall_load",
    "analysis_customer_load",
    "analysis_load_characteristics",
    "analysis_customer_profit",
    "analysis_intent_customer_diagnosis",
    "forecast_weather_data",
    "forecast_price_baseline",
    "forecast_dayahead_price",
    "forecast_d2_price",
    "forecast_short_term_load",
    "forecast_mid_term_load",
    "review_monthly",
    "review_intra_month",
    "review_dayahead",
}


BUSINESS_ADMIN_EXCLUDE_MODULES = {
    "system_user_auth",
    "system_data_access",
}


def _module_permission_code(module_code: str, level: str) -> str:
    return f"module:{module_code}:{level}"


def _build_module_permissions(now: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for mod in MODULE_DEFINITIONS:
        module_code = mod["module_code"]
        module_name = mod["module_name"]
        for level, label in (("view", "可查看"), ("edit", "可修改")):
            records.append(
                {
                    "code": _module_permission_code(module_code, level),
                    "name": f"{module_name}-{label}",
                    "module": module_code,
                    "module_code": module_code,
                    "action": level,
                    "permission_type": f"module_{level}",
                    "is_exception": False,
                    "is_system": True,
                    "is_active": True,
                    "description": f"模块权限：{module_name} {label}",
                    "created_at": now,
                    "updated_at": now,
                    "seed_version": "1.1",
                }
            )
    return records


def _build_exception_permissions(now: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for item in EXCEPTION_PERMISSIONS:
        records.append(
            {
                "code": item["code"],
                "name": item["name"],
                "module": "exception",
                "module_code": None,
                "action": "manage",
                "permission_type": "exception",
                "is_exception": True,
                "is_system": True,
                "is_active": True,
                "description": item["description"],
                "created_at": now,
                "updated_at": now,
                "seed_version": "1.1",
            }
        )
    return records


def _build_legacy_permissions(now: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for p in LEGACY_ACTION_PERMISSIONS:
        records.append(
            {
                "code": p["code"],
                "name": p["name"],
                "module": p["module"],
                "module_code": None,
                "action": p["action"],
                "permission_type": "legacy_action",
                "is_exception": False,
                "is_system": True,
                "is_active": True,
                "description": "Legacy action permission kept for backend compatibility",
                "created_at": now,
                "updated_at": now,
                "seed_version": "1.1",
            }
        )
    return records


def _build_roles(now: str) -> List[Dict[str, Any]]:
    all_modules = [m["module_code"] for m in MODULE_DEFINITIONS]

    def module_perms(module_codes: List[str], levels: List[str]) -> List[str]:
        out: List[str] = []
        for mc in module_codes:
            for lv in levels:
                out.append(_module_permission_code(mc, lv))
        return out

    viewer_permissions = module_perms(all_modules, ["view"])
    viewer_permissions.append("data:customer_name:view_real")

    analyst_permissions = module_perms(all_modules, ["view"])
    analyst_permissions.extend(module_perms([m for m in all_modules if m in ANALYST_EDIT_MODULES], ["edit"]))
    analyst_permissions.append("data:customer_name:view_real")
    for mc in ANALYST_EDIT_MODULES:
        analyst_permissions.extend(LEGACY_BY_MODULE_EDIT.get(mc, []))

    business_modules = [m for m in all_modules if m not in BUSINESS_ADMIN_EXCLUDE_MODULES]
    business_permissions = module_perms(business_modules, ["view", "edit"])
    for mc in business_modules:
        business_permissions.extend(LEGACY_BY_MODULE_EDIT.get(mc, []))
    business_permissions.append("customer:profile:delete")
    business_permissions.append("customer:contract:delete")
    business_permissions.append("customer:package:delete")
    business_permissions.append("data:customer_name:view_real")
    business_permissions.append("load:data:reaggregate")
    business_permissions.append("settlement:recalc:execute")

    system_admin_permissions = module_perms(all_modules, ["view", "edit"])
    for mc in all_modules:
        system_admin_permissions.extend(LEGACY_BY_MODULE_EDIT.get(mc, []))
    system_admin_permissions.extend([item["code"] for item in EXCEPTION_PERMISSIONS])

    super_admin_permissions = sorted(
        set(
            module_perms(all_modules, ["view", "edit"])
            + [item["code"] for item in EXCEPTION_PERMISSIONS]
            + [item["code"] for item in LEGACY_ACTION_PERMISSIONS]
        )
    )

    def uniq(items: List[str]) -> List[str]:
        return sorted(set(items))

    return [
        {
            "code": "super_admin",
            "name": "超级管理员",
            "description": "全权限角色",
            "permissions": uniq(super_admin_permissions),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
        {
            "code": "system_admin",
            "name": "系统管理员",
            "description": "系统管理、权限管理和高风险操作权限",
            "permissions": uniq(system_admin_permissions),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
        {
            "code": "business_admin",
            "name": "业务管理员",
            "description": "业务模块全权限（不含系统权限管理）",
            "permissions": uniq(business_permissions),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
        {
            "code": "analyst",
            "name": "分析师",
            "description": "分析/预测模块可修改，其他模块只读",
            "permissions": uniq(analyst_permissions),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
        {
            "code": "viewer",
            "name": "只读用户",
            "description": "全模块只读",
            "permissions": uniq(viewer_permissions),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
        {
            "code": "demo_viewer",
            "name": "演示用户",
            "description": "可查看全部页面，默认按演示规则隐藏真实客户名称",
            "permissions": uniq(module_perms(all_modules, ["view"])),
            "is_system": True,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        },
    ]


def run() -> None:
    from webapp.tools.mongo import DATABASE as db

    now = datetime.now().isoformat()

    logger.info("[1/5] 初始化 auth_modules...")
    for mod in MODULE_DEFINITIONS:
        doc = {
            **mod,
            "is_active": True,
            "is_system": True,
            "created_at": now,
            "updated_at": now,
            "seed_version": "1.1",
        }
        module_set_doc = {k: v for k, v in doc.items() if k != "created_at"}
        db.auth_modules.update_one({"module_code": mod["module_code"]}, {"$set": module_set_doc, "$setOnInsert": {"created_at": now}}, upsert=True)
    logger.info("  auth_modules: %s", len(MODULE_DEFINITIONS))

    logger.info("[2/5] 初始化 auth_permissions（模块两档+例外+兼容动作级）...")
    permission_docs = _build_module_permissions(now) + _build_exception_permissions(now) + _build_legacy_permissions(now)
    for p in permission_docs:
        permission_set_doc = {k: v for k, v in p.items() if k != "created_at"}
        db.auth_permissions.update_one({"code": p["code"]}, {"$set": permission_set_doc, "$setOnInsert": {"created_at": now}}, upsert=True)
    # 清理旧版三档模型遗留的 open 权限点
    db.auth_permissions.delete_many({"code": {"$regex": r"^module:.*:open$"}})
    logger.info("  auth_permissions: %s", len(permission_docs))

    logger.info("[3/5] 初始化 auth_roles...")
    roles = _build_roles(now)
    for role in roles:
        role_set_doc = {k: v for k, v in role.items() if k != "created_at"}
        db.auth_roles.update_one({"code": role["code"]}, {"$set": role_set_doc, "$setOnInsert": {"created_at": now}}, upsert=True)
    # 清理所有角色中的 open 权限残留
    db.auth_roles.update_many({}, {"$pull": {"permissions": {"$regex": r"^module:.*:open$"}}})
    logger.info("  auth_roles: %s", len(roles))

    logger.info("[4/5] 迁移 users 角色（admin -> super_admin，空角色 -> viewer）...")
    users = list(db.users.find({}))
    for user in users:
        username = user.get("username")
        update_fields: Dict[str, Any] = {}

        if not user.get("display_name"):
            update_fields["display_name"] = user.get("full_name") or username
        if "must_change_password" not in user:
            update_fields["must_change_password"] = False
        if "password_changed_at" not in user:
            update_fields["password_changed_at"] = now
        if "email_verified" not in user:
            update_fields["email_verified"] = bool(user.get("email"))
        if "security_actions_completed_at" not in user:
            update_fields["security_actions_completed_at"] = None

        roles_current = user.get("roles") or []
        if username == "admin":
            if roles_current != ["super_admin"]:
                update_fields["roles"] = ["super_admin"]
        elif not roles_current:
            update_fields["roles"] = ["viewer"]

        if update_fields:
            update_fields["updated_at"] = now
            db.users.update_one({"_id": user["_id"]}, {"$set": update_fields})

    logger.info("  users processed: %s", len(users))

    logger.info("[5/5] 创建索引...")
    db.auth_modules.create_index("module_code", unique=True)
    db.auth_modules.create_index([("menu_group", 1), ("sort_order", 1)])

    db.auth_permissions.create_index("code", unique=True)
    db.auth_permissions.create_index([("module_code", 1), ("permission_type", 1)])
    db.auth_permissions.create_index([("is_exception", 1), ("is_active", 1)])

    db.auth_roles.create_index("code", unique=True)
    db.auth_roles.create_index("is_active")

    db.users.create_index("username", unique=True)
    db.users.create_index("email")
    db.users.create_index("roles")
    db.users.create_index("last_active_at")
    db.auth_security_challenges.create_index("cid", unique=True)
    db.auth_security_challenges.create_index([("username", 1), ("status", 1), ("created_at", -1)])
    db.auth_email_challenges.create_index("challenge_id", unique=True)
    db.auth_email_challenges.create_index([("username", 1), ("email", 1), ("used_at", 1), ("expire_at", -1)])

    logger.info("初始化完成。")


if __name__ == "__main__":
    run()
