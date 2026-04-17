/**
 * 中长期趋势分析 - Tab3: 电量结构
 * 
 * 功能：
 * 1. 蓝色渐变消息提示框（电量汇总）
 * 2. 堆叠柱状图（可切换按周期/按类型分色，X轴为日期）
 * 3. 电量占比双饼图（左:按周期，右:按类型）
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Chip
} from '@mui/material';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    ReferenceArea
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { contractPriceTrendApi, QuantityStructureResponse } from '../../api/contractPriceTrend';
import { format } from 'date-fns';

// Props 接口
interface QuantityStructureTabProps {
    startDate: Date | null;
    endDate: Date | null;
    dateRange: string;
}

// 颜色配置
const PERIOD_COLORS: { [key: string]: string } = {
    '年度': '#1976d2',
    '月度': '#43a047',
    '月内': '#ff9800'
};

const TYPE_COLORS: { [key: string]: string } = {
    '市场化': '#1976d2',
    '绿电': '#43a047',
    '代购电': '#ff9800'
};

// 分色模式
type ColorMode = 'period' | 'type';

// 蓝色渐变消息提示框
const SummaryPanel: React.FC<{
    totalQuantity: number;
    periodTotals: { [key: string]: number };
    typeTotals: { [key: string]: number };
    dayCount: number;
}> = ({ totalQuantity, periodTotals, typeTotals, dayCount }) => {
    const periodRatios = Object.entries(periodTotals)
        .filter(([_, v]) => v > 0)
        .map(([name, value]) => ({
            name,
            ratio: totalQuantity > 0 ? (value / totalQuantity) * 100 : 0
        }));

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
                <Box component="span" sx={{ fontWeight: 'bold', mr: 1 }}>[电量结构]</Box>
                {dayCount}天总电量 {totalQuantity.toLocaleString()} MWh
                {periodRatios.length > 0 && (
                    <>
                        ，{periodRatios.map((p, i) => (
                            <span key={p.name}>
                                {p.name}占比 {p.ratio.toFixed(1)}%{i < periodRatios.length - 1 ? '、' : ''}
                            </span>
                        ))}
                    </>
                )}
            </Typography>
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

// 堆叠柱状图
const StackedBarChart: React.FC<{
    data: QuantityStructureResponse;
    colorMode: ColorMode;
    dateRange: string;
}> = ({ data, colorMode, dateRange }) => {
    const chartRef = useRef<HTMLDivElement>(null);

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } =
        useChartFullscreen({
            chartRef,
            title: `电量结构 (${dateRange})`
        });

    // 构建图表数据
    const chartData = useMemo(() => {
        if (colorMode === 'period') {
            return data.daily_quantities.map(d => ({
                date: d.date,
                '年度': d.yearly_qty,
                '月度': d.monthly_qty,
                '月内': d.within_month_qty
            }));
        } else {
            return data.daily_quantities.map(d => ({
                date: d.date,
                '市场化': d.market_qty,
                '绿电': d.green_qty,
                '代购电': d.agency_qty
            }));
        }
    }, [data, colorMode]);

    const hasData = chartData.length > 0;
    const colors = colorMode === 'period' ? PERIOD_COLORS : TYPE_COLORS;
    const stackKeys = colorMode === 'period'
        ? ['年度', '月度', '月内']
        : ['市场化', '绿电', '代购电'];

    return (
        <Paper
            variant="outlined"
            sx={{
                p: { xs: 1, sm: 2 },
                width: '100%',
                height: { xs: 'auto', md: '100%' },
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
            }}
        >
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                电量结构趋势
            </Typography>
            <Box
                ref={chartRef}
                sx={{
                    flex: { xs: 'none', md: 1 },
                    height: { xs: 320, md: '100%' },
                    minHeight: { xs: 320, md: 0 },
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
                        <Typography color="text.secondary">暂无电量数据</Typography>
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 20, right: 20, left: 8, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        {renderWeekendReferenceAreas(data.date_range)}
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis
                            label={{ value: '电量 (MWh)', angle: -90, position: 'insideLeft' }}
                            tick={{ fontSize: 12 }}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
                                    return (
                                        <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
                                            <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                日期: {label}
                                            </Typography>
                                            {payload.map((pld: any) => (
                                                <Typography key={pld.dataKey} variant="body2" sx={{ color: pld.fill }}>
                                                    {pld.name}: {pld.value?.toFixed(2)} MWh
                                                </Typography>
                                            ))}
                                            <Typography variant="body2" sx={{ fontWeight: 'bold', mt: 1, borderTop: '1px solid #ccc', pt: 1 }}>
                                                合计: {total.toFixed(2)} MWh
                                            </Typography>
                                        </Paper>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend />

                        {stackKeys.map(key => (
                            <Bar
                                key={key}
                                dataKey={key}
                                stackId="a"
                                fill={colors[key]}
                                name={key}
                            />
                        ))}
                    </BarChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );
};

// 饼图组件
const QuantityPieChart: React.FC<{
    data: { name: string; value: number; color: string }[];
    title: string;
}> = ({ data, title }) => {
    const total = data.reduce((sum, d) => sum + d.value, 0);

    return (
        <Paper
            variant="outlined"
            sx={{
                p: { xs: 1, sm: 2 },
                width: '100%',
                height: { xs: 'auto', md: '100%' },
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
            }}
        >
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', textAlign: 'center', mb: 1 }}>
                {title}
            </Typography>
            <Box sx={{ flex: { xs: 'none', md: 1 }, height: { xs: 220, md: '100%' }, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ percent }: any) => `${((percent || 0) * 100).toFixed(1)}%`}
                            outerRadius={58}
                            dataKey="value"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => [`${value.toFixed(2)} MWh`, '电量']}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                {data.map(d => (
                    <Box key={d.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 12, height: 12, backgroundColor: d.color, borderRadius: '50%' }} />
                        <Typography variant="caption">
                            {d.name}: {total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Paper>
    );
};

// 主组件
export const QuantityStructureTab: React.FC<QuantityStructureTabProps> = ({
    startDate,
    endDate,
    dateRange
}) => {
    const [data, setData] = useState<QuantityStructureResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [colorMode, setColorMode] = useState<ColorMode>('period');

    // 加载数据
    useEffect(() => {
        const fetchData = async () => {
            if (!startDate || !endDate) return;

            setLoading(true);
            setError(null);

            try {
                const response = await contractPriceTrendApi.fetchQuantityStructure({
                    start_date: format(startDate, 'yyyy-MM-dd'),
                    end_date: format(endDate, 'yyyy-MM-dd')
                });
                setData(response.data);
            } catch (err: any) {
                console.error('Error fetching quantity structure:', err);
                setError(err.response?.data?.detail || err.message || '加载数据失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [startDate, endDate]);

    // 计算饼图数据
    const periodPieData = useMemo(() => {
        if (!data?.period_totals) return [];
        return Object.entries(data.period_totals)
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({
                name,
                value,
                color: PERIOD_COLORS[name] || '#999'
            }));
    }, [data]);

    const typePieData = useMemo(() => {
        if (!data?.type_totals) return [];
        return Object.entries(data.type_totals)
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({
                name,
                value,
                color: TYPE_COLORS[name] || '#999'
            }));
    }, [data]);

    // 首次加载
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
        <Box sx={{ position: 'relative', height: { xs: 'auto', md: '100%' }, minHeight: 0, display: 'flex', flexDirection: 'column', gap: { xs: 1, md: 1.5 } }}>
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
                totalQuantity={data.total_quantity}
                periodTotals={data.period_totals}
                typeTotals={data.type_totals}
                dayCount={data.date_range.length}
            />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>分色维度:</Typography>
                <Chip
                    label="按周期"
                    size="small"
                    onClick={() => setColorMode('period')}
                    sx={{
                        backgroundColor: colorMode === 'period' ? '#1976d2' : 'transparent',
                        color: colorMode === 'period' ? 'white' : 'text.primary',
                        border: `1px solid ${colorMode === 'period' ? '#1976d2' : '#ccc'}`,
                        fontWeight: colorMode === 'period' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                />
                <Chip
                    label="按类型"
                    size="small"
                    onClick={() => setColorMode('type')}
                    sx={{
                        backgroundColor: colorMode === 'type' ? '#1976d2' : 'transparent',
                        color: colorMode === 'type' ? 'white' : 'text.primary',
                        border: `1px solid ${colorMode === 'type' ? '#1976d2' : '#ccc'}`,
                        fontWeight: colorMode === 'type' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                />
            </Box>

            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    gap: { xs: 1, sm: 2 },
                    overflow: { xs: 'visible', md: 'hidden' }
                }}
            >
                <Box
                    sx={{
                        width: { xs: '100%', md: '70%' },
                        flex: { xs: 'none', md: '0 0 70%' },
                        minHeight: 0,
                        display: 'flex'
                    }}
                >
                    <StackedBarChart
                        data={data}
                        colorMode={colorMode}
                        dateRange={dateRange}
                    />
                </Box>
                <Box
                    sx={{
                        width: { xs: '100%', md: '30%' },
                        flex: { xs: 'none', md: '0 0 30%' },
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        gap: { xs: 1, sm: 2 }
                    }}
                >
                    <Box sx={{ flex: 1, minHeight: { xs: 220, md: 0 }, display: 'flex' }}>
                        <QuantityPieChart data={periodPieData} title="按交易周期" />
                    </Box>
                    <Box sx={{ flex: 1, minHeight: { xs: 220, md: 0 }, display: 'flex' }}>
                        <QuantityPieChart data={typePieData} title="按合同类型" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
