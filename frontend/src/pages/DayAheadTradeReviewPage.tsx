import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Checkbox,
    CircularProgress,
    IconButton,
    Paper,
    Typography,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { addDays, format } from 'date-fns';
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { tradeReviewApi } from '../api/tradeReview';
import apiClient from '../api/client';
import { DayAheadReviewResponse } from '../types/tradeReview';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';

type PriceSeriesKey = 'price_rt' | 'price_da' | 'price_da_econ' | 'price_da_forecast';
type VolumeSeriesKey = 'declared_mwh' | 'actual_load_mwh' | 'forecast_gap_min_mwh';

const PRICE_SERIES_META: Record<PriceSeriesKey, { label: string; color: string }> = {
    price_rt: { label: '实时价格', color: '#f44336' },
    price_da: { label: '日前价格', color: '#2196f3' },
    price_da_econ: { label: '日前经济价格', color: '#ff9800' },
    price_da_forecast: { label: '日前预测价格', color: '#9c27b0' },
};

const DECLARED_VOLUME_COLOR = '#26a69a';
const ACTUAL_LOAD_BG_COLOR = '#90caf9';
const FORECAST_LOAD_BG_COLOR = '#ffcc80';
const VOLUME_SERIES_META: Record<VolumeSeriesKey, { label: string; color: string }> = {
    declared_mwh: { label: '申报电量', color: DECLARED_VOLUME_COLOR },
    actual_load_mwh: { label: '实际电量', color: ACTUAL_LOAD_BG_COLOR },
    forecast_gap_min_mwh: { label: '预测电量', color: FORECAST_LOAD_BG_COLOR },
};

interface PriceForecastVersion {
    forecast_id: string;
}

interface PriceForecastPoint {
    time: string;
    predicted_price: number | null;
}

const formatNumber = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return '-';
    }
    return value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const timeToMinutes = (timeText: string): number => {
    const [h, m] = timeText.split(':').map((v) => Number(v));
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
};

const to48Average = (values: Array<number | null>): Array<number | null> => {
    if (values.length === 48) return values;
    if (values.length < 48) return [...values, ...new Array(48 - values.length).fill(null)];
    if (values.length >= 96) {
        const result: Array<number | null> = [];
        for (let i = 0; i < 48; i += 1) {
            const a = values[i * 2];
            const b = values[i * 2 + 1];
            if (a === null || a === undefined || b === null || b === undefined) {
                result.push(null);
            } else {
                result.push((a + b) / 2);
            }
        }
        return result;
    }
    return values.slice(0, 48);
};

const DayAheadExecutionTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload.find((item: any) => item?.payload)?.payload || payload[0]?.payload;
    if (!row) return null;

    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                minWidth: 300,
                borderRadius: 3,
                border: '1px solid rgba(30, 41, 59, 0.12)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
                boxShadow: '0 14px 36px rgba(15, 23, 42, 0.16)',
                backdropFilter: 'blur(10px)',
            }}
        >
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
                时段 {row.period ?? '-'}（{row.time ?? label ?? '-'}）
            </Typography>
            <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1 }} />
            <Box sx={{ display: 'grid', gap: 0.75 }}>
                <Typography variant="body2" sx={{ color: PRICE_SERIES_META.price_rt.color }}>实时价格：{formatNumber(row.price_rt, 3)} 元/MWh</Typography>
                <Typography variant="body2" sx={{ color: PRICE_SERIES_META.price_da.color }}>日前价格：{formatNumber(row.price_da, 3)} 元/MWh</Typography>
                <Typography variant="body2" sx={{ color: PRICE_SERIES_META.price_da_econ.color }}>日前经济价格：{formatNumber(row.price_da_econ, 3)} 元/MWh</Typography>
                <Typography variant="body2" sx={{ color: PRICE_SERIES_META.price_da_forecast.color }}>日前预测价格：{formatNumber(row.price_da_forecast, 3)} 元/MWh</Typography>
            </Box>
            <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1.25 }} />
            <Typography variant="body2" sx={{ color: DECLARED_VOLUME_COLOR }}>
                申报电量：<Box component="span" sx={{ fontWeight: 700 }}>{formatNumber(row.declared_mwh, 3)} MWh</Box>
            </Typography>
            <Typography variant="body2" sx={{ color: ACTUAL_LOAD_BG_COLOR }}>
                实际电量：<Box component="span" sx={{ fontWeight: 700 }}>{formatNumber(row.actual_load_mwh, 3)} MWh</Box>
            </Typography>
            <Typography variant="body2" sx={{ color: FORECAST_LOAD_BG_COLOR }}>
                预测电量：<Box component="span" sx={{ fontWeight: 700 }}>{formatNumber(row.forecast_gap_min_mwh, 3)} MWh</Box>
            </Typography>
        </Paper>
    );
};

