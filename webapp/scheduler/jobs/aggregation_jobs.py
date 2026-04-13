# -*- coding: utf-8 -*-
"""
负荷数据聚合任务

事件驱动的自动聚合任务,监听 RPA 下载成功事件,自动触发数据聚合
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Set
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.scheduler.logger import TaskLogger
from webapp.services.contract_service import ContractService
from webapp.services.load_aggregation_service import LoadAggregationService

EXPECTED_MPS_LOOKBACK_DAYS = 10
MISSING_MP_ACTIVITY_LOOKBACK_DAYS = 3

async def _get_active_customers(date_str: str) -> list:
    """
    获取指定日期所在月份的有效签约客户
    
    Args:
        date_str: YYYY-MM-DD
        
    Returns:
        [{"customer_id": str, "customer_name": str}, ...]
    """
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        # 当月第一天
        start_of_month = datetime(dt.year, dt.month, 1)
        # 下个月第一天 (即当月结束时间点)
        if dt.month == 12:
            next_month = datetime(dt.year + 1, 1, 1)
        else:
            next_month = datetime(dt.year, dt.month + 1, 1)
            
        end_of_month = next_month - timedelta(seconds=1)
        
        contract_service = ContractService(DATABASE)
        # 获取重叠的客户信息
        return contract_service.get_signed_customers_in_range(start_of_month, end_of_month)
        
    except Exception as e:
        logger.error(f"查询活跃客户失败: {e}")
        return []

logger = logging.getLogger(__name__)

# ========== 内存缓存 ==========

# 全局缓存: {task_key: {"date": "YYYY-MM-DD", "status": "SUCCESS/FAILED"}}
# 示例: {"load_aggregation": {"date": "2026-02-03", "status": "SUCCESS"}}
_daily_execution_cache: Dict[str, Dict[str, str]] = {}


def _is_executed_today(task_key: str, date: str) -> bool:
    """
    检查今天是否已执行过 (优先查缓存,缓存未命中则查数据库)
    
    Args:
        task_key: 任务标识 (如 "load_aggregation")
        date: 日期 (YYYY-MM-DD)
    
    Returns:
        True: 今天已执行过 (SUCCESS 或 FAILED)
        False: 今天还没执行
    """
    # 1. 检查缓存是否存在且日期匹配
    if task_key in _daily_execution_cache:
        cached_date = _daily_execution_cache[task_key].get("date")
        
        # 如果日期不同,清空缓存 (跨天自动重置)
        if cached_date != date:
            logger.debug(f"日期变更: {cached_date} -> {date}, 清空缓存")
            _daily_execution_cache[task_key] = {}
        elif "status" in _daily_execution_cache[task_key]:
            # 日期匹配且有状态,缓存命中
            status = _daily_execution_cache[task_key]["status"]
            logger.debug(f"缓存命中: {task_key}:{date} = {status}")
            return True
    
    # 2. 缓存未命中,查询数据库
    logger.debug(f"缓存未命中,查询数据库: {task_key}:{date}")
    
    record = DATABASE["task_execution_logs"].find_one({
        "task_type": task_key,
        "trigger_type": "event",
        "status": {"$in": ["SUCCESS", "FAILED"]},
        "start_time": {
            "$gte": datetime.strptime(date, "%Y-%m-%d"),
            "$lt": datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)
        }
    })
    
    if record:
        # 查到记录,写入缓存
        status = record["status"]
        _mark_executed(task_key, date, status)
        logger.debug(f"数据库查询结果: {task_key}:{date} = {status}, 已写入缓存")
        return True
    
    logger.debug(f"数据库查询结果: {task_key}:{date} = 未执行")
    return False


def _mark_executed(task_key: str, date: str, status: str):
    """
    标记任务已执行 (写入缓存)
    
    Args:
        task_key: 任务标识
        date: 日期 (YYYY-MM-DD)
        status: 状态 (SUCCESS/FAILED)
    """
    _daily_execution_cache[task_key] = {
        "date": date,
        "status": status
    }
    logger.debug(f"缓存已更新: {task_key}:{date} = {status}")





# ========== 事件驱动任务 ==========

async def event_driven_load_aggregation_job():
    """
    事件驱动的负荷数据聚合任务
    
    触发频率: 每5分钟检查一次 RPA 下载状态
    执行策略: 每天00:00起开始检查, 且每天只执行一次 (使用内存缓存优化)
    """
    try:
        now = datetime.now()

        today = now.strftime("%Y-%m-%d")
        
        # 1. 检查今天是否已执行过 (优先查缓存)
        if _is_executed_today("load_aggregation", today):
            # 今天已执行过,静默跳过
            return
        
        # 2. 查询 RPA 下载成功记录
        rpa_record = DATABASE["task_execution_records"].find_one({
            "pipeline_name": "计量点负荷曲线",
            "status": "SUCCESS",
            "execution_date": today
        })
        
        if not rpa_record:
            # RPA 还没下载成功,静默跳过 (不记录日志,不告警)
            logger.debug(f"今天暂无 RPA 下载成功记录, 继续等待")
            return
        
        # 3. 发现 RPA 下载成功且今天还没聚合,开始执行
        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type="load_aggregation",
            task_name="负荷数据聚合 (事件驱动)",
            trigger_type="event"
        )
        
        # 4. 执行聚合
        result = await _aggregate_all_customers(today)
        
        # 5. 检查计量点发布异常
        mp_alert_analysis = await _analyze_mp_publication_alerts(today, rpa_record)
        result["mp_alert_analysis"] = mp_alert_analysis
        if mp_alert_analysis.get("missing_alert_needed"):
            await _create_alert(
                level="P1",
                category="DATA_QUALITY",
                title=f"计量点缺失({mp_alert_analysis['data_date']})",
                content=_build_missing_mp_alert_content(mp_alert_analysis),
                detail_content=_build_missing_mp_alert_detail_content(mp_alert_analysis),
            )
        if mp_alert_analysis.get("increase_alert_needed"):
            await _create_alert(
                level="P2",
                category="DATA_QUALITY",
                title=f"计量点增加({mp_alert_analysis['data_date']})",
                content=_build_increase_mp_alert_content(mp_alert_analysis),
                detail_content=_build_increase_mp_alert_detail_content(mp_alert_analysis),
            )
        
    # 6. 记录成功
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"成功聚合 {result['customers_processed']} 个客户, {result['dates_aggregated']} 个日期, {result['records_aggregated']} 条记录",
            details={
                **result,
                "rpa_task_id": str(rpa_record["_id"])
            }
        )
        
        # 7. 写入缓存
        _mark_executed("load_aggregation", today, "SUCCESS")
        
        logger.info(f"✅ 聚合完成: {task_id}")
        
    except Exception as e:
        # 聚合执行失败,记录日志并告警
        if 'task_id' in locals():
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="FAILED",
                summary=f"聚合失败: {str(e)}",
                error={"message": str(e)}
            )
            
            # 写入缓存 (失败也标记为已执行)
            _mark_executed("load_aggregation", today, "FAILED")
        
        # 聚合失败,立即创建告警 (1次失败即告警)
        await _create_alert(
            level="P1",
            category="TASK_FAILED",
            title="负荷数据聚合失败",
            content=f"聚合任务执行失败: {str(e)}"
        )
        
        logger.error(f"❌ 聚合失败: {str(e)}")
        raise


# ========== 共享业务逻辑 ==========

async def _aggregate_all_customers(trigger_date: str) -> Dict[str, Any]:
    """
    增量聚合所有当月有效签约客户的数据
    
    逻辑:
    1. 查找当月有有效零售合同的所有客户
    2. 对每个客户,找出 unified_load_curve 中缺失的日期
    3. 调用 LoadAggregationService.upsert_unified_load_curve 进行聚合
    
    Args:
        trigger_date: 触发日期 (用于确定"当月", YYYY-MM-DD)
    
    Returns:
        {
            "customers_processed": int,  # 成功聚合的客户数
            "dates_aggregated": int,     # 聚合的日期数
            "records_aggregated": int,   # 聚合的记录数
            "active_customers_count": int # 当月活跃客户总数
        }
    """
    # 1. 获取当月有效签约客户
    active_customers = await _get_active_customers(trigger_date)
    
    if not active_customers:
        logger.warning(f"没有找到 {trigger_date} 当月的有效签约客户")
        return {
            "customers_processed": 0,
            "dates_aggregated": 0,
            "records_aggregated": 0,
            "active_customers_count": 0
        }
    
    logger.info(f"开始执行增量聚合 (当月活跃客户数: {len(active_customers)})...")
    
    customers_processed = 0
    dates_aggregated_set = set()
    records_aggregated = 0
    
    # 3. 对每个客户进行增量聚合
    for customer in active_customers:
        customer_id = str(customer["customer_id"])
        customer_name = customer.get("customer_name", "未知")
        
        try:
            # 查找该客户待处理的日期 (包含缺失、不完整、过期)
            pending_tasks = LoadAggregationService.get_pending_tasks([customer_id])
            missing_dates = pending_tasks.get(customer_id, [])
            
            if not missing_dates:
                # 虽然没有缺失日期，但也算作成功处理（因为数据已完整）
                # 但为了 customers_processed 语义准确（成功聚合了数据），这里暂不计数
                # 或者如果它是"检查通过"，也算 processed? 
                # 通常 customers_processed 指的是发生变更。如果没变更，就不算。
                continue 
            
            # 对每个缺失日期进行聚合
            customer_success = False
            for date in missing_dates:
                try:
                    success = LoadAggregationService.upsert_unified_load_curve(
                        customer_id=customer_id,
                        date=date,
                        customer_name=customer_name
                    )
                    
                    if success:
                        records_aggregated += 1
                        dates_aggregated_set.add(date)
                        customer_success = True
                        
                except Exception as e:
                    logger.warning(f"聚合失败 customer={customer_id} date={date}: {str(e)}")
                    continue
            
            if customer_success:
                customers_processed += 1
                
        except Exception as e:
            logger.warning(f"处理客户 {customer_id} 失败: {str(e)}")
            continue
    
    return {
        "customers_processed": customers_processed,
        "dates_aggregated": len(dates_aggregated_set),
        "records_aggregated": records_aggregated,
        "active_customers_count": len(active_customers)
    }





async def _get_active_customers_count(date_str: str = None) -> int:
    """
    [已弃用] 获取当前签约客户数
    现在由 _aggregate_all_customers 直接返回准确的基数
    """
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")
    customers = await _get_active_customers(date_str)
    return len(customers)


def _extract_customer_archive(customer_id: str) -> Dict[str, Any]:
    try:
        customer = DATABASE["customer_archives"].find_one({"_id": ObjectId(customer_id)})
    except Exception:
        customer = DATABASE["customer_archives"].find_one({"_id": customer_id})

    if not customer:
        return {
            "customer_id": customer_id,
            "customer_name": "",
            "account_ids": set(),
            "mp_ids": set(),
        }

    account_ids: Set[str] = set()
    mp_ids: Set[str] = set()
    for account in customer.get("accounts", []):
        account_id = str(account.get("account_id") or "").strip()
        if account_id:
            account_ids.add(account_id)
        for mp in account.get("metering_points", []):
            mp_no = str(mp.get("mp_no") or "").strip()
            if mp_no:
                mp_ids.add(mp_no)

    return {
        "customer_id": customer_id,
        "customer_name": customer.get("user_name") or customer.get("customer_name") or "",
        "account_ids": account_ids,
        "mp_ids": mp_ids,
    }


async def _get_active_customer_context(date_str: str) -> Dict[str, Any]:
    active_customers = await _get_active_customers(date_str)
    archive_items = [_extract_customer_archive(str(item["customer_id"])) for item in active_customers]

    customer_ids = {item["customer_id"] for item in archive_items}
    customer_names = {item["customer_name"] for item in archive_items if item["customer_name"]}
    account_ids = set()
    archive_mp_ids = set()
    customer_mp_map = {}
    mp_customer_map = {}
    for item in archive_items:
        account_ids.update(item["account_ids"])
        archive_mp_ids.update(item["mp_ids"])
        customer_mp_map[item["customer_id"]] = item["mp_ids"]
        for mp_id in item["mp_ids"]:
            mp_customer_map[mp_id] = {
                "customer_id": item["customer_id"],
                "customer_name": item["customer_name"],
            }

    return {
        "active_customers": active_customers,
        "customer_ids": customer_ids,
        "customer_names": customer_names,
        "account_ids": account_ids,
        "archive_mp_ids": archive_mp_ids,
        "customer_mp_map": customer_mp_map,
        "mp_customer_map": mp_customer_map,
    }


def _is_doc_belongs_to_active_customers(doc: Dict[str, Any], context: Dict[str, Any]) -> bool:
    mp_id = str(doc.get("mp_id") or "").strip()
    if mp_id and mp_id in context["archive_mp_ids"]:
        return True

    meta = doc.get("meta") or {}
    account_id = str(meta.get("account_id") or "").strip()
    if account_id and account_id in context["account_ids"]:
        return True

    customer_name = str(meta.get("customer_name") or "").strip()
    return bool(customer_name and customer_name in context["customer_names"])


def _has_non_zero_load(doc: Dict[str, Any]) -> bool:
    total_load = doc.get("total_load")
    try:
        if total_load is not None and float(total_load) > 0:
            return True
    except (TypeError, ValueError):
        pass

    for value in doc.get("load_values", []) or []:
        try:
            if value is not None and float(value) > 0:
                return True
        except (TypeError, ValueError):
            continue
    return False


def _get_recent_dates(date_str: str, days: int) -> List[str]:
    base = datetime.strptime(date_str, "%Y-%m-%d")
    return [
        (base - timedelta(days=offset)).strftime("%Y-%m-%d")
        for offset in range(1, days + 1)
    ]


def _get_prev_month_last_day(date_str: str) -> str:
    current = datetime.strptime(date_str, "%Y-%m-%d")
    first_day = current.replace(day=1)
    return (first_day - timedelta(days=1)).strftime("%Y-%m-%d")


def _get_latest_available_data_date(before_date: str) -> str | None:
    previous_dates = DATABASE["raw_mp_data"].distinct("date", {"date": {"$lt": before_date}})
    previous_dates = [date for date in previous_dates if isinstance(date, str)]
    return max(previous_dates) if previous_dates else None


def _to_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


async def _analyze_mp_publication_alerts(execution_date: str, rpa_record: Dict[str, Any]) -> Dict[str, Any]:
    data_date = str(
        rpa_record.get("last_data_date")
        or rpa_record.get("data_date_end")
        or execution_date
    )
    context = await _get_active_customer_context(execution_date)
    history_dates = _get_recent_dates(data_date, EXPECTED_MPS_LOOKBACK_DAYS)

    daily_mp_sets: List[Dict[str, Any]] = []
    raw_mp_data = DATABASE["raw_mp_data"]

    for hist_date in history_dates:
        docs = list(raw_mp_data.find({"date": hist_date}, {"_id": 0, "mp_id": 1}))
        mp_set = {
            str(doc.get("mp_id") or "").strip()
            for doc in docs
            if str(doc.get("mp_id") or "").strip()
        }
        daily_mp_sets.append({"date": hist_date, "mp_set": mp_set, "count": len(mp_set)})

    expected_entry = max(
        daily_mp_sets,
        key=lambda item: (item["count"], item["date"]),
        default={"date": None, "mp_set": set(), "count": 0},
    )
    expected_mps = set(expected_entry["mp_set"])

    data_dt = datetime.strptime(data_date, "%Y-%m-%d")
    prev_month_last_day = _get_prev_month_last_day(data_date)
    customer_change_detected = False
    month_added_customer_ids: Set[str] = set()
    month_removed_customer_ids: Set[str] = set()
    if any(datetime.strptime(d, "%Y-%m-%d").month != data_dt.month for d in history_dates):
        prev_context = await _get_active_customer_context(prev_month_last_day)
        month_added_customer_ids = context["customer_ids"] - prev_context["customer_ids"]
        month_removed_customer_ids = prev_context["customer_ids"] - context["customer_ids"]
        customer_change_detected = bool(month_added_customer_ids or month_removed_customer_ids)

        if month_added_customer_ids:
            for cid in month_added_customer_ids:
                expected_mps.update(context["customer_mp_map"].get(cid, set()))

        if month_removed_customer_ids:
            for cid in month_removed_customer_ids:
                expected_mps.difference_update(prev_context["customer_mp_map"].get(cid, set()))

    today_docs = list(raw_mp_data.find({"date": data_date}, {"_id": 0, "mp_id": 1, "meta": 1, "total_load": 1, "load_values": 1}))
    actual_mps = {
        str(doc.get("mp_id") or "").strip()
        for doc in today_docs
        if str(doc.get("mp_id") or "").strip()
    }
    actual_active_mps = {
        str(doc.get("mp_id") or "").strip()
        for doc in today_docs
        if _is_doc_belongs_to_active_customers(doc, context) and str(doc.get("mp_id") or "").strip()
    }

    missing_mps = sorted(expected_mps - actual_mps)
    added_mps = sorted(actual_mps - expected_mps)
    active_archive_mps = context["archive_mp_ids"]
    effective_missing_mps = sorted(mp_id for mp_id in missing_mps if mp_id in active_archive_mps)
    effective_added_mps = sorted(mp_id for mp_id in added_mps if mp_id in actual_active_mps and mp_id not in active_archive_mps)

    activity_dates = _get_recent_dates(data_date, MISSING_MP_ACTIVITY_LOOKBACK_DAYS)
    missing_mp_recent_activity: Dict[str, List[str]] = {}
    if effective_missing_mps:
        history_docs = list(raw_mp_data.find(
            {"date": {"$in": activity_dates}, "mp_id": {"$in": effective_missing_mps}},
            {"_id": 0, "date": 1, "mp_id": 1, "total_load": 1, "load_values": 1}
        ))
        for doc in history_docs:
            mp_id = str(doc.get("mp_id") or "").strip()
            if not mp_id:
                continue
            missing_mp_recent_activity.setdefault(mp_id, [])
            if _has_non_zero_load(doc):
                missing_mp_recent_activity[mp_id].append(doc["date"])

    affected_customer_ids: Set[str] = set()
    affected_customer_names: Set[str] = set()
    for mp_id in effective_missing_mps:
        customer_info = context["mp_customer_map"].get(mp_id) or {}
        customer_id = str(customer_info.get("customer_id") or "").strip()
        customer_name = str(customer_info.get("customer_name") or "").strip()
        if customer_id:
            affected_customer_ids.add(customer_id)
        if customer_name:
            affected_customer_names.add(customer_name)

    added_customer_ids: Set[str] = set()
    added_customer_names: Set[str] = set()
    for mp_id in effective_added_mps:
        customer_info = context["mp_customer_map"].get(mp_id) or {}
        customer_id = str(customer_info.get("customer_id") or "").strip()
        customer_name = str(customer_info.get("customer_name") or "").strip()
        if customer_id:
            added_customer_ids.add(customer_id)
        if customer_name:
            added_customer_names.add(customer_name)

    missing_mp_latest_energy_map: Dict[str, Dict[str, Any]] = {}
    missing_mp_estimated_energy_mwh = 0.0
    if effective_missing_mps:
        latest_energy_docs = list(raw_mp_data.find(
            {"date": {"$lt": data_date}, "mp_id": {"$in": effective_missing_mps}},
            {"_id": 0, "date": 1, "mp_id": 1, "total_load": 1}
        ).sort([("mp_id", 1), ("date", -1)]))
        for doc in latest_energy_docs:
            mp_id = str(doc.get("mp_id") or "").strip()
            if not mp_id or mp_id in missing_mp_latest_energy_map:
                continue
            total_load = _to_float(doc.get("total_load"))
            missing_mp_latest_energy_map[mp_id] = {
                "date": doc.get("date"),
                "total_load": total_load,
            }
            missing_mp_estimated_energy_mwh += total_load

    added_mp_not_in_archive = sorted(mp_id for mp_id in added_mps if mp_id not in context["archive_mp_ids"])
    added_mp_in_archive = sorted(mp_id for mp_id in added_mps if mp_id in context["archive_mp_ids"])

    baseline_available = bool(expected_entry["date"])

    return {
        "execution_date": execution_date,
        "data_date": data_date,
        "expected_mps_count": len(expected_mps),
        "actual_mps_count": len(actual_mps),
        "expected_reference_date": expected_entry["date"],
        "missing_mps": missing_mps,
        "effective_missing_mps": effective_missing_mps,
        "missing_mp_recent_activity": {k: sorted(v) for k, v in missing_mp_recent_activity.items()},
        "mp_customer_map": context["mp_customer_map"],
        "affected_customer_count": len(affected_customer_ids) or len(affected_customer_names),
        "missing_mp_latest_energy_map": missing_mp_latest_energy_map,
        "missing_mp_estimated_energy_mwh": round(missing_mp_estimated_energy_mwh, 4),
        "added_mps": added_mps,
        "effective_added_mps": effective_added_mps,
        "added_customer_count": len(added_customer_ids) or len(added_customer_names),
        "added_mp_not_in_archive": added_mp_not_in_archive,
        "added_mp_in_archive": added_mp_in_archive,
        "previous_available_date": _get_latest_available_data_date(data_date),
        "baseline_available": baseline_available,
        "customer_change_detected": customer_change_detected,
        "month_added_customer_count": len(month_added_customer_ids),
        "removed_customer_count": len(month_removed_customer_ids),
        "missing_alert_needed": baseline_available and bool(effective_missing_mps),
        "increase_alert_needed": baseline_available and len(actual_mps) > len(expected_mps) and bool(effective_added_mps),
    }


def _build_missing_mp_alert_content(analysis: Dict[str, Any]) -> str:
    content = (
        f"{analysis['data_date']} 负荷数据下载发现计量点数量缺失："
        f"基准值{analysis['expected_mps_count']}个，当日 {analysis['actual_mps_count']} 个。"
        f"缺失有效计量点 {len(analysis['effective_missing_mps'])} 个，"
        f"涉及用户 {analysis.get('affected_customer_count', 0)} 户，"
        f"涉及电量少计 {analysis.get('missing_mp_estimated_energy_mwh', 0.0):.2f}MWh"
    )
    if analysis.get("customer_change_detected"):
        content += " 说明：检测到月初客户变动，基准已按当前活跃客户档案修正。"
    return content


def _build_missing_mp_alert_detail_content(analysis: Dict[str, Any]) -> str:
    lines = [
        f"告警日期：{analysis['data_date']}",
        f"基准计量点数：{analysis['expected_mps_count']} 个",
        f"当日计量点数：{analysis['actual_mps_count']} 个",
        f"缺失有效计量点：{len(analysis['effective_missing_mps'])} 个",
        f"涉及用户：{analysis.get('affected_customer_count', 0)} 户",
        f"涉及电量少计：{analysis.get('missing_mp_estimated_energy_mwh', 0.0):.2f}MWh",
        "",
        "缺失明细：",
    ]
    if analysis.get("customer_change_detected"):
        lines.insert(6, "说明：检测到月初客户变动，基准已按当前活跃客户档案修正。")
        lines.insert(7, "")

    customer_groups: Dict[str, Dict[str, Any]] = {}
    missing_mps = analysis.get("effective_missing_mps") or []
    mp_customer_map = analysis.get("mp_customer_map") or {}
    for mp_id in missing_mps:
        customer_info = mp_customer_map.get(mp_id) or {}
        customer_id = str(customer_info.get("customer_id") or "").strip() or "UNKNOWN"
        customer_name = str(customer_info.get("customer_name") or "").strip() or "未知用户"
        group = customer_groups.setdefault(
            customer_id,
            {"customer_name": customer_name, "mp_ids": []},
        )
        group["mp_ids"].append(mp_id)

    if not customer_groups:
        lines.append("未提取到缺失计量点明细。")
        return "\n".join(lines)

    for index, (_, group) in enumerate(sorted(customer_groups.items(), key=lambda item: item[1]["customer_name"]), start=1):
        lines.append(f"{index}. 用户：{group['customer_name']}")
        lines.append(f"缺失计量点：{'、'.join(sorted(group['mp_ids']))}")
        lines.append("")

    return "\n".join(line for line in lines if line is not None).strip()


def _build_increase_mp_alert_content(analysis: Dict[str, Any]) -> str:
    content = (
        f"{analysis['data_date']} 负荷数据下载发现计量点数量增加："
        f"基准值{analysis['expected_mps_count']}个，当日 {analysis['actual_mps_count']} 个。"
        f"新增有效计量点 {len(analysis.get('effective_added_mps', []))} 个，"
        f"涉及用户 {analysis.get('added_customer_count', 0)} 户。"
    )
    if analysis.get("customer_change_detected"):
        content += " 说明：检测到月初客户变动，基准已按当前活跃客户档案修正。"
    return content


def _build_increase_mp_alert_detail_content(analysis: Dict[str, Any]) -> str:
    lines = [
        f"告警日期：{analysis['data_date']}",
        f"基准计量点数：{analysis['expected_mps_count']} 个",
        f"当日计量点数：{analysis['actual_mps_count']} 个",
        f"新增有效计量点：{len(analysis.get('effective_added_mps', []))} 个",
        f"涉及用户：{analysis.get('added_customer_count', 0)} 户",
        "",
        "增加明细：",
    ]
    if analysis.get("customer_change_detected"):
        lines.insert(5, "说明：检测到月初客户变动，基准已按当前活跃客户档案修正。")
        lines.insert(6, "")

    customer_groups: Dict[str, Dict[str, Any]] = {}
    added_mps = analysis.get("effective_added_mps") or []
    mp_customer_map = analysis.get("mp_customer_map") or {}
    for mp_id in added_mps:
        customer_info = mp_customer_map.get(mp_id) or {}
        customer_id = str(customer_info.get("customer_id") or "").strip() or "UNKNOWN"
        customer_name = str(customer_info.get("customer_name") or "").strip() or "未知用户"
        group = customer_groups.setdefault(
            customer_id,
            {"customer_name": customer_name, "mp_ids": []},
        )
        group["mp_ids"].append(mp_id)

    if not customer_groups:
        lines.append("未提取到新增活跃计量点明细。")
        return "\n".join(lines)

    for index, (_, group) in enumerate(sorted(customer_groups.items(), key=lambda item: item[1]["customer_name"]), start=1):
        lines.append(f"{index}. 用户：{group['customer_name']}")
        lines.append(f"新增计量点：{'、'.join(sorted(group['mp_ids']))}")
        lines.append("")

    return "\n".join(line for line in lines if line is not None).strip()


async def _create_alert(level: str, category: str, title: str, content: str, detail_content: str | None = None):
    """创建系统告警"""
    import uuid
    
    # 使用本地时间作为ID部分 (虽然 uuid 足够唯一，但保留时间戳习惯)
    now_local = datetime.now()
    alert_id = f"alert_{now_local.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    
    DATABASE["system_alerts"].insert_one({
        "alert_id": alert_id,
        "level": level,
        "category": category,
        "title": title,
        "content": content,
        "detail_content": detail_content or content,
        "service_type": "web",
        "task_type": "load_aggregation",
        "status": "ACTIVE",
        "created_at": now_local, # 修正为本地时间
        "resolved_at": None
    })
    
    logger.warning(f"🚨 告警已创建: {alert_id} - {title}")
