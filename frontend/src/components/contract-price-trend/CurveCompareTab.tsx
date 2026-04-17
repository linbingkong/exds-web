/**
 * 中长期趋势分析 - Tab2: 曲线分析
 * 
 * 功能：
 * 1. 蓝色渐变消息提示框（曲线分析汇总）
 * 2. 筛选控件（紧凑按钮式布局，按类型分组）
 * 3. 多曲线叠加图表（日均价格曲线）
 * 
 * 支持多类型合同曲线：市场化、绿电、代理购电
 */
import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Chip,
    Grid
} from '@mui/material';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ReferenceArea
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { contractPriceTrendApi, CurveAnalysisResponse, CurveData } from '../../api/contractPriceTrend';
import { format } from 'date-fns';

// Props 接口
interface CurveCompareTabProps {
    startDate: Date | null;
    endDate: Date | null;
    spotBenchmark: 'day_ahead' | 'real_time';
    dateRange: string;  // 显示用，如 "2024-11-01 ~ 2024-11-30"
}

// 类型分组配置
const TYPE_CONFIG: { [key: string]: { label: string; color: string } } = {
    '市场化': { label: '市场化', color: '#1976d2' },
    '绿电': { label: '绿电', color: '#43a047' },
    '代理购电': { label: '代购电', color: '#ff9800' }
};

// 蓝色渐变消息提示框
const SummaryPanel: React.FC<{
    selectedCurves: string[];
    showSpot: boolean;
    spotLabel: string;
    curveLabels: { [key: string]: string };
}> = ({ selectedCurves, showSpot, spotLabel, curveLabels }) => {
    const curveCount = selectedCurves.length + (showSpot ? 1 : 0);
    const selectedLabels = selectedCurves.map(key => curveLabels[key] || key);

    return (
        <Paper
            variant="outlined"
            sx={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                p: 2,
                borderRadius: 2,
                boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)',
                border: 'none'
            }}
        >
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
                <Box component="span" sx={{ fontWeight: 'bold', mr: 1 }}>[曲线分析]</Box>
                当前显示 {curveCount} 条曲线
                {showSpot && ` (含${spotLabel}基准)`}
            </Typography>
        </Paper>
    );
};

