# -*- coding: utf-8 -*-
"""客户收益分析 API。"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from webapp.api.dependencies.authz import require_permission
from webapp.api.dependencies.authz import CurrentUserContext
from webapp.api.masking import mask_response_for_user
from webapp.services.customer_profit_analysis_service import CustomerProfitAnalysisService
from webapp.services.customer_name_masking_service import customer_name_masking_service

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
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_customer_profit:view")),
):
    service = CustomerProfitAnalysisService()
    use_masked_customer_search = bool(search and not ctx.can_view_real_customer_name)
    matched_customer_ids = customer_name_masking_service.search_customer_ids_by_keyword(search or "") if use_masked_customer_search else None
    result = service.get_dashboard_data(
        year=year,
        month=month,
        view_mode=view_mode,
        search=None if use_masked_customer_search else search,
        customer_ids=matched_customer_ids,
        sort_field=sort_field,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )
    return mask_response_for_user(result, ctx)
