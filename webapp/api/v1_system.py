# -*- coding: utf-8 -*-
"""
系统管理相关API
"""
import logging
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user
from webapp.api.dependencies.authz import require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["系统管理"])


# ========== 数据模型 ==========

class AlertItem(BaseModel):
    alert_id: Optional[str] = None
    level: str
    category: str
    title: str
    content: str
    detail_content: Optional[str] = None
    status: str
    service_type: Optional[str] = None
    task_type: Optional[str] = None
    related_task_id: Optional[str] = None
    created_at: datetime
    context: Optional[dict] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    resolution_note: Optional[str] = None


class TaskLogItem(BaseModel):
    task_id: str
    task_name: str
    task_type: str
    service_type: Optional[str] = None
    trigger_type: Optional[str] = None
    status: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration: Optional[float] = None
    summary: Optional[str] = None
    details: Optional[dict] = None
    error: Optional[dict] = None


class CommandItem(BaseModel):
    command_id: str
    command: str
    task_type: str
    service_type: Optional[str] = None
    status: str
    parameters: Optional[dict] = None
    priority: int = 0
    created_at: datetime
    created_by: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result_message: Optional[str] = None


class AlertsResponse(BaseModel):
    total: int
    alerts: List[AlertItem]


class TaskLogsResponse(BaseModel):
    total: int
    logs: List[TaskLogItem]


class CommandsResponse(BaseModel):
    total: int
    commands: List[CommandItem]


class FilterOptionsResponse(BaseModel):
    """筛选选项响应"""
    task_types: List[str]
    statuses: List[str]
    levels: List[str] = []
    commands: List[str] = []


class ResolveAlertRequest(BaseModel):
    resolution_note: str


# ========== API 接口 ==========

@router.get("/filter-options")
async def get_filter_options(
    current_user: dict = Depends(get_current_active_user)
):
    """获取筛选选项(从数据库动态获取)"""
    try:
        # 获取告警的级别和状态
        alert_levels = DATABASE["system_alerts"].distinct("level")
        alert_statuses = DATABASE["system_alerts"].distinct("status")
        alert_task_types = DATABASE["system_alerts"].distinct("task_type")
        
        # 获取任务日志的任务类型和状态
        log_task_types = DATABASE["task_execution_logs"].distinct("task_type")
        log_statuses = DATABASE["task_execution_logs"].distinct("status")
        
        # 获取远程指令的指令类型、任务类型和状态
        command_types = DATABASE["task_commands"].distinct("command")
        command_task_types = DATABASE["task_commands"].distinct("task_type")
        command_statuses = DATABASE["task_commands"].distinct("status")
        
        return {
            "alerts": {
                "levels": sorted([l for l in alert_levels if l]),
                "statuses": sorted([s for s in alert_statuses if s]),
                "task_types": sorted([t for t in alert_task_types if t])
            },
            "logs": {
                "task_types": sorted([t for t in log_task_types if t]),
                "statuses": sorted([s for s in log_statuses if s])
            },
            "commands": {
                "commands": sorted([c for c in command_types if c]),
                "task_types": sorted([t for t in command_task_types if t]),
                "statuses": sorted([s for s in command_statuses if s])
            }
        }
    
    except Exception as e:
        logger.error(f"获取筛选选项失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts", response_model=AlertsResponse)
async def get_alerts(
    date: Optional[str] = Query(None, description="日期 YYYY-MM-DD (可选,不传则获取所有)"),
    status: Optional[str] = Query(None, description="状态筛选: ACTIVE, RESOLVED"),
    level: Optional[str] = Query(None, description="级别筛选: P1, P2, P3"),
    task_type: Optional[str] = Query(None, description="任务类型筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    sort_field: str = Query("created_at", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向: asc, desc"),
    current_user: dict = Depends(get_current_active_user)
):
    """获取告警列表"""
    try:
        # 构建查询条件
        query = {}
        
        # 日期筛选(可选)
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            next_date = target_date + timedelta(days=1)
            query["created_at"] = {"$gte": target_date, "$lt": next_date}
        
        if status:
            query["status"] = status
        
        if level:
            query["level"] = level
        
        if task_type:
            query["task_type"] = task_type
        
        # 计算总数
        total = DATABASE["system_alerts"].count_documents(query)
        
        # 排序方向
        sort_dir = 1 if sort_order == "asc" else -1
        
        # 查询数据(分页)
        skip = (page - 1) * page_size
        raw_alerts = list(DATABASE["system_alerts"].find(
            query
        ).sort(sort_field, sort_dir).skip(skip).limit(page_size))
        
        # 处理缺失字段并转换数据
        alerts = []
        for doc in raw_alerts:
            # 补全 alert_id (如果缺失则使用 _id)
            if not doc.get("alert_id"):
                doc["alert_id"] = str(doc["_id"])
            
            # 补全 task_type (如果缺失则设为 UNKNOWN)
            if not doc.get("task_type"):
                doc["task_type"] = "UNKNOWN"
            
            # 移除 _id 以符合 AlertItem 模型
            if "_id" in doc:
                del doc["_id"]
            
            alerts.append(doc)
        
        return {
            "total": total,
            "alerts": alerts
        }
    
    except Exception as e:
        logger.error(f"获取告警列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task-logs", response_model=TaskLogsResponse)
