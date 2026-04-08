# -*- coding: utf-8 -*-
from typing import Optional
from fastapi import APIRouter, Depends, Query
from webapp.services.customer_load_overview_service import CustomerLoadOverviewService
from webapp.tools.security import get_current_active_user
from webapp.api.dependencies.authz import require_permission, CurrentUserContext
from webapp.api.masking import mask_response_for_user
from webapp.services.customer_name_masking_service import customer_name_masking_service

router = APIRouter()

@router.get("/dashboard", summary="获取客户负荷总览看板数据")
async def get_dashboard_data(
    year: int = Query(..., description="年份"),
    month: int = Query(..., description="月份"),
    view_mode: str = Query("monthly", description="视图模式: monthly/ytd"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    sort_field: str = Query("signed_quantity", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向: asc/desc"),
    page: int = Query(1, description="页码"),
    page_size: int = Query(20, description="每页数量"),
    current_user: dict = Depends(get_current_active_user),
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_customer_load:view")),
):
    """
    统一获取看板所有数据，包括KPI、贡献图、龙虎榜、效率榜和客户列表
    """
    service = CustomerLoadOverviewService()
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
        page_size=page_size
    )
    return mask_response_for_user(result, ctx)
