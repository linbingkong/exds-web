import apiClient from './client';
import {
    ContractEarningCalculationResponse,
    DayAheadReviewResponse,
    MonthlyReviewDetailResponse,
    MonthlyReviewOverviewResponse,
    MonthlyContractDetailResponse,
    OperationDetailResponse,
    TradeDateListResponse,
    TradeDetailResponse,
    TradeOverviewResponse,
} from '../types/tradeReview';

export const tradeReviewApi = {
    fetchMonthlyOverview: (month: string, autoBuild = false) =>
        apiClient.get<MonthlyReviewOverviewResponse>('/api/v1/trade-review/monthly-overview', {
            params: { month, auto_build: autoBuild },
        }),
    fetchMonthlyDetail: (month: string) =>
        apiClient.get<MonthlyReviewDetailResponse>('/api/v1/trade-review/monthly-detail', {
            params: { month },
        }),
    recalculateMonthly: (month: string) =>
        apiClient.post<MonthlyReviewDetailResponse>('/api/v1/trade-review/monthly-recalculate', null, {
            params: { month },
        }),
    fetchTradeDates: () => apiClient.get<TradeDateListResponse>('/api/v1/trade-review/trade-dates'),
    fetchTradeOverview: (tradeDate: string) =>
        apiClient.get<TradeOverviewResponse>('/api/v1/trade-review/overview', {
            params: { trade_date: tradeDate },
        }),
    fetchTradeDetail: (tradeDate: string, deliveryDate: string) =>
        apiClient.get<TradeDetailResponse>('/api/v1/trade-review/detail', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate },
        }),
    fetchOperationDetail: (tradeDate: string, deliveryDate: string, operationId: string) =>
        apiClient.get<OperationDetailResponse>('/api/v1/trade-review/operation-detail', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate, operation_id: operationId },
        }),
    fetchMonthlyContractDetails: (tradeDate: string, deliveryDate: string, period: number) =>
        apiClient.get<MonthlyContractDetailResponse>('/api/v1/trade-review/monthly-contract-details', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate, period },
        }),
    calculateContractEarnings: (tradeDate: string, deliveryDate: string) =>
        apiClient.get<ContractEarningCalculationResponse>('/api/v1/trade-review/contract-earnings', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate },
        }),
    fetchDayAheadReview: (targetDate: string) =>
        apiClient.get<DayAheadReviewResponse>('/api/v1/trade-review/day-ahead-review', {
            params: { target_date: targetDate },
        }),
};
