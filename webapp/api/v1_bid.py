import logging
import math
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, validator
from webapp.api.dependencies.authz import CurrentUserContext, require_permission
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bid", tags=["bid"])

VIEW_PERMISSION = "module:strategy_dayahead:view"
EDIT_PERMISSION = "module:strategy_dayahead:edit"
PERIOD_COUNT = 48
SETTLEMENT_BASE_PRICE = 300

TradeType = Literal["auto", "manual"]
TradeSourceStatus = Literal["启用", "停用"]
DeclareStatus = Literal["已申报", "未申报"]
ProfitMetric = Literal["amount", "unit"]


class TradeSourceParamModel(BaseModel):
    param_key: str = ""
    param_name: str = ""
    param_value: str = ""
    unit: str = ""
    description: str = ""


class TradeSourcePayload(BaseModel):
    trade_source_name: str
    trade_type: TradeType
    strategy_code: str = ""
    trade_source_status: TradeSourceStatus = "启用"
    description: str = ""
    params: List[TradeSourceParamModel] = Field(default_factory=list)


class TradeSourceListItemModel(BaseModel):
    trade_source_id: str
    trade_source_name: str
    trade_type: TradeType
    strategy_id: str = ""
    strategy_code: str = ""
    trade_source_status: TradeSourceStatus
    next_day_declare_status: DeclareStatus


class TradeSourceDetailModel(TradeSourceListItemModel):
    description: str = ""
    params: List[TradeSourceParamModel] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class TradeSourceStatusPayload(BaseModel):
    status: TradeSourceStatus


class SimulationSummaryModel(BaseModel):
    total_bid_mwh: float
    active_period_count: int
    max_bid_mwh_per_period: float


class SimulationDetailModel(BaseModel):
    trade_source_id: str
    target_date: str
    current_server_time: str
    trade_type: TradeType
    strategy_name: str
    strategy_id: str = ""
    strategy_code: str = ""
    next_day_declare_status: DeclareStatus
    summary: SimulationSummaryModel
    price_forecast_30m: List[float]
    bid_mwh_30m: List[float]
    is_editable: bool
    lock_reason: Optional[str] = None


class ManualSimulationPayload(BaseModel):
    trade_source_id: str
    target_date: str
    bid_mwh_30m: List[float]

    @validator("bid_mwh_30m")
    def validate_values(cls, values: List[float]) -> List[float]:
        if len(values) != PERIOD_COUNT:
            raise ValueError("bid_mwh_30m 必须包含 48 个点位")
        return values


class ManualSimulationResetPayload(BaseModel):
    trade_source_id: str
    target_date: str


class ProfitSummaryModel(BaseModel):
    trade_source_id: str
    start_date: str
    end_date: str
    total_realized_pnl_yuan: float
    avg_daily_realized_pnl_yuan: float
    win_rate: float
    max_drawdown_yuan: float
    max_single_day_loss_yuan: float
    trading_days: int


class ProfitCurvePointModel(BaseModel):
    date: str
    strategy_value: float
    benchmark_value: float
    excess_value: float
    unit_label: str


class ProfitCurveResponseModel(BaseModel):
    trade_source_id: str
    metric: ProfitMetric
    points: List[ProfitCurvePointModel]


class ProfitDailyRowModel(BaseModel):
    date: str
    bid_total_mwh: float
    realized_pnl_yuan: float
    unit_pnl_yuan_per_mwh: float
    win_periods: int
    loss_periods: int
    avg_spread_yuan_per_mwh: float
    review_status: Literal["已复盘", "待复盘"]


class ProfitDailyResponseModel(BaseModel):
    rows: List[ProfitDailyRowModel]
    summary_row: Dict[str, float]


class DailyReviewSummaryModel(BaseModel):
    expected_pnl_yuan: float
    realized_pnl_yuan: float
    total_bid_mwh: float
    win_periods: int
    loss_periods: int
    avg_spread_yuan_per_mwh: float


class DailyReviewRowModel(BaseModel):
    period: int
    time_label: str
    price_forecast_yuan_per_mwh: float
    dayahead_price_yuan_per_mwh: float
    econ_price_yuan_per_mwh: float
    realtime_price_yuan_per_mwh: float
    bid_mwh: float
    spread_yuan_per_mwh: float
    period_pnl_yuan: float
    result_flag: Literal["盈利", "亏损", "持平"]


class DailyReviewDetailModel(BaseModel):
    trade_source_id: str
    trade_source_name: str
    target_date: str
    summary: DailyReviewSummaryModel
    chart_rows: List[DailyReviewRowModel]
    period_profit_rows: List[DailyReviewRowModel]


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "_", (value or "").strip().lower())
    return text.strip("_") or "item"


def _parse_date(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="日期格式无效，请使用 YYYY-MM-DD",
        ) from exc


def _serialize_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return ""


def _coerce_curve(values: Any) -> List[float]:
    if not isinstance(values, list):
        return []
    return [_round(float(item or 0), 1) for item in values[:PERIOD_COUNT]]


def _pick_price_curve(result_doc: Dict[str, Any]) -> List[float]:
    for field in ("price_forecast_30m", "dayahead_price_30m", "econ_price_30m", "rt_price_30m"):
        curve = _coerce_curve(result_doc.get(field))
        if curve:
            return curve
    return [0.0] * PERIOD_COUNT


