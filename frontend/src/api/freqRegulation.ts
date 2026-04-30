import apiClient from './client';

export type FreqRegulationMarketType = 'day_ahead' | 'intraday';

export interface FreqDailyPoint {
    time: string;
    day_ahead_clearing_price: number | null;
    intraday_clearing_price: number | null;
    day_ahead_demand_mw: number | null;
    intraday_demand_mw: number | null;
    day_ahead_avg_bid_price: number | null;
    intraday_avg_bid_price: number | null;
    day_ahead_winning_resource_count: number | null;
    intraday_winning_resource_count: number | null;
}

export interface FreqDailyResponse {
    date: string;
    points: FreqDailyPoint[];
    kpis: {
        day_ahead_avg_clearing_price: number | null;
        intraday_avg_clearing_price: number | null;
        spread_avg_clearing_price: number | null;
        day_ahead_avg_demand_mw: number | null;
        intraday_avg_demand_mw: number | null;
    };
    total_points: number;
}

export interface FreqRangeHourlyStat {
    time: string;
    avg_clearing_price: number | null;
    clearing_price_std: number | null;
    clearing_price_upper: number | null;
    clearing_price_lower: number | null;
    avg_demand_mw: number | null;
    demand_mw_std: number | null;
    demand_mw_upper: number | null;
    demand_mw_lower: number | null;
}

export interface FreqRangeDailyTrend {
    date: string;
    avg_clearing_price: number | null;
    avg_demand_mw: number | null;
}

export interface FreqRangeResponse {
    start_date: string;
    end_date: string;
    market_type: FreqRegulationMarketType;
    hourly_stats: FreqRangeHourlyStat[];
    daily_trends: FreqRangeDailyTrend[];
}

export interface FreqMonthlyRow {
    month: string;
    day_ahead_avg_clearing_price: number | null;
    intraday_avg_clearing_price: number | null;
    spread_avg_clearing_price: number | null;
    day_ahead_avg_demand_mw: number | null;
    intraday_avg_demand_mw: number | null;
    day_ahead_avg_bid_price: number | null;
    intraday_avg_bid_price: number | null;
}

export interface FreqMonthlyResponse {
    start_month: string;
    end_month: string;
    rows: FreqMonthlyRow[];
    kpis: {
        day_ahead_period_avg_price: number | null;
        intraday_period_avg_price: number | null;
        spread_monthly_avg_price: number | null;
        highest_price_month: string | null;
        lowest_price_month: string | null;
    };
}

export interface FreqCompMonthlySummaryItem {
    month: string;
    total_compensation_fee: number;
    winning_plant_count: number;
}

export interface FreqCompMonthlySummaryResponse {
    months: FreqCompMonthlySummaryItem[];
}

export interface FreqCompFeeRecord {
    month: string;
    plant_name: string;
    order: number;
    on_grid_energy: number;
    compensation_fee: number;
    allocation_fee: number;
    settlement_fee: number;
}

export interface FreqCompFeeMonthResponse {
    month: string;
    records: FreqCompFeeRecord[];
}

export interface FreqCompPlantTrendPoint {
    month: string;
    compensation_fee: number;
}

export interface FreqCompPlantTrendResponse {
    plant_name: string;
    trend: FreqCompPlantTrendPoint[];
    stats: {
        total_compensation_fee: number;
        winning_months: number;
        total_months: number;
    };
}

export const freqRegulationApi = {
    fetchDaily: (date: string) => {
        return apiClient.get<FreqDailyResponse>('/api/v1/freq-regulation/daily', { params: { date } });
    },
    fetchRange: (params: { start_date: string; end_date: string; market_type: FreqRegulationMarketType }) => {
        return apiClient.get<FreqRangeResponse>('/api/v1/freq-regulation/range', { params });
    },
    fetchMonthly: (params: { start_month: string; end_month: string }) => {
        return apiClient.get<FreqMonthlyResponse>('/api/v1/freq-regulation/monthly', { params });
    },
    fetchFreqCompMonthlySummary: () => {
        return apiClient.get<FreqCompMonthlySummaryResponse>('/api/v1/freq-comp-fee/monthly-summary');
    },
    fetchFreqCompFeeMonth: (month: string) => {
        return apiClient.get<FreqCompFeeMonthResponse>(`/api/v1/freq-comp-fee/${month}`);
    },
    fetchFreqCompPlantTrend: (params: { plant_name: string; months?: number }) => {
        return apiClient.get<FreqCompPlantTrendResponse>('/api/v1/freq-comp-fee/plant-trend', { params });
    },
};
