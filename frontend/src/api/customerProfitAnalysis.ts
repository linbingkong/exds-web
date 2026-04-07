import apiClient from './client';

export type ProfitViewMode = 'monthly' | 'ytd';
export type ProfitSourceType = 'monthly' | 'platform_daily' | 'mixed';

export interface ProfitKpi {
    customer_count: number;
    total_energy_mwh: number;
    retail_revenue: number;
    retail_avg_price: number;
    wholesale_cost: number;
    wholesale_avg_price: number;
    gross_profit: number;
    avg_spread: number;
    source_summary: {
        monthly_months: string[];
        platform_daily_months: string[];
    };
}

export interface ContributionItem {
    customer_id: string;
    customer_name: string;
    short_name?: string;
    profit: number;
    avg_spread?: number;
    percentage: number;
    contribution_value: number;
}

export interface ContributionGroup {
    top5: ContributionItem[];
    others: {
        profit: number;
        percentage: number;
        contribution_value: number;
    };
    customer_count?: number;
    total_profit: number;
    contribution_type: 'positive' | 'negative';
}

export interface RankingItem {
    customer_id: string;
    customer_name: string;
    short_name?: string;
    package_name?: string;
    value: number;
}

export interface CustomerProfitRow {
    customer_id: string;
    customer_name: string;
    short_name?: string;
    package_name?: string;
    energy_mwh: number;
    retail_revenue: number;
    wholesale_cost: number;
    gross_profit: number;
    retail_unit_price: number;
    wholesale_unit_price: number;
    price_spread: number;
    source_type: ProfitSourceType;
    detail_ready: boolean;
}

export interface CustomerProfitDashboard {
    kpi: ProfitKpi;
    positive_contribution: ContributionGroup;
    negative_contribution: ContributionGroup;
    rankings: {
        profit: {
            top5: RankingItem[];
            bottom5: RankingItem[];
        };
        spread: {
            top5: RankingItem[];
            bottom5: RankingItem[];
        };
    };
    customer_list: {
        total: number;
        page: number;
        page_size: number;
        items: CustomerProfitRow[];
    };
}

export const customerProfitAnalysisApi = {
    async getDashboardData(params: {
        year: number;
        month: number;
        view_mode: ProfitViewMode;
        search?: string;
        sort_field?: string;
        sort_order?: 'asc' | 'desc';
        page?: number;
        page_size?: number;
    }): Promise<CustomerProfitDashboard> {
        const response = await apiClient.get<CustomerProfitDashboard>('/api/v1/customer-profit-analysis/dashboard', {
            params,
        });
        return response.data;
    },
};

export default customerProfitAnalysisApi;