def _get_trade_source_param_number(trade_source: Dict[str, Any], param_key: str, default: float = 0.0) -> float:
    params = trade_source.get("params") or []
    if isinstance(params, list):
        for item in params:
            if isinstance(item, dict) and item.get("param_key") == param_key:
                try:
                    return _round(float(item.get("param_value") or default), 1)
                except (TypeError, ValueError):
                    return _round(default, 1)
    return _round(default, 1)


def _load_latest_dayahead_forecast_curve(target_date: str) -> List[float]:
    target_dt = _parse_date(target_date)
    filters = {
        "forecast_type": "d1_price",
        "$or": [
            {"target_date": target_dt},
            {"target_date": target_date},
        ],
    }
    latest_doc = next(
        DATABASE.price_forecast_results.find(filters, {"forecast_id": 1, "created_at": 1}).sort(
            [("created_at", -1), ("forecast_id", -1)]
        ).limit(1),
        None,
    )
    if not latest_doc:
        return []

    forecast_id = latest_doc.get("forecast_id")
    forecast_filters = dict(filters)
    if forecast_id:
        forecast_filters["forecast_id"] = forecast_id

    docs = list(
        DATABASE.price_forecast_results.find(
            forecast_filters,
            {"_id": 0, "datetime": 1, "predicted_price": 1},
        ).sort([("datetime", 1)])
    )
    values = [_round(float(doc.get("predicted_price") or 0), 2) for doc in docs]
    if len(values) >= PERIOD_COUNT * 2:
        return [
            _round((values[index] + values[index + 1]) / 2, 2)
            for index in range(0, PERIOD_COUNT * 2, 2)
        ]
    if len(values) >= PERIOD_COUNT:
        return values[:PERIOD_COUNT]
    return []


def _resolve_dayahead_forecast_curve(target_date: str, result_doc: Optional[Dict[str, Any]] = None) -> List[float]:
    forecast_curve = _load_latest_dayahead_forecast_curve(target_date)
    if len(forecast_curve) == PERIOD_COUNT:
        return forecast_curve
    if result_doc:
        fallback_curve = _coerce_curve(result_doc.get("price_forecast_30m"))
        if len(fallback_curve) == PERIOD_COUNT:
            return fallback_curve
        return _pick_price_curve(result_doc)
    return [0.0] * PERIOD_COUNT


def _build_empty_manual_result_doc(trade_source: Dict[str, Any], target_date: str) -> Dict[str, Any]:
    now = datetime.now()
    zero_curve = [0.0] * PERIOD_COUNT
    max_bid_mwh_per_period = _get_trade_source_param_number(trade_source, "max_bid_mwh_per_period", 0.0)
    return {
        "trade_id": _trade_id(trade_source["trade_source_id"], target_date),
        "trade_type": trade_source["trade_type"],
        "trade_source_id": trade_source["trade_source_id"],
        "trade_source_name": trade_source.get("trade_source_name", ""),
        "strategy_id": trade_source.get("strategy_id", ""),
        "strategy_code": trade_source.get("strategy_code", ""),
        "forecast_date": now,
        "target_date": _parse_date(target_date),
        "trade_date_str": target_date,
        "status": "created",
        "max_bid_mwh_per_period": max_bid_mwh_per_period,
        "bid_ratio": zero_curve.copy(),
        "bid_mwh": zero_curve.copy(),
        "settlement_spread": zero_curve.copy(),
        "period_pnl": zero_curve.copy(),
        "period_result_flag": ["flat"] * PERIOD_COUNT,
        "daily_bid_mwh": 0.0,
        "daily_expected_pnl": 0.0,
        "daily_realized_pnl": 0.0,
        "daily_win_periods": 0,
        "daily_loss_periods": 0,
        "daily_avg_spread": 0.0,
        "settled_at": None,
        "created_at": now,
        "updated_at": now,
    }


def _build_bid_ratio_curve(bid_mwh_30m: List[float], max_bid_mwh_per_period: float) -> List[float]:
    if max_bid_mwh_per_period <= 0:
        return [0.0] * PERIOD_COUNT
    return [
        _round(max(0.0, float(value or 0)) / max_bid_mwh_per_period, 4)
        for value in bid_mwh_30m[:PERIOD_COUNT]
    ]


def _period_label(index: int) -> str:
    start_minutes = index * 30
    end_minutes = start_minutes + 30
    return f"{start_minutes // 60:02d}:{start_minutes % 60:02d}-{(end_minutes // 60) % 24:02d}:{end_minutes % 60:02d}"


def _build_price_forecast(target_date: str) -> List[float]:
    seed = int(target_date.replace("-", "")[-4:])
    rows: List[float] = []
    for index in range(PERIOD_COUNT):
        base = 330 + math.sin((index / PERIOD_COUNT) * math.pi * 2 - math.pi / 3) * 80
        evening = 52 if 34 <= index <= 40 else 0
        peak = 38 if 16 <= index <= 22 else 0
        valley = -32 if index <= 8 else 0
        rows.append(_round(base + evening + peak + valley + (seed % 9), 1))
    return rows


