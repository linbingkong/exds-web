import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    ButtonGroup,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    Typography,
    alpha,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import InsightsIcon from '@mui/icons-material/Insights';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    addDays,
    endOfMonth,
    endOfYear,
    format,
    startOfMonth,
    startOfYear,
    subDays,
    subMonths,
    subYears,
} from 'date-fns';
import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    FreqCompFeeRecord,
    FreqCompMonthlySummaryItem,
    FreqCompPlantTrendResponse,
    FreqDailyResponse,
    FreqMonthlyResponse,
    FreqRangeResponse,
    freqRegulationApi,
} from '../api/freqRegulation';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

type TabPanelProps = {
    children: React.ReactNode;
    index: number;
    value: number;
};

type KpiCardProps = {
    label: string;
    value: number | string | null | undefined;
    unit?: string;
    accent?: string;
    icon?: React.ReactNode;
};

type ChartPanelProps = {
    title: string;
    children: React.ReactNode;
    height?: number | { xs: number; sm: number };
};

const daColor = '#1f77b4';
const idColor = '#d62728';
const demandColor = '#2ca02c';
const resourceColor = '#ff7f0e';

function TabPanel({ children, value, index }: TabPanelProps) {
    return (
        <Box
            role="tabpanel"
            sx={{
                display: value === index ? 'flex' : 'none',
                flexDirection: 'column',
                flex: { xs: 'none', md: '1 1 0' },
                minHeight: 0,
                overflowY: 'auto',
                pt: 2,
            }}
        >
            {value === index && children}
        </Box>
    );
}

function formatNumber(value: number | string | null | undefined, digits = 2): string {
    if (value === null || value === undefined || value === '') {
        return '--';
    }
    if (typeof value === 'string') {
        return value;
    }
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(digits);
}

function formatTooltipValue(value: any): string {
    if (value === null || value === undefined) {
        return '--';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
    }
    return String(value);
}

function KpiCard({ label, value, unit, accent = daColor, icon }: KpiCardProps) {
    return (
        <Paper
            variant="outlined"
            sx={(theme) => ({
                p: { xs: 1.5, sm: 2 },
                minHeight: 96,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 2,
                border: '1px solid',
                borderColor: alpha(accent, 0.2),
                background: `linear-gradient(135deg, ${alpha(accent, 0.03)} 0%, ${alpha(accent, 0.07)} 100%)`,
                boxShadow: 'none',
                overflow: 'hidden',
                minWidth: 0,
                '& .freq-kpi-icon': {
                    color: accent,
                },
                '& .freq-kpi-value': {
                    color: theme.palette.text.primary,
                },
            })}
        >
            {icon && (
                <Box className="freq-kpi-icon" sx={{ fontSize: { xs: 30, sm: 38 }, mr: { xs: 1, sm: 1.5 }, display: 'flex', alignItems: 'center' }}>
                    {icon}
                </Box>
            )}
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" noWrap>
                    {label}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                    <Typography
                        className="freq-kpi-value"
                        variant="h6"
                        component="div"
                        fontWeight="bold"
                        noWrap
                        sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}
                    >
                        {formatNumber(value)}
                    </Typography>
                    {unit && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {unit}
                        </Typography>
                    )}
                </Box>
            </Box>
        </Paper>
    );
}

function LoadingOverlay({ visible }: { visible: boolean }) {
    if (!visible) return null;
    return (
        <Box
            sx={{
                position: 'absolute',
                inset: 0,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.7)',
            }}
        >
            <CircularProgress size={28} />
        </Box>
    );
}

function ChartPanel({ title, children, height = { xs: 320, sm: 360 } }: ChartPanelProps) {
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title,
    });

    return (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                {title}
            </Typography>
            <Box
                ref={chartRef}
                sx={{
                    height: isFullscreen ? '100vh' : height,
                    width: '100%',
                    position: isFullscreen ? 'fixed' : 'relative',
                    top: isFullscreen ? 0 : 'auto',
                    left: isFullscreen ? 0 : 'auto',
                    zIndex: isFullscreen ? 1400 : 'auto',
                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                    p: isFullscreen ? 2 : 0,
                    '& .recharts-surface:focus': { outline: 'none' },
                    '& *:focus': { outline: 'none !important' },
                }}
            >
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />
                {children}
            </Box>
        </Paper>
    );
}

