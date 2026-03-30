import React, { useMemo, useRef, useState } from 'react';
import {
    Box,
    Checkbox,
    Chip,
    Divider,
    Paper,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableFooter,
    TableHead,
    TableRow,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    alpha,
} from '@mui/material';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { MonthlyReviewDailyRow, MonthlyReviewPeriodRow } from '../../types/tradeReview';
import { MonthlyTradeType } from './MonthlyTradeReviewTypeCards';

type MainTab = 'daily' | 'period';
type ViewMode = 'price' | 'amount' | 'table';
type TradeSeriesKey =
    | 'annual_volume_mwh'
    | 'monthly_volume_mwh'
    | 'within_month_volume_mwh'
    | 'day_ahead_volume_mwh'
    | 'annual_avg_price'
    | 'monthly_avg_price'
    | 'within_month_avg_price'
    | 'day_ahead_avg_price'
    | 'annual_contribution_amount'
    | 'monthly_contribution_amount'
    | 'within_month_contribution_amount'
    | 'day_ahead_contribution_amount'
    | 'spot_avg_price'
    | 'actual_load_mwh'
    | 'total_contribution_amount'
    | 'exposed_amount';

type FlattenedRow = Record<string, string | number | null>;

const ORDER: Array<Exclude<MonthlyTradeType, 'all'>> = ['annual', 'monthly', 'within_month', 'day_ahead'];
const COLORS = { annual: '#bbdefb', monthly: '#d1c4e9', within_month: '#81c784', day_ahead: '#ffe082' } as const;
const LABELS = { annual: '年度交易', monthly: '月度交易', within_month: '月内交易', day_ahead: '日前交易' } as const;
const SPOT_PRICE_COLOR = '#e53935';
const ACTUAL_LOAD_FILL = '#cfd8dc';
const ACTUAL_LOAD_STROKE = '#b0bec5';
const TOTAL_CONTRIBUTION_COLOR = '#1e88e5';
const EXPOSED_AMOUNT_COLOR = '#e53935';
const CHART_HEIGHT = { xs: 390, sm: 480 };

const fmt = (value?: number | null, digits = 2) =>
    value === null || value === undefined || Number.isNaN(value)
        ? '-'
        : value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const sumValue = (items: FlattenedRow[], key: string) =>
    items.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

const weightedAverage = (items: FlattenedRow[], valueKey: string, weightKey: string) => {
    const weight = items.reduce((acc, item) => acc + (Number(item[weightKey]) || 0), 0);
    if (weight <= 0) {
        return null;
    }
    const amount = items.reduce((acc, item) => acc + (Number(item[valueKey]) || 0) * (Number(item[weightKey]) || 0), 0);
    return amount / weight;
};

const buildMonthDates = (month: string) => {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
        return [];
    }
    const days = new Date(year, monthNumber, 0).getDate();
    return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
};

const normalizeDailyRows = (month: string, rows: MonthlyReviewDailyRow[]) => {
    const rowMap = new Map(rows.map((row) => [row.date, row]));
    return buildMonthDates(month).map((date) => rowMap.get(date) || { date, trade_types: [] });
};

const MonthlyTradeReviewTooltipContent: React.FC<{
    row: FlattenedRow;
    mode: ViewMode;
    mainTab: MainTab;
}> = ({ row, mode, mainTab }) => (
    <Paper
        elevation={0}
        sx={{
            p: 2,
            minWidth: 320,
            borderRadius: 3,
            border: '1px solid rgba(30, 41, 59, 0.12)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
            boxShadow: '0 14px 36px rgba(15, 23, 42, 0.16)',
            backdropFilter: 'blur(10px)',
        }}
    >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
            {mainTab === 'daily' ? `日期 ${String(row.label)}` : `时段 ${String(row.label)}`}
        </Typography>
        <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1 }} />
        <Box sx={{ display: 'grid', gap: 0.75 }}>
            <Typography variant="body2" sx={{ color: '#334155' }}>
                实时现货均价：{fmt(row.spot_avg_price as number | null, 3)} 元/MWh
            </Typography>
            {mode === 'price' ? (
                <>
                    {ORDER.map((key) => (
                        <Typography key={`${key}_avg_price`} variant="body2" sx={{ color: '#334155' }}>
                            {LABELS[key]}均价：{fmt(row[`${key}_avg_price`] as number | null, 3)} 元/MWh
                        </Typography>
                    ))}
                </>
            ) : (
                <>
                    {ORDER.map((key) => (
                        <Typography key={`${key}_contribution_amount`} variant="body2" sx={{ color: '#334155' }}>
                            {LABELS[key]}贡献值：{fmt(row[`${key}_contribution_amount`] as number | null)} 元
                        </Typography>
                    ))}
                    <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 700 }}>
                        合计贡献值：{fmt(row.total_contribution_amount as number | null)} 元
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 700 }}>
                        风险暴露金额：{fmt(row.exposed_amount as number | null)} 元
                    </Typography>
                </>
            )}
        </Box>
        <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1.25 }} />
        <Box sx={{ display: 'grid', gap: 0.75 }}>
            <Typography variant="body2" sx={{ color: '#334155' }}>
                实际电量：{fmt(row.actual_load_mwh as number | null, 3)} MWh
            </Typography>
            {ORDER.map((key) => (
                <Typography key={`${key}_volume_mwh`} variant="body2" sx={{ color: '#334155' }}>
                    {LABELS[key]}电量：{fmt(row[`${key}_volume_mwh`] as number | null, 3)} MWh
                </Typography>
            ))}
        </Box>
    </Paper>
);

