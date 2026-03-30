# -*- coding: utf-8 -*-
"""交易总览首页快照任务。"""

import logging

from webapp.scheduler.logger import TaskLogger
from webapp.services.dashboard_snapshot_service import DashboardSnapshotService

logger = logging.getLogger(__name__)


async def event_driven_dashboard_snapshot_job() -> None:
    """定期检查结果数据签名，必要时重建首页快照。"""
    service = DashboardSnapshotService()
    task_id = await TaskLogger.log_task_start(
        service_type="web",
        task_type="dashboard_snapshot",
        task_name="交易总览首页快照刷新",
        trigger_type="schedule",
    )
    try:
        result = service.refresh_snapshot(force=False)
        await TaskLogger.log_task_end(
            task_id=task_id,
            status=result["status"],
            summary=f"交易总览首页快照{('已更新' if result['status'] == 'SUCCESS' else '无需更新')}",
            details={
                "snapshot_id": result["summary"].get("snapshot_id"),
                "month": result["summary"].get("month"),
                "generated_at": result["summary"].get("generated_at"),
                "signature": result.get("signature"),
            },
        )
    except Exception as exc:
        logger.error("交易总览首页快照刷新失败: %s", exc, exc_info=True)
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="FAILED",
            summary=f"交易总览首页快照刷新失败: {exc}",
            error={"message": str(exc)},
        )
        raise
