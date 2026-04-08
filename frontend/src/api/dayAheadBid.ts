import apiClient from './client';
import { addDays, endOfMonth, endOfYear, format, startOfDay, startOfMonth, startOfYear, subDays } from 'date-fns';

export type TradeType = 'auto' | 'manual' | 'real';
export type TradeSourceStatus = '启用' | '停用';
export type DeclareStatus = '已申报' | '未申报';
export type ProfitMetric = 'amount' | 'unit';
export type SourceKind = 'simulation' | 'real_trade';

export interface TradeSourceListItem {
    trade_source_id: string;
    trade_source_name: string;
    trade_type: TradeType;
    strategy_id: string;
    strategy_code: string;
    trade_source_status: TradeSourceStatus;
    next_day_declare_status: DeclareStatus;
    source_kind: SourceKind;
    readonly: boolean;
}

export interface TradeSourceParam {
    param_key: string;
    param_name: string;
    param_value: string;
    unit: string;
    description: string;
}

export interface TradeSourceDetail extends TradeSourceListItem {
    description: string;
    params: TradeSourceParam[];
    created_at: string;
    updated_at: string;
}

export interface SimulationSummary {
    total_bid_mwh: number;
    active_period_count: number;
    max_bid_mwh_per_period: number;
}

export interface SimulationDetail {
    trade_source_id: string;
    target_date: string;
    current_server_time: string;
    declaration_time: string;
    trade_type: TradeType;
    strategy_name: string;
    strategy_id: string;
    strategy_code: string;
    next_day_declare_status: DeclareStatus;
    summary: SimulationSummary;
    price_forecast_30m: number[];
    bid_mwh_30m: number[];
    is_editable: boolean;
    lock_reason: string | null;
}

export interface ProfitSummary {
    trade_source_id: string;
    start_date: string;
    end_date: string;
    total_realized_pnl_yuan: number;
    avg_daily_realized_pnl_yuan: number;
    daily_win_rate: number;
    period_win_rate: number;
    profitable_amount_yuan: number;
    loss_amount_yuan: number;
    profit_loss_ratio: number;
    avg_profit_yuan: number;
    avg_loss_yuan: number;
    avg_profit_loss_ratio: number;
    max_single_day_profit_yuan: number;
    max_single_day_loss_yuan: number;
    max_profit_loss_ratio: number;
    max_drawdown_yuan: number;
    unit_pnl_yuan_per_mwh: number;
    avg_bid_mwh_per_active_period: number;
    avg_period_pnl_yuan: number;
    trading_days: number;
}

export interface ProfitCurvePoint {
    date: string;
    strategy_value: number;
    benchmark_value: number;
    excess_value: number;
    unit_label: string;
}

export interface ProfitCurveResponse {
    trade_source_id: string;
    metric: ProfitMetric;
    points: ProfitCurvePoint[];
}

export interface ProfitDailyRow {
    date: string;
    bid_total_mwh: number;
    realized_pnl_yuan: number;
    unit_pnl_yuan_per_mwh: number;
    win_periods: number;
    loss_periods: number;
    avg_spread_yuan_per_mwh: number;
    review_status: '已复盘' | '待复盘';
}

export interface ProfitDailyResponse {
    rows: ProfitDailyRow[];
    summary_row: {
        bid_total_mwh: number;
        realized_pnl_yuan: number;
        unit_pnl_yuan_per_mwh: number;
        win_periods: number;
        loss_periods: number;
    };
}

export interface DailyReviewSummary {
    expected_pnl_yuan: number;
    realized_pnl_yuan: number;
    total_bid_mwh: number;
    win_periods: number;
    loss_periods: number;
    avg_spread_yuan_per_mwh: number;
}

export interface DailyReviewRow {
    period: number;
    time_label: string;
    price_forecast_yuan_per_mwh: number;
    dayahead_price_yuan_per_mwh: number;
    econ_price_yuan_per_mwh: number;
    realtime_price_yuan_per_mwh: number;
    bid_mwh: number;
    spread_yuan_per_mwh: number;
    period_pnl_yuan: number;
    result_flag: '盈利' | '亏损' | '持平';
}

