"""
储能申报策略 API 路由

路由前缀：/api/v1/storage-declaration

权限：
- 读：module:storage_declaration_strategy:view
- 写：module:storage_declaration_strategy:edit
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from webapp.api.dependencies.authz import (
    CurrentUserContext,
    require_any_permission,
    require_permission,
)
from webapp.services.storage_declaration_service import (
    DECLARE_STATUS_DECLARED,
    DECLARE_STATUS_PENDING,
    StorageDeclarationService,
    validate_declaration,
)
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/storage-declaration", tags=["StorageDeclaration"])

STATION_VIEW_PERMISSION = "module:energy_station_operation_info:view"
STATION_EDIT_PERMISSION = "module:energy_station_operation_info:edit"
VIEW_PERMISSION = "module:storage_declaration_strategy:view"
EDIT_PERMISSION = "module:storage_declaration_strategy:edit"


def _service() -> StorageDeclarationService:
    return StorageDeclarationService(DATABASE)


# ============ Pydantic 模型 ============


class StationPayload(BaseModel):
    station_name: str = ""
    control_unit_name: str = ""
    node_name: str = ""
    voltage_level: str = ""
    rated_power_mw: float = 0
    rated_capacity_mwh: float = 0
    is_hybrid: bool = False
    fm_power_mw: float = 0
    fm_capacity_mwh: float = 0
    charge_efficiency: float = 0.93
    discharge_efficiency: float = 0.93
    efficiency: Optional[float] = None
    discharge_depth: float = 0.9
    fm_k_value: float = 1.0
    default_mileage_beta: float = 1.0
    default_soc: float = 0.1
    degradation_cost_per_mwh: float = 0.0
    status: str = "启用"


class StationStatusPayload(BaseModel):
    status: str


class StrategyParam(BaseModel):
    param_key: str = ""
    param_name: str = ""
    param_value: str = ""
    unit: str = ""
    description: str = ""


class StrategyPayload(BaseModel):
    station_id: str = ""
    strategy_name: str = ""
    strategy_type: str = "simple_peak_valley"
    strategy_status: str = "启用"
    fm_price_threshold: float = 300
    description: str = ""
    strategy_params: List[StrategyParam] = Field(default_factory=list)


class StrategyStatusPayload(BaseModel):
    status: str


class GeneratePayload(BaseModel):
    station_id: str
    strategy_id: str
    target_date: str
    soc_initial_override: Optional[float] = None
    threshold_override: Optional[float] = None


class EnergySlot(BaseModel):
    time_point: str
    power_mw: float


class FmSlot(BaseModel):
    period_start: str
    period_end: str
    output_base_mw: float = 0.0
    mileage_price: float


class SaveDeclarationPayload(BaseModel):
    station_id: str
    strategy_id: str
    target_date: str
    declare_status: str = "未申报"
    energy_declaration: List[EnergySlot]
    fm_declaration: List[FmSlot]
    soc_trajectory: List[float] = Field(default_factory=list)
    spot_price_forecast: List[float] = Field(default_factory=list)
    params_snapshot: Dict[str, Any] = Field(default_factory=dict)
    result_meta: Dict[str, Any] = Field(default_factory=dict)


class CalculateRevenuePayload(BaseModel):
    station_id: str
    target_date: str
    energy_declaration: List[EnergySlot]
    fm_declaration: List[FmSlot]
    prices_96: Optional[List[float]] = None
    beta: Optional[float] = None
    kp: Optional[float] = None
    clearing_price: Optional[float] = None
    degradation_cost_per_mwh: Optional[float] = None


class ReviewSimulatePayload(BaseModel):
    station_id: str
    strategy_id: str
    target_date: str


# ============ 电站 ============


@router.get(
    "/stations",
    summary="电站列表",
    response_model=List[Dict[str, Any]],
)
def list_stations(
    _ctx: CurrentUserContext = Depends(require_any_permission([STATION_VIEW_PERMISSION, VIEW_PERMISSION])),
) -> List[Dict[str, Any]]:
    return _service().list_stations()


@router.get(
    "/stations/{station_id}",
    summary="电站详情",
    response_model=Dict[str, Any],
)
def get_station(
    station_id: str,
    _ctx: CurrentUserContext = Depends(require_any_permission([STATION_VIEW_PERMISSION, VIEW_PERMISSION])),
) -> Dict[str, Any]:
    try:
        return _service().get_station(station_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/stations",
    summary="新增电站",
    status_code=status.HTTP_201_CREATED,
    response_model=Dict[str, Any],
)
def create_station(
    payload: StationPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().create_station(payload.model_dump(), operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("新增电站失败")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"创建失败: {e}")


@router.put(
    "/stations/{station_id}",
    summary="修改电站",
    response_model=Dict[str, Any],
)
def update_station(
    station_id: str,
    payload: StationPayload,
    ctx: CurrentUserContext = Depends(require_permission(STATION_EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().update_station(station_id, payload.model_dump(), operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/stations/{station_id}/status",
    summary="启停电站",
    response_model=Dict[str, Any],
)
def set_station_status(
    station_id: str,
    payload: StationStatusPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().set_station_status(station_id, payload.status, operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete(
    "/stations/{station_id}",
    summary="删除电站（级联删除策略与申报）",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_station(
    station_id: str,
    _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> None:
    try:
        _service().delete_station(station_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ============ 策略 ============


@router.get(
    "/strategies",
    summary="策略列表",
    response_model=List[Dict[str, Any]],
)
def list_strategies(
    station_id: Optional[str] = Query(None, description="按电站过滤"),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> List[Dict[str, Any]]:
    return _service().list_strategies(station_id)


@router.get(
    "/strategies/{strategy_id}",
    summary="策略详情",
    response_model=Dict[str, Any],
)
def get_strategy(
    strategy_id: str,
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().get_strategy(strategy_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/strategies",
    summary="新增策略",
    status_code=status.HTTP_201_CREATED,
    response_model=Dict[str, Any],
)
def create_strategy(
    payload: StrategyPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().create_strategy(payload.model_dump(), operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put(
    "/strategies/{strategy_id}",
    summary="修改策略",
    response_model=Dict[str, Any],
)
def update_strategy(
    strategy_id: str,
    payload: StrategyPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().update_strategy(strategy_id, payload.model_dump(), operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/strategies/{strategy_id}/status",
    summary="启停策略",
    response_model=Dict[str, Any],
)
def set_strategy_status(
    strategy_id: str,
    payload: StrategyStatusPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().set_strategy_status(strategy_id, payload.status, operator=ctx.username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete(
    "/strategies/{strategy_id}",
    summary="删除策略",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_strategy(
    strategy_id: str,
    _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> None:
    try:
        _service().delete_strategy(strategy_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ============ 当日申报 ============


@router.get(
    "/spot-forecast",
    summary="读取目标日期 96 点 LMP 预测",
    response_model=Dict[str, Any],
)
def get_spot_forecast(
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    station_id: Optional[str] = Query(None, description="电站ID，用于读取节点日前预出清价格"),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    service = _service()
    node_name = ""
    if station_id:
        station = service.get_station(station_id)
        node_name = station.get("node_name") or ""
    prices = service.get_price_forecast_96(target_date, node_name)
    return {"target_date": target_date, "prices": prices}


@router.get(
    "/spot-forecast/available-dates",
    summary="读取模拟申报可用预测日期",
    response_model=List[str],
)
def list_spot_forecast_dates(
    station_id: Optional[str] = Query(None, description="电站ID，用于匹配节点日前预出清日期"),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> List[str]:
    return _service().list_forecast_available_dates(station_id)


@router.post(
    "/generate",
    summary="一键生成申报（96 点充放电 + 24 点调频）",
    response_model=Dict[str, Any],
)
def generate_declaration(
    payload: GeneratePayload,
    _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        result = _service().generate_declaration(
            station_id=payload.station_id,
            strategy_id=payload.strategy_id,
            target_date=payload.target_date,
            soc_initial_override=payload.soc_initial_override,
            threshold_override=payload.threshold_override,
        )
        # 风控复验
        station = _service().get_station(payload.station_id)
        violations = validate_declaration(
            station=station,
            energy_declaration=result["energy_declaration"],
            fm_declaration=result["fm_declaration"],
            soc_trajectory=result["soc_trajectory"],
        )
        result["violations"] = violations
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/save",
    summary="保存或提交申报",
    response_model=Dict[str, Any],
)
def save_declaration(
    payload: SaveDeclarationPayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    if payload.declare_status not in (DECLARE_STATUS_DECLARED, DECLARE_STATUS_PENDING):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"非法状态: {payload.declare_status}")
    service = _service()
    try:
        station = service.get_station(payload.station_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    violations = validate_declaration(
        station=station,
        energy_declaration=[s.model_dump() for s in payload.energy_declaration],
        fm_declaration=[s.model_dump() for s in payload.fm_declaration],
        soc_trajectory=payload.soc_trajectory,
    )
    if violations:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"violations": violations})

    return service.save_declaration(
        station_id=payload.station_id,
        strategy_id=payload.strategy_id,
        target_date=payload.target_date,
        energy_declaration=[s.model_dump() for s in payload.energy_declaration],
        fm_declaration=[s.model_dump() for s in payload.fm_declaration],
        soc_trajectory=payload.soc_trajectory,
        spot_price_forecast=payload.spot_price_forecast,
        params_snapshot=payload.params_snapshot,
        declare_status=payload.declare_status,
        operator=ctx.username,
        result_meta=payload.result_meta,
    )


@router.get(
    "/declarations/{station_id}/{target_date}",
    summary="读取已保存申报",
    response_model=Optional[Dict[str, Any]],
)
def get_declaration(
    station_id: str,
    target_date: str,
    strategy_id: Optional[str] = Query(None),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> Optional[Dict[str, Any]]:
    return _service().get_declaration(station_id, target_date, strategy_id)


@router.post(
    "/review-simulate",
    summary="复盘模拟并回写申报记录",
    response_model=Dict[str, Any],
)
def simulate_review(
    payload: ReviewSimulatePayload,
    ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().simulate_review(
            station_id=payload.station_id,
            strategy_id=payload.strategy_id,
            target_date=payload.target_date,
            operator=ctx.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get(
    "/profit-analysis",
    summary="策略收益分析",
    response_model=Dict[str, Any],
)
def get_profit_analysis(
    station_id: str = Query(..., description="电站ID"),
    strategy_id: str = Query(..., description="策略ID"),
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().get_profit_analysis(
            station_id=station_id,
            strategy_id=strategy_id,
            start_date=start_date,
            end_date=end_date,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ============ 收益测算 ============


@router.post(
    "/calculate-revenue",
    summary="收益测算（含完整电能量公式）",
    response_model=Dict[str, Any],
)
def calculate_revenue(
    payload: CalculateRevenuePayload,
    _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().calculate_revenue(
            station_id=payload.station_id,
            target_date=payload.target_date,
            energy_declaration=[s.model_dump() for s in payload.energy_declaration],
            fm_declaration=[s.model_dump() for s in payload.fm_declaration],
            prices_96=payload.prices_96,
            beta=payload.beta,
            kp=payload.kp,
            clearing_price=payload.clearing_price,
            degradation_cost_per_mwh=payload.degradation_cost_per_mwh,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ============ 历史复盘 ============


@router.get(
    "/history/dates",
    summary="可查复盘日期列表",
    response_model=List[str],
)
def list_history_dates(
    station_id: str = Query(...),
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> List[str]:
    return _service().list_history_dates(station_id)


@router.get(
    "/history/{station_id}/{date}",
    summary="复盘数据",
    response_model=Dict[str, Any],
)
def get_history(
    station_id: str,
    date: str,
    _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    try:
        return _service().get_history(station_id, date)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
