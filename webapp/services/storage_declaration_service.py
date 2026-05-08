"""
储能申报策略 Service

职责：
- 电站（storage_stations）CRUD
- 策略（storage_strategies）CRUD
- 申报数据（storage_declarations）生成与保存
- 收益测算（含完整电能量公式）
- 历史复盘（storage_history，初版可用模拟数据回填）
- price_sgcc 当月电费动态读取
- 多种策略算法（按 strategy_type 分发）
"""

from __future__ import annotations

import logging
import math
import random
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymongo.database import Database

from webapp.services.node_spot_price_service import load_node_spot_price_values_96

logger = logging.getLogger(__name__)

# ============ 常量 ============

SLOT_COUNT = 96  # 96 个 15min 时刻点
SLOT_HOURS = 0.25  # 15min = 0.25h
HOUR_COUNT = 24
DEFAULT_FM_PRICE_THRESHOLD = 300.0  # 元/MWh
DEFAULT_INITIAL_SOC = 0.1
DEFAULT_CHARGE_EFFICIENCY = 0.93
DEFAULT_DISCHARGE_EFFICIENCY = 0.93
DEFAULT_MAX_SOC = 0.9
FM_MILEAGE_PRICE_MIN = 6.0
FM_MILEAGE_PRICE_MAX = 15.0
FM_OUTPUT_BASE_LIMIT_RATIO = 0.9
FIXED_TRANSMISSION_DISTRIBUTION_PRICE = 110.5  # 元/MWh，对应 0.1105 元/kWh
SOC_UPPER_GUARD = 1.0  # SOC 风控硬上限：不允许超过 100%
SOC_LOWER_GUARD_DEFAULT = 0.1  # SOC 下限：放电后至少保留 10%
SOC_TOLERANCE = 1e-3  # SOC 越限容差，避免浮点比较误判
MAX_SOC_PARAM_KEY = "max_soc"

STATUS_ENABLED = "启用"
STATUS_DISABLED = "停用"
DECLARE_STATUS_DECLARED = "已申报"
DECLARE_STATUS_PENDING = "未申报"
REVIEW_STATUS_PENDING = "未复盘"
REVIEW_STATUS_COMPLETED = "已复盘"


# ============ 工具方法 ============

def _generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _now() -> datetime:
    """统一获取本地 naive 时间。"""
    return datetime.now()


def _slot_time_label(slot_index: int) -> str:
    """slot_index: 0..95 → "00:15", "00:30", ..., "23:45", "24:00" """
    minutes_total = (slot_index + 1) * 15
    if minutes_total >= 24 * 60:
        return "24:00"
    hour = minutes_total // 60
    minute = minutes_total % 60
    return f"{hour:02d}:{minute:02d}"


def _hour_period_labels(hour: int) -> Tuple[str, str]:
    """整点时段标签，如 hour=0 → ("00:00", "01:00")"""
    start = f"{hour:02d}:00"
    end_hour = hour + 1
    end = "24:00" if end_hour >= 24 else f"{end_hour:02d}:00"
    return start, end


def _hour_index_from_period_end(value: Any) -> Optional[int]:
    """将时段结束点映射为小时索引，如 01:00 → 0，24:00 → 23。"""
    text = str(value or "").strip()
    if not text:
        return None
    parts = text.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
    except (TypeError, ValueError):
        return None
    if minute != 0:
        return min(max(hour, 0), HOUR_COUNT - 1)
    if hour == 0:
        return 0
    return min(max(hour - 1, 0), HOUR_COUNT - 1)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return default
        return result
    except (TypeError, ValueError):
        return default


def _safe_soc_ratio(value: Any, default: float = DEFAULT_MAX_SOC) -> float:
    ratio = _safe_float(value, default)
    if ratio > 1:
        ratio = ratio / 100.0
    return max(SOC_LOWER_GUARD_DEFAULT, min(SOC_UPPER_GUARD, ratio))


def _default_max_soc_param(value: float = DEFAULT_MAX_SOC) -> Dict[str, str]:
    return {
        "param_key": MAX_SOC_PARAM_KEY,
        "param_name": "最高SOC",
        "param_value": f"{_safe_soc_ratio(value, DEFAULT_MAX_SOC) * 100:g}",
        "unit": "%",
        "description": "峰谷套利策略计算充放电功率时使用的目标 SOC 上限。",
    }


def _strategy_max_soc(strategy: Dict[str, Any]) -> float:
    for param in strategy.get("strategy_params") or []:
        if param.get("param_key") == MAX_SOC_PARAM_KEY:
            return _safe_soc_ratio(param.get("param_value"), DEFAULT_MAX_SOC)
    return DEFAULT_MAX_SOC