export interface DailyReviewDetail {
    trade_source_id: string;
    trade_source_name: string;
    target_date: string;
    summary: DailyReviewSummary;
    chart_rows: DailyReviewRow[];
    period_profit_rows: DailyReviewRow[];
}

interface MockState {
    tradeSources: TradeSourceDetail[];
    manualBidCurves: Record<string, number[]>;
}

export interface TradeSourcePayload {
    trade_source_name: string;
    trade_type: Exclude<TradeType, 'real'>;
    strategy_code: string;
    trade_source_status: TradeSourceStatus;
    description: string;
    params: TradeSourceParam[];
}

const STORAGE_KEY = 'day_ahead_bid_mock_state_v1';
const PERIOD_COUNT = 48;

const PERIOD_LABELS = Array.from({ length: PERIOD_COUNT }, (_, index) => {
    const startMinutes = index * 30;
    const endMinutes = startMinutes + 30;
    const startHour = Math.floor(startMinutes / 60);
    const startMinute = startMinutes % 60;
    const endHour = Math.floor(endMinutes / 60) % 24;
    const endMinute = endMinutes % 60;
    const fmt = (value: number) => String(value).padStart(2, '0');
    return `${fmt(startHour)}:${fmt(startMinute)}-${fmt(endHour)}:${fmt(endMinute)}`;
});

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function buildPriceForecast(targetDate: string): number[] {
    const seed = Number(targetDate.replaceAll('-', '').slice(-4));
    return Array.from({ length: PERIOD_COUNT }, (_, index) => {
        const base = 330 + Math.sin((index / PERIOD_COUNT) * Math.PI * 2 - Math.PI / 3) * 80;
        const evening = index >= 34 && index <= 40 ? 52 : 0;
        const peak = index >= 16 && index <= 22 ? 38 : 0;
        const valley = index <= 8 ? -32 : 0;
        return round(base + evening + peak + valley + (seed % 9), 1);
    });
}

function buildBidCurve(tradeType: TradeType, profileIndex: number, targetDate: string): number[] {
    const seed = Number(targetDate.replaceAll('-', '').slice(-4));
    return Array.from({ length: PERIOD_COUNT }, (_, index) => {
        if (tradeType === 'auto') {
            const morning = index >= 14 && index <= 18 ? 1 : 0;
            const evening = index >= 34 && index <= 40 ? 1 : 0;
            return round(65 + profileIndex * 18 + morning * 78 + evening * 95 + ((seed + index) % 6) * 5, 1);
        }

        if (profileIndex % 2 === 0) {
            const peak = index >= 16 && index <= 22 ? 135 : index >= 34 && index <= 39 ? 118 : 26;
            return round(peak + ((seed + index) % 5) * 4, 1);
        }

        const balanced = 88 + Math.sin((index / PERIOD_COUNT) * Math.PI * 2) * 18;
        return round(balanced + ((seed + index) % 3) * 4, 1);
    });
}

function summarizeBidCurve(values: number[]): SimulationSummary {
    const positive = values.filter((item) => item > 0);
    return {
        total_bid_mwh: round(values.reduce((sum, item) => sum + item, 0), 1),
        active_period_count: positive.length,
        max_bid_mwh_per_period: positive.length > 0 ? Math.max(...positive) : 0,
    };
}

