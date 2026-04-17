/**
 * 中长期趋势分析 - 价格走势 Tab
 * 
 * 对比中长期合同价格与现货价格的趋势
 */
import React, { useRef, useMemo } from 'react';
import {
    Box, Paper, Typography, Grid,
    CircularProgress, Alert, useTheme, useMediaQuery
} from '@mui/material';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceArea, ComposedChart
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { useSelectableSeries } from '../../hooks/useSelectableSeries';
import { ContractPriceTrendResponse } from '../../api/contractPriceTrend';

interface PriceTrendTabProps {
    data: ContractPriceTrendResponse | null;
    loading: boolean;
    error: string | null;
    spotBenchmark: 'day_ahead' | 'real_time';
}

// 趋势分析面板组件
const TrendSummaryPanel: React.FC<{
    stats: {
        slope: number;
        intercept: number;
        startPrice: number;
        endPrice: number;
        priceChange: number;
        priceChangePercent: number;
        avgSpread: number;
        positiveSpreadRatio: number;
        negativeSpreadRatio: number;
        maxSpread: number;
        minSpread: number;
    };
    spotBenchmark: 'day_ahead' | 'real_time';
}> = ({ stats, spotBenchmark }) => {
    const spotLabel = spotBenchmark === 'day_ahead' ? '日前' : '实时';

    // 趋势判断
    let trendText = "震荡";
    if (stats.slope > 0.5) {
        trendText = "上涨趋势";
    } else if (stats.slope < -0.5) {
        trendText = "下跌趋势";
    }

    // 价差建议
    let spreadSuggestion = "";
    if (stats.avgSpread > 10) {
        spreadSuggestion = `中长期均价高于${spotLabel}，建议优化合同结构`;
    } else if (stats.avgSpread < -10) {
        spreadSuggestion = `中长期均价低于${spotLabel}，合同价格优势明显`;
    } else {
        spreadSuggestion = "中长期与现货价差较小";
    }

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 2,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                borderRadius: 2,
                boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)'
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* 趋势分析 */}
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                        趋势分析
                    </Box>
                    <Box component="span">
                        中长期合同价格呈现
                        <Box component="span" sx={{ fontWeight: 'bold', mx: 0.5, color: '#fff' }}>{trendText}</Box>
                        (斜率: {stats.slope.toFixed(2)})，
                        区间涨跌幅 {stats.priceChange > 0 ? '+' : ''}{stats.priceChange.toFixed(2)} 元/MWh ({stats.priceChangePercent > 0 ? '+' : ''}{stats.priceChangePercent.toFixed(2)}%)
                    </Box>
                </Typography>

                {/* 价差分析 */}
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                        价差分析
                    </Box>
                    <Box component="span">
                        平均价差 {stats.avgSpread.toFixed(2)} 元/MWh（中长期 - {spotLabel}），
                        正价差占比 {stats.positiveSpreadRatio.toFixed(1)}%，
                        负价差占比 {stats.negativeSpreadRatio.toFixed(1)}%。
                        最大价差 {stats.maxSpread.toFixed(2)}，最小价差 {stats.minSpread.toFixed(2)}。
                        <Box component="span" sx={{ fontWeight: 'bold', ml: 0.5, color: '#fff' }}>{spreadSuggestion}</Box>
                    </Box>
                </Typography>
            </Box>
        </Paper>
    );
};

// 辅助函数：渲染周末背景标记
const renderWeekendReferenceAreas = (data: any[]) => {
    if (!data || data.length === 0) return null;
    return data.map((entry, index) => {
        if (!entry.date) return null;
        const date = new Date(entry.date);
        const day = date.getDay();
        if (day === 0 || day === 6) {
            return (
                <ReferenceArea
                    key={`weekend-${index}`}
                    x1={entry.date}
                    x2={entry.date}
                    strokeOpacity={0}
                    fill="#e0e0e0"
                    fillOpacity={0.3}
                    ifOverflow="extendDomain"
                />
            );
        }
        return null;
    });
};

// 48时段区间均价对比图
const PeriodAverageChart: React.FC<{
    data: ContractPriceTrendResponse['period_48_trends'];
    spotLabel: string;
}> = ({ data, spotLabel }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title: `48时段均价对比（中长期 vs ${spotLabel}）`
    });

    return (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Typography variant="h6" gutterBottom>48时段均价对比（中长期 vs {spotLabel}）</Typography>
            <Box ref={chartRef} sx={{
                height: { xs: 320, md: '100%' },
                minHeight: { xs: 320, md: 360 },
                position: 'relative',
                bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                p: isFullscreen ? 2 : 0,
                ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                '& .recharts-surface:focus': { outline: 'none' },
                '& *:focus': { outline: 'none !important' }
            }}>
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />
                <ResponsiveContainer>
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: isMobile ? 10 : 12 }}
                            interval={isMobile ? 3 : 1}
                            minTickGap={isMobile ? 6 : 2}
                        />
                        <YAxis label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                        <Tooltip
                            formatter={(value: any, name: string) => [
                                typeof value === 'number' ? value.toFixed(2) : '--',
                                name
                            ]}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="contract_vwap" name="中长期均价" stroke="#9c27b0" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="spot_vwap" name={`${spotLabel}均价`} stroke="#1976d2" strokeWidth={2.5} dot={false} strokeDasharray="5 5" />
                    </LineChart>
                </ResponsiveContainer>
            </Box>
        </Paper>
    );
};

