import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    IconButton,
    Tabs,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Checkbox,
    Button,
    CircularProgress,
    Alert,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { addDays, format, differenceInDays, isWeekend } from 'date-fns';

import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';

// ============ 类型定义 ============
interface TimeSeriesDataPoint {
    time: string;
    value: number;
    timestamp: string;
}

interface CurveData {
    data_item_id: number;
    data_item_name: string;
    date: string;
    data: TimeSeriesDataPoint[];
    total_points: number;
    completeness: number;
}

interface DataAvailabilityCell {
    data_item_id: number;
    date: string;
    is_available: boolean;
    sample_timestamp: string | null;
}

interface DataAvailabilityResponse {
    base_date: string;
    date_range: string[];
    availability_matrix: DataAvailabilityCell[][];
}

interface AccuracyResult {
    key: string;
    name: string;
    value: string;
    sortKey: string; // format: yyyyMMdd_{order}
}

// ============ 数据项配置 ============
const DATA_ITEMS_CONFIG = {
    weekly: [
        { id: 1, name: '次周系统负荷预测', shortName: '周负荷', unifiedName: '系统负荷' },
        { id: 3, name: '次周风电预测', shortName: '周风电', unifiedName: '风电出力' },
        { id: 2, name: '次周光伏预测', shortName: '周光伏', unifiedName: '光伏出力' },
        { id: 4, name: '次周水电(含抽蓄)预测', shortName: '周水电', unifiedName: '水电抽蓄' },
        { id: 5, name: '次周联络线可用容量', shortName: '周联络', unifiedName: '联络线' },
    ],
    daily: [
        { id: 6, name: '短期系统负荷预测', shortName: '日负荷', desktopName: '短期系统负荷预测', unifiedName: '系统负荷' },
        { id: 8, name: '短期风电预测', shortName: '日风电', unifiedName: '风电出力' },
        { id: 7, name: '短期光伏预测', shortName: '日光伏', unifiedName: '光伏出力' },
        { id: 9, name: '非市场化机组预测', shortName: '日水电', desktopName: '非市场化机组预测', unifiedName: '水电抽蓄' },
        { id: 10, name: '联络线总计划', shortName: '日联络', unifiedName: '联络线' },
    ],
    realtime: [
        { id: 11, name: '实际系统负荷', shortName: '实负荷', desktopName: '实际系统负荷', unifiedName: '系统负荷' },
        { id: 12, name: '实际风电出力', shortName: '实风电', desktopName: '实际风电出力', unifiedName: '风电出力' },
        { id: 13, name: '实际光伏出力', shortName: '实光伏', desktopName: '实际光伏出力', unifiedName: '光伏出力' },
        { id: 14, name: '实际水电(含抽蓄)出力', shortName: '实水电', desktopName: '实际水电(含抽蓄)出力', unifiedName: '水电抽蓄' },
        { id: 15, name: '联络线潮流', shortName: '实联络', desktopName: '联络线潮流', unifiedName: '联络线' },
    ],
};

// 图表颜色
const CHART_COLORS = [
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff7300',
    '#0088fe',
    '#00c49f',
    '#ffbb28',
    '#ff8042',
    '#a4de6c',
    '#d0ed57',
];

// ============ 独立的图表组件（使用 React.memo 避免不必要的重新渲染）============
interface ChartComponentProps {
    chartRef: React.RefObject<HTMLDivElement | null>;
    chartData: any[];
    curvesData: CurveData[];
    loadingCurves: boolean;
    isMobile: boolean;
    isFullscreen: boolean;
    FullscreenEnterButton: React.ComponentType;
    FullscreenExitButton: React.ComponentType;
    FullscreenTitle: React.ComponentType;
    NavigationButtons: React.ComponentType;
    getDataItemName: (dataItemId: number) => string;
    getForecastTypePrefix: (dataItemId: number) => string;
}

