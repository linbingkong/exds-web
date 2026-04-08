from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Any
from pydantic import BaseModel
from datetime import datetime
from fastapi.responses import StreamingResponse

from webapp.services.settlement_service import SettlementService
from webapp.services.export_service import ExportService
from webapp.models.settlement import SettlementDaily, SettlementVersion
from webapp.api.dependencies.authz import require_permission, CurrentUserContext
from webapp.api.masking import mask_response_for_user

router = APIRouter(prefix="/settlement", tags=["Settlement"])

service = SettlementService()
export_service = ExportService()

class CalculationRequest(BaseModel):
    date: str
    version: SettlementVersion = SettlementVersion.PRELIMINARY
    force: bool = False

class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None

class SettlementMetadata(BaseModel):
    preliminary_latest_date: Optional[str] = None
    platform_daily_latest_date: Optional[str] = None

@router.get("/metadata", response_model=ResponseModel)
async def get_settlement_metadata():
    """
    获取结算元数据（各版本的最新日期）
    """
    try:
        preliminary_date = await service.get_latest_results_date(SettlementVersion.PRELIMINARY)
        platform_date = await service.get_latest_results_date(SettlementVersion.PLATFORM_DAILY)
        
        return ResponseModel(code=200, data=SettlementMetadata(
            preliminary_latest_date=preliminary_date,
            platform_daily_latest_date=platform_date
        ))
    except Exception as e:
        return ResponseModel(code=500, message=str(e), data=None)

@router.post("/calculate", response_model=ResponseModel)
async def calculate_daily_settlement(
    req: CalculationRequest,
    _ctx = Depends(require_permission("module:settlement_daily_overview:edit")),
    _recalc_ctx = Depends(require_permission("settlement:recalc:execute")),
):
    """
    触发指定日期的预结算计算
    """
    try:
        # 校验日期格式
        datetime.strptime(req.date, "%Y-%m-%d")
        
        result = await service.run_daily_settlement(req.date, version=req.version, force=req.force)

        if not result.get("success"):
            return ResponseModel(
                code=400,
                message=result.get("message", "Calculation failed"),
                data={
                    "status": result.get("status"),
                    "missing_items": result.get("missing_items", []),
                    "date": req.date,
                    "version": req.version.value
                }
            )

        return ResponseModel(code=200, message=result.get("message", "????"), data=result.get("data"))
        
    except ValueError as ve:
        return ResponseModel(code=400, message=f"Invalid date format: {ve}", data=None)
    except Exception as e:
        return ResponseModel(code=500, message=f"Internal Error: {str(e)}", data=None)

@router.get("/daily", response_model=ResponseModel)
async def get_daily_settlement(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    version: Optional[SettlementVersion] = None,
    include_details: bool = False,
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_daily_overview:view")),
):
    """
    获取指定日期范围的日结算数据
    """
    try:
        # 查询数据库
        query = {
            "operating_date": {"$gte": start_date, "$lte": end_date}
        }
        if version:
            query["version"] = version
        
        # 优化：根据 include_details 决定是否加载重型明细数据
        projection = None if include_details else {"period_details": 0}
        cursor = service.db.settlement_daily.find(query, projection).sort("operating_date", 1)
        
        results = []
        for doc in cursor:
            # 转换为 Pydantic 模型
            daily = SettlementDaily(**doc)
            
            # 如果不需要明细，则清空 period_details (为了减少网络传输)
            # 注意: Pydantic .dict(exclude={...}) 可能更好，但这里我们直接操作对象或字典
            if not include_details:
                # 重新构造不带明细的字典? 或者让前端处理?
                # 为了性能，后端处理。
                # 由于 SettlementDaily 字段较多，手动构造比较繁琐。
                # 简单做法: 设置为空列表 (但类型检查可能报错 if definition is List[...])
                # 或者使用 exclude
                pass
            
            results.append(daily)

        # 序列化处理
        # 如果 include_details=False, 我们在由 Pydantic 转 dict 时排除
        data_list = []
        for r in results:
            if not include_details:
                if hasattr(r, 'model_dump'): # Pydantic v2
                    d = r.model_dump(exclude={'period_details'})
                else: # Pydantic v1
                    d = r.dict(exclude={'period_details'})
            else:
                if hasattr(r, 'model_dump'):
                    d = r.model_dump()
                else:
                    d = r.dict()
            data_list.append(d)

        return ResponseModel(code=200, data=mask_response_for_user(data_list, ctx))

    except Exception as e:
        return ResponseModel(code=500, message=str(e), data=[])


