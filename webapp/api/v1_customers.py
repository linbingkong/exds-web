from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from typing import Optional, List
from datetime import datetime
from webapp.models.customer import (
    Customer, CustomerCreate, CustomerUpdate, CustomerListResponse,
    MeterInfo, SyncUpdateRequest, SyncCandidate, SyncRequest
)
from webapp.services.customer_service import CustomerService
from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User
from webapp.api.dependencies.authz import require_permission, CurrentUserContext
from webapp.api.masking import mask_response_for_user
from webapp.services.customer_name_masking_service import customer_name_masking_service

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_customer(
    customer: CustomerCreate,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """创建新客户"""
    service = CustomerService(DATABASE)
    try:
        result = service.create(
            customer_data=customer.model_dump(exclude_unset=True),
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "已存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.get("/sync-preview", response_model=List[SyncCandidate])
async def preview_sync_data(
    current_user: User = Depends(get_current_active_user),
    ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """预览从原始数据同步的客户"""
    service = CustomerService(DATABASE)
    return mask_response_for_user(service.preview_sync_data(), ctx)


@router.post("/sync", response_model=dict)
async def sync_customers(
    request: SyncRequest,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """批量同步客户数据"""
    service = CustomerService(DATABASE)
    result = service.sync_customers(request.candidates, current_user.username)
    return result


@router.get("/field-options", response_model=dict)
async def get_field_options(
    current_user: User = Depends(get_current_active_user)
):
    """获取客户字段可选值（从现有数据聚合）"""
    # 聚合现有的 source 和 manager 值
    sources = DATABASE.customer_archives.distinct("source")
    managers = DATABASE.customer_archives.distinct("manager")
    
    # 过滤掉 None 和空字符串
    sources = [s for s in sources if s]
    managers = [m for m in managers if m]
    
    return {
        "sources": sorted(sources),
        "managers": sorted(managers)
    }


@router.get("", response_model=CustomerListResponse)
async def list_customers(
    keyword: Optional[str] = Query(None, description="搜索关键词（客户全称、简称或户号）"),
    tags: Optional[List[str]] = Query(None, description="标签筛选（多选）"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页大小"),
    sort_field: str = Query("created_at", description="排序字段"),
    sort_order: str = Query("desc", description="排序顺序 (asc/desc)"),
    current_user: User = Depends(get_current_active_user),
    ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """获取客户列表 (v2)"""
    service = CustomerService(DATABASE)
    use_masked_keyword_search = bool(keyword and not ctx.can_view_real_customer_name)
    matched_customer_ids = customer_name_masking_service.search_customer_ids_by_keyword(keyword or "") if use_masked_keyword_search else []
    result = service.list(
        filters={
            "keyword": keyword,
            "tags": tags,
            "customer_ids": matched_customer_ids,
            "include_name_search": not use_masked_keyword_search,
            "include_account_search": True,
        },
        page=page,
        page_size=page_size,
        sort_field=sort_field,
        sort_order=sort_order
    )
    return mask_response_for_user(result, ctx)



@router.get("/{customer_id}", response_model=dict)
async def get_customer(
    customer_id: str,
    current_user: User = Depends(get_current_active_user),
    ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """获取客户详情"""
    service = CustomerService(DATABASE)
    try:
        result = service.get_by_id(customer_id)
        return mask_response_for_user(result, ctx)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.put("/{customer_id}", response_model=dict)
async def update_customer(
    customer_id: str,
    customer: CustomerUpdate,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """更新客户信息"""
    service = CustomerService(DATABASE)
    try:
        result = service.update(
            customer_id=customer_id,
            customer_data=customer.model_dump(exclude_unset=True),
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        elif "已存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: str,
    password: str = Body(..., embed=True, description="当前用户登录密码"),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("customer:profile:delete"))
):
    """删除客户（需密码确认）"""
    # 验证密码
    from webapp.tools.security import verify_password, get_user
    from webapp.tools.mongo import DATABASE as db_instance
    user_in_db = get_user(db_instance, current_user.username)
    if not user_in_db or not verify_password(password, user_in_db.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码验证失败"
        )

    service = CustomerService(DATABASE)
    try:
        service.delete(customer_id)
        return None
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )




# 户号管理接口
@router.post("/{customer_id}/accounts", response_model=dict)
async def add_utility_account(
    customer_id: str,
    account_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """为客户添加户号"""
    service = CustomerService(DATABASE)
    try:
        result = service.add_utility_account(
            customer_id=customer_id,
            account_data=account_data,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        elif "已存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.put("/{customer_id}/accounts/{account_id}", response_model=dict)
async def update_utility_account(
    customer_id: str,
    account_id: str,
    account_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """更新户号信息"""
    service = CustomerService(DATABASE)
    try:
        result = service.update_utility_account(
            customer_id=customer_id,
            account_id=account_id,
            account_data=account_data,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.delete("/{customer_id}/accounts/{account_id}", response_model=dict)
async def delete_utility_account(
    customer_id: str,
    account_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """删除户号"""
    service = CustomerService(DATABASE)
    try:
        result = service.delete_utility_account(
            customer_id=customer_id,
            account_id=account_id,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


# 计量点管理接口
@router.post("/{customer_id}/accounts/{account_id}/metering-points", response_model=dict)
async def add_metering_point(
    customer_id: str,
    account_id: str,
    metering_point_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """为户号添加计量点"""
    service = CustomerService(DATABASE)
    try:
        result = service.add_metering_point(
            customer_id=customer_id,
            account_id=account_id,
            metering_point_data=metering_point_data,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        elif "已存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.put("/{customer_id}/accounts/{account_id}/metering-points/{metering_point_id}", response_model=dict)
async def update_metering_point(
    customer_id: str,
    account_id: str,
    metering_point_id: str,
    metering_point_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """更新计量点信息"""
    service = CustomerService(DATABASE)
    try:
        result = service.update_metering_point(
            customer_id=customer_id,
            account_id=account_id,
            metering_point_id=metering_point_id,
            metering_point_data=metering_point_data,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.delete("/{customer_id}/accounts/{account_id}/metering-points/{metering_point_id}", response_model=dict)
async def delete_metering_point(
    customer_id: str,
    account_id: str,
    metering_point_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """删除计量点"""
    service = CustomerService(DATABASE)
    try:
        result = service.delete_metering_point(
            customer_id=customer_id,
            account_id=account_id,
            metering_point_id=metering_point_id,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


# 数据一致性管理接口
@router.get("/meter-info/{meter_id}", response_model=MeterInfo)
async def get_meter_info(
    meter_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """获取电表信息（用于自动填充）"""
    service = CustomerService(DATABASE)
    result = service.get_meter_info(meter_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"电表 '{meter_id}' 不存在"
        )
    return result


@router.post("/meters/{meter_id}/sync-update", response_model=dict)
async def sync_update_meter(
    meter_id: str,
    update_data: SyncUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """同步更新电表信息"""
    service = CustomerService(DATABASE)

    # 检查电表是否存在
    meter_info = service.get_meter_info(meter_id)
    if not meter_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"电表 '{meter_id}' 不存在"
        )

    # 执行同步更新
    result = service.sync_update_meter(
        meter_id=meter_id,
        update_data=update_data.model_dump(exclude_unset=True, exclude={"sync_all"}),
        sync_all=update_data.sync_all,
        operator=current_user.username
    )

    return result


# ==================== 客户状态转换接口 ====================

@router.post("/{customer_id}/sign-contract", response_model=dict)
async def sign_contract(
    customer_id: str,
    contract_id: Optional[str] = Body(None, embed=True, description="关联的合同ID"),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    签约操作：将意向客户转换为待生效状态

    状态流转：prospect → pending
    """
    service = CustomerService(DATABASE)
    try:
        result = service.sign_contract(
            customer_id=customer_id,
            operator=current_user.username,
            contract_id=contract_id
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.post("/{customer_id}/cancel-contract", response_model=dict)
async def cancel_contract(
    customer_id: str,
    reason: Optional[str] = Body(None, description="撤销原因"),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    撤销操作：将待生效客户转换为已终止状态

    状态流转：pending → terminated
    """
    service = CustomerService(DATABASE)
    try:
        result = service.cancel_contract(
            customer_id=customer_id,
            operator=current_user.username,
            reason=reason
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.post("/{customer_id}/activate", response_model=dict)
async def activate(
    customer_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    生效操作：将待生效客户转换为执行中状态

    状态流转：pending → active
    """
    service = CustomerService(DATABASE)
    try:
        result = service.activate(
            customer_id=customer_id,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.post("/{customer_id}/suspend", response_model=dict)
async def suspend(
    customer_id: str,
    reason: Optional[str] = Body(None, description="暂停原因"),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    暂停操作：将执行中客户转换为已暂停状态

    状态流转：active → suspended
    """
    service = CustomerService(DATABASE)
    try:
        result = service.suspend(
            customer_id=customer_id,
            operator=current_user.username,
            reason=reason
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.post("/{customer_id}/resume", response_model=dict)
async def resume(
    customer_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    恢复操作：将已暂停客户转换为执行中状态

    状态流转：suspended → active
    """
    service = CustomerService(DATABASE)
    try:
        result = service.resume(
            customer_id=customer_id,
            operator=current_user.username
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


@router.post("/{customer_id}/terminate", response_model=dict)
async def terminate(
    customer_id: str,
    reason: Optional[str] = Body(None, description="终止原因"),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """
    终止操作：将执行中或已暂停客户转换为已终止状态

    状态流转：active/suspended → terminated
    """
    service = CustomerService(DATABASE)
    try:
        result = service.terminate(
            customer_id=customer_id,
            operator=current_user.username,
            reason=reason
        )
        return result
    except ValueError as e:
        error_msg = str(e)
        if "不存在" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_msg
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg
            )


# ==================== 客户标签管理接口 ====================

@router.get("/customer-tags", response_model=List[dict])
async def get_customer_tags(
    current_user: User = Depends(get_current_active_user),
    _ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """获取所有可用的客户标签"""
    from webapp.tools.mongo import DATABASE
    tags_collection = DATABASE.customer_tags
    
    # 获取所有标签
    tags = list(tags_collection.find({}).sort("name", 1))
    
    # 转换 _id 为字符串
    result = []
    for tag in tags:
        result.append({
            "_id": str(tag["_id"]),
            "name": tag.get("name", ""),
            "category": tag.get("category"),
            "description": tag.get("description")
        })
    
    return result


@router.post("/customer-tags", response_model=dict)
async def create_customer_tag(
    tag_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """创建新的客户标签"""
    from webapp.tools.mongo import DATABASE
    from bson import ObjectId
    
    tags_collection = DATABASE.customer_tags
    
    # 检查标签名称是否已存在
    existing = tags_collection.find_one({"name": tag_data.get("name")})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"标签 '{tag_data.get('name')}' 已存在"
        )
    
    # 创建新标签
    new_tag = {
        "name": tag_data.get("name"),
        "category": tag_data.get("category"),
        "description": tag_data.get("description"),
        "created_by": current_user.username,
        "created_at": datetime.now()
    }
    
    result = tags_collection.insert_one(new_tag)
    
    return {
        "_id": str(result.inserted_id),
        "name": new_tag["name"],
        "category": new_tag.get("category"),
        "description": new_tag.get("description")
    }


@router.put("/customer-tags/{tag_id}", response_model=dict)
async def update_customer_tag(
    tag_id: str,
    tag_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """更新客户标签"""
    from webapp.tools.mongo import DATABASE
    from bson import ObjectId
    
    if not ObjectId.is_valid(tag_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的标签ID"
        )
    
    tags_collection = DATABASE.customer_tags
    customers_collection = DATABASE.customer_archives
    
    # 检查标签是否存在
    existing_tag = tags_collection.find_one({"_id": ObjectId(tag_id)})
    if not existing_tag:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="标签不存在"
        )
    
    old_name = existing_tag.get("name")
    new_name = tag_data.get("name", old_name)
    
    # 检查新名称是否与其他标签重复
    if new_name != old_name:
        duplicate = tags_collection.find_one({
            "name": new_name,
            "_id": {"$ne": ObjectId(tag_id)}
        })
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"标签名称 '{new_name}' 已存在"
            )
    
    # 更新标签
    update_data = {
        "name": new_name,
        "category": tag_data.get("category", existing_tag.get("category")),
        "description": tag_data.get("description", existing_tag.get("description")),
        "updated_by": current_user.username,
        "updated_at": datetime.now()
    }
    
    tags_collection.update_one(
        {"_id": ObjectId(tag_id)},
        {"$set": update_data}
    )
    
    # 同步更新 customer_archives 中使用该标签的文档
    updated_customers_count = 0
    if new_name != old_name:
        result = customers_collection.update_many(
            {"tags.name": old_name},
            {"$set": {"tags.$.name": new_name}}
        )
        updated_customers_count = result.modified_count
    
    return {
        "_id": tag_id,
        "name": new_name,
        "category": update_data.get("category"),
        "description": update_data.get("description"),
        "updated_customers_count": updated_customers_count
    }


@router.delete("/customer-tags/{tag_id}", response_model=dict)
async def delete_customer_tag(
    tag_id: str,
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit"))
):
    """删除客户标签"""
    from webapp.tools.mongo import DATABASE
    from bson import ObjectId
    
    if not ObjectId.is_valid(tag_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的标签ID"
        )
    
    tags_collection = DATABASE.customer_tags
    customers_collection = DATABASE.customer_archives
    
    # 检查标签是否存在
    existing_tag = tags_collection.find_one({"_id": ObjectId(tag_id)})
    if not existing_tag:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="标签不存在"
        )
    
    tag_name = existing_tag.get("name")
    
    # 从 customer_archives 中移除该标签
    result = customers_collection.update_many(
        {"tags.name": tag_name},
        {"$pull": {"tags": {"name": tag_name}}}
    )
    affected_customers_count = result.modified_count
    
    # 删除标签
    tags_collection.delete_one({"_id": ObjectId(tag_id)})
    
    return {
        "deleted": True,
        "tag_name": tag_name,
        "affected_customers_count": affected_customers_count
    }


# ==================== 客户关联合同查询接口 ====================

@router.get("/{customer_id}/contracts", response_model=List[dict])
async def get_customer_contracts(
    customer_id: str,
    current_user: User = Depends(get_current_active_user),
    ctx: CurrentUserContext = Depends(require_permission("module:customer_profiles:view")),
):
    """获取客户关联的零售合同"""
    from webapp.tools.mongo import DATABASE
    from bson import ObjectId
    
    contracts_collection = DATABASE.retail_contracts
    
    # 查询该客户的所有合同
    contracts = list(contracts_collection.find(
        {"customer_id": customer_id}
    ).sort("purchase_start_month", -1))
    
    # 转换数据格式
    result = []
    for contract in contracts:
        result.append({
            "_id": str(contract["_id"]),
            "contract_name": contract.get("contract_name", ""),
            "package_name": contract.get("package_name"),
            "start_date": contract.get("purchase_start_month").isoformat() if contract.get("purchase_start_month") else None,
            "end_date": contract.get("purchase_end_month").isoformat() if contract.get("purchase_end_month") else None,
            "contracted_quantity": contract.get("purchasing_electricity_quantity")
        })
    
    return mask_response_for_user(result, ctx)