def _build_bid_curve(trade_type: TradeType, profile_index: int, target_date: str) -> List[float]:
    seed = int(target_date.replace("-", "")[-4:])
    rows: List[float] = []
    for index in range(PERIOD_COUNT):
        if trade_type == "auto":
            morning = 1 if 14 <= index <= 18 else 0
            evening = 1 if 34 <= index <= 40 else 0
            value = 65 + profile_index * 18 + morning * 78 + evening * 95 + ((seed + index) % 6) * 5
        elif profile_index % 2 == 0:
            peak = 135 if 16 <= index <= 22 else 118 if 34 <= index <= 39 else 26
            value = peak + ((seed + index) % 5) * 4
        else:
            balanced = 88 + math.sin((index / PERIOD_COUNT) * math.pi * 2) * 18
            value = balanced + ((seed + index) % 3) * 4
        rows.append(_round(value, 1))
    return rows


def _summarize_bid_curve(values: List[float]) -> Dict[str, Any]:
    positive = [item for item in values if item > 0]
    return {
        "total_bid_mwh": _round(sum(values), 1),
        "active_period_count": len(positive),
        "max_bid_mwh_per_period": _round(max(positive), 1) if positive else 0.0,
    }


def _build_default_trade_sources(now: datetime) -> List[Dict[str, Any]]:
    return [
        {
            "trade_source_id": "auto_prob",
            "trade_type": "auto",
            "trade_source_name": "策略1：独立时段概率报量",
            "strategy_id": "strategy_auto_prob",
            "strategy_code": "AUTO-PROB",
            "status": "active",
            "description": "按时段概率与边际收益自动生成次日申报曲线。",
            "params": [
                {"param_key": "risk_factor", "param_name": "风险系数", "param_value": "0.75", "unit": "-", "description": "控制报价风险偏好"},
                {"param_key": "peak_weight", "param_name": "峰段权重", "param_value": "1.25", "unit": "-", "description": "提高峰段分配"},
            ],
            "created_at": now,
            "updated_at": now,
        },
        {
            "trade_source_id": "auto_smooth",
            "trade_type": "auto",
            "trade_source_name": "策略2：联动平滑",
            "strategy_id": "strategy_auto_smooth",
            "strategy_code": "AUTO-SMOOTH",
            "status": "active",
            "description": "基于相邻时段平滑约束生成申报。",
            "params": [
                {"param_key": "smooth_lambda", "param_name": "平滑系数", "param_value": "0.60", "unit": "-", "description": "相邻时段平滑强度"},
                {"param_key": "max_ramp", "param_name": "最大爬坡", "param_value": "48", "unit": "MWh", "description": "单时段最大变化量"},
            ],
            "created_at": now,
            "updated_at": now,
        },
        {
            "trade_source_id": "manual_peak",
            "trade_type": "manual",
            "trade_source_name": "人工方案：高峰强化",
            "strategy_id": "strategy_manual_peak",
            "strategy_code": "MANUAL-PEAK",
            "status": "active",
            "description": "人工维护的高峰强化方案。",
            "params": [
                {"param_key": "peak_limit", "param_name": "峰段上限", "param_value": "160", "unit": "MWh", "description": "峰段手工申报上限"},
                {"param_key": "base_floor", "param_name": "基础底量", "param_value": "20", "unit": "MWh", "description": "低谷基础保留量"},
            ],
            "created_at": now,
            "updated_at": now,
        },
        {
            "trade_source_id": "manual_balance",
            "trade_type": "manual",
            "trade_source_name": "人工方案：平滑均衡",
            "strategy_id": "strategy_manual_balance",
            "strategy_code": "MANUAL-BALANCE",
            "status": "inactive",
            "description": "人工维护的平滑均衡方案。",
            "params": [
                {"param_key": "baseline_ratio", "param_name": "基础比例", "param_value": "0.55", "unit": "-", "description": "平滑基础比例"},
                {"param_key": "peak_boost", "param_name": "高峰加成", "param_value": "18", "unit": "MWh", "description": "高峰额外加成"},
            ],
            "created_at": now,
            "updated_at": now,
        },
    ]


def _normalize_params(params: Any) -> List[Dict[str, Any]]:
    if isinstance(params, list):
        rows = params
    elif isinstance(params, dict):
        rows = [
            {
                "param_key": key,
                "param_name": key,
                "param_value": str(value),
                "unit": "",
                "description": "",
            }
            for key, value in params.items()
        ]
    else:
        rows = []
    return [
        {
            "param_key": str(item.get("param_key", "")),
            "param_name": str(item.get("param_name", "")),
            "param_value": str(item.get("param_value", "")),
            "unit": str(item.get("unit", "")),
            "description": str(item.get("description", "")),
        }
        for item in rows
    ]


def _ensure_trade_sources_seeded() -> None:
    return


def _map_trade_source_status(raw: Any) -> TradeSourceStatus:
    if raw in ("inactive", "停用"):
        return "停用"
    return "启用"


def _map_trade_source_doc(doc: Dict[str, Any], next_status: DeclareStatus) -> Dict[str, Any]:
    return {
        "trade_source_id": str(doc.get("trade_source_id") or ""),
        "trade_source_name": str(doc.get("trade_source_name") or ""),
        "trade_type": doc.get("trade_type", "manual"),
        "strategy_id": str(doc.get("strategy_id") or ""),
        "strategy_code": str(doc.get("strategy_code") or ""),
        "trade_source_status": _map_trade_source_status(doc.get("status") or doc.get("trade_source_status")),
        "next_day_declare_status": next_status,
        "description": str(doc.get("description") or ""),
        "params": _normalize_params(doc.get("params")),
        "created_at": _serialize_timestamp(doc.get("created_at")),
        "updated_at": _serialize_timestamp(doc.get("updated_at")),
    }


