import apiClient from './client';
import { ContributionGroup } from './customerProfitAnalysis';
import { MonthlyReviewTypeCard } from '../types/tradeReview';

export interface SettlementKpiResponse {
    month: string;
    as_of_date?: string | null;
    kpi: {
        yearly_gross_profit: number;
        monthly_gross_profit: number;
        wholesale_avg_price: number;
        retail_avg_price: number;
        price_spread: number;
    };
    source_summary?: {
        monthly_months?: string[];
        platform_daily_months?: string[];
    };
}

export interface SettlementChartItem {
    date: string;
    day: string;
    month?: string;
    month_label?: string;
    price_spread: number | null;
    cumulative_avg_spread: number | null;
    gross_profit?: number | null;
    cumulative_gross_profit?: number | null;
    data_status: string;
    display_mode?: 'final' | 'estimated' | 'future';
}

export interface SettlementChartResponse {
    month: string;
    view_mode?: 'monthly' | 'yearly';
    as_of_date?: string | null;
    chart_data: SettlementChartItem[];
}

export interface TradeSummaryResponse {
    month: string;
    type_cards: MonthlyReviewTypeCard[];
    updated_at?: string | null;
}

export interface CustomerOverviewDistributionItem {
    name: string;
    usage_mwh: number;
    percentage: number;
}

export interface CustomerOverviewResponse {
    year: number;
    month: number;
    current_valid_customers: number;
    yearly_contract_customers: number;
    signed_quantity_mwh: number;
    actual_total_usage_mwh: number;
    signed_quantity_yoy: number | null;
    top_customer_distribution: CustomerOverviewDistributionItem[];
}

export interface CustomerProfitContributionResponse {
    year: number;
    month: number;
    positive_contribution: ContributionGroup;
    negative_contribution: ContributionGroup;
}

export interface CustomerLoadRankingItem {
    customer_id?: string | null;
    short_name: string;
    usage: number;
    percentage: number;
}

export interface CustomerLoadRankingResponse {
    year: number;
    month: number;
    total_usage_mwh: number;
    items: CustomerLoadRankingItem[];
}

export interface DashboardAlertItem {
    source: string;
    alert_id: string;
    level: string;
    title: string;
    content: string;
    detail_content?: string;
    status: string;
    created_at: string;
    link?: string | null;
}

export interface DashboardAlertsResponse {
    items: DashboardAlertItem[];
    total: number;
}

export interface PriceTrendResponse {
    daily_trends: Array<{
        date: string;
        contract_vwap?: number | null;
        spot_vwap?: number | null;
        vwap_spread?: number | null;
    }>;
    spread_stats: { avgSpread: number };
}

export interface MarketIntradayChartItem {
    time: string;
    price_rt: number | null;
    price_rt_display?: number | null;
    price_rt_fallback?: number | null;
    price_rt_is_fallback?: boolean;
    price_econ: number | null;
    period_type: string;
}

export interface MarketIntradayResponse {
    date: string | null;
    stats: {
        real_time_avg: number | null;
        econ_avg: number | null;
        avg_spread: number | null;
    };
    fallback?: {
        enabled: boolean;
        node_name?: string | null;
    };
    chart_data: MarketIntradayChartItem[];
}

export interface DashboardSummaryResponse {
    snapshot_id: string;
    status: string;
    month?: string | null;
    generated_at?: string | null;
    settlement_kpi: SettlementKpiResponse | null;
    settlement_chart_monthly: SettlementChartResponse | null;
    settlement_chart_yearly: SettlementChartResponse | null;
    trade_summary: TradeSummaryResponse | null;
    customer_overview: CustomerOverviewResponse | null;
    customer_profit_contribution: CustomerProfitContributionResponse | null;
    price_trend: PriceTrendResponse | null;
    alerts: DashboardAlertsResponse | null;
}

export const dashboardApi = {
    getSummary: async () => {
        const response = await apiClient.get<DashboardSummaryResponse>('/api/v1/dashboard/summary');
        return response.data;
    },
    getMarketIntraday: async (date?: string) => {
        const response = await apiClient.get<MarketIntradayResponse>('/api/v1/dashboard/market-intraday', {
            params: date ? { date } : undefined,
        });
        return response.data;
    },
    getSettlementKpi: async () => {
        const response = await apiClient.get<SettlementKpiResponse>('/api/v1/dashboard/settlement-kpi');
        return response.data;
    },
    getSettlementChart: async (view_mode: 'monthly' | 'yearly' = 'monthly') => {
        const response = await apiClient.get<SettlementChartResponse>('/api/v1/dashboard/settlement-chart', {
            params: { view_mode },
        });
        return response.data;
    },
    getTradeSummary: async () => {
        const response = await apiClient.get<TradeSummaryResponse>('/api/v1/dashboard/trade-summary');
        return response.data;
    },
    getCustomerOverview: async () => {
        const response = await apiClient.get<CustomerOverviewResponse>('/api/v1/dashboard/customer-overview');
        return response.data;
    },
    getCustomerProfitContribution: async () => {
        const response = await apiClient.get<CustomerProfitContributionResponse>('/api/v1/dashboard/customer-profit-contribution');
        return response.data;
    },
    getAlerts: async (limit = 10) => {
        const response = await apiClient.get<DashboardAlertsResponse>('/api/v1/dashboard/alerts', {
            params: { limit },
        });
        return response.data;
    },
};

export default dashboardApi;
