"""
一次性刷新储能申报策略最高 SOC 参数与已生成申报数据。

用途：
- 为 storage_strategies 补齐 max_soc 策略参数，默认 90%。
- 按新最高 SOC 规则重新生成 storage_declarations 中已有申报数据。
- 对已复盘的申报记录重新计算复盘指标。
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from webapp.services.storage_declaration_service import (
    DECLARE_STATUS_DECLARED,
    DECLARE_STATUS_PENDING,
    DEFAULT_FM_PRICE_THRESHOLD,
    DEFAULT_INITIAL_SOC,
    DEFAULT_MAX_SOC,
    MAX_SOC_PARAM_KEY,
    StorageDeclarationService,
    _default_max_soc_param,
    _safe_float,
)
from webapp.tools.mongo import DATABASE


logger = logging.getLogger(__name__)
OPERATOR = "temp_update_storage_max_soc"


def _param_value(params: List[Dict[str, Any]], key: str, default: float) -> float:
    for param in params or []:
        if param.get("param_key") == key:
            return _safe_float(param.get("param_value"), default)
    return default


def _ensure_strategy_max_soc(service: StorageDeclarationService) -> Tuple[int, int]:
    scanned = 0
    updated = 0
    for strategy in service.strategies.find({}):
        scanned += 1
        params = [dict(param) for param in (strategy.get("strategy_params") or [])]
        index = next((i for i, param in enumerate(params) if param.get("param_key") == MAX_SOC_PARAM_KEY), -1)
        if index >= 0:
            current = params[index]
            default_param = _default_max_soc_param(_param_value(params, MAX_SOC_PARAM_KEY, DEFAULT_MAX_SOC))
            merged = {
                **default_param,
                **current,
                "param_value": current.get("param_value") or default_param["param_value"],
                "unit": current.get("unit") or default_param["unit"],
                "description": current.get("description") or default_param["description"],
            }
            if merged == current:
                continue
            params[index] = merged
        else:
            params.append(_default_max_soc_param())
        service.strategies.update_one(
            {"strategy_id": strategy["strategy_id"]},
            {"$set": {"strategy_params": params, "updated_at": datetime.now(), "updated_by": OPERATOR}},
        )
        updated += 1
    return scanned, updated


def _regenerate_declarations(service: StorageDeclarationService) -> Tuple[int, int, int, List[str]]:
    scanned = 0
    refreshed = 0
    reviewed = 0
    errors: List[str] = []
    declarations = list(service.declarations.find({}, {"_id": 0}).sort([("target_date", 1), ("strategy_id", 1)]))
    for declaration in declarations:
        scanned += 1
        station_id = declaration.get("station_id")
        strategy_id = declaration.get("strategy_id")
        target_date = declaration.get("target_date")
        if not station_id or not strategy_id or not target_date:
            errors.append(f"跳过缺少关键字段的申报记录: {declaration.get('declaration_id')}")
            continue
        try:
            station = service.get_station(station_id)
            strategy = service.get_strategy(strategy_id)
            params_snapshot = dict(declaration.get("params_snapshot") or {})
            snapshot_strategy = dict(params_snapshot.get("strategy") or {})
            soc_initial = _safe_float(params_snapshot.get("soc_initial"), _safe_float(station.get("default_soc"), DEFAULT_INITIAL_SOC))
            threshold = _safe_float(
                snapshot_strategy.get("fm_price_threshold"),
                _param_value(strategy.get("strategy_params") or [], "fm_price_threshold", DEFAULT_FM_PRICE_THRESHOLD),
            )
            result = service.generate_declaration(
                station_id=station_id,
                strategy_id=strategy_id,
                target_date=target_date,
                soc_initial_override=soc_initial,
                threshold_override=threshold,
            )
            snapshot_strategy["max_soc"] = _param_value(strategy.get("strategy_params") or [], MAX_SOC_PARAM_KEY, DEFAULT_MAX_SOC)
            snapshot_strategy["fm_price_threshold"] = threshold
            params_snapshot["strategy"] = snapshot_strategy
            params_snapshot["soc_initial"] = soc_initial
            params_snapshot["fm_price_basis"] = result.get("fm_price_basis")
            params_snapshot["forecast_revenue"] = result.get("forecast_revenue")
            declare_status = declaration.get("declare_status")
            if declare_status not in (DECLARE_STATUS_DECLARED, DECLARE_STATUS_PENDING):
                declare_status = DECLARE_STATUS_PENDING
            service.save_declaration(
                station_id=station_id,
                strategy_id=strategy_id,
                target_date=target_date,
                energy_declaration=result.get("energy_declaration") or [],
                fm_declaration=result.get("fm_declaration") or [],
                soc_trajectory=result.get("soc_trajectory") or [],
                spot_price_forecast=result.get("spot_price_forecast") or [],
                params_snapshot=params_snapshot,
                declare_status=declare_status,
                operator=OPERATOR,
                result_meta={
                    "arbitrage_executed": result.get("arbitrage_executed"),
                    "charge_hours": result.get("charge_hours") or [],
                    "discharge_hours": result.get("discharge_hours") or [],
                    "p_charge_mw": result.get("p_charge_mw") or 0,
                    "p_discharge_mw": result.get("p_discharge_mw") or 0,
                    "max_soc": result.get("max_soc"),
                    "violations": result.get("violations") or [],
                    "generation_message": result.get("generation_message") or "",
                    "forecast_revenue": result.get("forecast_revenue"),
                },
            )
            if declaration.get("submitted_at"):
                service.declarations.update_one(
                    {"declaration_id": declaration.get("declaration_id")},
                    {"$set": {"submitted_at": declaration.get("submitted_at")}},
                )
            refreshed += 1
            if declaration.get("review_status") == "已复盘" or declaration.get("review_metrics"):
                service.simulate_review(
                    station_id=station_id,
                    strategy_id=strategy_id,
                    target_date=target_date,
                    operator=OPERATOR,
                )
                reviewed += 1
        except Exception as exc:
            errors.append(f"{target_date} / {strategy_id}: {exc}")
    return scanned, refreshed, reviewed, errors


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    service = StorageDeclarationService(DATABASE)
    strategy_count, strategy_updated = _ensure_strategy_max_soc(service)
    scanned, refreshed, reviewed, errors = _regenerate_declarations(service)
    logger.info("策略扫描 %s 条，补齐/修正最高SOC参数 %s 条", strategy_count, strategy_updated)
    logger.info("申报扫描 %s 条，刷新 %s 条，复盘重算 %s 条", scanned, refreshed, reviewed)
    if errors:
        logger.warning("处理过程中有 %s 条记录未完成", len(errors))
        for message in errors:
            logger.warning(message)


if __name__ == "__main__":
    main()