function EmptyState({ text = '暂无数据' }: { text?: string }) {
    return (
        <Box sx={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary">
                {text}
            </Typography>
        </Box>
    );
}

function DailyCurveTab() {
    const [date, setDate] = useState<Date | null>(subDays(new Date(), 1));
    const [data, setData] = useState<FreqDailyResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        if (!date) return;
        setLoading(true);
        setError(null);
        try {
            const response = await freqRegulationApi.fetchDaily(format(date, 'yyyy-MM-dd'));
            setData(response.data);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '获取调频市场日曲线失败');
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const points = data?.points || [];
    const hasData = points.length > 0;

    return (
        <Box sx={{ position: 'relative' }}>
            {loading && !data ? (
                <Box sx={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : (
                <>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <LoadingOverlay visible={loading && !!data} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <IconButton disabled={loading || !date} onClick={() => date && setDate(addDays(date, -1))}>
                                <ArrowLeftIcon />
                            </IconButton>
                            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
                                <DatePicker
                                    label="日期"
                                    value={date}
                                    onChange={(value) => setDate(value)}
                                    disabled={loading}
                                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                />
                            </LocalizationProvider>
                            <IconButton disabled={loading || !date} onClick={() => date && setDate(addDays(date, 1))}>
                                <ArrowRightIcon />
                            </IconButton>
                        </Stack>
                        <Button variant="outlined" startIcon={<CalendarMonthIcon />} disabled={loading} onClick={() => setDate(subDays(new Date(), 1))}>
                            昨日
                        </Button>
                    </Stack>

                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: { xs: 1.5, sm: 2 },
                            mb: 2,
                        }}
                    >
                        <KpiCard label="日前均出清价格" value={data?.kpis.day_ahead_avg_clearing_price} unit="¥/MWh" accent={daColor} icon={<QueryStatsIcon fontSize="inherit" />} />
                        <KpiCard label="日内均出清价格" value={data?.kpis.intraday_avg_clearing_price} unit="¥/MWh" accent={idColor} icon={<QueryStatsIcon fontSize="inherit" />} />
                        <KpiCard label="日前-日内价差" value={data?.kpis.spread_avg_clearing_price} unit="¥/MWh" accent="#455a64" icon={<InsightsIcon fontSize="inherit" />} />
                        <KpiCard label="日前均需求" value={data?.kpis.day_ahead_avg_demand_mw} unit="MW" accent={demandColor} icon={<CalendarMonthIcon fontSize="inherit" />} />
                        <KpiCard label="日内均需求" value={data?.kpis.intraday_avg_demand_mw} unit="MW" accent={resourceColor} icon={<CalendarMonthIcon fontSize="inherit" />} />
                    </Box>

                    {!hasData ? (
                        <EmptyState text="当前日期暂无调频市场数据" />
                    ) : (
                        <Grid container spacing={{ xs: 1.5, sm: 2 }}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="出清价格 (¥/MWh)">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={points} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前" type="monotone" dataKey="day_ahead_clearing_price" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内" type="monotone" dataKey="intraday_clearing_price" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="需求容量 (MW)">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={points} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前" type="monotone" dataKey="day_ahead_demand_mw" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内" type="monotone" dataKey="intraday_demand_mw" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="平均报价 (¥/MWh)">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={points} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前" type="monotone" dataKey="day_ahead_avg_bid_price" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内" type="monotone" dataKey="intraday_avg_bid_price" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="中标资源数 (个)">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={points} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis allowDecimals={false} />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前" type="monotone" dataKey="day_ahead_winning_resource_count" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内" type="monotone" dataKey="intraday_winning_resource_count" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                        </Grid>
                    )}
                </>
            )}
        </Box>
    );
}

function RangeAnalysisTab() {
    const [startDate, setStartDate] = useState<Date | null>(startOfMonth(new Date()));
    const [endDate, setEndDate] = useState<Date | null>(new Date());
    const [dayAheadData, setDayAheadData] = useState<FreqRangeResponse | null>(null);
    const [intradayData, setIntradayData] = useState<FreqRangeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyDatePreset = (preset: 'thisMonth' | 'lastMonth' | 'last30' | 'last60' | 'last90') => {
        const today = new Date();
        if (preset === 'thisMonth') {
            setStartDate(startOfMonth(today));
            setEndDate(today);
        } else if (preset === 'lastMonth') {
            const lastMonth = subMonths(today, 1);
            setStartDate(startOfMonth(lastMonth));
            setEndDate(endOfMonth(lastMonth));
        } else {
            const days = preset === 'last30' ? 30 : preset === 'last60' ? 60 : 90;
            setStartDate(subDays(today, days - 1));
            setEndDate(today);
        }
    };

    const loadData = useCallback(async () => {
        if (!startDate || !endDate) return;
        setLoading(true);
        setError(null);
        try {
            const params = {
                start_date: format(startDate, 'yyyy-MM-dd'),
                end_date: format(endDate, 'yyyy-MM-dd'),
            };
            const [dayAheadResponse, intradayResponse] = await Promise.all([
                freqRegulationApi.fetchRange({ ...params, market_type: 'day_ahead' }),
                freqRegulationApi.fetchRange({ ...params, market_type: 'intraday' }),
            ]);
            setDayAheadData(dayAheadResponse.data);
            setIntradayData(intradayResponse.data);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '获取调频市场区间分析失败');
        } finally {
            setLoading(false);
        }
    }, [endDate, startDate]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const hourlyStats = useMemo(() => {
        const byTime = new Map<string, any>();
        (dayAheadData?.hourly_stats || []).forEach((row) => {
            byTime.set(row.time, {
                ...(byTime.get(row.time) || {}),
                time: row.time,
                day_ahead_avg_clearing_price: row.avg_clearing_price,
                day_ahead_clearing_base: row.clearing_price_lower,
                day_ahead_clearing_band:
                    row.clearing_price_lower !== null && row.clearing_price_upper !== null
                        ? row.clearing_price_upper - row.clearing_price_lower
                        : null,
                day_ahead_avg_demand_mw: row.avg_demand_mw,
                day_ahead_demand_base: row.demand_mw_lower,
                day_ahead_demand_band:
                    row.demand_mw_lower !== null && row.demand_mw_upper !== null
                        ? row.demand_mw_upper - row.demand_mw_lower
                        : null,
            });
        });
        (intradayData?.hourly_stats || []).forEach((row) => {
            byTime.set(row.time, {
                ...(byTime.get(row.time) || {}),
                time: row.time,
                intraday_avg_clearing_price: row.avg_clearing_price,
                intraday_clearing_base: row.clearing_price_lower,
                intraday_clearing_band:
                    row.clearing_price_lower !== null && row.clearing_price_upper !== null
                        ? row.clearing_price_upper - row.clearing_price_lower
                        : null,
                intraday_avg_demand_mw: row.avg_demand_mw,
                intraday_demand_base: row.demand_mw_lower,
                intraday_demand_band:
                    row.demand_mw_lower !== null && row.demand_mw_upper !== null
                        ? row.demand_mw_upper - row.demand_mw_lower
                        : null,
            });
        });
        return Array.from(byTime.values()).sort((a, b) => a.time.localeCompare(b.time));
    }, [dayAheadData, intradayData]);

    const dailyTrends = useMemo(() => {
        const byDate = new Map<string, any>();
        (dayAheadData?.daily_trends || []).forEach((row) => {
            byDate.set(row.date, {
                ...(byDate.get(row.date) || {}),
                date: row.date,
                day_ahead_avg_clearing_price: row.avg_clearing_price,
                day_ahead_avg_demand_mw: row.avg_demand_mw,
            });
        });
        (intradayData?.daily_trends || []).forEach((row) => {
            byDate.set(row.date, {
                ...(byDate.get(row.date) || {}),
                date: row.date,
                intraday_avg_clearing_price: row.avg_clearing_price,
                intraday_avg_demand_mw: row.avg_demand_mw,
            });
        });
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [dayAheadData, intradayData]);

    const hasLoadedData = !!dayAheadData || !!intradayData;

    return (
        <Box sx={{ position: 'relative' }}>
            {loading && !hasLoadedData ? (
                <Box sx={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : (
                <>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <LoadingOverlay visible={loading && hasLoadedData} />
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2 }}>
                        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexShrink: 0 }}>
                                <DatePicker
                                    label="开始日期"
                                    value={startDate}
                                    onChange={(value) => setStartDate(value)}
                                    disabled={loading}
                                    slotProps={{ textField: { size: 'small', fullWidth: true, sx: { minWidth: { sm: 160 } } } }}
                                />
                                <DatePicker
                                    label="结束日期"
                                    value={endDate}
                                    onChange={(value) => setEndDate(value)}
                                    disabled={loading}
                                    slotProps={{ textField: { size: 'small', fullWidth: true, sx: { minWidth: { sm: 160 } } } }}
                                />
                            </Stack>
                        </LocalizationProvider>
                        <ButtonGroup variant="outlined" size="small" sx={{ flexWrap: 'wrap', alignSelf: { xs: 'stretch', md: 'center' } }}>
                            <Button disabled={loading} onClick={() => applyDatePreset('thisMonth')}>本月</Button>
                            <Button disabled={loading} onClick={() => applyDatePreset('lastMonth')}>上月</Button>
                            <Button disabled={loading} onClick={() => applyDatePreset('last30')}>近30天</Button>
                            <Button disabled={loading} onClick={() => applyDatePreset('last60')}>近60天</Button>
                            <Button disabled={loading} onClick={() => applyDatePreset('last90')}>近90天</Button>
                        </ButtonGroup>
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                        <InsightsIcon color="primary" fontSize="small" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            日平均曲线
                        </Typography>
                    </Stack>
                    {hourlyStats.length === 0 ? (
                        <EmptyState text="当前区间暂无调频市场数据" />
                    ) : (
                        <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ mb: 2 }}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="平均出清价格 ± std">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={hourlyStats} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Area dataKey="day_ahead_clearing_base" stackId="daPriceStd" stroke="none" fill="transparent" legendType="none" />
                                            <Area name="日前 ±std" dataKey="day_ahead_clearing_band" stackId="daPriceStd" stroke="none" fill={daColor} fillOpacity={0.15} />
                                            <Area dataKey="intraday_clearing_base" stackId="idPriceStd" stroke="none" fill="transparent" legendType="none" />
                                            <Area name="日内 ±std" dataKey="intraday_clearing_band" stackId="idPriceStd" stroke="none" fill={idColor} fillOpacity={0.12} />
                                            <Line name="日前均值" type="monotone" dataKey="day_ahead_avg_clearing_price" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内均值" type="monotone" dataKey="intraday_avg_clearing_price" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="平均需求容量 ± std">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={hourlyStats} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Area dataKey="day_ahead_demand_base" stackId="daDemandStd" stroke="none" fill="transparent" legendType="none" />
                                            <Area name="日前 ±std" dataKey="day_ahead_demand_band" stackId="daDemandStd" stroke="none" fill={daColor} fillOpacity={0.15} />
                                            <Area dataKey="intraday_demand_base" stackId="idDemandStd" stroke="none" fill="transparent" legendType="none" />
                                            <Area name="日内 ±std" dataKey="intraday_demand_band" stackId="idDemandStd" stroke="none" fill={idColor} fillOpacity={0.12} />
                                            <Line name="日前均值" type="monotone" dataKey="day_ahead_avg_demand_mw" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内均值" type="monotone" dataKey="intraday_avg_demand_mw" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                        </Grid>
                    )}

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                        <QueryStatsIcon color="primary" fontSize="small" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            日度趋势
                        </Typography>
                    </Stack>
                    {dailyTrends.length === 0 ? (
                        <EmptyState text="当前区间暂无日度趋势数据" />
                    ) : (
                        <Grid container spacing={{ xs: 1.5, sm: 2 }}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="日均出清价格走势">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={dailyTrends} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" minTickGap={24} />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前日均出清价格" type="monotone" dataKey="day_ahead_avg_clearing_price" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内日均出清价格" type="monotone" dataKey="intraday_avg_clearing_price" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <ChartPanel title="日均需求容量走势">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={dailyTrends} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" minTickGap={24} />
                                            <YAxis />
                                            <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                            <Legend />
                                            <Line name="日前日均需求容量" type="monotone" dataKey="day_ahead_avg_demand_mw" stroke={daColor} strokeWidth={2} dot={false} connectNulls />
                                            <Line name="日内日均需求容量" type="monotone" dataKey="intraday_avg_demand_mw" stroke={idColor} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </ChartPanel>
                            </Grid>
                        </Grid>
                    )}
                </>
            )}
        </Box>
    );
}

