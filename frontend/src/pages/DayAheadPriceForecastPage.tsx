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
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    Chip,
    Card,
    CardContent,
    LinearProgress,
    useTheme,
    useMediaQuery,
    SelectChangeEvent,
    Button,
    Snackbar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SyncIcon from '@mui/icons-material/Sync';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { format, addDays, startOfMonth, subDays } from 'date-fns';
import {
    ComposedChart,
    LineChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';
import { priceForecastApi, ForecastVersion, ChartDataPoint, AccuracyData, AccuracyHistoryPoint, CommandStatus } from '../api/priceForecast';


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
    const preSchedule = payload.find((p) => p.dataKey === 'pre_schedule_price')?.value ?? null;
    const conf80Lower = point?.confidence_80_lower ?? null;
    const conf80Upper = point?.confidence_80_upper ?? null;
    const conf90Lower = point?.confidence_90_lower ?? null;
    const conf90Upper = point?.confidence_90_upper ?? null;
    const predictedValue = typeof predicted === 'number' ? predicted : null;
    const actualValue = typeof actual === 'number' ? actual : null;
    const preScheduleValue = typeof preSchedule === 'number' ? preSchedule : null;
    const error = (predictedValue !== null && actualValue !== null) ? (predictedValue - actualValue) : null;
    const preScheduleError = (preScheduleValue !== null && actualValue !== null) ? (preScheduleValue - actualValue) : null;
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
                    <Typography variant="body2" color="error.main">日前出清:</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {actualValue !== null ? `${actualValue.toFixed(2)} 元/MWh` : '-'}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" color="warning.main">预计划日前:</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {preScheduleValue !== null ? `${preScheduleValue.toFixed(2)} 元/MWh` : '-'}
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary">预计划误差:</Typography>
                    <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={preScheduleError === null ? 'text.primary' : Math.abs(preScheduleError) < 20 ? 'success.main' : 'warning.main'}
                    >
                        {preScheduleError !== null ? `${preScheduleError > 0 ? '+' : ''}${preScheduleError.toFixed(2)} 元/MWh` : '-'}
                    </Typography>
                </Box>
            </Box>

            {(conf80Lower !== null && conf80Upper !== null) || (conf90Lower !== null && conf90Upper !== null) ? (
                <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px dashed', borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                        预测区间
                    </Typography>
                    {conf80Lower !== null && conf80Upper !== null && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: conf90Lower !== null && conf90Upper !== null ? 0.5 : 0 }}>
                            <Typography variant="caption" color="primary.main">80% 置信区间:</Typography>
                            <Typography variant="caption" fontWeight="bold">
                                {conf80Lower.toFixed(2)} ~ {conf80Upper.toFixed(2)} 元/MWh
                            </Typography>
                        </Box>
                    )}
                    {conf90Lower !== null && conf90Upper !== null && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                            <Typography variant="caption" color="success.main">90% 置信区间:</Typography>
                            <Typography variant="caption" fontWeight="bold" color="success.main">
                                {conf90Lower.toFixed(2)} ~ {conf90Upper.toFixed(2)} 元/MWh
                            </Typography>
                        </Box>
                    )}
                </Box>
            ) : null}
        </Paper>
    );
};


// ============ 准确度颜色编码 ============
const getAccuracyColor = (accuracy: number): 'success' | 'warning' | 'error' => {
    if (accuracy >= 90) return 'success';
    if (accuracy >= 85) return 'warning';
    return 'error';
};

const calculateWmapeAccuracy = (
    actualValues: Array<number | null | undefined>,
    comparedValues: Array<number | null | undefined>,
): number | null => {
    const pairedValues = actualValues.reduce<Array<{ actual: number; compared: number }>>((acc, actual, index) => {
        const compared = comparedValues[index];
        if (typeof actual === 'number' && typeof compared === 'number') {
            acc.push({ actual, compared });
        }
        return acc;
    }, []);

    if (pairedValues.length === 0) {
        return null;
    }

    const denominator = pairedValues.reduce((sum, item) => sum + Math.abs(item.actual), 0);
    if (denominator === 0) {
        return null;
    }

    const numerator = pairedValues.reduce((sum, item) => sum + Math.abs(item.actual - item.compared), 0);
    return 100 - (numerator / denominator) * 100;
};


