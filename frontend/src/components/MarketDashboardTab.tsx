import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Grid,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow
} from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, ComposedChart, Bar, ReferenceLine, Cell } from 'recharts';
import { format } from 'date-fns';
import apiClient from '../api/client';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { CustomTooltip } from './CustomTooltip';

// 类型定义
interface FinancialKPIs {
    vwap_rt: number | null;
    vwap_da: number | null;
    vwap_spread: number | null;
    twap_rt: number | null;
    twap_da: number | null;
    twap_econ: number | null;
    max_econ: number | null;
    min_econ: number | null;
}

interface RiskKPI {
    value: number;
    time_str: string;
    period: number;
}

interface RiskKPIs {
    max_positive_spread: RiskKPI | null;
    max_negative_spread: RiskKPI | null;
    max_rt_price: RiskKPI | null;
    min_rt_price: RiskKPI | null;
}

interface TimeSeriesPoint {
    period: number;
    time: string;
    time_str: string;
    price_rt: number | null;
    node_rt_price?: number | null;
    price_da: number | null;
    price_econ: number | null;
    volume_rt: number;
    volume_da: number;
    spread: number | null;
    period_type: string;
}

interface PeriodSummary {
    period_name: string;
    vwap_da: number | null;
    vwap_rt: number | null;
    vwap_spread: number | null;
    avg_volume_rt: number | null;
    renewable_ratio: number | null;
}

interface SpreadAnalysisData {
    time_series: any[];
    systematic_bias: any[];
    price_distribution: any[];
}

interface DashboardData {
    date: string;
    financial_kpis: FinancialKPIs;
    risk_kpis: RiskKPIs;
    time_series: TimeSeriesPoint[];
    period_summary: PeriodSummary[];
    node_rt_fallback?: {
        enabled: boolean;
        node_name: string;
    };
}

type PriceSeriesKey = 'price_rt' | 'node_rt_price' | 'price_da' | 'price_econ';

// 市场价格描述面板组件
const MarketPriceSummaryPanel: React.FC<{
    financial_kpis: FinancialKPIs;
    risk_kpis: RiskKPIs;
    time_series: TimeSeriesPoint[];
}> = ({ financial_kpis, risk_kpis, time_series }) => {
    // 计算价格范围
    const rtPrices = time_series.filter(d => d.price_rt !== null).map(d => d.price_rt!);
    const daPrices = time_series.filter(d => d.price_da !== null).map(d => d.price_da!);
    const minRtPrice = rtPrices.length > 0 ? Math.min(...rtPrices) : 0;
    const maxRtPrice = rtPrices.length > 0 ? Math.max(...rtPrices) : 0;
    const minDaPrice = daPrices.length > 0 ? Math.min(...daPrices) : 0;
    const maxDaPrice = daPrices.length > 0 ? Math.max(...daPrices) : 0;
    const econPrices = time_series.filter(d => d.price_econ !== null).map(d => d.price_econ!);
    const minEconPrice = econPrices.length > 0 ? Math.min(...econPrices) : 0;
    const maxEconPrice = econPrices.length > 0 ? Math.max(...econPrices) : 0;

    // 计算价差统计
    const spreads = time_series.filter(d => d.spread !== null).map(d => d.spread!);
    const negativeSpreads = spreads.filter(s => s < 0);
    const negativeSpreadsRatio = spreads.length > 0 ? (negativeSpreads.length / spreads.length) * 100 : 0;

    // 计算价差超过±100的时段占比
    const extremeSpreads = spreads.filter(s => Math.abs(s) > 100);
    const extremeSpreadsRatio = spreads.length > 0 ? (extremeSpreads.length / spreads.length) * 100 : 0;

    // 计算价差率（平均价差/平均价格）
    const spreadRate = financial_kpis.vwap_rt !== null && financial_kpis.vwap_rt !== 0
        ? ((financial_kpis.vwap_spread || 0) / financial_kpis.vwap_rt) * 100
        : 0;

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 2,
                mb: 2,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                borderRadius: 2,
                boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)'
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* 第一行：日前和实时价格信息 */}
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                        市场价格
                    </Box>
                    <Box component="span">
                        日前均价 {financial_kpis.vwap_da?.toFixed(2) || 'N/A'} 元/MWh (范围: {minDaPrice.toFixed(2)}~{maxDaPrice.toFixed(2)})，
                        实时均价 {financial_kpis.vwap_rt?.toFixed(2) || 'N/A'} 元/MWh (范围: {minRtPrice.toFixed(2)}~{maxRtPrice.toFixed(2)})，
                        经济出清均价 {financial_kpis.twap_econ?.toFixed(2) || 'N/A'} 元/MWh (范围: {minEconPrice.toFixed(2)}~{maxEconPrice.toFixed(2)})
                    </Box>
                </Typography>

                {/* 第二行：价差信息和策略建议 */}
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                        价差分析
                    </Box>
                    <Box component="span">
                        均值价差 {financial_kpis.vwap_spread?.toFixed(2) || 'N/A'} 元/MWh (价差率 {spreadRate.toFixed(1)}%)，
                        负价差占比 {negativeSpreadsRatio.toFixed(1)}%，
                        最大正价差 {risk_kpis.max_positive_spread?.value.toFixed(2) || 'N/A'} 元/MWh ({risk_kpis.max_positive_spread?.time_str || 'N/A'})，
                        最大负价差 {risk_kpis.max_negative_spread?.value.toFixed(2) || 'N/A'} 元/MWh ({risk_kpis.max_negative_spread?.time_str || 'N/A'})，
                        极端价差(±100)占比 {extremeSpreadsRatio.toFixed(1)}%
                        {spreadRate < 0 && ' - 建议多报实时市场'}
                        {spreadRate > 0 && ' - 建议多报日前市场'}
                    </Box>
                </Typography>
            </Box>
        </Paper>
    );
};

