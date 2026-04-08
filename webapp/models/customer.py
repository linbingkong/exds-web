"""
客户档案管理模型 (v2)
根据 dataset_structures_v2.md 重构
"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Literal, List, Any, Dict
from datetime import datetime
from bson import ObjectId


class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler):
        from pydantic_core import core_schema
        return core_schema.union_schema([
            core_schema.is_instance_schema(ObjectId),
            core_schema.no_info_plain_validator_function(cls.validate),
        ], serialization=core_schema.plain_serializer_function_ser_schema(
            lambda x: str(x)
        ))

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            if not ObjectId.is_valid(v):
                raise ValueError("Invalid ObjectId")
            return ObjectId(v)
        raise ValueError("Invalid ObjectId")


class BaseMongoModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True
    )

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")


# ==================== 标签相关模型 ====================

class Tag(BaseModel):
    """客户标签 (嵌入在客户文档中)"""
    name: str = Field(..., description="标签名/值")
    source: Literal["AUTO", "MANUAL"] = Field("MANUAL", description="来源: AUTO(算法)/MANUAL(人工)")
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="置信度 (0.0-1.0)")
    rule_id: Optional[str] = Field(None, description="命中规则ID")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="元数据 (如相似度、聚类ID)")
    expire: Optional[datetime] = Field(None, description="失效时间 (用于临时标签)")
    reason: Optional[str] = Field(None, description="原因/备注")


# ==================== 户号与资产模型 (v2 结构) ====================

class Meter(BaseModel):
    """电表信息"""
    meter_id: str = Field(..., description="电表资产号")
    multiplier: float = Field(..., gt=0, description="倍率")
    allocation_ratio: Optional[float] = Field(None, ge=0, le=1.0, description="分配系数 0-1.0, 空表示未校验")


class MeteringPoint(BaseModel):
    """计量点信息"""
    mp_no: str = Field(..., description="计量点编号")
    mp_name: Optional[str] = Field(None, description="计量点名称")


class Account(BaseModel):
    """户号信息 (v2 结构)"""
    account_id: str = Field(..., description="用电户号")
    meters: List[Meter] = Field(default_factory=list, description="挂载电表列表")
    metering_points: List[MeteringPoint] = Field(default_factory=list, description="挂载计量点列表")


# ==================== 地理位置模型 ====================

class GeoLocation(BaseModel):
    """GeoJSON Point 格式的地理位置"""
    type: Literal["Point"] = "Point"
    coordinates: List[float] = Field(..., description="经纬度坐标 [longitude, latitude]")


# ==================== 客户模型 (v2) ====================

class CustomerCreate(BaseModel):
    """客户创建模型 (v2)"""
    # 客户基本信息
    user_name: str = Field(..., min_length=1, description="客户全称")
    short_name: str = Field(..., min_length=1, description="客户简称")
    needs_name_masking: Optional[bool] = Field(None, description="是否需要客户名称脱敏")
    
    # 位置信息 (关联 weather_locations)
    location: Optional[str] = Field(None, description="气象区域名称 (关联 weather_locations.name)")
    
    # 管理信息
    source: Optional[str] = Field(None, description="客户来源 (自营开发、居间代理A、居间代理B)")
    manager: Optional[str] = Field(None, description="客户经理")
    
    # 户号信息 (v2 结构)
    accounts: List[Account] = Field(default_factory=list, description="用电户号列表")
    
    # 标签
    tags: List[Tag] = Field(default_factory=list, description="标签集合")


class Customer(BaseMongoModel, CustomerCreate):
    """客户完整模型 (v2)"""
    # 审计字段
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")
    updated_at: datetime = Field(default_factory=datetime.now, description="更新时间")
    created_by: Optional[str] = Field(None, description="创建人")
    updated_by: Optional[str] = Field(None, description="更新人")


class CustomerUpdate(BaseModel):
    """客户更新模型 (v2，所有字段可选)"""
    user_name: Optional[str] = Field(None, min_length=1, description="客户全称")
    short_name: Optional[str] = Field(None, min_length=1, description="客户简称")
    needs_name_masking: Optional[bool] = Field(None, description="是否需要客户名称脱敏")
    location: Optional[str] = Field(None, description="气象区域名称")
    source: Optional[str] = Field(None, description="客户来源")
    manager: Optional[str] = Field(None, description="客户经理")
    accounts: Optional[List[Account]] = Field(None, description="用电户号列表")
    tags: Optional[List[Tag]] = Field(None, description="标签集合")


# ==================== 列表与响应模型 ====================

class CustomerListItem(BaseModel):
    """客户列表项模型 (v2)"""
    id: str = Field(..., description="客户ID")
    user_name: str = Field(..., description="客户全称")
    short_name: Optional[str] = Field(None, description="客户简称")
    needs_name_masking: Optional[bool] = Field(None, description="是否需要客户名称脱敏")
    location: Optional[str] = Field(None, description="气象区域")
    tags: List[Tag] = Field(default_factory=list, description="标签列表")
    account_count: int = Field(0, description="户号数量")
    meter_count: int = Field(0, description="电表数量")
    mp_count: int = Field(0, description="计量点数量")
    current_year_contract_amount: float = Field(0.0, description="当年签约电量(万度)")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")


class CustomerListResponse(BaseModel):
    """客户列表响应模型"""
    total: int = Field(..., description="总数量")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页大小")
    items: List[CustomerListItem] = Field(..., description="客户列表")


# ==================== 辅助模型 ====================

class MeterInfo(BaseModel):
    """电表信息（用于自动填充）"""
    meter_id: str = Field(..., description="电表资产号")
    multiplier: float = Field(..., description="倍率")
    usage_count: int = Field(..., description="使用次数")


class SyncUpdateRequest(BaseModel):
    """同步更新请求模型"""
    multiplier: Optional[float] = Field(None, gt=0, description="新倍率")
    sync_all: bool = Field(True, description="是否同步更新所有计量点")


class DeleteCustomerRequest(BaseModel):
    """删除客户请求 (需密码确认)"""
    password: str = Field(..., min_length=1, description="当前用户登录密码")


# ==================== 兼容旧版本的别名 ====================
# 保留旧名称以兼容现有代码，后续逐步迁移

UtilityAccount = Account  # 兼容旧名称

# ==================== 数据同步模型 ====================

class SyncCandidate(BaseModel):
    """待同步数据候选项"""
    mp_no: str = Field(..., description="计量点编号 (raw_mp_data.mp_id)")
    customer_name: str = Field(..., description="客户名称 (raw_mp_data.meta.customer_name)")
    account_id: str = Field(..., description="用电户号 (raw_mp_data.meta.account_id)")

class SyncRequest(BaseModel):
    """批量同步请求"""
    candidates: List[SyncCandidate] = Field(..., description="需同步的候选列表")