def _tomorrow_str() -> str:
    return (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")


def _trade_id(trade_source_id: str, target_date: str) -> str:
    return f"{trade_source_id}_{target_date.replace('-', '')}"


def _build_strategy_result_doc(trade_source: Dict[str, Any], target_date: str, profile_index: int, settled: bool) -> Dict[str, Any]:
    now = datetime.now()
    price_forecast = _build_price_forecast(target_date)
    bid_mwh = _build_bid_curve(trade_source["trade_type"], profile_index, target_date)
    dayahead_price = [_round(price - 8 + math.sin(index / 6) * 6, 2) for index, price in enumerate(price_forecast)]
    econ_price = [_round(price - 14 + math.cos(index / 5) * 7, 2) for index, price in enumerate(price_forecast)]
    realtime_price = [_round(econ_price[index] + math.sin(index / 4) * 11 + ((profile_index + index) % 3 - 1) * 3.6, 2) for index in range(PERIOD_COUNT)]
    settlement_spread = [_round(realtime_price[index] - econ_price[index], 2) for index in range(PERIOD_COUNT)]
    period_pnl = [_round(bid_mwh[index] * settlement_spread[index], 2) for index in range(PERIOD_COUNT)]
    period_result_flag = ["win" if item > 0 else "loss" if item < 0 else "flat" for item in period_pnl]
    daily_bid = _round(sum(bid_mwh), 1)
    daily_expected = _round(sum(bid_mwh[index] * (price_forecast[index] - SETTLEMENT_BASE_PRICE) for index in range(PERIOD_COUNT)), 2)
    daily_realized = _round(sum(period_pnl), 2)
    daily_win_periods = sum(1 for item in period_pnl if item > 0)
    daily_loss_periods = sum(1 for item in period_pnl if item < 0)
    daily_avg_spread = _round(sum(settlement_spread) / PERIOD_COUNT, 2)
    return {
        "trade_id": _trade_id(trade_source["trade_source_id"], target_date),
        "trade_type": trade_source["trade_type"],
        "trade_source_id": trade_source["trade_source_id"],
        "trade_source_name": trade_source["trade_source_name"],
        "strategy_id": trade_source.get("strategy_id", ""),
        "strategy_code": trade_source.get("strategy_code", ""),
        "forecast_date": now.strftime("%Y-%m-%d"),
        "target_date": target_date,
        "trade_date_str": target_date,
        "status": "settled" if settled else "created",
        "price_forecast_30m": price_forecast,
        "dayahead_price_30m": dayahead_price,
        "econ_price_30m": econ_price,
        "rt_price_30m": realtime_price,
        "settlement_spread": settlement_spread,
        "bid_mwh": bid_mwh,
        "period_pnl": period_pnl,
        "period_result_flag": period_result_flag,
        "daily_bid_mwh": daily_bid,
        "daily_expected_pnl": daily_expected,
        "daily_realized_pnl": daily_realized if settled else 0.0,
        "daily_win_periods": daily_win_periods if settled else 0,
        "daily_loss_periods": daily_loss_periods if settled else 0,
        "daily_avg_spread": daily_avg_spread if settled else 0.0,
        "settled_at": now if settled else None,
        "created_at": now,
        "updated_at": now,
    }


def _result_date_variants(target_date: str) -> List[Any]:
    return [target_date, _parse_date(target_date)]


def _result_sort_key(doc: Dict[str, Any]) -> str:
    return str(doc.get("trade_date_str") or _serialize_timestamp(doc.get("target_date")) or "")


def _ensure_strategy_result(trade_source: Dict[str, Any], target_date: str) -> Optional[Dict[str, Any]]:
    return DATABASE.bid_strategy_results.find_one(
        {
            "$or": [
                {"trade_id": _trade_id(trade_source["trade_source_id"], target_date)},
                {"trade_source_id": trade_source["trade_source_id"], "trade_date_str": target_date},
                {"trade_source_id": trade_source["trade_source_id"], "target_date": {"$in": _result_date_variants(target_date)}},
            ]
        }
    )


def _ensure_strategy_results_for_range(trade_source: Dict[str, Any], start_date: str, end_date: str) -> List[Dict[str, Any]]:
    start = _parse_date(start_date)
    end = _parse_date(end_date)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="开始日期不能晚于结束日期")
    rows = list(
        DATABASE.bid_strategy_results.find(
            {
                "trade_source_id": trade_source["trade_source_id"],
                "$or": [
                    {"trade_date_str": {"$gte": start_date, "$lte": end_date}},
                    {"target_date": {"$gte": start, "$lte": end}},
                ],
            }
        )
    )
    return sorted(rows, key=_result_sort_key)


def _next_day_declare_status(trade_source_id: str) -> DeclareStatus:
    target_date = _tomorrow_str()
    result = DATABASE.bid_strategy_results.find_one(
        {
            "$or": [
                {"trade_id": _trade_id(trade_source_id, target_date)},
                {"trade_source_id": trade_source_id, "trade_date_str": target_date},
                {"trade_source_id": trade_source_id, "target_date": {"$in": _result_date_variants(target_date)}},
            ]
        },
        {"daily_bid_mwh": 1, "bid_mwh": 1},
    )
    if not result:
        return "未申报"
    daily_bid = float(result.get("daily_bid_mwh") or 0)
    bid_values = result.get("bid_mwh") or []
    return "已申报" if daily_bid > 0 or any(float(value or 0) > 0 for value in bid_values) else "未申报"


