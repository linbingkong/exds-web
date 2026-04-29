# -*- coding: utf-8 -*-
"""调频市场价格接口。"""

import logging
import math
from datetime import datetime
from typing import Any, Dict, Iterable, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status

from webapp.api.dependencies.authz import require_permission
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/freq-regulation", tags=["调频市场价格"])

MarketType = Literal["day_ahead", "intraday"]
MARKET_TYPES: Tuple[MarketType, MarketType] = ("day_ahead", "intraday")
VIEW_PERMISSION = "module:freq_regulation_market:view"

clearing_collection = DATABASE["frequency_regulation_clearing"]
demand_collection = DATABASE["frequency_regulation_demand"]


def _parse_date(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} 格式无效，应为 YYYY-MM-DD")


def _parse_month(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} 格式无效，应为 YYYY-MM")


def _validate_date_range(start_date: str, end_date: str) -> None:
    start = _parse_date(start_date, "start_date")
    end = _parse_date(end_date, "end_date")
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date 不能晚于 end_date")


def _validate_month_range(start_month: str, end_month: str) -> None:
    start = _parse_month(start_month, "start_month")
    end = _parse_month(end_month, "end_month")
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_month 不能晚于 end_month")


def _month_upper_bound(month: str) -> str:
    return f"{month}-31"


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def _mean(values: Iterable[Any]) -> Optional[float]:
    nums = [_to_float(v) for v in values]
    clean = [v for v in nums if v is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _std(values: Iterable[Any]) -> Optional[float]:
    nums = [_to_float(v) for v in values]
    clean = [v for v in nums if v is not None]
    if not clean:
        return None
    avg = sum(clean) / len(clean)
    variance = sum((v - avg) ** 2 for v in clean) / len(clean)
    return math.sqrt(variance)


def _round_value(value: Optional[float], digits: int = 2) -> Optional[float]:
    if value is None:
        return None
    return round(value, digits)


def _time_sort_key(time_str: str) -> int:
    if time_str == "24:00":
        return 24 * 60
    try:
        hour_text, minute_text = time_str.split(":", 1)
        return int(hour_text) * 60 + int(minute_text)
    except Exception:
        return 9999


def _date_sort_key(date_str: str) -> datetime:
    return _parse_date(date_str, "date_str")


def _collect_daily_market_rows(date: str, market_type: MarketType) -> Dict[str, Dict[str, Optional[float]]]:
    clearing_rows = clearing_collection.find(
        {"date_str": date, "market_type": market_type},
        {"_id": 0, "time_str": 1, "clearing_price": 1, "winning_resource_count": 1, "avg_bid_price": 1},
    )
    demand_rows = demand_collection.find(
        {"date_str": date, "market_type": market_type},
        {"_id": 0, "time_str": 1, "demand_mw": 1},
    )

    by_time: Dict[str, Dict[str, Optional[float]]] = {}
    for row in clearing_rows:
        time_str = str(row.get("time_str") or "")
        if not time_str:
            continue
        by_time.setdefault(time_str, {})
        by_time[time_str].update(
            {
                "clearing_price": _to_float(row.get("clearing_price")),
                "winning_resource_count": _to_float(row.get("winning_resource_count")),
                "avg_bid_price": _to_float(row.get("avg_bid_price")),
            }
        )

    for row in demand_rows:
        time_str = str(row.get("time_str") or "")
        if not time_str:
            continue
        by_time.setdefault(time_str, {})
        by_time[time_str]["demand_mw"] = _to_float(row.get("demand_mw"))

    return by_time


@router.get("/daily", summary="获取调频市场单日曲线")
def get_freq_regulation_daily(
    date: str = Query(..., description="业务日期，格式 YYYY-MM-DD"),
    _=Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    """返回单日日前和日内调频市场小时点数据。"""
    _parse_date(date, "date")

    market_rows = {market_type: _collect_daily_market_rows(date, market_type) for market_type in MARKET_TYPES}
    all_times = sorted(
        set(market_rows["day_ahead"].keys()) | set(market_rows["intraday"].keys()),
        key=_time_sort_key,
    )

    points: List[Dict[str, Any]] = []
    for time_str in all_times:
        da = market_rows["day_ahead"].get(time_str, {})
        intraday = market_rows["intraday"].get(time_str, {})
        points.append(
            {
                "time": time_str,
                "day_ahead_clearing_price": _round_value(da.get("clearing_price")),
                "intraday_clearing_price": _round_value(intraday.get("clearing_price")),
                "day_ahead_demand_mw": _round_value(da.get("demand_mw")),
                "intraday_demand_mw": _round_value(intraday.get("demand_mw")),
                "day_ahead_avg_bid_price": _round_value(da.get("avg_bid_price")),
                "intraday_avg_bid_price": _round_value(intraday.get("avg_bid_price")),
                "day_ahead_winning_resource_count": _round_value(da.get("winning_resource_count"), 0),
                "intraday_winning_resource_count": _round_value(intraday.get("winning_resource_count"), 0),
            }
        )

    da_avg_price = _mean(point["day_ahead_clearing_price"] for point in points)
    intraday_avg_price = _mean(point["intraday_clearing_price"] for point in points)

    return {
        "date": date,
        "points": points,
        "kpis": {
            "day_ahead_avg_clearing_price": _round_value(da_avg_price),
            "intraday_avg_clearing_price": _round_value(intraday_avg_price),
            "spread_avg_clearing_price": _round_value(
                da_avg_price - intraday_avg_price
                if da_avg_price is not None and intraday_avg_price is not None
                else None
            ),
            "day_ahead_avg_demand_mw": _round_value(_mean(point["day_ahead_demand_mw"] for point in points)),
            "intraday_avg_demand_mw": _round_value(_mean(point["intraday_demand_mw"] for point in points)),
        },
        "total_points": len(points),
    }


@router.get("/range", summary="获取调频市场区间分析")
def get_freq_regulation_range(
    start_date: str = Query(..., description="开始日期，格式 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期，格式 YYYY-MM-DD"),
    market_type: MarketType = Query(..., description="市场类型：day_ahead 或 intraday"),
    _=Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    """返回指定市场类型的小时均值、标准差和日度趋势。"""
    _validate_date_range(start_date, end_date)

    clearing_rows = list(
        clearing_collection.find(
            {"market_type": market_type, "date_str": {"$gte": start_date, "$lte": end_date}},
            {"_id": 0, "date_str": 1, "time_str": 1, "clearing_price": 1},
        )
    )
    demand_rows = list(
        demand_collection.find(
            {"market_type": market_type, "date_str": {"$gte": start_date, "$lte": end_date}},
            {"_id": 0, "date_str": 1, "time_str": 1, "demand_mw": 1},
        )
    )

    prices_by_time: Dict[str, List[Optional[float]]] = {}
    demands_by_time: Dict[str, List[Optional[float]]] = {}
    prices_by_date: Dict[str, List[Optional[float]]] = {}
    demands_by_date: Dict[str, List[Optional[float]]] = {}

    for row in clearing_rows:
        time_str = str(row.get("time_str") or "")
        date_str = str(row.get("date_str") or "")
        value = _to_float(row.get("clearing_price"))
        if time_str:
            prices_by_time.setdefault(time_str, []).append(value)
        if date_str:
            prices_by_date.setdefault(date_str, []).append(value)

    for row in demand_rows:
        time_str = str(row.get("time_str") or "")
        date_str = str(row.get("date_str") or "")
        value = _to_float(row.get("demand_mw"))
        if time_str:
            demands_by_time.setdefault(time_str, []).append(value)
        if date_str:
            demands_by_date.setdefault(date_str, []).append(value)

    all_times = sorted(set(prices_by_time.keys()) | set(demands_by_time.keys()), key=_time_sort_key)
    hourly_stats: List[Dict[str, Any]] = []
    for time_str in all_times:
        avg_price = _mean(prices_by_time.get(time_str, []))
        price_std = _std(prices_by_time.get(time_str, []))
        avg_demand = _mean(demands_by_time.get(time_str, []))
        demand_std = _std(demands_by_time.get(time_str, []))
        hourly_stats.append(
            {
                "time": time_str,
                "avg_clearing_price": _round_value(avg_price),
                "clearing_price_std": _round_value(price_std),
                "clearing_price_upper": _round_value(avg_price + price_std if avg_price is not None and price_std is not None else None),
                "clearing_price_lower": _round_value(avg_price - price_std if avg_price is not None and price_std is not None else None),
                "avg_demand_mw": _round_value(avg_demand),
                "demand_mw_std": _round_value(demand_std),
                "demand_mw_upper": _round_value(avg_demand + demand_std if avg_demand is not None and demand_std is not None else None),
                "demand_mw_lower": _round_value(avg_demand - demand_std if avg_demand is not None and demand_std is not None else None),
            }
        )

    all_dates = sorted(set(prices_by_date.keys()) | set(demands_by_date.keys()), key=_date_sort_key)
    daily_trends = [
        {
            "date": date_str,
            "avg_clearing_price": _round_value(_mean(prices_by_date.get(date_str, []))),
            "avg_demand_mw": _round_value(_mean(demands_by_date.get(date_str, []))),
        }
        for date_str in all_dates
    ]

    return {
        "start_date": start_date,
        "end_date": end_date,
        "market_type": market_type,
        "hourly_stats": hourly_stats,
        "daily_trends": daily_trends,
    }


@router.get("/monthly", summary="获取调频市场月度趋势")
def get_freq_regulation_monthly(
    start_month: str = Query(..., description="开始月份，格式 YYYY-MM"),
    end_month: str = Query(..., description="结束月份，格式 YYYY-MM"),
    _=Depends(require_permission(VIEW_PERMISSION)),
) -> Dict[str, Any]:
    """返回调频市场月度聚合数据。"""
    _validate_month_range(start_month, end_month)
    start_date = f"{start_month}-01"
    end_date = _month_upper_bound(end_month)

    clearing_rows = list(
        clearing_collection.find(
            {"date_str": {"$gte": start_date, "$lte": end_date}},
            {"_id": 0, "market_type": 1, "date_str": 1, "clearing_price": 1, "avg_bid_price": 1},
        )
    )
    demand_rows = list(
        demand_collection.find(
            {"date_str": {"$gte": start_date, "$lte": end_date}},
            {"_id": 0, "market_type": 1, "date_str": 1, "demand_mw": 1},
        )
    )

    daily_price: Dict[Tuple[str, str, str], List[Optional[float]]] = {}
    daily_bid: Dict[Tuple[str, str, str], List[Optional[float]]] = {}
    daily_demand: Dict[Tuple[str, str, str], List[Optional[float]]] = {}

    for row in clearing_rows:
        market_type = str(row.get("market_type") or "")
        date_str = str(row.get("date_str") or "")
        if market_type not in MARKET_TYPES or not date_str:
            continue
        month = date_str[:7]
        daily_price.setdefault((market_type, month, date_str), []).append(_to_float(row.get("clearing_price")))
        daily_bid.setdefault((market_type, month, date_str), []).append(_to_float(row.get("avg_bid_price")))

    for row in demand_rows:
        market_type = str(row.get("market_type") or "")
        date_str = str(row.get("date_str") or "")
        if market_type not in MARKET_TYPES or not date_str:
            continue
        month = date_str[:7]
        daily_demand.setdefault((market_type, month, date_str), []).append(_to_float(row.get("demand_mw")))

    month_buckets: Dict[str, Dict[str, List[Optional[float]]]] = {}
    for (market_type, month, _date_str), values in daily_price.items():
        month_buckets.setdefault(month, {}).setdefault(f"{market_type}_clearing_price", []).append(_mean(values))
    for (market_type, month, _date_str), values in daily_bid.items():
        month_buckets.setdefault(month, {}).setdefault(f"{market_type}_avg_bid_price", []).append(_mean(values))
    for (market_type, month, _date_str), values in daily_demand.items():
        month_buckets.setdefault(month, {}).setdefault(f"{market_type}_demand_mw", []).append(_mean(values))

    months = sorted(month_buckets.keys())
    rows: List[Dict[str, Any]] = []
    for month in months:
        bucket = month_buckets[month]
        da_price = _mean(bucket.get("day_ahead_clearing_price", []))
        intraday_price = _mean(bucket.get("intraday_clearing_price", []))
        rows.append(
            {
                "month": month,
                "day_ahead_avg_clearing_price": _round_value(da_price),
                "intraday_avg_clearing_price": _round_value(intraday_price),
                "spread_avg_clearing_price": _round_value(
                    da_price - intraday_price if da_price is not None and intraday_price is not None else None
                ),
                "day_ahead_avg_demand_mw": _round_value(_mean(bucket.get("day_ahead_demand_mw", []))),
                "intraday_avg_demand_mw": _round_value(_mean(bucket.get("intraday_demand_mw", []))),
                "day_ahead_avg_bid_price": _round_value(_mean(bucket.get("day_ahead_avg_bid_price", []))),
                "intraday_avg_bid_price": _round_value(_mean(bucket.get("intraday_avg_bid_price", []))),
            }
        )

    avg_prices = [
        (row["month"], row["day_ahead_avg_clearing_price"], row["intraday_avg_clearing_price"])
        for row in rows
    ]
    combined_month_prices = [
        (month, _mean([da_price, intraday_price]))
        for month, da_price, intraday_price in avg_prices
    ]
    valid_combined = [(month, price) for month, price in combined_month_prices if price is not None]
    highest = max(valid_combined, key=lambda item: item[1]) if valid_combined else None
    lowest = min(valid_combined, key=lambda item: item[1]) if valid_combined else None

    return {
        "start_month": start_month,
        "end_month": end_month,
        "rows": rows,
        "kpis": {
            "day_ahead_period_avg_price": _round_value(_mean(row["day_ahead_avg_clearing_price"] for row in rows)),
            "intraday_period_avg_price": _round_value(_mean(row["intraday_avg_clearing_price"] for row in rows)),
            "spread_monthly_avg_price": _round_value(_mean(row["spread_avg_clearing_price"] for row in rows)),
            "highest_price_month": highest[0] if highest else None,
            "lowest_price_month": lowest[0] if lowest else None,
        },
    }
