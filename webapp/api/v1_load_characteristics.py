from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from datetime import datetime, timedelta
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.models.characteristic_models import (
    CharacteristicsOverview, CustomerCharacteristics, CustomerCharacteristicListResponse,
    OverviewKpi, TagDistribution, TagDistributionItem, AnomalySummaryItem,
    TagCategoryDistribution, EnhancedTagDistribution,
    TagChangeItem, TagChangesResponse,
    ScatterDataItem, ScatterDataResponse,
    AnalysisHistoryItem, AnalysisHistoryResponse,
    AnomalyAlertItem, AnomalyAlertListResponse, AcknowledgeRequest
)
from webapp.services.characteristics.service import CharacteristicService
from webapp.services.load_query_service import LoadQueryService

# --- Security Dependency ---
from webapp.tools.security import get_current_active_user
from webapp.api.dependencies.authz import require_permission, CurrentUserContext
from webapp.api.masking import mask_response_for_user, paginate_items
from webapp.services.customer_name_masking_service import customer_name_masking_service

router = APIRouter(prefix="/load-characteristics", tags=["Load Characteristics"])


# --- 标签类别定义 ---
TAG_CATEGORIES = {
    "shift": {
        "name": "生产班次",
        "tags": ["连续生产", "全天生产", "单班生产", "双班生产", "三班生产", "夜间生产", "间歇生产", "不规律生产"]
    },
    "trend": {
        "name": "经营趋势",
        "tags": ["产能扩张", "产能萎缩", "经营稳健"]
    },
    "facility": {
        "name": "能源设施",
        "tags": ["光伏自备", "储能套利", "分布式光伏", "分布式储能"]
    },
    "cost": {
        "name": "成本偏好",
        "tags": ["成本敏感型", "刚性用电型", "移谷填峰", "避峰用电"]
    },
    "seasonal": {
        "name": "季节气象",
        "tags": ["冬夏双峰型", "冬季单峰型", "夏季单峰型", "气温敏感型", "气温钝化型"]
    },
    "stability": {
        "name": "稳定性",
        "tags": ["极度规律型", "剧烈波动型", "间歇停产型"]
    },
    "behavior": {
        "name": "行为规律",
        "tags": ["机器规律型", "随机波动型"]
    },
    "calendar": {
        "name": "日历特征",
        "tags": ["标准双休型", "周末单休型", "周末生产型", "春节深调型", "节后慢热型"]
    }
}


@router.post("/analyze/{customer_id}", summary="手动触发客户特征分析")
async def analyze_customer_manual(
    customer_id: str,
    date: Optional[str] = None,
    _ctx = Depends(require_permission("module:analysis_load_characteristics:edit")),
):
    """
    手动触发单个客户的特征分析
    """
    service = CharacteristicService()
    if not date:
        date = LoadQueryService.get_latest_data_date()
        if not date:
            date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        
    tags = service.analyze_customer(customer_id, date)
    return {"status": "success", "customer_id": customer_id, "tags_generated": len(tags) if tags else 0}


@router.post("/analyze/batch/all", summary="手动触发全量分析")
async def analyze_batch_manual(
    date: Optional[str] = None,
    _ctx = Depends(require_permission("module:analysis_load_characteristics:edit")),
):
    """
    手动触发全量客户特征分析
    """
    service = CharacteristicService()
    if not date:
        date = LoadQueryService.get_latest_data_date()
        if not date:
            date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        
    result = service.analyze_all_active_customers(date)
    return result


