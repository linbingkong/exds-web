"""
中长期趋势分析 - 数据模型
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict


class DailyTrendPoint(BaseModel):
    """每日趋势数据点"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    contract_vwap: Optional[float] = Field(None, description="中长期合同日均价 (VWAP)")
    spot_vwap: Optional[float] = Field(None, description="现货日均价 (VWAP)")
    vwap_spread: Optional[float] = Field(None, description="价差 = contract - spot")
    positive_spread_count: int = Field(0, description="正价差时段数")
    negative_spread_count: int = Field(0, description="负价差时段数")


class SpreadStats(BaseModel):
    """价差统计指标"""
    avgSpread: float = Field(0, description="平均价差")
    positiveSpreadRatio: float = Field(0, description="正价差占比 (%)")
    negativeSpreadRatio: float = Field(0, description="负价差占比 (%)")
    maxSpread: float = Field(0, description="最大价差")
    minSpread: float = Field(0, description="最小价差")


class SpreadDistribution(BaseModel):
    """价差分布区间"""
    range: str = Field(..., description="区间范围，如 '-50~0'")
    count: int = Field(0, description="该区间的时段数")


class Period48TrendPoint(BaseModel):
    """区间聚合后的48时段均价数据点"""
    period: int = Field(..., ge=1, le=48, description="48时段编号")
    label: str = Field(..., description="展示标签，如 '01'")
    contract_vwap: Optional[float] = Field(None, description="区间内中长期合同48时段均价")
    spot_vwap: Optional[float] = Field(None, description="区间内现货48时段均价")
    vwap_spread: Optional[float] = Field(None, description="价差 = contract - spot")


class ContractPriceTrendResponse(BaseModel):
    """中长期趋势分析响应"""
    daily_trends: List[DailyTrendPoint] = Field(..., description="每日趋势数据")
    spread_stats: SpreadStats = Field(..., description="价差统计指标")
    spread_distribution: List[SpreadDistribution] = Field(..., description="价差分布直方图数据")
    period_48_trends: List[Period48TrendPoint] = Field(default_factory=list, description="区间聚合后的48时段均价数据")


# ========== 曲线分析模型 ==========

class DailyCurvePoint(BaseModel):
    """每日曲线数据点"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    vwap: Optional[float] = Field(None, description="日均价 (VWAP)")


class CurvePeriod48Point(BaseModel):
    """48时段曲线数据点"""
    period: int = Field(..., ge=1, le=48, description="48时段编号")
    label: str = Field(..., description="展示标签，如 '01'")
    vwap: Optional[float] = Field(None, description="48时段均价 (VWAP)")


class CurveData(BaseModel):
    """单条曲线数据"""
    key: str = Field(..., description="曲线标识，如 '市场化-月内'")
    contract_type: str = Field(..., description="合同类型：市场化、绿电、代理购电")
    contract_period: str = Field(..., description="合同周期：整体、年度、月度、月内")
    label: str = Field(..., description="显示标签")
    color: str = Field(..., description="曲线颜色")
    points: List[DailyCurvePoint] = Field(default_factory=list, description="每日数据点")
    period_48_points: List[CurvePeriod48Point] = Field(default_factory=list, description="区间聚合后的48时段数据点")


class CurveAnalysisResponse(BaseModel):
    """曲线分析响应"""
    curves: List[CurveData] = Field(default_factory=list, description="所有曲线数据")
    spot_curve: CurveData = Field(..., description="现货基准曲线")
    date_range: List[str] = Field(default_factory=list, description="日期范围列表")


# ========== 电量结构模型 ==========

class DailyQuantityPoint(BaseModel):
    """每日电量数据点"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    # 按周期分组
    yearly_qty: float = Field(0, description="年度电量 MWh")
    monthly_qty: float = Field(0, description="月度电量 MWh")
    within_month_qty: float = Field(0, description="月内电量 MWh")
    # 按类型分组
    market_qty: float = Field(0, description="市场化电量 MWh")
    green_qty: float = Field(0, description="绿电电量 MWh")
    agency_qty: float = Field(0, description="代理购电电量 MWh")
    # 总量
    total_qty: float = Field(0, description="当日总电量 MWh")


class QuantityStructureResponse(BaseModel):
    """电量结构响应"""
    daily_quantities: List[DailyQuantityPoint] = Field(default_factory=list, description="每日电量数据")
    # 汇总统计
    total_quantity: float = Field(0, description="时段总电量 MWh")
    period_totals: Dict[str, float] = Field(default_factory=dict, description="按周期汇总 {年度: x, 月度: y, 月内: z}")
    type_totals: Dict[str, float] = Field(default_factory=dict, description="按类型汇总 {市场化: x, 绿电: y, 代购电: z}")
    date_range: List[str] = Field(default_factory=list, description="日期范围列表")

