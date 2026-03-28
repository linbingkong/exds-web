import React, { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
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
    Tooltip,
    Snackbar,
    useTheme,
    useMediaQuery,
    LinearProgress,
    alpha
} from '@mui/material';
import {
    Search as SearchIcon,
    Upload as UploadIcon,
    Visibility as VisibilityIcon,
    People as PeopleIcon,
    Sync as SyncIcon,
    Warning as WarningIcon,
    Error as ErrorIcon,
    PlayArrow as PlayArrowIcon,
    HourglassEmpty as HourglassEmptyIcon,
    BrokenImage as BrokenImageIcon
} from '@mui/icons-material';
import Grid from '@mui/material/Grid';
import apiClient from '../api/client';
import { LoadDataImportDialog } from '../components/load-diagnosis/LoadDataImportDialog';
import { LoadDataAggregationDialog } from '../components/load-diagnosis/LoadDataAggregationDialog';
import { useTabContext } from '../contexts/TabContext';
import { LoadDataDiagnosisWorkbench } from './LoadDataDiagnosisWorkbench';
import { useAuth } from '../contexts/AuthContext';

// 诊断结果类型
interface DiagnosisResult {
    customer_id: string;
    customer_name: string;
    date_range: { start: string | null; end: string | null };
    total_days: number;
    breakpoint_days: number;
    data_distribution: { mp_days: number; meter_days: number };
    incomplete_days: { mp_incomplete: number; meter_incomplete: number };
    max_error: number | null;
    has_unaggregated: { mp: boolean; meter: boolean };
}

// 统计摘要类型
interface DiagnosisSummary {
    total_customers: number;
    unaggregated_customers: number;
    error_anomaly_customers: number;
    mp_missing_customers: number;
    meter_missing_customers: number;
    breakpoint_customers: number;
}

// 排序方向类型
type Order = 'asc' | 'desc';

// 可排序的列
type SortableColumn = 'customer_name' | 'start_date' | 'end_date' | 'total_days' | 'breakpoint_days' | 'mp_incomplete' | 'meter_incomplete' | 'max_error';