function MonthlyTrendTab() {
    const [startMonth, setStartMonth] = useState<Date | null>(startOfYear(new Date()));
    const [endMonth, setEndMonth] = useState<Date | null>(new Date());
    const [data, setData] = useState<FreqMonthlyResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyMonthPreset = (preset: 'thisYear' | 'lastYear' | 'last12' | 'last24' | 'last36') => {
        const today = new Date();
        if (preset === 'thisYear') {
            setStartMonth(startOfYear(today));
            setEndMonth(today);
        } else if (preset === 'lastYear') {
            const lastYear = subYears(today, 1);
            setStartMonth(startOfYear(lastYear));
            setEndMonth(endOfYear(lastYear));
        } else {
            const months = preset === 'last12' ? 12 : preset === 'last24' ? 24 : 36;
            setStartMonth(startOfMonth(subMonths(today, months - 1)));
            setEndMonth(today);
        }
    };

    const loadData = useCallback(async () => {
        if (!startMonth || !endMonth) return;
        setLoading(true);
        setError(null);
        try {
            const response = await freqRegulationApi.fetchMonthly({
                start_month: format(startMonth, 'yyyy-MM'),
                end_month: format(endMonth, 'yyyy-MM'),
            });
            setData(response.data);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '获取调频市场月度趋势失败');
        } finally {
            setLoading(false);
        }
    }, [endMonth, startMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const rows = data?.rows || [];

    return (
        <Box sx={{ position: 'relative' }}>
            {loading && !data ? (
                <Box sx={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : (
                <>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <LoadingOverlay visible={loading && !!data} />
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2 }}>
                        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexShrink: 0 }}>
                                <DatePicker
                                    label="开始月份"
                                    views={['year', 'month']}
                                    value={startMonth}
                                    onChange={(value) => setStartMonth(value)}
                                    disabled={loading}
                                    slotProps={{ textField: { size: 'small', fullWidth: true, sx: { minWidth: { sm: 160 } } } }}
                                />
                                <DatePicker
                                    label="结束月份"
                                    views={['year', 'month']}
                                    value={endMonth}
                                    onChange={(value) => setEndMonth(value)}
                                    disabled={loading}
                                    slotProps={{ textField: { size: 'small', fullWidth: true, sx: { minWidth: { sm: 160 } } } }}
                                />
                            </Stack>
                        </LocalizationProvider>
                        <ButtonGroup variant="outlined" size="small" sx={{ flexWrap: 'wrap', alignSelf: { xs: 'stretch', md: 'center' } }}>
                            <Button disabled={loading} onClick={() => applyMonthPreset('thisYear')}>今年</Button>
                            <Button disabled={loading} onClick={() => applyMonthPreset('lastYear')}>去年</Button>
                            <Button disabled={loading} onClick={() => applyMonthPreset('last12')}>近12个月</Button>
                            <Button disabled={loading} onClick={() => applyMonthPreset('last24')}>近24个月</Button>
                            <Button disabled={loading} onClick={() => applyMonthPreset('last36')}>近36个月</Button>
                        </ButtonGroup>
                    </Stack>

                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: { xs: 1.5, sm: 2 },
                            mb: 2,
                        }}
                    >
                        <KpiCard label="日前期间均价" value={data?.kpis.day_ahead_period_avg_price} unit="¥/MWh" accent={daColor} icon={<QueryStatsIcon fontSize="inherit" />} />
                        <KpiCard label="日内期间均价" value={data?.kpis.intraday_period_avg_price} unit="¥/MWh" accent={idColor} icon={<QueryStatsIcon fontSize="inherit" />} />
                        <KpiCard label="月均日前-日内价差" value={data?.kpis.spread_monthly_avg_price} unit="¥/MWh" accent="#455a64" icon={<InsightsIcon fontSize="inherit" />} />
                        <KpiCard label="最高价月份" value={data?.kpis.highest_price_month} accent={resourceColor} icon={<CalendarMonthIcon fontSize="inherit" />} />
                        <KpiCard label="最低价月份" value={data?.kpis.lowest_price_month} accent={demandColor} icon={<CalendarMonthIcon fontSize="inherit" />} />
                    </Box>

                    {rows.length === 0 ? (
                        <EmptyState text="当前月份范围暂无调频市场数据" />
                    ) : (
                        <Stack spacing={2}>
                            <ChartPanel title="月均出清价格组合图" height={{ xs: 360, sm: 420 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={rows} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="month" />
                                        <YAxis yAxisId="price" />
                                        <YAxis yAxisId="spread" orientation="right" />
                                        <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                        <Legend />
                                        <Bar yAxisId="price" name="日前均价" dataKey="day_ahead_avg_clearing_price" fill={daColor} maxBarSize={36} />
                                        <Bar yAxisId="price" name="日内均价" dataKey="intraday_avg_clearing_price" fill={idColor} maxBarSize={36} />
                                        <Line yAxisId="spread" name="价差" type="monotone" dataKey="spread_avg_clearing_price" stroke="#455a64" strokeWidth={2} dot={false} connectNulls />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </ChartPanel>

                            <Grid container spacing={{ xs: 1.5, sm: 2 }}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <ChartPanel title="月均需求容量">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={rows} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="month" />
                                                <YAxis />
                                                <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                                <Legend />
                                                <Bar name="日前需求" dataKey="day_ahead_avg_demand_mw" fill={daColor} maxBarSize={32} />
                                                <Bar name="日内需求" dataKey="intraday_avg_demand_mw" fill={idColor} maxBarSize={32} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </ChartPanel>
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <ChartPanel title="月均平均报价">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={rows} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="month" />
                                                <YAxis />
                                                <Tooltip formatter={(value: any) => formatTooltipValue(value)} />
                                                <Legend />
                                                <Bar name="日前报价" dataKey="day_ahead_avg_bid_price" fill={daColor} maxBarSize={32} />
                                                <Bar name="日内报价" dataKey="intraday_avg_bid_price" fill={idColor} maxBarSize={32} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </ChartPanel>
                                </Grid>
                            </Grid>

                            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                                    月度汇总表
                                </Typography>
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                    <Table
                                        size="small"
                                        sx={{
                                            minWidth: 900,
                                            '& .MuiTableCell-root': {
                                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                px: { xs: 0.75, sm: 1.5 },
                                            },
                                        }}
                                    >
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>月份</TableCell>
                                                <TableCell align="right">日前均价</TableCell>
                                                <TableCell align="right">日内均价</TableCell>
                                                <TableCell align="right">价差</TableCell>
                                                <TableCell align="right">日前需求</TableCell>
                                                <TableCell align="right">日内需求</TableCell>
                                                <TableCell align="right">日前报价</TableCell>
                                                <TableCell align="right">日内报价</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {rows.map((row) => (
                                                <TableRow key={row.month} hover>
                                                    <TableCell>{row.month}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.day_ahead_avg_clearing_price)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.intraday_avg_clearing_price)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.spread_avg_clearing_price)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.day_ahead_avg_demand_mw)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.intraday_avg_demand_mw)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.day_ahead_avg_bid_price)}</TableCell>
                                                    <TableCell align="right">{formatNumber(row.intraday_avg_bid_price)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Paper>
                        </Stack>
                    )}
                </>
            )}
        </Box>
    );
}

