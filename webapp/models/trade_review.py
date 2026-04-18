from typing import List, Optional

from pydantic import BaseModel, Field


class TradeDateListResponse(BaseModel):
    latest_trade_date: Optional[str] = Field(None, description="最近交易日")
    trade_dates: List[str] = Field(default_factory=list, description="交易日期列表")


class DeliveryDateSummary(BaseModel):
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    record_count: int = Field(..., description="申报记录数")


class TradeOverviewResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_summaries: List[DeliveryDateSummary] = Field(default_factory=list, description="目标日期摘要")


class RecordOverviewCard(BaseModel):
    total_records: int = Field(..., description="总申报记录数")
    traded_records: int = Field(..., description="成交笔数")


class TradeOverviewCard(BaseModel):
    traded_mwh: float = Field(..., description="成交电量")
    buy_traded_mwh: float = Field(..., description="买入成交电量")
    sell_traded_mwh: float = Field(..., description="卖出成交电量")


class PeriodOverviewCard(BaseModel):
    traded_period_count: int = Field(..., description="成交时段数")
    buy_traded_period_count: int = Field(..., description="买入成交时段数")
    sell_traded_period_count: int = Field(..., description="卖出成交时段数")


class OperationOverviewCard(BaseModel):
    listing_operation_count: int = Field(..., description="挂牌申报次数")
    manual_off_shelf_operation_count: int = Field(..., description="人工下架次数")
    auto_off_shelf_operation_count: int = Field(..., description="自动下架次数")


class SummaryCardsResponse(BaseModel):
    record_overview: RecordOverviewCard
    trade_overview: TradeOverviewCard
    period_overview: PeriodOverviewCard
    operation_overview: OperationOverviewCard


class ExecutionAnalysisSummary(BaseModel):
    profit_count: int = Field(..., description="盈利时段数")
    profit_amount: float = Field(..., description="盈利金额")
    loss_count: int = Field(..., description="亏损时段数")
    loss_amount: float = Field(..., description="亏损金额")
    total_profit_amount: float = Field(..., description="当日交易总收益")


class DayAheadReviewChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="48时段")
    time: str = Field(..., description="时间标签")
    period_type: str = Field(..., description="分时时段类型")
    declared_mwh: float = Field(0.0, description="日前申报电量")
    actual_load_mwh: Optional[float] = Field(None, description="实际电量")
    forecast_gap_min_mwh: Optional[float] = Field(None, description="预测电量（gap最小）")
    price_rt: Optional[float] = Field(None, description="实时价格")
    node_price_rt: Optional[float] = Field(None, description="节点实时价格")
    price_da: Optional[float] = Field(None, description="日前物理出清价格")
    price_da_econ: Optional[float] = Field(None, description="日前经济出清价格")
    price_da_forecast: Optional[float] = Field(None, description="日前预测价格")


class DayAheadReviewResponse(BaseModel):
    target_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    settlement_price_type: str = Field(..., description="physical / econ")
    chart_rows: List[DayAheadReviewChartRow] = Field(default_factory=list, description="48时段图表数据")
    execution_analysis_summary: Optional[ExecutionAnalysisSummary] = Field(
        None,
        description="盈亏汇总，价格未完整发布时为空",
    )


class ExecutionChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    annual_monthly_mwh: float = Field(0.0, description="年度分月电量")
    monthly_mwh: float = Field(0.0, description="月度电量")
    mechanism_mwh: float = Field(0.0, description="机制电量")
    historical_within_month_net_mwh: float = Field(0.0, description="历史月内净持仓修正量")
    trade_day_net_mwh: float = Field(0.0, description="当日月内净成交量")
    final_position_mwh: float = Field(0.0, description="最终持仓")
    actual_or_forecast_load_mwh: Optional[float] = Field(None, description="实际或预测电量")
    load_source: Optional[str] = Field(None, description="actual / forecast")
    trade_avg_price: Optional[float] = Field(None, description="成交均价")
    trade_count: int = Field(0, description="成交次数")
    trade_volume_mwh: float = Field(0.0, description="累计成交量")
    market_monthly_price: Optional[float] = Field(None, description="市场化年度月度加权均价")
    spot_price: Optional[float] = Field(None, description="现货价格")
    period_profit_amount: Optional[float] = Field(None, description="该时段交易收益")


class ExecutionTableRow(ExecutionChartRow):
    pass


class OperationButtonItem(BaseModel):
    operation_id: str = Field(..., description="申报过程ID")
    operation_type: str = Field(..., description="listing / manual_off_shelf / auto_off_shelf")
    operation_time: str = Field(..., description="申报过程时间")
    button_title: str = Field(..., description="按钮主文案")
    button_subtitle: str = Field(..., description="按钮副文案")
    record_count: int = Field(..., description="记录数")
    covered_period_count: int = Field(..., description="覆盖时段数")
    buy_record_count: int = Field(..., description="买入记录数")
    sell_record_count: int = Field(..., description="卖出记录数")


class OperationSummary(BaseModel):
    operation_title: str = Field(..., description="动作标题")
    operation_effect_text: str = Field(..., description="本次动作影响说明")
    post_operation_text: str = Field(..., description="动作后状态说明")


