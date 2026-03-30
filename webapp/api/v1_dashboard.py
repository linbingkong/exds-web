# -*- coding: utf-8 -*-
"""交易总览聚合接口。"""

from fastapi import APIRouter, Depends, Query

from webapp.api.dependencies.authz import require_permission
from webapp.services.dashboard_service import DashboardService
from webapp.services.dashboard_snapshot_service import DashboardSnapshotService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
service = DashboardService()
snapshot_service = DashboardSnapshotService()


@router.get("/summary", summary="获取交易总览首页快照")
def get_dashboard_summary(
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return snapshot_service.get_summary()


@router.get("/settlement-kpi", summary="获取交易总览结算 KPI")
def get_settlement_kpi(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_settlement_kpi(month)


@router.get("/settlement-chart", summary="获取交易总览结算走势图")
def get_settlement_chart(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    view_mode: str = Query("monthly", description="视图模式：monthly 或 yearly"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_settlement_chart(month, view_mode)


@router.get("/trade-summary", summary="获取交易总览交易复盘摘要")
def get_trade_summary(
    month: str | None = Query(None, description="月份 YYYY-MM，不传则默认当前月"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_trade_summary(month)


@router.get("/customer-overview", summary="获取交易总览客户概览")
def get_customer_overview(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_customer_overview(year, month)


@router.get("/customer-profit-contribution", summary="获取交易总览客户收益构成")
def get_customer_profit_contribution(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_customer_profit_contribution(year, month)


@router.get("/customer-load-ranking", summary="获取交易总览客户负荷 TOP5")
def get_customer_load_ranking(
    year: int | None = Query(None, description="年份，不传则默认当前年"),
    month: int | None = Query(None, description="月份，不传则默认当前月"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_customer_load_ranking(year, month)


@router.get("/alerts", summary="获取交易总览告警摘要")
def get_alerts(
    limit: int = Query(8, ge=1, le=20, description="返回数量"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_alerts(limit)


@router.get("/market-intraday", summary="获取交易总览市场价格日内视图")
def get_market_intraday(
    date: str | None = Query(None, description="日期 YYYY-MM-DD，不传则默认最新有数据日期"),
    _ctx=Depends(require_permission("module:dashboard_overview:view")),
):
    return service.get_market_intraday(date)
