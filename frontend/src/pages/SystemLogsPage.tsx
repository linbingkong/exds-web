/**
 * 系统日志与告警页面
 * 参考客户档案管理、零售合同管理风格
 * 桌面端：表格布局
 * 移动端：卡片布局 + 可折叠筛选
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    TextField,
    CircularProgress,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    TableSortLabel,
    IconButton,
    Chip,
    Tooltip,
    Snackbar,
    useTheme,
    useMediaQuery,
    Tab,
    Tabs,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    FilterList as FilterListIcon,
    Visibility as VisibilityIcon,
    Check as CheckIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format } from 'date-fns';
import apiClient from '../api/client';
import { useAuth } from '../contexts/AuthContext';


// ========== 类型定义 ==========

interface AlertItem {
    alert_id: string;
    level: string;
    category: string;
    title: string;
    content: string;
    detail_content?: string;
    status: string;
    service_type?: string;
    task_type: string;
    related_task_id?: string;
    created_at: string;
    resolved_at?: string;
    resolved_by?: string;
    resolution_note?: string;
}

const isAlertItem = (value: any): value is AlertItem => {
    return Boolean(value && typeof value === 'object' && 'alert_id' in value && 'level' in value && 'title' in value);
};

interface TaskLogItem {
    task_id: string;
    task_name: string;
    task_type: string;
    service_type?: string;
    trigger_type?: string;
    status: string;
    start_time: string;
    end_time?: string;
    duration?: number;
    summary?: string;
    details?: any;
    error?: any;
}

interface CommandItem {
    command_id: string;
    command: string;
    task_type: string;
    service_type?: string;
    status: string;
    parameters?: any;
    priority: number;
    created_at: string;
    created_by: string;
    started_at?: string;
    completed_at?: string;
    result_message?: string;
}

interface FilterOptions {
    alerts: {
        levels: string[];
        statuses: string[];
        task_types: string[];
    };
    logs: {
        task_types: string[];
        statuses: string[];
    };
    commands: {
        commands: string[];
        task_types: string[];
        statuses: string[];
    };
}

type TabType = 'alerts' | 'logs' | 'commands';


// ========== 辅助函数 ==========

// 获取级别Chip颜色
const getLevelColor = (level: string): 'error' | 'warning' | 'info' | 'default' => {
    switch (level) {
        case 'P1': return 'error';
        case 'P2': return 'warning';
        case 'P3': return 'info';
        default: return 'default';
    }
};

// 获取状态Chip配置
const getStatusConfig = (status: string): { label: string; color: 'success' | 'error' | 'warning' | 'info' | 'default' } => {
    switch (status) {
        case 'SUCCESS': return { label: '成功', color: 'success' };
        case 'FAILED': return { label: '失败', color: 'error' };
        case 'RUNNING': return { label: '运行中', color: 'info' };
        case 'PENDING': return { label: '待执行', color: 'default' };
        case 'ACTIVE': return { label: '活跃', color: 'warning' };
        case 'RESOLVED': return { label: '已解决', color: 'success' };
        case 'PARTIAL': return { label: '部分成功', color: 'warning' };
        default: return { label: status, color: 'default' };
    }
};

// 安全格式化日期
const safeFormatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return '-';
    try {
        return format(new Date(dateStr), 'yyyy-MM-dd HH:mm:ss');
    } catch (e) {
        return '-';
    }
};


// ========== 主组件 ==========

export const SystemLogsPage: React.FC = () => {
    const { hasPermission } = useAuth();
    const canResolveAlert = hasPermission('module:system_logs:edit');
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // Tab状态
    const [currentTab, setCurrentTab] = useState<TabType>('alerts');

    // 动态筛选选项
    const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

    // 日期状态 - 默认null表示获取所有数据
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // 筛选状态
    const [alertFilters, setAlertFilters] = useState({ status: '', level: '', task_type: '' });
    const [logFilters, setLogFilters] = useState({ status: '', task_type: '' });
    const [commandFilters, setCommandFilters] = useState({ status: '', task_type: '', command: '' });

    // 分页状态
    const [alertPage, setAlertPage] = useState(0);
    const [alertPageSize, setAlertPageSize] = useState(10);
    const [logPage, setLogPage] = useState(0);
    const [logPageSize, setLogPageSize] = useState(10);
    const [commandPage, setCommandPage] = useState(0);
    const [commandPageSize, setCommandPageSize] = useState(10);

    // 排序状态
    const [alertSort, setAlertSort] = useState({ field: 'created_at', order: 'desc' as 'asc' | 'desc' });
    const [logSort, setLogSort] = useState({ field: 'start_time', order: 'desc' as 'asc' | 'desc' });
    const [commandSort, setCommandSort] = useState({ field: 'created_at', order: 'desc' as 'asc' | 'desc' });

    // 数据状态
    const [alerts, setAlerts] = useState<AlertItem[]>([]);
    const [alertTotal, setAlertTotal] = useState(0);
    const [logs, setLogs] = useState<TaskLogItem[]>([]);
    const [logTotal, setLogTotal] = useState(0);
    const [commands, setCommands] = useState<CommandItem[]>([]);
    const [commandTotal, setCommandTotal] = useState(0);

    // 加载状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 筛选区域折叠状态
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);



    // 详情对话框
    const [detailDialog, setDetailDialog] = useState<{ open: boolean; title: string; content: any }>({
        open: false, title: '', content: null
    });

    // 解决告警对话框
    const [resolveDialog, setResolveDialog] = useState<{ open: boolean; alertId: string; note: string }>({
        open: false, alertId: '', note: ''
    });

    // Snackbar
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false, message: '', severity: 'success'
    });

    // 加载筛选选项
    const fetchFilterOptions = useCallback(async () => {
        try {
            const response = await apiClient.get('/api/v1/system/filter-options');
            setFilterOptions(response.data);
        } catch (err: any) {
            console.error('加载筛选选项失败:', err);
        }
    }, []);

    // 初始化加载筛选选项
    useEffect(() => {
        fetchFilterOptions();
    }, [fetchFilterOptions]);

    // 检查是否有活跃筛选
    const hasActiveFilters = () => {
        switch (currentTab) {
            case 'alerts':
                return Boolean(alertFilters.status || alertFilters.level || alertFilters.task_type || selectedDate);
            case 'logs':
                return Boolean(logFilters.status || logFilters.task_type || selectedDate);
            case 'commands':
                return Boolean(commandFilters.status || commandFilters.task_type || commandFilters.command || selectedDate);
            default:
                return false;
        }
    };

    // 加载告警数据
    const fetchAlerts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(alertPage + 1),
                page_size: String(alertPageSize),
                sort_field: alertSort.field,
                sort_order: alertSort.order
            });
            if (selectedDate) params.append('date', format(selectedDate, 'yyyy-MM-dd'));
            if (alertFilters.status) params.append('status', alertFilters.status);
            if (alertFilters.level) params.append('level', alertFilters.level);
            if (alertFilters.task_type) params.append('task_type', alertFilters.task_type);

            const response = await apiClient.get(`/api/v1/system/alerts?${params}`);
            setAlerts(response.data.alerts || []);
            setAlertTotal(response.data.total || 0);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载告警失败');
        } finally {
            setLoading(false);
        }
    }, [selectedDate, alertPage, alertPageSize, alertSort, alertFilters]);

    // 加载任务日志数据
    const fetchLogs = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(logPage + 1),
                page_size: String(logPageSize),
                sort_field: logSort.field,
                sort_order: logSort.order
            });
            if (selectedDate) params.append('date', format(selectedDate, 'yyyy-MM-dd'));
            if (logFilters.status) params.append('status', logFilters.status);
            if (logFilters.task_type) params.append('task_type', logFilters.task_type);

            const response = await apiClient.get(`/api/v1/system/task-logs?${params}`);
            setLogs(response.data.logs || []);
            setLogTotal(response.data.total || 0);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载任务日志失败');
        } finally {
            setLoading(false);
        }
    }, [selectedDate, logPage, logPageSize, logSort, logFilters]);

    // 加载远程指令数据
    const fetchCommands = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(commandPage + 1),
                page_size: String(commandPageSize),
                sort_field: commandSort.field,
                sort_order: commandSort.order
            });
            if (selectedDate) params.append('date', format(selectedDate, 'yyyy-MM-dd'));
            if (commandFilters.status) params.append('status', commandFilters.status);
            if (commandFilters.task_type) params.append('task_type', commandFilters.task_type);
            if (commandFilters.command) params.append('command', commandFilters.command);

            const response = await apiClient.get(`/api/v1/system/commands?${params}`);
            setCommands(response.data.commands || []);
            setCommandTotal(response.data.total || 0);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载远程指令失败');
        } finally {
            setLoading(false);
        }
    }, [selectedDate, commandPage, commandPageSize, commandSort, commandFilters]);

    // 根据当前Tab加载数据
    const fetchCurrentTabData = useCallback(() => {
        switch (currentTab) {
            case 'alerts': fetchAlerts(); break;
            case 'logs': fetchLogs(); break;
            case 'commands': fetchCommands(); break;
        }
    }, [currentTab, fetchAlerts, fetchLogs, fetchCommands]);

    // 监听依赖变化自动加载
    useEffect(() => {
        fetchCurrentTabData();
    }, [fetchCurrentTabData]);

    // 重置筛选
    const handleReset = () => {
        setSelectedDate(null);
        switch (currentTab) {
            case 'alerts':
                setAlertFilters({ status: '', level: '', task_type: '' });
                setAlertPage(0);
                break;
            case 'logs':
                setLogFilters({ status: '', task_type: '' });
                setLogPage(0);
                break;
            case 'commands':
                setCommandFilters({ status: '', task_type: '', command: '' });
                setCommandPage(0);
                break;
        }
    };

    // 刷新数据
    const handleRefresh = () => {
        fetchFilterOptions();
        fetchCurrentTabData();
    };

    // 排序处理
    const handleSort = (field: string) => {
        switch (currentTab) {
            case 'alerts':
                setAlertSort(prev => ({
                    field,
                    order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
                }));
                break;
            case 'logs':
                setLogSort(prev => ({
                    field,
                    order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
                }));
                break;
            case 'commands':
                setCommandSort(prev => ({
                    field,
                    order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
                }));
                break;
        }
    };

    // 查看详情
    const handleViewDetail = (title: string, content: any) => {
        setDetailDialog({ open: true, title, content });
    };

    // 解决告警
    const handleResolveAlert = async () => {
        if (!canResolveAlert) return;
        try {
            await apiClient.post(`/api/v1/system/alerts/${resolveDialog.alertId}/resolve`, {
                resolution_note: resolveDialog.note
            });
            setResolveDialog({ open: false, alertId: '', note: '' });
            setSnackbar({ open: true, message: '告警已解决', severity: 'success' });
            fetchAlerts();
        } catch (err: any) {
            setSnackbar({ open: true, message: err.response?.data?.detail || '解决告警失败', severity: 'error' });
        }
    };

    // ========== 渲染告警表格 ==========
    const renderAlertsTable = () => (
        <>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel
                                    active={alertSort.field === 'level'}
                                    direction={alertSort.field === 'level' ? alertSort.order : 'asc'}
                                    onClick={() => handleSort('level')}
                                >
                                    级别
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>标题</TableCell>
                            <TableCell sx={{ maxWidth: 250 }}>内容</TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={alertSort.field === 'status'}
                                    direction={alertSort.field === 'status' ? alertSort.order : 'asc'}
                                    onClick={() => handleSort('status')}
                                >
                                    状态
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={alertSort.field === 'task_type'}
                                    direction={alertSort.field === 'task_type' ? alertSort.order : 'asc'}
                                    onClick={() => handleSort('task_type')}
                                >
                                    任务类型
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={alertSort.field === 'created_at'}
                                    direction={alertSort.field === 'created_at' ? alertSort.order : 'asc'}
                                    onClick={() => handleSort('created_at')}
                                >
                                    时间
                                </TableSortLabel>
                            </TableCell>
                            <TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {alerts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>暂无数据</Typography>
                                </TableCell>
                            </TableRow>
                        ) : alerts.map((alert) => (
                            <TableRow key={alert.alert_id}>
                                <TableCell>
                                    <Chip label={alert.level} color={getLevelColor(alert.level)} size="small" />
                                </TableCell>
                                <TableCell sx={{ fontWeight: 'medium' }}>{alert.title}</TableCell>
                                <TableCell sx={{ maxWidth: 250 }}>
                                    <Tooltip title={alert.detail_content || alert.content}>
                                        <Typography noWrap variant="body2">{alert.detail_content || alert.content}</Typography>
                                    </Tooltip>
                                </TableCell>
                                <TableCell>
                                    <Chip {...getStatusConfig(alert.status)} size="small" />
                                </TableCell>
                                <TableCell>{alert.task_type}</TableCell>
                                <TableCell>{safeFormatDate(alert.created_at)}</TableCell>
                                <TableCell align="right">
                                    <Tooltip title="查看详情">
                                        <IconButton size="small" onClick={() => handleViewDetail('告警详情', alert)}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {alert.status === 'ACTIVE' && (
                                        <Tooltip title="解决">
                                            <IconButton size="small" onClick={() => setResolveDialog({ open: true, alertId: alert.alert_id, note: '' })} disabled={!canResolveAlert}>
                                                <CheckIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            <TablePagination
                component="div"
                count={alertTotal}
                page={alertPage}
                rowsPerPage={alertPageSize}
                onPageChange={(_, page) => setAlertPage(page)}
                onRowsPerPageChange={(e) => { setAlertPageSize(parseInt(e.target.value)); setAlertPage(0); }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
            />
        </>
    );

    // ========== 渲染任务日志表格 ==========
    const renderLogsTable = () => (
        <>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel
                                    active={logSort.field === 'task_name'}
                                    direction={logSort.field === 'task_name' ? logSort.order : 'asc'}
                                    onClick={() => handleSort('task_name')}
                                >
                                    任务名称
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={logSort.field === 'task_type'}
                                    direction={logSort.field === 'task_type' ? logSort.order : 'asc'}
                                    onClick={() => handleSort('task_type')}
                                >
                                    任务类型
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={logSort.field === 'status'}
                                    direction={logSort.field === 'status' ? logSort.order : 'asc'}
                                    onClick={() => handleSort('status')}
                                >
                                    状态
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={logSort.field === 'start_time'}
                                    direction={logSort.field === 'start_time' ? logSort.order : 'asc'}
                                    onClick={() => handleSort('start_time')}
                                >
                                    开始时间
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={logSort.field === 'duration'}
                                    direction={logSort.field === 'duration' ? logSort.order : 'asc'}
                                    onClick={() => handleSort('duration')}
                                >
                                    耗时
                                </TableSortLabel>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 200 }}>摘要</TableCell>
                            <TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {logs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>暂无数据</Typography>
                                </TableCell>
                            </TableRow>
                        ) : logs.map((log) => (
                            <TableRow key={log.task_id}>
                                <TableCell sx={{ fontWeight: 'medium' }}>{log.task_name}</TableCell>
                                <TableCell>{log.task_type}</TableCell>
                                <TableCell>
                                    <Chip {...getStatusConfig(log.status)} size="small" />
                                </TableCell>
                                <TableCell>{safeFormatDate(log.start_time)}</TableCell>
                                <TableCell>{log.duration != null ? `${log.duration.toFixed(1)}s` : '-'}</TableCell>
                                <TableCell sx={{ maxWidth: 200 }}>
                                    <Tooltip title={log.summary || ''}>
                                        <Typography noWrap variant="body2">{log.summary || '-'}</Typography>
                                    </Tooltip>
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="查看详情">
                                        <IconButton size="small" onClick={() => handleViewDetail('任务日志详情', log)}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            <TablePagination
                component="div"
                count={logTotal}
                page={logPage}
                rowsPerPage={logPageSize}
                onPageChange={(_, page) => setLogPage(page)}
                onRowsPerPageChange={(e) => { setLogPageSize(parseInt(e.target.value)); setLogPage(0); }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
            />
        </>
    );

    // ========== 渲染远程指令表格 ==========
    const renderCommandsTable = () => (
        <>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'command'}
                                    direction={commandSort.field === 'command' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('command')}
                                >
                                    指令
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'task_type'}
                                    direction={commandSort.field === 'task_type' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('task_type')}
                                >
                                    任务类型
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'status'}
                                    direction={commandSort.field === 'status' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('status')}
                                >
                                    状态
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'priority'}
                                    direction={commandSort.field === 'priority' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('priority')}
                                >
                                    优先级
                                </TableSortLabel>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 150 }}>参数</TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'created_by'}
                                    direction={commandSort.field === 'created_by' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('created_by')}
                                >
                                    创建人
                                </TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel
                                    active={commandSort.field === 'created_at'}
                                    direction={commandSort.field === 'created_at' ? commandSort.order : 'asc'}
                                    onClick={() => handleSort('created_at')}
                                >
                                    时间
                                </TableSortLabel>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 150 }}>结果</TableCell>
                            <TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {commands.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>暂无数据</Typography>
                                </TableCell>
                            </TableRow>
                        ) : commands.map((cmd) => (
                            <TableRow key={cmd.command_id}>
                                <TableCell sx={{ fontWeight: 'medium' }}>{cmd.command}</TableCell>
                                <TableCell>{cmd.task_type}</TableCell>
                                <TableCell>
                                    <Chip {...getStatusConfig(cmd.status)} size="small" />
                                </TableCell>
                                <TableCell>{cmd.priority}</TableCell>
                                <TableCell sx={{ maxWidth: 150 }}>
                                    <Tooltip title={JSON.stringify(cmd.parameters)}>
                                        <Typography noWrap variant="body2">{JSON.stringify(cmd.parameters)}</Typography>
                                    </Tooltip>
                                </TableCell>
                                <TableCell>{cmd.created_by}</TableCell>
                                <TableCell>{safeFormatDate(cmd.created_at)}</TableCell>
                                <TableCell sx={{ maxWidth: 150 }}>
                                    <Tooltip title={cmd.result_message || ''}>
                                        <Typography noWrap variant="body2">{cmd.result_message || '-'}</Typography>
                                    </Tooltip>
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="查看详情">
                                        <IconButton size="small" onClick={() => handleViewDetail('指令详情', cmd)}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            <TablePagination
                component="div"
                count={commandTotal}
                page={commandPage}
                rowsPerPage={commandPageSize}
                onPageChange={(_, page) => setCommandPage(page)}
                onRowsPerPageChange={(e) => { setCommandPageSize(parseInt(e.target.value)); setCommandPage(0); }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
            />
        </>
    );

    // ========== 渲染移动端空状态 ==========
    const renderEmptyState = () => (
        <Box sx={{ py: 8, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', bgcolor: 'background.paper', borderRadius: 1 }}>
            <Typography color="text.secondary" variant="body1">暂无数据</Typography>
        </Box>
    );

    // ========== 渲染移动端卡片 ==========
    const renderMobileCards = () => {
        switch (currentTab) {
            case 'alerts':
                if (!Array.isArray(alerts) || alerts.length === 0) return renderEmptyState();
                return alerts.map((alert) => (
                    <Paper key={alert.alert_id} variant="outlined" sx={{ p: 2, mb: 2, overflow: 'hidden' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'min-content 1fr', gap: 1, mb: 1, alignItems: 'center' }}>
                            <Chip label={alert.level || 'INFO'} color={getLevelColor(alert.level)} size="small" />
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>{alert.title}</Typography>
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', mb: 1 }}>
                            <Typography variant="body2" color="text.secondary" noWrap>{alert.content || '-'}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                            <Box>
                                <Typography variant="caption" color="text.secondary">状态:</Typography>
                                <Chip {...getStatusConfig(alert.status)} size="small" sx={{ ml: 0.5 }} />
                            </Box>
                            <Box>
                                <Typography variant="caption" color="text.secondary">任务:</Typography>
                                <Typography variant="body2" component="span" sx={{ ml: 0.5 }}>{alert.task_type}</Typography>
                            </Box>
                        </Box>
                        <Typography variant="caption" color="text.secondary">时间: {safeFormatDate(alert.created_at)}</Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 1 }}>
                            <Button size="small" startIcon={<VisibilityIcon />} onClick={() => handleViewDetail('告警详情', alert)}>查看</Button>
                            {alert.status === 'ACTIVE' && (
                                <Button size="small" startIcon={<CheckIcon />} onClick={() => setResolveDialog({ open: true, alertId: alert.alert_id, note: '' })} disabled={!canResolveAlert}>解决</Button>
                            )}
                        </Box>
                    </Paper>
                ));
            case 'logs':
                if (!Array.isArray(logs) || logs.length === 0) return renderEmptyState();
                return logs.map((log) => (
                    <Paper key={log.task_id} variant="outlined" sx={{ p: 2, mb: 2, overflow: 'hidden' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', mb: 1 }}>
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>{log.task_name}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Chip {...getStatusConfig(log.status)} size="small" />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2"><strong>类型:</strong> {log.task_type}</Typography>
                            <Typography variant="body2">
                                <strong>耗时:</strong> {(log.duration !== undefined && log.duration !== null && !isNaN(Number(log.duration))) ? `${Number(log.duration).toFixed(1)}s` : '-'}
                            </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary">时间: {safeFormatDate(log.start_time)}</Typography>
                        {log.summary && (
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', mt: 1 }}>
                                <Typography variant="body2" color="text.secondary" noWrap>摘要: {log.summary}</Typography>
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                            <Button size="small" startIcon={<VisibilityIcon />} onClick={() => handleViewDetail('任务日志详情', log)}>查看详情</Button>
                        </Box>
                    </Paper>
                ));
            case 'commands':
                if (!Array.isArray(commands) || commands.length === 0) return renderEmptyState();
                return commands.map((cmd) => (
                    <Paper key={cmd.command_id} variant="outlined" sx={{ p: 2, mb: 2, overflow: 'hidden' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', mb: 1 }}>
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>{cmd.command}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Chip {...getStatusConfig(cmd.status)} size="small" />
                            <Typography variant="body2">优先级: {cmd.priority}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2"><strong>任务:</strong> {cmd.task_type}</Typography>
                            <Typography variant="body2"><strong>创建人:</strong> {cmd.created_by}</Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary">时间: {safeFormatDate(cmd.created_at)}</Typography>
                        {cmd.parameters && (
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', mt: 1 }}>
                                <Typography variant="body2" color="text.secondary" noWrap>参数: {typeof cmd.parameters === 'object' ? JSON.stringify(cmd.parameters) : String(cmd.parameters)}</Typography>
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                            <Button size="small" startIcon={<VisibilityIcon />} onClick={() => handleViewDetail('指令详情', cmd)}>查看详情</Button>
                        </Box>
                    </Paper>
                ));
            default:
                return null;
        }
    };

    // ========== 渲染筛选区域内容 ==========
    const renderFilterContent = () => {
        const commonDatePicker = (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <DatePicker
                    label="按日期筛选"
                    value={selectedDate}
                    onChange={(date) => setSelectedDate(date)}
                    disabled={loading}
                    slotProps={{
                        textField: { size: 'small', sx: { width: { xs: '100%', sm: '180px' } } },
                        field: { clearable: true }
                    }}
                />
            </Box>
        );

        switch (currentTab) {
            case 'alerts':
                return (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: isMobile ? 'stretch' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
                        {commonDatePicker}
                        <TextField
                            select
                            label="告警级别"
                            value={alertFilters.level}
                            onChange={(e) => { setAlertFilters(prev => ({ ...prev, level: e.target.value })); setAlertPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '120px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.alerts?.levels?.map(level => (
                                <MenuItem key={level} value={level}>{level}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="状态"
                            value={alertFilters.status}
                            onChange={(e) => { setAlertFilters(prev => ({ ...prev, status: e.target.value })); setAlertPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '120px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.alerts?.statuses?.map(status => (
                                <MenuItem key={status} value={status}>{getStatusConfig(status).label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="任务类型"
                            value={alertFilters.task_type}
                            onChange={(e) => { setAlertFilters(prev => ({ ...prev, task_type: e.target.value })); setAlertPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '160px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.alerts?.task_types?.map(type => (
                                <MenuItem key={type} value={type}>{type}</MenuItem>
                            ))}
                        </TextField>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="outlined" onClick={handleReset}>重置</Button>
                            <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleRefresh} disabled={loading}>刷新</Button>
                        </Box>
                    </Box>
                );
            case 'logs':
                return (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: isMobile ? 'stretch' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
                        {commonDatePicker}
                        <TextField
                            select
                            label="任务状态"
                            value={logFilters.status}
                            onChange={(e) => { setLogFilters(prev => ({ ...prev, status: e.target.value })); setLogPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '140px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.logs?.statuses?.map(status => (
                                <MenuItem key={status} value={status}>{getStatusConfig(status).label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="任务类型"
                            value={logFilters.task_type}
                            onChange={(e) => { setLogFilters(prev => ({ ...prev, task_type: e.target.value })); setLogPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '160px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.logs?.task_types?.map(type => (
                                <MenuItem key={type} value={type}>{type}</MenuItem>
                            ))}
                        </TextField>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="outlined" onClick={handleReset}>重置</Button>
                            <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleRefresh} disabled={loading}>刷新</Button>
                        </Box>
                    </Box>
                );
            case 'commands':
                return (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: isMobile ? 'stretch' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
                        {commonDatePicker}
                        <TextField
                            select
                            label="指令状态"
                            value={commandFilters.status}
                            onChange={(e) => { setCommandFilters(prev => ({ ...prev, status: e.target.value })); setCommandPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '140px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.commands?.statuses?.map(status => (
                                <MenuItem key={status} value={status}>{getStatusConfig(status).label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="指令类型"
                            value={commandFilters.command}
                            onChange={(e) => { setCommandFilters(prev => ({ ...prev, command: e.target.value })); setCommandPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '180px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.commands?.commands?.map(cmd => (
                                <MenuItem key={cmd} value={cmd}>{cmd}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="任务类型"
                            value={commandFilters.task_type}
                            onChange={(e) => { setCommandFilters(prev => ({ ...prev, task_type: e.target.value })); setCommandPage(0); }}
                            size="small"
                            sx={{ width: { xs: '100%', sm: '160px' } }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {filterOptions?.commands?.task_types?.map(type => (
                                <MenuItem key={type} value={type}>{type}</MenuItem>
                            ))}
                        </TextField>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="outlined" onClick={handleReset}>重置</Button>
                            <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleRefresh} disabled={loading}>刷新</Button>
                        </Box>
                    </Box>
                );
            default:
                return null;
        }
    };

    // ========== 主渲染 ==========
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}>
                        系统管理 / 告警与日志
                    </Typography>
                )}

                {/* Tab切换 */}
                <Paper variant="outlined" sx={{ mb: 2 }}>
                    <Tabs
                        value={currentTab}
                        onChange={(_, val) => setCurrentTab(val)}
                        variant={isMobile ? 'fullWidth' : 'standard'}
                        sx={{
                            minHeight: isMobile ? 40 : 48,
                            '& .MuiTab-root': {
                                minHeight: isMobile ? 40 : 48,
                                padding: isMobile ? '6px 8px' : '12px 16px',
                                fontSize: isMobile ? '0.85rem' : '0.875rem',
                                minWidth: isMobile ? 'auto' : 90
                            }
                        }}
                    >
                        <Tab label={isMobile ? '告警' : `告警 (${alertTotal})`} value="alerts" />
                        <Tab label={isMobile ? '任务日志' : `任务日志 (${logTotal})`} value="logs" />
                        <Tab label={isMobile ? '远程指令' : `远程指令 (${commandTotal})`} value="commands" />
                    </Tabs>
                </Paper>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {/* 筛选区域 */}
                <Paper variant="outlined" sx={{ mb: 2 }}>
                    {/* 移动端折叠标题栏 */}
                    {isMobile && (
                        <Box
                            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5 }}
                            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}>
                                <FilterListIcon sx={{ color: 'primary.main' }} />
                                <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>筛选条件</Typography>
                                {hasActiveFilters() && <Chip size="small" label="已筛选" color="primary" variant="outlined" />}
                            </Box>
                            {isFilterExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </Box>
                    )}

                    {/* 筛选内容 */}
                    {(!isMobile || isFilterExpanded) && (
                        <Box sx={{ p: 2 }}>
                            {renderFilterContent()}
                            {isMobile && (
                                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                                    <Button variant="text" onClick={() => setIsFilterExpanded(false)} startIcon={<ExpandLessIcon />} sx={{ color: 'text.secondary' }}>
                                        收起筛选
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    )}
                </Paper>

                {/* 数据区域 */}
                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                    {loading ? (
                        <Box display="flex" justifyContent="center" alignItems="center" py={4}>
                            <CircularProgress />
                        </Box>
                    ) : isMobile ? (
                        <Box>
                            {renderMobileCards()}
                            {/* 移动端分页 */}
                            <TablePagination
                                component="div"
                                count={currentTab === 'alerts' ? alertTotal : currentTab === 'logs' ? logTotal : commandTotal}
                                page={currentTab === 'alerts' ? alertPage : currentTab === 'logs' ? logPage : commandPage}
                                rowsPerPage={currentTab === 'alerts' ? alertPageSize : currentTab === 'logs' ? logPageSize : commandPageSize}
                                onPageChange={(_, page) => {
                                    switch (currentTab) {
                                        case 'alerts': setAlertPage(page); break;
                                        case 'logs': setLogPage(page); break;
                                        case 'commands': setCommandPage(page); break;
                                    }
                                }}
                                onRowsPerPageChange={(e) => {
                                    const size = parseInt(e.target.value);
                                    switch (currentTab) {
                                        case 'alerts': setAlertPageSize(size); setAlertPage(0); break;
                                        case 'logs': setLogPageSize(size); setLogPage(0); break;
                                        case 'commands': setCommandPageSize(size); setCommandPage(0); break;
                                    }
                                }}
                                rowsPerPageOptions={[10, 25, 50]}
                                labelRowsPerPage="每页"
                                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                            />
                        </Box>
                    ) : (
                        <>
                            {currentTab === 'alerts' && renderAlertsTable()}
                            {currentTab === 'logs' && renderLogsTable()}
                            {currentTab === 'commands' && renderCommandsTable()}
                        </>
                    )}
                </Paper>

                {/* 详情对话框 */}
                <Dialog open={detailDialog.open} onClose={() => setDetailDialog({ open: false, title: '', content: null })} maxWidth="md" fullWidth>
                    <DialogTitle>{detailDialog.title}</DialogTitle>
                    <DialogContent>
                        {isAlertItem(detailDialog.content) ? (
                            <Box sx={{ bgcolor: 'grey.100', p: 2, borderRadius: 1, maxHeight: '60vh', overflow: 'auto' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                                    {detailDialog.content.title}
                                </Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                                    {detailDialog.content.detail_content || detailDialog.content.content || '暂无告警详情'}
                                </Typography>
                            </Box>
                        ) : (
                            <Box component="pre" sx={{ bgcolor: 'grey.100', p: 2, borderRadius: 1, overflow: 'auto', fontSize: '0.875rem', maxHeight: '60vh' }}>
                                {JSON.stringify(detailDialog.content, null, 2)}
                            </Box>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDetailDialog({ open: false, title: '', content: null })}>关闭</Button>
                    </DialogActions>
                </Dialog>

                {/* 解决告警对话框 */}
                <Dialog open={resolveDialog.open} onClose={() => setResolveDialog({ open: false, alertId: '', note: '' })} maxWidth="sm" fullWidth>
                    <DialogTitle>解决告警</DialogTitle>
                    <DialogContent>
                        <TextField
                            fullWidth
                            multiline
                            rows={4}
                            label="解决说明"
                            value={resolveDialog.note}
                            onChange={(e) => setResolveDialog({ ...resolveDialog, note: e.target.value })}
                            sx={{ mt: 2 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setResolveDialog({ open: false, alertId: '', note: '' })}>取消</Button>
                        <Button onClick={handleResolveAlert} variant="contained" disabled={!canResolveAlert}>确认解决</Button>
                    </DialogActions>
                </Dialog>

                {/* Snackbar */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={3000}
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    message={snackbar.message}
                />
            </Box>
        </LocalizationProvider>
    );
};