@router.get("/overview", response_model=CharacteristicsOverview)
async def get_overview(
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取特征分析总览"""
    db = DATABASE
    
    # 1. KPIs
    total_cust = db['customer_archives'].count_documents({})
    char_cust = db['customer_characteristics'].count_documents({})
    
    # 异动告警数量 (优先取今日，无数据取最近一天)
    today_str = datetime.now().strftime("%Y-%m-%d")
    anomaly_count = db['customer_anomaly_alerts'].count_documents({"alert_date": today_str})
    
    if anomaly_count == 0:
        # 尝试找最近的一天
        latest_alert = db['customer_anomaly_alerts'].find_one(sort=[("alert_date", -1)])
        if latest_alert:
            latest_date = latest_alert["alert_date"]
            anomaly_count = db['customer_anomaly_alerts'].count_documents({"alert_date": latest_date})
    
    # 覆盖率
    coverage_rate = (char_cust / total_cust) if total_cust > 0 else 0
    
    # 1.1 最新特征分析日期
    latest_char = db['customer_characteristics'].find_one(
        {"data_date": {"$exists": True}}, 
        sort=[("data_date", -1)]
    )
    latest_data_date = latest_char["data_date"] if latest_char else "-"
    
    # 1.2 全网规律性加权平均评分 (权重：long_term.avg_daily_load)
    pipeline_reg = [
        {
            "$match": {
                "regularity_score": {"$exists": True},
                "long_term.avg_daily_load": {"$gt": 0}
            }
        },
        {
            "$group": {
                "_id": None,
                "total_weighted_score": {"$sum": {"$multiply": ["$regularity_score", "$long_term.avg_daily_load"]}},
                "total_weight": {"$sum": "$long_term.avg_daily_load"}
            }
        }
    ]
    res_reg = list(db['customer_characteristics'].aggregate(pipeline_reg))
    avg_reg = (res_reg[0]['total_weighted_score'] / res_reg[0]['total_weight']) if res_reg and res_reg[0]['total_weight'] > 0 else 0.0
    
    # 主力特征
    pipeline_dominant = [
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags.name", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1}
    ]
    dominant_result = list(db['customer_archives'].aggregate(pipeline_dominant))
    dominant_tag = dominant_result[0]["_id"] if dominant_result else "-"
    dominant_count = dominant_result[0]["count"] if dominant_result else 0
    dominant_pct = round(dominant_count / total_cust, 2) if total_cust > 0 else 0
    
    # 2. 标签分布 - 生产班次
    pipeline_shift = [
        {"$unwind": "$tags"},
        {"$match": {"tags.name": {"$in": TAG_CATEGORIES["shift"]["tags"]}}},
        {"$group": {"_id": "$tags.name", "count": {"$sum": 1}}}
    ]
    shifts = list(db['customer_archives'].aggregate(pipeline_shift))
    dist_shift = [TagDistributionItem(name=x["_id"], value=x["count"], percentage=0) for x in shifts]
    total_shifts = sum(x.value for x in dist_shift)
    for x in dist_shift: 
        x.percentage = round(x.value / total_shifts, 2) if total_shifts else 0

    # 稳定性/经营分布
    pipeline_stability = [
        {"$unwind": "$tags"},
        {"$match": {"tags.name": {"$in": TAG_CATEGORIES["trend"]["tags"] + TAG_CATEGORIES["stability"]["tags"]}}},
        {"$group": {"_id": "$tags.name", "count": {"$sum": 1}}}
    ]
    stability = list(db['customer_archives'].aggregate(pipeline_stability))
    dist_fac = [TagDistributionItem(name=x["_id"], value=x["count"], percentage=0) for x in stability]
    total_fac = sum(x.value for x in dist_fac)
    for x in dist_fac:
        x.percentage = round(x.value / total_fac, 2) if total_fac else 0

    # 3. 最近异动告警 (5条)
    # 3. 最近异动告警 (5条) - 按 (客户+异动类型) 去重，只显示最新的一条
    pipeline_anoms = [
        {"$match": {"acknowledged": False}},
        {"$sort": {"alert_date": -1, "created_at": -1}},
        {"$group": {
            "_id": {"cid": "$customer_id", "type": "$alert_type"},
            "doc": {"$first": "$$ROOT"}
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$sort": {"alert_date": -1, "created_at": -1}}
    ]
    anoms = list(db['customer_anomaly_alerts'].aggregate(pipeline_anoms))
    
    anom_list = []
    for a in anoms:
        anom_list.append(AnomalySummaryItem(
            id=str(a["_id"]),
            customer_id=a["customer_id"],
            customer_name=a.get("customer_name", "Unknown"),
            severity=a.get("severity", "warning"),
            type=a.get("alert_type", "unknown"),
            description=a.get("reason", ""),
            time=a.get("created_at", datetime.now()).strftime("%Y-%m-%d %H:%M")
        ))

    result = CharacteristicsOverview(
        kpi=OverviewKpi(
            coverage_rate=round(coverage_rate, 2),
            coverage_count=char_cust,
            total_customers=total_cust,
            dominant_tag=dominant_tag,
            dominant_tag_percentage=dominant_pct,
            latest_data_date=latest_data_date,
            anomaly_count_today=anomaly_count,
            avg_regularity_score=round(avg_reg, 1) if avg_reg else 0,
            irregular_load_weight=0
        ),
        distribution=TagDistribution(
            by_shift=dist_shift,
            by_facility=dist_fac
        ),
        anomalies=anom_list
    )
    return mask_response_for_user(result.model_dump(), ctx)


@router.get("/overview/distribution", response_model=EnhancedTagDistribution)
async def get_tag_distribution(
    _ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取完整的标签分布 (按类别)"""
    db = DATABASE
    
    categories_result = []
    
    for cat_key, cat_info in TAG_CATEGORIES.items():
        pipeline = [
            {"$unwind": "$tags"},
            {"$match": {
                "tags.name": {"$in": cat_info["tags"]},
                "tags.source": {"$ne": "MANUAL"} 
            }},
            {"$group": {"_id": "$tags.name", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]
        results = list(db['customer_archives'].aggregate(pipeline))
        
        items = []
        total = sum(x["count"] for x in results)
        for r in results:
            items.append(TagDistributionItem(
                name=r["_id"],
                value=r["count"],
                percentage=round(r["count"] / total, 2) if total > 0 else 0
            ))
        
        categories_result.append(TagCategoryDistribution(
            category=cat_key,
            category_name=cat_info["name"],
            items=items
        ))
    
    return EnhancedTagDistribution(categories=categories_result)


@router.get("/overview/tag-changes", response_model=TagChangesResponse)
async def get_tag_changes(
    date: Optional[str] = None,
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取标签变化 (对比昨日今日)"""
    db = DATABASE
    
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    
    # 计算昨天日期
    current_date = datetime.strptime(date, "%Y-%m-%d")
    yesterday = (current_date - timedelta(days=1)).strftime("%Y-%m-%d")
    
    # 获取今天和昨天的分析历史
    today_logs = list(db['analysis_history_log'].find({"date": date}))
    yesterday_logs = list(db['analysis_history_log'].find({"date": yesterday}))
    
    # 构建昨天标签映射
    yesterday_tags_map = {}
    for log in yesterday_logs:
        cid = log["customer_id"]
        tags = [t.get("name", "") for t in log.get("tags_snapshot", [])]
        yesterday_tags_map[cid] = set(tags)
    
    # 对比
    changes = []
    total_added = 0
    total_removed = 0
    
    for log in today_logs:
        cid = log["customer_id"]
        today_tags = set(t.get("name", "") for t in log.get("tags_snapshot", []))
        yesterday_tags = yesterday_tags_map.get(cid, set())
        
        added = today_tags - yesterday_tags
        removed = yesterday_tags - today_tags
        
        if added or removed:
            # 获取客户名称
            cust = db['customer_archives'].find_one({"_id": ObjectId(cid)}, {"user_name": 1})
            cust_name = cust.get("user_name", "Unknown") if cust else "Unknown"
            
            changes.append(TagChangeItem(
                customer_id=cid,
                customer_name=cust_name,
                added_tags=list(added),
                removed_tags=list(removed)
            ))
            total_added += len(added)
            total_removed += len(removed)
    
    result = TagChangesResponse(
        date=date,
        total_added=total_added,
        total_removed=total_removed,
        changes=changes
    )
    return mask_response_for_user(result.model_dump(), ctx)


@router.get("/overview/scatter-data", response_model=ScatterDataResponse)
async def get_scatter_data(
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取散点图数据 (规模-稳定性)"""
    db = DATABASE
    
    # 从 customer_characteristics 获取有 long_term 数据的客户
    pipeline = [
        {"$match": {"long_term": {"$exists": True}}},
        {"$project": {
            "customer_id": 1,
            "customer_name": 1,
            "regularity_score": 1,
            "avg_daily_load": "$long_term.avg_daily_load",
            "cv": "$long_term.cv"
        }}
    ]
    
    results = list(db['customer_characteristics'].aggregate(pipeline))
    
    items = []
    for r in results:
        # 获取标签和简称
        cust = db['customer_archives'].find_one(
            {"_id": ObjectId(r["customer_id"])}, 
            {"tags": 1, "short_name": 1}
        )
        tag_names = [t.get("name", "") for t in cust.get("tags", [])] if cust else []
        short_name = cust.get("short_name", r.get("customer_name", "Unknown")) if cust else r.get("customer_name", "Unknown")
        
        items.append(ScatterDataItem(
            customer_id=r["customer_id"],
            customer_name=r.get("customer_name", "Unknown"),
            short_name=short_name,
            avg_daily_load=r.get("avg_daily_load", 0),  # 数据库存的是 MWh
            cv=r.get("cv", 0),
            regularity_score=r.get("regularity_score"),
            tags=tag_names[:3]  # 最多显示3个
        ))
    
    return mask_response_for_user(ScatterDataResponse(items=items).model_dump(), ctx)


@router.get("/customers", response_model=CustomerCharacteristicListResponse)
async def list_customers(
    page: int = 1,
    page_size: int = 10,
    search: Optional[str] = None,
    tag: Optional[str] = None,
    quality: Optional[str] = None,
    has_anomaly: Optional[bool] = None,
    sort_by: str = "avg_daily_load",
    order: str = "desc",
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取客户特征列表 (关联查询Tags)"""
    db = DATABASE
    query = {}
    use_masked_customer_search = bool(search and not ctx.can_view_real_customer_name)
    if search and not use_masked_customer_search:
        query["customer_name"] = {"$regex": search, "$options": "i"}
    elif use_masked_customer_search:
        matched_customer_ids = customer_name_masking_service.search_customer_ids_by_keyword(search or "")
        query["customer_id"] = {"$in": matched_customer_ids or ["__no_match__"]}
    if quality:
        query["quality_rating"] = quality
    if has_anomaly is not None:
        query["has_anomaly"] = has_anomaly
        
    # 如果按标签筛选，先从 customer_archives 找到对应的 customer_ids
    if tag:
        t_pipeline = [
            {"$match": {"tags.name": tag}},
            {"$project": {"_id": 1}}
        ]
        tagged_custs = list(db['customer_archives'].aggregate(t_pipeline))
        tagged_ids = [str(c["_id"]) for c in tagged_custs]
        
        # 合并查询条件
        query["customer_id"] = {"$in": tagged_ids}

    # 排序映射
    sort_mapping = {
        "customer_name": "customer_name",
        "score": "regularity_score",
        "avg_daily_load": "long_term.avg_daily_load"
    }
    
    sort_field = sort_mapping.get(sort_by, "long_term.avg_daily_load")
    sort_dir = -1 if order == "desc" else 1

    effective_page_size = page_size
    skip = (page - 1) * page_size
    
    total = db['customer_characteristics'].count_documents(query)
    cursor = db['customer_characteristics'].find(query).sort(sort_field, sort_dir)
    if effective_page_size > 0:
        cursor = cursor.skip(skip).limit(effective_page_size)
    
    # 获取每一条记录，并补全 tags
    items = []
    for doc in cursor:
        cid = doc["customer_id"]
        # 查找最新的 tags 和简称
        cust_arch = db['customer_archives'].find_one(
             {"_id": ObjectId(cid)}, 
             {"tags": 1, "short_name": 1}
        )
        real_tags = cust_arch.get("tags", []) if cust_arch else []
        
        # 构造响应对象
        # 注意: doc['tags'] 是空的，我们需要用 real_tags 覆盖
        # Pydantic model 需要 tags 是 List[TagItem] (name, category, confidence)
        # customer_archives 里的 tags 已经是这个结构
        model_tags = []
        for t in real_tags:
            # 简单映射，确保字段存在
            model_tags.append({
                "name": t.get("name"),
                "category": "auto", # 暂时没存 category 在 archives tags 里，或者有? Check DB
                "confidence": t.get("confidence"),
                "source": t.get("source", "AUTO")
            })
            
        doc["short_name"] = cust_arch.get("short_name", doc.get("customer_name", "Unknown")) if cust_arch else doc.get("customer_name", "Unknown")
        doc["tags"] = model_tags
        items.append(CustomerCharacteristics(**doc))

    result = CustomerCharacteristicListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items
    )
    return mask_response_for_user(result.model_dump(), ctx)


@router.get("/customer/{customer_id}", response_model=CustomerCharacteristics)
async def get_customer_detail(
    customer_id: str,
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取单个客户特征详情"""
    doc = DATABASE['customer_characteristics'].find_one({"customer_id": customer_id})
    if not doc:
        # If no characteristics exist yet, try to create a default one from archives
        # Or just return 404. For now, we assume analysis has run.
        raise HTTPException(status_code=404, detail="Characteristics not found")
    
    # 获取实时标签 (from customer_archives)
    cust_arch = DATABASE['customer_archives'].find_one(
            {"_id": ObjectId(customer_id)}, 
            {"tags": 1, "user_name": 1, "short_name": 1}
    )
    
    real_tags = cust_arch.get("tags", []) if cust_arch else []
    
    # Build a lookup map for categories
    # Tag Name -> Category Name (e.g., "连续生产" -> "生产班次")
    tag_cat_map = {}
    for cat_key, cat_val in TAG_CATEGORIES.items():
        for t_name in cat_val["tags"]:
            tag_cat_map[t_name] = cat_val["name"]

    # Transform tags to model format
    model_tags = []
    for t in real_tags:
        t_name = t.get("name")
        # Identify category: 
        # 1. From DB if exists (unlikely in simple list)
        # 2. From Lookup Map
        # 3. Fallback to "其它"
        cat_name = tag_cat_map.get(t_name, "其它")
        
        model_tags.append({
            "name": t_name,
            "category": cat_name,
            "confidence": t.get("confidence"),
            "source": t.get("source", "AUTO"),
            "reason": t.get("reason")  # Include reason/description
        })
        
    doc["tags"] = model_tags
    doc["short_name"] = cust_arch.get("short_name", doc.get("customer_name", "Unknown")) if cust_arch else doc.get("customer_name", "Unknown")
    
    # Ensure customer_name is up to date
    if cust_arch and "user_name" in cust_arch:
        doc["customer_name"] = cust_arch["user_name"]
        
    return mask_response_for_user(CustomerCharacteristics(**doc).model_dump(), ctx)


@router.get("/customer/{customer_id}/history", response_model=AnalysisHistoryResponse)
async def get_customer_history(
    customer_id: str,
    limit: int = 30,
    month: Optional[str] = None,
    _ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取客户分析历史"""
    db = DATABASE
    
    query = {"customer_id": customer_id}
    if month:
        # 支持 YYYY-MM 格式
        query["date"] = {"$regex": f"^{month}"}
        # 如果是按月查询，通常需要该月所有数据，不设 limit or 设大一点
        limit = 100 
    
    cursor = db['analysis_history_log'].find(query).sort("date", -1).limit(limit)
    
    items = []
    for doc in cursor:
        tags_snapshot = doc.get("tags_snapshot", [])
        
        items.append(AnalysisHistoryItem(
            date=doc.get("date", ""),
            execution_time=doc.get("execution_time", datetime.now()),
            tags=tags_snapshot,
            rule_ids=doc.get("rule_ids", []),
            metrics=doc.get("metrics"),
            baseline_curve=doc.get("baseline_curve")
        ))
    
    return AnalysisHistoryResponse(customer_id=customer_id, items=items)


@router.get("/customer/{customer_id}/alerts", response_model=AnomalyAlertListResponse)
async def get_customer_alerts(
    customer_id: str,
    limit: int = 50,
    ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """获取客户异动告警历史"""
    db = DATABASE
    
    cursor = db['customer_anomaly_alerts'].find(
        {"customer_id": customer_id}
    ).sort("alert_date", -1).limit(limit)
    
    items = []
    for a in cursor:
        items.append(AnomalyAlertItem(
            id=str(a["_id"]),
            customer_id=a["customer_id"],
            customer_name=a.get("customer_name", "Unknown"),
            alert_date=a.get("alert_date", ""),
            alert_type=a.get("alert_type", ""),
            severity=a.get("severity", "warning"),
            confidence=a.get("confidence", 0),
            reason=a.get("reason", ""),
            metrics=a.get("metrics"),
            acknowledged=a.get("acknowledged", False),
            acknowledged_by=a.get("acknowledged_by"),
            acknowledged_at=a.get("acknowledged_at"),
            notes=a.get("notes")
        ))
    
    return mask_response_for_user(AnomalyAlertListResponse(total=len(items), items=items).model_dump(), ctx)


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: str,
    request: AcknowledgeRequest,
    current_user = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:analysis_load_characteristics:edit")),
):
    """确认异动告警"""
    db = DATABASE
    
    try:
        oid = ObjectId(alert_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid alert ID")
    
    update_data = {
        "acknowledged": request.acknowledged,
        "notes": request.notes
    }
    
    if request.acknowledged:
        update_data["acknowledged_by"] = current_user.username
        update_data["acknowledged_at"] = datetime.now()
    else:
        # If un-checking, clear the processed info
        update_data["acknowledged_by"] = None
        update_data["acknowledged_at"] = None

    result = db['customer_anomaly_alerts'].update_one(
        {"_id": oid},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    return {"status": "success", "alert_id": alert_id}


# --- Chart Data Endpoints ---

from webapp.services.load_query_service import LoadQueryService
from webapp.models.load_models import DailyTotal, MonthlyTotal


@router.get("/customer/{customer_id}/daily-trend", response_model=List[DailyTotal])
async def get_customer_daily_trend(
    customer_id: str,
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    _ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """Get daily energy usage for long-term trend analysis"""
    data = LoadQueryService.get_daily_totals(customer_id, start_date, end_date)
    return data


@router.get("/customer/{customer_id}/monthly-energy", response_model=List[MonthlyTotal])
async def get_customer_monthly_energy(
    customer_id: str,
    start_month: str = Query(..., description="YYYY-MM"),
    end_month: str = Query(..., description="YYYY-MM"),
    _ctx: CurrentUserContext = Depends(require_permission("module:analysis_load_characteristics:view")),
):
    """Get monthly energy usage for long-term analysis"""
    data = LoadQueryService.get_monthly_totals(customer_id, start_month, end_month)
    return data