def _merge_default_strategy_params(params: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    next_params = [dict(param) for param in (params or [])]
    max_soc_index = next((i for i, param in enumerate(next_params) if param.get("param_key") == MAX_SOC_PARAM_KEY), -1)
    if max_soc_index >= 0:
        current = next_params[max_soc_index]
        default_param = _default_max_soc_param(_safe_soc_ratio(current.get("param_value"), DEFAULT_MAX_SOC))
        next_params[max_soc_index] = {
            **default_param,
            **current,
            "param_value": current.get("param_value") or default_param["param_value"],
            "unit": current.get("unit") or default_param["unit"],
            "description": current.get("description") or default_param["description"],
        }
        return next_params
    return [*next_params, _default_max_soc_param()]


def _composition_label_value(row: Any) -> Tuple[str, float]:
    if isinstance(row, dict):
        label = str(row.get("name") or row.get("item") or row.get("label") or "")
        value = row.get("price") or row.get("value") or row.get("amount")
        return label, _safe_float(value, 0)
    if isinstance(row, (list, tuple)) and len(row) >= 2:
        return str(row[0] or ""), _safe_float(row[1], 0)
    return "", 0.0


def _voltage_level_matches(requested: str, candidate: str) -> bool:
    req = str(requested or "").strip()
    cand = str(candidate or "").replace("\n", "").replace(" ", "").strip()
    if not req or not cand:
        return False
    if req == candidate or req in cand:
        return True
    if req.isdigit() and f"{req}千伏" in cand:
        return True
    return False


def _normalize_fm_mileage_price(value: Any) -> float:
    price = _safe_float(value, 0.0)
    if price <= 0:
        return 0.0
    price = max(FM_MILEAGE_PRICE_MIN, min(FM_MILEAGE_PRICE_MAX, price))
    return round(price * 10) / 10


def _default_fm_output_base_mw(station: Dict[str, Any]) -> float:
    fm_power = _safe_float(station.get("fm_power_mw"), 0)
    if fm_power <= 0:
        return 0.0
    return round(fm_power * FM_OUTPUT_BASE_LIMIT_RATIO, 4)


def _station_charge_efficiency(station: Dict[str, Any]) -> float:
    return _safe_float(station.get("charge_efficiency"), _safe_float(station.get("efficiency"), DEFAULT_CHARGE_EFFICIENCY))


def _station_discharge_efficiency(station: Dict[str, Any]) -> float:
    return _safe_float(station.get("discharge_efficiency"), _safe_float(station.get("efficiency"), DEFAULT_DISCHARGE_EFFICIENCY))


def _doc_to_station(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    out = dict(doc)
    out.pop("_id", None)
    legacy_efficiency = _safe_float(out.get("efficiency"), DEFAULT_CHARGE_EFFICIENCY)
    out["charge_efficiency"] = _safe_float(out.get("charge_efficiency"), legacy_efficiency)
    out["discharge_efficiency"] = _safe_float(out.get("discharge_efficiency"), legacy_efficiency)
    for k in ("created_at", "updated_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    return out


def _doc_to_strategy(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    out = dict(doc)
    out.pop("_id", None)
    out["strategy_params"] = _merge_default_strategy_params(out.get("strategy_params") or [])
    for k in ("created_at", "updated_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    return out


def _doc_to_declaration(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    out = dict(doc)
    out.pop("_id", None)
    for k in ("forecast_date", "generated_at", "submitted_at", "settled_at", "review_simulated_at", "created_at", "updated_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    return out


# ============ Service ============


class StorageDeclarationService:
    """储能申报策略服务层。"""

    def __init__(self, db: Database) -> None:
        self.db = db
        self.stations = db.storage_stations
        self.strategies = db.storage_strategies
        self.declarations = db.storage_declarations
        self.history = db.storage_history
        self.price_sgcc = db.price_sgcc
        self.price_forecast = db.price_forecast_results
        self.real_time_spot_price = db.real_time_spot_price
        self.frequency_regulation_clearing = db.frequency_regulation_clearing
        self.frequency_regulation_demand = db.frequency_regulation_demand
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        try:
            for coll, indexes in [
                (
                    self.stations,
                    [
                        ([("station_id", 1)], {"name": "idx_unique_station_id", "unique": True}),
                        ([("status", 1)], {"name": "idx_status"}),
                        ([("status", 1), ("created_at", -1)], {"name": "idx_status_created_at"}),
                    ],
                ),
                (
                    self.strategies,
                    [
                        ([("strategy_id", 1)], {"name": "idx_unique_strategy_id", "unique": True}),
                        ([("station_id", 1)], {"name": "idx_station_id"}),
                        ([("strategy_status", 1)], {"name": "idx_strategy_status"}),
                        ([("station_id", 1), ("strategy_status", 1), ("created_at", -1)], {"name": "idx_station_status_created_at"}),
                    ],
                ),
                (
                    self.declarations,
                    [
                        ([("declaration_id", 1)], {"name": "idx_unique_declaration_id", "unique": True}),
                        ([("declaration_key", 1)], {"name": "idx_unique_declaration_key", "unique": True}),
                        ([("strategy_id", 1), ("target_date", 1)], {"name": "idx_unique_strategy_target_date", "unique": True}),
                        ([("station_id", 1), ("target_date", 1)], {"name": "idx_station_target_date"}),
                        ([("strategy_id", 1)], {"name": "idx_strategy_id"}),
                        ([("status", 1), ("target_date", 1)], {"name": "idx_status_target_date"}),
                        ([("station_id", 1), ("target_date", 1), ("updated_at", -1)], {"name": "idx_station_target_updated_at"}),
                        ([("station_id", 1), ("strategy_id", 1), ("review_status", 1), ("target_date", 1)], {"name": "idx_station_strategy_review_target"}),
                        ([("review_status", 1), ("target_date", 1)], {"name": "idx_review_status_target_date"}),
                    ],
                ),
                (
                    self.history,
                    [
                        ([("history_id", 1)], {"name": "idx_unique_history_id", "unique": True}),
                        ([("station_id", 1), ("date", 1)], {"name": "idx_station_date_history"}),
                    ],
                ),
                (
                    self.price_forecast,
                    [
                        ([("target_date", 1), ("forecast_type", 1), ("created_at", -1)], {"name": "idx_target_type_created_at"}),
                        ([("target_date", 1), ("forecast_type", 1), ("forecast_id", 1), ("datetime", 1)], {"name": "idx_target_type_forecast_datetime"}),
                        ([("forecast_type", 1), ("target_date", 1)], {"name": "idx_forecast_type_target_date"}),
                    ],
                ),
                (
                    self.frequency_regulation_clearing,
                    [
                        ([("market_type", 1), ("date_str", 1), ("time_str", 1)], {"name": "idx_market_date_time"}),
                        ([("date_str", -1)], {"name": "idx_date_str_desc"}),
                    ],
                ),
                (
                    self.frequency_regulation_demand,
                    [
                        ([("market_type", 1), ("date_str", 1), ("time_str", 1)], {"name": "idx_market_date_time"}),
                    ],
                ),
            ]:
                existing = {idx.get("name") for idx in coll.list_indexes()}
                for keys, options in indexes:
                    if options["name"] not in existing:
                        coll.create_index(keys, **options)
                        logger.info(f"创建索引: {coll.name}.{options['name']}")
        except Exception as e:
            logger.warning(f"创建储能申报相关索引失败: {e}")

    # ============ 电站 CRUD ============

    def list_stations(self) -> List[Dict[str, Any]]:
        cursor = self.stations.find().sort([("status", 1), ("created_at", -1)])
        return [_doc_to_station(doc) for doc in cursor]

    def get_station(self, station_id: str) -> Dict[str, Any]:
        doc = self.stations.find_one({"station_id": station_id})
        if not doc:
            raise ValueError(f"电站不存在: {station_id}")
        return _doc_to_station(doc)

    def create_station(self, payload: Dict[str, Any], operator: str) -> Dict[str, Any]:
        name = (payload.get("station_name") or "").strip()
        if not name:
            raise ValueError("电站名称不能为空")
        if self.stations.find_one({"station_name": name}):
            raise ValueError(f"电站名称已存在: {name}")

        now = _now()
        station_id = _generate_id("st")
        doc = {
            "station_id": station_id,
            "station_name": name,
            "control_unit_name": (payload.get("control_unit_name") or "").strip(),
            "node_name": (payload.get("node_name") or "").strip(),
            "voltage_level": (payload.get("voltage_level") or "").strip(),
            "rated_power_mw": _safe_float(payload.get("rated_power_mw"), 0),
            "rated_capacity_mwh": _safe_float(payload.get("rated_capacity_mwh"), 0),
            "is_hybrid": bool(payload.get("is_hybrid", False)),
            "fm_power_mw": _safe_float(payload.get("fm_power_mw"), 0),
            "fm_capacity_mwh": _safe_float(payload.get("fm_capacity_mwh"), 0),
            "charge_efficiency": _safe_float(payload.get("charge_efficiency"), _safe_float(payload.get("efficiency"), DEFAULT_CHARGE_EFFICIENCY)),
            "discharge_efficiency": _safe_float(payload.get("discharge_efficiency"), _safe_float(payload.get("efficiency"), DEFAULT_DISCHARGE_EFFICIENCY)),
            "discharge_depth": _safe_float(payload.get("discharge_depth"), 0.9),
            "fm_k_value": _safe_float(payload.get("fm_k_value"), 1.0),
            "default_mileage_beta": _safe_float(payload.get("default_mileage_beta"), 1.0),
            "default_soc": _safe_float(payload.get("default_soc"), DEFAULT_INITIAL_SOC),
            "degradation_cost_per_mwh": _safe_float(payload.get("degradation_cost_per_mwh"), 0),
            "status": payload.get("status") if payload.get("status") in (STATUS_ENABLED, STATUS_DISABLED) else STATUS_ENABLED,
            "created_at": now,
            "updated_at": now,
            "created_by": operator,
            "updated_by": operator,
        }
        self.stations.insert_one(doc)
        return _doc_to_station(doc)

    def update_station(self, station_id: str, payload: Dict[str, Any], operator: str) -> Dict[str, Any]:
        doc = self.stations.find_one({"station_id": station_id})
        if not doc:
            raise ValueError(f"电站不存在: {station_id}")

        update: Dict[str, Any] = {}
        # 字符串字段
        for k in ("station_name", "control_unit_name", "node_name", "voltage_level"):
            if k in payload:
                update[k] = (payload.get(k) or "").strip()
        # 数值字段
        for k in (
            "rated_power_mw", "rated_capacity_mwh", "fm_power_mw", "fm_capacity_mwh",
            "charge_efficiency", "discharge_efficiency", "discharge_depth", "fm_k_value", "default_mileage_beta",
            "default_soc", "degradation_cost_per_mwh",
        ):
            if k in payload:
                update[k] = _safe_float(payload.get(k), doc.get(k, 0))
        if "efficiency" in payload and "charge_efficiency" not in payload and "discharge_efficiency" not in payload:
            legacy_efficiency = _safe_float(payload.get("efficiency"), DEFAULT_CHARGE_EFFICIENCY)
            update["charge_efficiency"] = legacy_efficiency
            update["discharge_efficiency"] = legacy_efficiency
        if "is_hybrid" in payload:
            update["is_hybrid"] = bool(payload.get("is_hybrid"))
        if "status" in payload and payload.get("status") in (STATUS_ENABLED, STATUS_DISABLED):
            update["status"] = payload["status"]
        if "station_name" in update and update["station_name"] != doc.get("station_name"):
            existing = self.stations.find_one({"station_name": update["station_name"], "station_id": {"$ne": station_id}})
            if existing:
                raise ValueError(f"电站名称已存在: {update['station_name']}")
        update["updated_at"] = _now()
        update["updated_by"] = operator
        self.stations.update_one({"station_id": station_id}, {"$set": update})
        return self.get_station(station_id)

    def set_station_status(self, station_id: str, status: str, operator: str) -> Dict[str, Any]:
        if status not in (STATUS_ENABLED, STATUS_DISABLED):
            raise ValueError(f"非法状态值: {status}")
        result = self.stations.update_one(
            {"station_id": station_id},
            {"$set": {"status": status, "updated_at": _now(), "updated_by": operator}},
        )
        if result.matched_count == 0:
            raise ValueError(f"电站不存在: {station_id}")
        return self.get_station(station_id)

    def delete_station(self, station_id: str) -> None:
        if not self.stations.find_one({"station_id": station_id}):
            raise ValueError(f"电站不存在: {station_id}")
        # 级联删除相关策略与申报
        self.strategies.delete_many({"station_id": station_id})
        self.declarations.delete_many({"station_id": station_id})
        self.history.delete_many({"station_id": station_id})
        self.stations.delete_one({"station_id": station_id})

    # ============ 策略 CRUD ============

    def list_strategies(self, station_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if station_id:
            query["station_id"] = station_id
        cursor = self.strategies.find(query).sort([("strategy_status", 1), ("created_at", -1)])
        items: List[Dict[str, Any]] = []
        for doc in cursor:
            item = _doc_to_strategy(doc)
            # 附加申报状态（针对次日的申报状态）
            tomorrow = (_now() + timedelta(days=1)).strftime("%Y-%m-%d")
            decl = self.declarations.find_one({
                "strategy_id": item.get("strategy_id"),
                "target_date": tomorrow,
            })
            item["next_day_declare_status"] = (
                DECLARE_STATUS_DECLARED if decl and decl.get("declare_status") == DECLARE_STATUS_DECLARED
                else DECLARE_STATUS_PENDING
            )
            items.append(item)
        return items

    def get_strategy(self, strategy_id: str) -> Dict[str, Any]:
        doc = self.strategies.find_one({"strategy_id": strategy_id})
        if not doc:
            raise ValueError(f"策略不存在: {strategy_id}")
        return _doc_to_strategy(doc)

    def create_strategy(self, payload: Dict[str, Any], operator: str) -> Dict[str, Any]:
        station_id = (payload.get("station_id") or "").strip()
        if not station_id:
            raise ValueError("策略必须关联电站")
        if not self.stations.find_one({"station_id": station_id}):
            raise ValueError(f"电站不存在: {station_id}")

        name = (payload.get("strategy_name") or "").strip()
        if not name:
            raise ValueError("策略名称不能为空")

        now = _now()
        strategy_id = _generate_id("sg")
        params = payload.get("strategy_params") or []
        norm_params = _merge_default_strategy_params([self._normalize_param(p) for p in params])

        doc = {
            "strategy_id": strategy_id,
            "station_id": station_id,
            "strategy_name": name,
            "strategy_type": (payload.get("strategy_type") or "simple_peak_valley").strip(),
            "strategy_status": payload.get("strategy_status") if payload.get("strategy_status") in (STATUS_ENABLED, STATUS_DISABLED) else STATUS_ENABLED,
            "fm_price_threshold": _safe_float(payload.get("fm_price_threshold"), DEFAULT_FM_PRICE_THRESHOLD),
            "description": (payload.get("description") or "").strip(),
            "strategy_params": norm_params,
            "created_at": now,
            "updated_at": now,
            "created_by": operator,
            "updated_by": operator,
        }
        self.strategies.insert_one(doc)
        return _doc_to_strategy(doc)

    def update_strategy(self, strategy_id: str, payload: Dict[str, Any], operator: str) -> Dict[str, Any]:
        doc = self.strategies.find_one({"strategy_id": strategy_id})
        if not doc:
            raise ValueError(f"策略不存在: {strategy_id}")

        update: Dict[str, Any] = {}
        if "strategy_name" in payload:
            update["strategy_name"] = (payload.get("strategy_name") or "").strip() or doc.get("strategy_name")
        if "strategy_type" in payload:
            update["strategy_type"] = (payload.get("strategy_type") or "").strip() or doc.get("strategy_type")
        if "strategy_status" in payload and payload.get("strategy_status") in (STATUS_ENABLED, STATUS_DISABLED):
            update["strategy_status"] = payload["strategy_status"]
        if "description" in payload:
            update["description"] = (payload.get("description") or "").strip()
        if "fm_price_threshold" in payload:
            update["fm_price_threshold"] = _safe_float(payload.get("fm_price_threshold"), doc.get("fm_price_threshold", DEFAULT_FM_PRICE_THRESHOLD))
        if "strategy_params" in payload:
            update["strategy_params"] = _merge_default_strategy_params([self._normalize_param(p) for p in (payload.get("strategy_params") or [])])
        update["updated_at"] = _now()
        update["updated_by"] = operator
        self.strategies.update_one({"strategy_id": strategy_id}, {"$set": update})
        return self.get_strategy(strategy_id)

    def set_strategy_status(self, strategy_id: str, status: str, operator: str) -> Dict[str, Any]:
        if status not in (STATUS_ENABLED, STATUS_DISABLED):
            raise ValueError(f"非法状态值: {status}")
        result = self.strategies.update_one(
            {"strategy_id": strategy_id},
            {"$set": {"strategy_status": status, "updated_at": _now(), "updated_by": operator}},
        )
        if result.matched_count == 0:
            raise ValueError(f"策略不存在: {strategy_id}")
        return self.get_strategy(strategy_id)

    def delete_strategy(self, strategy_id: str) -> None:
        if not self.strategies.find_one({"strategy_id": strategy_id}):
            raise ValueError(f"策略不存在: {strategy_id}")
        self.declarations.delete_many({"strategy_id": strategy_id})
        self.strategies.delete_one({"strategy_id": strategy_id})

    @staticmethod
    def _normalize_param(p: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "param_key": (p.get("param_key") or "").strip(),
            "param_name": (p.get("param_name") or "").strip(),
            "param_value": (p.get("param_value") or "").strip() if isinstance(p.get("param_value"), str) else str(p.get("param_value") or ""),
            "unit": (p.get("unit") or "").strip(),
            "description": (p.get("description") or "").strip(),
        }

    @staticmethod
    def _strategy_fm_price_threshold(strategy: Dict[str, Any]) -> float:
        for param in strategy.get("strategy_params") or []:
            if param.get("param_key") == "fm_price_threshold":
                return _safe_float(param.get("param_value"), DEFAULT_FM_PRICE_THRESHOLD)
        return _safe_float(strategy.get("fm_price_threshold"), DEFAULT_FM_PRICE_THRESHOLD)

    @staticmethod
    def _strategy_max_soc(strategy: Dict[str, Any]) -> float:
        return _strategy_max_soc(strategy)

    # ============ 价格读取 ============

    def _get_price_forecast_results_96(self, target_dt: datetime, forecast_type: str) -> Optional[List[float]]:
        latest = self.price_forecast.find_one(
            {"target_date": target_dt, "forecast_type": forecast_type},
            sort=[("created_at", -1)],
        )
        if not latest:
            return None
        forecast_id = latest.get("forecast_id")
        cursor = self.price_forecast.find(
            {"target_date": target_dt, "forecast_type": forecast_type, "forecast_id": forecast_id},
            {"_id": 0, "datetime": 1, "predicted_price": 1},
        ).sort("datetime", 1)
        prices: Dict[str, float] = {}
        next_day = target_dt + timedelta(days=1)
        for doc in cursor:
            dt = doc.get("datetime")
            if not isinstance(dt, datetime):
                continue
            # 96 点：00:15..23:45 + 24:00（即次日 00:00）
            if dt.date() == target_dt.date():
                label = dt.strftime("%H:%M")
            elif dt.date() == next_day.date() and dt.hour == 0 and dt.minute == 0:
                label = "24:00"
            else:
                continue
            prices[label] = _safe_float(doc.get("predicted_price"), 0)
        if not prices:
            return None
        return [prices.get(_slot_time_label(i), 0.0) for i in range(SLOT_COUNT)]

    def get_price_forecast_96(self, target_date: str, node_name: str = "") -> List[float]:
        """读取目标日期 96 点 LMP 预测，优先使用节点日前预出清曲线，缺失时回退统一预测。"""
        if node_name:
            try:
                node_values = load_node_spot_price_values_96(
                    self.db,
                    target_date,
                    node_name,
                    price_type="day_ahead_pre_schedule",
                )
                node_prices = [float(value) if value is not None else 0.0 for value in node_values]
                if len(node_prices) >= SLOT_COUNT and any(value != 0 for value in node_prices):
                    return node_prices[:SLOT_COUNT]
            except Exception as e:
                logger.warning(f"读取节点日前预出清价格失败: {e}")

        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError as e:
            raise ValueError(f"日期格式错误: {target_date}") from e

        for forecast_type in ("d1_price_unified", "d1_price"):
            result = self._get_price_forecast_results_96(target_dt, forecast_type)
            if result and any(value != 0 for value in result):
                return result
        return [0.0] * SLOT_COUNT

    def list_forecast_available_dates(self, station_id: Optional[str] = None) -> List[str]:
        """列出模拟申报可切换的价格预测日期。"""
        node_name = ""
        if station_id:
            try:
                station = self.get_station(station_id)
                node_name = station.get("node_name") or ""
            except ValueError:
                node_name = ""

        dates = set()
        if node_name:
            cursor = self.db.node_spot_price_daily.find(
                {"price_type": "day_ahead_pre_schedule", "node_name": node_name},
                {"_id": 0, "date": 1},
            )
            for doc in cursor:
                date_value = doc.get("date")
                if date_value:
                    dates.add(str(date_value)[:10])

        cursor = self.price_forecast.find(
            {"forecast_type": "d1_price_unified"},
            {"_id": 0, "target_date": 1},
        )
        for doc in cursor:
            target_date = doc.get("target_date")
            if isinstance(target_date, datetime):
                dates.add(target_date.strftime("%Y-%m-%d"))
            elif target_date:
                dates.add(str(target_date)[:10])
        return sorted(dates)

    def get_grid_surcharge(self, voltage_level: str, month: str) -> Dict[str, float]:
        """读取 price_sgcc 当月 5 项电费参数（输出单位：元/MWh）。"""
        doc = self.price_sgcc.find_one({"_id": month})
        if not doc:
            # 兜底：找最近月份
            doc = self.price_sgcc.find_one({}, sort=[("_id", -1)])
            if not doc:
                logger.warning(f"price_sgcc 无数据，使用零值兜底")
                return {
                    "transmission_distribution_price": 0.0,
                    "government_fund": 0.0,
                    "network_loss_price": 0.0,
                    "system_op_cost_discount": 0.0,
                    "peak_valley_bonus": 0.0,
                }
            logger.warning(f"price_sgcc 缺失 {month} 数据，使用 {doc.get('_id')} 兜底")

        full_data = doc.get("full_data") or {}
        rate_rows = full_data.get("price_rates") or []
        rate_row: Dict[str, Any] = {}
        if voltage_level:
            for row in rate_rows:
                if _voltage_level_matches(voltage_level, str(row.get("voltage_level") or "")):
                    rate_row = row
                    break
        # 峰谷损益折价：从 price_composition 中提取
        peak_valley = 0.0
        for row in (full_data.get("price_composition") or []):
            label, value = _composition_label_value(row)
            if "峰谷" in label and "损益" in label:
                peak_valley = value
                break

        return {
            "transmission_distribution_price": FIXED_TRANSMISSION_DISTRIBUTION_PRICE,
            "government_fund": _safe_float(rate_row.get("government_fund"), 0) * 1000,
            "network_loss_price": _safe_float(rate_row.get("network_loss_price", doc.get("network_loss_price")), 0) * 1000,
            "system_op_cost_discount": _safe_float(rate_row.get("system_op_cost_discount", doc.get("system_op_cost_discount")), 0) * 1000,
            "peak_valley_bonus": peak_valley * 1000,
        }

    @staticmethod
    def _charge_price(market_price: float, grid: Dict[str, float]) -> float:
        return (
            market_price
            + grid.get("network_loss_price", 0)
            + grid.get("system_op_cost_discount", 0)
            - grid.get("peak_valley_bonus", 0)
        )

    @staticmethod
    def _loss_price(charge_price: float, grid: Dict[str, float]) -> float:
        return (
            charge_price
            + grid.get("transmission_distribution_price", 0)
            + grid.get("government_fund", 0)
        )

    # ============ SOC 推演 ============

    @staticmethod
    def simulate_soc(
        slots: List[Dict[str, Any]],
        capacity_mwh: float,
        charge_efficiency: float,
        discharge_efficiency: float,
        soc_initial: float,
    ) -> List[float]:
        """根据 96 点出力序列推演期末 SOC（0~1）。

        充电：SOC += P × 充电效率 × dt / cap
        放电：SOC -= P × dt / (cap × 放电效率)
        """
        socs: List[float] = []
        soc = soc_initial
        charge_eff = max(charge_efficiency, 1e-6)
        discharge_eff = max(discharge_efficiency, 1e-6)
        cap = max(capacity_mwh, 1e-6)
        for s in slots:
            power = _safe_float(s.get("power_mw"), 0)
            if power > 0:  # 放电
                soc -= (power * SLOT_HOURS) / (cap * discharge_eff)
            elif power < 0:  # 充电
                soc += (abs(power) * charge_eff * SLOT_HOURS) / cap
            soc = max(0.0, min(1.0, soc))
            socs.append(round(soc, 6))
        return socs

    # ============ 策略算法分发 ============

    def generate_declaration(
        self,
        station_id: str,
        strategy_id: str,
        target_date: str,
        soc_initial_override: Optional[float] = None,
        threshold_override: Optional[float] = None,
    ) -> Dict[str, Any]:
        station = self.get_station(station_id)
        strategy = self.get_strategy(strategy_id)
        lmp_forecast = self.get_price_forecast_96(target_date, station.get("node_name") or "")
        soc_initial = soc_initial_override if soc_initial_override is not None else _safe_float(station.get("default_soc"), DEFAULT_INITIAL_SOC)
        threshold = threshold_override if threshold_override is not None else self._strategy_fm_price_threshold(strategy)

        strategy_type = (strategy.get("strategy_type") or "simple_peak_valley").strip()
        algorithm = ALGORITHM_MAP.get(strategy_type, generate_simple_peak_valley)
        result = algorithm(
            station=station,
            strategy=strategy,
            lmp_forecast=lmp_forecast,
            soc_initial=soc_initial,
            threshold=threshold,
        )
        fallback_fm_price = _normalize_fm_mileage_price(threshold * 0.6 if threshold > 0 else 0.0)
        fm_price_forecast, fm_price_basis = self._recommended_fm_mileage_prices_24(target_date, fallback_fm_price)
        fm_declaration = result.get("fm_declaration") or []
        fm_output_base_mw = _default_fm_output_base_mw(station)
        for hour, row in enumerate(fm_declaration[:HOUR_COUNT]):
            if _safe_float(row.get("mileage_price"), 0) > 0:
                row["output_base_mw"] = _safe_float(row.get("output_base_mw"), fm_output_base_mw) or fm_output_base_mw
                row["mileage_price"] = _normalize_fm_mileage_price(fm_price_forecast[hour]) if row["output_base_mw"] > 0 else 0.0
        result["fm_price_forecast_24"] = fm_price_forecast
        result["fm_price_basis"] = fm_price_basis
        result["generation_message"] = "已生成峰谷套利策略" if result.get("arbitrage_executed") else "未达价差阈值，已退回全天调频策略"
        result["spot_price_forecast"] = lmp_forecast
        result["forecast_revenue"] = self.calculate_revenue(
            station_id=station_id,
            target_date=target_date,
            energy_declaration=result.get("energy_declaration") or [],
            fm_declaration=result.get("fm_declaration") or [],
            prices_96=lmp_forecast,
        )
        result["target_date"] = target_date
        return result

    def auto_generate_declarations(
        self,
        target_date: str,
        operator: str = "system",
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """自动生成目标日储能申报数据。"""
        enabled_stations = {
            doc.get("station_id"): _doc_to_station(doc)
            for doc in self.stations.find({"status": STATUS_ENABLED})
            if doc.get("station_id")
        }
        result: Dict[str, Any] = {
            "target_date": target_date,
            "generated_count": 0,
            "skipped_count": 0,
            "blocked_count": 0,
            "error_count": 0,
            "generated": [],
            "skipped": [],
            "blocked": [],
            "errors": [],
        }
        if not enabled_stations:
            result["blocked"].append({"reason": "无启用电站"})
            result["blocked_count"] = 1
            return result

        price_ready_by_station: Dict[str, bool] = {}
        for station_id, station in enabled_stations.items():
            prices = self.get_price_forecast_96(target_date, station.get("node_name") or "")
            price_ready_by_station[station_id] = any(_safe_float(value, 0) != 0 for value in prices)

        strategies = list(self.strategies.find({"strategy_status": STATUS_ENABLED}).sort([("station_id", 1), ("created_at", -1)]))
        if not strategies:
            result["blocked"].append({"reason": "无启用策略"})
            result["blocked_count"] = 1
            return result

        for strategy_doc in strategies:
            strategy = _doc_to_strategy(strategy_doc)
            strategy_id = strategy.get("strategy_id") or ""
            station_id = strategy.get("station_id") or ""
            station = enabled_stations.get(station_id)
            if not station:
                result["blocked"].append({
                    "strategy_id": strategy_id,
                    "strategy_name": strategy.get("strategy_name"),
                    "reason": "关联电站未启用或不存在",
                })
                continue
            if not price_ready_by_station.get(station_id, False):
                result["blocked"].append({
                    "station_id": station_id,
                    "station_name": station.get("station_name"),
                    "strategy_id": strategy_id,
                    "strategy_name": strategy.get("strategy_name"),
                    "reason": "目标日预测价格未生成",
                })
                continue
            existing = self.declarations.find_one({"strategy_id": strategy_id, "target_date": target_date})
            if existing and not overwrite:
                result["skipped"].append({
                    "strategy_id": strategy_id,
                    "strategy_name": strategy.get("strategy_name"),
                    "declaration_id": existing.get("declaration_id"),
                    "reason": "目标日申报已存在",
                })
                continue
            try:
                generated = self.generate_declaration(
                    station_id=station_id,
                    strategy_id=strategy_id,
                    target_date=target_date,
                )
                violations = validate_declaration(
                    station=station,
                    energy_declaration=generated.get("energy_declaration") or [],
                    fm_declaration=generated.get("fm_declaration") or [],
                    soc_trajectory=generated.get("soc_trajectory") or [],
                )
                if violations:
                    result["blocked"].append({
                        "station_id": station_id,
                        "station_name": station.get("station_name"),
                        "strategy_id": strategy_id,
                        "strategy_name": strategy.get("strategy_name"),
                        "reason": "风控校验未通过",
                        "violations": violations,
                    })
                    continue
                generated["violations"] = []
                saved = self.save_declaration(
                    station_id=station_id,
                    strategy_id=strategy_id,
                    target_date=target_date,
                    energy_declaration=generated.get("energy_declaration") or [],
                    fm_declaration=generated.get("fm_declaration") or [],
                    soc_trajectory=generated.get("soc_trajectory") or [],
                    spot_price_forecast=generated.get("spot_price_forecast") or [],
                    params_snapshot={
                        "auto_generated": True,
                        "operator": operator,
                        "target_date": target_date,
                    },
                    declare_status=DECLARE_STATUS_PENDING,
                    operator=operator,
                    result_meta=generated,
                )
                result["generated"].append({
                    "station_id": station_id,
                    "station_name": station.get("station_name"),
                    "strategy_id": strategy_id,
                    "strategy_name": strategy.get("strategy_name"),
                    "declaration_id": saved.get("declaration_id"),
                    "generation_message": saved.get("generation_message"),
                })
            except Exception as exc:
                logger.error("储能申报自动生成失败 strategy_id=%s target_date=%s: %s", strategy_id, target_date, exc, exc_info=True)
                result["errors"].append({
                    "station_id": station_id,
                    "strategy_id": strategy_id,
                    "strategy_name": strategy.get("strategy_name"),
                    "message": str(exc),
                })

        result["generated_count"] = len(result["generated"])
        result["skipped_count"] = len(result["skipped"])
        result["blocked_count"] = len(result["blocked"])
        result["error_count"] = len(result["errors"])
        return result

    # ============ 申报数据保存 ============

    def save_declaration(
        self,
        station_id: str,
        strategy_id: str,
        target_date: str,
        energy_declaration: List[Dict[str, Any]],
        fm_declaration: List[Dict[str, Any]],
        soc_trajectory: List[float],
        spot_price_forecast: List[float],
        params_snapshot: Dict[str, Any],
        declare_status: str,
        operator: str,
        result_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if declare_status not in (DECLARE_STATUS_DECLARED, DECLARE_STATUS_PENDING):
            raise ValueError(f"非法申报状态: {declare_status}")

        station = self.get_station(station_id)
        strategy = self.get_strategy(strategy_id)
        if strategy.get("station_id") != station_id:
            raise ValueError("策略与电站不匹配")

        declaration_key = f"{strategy_id}_{target_date.replace('-', '')}"
        status_value = "submitted" if declare_status == DECLARE_STATUS_DECLARED else "created"
        energy_declaration_96 = [round(_safe_float(row.get("power_mw"), 0), 6) for row in energy_declaration]
        normalized_fm_slots = []
        for row in fm_declaration[:HOUR_COUNT]:
            normalized_fm_slots.append({
                **row,
                "mileage_price": _normalize_fm_mileage_price(row.get("mileage_price")),
                "output_base_mw": round(_safe_float(row.get("output_base_mw"), 0), 6),
            })
        fm_declaration_24 = [round(_safe_float(row.get("mileage_price"), 0), 6) for row in normalized_fm_slots]
        fm_output_base_24 = [round(_safe_float(row.get("output_base_mw"), 0), 6) for row in normalized_fm_slots]
        total_charge_mwh = sum(abs(value) * SLOT_HOURS for value in energy_declaration_96 if value < 0)
        total_discharge_mwh = sum(value * SLOT_HOURS for value in energy_declaration_96 if value > 0)
        fm_hours = sum(1 for value in fm_declaration_24 if value > 0)
        result_meta = result_meta or {}
        forecast_revenue = self.calculate_revenue(
            station_id=station_id,
            target_date=target_date,
            energy_declaration=energy_declaration,
            fm_declaration=normalized_fm_slots,
            prices_96=spot_price_forecast,
        )
        result_meta["forecast_revenue"] = forecast_revenue

        existing = self.declarations.find_one({
            "strategy_id": strategy_id,
            "target_date": target_date,
        })
        now = _now()
        base_doc = {
            "declaration_key": declaration_key,
            "station_id": station_id,
            "station_name": station.get("station_name", ""),
            "strategy_id": strategy_id,
            "strategy_name": strategy.get("strategy_name", ""),
            "strategy_type": strategy.get("strategy_type", ""),
            "target_date": target_date,
            "status": status_value,
            "declare_status": declare_status,
            "forecast_date": now,
            "generated_at": now,
            "submitted_at": now if declare_status == DECLARE_STATUS_DECLARED else None,
            "energy_declaration_96": energy_declaration_96,
            "fm_declaration_24": fm_declaration_24,
            "fm_output_base_24": fm_output_base_24,
            "energy_slots_96": energy_declaration,
            "fm_slots_24": normalized_fm_slots,
            "soc_trajectory_96": soc_trajectory,
            "spot_price_forecast_96": spot_price_forecast,
            "arbitrage_executed": bool(result_meta.get("arbitrage_executed", False)),
            "charge_hours": result_meta.get("charge_hours") or [],
            "discharge_hours": result_meta.get("discharge_hours") or [],
            "p_charge_mw": _safe_float(result_meta.get("p_charge_mw"), 0),
            "p_discharge_mw": _safe_float(result_meta.get("p_discharge_mw"), 0),
            "max_soc": _safe_float(result_meta.get("max_soc"), self._strategy_max_soc(strategy)),
            "violations": result_meta.get("violations") or [],
            "generation_message": result_meta.get("generation_message") or "",
            "forecast_revenue": result_meta.get("forecast_revenue") or {},
            "total_charge_mwh": round(total_charge_mwh, 4),
            "total_discharge_mwh": round(total_discharge_mwh, 4),
            "fm_hours": fm_hours,
            "review_status": REVIEW_STATUS_PENDING,
            "station_snapshot": {
                "station_id": station_id,
                "station_name": station.get("station_name", ""),
                "rated_power_mw": station.get("rated_power_mw"),
                "rated_capacity_mwh": station.get("rated_capacity_mwh"),
                "fm_power_mw": station.get("fm_power_mw"),
                "fm_capacity_mwh": station.get("fm_capacity_mwh"),
                "charge_efficiency": _station_charge_efficiency(station),
                "discharge_efficiency": _station_discharge_efficiency(station),
                "discharge_depth": station.get("discharge_depth"),
                "default_soc": station.get("default_soc"),
            },
            "strategy_snapshot": {
                "strategy_id": strategy_id,
                "strategy_name": strategy.get("strategy_name", ""),
                "strategy_type": strategy.get("strategy_type", ""),
                "strategy_params": strategy.get("strategy_params") or [],
                "fm_price_threshold": self._strategy_fm_price_threshold(strategy),
                "max_soc": self._strategy_max_soc(strategy),
            },
            "params_snapshot": params_snapshot,
            "updated_at": now,
            "updated_by": operator,
        }
        if existing:
            doc = dict(base_doc)
            self.declarations.update_one({"declaration_id": existing["declaration_id"]}, {"$set": doc})
            return _doc_to_declaration(self.declarations.find_one({"declaration_id": existing["declaration_id"]}))

        declaration_id = _generate_id("dc")
        doc = {
            "declaration_id": declaration_id,
            **base_doc,
            "created_at": now,
            "created_by": operator,
        }
        self.declarations.insert_one(doc)
        return _doc_to_declaration(doc)

    def get_declaration(self, station_id: str, target_date: str, strategy_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        query: Dict[str, Any] = {"station_id": station_id, "target_date": target_date}
        if strategy_id:
            query["strategy_id"] = strategy_id
        doc = self.declarations.find_one(query, sort=[("updated_at", -1)])
        if not doc:
            return None
        out = _doc_to_declaration(doc)
        try:
            station = self.get_station(station_id)
            out["review_readiness"] = self._get_review_readiness(station, target_date)
        except Exception as e:
            logger.warning(f"检查复盘数据完整性失败: {e}")
            out["review_readiness"] = {
                "can_review": False,
                "message": "复盘数据完整性检查失败",
                "node_realtime_points": 0,
                "fm_intraday_hours": 0,
            }
        return out

    def get_profit_analysis(
        self,
        station_id: str,
        strategy_id: str,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        """按已复盘申报记录统计储能策略收益。"""
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            raise ValueError("日期格式应为 YYYY-MM-DD")
        if start_dt > end_dt:
            raise ValueError("开始日期不能晚于结束日期")

        if not self.stations.find_one({"station_id": station_id}):
            raise ValueError(f"电站不存在: {station_id}")
        strategy = self.get_strategy(strategy_id)
        if strategy.get("station_id") != station_id:
            raise ValueError("策略与电站不匹配")

        query = {
            "station_id": station_id,
            "strategy_id": strategy_id,
            "target_date": {"$gte": start_date, "$lte": end_date},
            "review_status": REVIEW_STATUS_COMPLETED,
            "review_metrics": {"$exists": True},
        }
        cursor = self.declarations.find(query, {"_id": 0}).sort("target_date", 1)
        rows: List[Dict[str, Any]] = []
        cumulative_revenue = 0.0
        cumulative_energy_revenue = 0.0
        cumulative_fm_revenue = 0.0
        totals = {
            "total_revenue": 0.0,
            "energy_revenue": 0.0,
            "fm_revenue": 0.0,
            "charge_mwh": 0.0,
            "discharge_mwh": 0.0,
            "loss_mwh": 0.0,
            "winning_hours": 0.0,
            "fm_mileage": 0.0,
            "fm_revenue_per_winning_hour": 0.0,
        }
        clearing_weighted_sum = 0.0

        for declaration in cursor:
            metrics = declaration.get("review_metrics") or {}
            total_revenue = _safe_float(metrics.get("total_revenue"), 0)
            energy_revenue = _safe_float(metrics.get("energy_revenue"), 0)
            fm_revenue = _safe_float(metrics.get("fm_revenue"), 0)
            charge_mwh = _safe_float(metrics.get("charge_mwh"), 0)
            discharge_mwh = _safe_float(metrics.get("discharge_mwh"), 0)
            loss_mwh = _safe_float(metrics.get("loss_mwh"), 0)
            winning_hours = _safe_float(metrics.get("winning_hours"), 0)
            fm_mileage = _safe_float(metrics.get("fm_mileage"), 0)
            avg_clearing_price = _safe_float(metrics.get("avg_clearing_price"), 0)
            fm_period_revenue = fm_revenue / winning_hours if winning_hours > 0 else 0.0

            cumulative_revenue += total_revenue
            cumulative_energy_revenue += energy_revenue
            cumulative_fm_revenue += fm_revenue
            totals["total_revenue"] += total_revenue
            totals["energy_revenue"] += energy_revenue
            totals["fm_revenue"] += fm_revenue
            totals["charge_mwh"] += charge_mwh
            totals["discharge_mwh"] += discharge_mwh
            totals["loss_mwh"] += loss_mwh
            totals["winning_hours"] += winning_hours
            totals["fm_mileage"] += fm_mileage
            if fm_mileage > 0:
                clearing_weighted_sum += avg_clearing_price * fm_mileage

            rows.append({
                "date": declaration.get("target_date"),
                "total_revenue": round(total_revenue, 2),
                "energy_revenue": round(energy_revenue, 2),
                "fm_revenue": round(fm_revenue, 2),
                "cumulative_revenue": round(cumulative_revenue, 2),
                "cumulative_energy_revenue": round(cumulative_energy_revenue, 2),
                "cumulative_fm_revenue": round(cumulative_fm_revenue, 2),
                "charge_mwh": round(charge_mwh, 4),
                "discharge_mwh": round(discharge_mwh, 4),
                "loss_mwh": round(loss_mwh, 4),
                "winning_hours": int(round(winning_hours)),
                "fm_mileage": round(fm_mileage, 4),
                "avg_clearing_price": round(avg_clearing_price, 2),
                "fm_period_revenue": round(fm_period_revenue, 2),
            })

        reviewed_days = len(rows)
        natural_days = (end_dt - start_dt).days + 1
        avg_clearing_price = clearing_weighted_sum / totals["fm_mileage"] if totals["fm_mileage"] > 0 else 0.0
        fm_revenue_per_winning_hour = (
            totals["fm_revenue"] / totals["winning_hours"] if totals["winning_hours"] > 0 else 0.0
        )
        summary = {
            "start_date": start_date,
            "end_date": end_date,
            "reviewed_days": reviewed_days,
            "natural_days": natural_days,
            "total_revenue": round(totals["total_revenue"], 2),
            "energy_revenue": round(totals["energy_revenue"], 2),
            "fm_revenue": round(totals["fm_revenue"], 2),
            "avg_daily_revenue": round(totals["total_revenue"] / reviewed_days, 2) if reviewed_days > 0 else 0.0,
            "charge_mwh": round(totals["charge_mwh"], 4),
            "discharge_mwh": round(totals["discharge_mwh"], 4),
            "loss_mwh": round(totals["loss_mwh"], 4),
            "winning_hours": int(round(totals["winning_hours"])),
            "fm_mileage": round(totals["fm_mileage"], 4),
            "avg_clearing_price": round(avg_clearing_price, 2),
            "fm_revenue_per_winning_hour": round(fm_revenue_per_winning_hour, 2),
        }
        return {"summary": summary, "rows": rows}

    # ============ 收益测算 ============

    def calculate_revenue(
        self,
        station_id: str,
        target_date: str,
        energy_declaration: List[Dict[str, Any]],
        fm_declaration: List[Dict[str, Any]],
        prices_96: Optional[List[float]] = None,
        beta: Optional[float] = None,
        kp: Optional[float] = None,
        clearing_price: Optional[float] = None,
        degradation_cost_per_mwh: Optional[float] = None,
    ) -> Dict[str, Any]:
        """完整收益公式：电能量收益 + 调频收益 → 运营收益 → 净收益。"""
        station = self.get_station(station_id)
        prices = prices_96 if prices_96 else self.get_price_forecast_96(target_date, station.get("node_name") or "")
        # 取月份用于 price_sgcc
        month = target_date[:7]
        grid = self.get_grid_surcharge(str(station.get("voltage_level") or ""), month)

        beta = _safe_float(beta if beta is not None else station.get("default_mileage_beta"), 1.0)
        kp = _safe_float(kp if kp is not None else station.get("fm_k_value"), 1.0)
        clearing_price = _safe_float(clearing_price if clearing_price is not None else self._latest_fm_clearing_price(target_date), 0)
        degradation = _safe_float(
            degradation_cost_per_mwh if degradation_cost_per_mwh is not None else station.get("degradation_cost_per_mwh"),
            0,
        )
        default_winning_capacity = _safe_float(station.get("fm_power_mw"), 0)

        # 电能量收益
        total_charge_mwh = 0.0
        total_discharge_mwh = 0.0
        gross_charge_cost = 0.0
        gross_discharge_revenue = 0.0
        charge_market_prices: List[float] = []
        discharge_market_prices: List[float] = []
        slot_pnl: List[float] = []
        for i in range(SLOT_COUNT):
            slot = energy_declaration[i] if i < len(energy_declaration) else {"power_mw": 0}
            power = _safe_float(slot.get("power_mw"), 0)
            price = prices[i] if i < len(prices) else 0
            charge_price = self._charge_price(price, grid)
            energy_mwh = abs(power) * SLOT_HOURS
            slot_value = 0.0
            if power > 0:  # 放电
                total_discharge_mwh += energy_mwh
                gross_discharge_revenue += energy_mwh * price
                discharge_market_prices.append(price)
                slot_value = energy_mwh * price
            elif power < 0:  # 充电
                total_charge_mwh += energy_mwh
                gross_charge_cost += energy_mwh * charge_price
                charge_market_prices.append(price)
                slot_value = -energy_mwh * charge_price
            slot_pnl.append(round(slot_value, 4))

        net_consumption = max(total_charge_mwh - total_discharge_mwh, 0.0)
        charge_weighted_price = gross_charge_cost / total_charge_mwh if total_charge_mwh > 0 else 0.0
        loss_price = self._loss_price(charge_weighted_price, grid) if net_consumption > 0 else 0.0
        loss_fee = net_consumption * loss_price
        energy_revenue = gross_discharge_revenue - gross_charge_cost - loss_fee
        avg_charge_market_price = sum(charge_market_prices) / len(charge_market_prices) if charge_market_prices else 0.0
        avg_discharge_market_price = sum(discharge_market_prices) / len(discharge_market_prices) if discharge_market_prices else 0.0
        peak_valley_spread = avg_discharge_market_price - avg_charge_market_price

        # 调频收益（24点）
        fm_revenue = 0.0
        for h in range(HOUR_COUNT):
            row = fm_declaration[h] if h < len(fm_declaration) else {}
            mileage_price = _safe_float(row.get("mileage_price"), 0)
            winning_capacity = _safe_float(row.get("output_base_mw"), default_winning_capacity)
            if mileage_price > 0 and winning_capacity > 0:
                fm_revenue += winning_capacity * beta * kp * clearing_price * 1.0  # 1h
                # mileage_price 为里程报价，用于市场出清，本简化版用 clearing_price 作为出清价

        operational_revenue = energy_revenue + fm_revenue
        degradation_total = total_charge_mwh * degradation
        net_revenue = operational_revenue - degradation_total

        return {
            "energy_revenue": round(energy_revenue, 2),
            "fm_revenue": round(fm_revenue, 2),
            "operational_revenue": round(operational_revenue, 2),
            "degradation_cost": round(degradation_total, 2),
            "net_revenue": round(net_revenue, 2),
            "total_charge_mwh": round(total_charge_mwh, 4),
            "total_discharge_mwh": round(total_discharge_mwh, 4),
            "net_consumption_mwh": round(net_consumption, 4),
            "net_surcharge_per_mwh": round(loss_price, 4),
            "peak_valley_spread": round(peak_valley_spread, 2),
            "charge_fee": round(gross_charge_cost, 2),
            "discharge_revenue": round(gross_discharge_revenue, 2),
            "loss_fee": round(loss_fee, 2),
            "grid_surcharge_detail": grid,
            "slot_pnl": slot_pnl,
            "params": {
                "beta": beta,
                "kp": kp,
                "clearing_price": clearing_price,
                "degradation_cost_per_mwh": degradation,
                "winning_capacity_mw": default_winning_capacity,
            },
        }

    def _latest_fm_clearing_price(self, target_date: str) -> float:
        """读取调频出清价格的均值，作为预演的默认参考。"""
        try:
            doc_cursor = self.frequency_regulation_clearing.find(
                {"date_str": target_date},
                {"_id": 0, "clearing_price": 1},
            )
            prices = [_safe_float(d.get("clearing_price"), 0) for d in doc_cursor if d.get("clearing_price") is not None]
            if not prices:
                # 取最近一日
                latest = self.frequency_regulation_clearing.find({}, sort=[("date_str", -1)]).limit(96)
                prices = [_safe_float(d.get("clearing_price"), 0) for d in latest if d.get("clearing_price") is not None]
            if not prices:
                return 0.0
            return sum(prices) / len(prices)
        except Exception as e:
            logger.warning(f"读取调频出清价格失败: {e}")
            return 0.0

    def _get_fm_intraday_clearing_prices_24(self, target_date: str) -> List[Optional[float]]:
        """读取目标日日内调频出清价格，按小时聚合为 24 点；缺失小时保留 None。"""
        rows = list(self.frequency_regulation_clearing.find(
            {"market_type": "intraday", "date_str": target_date},
            {"_id": 0, "time_str": 1, "clearing_price": 1},
        ))
        by_hour: Dict[int, List[float]] = {h: [] for h in range(HOUR_COUNT)}

        for row in rows:
            hour = _hour_index_from_period_end(row.get("time_str"))
            if hour is None:
                continue
            price = _safe_float(row.get("clearing_price"), -1)
            if price >= 0:
                by_hour[hour].append(price)

        values: List[Optional[float]] = []
        for hour in range(HOUR_COUNT):
            bucket = by_hour.get(hour) or []
            values.append(round(sum(bucket) / len(bucket), 6) if bucket else None)
        return values

    def _get_review_readiness(self, station: Dict[str, Any], target_date: str) -> Dict[str, Any]:
        node_prices = self._get_node_prices_96(station.get("node_name") or "", target_date)
        fm_prices = self._get_fm_intraday_clearing_prices_24(target_date)
        node_count = sum(1 for value in node_prices if value is not None)
        fm_count = sum(1 for value in fm_prices if value is not None)
        missing: List[str] = []
        if node_count < SLOT_COUNT:
            missing.append(f"节点实时价格 {node_count}/96")
        if fm_count < HOUR_COUNT:
            missing.append(f"调频日内出清价格 {fm_count}/24")
        can_review = not missing
        return {
            "can_review": can_review,
            "message": "复盘数据已完整" if can_review else "复盘数据未完整：" + "，".join(missing),
            "node_realtime_points": node_count,
            "fm_intraday_hours": fm_count,
        }

    def simulate_review(
        self,
        station_id: str,
        strategy_id: str,
        target_date: str,
        operator: str,
    ) -> Dict[str, Any]:
        """按目标日实际价格模拟单日复盘，并回写到同一条申报记录。"""
        station = self.get_station(station_id)
        declaration = self.declarations.find_one({
            "station_id": station_id,
            "strategy_id": strategy_id,
            "target_date": target_date,
        })
        if not declaration:
            raise ValueError("该日未生成申报数据")

        energy_slots = declaration.get("energy_slots_96") or []
        fm_slots = declaration.get("fm_slots_24") or []
        soc_trajectory = declaration.get("soc_trajectory_96") or []
        readiness = self._get_review_readiness(station, target_date)
        if not readiness.get("can_review"):
            raise ValueError(readiness.get("message") or "复盘数据未完整")
        node_prices = self._get_node_prices_96(station.get("node_name") or "", target_date)
        fm_clearing_prices = self._get_fm_intraday_clearing_prices_24(target_date)
        grid = self.get_grid_surcharge(str(station.get("voltage_level") or ""), target_date[:7])

        total_charge_mwh = 0.0
        total_discharge_mwh = 0.0
        charge_fee = 0.0
        discharge_revenue = 0.0
        charge_market_prices: List[float] = []
        discharge_market_prices: List[float] = []
        review_energy_slots: List[Dict[str, Any]] = []

        for i in range(SLOT_COUNT):
            row = energy_slots[i] if i < len(energy_slots) else {}
            power = _safe_float(row.get("power_mw"), 0)
            price = _safe_float(node_prices[i], 0) if i < len(node_prices) else 0
            charge_price = self._charge_price(price, grid)
            energy_mwh = abs(power) * SLOT_HOURS
            charge_mwh = energy_mwh if power < 0 else 0.0
            discharge_mwh = energy_mwh if power > 0 else 0.0
            if charge_mwh > 0:
                charge_market_prices.append(price)
            if discharge_mwh > 0:
                discharge_market_prices.append(price)
            slot_charge_fee = charge_mwh * charge_price
            slot_discharge_revenue = discharge_mwh * price
            total_charge_mwh += charge_mwh
            total_discharge_mwh += discharge_mwh
            charge_fee += slot_charge_fee
            discharge_revenue += slot_discharge_revenue
            review_energy_slots.append({
                "time_point": row.get("time_point") or _slot_time_label(i),
                "power_mw": round(power, 6),
                "energy_mwh": round(power * SLOT_HOURS, 6),
                "charge_mwh": round(charge_mwh, 6),
                "discharge_mwh": round(discharge_mwh, 6),
                "node_realtime_price": round(price, 6),
                "charge_price": round(charge_price, 6),
                "charge_fee": round(slot_charge_fee, 6),
                "discharge_revenue": round(slot_discharge_revenue, 6),
                "soc": round(_safe_float(soc_trajectory[i], 0), 6) if i < len(soc_trajectory) else 0.0,
            })

        loss_mwh = max(total_charge_mwh - total_discharge_mwh, 0.0)
        charge_weighted_price = charge_fee / total_charge_mwh if total_charge_mwh > 0 else 0.0
        loss_price = self._loss_price(charge_weighted_price, grid) if loss_mwh > 0 else 0.0
        loss_fee = loss_mwh * loss_price
        energy_revenue = discharge_revenue - charge_fee - loss_fee
        avg_charge_market_price = sum(charge_market_prices) / len(charge_market_prices) if charge_market_prices else 0.0
        avg_discharge_market_price = sum(discharge_market_prices) / len(discharge_market_prices) if discharge_market_prices else 0.0
        peak_valley_spread = avg_discharge_market_price - avg_charge_market_price

        beta = _safe_float(station.get("default_mileage_beta"), 1.0)
        k_value = _safe_float(station.get("fm_k_value"), 1.0)
        bid_compare_k_value = k_value if k_value > 0 else 1.0
        fm_revenue = 0.0
        winning_hours = 0
        total_fm_mileage = 0.0
        review_fm_slots: List[Dict[str, Any]] = []

        for h in range(HOUR_COUNT):
            row = fm_slots[h] if h < len(fm_slots) else {}
            bid_price = _safe_float(row.get("mileage_price"), 0)
            capacity = _safe_float(row.get("output_base_mw"), 0)
            clearing_price = _safe_float(fm_clearing_prices[h], 0) if h < len(fm_clearing_prices) else 0
            bid_price_for_clearing = bid_price / bid_compare_k_value if bid_price > 0 else 0.0
            is_winning = bid_price > 0 and capacity > 0 and bid_price_for_clearing < clearing_price
            mileage = capacity * beta if is_winning else 0.0
            revenue = mileage * clearing_price * k_value
            if is_winning:
                winning_hours += 1
                total_fm_mileage += mileage
                fm_revenue += revenue
            start, end = _hour_period_labels(h)
            review_fm_slots.append({
                "hour": h + 1,
                "period_start": row.get("period_start") or start,
                "period_end": row.get("period_end") or end,
                "output_base_mw": round(capacity, 6),
                "mileage_price": round(bid_price, 6),
                "clearing_compare_price": round(bid_price_for_clearing, 6),
                "intraday_clearing_price": round(clearing_price, 6),
                "is_winning": is_winning,
                "mileage": round(mileage, 6),
                "revenue": round(revenue, 6),
            })

        valid_clearing_prices = [_safe_float(price, 0) for price in fm_clearing_prices if _safe_float(price, 0) > 0]
        avg_clearing_price = sum(valid_clearing_prices) / len(valid_clearing_prices) if valid_clearing_prices else 0.0
        fm_revenue_per_winning_hour = fm_revenue / winning_hours if winning_hours > 0 else 0.0
        total_revenue = energy_revenue + fm_revenue
        metrics = {
            "total_revenue": round(total_revenue, 2),
            "energy_revenue": round(energy_revenue, 2),
            "peak_valley_spread": round(peak_valley_spread, 2),
            "charge_mwh": round(total_charge_mwh, 4),
            "charge_fee": round(charge_fee, 2),
            "discharge_mwh": round(total_discharge_mwh, 4),
            "discharge_revenue": round(discharge_revenue, 2),
            "loss_mwh": round(loss_mwh, 4),
            "loss_fee": round(loss_fee, 2),
            "fm_revenue": round(fm_revenue, 2),
            "winning_hours": winning_hours,
            "fm_mileage": round(total_fm_mileage, 4),
            "avg_clearing_price": round(avg_clearing_price, 2),
            "fm_revenue_per_winning_hour": round(fm_revenue_per_winning_hour, 2),
            "charge_weighted_price": round(charge_weighted_price, 4),
            "loss_price": round(loss_price, 4),
            "fm_k_value": round(k_value, 6),
            "default_mileage_beta": round(beta, 6),
            "grid_surcharge_detail": grid,
        }
        now = _now()
        update_doc = {
            "status": "settled",
            "settled_at": now,
            "review_status": REVIEW_STATUS_COMPLETED,
            "review_simulated_at": now,
            "review_node_realtime_price_96": [round(_safe_float(value, 0), 6) for value in node_prices],
            "review_fm_clearing_price_24": [round(_safe_float(value, 0), 6) for value in fm_clearing_prices],
            "review_energy_slots_96": review_energy_slots,
            "review_fm_slots_24": review_fm_slots,
            "review_metrics": metrics,
            "updated_at": now,
            "updated_by": operator,
        }
        self.declarations.update_one({"declaration_id": declaration["declaration_id"]}, {"$set": update_doc})
        out = _doc_to_declaration(self.declarations.find_one({"declaration_id": declaration["declaration_id"]}))
        out["review_readiness"] = readiness
        return out

    def auto_simulate_reviews(
        self,
        operator: str = "system",
        limit: int = 50,
        latest_target_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """自动回填已具备数据条件的储能单日复盘结果。"""
        result: Dict[str, Any] = {
            "latest_target_date": latest_target_date,
            "reviewed_count": 0,
            "skipped_count": 0,
            "blocked_count": 0,
            "error_count": 0,
            "reviewed": [],
            "skipped": [],
            "blocked": [],
            "errors": [],
        }
        query: Dict[str, Any] = {"review_status": REVIEW_STATUS_PENDING}
        if latest_target_date:
            query["target_date"] = {"$lte": latest_target_date}
        cursor = self.declarations.find(
            query,
            {
                "_id": 0,
                "declaration_id": 1,
                "station_id": 1,
                "station_name": 1,
                "strategy_id": 1,
                "strategy_name": 1,
                "target_date": 1,
            },
        ).sort("target_date", 1).limit(limit)

        for declaration in cursor:
            station_id = declaration.get("station_id") or ""
            strategy_id = declaration.get("strategy_id") or ""
            target_date = declaration.get("target_date") or ""
            if not station_id or not strategy_id or not target_date:
                result["skipped"].append({
                    "declaration_id": declaration.get("declaration_id"),
                    "reason": "申报记录缺少电站、策略或目标日",
                })
                continue
            try:
                station = self.get_station(station_id)
                readiness = self._get_review_readiness(station, target_date)
                if not readiness.get("can_review"):
                    result["blocked"].append({
                        "declaration_id": declaration.get("declaration_id"),
                        "station_id": station_id,
                        "station_name": declaration.get("station_name"),
                        "strategy_id": strategy_id,
                        "strategy_name": declaration.get("strategy_name"),
                        "target_date": target_date,
                        "reason": readiness.get("message") or "复盘数据未完整",
                        "readiness": readiness,
                    })
                    continue
                reviewed = self.simulate_review(
                    station_id=station_id,
                    strategy_id=strategy_id,
                    target_date=target_date,
                    operator=operator,
                )
                result["reviewed"].append({
                    "declaration_id": reviewed.get("declaration_id"),
                    "station_id": station_id,
                    "station_name": reviewed.get("station_name"),
                    "strategy_id": strategy_id,
                    "strategy_name": reviewed.get("strategy_name"),
                    "target_date": target_date,
                    "total_revenue": (reviewed.get("review_metrics") or {}).get("total_revenue"),
                })
            except Exception as exc:
                logger.error("储能复盘自动回填失败 declaration_id=%s: %s", declaration.get("declaration_id"), exc, exc_info=True)
                result["errors"].append({
                    "declaration_id": declaration.get("declaration_id"),
                    "station_id": station_id,
                    "strategy_id": strategy_id,
                    "target_date": target_date,
                    "message": str(exc),
                })

        result["reviewed_count"] = len(result["reviewed"])
        result["skipped_count"] = len(result["skipped"])
        result["blocked_count"] = len(result["blocked"])
        result["error_count"] = len(result["errors"])
        return result

    def _recommended_fm_mileage_prices_24(self, target_date: str, fallback_price: float) -> Tuple[List[float], Dict[str, Any]]:
        """基于日前需求和近期出清价生成 24 点调频里程报价建议。"""
        fallback_price = _normalize_fm_mileage_price(fallback_price)
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            return [fallback_price] * HOUR_COUNT, {"source": "fallback", "fallback_price": fallback_price}

        start_date = (target_dt - timedelta(days=14)).strftime("%Y-%m-%d")
        end_date = (target_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        history_query = {
            "market_type": "day_ahead",
            "date_str": {"$gte": start_date, "$lte": end_date},
        }
        clearing_rows = list(self.frequency_regulation_clearing.find(
            history_query,
            {"_id": 0, "time_str": 1, "clearing_price": 1, "avg_bid_price": 1},
        ))
        demand_rows = list(self.frequency_regulation_demand.find(
            history_query,
            {"_id": 0, "time_str": 1, "demand_mw": 1},
        ))
        target_demand_rows = list(self.frequency_regulation_demand.find(
            {"market_type": "day_ahead", "date_str": target_date},
            {"_id": 0, "time_str": 1, "demand_mw": 1},
        ))

        prices_by_hour: Dict[int, List[float]] = {h: [] for h in range(HOUR_COUNT)}
        bids_by_hour: Dict[int, List[float]] = {h: [] for h in range(HOUR_COUNT)}
        demand_by_hour: Dict[int, List[float]] = {h: [] for h in range(HOUR_COUNT)}
        target_demand_by_hour: Dict[int, float] = {}

        def parse_hour(time_str: Any) -> Optional[int]:
            text = str(time_str or "")
            if not text:
                return None
            try:
                hour = int(text.split(":", 1)[0])
                return min(max(hour, 0), HOUR_COUNT - 1)
            except Exception:
                return None

        for row in clearing_rows:
            hour = parse_hour(row.get("time_str"))
            if hour is None:
                continue
            clearing_price = _safe_float(row.get("clearing_price"), -1)
            avg_bid_price = _safe_float(row.get("avg_bid_price"), -1)
            if clearing_price >= 0:
                prices_by_hour[hour].append(clearing_price)
            if avg_bid_price >= 0:
                bids_by_hour[hour].append(avg_bid_price)

        for row in demand_rows:
            hour = parse_hour(row.get("time_str"))
            demand = _safe_float(row.get("demand_mw"), -1)
            if hour is not None and demand >= 0:
                demand_by_hour[hour].append(demand)

        for row in target_demand_rows:
            hour = parse_hour(row.get("time_str"))
            demand = _safe_float(row.get("demand_mw"), -1)
            if hour is not None and demand >= 0:
                target_demand_by_hour[hour] = demand

        all_history_prices = [value for values in prices_by_hour.values() for value in values]
        all_history_bids = [value for values in bids_by_hour.values() for value in values]
        all_history_demands = [value for values in demand_by_hour.values() for value in values]
        global_price = sum(all_history_prices) / len(all_history_prices) if all_history_prices else fallback_price
        global_bid = sum(all_history_bids) / len(all_history_bids) if all_history_bids else global_price
        global_demand = sum(all_history_demands) / len(all_history_demands) if all_history_demands else 0.0

        recommended: List[float] = []
        for hour in range(HOUR_COUNT):
            hour_prices = prices_by_hour.get(hour) or []
            hour_bids = bids_by_hour.get(hour) or []
            hour_demands = demand_by_hour.get(hour) or []
            price_base = sum(hour_prices) / len(hour_prices) if hour_prices else global_price
            bid_base = sum(hour_bids) / len(hour_bids) if hour_bids else global_bid
            history_demand = sum(hour_demands) / len(hour_demands) if hour_demands else global_demand
            target_demand = target_demand_by_hour.get(hour, history_demand)
            demand_factor = 1.0
            if history_demand > 0 and target_demand > 0:
                demand_factor = max(0.85, min(1.2, target_demand / history_demand))
            base = price_base * 0.75 + bid_base * 0.25
            price = base * demand_factor if base > 0 else fallback_price
            recommended.append(_normalize_fm_mileage_price(price))

        return recommended, {
            "source": "frequency_regulation_demand+frequency_regulation_clearing",
            "market_type": "day_ahead",
            "history_start_date": start_date,
            "history_end_date": end_date,
            "fallback_price": round(fallback_price, 2),
            "history_price_avg": round(global_price, 2),
            "history_bid_avg": round(global_bid, 2),
            "history_demand_avg": round(global_demand, 2),
            "target_demand_points": len(target_demand_by_hour),
        }

    # ============ 历史复盘 ============

    def list_history_dates(self, station_id: str) -> List[str]:
        cursor = self.history.find({"station_id": station_id}, {"_id": 0, "date": 1}).sort("date", -1)
        dates = [d.get("date") for d in cursor if d.get("date")]
        # 若无真实复盘数据，回退为有申报数据的日期列表
        if not dates:
            cursor = self.declarations.find({"station_id": station_id}, {"_id": 0, "target_date": 1}).sort("target_date", -1)
            seen = set()
            for d in cursor:
                s = d.get("target_date")
                if s and s not in seen:
                    seen.add(s)
                    dates.append(s)
        return dates

    def get_history(self, station_id: str, date: str) -> Dict[str, Any]:
        """复盘数据：优先读取 storage_history，否则基于已保存申报生成模拟偏差数据。"""
        station = self.get_station(station_id)
        doc = self.history.find_one({"station_id": station_id, "date": date})
        if doc:
            out = dict(doc)
            out.pop("_id", None)
            for k in ("created_at", "updated_at"):
                if isinstance(out.get(k), datetime):
                    out[k] = out[k].isoformat()
            return out

        # 回退：根据申报生成模拟数据
        decl = self.declarations.find_one({"station_id": station_id, "target_date": date}, sort=[("updated_at", -1)])
        node_prices = self._get_node_prices_96(station.get("node_name") or "", date)

        if decl:
            energy = decl.get("energy_slots_96") or []
            actual_slots = []
            sced_slots = []
            random.seed(f"{station_id}-{date}")
            for i in range(SLOT_COUNT):
                planned = _safe_float((energy[i] or {}).get("power_mw"), 0) if i < len(energy) else 0
                deviation = random.uniform(-0.06, 0.06)
                sced = round(planned * (1 + deviation * 0.5), 3)
                actual = round(sced * (1 + random.uniform(-0.05, 0.05)), 3)
                actual_slots.append({"time_point": _slot_time_label(i), "actual_power_mw": actual})
                sced_slots.append({"time_point": _slot_time_label(i), "sced_mw": sced})
            actual_soc = self.simulate_soc(
                [{"power_mw": s["actual_power_mw"]} for s in actual_slots],
                _safe_float(station.get("rated_capacity_mwh"), 1),
                _station_charge_efficiency(station),
                _station_discharge_efficiency(station),
                _safe_float(station.get("default_soc"), DEFAULT_INITIAL_SOC),
            )
        else:
            actual_slots = [{"time_point": _slot_time_label(i), "actual_power_mw": 0.0} for i in range(SLOT_COUNT)]
            sced_slots = [{"time_point": _slot_time_label(i), "sced_mw": 0.0} for i in range(SLOT_COUNT)]
            actual_soc = [_safe_float(station.get("default_soc"), DEFAULT_INITIAL_SOC)] * SLOT_COUNT

        # 调频实测指标（模拟）
        random.seed(f"{station_id}-{date}-fm")
        fm_hourly_kp = []
        for h in range(HOUR_COUNT):
            k1 = round(random.uniform(0.7, 1.0), 3)
            k2 = round(random.uniform(0.6, 1.0), 3)
            k3 = round(random.uniform(0.7, 1.0), 3)
            kp_val = round((k1 + k2 + k3) / 3, 3)
            penalty = 0.0 if kp_val >= 0.6 else round(random.uniform(50, 500), 2)
            fm_hourly_kp.append({
                "hour": h,
                "winning_capacity_mw": _safe_float(station.get("fm_power_mw"), 0),
                "k1_rate": k1,
                "k2_accuracy": k2,
                "k3_response": k3,
                "kp_composite": kp_val,
                "penalty_yuan": penalty,
            })

        # 结算汇总（用节点电价 + 申报曲线粗算）
        if decl:
            revenue = self.calculate_revenue(
                station_id=station_id,
                target_date=date,
                energy_declaration=decl.get("energy_slots_96") or [],
                fm_declaration=decl.get("fm_slots_24") or [],
                prices_96=node_prices,
            )
            energy_revenue = revenue["energy_revenue"]
            fm_revenue = revenue["fm_revenue"]
            total_revenue = revenue["net_revenue"]
        else:
            energy_revenue = 0.0
            fm_revenue = 0.0
            total_revenue = 0.0
        avg_kp = sum(item["kp_composite"] for item in fm_hourly_kp) / max(len(fm_hourly_kp), 1)
        total_penalty = sum(item["penalty_yuan"] for item in fm_hourly_kp)

        return {
            "history_id": "",
            "station_id": station_id,
            "date": date,
            "actual_energy_slots": actual_slots,
            "sced_slots": sced_slots,
            "actual_soc": actual_soc,
            "node_prices": node_prices,
            "fm_hourly_kp": fm_hourly_kp,
            "energy_revenue": round(energy_revenue, 2),
            "fm_revenue": round(fm_revenue, 2),
            "energy_deviation_penalty": 0.0,
            "fm_penalty": round(total_penalty, 2),
            "total_revenue": round(total_revenue, 2),
            "avg_kp": round(avg_kp, 3),
            "is_simulated": True,
            "declared_energy": (decl or {}).get("energy_slots_96") or [],
            "declared_fm": (decl or {}).get("fm_slots_24") or [],
        }

    def _get_node_prices_96(self, node_name: str, date: str) -> List[Optional[float]]:
        """从 node_spot_price_daily 读取实时节点电价 96 点。"""
        if not node_name:
            return [None] * SLOT_COUNT
        try:
            node_values = load_node_spot_price_values_96(
                self.db,
                date,
                node_name,
                price_type="real_time",
            )
            slot_prices = [
                float(value) if value is not None else None
                for value in node_values
            ]
            if len(slot_prices) >= SLOT_COUNT:
                return slot_prices[:SLOT_COUNT]
            return slot_prices + [None] * (SLOT_COUNT - len(slot_prices))
        except Exception as e:
            logger.warning(f"读取节点电价失败: {e}")
            return [None] * SLOT_COUNT


# ============ 策略算法实现 ============


def _build_empty_slots(fm_power_mw: float = 0.0) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    energy = [{"time_point": _slot_time_label(i), "power_mw": 0.0} for i in range(SLOT_COUNT)]
    fm = []
    for h in range(HOUR_COUNT):
        start, end = _hour_period_labels(h)
        fm.append({"period_start": start, "period_end": end, "output_base_mw": 0.0, "mileage_price": 0.0})
    return energy, fm


def generate_simple_peak_valley(
    station: Dict[str, Any],
    strategy: Dict[str, Any],
    lmp_forecast: List[float],
    soc_initial: float,
    threshold: float,
) -> Dict[str, Any]:
    """简单峰谷套利：取最低 2 小时充电、最高 2 小时放电，其余时段调频。"""
    rated_power = _safe_float(station.get("rated_power_mw"), 0)
    rated_capacity = _safe_float(station.get("rated_capacity_mwh"), 0)
    charge_efficiency = _station_charge_efficiency(station)
    discharge_efficiency = _station_discharge_efficiency(station)
    discharge_depth = _safe_float(station.get("discharge_depth"), 0.9)
    fm_power = _safe_float(station.get("fm_power_mw"), 0)
    fm_output_base_mw = _default_fm_output_base_mw(station)

    # 96 点 → 24 点小时均价
    hourly_price = []
    for h in range(HOUR_COUNT):
        bucket = lmp_forecast[h * 4:(h + 1) * 4]
        bucket = [p for p in bucket if p is not None]
        avg = sum(bucket) / max(len(bucket), 1) if bucket else 0
        hourly_price.append(avg)

    # 找 2 个充电小时 + 2 个放电小时，强制满足充电全部早于放电。
    best_plan: Optional[Tuple[float, Tuple[int, int], Tuple[int, int], float, float]] = None
    for c1 in range(HOUR_COUNT - 1):
        for c2 in range(c1 + 1, HOUR_COUNT):
            charge_pair = (c1, c2)
            discharge_candidates = [h for h in range(c2 + 1, HOUR_COUNT)]
            if len(discharge_candidates) < 2:
                continue
            sorted_discharge = sorted(discharge_candidates, key=lambda h: hourly_price[h], reverse=True)
            discharge_pair = tuple(sorted(sorted_discharge[:2]))
            avg_low_candidate = (hourly_price[c1] + hourly_price[c2]) / 2
            avg_high_candidate = sum(hourly_price[h] for h in discharge_pair) / 2
            spread = avg_high_candidate - avg_low_candidate
            if best_plan is None or spread > best_plan[0]:
                best_plan = (spread, charge_pair, discharge_pair, avg_low_candidate, avg_high_candidate)

    if best_plan:
        spread, charge_pair, discharge_pair, avg_low, avg_high = best_plan
        charge_hours = set(charge_pair)
        discharge_hours = set(discharge_pair)
    else:
        spread = 0.0
        avg_low = 0.0
        avg_high = 0.0
        charge_hours = set()
        discharge_hours = set()
    arbitrage_ok = (avg_high - avg_low) > threshold

    # SOC 边界：目标最高 SOC 来自策略参数，放电至少保留 10%（与 DoD 下限取较高者）
    soc_max = _strategy_max_soc(strategy)
    soc_min = max(SOC_LOWER_GUARD_DEFAULT, 1.0 - discharge_depth)
    charge_eff_safe = max(charge_efficiency, 1e-6)
    discharge_eff_safe = max(discharge_efficiency, 1e-6)
    cap_safe = max(rated_capacity, 1e-6)

    # 充放电功率独立计算：
    # 2h 充电：ΔSOC × cap = P_charge × η_charge × 2
    # 2h 放电：ΔSOC × cap = P_discharge × 2 / η_discharge
    p_charge_target = max(soc_max - soc_initial, 0.0) * cap_safe / (2.0 * charge_eff_safe)
    p_discharge_target = max(soc_max - soc_min, 0.0) * cap_safe * discharge_eff_safe / 2.0
    p_charge = min(rated_power, p_charge_target) if rated_power > 0 else 0.0
    p_discharge = min(rated_power, p_discharge_target) if rated_power > 0 else 0.0

    energy_slots, fm_slots = _build_empty_slots(fm_power)

    # 默认 FM 报价（取阈值附近，避免为 0 导致前端忽略）
    fm_default_mileage_price = _normalize_fm_mileage_price(threshold * 0.6 if threshold > 0 else 0.0)
    if fm_output_base_mw <= 0:
        fm_default_mileage_price = 0.0

    if not arbitrage_ok or p_charge <= 0:
        # 退回全天调频
        for h in range(HOUR_COUNT):
            fm_slots[h]["mileage_price"] = fm_default_mileage_price
            fm_slots[h]["output_base_mw"] = fm_output_base_mw
        soc_traj = StorageDeclarationService.simulate_soc(energy_slots, rated_capacity, charge_efficiency, discharge_efficiency, soc_initial)
        return {
            "energy_declaration": energy_slots,
            "fm_declaration": fm_slots,
            "soc_trajectory": soc_traj,
            "arbitrage_executed": False,
            "charge_hours": [],
            "discharge_hours": [],
            "p_charge_mw": 0.0,
            "p_discharge_mw": 0.0,
            "max_soc": soc_max,
        }

    # 写入 96 点：充电（负值）/放电（正值）/其余为 0（调频）
    for slot in range(SLOT_COUNT):
        hour = slot // 4
        if hour in charge_hours:
            energy_slots[slot]["power_mw"] = round(-p_charge, 4)
        elif hour in discharge_hours:
            energy_slots[slot]["power_mw"] = round(p_discharge, 4)
        else:
            energy_slots[slot]["power_mw"] = 0.0

    # 调频 24 点：非充放电小时申报里程报价
    for h in range(HOUR_COUNT):
        if h in charge_hours or h in discharge_hours:
            fm_slots[h]["mileage_price"] = 0.0
            fm_slots[h]["output_base_mw"] = 0.0
        else:
            fm_slots[h]["mileage_price"] = fm_default_mileage_price
            fm_slots[h]["output_base_mw"] = fm_output_base_mw

    soc_traj = StorageDeclarationService.simulate_soc(energy_slots, rated_capacity, charge_efficiency, discharge_efficiency, soc_initial)

    return {
        "energy_declaration": energy_slots,
        "fm_declaration": fm_slots,
        "soc_trajectory": soc_traj,
        "arbitrage_executed": True,
        "charge_hours": sorted(charge_hours),
        "discharge_hours": sorted(discharge_hours),
        "p_charge_mw": round(p_charge, 4),
        "p_discharge_mw": round(p_discharge, 4),
        "discharge_depth": discharge_depth,
        "max_soc": soc_max,
    }


def generate_threshold_arbitrage(
    station: Dict[str, Any],
    strategy: Dict[str, Any],
    lmp_forecast: List[float],
    soc_initial: float,
    threshold: float,
) -> Dict[str, Any]:
    """预留接口：价差阈值套利。首版退回 simple_peak_valley。"""
    return generate_simple_peak_valley(station, strategy, lmp_forecast, soc_initial, threshold)


def generate_fm_priority(
    station: Dict[str, Any],
    strategy: Dict[str, Any],
    lmp_forecast: List[float],
    soc_initial: float,
    threshold: float,
) -> Dict[str, Any]:
    """预留接口：调频优先。首版改为全天调频，零充放电。"""
    rated_capacity = _safe_float(station.get("rated_capacity_mwh"), 0)
    charge_efficiency = _station_charge_efficiency(station)
    discharge_efficiency = _station_discharge_efficiency(station)
    fm_power = _safe_float(station.get("fm_power_mw"), 0)
    fm_output_base_mw = _default_fm_output_base_mw(station)
    energy_slots, fm_slots = _build_empty_slots(fm_power)
    fm_default_mileage_price = _normalize_fm_mileage_price(threshold * 0.6 if threshold > 0 else 0.0)
    if fm_output_base_mw <= 0:
        fm_default_mileage_price = 0.0
    for h in range(HOUR_COUNT):
        fm_slots[h]["mileage_price"] = fm_default_mileage_price
        fm_slots[h]["output_base_mw"] = fm_output_base_mw
    soc_traj = StorageDeclarationService.simulate_soc(energy_slots, rated_capacity, charge_efficiency, discharge_efficiency, soc_initial)
    return {
        "energy_declaration": energy_slots,
        "fm_declaration": fm_slots,
        "soc_trajectory": soc_traj,
        "arbitrage_executed": False,
        "charge_hours": [],
        "discharge_hours": [],
        "p_charge_mw": 0.0,
        "p_discharge_mw": 0.0,
    }


def generate_hybrid_opt(
    station: Dict[str, Any],
    strategy: Dict[str, Any],
    lmp_forecast: List[float],
    soc_initial: float,
    threshold: float,
) -> Dict[str, Any]:
    """预留接口：混合优化。首版退回 simple_peak_valley。"""
    return generate_simple_peak_valley(station, strategy, lmp_forecast, soc_initial, threshold)


ALGORITHM_MAP = {
    "simple_peak_valley": generate_simple_peak_valley,
    "threshold_arbitrage": generate_threshold_arbitrage,
    "fm_priority": generate_fm_priority,
    "hybrid_opt": generate_hybrid_opt,
}


# ============ 风控校验 ============


def validate_declaration(
    station: Dict[str, Any],
    energy_declaration: List[Dict[str, Any]],
    fm_declaration: List[Dict[str, Any]],
    soc_trajectory: List[float],
) -> List[str]:
    """返回违规说明列表（空列表代表通过）。"""
    violations: List[str] = []
    fm_power = _safe_float(station.get("fm_power_mw"), 0)
    fm_output_base_limit = fm_power * FM_OUTPUT_BASE_LIMIT_RATIO if fm_power > 0 else 0
    discharge_depth = _safe_float(station.get("discharge_depth"), 0.9)
    soc_lower = max(SOC_LOWER_GUARD_DEFAULT, 1 - discharge_depth)
    rated_power = _safe_float(station.get("rated_power_mw"), 0)

    if len(energy_declaration) != SLOT_COUNT:
        violations.append(f"电能量申报需完整填写 {SLOT_COUNT} 时刻数据")
    if len(fm_declaration) != HOUR_COUNT:
        violations.append(f"调频申报需完整填写 {HOUR_COUNT} 时段数据")

    for i, slot in enumerate(energy_declaration):
        power = _safe_float(slot.get("power_mw"), 0)
        hour = i // 4
        fm_row = fm_declaration[hour] if hour < len(fm_declaration) else {}
        mileage_price = _safe_float(fm_row.get("mileage_price"), 0)
        if abs(power) > 1e-6 and mileage_price > 0:
            violations.append(f"时段 {_slot_time_label(i)} 同时存在充放电与调频申报")
        if rated_power > 0 and abs(power) > rated_power + 1e-3:
            violations.append(f"时段 {_slot_time_label(i)} 出力 {power} MW 超过额定功率 {rated_power} MW")

    for i, soc in enumerate(soc_trajectory):
        if soc < soc_lower - SOC_TOLERANCE:
            violations.append(f"时段 {_slot_time_label(i)} SOC {soc:.3f} 低于下限 {soc_lower:.3f}")
            break
        if soc > SOC_UPPER_GUARD + SOC_TOLERANCE:
            violations.append(f"时段 {_slot_time_label(i)} SOC {soc:.3f} 高于上限 {SOC_UPPER_GUARD:.3f}")
            break

    for h, row in enumerate(fm_declaration):
        mileage_price = _safe_float(row.get("mileage_price"), 0)
        output_base_mw = _safe_float(row.get("output_base_mw"), 0)
        if mileage_price < 0:
            violations.append(f"调频小时 {h:02d} 里程报价为负")
        if mileage_price > 0:
            if mileage_price < FM_MILEAGE_PRICE_MIN or mileage_price > FM_MILEAGE_PRICE_MAX:
                violations.append(f"调频小时 {h:02d} 里程报价需在 {FM_MILEAGE_PRICE_MIN:g}-{FM_MILEAGE_PRICE_MAX:g} 元/MW 范围内")
            if abs(round(mileage_price * 10) - mileage_price * 10) > 1e-6:
                violations.append(f"调频小时 {h:02d} 里程报价最小单位为 0.1 元/MW")
            if output_base_mw <= 0:
                violations.append(f"调频小时 {h:02d} 出力基值需大于 0 MW")
        if output_base_mw > 0 and mileage_price <= 0:
            violations.append(f"调频小时 {h:02d} 填写出力基值时需同步填写里程报价")
        if fm_output_base_limit > 0 and output_base_mw > fm_output_base_limit + 1e-3:
            violations.append(f"调频小时 {h:02d} 出力基值 {output_base_mw} MW 超过调频额定功率 90% 上限 {fm_output_base_limit:.3f} MW")

    return violations