// 财务指标大卡片组件
const FinancialKPIsPanel: React.FC<{ kpis: FinancialKPIs }> = ({ kpis }) => (
    <Paper elevation={2} sx={{ p: 2, height: '100%' }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                财务指标
            </Typography>
            <Typography variant="caption" color="text.secondary">
                单位: 元/MWh
            </Typography>
        </Box>
        <Grid container spacing={1.5}>
            <Grid size={{ xs: 6, sm: 4 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        实时加权均价
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main', my: 0.5 }}>
                        {kpis.vwap_rt !== null ? kpis.vwap_rt.toFixed(2) : 'N/A'}
                    </Typography>
                </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        日前加权均价
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'info.main', my: 0.5 }}>
                        {kpis.vwap_da !== null ? kpis.vwap_da.toFixed(2) : 'N/A'}
                    </Typography>
                </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        日均加权价差
                    </Typography>
                    <Typography
                        variant="h6"
                        sx={{
                            fontWeight: 'bold',
                            color: kpis.vwap_spread && kpis.vwap_spread > 0 ? 'error.main' : 'success.main',
                            my: 0.5
                        }}
                    >
                        {kpis.vwap_spread !== null ? kpis.vwap_spread.toFixed(2) : 'N/A'}
                    </Typography>
                </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        实时算术均价
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', my: 0.5 }}>
                        {kpis.twap_rt !== null ? kpis.twap_rt.toFixed(2) : 'N/A'}
                    </Typography>
                </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        日前算术均价
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', my: 0.5 }}>
                        {kpis.twap_da !== null ? kpis.twap_da.toFixed(2) : 'N/A'}
                    </Typography>
                </Box>
            </Grid>
        </Grid>
    </Paper>
);

// 风险指标大卡片组件
const RiskKPIsPanel: React.FC<{ kpis: RiskKPIs }> = ({ kpis }) => (
    <Paper elevation={2} sx={{ p: 2, height: '100%' }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                风险指标
            </Typography>
            <Typography variant="caption" color="text.secondary">
                单位: 元/MWh
            </Typography>
        </Box>
        <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        最大正价差（最大亏损点）
                    </Typography>
                    {kpis.max_positive_spread ? (
                        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap" justifyContent="center">
                            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                                {kpis.max_positive_spread.value.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {kpis.max_positive_spread.time_str} (第{kpis.max_positive_spread.period}段)
                            </Typography>
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">无数据</Typography>
                    )}
                </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        最大负价差（最大盈利点）
                    </Typography>
                    {kpis.max_negative_spread ? (
                        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap" justifyContent="center">
                            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                                {kpis.max_negative_spread.value.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {kpis.max_negative_spread.time_str} (第{kpis.max_negative_spread.period}段)
                            </Typography>
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">无数据</Typography>
                    )}
                </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        实时最高价
                    </Typography>
                    {kpis.max_rt_price ? (
                        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap" justifyContent="center">
                            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                                {kpis.max_rt_price.value.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {kpis.max_rt_price.time_str} (第{kpis.max_rt_price.period}段)
                            </Typography>
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">无数据</Typography>
                    )}
                </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
                <Box textAlign="center">
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '1rem' }}>
                        实时最低价
                    </Typography>
                    {kpis.min_rt_price ? (
                        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap" justifyContent="center">
                            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                                {kpis.min_rt_price.value.toFixed(2)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {kpis.min_rt_price.time_str} (第{kpis.min_rt_price.period}段)
                            </Typography>
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">无数据</Typography>
                    )}
                </Box>
            </Grid>
        </Grid>
    </Paper>
);

// Custom Tooltip 内容组件
const CustomTooltipContent: React.FC<any> = ({ active, payload, label, unit }) => {
    if (active && payload && payload.length) {
        const periodType = payload[0].payload.period_type;
        return (
            <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc', borderRadius: '4px' }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                    {`时间: ${label} (${periodType})`}
                </Typography>
                {payload.map((pld: any) => (
                    <Typography key={pld.dataKey} variant="body2" sx={{ color: pld.color }}>
                        {`${pld.name}: ${Number(pld.value).toFixed(2)} ${unit}`}
                    </Typography>
                ))}
            </Paper>
        );
    }
    return null;
};


// 价格曲线图组件
const PriceChart: React.FC<{ data: TimeSeriesPoint[]; dateStr: string; onDateShift?: (days: number) => void }> = ({ data, dateStr, onDateShift }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const hasPublishedRtPrice = data.some(point => point.price_rt !== null && point.price_rt !== undefined);
    const hasNodeRtPrice = data.some(point => point.node_rt_price !== null && point.node_rt_price !== undefined);
    const [seriesVisibility, setSeriesVisibility] = useState<Record<PriceSeriesKey, boolean>>({
        price_rt: true,
        node_rt_price: false,
        price_da: false,
        price_econ: true
    });

    useEffect(() => {
        setSeriesVisibility({
            price_rt: true,
            node_rt_price: !hasPublishedRtPrice && hasNodeRtPrice,
            price_da: false,
            price_econ: true
        });
    }, [dateStr, hasPublishedRtPrice, hasNodeRtPrice]);

    const handleLegendClick = (dataKey: PriceSeriesKey) => {
        if (!dataKey) return;
        setSeriesVisibility(prev => (
            Object.prototype.hasOwnProperty.call(prev, dataKey)
                ? { ...prev, [dataKey]: !prev[dataKey] }
                : prev
        ));
    };

    const legendItems: Array<{ key: PriceSeriesKey; label: string; color: string }> = [
        ...(hasPublishedRtPrice ? [{ key: 'price_rt' as const, label: '实时价格', color: '#f44336' }] : []),
        ...(hasNodeRtPrice ? [{ key: 'node_rt_price' as const, label: '节点实时价格', color: '#ff1f1f' }] : []),
        { key: 'price_da', label: '日前价格', color: '#2196f3' },
        { key: 'price_econ', label: '经济出清价', color: '#ff9800' },
    ];

    // 计算Y轴范围
    const prices = data.flatMap(d => [
        seriesVisibility.price_rt ? d.price_rt : null,
        seriesVisibility.node_rt_price ? d.node_rt_price ?? null : null,
        seriesVisibility.price_da ? d.price_da : null,
        seriesVisibility.price_econ ? d.price_econ : null
    ].filter(p => p !== null) as number[]);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

    // 计算实时价格的最大最小值点
    const rtPrices = data.filter(d => d.price_rt !== null);
    const maxRtPoint = rtPrices.length > 0
        ? rtPrices.reduce((prev, curr) => (curr.price_rt! > prev.price_rt! ? curr : prev))
        : null;
    const minRtPoint = rtPrices.length > 0
        ? rtPrices.reduce((prev, curr) => (curr.price_rt! < prev.price_rt! ? curr : prev))
        : null;

    const { TouPeriodAreas } = useTouPeriodBackground(data);

    // 全屏功能(带导航按钮)
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } = useChartFullscreen({
        chartRef,
        title: `${dateStr} 价格曲线`,
        onPrevious: onDateShift ? () => onDateShift(-1) : undefined,
        onNext: onDateShift ? () => onDateShift(1) : undefined
    });

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>价格曲线</Typography>
            <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
                <Box
                    ref={chartRef}
                    sx={{
                        height: { xs: 350, sm: 400 },
                        position: 'relative',
                        backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                        p: isFullscreen ? 2 : 0,
                        ...(isFullscreen && {
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100vw',
                            height: '100vh',
                            zIndex: 1400
                        })
                    }}
                >
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />
                    <NavigationButtons />

                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            {TouPeriodAreas}
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="time_str"
                                tick={{ fontSize: 12 }}
                                interval={11}
                            />
                            <YAxis
                                domain={[Math.floor(minPrice * 0.9), Math.ceil(maxPrice * 1.1)]}
                                label={{
                                    value: '价格 (元/MWh)',
                                    angle: -90,
                                    position: 'insideLeft'
                                }}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip content={<CustomTooltipContent unit="元/MWh" />} />
                            <Legend
                                content={() => (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 2,
                                            pt: 1,
                                        }}
                                    >
                                        {legendItems.map((item) => {
                                            const active = seriesVisibility[item.key];
                                            return (
                                                <Box
                                                    key={item.key}
                                                    onClick={() => handleLegendClick(item.key)}
                                                    sx={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 0.75,
                                                        cursor: 'pointer',
                                                        color: active ? 'text.primary' : 'text.disabled',
                                                        userSelect: 'none',
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            width: 18,
                                                            height: 0,
                                                            borderTop: `3px solid ${item.color}`,
                                                            opacity: active ? 1 : 0.35,
                                                        }}
                                                    />
                                                    <Typography variant="body2">
                                                        {item.label}
                                                    </Typography>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                )}
                            />
                            <Line
                                type="monotone"
                                dataKey="price_rt"
                                stroke="#f44336"
                                strokeWidth={2}
                                name="实时价格"
                                dot={false}
                                hide={!seriesVisibility.price_rt || !hasPublishedRtPrice}
                            />
                            {hasNodeRtPrice && (
                                <Line
                                    type="monotone"
                                    dataKey="node_rt_price"
                                    stroke="#ff1f1f"
                                    strokeWidth={3}
                                    strokeDasharray="10 5"
                                    name="节点实时价格"
                                    dot={false}
                                    hide={!seriesVisibility.node_rt_price}
                                    isAnimationActive={false}
                                />
                            )}
                            <Line
                                type="monotone"
                                dataKey="price_da"
                                stroke="#2196f3"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                name="日前价格"
                                dot={false}
                                hide={!seriesVisibility.price_da}
                            />
                            <Line
                                type="monotone"
                                dataKey="price_econ"
                                stroke="#ff9800"
                                strokeWidth={2}
                                strokeDasharray="3 3"
                                name="经济出清价"
                                dot={false}
                                hide={!seriesVisibility.price_econ}
                            />

                            {/* 实时价格最大值标注 */}
                            {maxRtPoint && (
                                <ReferenceDot
                                    x={maxRtPoint.time_str}
                                    y={maxRtPoint.price_rt!}
                                    r={6}
                                    fill="#f44336"
                                    stroke="#fff"
                                    strokeWidth={2}
                                    label={{
                                        value: maxRtPoint.price_rt!.toFixed(2),
                                        position: 'top',
                                        fill: '#f44336',
                                        fontSize: 12,
                                        fontWeight: 'bold'
                                    }}
                                />
                            )}

                            {/* 实时价格最小值标注 */}
                            {minRtPoint && (
                                <ReferenceDot
                                    x={minRtPoint.time_str}
                                    y={minRtPoint.price_rt!}
                                    r={6}
                                    fill="#f44336"
                                    stroke="#fff"
                                    strokeWidth={2}
                                    label={{
                                        value: minRtPoint.price_rt!.toFixed(2),
                                        position: 'bottom',
                                        fill: '#f44336',
                                        fontSize: 12,
                                        fontWeight: 'bold'
                                    }}
                                />
                            )}

                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>
        </Box>
    );
};

// 价格偏差主图组件
const PriceSpreadChart: React.FC<{ data: any[]; dateStr: string; onDateShift?: (days: number) => void }> = ({ data, dateStr, onDateShift }) => {
    const chartRef = useRef<HTMLDivElement>(null);

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } = useChartFullscreen({
        chartRef,
        title: `${dateStr} 价格偏差主图`,
        onPrevious: onDateShift ? () => onDateShift(-1) : undefined,
        onNext: onDateShift ? () => onDateShift(1) : undefined
    });

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>价格偏差主图</Typography>
            <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
                <Box
                    ref={chartRef}
                    sx={{
                        height: { xs: 350, sm: 400 },
                        position: 'relative',
                        backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                        p: isFullscreen ? 2 : 0,
                        ...(isFullscreen && {
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100vw',
                            height: '100vh',
                            zIndex: 1400
                        })
                    }}
                >
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />
                    <NavigationButtons />

                    {!data || data.length === 0 ? (
                        <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography>无数据</Typography>
                        </Box>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="time_str" interval={11} tick={{ fontSize: 10 }} />
                                <YAxis label={{ value: '价差(元/MWh)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 10 }} />
                                <Tooltip content={<CustomTooltip unit="元/MWh" />} />
                                <ReferenceLine y={0} stroke="#000" />
                                <Bar dataKey="price_spread" name="价格偏差">
                                    {(data || []).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.price_spread > 0 ? '#f44336' : '#4caf50'} />
                                    ))}
                                </Bar>
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

// 价差分布直方图组件
const PriceDistributionChart: React.FC<{ data: any[]; dateStr: string; onDateShift?: (days: number) => void }> = ({ data, dateStr, onDateShift }) => {
    const chartRef = useRef<HTMLDivElement>(null);

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } = useChartFullscreen({
        chartRef,
        title: `${dateStr} 价差分布直方图`,
        onPrevious: onDateShift ? () => onDateShift(-1) : undefined,
        onNext: onDateShift ? () => onDateShift(1) : undefined
    });

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>价差分布直方图</Typography>
            <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
                <Box
                    ref={chartRef}
                    sx={{
                        height: { xs: 350, sm: 400 },
                        position: 'relative',
                        backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                        p: isFullscreen ? 2 : 0,
                        ...(isFullscreen && {
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100vw',
                            height: '100vh',
                            zIndex: 1400
                        })
                    }}
                >
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />
                    <NavigationButtons />

                    {!data || data.length === 0 ? (
                        <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography>无数据</Typography>
                        </Box>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="range_label"
                                    label={{ value: '价差区间 (元/MWh)', position: 'insideBottom', offset: -5 }}
                                    angle={-45}
                                    textAnchor="end"
                                    tick={false}
                                />
                                <YAxis
                                    label={{ value: '时段数量', angle: -90, position: 'insideLeft' }}
                                    allowDecimals={false}
                                    tick={false}
                                />
                                <Tooltip content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc' }}>
                                                <Typography variant="body2">区间:{data.range_label} 元/MWh</Typography>
                                                <Typography variant="body2">频次:{data.count}次</Typography>
                                            </Paper>
                                        );
                                    }
                                    return null;
                                }} />
                                <ReferenceLine x={0} stroke="#000" />
                                <Bar dataKey="count" name="时段数量">
                                    {(data || []).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.range_min >= 0 ? '#f44336' : '#4caf50'} />
                                    ))}
                                </Bar>
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