const compColor = '#2ca02c';

function formatMonthLabel(month: string): string {
    return `${month.slice(0, 4)}-${month.slice(4, 6)}`;
}

function CompensationAnalysisTab() {
    const [summaryData, setSummaryData] = useState<FreqCompMonthlySummaryItem[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [monthRecords, setMonthRecords] = useState<FreqCompFeeRecord[]>([]);
    const [selectedPlant, setSelectedPlant] = useState<string>('');
    const [plantTrend, setPlantTrend] = useState<FreqCompPlantTrendResponse | null>(null);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [loadingMonth, setLoadingMonth] = useState(false);
    const [loadingPlant, setLoadingPlant] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoadingSummary(true);
        freqRegulationApi
            .fetchFreqCompMonthlySummary()
            .then((res) => {
                const months = res.data.months;
                setSummaryData(months);
                if (months.length > 0) {
                    setSelectedMonth(months[months.length - 1].month);
                }
            })
            .catch((err) => setError(err.response?.data?.detail || '获取月度汇总数据失败'))
            .finally(() => setLoadingSummary(false));
    }, []);

    useEffect(() => {
        if (!selectedMonth) return;
        setLoadingMonth(true);
        freqRegulationApi
            .fetchFreqCompFeeMonth(selectedMonth)
            .then((res) => {
                const filtered = res.data.records
                    .filter((r) => r.compensation_fee > 0)
                    .sort((a, b) => b.compensation_fee - a.compensation_fee);
                setMonthRecords(filtered);
                if (filtered.length > 0) {
                    setSelectedPlant(filtered[0].plant_name);
                } else {
                    setSelectedPlant('');
                    setPlantTrend(null);
                }
            })
            .catch((err) => setError(err.response?.data?.detail || '获取月度电厂数据失败'))
            .finally(() => setLoadingMonth(false));
    }, [selectedMonth]);

    useEffect(() => {
        if (!selectedPlant) return;
        setLoadingPlant(true);
        freqRegulationApi
            .fetchFreqCompPlantTrend({ plant_name: selectedPlant, months: 12 })
            .then((res) => setPlantTrend(res.data))
            .catch((err) => setError(err.response?.data?.detail || '获取电厂趋势数据失败'))
            .finally(() => setLoadingPlant(false));
    }, [selectedPlant]);

    const currentMonthSummary = summaryData.find((m) => m.month === selectedMonth);
    const monthsDesc = [...summaryData].reverse();
    const totalFee = summaryData.reduce((sum, m) => sum + m.total_compensation_fee, 0);
    const avgFee = summaryData.length > 0 ? totalFee / summaryData.length : 0;

    const renderPlantTick = useCallback(
        (props: any) => {
            const { x, y, payload } = props;
            const isSelected = payload.value === selectedPlant;
            const raw: string = payload.value ?? '';
            const label = raw.length > 8 ? raw.slice(0, 8) + '…' : raw;
            return (
                <text
                    x={x}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize={12}
                    fill={isSelected ? '#d62728' : '#555'}
                    style={{ cursor: 'pointer', userSelect: 'none' } as React.CSSProperties}
                    onClick={() => setSelectedPlant(payload.value)}
                >
                    {label}
                </text>
            );
        },
        [selectedPlant]
    );

    if (loadingSummary) {
        return (
            <Box sx={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 0',
                minHeight: 0,
                gap: { xs: 1.5, sm: 2 },
            }}
        >
            {error && (
                <Alert severity="error" onClose={() => setError(null)} sx={{ flexShrink: 0 }}>
                    {error}
                </Alert>
            )}

            {/* 区域1：全市场月度趋势 */}
            <Paper
                variant="outlined"
                sx={{
                    p: { xs: 1.5, sm: 2 },
                    height: { xs: 240, sm: 260 },
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    '& .recharts-surface:focus': { outline: 'none' },
                    '& *:focus': { outline: 'none !important' },
                }}
            >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexShrink: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        全市场月度补偿费用趋势（点击柱体切换月份）
                    </Typography>
                    <Stack direction="row" spacing={{ xs: 1.5, sm: 2.5 }} sx={{ flexShrink: 0, ml: 1.5 }}>
                        <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="caption" color="text.secondary" display="block">累计补偿</Typography>
                            <Typography variant="body2" fontWeight="bold" sx={{ color: compColor }}>
                                {formatNumber(totalFee)} 万元
                            </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="caption" color="text.secondary" display="block">月均</Typography>
                            <Typography variant="body2" fontWeight="bold">
                                {formatNumber(avgFee)} 万元
                            </Typography>
                        </Box>
                    </Stack>
                </Stack>
                <Box sx={{ flex: '1 1 0', minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={summaryData} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" tickFormatter={formatMonthLabel} />
                            <YAxis yAxisId="fee" tickFormatter={(v) => `${v}`} />
                            <YAxis yAxisId="count" orientation="right" allowDecimals={false} />
                            <Tooltip
                                formatter={(value: any, name: string) => [formatTooltipValue(value), name]}
                                labelFormatter={formatMonthLabel}
                            />
                            <Legend />
                            <Bar
                                yAxisId="fee"
                                dataKey="total_compensation_fee"
                                name="总补偿费用（万元）"
                                maxBarSize={40}
                                cursor="pointer"
                                onClick={(data: any) => data?.month && setSelectedMonth(data.month)}
                            >
                                {summaryData.map((entry) => (
                                    <Cell
                                        key={entry.month}
                                        fill={entry.month === selectedMonth ? '#d62728' : compColor}
                                    />
                                ))}
                            </Bar>
                            <Line
                                yAxisId="count"
                                type="monotone"
                                dataKey="winning_plant_count"
                                name="获益电厂数（家）"
                                stroke={daColor}
                                strokeWidth={2}
                                dot={{ r: 4 }}
                                connectNulls
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>

            {/* 区域2：左右分栏 */}
            <Box
                sx={{
                    flex: '1 1 0',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    gap: { xs: 1.5, sm: 2 },
                }}
            >
                {/* 区域2a：单月电厂分布 */}
                <Box
                    sx={{
                        flex: { xs: 'none', md: '0 0 42%' },
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Paper
                        variant="outlined"
                        sx={{
                            p: { xs: 1.5, sm: 2 },
                            flex: { xs: 'none', md: 1 },
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: { xs: 260, md: 0 },
                            '& *:focus': { outline: 'none !important' },
                        }}
                    >
                        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5, flexShrink: 0 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, flexShrink: 0 }}>
                                电厂补偿分布
                            </Typography>
                            <FormControl size="small" sx={{ minWidth: 110 }}>
                                <InputLabel>月份</InputLabel>
                                <Select
                                    label="月份"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    disabled={loadingMonth}
                                >
                                    {monthsDesc.map((m) => (
                                        <MenuItem key={m.month} value={m.month}>
                                            {formatMonthLabel(m.month)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                        <Box sx={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
                            {loadingMonth ? (
                                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <CircularProgress size={24} />
                                </Box>
                            ) : monthRecords.length === 0 ? (
                                <EmptyState text="当月暂无获益电厂数据" />
                            ) : (
                                <Box sx={{ height: Math.max(200, monthRecords.length * 26 + 40) }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            layout="vertical"
                                            data={monthRecords}
                                            margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                            <XAxis type="number" tick={{ fontSize: 12 }} />
                                            <YAxis
                                                type="category"
                                                dataKey="plant_name"
                                                width={130}
                                                tick={renderPlantTick}
                                            />
                                            <Tooltip
                                                formatter={(value: any) => [
                                                    `${formatTooltipValue(value)} 万元`,
                                                    '补偿费用',
                                                ]}
                                            />
                                            <Bar
                                                dataKey="compensation_fee"
                                                name="补偿费用（万元）"
                                                maxBarSize={18}
                                                cursor="pointer"
                                                onClick={(data: any) =>
                                                    data?.plant_name && setSelectedPlant(data.plant_name)
                                                }
                                            >
                                                {monthRecords.map((entry) => (
                                                    <Cell
                                                        key={entry.plant_name}
                                                        fill={
                                                            entry.plant_name === selectedPlant
                                                                ? '#d62728'
                                                                : compColor
                                                        }
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Box>
                            )}
                        </Box>
                    </Paper>
                </Box>

                {/* 区域2b：电厂近12月趋势 */}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Paper
                        variant="outlined"
                        sx={{
                            p: { xs: 1.5, sm: 2 },
                            flex: { xs: 'none', md: 1 },
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: { xs: 320, md: 0 },
                            '& .recharts-surface:focus': { outline: 'none' },
                            '& *:focus': { outline: 'none !important' },
                        }}
                    >
                        {!selectedPlant ? (
                            <EmptyState text="请从左侧选择电厂" />
                        ) : (
                            <>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, flexShrink: 0 }}>
                                    {selectedPlant} · 近12月补偿趋势
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                        gap: { xs: 1, sm: 1.5 },
                                        mb: { xs: 1.5, sm: 2 },
                                        flexShrink: 0,
                                    }}
                                >
                                    <KpiCard
                                        label="当月市场总补偿"
                                        value={currentMonthSummary?.total_compensation_fee ?? null}
                                        unit="万元"
                                        accent={compColor}
                                    />
                                    <KpiCard
                                        label="当月获益电厂数"
                                        value={currentMonthSummary?.winning_plant_count ?? null}
                                        unit="家"
                                        accent={daColor}
                                    />
                                    <KpiCard
                                        label="近12月总补偿收益"
                                        value={plantTrend?.stats.total_compensation_fee ?? null}
                                        unit="万元"
                                        accent="#d62728"
                                    />
                                    <KpiCard
                                        label="近12月获益月数"
                                        value={
                                            plantTrend
                                                ? `${plantTrend.stats.winning_months}/${plantTrend.stats.total_months}`
                                                : null
                                        }
                                        accent={resourceColor}
                                    />
                                </Box>
                                {loadingPlant ? (
                                    <Box sx={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : !plantTrend ? (
                                    <Box sx={{ flex: '1 1 0' }}><EmptyState /></Box>
                                ) : (
                                    <Box
                                        sx={{
                                            flex: '1 1 0',
                                            minHeight: { xs: 200, md: 0 },
                                        }}
                                    >
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart
                                                data={plantTrend.trend}
                                                margin={{ top: 8, right: 20, bottom: 8, left: 0 }}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="month" tickFormatter={formatMonthLabel} />
                                                <YAxis />
                                                <Tooltip
                                                    formatter={(value: any) => [
                                                        `${formatTooltipValue(value)} 万元`,
                                                        '补偿费用',
                                                    ]}
                                                    labelFormatter={formatMonthLabel}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="compensation_fee"
                                                    name="补偿费用（万元）"
                                                    stroke="#d62728"
                                                    strokeWidth={2}
                                                    connectNulls
                                                    dot={(props: any) => {
                                                        const { cx, cy, payload } = props;
                                                        return (
                                                            <circle
                                                                key={payload.month}
                                                                cx={cx}
                                                                cy={cy}
                                                                r={5}
                                                                fill={
                                                                    payload.compensation_fee > 0
                                                                        ? '#d62728'
                                                                        : '#bbb'
                                                                }
                                                                stroke="#fff"
                                                                strokeWidth={1.5}
                                                            />
                                                        );
                                                    }}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </Box>
                                )}
                            </>
                        )}
                    </Paper>
                </Box>
            </Box>
        </Box>
    );
}

const FreqRegulationMarketPage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    return (
        <Box
            sx={{
                width: '100%',
                height: { xs: 'auto', md: '100%' },
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
            }}
        >
            {isTablet && (
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary', flexShrink: 0 }}>
                    储能运营 / 调频市场价格
                </Typography>
            )}

            <Paper variant="outlined" sx={{ borderColor: 'divider', flexShrink: 0 }}>
                <Tabs
                    value={tabIndex}
                    onChange={(_, value) => setTabIndex(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                    aria-label="调频市场价格"
                >
                    <Tab label="日曲线" />
                    <Tab label="区间分析" />
                    <Tab label="月度趋势" />
                    <Tab label="补偿收益分析" />
                </Tabs>
            </Paper>

            <TabPanel value={tabIndex} index={0}>
                <DailyCurveTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={1}>
                <RangeAnalysisTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={2}>
                <MonthlyTrendTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={3}>
                <CompensationAnalysisTab />
            </TabPanel>
        </Box>
    );
};

export default FreqRegulationMarketPage;