export const LoadDataDiagnosisPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { addTab } = useTabContext();
    const { hasPermission } = useAuth();
    const canValidationEdit = hasPermission('module:basic_load_validation:edit');
    const canManualImportEdit = hasPermission('module:basic_monthly_manual_import:edit');

    // 状态
    const [loading, setLoading] = useState(false);
    const [diagnosing, setDiagnosing] = useState(false);
    const [diagnosisProgress, setDiagnosisProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // 数据
    const [customers, setCustomers] = useState<{ customer_id: string; customer_name: string }[]>([]);
    const [diagnosisResults, setDiagnosisResults] = useState<DiagnosisResult[]>([]);
    const [summary, setSummary] = useState<DiagnosisSummary | null>(null);

    // 客户端分页
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);

    // 客户端排序
    const [orderBy, setOrderBy] = useState<SortableColumn>('customer_name');
    const [order, setOrder] = useState<Order>('asc');

    // 筛选
    const [searchKeyword, setSearchKeyword] = useState('');

    // 弹窗状态
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [aggregationDialogOpen, setAggregationDialogOpen] = useState(false);

    // Snackbar
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({
        open: false,
        message: '',
        severity: 'info'
    });

    const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        setSnackbar({ open: true, message, severity });
    };

    // 初始加载：获取签约客户列表
    const fetchSignedCustomers = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiClient.get('/api/v1/load-data/signed-customers');
            setCustomers(response.data.customers || []);

            // 尝试从 sessionStorage 恢复诊断结果
            try {
                const savedResults = sessionStorage.getItem('load_diagnosis_results');
                const savedSummary = sessionStorage.getItem('load_diagnosis_summary');

                if (savedResults && savedSummary) {
                    setDiagnosisResults(JSON.parse(savedResults));
                    const parsedSummary = JSON.parse(savedSummary);
                    // 确保总数与最新获取的客户列表一致
                    parsedSummary.total_customers = response.data.total || (response.data.customers || []).length;
                    setSummary(parsedSummary);
                } else {
                    // 初始化空的诊断结果
                    setDiagnosisResults([]);
                    setSummary({
                        total_customers: response.data.total || 0,
                        unaggregated_customers: 0,
                        error_anomaly_customers: 0,
                        mp_missing_customers: 0,
                        meter_missing_customers: 0,
                        breakpoint_customers: 0
                    });
                }
            } catch (e) {
                console.warn('Failed to restore diagnosis state:', e);
                setDiagnosisResults([]);
            }
        } catch (err: any) {
            console.error('获取签约客户失败:', err);
            setError(err.response?.data?.detail || err.message || '获取数据失败');
        } finally {
            setLoading(false);
        }
    };

    // 执行诊断
    const handleDiagnose = async () => {
        if (!canValidationEdit) return;
        setDiagnosing(true);
        setDiagnosisProgress(0);
        try {
            const response = await apiClient.post('/api/v1/load-data/diagnose');
            const results = response.data.customers || [];
            const summaryData = response.data.summary;

            setDiagnosisResults(results);
            setSummary(summaryData);

            // 保存到 sessionStorage
            sessionStorage.setItem('load_diagnosis_results', JSON.stringify(results));
            sessionStorage.setItem('load_diagnosis_summary', JSON.stringify(summaryData));

            showSnackbar('诊断完成', 'success');
        } catch (err: any) {
            console.error('诊断失败:', err);
            showSnackbar(err.response?.data?.detail || err.message || '诊断失败', 'error');
        } finally {
            setDiagnosing(false);
            setDiagnosisProgress(100);
        }
    };

    // 清除缓存（在数据变更时调用）
    const clearDiagnosisCache = () => {
        sessionStorage.removeItem('load_diagnosis_results');
        sessionStorage.removeItem('load_diagnosis_summary');
        setDiagnosisResults([]);
        setSummary(prev => prev ? ({
            ...prev,
            unaggregated_customers: 0,
            error_anomaly_customers: 0,
            mp_missing_customers: 0,
            meter_missing_customers: 0,
            breakpoint_customers: 0
        }) : null);
    };

    // 初始化
    useEffect(() => {
        fetchSignedCustomers();
    }, []);

    // 筛选和排序后的数据
    const filteredAndSortedData = useMemo(() => {
        // 合并客户列表和诊断结果
        const mergedData = customers.map(c => {
            const diagnosis = diagnosisResults.find(d => d.customer_id === c.customer_id);
            return diagnosis || {
                customer_id: c.customer_id,
                customer_name: c.customer_name,
                date_range: { start: null, end: null },
                total_days: 0,
                breakpoint_days: 0,
                data_distribution: { mp_days: 0, meter_days: 0 },
                incomplete_days: { mp_incomplete: 0, meter_incomplete: 0 },
                max_error: null,
                has_unaggregated: { mp: false, meter: false }
            } as DiagnosisResult;
        });

        // 筛选
        let filtered = mergedData;
        if (searchKeyword) {
            const keyword = searchKeyword.toLowerCase();
            filtered = mergedData.filter(d =>
                d.customer_name.toLowerCase().includes(keyword)
            );
        }

        // 排序
        filtered.sort((a, b) => {
            const asc = order === 'asc' ? 1 : -1;
            switch (orderBy) {
                case 'customer_name':
                    return asc * a.customer_name.localeCompare(b.customer_name, 'zh');
                case 'start_date':
                    const startA = a.date_range?.start || '';
                    const startB = b.date_range?.start || '';
                    return asc * startA.localeCompare(startB);
                case 'end_date':
                    const endA = a.date_range?.end || '';
                    const endB = b.date_range?.end || '';
                    return asc * endA.localeCompare(endB);
                case 'total_days':
                    return asc * (a.total_days - b.total_days);
                case 'breakpoint_days':
                    return asc * (a.breakpoint_days - b.breakpoint_days);
                case 'mp_incomplete':
                    return asc * (a.incomplete_days.mp_incomplete - b.incomplete_days.mp_incomplete);
                case 'meter_incomplete':
                    return asc * (a.incomplete_days.meter_incomplete - b.incomplete_days.meter_incomplete);
                case 'max_error':
                    const aErr = a.max_error ?? -Infinity;
                    const bErr = b.max_error ?? -Infinity;
                    return asc * (aErr - bErr);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [customers, diagnosisResults, searchKeyword, orderBy, order]);

    // 当前页数据
    const paginatedData = useMemo(() => {
        const start = page * pageSize;
        return filteredAndSortedData.slice(start, start + pageSize);
    }, [filteredAndSortedData, page, pageSize]);

    // 排序处理
    const handleSort = (column: SortableColumn) => {
        if (orderBy === column) {
            setOrder(order === 'asc' ? 'desc' : 'asc');
        } else {
            setOrderBy(column);
            setOrder('asc');
        }
    };

    // 查看详情
    const handleViewDetail = (customerId: string, customerName: string) => {
        addTab({
            key: `load-diagnosis-${customerId}`,
            title: `诊断：${customerName}`,
            path: `/load-diagnosis/${customerId}`,
            component: <LoadDataDiagnosisWorkbench customerId={customerId} />
        });
    };

    // 判断是否已诊断
    const isDiagnosed = diagnosisResults.length > 0;

    // 导出计量点缺失数据
    const handleExportMpMissing = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/api/v1/load-data/export/mp-missing', {
                responseType: 'blob'
            });

            // 下载文件
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const contentDisposition = response.headers['content-disposition'];
            let filename = '计量点缺失明细.xlsx';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)/);
                if (filenameMatch) {
                    filename = decodeURIComponent(filenameMatch[1]);
                }
            }
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '导出失败');
        } finally {
            setLoading(false);
        }
    };

    // 统计卡片组件
    const StatCard: React.FC<{
        title: string;
        value: number | string;
        icon: React.ReactNode;
        color: string;
        onClick?: () => void;
        tooltip?: string;
    }> = ({ title, value, icon, color, onClick, tooltip }) => (
        <Paper
            variant="outlined"
            sx={{
                p: { xs: 1.5, sm: 2 },
                display: 'flex',
                alignItems: 'center',
                borderRadius: 2,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: alpha(color, 0.2),
                background: `linear-gradient(135deg, ${alpha(color, 0.03)} 0%, ${alpha(color, 0.07)} 100%)`,
                cursor: onClick ? 'pointer' : 'default',
                transition: 'all 0.2s',
                '&:hover': onClick ? {
                    boxShadow: 2,
                    transform: 'translateY(-2px)'
                } : undefined
            }}
            onClick={onClick}
        >
            <Box sx={{
                color: color,
                mr: { xs: 1, sm: 2 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: { xs: 36, sm: 44 },
                height: { xs: 36, sm: 44 },
                borderRadius: '50%',
                bgcolor: `${color}15`
            }}>
                {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" noWrap>
                    {title}
                </Typography>
                <Tooltip title={tooltip || ''}>
                    <Typography variant="h6" fontWeight="bold" sx={{ color: color }}>
                        {value}
                    </Typography>
                </Tooltip>
            </Box>
        </Paper>
    );

    // 渲染统计卡片
    const renderSummaryCards = () => (
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="签约客户"
                    value={summary?.total_customers || 0}
                    icon={<PeopleIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#1976d2"
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="未聚合客户"
                    value={isDiagnosed ? (summary?.unaggregated_customers || 0) : '-'}
                    icon={<SyncIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#0288d1"
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="误差异常"
                    value={isDiagnosed ? (summary?.error_anomaly_customers || 0) : '-'}
                    icon={<ErrorIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#d32f2f"
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="计量点缺失"
                    value={isDiagnosed ? (summary?.mp_missing_customers || 0) : '-'}
                    icon={<WarningIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#ed6c02"
                    onClick={handleExportMpMissing}
                    tooltip="点击导出缺失明细"
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="电表缺失"
                    value={isDiagnosed ? (summary?.meter_missing_customers || 0) : '-'}
                    icon={<HourglassEmptyIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#9c27b0"
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                    title="断点客户"
                    value={isDiagnosed ? (summary?.breakpoint_customers || 0) : '-'}
                    icon={<BrokenImageIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />}
                    color="#607d8b"
                />
            </Grid>
        </Grid>
    );

    // 渲染表格
    const renderTable = () => (
        <TableContainer>
            <Table sx={{
                '& .MuiTableCell-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    px: { xs: 0.5, sm: 1.5 }
                }
            }}>
                <TableHead>
                    <TableRow>
                        <TableCell>
                            <TableSortLabel
                                active={orderBy === 'customer_name'}
                                direction={orderBy === 'customer_name' ? order : 'asc'}
                                onClick={() => handleSort('customer_name')}
                            >
                                客户名称
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'start_date'}
                                direction={orderBy === 'start_date' ? order : 'asc'}
                                onClick={() => handleSort('start_date')}
                            >
                                开始日期
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'end_date'}
                                direction={orderBy === 'end_date' ? order : 'asc'}
                                onClick={() => handleSort('end_date')}
                            >
                                结束日期
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'total_days'}
                                direction={orderBy === 'total_days' ? order : 'asc'}
                                onClick={() => handleSort('total_days')}
                            >
                                周期
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'breakpoint_days'}
                                direction={orderBy === 'breakpoint_days' ? order : 'asc'}
                                onClick={() => handleSort('breakpoint_days')}
                            >
                                断点
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">数据分布</TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'mp_incomplete'}
                                direction={orderBy === 'mp_incomplete' ? order : 'asc'}
                                onClick={() => handleSort('mp_incomplete')}
                            >
                                计量点缺失
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'meter_incomplete'}
                                direction={orderBy === 'meter_incomplete' ? order : 'asc'}
                                onClick={() => handleSort('meter_incomplete')}
                            >
                                电表缺失
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">
                            <TableSortLabel
                                active={orderBy === 'max_error'}
                                direction={orderBy === 'max_error' ? order : 'asc'}
                                onClick={() => handleSort('max_error')}
                            >
                                当年最大误差
                            </TableSortLabel>
                        </TableCell>
                        <TableCell align="center">未聚合</TableCell>
                        <TableCell align="center">操作</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {paginatedData.map((row) => {
                        const hasDiagnosis = diagnosisResults.some(d => d.customer_id === row.customer_id);
                        return (
                            <TableRow key={row.customer_id} hover>
                                <TableCell>
                                    <Typography
                                        sx={{
                                            cursor: 'pointer',
                                            color: 'primary.main',
                                            '&:hover': { textDecoration: 'underline' }
                                        }}
                                        onClick={() => handleViewDetail(row.customer_id, row.customer_name)}
                                    >
                                        {row.customer_name}
                                    </Typography>
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis && row.date_range.start
                                        ? row.date_range.start
                                        : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis && row.date_range.end
                                        ? row.date_range.end
                                        : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis ? `${row.total_days}天` : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis ? row.breakpoint_days : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis
                                        ? `${row.data_distribution.mp_days}/${row.data_distribution.meter_days}`
                                        : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis ? row.incomplete_days.mp_incomplete : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis ? row.incomplete_days.meter_incomplete : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis && row.max_error !== null
                                        ? `${row.max_error.toFixed(1)}%`
                                        : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    {hasDiagnosis
                                        ? `${row.has_unaggregated.mp ? '是' : '否'}/${row.has_unaggregated.meter ? '是' : '否'}`
                                        : '-'}
                                </TableCell>
                                <TableCell align="center">
                                    <Tooltip title="查看详情">
                                        <IconButton
                                            size="small"
                                            onClick={() => handleViewDetail(row.customer_id, row.customer_name)}
                                        >
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );

    // 渲染移动端卡片
    const renderMobileCards = () => (
        <Box>
            {paginatedData.map((row) => {
                const hasDiagnosis = diagnosisResults.some(d => d.customer_id === row.customer_id);
                return (
                    <Paper key={row.customer_id} variant="outlined" sx={{ p: 2, mb: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography
                                variant="subtitle1"
                                sx={{
                                    cursor: 'pointer',
                                    color: 'primary.main',
                                    fontWeight: 'bold',
                                    '&:hover': { textDecoration: 'underline' }
                                }}
                                onClick={() => handleViewDetail(row.customer_id, row.customer_name)}
                            >
                                {row.customer_name}
                            </Typography>
                        </Box>
                        {hasDiagnosis ? (
                            <>
                                <Typography variant="caption" display="block">
                                    周期: {row.date_range.start} ~ {row.date_range.end} ({row.total_days}天)
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                                    <Typography variant="caption">断点: {row.breakpoint_days}</Typography>
                                    <Typography variant="caption">
                                        分布: {row.data_distribution.mp_days}/{row.data_distribution.meter_days}
                                    </Typography>
                                    <Typography variant="caption">
                                        误差: {row.max_error !== null ? `${row.max_error.toFixed(1)}%` : '-'}
                                    </Typography>
                                </Box>
                            </>
                        ) : (
                            <Typography variant="caption" color="text.secondary">
                                未诊断
                            </Typography>
                        )}
                    </Paper>
                );
            })}
        </Box>
    );

    return (
        <Box sx={{ width: '100%' }}>
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
                    基础数据 / 负荷数据诊断
                </Typography>
            )}

            {/* 第一行: 统计卡片 */}
            {renderSummaryCards()}

            {/* 第二行: 筛选与诊断按钮 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1, minWidth: { xs: '100%', sm: 'auto' } }}>
                        <TextField
                            placeholder="搜索客户名称"
                            size="small"
                            value={searchKeyword}
                            onChange={(e) => {
                                setSearchKeyword(e.target.value);
                                setPage(0);
                            }}
                            InputProps={{
                                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                            }}
                            sx={{ width: { xs: '100%', sm: '300px' } }}
                        />
                        <Button
                            variant="contained"
                            startIcon={diagnosing ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                            onClick={handleDiagnose}
                            disabled={diagnosing || loading || !canValidationEdit}
                            sx={{ whiteSpace: 'nowrap' }}
                        >
                            {diagnosing ? '诊断中...' : '执行诊断'}
                        </Button>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            variant="text"
                            startIcon={<UploadIcon />}
                            onClick={() => setImportDialogOpen(true)}
                            disabled={!canManualImportEdit}
                        >
                            导入数据
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<SyncIcon />}
                            onClick={() => setAggregationDialogOpen(true)}
                            disabled={diagnosing || !canManualImportEdit}
                        >
                            执行聚合
                        </Button>
                    </Box>
                </Box>

                {/* 诊断进度条 */}
                {diagnosing && (
                    <Box sx={{ mt: 2 }}>
                        <LinearProgress />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            正在诊断所有签约客户...
                        </Typography>
                    </Box>
                )}
            </Paper>

            {/* 第三行: 客户列表 */}
            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : filteredAndSortedData.length === 0 ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                        <Typography color="text.secondary">暂无签约客户</Typography>
                    </Box>
                ) : (
                    <>
                        {isMobile ? renderMobileCards() : renderTable()}

                        <TablePagination
                            component="div"
                            count={filteredAndSortedData.length}
                            page={page}
                            onPageChange={(_, newPage) => setPage(newPage)}
                            rowsPerPage={pageSize}
                            onRowsPerPageChange={(e) => {
                                setPageSize(parseInt(e.target.value, 10));
                                setPage(0);
                            }}
                            rowsPerPageOptions={[10, 20, 50]}
                            labelRowsPerPage={isMobile ? '' : '每页行数'}
                        />
                    </>
                )}
            </Paper>

            {/* 导入弹窗 */}
            <LoadDataImportDialog
                open={importDialogOpen}
                onClose={() => setImportDialogOpen(false)}
                canEdit={canManualImportEdit}
                onSuccess={() => {
                    clearDiagnosisCache();
                    fetchSignedCustomers();
                }}
            />

            {/* 聚合弹窗 */}
            <LoadDataAggregationDialog
                open={aggregationDialogOpen}
                onClose={() => setAggregationDialogOpen(false)}
                canEdit={canManualImportEdit}
                onSuccess={() => {
                    clearDiagnosisCache();
                    fetchSignedCustomers();
                }}
            />

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
            >
                <Alert
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    severity={snackbar.severity}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default LoadDataDiagnosisPage;