async def get_task_logs(
    date: Optional[str] = Query(None, description="日期 YYYY-MM-DD (可选,不传则获取所有)"),
    status: Optional[str] = Query(None, description="状态筛选: RUNNING, SUCCESS, FAILED, PARTIAL"),
    task_type: Optional[str] = Query(None, description="任务类型筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    sort_field: str = Query("start_time", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向: asc, desc"),
    current_user: dict = Depends(get_current_active_user)
):
    """获取任务执行日志"""
    try:
        # 构建查询条件
        query = {}
        
        # 日期筛选(可选)
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            next_date = target_date + timedelta(days=1)
            query["start_time"] = {"$gte": target_date, "$lt": next_date}
        
        if status:
            query["status"] = status
        
        if task_type:
            query["task_type"] = task_type
        
        # 计算总数
        total = DATABASE["task_execution_logs"].count_documents(query)
        
        # 排序方向
        sort_dir = 1 if sort_order == "asc" else -1
        
        # 查询数据(分页)
        skip = (page - 1) * page_size
        logs = list(DATABASE["task_execution_logs"].find(
            query,
            {"_id": 0}
        ).sort(sort_field, sort_dir).skip(skip).limit(page_size))
        
        return {
            "total": total,
            "logs": logs
        }
    
    except Exception as e:
        logger.error(f"获取任务日志失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/commands", response_model=CommandsResponse)
async def get_commands(
    date: Optional[str] = Query(None, description="日期 YYYY-MM-DD (可选,不传则获取所有)"),
    status: Optional[str] = Query(None, description="状态筛选: PENDING, RUNNING, SUCCESS, FAILED"),
    task_type: Optional[str] = Query(None, description="任务类型筛选"),
    command: Optional[str] = Query(None, description="指令类型筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    sort_field: str = Query("created_at", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向: asc, desc"),
    current_user: dict = Depends(get_current_active_user)
):
    """获取远程指令列表"""
    try:
        # 构建查询条件
        query = {}
        
        # 日期筛选(可选)
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            next_date = target_date + timedelta(days=1)
            query["created_at"] = {"$gte": target_date, "$lt": next_date}
        
        if status:
            query["status"] = status
        
        if task_type:
            query["task_type"] = task_type
        
        if command:
            query["command"] = command
        
        # 计算总数
        total = DATABASE["task_commands"].count_documents(query)
        
        # 排序方向
        sort_dir = 1 if sort_order == "asc" else -1
        
        # 查询数据(分页)
        skip = (page - 1) * page_size
        commands = list(DATABASE["task_commands"].find(
            query,
            {"_id": 0}
        ).sort(sort_field, sort_dir).skip(skip).limit(page_size))
        
        return {
            "total": total,
            "commands": commands
        }
    
    except Exception as e:
        logger.error(f"获取远程指令列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    request: ResolveAlertRequest,
    current_user: dict = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:system_logs:edit"))
):
    """解决告警"""
    try:
        # 支持通过 alert_id 或 ObjectId 匹配
        from bson import ObjectId
        
        query = {"alert_id": alert_id}
        # 如果 alert_id 看起来像 ObjectId, 也尝试作为 _id 查询
        if len(alert_id) == 24:
            try:
                query = {"$or": [
                    {"alert_id": alert_id},
                    {"_id": ObjectId(alert_id)}
                ]}
            except:
                pass

        result = DATABASE["system_alerts"].update_one(
            query,
            {
                "$set": {
                    "status": "RESOLVED",
                    "resolved_at": datetime.now(),
                    "resolved_by": current_user.get("username"),
                    "resolution_note": request.resolution_note
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="告警不存在")
        
        return {"message": "告警已解决"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"解决告警失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