const ChartComponent = React.memo<ChartComponentProps>(({
    chartRef,
    chartData,
    curvesData,
    loadingCurves,
    isMobile,
    isFullscreen,
    FullscreenEnterButton,
    FullscreenExitButton,
    FullscreenTitle,
    NavigationButtons,
    getDataItemName,
    getForecastTypePrefix,
}) => {
    return (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
                96点数据对比分析
            </Typography>

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
                        zIndex: 1400,
                    }),
                }}
            >
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />
                <NavigationButtons />

                {loadingCurves && (
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
                            zIndex: 1000,
                        }}
                    >
                        <CircularProgress />
                    </Box>
                )}

                {curvesData.length === 0 ? (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Typography color="text.secondary">
                            请在上方表格中选择数据项进行对比分析
                        </Typography>
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="time"
                                tick={{ fontSize: isMobile ? 10 : 12 }}
                                interval={isMobile ? 11 : 7}
                            />
                            <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} />
                            <Tooltip
                                labelFormatter={(label) => `时间: ${label}`}
                                formatter={(value: number, name: string) => {
                                    const idx = parseInt(name.split('_')[1], 10);
                                    const curve = curvesData[idx];
                                    if (!curve) return [`${value.toFixed(2)} MW`, name];

                                    const prefix = getForecastTypePrefix(curve.data_item_id);
                                    const displayName = getDataItemName(curve.data_item_id);
                                    const curveName = `${prefix}${displayName}(${curve.date.substring(5)})`;
                                    return [`${value.toFixed(2)} MW`, curveName];
                                }}
                            />
                            <Legend
                                formatter={(value: string) => {
                                    const idx = parseInt(value.split('_')[1], 10);
                                    const curve = curvesData[idx];
                                    if (curve) {
                                        const prefix = getForecastTypePrefix(curve.data_item_id);
                                        const displayName = getDataItemName(curve.data_item_id);
                                        return `${prefix}${displayName}(${curve.date.substring(5)})`;
                                    }
                                    return value;
                                }}
                            />
                            {curvesData.map((_, idx) => (
                                <Line
                                    key={idx}
                                    type="monotone"
                                    dataKey={`curve_${idx}`}
                                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );
});

export const ForecastBaseDataPage: React.FC = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_price_baseline:edit');
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // 日期状态
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -1));

    // 移动端日期范围类型 (桌面端固定为 desktop_full_range)
    const [dateRangeType, setDateRangeType] = useState<string>('recent_3');

    // 数据类型状态 (0: 周预测, 1: 日预测, 2: 实际数据)
    const [dataType, setDataType] = useState<number>(0);

    // Loading和错误状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingCurves, setLoadingCurves] = useState(false);

    // 数据状态
    const [availabilityData, setAvailabilityData] = useState<DataAvailabilityResponse | null>(null);
    // 使用相对偏移量作为key（如 "1_-7" 表示数据项1的D-7）
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [curvesData, setCurvesData] = useState<CurveData[]>([]);
    const [accuracyResults, setAccuracyResults] = useState<AccuracyResult[]>([]);

    // 图表引用
    const chartRef = useRef<HTMLDivElement>(null);

    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 全屏 Hook
    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `96点数据对比分析 (${dateStr})`,
        onPrevious: () => handleShiftDate(-1),
        onNext: () => handleShiftDate(1),
    });

    // ============ 辅助函数 ============
    // 根据基准日期和偏移量计算实际日期
    const getActualDate = (baseDate: Date | null, offset: number): string => {
        if (!baseDate) return '';
        return format(addDays(baseDate, offset), 'yyyy-MM-dd');
    };

    // 根据基准日期和具体日期计算偏移量
    const getDateOffset = (baseDate: Date | null, actualDate: string): number => {
        if (!baseDate) return 0;
        const baseDateStr = format(baseDate, 'yyyy-MM-dd');
        return differenceInDays(new Date(actualDate), new Date(baseDateStr));
    };

    // 格式化相对日期标签 (D-10, D-1, D, D+1, D+2)
    const formatRelativeDate = (offset: number): string => {
        if (offset === 0) return 'D';
        if (offset > 0) return `D+${offset}`;
        return `D${offset}`; // 负数自带负号
    };

    // ============ API调用 ============
    const fetchAvailability = async (date: Date | null) => {
        if (!date) return;

        setLoading(true);
        setError(null);

        try {
            // 桌面端使用固定的13天范围 (D-10到D+2)
            const rangeType = isMobile ? dateRangeType : 'desktop_full_range';

            const response = await apiClient.get<DataAvailabilityResponse>(
                '/api/v1/forecast-base-data/availability',
                {
                    params: {
                        base_date: format(date, 'yyyy-MM-dd'),
                        date_range: rangeType,
                    },
                }
            );
            setAvailabilityData(response.data);
        } catch (err: any) {
            const errorMessage =
                err.response?.data?.detail || err.message || '加载数据可用性失败';
            setError(errorMessage);
            console.error('加载数据可用性失败:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchCurves = async (baseDate: Date | null) => {
        if (!canEdit) {
            setCurvesData([]);
            return;
        }
        if (!baseDate) return;

        const selectedKeys = Object.keys(selectedItems).filter((key) => selectedItems[key]);

        if (selectedKeys.length === 0) {
            setCurvesData([]);
            return;
        }

        setLoadingCurves(true);

        try {
            // 将相对偏移量转换为实际日期
            const requests = selectedKeys.map((key) => {
                const [dataItemId, offsetStr] = key.split('_');
                const offset = parseInt(offsetStr, 10);
                const actualDate = getActualDate(baseDate, offset);
                return { data_item_id: parseInt(dataItemId, 10), date: actualDate };
            });

            const response = await apiClient.post('/api/v1/forecast-base-data/curves', requests);
            setCurvesData(response.data.curves);
        } catch (err: any) {
            console.error('加载曲线数据失败:', err);
        } finally {
            setLoadingCurves(false);
        }
    };

    // ============ 副作用 ============
    useEffect(() => {
        fetchAvailability(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, dateRangeType, isMobile]);

    useEffect(() => {
        fetchCurves(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedItems, selectedDate]);

    // ============ 事件处理 ============
    const handleShiftDate = (days: number) => {
        if (!selectedDate || loading) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
        // 注意：selectedItems 使用相对偏移量，不需要更新
    };

    const handleCheckboxToggle = (dataItemId: number, offset: number) => {
        if (!canEdit) return;
        const key = `${dataItemId}_${offset}`;
        setSelectedItems((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleClearSelection = () => {
        setSelectedItems({});
        setAccuracyResults([]); // Clear accuracy results when selection is cleared
    };

    const handleDataTypeChange = (_: React.SyntheticEvent, newValue: number) => {
        setDataType(newValue);
    };

    // ============ 辅助函数 ============
    const getDataItemsForType = (type: number) => {
        switch (type) {
            case 0:
                return DATA_ITEMS_CONFIG.weekly;
            case 1:
                return DATA_ITEMS_CONFIG.daily;
            case 2:
                return DATA_ITEMS_CONFIG.realtime;
            default:
                return DATA_ITEMS_CONFIG.weekly;
        }
    };

    const getDataItemName = (dataItemId: number): string => {
        const allItems = [
            ...DATA_ITEMS_CONFIG.weekly,
            ...DATA_ITEMS_CONFIG.daily,
            ...DATA_ITEMS_CONFIG.realtime,
        ];
        const item = allItems.find((i) => i.id === dataItemId);
        if (!item) return `数据项${dataItemId}`;

        // 移动端使用shortName，桌面端优先使用unifiedName
        if (isMobile) return item.shortName;
        return (item as any).unifiedName || item.name;
    };

    const getUnifiedName = (dataItemId: number): string => {
        const allItems = [
            ...DATA_ITEMS_CONFIG.weekly,
            ...DATA_ITEMS_CONFIG.daily,
            ...DATA_ITEMS_CONFIG.realtime,
        ];
        const item = allItems.find((i) => i.id === dataItemId);
        return (item as any)?.unifiedName || '';
    };

    const getForecastTypePrefix = (dataItemId: number): string => {
        if (DATA_ITEMS_CONFIG.weekly.some(i => i.id === dataItemId)) return '周';
        if (DATA_ITEMS_CONFIG.daily.some(i => i.id === dataItemId)) return '日';
        if (DATA_ITEMS_CONFIG.realtime.some(i => i.id === dataItemId)) return '实';
        return '';
    };

    // 计算准确率
    useEffect(() => {
        if (curvesData.length === 0) return;

        const newResults: AccuracyResult[] = [];

        // 1. 分组曲线数据
        const actualCurves: CurveData[] = [];
        const weeklyForecastCurves: CurveData[] = [];
        const dailyForecastCurves: CurveData[] = [];

        curvesData.forEach(curve => {
            // 实际数据 ID 11-15
            if (curve.data_item_id >= 11 && curve.data_item_id <= 15) {
                actualCurves.push(curve);
            }
            // 周预测 ID 1-5
            else if (curve.data_item_id >= 1 && curve.data_item_id <= 5) {
                weeklyForecastCurves.push(curve);
            }
            // 日预测 ID 6-10
            else if (curve.data_item_id >= 6 && curve.data_item_id <= 10) {
                dailyForecastCurves.push(curve);
            }
        });

        // 辅助函数：计算两条曲线的准确率
        const calculateAccuracy = (curve1: CurveData, curve2: CurveData): number | null => {
            let sumDiff = 0;
            let sumBase = 0;
            let count = 0;

            // 创建时间映射以加速查找
            const map1 = new Map(curve1.data.map(p => [p.time, p.value]));

            curve2.data.forEach(p => {
                if (map1.has(p.time)) {
                    const val1 = map1.get(p.time)!;
                    sumDiff += Math.abs(p.value - val1);
                    sumBase += Math.abs(val1);
                    count++;
                }
            });

            if (count > 0 && sumBase > 0) {
                return (1 - sumDiff / sumBase) * 100;
            }
            return null;
        };

        // 2. 计算预测 vs 实际的准确率
        actualCurves.forEach(actual => {
            const actualUnifiedName = getUnifiedName(actual.data_item_id);

            // 周预测 vs 实际
            weeklyForecastCurves.forEach(forecast => {
                const forecastUnifiedName = getUnifiedName(forecast.data_item_id);
                if (actual.date === forecast.date && actualUnifiedName === forecastUnifiedName) {
                    const accuracy = calculateAccuracy(actual, forecast);
                    if (accuracy !== null) {
                        const name = `周${forecastUnifiedName}准确率 (${forecast.date})`;
                        const key = `周_${forecastUnifiedName}_${forecast.date}`;
                        newResults.push({
                            key,
                            name,
                            value: `${accuracy.toFixed(2)}%`,
                            sortKey: `${forecast.date.replace(/-/g, '')}_2_${forecast.data_item_id}`
                        });
                    }
                }
            });

            // 日预测 vs 实际
            dailyForecastCurves.forEach(forecast => {
                const forecastUnifiedName = getUnifiedName(forecast.data_item_id);
                if (actual.date === forecast.date && actualUnifiedName === forecastUnifiedName) {
                    const accuracy = calculateAccuracy(actual, forecast);
                    if (accuracy !== null) {
                        const name = `日${forecastUnifiedName}准确率 (${forecast.date})`;
                        const key = `日_${forecastUnifiedName}_${forecast.date}`;
                        newResults.push({
                            key,
                            name,
                            value: `${accuracy.toFixed(2)}%`,
                            sortKey: `${forecast.date.replace(/-/g, '')}_1_${forecast.data_item_id}`
                        });
                    }
                }
            });
        });

        // 3. 计算周预测 vs 日预测的准确率
        weeklyForecastCurves.forEach(weeklyForecast => {
            const weeklyUnifiedName = getUnifiedName(weeklyForecast.data_item_id);

            dailyForecastCurves.forEach(dailyForecast => {
                const dailyUnifiedName = getUnifiedName(dailyForecast.data_item_id);

                // 匹配条件：同一天且统一名称相同
                if (weeklyForecast.date === dailyForecast.date && weeklyUnifiedName === dailyUnifiedName) {
                    const accuracy = calculateAccuracy(dailyForecast, weeklyForecast);
                    if (accuracy !== null) {
                        const name = `周日${weeklyUnifiedName}准确率 (${weeklyForecast.date})`;
                        const key = `周日_${weeklyUnifiedName}_${weeklyForecast.date}`;
                        newResults.push({
                            key,
                            name,
                            value: `${accuracy.toFixed(2)}%`,
                            sortKey: `${weeklyForecast.date.replace(/-/g, '')}_3_${weeklyForecast.data_item_id}`
                        });
                    }
                }
            });
        });

        // 4. 合并结果 (保留旧结果，更新新结果)
        if (newResults.length > 0) {
            setAccuracyResults(prev => {
                const prevMap = new Map(prev.map(r => [r.key, r]));
                newResults.forEach(r => {
                    prevMap.set(r.key, r);
                });
                return Array.from(prevMap.values());
            });
        }
    }, [curvesData]);

    const getSelectedCount = (): number => {
        return Object.values(selectedItems).filter(Boolean).length;
    };

    // 准备图表数据 - 使用 useMemo 避免不必要的重新计算
    const chartData = useMemo(() => {
        if (curvesData.length === 0) return [];

        const timeMap: Record<string, any> = {};

        curvesData.forEach((curve, idx) => {
            curve.data.forEach((point) => {
                if (!timeMap[point.time]) {
                    timeMap[point.time] = { time: point.time };
                }
                timeMap[point.time][`curve_${idx}`] = point.value;
            });
        });

        // 排序，确保24:00在最后
        return Object.values(timeMap).sort((a, b) => {
            const timeA = a.time === '24:00' ? '23:59:59' : a.time;
            const timeB = b.time === '24:00' ? '23:59:59' : b.time;
            return timeA.localeCompare(timeB);
        });
    }, [curvesData]);

    // ============ 渲染函数 ============
    const renderAvailabilityTable = () => {
        if (!availabilityData || !selectedDate) return null;

        const currentItems = getDataItemsForType(dataType);
        const dateRange = availabilityData.date_range;

        return (
            <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ overflowX: 'auto', mt: 2 }}
            >
                <Table
                    size="small"
                    sx={{
                        '& .MuiTableCell-root': {
                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                            px: { xs: 0.5, sm: 2 },
                            py: { xs: 0.5, sm: 1 },
                            borderRight: '1px solid rgba(224, 224, 224, 1)',
                        },
                        '& .MuiTableCell-head': {
                            backgroundColor: 'background.paper',
                            fontWeight: 'bold',
                        }
                    }}
                >
                    <TableHead>
                        <TableRow>
                            <TableCell
                                sx={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 2,
                                    minWidth: { xs: 100, sm: 150 },
                                    borderRight: '2px solid rgba(224, 224, 224, 1) !important',
                                }}
                            >
                                数据项
                            </TableCell>
                            {dateRange.map((date) => {
                                const isWk = isWeekend(new Date(date));
                                const offset = getDateOffset(selectedDate, date);
                                const isBaseDate = offset === 0;
                                const relativeDate = formatRelativeDate(offset);

                                let bgColor = 'background.paper';
                                if (isBaseDate) bgColor = 'rgba(25, 118, 210, 0.12)'; // Light blue for D-day
                                else if (isWk) bgColor = 'action.hover'; // Gray for weekend

                                return (
                                    <TableCell
                                        key={date}
                                        align="center"
                                        sx={{
                                            minWidth: { xs: 60, sm: 80 },
                                            backgroundColor: bgColor,
                                            color: isWk ? 'error.main' : 'text.primary',
                                        }}
                                    >
                                        <Box sx={{ fontWeight: 'bold' }}>{relativeDate}</Box>
                                        <Box>{date.substring(5)}</Box>
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {currentItems.map((item) => (
                            <TableRow key={item.id} hover>
                                <TableCell
                                    sx={{
                                        position: 'sticky',
                                        left: 0,
                                        backgroundColor: 'background.paper',
                                        zIndex: 1,
                                        fontWeight: 'bold',
                                        fontSize: '0.9rem',
                                        color: 'primary.main',
                                        borderRight: '2px solid rgba(224, 224, 224, 1) !important',
                                    }}
                                >
                                    {getDataItemName(item.id)}
                                </TableCell>
                                {dateRange.map((date) => {
                                    const offset = getDateOffset(selectedDate, date);
                                    const key = `${item.id}_${offset}`;
                                    const isSelected = !!selectedItems[key];

                                    // Find availability
                                    const cell = availabilityData.availability_matrix
                                        .find(row => row[0]?.data_item_id === item.id)
                                        ?.find(c => c.date === date);

                                    const isAvailable = cell?.is_available;
                                    const isWk = isWeekend(new Date(date));
                                    const isBaseDate = offset === 0;

                                    let bgColor = 'inherit';
                                    if (isSelected) bgColor = 'primary.light';
                                    else if (isBaseDate) bgColor = 'rgba(25, 118, 210, 0.08)';
                                    else if (isWk) bgColor = 'action.hover';

                                    return (
                                        <TableCell
                                            key={date}
                                            align="center"
                                            padding="none"
                                            sx={{
                                                backgroundColor: bgColor,
                                                cursor: isAvailable && canEdit ? 'pointer' : 'default',
                                                '&:hover': {
                                                    backgroundColor: isAvailable && canEdit ? (isSelected ? 'primary.main' : 'action.selected') : undefined
                                                }
                                            }}
                                            onClick={() => isAvailable && canEdit && handleCheckboxToggle(item.id, offset)}
                                        >
                                            {isAvailable ? (
                                                <Checkbox
                                                    checked={isSelected}
                                                    size="small"
                                                    color="primary"
                                                    disabled={!canEdit}
                                                    sx={{ p: 0 }}
                                                />
                                            ) : (
                                                <Typography variant="caption" color="text.disabled">—</Typography>
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%', p: { xs: 1, sm: 2 } }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        基础数据 / 价格基础数据
                    </Typography>
                )}

                {/* 日期选择器 */}
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="基准日期"
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

                    {/* 桌面端清空按钮 */}
                    {!isMobile && (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleClearSelection}
                            disabled={getSelectedCount() === 0}
                            sx={{ ml: 'auto' }}
                        >
                            清空选择
                        </Button>
                    )}
                </Paper>

                {/* 数据类型Tab（桌面端和移动端都显示） + 移动端日期范围切换 */}
                <Paper variant="outlined" sx={{ borderColor: 'divider', mt: 2 }}>
                    {/* 数据类型Tab */}
                    <Tabs
                        value={dataType}
                        onChange={handleDataTypeChange}
                        variant={isMobile ? 'fullWidth' : 'standard'}
                    >
                        <Tab label="周预测" />
                        <Tab label="日预测" />
                        <Tab label="实际数据" />
                    </Tabs>

                    {/* 移动端日期范围切换和清空按钮 */}
                    {isMobile && (
                        <>
                            <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
                                <Tabs
                                    value={dateRangeType}
                                    onChange={(_, newValue) => setDateRangeType(newValue)}
                                    variant="fullWidth"
                                >
                                    <Tab label="近3天" value="recent_3" />
                                    <Tab label="近7日" value="recent_7" />
                                    <Tab label="历史10日" value="historical_10" />
                                </Tabs>
                            </Box>
                            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleClearSelection}
                                    disabled={getSelectedCount() === 0}
                                    fullWidth
                                >
                                    清空选择
                                </Button>
                            </Box>
                        </>
                    )}
                </Paper>

                {/* 数据可用性表格 */}
                {loading && !availabilityData ? (
                    <Box
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        minHeight="200px"
                    >
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                ) : availabilityData ? (
                    <Box sx={{ position: 'relative' }}>
                        {/* 数据刷新时的覆盖层 */}
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
                                    zIndex: 1000,
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        {renderAvailabilityTable()}

                        {/* 图例说明 */}
                        <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Box display="flex" alignItems="center" gap={0.5}>
                                <Checkbox size="small" checked color="primary" sx={{ p: 0 }} />
                                <Typography variant="caption" color="text.secondary">已选中</Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={0.5}>
                                <Checkbox size="small" checked={false} sx={{ p: 0 }} />
                                <Typography variant="caption" color="text.secondary">可选择</Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={0.5}>
                                <Typography variant="caption" color="text.disabled">—</Typography>
                                <Typography variant="caption" color="text.secondary">无数据</Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={0.5}>
                                <Box sx={{ width: 16, height: 16, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }} />
                                <Typography variant="caption" color="text.secondary">周末</Typography>
                            </Box>
                        </Box>

                        {/* 已选数量 */}
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            已选择 {getSelectedCount()} 项数据
                        </Typography>

                        {/* 准确率显示区域 */}
                        {accuracyResults.length > 0 && (
                            <Paper
                                variant="outlined"
                                sx={{
                                    mt: 2,
                                    p: 1.5,
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 2,
                                    backgroundColor: 'rgba(25, 118, 210, 0.04)',
                                    borderColor: 'rgba(25, 118, 210, 0.2)'
                                }}
                            >
                                {accuracyResults.map((result) => (
                                    <Box
                                        key={result.key}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                            px: 1,
                                            py: 0.5,
                                            backgroundColor: 'background.paper'
                                        }}
                                    >
                                        <Typography variant="body2" color="text.secondary">
                                            {result.name}:
                                        </Typography>
                                        <Typography variant="body2" fontWeight="bold" color="primary">
                                            {result.value}
                                        </Typography>
                                    </Box>
                                ))}
                            </Paper>
                        )}

                        {/* 96点曲线图 */}
                        <ChartComponent
                            chartRef={chartRef}
                            chartData={chartData}
                            curvesData={curvesData}
                            loadingCurves={loadingCurves}
                            isMobile={isMobile}
                            isFullscreen={isFullscreen}
                            FullscreenEnterButton={FullscreenEnterButton}
                            FullscreenExitButton={FullscreenExitButton}
                            FullscreenTitle={FullscreenTitle}
                            NavigationButtons={NavigationButtons}
                            getDataItemName={getDataItemName}
                            getForecastTypePrefix={getForecastTypePrefix}
                        />
                    </Box>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};

export default ForecastBaseDataPage;
