# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from webapp.api.dependencies.authz import CurrentUserContext
from webapp.services.customer_name_masking_service import customer_name_masking_service


def mask_response_for_user(data: Any, ctx: CurrentUserContext) -> Any:
    return customer_name_masking_service.mask_customer_fields(
        data,
        can_view_real_name=ctx.can_view_real_customer_name,
    )


def paginate_items(items: list[dict], page: int, page_size: int) -> tuple[list[dict], int]:
    total = len(items)
    if page_size <= 0:
        return items, total

    safe_page = max(page, 1)
    safe_page_size = max(page_size, 1)
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return items[start:end], total
