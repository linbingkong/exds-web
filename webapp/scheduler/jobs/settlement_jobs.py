import json
import logging
from typing import Any, Dict, List

from webapp.models.settlement import SettlementVersion
from webapp.scheduler.logger import TaskLogger
from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.services.settlement_service import SettlementService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


def _normalize_blocked_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for entry in entries:
        normalized.append({
            "process": entry.get("process"),
            "date": entry.get("date"),
            "version": entry.get("version"),
            "missing_items": sorted(entry.get("missing_items", [])),
            "message": entry.get("message"),
        })
    normalized.sort(key=lambda x: (x["process"] or "", x["date"] or "", x["version"] or ""))
    return normalized


def _should_persist_log(status: str, details: Dict[str, Any]) -> bool:
    latest = DATABASE["task_execution_logs"].find_one(
        {"task_type": "event_driven_settlement"},
        sort=[("start_time", -1)]
    )
    if not latest:
        return True

    latest_details = latest.get("details") or {}
    compare_keys = [
        "signature",
        "new_preliminary",
        "new_platform_daily",
        "new_retail",
        "blocked_count",
        "error_count",
    ]
    same_status = latest.get("status") == status
    same_details = all(latest_details.get(key) == details.get(key) for key in compare_keys)
    return not (same_status and same_details)


def _get_pending_retail_dates(retail_service: RetailSettlementService) -> List[str]:
    wholesale_dates = sorted(set(DATABASE["settlement_daily"].distinct("operating_date")))
    latest_retail_doc = DATABASE["retail_settlement_daily"].find_one(
        {"settlement_type": "daily"},
        projection={"date": 1},
        sort=[("date", -1)]
    )
    cutoff_date = latest_retail_doc.get("date") if latest_retail_doc else None
    pending_dates: List[str] = []
    for date_str in wholesale_dates:
        if cutoff_date and date_str <= cutoff_date:
            continue
        expected_count = len(retail_service.contract_service.get_active_customers(date_str, date_str))
        if expected_count == 0:
            continue
        actual_count = DATABASE["retail_settlement_daily"].count_documents({
            "date": date_str,
            "settlement_type": "daily"
        })
        if actual_count < expected_count:
            pending_dates.append(date_str)
    return pending_dates