@router.get("/overview", response_model=ResponseModel)
async def get_settlement_overview(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$", description="月份，格式 YYYY-MM"),
    version: SettlementVersion = Query(SettlementVersion.PRELIMINARY, description="结算版本"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_daily_overview:view")),
):
    """
    预结算总览：汇总指定月份的批发侧成本、零售侧收入，计算毛利和均价。
    """
    try:
        import calendar
        year, mon = int(month[:4]), int(month[5:7])
        _, last_day = calendar.monthrange(year, mon)
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        db = service.db

        # ====== 批发侧 ======
        wholesale_cursor = db.settlement_daily.find(
            {"operating_date": {"$gte": start_date, "$lte": end_date}, "version": version.value},
            projection={"period_details": 0}
        ).sort("operating_date", 1)

        wholesale_by_date = {}
        for doc in wholesale_cursor:
            d = doc["operating_date"]
            wholesale_by_date[d] = {
                "volume_mwh": doc.get("real_time_volume", 0) or 0,
                "wholesale_cost": doc.get("predicted_wholesale_cost", 0) or 0,
                "deviation_recovery_fee": doc.get("deviation_recovery_fee", 0) or 0,
                "wholesale_avg_price": doc.get("predicted_wholesale_price", 0) or 0,
            }

        # ====== 零售侧（聚合全客户，仅统计预结算口径）======
        retail_match = {
            "date": {"$gte": start_date, "$lte": end_date},
            "settlement_type": "daily",
        }

        retail_pipeline = [
            {"$match": retail_match},
            {"$group": {
                "_id": "$date",
                "total_fee": {"$sum": "$total_fee"},
                "total_load": {"$sum": "$total_load_mwh"},
                "customer_count": {"$sum": 1},
            }},
            {"$sort": {"_id": 1}},
        ]
        retail_results = list(db.retail_settlement_daily.aggregate(retail_pipeline))
        retail_by_date = {}
        for r in retail_results:
            retail_by_date[r["_id"]] = {
                "retail_revenue": r["total_fee"] or 0,
                "retail_load": r["total_load"] or 0,
                "customer_count": r["customer_count"],
            }

        # ====== 合并日度数据 ======
        all_dates = sorted(set(list(wholesale_by_date.keys()) + list(retail_by_date.keys())))

        daily_details = []
        cumulative_profit = 0
        total_wholesale_cost = 0
        total_retail_revenue = 0
        total_volume = 0
        total_deviation_recovery = 0
        total_retail_load = 0
        max_customer_count = 0

        for d in all_dates:
            w_exists = d in wholesale_by_date
            w = wholesale_by_date.get(d, {"volume_mwh": 0, "wholesale_cost": 0, "deviation_recovery_fee": 0, "wholesale_avg_price": 0})
            r = retail_by_date.get(d, {"retail_revenue": 0, "retail_load": 0, "customer_count": 0})

            retail_avg_price = round(r["retail_revenue"] / r["retail_load"], 3) if r["retail_load"] > 0 else 0
            
            # 核心改进：仅在批发侧数据（对应版本）存在时，才计入汇总指标，以保证结算口径一致
            if w_exists:
                price_spread = round(retail_avg_price - w["wholesale_avg_price"], 3)
                daily_profit = round(r["retail_revenue"] - w["wholesale_cost"], 2)
                cumulative_profit = round(cumulative_profit + daily_profit, 2)

                total_wholesale_cost += w["wholesale_cost"]
                total_retail_revenue += r["retail_revenue"]
                total_volume += w["volume_mwh"]
                total_deviation_recovery += w["deviation_recovery_fee"]
                total_retail_load += r["retail_load"]
                max_customer_count = max(max_customer_count, r["customer_count"])
            else:
                # 缺失批发侧版本数据时，不参与汇总，明细中也不计入当日盈亏
                price_spread = 0
                daily_profit = 0
                # cumulative_profit 保持上一日值

            daily_details.append({
                "date": d,
                "volume_mwh": round(w["volume_mwh"], 3),
                "wholesale_cost": round(w["wholesale_cost"], 2),
                "deviation_recovery_fee": round(w["deviation_recovery_fee"], 2),
                "wholesale_avg_price": round(w["wholesale_avg_price"], 3),
                "retail_revenue": round(r["retail_revenue"], 2),
                "retail_avg_price": retail_avg_price,
                "price_spread": price_spread,
                "daily_profit": daily_profit,
                "cumulative_profit": cumulative_profit,
                "data_status": "complete" if w_exists else "wholesale_missing"
            })

        # ====== 汇总 ======
        wholesale_avg = round(total_wholesale_cost / total_volume, 3) if total_volume > 0 else 0
        retail_avg = round(total_retail_revenue / total_retail_load, 3) if total_retail_load > 0 else 0
        gross_profit = round(total_retail_revenue - total_wholesale_cost, 2)
        profit_margin = round(gross_profit / total_wholesale_cost * 100, 2) if total_wholesale_cost > 0 else 0

        summary = {
            "customer_count": max_customer_count,
            "settlement_start": all_dates[0] if all_dates else start_date,
            "settlement_end": all_dates[-1] if all_dates else end_date,
            "total_wholesale_cost": round(total_wholesale_cost, 2),
            "total_retail_revenue": round(total_retail_revenue, 2),
            "total_volume_mwh": round(total_volume, 3),
            "total_deviation_recovery_fee": round(total_deviation_recovery, 2),
            "wholesale_avg_price": wholesale_avg,
            "retail_avg_price": retail_avg,
            "price_spread": round(retail_avg - wholesale_avg, 3),
            "gross_profit": gross_profit,
            "profit_margin": profit_margin,
        }

        return ResponseModel(code=200, data=mask_response_for_user({
            "month": month,
            "version": version.value,
            "summary": summary,
            "daily_details": daily_details,
        }, ctx))

    except Exception as e:
        import traceback
        traceback.print_exc()
        return ResponseModel(code=500, message=str(e), data=None)

@router.get("/detail", response_model=ResponseModel)
async def get_settlement_detail(
    date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$", description="结算日期 YYYY-MM-DD"),
    version: SettlementVersion = Query(SettlementVersion.PRELIMINARY, description="结算版本"),
    settlement_type: str = Query("daily", description="结算类型：daily 或 monthly"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_daily_detail:view")),
):
    """
    获取指定日期的结算详情（包含批发侧和零售侧列表）
    """
    try:
        data = await service.get_settlement_detail(date, version, settlement_type=settlement_type)
        if not data:
            return ResponseModel(code=404, message="No settlement data found for this date/version", data=None)
        
        return ResponseModel(code=200, data=mask_response_for_user(data, ctx))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return ResponseModel(code=500, message=str(e), data=None)

@router.get("/customer-detail", response_model=ResponseModel)
async def get_settlement_customer_detail(
    date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$", description="结算日期 YYYY-MM-DD"),
    version: SettlementVersion = Query(SettlementVersion.PRELIMINARY, description="结算版本"),
    customer_id: str = Query(..., description="客户ID"),
    settlement_type: str = Query("daily", description="结算类型：daily 或 monthly"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_daily_detail:view")),
):
    """
    获取单个客户在指定日期的零售详情数据
    """
    try:
        data = await service.get_settlement_customer_detail(
            date,
            customer_id,
            version=version,
            settlement_type=settlement_type,
        )
        if not data:
            return ResponseModel(code=404, message="No retail settlement data found for this customer/date", data=None)
        
        return ResponseModel(code=200, data=mask_response_for_user(data, ctx))
    except Exception as e:
        return ResponseModel(code=500, message=str(e), data=None)

@router.get("/export/wholesale")
async def export_wholesale_settlement(
    date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$", description="结算日期 YYYY-MM-DD"),
    version: SettlementVersion = Query(SettlementVersion.PRELIMINARY, description="结算版本"),
):
    """
    导出指定日期的批发侧结算 Excel (保留公式)
    """
    try:
        data = await service.get_settlement_detail(date, version)
        if not data:
            raise HTTPException(status_code=404, detail="No settlement data found")
        
        version_label = "预结算" if version == SettlementVersion.PRELIMINARY else "确权版"
        excel_stream = export_service.export_wholesale_to_excel(date, version_label, data)
        
        filename = f"批发侧结算_{date}_{version_label}.xlsx"
        # 兼容中文文件名
        from urllib.parse import quote
        encoded_filename = quote(filename)
        
        headers = {
            'Content-Disposition': f"attachment; filename*=UTF-8''{encoded_filename}"
        }
        
        return StreamingResponse(
            excel_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/validate", response_model=ResponseModel)
async def validate_settlement_data(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$", description="月份，格式 YYYY-MM"),
):
    """
    日清结算数据校验：
    1. 比较当月 spot_settlement_daily(平台电能量费) 与 settlement_daily(PLATFORM_DAILY版) 的电能量费用，误差是否 < 10
    2. 比较当月 settlement_daily 中 PRELIMINARY 与 PLATFORM_DAILY 版本的标准值电费，误差是否 < 100
    """
    try:
        import calendar
        year, mon = int(month[:4]), int(month[5:7])
        _, last_day = calendar.monthrange(year, mon)
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        db = service.db
        
        # 1. 获取当月 spot_settlement_daily 数据 (平台原始日结数据)
        spot_cursor = db.spot_settlement_daily.find({
            "operating_date": {"$gte": start_date, "$lte": end_date}
        })
        spot_data = {doc["operating_date"]: doc.get("total_fee", 0) for doc in spot_cursor}
        
        # 2. 获取当月 settlement_daily 数据 (PRELIMINARY 和 PLATFORM_DAILY)
        preliminary_cursor = db.settlement_daily.find({
            "operating_date": {"$gte": start_date, "$lte": end_date},
            "version": SettlementVersion.PRELIMINARY.value
        }, projection={"operating_date": 1, "total_energy_fee": 1, "total_standard_value_cost": 1})
        preliminary_data = {doc["operating_date"]: doc for doc in preliminary_cursor}
        
        platform_cursor = db.settlement_daily.find({
            "operating_date": {"$gte": start_date, "$lte": end_date},
            "version": SettlementVersion.PLATFORM_DAILY.value
        }, projection={"operating_date": 1, "total_energy_fee": 1, "total_standard_value_cost": 1})
        platform_data = {doc["operating_date"]: doc for doc in platform_cursor}
        
        all_dates = sorted(list(set(list(spot_data.keys()) + list(preliminary_data.keys()) + list(platform_data.keys()))))
        
        rule1_errors = []
        rule2_errors = []
        
        for d in all_dates:
            # Rule 1: spot total_fee vs platform_daily total_energy_fee
            spot_fee = spot_data.get(d)
            pf_doc = platform_data.get(d)
            if spot_fee is not None and pf_doc is not None:
                pf_fee = pf_doc.get("total_energy_fee", 0)
                diff1 = abs(spot_fee - pf_fee)
                if diff1 > 10:
                    rule1_errors.append({
                        "date": d,
                        "platform_original_fee": round(spot_fee, 2),
                        "settlement_fee": round(pf_fee, 2),
                        "diff": round(diff1, 2)
                    })
            
            # Rule 2: preliminary vs platform_daily standard_value_cost
            pr_doc = preliminary_data.get(d)
            if pr_doc is not None and pf_doc is not None:
                pr_std = pr_doc.get("total_standard_value_cost", 0)
                pf_std = pf_doc.get("total_standard_value_cost", 0)
                diff2 = abs(pr_std - pf_std)
                if diff2 > 100:
                    rule2_errors.append({
                        "date": d,
                        "preliminary_std_cost": round(pr_std, 2),
                        "platform_std_cost": round(pf_std, 2),
                        "diff": round(diff2, 2)
                    })
                    
        return ResponseModel(code=200, data={
            "rule1_errors": rule1_errors,
            "rule2_errors": rule2_errors
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return ResponseModel(code=500, message=str(e), data=None)