// 筛选面板
const FilterPanel: React.FC<{
    curves: CurveData[];
    selectedCurves: string[];
    onSelectedCurvesChange: (curves: string[]) => void;
    showSpot: boolean;
    onShowSpotChange: (show: boolean) => void;
    spotLabel: string;
}> = ({ curves, selectedCurves, onSelectedCurvesChange, showSpot, onShowSpotChange, spotLabel }) => {

    const toggleCurve = (key: string) => {
        if (selectedCurves.includes(key)) {
            onSelectedCurvesChange(selectedCurves.filter(k => k !== key));
        } else {
            onSelectedCurvesChange([...selectedCurves, key]);
        }
    };

    // 按类型分组曲线
    const groupedCurves = curves.reduce((acc, curve) => {
        const type = curve.contract_type;
        if (!acc[type]) acc[type] = [];
        acc[type].push(curve);
        return acc;
    }, {} as { [key: string]: CurveData[] });

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            {/* 合同类型曲线选择 */}
            <Box sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: { xs: 1.5, md: 3 },
                flexWrap: 'wrap'
            }}>
                {Object.entries(groupedCurves).map(([typeName, typeCurves]) => {
                    if (typeCurves.length === 0) return null;
                    const typeConfig = TYPE_CONFIG[typeName] || { label: typeName, color: '#999' };

                    return (
                        <Box
                            key={typeName}
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                        >
                            <Typography
                                variant="body2"
                                sx={{
                                    fontWeight: 'bold',
                                    color: typeConfig.color,
                                    minWidth: { xs: 55, md: 'auto' },
                                    flexShrink: 0
                                }}
                            >
                                {typeConfig.label}
                            </Typography>

                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {typeCurves.map(curve => {
                                    const isSelected = selectedCurves.includes(curve.key);
                                    return (
                                        <Chip
                                            key={curve.key}
                                            label={curve.contract_period}
                                            size="small"
                                            onClick={() => toggleCurve(curve.key)}
                                            sx={{
                                                backgroundColor: isSelected ? curve.color : 'transparent',
                                                color: isSelected ? 'white' : 'text.primary',
                                                border: `1px solid ${isSelected ? curve.color : '#ccc'}`,
                                                fontWeight: isSelected ? 'bold' : 'normal',
                                                cursor: 'pointer',
                                                '&:hover': {
                                                    backgroundColor: isSelected ? curve.color : 'action.hover',
                                                    opacity: isSelected ? 0.9 : 1
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            {/* 现货曲线开关 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 1.5, mt: 1.5, borderTop: '1px dashed', borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#f44336', minWidth: { xs: 55, md: 'auto' }, flexShrink: 0 }}>
                    现货
                </Typography>
                <Chip
                    label={spotLabel}
                    size="small"
                    onClick={() => onShowSpotChange(!showSpot)}
                    sx={{
                        backgroundColor: showSpot ? '#f44336' : 'transparent',
                        color: showSpot ? 'white' : 'text.primary',
                        border: `1px solid ${showSpot ? '#f44336' : '#ccc'}`,
                        fontWeight: showSpot ? 'bold' : 'normal',
                        cursor: 'pointer',
                        '&:hover': {
                            backgroundColor: showSpot ? '#f44336' : 'action.hover',
                            opacity: showSpot ? 0.9 : 1
                        }
                    }}
                />
            </Box>
        </Paper>
    );
};

// 辅助函数：渲染周末背景标记
const renderWeekendReferenceAreas = (dateRange: string[]) => {
    if (!dateRange || dateRange.length === 0) return null;
    return dateRange.map((dateStr, index) => {
        const date = new Date(dateStr);
        const day = date.getDay();
        if (day === 0 || day === 6) {
            return (
                <ReferenceArea
                    key={`weekend-${index}`}
                    x1={dateStr}
                    x2={dateStr}
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

const buildDailyChartData = (data: CurveAnalysisResponse, selectedCurves: string[], showSpot: boolean) => {
    return data.date_range.map(date => {
        const point: any = { date };

        data.curves.forEach(curve => {
            if (selectedCurves.includes(curve.key)) {
                const curvePoint = curve.points.find(p => p.date === date);
                point[curve.key] = curvePoint?.vwap ?? null;
            }
        });

        if (showSpot) {
            const spotPoint = data.spot_curve.points.find(p => p.date === date);
            point.spot = spotPoint?.vwap ?? null;
        }

        return point;
    });
};

const buildPeriod48ChartData = (data: CurveAnalysisResponse, selectedCurves: string[], showSpot: boolean) => {
    return Array.from({ length: 48 }, (_, index) => {
        const period = index + 1;
        const point: any = { period, label: `${period}`.padStart(2, '0') };

        data.curves.forEach(curve => {
            if (selectedCurves.includes(curve.key)) {
                const curvePoint = curve.period_48_points.find(p => p.period === period);
                point[curve.key] = curvePoint?.vwap ?? null;
            }
        });

        if (showSpot) {
            const spotPoint = data.spot_curve.period_48_points.find(p => p.period === period);
            point.spot = spotPoint?.vwap ?? null;
        }

        return point;
    });
};

const getCurveConfig = (data: CurveAnalysisResponse, key: string): { color: string; label: string } => {
    const curve = data.curves.find(c => c.key === key);
    if (curve) {
        return { color: curve.color, label: curve.label };
    }
    return { color: '#999', label: key };
};

const calcYDomain = (chartData: any[], xKey: string) => {
    const allPrices: number[] = [];
    chartData.forEach(row => {
        Object.keys(row).forEach(key => {
            if (key !== xKey && row[key] !== null && row[key] !== undefined) {
                allPrices.push(row[key]);
            }
        });
    });

    if (allPrices.length === 0) {
        return [0, 500];
    }

    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    return [Math.floor(minPrice * 0.95), Math.ceil(maxPrice * 1.05)];
};

// 多曲线日均图表
const DailyCurveChart: React.FC<{
    data: CurveAnalysisResponse;
    selectedCurves: string[];
    showSpot: boolean;
    dateRange: string;
}> = ({ data, selectedCurves, showSpot, dateRange }) => {
    const chartRef = useRef<HTMLDivElement>(null);

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } =
        useChartFullscreen({
            chartRef,
            title: `日均价格曲线 (${dateRange})`
        });

    const chartData = buildDailyChartData(data, selectedCurves, showSpot);
    const yDomain = calcYDomain(chartData, 'date');

    const hasData = chartData.length > 0 && (selectedCurves.length > 0 || showSpot);

    return (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Typography variant="h6" gutterBottom>日均价格曲线</Typography>
            <Box
                ref={chartRef}
                sx={{
                    height: { xs: 360, md: '100%' },
                    minHeight: { xs: 360, md: 0 },
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
                    }),
                    '& .recharts-surface:focus': { outline: 'none' },
                    '& *:focus': { outline: 'none !important' }
                }}
            >
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />

                {!hasData ? (
                    <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography color="text.secondary">请选择至少一条曲线</Typography>
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            {renderWeekendReferenceAreas(data.date_range)}
                            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                            <YAxis
                                domain={yDomain}
                                label={{ value: '价格 (元/MWh)', angle: -90, position: 'insideLeft' }}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        return (
                                            <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc', borderRadius: '4px' }}>
                                                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                    日期: {label}
                                                </Typography>
                                                {payload.map((pld: any) => (
                                                    <Typography key={pld.dataKey} variant="body2" sx={{ color: pld.color }}>
                                                        {pld.name}: {pld.value !== null ? `${Number(pld.value).toFixed(2)} 元/MWh` : 'N/A'}
                                                    </Typography>
                                                ))}
                                            </Paper>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Legend />

                            {/* 合同曲线 */}
                            {selectedCurves.map(key => {
                                const config = getCurveConfig(data, key);
                                return (
                                    <Line
                                        key={key}
                                        type="monotone"
                                        dataKey={key}
                                        stroke={config.color}
                                        strokeWidth={2}
                                        name={config.label}
                                        dot={false}
                                        connectNulls
                                    />
                                );
                            })}

                            {/* 现货曲线 */}
                            {showSpot && (
                                <Line
                                    type="monotone"
                                    dataKey="spot"
                                    stroke={data.spot_curve.color}
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    name={data.spot_curve.label}
                                    dot={false}
                                    connectNulls
                                />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );
};

const Period48CurveChart: React.FC<{
    data: CurveAnalysisResponse;
    selectedCurves: string[];
    showSpot: boolean;
    dateRange: string;
}> = ({ data, selectedCurves, showSpot, dateRange }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } =
        useChartFullscreen({
            chartRef,
            title: `48时段均价曲线 (${dateRange})`
        });

    const chartData = buildPeriod48ChartData(data, selectedCurves, showSpot);
    const yDomain = calcYDomain(chartData, 'label');
    const hasData = chartData.length > 0 && (selectedCurves.length > 0 || showSpot);

    return (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Typography variant="h6" gutterBottom>48时段均价曲线</Typography>
            <Box
                ref={chartRef}
                sx={{
                    height: { xs: 360, md: '100%' },
                    minHeight: { xs: 360, md: 0 },
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
                    }),
                    '& .recharts-surface:focus': { outline: 'none' },
                    '& *:focus': { outline: 'none !important' }
                }}
            >
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />

                {!hasData ? (
                    <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography color="text.secondary">请选择至少一条曲线</Typography>
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={1} minTickGap={2} />
                            <YAxis
                                domain={yDomain}
                                label={{ value: '价格 (元/MWh)', angle: -90, position: 'insideLeft' }}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        return (
                                            <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc', borderRadius: '4px' }}>
                                                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                    时段: {label}
                                                </Typography>
                                                {payload.map((pld: any) => (
                                                    <Typography key={pld.dataKey} variant="body2" sx={{ color: pld.color }}>
                                                        {pld.name}: {pld.value !== null ? `${Number(pld.value).toFixed(2)} 元/MWh` : 'N/A'}
                                                    </Typography>
                                                ))}
                                            </Paper>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Legend />

                            {selectedCurves.map(key => {
                                const config = getCurveConfig(data, key);
                                return (
                                    <Line
                                        key={key}
                                        type="monotone"
                                        dataKey={key}
                                        stroke={config.color}
                                        strokeWidth={2}
                                        name={config.label}
                                        dot={false}
                                        connectNulls
                                    />
                                );
                            })}

                            {showSpot && (
                                <Line
                                    type="monotone"
                                    dataKey="spot"
                                    stroke={data.spot_curve.color}
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    name={data.spot_curve.label}
                                    dot={false}
                                    connectNulls
                                />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );
};

// 主组件
export const CurveCompareTab: React.FC<CurveCompareTabProps> = ({
    startDate,
    endDate,
    spotBenchmark,
    dateRange
}) => {
    const [data, setData] = useState<CurveAnalysisResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedCurves, setSelectedCurves] = useState<string[]>(['市场化-月内']);
    const [showSpot, setShowSpot] = useState<boolean>(true);

    const spotLabel = spotBenchmark === 'day_ahead' ? '日前现货' : '实时现货';

    // 获取曲线标签映射
    const curveLabels: { [key: string]: string } = {};
    if (data) {
        data.curves.forEach(c => {
            curveLabels[c.key] = c.label;
        });
    }

    // 加载数据
    useEffect(() => {
        const fetchData = async () => {
            if (!startDate || !endDate) return;

            setLoading(true);
            setError(null);

            try {
                const response = await contractPriceTrendApi.fetchCurveAnalysis({
                    start_date: format(startDate, 'yyyy-MM-dd'),
                    end_date: format(endDate, 'yyyy-MM-dd'),
                    spot_type: spotBenchmark
                });
                setData(response.data);
            } catch (err: any) {
                console.error('Error fetching curve analysis:', err);
                setError(err.response?.data?.detail || err.message || '加载数据失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [startDate, endDate, spotBenchmark]);

    if (loading && !data) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>;
    }

    if (!data) {
        return <Alert severity="info" sx={{ mt: 2 }}>请选择日期范围查看数据</Alert>;
    }

    return (
        <Box sx={{ position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: { xs: 1, md: 1.5 } }}>
            {loading && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
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

            <SummaryPanel
                selectedCurves={selectedCurves}
                showSpot={showSpot}
                spotLabel={spotLabel}
                curveLabels={curveLabels}
            />

            <FilterPanel
                curves={data.curves}
                selectedCurves={selectedCurves}
                onSelectedCurvesChange={setSelectedCurves}
                showSpot={showSpot}
                onShowSpotChange={setShowSpot}
                spotLabel={spotLabel}
            />

            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ flex: 1, minHeight: 0, alignItems: 'stretch', width: '100%' }}>
                <Grid size={{ xs: 12, md: 6 }} sx={{ display: 'flex', minHeight: 0, width: '100%' }}>
                    <DailyCurveChart
                        data={data}
                        selectedCurves={selectedCurves}
                        showSpot={showSpot}
                        dateRange={dateRange}
                    />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }} sx={{ display: 'flex', minHeight: 0, width: '100%' }}>
                    <Period48CurveChart
                        data={data}
                        selectedCurves={selectedCurves}
                        showSpot={showSpot}
                        dateRange={dateRange}
                    />
                </Grid>
            </Grid>
        </Box>
    );
};