export const PriceTrendTab: React.FC<PriceTrendTabProps> = ({ data, loading, error, spotBenchmark }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const spotLabel = spotBenchmark === 'day_ahead' ? '日前' : '实时';

    // Derived values
    const chartHeight = { xs: 320, md: '100%' };

    // Refs for charts
    const priceChartRef = useRef<HTMLDivElement>(null);

    // Fullscreen hooks
    const priceFullscreen = useChartFullscreen({ chartRef: priceChartRef, title: '日均价格趋势' });

    // Series selection hooks
    const priceSeries = useSelectableSeries({ contract_vwap: true, spot_vwap: true });

    // Calculate Trend Line and Stats
    const { chartData, stats, periodChartData } = useMemo(() => {
        if (!data?.daily_trends) return { chartData: [], stats: null, periodChartData: [] };

        const sourceTrends = data.daily_trends;

        // 1. Linear Regression on contract_vwap
        const points = sourceTrends
            .map((d: any, i: number) => ({ x: i, y: d.contract_vwap }))
            .filter(p => p.y !== null && p.y !== undefined);

        let slope = 0;
        let intercept = 0;

        if (points.length > 1) {
            const n = points.length;
            const sumX = points.reduce((acc, p) => acc + p.x, 0);
            const sumY = points.reduce((acc, p) => acc + p.y, 0);
            const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
            const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);

            slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            intercept = (sumY - slope * sumX) / n;

        }

        // 使用 map 创建新对象，避免修改原始数据（来自 React 状态的冻结对象）
        const trends = sourceTrends.map((d: any, i: number) => ({
            ...d,
            trend_line: points.length > 1 ? slope * i + intercept : undefined
        }));

        // 2. Calculate Stats
        const startPrice = points.length > 0 ? (slope * 0 + intercept) : 0;
        const endPrice = points.length > 0 ? (slope * (points.length - 1) + intercept) : 0;
        const priceChange = endPrice - startPrice;
        const priceChangePercent = startPrice !== 0 ? (priceChange / startPrice) * 100 : 0;

        const statsObj = {
            slope, intercept, startPrice, endPrice, priceChange, priceChangePercent,
            avgSpread: data.spread_stats.avgSpread,
            positiveSpreadRatio: data.spread_stats.positiveSpreadRatio,
            negativeSpreadRatio: data.spread_stats.negativeSpreadRatio,
            maxSpread: data.spread_stats.maxSpread,
            minSpread: data.spread_stats.minSpread
        };

        return {
            chartData: trends,
            stats: statsObj,
            periodChartData: data.period_48_trends || []
        };
    }, [data]);

    return (
        <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Content Area */}
            {loading && !data ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error">{error}</Alert>
            ) : data ? (
                <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', gap: { xs: 1, md: 1.5 } }}>
                    {/* Loading Overlay */}
                    {loading && (
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000
                        }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {/* Top: Trend Summary Panel */}
                    {stats && <TrendSummaryPanel stats={stats} spotBenchmark={spotBenchmark} />}

                    <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
                        {/* Left: Price Trend */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column', minHeight: { xs: 360, md: 0 } }}>
                                <Typography variant="h6" gutterBottom>日均价格趋势</Typography>
                                <Box ref={priceChartRef} sx={{
                                    height: chartHeight,
                                    minHeight: { xs: 320, md: 360 },
                                    position: 'relative',
                                    bgcolor: priceFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                                    p: priceFullscreen.isFullscreen ? 2 : 0,
                                    ...(priceFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                                    '& .recharts-surface:focus': { outline: 'none' },
                                    '& *:focus': { outline: 'none !important' }
                                }}>
                                    <priceFullscreen.FullscreenEnterButton />
                                    <priceFullscreen.FullscreenExitButton />
                                    <priceFullscreen.FullscreenTitle />
                                    <ResponsiveContainer>
                                        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            {renderWeekendReferenceAreas(chartData)}
                                            <XAxis dataKey="date" tick={{ fontSize: isMobile ? 10 : 12 }} minTickGap={isMobile ? 12 : 6} />
                                            <YAxis label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip formatter={(value: any) => typeof value === 'number' ? value.toFixed(2) : '--'} />
                                            <Legend onClick={priceSeries.handleLegendClick} />
                                            <Line hide={!priceSeries.seriesVisibility.contract_vwap} type="monotone" dataKey="contract_vwap" name="中长期均价" stroke="#9c27b0" strokeWidth={2} dot={false} />
                                            <Line hide={!priceSeries.seriesVisibility.spot_vwap} type="monotone" dataKey="spot_vwap" name={`${spotLabel}均价`} stroke="#1976d2" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Paper>
                        </Grid>

                        {/* Right: Period 48 Trend */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <PeriodAverageChart data={periodChartData} spotLabel={spotLabel} />
                        </Grid>
                    </Grid>
                </Box>
            ) : null}
        </Box>
    );
};