def _get_trade_source_or_404(trade_source_id: str) -> Dict[str, Any]:
    doc = DATABASE.bid_trade_sources.find_one({"trade_source_id": trade_source_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="交易来源不存在")
    return doc


def _get_strategy_result_or_404(trade_source: Dict[str, Any], target_date: str, detail: str) -> Dict[str, Any]:
    result = _ensure_strategy_result(trade_source, target_date)
    if result:
        return result
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _simulation_response(trade_source: Dict[str, Any], result_doc: Dict[str, Any]) -> SimulationDetailModel:
    is_editable = trade_source.get("trade_type") == "manual"
    next_status = "已申报" if float(result_doc.get("daily_bid_mwh") or 0) > 0 else "未申报"
    target_date = str(result_doc.get("trade_date_str") or _serialize_timestamp(result_doc.get("target_date")) or "")
    price_curve = _resolve_dayahead_forecast_curve(target_date, result_doc)
    bid_curve = _coerce_curve(result_doc.get("bid_mwh"))
    if len(bid_curve) < PERIOD_COUNT:
        bid_curve = bid_curve + [0.0] * (PERIOD_COUNT - len(bid_curve))
    return SimulationDetailModel(
        trade_source_id=str(trade_source.get("trade_source_id") or ""),
        target_date=target_date,
        current_server_time=datetime.now().isoformat(),
        trade_type=trade_source["trade_type"],
        strategy_name=str(trade_source.get("trade_source_name") or ""),
        strategy_id=str(trade_source.get("strategy_id") or ""),
        strategy_code=str(trade_source.get("strategy_code") or ""),
        next_day_declare_status=next_status,
        summary=SimulationSummaryModel(**_summarize_bid_curve(bid_curve)),
        price_forecast_30m=price_curve if len(price_curve) == PERIOD_COUNT else price_curve + [0.0] * (PERIOD_COUNT - len(price_curve)),
        bid_mwh_30m=bid_curve,
        is_editable=is_editable,
        lock_reason=None if is_editable else "自动策略申报只读展示，不支持前端编辑。",
    )


def _profit_summary_from_results(trade_source_id: str, start_date: str, end_date: str, rows: List[Dict[str, Any]]) -> ProfitSummaryModel:
    realized_values = [float(item.get("daily_realized_pnl") or 0) for item in rows]
    total_realized = _round(sum(realized_values), 2)
    trading_days = len(rows)
    avg_daily = _round(total_realized / trading_days, 2) if trading_days else 0.0
    win_rate = _round(sum(1 for item in realized_values if item > 0) / trading_days, 4) if trading_days else 0.0
    max_single_day_loss = _round(min(realized_values), 2) if realized_values else 0.0
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for item in realized_values:
        cumulative += item
        peak = max(peak, cumulative)
        max_drawdown = min(max_drawdown, cumulative - peak)
    return ProfitSummaryModel(
        trade_source_id=trade_source_id,
        start_date=start_date,
        end_date=end_date,
        total_realized_pnl_yuan=total_realized,
        avg_daily_realized_pnl_yuan=avg_daily,
        win_rate=win_rate,
        max_drawdown_yuan=_round(abs(max_drawdown), 2),
        max_single_day_loss_yuan=_round(abs(min(max_single_day_loss, 0.0)), 2),
        trading_days=trading_days,
    )


def _profit_curve_from_results(trade_source_id: str, metric: ProfitMetric, rows: List[Dict[str, Any]]) -> ProfitCurveResponseModel:
    points: List[ProfitCurvePointModel] = []
    cumulative_strategy = 0.0
    cumulative_benchmark = 0.0
    cumulative_bid = 0.0
    for item in rows:
        daily_bid = float(item.get("daily_bid_mwh") or 0)
        realized = float(item.get("daily_realized_pnl") or 0)
        expected = float(item.get("daily_expected_pnl") or 0) * 0.82
        cumulative_bid += daily_bid
        cumulative_strategy += realized
        cumulative_benchmark += expected
        if metric == "unit":
            strategy_value = _round(cumulative_strategy / cumulative_bid, 4) if cumulative_bid else 0.0
            benchmark_value = _round(cumulative_benchmark / cumulative_bid, 4) if cumulative_bid else 0.0
            unit_label = "元/MWh"
        else:
            strategy_value = _round(cumulative_strategy, 2)
            benchmark_value = _round(cumulative_benchmark, 2)
            unit_label = "元"
        points.append(
            ProfitCurvePointModel(
                date=item["trade_date_str"],
                strategy_value=strategy_value,
                benchmark_value=benchmark_value,
                excess_value=_round(strategy_value - benchmark_value, 4 if metric == "unit" else 2),
                unit_label=unit_label,
            )
        )
    return ProfitCurveResponseModel(trade_source_id=trade_source_id, metric=metric, points=points)


def _profit_daily_from_results(rows: List[Dict[str, Any]]) -> ProfitDailyResponseModel:
    data_rows: List[ProfitDailyRowModel] = []
    total_bid = 0.0
    total_realized = 0.0
    total_win_periods = 0
    total_loss_periods = 0
    for item in rows:
        daily_bid = float(item.get("daily_bid_mwh") or 0)
        realized = float(item.get("daily_realized_pnl") or 0)
        win_periods = int(item.get("daily_win_periods") or 0)
        loss_periods = int(item.get("daily_loss_periods") or 0)
        data_rows.append(
            ProfitDailyRowModel(
                date=item["trade_date_str"],
                bid_total_mwh=_round(daily_bid, 1),
                realized_pnl_yuan=_round(realized, 2),
                unit_pnl_yuan_per_mwh=_round(realized / daily_bid, 4) if daily_bid else 0.0,
                win_periods=win_periods,
                loss_periods=loss_periods,
                avg_spread_yuan_per_mwh=_round(float(item.get("daily_avg_spread") or 0), 2),
                review_status="已复盘" if item.get("status") == "settled" else "待复盘",
            )
        )
        total_bid += daily_bid
        total_realized += realized
        total_win_periods += win_periods
        total_loss_periods += loss_periods
    return ProfitDailyResponseModel(
        rows=data_rows,
        summary_row={
            "bid_total_mwh": _round(total_bid, 1),
            "realized_pnl_yuan": _round(total_realized, 2),
            "unit_pnl_yuan_per_mwh": _round(total_realized / total_bid, 4) if total_bid else 0.0,
            "win_periods": float(total_win_periods),
            "loss_periods": float(total_loss_periods),
        },
    )


def _daily_review_from_result(trade_source: Dict[str, Any], result: Dict[str, Any]) -> DailyReviewDetailModel:
    target_date = str(result.get("trade_date_str") or _serialize_timestamp(result.get("target_date")) or "")
    forecast_curve = _resolve_dayahead_forecast_curve(target_date, result)
    rows: List[DailyReviewRowModel] = []
    for index in range(PERIOD_COUNT):
        period_pnl = float((result.get("period_pnl") or [0] * PERIOD_COUNT)[index] or 0)
        if period_pnl > 0:
            result_flag: Literal["盈利", "亏损", "持平"] = "盈利"
        elif period_pnl < 0:
            result_flag = "亏损"
        else:
            result_flag = "持平"
        rows.append(
            DailyReviewRowModel(
                period=index + 1,
                time_label=_period_label(index),
                price_forecast_yuan_per_mwh=forecast_curve[index] if index < len(forecast_curve) else 0.0,
                dayahead_price_yuan_per_mwh=_round(float((result.get("dayahead_price_30m") or [0] * PERIOD_COUNT)[index] or 0), 2),
                econ_price_yuan_per_mwh=_round(float((result.get("econ_price_30m") or [0] * PERIOD_COUNT)[index] or 0), 2),
                realtime_price_yuan_per_mwh=_round(float((result.get("rt_price_30m") or [0] * PERIOD_COUNT)[index] or 0), 2),
                bid_mwh=_round(float((result.get("bid_mwh") or [0] * PERIOD_COUNT)[index] or 0), 1),
                spread_yuan_per_mwh=_round(float((result.get("settlement_spread") or [0] * PERIOD_COUNT)[index] or 0), 2),
                period_pnl_yuan=_round(period_pnl, 2),
                result_flag=result_flag,
            )
        )
    return DailyReviewDetailModel(
        trade_source_id=trade_source["trade_source_id"],
        trade_source_name=trade_source["trade_source_name"],
        target_date=target_date,
        summary=DailyReviewSummaryModel(
            expected_pnl_yuan=_round(float(result.get("daily_expected_pnl") or 0), 2),
            realized_pnl_yuan=_round(float(result.get("daily_realized_pnl") or 0), 2),
            total_bid_mwh=_round(float(result.get("daily_bid_mwh") or 0), 1),
            win_periods=int(result.get("daily_win_periods") or 0),
            loss_periods=int(result.get("daily_loss_periods") or 0),
            avg_spread_yuan_per_mwh=_round(float(result.get("daily_avg_spread") or 0), 2),
        ),
        chart_rows=rows,
        period_profit_rows=rows,
    )


def _create_trade_source(payload: TradeSourcePayload, expected_type: TradeType) -> TradeSourceDetailModel:
    if payload.trade_type != expected_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="交易类型与接口不匹配")
    now = datetime.now()
    base_slug = _slugify(payload.strategy_code or payload.trade_source_name)
    prefix = "auto" if payload.trade_type == "auto" else "manual"
    trade_source_id = f"{prefix}_{base_slug}"
    counter = 2
    while DATABASE.bid_trade_sources.count_documents({"trade_source_id": trade_source_id}) > 0:
        trade_source_id = f"{prefix}_{base_slug}_{counter}"
        counter += 1
    doc = {
        "trade_source_id": trade_source_id,
        "trade_type": payload.trade_type,
        "trade_source_name": payload.trade_source_name,
        "strategy_id": f"strategy_{base_slug}",
        "strategy_code": payload.strategy_code,
        "status": "active" if payload.trade_source_status == "启用" else "inactive",
        "description": payload.description,
        "params": [item.dict() for item in payload.params],
        "created_at": now,
        "updated_at": now,
    }
    DATABASE.bid_trade_sources.insert_one(doc)
    return TradeSourceDetailModel(**_map_trade_source_doc(doc, "未申报"))


