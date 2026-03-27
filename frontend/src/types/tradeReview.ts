export interface TradeDateListResponse {
    latest_trade_date: string | null;
    trade_dates: string[];
}

export interface MonthlyReviewDataRange {
    start_date?: string | null;
    end_date?: string | null;
}

export interface MonthlyReviewOverview {
    total_load_mwh?: number | null;
    spot_avg_price?: number | null;
    total_contribution_amount?: number | null;
    total_exposed_mwh?: number | null;
    total_exposed_amount?: number | null;
    settlement_price_impact_amount?: number | null;
}

export interface MonthlyReviewTypeCard {
    trade_type: 'annual' | 'monthly' | 'within_month' | 'day_ahead' | string;
    label: string;
    covered_mwh: number;
    energy_share?: number | null;
    avg_trade_price?: number | null;
    spot_weighted_price?: number | null;
    spot_spread?: number | null;
    contribution_amount?: number | null;
    win_rate?: number | null;
    positive_bucket_count: number;
    negative_bucket_count: number;
    neutral_bucket_count: number;
    settlement_price_impact_amount?: number | null;
}

export interface MonthlyReviewTradePoint {
    trade_type: 'annual' | 'monthly' | 'within_month' | 'day_ahead' | string;
    volume_mwh: number;
    avg_price?: number | null;
    contribution_amount?: number | null;
    spot_spread?: number | null;
}

export interface MonthlyReviewDailyRow {
    date: string;
    actual_load_mwh?: number | null;
    spot_avg_price?: number | null;
    total_contribution_amount?: number | null;
    exposed_mwh?: number | null;
    exposed_amount?: number | null;
    trade_types: MonthlyReviewTradePoint[];
}

export interface MonthlyReviewPeriodRow {
    period: number;
    time_label: string;
    actual_load_mwh?: number | null;
    spot_avg_price?: number | null;
    total_contribution_amount?: number | null;
    exposed_mwh?: number | null;
    exposed_amount?: number | null;
    trade_types: MonthlyReviewTradePoint[];
}

export interface MonthlyReviewSourceMeta {
    contracts_last_updated_at?: string | null;
    trade_last_updated_at?: string | null;
    spot_last_updated_at?: string | null;
}

export interface MonthlyReviewOverviewResponse {
    month: string;
    exists: boolean;
    calc_status?: string | null;
    calc_message?: string | null;
    data_range?: MonthlyReviewDataRange | null;
    overview?: MonthlyReviewOverview | null;
    updated_at?: string | null;
}

export interface MonthlyReviewDetailResponse {
    month: string;
    calc_status?: string | null;
    calc_message?: string | null;
    data_range?: MonthlyReviewDataRange | null;
    overview?: MonthlyReviewOverview | null;
    type_cards: MonthlyReviewTypeCard[];
    daily_view: MonthlyReviewDailyRow[];
    period_view: MonthlyReviewPeriodRow[];
    diagnosis_texts: string[];
    source_meta?: MonthlyReviewSourceMeta | null;
    updated_at?: string | null;
}

export interface DeliveryDateSummary {
    delivery_date: string;
    record_count: number;
}

export interface TradeOverviewResponse {
    trade_date: string;
    delivery_summaries: DeliveryDateSummary[];
}

export interface RecordOverviewCard {
    total_records: number;
    traded_records: number;
}

export interface TradeOverviewCard {
    traded_mwh: number;
    buy_traded_mwh: number;
    sell_traded_mwh: number;
}

export interface PeriodOverviewCard {
    traded_period_count: number;
    buy_traded_period_count: number;
    sell_traded_period_count: number;
}

export interface OperationOverviewCard {
    listing_operation_count: number;
    manual_off_shelf_operation_count: number;
    auto_off_shelf_operation_count: number;
}

export interface SummaryCardsResponse {
    record_overview: RecordOverviewCard;
    trade_overview: TradeOverviewCard;
    period_overview: PeriodOverviewCard;
    operation_overview: OperationOverviewCard;
}

export interface ExecutionAnalysisSummary {
    profit_count: number;
    profit_amount: number;
    loss_count: number;
    loss_amount: number;
    total_profit_amount: number;
}