export const DayAheadTradeReviewPage: React.FC = () => {
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), 1));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DayAheadReviewResponse | null>(null);
    const [forecast48, setForecast48] = useState<Array<number | null>>([]);

    const chartRef = useRef<HTMLDivElement>(null);
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    const { seriesVisibility, handleLegendClick } = useSelectableSeries<PriceSeriesKey>({
        price_rt: true,
        price_da: true,
        price_da_econ: true,
        price_da_forecast: true,
    });
    const { seriesVisibility: volumeSeriesVisibility, handleLegendClick: handleVolumeLegendClick } = useSelectableSeries<VolumeSeriesKey>({
        declared_mwh: true,
        actual_load_mwh: true,
        forecast_gap_min_mwh: true,
    });

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } = useChartFullscreen({
        chartRef,
        title: `日前交易复盘 (${dateStr})`,
        onPrevious: () => {
            if (!selectedDate) return;
            setSelectedDate(addDays(selectedDate, -1));
        },
        onNext: () => {
            if (!selectedDate) return;
            setSelectedDate(addDays(selectedDate, 1));
        },
    });

    useEffect(() => {
        const fetchReviewData = async () => {
            if (!dateStr) return;
            setLoading(true);
            setError(null);
            try {
                const reviewResp = await tradeReviewApi.fetchDayAheadReview(dateStr);
                setData(reviewResp.data);
            } catch (err: any) {
                setError(err.response?.data?.detail || err.message || '加载日前交易复盘数据失败');
                setData(null);
            } finally {
                setLoading(false);
            }
        };
        fetchReviewData();
    }, [dateStr]);

    useEffect(() => {
        const fetchForecast = async () => {
            if (!dateStr) return;
            try {
                const versionsResp = await apiClient.get<PriceForecastVersion[]>('/api/v1/price-forecast/versions', {
                    params: { target_date: dateStr, forecast_type: 'd1_price' },
                });
                const latestVersion = versionsResp.data?.[0];
                if (!latestVersion?.forecast_id) {
                    setForecast48(new Array(48).fill(null));
                    return;
                }
                const forecastResp = await apiClient.get<PriceForecastPoint[]>('/api/v1/price-forecast/data', {
                    params: { forecast_id: latestVersion.forecast_id, target_date: dateStr },
                });
                const sorted = [...(forecastResp.data || [])].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
                const values = sorted.map((item) => (item.predicted_price ?? null));
                setForecast48(to48Average(values));
            } catch {
                setForecast48(new Array(48).fill(null));
            }
        };
        fetchForecast();
    }, [dateStr]);

    const chartRows = useMemo(() => {
        if (!data) return [];
        return data.chart_rows.map((row, idx) => ({
            ...row,
            price_da_forecast: forecast48[idx] ?? row.price_da_forecast,
        }));
    }, [data, forecast48]);

    const { TouPeriodAreas } = useTouPeriodBackground(chartRows);

    const priceValues = useMemo(() => {
        return chartRows.flatMap((row) => [
            seriesVisibility.price_rt ? row.price_rt : null,
            seriesVisibility.price_da ? row.price_da : null,
            seriesVisibility.price_da_econ ? row.price_da_econ : null,
            seriesVisibility.price_da_forecast ? row.price_da_forecast : null,
        ].filter((v) => v !== null) as number[]);
    }, [chartRows, seriesVisibility]);

    const priceDomain = useMemo(() => {
        if (priceValues.length === 0) return [0, 1000];
        const minValue = Math.min(...priceValues);
        const maxValue = Math.max(...priceValues);
        return [Math.floor(minValue * 0.9), Math.ceil(maxValue * 1.1)];
    }, [priceValues]);

    const markerField = data?.settlement_price_type === 'econ' ? 'price_da_econ' : 'price_da';
    const markerRows = useMemo(() => {
        return chartRows.filter((row) => row.declared_mwh > 0 && row[markerField] !== null);
    }, [chartRows, markerField]);
    const hasPublishedSettlementPrices = useMemo(() => {
        return chartRows.some((row) => row.price_rt !== null && row[markerField] !== null);
    }, [chartRows, markerField]);
    const hasDeclaredTrades = useMemo(() => {
        return chartRows.some((row) => row.declared_mwh > 0);
    }, [chartRows]);

    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        setSelectedDate(addDays(selectedDate, days));
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 700, color: 'text.primary' }}>
                    交易复盘 / 日前交易复盘
                </Typography>

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="交易目标日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } },
                            },
                        }}
                    />
                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>
                </Paper>

                {loading && !data ? (
                    <Box sx={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                ) : data ? (
                    <Box sx={{ position: 'relative', mt: 2 }}>
                        {loading && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                    zIndex: 1000,
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>成交分析图表</Typography>
                            <Box
                                ref={chartRef}
                                sx={{
                                    height: { xs: 460, sm: 540 },
                                    display: 'flex',
                                    flexDirection: 'column',
                                    position: 'relative',
                                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                                    p: isFullscreen ? 2 : 0,
                                    ...(isFullscreen && {
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        width: '100vw',
                                        height: '100vh',
                                        zIndex: 1400,
                                    }),
                                }}
                            >
                                <FullscreenEnterButton />
                                <FullscreenExitButton />
                                <FullscreenTitle />
                                <NavigationButtons />

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', flexWrap: { xs: 'nowrap', md: 'wrap' }, pb: 0.5, pr: { xs: 5, sm: 0 }, flex: '0 0 auto' }}>
                                    {(Object.keys(PRICE_SERIES_META) as PriceSeriesKey[]).map((key) => (
                                        <Box
                                            key={key}
                                            onClick={() => handleLegendClick({ dataKey: key } as any)}
                                            sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', flex: '0 0 auto' }}
                                        >
                                            <Checkbox
                                                checked={seriesVisibility[key]}
                                                size="small"
                                                sx={{
                                                    p: 0.5,
                                                    color: PRICE_SERIES_META[key].color,
                                                    '&.Mui-checked': { color: PRICE_SERIES_META[key].color },
                                                }}
                                            />
                                            <Typography variant="body2" sx={{ color: seriesVisibility[key] ? 'text.primary' : 'text.disabled', mr: 1 }}>
                                                {PRICE_SERIES_META[key].label}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Box>

                                <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 1 }}>
                                    <Box sx={{ flex: '3 1 0', minHeight: 0 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartRows} syncId="day-ahead-review" margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
                                                {TouPeriodAreas}
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="time" hide />
                                                <YAxis domain={priceDomain} label={{ value: '价格(元/MWh)', angle: -90, position: 'insideLeft' }} />
                                                <Tooltip
                                                    content={<DayAheadExecutionTooltip />}
                                                    cursor={{ stroke: '#9e9e9e', strokeDasharray: '3 3' }}
                                                    wrapperStyle={{ zIndex: 1401 }}
                                                />
                                                <Line type="monotone" dataKey="price_rt" name="实时价格" stroke={PRICE_SERIES_META.price_rt.color} strokeWidth={2} dot={false} hide={!seriesVisibility.price_rt} />
                                                <Line type="monotone" dataKey="price_da" name="日前价格" stroke={PRICE_SERIES_META.price_da.color} strokeWidth={2} strokeDasharray="5 5" dot={false} hide={!seriesVisibility.price_da} />
                                                <Line type="monotone" dataKey="price_da_econ" name="日前经济价格" stroke={PRICE_SERIES_META.price_da_econ.color} strokeWidth={2} strokeDasharray="3 3" dot={false} hide={!seriesVisibility.price_da_econ} />
                                                <Line type="monotone" dataKey="price_da_forecast" name="日前预测价格" stroke={PRICE_SERIES_META.price_da_forecast.color} strokeWidth={2} strokeDasharray="8 4" dot={false} hide={!seriesVisibility.price_da_forecast} />
                                                {markerRows.map((row) => (
                                                    <ReferenceDot key={`marker-${row.period}`} x={row.time} y={row[markerField] as number} r={4} fill="#d32f2f" stroke="#ffffff" strokeWidth={1.2} />
                                                ))}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </Box>

                                    <Box sx={{ flex: '2 1 0', minHeight: 0 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartRows} syncId="day-ahead-review" margin={{ top: 4, right: 20, left: 8, bottom: 12 }}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="time" interval={3} tick={{ fontSize: 12 }} />
                                                <YAxis label={{ value: '申报电量(MWh)', angle: -90, position: 'insideLeft' }} />
                                                <Tooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
                                                <ReferenceLine y={0} stroke="#94a3b8" />
                                                <Area
                                                    type="monotone"
                                                    dataKey="actual_load_mwh"
                                                    name="实际电量"
                                                    stroke="none"
                                                    fill={ACTUAL_LOAD_BG_COLOR}
                                                    fillOpacity={0.28}
                                                    hide={!volumeSeriesVisibility.actual_load_mwh}
                                                    isAnimationActive={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="forecast_gap_min_mwh"
                                                    name="预测电量"
                                                    stroke={FORECAST_LOAD_BG_COLOR}
                                                    strokeWidth={2}
                                                    strokeDasharray="6 4"
                                                    dot={false}
                                                    hide={!volumeSeriesVisibility.forecast_gap_min_mwh}
                                                    isAnimationActive={false}
                                                />
                                                <Bar
                                                    dataKey="declared_mwh"
                                                    name="申报电量"
                                                    fill={DECLARED_VOLUME_COLOR}
                                                    hide={!volumeSeriesVisibility.declared_mwh}
                                                />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 0.25, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', flexWrap: { xs: 'nowrap', md: 'wrap' }, pb: 0.5, flex: '0 0 auto' }}>
                                        {(Object.keys(VOLUME_SERIES_META) as VolumeSeriesKey[]).map((key) => (
                                            <Box
                                                key={key}
                                                onClick={() => handleVolumeLegendClick({ dataKey: key } as any)}
                                                sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', flex: '0 0 auto' }}
                                            >
                                                <Checkbox
                                                    checked={volumeSeriesVisibility[key]}
                                                    size="small"
                                                    sx={{
                                                        p: 0.5,
                                                        color: VOLUME_SERIES_META[key].color,
                                                        '&.Mui-checked': { color: VOLUME_SERIES_META[key].color },
                                                    }}
                                                />
                                                <Typography variant="body2" sx={{ color: volumeSeriesVisibility[key] ? 'text.primary' : 'text.disabled', mr: 1 }}>
                                                    {VOLUME_SERIES_META[key].label}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            </Box>
                        </Paper>

                        <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.25, sm: 1.5 }, borderColor: 'divider', backgroundColor: 'grey.50' }}>
                            {data.execution_analysis_summary ? (
                                <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.8 }}>
                                    盈利笔数：
                                    <Box component="span" sx={{ color: 'success.main', fontWeight: 900 }}>{data.execution_analysis_summary.profit_count}</Box>
                                    ，盈利金额：
                                    <Box component="span" sx={{ color: 'success.main', fontWeight: 900 }}>{formatNumber(data.execution_analysis_summary.profit_amount, 2)}元</Box>
                                    ；亏损笔数：
                                    <Box component="span" sx={{ color: 'error.main', fontWeight: 900 }}>{data.execution_analysis_summary.loss_count}</Box>
                                    ，亏损金额：
                                    <Box component="span" sx={{ color: 'error.main', fontWeight: 900 }}>{formatNumber(data.execution_analysis_summary.loss_amount, 2)}元</Box>
                                    ；当日交易总收益：
                                    <Box
                                        component="span"
                                        sx={{
                                            ml: 0.5,
                                            color: data.execution_analysis_summary.total_profit_amount >= 0 ? 'success.main' : 'error.main',
                                            fontWeight: 900,
                                        }}
                                    >
                                        {formatNumber(data.execution_analysis_summary.total_profit_amount, 2)}元
                                    </Box>
                                </Typography>
                            ) : hasPublishedSettlementPrices && !hasDeclaredTrades ? (
                                <Typography variant="body2" color="text.secondary">
                                    当前日期日前与实时价格已发布，但暂无日前申报交易，暂不展示当日盈亏汇总。
                                </Typography>
                            ) : (
                                <Typography variant="body2" color="text.secondary">
                                    当前日期尚未发布完整的日前/实时价格，暂不展示当日盈亏汇总。
                                </Typography>
                            )}
                        </Paper>
                    </Box>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};

export default DayAheadTradeReviewPage;
