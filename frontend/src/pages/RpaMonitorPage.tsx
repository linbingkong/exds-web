import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    CircularProgress,
    Alert,
    Collapse,
    Button,
    useTheme,
    useMediaQuery,
    Tooltip
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import WarningIcon from '@mui/icons-material/Warning';
import ReplayIcon from '@mui/icons-material/Replay';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { format, addDays } from 'date-fns';
import apiClient from '../api/client';
import { useAuth } from '../contexts/AuthContext';


// ========== 类型定义 ==========

interface SummaryStats {
    success: number;
    skipped: number;
    failed: number;
    alerts: number;
}

interface TaskExecutionSummary {
    pipeline_name: string;
    task_key: string;
    daily_status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    execution_time: string | null;
    execution_count: number;
    last_success_date: string | null;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    target_collections: string[];
    error_message: string | null;
    message: string | null;
    duration_seconds: number | null;
}

interface DailySummaryResponse {
    date: string;
    summary: SummaryStats;
    tasks: TaskExecutionSummary[];
    has_data: boolean;
}

interface ExecutionHistoryItem {
    pipeline_name: string;
    task_key: string;
    execution_time: string;
    status: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    error_message: string | null;
    message: string | null;
    duration_seconds: number | null;
}

interface ExecutionBatch {
    batch_index: number;
    batch_time: string;
    start_time: string;
    end_time: string;
    task_count: number;
    success_count: number;
    failed_count: number;
    records: ExecutionHistoryItem[];
}

interface ExecutionHistoryResponse {
    date: string;
    total_batches: number;
    batches: ExecutionBatch[];
    has_data: boolean;
}

interface TaskHistoryGroup {
    group_key: string;
    pipeline_name: string;
    task_key: string;
    execution_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    last_execution_time: string;
    records: ExecutionHistoryItem[];
}

interface AlertItem {
    level: 'critical' | 'warning' | 'info';
    rule: string;
    pipeline_name: string;
    task_key: string;
    message: string;
    timestamp: string | null;
    can_retry: boolean;
}


// ========== 辅助组件 ==========

// 状态芯片
const StatusChip: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'SUCCESS':
            return <Chip icon={<CheckCircleIcon />} label="成功" color="success" size="small" />;
        case 'FAILED':
            return <Chip icon={<CancelIcon />} label="失败" color="error" size="small" />;
        case 'SKIPPED':
            return <Chip icon={<SkipNextIcon />} label="跳过" color="default" size="small" />;
        default:
            return <Chip label={status} size="small" />;
    }
};