// 时段价格分析数据接口
interface PeriodPriceAnalysis {
    period_name: string;
    avg_price_da: number | null;
    avg_price_rt: number | null;
    avg_spread: number | null;
    positive_spread_ratio: number | null; // 正差率
    suggestion: string; // 建议操作
}

// 时段价格分析表格组件
const PeriodPriceAnalysisTable: React.FC<{
    periodSummary: PeriodSummary[];
    timeSeries: TimeSeriesPoint[]
}> = ({ periodSummary, timeSeries }) => {
    // 调试:输出数据结构
    // console.log('=== 时段价格分析调试 ===');
    // console.log('periodSummary:', periodSummary);
    // console.log('timeSeries示例(前3条):', timeSeries.slice(0, 3));
    // console.log('所有不同的period_type值:', [...new Set(timeSeries.map(p => p.period_type))]);

    // 计算每个时段的正差率和建议操作
    const analysisData: PeriodPriceAnalysis[] = periodSummary.map(period => {
        // 筛选出属于当前时段的所有时间点
        const periodPoints = timeSeries.filter(point => point.period_type === period.period_name);

        // 计算正差率:实时价格 > 日前价格的时段数 / 总时段数
        // 只统计同时有实时价格和日前价格的时段
        const validPoints = periodPoints.filter(point =>
            point.price_rt !== null && point.price_da !== null
        );
        const totalCount = validPoints.length;
        const positiveSpreads = validPoints.filter(point =>
            point.price_rt! > point.price_da!
        );
        const positiveSpreadRatio = totalCount > 0 ? (positiveSpreads.length / totalCount) * 100 : null;

        // 平均价差
        const avgSpread = period.vwap_spread;

        // 建议操作逻辑
        let suggestion = '观望';
        if (positiveSpreadRatio !== null && avgSpread !== null) {
            if (positiveSpreadRatio > 70 && avgSpread > 50) {
                suggestion = '做多';
            } else if (positiveSpreadRatio < 30 && avgSpread < -50) {
                suggestion = '做空';
            }
        }

        return {
            period_name: period.period_name,
            avg_price_da: period.vwap_da,
            avg_price_rt: period.vwap_rt,
            avg_spread: avgSpread,
            positive_spread_ratio: positiveSpreadRatio,
            suggestion
        };
    });

    return (
        <TableContainer component={Paper} elevation={2} sx={{ overflowX: 'auto' }}>
            <Table
                sx={{
                    '& .MuiTableCell-root': {
                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                        px: { xs: 0.5, sm: 2 },
                    }
                }}
            >
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>时段</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            日前均价
                            <br />
                            (元/MWh)
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            实时均价
                            <br />
                            (元/MWh)
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            价差
                            <br />
                            (元/MWh)
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            正差率
                            <br />
                            (%)
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>建议操作</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {analysisData.map((row) => (
                        <TableRow key={row.period_name} hover>
                            <TableCell component="th" scope="row" sx={{ fontWeight: 'medium' }}>
                                {row.period_name}
                            </TableCell>
                            <TableCell align="right">
                                {row.avg_price_da !== null ? row.avg_price_da.toFixed(2) : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                                {row.avg_price_rt !== null ? row.avg_price_rt.toFixed(2) : 'N/A'}
                            </TableCell>
                            <TableCell
                                align="right"
                                sx={{
                                    color: row.avg_spread && row.avg_spread > 0 ? 'error.main' : 'success.main',
                                    fontWeight: 'bold'
                                }}
                            >
                                {row.avg_spread !== null ? row.avg_spread.toFixed(2) : 'N/A'}
                            </TableCell>
                            <TableCell align="right">
                                {row.positive_spread_ratio !== null ? row.positive_spread_ratio.toFixed(1) : 'N/A'}
                            </TableCell>
                            <TableCell
                                align="center"
                                sx={{
                                    fontWeight: 'bold',
                                    color: row.suggestion === '做多' ? 'error.main' :
                                        row.suggestion === '做空' ? 'success.main' :
                                            'text.secondary'
                                }}
                            >
                                {row.suggestion}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

// Props接口
interface MarketDashboardTabProps {
    selectedDate: Date | null;
    onDateShift?: (days: number) => void;
}

// 主组件
export const MarketDashboardTab: React.FC<MarketDashboardTabProps> = ({ selectedDate, onDateShift }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DashboardData | null>(null);
    const [spreadData, setSpreadData] = useState<SpreadAnalysisData>({
        time_series: [],
        systematic_bias: [],
        price_distribution: []
    });
    const dashboardCacheRef = useRef<Map<string, DashboardData>>(new Map());
    const spreadCacheRef = useRef<Map<string, SpreadAnalysisData>>(new Map());

    // 加载Dashboard数据(带缓存)
    useEffect(() => {
        if (!selectedDate) return;
        const controller = new AbortController();
        let active = true;

        const fetchData = async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const cachedDashboard = dashboardCacheRef.current.get(dateStr);

            if (cachedDashboard) {
                setData(cachedDashboard);
                setError(null);
                return;
            }

            setLoading(true);
            setError(null);
            try {
                const response = await apiClient.get<DashboardData>('/api/v1/market-analysis/dashboard', {
                    params: { date_str: dateStr },
                    signal: controller.signal,
                });
                if (!active) {
                    return;
                }
                const nextData = response.data;
                const timeSeriesData = nextData.time_series;
                if (timeSeriesData && timeSeriesData.length > 0) {
                    const firstPoint = timeSeriesData[0];
                    if (firstPoint.time_str !== '00:15') {
                        console.warn(`数据起点不正确: ${firstPoint.time_str}，应为 00:15`);
                    }
                    if (timeSeriesData.length !== 96) {
                        console.warn(`数据点数量不正确: ${timeSeriesData.length}，应为 96`);
                    }
                }

                setData(nextData);
                dashboardCacheRef.current.set(dateStr, nextData);
            } catch (err: any) {
                if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
                    return;
                }
                if (!active) {
                    return;
                }
                if (typeof err.response?.data?.detail === 'string') {
                    setError(err.response.data.detail);
                } else if (err instanceof Error) {
                    setError(err.message);
                } else if (typeof err === 'object' && err !== null) {
                    setError(JSON.stringify(err));
                } else {
                    setError('加载数据失败，发生未知错误');
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void fetchData();
        return () => {
            active = false;
            controller.abort();
        };
    }, [selectedDate]);

    // 加载价差归因数据(带缓存)
    useEffect(() => {
        if (!selectedDate) return;
        const controller = new AbortController();
        let active = true;

        const fetchSpreadData = async () => {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const cachedSpread = spreadCacheRef.current.get(dateStr);

            if (cachedSpread) {
                setSpreadData(cachedSpread);
                return;
            }

            try {
                const response = await apiClient.get('/api/v1/market-analysis/spread-attribution', {
                    params: { date: dateStr },
                    signal: controller.signal,
                });
                if (!active) {
                    return;
                }
                setSpreadData(response.data);
                spreadCacheRef.current.set(dateStr, response.data);
            } catch (err: any) {
                if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
                    return;
                }
                if (!active) {
                    return;
                }
                console.error('Error fetching spread analysis data:', err);
                setSpreadData({ time_series: [], systematic_bias: [], price_distribution: [] });
            }
        };

        void fetchSpreadData();
        return () => {
            active = false;
            controller.abort();
        };
    }, [selectedDate]);

    return (
        <Box>

            {/* 首次加载显示完整的 loading */}
            {loading && !data ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                </Alert>
            ) : data ? (
                <Box sx={{ position: 'relative' }}>
                    {/* 数据加载时的覆盖层 */}
                    {loading && (
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                zIndex: 1000
                            }}
                        >
                            <CircularProgress />
                        </Box>
                    )}

                    {/* 市场价格描述面板 */}
                    <MarketPriceSummaryPanel
                        financial_kpis={data.financial_kpis}
                        risk_kpis={data.risk_kpis}
                        time_series={data.time_series}
                    />

                    <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                        {/* 价格曲线图 */}
                        <Grid size={{ xs: 12 }}>
                            <PriceChart data={data.time_series} dateStr={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''} onDateShift={onDateShift} />
                        </Grid>

                        {/* 价格偏差主图和价差分布直方图 */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <PriceSpreadChart data={spreadData.time_series} dateStr={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''} onDateShift={onDateShift} />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <PriceDistributionChart data={spreadData.price_distribution} dateStr={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''} onDateShift={onDateShift} />
                        </Grid>

                        {/* 时段价格分析表格 */}
                        <Grid size={{ xs: 12 }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 2 }}>
                                时段价格分析
                            </Typography>
                            <PeriodPriceAnalysisTable
                                periodSummary={data.period_summary}
                                timeSeries={data.time_series}
                            />
                        </Grid>
                    </Grid>
                </Box>
            ) : null}
        </Box>
    );
};