@router.get("/trade-sources", response_model=List[TradeSourceListItemModel], summary="获取交易来源列表")
def get_trade_sources(_ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> List[TradeSourceListItemModel]:
    docs = list(DATABASE.bid_trade_sources.find({}, {"_id": 0}).sort("trade_source_name", 1))
    return [
        TradeSourceListItemModel(**{key: value for key, value in _map_trade_source_doc(doc, _next_day_declare_status(doc["trade_source_id"])).items() if key in TradeSourceListItemModel.__fields__})
        for doc in docs
    ]


@router.get("/trade-sources/{trade_source_id}", response_model=TradeSourceDetailModel, summary="获取交易来源详情")
def get_trade_source_detail(trade_source_id: str, _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> TradeSourceDetailModel:
    return TradeSourceDetailModel(**_map_trade_source_doc(_get_trade_source_or_404(trade_source_id), _next_day_declare_status(trade_source_id)))


@router.post("/trade-sources/manual", response_model=TradeSourceDetailModel, summary="新增人工方案")
def create_manual_trade_source(payload: TradeSourcePayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> TradeSourceDetailModel:
    return _create_trade_source(payload, expected_type="manual")


@router.post("/trade-sources/auto", response_model=TradeSourceDetailModel, summary="新增自动策略")
def create_auto_trade_source(payload: TradeSourcePayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> TradeSourceDetailModel:
    return _create_trade_source(payload, expected_type="auto")


@router.put("/trade-sources/{trade_source_id}", response_model=TradeSourceDetailModel, summary="更新交易来源")
def update_trade_source(trade_source_id: str, payload: TradeSourcePayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> TradeSourceDetailModel:
    doc = _get_trade_source_or_404(trade_source_id)
    update_doc = {
        "trade_source_name": payload.trade_source_name,
        "strategy_code": payload.strategy_code,
        "description": payload.description,
        "params": [item.dict() for item in payload.params],
        "status": "active" if payload.trade_source_status == "启用" else "inactive",
        "updated_at": datetime.now(),
    }
    DATABASE.bid_trade_sources.update_one({"trade_source_id": trade_source_id}, {"$set": update_doc})
    return TradeSourceDetailModel(**_map_trade_source_doc({**doc, **update_doc}, _next_day_declare_status(trade_source_id)))


@router.post("/trade-sources/{trade_source_id}/status", summary="设置交易来源状态")
def set_trade_source_status(trade_source_id: str, payload: TradeSourceStatusPayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> Dict[str, str]:
    _get_trade_source_or_404(trade_source_id)
    DATABASE.bid_trade_sources.update_one({"trade_source_id": trade_source_id}, {"$set": {"status": "active" if payload.status == "启用" else "inactive", "updated_at": datetime.now()}})
    return {"status": "success"}


@router.delete("/trade-sources/{trade_source_id}", summary="删除交易来源")
def delete_trade_source(trade_source_id: str, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> Dict[str, str]:
    _get_trade_source_or_404(trade_source_id)
    DATABASE.bid_trade_sources.delete_one({"trade_source_id": trade_source_id})
    DATABASE.bid_strategy_results.delete_many({"trade_source_id": trade_source_id})
    return {"status": "success"}


@router.get("/simulations/next-day", response_model=SimulationDetailModel, summary="获取次日模拟申报")
def get_next_day_simulation(trade_source_id: str = Query(...), _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> SimulationDetailModel:
    trade_source = _get_trade_source_or_404(trade_source_id)
    target_date = _tomorrow_str()
    result_doc = _ensure_strategy_result(trade_source, target_date)
    if not result_doc:
        if trade_source.get("trade_type") == "manual":
            result_doc = _build_empty_manual_result_doc(trade_source, target_date)
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到次日申报记录")
    return _simulation_response(trade_source, result_doc)


@router.post("/simulations/manual-save", response_model=SimulationDetailModel, summary="保存人工申报")
def save_manual_simulation(payload: ManualSimulationPayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> SimulationDetailModel:
    trade_source = _get_trade_source_or_404(payload.trade_source_id)
    if trade_source.get("trade_type") != "manual":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅人工方案支持保存")
    result_doc = _ensure_strategy_result(trade_source, payload.target_date)
    if not result_doc:
        result_doc = _build_empty_manual_result_doc(trade_source, payload.target_date)
    now = datetime.now()
    summary = _summarize_bid_curve(payload.bid_mwh_30m)
    price_forecast = _resolve_dayahead_forecast_curve(payload.target_date, result_doc)
    daily_expected = _round(sum(payload.bid_mwh_30m[index] * (price_forecast[index] - SETTLEMENT_BASE_PRICE) for index in range(PERIOD_COUNT)), 2)
    max_bid_mwh_per_period = _round(float(result_doc.get("max_bid_mwh_per_period") or _get_trade_source_param_number(trade_source, "max_bid_mwh_per_period", 0.0)), 1)
    bid_curve = [_round(float(value or 0), 1) for value in payload.bid_mwh_30m]
    bid_ratio = _build_bid_ratio_curve(bid_curve, max_bid_mwh_per_period)
    update_fields: Dict[str, Any] = {
        "trade_id": _trade_id(payload.trade_source_id, payload.target_date),
        "trade_type": trade_source.get("trade_type"),
        "trade_source_id": trade_source.get("trade_source_id"),
        "trade_source_name": trade_source.get("trade_source_name"),
        "strategy_id": trade_source.get("strategy_id", ""),
        "strategy_code": trade_source.get("strategy_code", ""),
        "forecast_date": result_doc.get("forecast_date") or now,
        "target_date": result_doc.get("target_date") or _parse_date(payload.target_date),
        "trade_date_str": payload.target_date,
        "status": result_doc.get("status") or "created",
        "max_bid_mwh_per_period": max_bid_mwh_per_period,
        "bid_ratio": bid_ratio,
        "bid_mwh": bid_curve,
        "daily_bid_mwh": summary["total_bid_mwh"],
        "daily_expected_pnl": daily_expected,
        "updated_at": now,
    }
    if result_doc.get("original_bid_mwh") is None and isinstance(result_doc.get("bid_mwh"), list):
        update_fields["original_bid_mwh"] = [_round(float(value or 0), 1) for value in result_doc.get("bid_mwh", [])]
    filter_query = {"trade_id": _trade_id(payload.trade_source_id, payload.target_date)}
    DATABASE.bid_strategy_results.update_one(
        filter_query,
        {
            "$set": update_fields,
            "$setOnInsert": {"created_at": result_doc.get("created_at") or now},
        },
        upsert=True,
    )
    DATABASE.bid_trade_sources.update_one({"trade_source_id": payload.trade_source_id}, {"$set": {"updated_at": now}})
    saved_doc = DATABASE.bid_strategy_results.find_one(filter_query) or {**result_doc, **update_fields}
    return _simulation_response(trade_source, saved_doc)


@router.post("/simulations/manual-reset", response_model=SimulationDetailModel, summary="重置人工申报")
def reset_manual_simulation(payload: ManualSimulationResetPayload, _ctx: CurrentUserContext = Depends(require_permission(EDIT_PERMISSION))) -> SimulationDetailModel:
    trade_source = _get_trade_source_or_404(payload.trade_source_id)
    if trade_source.get("trade_type") != "manual":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅人工方案支持重置")
    result_doc = _get_strategy_result_or_404(trade_source, payload.target_date, "未找到可重置的申报记录")
    if not isinstance(result_doc.get("original_bid_mwh"), list) or len(result_doc.get("original_bid_mwh", [])) != PERIOD_COUNT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前记录缺少原始申报曲线，暂不支持重置")
    reset_curve = [_round(float(value or 0), 1) for value in result_doc.get("original_bid_mwh", [])]
    now = datetime.now()
    summary = _summarize_bid_curve(reset_curve)
    price_forecast = _resolve_dayahead_forecast_curve(payload.target_date, result_doc)
    daily_expected = _round(sum(reset_curve[index] * (price_forecast[index] - SETTLEMENT_BASE_PRICE) for index in range(PERIOD_COUNT)), 2)
    DATABASE.bid_strategy_results.update_one({"_id": result_doc["_id"]}, {"$set": {"bid_mwh": reset_curve, "daily_bid_mwh": summary["total_bid_mwh"], "daily_expected_pnl": daily_expected, "updated_at": now}})
    DATABASE.bid_trade_sources.update_one({"trade_source_id": payload.trade_source_id}, {"$set": {"updated_at": now}})
    return _simulation_response(trade_source, DATABASE.bid_strategy_results.find_one({"_id": result_doc["_id"]}) or result_doc)


@router.get("/analysis/summary", response_model=ProfitSummaryModel, summary="获取收益摘要")
def get_profit_summary(trade_source_id: str = Query(...), start_date: str = Query(...), end_date: str = Query(...), _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> ProfitSummaryModel:
    trade_source = _get_trade_source_or_404(trade_source_id)
    return _profit_summary_from_results(trade_source_id, start_date, end_date, _ensure_strategy_results_for_range(trade_source, start_date, end_date))


@router.get("/analysis/profit-curve", response_model=ProfitCurveResponseModel, summary="获取收益曲线")
def get_profit_curve(trade_source_id: str = Query(...), start_date: str = Query(...), end_date: str = Query(...), metric: ProfitMetric = Query("amount"), _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> ProfitCurveResponseModel:
    trade_source = _get_trade_source_or_404(trade_source_id)
    return _profit_curve_from_results(trade_source_id, metric, _ensure_strategy_results_for_range(trade_source, start_date, end_date))


@router.get("/analysis/daily", response_model=ProfitDailyResponseModel, summary="获取日度收益表")
def get_profit_daily(trade_source_id: str = Query(...), start_date: str = Query(...), end_date: str = Query(...), _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> ProfitDailyResponseModel:
    trade_source = _get_trade_source_or_404(trade_source_id)
    return _profit_daily_from_results(_ensure_strategy_results_for_range(trade_source, start_date, end_date))


@router.get("/analysis/daily-review/{target_date}", response_model=DailyReviewDetailModel, summary="获取单日复盘")
def get_daily_review(target_date: str, trade_source_id: str = Query(...), _ctx: CurrentUserContext = Depends(require_permission(VIEW_PERMISSION))) -> DailyReviewDetailModel:
    trade_source = _get_trade_source_or_404(trade_source_id)
    return _daily_review_from_result(trade_source, _get_strategy_result_or_404(trade_source, target_date, "未找到对应日期的复盘记录"))
