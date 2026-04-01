import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
    Paper,
    Stack,
    Tooltip,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    alpha,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import AttachMoneyOutlinedIcon from '@mui/icons-material/AttachMoneyOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    Pie,
    PieChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { addDays, format, parseISO } from 'date-fns';
import {
    CustomerOverviewResponse,
    CustomerProfitContributionResponse,
    DashboardSummaryResponse,
    MarketIntradayResponse,
    PriceTrendResponse,
    SettlementChartResponse,
    SettlementKpiResponse,
    TradeSummaryResponse,
    dashboardApi,
} from '../api/dashboard';
import { ContributionGroup } from '../api/customerProfitAnalysis';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';

type ContributionMode = 'positive' | 'negative';
type SettlementViewMode = 'monthly' | 'yearly';
type MarketViewMode = 'trend' | 'intraday';

interface DashboardState {
    settlementKpi: SettlementKpiResponse | null;
    settlementChart: SettlementChartResponse | null;
    yearlySettlementChart: SettlementChartResponse | null;
    tradeSummary: TradeSummaryResponse | null;
    customerOverview: CustomerOverviewResponse | null;
    customerProfit: CustomerProfitContributionResponse | null;
    priceTrend: PriceTrendResponse | null;
    marketIntraday: MarketIntradayResponse | null;
    snapshotMeta: Pick<DashboardSummaryResponse, 'snapshot_id' | 'status' | 'month' | 'generated_at'> | null;
}

const PIE_COLORS = ['#1f6feb', '#2da44e', '#f57c00', '#8e24aa', '#00838f', '#94a3b8', '#d97706'];
const TRADE_POSITIVE = '#16a34a';
const TRADE_NEGATIVE = '#dc2626';

const formatNumber = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const formatWanMwh = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return `${formatNumber(Number(value) / 10000, digits)} 万MWh`;
};

const formatWanYuan = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return `${formatNumber(Number(value) / 10000, 2)} 万元`;
};

const formatMonthLabel = (month?: string | null) => {
    if (!month) return '当月';
    const parts = month.split('-');
    if (parts.length !== 2) return month;
    return `${Number(parts[1])}月`;
};

const getValueColor = (value?: number | null) => {
    if (value === null || value === undefined) return 'text.primary';
    return value >= 0 ? TRADE_POSITIVE : TRADE_NEGATIVE;
};

const normalizePercent = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    if (Math.abs(value) <= 1) return Number(value) * 100;
    return Number(value);
};

const parseApiError = (error: any) => error?.response?.data?.detail || error?.message || '交易总览数据加载失败';

const DashboardPanel: React.FC<{
    title: string;
    icon: React.ReactNode;
    extra?: React.ReactNode;
    subtitle?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, icon, extra, subtitle, children }) => (
    <Paper
        variant="outlined"
        sx={{
            p: { xs: 1, md: 1.5 },
            borderRadius: 2,
            width: '100%',
            maxWidth: '100%',
            height: { xs: 'auto', md: '100%' },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
        }}
    >
        <Box
            sx={{
                display: 'flex',
                alignItems: { xs: 'flex-start', md: 'center' },
                justifyContent: 'space-between',
                gap: 1,
                mb: 1.25,
                flexWrap: 'wrap',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color: 'primary.main', display: 'inline-flex' }}>{icon}</Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {title}
                </Typography>
            </Box>
            {extra}
        </Box>
        {subtitle && <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1, width: '100%', minWidth: 0 }}>{subtitle}</Box>}
        <Box sx={{ flex: 1, minHeight: { xs: 'auto', md: 0 } }}>{children}</Box>
    </Paper>
);

const InlineStat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0, maxWidth: '100%', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
            {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 800, color: tone || 'text.primary', minWidth: 0, wordBreak: 'break-all' }}>
            {value}
        </Typography>
    </Box>
);

const buildContributionPieData = (group: ContributionGroup | null) => {
    if (!group) return [];
    const rows = group.top5.map((item, index) => ({
        name: item.short_name || item.customer_name,
        value: item.contribution_value,
        percentage: item.percentage,
        fill: PIE_COLORS[index % PIE_COLORS.length],
    }));
    if ((group.others?.contribution_value || 0) > 0) {
        rows.push({
            name: '其他',
            value: group.others.contribution_value,
            percentage: group.others.percentage,
            fill: PIE_COLORS[5],
        });
    }
    return rows;
};

