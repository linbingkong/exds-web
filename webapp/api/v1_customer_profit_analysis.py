# -*- coding: utf-8 -*-
"""客户收益分析 API。"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from webapp.api.dependencies.authz import require_permission
from webapp.services.customer_profit_analysis_service import CustomerProfitAnalysisService

router = APIRouter()


@router.get("/dashboard", summary="获取客户收益分析看板数据")
def get_customer_profit_dashboard(
    year: int = Query(..., description="年份"),
    month: int = Query(..., description="月份"),
    view_mode: str = Query("monthly", description="视图模式：monthly / ytd"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    sort_field: str = Query("gross_profit", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向：asc / desc"),
    page: int = Query(1, description="页码"),
    page_size: int = Query(20, description="每页数量"),
    _ctx=Depends(require_permission("module:analysis_customer_profit:view")),
):
    service = CustomerProfitAnalysisService()
    return service.get_dashboard_data(
        year=year,
        month=month,
        view_mode=view_mode,
        search=search,
        sort_field=sort_field,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )
