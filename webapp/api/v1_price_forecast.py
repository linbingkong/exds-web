"""
价格预测 API 路由

提供日前价格预测结果的 RESTful API 接口。
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from webapp.tools.mongo import DATABASE
from webapp.services.price_forecast_service import PriceForecastService
from webapp.api.dependencies.authz import require_permission
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/price-forecast", tags=["Price Forecast"])

# 初始化服务
_service: Optional[PriceForecastService] = None


def get_service() -> PriceForecastService:
    """获取或创建服务实例"""
    global _service
    if _service is None:
        _service = PriceForecastService(DATABASE)
    return _service


@router.get(
    "/versions",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取预测版本列表",
    description="""
    获取指定目标日期的所有预测版本。

    返回按创建时间降序排列的版本列表，包含：
    - forecast_id: 预测批次ID
    - forecast_type: 预测类型
    - model_version: 模型版本
    - model_type: 模型类型
    - created_at: 创建时间
    """
)
def get_versions(
    target_date: str = Query(..., description="目标日期, 格式 YYYY-MM-DD"),
    forecast_type: str = Query("d1_price", description="预测类型: d1_price")
) -> List[Dict[str, Any]]:
    """获取预测版本列表"""
    try:
        service = get_service()
        result = service.get_versions(target_date, forecast_type)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取预测版本列表失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/data",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取图表数据",
    description="""
    获取指定预测版本的图表数据，包含预测曲线和实际曲线。

    返回96个时间点的数据，每个点包含：
    - time: 时间标签 (00:15 ~ 24:00)
    - predicted_price: 预测价格
    - actual_price: 实际价格 (可能为 null)
    - confidence_80_lower: 80%置信区间下界
    - confidence_80_upper: 80%置信区间上界
    """
)
def get_chart_data(
    forecast_id: str = Query(..., description="预测批次ID"),
    target_date: str = Query(..., description="目标日期, 格式 YYYY-MM-DD")
) -> List[Dict[str, Any]]:
    """获取图表数据"""
    try:
        service = get_service()
        result = service.get_chart_data(forecast_id, target_date)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取图表数据失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/accuracy",
    response_model=Optional[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取准确度评估",
    description="""
    获取指定预测版本的准确度评估数据。

    返回包含以下指标的评估结果：
    - wmape_accuracy: WMAPE准确率
    - mae: 平均绝对误差
    - rmse: 均方根误差
    - r2: R²决定系数
    - direction_accuracy: 方向准确率
    - period_accuracy: 分时段准确率
    - stats: 当日统计信息
    - rate_90_pass: 是否达90%准确率
    - rate_85_pass: 是否达85%准确率

    如果暂无评估数据，返回 null。
    """
)
def get_accuracy(
    forecast_id: str = Query(..., description="预测批次ID"),
    target_date: Optional[str] = Query(None, description="目标日期, 格式 YYYY-MM-DD")
) -> Optional[Dict[str, Any]]:
    """获取准确度评估"""
    try:
        service = get_service()
        result = service.get_accuracy(forecast_id, target_date)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取准确度评估失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/accuracy-history",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取历史准确率曲线",
    description="""
    获取指定日期区间内的历史 WMAPE 准确率曲线。

    返回规则：
    - 按 target_date 聚合
    - 若同一天有多个版本，取 calculated_at 最新的一条
    """
)
def get_accuracy_history(
    start_date: str = Query(..., description="开始日期, 格式 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期, 格式 YYYY-MM-DD"),
    forecast_type: str = Query("d1_price", description="预测类型: d1_price")
) -> List[Dict[str, Any]]:
    """获取历史准确率曲线"""
    try:
        service = get_service()
        result = service.get_accuracy_history(start_date, end_date, forecast_type)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取历史准确率曲线失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/max-available-date",
    response_model=Dict[str, str],
    status_code=status.HTTP_200_OK,
    summary="获取最大可用日期",
    description="返回日前价格预测页面当前可选择的最大日期。"
)
def get_max_available_date() -> Dict[str, str]:
    """获取最大可用日期"""
    try:
        service = get_service()
        return {"max_available_date": service.get_max_available_date()}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取最大可用日期失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


# ============ 预测触发相关 API ============

class TriggerRequest(BaseModel):
    """触发预测任务的请求体"""
    target_date: str


@router.get(
    "/data-check",
    status_code=status.HTTP_200_OK,
    summary="检查预测基础数据条数",
    description="检查指定日期的 daily_release 数据条数，用于判断是否可以触发预测任务。"
)
async def check_data_availability(
    target_date: str = Query(..., description="目标日期, 格式 YYYY-MM-DD")
) -> Dict[str, Any]:
    """检查 daily_release 数据条数"""
    try:
        # 解析日期
        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        start_of_day = target_dt
        end_of_day = target_dt + timedelta(days=1)

        # 查询 daily_release 集合中指定日期的记录数
        count = DATABASE["daily_release"].count_documents({
            "datetime": {"$gte": start_of_day, "$lt": end_of_day}
        })

        return {
            "target_date": target_date,
            "count": count,
            "is_sufficient": count > 90
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"日期格式错误: {e}")
    except Exception as e:
        logger.error(f"检查数据条数失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.post(
    "/trigger",
    status_code=status.HTTP_200_OK,
    summary="触发预测任务",
    description="向 task_commands 集合插入预测命令，触发后台预测任务执行。"
)
async def trigger_forecast(
    request: TriggerRequest,
    _ctx = Depends(require_permission("module:forecast_dayahead_price:edit")),
) -> Dict[str, Any]:
    """触发预测任务"""
    try:
        target_date = request.target_date
        task_type = "d1_price"
        command_col = DATABASE["task_commands"]

        # 检查是否存在未完成的同类型命令（5分钟内）
        existing = command_col.find_one({
            "task_type": task_type,
            "status": {"$in": ["pending", "running"]},
            "created_at": {"$gte": datetime.now() - timedelta(minutes=5)}
        })

        if existing:
            return {
                "success": False,
                "message": "已有相同任务在执行中，请等待完成",
                "existing_command_id": existing["command_id"],
                "status": existing["status"],
                "created_at": existing["created_at"].isoformat()
            }

        # 插入新命令
        command_id = f"{task_type}_manual_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        doc = {
            "command_id": command_id,
            "command": "run",
            "task_type": task_type,
            "service_type": "forecast",
            "status": "pending",
            "parameters": {"target_date": target_date},
            "priority": 1,
            "created_at": datetime.now(),
            "created_by": "web_user"
        }

        command_col.insert_one(doc)
        logger.info(f"已创建预测命令: {command_id}, 目标日期: {target_date}")

        return {
            "success": True,
            "message": "命令已发送，预计1-2分钟内开始执行",
            "command_id": command_id
        }
    except Exception as e:
        logger.error(f"触发预测任务失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/command/{command_id}",
    status_code=status.HTTP_200_OK,
    summary="查询命令状态",
    description="查询预测命令的执行状态。"
)
async def get_command_status(command_id: str) -> Dict[str, Any]:
    """查询命令状态"""
    try:
        command_col = DATABASE["task_commands"]
        doc = command_col.find_one({"command_id": command_id})

        if not doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="命令不存在"
            )

        return {
            "command_id": doc["command_id"],
            "task_type": doc["task_type"],
            "status": doc["status"],
            "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
            "started_at": doc["started_at"].isoformat() if doc.get("started_at") else None,
            "completed_at": doc["completed_at"].isoformat() if doc.get("completed_at") else None,
            "result_message": doc.get("result_message"),
            "error_message": doc.get("error_message"),
            "result": doc.get("result"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询命令状态失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )
