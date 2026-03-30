# -*- coding: utf-8 -*-
"""
调度器核心模块

管理所有定时任务和事件驱动任务
"""
import os
import logging
import configparser
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.executors.asyncio import AsyncIOExecutor

from webapp.scheduler.jobs.aggregation_jobs import (
    event_driven_load_aggregation_job
)
from webapp.scheduler.jobs.accuracy_jobs import (
    event_driven_accuracy_job
)
from webapp.scheduler.jobs.settlement_jobs import (
    event_driven_settlement_job
)
from webapp.scheduler.jobs.characteristics_jobs import (
    event_driven_characteristics_analysis_job
)
from webapp.scheduler.jobs.auth_jobs import (
    event_driven_auth_session_cleanup_job
)
from webapp.scheduler.jobs.dashboard_jobs import (
    event_driven_dashboard_snapshot_job
)

logger = logging.getLogger(__name__)

# 创建调度器实例
scheduler = AsyncIOScheduler(
    jobstores={"default": MemoryJobStore()},
    executors={"default": AsyncIOExecutor()},
    job_defaults={
        "coalesce": True,  # 合并错过的任务
        "max_instances": 1,  # 每个任务最多1个实例
        "misfire_grace_time": 60  # 错过任务的宽限时间(秒)
    }
)


def get_scheduler_enabled() -> bool:
    """从配置文件读取调度器开关"""
    config_path = os.path.expanduser("~/.exds/config.ini")
    if os.path.exists(config_path):
        config = configparser.ConfigParser()
        config.read(config_path, encoding='utf-8')
        if "SCHEDULER" in config and "enabled" in config["SCHEDULER"]:
            return config.getboolean("SCHEDULER", "enabled", fallback=True)
    return True

def setup_scheduler(app):
    """
    设置调度器并注册任务
    
    Args:
        app: FastAPI 应用实例
    """
    if not get_scheduler_enabled():
        logger.warning("⚙️ 定时任务已被配置禁用 ([SCHEDULER] enabled = false)，本实例将不运行定时任务。")
        return
    
    # ========== 事件驱动任务 ==========
    
    # 负荷数据聚合 (每5分钟检查 RPA 下载状态)
    scheduler.add_job(
        event_driven_load_aggregation_job,
        'interval',
        minutes=5,
        id='web_event_load_aggregation',
        replace_existing=True
    )

    # 预测准确度计算 (每10分钟检查日程出清数据下载状态)
    scheduler.add_job(
        event_driven_accuracy_job,
        'interval',
        minutes=10,
        id='web_event_forecast_accuracy',
        replace_existing=True
    )

    # 预结算计算 (每10分钟检查数据完整性)
    scheduler.add_job(
        event_driven_settlement_job,
        'interval',
        minutes=10,
        id='web_event_settlement_calc',
        replace_existing=True
    )

    # 客户特征画像分析 (每15分钟检查负荷聚合状态)
    scheduler.add_job(
        event_driven_characteristics_analysis_job,
        'interval',
        minutes=15,
        id='web_event_characteristics_analysis',
        replace_existing=True
    )

    # 认证会话清理 (每2分钟清理超时/过期会话)
    scheduler.add_job(
        event_driven_auth_session_cleanup_job,
        'interval',
        minutes=2,
        id='web_event_auth_session_cleanup',
        replace_existing=True
    )

    # 交易总览首页快照 (每5分钟检查结果数据签名)
    scheduler.add_job(
        event_driven_dashboard_snapshot_job,
        'interval',
        minutes=5,
        id='web_event_dashboard_snapshot',
        replace_existing=True
    )
    
    # ========== 生命周期管理 ==========
    
    @app.on_event("startup")
    async def start_scheduler():
        """启动调度器"""
        scheduler.start()
        jobs = scheduler.get_jobs()
        logger.info("✅ APScheduler 已启动")
        logger.info(f"📋 已注册 {len(jobs)} 个定时任务:")
        for job in jobs:
            logger.info(f"  - {job.id}: {job.next_run_time}")
    
    @app.on_event("shutdown")
    async def stop_scheduler():
        """停止调度器"""
        scheduler.shutdown()
        logger.info("🛑 APScheduler 已停止")