export const DashboardPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [contributionMode, setContributionMode] = useState<ContributionMode>('positive');
    const [settlementViewMode, setSettlementViewMode] = useState<SettlementViewMode>('monthly');
    const [marketViewMode, setMarketViewMode] = useState<MarketViewMode>('trend');
    const [marketIntradayLoading, setMarketIntradayLoading] = useState(false);
    const [marketSelectedDate, setMarketSelectedDate] = useState<Date | null>(null);
    const [state, setState] = useState<DashboardState>({
        settlementKpi: null,
        settlementChart: null,
        yearlySettlementChart: null,
        tradeSummary: null,
        customerOverview: null,
        customerProfit: null,
        priceTrend: null,
        marketIntraday: null,
        snapshotMeta: null,
    });

    useEffect(() => {
        let cancelled = false;

        const loadAll = async () => {
            setLoading(true);
            setError(null);
            try {
                const summary = await dashboardApi.getSummary();

                if (cancelled) return;
                setState({
                    settlementKpi: summary.settlement_kpi,
                    settlementChart: summary.settlement_chart_monthly,
                    yearlySettlementChart: summary.settlement_chart_yearly,
                    tradeSummary: summary.trade_summary,
                    customerOverview: summary.customer_overview,
                    customerProfit: summary.customer_profit_contribution,
                    priceTrend: summary.price_trend,
                    marketIntraday: null,
                    snapshotMeta: {
                        snapshot_id: summary.snapshot_id,
                        status: summary.status,
                        month: summary.month,
                        generated_at: summary.generated_at,
                    },
                });
            } catch (err: any) {
                if (!cancelled) {
                    setError(parseApiError(err));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadAll();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (marketViewMode !== 'intraday') {
            return;
        }

        const loadIntraday = async () => {
            setMarketIntradayLoading(true);
            try {
                const selectedDate = marketSelectedDate ? format(marketSelectedDate, 'yyyy-MM-dd') : undefined;
                const response = await dashboardApi.getMarketIntraday(selectedDate);
                if (cancelled) return;
                setState((prev) => ({
                    ...prev,
                    marketIntraday: response,
                }));
                const currentDateText = marketSelectedDate ? format(marketSelectedDate, 'yyyy-MM-dd') : null;
                if (response.date && response.date !== currentDateText) {
                    setMarketSelectedDate(parseISO(response.date));
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(parseApiError(err));
                }
            } finally {
                if (!cancelled) {
                    setMarketIntradayLoading(false);
                }
            }
        };

        void loadIntraday();
        return () => {
            cancelled = true;
        };
    }, [marketViewMode, marketSelectedDate]);

    const customerOverviewPieData = useMemo(
        () =>
            (state.customerOverview?.top_customer_distribution || []).map((item, index) => ({
                name: item.name,
                value: item.usage_mwh,
                percentage: item.percentage,
                fill: PIE_COLORS[index % PIE_COLORS.length],
            })),
        [state.customerOverview]
    );

    const contributionGroup = useMemo(() => {
        if (!state.customerProfit) return null;
        return contributionMode === 'positive'
            ? state.customerProfit.positive_contribution
            : state.customerProfit.negative_contribution;
    }, [contributionMode, state.customerProfit]);

    const contributionPieData = useMemo(() => buildContributionPieData(contributionGroup), [contributionGroup]);

    const tradeChartData = useMemo(
        () =>
            (state.tradeSummary?.type_cards || []).map((item) => ({
                label: item.label,
                contribution: Number(item.contribution_amount || 0),
                contributionAbs: Math.abs(Number(item.contribution_amount || 0)),
                winRate: normalizePercent(item.win_rate),
                energyShare: normalizePercent(item.energy_share),
            })),
        [state.tradeSummary]
    );

    const tradeReviewMonthLabel = useMemo(() => formatMonthLabel(state.tradeSummary?.month), [state.tradeSummary?.month]);
    const tradeReviewSummaryText = useMemo(() => {
        return `说明：数据来自${tradeReviewMonthLabel}交易复盘结果，按各类交易相对实时现货价格的偏差结算表现汇总展示贡献值、胜率和电量占比。`;
    }, [tradeReviewMonthLabel]);

    const avgContractPrice = useMemo(() => {
        const rows = state.priceTrend?.daily_trends.filter((item) => item.contract_vwap !== null) || [];
        if (!rows.length) return null;
        return rows.reduce((sum, item) => sum + Number(item.contract_vwap || 0), 0) / rows.length;
    }, [state.priceTrend]);

    const avgSpotPrice = useMemo(() => {
        const rows = state.priceTrend?.daily_trends.filter((item) => item.spot_vwap !== null) || [];
        if (!rows.length) return null;
        return rows.reduce((sum, item) => sum + Number(item.spot_vwap || 0), 0) / rows.length;
    }, [state.priceTrend]);
    const marketIntradayDateText = useMemo(
        () => (state.marketIntraday?.date ? state.marketIntraday.date : '--'),
        [state.marketIntraday]
    );
    const marketIntradayChartData = state.marketIntraday?.chart_data || [];
    const { TouPeriodAreas } = useTouPeriodBackground(
        marketViewMode === 'intraday' ? marketIntradayChartData : null,
        '24:00'
    );

    const activeSettlementChart = settlementViewMode === 'yearly' ? state.yearlySettlementChart : state.settlementChart;
    const settlementMonthLabel = useMemo(() => formatMonthLabel(state.settlementKpi?.month), [state.settlementKpi?.month]);
    const settlementAsOfDateText = useMemo(
        () => state.settlementKpi?.as_of_date || activeSettlementChart?.as_of_date || '--',
        [activeSettlementChart?.as_of_date, state.settlementKpi?.as_of_date]
    );

    const settlementChartData = useMemo(() => {
        const rows = activeSettlementChart?.chart_data || [];
        if (settlementViewMode !== 'yearly') {
            return rows;
        }
        return rows.map((item, index) => ({
            ...item,
            cumulative_avg_spread_final: item.display_mode === 'final' ? item.cumulative_avg_spread : null,
            // 让虚线从最后一个已月结月份平滑衔接到估算月份，避免 3 月看起来断线
            cumulative_avg_spread_estimated:
                item.display_mode === 'estimated'
                    ? item.cumulative_avg_spread
                    : (item.display_mode === 'final' && rows[index + 1]?.display_mode === 'estimated'
                        ? item.cumulative_avg_spread
                        : null),
        }));
    }, [activeSettlementChart, settlementViewMode]);

    if (loading) {
        return (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ p: 2 }}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    const customerOverviewPanel = (
        <DashboardPanel
            title="客户概览"
            icon={<GroupsOutlinedIcon fontSize="small" />}
            extra={
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
                    <InlineStat label="签约客户/当月有效" value={`${state.customerOverview?.yearly_contract_customers ?? '--'}户/${state.customerOverview?.current_valid_customers ?? '--'}户`} />
                    <InlineStat label="签约电量/当年实际" value={`${formatWanMwh(state.customerOverview?.signed_quantity_mwh)} / ${formatWanMwh(state.customerOverview?.actual_total_usage_mwh)}`} />
                </Box>
            }
        >
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 1.5, height: { xs: 'auto', lg: '100%' } }}>
                <Box sx={{ flex: { xs: 'none', lg: '0 0 56%' }, minHeight: { xs: 220, lg: 0 }, height: { xs: 220, lg: 'auto' }, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={customerOverviewPieData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={isMobile ? 42 : 54}
                                outerRadius={isMobile ? 70 : 88}
                                paddingAngle={2}
                            >
                                {customerOverviewPieData.map((item) => (
                                    <Cell key={item.name} fill={item.fill} />
                                ))}
                            </Pie>
                            <RechartsTooltip
                                wrapperStyle={{ zIndex: 9999 }}
                                formatter={(value: number, _name, props: any) => [`${formatWanMwh(value, 2)}`, `${props?.payload?.name} ${formatNumber(props?.payload?.percentage, 1)}%`]}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column',
                            pointerEvents: 'none',
                        }}
                    >
                        <Typography variant="caption" color="text.secondary">
                            前六大客户+其他
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            {formatWanMwh(state.customerOverview?.actual_total_usage_mwh, 2)}
                        </Typography>
                    </Box>
                </Box>
                <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
                    {customerOverviewPieData.map((item, index) => (
                        <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PIE_COLORS[index % PIE_COLORS.length], flexShrink: 0 }} />
                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, flex: 1 }}>
                                    {item.name}
                                </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>
                                {formatNumber(item.percentage, 1)}%
                            </Typography>
                        </Box>
                    ))}
                </Stack>
            </Box>
        </DashboardPanel>
    );

    const settlementPanel = (
        <DashboardPanel
            title="售电收益"
            icon={<AttachMoneyOutlinedIcon fontSize="small" />}
            extra={
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={settlementViewMode}
                    onChange={(_, value: SettlementViewMode | null) => value && setSettlementViewMode(value)}
                    sx={{ maxWidth: '100%', flexShrink: 1 }}
                >
                    <ToggleButton value="monthly">月内</ToggleButton>
                    <ToggleButton value="yearly">月度</ToggleButton>
                </ToggleButtonGroup>
            }
            subtitle={
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <InlineStat label="年度累计毛利" value={formatWanYuan(state.settlementKpi?.kpi.yearly_gross_profit)} tone={getValueColor(state.settlementKpi?.kpi.yearly_gross_profit)} />
                    <InlineStat label={`${settlementMonthLabel}毛利`} value={formatWanYuan(state.settlementKpi?.kpi.monthly_gross_profit)} tone={getValueColor(state.settlementKpi?.kpi.monthly_gross_profit)} />
                    <InlineStat label={`购电均价/售电均价/${settlementMonthLabel}价差`} value={`${formatNumber(state.settlementKpi?.kpi.wholesale_avg_price, 3)} / ${formatNumber(state.settlementKpi?.kpi.retail_avg_price, 3)} / ${formatNumber(state.settlementKpi?.kpi.price_spread, 3)} 元/MWh`} tone={getValueColor(state.settlementKpi?.kpi.price_spread)} />
                    <InlineStat label="结算截止日" value={settlementAsOfDateText} />
                </Box>
            }
        >
            <Box sx={{ height: { xs: 260, md: '100%' }, minHeight: { xs: 260, md: 0 }, '& .recharts-surface:focus': { outline: 'none' } }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={settlementChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey={settlementViewMode === 'yearly' ? 'month_label' : 'day'} tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={36} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={36} />
                        <RechartsTooltip
                            content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                const title = settlementViewMode === 'yearly'
                                    ? payload[0]?.payload?.month || label
                                    : payload[0]?.payload?.date || label;
                                const point = payload[0]?.payload || {};
                                const seenNames = new Set<string>();
                                const rows = payload
                                    .filter((entry) => entry?.value !== null && entry?.value !== undefined)
                                    .map((entry) => {
                                        let name = settlementViewMode === 'yearly' ? '月度价差' : '当日价差';
                                        let valueText = `${formatNumber(entry.value, 3)} 元/MWh`;

                                        if (
                                            entry?.dataKey === 'cumulative_avg_spread'
                                            || entry?.dataKey === 'cumulative_avg_spread_final'
                                            || entry?.dataKey === 'cumulative_avg_spread_estimated'
                                        ) {
                                            name = '累计价差';
                                        } else if (entry?.dataKey === 'gross_profit') {
                                            name = settlementViewMode === 'yearly' ? '当月毛利' : '当日毛利';
                                            valueText = formatWanYuan(entry.value);
                                        } else if (entry?.dataKey === 'cumulative_gross_profit') {
                                            name = '累计毛利';
                                            valueText = formatWanYuan(entry.value);
                                        }

                                        return {
                                            name,
                                            valueText,
                                        };
                                    })
                                    .filter((entry) => {
                                        if (seenNames.has(entry.name)) {
                                            return false;
                                        }
                                        seenNames.add(entry.name);
                                        return true;
                                    });
                                const extraRows = [
                                    {
                                        name: settlementViewMode === 'yearly' ? '当月毛利' : '当日毛利',
                                        valueText: point.gross_profit !== null && point.gross_profit !== undefined
                                            ? formatWanYuan(point.gross_profit)
                                            : '--',
                                    },
                                    {
                                        name: '累计毛利',
                                        valueText: point.cumulative_gross_profit !== null && point.cumulative_gross_profit !== undefined
                                            ? formatWanYuan(point.cumulative_gross_profit)
                                            : '--',
                                    },
                                ];
                                extraRows.forEach((entry) => {
                                    if (!seenNames.has(entry.name)) {
                                        rows.push(entry);
                                        seenNames.add(entry.name);
                                    }
                                });

                                return (
                                    <Box
                                        sx={{
                                            bgcolor: 'background.paper',
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1.5,
                                            px: 1.25,
                                            py: 0.9,
                                            boxShadow: 3,
                                        }}
                                    >
                                        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                                            {String(title)}
                                        </Typography>
                                        {rows.map((entry) => (
                                            <Typography key={entry.name} variant="caption" sx={{ display: 'block', lineHeight: 1.7 }}>
                                                {entry.name}：{entry.valueText}
                                            </Typography>
                                        ))}
                                    </Box>
                                );
                            }}
                        />
                        <ReferenceLine yAxisId="left" y={0} stroke="#94a3b8" />
                        <Bar yAxisId="left" dataKey="price_spread" radius={[2, 2, 0, 0]}>
                            {settlementChartData.map((item: any, index: number) => {
                                const key = item.date || item.month || String(index);
                                if (settlementViewMode === 'yearly' && item.display_mode === 'estimated') {
                                    return (
                                        <Cell
                                            key={key}
                                            fill="rgba(0,0,0,0)"
                                            stroke="#22c55e"
                                            strokeWidth={2}
                                            strokeDasharray="4 3"
                                        />
                                    );
                                }
                                if (settlementViewMode === 'yearly' && item.display_mode === 'future') {
                                    return <Cell key={key} fill="rgba(0,0,0,0)" stroke="rgba(0,0,0,0)" />;
                                }
                                if (settlementViewMode === 'yearly') {
                                    return <Cell key={key} fill="#22c55e" />;
                                }
                                const color = (item.price_spread || 0) >= 0 ? '#22c55e' : '#ef4444';
                                return <Cell key={key} fill={color} />
                            })}
                        </Bar>
                        {settlementViewMode === 'yearly' ? (
                            <>
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="cumulative_avg_spread_final"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls={false}
                                />
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="cumulative_avg_spread_estimated"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    dot={false}
                                    strokeDasharray="5 4"
                                    connectNulls={false}
                                />
                            </>
                        ) : (
                            <Line yAxisId="right" type="monotone" dataKey="cumulative_avg_spread" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </Box>
        </DashboardPanel>
    );

    const tradeReviewPanel = (
        <DashboardPanel title="交易复盘" icon={<InsightsOutlinedIcon fontSize="small" />}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: { xs: 'auto', lg: '100%' } }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 1.5, flex: 1, minHeight: { xs: 'auto', lg: 0 } }}>
                    <Box
                        sx={{
                            flex: { xs: 'none', lg: '0 0 56%' },
                            minHeight: { xs: 240, lg: 0 },
                            height: { xs: 240, lg: 'auto' },
                            display: 'flex',
                            alignItems: 'stretch',
                            '& .recharts-surface:focus': { outline: 'none' },
                        }}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={tradeChartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="26%">
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="label" width={56} tick={{ fontSize: 12 }} />
                                <RechartsTooltip
                                    formatter={(value: number, _name, props: any) => {
                                        const payload = props?.payload;
                                        return [
                                            `${formatNumber(payload?.contribution, 2)} 元 | 胜率 ${formatNumber(payload?.winRate, 1)}% | 电量占比 ${formatNumber(payload?.energyShare, 1)}%`,
                                            payload?.label || '',
                                        ];
                                    }}
                                />
                                <Bar dataKey="contributionAbs" radius={[0, 6, 6, 0]} barSize={17}>
                                    {tradeChartData.map((item) => (
                                        <Cell key={item.label} fill={item.contribution >= 0 ? TRADE_POSITIVE : TRADE_NEGATIVE} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Box>
                    <Stack
                        spacing={0.75}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            height: { xs: 'auto', lg: '100%' },
                            justifyContent: { xs: 'flex-start', lg: 'center' },
                        }}
                    >
                        {tradeChartData.map((item) => (
                            <Tooltip
                                key={item.label}
                                arrow
                                placement="left"
                                title={
                                    <Box sx={{ py: 0.25 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                                            {item.label}
                                        </Typography>
                                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
                                            贡献值：{formatWanYuan(item.contribution)}
                                        </Typography>
                                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
                                            胜率：{formatNumber(item.winRate, 1)}%
                                        </Typography>
                                        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
                                            电量占比：{formatNumber(item.energyShare, 1)}%
                                        </Typography>
                                    </Box>
                                }
                            >
                                <Box
                                    sx={{
                                        p: 1,
                                        borderRadius: 1.5,
                                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                                        border: '1px solid',
                                        borderColor: alpha(theme.palette.primary.main, 0.1),
                                        cursor: 'help',
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
                                        {item.label}
                                    </Typography>
                                    <Typography
                                        variant="subtitle2"
                                        sx={{
                                            fontWeight: 800,
                                            color: getValueColor(item.contribution),
                                            lineHeight: 1.3,
                                        }}
                                    >
                                        {formatWanYuan(item.contribution)}
                                    </Typography>
                                </Box>
                            </Tooltip>
                        ))}
                    </Stack>
                </Box>
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', lineHeight: 1.6, px: 0.5 }}
                >
                    {tradeReviewSummaryText}
                </Typography>
            </Box>
        </DashboardPanel>
    );

    const customerContributionPanel = (
        <DashboardPanel
            title="客户贡献"
            icon={<PriceChangeOutlinedIcon fontSize="small" />}
            extra={
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={contributionMode}
                    onChange={(_, value: ContributionMode | null) => value && setContributionMode(value)}
                    sx={{ maxWidth: '100%', flexShrink: 1 }}
                >
                    <ToggleButton value="positive">正收益</ToggleButton>
                    <ToggleButton value="negative">负收益</ToggleButton>
                </ToggleButtonGroup>
            }
        >
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 1.5, height: { xs: 'auto', lg: '100%' } }}>
                <Box sx={{ flex: { xs: 'none', lg: '0 0 52%' }, minHeight: { xs: 220, lg: 0 }, height: { xs: 220, lg: 'auto' }, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={contributionPieData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={isMobile ? 42 : 54}
                                outerRadius={isMobile ? 70 : 88}
                                paddingAngle={2}
                            >
                                {contributionPieData.map((item) => (
                                    <Cell key={item.name} fill={item.fill} />
                                ))}
                            </Pie>
                            <RechartsTooltip
                                wrapperStyle={{ zIndex: 9999 }}
                                formatter={(value: number, _name, props: any) => [`${formatWanYuan(value)}`, `${props?.payload?.name} ${formatNumber(props?.payload?.percentage, 1)}%`]}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column',
                            pointerEvents: 'none',
                        }}
                    >
                        <Typography variant="caption" color="text.secondary">
                            {contributionMode === 'positive' ? '正收益累计' : '负收益累计'}
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: contributionMode === 'positive' ? TRADE_POSITIVE : TRADE_NEGATIVE }}>
                            {formatWanYuan(contributionPieData.reduce((sum, item) => sum + Number(item.value || 0), 0))}
                        </Typography>
                    </Box>
                </Box>
                <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
                    {contributionPieData.map((item, index) => (
                        <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PIE_COLORS[index % PIE_COLORS.length], flexShrink: 0 }} />
                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, flex: 1 }}>
                                    {item.name}
                                </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ fontWeight: 700, flexShrink: 0 }}>
                                {formatNumber(item.percentage, 1)}%
                            </Typography>
                        </Box>
                    ))}
                </Stack>
            </Box>
        </DashboardPanel>
    );

    const marketPricePanel = (
        <DashboardPanel
            title="市场价格"
            icon={<TrendingUpOutlinedIcon fontSize="small" />}
            extra={
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={marketViewMode}
                    onChange={(_, value: MarketViewMode | null) => value && setMarketViewMode(value)}
                    sx={{ maxWidth: '100%', flexShrink: 1 }}
                >
                    <ToggleButton value="trend">趋势</ToggleButton>
                    <ToggleButton value="intraday">日内</ToggleButton>
                </ToggleButtonGroup>
            }
            subtitle={
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {marketViewMode === 'trend' ? (
                        <>
                            <InlineStat label="中长期均价" value={`${formatNumber(avgContractPrice, 2)} 元/MWh`} />
                            <InlineStat label="实时现货均价" value={`${formatNumber(avgSpotPrice, 2)} 元/MWh`} />
                            <InlineStat label="平均价差" value={`${formatNumber(state.priceTrend?.spread_stats.avgSpread, 2)} 元/MWh`} />
                        </>
                    ) : (
                        <>
                            <InlineStat label="实时现货均价" value={`${formatNumber(state.marketIntraday?.stats.real_time_avg, 3)} 元/MWh`} />
                            <InlineStat label="经济日前均价" value={`${formatNumber(state.marketIntraday?.stats.econ_avg, 3)} 元/MWh`} />
                            <InlineStat label="平均价差" value={`${formatNumber(state.marketIntraday?.stats.avg_spread, 3)} 元/MWh`} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                <IconButton
                                    size="small"
                                    onClick={() => setMarketSelectedDate((prev) => (prev ? addDays(prev, -1) : null))}
                                    disabled={!marketSelectedDate}
                                    sx={{ p: 0.25 }}
                                >
                                    <ArrowLeftIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                                <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        日期
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontWeight: 700,
                                            color: theme.palette.primary.main,
                                        }}
                                    >
                                        {marketIntradayDateText}
                                    </Typography>
                                </Box>
                                <IconButton
                                    size="small"
                                    onClick={() => setMarketSelectedDate((prev) => (prev ? addDays(prev, 1) : null))}
                                    disabled={!marketSelectedDate}
                                    sx={{ p: 0.25 }}
                                >
                                    <ArrowRightIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Box>
                        </>
                    )}
                </Box>
            }
        >
            <Box sx={{ height: { xs: 260, md: '100%' }, minHeight: { xs: 260, md: 0 }, '& .recharts-surface:focus': { outline: 'none' } }}>
                {marketViewMode === 'intraday' && marketIntradayLoading ? (
                    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            data={marketViewMode === 'trend' ? state.priceTrend?.daily_trends || [] : marketIntradayChartData}
                            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            {marketViewMode === 'intraday' ? TouPeriodAreas : null}
                            <XAxis
                                dataKey={marketViewMode === 'trend' ? 'date' : 'time'}
                                tickFormatter={(value) => marketViewMode === 'trend' ? String(value).slice(5) : value}
                                tick={{ fontSize: 11 }}
                                interval={marketViewMode === 'intraday' ? 7 : 'preserveStartEnd'}
                            />
                            <YAxis tick={{ fontSize: 11 }} width={40} />
                            <RechartsTooltip
                                content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;
                                    const point = payload[0]?.payload || {};
                                    const line1Label = marketViewMode === 'intraday' ? '实时现货' : '中长期';
                                    const line1Value = marketViewMode === 'intraday' ? point.price_rt : point.contract_vwap;
                                    const line2Label = marketViewMode === 'intraday' ? '经济日前' : '实时现货';
                                    const line2Value = marketViewMode === 'intraday' ? point.price_econ : point.spot_vwap;
                                    const spreadLabel = marketViewMode === 'intraday' ? '实时-日前' : '实时-中长期';
                                    const spread =
                                        line1Value !== null &&
                                        line1Value !== undefined &&
                                        line2Value !== null &&
                                        line2Value !== undefined
                                            ? (
                                                marketViewMode === 'intraday'
                                                    ? Number(line1Value) - Number(line2Value)
                                                    : Number(line2Value) - Number(line1Value)
                                            )
                                            : null;

                                    return (
                                        <Box
                                            sx={{
                                                bgcolor: 'background.paper',
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1.5,
                                                px: 1.25,
                                                py: 0.9,
                                                boxShadow: 3,
                                            }}
                                        >
                                            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                                                {String(label)}
                                            </Typography>
                                            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.7 }}>
                                                {line1Label}：{formatNumber(line1Value, marketViewMode === 'intraday' ? 3 : 2)} 元/MWh
                                            </Typography>
                                            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.7 }}>
                                                {line2Label}：{formatNumber(line2Value, marketViewMode === 'intraday' ? 3 : 2)} 元/MWh
                                            </Typography>
                                            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.7 }}>
                                                价差（{spreadLabel}）：{spread !== null ? `${formatNumber(spread, marketViewMode === 'intraday' ? 3 : 2)} 元/MWh` : '--'}
                                            </Typography>
                                        </Box>
                                    );
                                }}
                            />
                            {marketViewMode === 'trend' ? (
                                <>
                                    <Line type="monotone" dataKey="contract_vwap" name="中长期" stroke="#2563eb" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="spot_vwap" name="实时现货" stroke="#ef4444" strokeWidth={2} dot={false} />
                                </>
                            ) : (
                                <>
                                    <Line type="monotone" dataKey="price_rt" name="实时现货" stroke="#ef4444" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="price_econ" name="经济日前" stroke="#2563eb" strokeWidth={2} dot={false} />
                                </>
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </DashboardPanel>
    );

    const alertsPanel = (
        <DashboardPanel title="异常告警" icon={<NotificationsActiveOutlinedIcon fontSize="small" />}>
            <Box
                sx={{
                    height: { xs: 160, md: '100%' },
                    borderRadius: 2,
                    border: '1px dashed',
                    borderColor: 'divider',
                    bgcolor: alpha(theme.palette.background.default, 0.6),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    px: 2,
                    textAlign: 'center',
                }}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    异常告警区域预留
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    后续按告警分级、来源聚合和跳转策略再细化。
                </Typography>
            </Box>
        </DashboardPanel>
    );

    const mobileLayoutSx = {
        display: 'flex',
        flexDirection: 'column',
        gap: { xs: 1.5, sm: 2 },
        px: { xs: 1, sm: 1.5 },
        pt: { xs: 0.5, sm: 0.75 },
        pb: { xs: 1.25, sm: 1.5 },
    } as const;

    const desktopLayoutSx = {
        display: 'grid',
        gridTemplateColumns: '1fr 2fr 1fr',
        gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
        gap: 2,
        px: 2,
        py: 2,
        height: 'calc(100vh - 64px - 49px)',
        minHeight: 0,
        overflow: 'hidden',
    } as const;

    return (
        <Box
            sx={{
                height: isMobile ? 'auto' : 'calc(100vh - 64px - 49px)',
                minHeight: isMobile ? '100%' : 0,
                bgcolor: 'background.default',
                overflowX: 'hidden',
                overflowY: isMobile ? 'auto' : 'hidden',
            }}
        >
            {isMobile && (
                <Typography
                    variant="subtitle1"
                    sx={{
                        px: { xs: 1, sm: 1.5 },
                        pt: { xs: 1, sm: 1.5 },
                        fontWeight: 'bold',
                        color: 'text.primary',
                    }}
                >
                    首页 / 交易总览
                </Typography>
            )}
            <Box sx={isMobile ? mobileLayoutSx : desktopLayoutSx}>
                {isMobile ? (
                    <>
                        {customerOverviewPanel}
                        {settlementPanel}
                        {tradeReviewPanel}
                        {customerContributionPanel}
                        {marketPricePanel}
                        {alertsPanel}
                    </>
                ) : (
                    <>
                        <Box sx={{ gridColumn: 1, gridRow: 1, minHeight: 0 }}>{customerOverviewPanel}</Box>
                        <Box sx={{ gridColumn: 2, gridRow: 1, minHeight: 0 }}>{settlementPanel}</Box>
                        <Box sx={{ gridColumn: 3, gridRow: 1, minHeight: 0 }}>{tradeReviewPanel}</Box>
                        <Box sx={{ gridColumn: 1, gridRow: 2, minHeight: 0 }}>{customerContributionPanel}</Box>
                        <Box sx={{ gridColumn: 2, gridRow: 2, minHeight: 0 }}>{marketPricePanel}</Box>
                        <Box sx={{ gridColumn: 3, gridRow: 2, minHeight: 0 }}>{alertsPanel}</Box>
                    </>
                )}
            </Box>
        </Box>
    );
};

export default DashboardPage;