const MonthlyTradeReviewTooltip: React.FC<{
    active?: boolean;
    payload?: Array<{ payload?: FlattenedRow }>;
    mode: ViewMode;
    mainTab: MainTab;
}> = ({ active, payload, mode, mainTab }) => {
    if (!active || !payload || payload.length === 0) {
        return null;
    }
    const row = payload.find((item) => item?.payload)?.payload;
    if (!row) {
        return null;
    }
    return <MonthlyTradeReviewTooltipContent row={row} mode={mode} mainTab={mainTab} />;
};

const resolveContributionTone = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return { label: '暂无数据', color: 'default' as const };
    }
    if (value > 0) {
        return { label: '正贡献', color: 'success' as const };
    }
    if (value < 0) {
        return { label: '负贡献', color: 'error' as const };
    }
    return { label: '持平', color: 'default' as const };
};

const flattenRows = (rows: Array<MonthlyReviewDailyRow | MonthlyReviewPeriodRow>, type: MainTab) =>
    rows.map((row) => {
        const next: FlattenedRow = {
            key: type === 'daily' ? (row as MonthlyReviewDailyRow).date : String((row as MonthlyReviewPeriodRow).period),
            label: type === 'daily'
                ? String((row as MonthlyReviewDailyRow).date)
                : String((row as MonthlyReviewPeriodRow).period),
            actual_load_mwh: row.actual_load_mwh ?? null,
            spot_avg_price: row.spot_avg_price ?? null,
            total_contribution_amount: row.total_contribution_amount ?? null,
            exposed_amount: row.exposed_amount ?? null,
        };

        ORDER.forEach((tradeType) => {
            const point = (row.trade_types || []).find((item) => item.trade_type === tradeType);
            next[`${tradeType}_volume_mwh`] = point?.volume_mwh ?? null;
            next[`${tradeType}_avg_price`] = point?.avg_price ?? null;
            next[`${tradeType}_contribution_amount`] = point?.contribution_amount ?? null;
        });

        return next;
    });

const initialSeriesState: Record<TradeSeriesKey, boolean> = {
    annual_volume_mwh: true,
    monthly_volume_mwh: true,
    within_month_volume_mwh: true,
    day_ahead_volume_mwh: true,
    annual_avg_price: true,
    monthly_avg_price: true,
    within_month_avg_price: true,
    day_ahead_avg_price: true,
    annual_contribution_amount: true,
    monthly_contribution_amount: true,
    within_month_contribution_amount: true,
    day_ahead_contribution_amount: true,
    spot_avg_price: true,
    actual_load_mwh: true,
    total_contribution_amount: true,
    exposed_amount: false,
};

interface MonthlyTradeReviewChartPanelProps {
    month: string;
    dailyView: MonthlyReviewDailyRow[];
    periodView: MonthlyReviewPeriodRow[];
    selectedTradeType: MonthlyTradeType;
}