async def event_driven_settlement_job() -> None:
    """事件驱动结算任务。"""
    logger.info("开始执行事件驱动结算任务")

    settlement_service = SettlementService()
    retail_service = RetailSettlementService()

    new_preliminary = 0
    new_platform_daily = 0
    new_retail = 0
    blocked_entries: List[Dict[str, Any]] = []
    error_entries: List[Dict[str, Any]] = []

    try:
        preliminary_dates = settlement_service.get_pending_dates(SettlementVersion.PRELIMINARY)
        platform_dates = settlement_service.get_pending_dates(SettlementVersion.PLATFORM_DAILY)

        for date_str in preliminary_dates:
            logger.info("开始检查预结算日期: %s", date_str)
            try:
                result = await settlement_service.run_daily_settlement(
                    date_str=date_str,
                    version=SettlementVersion.PRELIMINARY,
                    force=False
                )
                if result["success"]:
                    if result.get("is_new_calculation"):
                        new_preliminary += 1
                elif result.get("status") == "BLOCKED":
                    blocked_entries.append({
                        "process": "PRELIMINARY",
                        "date": date_str,
                        "version": SettlementVersion.PRELIMINARY.value,
                        "missing_items": result.get("missing_items", []),
                        "message": result.get("message"),
                    })
                else:
                    error_entries.append({
                        "process": "PRELIMINARY",
                        "date": date_str,
                        "message": result.get("message", "预结算执行失败"),
                    })
            except Exception as exc:
                logger.error("预结算执行异常 date=%s err=%s", date_str, exc, exc_info=True)
                error_entries.append({
                    "process": "PRELIMINARY",
                    "date": date_str,
                    "message": str(exc),
                })

        for date_str in platform_dates:
            logger.info("开始检查平台日结日期: %s", date_str)
            try:
                result = await settlement_service.run_daily_settlement(
                    date_str=date_str,
                    version=SettlementVersion.PLATFORM_DAILY,
                    force=False
                )
                if result["success"]:
                    if result.get("is_new_calculation"):
                        new_platform_daily += 1
                elif result.get("status") == "BLOCKED":
                    blocked_entries.append({
                        "process": "PLATFORM_DAILY",
                        "date": date_str,
                        "version": SettlementVersion.PLATFORM_DAILY.value,
                        "missing_items": result.get("missing_items", []),
                        "message": result.get("message"),
                    })
                else:
                    error_entries.append({
                        "process": "PLATFORM_DAILY",
                        "date": date_str,
                        "message": result.get("message", "平台日结执行失败"),
                    })
            except Exception as exc:
                logger.error("平台日结执行异常 date=%s err=%s", date_str, exc, exc_info=True)
                error_entries.append({
                    "process": "PLATFORM_DAILY",
                    "date": date_str,
                    "message": str(exc),
                })

        retail_dates = _get_pending_retail_dates(retail_service)
        for date_str in retail_dates:
            logger.info("开始检查零售日结日期: %s", date_str)
            try:
                wholesale_doc = DATABASE["settlement_daily"].find_one(
                    {"operating_date": date_str, "version": SettlementVersion.PLATFORM_DAILY.value},
                    projection={"_id": 1}
                )
                if not wholesale_doc:
                    wholesale_doc = DATABASE["settlement_daily"].find_one(
                        {"operating_date": date_str, "version": SettlementVersion.PRELIMINARY.value},
                        projection={"_id": 1}
                    )
                if not wholesale_doc:
                    blocked_entries.append({
                        "process": "RETAIL_DAILY",
                        "date": date_str,
                        "version": "RETAIL_DAILY",
                        "missing_items": ["wholesale_settlement_daily"],
                        "message": "缺少批发侧日结结果",
                    })
                    continue

                retail_result = retail_service.calculate_all_customers_daily(date_str)
                new_retail += retail_result.get("new_processed", 0)
            except Exception as exc:
                logger.error("零售日结执行异常 date=%s err=%s", date_str, exc, exc_info=True)
                error_entries.append({
                    "process": "RETAIL_DAILY",
                    "date": date_str,
                    "message": str(exc),
                })

        blocked_normalized = _normalize_blocked_entries(blocked_entries)
        signature = json.dumps(blocked_normalized, ensure_ascii=False, sort_keys=True)
        error_count = len(error_entries)
        blocked_count = len(blocked_entries)
        total_new = new_preliminary + new_platform_daily + new_retail

        if error_count > 0:
            status = "FAILED"
        elif blocked_count > 0:
            status = "PARTIAL"
        elif total_new > 0:
            status = "SUCCESS"
        else:
            status = "SKIPPED"

        summary = (
            f"结算刷新完成: 预结算={new_preliminary}, 平台日结={new_platform_daily}, "
            f"零售日结={new_retail}, 阻塞={blocked_count}, 异常={error_count}"
        )
        details = {
            "new_preliminary": new_preliminary,
            "new_platform_daily": new_platform_daily,
            "new_retail": new_retail,
            "blocked_count": blocked_count,
            "error_count": error_count,
            "blocked_samples": blocked_normalized[:10],
            "error_samples": error_entries[:10],
            "signature": signature,
        }

        if total_new > 0 or error_count > 0 or blocked_count > 0:
            if _should_persist_log(status, details):
                task_id = await TaskLogger.log_task_start(
                    service_type="settlement_service",
                    task_type="event_driven_settlement",
                    task_name="事件驱动结算刷新",
                    trigger_type="schedule"
                )
                await TaskLogger.log_task_end(
                    task_id,
                    status,
                    summary=summary,
                    details=details
                )
            else:
                logger.info("事件驱动结算结果与上一条一致，跳过写入任务日志")
        else:
            logger.info("事件驱动结算无新增、无阻塞、无异常，跳过写入任务日志")

    except Exception as exc:
        logger.error("事件驱动结算任务执行失败: %s", exc, exc_info=True)
        task_id = await TaskLogger.log_task_start(
            service_type="settlement_service",
            task_type="event_driven_settlement",
            task_name="事件驱动结算刷新",
            trigger_type="schedule"
        )
        await TaskLogger.log_task_end(
            task_id,
            "FAILED",
            summary="事件驱动结算任务执行失败",
            error={"message": str(exc)}
        )

    logger.info("事件驱动结算任务执行结束")