class OrderLevelItem(BaseModel):
    level_index: int = Field(..., description="价格档位序号")
    price: float = Field(..., description="挂单价格")
    volume_mwh: float = Field(..., description="挂单电量")
    color_token: str = Field(..., description="颜色标识")


class OperationChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    buy_order_levels: List[OrderLevelItem] = Field(default_factory=list, description="买入挂单档位")
    sell_order_levels: List[OrderLevelItem] = Field(default_factory=list, description="卖出挂单档位")
    market_monthly_price: Optional[float] = Field(None, description="年度月度价格")
    spot_price: Optional[float] = Field(None, description="实时价格")
    actual_or_forecast_load_mwh: Optional[float] = Field(None, description="实际或预测电量")
    load_source: Optional[str] = Field(None, description="actual / forecast")


class OperationTableRow(BaseModel):
    record_key: str = Field(..., description="记录唯一键")
    period: int = Field(..., ge=1, le=48, description="时段")
    trade_direction: str = Field(..., description="buy / sell")
    price_level_index: int = Field(..., description="价格档位序号")
    same_direction_level_count: int = Field(..., description="同方向档位数")
    listing_price: Optional[float] = Field(None, description="挂单价格")
    listing_mwh: float = Field(0.0, description="挂单电量")
    spot_price: Optional[float] = Field(None, description="实时价格")
    operation_effect_type: str = Field(..., description="add / remove / auto_remove / keep")
    operation_effect_mwh: float = Field(0.0, description="本次动作影响电量")


class OperationDetailResponse(BaseModel):
    operation_id: str = Field(..., description="申报过程ID")
    operation_type: str = Field(..., description="listing / manual_off_shelf / auto_off_shelf")
    operation_time: str = Field(..., description="申报过程时间")
    operation_summary: OperationSummary
    chart_rows: List[OperationChartRow] = Field(default_factory=list, description="申报后挂单图表数据")
    table_rows: List[OperationTableRow] = Field(default_factory=list, description="申报后挂单明细")


class MonthlyContractDetailItem(BaseModel):
    contract_id: str = Field(..., description="合同明细ID")
    seller_name: str = Field(..., description="售方名称")
    date: str = Field(..., description="目标日期 YYYY-MM-DD")
    period: int = Field(..., ge=1, le=48, description="时段")
    quantity_mwh: float = Field(0.0, description="合同电量")
    price_yuan_per_mwh: Optional[float] = Field(None, description="合同电价")


class MonthlyContractDetailSummary(BaseModel):
    historical_quantity_mwh: float = Field(0.0, description="历史电量")
    current_quantity_mwh: float = Field(0.0, description="当前成交电量")
    displayed_quantity_mwh: float = Field(0.0, description="当前展示合同合计电量")
    avg_price_yuan_per_mwh: Optional[float] = Field(None, description="当前展示合同加权均价")
    contract_count: int = Field(0, description="当前展示合同数量")


class MonthlyContractDetailResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    period: int = Field(..., ge=1, le=48, description="时段")
    matched: bool = Field(False, description="是否自动匹配成功")
    manual_match_required: bool = Field(False, description="是否需要手工匹配")
    match_message: Optional[str] = Field(None, description="匹配提示信息")
    summary: MonthlyContractDetailSummary
    contracts: List[MonthlyContractDetailItem] = Field(default_factory=list, description="合同明细")


class ContractEarningPeriodRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    matched: bool = Field(False, description="是否匹配成功")
    trade_net_mwh: float = Field(0.0, description="当日净成交电量")
    contract_avg_price_yuan_per_mwh: Optional[float] = Field(None, description="合同成交均价")
    spot_price: Optional[float] = Field(None, description="现货价格")
    period_profit_amount: Optional[float] = Field(None, description="该时段合同成交收益")


class ContractEarningCalculationResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    summary: Optional[ExecutionAnalysisSummary] = Field(None, description="合同成交收益汇总")
    period_rows: List[ContractEarningPeriodRow] = Field(default_factory=list, description="逐时段收益明细")


class MonthlyReviewDataRange(BaseModel):
    start_date: Optional[str] = Field(None, description="起始日期 YYYY-MM-DD")
    end_date: Optional[str] = Field(None, description="结束日期 YYYY-MM-DD")


class MonthlyReviewOverview(BaseModel):
    total_load_mwh: Optional[float] = Field(None, description="月度实际总电量")
    spot_avg_price: Optional[float] = Field(None, description="全月实时现货加权均价")
    total_contribution_amount: Optional[float] = Field(None, description="四类交易合计贡献值")
    total_exposed_mwh: Optional[float] = Field(None, description="剩余风险暴露电量")
    total_exposed_amount: Optional[float] = Field(None, description="剩余风险暴露金额")
    settlement_price_impact_amount: Optional[float] = Field(None, description="采购结算成本影响金额")


