# -*- coding: utf-8 -*-
from datetime import datetime
from typing import Any, Optional

from bson import ObjectId

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from webapp.models.settlement import SettlementVersion
from webapp.services.retail_monthly_settlement_service import RetailMonthlySettlementService
from webapp.services.retail_price_service import retail_price_service
from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.api.dependencies.authz import require_permission, CurrentUserContext
from webapp.api.masking import mask_response_for_user
from webapp.services.customer_name_masking_service import customer_name_masking_service

router = APIRouter(prefix="/retail-settlement", tags=["Retail Settlement"])

service = RetailSettlementService()
monthly_service = RetailMonthlySettlementService()


class RetailCalculationRequest(BaseModel):
    date: str = Field(..., description="结算日期 YYYY-MM-DD")
    force: bool = Field(False, description="是否强制重算")
    wholesale_version: SettlementVersion = Field(
        SettlementVersion.PLATFORM_DAILY,
        description="零售侧所依赖的批发结算版本",
    )


class MonthlyCalcRequest(BaseModel):
    month: str = Field(..., description="结算月份 YYYY-MM")
    force: bool = Field(False, description="是否强制重新计算")


class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None


@router.post("/calculate", response_model=ResponseModel)
def calculate_retail_settlement(
    req: RetailCalculationRequest,
    _ctx = Depends(require_permission("module:settlement_daily_overview:edit")),
    _recalc_ctx = Depends(require_permission("settlement:recalc:execute")),
):
    try:
        datetime.strptime(req.date, "%Y-%m-%d")
        result = service.calculate_all_customers_daily(
            req.date,
            force=req.force,
            wholesale_version=req.wholesale_version,
        )
        if not result or (result.get("failed", 0) > 0 and result.get("success", 0) == 0):
            return ResponseModel(code=400, message="Calculation failed or no data found", data=result)
        return ResponseModel(code=200, message="Calculation completed", data=result)
    except ValueError as exc:
        return ResponseModel(code=400, message=f"Invalid date format: {exc}", data=None)
    except Exception as exc:
        return ResponseModel(code=500, message=f"Internal Error: {exc}", data=None)


@router.get("/daily", response_model=ResponseModel)
def get_retail_daily_settlement(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    customer_id: Optional[str] = None,
    include_details: bool = False,
    settlement_type: str = Query("daily", description="结算类型：daily（预结算）或 monthly（月结口径）"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_daily_detail:view")),
):
    try:
        query = {
            "date": {"$gte": start_date, "$lte": end_date},
            "settlement_type": settlement_type,
        }
        if customer_id:
            query["customer_id"] = customer_id

        projection = None if include_details else {"period_details": 0}
        cursor = service.db["retail_settlement_daily"].find(query, projection).sort("date", 1)

        results = []
        for doc in cursor:
            if "_id" in doc:
                doc["_id"] = str(doc["_id"])
            results.append(doc)

        return ResponseModel(code=200, data=mask_response_for_user(results, ctx))
    except Exception as exc:
        return ResponseModel(code=500, message=str(exc), data=[])


@router.post("/monthly-calc", response_model=ResponseModel)
def trigger_monthly_calc(
    req: MonthlyCalcRequest,
    background_tasks: BackgroundTasks,
    _ctx = Depends(require_permission("module:settlement_monthly_detail:edit")),
    _recalc_ctx = Depends(require_permission("settlement:recalc:execute")),
):
    try:
        datetime.strptime(req.month, "%Y-%m")
    except ValueError:
        return ResponseModel(code=400, message="月份格式错误，需 YYYY-MM", data=None)

    ready, reason = monthly_service.validate_month_ready(req.month, allow_fallback=req.force)
    if not ready:
        return ResponseModel(code=400, message=reason, data=None)

    job_id = monthly_service.initialize_job(req.month, force=req.force)
    background_tasks.add_task(monthly_service.run_monthly_settlement, req.month, job_id, req.force)
    return ResponseModel(data={"job_id": job_id})


@router.get("/monthly-progress/{job_id}", response_model=ResponseModel)
def get_monthly_progress(job_id: str):
    job = monthly_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="未找到结算任务")
    job["job_id"] = job.pop("_id")
    return ResponseModel(data=job)