function buildDefaultTradeSources(now: string): TradeSourceDetail[] {
    return [
        {
            trade_source_id: 'auto_prob',
            trade_source_name: '策略1：独立时段概率报量',
            trade_type: 'auto',
            strategy_id: 'strategy_auto_prob',
            strategy_code: 'AUTO-PROB',
            trade_source_status: '启用',
            next_day_declare_status: '已申报',
            source_kind: 'simulation',
            readonly: false,
            description: '按时段概率与边际收益自动生成次日申报曲线。',
            params: [
                { param_key: 'risk_factor', param_name: '风险系数', param_value: '0.75', unit: '-', description: '控制报价风险偏好' },
                { param_key: 'peak_weight', param_name: '峰段权重', param_value: '1.25', unit: '-', description: '提高峰段分配' },
            ],
            created_at: now,
            updated_at: now,
        },
        {
            trade_source_id: 'auto_smooth',
            trade_source_name: '策略2：联动平滑',
            trade_type: 'auto',
            strategy_id: 'strategy_auto_smooth',
            strategy_code: 'AUTO-SMOOTH',
            trade_source_status: '启用',
            next_day_declare_status: '已申报',
            source_kind: 'simulation',
            readonly: false,
            description: '基于相邻时段平滑约束生成申报。',
            params: [
                { param_key: 'smooth_lambda', param_name: '平滑系数', param_value: '0.60', unit: '-', description: '相邻时段平滑强度' },
                { param_key: 'max_ramp', param_name: '最大爬坡', param_value: '48', unit: 'MWh', description: '单时段最大变化量' },
            ],
            created_at: now,
            updated_at: now,
        },
        {
            trade_source_id: 'manual_peak',
            trade_source_name: '人工方案：高峰强化',
            trade_type: 'manual',
            strategy_id: 'strategy_manual_peak',
            strategy_code: 'MANUAL-PEAK',
            trade_source_status: '启用',
            next_day_declare_status: '未申报',
            source_kind: 'simulation',
            readonly: false,
            description: '人工维护的高峰强化方案。',
            params: [
                { param_key: 'peak_limit', param_name: '峰段上限', param_value: '160', unit: 'MWh', description: '峰段手工申报上限' },
                { param_key: 'base_floor', param_name: '基础底量', param_value: '20', unit: 'MWh', description: '低谷基础保留量' },
            ],
            created_at: now,
            updated_at: now,
        },
        {
            trade_source_id: 'manual_balance',
            trade_source_name: '人工方案：平滑均衡',
            trade_type: 'manual',
            strategy_id: 'strategy_manual_balance',
            strategy_code: 'MANUAL-BALANCE',
            trade_source_status: '停用',
            next_day_declare_status: '未申报',
            source_kind: 'simulation',
            readonly: false,
            description: '人工维护的平滑均衡方案。',
            params: [
                { param_key: 'balance_ratio', param_name: '平衡系数', param_value: '0.95', unit: '-', description: '控制日内波动幅度' },
                { param_key: 'night_keep', param_name: '夜间保留', param_value: '28', unit: 'MWh', description: '夜间基础申报量' },
            ],
            created_at: now,
            updated_at: now,
        },
    ];
}

function buildInitialState(): MockState {
    const now = new Date().toISOString();
    const tradeSources = buildDefaultTradeSources(now);
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const manualBidCurves: Record<string, number[]> = {
        [`manual_peak_${tomorrow}`]: new Array(PERIOD_COUNT).fill(0),
        [`manual_balance_${tomorrow}`]: new Array(PERIOD_COUNT).fill(0),
    };
    return { tradeSources, manualBidCurves };
}

function loadState(): MockState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        const initial = buildInitialState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
    }
    try {
        return JSON.parse(raw) as MockState;
    } catch {
        const initial = buildInitialState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
    }
}