export const MonthlyTradeReviewChartPanel: React.FC<MonthlyTradeReviewChartPanelProps> = ({
    month,
    dailyView,
    periodView,
    selectedTradeType,
}) => {
    const [mainTab, setMainTab] = useState<MainTab>('daily');
    const [dailyMode, setDailyMode] = useState<ViewMode>('price');
    const [periodMode, setPeriodMode] = useState<ViewMode>('price');
    const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
    const [seriesVisibility, setSeriesVisibility] = useState(initialSeriesState);
    const chartRef = useRef<HTMLDivElement>(null);

    const fullscreen = useChartFullscreen({
        chartRef,
        title: `月度交易复盘${mainTab === 'daily' ? ' - 日度视图' : ' - 48时段视图'}`,
    });

    const mode = mainTab === 'daily' ? dailyMode : periodMode;
    const rawRows = useMemo(
        () => (mainTab === 'daily' ? normalizeDailyRows(month, dailyView) : periodView),
        [dailyView, mainTab, month, periodView],
    );
    const rows = useMemo(
        () => flattenRows(rawRows, mainTab),
        [mainTab, rawRows],
    );
    const selectedRow = useMemo(
        () => rows.find((item) => String(item.key) === selectedRowKey) ?? null,
        [rows, selectedRowKey],
    );
    const selectedLabel = selectedRow?.label ?? undefined;

    const totals = useMemo(() => {
        const next: FlattenedRow = {
            key: 'total',
            label: '合计',
            actual_load_mwh: sumValue(rows, 'actual_load_mwh'),
            spot_avg_price: weightedAverage(rows, 'spot_avg_price', 'actual_load_mwh'),
            total_contribution_amount: sumValue(rows, 'total_contribution_amount'),
            exposed_amount: sumValue(rows, 'exposed_amount'),
        };

        ORDER.forEach((tradeType) => {
            next[`${tradeType}_volume_mwh`] = sumValue(rows, `${tradeType}_volume_mwh`);
            next[`${tradeType}_avg_price`] = weightedAverage(rows, `${tradeType}_avg_price`, `${tradeType}_volume_mwh`);
            next[`${tradeType}_contribution_amount`] = sumValue(rows, `${tradeType}_contribution_amount`);
        });

        return next;
    }, [rows]);

    const canShowTradeType = (tradeType: Exclude<MonthlyTradeType, 'all'>) => selectedTradeType === 'all' || selectedTradeType === tradeType;
    const canShowKey = (key: TradeSeriesKey) => {
        const tradeType = ORDER.find((item) => key.startsWith(`${item}_`));
        if (!tradeType) {
            return seriesVisibility[key];
        }
        return seriesVisibility[key] && canShowTradeType(tradeType);
    };

    const getTradeSeriesKeys = (tradeType: Exclude<MonthlyTradeType, 'all'>) => ([
        `${tradeType}_avg_price`,
        `${tradeType}_volume_mwh`,
        `${tradeType}_contribution_amount`,
    ] as TradeSeriesKey[]);

    const isTradeGroupChecked = (tradeType: Exclude<MonthlyTradeType, 'all'>) =>
        getTradeSeriesKeys(tradeType).every((key) => seriesVisibility[key]);

    const setTradeGroupVisible = (tradeType: Exclude<MonthlyTradeType, 'all'>, checked: boolean) => {
        setSeriesVisibility((prev) => {
            const next = { ...prev };
            getTradeSeriesKeys(tradeType).forEach((key) => {
                next[key] = checked;
            });
            return next;
        });
    };

    const setSingleSeriesVisible = (key: TradeSeriesKey, checked: boolean) => {
        setSeriesVisibility((prev) => ({ ...prev, [key]: checked }));
    };

    const tradeControlItems = ORDER.map((tradeType) => ({
        key: `${tradeType}-group`,
        label: LABELS[tradeType],
        color: COLORS[tradeType],
        checked: isTradeGroupChecked(tradeType),
        onChange: (checked: boolean) => setTradeGroupVisible(tradeType, checked),
    }));

    const controlItems = mode === 'amount'
        ? [
            ...tradeControlItems,
            { key: 'actual_load_mwh', label: '实际电量', color: ACTUAL_LOAD_FILL, checked: seriesVisibility.actual_load_mwh, onChange: (checked: boolean) => setSingleSeriesVisible('actual_load_mwh', checked) },
            { key: 'total_contribution_amount', label: '合计贡献值', color: TOTAL_CONTRIBUTION_COLOR, checked: seriesVisibility.total_contribution_amount, onChange: (checked: boolean) => setSingleSeriesVisible('total_contribution_amount', checked) },
            { key: 'exposed_amount', label: '风险暴露金额', color: EXPOSED_AMOUNT_COLOR, checked: seriesVisibility.exposed_amount, onChange: (checked: boolean) => setSingleSeriesVisible('exposed_amount', checked) },
        ]
        : [
            ...tradeControlItems,
            { key: 'actual_load_mwh', label: '实际电量', color: ACTUAL_LOAD_FILL, checked: seriesVisibility.actual_load_mwh, onChange: (checked: boolean) => setSingleSeriesVisible('actual_load_mwh', checked) },
            { key: 'spot_avg_price', label: '实时现货', color: SPOT_PRICE_COLOR, checked: seriesVisibility.spot_avg_price, onChange: (checked: boolean) => setSingleSeriesVisible('spot_avg_price', checked) },
        ];

    const renderSeriesSelector = () => (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
            {controlItems.map((item) => (
                <Box
                    key={item.key}
                    onClick={() => item.onChange(!item.checked)}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1,
                        py: 0.5,
                        borderRadius: 999,
                        border: `1px solid ${alpha(item.color, 0.24)}`,
                        bgcolor: alpha(item.color, 0.06),
                        cursor: 'pointer',
                    }}
                >
                    <Checkbox
                        checked={item.checked}
                        size="small"
                        sx={{ p: 0.25, color: item.color, '&.Mui-checked': { color: item.color } }}
                    />
                    <Typography variant="caption" sx={{ color: item.checked ? 'text.primary' : 'text.disabled' }}>
                        {item.label}
                    </Typography>
                </Box>
            ))}
        </Stack>
    );

    const getTradeCellSx = (tradeType: Exclude<MonthlyTradeType, 'all'>) => ({
        bgcolor: alpha(COLORS[tradeType], 0.16),
    });

    const headerCellSx = {
        position: 'sticky' as const,
        top: 0,
        bgcolor: '#f8fafc',
        zIndex: 6,
        backgroundImage: 'linear-gradient(180deg, #f8fafc 0%, #f8fafc 100%)',
        backgroundClip: 'padding-box',
        boxShadow: 'inset 0 -1px 0 rgba(148, 163, 184, 0.18)',
    };

    const renderTable = () => (
        <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
                maxHeight: CHART_HEIGHT,
                overflow: 'auto',
                position: 'relative',
                bgcolor: '#fff',
                '& .MuiTableCell-stickyHeader': headerCellSx,
            }}
        >
            <Table
                size="small"
                stickyHeader
                sx={{
                    borderCollapse: 'separate',
                    '& thead th': headerCellSx,
                }}
            >
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ ...headerCellSx, minWidth: mainTab === 'daily' ? 124 : 96 }}>{mainTab === 'daily' ? '日期' : '时段'}</TableCell>
                        <TableCell align="right" sx={headerCellSx}>实际电量</TableCell>
                        <TableCell align="right" sx={headerCellSx}>实时现货均价</TableCell>
                        {ORDER.map((key) => (
                            <React.Fragment key={key}>
                                <TableCell align="right" sx={{ ...headerCellSx, ...getTradeCellSx(key) }}>{LABELS[key]}电量</TableCell>
                                <TableCell align="right" sx={{ ...headerCellSx, ...getTradeCellSx(key) }}>{LABELS[key]}均价</TableCell>
                                <TableCell align="right" sx={{ ...headerCellSx, ...getTradeCellSx(key) }}>{LABELS[key]}贡献值</TableCell>
                            </React.Fragment>
                        ))}
                        <TableCell align="right" sx={headerCellSx}>合计贡献值</TableCell>
                        <TableCell align="right" sx={headerCellSx}>风险暴露金额</TableCell>
                        <TableCell align="center" sx={headerCellSx}>表现标签</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row) => (
                        <TableRow
                            key={String(row.key)}
                            hover
                            selected={selectedRowKey === String(row.key)}
                            onClick={() => setSelectedRowKey(String(row.key))}
                            sx={{ cursor: 'pointer' }}
                        >
                            <TableCell>{String(row.label)}</TableCell>
                            <TableCell align="right">{fmt(row.actual_load_mwh as number | null)}</TableCell>
                            <TableCell align="right">{fmt(row.spot_avg_price as number | null)}</TableCell>
                            {ORDER.map((key) => (
                                <React.Fragment key={key}>
                                    <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(row[`${key}_volume_mwh`] as number | null)}</TableCell>
                                    <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(row[`${key}_avg_price`] as number | null)}</TableCell>
                                    <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(row[`${key}_contribution_amount`] as number | null)}</TableCell>
                                </React.Fragment>
                            ))}
                            <TableCell align="right">{fmt(row.total_contribution_amount as number | null)}</TableCell>
                            <TableCell align="right">{fmt(row.exposed_amount as number | null)}</TableCell>
                            <TableCell align="center">
                                <Chip
                                    size="small"
                                    color={resolveContributionTone(row.total_contribution_amount as number | null).color}
                                    label={resolveContributionTone(row.total_contribution_amount as number | null).label}
                                    variant="outlined"
                                />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                <TableFooter>
                    <TableRow
                        sx={{
                            position: 'sticky',
                            bottom: 0,
                            zIndex: 3,
                            '& td': { fontWeight: 800, bgcolor: '#f8fafc', borderTop: '1px solid rgba(148, 163, 184, 0.22)' },
                        }}
                    >
                        <TableCell>合计</TableCell>
                        <TableCell align="right">{fmt(totals.actual_load_mwh as number | null)}</TableCell>
                        <TableCell align="right">{fmt(totals.spot_avg_price as number | null)}</TableCell>
                        {ORDER.map((key) => (
                            <React.Fragment key={key}>
                                <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(totals[`${key}_volume_mwh`] as number | null)}</TableCell>
                                <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(totals[`${key}_avg_price`] as number | null)}</TableCell>
                                <TableCell align="right" sx={getTradeCellSx(key)}>{fmt(totals[`${key}_contribution_amount`] as number | null)}</TableCell>
                            </React.Fragment>
                        ))}
                        <TableCell align="right">{fmt(totals.total_contribution_amount as number | null)}</TableCell>
                        <TableCell align="right">{fmt(totals.exposed_amount as number | null)}</TableCell>
                        <TableCell align="center">-</TableCell>
                    </TableRow>
                </TableFooter>
            </Table>
        </TableContainer>
    );

    const commonTooltip = (
        <Tooltip
            content={<MonthlyTradeReviewTooltip mode={mode} mainTab={mainTab} />}
            cursor={{ stroke: '#9e9e9e', strokeDasharray: '3 3' }}
            wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
        />
    );

    const renderChart = () => (
        <Box
            ref={chartRef}
            sx={{
                position: 'relative',
                height: CHART_HEIGHT,
                borderRadius: 3,
                bgcolor: fullscreen.isFullscreen ? '#fff' : 'transparent',
                overflow: 'visible',
                '& .recharts-surface:focus': { outline: 'none' },
                '& *:focus': { outline: 'none !important' },
                '& .recharts-tooltip-wrapper': { zIndex: '30 !important' },
            }}
        >
            <fullscreen.FullscreenEnterButton />
            <fullscreen.FullscreenExitButton />
            <fullscreen.FullscreenTitle />
            <Stack spacing={2} sx={{ height: '100%', pt: 1 }}>
                {selectedRow && (
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap" sx={{ px: 1 }}>
                        <Chip
                            size="small"
                            color="primary"
                            variant="outlined"
                            label={`当前定位：${mainTab === 'daily' ? `日期 ${selectedRow.label}` : `时段 ${selectedRow.label}`}`}
                        />
                        <Chip size="small" variant="outlined" label={`实际电量：${fmt(selectedRow.actual_load_mwh as number | null)} MWh`} />
                        <Chip size="small" variant="outlined" label={`现货均价：${fmt(selectedRow.spot_avg_price as number | null)} 元/MWh`} />
                        <Chip size="small" variant="outlined" label={`合计贡献值：${fmt(selectedRow.total_contribution_amount as number | null)} 元`} />
                    </Stack>
                )}

                <Box sx={{ height: '42%', minHeight: 0, position: 'relative', zIndex: 2 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            syncId={`monthly-review-${mainTab}`}
                            data={rows}
                            stackOffset="sign"
                            margin={{ top: 12, right: 16, left: 4, bottom: 8 }}
                            onClick={(state) => {
                                const activeLabel = state?.activeLabel;
                                if (activeLabel !== undefined && activeLabel !== null) {
                                    const matched = rows.find((item) => item.label === String(activeLabel));
                                    if (matched) {
                                        setSelectedRowKey(String(matched.key));
                                    }
                                }
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" />
                            <YAxis yAxisId="left" />
                            {commonTooltip}
                            {selectedLabel !== undefined && (
                                <ReferenceLine x={selectedLabel} stroke="#0f172a" strokeDasharray="4 4" strokeOpacity={0.45} />
                            )}
                            {mode === 'price' ? (
                                <>
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="spot_avg_price"
                                        stroke={SPOT_PRICE_COLOR}
                                        strokeWidth={1.5}
                                        dot={false}
                                        hide={!seriesVisibility.spot_avg_price}
                                        connectNulls={false}
                                    />
                                    {ORDER.map((key) => (
                                        <Line
                                            key={`${key}_avg_price`}
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey={`${key}_avg_price`}
                                            stroke={COLORS[key]}
                                            strokeWidth={1.5}
                                            dot={false}
                                            hide={!canShowKey(`${key}_avg_price` as TradeSeriesKey)}
                                            connectNulls={false}
                                        />
                                    ))}
                                </>
                            ) : (
                                <>
                                    {ORDER.map((key) => (
                                        <Bar
                                            key={`${key}_contribution_amount`}
                                            yAxisId="left"
                                            stackId="contribution"
                                            dataKey={`${key}_contribution_amount`}
                                            fill={alpha(COLORS[key], 0.72)}
                                            hide={!canShowKey(`${key}_contribution_amount` as TradeSeriesKey)}
                                        />
                                    ))}
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="total_contribution_amount"
                                        stroke={TOTAL_CONTRIBUTION_COLOR}
                                        strokeWidth={2.5}
                                        dot={false}
                                        hide={!seriesVisibility.total_contribution_amount}
                                        connectNulls={false}
                                    />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="exposed_amount"
                                        stroke={EXPOSED_AMOUNT_COLOR}
                                        strokeDasharray="6 3"
                                        strokeWidth={2}
                                        dot={false}
                                        hide={!seriesVisibility.exposed_amount}
                                        connectNulls={false}
                                    />
                                </>
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>

                <Box sx={{ height: '56%', minHeight: 0, position: 'relative', zIndex: 1 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            syncId={`monthly-review-${mainTab}`}
                            data={rows}
                            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                            onClick={(state) => {
                                const activeLabel = state?.activeLabel;
                                if (activeLabel !== undefined && activeLabel !== null) {
                                    const matched = rows.find((item) => item.label === String(activeLabel));
                                    if (matched) {
                                        setSelectedRowKey(String(matched.key));
                                    }
                                }
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" />
                            <YAxis yAxisId="left" />
                            <Tooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
                            {selectedLabel !== undefined && (
                                <ReferenceLine x={selectedLabel} stroke="#0f172a" strokeDasharray="4 4" strokeOpacity={0.45} />
                            )}
                            <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="actual_load_mwh"
                                stroke={ACTUAL_LOAD_STROKE}
                                fill={ACTUAL_LOAD_FILL}
                                fillOpacity={0.25}
                                hide={!seriesVisibility.actual_load_mwh}
                                connectNulls={false}
                            />
                            {ORDER.map((key) => (
                                <Bar
                                    key={`${key}_volume_mwh`}
                                    yAxisId="left"
                                    stackId="volume"
                                    dataKey={`${key}_volume_mwh`}
                                    fill={COLORS[key]}
                                    hide={!canShowKey(`${key}_volume_mwh` as TradeSeriesKey)}
                                />
                            ))}
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            </Stack>
        </Box>
    );

    return (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'visible' }}>
            <Box sx={{ px: 2, pt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Tabs value={mainTab} onChange={(_, value) => setMainTab(value)}>
                    <Tab value="daily" label="日度" />
                    <Tab value="period" label="48时段" />
                </Tabs>
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={mode}
                    onChange={(_, value) => {
                        if (!value) return;
                        if (mainTab === 'daily') setDailyMode(value);
                        else setPeriodMode(value);
                    }}
                >
                    <ToggleButton value="price">价格</ToggleButton>
                    <ToggleButton value="amount">金额</ToggleButton>
                    <ToggleButton value="table">表格</ToggleButton>
                </ToggleButtonGroup>
            </Box>
            <Divider sx={{ mt: 1.5 }} />
            <Box sx={{ p: 2 }}>
                <Stack spacing={2}>
                    {mode !== 'table' && renderSeriesSelector()}
                    {mode === 'table' ? renderTable() : renderChart()}
                    <Typography variant="caption" sx={{ color: '#64748b' }}>
                        日度视图默认补齐整月日期；无数据日期保留为空，便于对照整月走势与缺口位置。
                    </Typography>
                </Stack>
            </Box>
        </Paper>
    );
};
