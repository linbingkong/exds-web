/**
 * 日前价格预测分析页面
 * 
 * 功能：
 * 1. 展示日前价格预测曲线与实际价格对比
 * 2. 显示预测准确度评估指标
 * 3. 支持多版本回溯
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    IconButton,
    Chip,
    useTheme,
    useMediaQuery,
    Button,
    Snackbar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Divider,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SyncIcon from '@mui/icons-material/Sync';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { format, addDays, startOfDay, subDays } from 'date-fns';
import {
    ComposedChart,
    BarChart,
    Bar,
    Cell,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';
import { priceForecastApi, ForecastVersion, ChartDataPoint, AccuracyData, AccuracyHistoryPoint, CommandStatus } from '../api/priceForecast';
import { useWeather } from '../hooks/useWeather';
import { WeatherDisplay } from '../components/WeatherDisplay';

const DAY_AHEAD_UNIFIED_FORECAST_TYPE = 'd1_price_unified';
const DAY_AHEAD_POINT_COUNT = 96;

// ============ 自定义 Tooltip ============
interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{
        dataKey?: string;
        value?: number | [number, number] | null;
        payload?: ChartDataPoint;
    }>;
    label?: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;

    const point = payload.find((p) => p.payload)?.payload;
    const predicted = payload.find((p) => p.dataKey === 'predicted_price')?.value ?? null;
    const actual = payload.find((p) => p.dataKey === 'actual_price')?.value ?? null;
    const conf90Lower = point?.confidence_90_lower ?? null;
    const conf90Upper = point?.confidence_90_upper ?? null;
    const predictedValue = typeof predicted === 'number' ? predicted : null;
    const actualValue = typeof actual === 'number' ? actual : null;
    const error = (predictedValue !== null && actualValue !== null) ? (predictedValue - actualValue) : null;
    const errorColor = error === null
        ? 'text.primary'
        : Math.abs(error) < 20
            ? 'success.main'
            : error > 0
                ? 'warning.main'
                : 'error.main';

    return (
        <Paper sx={{ p: 1.5, minWidth: 200 }}>
            <Typography variant="subtitle2" gutterBottom>{label}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" color="primary.main">预测价格:</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {predictedValue !== null ? `${predictedValue.toFixed(2)} 元/MWh` : '-'}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" color="error.main">物理出清:</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {actualValue !== null ? `${actualValue.toFixed(2)} 元/MWh` : '-'}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary">预测误差:</Typography>
                    <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={errorColor}
                    >
                        {error !== null ? `${error > 0 ? '+' : ''}${error.toFixed(2)} 元/MWh` : '-'}
                    </Typography>
                </Box>
            </Box>

            {conf90Lower !== null && conf90Upper !== null ? (
                <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px dashed', borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                        预测区间
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        <Typography variant="caption" color="success.main">90% 置信区间:</Typography>
                        <Typography variant="caption" fontWeight="bold" color="success.main">
                            {conf90Lower.toFixed(2)} ~ {conf90Upper.toFixed(2)} 元/MWh
                        </Typography>
                    </Box>
                </Box>
            ) : null}
        </Paper>
    );
};


const getAccuracyBarColor = (accuracy: number | null | undefined): string => {
    if (accuracy === null || accuracy === undefined) return '#cbd5e1';
    if (accuracy >= 95) return '#2fb983';
    if (accuracy >= 90) return '#64bfa2';
    if (accuracy >= 80) return '#d39a45';
    return '#bd5e61';
};

type ForecastExecutionKind = 'pending' | 'running' | 'success' | 'waiting' | 'failed';

interface ForecastExecutionState {
    kind: ForecastExecutionKind;
    title: string;
    detail: string | null;
    blockedDate: string | null;
    missingItems: string[];
}

const buildExecutionState = (command?: Partial<CommandStatus> | null): ForecastExecutionState | null => {
    if (!command) return null;

    const resultStatus = command.result?.status;
    const resultDetails = command.result?.details;
    const normalizedResultStatus = typeof resultStatus === 'string' ? resultStatus.toLowerCase() : null;
    const title = command.result?.summary || command.result_message || command.error_message || '';
    const detail =
        command.result?.msg ||
        (typeof resultDetails?.error === 'string' ? resultDetails.error : null) ||
        command.error_message ||
        null;
    const blockedDate = typeof resultDetails?.blocked_date === 'string'
        ? resultDetails.blocked_date
        : null;
    const rawMissingItems = Array.isArray(resultDetails?.missing_items) ? resultDetails?.missing_items ?? [] : [];
    const missingItems: string[] = rawMissingItems.filter((item): item is string => typeof item === 'string');

    if (normalizedResultStatus === 'waiting') {
        return {
            kind: 'waiting',
            title: title || '等待基础数据',
            detail,
            blockedDate,
            missingItems,
        };
    }

    if (normalizedResultStatus === 'failed' || normalizedResultStatus === 'error') {
        return {
            kind: 'failed',
            title: title || '执行失败',
            detail,
            blockedDate,
            missingItems,
        };
    }

    if (command.status === 'completed') {
        return {
            kind: 'success',
            title: title || '执行成功',
            detail,
            blockedDate,
            missingItems,
        };
    }

    if (command.status === 'running') {
        return {
            kind: 'running',
            title: title || '执行中',
            detail,
            blockedDate,
            missingItems,
        };
    }

    return {
        kind: 'pending',
        title: title || '等待执行',
        detail,
        blockedDate,
        missingItems,
    };
};

interface ForecastExecutionPanelProps {
    executionState: ForecastExecutionState;
}

const ForecastExecutionPanel: React.FC<ForecastExecutionPanelProps> = ({ executionState }) => {
    const panelConfig: Record<ForecastExecutionKind, {
        title: string;
        chipColor: 'default' | 'info' | 'success' | 'warning' | 'error';
        borderColor: string;
        backgroundColor: string;
        icon: React.ReactNode;
    }> = {
        pending: {
            title: '等待执行',
            chipColor: 'default',
            borderColor: 'divider',
            backgroundColor: 'grey.50',
            icon: <HourglassEmptyIcon color="action" />,
        },
        running: {
            title: '执行中',
            chipColor: 'info',
            borderColor: 'info.light',
            backgroundColor: 'rgba(2, 136, 209, 0.08)',
            icon: <SyncIcon color="info" sx={{
                animation: 'spin 2s linear infinite',
                '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                },
            }} />,
        },
        success: {
            title: '执行成功',
            chipColor: 'success',
            borderColor: 'success.light',
            backgroundColor: 'rgba(46, 125, 50, 0.08)',
            icon: <CheckCircleIcon color="success" />,
        },
        waiting: {
            title: '等待基础数据',
            chipColor: 'warning',
            borderColor: 'warning.light',
            backgroundColor: 'rgba(237, 108, 2, 0.08)',
            icon: <WarningAmberIcon color="warning" />,
        },
        failed: {
            title: '执行失败',
            chipColor: 'error',
            borderColor: 'error.light',
            backgroundColor: 'rgba(211, 47, 47, 0.08)',
            icon: <ErrorIcon color="error" />,
        },
    };

    const config = panelConfig[executionState.kind];

    return (
        <Box
            sx={{
                mb: 2,
                p: 2,
                border: '1px solid',
                borderColor: config.borderColor,
                borderRadius: 2,
                bgcolor: config.backgroundColor,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                    {config.icon}
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">
                            {executionState.title || config.title}
                        </Typography>
                        {executionState.detail && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                {executionState.detail}
                            </Typography>
                        )}
                    </Box>
                </Box>
                <Chip label={config.title} color={config.chipColor} size="small" />
            </Box>

            {(executionState.blockedDate || executionState.missingItems.length > 0) && (
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed', borderColor: config.borderColor }}>
                    {executionState.blockedDate && (
                        <Typography variant="body2" sx={{ mb: executionState.missingItems.length > 0 ? 1 : 0 }}>
                            阻塞日期：{executionState.blockedDate}
                        </Typography>
                    )}
                    {executionState.missingItems.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                            {executionState.missingItems.map((item) => (
                                <Chip key={item} label={item} size="small" variant="outlined" color={config.chipColor} />
                            ))}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};


interface AccuracyHistoryTooltipProps {
    active?: boolean;
    payload?: Array<{ value?: number | null; payload?: AccuracyHistoryPoint }>;
    label?: string;
}

const AccuracyHistoryTooltip: React.FC<AccuracyHistoryTooltipProps> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;

    const point = payload[0].payload;
    const dateLabel = point.target_date ? format(new Date(point.target_date), 'MM-dd') : '-';

    return (
        <Paper sx={{ p: 1.5, minWidth: 180 }}>
            <Typography variant="subtitle2" gutterBottom>{dateLabel}</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography variant="body2" color="primary.main">准确率:</Typography>
                <Typography variant="body2" fontWeight="bold">
                    {point.wmape_accuracy !== null && point.wmape_accuracy !== undefined
                        ? `${point.wmape_accuracy.toFixed(2)}%`
                        : '-'}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">MAE平均偏差:</Typography>
                <Typography variant="caption" fontWeight="bold">
                    {point.mae !== null && point.mae !== undefined
                        ? `${point.mae.toFixed(2)} 元/MWh`
                        : '-'}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">RMSE波动偏差:</Typography>
                <Typography variant="caption" fontWeight="bold">
                    {point.rmse !== null && point.rmse !== undefined
                        ? `${point.rmse.toFixed(2)} 元/MWh`
                        : '-'}
                </Typography>
            </Box>
        </Paper>
    );
};


// ============ 主页面组件 ============
export const DayAheadPriceForecastPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_dayahead_price:edit');

    // 状态管理
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(startOfDay(new Date()), 1));
    const [versions, setVersions] = useState<ForecastVersion[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
    const [accuracy, setAccuracy] = useState<AccuracyData | null>(null);
    const [accuracyHistory, setAccuracyHistory] = useState<AccuracyHistoryPoint[]>([]);

    const [loadingVersions, setLoadingVersions] = useState(false);
    const [loadingChart, setLoadingChart] = useState(false);
    const [loadingAccuracy, setLoadingAccuracy] = useState(false);
    const [loadingAccuracyHistory, setLoadingAccuracyHistory] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [availableMaxDate, setAvailableMaxDate] = useState<Date | null>(addDays(startOfDay(new Date()), 1));
    const [historyStartDate, setHistoryStartDate] = useState<Date | null>(subDays(startOfDay(new Date()), 28));
    const [historyEndDate, setHistoryEndDate] = useState<Date | null>(addDays(startOfDay(new Date()), 1));
    const { weatherData, loading: weatherLoading } = useWeather(selectedDate);

    // 预测触发相关状态
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [commandStatus, setCommandStatus] = useState<CommandStatus['status'] | null>(null);
    const [executionState, setExecutionState] = useState<ForecastExecutionState | null>(null);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 日期限制：以后端实际可用数据日期为准
    const maxDate = availableMaxDate || addDays(startOfDay(new Date()), 1);

    const dailyMetrics = useMemo(() => {
        const predictedPrices = chartData
            .map((item) => item.predicted_price)
            .filter((value): value is number => typeof value === 'number');
        const actualPrices = chartData
            .map((item) => item.actual_price)
            .filter((value): value is number => typeof value === 'number');
        const pairedValues = chartData.reduce<Array<{ predicted: number; actual: number }>>((acc, item) => {
            if (typeof item.predicted_price === 'number' && typeof item.actual_price === 'number') {
                acc.push({ predicted: item.predicted_price, actual: item.actual_price });
            }
            return acc;
        }, []);
        const actualPublished = chartData.some((item) => typeof item.actual_price === 'number');
        const absoluteErrors = pairedValues.map((item) => Math.abs(item.predicted - item.actual));
        const relativeErrors = pairedValues
            .map((item) => {
                if (item.actual === 0) {
                    return Math.abs(item.predicted - item.actual) === 0 ? 0 : null;
                }
                return Math.abs(item.predicted - item.actual) / Math.abs(item.actual);
            })
            .filter((value): value is number => value !== null);

        return {
            predictedAvg: predictedPrices.length > 0 ? predictedPrices.reduce((sum, value) => sum + value, 0) / predictedPrices.length : null,
            predictedMax: predictedPrices.length > 0 ? Math.max(...predictedPrices) : null,
            predictedMin: predictedPrices.length > 0 ? Math.min(...predictedPrices) : null,
            actualAvg: actualPrices.length > 0 ? actualPrices.reduce((sum, value) => sum + value, 0) / actualPrices.length : null,
            actualPublished,
            maxError: absoluteErrors.length > 0 ? Math.max(...absoluteErrors) : null,
            within5Count: relativeErrors.filter((value) => value <= 0.05).length,
            within10Count: relativeErrors.filter((value) => value <= 0.1).length,
        };
    }, [chartData]);

    const dailyMetricRows = useMemo(() => {
        const formatPrice = (value: number | null) => value !== null ? `${value.toFixed(2)} 元/MWh` : '-';
        const formatActualPrice = (value: number | null) => dailyMetrics.actualPublished && value !== null ? `${value.toFixed(2)} 元/MWh` : '-';
        const formatAccuracy = (value: number | null | undefined) => (
            dailyMetrics.actualPublished && value !== null && value !== undefined ? `${value.toFixed(2)}%` : '-'
        );
        const formatError = (value: number | null | undefined) => (
            dailyMetrics.actualPublished && value !== null && value !== undefined ? `${value.toFixed(2)} 元/MWh` : '-'
        );
        const formatCount = (value: number) => dailyMetrics.actualPublished ? `${value}/${DAY_AHEAD_POINT_COUNT}` : '-';
        const accuracyColor = accuracy?.wmape_accuracy !== null && accuracy?.wmape_accuracy !== undefined
            ? getAccuracyBarColor(accuracy.wmape_accuracy)
            : '#64748b';
        const neutralMetricStyle = {
            color: '#334155',
            bg: 'rgba(15, 23, 42, 0.03)',
            emphasize: false,
        };

        return [
            { label: '预测均价', value: formatPrice(dailyMetrics.predictedAvg), color: '#2563eb', bg: 'rgba(37, 99, 235, 0.06)', emphasize: true },
            { label: '实际均价', value: formatActualPrice(dailyMetrics.actualAvg), ...neutralMetricStyle },
            { label: '预测最高价', value: formatPrice(dailyMetrics.predictedMax), ...neutralMetricStyle },
            { label: '预测最低价', value: formatPrice(dailyMetrics.predictedMin), ...neutralMetricStyle },
            { label: '当日准确率', value: formatAccuracy(accuracy?.wmape_accuracy), color: accuracyColor, bg: 'rgba(47, 185, 131, 0.08)', emphasize: true },
            { label: '最大误差', value: formatError(dailyMetrics.maxError), color: '#e11d48', bg: 'rgba(225, 29, 72, 0.06)', emphasize: true },
            { label: 'MAE', value: formatError(accuracy?.mae), ...neutralMetricStyle },
            { label: 'RMSE', value: formatError(accuracy?.rmse), ...neutralMetricStyle },
            { label: '5%以内点数', value: formatCount(dailyMetrics.within5Count), ...neutralMetricStyle },
            { label: '10%以内点数', value: formatCount(dailyMetrics.within10Count), ...neutralMetricStyle },
        ];
    }, [accuracy, dailyMetrics]);

    // 图表全屏
    const chartRef = useRef<HTMLDivElement>(null);
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `日前价格预测 (${dateStr})`,
        onPrevious: () => handleShiftDate(-1),
        onNext: () => handleShiftDate(1),
    });

    // 加载预测版本列表
    const fetchVersions = async (date: Date | null) => {
        if (!date) return;

        setLoadingVersions(true);
        setError(null);
        try {
            const response = await priceForecastApi.fetchVersions({
                target_date: format(date, 'yyyy-MM-dd'),
                forecast_type: DAY_AHEAD_UNIFIED_FORECAST_TYPE,
            });
            const data = response.data;
            setVersions(data);

            // 自动选中第一个（最新）版本
            if (data.length > 0) {
                setSelectedVersion(data[0].forecast_id);
            } else {
                setSelectedVersion('');
                fetchChartData('', date);
                setAccuracy(null);
            }
        } catch (err: any) {
            console.error('获取预测版本失败:', err);
            setError(err.response?.data?.detail || err.message || '获取预测版本失败');
            setVersions([]);
            setSelectedVersion('');
            fetchChartData('', date);
        } finally {
            setLoadingVersions(false);
        }
    };

    // 加载图表数据
    const fetchChartData = async (forecastId: string, date: Date | null) => {
        if (!date) return;

        setLoadingChart(true);
        try {
            const response = await priceForecastApi.fetchChartData({
                forecast_id: forecastId,
                target_date: format(date, 'yyyy-MM-dd'),
            });
            setChartData(response.data);
        } catch (err: any) {
            console.error('获取图表数据失败:', err);
            setChartData([]);
        } finally {
            setLoadingChart(false);
        }
    };

    // 加载准确度数据
    const fetchAccuracy = async (forecastId: string, date: Date | null) => {
        if (!forecastId || !date) return;

        setLoadingAccuracy(true);
        try {
            const response = await priceForecastApi.fetchAccuracy({
                forecast_id: forecastId,
                target_date: format(date, 'yyyy-MM-dd'),
            });
            setAccuracy(response.data);
        } catch (err: any) {
            console.error('获取准确度数据失败:', err);
            setAccuracy(null);
        } finally {
            setLoadingAccuracy(false);
        }
    };

    const fetchAccuracyHistory = async (startDate: Date | null, endDate: Date | null) => {
        if (!startDate || !endDate) return;

        setLoadingAccuracyHistory(true);
        try {
            const response = await priceForecastApi.fetchAccuracyHistory({
                start_date: format(startDate, 'yyyy-MM-dd'),
                end_date: format(endDate, 'yyyy-MM-dd'),
                forecast_type: DAY_AHEAD_UNIFIED_FORECAST_TYPE,
            });
            setAccuracyHistory(response.data);
        } catch (err) {
            console.error('获取历史准确率曲线失败:', err);
            setAccuracyHistory([]);
        } finally {
            setLoadingAccuracyHistory(false);
        }
    };

    const fetchMaxAvailableDate = async () => {
        try {
            const response = await priceForecastApi.fetchMaxAvailableDate();
            const nextMaxDate = startOfDay(new Date(response.data.max_available_date));
            if (!Number.isNaN(nextMaxDate.getTime())) {
                setAvailableMaxDate(nextMaxDate);
                setSelectedDate((current) => {
                    if (!current) return current;
                    const normalizedCurrent = startOfDay(current);
                    return normalizedCurrent > nextMaxDate ? nextMaxDate : normalizedCurrent;
                });
            }
        } catch (err) {
            console.error('获取最大可用日期失败:', err);
            setAvailableMaxDate(addDays(startOfDay(new Date()), 1));
        }
    };

    // 版本或日期变化时加载数据
    useEffect(() => {
        if (selectedVersion && selectedDate) {
            fetchChartData(selectedVersion, selectedDate);
            fetchAccuracy(selectedVersion, selectedDate);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedVersion, selectedDate]);

    useEffect(() => {
        if (!selectedDate) return;
        setHistoryStartDate(subDays(selectedDate, 29));
        setHistoryEndDate(selectedDate);
    }, [selectedDate]);

    useEffect(() => {
        if (!historyStartDate || !historyEndDate || historyStartDate > historyEndDate) {
            setAccuracyHistory([]);
            return;
        }
        fetchAccuracyHistory(historyStartDate, historyEndDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [historyStartDate, historyEndDate]);

    // 日期导航
    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = startOfDay(addDays(selectedDate, days));
        // 限制最大日期为明天
        if (newDate > maxDate) return;
        setSelectedDate(newDate);
    };

    const handleAccuracyBarClick = (point?: AccuracyHistoryPoint | null) => {
        if (!point?.target_date) return;
        const nextDate = startOfDay(new Date(point.target_date));
        if (Number.isNaN(nextDate.getTime()) || nextDate > maxDate) return;
        setSelectedDate(nextDate);
    };

    // 检查是否可以向右导航（+1天）
    const canNavigateNext = selectedDate ? addDays(selectedDate, 1) <= maxDate : false;

    // 停止轮询
    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    }, []);

    // 日期变化时加载版本
    useEffect(() => {
        stopPolling();
        setCommandStatus(null);
        setExecutionState(null);
        fetchVersions(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, stopPolling]);

    useEffect(() => {
        fetchMaxAvailableDate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 轮询命令状态
    const startPolling = useCallback((cmdId: string) => {
        stopPolling();
        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await priceForecastApi.getCommandStatus(cmdId);
                const status = response.data.status;
                const nextExecutionState = buildExecutionState(response.data);
                setCommandStatus(status);
                setExecutionState(nextExecutionState);

                if (status === 'completed') {
                    stopPolling();
                    setSnackbar({ open: true, message: nextExecutionState?.title || '预测任务已完成！', severity: 'success' });
                    // 刷新版本列表
                    fetchVersions(selectedDate);
                    setCommandStatus(null);
                } else if (status === 'failed') {
                    stopPolling();
                    setSnackbar({
                        open: true,
                        message: nextExecutionState?.title || '预测任务执行失败',
                        severity: nextExecutionState?.kind === 'waiting' ? 'warning' : 'error'
                    });
                    setCommandStatus(null);
                }
            } catch (err) {
                console.error('轮询命令状态失败:', err);
            }
        }, 5000); // 每 5 秒轮询一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stopPolling, selectedDate]);

    // 组件卸载时清理轮询
    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    // 触发预测
    const handleTriggerForecast = async () => {
        if (!canEdit) return;
        if (!selectedDate) return;

        const targetDate = format(selectedDate, 'yyyy-MM-dd');
        setTriggerLoading(true);

        try {
            // 1. 检查数据充足性
            const checkResponse = await priceForecastApi.checkDataAvailability({ target_date: targetDate });
            if (!checkResponse.data.is_sufficient) {
                setSnackbar({
                    open: true,
                    message: `数据不足（${checkResponse.data.count}/96条），无法触发预测`,
                    severity: 'warning'
                });
                setTriggerLoading(false);
                return;
            }

            // 2. 触发预测任务
            const triggerResponse = await priceForecastApi.triggerForecast({ target_date: targetDate });
            if (triggerResponse.data.success) {
                const cmdId = triggerResponse.data.command_id!;
                setCommandStatus('pending');
                setExecutionState(buildExecutionState({
                    status: 'pending',
                    result_message: `已提交 ${targetDate} 的预测任务，请等待执行结果`,
                }));
                setSnackbar({ open: true, message: '预测任务已提交，预计1-2分钟完成', severity: 'info' });
                // 开始轮询状态
                startPolling(cmdId);
            } else {
                // 已有任务在执行中
                if (triggerResponse.data.existing_command_id) {
                    const cmdId = triggerResponse.data.existing_command_id;
                    setCommandStatus(triggerResponse.data.status as CommandStatus['status']);
                    setExecutionState(buildExecutionState({
                        status: (triggerResponse.data.status as CommandStatus['status']) || 'pending',
                        result_message: triggerResponse.data.message,
                    }));
                    setSnackbar({ open: true, message: triggerResponse.data.message, severity: 'warning' });
                    startPolling(cmdId);
                } else {
                    setSnackbar({ open: true, message: triggerResponse.data.message, severity: 'error' });
                }
            }
        } catch (err: any) {
            console.error('触发预测失败:', err);
            setSnackbar({ open: true, message: err.response?.data?.detail || '触发预测失败', severity: 'error' });
        } finally {
            setTriggerLoading(false);
        }
    };

    // 处理预测按钮点击
    const handlePredictClick = () => {
        if (!canEdit) return;
        if (versions.length > 0) {
            setConfirmDialogOpen(true);
        } else {
            handleTriggerForecast();
        }
    };

    // 确认重新预测
    const handleConfirmPredict = () => {
        if (!canEdit) return;
        setConfirmDialogOpen(false);
        handleTriggerForecast();
    };

    const loading = loadingVersions || loadingChart || loadingAccuracy;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box
                sx={{
                    width: '100%',
                    height: { xs: 'auto', md: '100%' },
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    gap: 2,
                }}
            >
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 'bold', color: 'text.primary' }}
                    >
                        价格预测 / 日前价格预测
                    </Typography>
                )}

                {/* 区域 A：控制栏 */}
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        display: 'flex',
                        gap: { xs: 1, sm: 2 },
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        justifyContent: { xs: 'center', sm: 'flex-start' },
                        flex: '0 0 auto',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                        <IconButton onClick={() => handleShiftDate(-1)} disabled={loading} size="small">
                            <ArrowLeftIcon />
                        </IconButton>
                        <DatePicker
                            label="选择日期"
                            value={selectedDate}
                            onChange={(date) => setSelectedDate(date ? startOfDay(date) : null)}
                            disabled={loading}
                            maxDate={maxDate}
                            slotProps={{
                                textField: {
                                    size: 'small',
                                    sx: { width: { xs: '150px', sm: '200px' } },
                                },
                            }}
                        />
                        <IconButton onClick={() => handleShiftDate(1)} disabled={loading || !canNavigateNext} size="small">
                            <ArrowRightIcon />
                        </IconButton>
                    </Box>

                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                    <WeatherDisplay weatherData={weatherData} loading={weatherLoading} />

                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            flexWrap: 'wrap',
                            ml: { xs: 0, lg: 'auto' },
                            justifyContent: { xs: 'center', sm: 'flex-start' },
                        }}
                    >
                        <Button
                            variant="contained"
                            color={commandStatus ? 'warning' : 'primary'}
                            startIcon={
                                triggerLoading ? <CircularProgress size={16} color="inherit" /> :
                                    commandStatus === 'pending' ? <HourglassEmptyIcon /> :
                                        commandStatus === 'running' ? <SyncIcon sx={{
                                            animation: 'spin 2s linear infinite',
                                            '@keyframes spin': {
                                                '0%': { transform: 'rotate(0deg)' },
                                                '100%': { transform: 'rotate(360deg)' }
                                            }
                                        }} /> :
                                            versions.length > 0 ? <SyncIcon /> : <PlayArrowIcon />
                            }
                            onClick={handlePredictClick}
                            disabled={
                                !canEdit ||
                                loading ||
                                triggerLoading ||
                                commandStatus === 'pending' ||
                                commandStatus === 'running'
                            }
                        >
                            {commandStatus === 'pending' ? '等待中...' :
                                commandStatus === 'running' ? '执行中...' :
                                    versions.length > 0 ? '重新预测' : '预测'}
                        </Button>
                    </Box>
                </Paper>

                {/* 重新预测确认对话框 */}
                <Dialog
                    open={confirmDialogOpen}
                    onClose={() => setConfirmDialogOpen(false)}
                >
                    <DialogTitle>确认重新预测？</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            该日期已存在预测版本。重新预测将生成新的版本。是否继续？
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmDialogOpen(false)}>取消</Button>
                        <Button onClick={handleConfirmPredict} variant="contained" autoFocus disabled={!canEdit}>
                            执行重新预测
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* Snackbar 提示 */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={6000}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                    <Alert
                        onClose={() => setSnackbar({ ...snackbar, open: false })}
                        severity={snackbar.severity}
                        sx={{ width: '100%' }}
                    >
                        {snackbar.message}
                    </Alert>
                </Snackbar>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}

                <Paper
                    variant="outlined"
                    sx={{
                        p: { xs: 1, sm: 2 },
                        position: 'relative',
                        flex: { xs: '0 0 auto', md: '1 1 0' },
                        minHeight: { xs: 360, md: 0 },
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: { xs: 'visible', md: 'hidden' },
                    }}
                >
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

                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: { xs: 'flex-start', md: 'center' },
                            justifyContent: 'space-between',
                            gap: 1.5,
                            mb: 0.75,
                            flexDirection: { xs: 'column', md: 'row' },
                            flex: '0 0 auto',
                        }}
                    >
                        <Typography variant="h6">96点日前预测曲线</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, flexWrap: 'wrap' }}>
                            {[
                                { label: '预测', color: '#009f72', dashed: false, area: false },
                                { label: '物理出清', color: '#c7861b', dashed: true, area: false },
                                { label: '90%置信区间', color: '#9fd8cb', dashed: false, area: true },
                            ].map((item) => (
                                <Box key={item.label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                                    {item.area ? (
                                        <Box sx={{ width: 18, height: 10, borderRadius: 0.5, bgcolor: item.color, opacity: 0.5 }} />
                                    ) : (
                                        <Box sx={{ width: 20, height: 0, borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}` }} />
                                    )}
                                    <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>

                    {executionState && <ForecastExecutionPanel executionState={executionState} />}

                    <Box
                        ref={chartRef}
                        sx={{
                            height: { xs: 300, md: '100%' },
                            flex: { xs: '0 0 auto', md: '1 1 0' },
                            minHeight: 0,
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
                            '& .recharts-surface:focus': {
                                outline: 'none',
                            },
                            '& *:focus': {
                                outline: 'none !important',
                            },
                        }}
                    >
                        <FullscreenEnterButton />
                        <FullscreenExitButton />
                        <FullscreenTitle />
                        <NavigationButtons />

                        {chartData.length === 0 ? (
                            <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography color="text.secondary">
                                    {versions.length === 0 ? executionState?.title || '该日期暂无可展示曲线数据' : '加载中...'}
                                </Typography>
                            </Box>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                                    <YAxis tick={{ fontSize: 11 }} label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip content={<CustomTooltip />} />
                                    {chartData.some(d => d.confidence_90_lower != null && d.confidence_90_upper != null) && (
                                        <Area
                                            type="monotone"
                                            dataKey={(d: any) => [d.confidence_90_lower, d.confidence_90_upper]}
                                            stroke="none"
                                            fill="#9fd8cb"
                                            fillOpacity={0.24}
                                            name="90%置信区间"
                                            connectNulls
                                        />
                                    )}
                                    <Line type="monotone" dataKey="predicted_price" stroke="#009f72" strokeWidth={2.4} dot={false} name="预测" connectNulls />
                                    <Line type="monotone" dataKey="actual_price" stroke="#c7861b" strokeWidth={2} dot={false} strokeDasharray="6 4" name="物理出清" connectNulls />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </Box>
                </Paper>

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.15fr) minmax(360px, 0.85fr)' },
                        gap: 2,
                        flex: { xs: '0 0 auto', md: '0 0 340px' },
                        minHeight: { xs: 'auto', md: 0 },
                    }}
                >
                    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, height: { xs: 'auto', md: '100%' }, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                            <Typography variant="h6">近30天准确率</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {[
                                    { label: '≥95%', color: getAccuracyBarColor(95) },
                                    { label: '90%-95%', color: getAccuracyBarColor(90) },
                                    { label: '80%-90%', color: getAccuracyBarColor(80) },
                                    { label: '<80%', color: getAccuracyBarColor(79) },
                                ].map((item) => (
                                    <Box key={item.label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                        <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: item.color }} />
                                        <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                        <Box
                            sx={{
                                height: { xs: 240, md: '100%' },
                                flex: { xs: '0 0 auto', md: '1 1 0' },
                                minHeight: 0,
                                '& .recharts-surface:focus': { outline: 'none' },
                                '& *:focus': { outline: 'none !important' },
                            }}
                        >
                            {loadingAccuracyHistory ? (
                                <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                    <CircularProgress size={24} />
                                </Box>
                            ) : accuracyHistory.length === 0 ? (
                                <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                    <Typography color="text.secondary">近30天暂无准确率数据</Typography>
                                </Box>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={accuracyHistory} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                        <XAxis dataKey="target_date" tick={{ fontSize: 11 }} tickFormatter={(value) => format(new Date(value), 'MM-dd')} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                                        <Tooltip content={<AccuracyHistoryTooltip />} />
                                        <Bar
                                            dataKey="wmape_accuracy"
                                            name="准确率"
                                            radius={[3, 3, 0, 0]}
                                            cursor="pointer"
                                            onClick={(data) => handleAccuracyBarClick(data?.payload as AccuracyHistoryPoint | undefined)}
                                        >
                                            {accuracyHistory.map((entry) => (
                                                <Cell
                                                    key={entry.target_date}
                                                    fill={getAccuracyBarColor(entry.wmape_accuracy)}
                                                    stroke={selectedDate && format(selectedDate, 'yyyy-MM-dd') === format(new Date(entry.target_date), 'yyyy-MM-dd') ? '#0f172a' : 'transparent'}
                                                    strokeWidth={selectedDate && format(selectedDate, 'yyyy-MM-dd') === format(new Date(entry.target_date), 'yyyy-MM-dd') ? 2 : 0}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </Box>
                    </Paper>

                    <Paper
                        variant="outlined"
                        sx={{
                            p: { xs: 1.5, sm: 2 },
                            height: { xs: 'auto', md: '100%' },
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 1 }}>当日预测指标</Typography>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                                gridTemplateRows: { sm: 'repeat(5, minmax(0, 1fr))' },
                                gap: 0.75,
                                flex: '1 1 0',
                                minHeight: 0,
                                alignContent: 'stretch',
                            }}
                        >
                            {dailyMetricRows.map((row) => (
                                <Box
                                    key={row.label}
                                    sx={{
                                        minWidth: 0,
                                        minHeight: 0,
                                        p: 0.75,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderLeft: '4px solid',
                                        borderLeftColor: '#cbd5e1',
                                        borderRadius: 1,
                                        bgcolor: row.bg,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.15 }}>
                                        {row.label}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            mt: 0.2,
                                            fontWeight: 700,
                                            color: row.color,
                                            overflowWrap: 'anywhere',
                                            lineHeight: 1.15,
                                            fontSize: { xs: '0.875rem', md: '0.8rem', xl: '0.875rem' },
                                        }}
                                    >
                                        {row.value}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Paper>
                </Box>
            </Box>
        </LocalizationProvider>
    );
};

export default DayAheadPriceForecastPage;
