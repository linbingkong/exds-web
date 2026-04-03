/**
 * 价格预测 API 客户端
 */
import apiClient from './client';

// ============ 类型定义 ============

/** 预测版本信息 */
export interface ForecastVersion {
    forecast_id: string;
    forecast_type: string;
    model_version: string;
    model_type: string;
    created_at: string;
}

/** 图表数据点 */
export interface ChartDataPoint {
    time: string;                    // "00:15" ~ "24:00"
    predicted_price: number | null;
    actual_price: number | null;
    pre_schedule_price?: number | null;
    confidence_80_lower?: number | null;
    confidence_80_upper?: number | null;
    confidence_90_lower?: number | null;
    confidence_90_upper?: number | null;
}

/** 准确度数据 */
export interface AccuracyData {
    forecast_id: string;
    forecast_type: string;
    target_date: string;
    model_type: string;
    model_version: string;
    wmape_accuracy: number;
    mape?: number;
    mae: number;
    rmse: number;
    r2: number;
    direction_accuracy: number;
    period_accuracy: Record<string, number>;
    stats: {
        min_value: number;
        max_value: number;
        mean_value: number;
        has_negative: boolean;
    };
    rate_90_pass: boolean;
    rate_85_pass: boolean;
    calculated_at: string;
}

export interface AccuracyHistoryPoint {
    target_date: string;
    forecast_id: string;
    wmape_accuracy: number | null;
    mae?: number | null;
    rmse?: number | null;
    direction_accuracy?: number | null;
    rate_90_pass?: boolean;
    rate_85_pass?: boolean;
    calculated_at?: string | null;
}

export interface MaxAvailableDateResponse {
    max_available_date: string;
}

// ============ API 调用 ============

export const priceForecastApi = {
    /**
     * 获取预测版本列表
     */
    fetchVersions: (params: { target_date: string; forecast_type?: string }) => {
        return apiClient.get<ForecastVersion[]>('/api/v1/price-forecast/versions', { params });
    },

    /**
     * 获取图表数据（预测曲线 + 实际曲线）
     */
    fetchChartData: (params: { forecast_id: string; target_date: string }) => {
        return apiClient.get<ChartDataPoint[]>('/api/v1/price-forecast/data', { params });
    },

    /**
     * 获取准确度评估数据
     */
    fetchAccuracy: (params: { forecast_id: string; target_date?: string }) => {
        return apiClient.get<AccuracyData | null>('/api/v1/price-forecast/accuracy', { params });
    },

    /**
     * 获取历史准确率曲线
     */
    fetchAccuracyHistory: (params: { start_date: string; end_date: string; forecast_type?: string }) => {
        return apiClient.get<AccuracyHistoryPoint[]>('/api/v1/price-forecast/accuracy-history', { params });
    },

    fetchMaxAvailableDate: () => {
        return apiClient.get<MaxAvailableDateResponse>('/api/v1/price-forecast/max-available-date');
    },

    /**
     * 检查预测基础数据条数
     */
    checkDataAvailability: (params: { target_date: string }) => {
        return apiClient.get<DataCheckResult>('/api/v1/price-forecast/data-check', { params });
    },

    /**
     * 触发预测任务
     */
    triggerForecast: (params: { target_date: string }) => {
        return apiClient.post<TriggerResult>('/api/v1/price-forecast/trigger', params);
    },

    /**
     * 查询命令状态
     */
    getCommandStatus: (commandId: string) => {
        return apiClient.get<CommandStatus>(`/api/v1/price-forecast/command/${commandId}`);
    },
};

// ============ 触发预测相关类型 ============

/** 数据检查结果 */
export interface DataCheckResult {
    target_date: string;
    count: number;
    is_sufficient: boolean;
}

/** 触发结果 */
export interface TriggerResult {
    success: boolean;
    message: string;
    command_id?: string;
    existing_command_id?: string;
    status?: string;
    created_at?: string;
}

export interface CommandResult {
    status?: 'waiting' | 'FAILED' | 'error' | 'skipped' | null | string;
    summary?: string | null;
    msg?: string | null;
    details?: {
        error?: string | null;
        blocked_date?: string | null;
        missing_items?: string[] | null;
        [key: string]: any;
    } | null;
}

/** 命令状态 */
export interface CommandStatus {
    command_id: string;
    task_type: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    created_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    result_message: string | null;
    error_message: string | null;
    result?: CommandResult | null;
}
