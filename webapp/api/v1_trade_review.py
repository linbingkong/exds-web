import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from webapp.api.dependencies.authz import CurrentUserContext, require_permission
from webapp.models.trade_review import (
    ContractEarningCalculationResponse,
    DayAheadReviewResponse,
    MonthlyReviewDetailResponse,
    MonthlyReviewOverviewResponse,
    MonthlyContractDetailResponse,
    OperationDetailResponse,
    TradeDateListResponse,
    TradeDetailResponse,
    TradeOverviewResponse,
)
from webapp.services.monthly_trade_review_service import MonthlyTradeReviewService
from webapp.services.trade_review_service import TradeReviewService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trade-review", tags=["trade-review"])


def get_service() -> TradeReviewService:
    return TradeReviewService(DATABASE)


def get_monthly_service() -> MonthlyTradeReviewService:
    return MonthlyTradeReviewService(DATABASE)


def _validate_date(date_str: str) -> None:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="日期格式无效，请使用 YYYY-MM-DD 格式",
        ) from exc


def _validate_month(month_str: str) -> None:
    try:
        datetime.strptime(month_str, "%Y-%m")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="月份格式无效，请使用 YYYY-MM 格式",
        ) from exc


@router.get("/trade-dates", response_model=TradeDateListResponse, summary="获取交易日期列表")
def get_trade_dates() -> TradeDateListResponse:
    try:
        return get_service().get_trade_dates()
    except Exception as exc:
        logger.error("get_trade_dates error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/overview", response_model=TradeOverviewResponse, summary="获取交易日概览")
def get_trade_overview(
    trade_date: str = Query(..., description="交易日期 YYYY-MM-DD"),
) -> TradeOverviewResponse:
    _validate_date(trade_date)
    try:
        return get_service().get_trade_overview(trade_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_trade_overview error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/detail", response_model=TradeDetailResponse, summary="获取目标日复盘详情")
def get_trade_detail(
    trade_date: str = Query(..., description="交易日期 YYYY-MM-DD"),
    delivery_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
) -> TradeDetailResponse:
    _validate_date(trade_date)
    _validate_date(delivery_date)
    try:
        return get_service().get_trade_detail(trade_date, delivery_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_trade_detail error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/operation-detail", response_model=OperationDetailResponse, summary="获取单个申报过程详情")
def get_operation_detail(
    trade_date: str = Query(..., description="交易日期 YYYY-MM-DD"),
    delivery_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    operation_id: str = Query(..., description="申报过程ID"),
) -> OperationDetailResponse:
    _validate_date(trade_date)
    _validate_date(delivery_date)
    try:
        return get_service().get_operation_detail(trade_date, delivery_date, operation_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_operation_detail error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/monthly-contract-details", response_model=MonthlyContractDetailResponse, summary="获取月内交易合同明细")
def get_monthly_contract_details(
    trade_date: str = Query(..., description="交易日期 YYYY-MM-DD"),
    delivery_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    period: int = Query(..., ge=1, le=48, description="时段号"),
) -> MonthlyContractDetailResponse:
    _validate_date(trade_date)
    _validate_date(delivery_date)
    try:
        return get_service().get_monthly_contract_details(trade_date, delivery_date, period)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_monthly_contract_details error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/contract-earnings", response_model=ContractEarningCalculationResponse, summary="计算合同成交收益")
def get_contract_earnings(
    trade_date: str = Query(..., description="交易日期 YYYY-MM-DD"),
    delivery_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
) -> ContractEarningCalculationResponse:
    _validate_date(trade_date)
    _validate_date(delivery_date)
    try:
        return get_service().calculate_contract_earnings(trade_date, delivery_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_contract_earnings error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/day-ahead-review", response_model=DayAheadReviewResponse, summary="获取日前交易复盘数据")
def get_day_ahead_review(
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
) -> DayAheadReviewResponse:
    _validate_date(target_date)
    try:
        return get_service().get_day_ahead_review(target_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_day_ahead_review error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/monthly-overview", response_model=MonthlyReviewOverviewResponse, summary="获取月度交易复盘概览")
def get_monthly_overview(
    month: str = Query(..., description="统计月份 YYYY-MM"),
    auto_build: bool = Query(False, description="是否在查询时自动计算最新结果"),
) -> MonthlyReviewOverviewResponse:
    _validate_month(month)
    try:
        return get_monthly_service().get_monthly_overview(month, auto_build=auto_build)
    except Exception as exc:
        logger.error("get_monthly_overview error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/monthly-detail", response_model=MonthlyReviewDetailResponse, summary="获取月度交易复盘详情")
def get_monthly_detail(
    month: str = Query(..., description="统计月份 YYYY-MM"),
) -> MonthlyReviewDetailResponse:
    _validate_month(month)
    try:
        return get_monthly_service().get_monthly_detail(month)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("get_monthly_detail error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.post("/monthly-recalculate", response_model=MonthlyReviewDetailResponse, summary="立即计算月度交易复盘")
def recalculate_monthly_detail(
    month: str = Query(..., description="统计月份 YYYY-MM"),
    _ctx: CurrentUserContext = Depends(require_permission("module:review_monthly:edit")),
) -> MonthlyReviewDetailResponse:
    _validate_month(month)
    try:
        return get_monthly_service().recalculate_monthly_detail(month)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("recalculate_monthly_detail error: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
