# -*- coding: utf-8 -*-
"""储能申报策略自动化任务。"""

import logging
from datetime import datetime, time, timedelta
from typing import Any, Dict

from webapp.scheduler.logger import TaskLogger
from webapp.services.storage_declaration_service import StorageDeclarationService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

TASK_TYPE_STORAGE_DECLARATION_GENERATION = "storage_declaration_generation"
GENERATION_START_TIME = time(9, 30)


def _today_range(now: datetime) -> Dict[str, datetime]:
    start = datetime.combine(now.date(), time.min)
    end = start + timedelta(days=1)
    return {"start": start, "end": end}


def _has_generation_success_today(now: datetime) -> bool:
    day_range = _today_range(now)
    return DATABASE["task_execution_logs"].find_one({
        "task_type": TASK_TYPE_STORAGE_DECLARATION_GENERATION,
        "status": "SUCCESS",
        "details.generation.generated_count": {"$gt": 0},
        "start_time": {
            "$gte": day_range["start"],
            "$lt": day_range["end"],
        },
    }) is not None


def _build_task_status(generation: Dict[str, Any], review: Dict[str, Any]) -> str:
    error_count = generation.get("error_count", 0) + review.get("error_count", 0)
    success_count = generation.get("generated_count", 0) + review.get("reviewed_count", 0)
    blocked_count = generation.get("blocked_count", 0) + review.get("blocked_count", 0)
    if error_count > 0:
        return "PARTIAL" if success_count > 0 else "FAILED"
    if success_count > 0:
        return "SUCCESS"
    if blocked_count > 0:
        return "PARTIAL"
    return "SKIPPED"


async def event_driven_storage_declaration_generation_job() -> None:
    """9:30 后检查目标日预测价格，并回填已具备条件的复盘结果。"""
    now = datetime.now()
    target_date = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    service = StorageDeclarationService(DATABASE)

    task_id = ""
    try:
        if now.time() < GENERATION_START_TIME:
            generation_result: Dict[str, Any] = {
                "target_date": target_date,
                "generated_count": 0,
                "skipped_count": 1,
                "blocked_count": 0,
                "error_count": 0,
                "generated": [],
                "skipped": [{"reason": "未到申报自动生成启动时间"}],
                "blocked": [],
                "errors": [],
            }
        elif _has_generation_success_today(now):
            generation_result: Dict[str, Any] = {
                "target_date": target_date,
                "generated_count": 0,
                "skipped_count": 1,
                "blocked_count": 0,
                "error_count": 0,
                "generated": [],
                "skipped": [{"reason": "当天已成功生成申报"}],
                "blocked": [],
                "errors": [],
            }
        else:
            generation_result = service.auto_generate_declarations(
                target_date=target_date,
                operator="system",
                overwrite=False,
            )

        latest_review_target_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        review_result = service.auto_simulate_reviews(
            operator="system",
            latest_target_date=latest_review_target_date,
        )
        status = _build_task_status(generation_result, review_result)

        generation_waiting_for_price = (
            generation_result.get("generated_count", 0) == 0
            and generation_result.get("error_count", 0) == 0
            and generation_result.get("blocked_count", 0) > 0
            and all(item.get("reason") == "目标日预测价格未生成" for item in generation_result.get("blocked", []))
        )
        review_waiting_for_data = (
            review_result.get("reviewed_count", 0) == 0
            and review_result.get("error_count", 0) == 0
            and review_result.get("blocked_count", 0) > 0
        )

        # 两个阶段都只是等待数据时不写任务日志，等待下一个轮询周期继续检查。
        if generation_waiting_for_price and review_waiting_for_data:
            logger.info(
                "储能申报预测价格或复盘数据未就绪，等待下次轮询: generation_target_date=%s review_blocked=%s",
                target_date,
                review_result.get("blocked_count", 0),
            )
            return
        if generation_waiting_for_price and review_result.get("reviewed_count", 0) == 0 and review_result.get("error_count", 0) == 0:
            logger.info("储能申报目标日预测价格未就绪，等待下次轮询: target_date=%s", target_date)
            return
        if (
            review_waiting_for_data
            and generation_result.get("generated_count", 0) == 0
            and generation_result.get("error_count", 0) == 0
            and generation_result.get("blocked_count", 0) == 0
        ):
            logger.info(
                "储能复盘数据未就绪，等待下次轮询: review_blocked=%s",
                review_result.get("blocked_count", 0),
            )
            return

        # 没有新增、没有阻塞、没有异常时也不写日志，避免 interval 任务刷屏。
        if status == "SKIPPED":
            logger.info(
                "储能申报与复盘回填均无新增，跳过写入任务日志: target_date=%s generation_skipped=%s review_skipped=%s",
                target_date,
                generation_result.get("skipped_count", 0),
                review_result.get("skipped_count", 0),
            )
            return

        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type=TASK_TYPE_STORAGE_DECLARATION_GENERATION,
            task_name="储能申报策略自动生成与复盘回填",
            trigger_type="schedule",
        )
        await TaskLogger.log_task_end(
            task_id=task_id,
            status=status,
            summary=(
                f"储能自动任务完成: 申报目标日={target_date}, "
                f"生成={generation_result.get('generated_count', 0)}, "
                f"复盘={review_result.get('reviewed_count', 0)}, "
                f"阻塞={generation_result.get('blocked_count', 0) + review_result.get('blocked_count', 0)}, "
                f"异常={generation_result.get('error_count', 0) + review_result.get('error_count', 0)}"
            ),
            details={
                "generation": generation_result,
                "review": review_result,
            },
        )
    except Exception as exc:
        logger.error("储能申报自动生成与复盘回填任务失败: %s", exc, exc_info=True)
        if not task_id:
            task_id = await TaskLogger.log_task_start(
                service_type="web",
                task_type=TASK_TYPE_STORAGE_DECLARATION_GENERATION,
                task_name="储能申报策略自动生成与复盘回填",
                trigger_type="schedule",
            )
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="FAILED",
            summary=f"储能申报自动生成与复盘回填失败: {exc}",
            error={"message": str(exc)},
        )
        raise