// 统计卡片
const StatCard: React.FC<{
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    onClick?: () => void;
}> = ({ title, value, icon, color, onClick }) => {
    return (
        <Paper
            elevation={2}
            sx={{
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: onClick ? 'pointer' : 'default',
                '&:hover': onClick ? { bgcolor: 'action.hover' } : {}
            }}
            onClick={onClick}
        >
            <Box sx={{ color, fontSize: 32, mb: 1 }}>{icon}</Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold', color }}>
                {value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                {title}
            </Typography>
        </Paper>
    );
};

// 移动端紧凑统计条
const CompactStatsBar: React.FC<{
    taskCount: number;
    success: number;
    skipped: number;
    failed: number;
}> = ({ taskCount, success, skipped, failed }) => {
    return (
        <Paper
            variant="outlined"
            sx={{
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                gap: 1,
                mt: 2
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AssignmentIcon sx={{ fontSize: 18, color: '#3B82F6' }} />
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    {taskCount}
                </Typography>
                <Typography variant="caption" color="text.secondary">任务</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CheckCircleIcon sx={{ fontSize: 18, color: '#10B981' }} />
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#10B981' }}>
                    {success}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <SkipNextIcon sx={{ fontSize: 18, color: '#6B7280' }} />
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#6B7280' }}>
                    {skipped}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CancelIcon sx={{ fontSize: 18, color: '#EF4444' }} />
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#EF4444' }}>
                    {failed}
                </Typography>
            </Box>
        </Paper>
    );
};

// 移动端任务行（简洁版，避免横向滚动）
const MobileTaskRow: React.FC<{
    task: TaskExecutionSummary;
    index: number;
}> = ({ task, index }) => {
    // 状态图标
    const StatusIcon = () => {
        switch (task.daily_status) {
            case 'SUCCESS':
                return <CheckCircleIcon sx={{ fontSize: 18, color: '#10B981' }} />;
            case 'FAILED':
                return <CancelIcon sx={{ fontSize: 18, color: '#EF4444' }} />;
            case 'SKIPPED':
                return <SkipNextIcon sx={{ fontSize: 18, color: '#6B7280' }} />;
            default:
                return null;
        }
    };

    // 结果文本
    const getResultText = () => {
        if (task.daily_status === 'SUCCESS') {
            if (task.records_inserted > 0 || task.records_updated > 0) {
                let text = '';
                if (task.records_inserted > 0) text += `+${task.records_inserted}`;
                if (task.records_updated > 0) text += ` ↻${task.records_updated}`;
                return text.trim();
            }
            return '无变化';
        } else if (task.daily_status === 'SKIPPED') {
            return task.message || '已跳过';
        } else {
            return task.error_message ? task.error_message.substring(0, 20) + '...' : '失败';
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                py: 1,
                px: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-child': { borderBottom: 'none' }
            }}
        >
            {/* 序号 */}
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ width: 24, flexShrink: 0 }}
            >
                {index + 1}
            </Typography>

            {/* 任务名 + 结果 */}
            <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                <Typography
                    variant="body2"
                    sx={{
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {task.task_key}
                </Typography>
                <Typography
                    variant="caption"
                    color={task.daily_status === 'FAILED' ? 'error' : 'text.secondary'}
                    sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block'
                    }}
                >
                    {getResultText()}
                </Typography>
            </Box>

            {/* 状态图标 */}
            <StatusIcon />
        </Box>
    );
};


// ========== 主组件 ==========