// ============ 核心指标卡片组件 ============
interface KpiCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    color?: 'default' | 'success' | 'warning' | 'error';
    chips?: Array<{ label: string; passed: boolean }>;
    icon?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, subtitle, color, chips, icon }) => {
    const colorMap: Record<string, string> = {
        success: 'success.main',
        warning: 'warning.main',
        error: 'error.main',
        default: 'text.primary',
    };

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">{title}</Typography>
                    {icon}
                </Box>
                <Typography
                    variant="h5"
                    fontWeight="bold"
                    color={colorMap[color || 'default']}
                    sx={{ mb: 0.5 }}
                >
                    {value}
                </Typography>
                {subtitle && (
                    <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
                )}
                {chips && chips.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {chips.map((chip, idx) => (
                            <Chip
                                key={idx}
                                label={chip.label}
                                size="small"
                                color={chip.passed ? 'success' : 'default'}
                                variant={chip.passed ? 'filled' : 'outlined'}
                                icon={chip.passed ? <CheckCircleIcon /> : undefined}
                            />
                        ))}
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};


// ============ 分时段准确度组件 ============
interface PeriodAccuracyProps {
    data: Record<string, number>;
}

const PeriodAccuracyCard: React.FC<PeriodAccuracyProps> = ({ data }) => {
    if (!data || Object.keys(data).length === 0) {
        return (
            <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                    <Typography variant="subtitle2" gutterBottom>分时段准确度</Typography>
                    <Typography variant="body2" color="text.secondary">暂无数据</Typography>
                </CardContent>
            </Card>
        );
    }

    const periodOrder = ['尖峰', '高峰', '平段', '低谷', '深谷'];
    const sortedPeriods = Object.entries(data).sort((a, b) => {
        const idxA = periodOrder.indexOf(a[0]);
        const idxB = periodOrder.indexOf(b[0]);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Typography variant="subtitle2" gutterBottom>分时段准确度</Typography>
                {sortedPeriods.map(([period, accuracy]) => (
                    <Box key={period} sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="body2">{period}</Typography>
                            <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={`${getAccuracyColor(accuracy ?? 0)}.main`}
                            >
                                {(accuracy ?? 0).toFixed(1)}%
                            </Typography>
                        </Box>
                        <LinearProgress
                            variant="determinate"
                            value={Math.min(accuracy ?? 0, 100)}
                            color={getAccuracyColor(accuracy ?? 0)}
                            sx={{ height: 6, borderRadius: 3 }}
                        />
                    </Box>
                ))}
            </CardContent>
        </Card>
    );
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


// ============ 当日数据特征组件 ============
interface DailyStatsProps {
    stats: AccuracyData['stats'];
    chartData: ChartDataPoint[];
}

interface AccuracyHistoryTooltipProps {
    active?: boolean;
    payload?: Array<{ value?: number | null; payload?: AccuracyHistoryPoint }>;
    label?: string;
}

interface HistoryLegendProps {
    showHistoryWmape: boolean;
    showHistoryMae: boolean;
    showHistoryRmse: boolean;
    onToggleWmape: () => void;
    onToggleMae: () => void;
    onToggleRmse: () => void;
}

const AccuracyHistoryTooltip: React.FC<AccuracyHistoryTooltipProps> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;

    const point = payload[0].payload;
    const dateLabel = point.target_date ? format(new Date(point.target_date), 'MM-dd') : '-';

    return (
        <Paper sx={{ p: 1.5, minWidth: 180 }}>
            <Typography variant="subtitle2" gutterBottom>{dateLabel}</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography variant="body2" color="primary.main">WMAPE准确率:</Typography>
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

const AccuracyHistoryLegend: React.FC<HistoryLegendProps> = ({
    showHistoryWmape,
    showHistoryMae,
    showHistoryRmse,
    onToggleWmape,
    onToggleMae,
    onToggleRmse,
}) => {
    const items = [
        {
            label: 'WMAPE准确率',
            active: showHistoryWmape,
            color: '#1976d2',
            dashed: false,
            onClick: onToggleWmape,
        },
        {
            label: 'MAE平均偏差',
            active: showHistoryMae,
            color: '#ed6c02',
            dashed: false,
            onClick: onToggleMae,
        },
        {
            label: 'RMSE波动偏差',
            active: showHistoryRmse,
            color: '#7b1fa2',
            dashed: true,
            onClick: onToggleRmse,
        },
    ];

    return (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
            {items.map((item) => (
                <Box
                    key={item.label}
                    onClick={item.onClick}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        cursor: 'pointer',
                        userSelect: 'none',
                        opacity: item.active ? 1 : 0.45,
                        transition: 'opacity 0.2s ease',
                    }}
                >
                    <Box
                        sx={{
                            width: 18,
                            height: 0,
                            borderTop: `3px ${item.dashed ? 'dashed' : 'solid'} ${item.color}`,
                            borderRadius: 999,
                        }}
                    />
                    <Typography variant="body2" color="text.secondary">
                        {item.label}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};

const DailyStatsCard: React.FC<DailyStatsProps> = ({ stats, chartData }) => {
    // 从 chartData 计算预测价格统计
    const predictedPrices = chartData
        .map(d => d.predicted_price)
        .filter((p): p is number => p !== null && p !== undefined);

    const predictedStats = predictedPrices.length > 0 ? {
        max: Math.max(...predictedPrices),
        min: Math.min(...predictedPrices),
        mean: predictedPrices.reduce((a, b) => a + b, 0) / predictedPrices.length,
        hasNegative: predictedPrices.some(p => p < 0),
    } : null;

    // 从 chartData 计算实际价格统计
    const actualPrices = chartData
        .map(d => d.actual_price)
        .filter((p): p is number => p !== null && p !== undefined);

    const actualStats = actualPrices.length > 0 ? {
        max: Math.max(...actualPrices),
        min: Math.min(...actualPrices),
        mean: actualPrices.reduce((a, b) => a + b, 0) / actualPrices.length,
        hasNegative: actualPrices.some(p => p < 0),
    } : null;

    if (!predictedStats && !actualStats) {
        return (
            <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                    <Typography variant="subtitle2" gutterBottom>当日数据特征</Typography>
                    <Typography variant="body2" color="text.secondary">暂无数据</Typography>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Typography variant="subtitle2" gutterBottom>当日数据特征</Typography>

                {/* 表头 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}></Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>预测</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>实际</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* 最高价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>最高价</Typography>
                        <Typography variant="body2" fontWeight="bold" color="error.main" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.max.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="error.main" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.max.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 最低价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>最低价</Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.min.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.min.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 均价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>均价</Typography>
                        <Typography variant="body2" fontWeight="bold" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.mean.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.mean.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 负电价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>负电价</Typography>
                        <Box sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? (
                                predictedStats.hasNegative ? (
                                    <Chip label="有" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                                ) : (
                                    <Chip label="无" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                )
                            ) : '-'}
                        </Box>
                        <Box sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? (
                                actualStats.hasNegative ? (
                                    <Chip label="有" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                                ) : (
                                    <Chip label="无" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                )
                            ) : '-'}
                        </Box>
                    </Box>
                </Box>
            </CardContent>
        </Card>
    );
};


// ============ 主页面组件 ============
export const DayAheadPriceForecastPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_dayahead_price:edit');

    // 状态管理
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
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
    const [availableMaxDate, setAvailableMaxDate] = useState<Date | null>(addDays(new Date(), 1));
    const [historyStartDate, setHistoryStartDate] = useState<Date | null>(subDays(new Date(), 29));
    const [historyEndDate, setHistoryEndDate] = useState<Date | null>(new Date());
    const [showHistoryWmape, setShowHistoryWmape] = useState(true);
    const [showHistoryMae, setShowHistoryMae] = useState(false);
    const [showHistoryRmse, setShowHistoryRmse] = useState(false);

    // 预测触发相关状态
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [commandStatus, setCommandStatus] = useState<CommandStatus['status'] | null>(null);
    const [executionState, setExecutionState] = useState<ForecastExecutionState | null>(null);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 日期限制：以后端实际可用数据日期为准
    const maxDate = availableMaxDate || addDays(new Date(), 1);

    // 计算预测均价
    const avgPredictedPrice = useMemo(() => {
        if (chartData.length === 0) return null;
        const validPoints = chartData.filter(d => d.predicted_price !== null);
        if (validPoints.length === 0) return null;
        const sum = validPoints.reduce((acc, curr) => acc + (curr.predicted_price || 0), 0);
        return sum / validPoints.length;
    }, [chartData]);

    const selectedWmape = accuracy?.wmape_accuracy ?? null;
    const preScheduleWmape = useMemo(() => {
        if (chartData.length === 0) return null;
        return calculateWmapeAccuracy(
            chartData.map((item) => item.actual_price),
            chartData.map((item) => item.pre_schedule_price),
        );
    }, [chartData]);
    const historyErrorAxisMax = useMemo(() => {
        const values = accuracyHistory.flatMap((item) => [
            typeof item.mae === 'number' ? item.mae : null,
            typeof item.rmse === 'number' ? item.rmse : null,
        ]).filter((value): value is number => value !== null);
        if (values.length === 0) return 10;
        return Math.ceil(Math.max(...values) * 1.1);
    }, [accuracyHistory]);

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
                forecast_type: 'd1_price',
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
                forecast_type: 'd1_price',
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
            const nextMaxDate = new Date(response.data.max_available_date);
            if (!Number.isNaN(nextMaxDate.getTime())) {
                setAvailableMaxDate(nextMaxDate);
                setSelectedDate((current) => {
                    if (!current) return current;
                    return current > nextMaxDate ? nextMaxDate : current;
                });
            }
        } catch (err) {
            console.error('获取最大可用日期失败:', err);
            setAvailableMaxDate(addDays(new Date(), 1));
        }
    };

    const handleHistoryQuickSelect = (type: 'last7' | 'last30' | 'last60' | 'thisMonth') => {
        const baseDate = selectedDate || new Date();
        switch (type) {
            case 'last7':
                setHistoryStartDate(subDays(baseDate, 6));
                setHistoryEndDate(baseDate);
                break;
            case 'last30':
                setHistoryStartDate(subDays(baseDate, 29));
                setHistoryEndDate(baseDate);
                break;
            case 'last60':
                setHistoryStartDate(subDays(baseDate, 59));
                setHistoryEndDate(baseDate);
                break;
            case 'thisMonth':
                setHistoryStartDate(startOfMonth(baseDate));
                setHistoryEndDate(baseDate);
                break;
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
        const newDate = addDays(selectedDate, days);
        // 限制最大日期为明天
        if (newDate > maxDate) return;
        setSelectedDate(newDate);
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

    // 版本选择
    const handleVersionChange = (event: SelectChangeEvent<string>) => {
        setSelectedVersion(event.target.value);
    };

    // 格式化版本显示
    const formatVersionLabel = (version: ForecastVersion): string => {
        const time = new Date(version.created_at).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
        return `${time} - ${version.model_type}`;
    };

    const loading = loadingVersions || loadingChart;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
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
                        gap: 1,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        maxDate={maxDate}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } },
                            },
                        }}
                    />

                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading || !canNavigateNext}>
                        <ArrowRightIcon />
                    </IconButton>

                    <FormControl
                        size="small"
                        sx={{ minWidth: { xs: 180, sm: 280 }, ml: { xs: 0, sm: 2 } }}
                        disabled={loading || versions.length === 0}
                    >
                        <InputLabel>预测版本</InputLabel>
                        <Select
                            value={selectedVersion}
                            onChange={handleVersionChange}
                            label="预测版本"
                        >
                            {versions.map((v) => (
                                <MenuItem key={v.forecast_id} value={v.forecast_id}>
                                    {formatVersionLabel(v)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* 预测按钮 */}
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
                        sx={{ ml: { xs: 0, sm: 'auto' } }}
                    >
                        {commandStatus === 'pending' ? '等待中...' :
                            commandStatus === 'running' ? '执行中...' :
                                versions.length > 0 ? '重新预测' : '预测'}
                    </Button>
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

                {/* 首次加载 */}
                {loading && chartData.length === 0 ? (
                    <Box
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        minHeight="400px"
                    >
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        {/* 区域 B：趋势对比图 */}
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2, position: 'relative' }}>
                            {/* 数据刷新覆盖层 */}
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
                                    mb: 2,
                                    flexDirection: { xs: 'column', md: 'row' },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <Typography variant="h6">
                                        预测与出清价格对比
                                    </Typography>
                                    {avgPredictedPrice !== null && (
                                        <Box sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            px: 1.5,
                                            py: 0.5,
                                            border: '1px solid',
                                            borderColor: 'primary.light',
                                            borderRadius: 1,
                                            bgcolor: 'rgba(25, 118, 210, 0.04)',
                                        }}>
                                            <Typography variant="caption" color="text.secondary">预测均价:</Typography>
                                            <Typography variant="body2" fontWeight="bold" color="primary.main">
                                                {avgPredictedPrice.toFixed(2)} 元
                                            </Typography>
                                        </Box>
                                    )}
                                    <Box sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.5,
                                        border: '1px solid',
                                        borderColor: selectedWmape !== null ? `${getAccuracyColor(selectedWmape)}.light` : 'divider',
                                        borderRadius: 1,
                                        bgcolor: selectedWmape !== null
                                            ? getAccuracyColor(selectedWmape) === 'success'
                                                ? 'rgba(46, 125, 50, 0.06)'
                                                : getAccuracyColor(selectedWmape) === 'warning'
                                                    ? 'rgba(237, 108, 2, 0.08)'
                                                    : 'rgba(211, 47, 47, 0.06)'
                                            : 'rgba(0, 0, 0, 0.02)',
                                    }}>
                                        <Typography variant="caption" color="text.secondary">WMAPE准确率:</Typography>
                                        <Typography
                                            variant="body2"
                                            fontWeight="bold"
                                            color={selectedWmape !== null ? `${getAccuracyColor(selectedWmape)}.main` : 'text.primary'}
                                        >
                                            {selectedWmape !== null ? `${selectedWmape.toFixed(2)}%` : '待评估'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.5,
                                        border: '1px solid',
                                        borderColor: preScheduleWmape !== null ? `${getAccuracyColor(preScheduleWmape)}.light` : 'divider',
                                        borderRadius: 1,
                                        bgcolor: preScheduleWmape !== null
                                            ? getAccuracyColor(preScheduleWmape) === 'success'
                                                ? 'rgba(46, 125, 50, 0.06)'
                                                : getAccuracyColor(preScheduleWmape) === 'warning'
                                                    ? 'rgba(237, 108, 2, 0.08)'
                                                    : 'rgba(211, 47, 47, 0.06)'
                                            : 'rgba(0, 0, 0, 0.02)',
                                    }}>
                                        <Typography variant="caption" color="text.secondary">预计划vs日前 WMAPE:</Typography>
                                        <Typography
                                            variant="body2"
                                            fontWeight="bold"
                                            color={preScheduleWmape !== null ? `${getAccuracyColor(preScheduleWmape)}.main` : 'text.primary'}
                                        >
                                            {preScheduleWmape !== null ? `${preScheduleWmape.toFixed(2)}%` : '待评估'}
                                        </Typography>
                                    </Box>
                                    {showHistoryMae && (
                                        <Box sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            px: 1.5,
                                            py: 0.5,
                                            border: '1px solid',
                                            borderColor: 'primary.light',
                                            borderRadius: 1,
                                            bgcolor: 'rgba(25, 118, 210, 0.04)',
                                        }}>
                                            <Typography variant="caption" color="text.secondary">MAE平均偏差:</Typography>
                                            <Typography variant="body2" fontWeight="bold" color="primary.main">
                                                {accuracy?.mae !== null && accuracy?.mae !== undefined ? `${accuracy.mae.toFixed(2)} 元/MWh` : '待评估'}
                                            </Typography>
                                        </Box>
                                    )}
                                    {showHistoryRmse && (
                                        <Box sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            px: 1.5,
                                            py: 0.5,
                                            border: '1px solid',
                                            borderColor: 'primary.light',
                                            borderRadius: 1,
                                            bgcolor: 'rgba(25, 118, 210, 0.04)',
                                        }}>
                                            <Typography variant="caption" color="text.secondary">RMSE波动偏差:</Typography>
                                            <Typography variant="body2" fontWeight="bold" color="primary.main">
                                                {accuracy?.rmse !== null && accuracy?.rmse !== undefined ? `${accuracy.rmse.toFixed(2)} 元/MWh` : '待评估'}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                            </Box>

                            {executionState && <ForecastExecutionPanel executionState={executionState} />}

                            <Box
                                ref={chartRef}
                                sx={{
                                    height: { xs: 350, sm: 450 },
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
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            height: '100%',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Typography color="text.secondary">
                                            {chartData.length === 0 && versions.length === 0
                                                ? executionState?.title || '该日期暂无可展示曲线数据'
                                                : '加载中...'}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={chartData}
                                            margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis
                                                dataKey="time"
                                                tick={{ fontSize: 11 }}
                                                interval="preserveStartEnd"
                                            />
                                            <YAxis
                                                tick={{ fontSize: 11 }}
                                                label={{
                                                    value: '元/MWh',
                                                    angle: -90,
                                                    position: 'insideLeft',
                                                }}
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend />

                                            {/* 置信区间 */}
                                            {/* 置信区间 90% (浅绿色范围) */}
                                            {chartData.some(d => d.confidence_90_lower != null) && (
                                                <Area
                                                    type="monotone"
                                                    dataKey={(d: any) => [d.confidence_90_lower, d.confidence_90_upper]}
                                                    stroke="none"
                                                    fill="#4caf50"
                                                    fillOpacity={0.15}
                                                    name="90%置信区间"
                                                    connectNulls
                                                />
                                            )}

                                            {/* 置信区间 80% (淡蓝色范围) */}
                                            {chartData.some(d => d.confidence_80_lower != null) && (
                                                <Area
                                                    type="monotone"
                                                    dataKey={(d: any) => [d.confidence_80_lower, d.confidence_80_upper]}
                                                    stroke="none"
                                                    fill="#1976d2"
                                                    fillOpacity={0.15}
                                                    name="80%置信区间"
                                                    connectNulls
                                                />
                                            )}

                                            {/* 预测曲线 */}
                                            <Line
                                                type="monotone"
                                                dataKey="predicted_price"
                                                stroke="#1976d2"
                                                strokeWidth={2}
                                                dot={false}
                                                name="预测价格"
                                                connectNulls
                                            />

                                            {/* 实际曲线 */}
                                            <Line
                                                type="monotone"
                                                dataKey="actual_price"
                                                stroke="#d32f2f"
                                                strokeWidth={2}
                                                dot={false}
                                                name="日前出清价格"
                                                connectNulls
                                            />

                                            <Line
                                                type="monotone"
                                                dataKey="pre_schedule_price"
                                                stroke="#ed6c02"
                                                strokeWidth={2}
                                                dot={false}
                                                strokeDasharray="6 3"
                                                name="预计划日前出清价格"
                                                connectNulls
                                            />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                )}
                            </Box>
                        </Paper>

                        {/* 区域 C：历史准确率曲线 */}
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: { xs: 'stretch', md: 'center' },
                                        justifyContent: 'space-between',
                                        flexDirection: { xs: 'column', md: 'row' },
                                        gap: 1.5,
                                        mb: 2,
                                    }}
                                >
                                    <Typography variant="h6">历史准确率曲线</Typography>
                                </Box>

                                <Box
                                    sx={{
                                        mb: 2,
                                        display: 'flex',
                                        flexDirection: { xs: 'column', lg: 'row' },
                                        gap: 1.5,
                                        alignItems: { xs: 'stretch', lg: 'center' },
                                        justifyContent: 'flex-end',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}>
                                        <DatePicker
                                            label="开始日期"
                                            value={historyStartDate}
                                            onChange={(date) => setHistoryStartDate(date)}
                                            maxDate={historyEndDate || selectedDate || maxDate}
                                            slotProps={{
                                                textField: {
                                                    size: 'small',
                                                    sx: {
                                                        width: { xs: '140px', sm: '170px' },
                                                        '& .MuiInputBase-input': { fontSize: { xs: '0.85rem', sm: '1rem' } },
                                                    },
                                                },
                                            }}
                                        />
                                        <Typography sx={{ px: 0.5, fontSize: '0.875rem' }}>至</Typography>
                                        <DatePicker
                                            label="结束日期"
                                            value={historyEndDate}
                                            onChange={(date) => setHistoryEndDate(date)}
                                            minDate={historyStartDate || undefined}
                                            maxDate={selectedDate || maxDate}
                                            slotProps={{
                                                textField: {
                                                    size: 'small',
                                                    sx: {
                                                        width: { xs: '140px', sm: '170px' },
                                                        '& .MuiInputBase-input': { fontSize: { xs: '0.85rem', sm: '1rem' } },
                                                    },
                                                },
                                            }}
                                        />
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}>
                                        <Button variant="outlined" size="small" onClick={() => handleHistoryQuickSelect('last7')}>
                                            近7天
                                        </Button>
                                        <Button variant="outlined" size="small" onClick={() => handleHistoryQuickSelect('last30')}>
                                            近30天
                                        </Button>
                                        <Button variant="outlined" size="small" onClick={() => handleHistoryQuickSelect('last60')}>
                                            近60天
                                        </Button>
                                        <Button variant="outlined" size="small" onClick={() => handleHistoryQuickSelect('thisMonth')}>
                                            本月
                                        </Button>
                                    </Box>
                                </Box>

                                <Box
                                    sx={{
                                        height: { xs: 260, md: 320 },
                                        '& .recharts-surface:focus': {
                                            outline: 'none',
                                        },
                                        '& *:focus': {
                                            outline: 'none !important',
                                        },
                                    }}
                                >
                                    <AccuracyHistoryLegend
                                        showHistoryWmape={showHistoryWmape}
                                        showHistoryMae={showHistoryMae}
                                        showHistoryRmse={showHistoryRmse}
                                        onToggleWmape={() => setShowHistoryWmape((prev) => !prev)}
                                        onToggleMae={() => setShowHistoryMae((prev) => !prev)}
                                        onToggleRmse={() => setShowHistoryRmse((prev) => !prev)}
                                    />

                                    {loadingAccuracy || loadingAccuracyHistory ? (
                                        <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                            <CircularProgress size={24} />
                                        </Box>
                                    ) : accuracyHistory.length === 0 ? (
                                        <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                            <Typography color="text.secondary">所选日期区间暂无历史准确率数据</Typography>
                                        </Box>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={accuracyHistory} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis
                                                    dataKey="target_date"
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(value) => format(new Date(value), 'MM-dd')}
                                                />
                                                <YAxis
                                                    yAxisId="accuracy"
                                                    domain={[0, 100]}
                                                    tick={{ fontSize: 11 }}
                                                    unit="%"
                                                    label={{ value: 'WMAPE准确率', angle: -90, position: 'insideLeft' }}
                                                />
                                                <YAxis
                                                    yAxisId="error"
                                                    orientation="right"
                                                    domain={[0, historyErrorAxisMax]}
                                                    tick={{ fontSize: 11 }}
                                                    unit=" 元/MWh"
                                                    label={{ value: '偏差', angle: 90, position: 'insideRight' }}
                                                />
                                                <Tooltip content={<AccuracyHistoryTooltip />} />
                                                {showHistoryWmape && (
                                                    <Line
                                                        type="monotone"
                                                        yAxisId="accuracy"
                                                        dataKey="wmape_accuracy"
                                                        name="WMAPE准确率"
                                                        stroke="#1976d2"
                                                        strokeWidth={2.5}
                                                        dot={{ r: 3 }}
                                                        activeDot={{ r: 5 }}
                                                        connectNulls
                                                    />
                                                )}
                                                {showHistoryMae && (
                                                    <Line
                                                        type="monotone"
                                                        yAxisId="error"
                                                        dataKey="mae"
                                                        name="MAE平均偏差"
                                                        stroke="#ed6c02"
                                                        strokeWidth={2.5}
                                                        dot={{ r: 3 }}
                                                        activeDot={{ r: 4 }}
                                                        connectNulls
                                                    />
                                                )}
                                                {showHistoryRmse && (
                                                    <Line
                                                        type="monotone"
                                                        yAxisId="error"
                                                        dataKey="rmse"
                                                        name="RMSE波动偏差"
                                                        stroke="#7b1fa2"
                                                        strokeWidth={2.5}
                                                        dot={{ r: 3 }}
                                                        activeDot={{ r: 4 }}
                                                        strokeDasharray="6 4"
                                                        connectNulls
                                                    />
                                                )}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    )}
                                </Box>
                            </Paper>
                    </>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default DayAheadPriceForecastPage;