export interface DayAheadReviewChartRow {
    period: number;
    time: string;
    period_type: string;
    declared_mwh: number;
    actual_load_mwh?: number | null;
    forecast_gap_min_mwh?: number | null;
    price_rt: number | null;
    price_da: number | null;
    price_da_econ: number | null;
    price_da_forecast: number | null;
}

export interface DayAheadReviewResponse {
    target_date: string;
    settlement_price_type: 'physical' | 'econ';
    chart_rows: DayAheadReviewChartRow[];
    execution_analysis_summary: ExecutionAnalysisSummary | null;
}

export interface ExecutionChartRow {
    period: number;
    annual_monthly_mwh: number;
    monthly_mwh: number;
    mechanism_mwh: number;
    historical_within_month_net_mwh: number;
    trade_day_net_mwh: number;
    final_position_mwh: number;
    actual_or_forecast_load_mwh: number | null;
    load_source: string | null;
    trade_avg_price: number | null;
    trade_count: number;
    trade_volume_mwh: number;
    market_monthly_price: number | null;
    spot_price: number | null;
    period_profit_amount: number | null;
}

export type ExecutionTableRow = ExecutionChartRow;

export interface OperationButtonItem {
    operation_id: string;
    operation_type: 'listing' | 'manual_off_shelf' | 'auto_off_shelf' | 'partial_fill';
    operation_time: string;
    button_title: string;
    button_subtitle: string;
    record_count: number;
    covered_period_count: number;
    buy_record_count: number;
    sell_record_count: number;
}

export interface OrderLevelItem {
    level_index: number;
    price: number;
    volume_mwh: number;
    color_token: string;
}

export interface OperationChartRow {
    period: number;
    buy_order_levels: OrderLevelItem[];
    sell_order_levels: OrderLevelItem[];
    market_monthly_price: number | null;
    spot_price: number | null;
    actual_or_forecast_load_mwh: number | null;
    load_source: string | null;
}

export interface OperationTableRow {
    record_key: string;
    period: number;
    trade_direction: 'buy' | 'sell';
    price_level_index: number;
    same_direction_level_count: number;
    listing_price: number | null;
    listing_mwh: number;
    spot_price: number | null;
    operation_effect_type: 'add' | 'remove' | 'auto_remove' | 'partial_fill' | 'keep';
    operation_effect_mwh: number;
}

export interface OperationSummary {
    operation_title: string;
    operation_effect_text: string;
    post_operation_text: string;
}

export interface OperationDetailResponse {
    operation_id: string;
    operation_type: 'listing' | 'manual_off_shelf' | 'auto_off_shelf' | 'partial_fill';
    operation_time: string;
    operation_summary: OperationSummary;
    chart_rows: OperationChartRow[];
    table_rows: OperationTableRow[];
}

export interface MonthlyContractDetailItem {
    contract_id: string;
    seller_name: string;
    date: string;
    period: number;
    quantity_mwh: number;
    price_yuan_per_mwh: number | null;
}

export interface MonthlyContractDetailSummary {
    historical_quantity_mwh: number;
    current_quantity_mwh: number;
    displayed_quantity_mwh: number;
    avg_price_yuan_per_mwh: number | null;
    contract_count: number;
}

export interface MonthlyContractDetailResponse {
    trade_date: string;
    delivery_date: string;
    period: number;
    matched: boolean;
    manual_match_required: boolean;
    match_message: string | null;
    summary: MonthlyContractDetailSummary;
    contracts: MonthlyContractDetailItem[];
}

export interface ContractEarningPeriodRow {
    period: number;
    matched: boolean;
    trade_net_mwh: number;
    contract_avg_price_yuan_per_mwh: number | null;
    spot_price: number | null;
    period_profit_amount: number | null;
}

export interface ContractEarningCalculationResponse {
    trade_date: string;
    delivery_date: string;
    summary: ExecutionAnalysisSummary | null;
    period_rows: ContractEarningPeriodRow[];
}

export interface TradeDetailResponse {
    trade_date: string;
    delivery_date: string;
    summary_cards: SummaryCardsResponse;
    execution_analysis_summary: ExecutionAnalysisSummary | null;
    execution_chart: ExecutionChartRow[];
    execution_table: ExecutionTableRow[];
    operation_buttons: OperationButtonItem[];
    default_operation_id: string | null;
    default_operation_detail: OperationDetailResponse | null;
    review_texts: string[];
}