export const RpaMonitorPage: React.FC = () => {
    const { hasPermission } = useAuth();
    const canRetryTask = hasPermission('module:system_data_access:edit');
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));

    // 日期状态
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 数据状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dailySummary, setDailySummary] = useState<DailySummaryResponse | null>(null);
    const [executionHistory, setExecutionHistory] = useState<ExecutionHistoryResponse | null>(null);
    const [alerts, setAlerts] = useState<AlertItem[]>([]);

    // 历史任务展开状态
    const [expandedHistoryTasks, setExpandedHistoryTasks] = useState<Record<string, boolean>>({});

    // 告警展开状态
    const [alertsExpanded, setAlertsExpanded] = useState(true);

    // 全局重试状态
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryDisabledUntil, setRetryDisabledUntil] = useState<Date | null>(null);

    // 检查重试按钮是否应该禁用
    const isRetryDisabled = isRetrying || (retryDisabledUntil && new Date() < retryDisabledUntil);

    // 加载数据
    const fetchData = useCallback(async (date: Date | null) => {
        if (!date) return;

        setLoading(true);
        setError(null);

        const formattedDate = format(date, 'yyyy-MM-dd');

        try {
            // 并行请求所有数据
            const [summaryRes, historyRes, alertsRes] = await Promise.all([
                apiClient.get(`/api/v1/rpa/execution/daily?date=${formattedDate}`),
                apiClient.get(`/api/v1/rpa/execution/history?date=${formattedDate}`),
                apiClient.get(`/api/v1/rpa/alerts?date=${formattedDate}`)
            ]);

            setDailySummary(summaryRes.data);
            setExecutionHistory(historyRes.data);
            setAlerts(alertsRes.data.alerts || []);
        } catch (err: any) {
            console.error('加载数据失败:', err);
            setError(err.response?.data?.detail || err.message || '加载数据失败');
        } finally {
            setLoading(false);
        }
    }, []);

    // 自动加载数据
    useEffect(() => {
        fetchData(selectedDate);
    }, [selectedDate, fetchData]);

    // 日期导航
    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
    };

    // 刷新数据
    const handleRefresh = () => {
        fetchData(selectedDate);
    };

    // 重试所有失败任务
    const handleRetryAll = async () => {
        if (!canRetryTask) return;
        // 筛选可重试的告警
        const retryableAlerts = alerts.filter(a => a.can_retry);
        if (retryableAlerts.length === 0) {
            setError('没有可重试的任务');
            return;
        }

        setIsRetrying(true);
        setError(null);

        try {
            // 并行发送所有重试请求
            const retryPromises = retryableAlerts.map(alert =>
                apiClient.post(`/api/v1/rpa/tasks/${encodeURIComponent(alert.pipeline_name)}/${encodeURIComponent(alert.task_key)}/retry`)
                    .catch(err => {
                        console.error(`重试 ${alert.pipeline_name}/${alert.task_key} 失败:`, err);
                        return null; // 忽略单个失败
                    })
            );

            await Promise.all(retryPromises);

            // 设置 10 分钟超时
            const timeout = new Date();
            timeout.setMinutes(timeout.getMinutes() + 10);
            setRetryDisabledUntil(timeout);

        } catch (err: any) {
            console.error('重试请求失败:', err);
            setError(err.response?.data?.detail || err.message || '重试请求失败');
        } finally {
            setIsRetrying(false);
        }
    };

    const executionHistoryByTask: TaskHistoryGroup[] = (() => {
        if (!executionHistory?.batches?.length) {
            return [];
        }

        const grouped = new Map<string, TaskHistoryGroup>();

        executionHistory.batches.forEach((batch) => {
            batch.records.forEach((record) => {
                const groupKey = `${record.pipeline_name}__${record.task_key}`;
                const existing = grouped.get(groupKey);

                if (!existing) {
                    grouped.set(groupKey, {
                        group_key: groupKey,
                        pipeline_name: record.pipeline_name,
                        task_key: record.task_key,
                        execution_count: 1,
                        success_count: record.status === 'SUCCESS' ? 1 : 0,
                        failed_count: record.status === 'FAILED' ? 1 : 0,
                        skipped_count: record.status === 'SKIPPED' ? 1 : 0,
                        last_execution_time: record.execution_time,
                        records: [record]
                    });
                    return;
                }

                existing.execution_count += 1;
                if (record.status === 'SUCCESS') existing.success_count += 1;
                if (record.status === 'FAILED') existing.failed_count += 1;
                if (record.status === 'SKIPPED') existing.skipped_count += 1;
                if (new Date(record.execution_time) > new Date(existing.last_execution_time)) {
                    existing.last_execution_time = record.execution_time;
                }
                existing.records.push(record);
            });
        });

        return Array.from(grouped.values())
            .map((group) => ({
                ...group,
                records: [...group.records].sort(
                    (a, b) => new Date(b.execution_time).getTime() - new Date(a.execution_time).getTime()
                )
            }))
            .sort(
                (a, b) => new Date(b.last_execution_time).getTime() - new Date(a.last_execution_time).getTime()
            );
    })();

    useEffect(() => {
        if (!executionHistoryByTask.length) {
            setExpandedHistoryTasks({});
            return;
        }

        setExpandedHistoryTasks((prev) => {
            const nextState: Record<string, boolean> = {};
            executionHistoryByTask.forEach((group, index) => {
                nextState[group.group_key] = prev[group.group_key] ?? index === 0;
            });
            return nextState;
        });
    }, [executionHistory?.date, executionHistoryByTask]);

    const toggleHistoryTask = (groupKey: string) => {
        setExpandedHistoryTasks((prev) => ({
            ...prev,
            [groupKey]: !prev[groupKey]
        }));
    };

    // 渲染空状态
    const renderEmptyState = () => (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', mt: 3 }}>
            <Box sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }}>📭</Box>
            <Typography variant="h6" gutterBottom>
                暂无执行记录
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                RPA 任务尚未在 {dateStr} 执行
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                预计执行时间：09:10、12:00、21:00
            </Typography>
            <Button
                variant="outlined"
                onClick={() => setSelectedDate(addDays(new Date(), -1))}
            >
                查看昨日记录
            </Button>
        </Paper>
    );

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%', overflowX: 'hidden' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                    >
                        系统管理 / 数据下载监控
                    </Typography>
                )}

                {/* 日期选择器和刷新按钮 */}
                <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } }
                            }
                        }}
                    />

                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>

                    <Tooltip title="刷新数据">
                        <IconButton onClick={handleRefresh} disabled={loading}>
                            <RefreshIcon />
                        </IconButton>
                    </Tooltip>
                </Paper>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {/* 首次加载 */}
                {loading && !dailySummary ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : (
                    <Box sx={{ position: 'relative' }}>
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
                                    zIndex: 1000
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        {/* 统计区域：移动端紧凑条，桌面端卡片 */}
                        {isSmallScreen ? (
                            <CompactStatsBar
                                taskCount={dailySummary?.tasks.length || 0}
                                success={dailySummary?.summary.success || 0}
                                skipped={dailySummary?.summary.skipped || 0}
                                failed={dailySummary?.summary.failed || 0}
                            />
                        ) : (
                            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                                <Grid size={{ xs: 6, sm: 2.4 }}>
                                    <StatCard
                                        title="任务数"
                                        value={dailySummary?.tasks.length || 0}
                                        icon={<AssignmentIcon fontSize="inherit" />}
                                        color="#3B82F6"
                                    />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 2.4 }}>
                                    <StatCard
                                        title="成功"
                                        value={dailySummary?.summary.success || 0}
                                        icon={<CheckCircleIcon fontSize="inherit" />}
                                        color="#10B981"
                                    />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 2.4 }}>
                                    <StatCard
                                        title="跳过"
                                        value={dailySummary?.summary.skipped || 0}
                                        icon={<SkipNextIcon fontSize="inherit" />}
                                        color="#6B7280"
                                    />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 2.4 }}>
                                    <StatCard
                                        title="失败"
                                        value={dailySummary?.summary.failed || 0}
                                        icon={<CancelIcon fontSize="inherit" />}
                                        color="#EF4444"
                                    />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 2.4 }}>
                                    <StatCard
                                        title="告警"
                                        value={alerts.length}
                                        icon={<WarningIcon fontSize="inherit" />}
                                        color="#F59E0B"
                                        onClick={() => setAlertsExpanded(!alertsExpanded)}
                                    />
                                </Grid>
                            </Grid>
                        )}

                        {/* 告警展开区 */}
                        {alerts.length > 0 && (
                            <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
                                <Box
                                    sx={{
                                        p: 1.5,
                                        display: 'flex',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 1,
                                        bgcolor: 'warning.light'
                                    }}
                                >
                                    <Box
                                        sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 120, cursor: 'pointer' }}
                                        onClick={() => setAlertsExpanded(!alertsExpanded)}
                                    >
                                        <WarningIcon sx={{ mr: 0.5, fontSize: 20, color: 'warning.dark' }} />
                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                            告警 ({alerts.length})
                                        </Typography>
                                    </Box>
                                    {/* 重试按钮 */}
                                    {alerts.some(a => a.can_retry) && (
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            startIcon={isRetrying ? <CircularProgress size={12} sx={{ color: 'warning.dark' }} /> : <ReplayIcon sx={{ fontSize: 16 }} />}
                                            onClick={(e) => { e.stopPropagation(); handleRetryAll(); }}
                                            disabled={!!isRetryDisabled || !canRetryTask}
                                            sx={{
                                                py: 0.25,
                                                px: 1,
                                                fontSize: '0.75rem',
                                                color: 'warning.dark',
                                                borderColor: 'warning.dark',
                                                '&:hover': {
                                                    borderColor: 'warning.main',
                                                    bgcolor: 'rgba(237, 137, 54, 0.1)'
                                                },
                                                '&.Mui-disabled': {
                                                    color: 'warning.main',
                                                    borderColor: 'warning.main',
                                                    opacity: 0.7
                                                }
                                            }}
                                        >
                                            {isRetrying ? '...' : retryDisabledUntil && new Date() < retryDisabledUntil ? '已发' : '重试'}
                                        </Button>
                                    )}
                                    <IconButton
                                        size="small"
                                        onClick={() => setAlertsExpanded(!alertsExpanded)}
                                        sx={{ color: 'warning.dark', p: 0.5 }}
                                    >
                                        {alertsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                    </IconButton>
                                </Box>
                                <Collapse in={alertsExpanded}>
                                    <Box sx={{ p: 2 }}>
                                        {alerts.map((alert, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    p: 1,
                                                    borderBottom: index < alerts.length - 1 ? '1px solid' : 'none',
                                                    borderColor: 'divider'
                                                }}
                                            >
                                                {/* 第一行：级别标签 + 任务名 */}
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                                    <Chip
                                                        label={alert.level === 'critical' ? '严重' : alert.level === 'warning' ? '警告' : '提示'}
                                                        size="small"
                                                        color={alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}
                                                    />
                                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                        {alert.task_key}
                                                    </Typography>
                                                </Box>
                                                {/* 第二行：消息（允许换行） */}
                                                <Typography
                                                    variant="body2"
                                                    color="text.secondary"
                                                    sx={{
                                                        wordBreak: 'break-word',
                                                        pl: 0.5
                                                    }}
                                                >
                                                    {alert.message}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Collapse>
                            </Paper>
                        )}

                        {/* 无数据状态 */}
                        {!dailySummary?.has_data && renderEmptyState()}

                        {/* 有数据时显示表格 */}
                        {dailySummary?.has_data && (
                            <>
                                {/* 当日摘要表格 */}
                                <Paper variant="outlined" sx={{ mt: 2, p: { xs: 1, sm: 2 } }}>
                                    <Typography variant="h6" gutterBottom>
                                        当日摘要
                                    </Typography>

                                    {/* 移动端：简洁列表 */}
                                    {isSmallScreen ? (
                                        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                                            {dailySummary.tasks.map((task, index) => (
                                                <MobileTaskRow
                                                    key={`${task.pipeline_name}-${task.task_key}-${index}`}
                                                    task={task}
                                                    index={index}
                                                />
                                            ))}
                                        </Paper>
                                    ) : (
                                        /* 桌面端：表格布局 */
                                        <TableContainer sx={{ overflowX: 'auto' }}>
                                            <Table
                                                size="small"
                                                sx={{
                                                    '& .MuiTableCell-root': {
                                                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                        px: { xs: 0.5, sm: 2 }
                                                    }
                                                }}
                                            >
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell align="center">序号</TableCell>
                                                        <TableCell>管道</TableCell>
                                                        <TableCell>任务</TableCell>
                                                        <TableCell>状态</TableCell>
                                                        <TableCell align="right">记录数</TableCell>
                                                        <TableCell>执行时间</TableCell>
                                                        <TableCell align="right">耗时</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {dailySummary.tasks.map((task, index) => (
                                                        <TableRow key={`${task.pipeline_name}-${task.task_key}-${index}`}>
                                                            <TableCell align="center">{index + 1}</TableCell>
                                                            <TableCell>{task.pipeline_name}</TableCell>
                                                            <TableCell>{task.task_key}</TableCell>
                                                            <TableCell>
                                                                <StatusChip status={task.daily_status} />
                                                            </TableCell>
                                                            <TableCell align="right">
                                                                {task.daily_status === 'SUCCESS' ? (
                                                                    <>
                                                                        {task.records_inserted > 0 && `+${task.records_inserted}`}
                                                                        {task.records_updated > 0 && ` ↻${task.records_updated}`}
                                                                    </>
                                                                ) : '-'}
                                                            </TableCell>
                                                            <TableCell>
                                                                {task.execution_time
                                                                    ? format(new Date(task.execution_time), 'HH:mm:ss')
                                                                    : task.last_success_date || '-'}
                                                            </TableCell>
                                                            <TableCell align="right">
                                                                {task.duration_seconds != null
                                                                    ? `${task.duration_seconds.toFixed(1)}s`
                                                                    : '-'}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    )}
                                </Paper>

                                {/* 执行历史（移动端隐藏） */}
                                {!isSmallScreen && executionHistory?.has_data && executionHistoryByTask.length > 0 && (
                                    <Paper variant="outlined" sx={{ mt: 2, p: { xs: 1, sm: 2 } }}>
                                        <Typography variant="h6" gutterBottom>
                                            执行历史
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                            按任务汇总展示当日执行记录，便于查看高频任务的执行次数和最近状态。
                                        </Typography>

                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                            {executionHistoryByTask.map((group) => {
                                                const isExpanded = !!expandedHistoryTasks[group.group_key];

                                                return (
                                                    <Paper key={group.group_key} variant="outlined">
                                                        <Box
                                                            sx={{
                                                                px: 2,
                                                                py: 1.5,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 1.5,
                                                                cursor: 'pointer',
                                                                flexWrap: 'wrap'
                                                            }}
                                                            onClick={() => toggleHistoryTask(group.group_key)}
                                                        >
                                                            <Box sx={{ flex: 1, minWidth: 240 }}>
                                                                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                                                    {group.task_key}
                                                                </Typography>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {group.pipeline_name} · 最近执行 {format(new Date(group.last_execution_time), 'HH:mm:ss')}
                                                                </Typography>
                                                            </Box>

                                                            <Chip
                                                                label={`今日执行 ${group.execution_count} 次`}
                                                                variant="outlined"
                                                                size="small"
                                                            />
                                                            <Chip
                                                                icon={<CheckCircleIcon />}
                                                                label={`成功 ${group.success_count}`}
                                                                color="success"
                                                                variant="outlined"
                                                                size="small"
                                                            />
                                                            {group.failed_count > 0 && (
                                                                <Chip
                                                                    icon={<CancelIcon />}
                                                                    label={`失败 ${group.failed_count}`}
                                                                    color="error"
                                                                    variant="outlined"
                                                                    size="small"
                                                                />
                                                            )}
                                                            {group.skipped_count > 0 && (
                                                                <Chip
                                                                    icon={<SkipNextIcon />}
                                                                    label={`跳过 ${group.skipped_count}`}
                                                                    variant="outlined"
                                                                    size="small"
                                                                />
                                                            )}
                                                            <IconButton size="small">
                                                                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                            </IconButton>
                                                        </Box>

                                                        <Collapse in={isExpanded}>
                                                            <Box sx={{ px: 2, pb: 2 }}>
                                                                <TableContainer sx={{ overflowX: 'auto' }}>
                                                                    <Table
                                                                        size="small"
                                                                        sx={{
                                                                            '& .MuiTableCell-root': {
                                                                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                                                px: { xs: 0.5, sm: 2 }
                                                                            }
                                                                        }}
                                                                    >
                                                                        <TableHead>
                                                                            <TableRow>
                                                                                <TableCell>时间</TableCell>
                                                                                <TableCell>状态</TableCell>
                                                                                <TableCell align="right">耗时</TableCell>
                                                                                <TableCell align="right">记录数</TableCell>
                                                                                <TableCell>消息</TableCell>
                                                                            </TableRow>
                                                                        </TableHead>
                                                                        <TableBody>
                                                                            {group.records.map((record, index) => (
                                                                                <TableRow key={`${group.group_key}-${record.execution_time}-${index}`}>
                                                                                    <TableCell>
                                                                                        {format(new Date(record.execution_time), 'HH:mm:ss')}
                                                                                    </TableCell>
                                                                                    <TableCell>
                                                                                        <StatusChip status={record.status} />
                                                                                    </TableCell>
                                                                                    <TableCell align="right">
                                                                                        {record.duration_seconds != null
                                                                                            ? `${record.duration_seconds.toFixed(1)}s`
                                                                                            : '-'}
                                                                                    </TableCell>
                                                                                    <TableCell align="right">
                                                                                        {(record.records_inserted || record.records_updated || record.records_skipped)
                                                                                            ? `${record.records_inserted > 0 ? `+${record.records_inserted}` : ''}${record.records_updated > 0 ? ` ↻${record.records_updated}` : ''}${record.records_skipped > 0 ? ` 跳${record.records_skipped}` : ''}`.trim()
                                                                                            : '-'}
                                                                                    </TableCell>
                                                                                    <TableCell>
                                                                                        {record.error_message || record.message || '-'}
                                                                                    </TableCell>
                                                                                </TableRow>
                                                                            ))}
                                                                        </TableBody>
                                                                    </Table>
                                                                </TableContainer>
                                                            </Box>
                                                        </Collapse>
                                                    </Paper>
                                                );
                                            })}
                                        </Box>
                                    </Paper>
                                )}
                            </>
                        )}
                    </Box>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default RpaMonitorPage;
