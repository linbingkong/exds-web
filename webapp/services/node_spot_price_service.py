"""节点现货价格数据服务。"""

import logging
import math
from typing import Any, Dict, List, Literal, Optional

from pymongo.database import Database

logger = logging.getLogger(__name__)

NodeSpotPriceType = Literal[
    "real_time",
    "day_ahead",
    "day_ahead_economic",
    "day_ahead_pre_schedule",
]

REAL_TIME_PRICE_TYPE: Literal["real_time"] = "real_time"


def _safe_finite_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None
    return numeric_value if math.isfinite(numeric_value) else None


def _time_label_from_minutes(total_minutes: int) -> str:
    return "24:00" if total_minutes == 1440 else f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _normalize_time_label(value: Any) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if raw == "24:00":
        return raw
    parts = raw.split(":")
    if len(parts) < 2:
        return raw
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return raw
    if hour == 24 and minute == 0:
        return "24:00"
    return f"{hour:02d}:{minute:02d}"


def _load_node_daily_doc(
    db: Database,
    date_str: str,
    node_name: str,
    price_type: NodeSpotPriceType,
) -> Dict[str, Any]:
    collection = db["node_spot_price_daily"]
    query = {
        "price_type": price_type,
        "node_name": node_name,
        "date": date_str,
    }
    doc = collection.find_one(query, {"_id": 0, "points": 1})
    if doc:
        return doc

    if price_type != REAL_TIME_PRICE_TYPE:
        return {}

    legacy_query = {
        "node_name": node_name,
        "date": date_str,
        "price_type": {"$exists": False},
    }
    legacy_doc = collection.find_one(legacy_query, {"_id": 0, "points": 1})
    if legacy_doc:
        logger.warning("使用旧结构节点现货价格数据: node=%s date=%s", node_name, date_str)
        return legacy_doc
    return {}


def _build_direct_15m_price_map(points: List[Dict[str, Any]]) -> Dict[str, float]:
    price_map: Dict[str, float] = {}
    for point in points:
        time_label = _normalize_time_label(point.get("time"))
        price = _safe_finite_float(point.get("cq_price"))
        if time_label and price is not None:
            price_map[time_label] = price
    return price_map


def _build_realtime_15m_price_map(points: List[Dict[str, Any]]) -> Dict[str, float]:
    raw_price_map = _build_direct_15m_price_map(points)
    aggregated_map: Dict[str, float] = {}
    for quarter_index in range(1, 97):
        total_minutes = quarter_index * 15
        quarter_time = _time_label_from_minutes(total_minutes)
        window_times = [
            _time_label_from_minutes(total_minutes - offset)
            for offset in (10, 5, 0)
        ]
        if all(time_key in raw_price_map for time_key in window_times):
            aggregated_map[quarter_time] = round(
                sum(raw_price_map[time_key] for time_key in window_times) / 3,
                6,
            )
    return aggregated_map


def build_node_spot_price_map_96(
    points: List[Dict[str, Any]],
    price_type: NodeSpotPriceType = REAL_TIME_PRICE_TYPE,
) -> Dict[str, float]:
    """生成 15 分钟 96 点映射；实时价先由 5 分钟点聚合。"""
    if not points:
        return {}
    if price_type == REAL_TIME_PRICE_TYPE:
        return _build_realtime_15m_price_map(points)
    return _build_direct_15m_price_map(points)


def load_node_spot_price_map_96(
    db: Database,
    date_str: str,
    node_name: str,
    price_type: NodeSpotPriceType = REAL_TIME_PRICE_TYPE,
) -> Dict[str, float]:
    doc = _load_node_daily_doc(db, date_str, node_name, price_type)
    return build_node_spot_price_map_96(doc.get("points") or [], price_type)


def load_node_spot_price_values_96(
    db: Database,
    date_str: str,
    node_name: str,
    price_type: NodeSpotPriceType = REAL_TIME_PRICE_TYPE,
) -> List[Optional[float]]:
    price_map = load_node_spot_price_map_96(db, date_str, node_name, price_type)
    return [
        price_map.get(_time_label_from_minutes(quarter_index * 15))
        for quarter_index in range(1, 97)
    ]


def load_node_spot_price_values_48(
    db: Database,
    date_str: str,
    node_name: str,
    price_type: NodeSpotPriceType = REAL_TIME_PRICE_TYPE,
) -> List[Optional[float]]:
    values_96 = load_node_spot_price_values_96(db, date_str, node_name, price_type)
    values_48: List[Optional[float]] = []
    for index in range(0, 96, 2):
        first = values_96[index]
        second = values_96[index + 1]
        if first is None or second is None:
            values_48.append(None)
        else:
            values_48.append(round((first + second) / 2, 6))
    return values_48