function saveState(state: MockState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isEditable(_targetDate: string, tradeType: TradeType): { editable: boolean; reason: string | null } {
    if (tradeType !== 'manual') {
        return { editable: false, reason: '自动策略仅支持查看。' };
    }
    return { editable: true, reason: null };
}

function getCurveKey(tradeSourceId: string, targetDate: string): string {
    return `${tradeSourceId}_${targetDate}`;
}

function buildSimulationDetailFromState(item: TradeSourceDetail, targetDate: string, state: MockState): SimulationDetail {
    const priceForecast = buildPriceForecast(targetDate);
    const tradeSourceIndex = state.tradeSources.findIndex((source) => source.trade_source_id === item.trade_source_id);
    let bidCurve = item.trade_type === 'auto'
        ? buildBidCurve(item.trade_type, tradeSourceIndex, targetDate)
        : state.manualBidCurves[getCurveKey(item.trade_source_id, targetDate)] || new Array(PERIOD_COUNT).fill(0);

    if (bidCurve.length !== PERIOD_COUNT) {
        bidCurve = new Array(PERIOD_COUNT).fill(0);
    }

    const hasDeclared = bidCurve.some((value) => value > 0);
    const nextStatus: DeclareStatus = hasDeclared ? '已申报' : '未申报';
    const editable = isEditable(targetDate, item.trade_type);
    return {
        trade_source_id: item.trade_source_id,
        target_date: targetDate,
        current_server_time: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        declaration_time: item.updated_at || item.created_at || '',
        trade_type: item.trade_type,
        strategy_name: item.trade_source_name,
        strategy_id: item.strategy_id,
        strategy_code: item.strategy_code,
        next_day_declare_status: nextStatus,
        summary: summarizeBidCurve(bidCurve),
        price_forecast_30m: priceForecast,
        bid_mwh_30m: bidCurve,
        is_editable: editable.editable,
        lock_reason: editable.reason,
    };
}

function buildDailyRow(item: TradeSourceListItem, date: string): ProfitDailyRow {
    const bidCurve = item.trade_type === 'auto'
        ? buildBidCurve('auto', 1, date)
        : buildBidCurve('manual', 0, date);
    const totalBid = bidCurve.reduce((sum, value) => sum + value, 0);
    const seed = Number(date.replaceAll('-', '').slice(-4)) + item.trade_source_id.length;
    const avgSpread = round(Math.sin(seed / 7) * 22 + 12, 2);
    const realized = round(totalBid * avgSpread * 0.32, 2);
    const winPeriods = clamp(24 + Math.floor((seed % 11) - 2), 10, 38);
    const lossPeriods = clamp(48 - winPeriods - Math.floor(seed % 3), 6, 26);
    return {
        date,
        bid_total_mwh: round(totalBid, 1),
        realized_pnl_yuan: realized,
        unit_pnl_yuan_per_mwh: round(realized / Math.max(totalBid, 1), 2),
        win_periods: winPeriods,
        loss_periods: lossPeriods,
        avg_spread_yuan_per_mwh: avgSpread,
        review_status: seed % 3 === 0 ? '待复盘' : '已复盘',
    };
}

function buildDailyRows(item: TradeSourceListItem, startDate: string, endDate: string): ProfitDailyRow[] {
    const rows: ProfitDailyRow[] = [];
    let cursor = startOfDay(new Date(startDate));
    const end = startOfDay(new Date(endDate));
    while (cursor <= end) {
        rows.push(buildDailyRow(item, format(cursor, 'yyyy-MM-dd')));
        cursor = addDays(cursor, 1);
    }
    return rows;
}

function buildSummary(item: TradeSourceListItem, startDate: string, endDate: string): ProfitSummary {
    const rows = buildDailyRows(item, startDate, endDate);
    const activeBidPeriods = rows.reduce((sum, row) => {
        const bidCurve = item.trade_type === 'auto'
            ? buildBidCurve('auto', 1, row.date)
            : buildBidCurve('manual', 0, row.date);
        return sum + bidCurve.filter((value) => value > 0).length;
    }, 0);
    const total = rows.reduce((sum, row) => sum + row.realized_pnl_yuan, 0);
    const positiveRows = rows.filter((row) => row.realized_pnl_yuan > 0);
    const negativeRows = rows.filter((row) => row.realized_pnl_yuan < 0);
    const profitableAmount = positiveRows.reduce((sum, row) => sum + row.realized_pnl_yuan, 0);
    const lossAmount = negativeRows.reduce((sum, row) => sum + row.realized_pnl_yuan, 0);
    const totalBid = rows.reduce((sum, row) => sum + row.bid_total_mwh, 0);
    const totalWinPeriods = rows.reduce((sum, row) => sum + row.win_periods, 0);
    const totalLossPeriods = rows.reduce((sum, row) => sum + row.loss_periods, 0);
    const totalPeriods = rows.length * 48;
    let peak = 0;
    let cumulative = 0;
    let maxDrawdown = 0;
    rows.forEach((row) => {
        cumulative += row.realized_pnl_yuan;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    });
    const maxSingleDayProfit = positiveRows.length ? Math.max(...positiveRows.map((row) => row.realized_pnl_yuan)) : 0;
    const maxSingleDayLoss = negativeRows.length ? Math.min(...negativeRows.map((row) => row.realized_pnl_yuan)) : 0;
    const winDays = positiveRows.length;
    const avgProfit = positiveRows.length ? profitableAmount / positiveRows.length : 0;
    const avgLoss = negativeRows.length ? lossAmount / negativeRows.length : 0;
    return {
        trade_source_id: item.trade_source_id,
        start_date: startDate,
        end_date: endDate,
        total_realized_pnl_yuan: round(total, 2),
        avg_daily_realized_pnl_yuan: round(total / Math.max(rows.length, 1), 2),
        daily_win_rate: round(winDays / Math.max(rows.length, 1), 4),
        period_win_rate: round(totalWinPeriods / Math.max(totalWinPeriods + totalLossPeriods, 1), 4),
        profitable_amount_yuan: round(profitableAmount, 2),
        loss_amount_yuan: round(lossAmount, 2),
        profit_loss_ratio: round(lossAmount < 0 ? profitableAmount / Math.abs(lossAmount) : 0, 4),
        avg_profit_yuan: round(avgProfit, 2),
        avg_loss_yuan: round(avgLoss, 2),
        avg_profit_loss_ratio: round(avgLoss < 0 ? avgProfit / Math.abs(avgLoss) : 0, 4),
        max_single_day_profit_yuan: round(maxSingleDayProfit, 2),
        max_single_day_loss_yuan: round(maxSingleDayLoss, 2),
        max_profit_loss_ratio: round(maxSingleDayLoss < 0 ? maxSingleDayProfit / Math.abs(maxSingleDayLoss) : 0, 4),
        max_drawdown_yuan: round(maxDrawdown, 2),
        unit_pnl_yuan_per_mwh: round(total / Math.max(totalBid, 1), 4),
        avg_bid_mwh_per_active_period: round(totalBid / Math.max(activeBidPeriods, 1), 4),
        avg_period_pnl_yuan: round(total / Math.max(totalPeriods, 1), 2),
        trading_days: rows.length,
    };
}

function buildCurve(item: TradeSourceListItem, startDate: string, endDate: string, metric: ProfitMetric): ProfitCurveResponse {
    const rows = buildDailyRows(item, startDate, endDate);
    return {
        trade_source_id: item.trade_source_id,
        metric,
        points: rows.map((row, index) => {
            const strategyValue = metric === 'amount' ? row.realized_pnl_yuan : row.unit_pnl_yuan_per_mwh;
            const benchmarkValue = metric === 'amount'
                ? round(row.realized_pnl_yuan * (0.78 + (index % 5) * 0.04), 2)
                : round(row.unit_pnl_yuan_per_mwh * (0.80 + (index % 4) * 0.05), 2);
            return {
                date: row.date,
                strategy_value: strategyValue,
                benchmark_value: benchmarkValue,
                excess_value: round(strategyValue - benchmarkValue, 2),
                unit_label: metric === 'amount' ? '元' : '元/MWh',
            };
        }),
    };
}

function buildDailyResponse(item: TradeSourceListItem, startDate: string, endDate: string): ProfitDailyResponse {
    const rows = buildDailyRows(item, startDate, endDate);
    return {
        rows,
        summary_row: {
            bid_total_mwh: round(rows.reduce((sum, row) => sum + row.bid_total_mwh, 0), 1),
            realized_pnl_yuan: round(rows.reduce((sum, row) => sum + row.realized_pnl_yuan, 0), 2),
            unit_pnl_yuan_per_mwh: round(rows.reduce((sum, row) => sum + row.unit_pnl_yuan_per_mwh, 0) / Math.max(rows.length, 1), 2),
            win_periods: rows.reduce((sum, row) => sum + row.win_periods, 0),
            loss_periods: rows.reduce((sum, row) => sum + row.loss_periods, 0),
        },
    };
}

function buildDailyReview(item: TradeSourceListItem, targetDate: string): DailyReviewDetail {
    const priceForecast = buildPriceForecast(targetDate);
    const bidCurve = item.trade_type === 'auto' ? buildBidCurve('auto', 0, targetDate) : buildBidCurve('manual', 0, targetDate);
    const chartRows: DailyReviewRow[] = PERIOD_LABELS.map((timeLabel, index) => {
        const forecast = priceForecast[index];
        const econ = round(forecast + Math.sin(index / 5) * 16 + 8, 2);
        const realtime = round(econ + Math.cos(index / 4) * 12 - 5, 2);
        const dayahead = round((forecast + econ) / 2, 2);
        const spread = round(realtime - econ, 2);
        const pnl = round(bidCurve[index] * spread * 0.5, 2);
        return {
            period: index + 1,
            time_label: timeLabel,
            price_forecast_yuan_per_mwh: forecast,
            dayahead_price_yuan_per_mwh: dayahead,
            econ_price_yuan_per_mwh: econ,
            realtime_price_yuan_per_mwh: realtime,
            bid_mwh: bidCurve[index],
            spread_yuan_per_mwh: spread,
            period_pnl_yuan: pnl,
            result_flag: pnl > 0 ? '盈利' : pnl < 0 ? '亏损' : '持平',
        };
    });
    const totalPnl = chartRows.reduce((sum, row) => sum + row.period_pnl_yuan, 0);
    const totalBid = chartRows.reduce((sum, row) => sum + row.bid_mwh, 0);
    const winPeriods = chartRows.filter((row) => row.period_pnl_yuan > 0).length;
    const lossPeriods = chartRows.filter((row) => row.period_pnl_yuan < 0).length;
    const avgSpread = round(chartRows.reduce((sum, row) => sum + row.spread_yuan_per_mwh, 0) / PERIOD_COUNT, 2);
    return {
        trade_source_id: item.trade_source_id,
        trade_source_name: item.trade_source_name,
        target_date: targetDate,
        summary: {
            expected_pnl_yuan: round(totalPnl * 0.92, 2),
            realized_pnl_yuan: round(totalPnl, 2),
            total_bid_mwh: round(totalBid, 1),
            win_periods: winPeriods,
            loss_periods: lossPeriods,
            avg_spread_yuan_per_mwh: avgSpread,
        },
        chart_rows: chartRows,
        period_profit_rows: chartRows,
    };
}

async function fallback<T>(runner: () => Promise<T>, mock: () => T): Promise<T> {
    void mock;
    return runner();
}

export const dayAheadBidApi = {
    getTradeSources: async (): Promise<TradeSourceListItem[]> =>
        fallback(
            async () => {
                const res = await apiClient.get<TradeSourceListItem[]>('/api/v1/bid/trade-sources');
                return res.data;
            },
            () => {
                const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
                const state = loadState();
                return state.tradeSources.map((item) => ({
                    ...item,
                    next_day_declare_status: buildSimulationDetailFromState(item, tomorrow, state).next_day_declare_status,
                }));
            },
        ),

    getTradeSourceDetail: async (tradeSourceId: string): Promise<TradeSourceDetail> =>
        fallback(
            async () => {
                const res = await apiClient.get<TradeSourceDetail>(`/api/v1/bid/trade-sources/${tradeSourceId}`);
                return res.data;
            },
            () => {
                const item = loadState().tradeSources.find((source) => source.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return item;
            },
        ),

    createTradeSource: async (payload: TradeSourcePayload): Promise<TradeSourceDetail> =>
        fallback(
            async () => {
                const path = payload.trade_type === 'manual' ? '/api/v1/bid/trade-sources/manual' : '/api/v1/bid/trade-sources/auto';
                const res = await apiClient.post<TradeSourceDetail>(path, payload);
                return res.data;
            },
            () => {
                const state = loadState();
                const now = new Date().toISOString();
                const id = `${payload.trade_type}_${Date.now()}`;
                const item: TradeSourceDetail = {
                    trade_source_id: id,
                    strategy_id: `${payload.trade_type}_${Date.now()}`,
                    next_day_declare_status: '未申报',
                    source_kind: 'simulation',
                    readonly: false,
                    created_at: now,
                    updated_at: now,
                    ...payload,
                };
                state.tradeSources.unshift(item);
                saveState(state);
                return item;
            },
        ),

    updateTradeSource: async (tradeSourceId: string, payload: TradeSourcePayload): Promise<TradeSourceDetail> =>
        fallback(
            async () => {
                const res = await apiClient.put<TradeSourceDetail>(`/api/v1/bid/trade-sources/${tradeSourceId}`, payload);
                return res.data;
            },
            () => {
                const state = loadState();
                const index = state.tradeSources.findIndex((item) => item.trade_source_id === tradeSourceId);
                if (index === -1) throw new Error('策略不存在');
                const next: TradeSourceDetail = {
                    ...state.tradeSources[index],
                    ...payload,
                    updated_at: new Date().toISOString(),
                };
                state.tradeSources[index] = next;
                saveState(state);
                return next;
            },
        ),

    setTradeSourceStatus: async (tradeSourceId: string, status: TradeSourceStatus): Promise<void> =>
        fallback(
            async () => {
                await apiClient.post(`/api/v1/bid/trade-sources/${tradeSourceId}/status`, { status });
            },
            () => {
                const state = loadState();
                const item = state.tradeSources.find((row) => row.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                item.trade_source_status = status;
                item.updated_at = new Date().toISOString();
                saveState(state);
            },
        ),

    deleteTradeSource: async (tradeSourceId: string): Promise<void> =>
        fallback(
            async () => {
                await apiClient.delete(`/api/v1/bid/trade-sources/${tradeSourceId}`);
            },
            () => {
                const state = loadState();
                state.tradeSources = state.tradeSources.filter((item) => item.trade_source_id !== tradeSourceId);
                Object.keys(state.manualBidCurves)
                    .filter((key) => key.startsWith(`${tradeSourceId}_`))
                    .forEach((key) => delete state.manualBidCurves[key]);
                saveState(state);
            },
        ),

    getNextDaySimulation: async (tradeSourceId: string): Promise<SimulationDetail> =>
        fallback(
            async () => {
                const res = await apiClient.get<SimulationDetail>('/api/v1/bid/simulations/next-day', { params: { trade_source_id: tradeSourceId } });
                return res.data;
            },
            () => {
                const targetDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');
                const state = loadState();
                const item = state.tradeSources.find((source) => source.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return buildSimulationDetailFromState(item, targetDate, state);
            },
        ),

    saveManualSimulation: async (tradeSourceId: string, targetDate: string, bidValues: number[]): Promise<SimulationDetail> =>
        fallback(
            async () => {
                const res = await apiClient.post<SimulationDetail>('/api/v1/bid/simulations/manual-save', {
                    trade_source_id: tradeSourceId,
                    target_date: targetDate,
                    bid_mwh_30m: bidValues,
                });
                return res.data;
            },
            () => {
                const state = loadState();
                state.manualBidCurves[getCurveKey(tradeSourceId, targetDate)] = bidValues.map((item) => round(item, 1));
                const item = state.tradeSources.find((source) => source.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                item.next_day_declare_status = bidValues.some((value) => value > 0) ? '已申报' : '未申报';
                item.updated_at = new Date().toISOString();
                saveState(state);
                return buildSimulationDetailFromState(item, targetDate, state);
            },
        ),

    resetManualSimulation: async (tradeSourceId: string, targetDate: string): Promise<SimulationDetail> =>
        fallback(
            async () => {
                const res = await apiClient.post<SimulationDetail>('/api/v1/bid/simulations/manual-reset', {
                    trade_source_id: tradeSourceId,
                    target_date: targetDate,
                });
                return res.data;
            },
            () => {
                const state = loadState();
                const item = state.tradeSources.find((source) => source.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                state.manualBidCurves[getCurveKey(tradeSourceId, targetDate)] = new Array(PERIOD_COUNT).fill(0);
                saveState(state);
                return buildSimulationDetailFromState(item, targetDate, state);
            },
        ),

    getProfitSummary: async (tradeSourceId: string, startDate: string, endDate: string): Promise<ProfitSummary> =>
        fallback(
            async () => {
                const res = await apiClient.get<ProfitSummary>('/api/v1/bid/analysis/summary', {
                    params: { trade_source_id: tradeSourceId, start_date: startDate, end_date: endDate },
                });
                return res.data;
            },
            () => {
                const item = loadState().tradeSources.find((row) => row.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return buildSummary(item, startDate, endDate);
            },
        ),

    getProfitCurve: async (tradeSourceId: string, startDate: string, endDate: string, metric: ProfitMetric): Promise<ProfitCurveResponse> =>
        fallback(
            async () => {
                const res = await apiClient.get<ProfitCurveResponse>('/api/v1/bid/analysis/profit-curve', {
                    params: { trade_source_id: tradeSourceId, start_date: startDate, end_date: endDate, metric },
                });
                return res.data;
            },
            () => {
                const item = loadState().tradeSources.find((row) => row.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return buildCurve(item, startDate, endDate, metric);
            },
        ),

    getProfitDaily: async (tradeSourceId: string, startDate: string, endDate: string): Promise<ProfitDailyResponse> =>
        fallback(
            async () => {
                const res = await apiClient.get<ProfitDailyResponse>('/api/v1/bid/analysis/daily', {
                    params: { trade_source_id: tradeSourceId, start_date: startDate, end_date: endDate },
                });
                return res.data;
            },
            () => {
                const item = loadState().tradeSources.find((row) => row.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return buildDailyResponse(item, startDate, endDate);
            },
        ),

    getDailyReview: async (tradeSourceId: string, targetDate: string): Promise<DailyReviewDetail> =>
        fallback(
            async () => {
                const res = await apiClient.get<DailyReviewDetail>(`/api/v1/bid/analysis/daily-review/${targetDate}`, {
                    params: { trade_source_id: tradeSourceId },
                });
                return res.data;
            },
            () => {
                const item = loadState().tradeSources.find((row) => row.trade_source_id === tradeSourceId);
                if (!item) throw new Error('策略不存在');
                return buildDailyReview(item, targetDate);
            },
        ),

    buildDefaultProfitRange: () => {
        const end = new Date();
        const start = subDays(end, 29);
        return {
            start_date: format(start, 'yyyy-MM-dd'),
            end_date: format(end, 'yyyy-MM-dd'),
        };
    },

    buildQuickRange: (preset: 'thisMonth' | 'lastMonth' | '30d' | '60d' | 'thisYear') => {
        const now = new Date();
        if (preset === 'thisMonth') {
            return { start_date: format(startOfMonth(now), 'yyyy-MM-dd'), end_date: format(now, 'yyyy-MM-dd') };
        }
        if (preset === 'lastMonth') {
            const prev = subDays(startOfMonth(now), 1);
            return { start_date: format(startOfMonth(prev), 'yyyy-MM-dd'), end_date: format(endOfMonth(prev), 'yyyy-MM-dd') };
        }
        if (preset === '60d') {
            return { start_date: format(subDays(now, 59), 'yyyy-MM-dd'), end_date: format(now, 'yyyy-MM-dd') };
        }
        if (preset === 'thisYear') {
            return { start_date: format(startOfYear(now), 'yyyy-MM-dd'), end_date: format(endOfYear(now) < now ? endOfYear(now) : now, 'yyyy-MM-dd') };
        }
        return { start_date: format(subDays(now, 29), 'yyyy-MM-dd'), end_date: format(now, 'yyyy-MM-dd') };
    },
};