class MonthlyReviewTypeCard(BaseModel):
    trade_type: str = Field(..., description="交易类型")
    label: str = Field(..., description="展示名称")
    covered_mwh: float = Field(0.0, description="覆盖电量")
    energy_share: Optional[float] = Field(None, description="电量占比")
    avg_trade_price: Optional[float] = Field(None, description="交易均价")
    spot_weighted_price: Optional[float] = Field(None, description="按覆盖电量加权的实时现货均价")
    spot_spread: Optional[float] = Field(None, description="现货价差")
    contribution_amount: Optional[float] = Field(None, description="贡献值")
    win_rate: Optional[float] = Field(None, description="胜率")
    positive_bucket_count: int = Field(0, description="正贡献单元数")
    negative_bucket_count: int = Field(0, description="负贡献单元数")
    neutral_bucket_count: int = Field(0, description="无贡献或无数据单元数")
    settlement_price_impact_amount: Optional[float] = Field(None, description="采购结算成本影响金额")


class MonthlyReviewTradePoint(BaseModel):
    trade_type: str = Field(..., description="交易类型")
    volume_mwh: float = Field(0.0, description="电量")
    avg_price: Optional[float] = Field(None, description="交易均价")
    contribution_amount: Optional[float] = Field(None, description="贡献值")
    spot_spread: Optional[float] = Field(None, description="现货价差")


class MonthlyReviewDailyRow(BaseModel):
    date: str = Field(..., description="日期 YYYY-MM-DD")
    actual_load_mwh: Optional[float] = Field(None, description="实际电量")
    spot_avg_price: Optional[float] = Field(None, description="当日实时现货均价")
    total_contribution_amount: Optional[float] = Field(None, description="当日合计贡献值")
    exposed_mwh: Optional[float] = Field(None, description="当日风险暴露电量")
    exposed_amount: Optional[float] = Field(None, description="当日风险暴露金额")
    trade_types: List[MonthlyReviewTradePoint] = Field(default_factory=list, description="四类交易当日明细")


class MonthlyReviewPeriodRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    time_label: str = Field(..., description="时段标签")
    actual_load_mwh: Optional[float] = Field(None, description="该时段月累计或日均实际电量")
    spot_avg_price: Optional[float] = Field(None, description="该时段实时现货均价")
    total_contribution_amount: Optional[float] = Field(None, description="该时段合计贡献值")
    exposed_mwh: Optional[float] = Field(None, description="该时段风险暴露电量")
    exposed_amount: Optional[float] = Field(None, description="该时段风险暴露金额")
    trade_types: List[MonthlyReviewTradePoint] = Field(default_factory=list, description="四类交易时段明细")


class MonthlyReviewSourceMeta(BaseModel):
    contracts_last_updated_at: Optional[str] = Field(None, description="合同数据最近更新时间")
    trade_last_updated_at: Optional[str] = Field(None, description="交易数据最近更新时间")
    spot_last_updated_at: Optional[str] = Field(None, description="现货数据最近更新时间")


class MonthlyReviewOverviewResponse(BaseModel):
    month: str = Field(..., description="统计月份 YYYY-MM")
    exists: bool = Field(..., description="是否存在可展示结果")
    calc_status: Optional[str] = Field(None, description="计算状态")
    calc_message: Optional[str] = Field(None, description="计算结果说明")
    data_range: Optional[MonthlyReviewDataRange] = Field(None, description="数据覆盖范围")
    overview: Optional[MonthlyReviewOverview] = Field(None, description="月度总览")
    updated_at: Optional[str] = Field(None, description="结果更新时间")


class MonthlyReviewDetailResponse(BaseModel):
    month: str = Field(..., description="统计月份 YYYY-MM")
    calc_status: Optional[str] = Field(None, description="计算状态")
    calc_message: Optional[str] = Field(None, description="计算结果说明")
    data_range: Optional[MonthlyReviewDataRange] = Field(None, description="数据覆盖范围")
    overview: Optional[MonthlyReviewOverview] = Field(None, description="月度总览")
    type_cards: List[MonthlyReviewTypeCard] = Field(default_factory=list, description="四类交易对比卡")
    daily_view: List[MonthlyReviewDailyRow] = Field(default_factory=list, description="日度视图数据")
    period_view: List[MonthlyReviewPeriodRow] = Field(default_factory=list, description="48时段视图数据")
    diagnosis_texts: List[str] = Field(default_factory=list, description="自动诊断结论")
    source_meta: Optional[MonthlyReviewSourceMeta] = Field(None, description="数据来源摘要")
    updated_at: Optional[str] = Field(None, description="结果更新时间")


class TradeDetailResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    summary_cards: SummaryCardsResponse
    execution_analysis_summary: Optional[ExecutionAnalysisSummary] = Field(
        None,
        description="成交分析结果；现货价格未发布时为空",
    )
    execution_chart: List[ExecutionChartRow] = Field(default_factory=list, description="图形复盘数据")
    execution_table: List[ExecutionTableRow] = Field(default_factory=list, description="数据表格")
    operation_buttons: List[OperationButtonItem] = Field(default_factory=list, description="申报过程按钮带")
    default_operation_id: Optional[str] = Field(None, description="默认选中的申报过程ID")
    default_operation_detail: Optional[OperationDetailResponse] = Field(None, description="默认申报过程详情")
    review_texts: List[str] = Field(default_factory=list, description="复盘文本")
