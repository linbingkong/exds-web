/**
 * 中长期趋势分析 API 客户端
 */
import apiClient from './client';

// 类型定义
export interface ContractPriceTrendParams {
    start_date: string;
    end_date: string;
    spot_type: 'day_ahead' | 'real_time';
}

export interface DailyTrendPoint {
    date: string;
    contract_vwap: number | null;
    spot_vwap: number | null;
    vwap_spread: number | null;
    positive_spread_count: number;
    negative_spread_count: number;
}

export interface SpreadStats {
    avgSpread: number;
    positiveSpreadRatio: number;
    negativeSpreadRatio: number;
    maxSpread: number;
    minSpread: number;
}

export interface SpreadDistribution {
    range: string;
    count: number;
}

export interface Period48TrendPoint {
    period: number;
    label: string;
    contract_vwap: number | null;
    spot_vwap: number | null;
    vwap_spread: number | null;
}

export interface ContractPriceTrendResponse {
    daily_trends: DailyTrendPoint[];
    spread_stats: SpreadStats;
    spread_distribution: SpreadDistribution[];
    period_48_trends: Period48TrendPoint[];
}

// ========== 曲线分析类型 ==========

export interface DailyCurvePoint {
    date: string;
    vwap: number | null;
}

export interface CurvePeriod48Point {
    period: number;
    label: string;
    vwap: number | null;
}

export interface CurveData {
    key: string;
    contract_type: string;
    contract_period: string;
    label: string;
    color: string;
    points: DailyCurvePoint[];
    period_48_points: CurvePeriod48Point[];
}

export interface CurveAnalysisResponse {
    curves: CurveData[];
    spot_curve: CurveData;
    date_range: string[];
}

// ========== 电量结构类型 ==========

export interface DailyQuantityPoint {
    date: string;
    yearly_qty: number;
    monthly_qty: number;
    within_month_qty: number;
    market_qty: number;
    green_qty: number;
    agency_qty: number;
    total_qty: number;
}

export interface QuantityStructureResponse {
    daily_quantities: DailyQuantityPoint[];
    total_quantity: number;
    period_totals: { [key: string]: number };
    type_totals: { [key: string]: number };
    date_range: string[];
}

// API 方法
export const contractPriceTrendApi = {
    /**
     * 获取中长期合同价格趋势分析数据
     */
    fetchPriceTrend: (params: ContractPriceTrendParams) => {
        return apiClient.get<ContractPriceTrendResponse>('/api/v1/contract-price-trend/price-trend', {
            params: {
                start_date: params.start_date,
                end_date: params.end_date,
                spot_type: params.spot_type
            }
        });
    },

    /**
     * 获取曲线分析数据（按类型分组的日均价曲线）
     */
    fetchCurveAnalysis: (params: ContractPriceTrendParams) => {
        return apiClient.get<CurveAnalysisResponse>('/api/v1/contract-price-trend/curve-analysis', {
            params: {
                start_date: params.start_date,
                end_date: params.end_date,
                spot_type: params.spot_type
            }
        });
    },

    /**
     * 获取电量结构分析数据
     */
    fetchQuantityStructure: (params: { start_date: string; end_date: string }) => {
        return apiClient.get<QuantityStructureResponse>('/api/v1/contract-price-trend/quantity-structure', {
            params: {
                start_date: params.start_date,
                end_date: params.end_date
            }
        });
    }
};
