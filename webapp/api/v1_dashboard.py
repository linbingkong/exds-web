# -*- coding: utf-8 -*-
"""交易总览聚合接口。"""

from fastapi import APIRouter, Depends, Query

from webapp.api.dependencies.authz import require_permission
from webapp.api.dependencies.authz import CurrentUserContext
from webapp.api.masking import mask_response_for_user
from webapp.services.dashboard_service import DashboardService
from webapp.services.dashboard_snapshot_service import DashboardSnapshotService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
service = DashboardService()
snapshot_service = DashboardSnapshotService()


@router.get("/summary", summary="获取交易总览首页快照")
def get_dashboard_summary(
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(snapshot_service.get_summary(), ctx)


@router.get("/settlement-kpi", summary="获取交易总览结算 KPI")
def get_settlement_kpi(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_settlement_kpi(month), ctx)


@router.get("/settlement-chart", summary="获取交易总览结算走势图")
def get_settlement_chart(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    view_mode: str = Query("monthly", description="视图模式：monthly 或 yearly"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_settlement_chart(month, view_mode), ctx)


@router.get("/trade-summary", summary="获取交易总览交易复盘摘要")
def get_trade_summary(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_trade_summary(month), ctx)


@router.get("/customer-overview", summary="获取交易总览客户概览")
def get_customer_overview(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_customer_overview(year, month), ctx)


@router.get("/customer-profit-contribution", summary="获取交易总览客户收益构成")
def get_customer_profit_contribution(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_customer_profit_contribution(year, month), ctx)


@router.get("/customer-load-ranking", summary="获取交易总览客户负荷 TOP5")
def get_customer_load_ranking(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_customer_load_ranking(year, month), ctx)


@router.get("/alerts", summary="获取交易总览告警摘要")
def get_alerts(
    limit: int = Query(8, ge=1, le=20, description="返回数量"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    result = mask_response_for_user(service.get_alerts(limit), ctx)
    if not ctx.can_view_real_customer_name:
        for item in result.get("items", []):
            if item.get("source") == "customer_anomaly_alerts":
                title_suffix = "异动告警"
                raw_title = str(item.get("title") or "")
                if " " in raw_title:
                    title_suffix = raw_title.split(" ", 1)[1]
                customer_name = str(item.get("customer_name") or item.get("short_name") or "演示客户")
                item["title"] = f"{customer_name} {title_suffix}"
    return result


@router.get("/market-intraday", summary="获取交易总览市场价格日内视图")
def get_market_intraday(
    date: str | None = Query(None, description="日期 YYYY-MM-DD，不传则默认最新有数据日期"),
    ctx: CurrentUserContext = Depends(require_permission("module:dashboard_overview:view")),
):
    return mask_response_for_user(service.get_market_intraday(date), ctx)