@router.get("/monthly-status", response_model=ResponseModel)
def get_monthly_status(month: str = Query(..., regex=r"^\d{4}-\d{2}$")):
    status = monthly_service.get_month_status(month)
    if not status:
        return ResponseModel(code=404, message="尚未生成月度状态", data=None)
    return ResponseModel(data=status)


@router.get("/monthly-summaries", response_model=ResponseModel)
def get_monthly_summaries(
    year: Optional[str] = Query(None, regex=r"^\d{4}$"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_monthly_overview:view")),
):
    summaries = monthly_service.list_monthly_summaries(year)
    return ResponseModel(data=mask_response_for_user({"summaries": summaries}, ctx))


@router.get("/monthly-customers", response_model=ResponseModel)
def get_monthly_customers(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_monthly_detail:view")),
):
    records = monthly_service.get_customer_records(month)
    for rec in records:
        rec["_id"] = str(rec["_id"])
    return ResponseModel(data=mask_response_for_user(records, ctx))


@router.get("/monthly-chart-data", response_model=ResponseModel)
def get_monthly_chart_data(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_monthly_detail:view")),
):
    try:
        data = monthly_service.get_month_chart_data(month)
        return ResponseModel(data=mask_response_for_user(data, ctx))
    except Exception as exc:
        return ResponseModel(code=500, message=str(exc), data={"customer_points": [], "package_summary": []})


@router.get("/monthly-customer-detail", response_model=ResponseModel)
def get_monthly_customer_detail(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$"),
    customer_id: Optional[str] = Query(None, description="客户ID"),
    customer_name: Optional[str] = Query(None, description="客户名称"),
    ctx: CurrentUserContext = Depends(require_permission("module:settlement_monthly_detail:view")),
):
    """获取单个客户的月度结算详情"""
    resolved_customer_id = customer_id
    if not resolved_customer_id and customer_name:
        resolved_customer_id = customer_name_masking_service.resolve_customer_id_by_display_name(customer_name)

    query = {"month": month}
    if resolved_customer_id:
        query["customer_id"] = resolved_customer_id
    elif customer_name:
        query["customer_name"] = customer_name
    else:
        return ResponseModel(code=400, message="customer_id 或 customer_name 至少提供一个", data=None)

    doc = monthly_service.db[monthly_service.CUSTOMER_COLLECTION].find_one(query)
    if not doc:
        return ResponseModel(code=404, message="未找到该客户月度结算数据", data=None)

    contract_id = doc.get("contract_id")
    package = None
    if contract_id:
        try:
            query_id = ObjectId(contract_id) if isinstance(contract_id, str) and len(contract_id) == 24 else contract_id
            contract = monthly_service.db.retail_contracts.find_one({"_id": query_id})
            if contract and contract.get("package_id"):
                package_id = contract["package_id"]
                package_query_id = ObjectId(package_id) if isinstance(package_id, str) and len(package_id) == 24 else package_id
                package = monthly_service.db.retail_packages.find_one({"_id": package_query_id})
        except Exception:
            package = None

    if not package and doc.get("package_name"):
        package = monthly_service.db.retail_packages.find_one({"package_name": doc["package_name"]})

    if package:
        doc["pricing_config"] = package.get("pricing_config", {})

        price_model = doc.get("price_model") or {}
        ref_price = price_model.get("reference_price") or {}
        ref_type = ref_price.get("type")
        if ref_type:
            corrected_base = retail_price_service.get_monthly_base_price(month, ref_type)
            if corrected_base is not None and corrected_base > 0:
                ref_price["base_value"] = float(corrected_base)
                price_model["reference_price"] = ref_price
                doc["price_model"] = price_model

    doc["_id"] = str(doc["_id"])
    return ResponseModel(data=mask_response_for_user(doc, ctx))
