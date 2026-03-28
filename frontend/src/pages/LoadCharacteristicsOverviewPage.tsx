import React, { useEffect, useState } from 'react';
import {
    Box, Grid, Paper, Typography, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Chip, LinearProgress, Alert, Button, TablePagination,
    IconButton, TextField, InputAdornment, FormControl, InputLabel, Select, MenuItem,
    CircularProgress, Tooltip, useMediaQuery, Tabs, Tab, Card, CardContent, ListSubheader
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
    ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend,
    ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis, LineChart, Line,
    BarChart, Bar
} from 'recharts';

import { useNavigate } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import VisibilityIcon from '@mui/icons-material/Visibility';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PeopleIcon from '@mui/icons-material/People';

import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Dialog, AppBar, Toolbar, Slide } from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import {
    loadCharacteristicsApi,
    CharacteristicsOverview, CustomerCharacteristics,
    EnhancedTagDistribution, TagChangesResponse, ScatterDataItem, ScatterDataResponse
} from '../api/loadCharacteristics';
import { useTabContext } from '../contexts/TabContext';
import { useAuth } from '../contexts/AuthContext';
import LoadCharacteristicsDetailPage from './LoadCharacteristicsDetailPage';
import { useDebounce } from '../hooks/useDebounce';





// 颜色配置
// Transition for Dialog
const Transition = React.forwardRef(function Transition(
    props: TransitionProps & {
        children: React.ReactElement;
    },
    ref: React.Ref<unknown>,
) {
    return <Slide direction="left" ref={ref} {...props} />;
});

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1'];
const SEVERITY_COLORS = { critical: '#d32f2f', warning: '#ff9800', low: '#4caf50' };

// 标签图标映射
const TAG_ICONS: Record<string, string> = {
    // 生产班次
    '连续生产': '🏭', '全天生产': '🏭', '单班生产': '☀️', '双班生产': '🌙', '三班生产': '🔄', '夜间生产': '🦉', '间歇生产': '🛑', '不规律生产': '〰️',
    // 经营趋势
    '产能扩张': '🚀', '产能萎缩': '🥀', '经营稳健': '⚓',
    // 季节气象
    '冬夏双峰型': '❄️🔥', '冬季单峰型': '❄️', '夏季单峰型': '🔥', '气温敏感型': '🌡️', '气温钝化型': '🧱',
    // 稳定性 (长周期)
    '极度规律型': '📏', '剧烈波动型': '🌊', '间歇停产型': '🛑',
    // 行为规律 (短周期)
    '机器规律型': '🤖', '随机波动型': '🎲',
    // 日历特征
    '标准双休型': '📅', '周末单休型': '🗓️', '周末生产型': '🛠️', '春节深调型': '🧧', '节后慢热型': '🐢',
    // 能源设施
    '光伏自备': '🔋', '储能套利': '⚡', '分布式光伏': '☀️', '分布式储能': '🔋',
    // 成本偏好
    '成本敏感型': '💰', '刚性用电型': '💸', '移谷填峰': '⛰️', '避峰用电': '📉'
};

// 特征分类：长周期 vs 短周期
const CATEGORY_TERM_TYPE: Record<string, 'long' | 'short'> = {
    trend: 'long',
    calendar: 'long',
    stability: 'long',
    seasonal: 'long',
    shift: 'short',
    behavior: 'short',
    facility: 'short',
    cost: 'short'
};

const TAG_DESCRIPTIONS: Record<string, { desc: string; criteria: string }> = {
    // 1. Shift
    '连续生产': { desc: '日均负荷率高，通常为 24 小时连续作业（如三班倒）', criteria: '日均负荷率 > 60%' },
    '全天生产': { desc: '全天有较高负荷，无明显停产时段', criteria: '日均负荷率 > 40% 或 匹配双班模板' },
    '单班生产': { desc: '典型“日出而作，日落而息”，仅在白班时段生产', criteria: '匹配单班(早8晚5)模板 (置信度>0.6)' },
    '双班生产': { desc: '生产时间较长，覆盖白班和小夜班', criteria: '匹配双班(早8晚12)模板 (置信度>0.6)' },
    '间歇生产': { desc: '生产过程断断续续，负荷起停频繁', criteria: '匹配间歇模板' }, // Added placeholder criteria
    '夜间生产': { desc: '主要负荷集中在夜间（可能为避峰生产）', criteria: '夜间负荷占比高' }, // Added placeholder
    '不规律生产': { desc: '无固定生产班次规律', criteria: '无法匹配已知模板且负荷率 < 60%' },

    // 2. Trend
    '产能扩张': { desc: '近期用电量呈现显著上升趋势', criteria: '趋势斜率 > 0.1%/日 (STL分解)' },
    '产能萎缩': { desc: '近期用电量呈现显著下降趋势', criteria: '趋势斜率 < -0.1%/日 (STL分解)' },
    '经营稳健': { desc: '用电量保持相对稳定，波动较小', criteria: '离散系数(CV) < 0.3 且 无显著趋势' },

    // 3. Cost
    '成本敏感型': { desc: '尖峰时段用电占比极低，主动避峰用电', criteria: '尖峰电量占比 < 20%' },
    '刚性用电型': { desc: '尖峰时段用电占比高，对电价不敏感', criteria: '尖峰电量占比 > 30%' },
    '移谷填峰': { desc: '具备显著的负荷转移行为，在低谷时段增加用电', criteria: '谷电量占比显著高于平段' },
    '避峰用电': { desc: '在高峰电价时段主动压降负荷', criteria: '高峰电量占比显著低于平段' },

    // 4. Seasonal
    '冬夏双峰型': { desc: '夏季和冬季均为用电高峰（典型空调用电特征）', criteria: '1月与7月负荷 > 春秋 * 1.3' },
    '冬季单峰型': { desc: '仅在冬季出现显著用电高峰', criteria: '1月负荷 > 春秋 * 1.3' },
    '夏季单峰型': { desc: '仅在夏季出现显著用电高峰', criteria: '7月负荷 > 春秋 * 1.3' },
    '气温敏感型': { desc: '负荷大小与气温变化高度相关', criteria: '负荷与|气温-20℃|相关系数 > 0.6' },
    '气温钝化型': { desc: '负荷受气温变化影响极小', criteria: '相关系数绝对值 < 0.2' },

    // 5. Stability
    '极度规律型': { desc: '每日负荷曲线极其相似，生产计划性极强', criteria: '近30天日电量 CV < 0.2' },
    '剧烈波动型': { desc: '负荷波动大，缺乏稳定性', criteria: 'CV > 0.5' },
    '间歇停产型': { desc: '出现非节假日的长时段停产行为', criteria: '近一年零电量天数占比 > 20%' },

    // 6. Behavior
    '机器规律型': { desc: '负荷曲线呈现典型的机械化特征', criteria: '日曲线余弦相似度 > 0.9' },
    '随机波动型': { desc: '负荷变化无章可循', criteria: '日曲线余弦相似度 < 0.7' },

    // 7. Facility
    '光伏自备': { desc: '识别出午间负荷凹陷特征', criteria: '午间负荷显著低于基线' },
    '储能套利': { desc: '识别出明显的“谷充峰放”特征', criteria: '夜间谷充电、高峰放电特征显著' },
    '分布式光伏': { desc: '明确识别为分布式光伏接入', criteria: '人工或档案识别' },
    '分布式储能': { desc: '明确识别为分布式储能接入', criteria: '人工或档案识别' },

    // Calendar
    '标准双休型': { desc: '周六、周日负荷显著低于工作日', criteria: '周末/工作日负荷比 < 0.6' },
    '周末单休型': { desc: '仅周日（或周六）负荷降低', criteria: '周日/工作日负荷比 < 0.6' },
    '周末生产型': { desc: '周末与工作日负荷无明显差异', criteria: '周末/工作日负荷比 > 0.8' },
    '春节深调型': { desc: '春节期间负荷大幅下降', criteria: '春节/平时负荷比 < 0.3' },
    '节后慢热型': { desc: '节后复工缓慢', criteria: '节后首周/平时负荷比 < 0.5' }
};

const LoadCharacteristicsOverviewPage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const { addTab } = useTabContext();
    const { hasPermission } = useAuth();
    const canManualAnalyze = hasPermission('module:analysis_load_characteristics:edit');

    const [analysisLoading, setAnalysisLoading] = useState(false);

    // 数据状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overviewData, setOverviewData] = useState<CharacteristicsOverview | null>(null);
    const [distribution, setDistribution] = useState<EnhancedTagDistribution | null>(null);
    const [tagChanges, setTagChanges] = useState<TagChangesResponse | null>(null);
    const [scatterData, setScatterData] = useState<ScatterDataItem[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('shift');

    // Mobile Detail Dialog State
    const [mobileDetailCustomer, setMobileDetailCustomer] = useState<{ id: string; name: string } | null>(null);

    // 客户列表状态
    const [customers, setCustomers] = useState<CustomerCharacteristics[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1); // API may return total count, assuming total pages for now from previous code, but typically TablePagination needs total count
    const [totalCount, setTotalCount] = useState(0);
    const [searchText, setSearchText] = useState('');
    const debouncedSearch = useDebounce(searchText, 500);
    const [filterTag, setFilterTag] = useState<string>('');
    const [sortBy, setSortBy] = useState<string>('avg_daily_load');
    const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');

    // 加载总览数据
    const fetchAllData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [overviewRes, distRes, changesRes, scatterRes] = await Promise.all([
                loadCharacteristicsApi.getOverview(),
                loadCharacteristicsApi.getDistribution(),
                loadCharacteristicsApi.getTagChanges(),
                loadCharacteristicsApi.getScatterData()
            ]);
            setOverviewData(overviewRes.data);
            setDistribution(distRes.data);
            setTagChanges(changesRes.data);
            setScatterData(scatterRes.data.items);

            // 刷新当前页面的客户列表
            await fetchCustomers(page);
        } catch (err: any) {
            console.error(err);
            setError('加载数据失败');
        } finally {
            setLoading(false);
        }
    };

    // 手动特征分析
    const handleManualAnalyze = async () => {
        if (!canManualAnalyze) {
            alert('当前角色无修改权限（需要 module:analysis_load_characteristics:edit）');
            return;
        }
        if (!window.confirm('确定要手动触发全量客户特征分析吗？这可能需要一些时间。')) {
            return;
        }

        setAnalysisLoading(true);
        try {
            await loadCharacteristicsApi.analyzeBatch();
            // 分析完成后刷新所有数据
            await fetchAllData();
        } catch (err: any) {
            console.error(err);
            alert('接口调用失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setAnalysisLoading(false);
        }
    };

    // 加载客户列表
    const fetchCustomers = async (p: number, search?: string, tag?: string, sort?: string, dir?: 'asc' | 'desc') => {
        try {
            const currentSort = sort || sortBy;
            const currentDir = dir || orderDir;
            const res = await loadCharacteristicsApi.listCustomers(p, 10, search, tag, currentSort, currentDir);
            setCustomers(res.data.items);
            setTotalCount(res.data.total);
            setTotalPages(Math.ceil(res.data.total / res.data.page_size));
            setPage(res.data.page);
        } catch (err) {
            console.error('加载客户列表失败', err);
        }
    };

    useEffect(() => {
        fetchAllData();
        // Initial fetch handled by debouncedSearch effect or manual call here?
        // Since debouncedSearch starts as '', verification:
        // If we rely on debouncedSearch effect, it invokes on mount.
        // fetchCustomers(1); // Removed to avoid double fetch
    }, []);

    // 搜索联动 (Debounce)
    useEffect(() => {
        // Reset to page 1 on search change
        fetchCustomers(1, debouncedSearch, filterTag);
    }, [debouncedSearch]);

    const handleChangePage = (_: unknown, newPage: number) => {
        // TablePagination uses 0-based index
        setPage(newPage + 1);
        fetchCustomers(newPage + 1, searchText, filterTag, sortBy, orderDir);
    };

    const handleSort = (field: string) => {
        const isAsc = sortBy === field && orderDir === 'asc';
        const newDir = isAsc ? 'desc' : 'asc';
        setSortBy(field);
        setOrderDir(newDir);
        fetchCustomers(1, debouncedSearch, filterTag, field, newDir);
    };

    const handleSearch = () => {
        // fetchCustomers(1, searchText, filterTag); 
        // 废弃：通过 debouncedSearch 自动触发
    };

    const handleCustomerClick = (customerId: string, customerName: string = '客户详情') => {
        if (isDesktop) {
            addTab({
                key: `load-characteristics-${customerId}`,
                title: `特征详情：${customerName}`,
                path: `/customer/load-characteristics/${customerId}`,
                component: <LoadCharacteristicsDetailPage customerId={customerId} />
            });
        } else {
            // Mobile: Set state to open Dialog
            setMobileDetailCustomer({ id: customerId, name: customerName });
        }
    };

    if (error && !overviewData) {
        return <Alert severity="error">{error}</Alert>;
    }

    // 准备饼图数据
    const rawPieData = distribution?.categories.find(c => c.category === selectedCategory)?.items || [];
    const pieData = rawPieData.map(item => ({
        name: item.name,
        value: item.value,
        percentage: (item.percentage * 100).toFixed(1)
    }));

    return (
        <Box sx={{ width: '100%' }}>
            {/* 标题栏 - 仅移动端显示，面包屑样式 */}
            {/* 标题栏 - 移动端/平板显示面包屑 */}
            {!isDesktop && (
                <Typography
                    variant="subtitle1"
                    sx={{
                        mb: 2,
                        fontWeight: 'bold',
                        color: 'text.primary'
                    }}
                >
                    负荷分析 / 负荷特征分析
                </Typography>
            )}

            {/* 桌面端刷新按钮 */}


            {loading && <LinearProgress sx={{ mb: 2 }} />}

            {/* 第一行：KPI 卡片 */}
            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                {[
                    {
                        title: '特征分析日期',
                        value: overviewData?.kpi.latest_data_date || '-',
                        unit: '',
                        icon: '📅',
                        color: theme.palette.info.main,
                        content: <Typography variant="caption" color="text.secondary">负荷数据截至日期</Typography>
                    },
                    {
                        title: '画像覆盖率',
                        value: overviewData ? `${(overviewData.kpi.coverage_rate * 100).toFixed(0)}%` : '-',
                        unit: `${overviewData?.kpi.coverage_count || 0}/${overviewData?.kpi.total_customers || 0}户`,
                        icon: '📊',
                        color: theme.palette.primary.main,
                        content: (
                            <LinearProgress
                                variant="determinate"
                                value={overviewData ? overviewData.kpi.coverage_rate * 100 : 0}
                                sx={{ mt: 1, height: 6, borderRadius: 3 }}
                            />
                        )
                    },
                    {
                        title: '主力特征',
                        value: overviewData?.kpi.dominant_tag || '-',
                        unit: `占比 ${((overviewData?.kpi.dominant_tag_percentage || 0) * 100).toFixed(0)}%`,
                        icon: TAG_ICONS[overviewData?.kpi.dominant_tag || ''] || '🏷️',
                        color: '#7b1fa2',
                    },
                    {
                        title: '规律评分',
                        value: overviewData?.kpi.avg_regularity_score || 0,
                        unit: '分',
                        icon: '🎯',
                        color: theme.palette.success.main,
                        content: <Typography variant="caption" color="text.secondary">全网加权平均</Typography>
                    },
                    {
                        title: '今日异动',
                        value: overviewData?.kpi.anomaly_count_today ?? 0,
                        unit: '户',
                        icon: '⚠️',
                        color: theme.palette.error.main,
                        content: <Typography variant="caption" color="text.secondary">待处理告警</Typography>
                    },
                    {
                        title: '特征变化',
                        value: tagChanges ? (tagChanges.total_added + tagChanges.total_removed) : 0,
                        unit: '项变动',
                        icon: '📈',
                        color: '#f57c00', // Orange
                        content: (
                            <Box display="flex" alignItems="center" gap={1} sx={{ mt: 0.5 }}>
                                <Chip
                                    icon={<TrendingUpIcon />}
                                    label={`+${tagChanges?.total_added || 0}`}
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                                <Chip
                                    icon={<TrendingDownIcon />}
                                    label={`-${tagChanges?.total_removed || 0}`}
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                            </Box>
                        )
                    }
                ].map((card, index) => (
                    <Grid key={index} size={{ xs: 6, md: 2 }} sx={{ display: 'flex' }}>
                        <Card
                            variant="outlined"
                            sx={{
                                width: '100%',
                                height: '100%',
                                borderRadius: 2,
                                border: '1px solid',
                                borderColor: alpha(card.color, 0.2),
                                background: `linear-gradient(135deg, ${alpha(card.color, 0.03)} 0%, ${alpha(card.color, 0.07)} 100%)`
                            }}
                        >
                            <CardContent
                                sx={{
                                    p: { xs: 1.5, sm: 2 },
                                    pb: { xs: 1.5, sm: 2 } + ' !important',
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '100%',
                                    justifyContent: 'center'
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: { xs: 0.5, sm: 1 } }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
                                        <Box sx={{
                                            color: card.color,
                                            display: 'flex',
                                            p: 0.5,
                                            borderRadius: 1,
                                            bgcolor: `${card.color}15`,
                                            fontSize: { xs: 18, sm: 22 },
                                            lineHeight: 1
                                        }}>
                                            {typeof card.icon === 'string' ? card.icon : card.icon}
                                        </Box>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            fontWeight="medium"
                                            noWrap
                                            sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}
                                        >
                                            {card.title}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Typography
                                    variant="h5"
                                    fontWeight="bold"
                                    sx={{
                                        color: 'text.primary',
                                        fontSize: { xs: '1.25rem', sm: '1.5rem' },
                                        lineHeight: 1.2
                                    }}
                                >
                                    {card.value}
                                    <Typography
                                        component="span"
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ ml: 0.5, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}
                                    >
                                        {card.unit}
                                    </Typography>
                                </Typography>
                                {card.content}
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>

            {/* 第二行：三面板 (统一高度) */}
            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                {/* 异动告警面板 */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper variant="outlined" sx={{ p: 2, height: 320, display: 'flex', flexDirection: 'column' }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                            <Typography variant="subtitle1" fontWeight="bold">
                                <WarningAmberIcon sx={{ verticalAlign: 'middle', mr: 0.5, color: 'warning.main' }} />
                                异动告警
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1, overflow: 'auto', pr: 0.5 }}>
                            {overviewData?.anomalies && overviewData.anomalies.length > 0 ? (
                                overviewData.anomalies.map((anom) => (
                                    <Box
                                        key={anom.id}
                                        sx={{
                                            mb: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1,
                                            borderLeft: `3px solid ${SEVERITY_COLORS[anom.severity as keyof typeof SEVERITY_COLORS] || '#ccc'}`,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            '&:hover': { bgcolor: 'grey.100', transform: 'translateX(2px)' }
                                        }}
                                        onClick={() => handleCustomerClick(anom.customer_id, anom.customer_name)}
                                    >
                                        <Box display="flex" justifyContent="space-between" alignItems="center">
                                            <Typography variant="body2" fontWeight="medium">{anom.customer_name}</Typography>
                                            <Chip
                                                label={anom.type}
                                                size="small"
                                                color={anom.severity === 'critical' ? 'error' : 'warning'}
                                                sx={{ height: 20, fontSize: '0.625rem' }}
                                            />
                                        </Box>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {anom.description}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" display="block" textAlign="right" sx={{ mt: 0.5 }}>
                                            {anom.time.substring(5, 16)}
                                        </Typography>
                                    </Box>
                                ))
                            ) : (
                                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" color="text.secondary">
                                    <Typography variant="body2">暂无待处理告警</Typography>
                                </Box>
                            )}
                        </Box>
                    </Paper>
                </Grid>

                {/* 特征分布面板 */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper variant="outlined" sx={{ p: 2, height: 320, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                            <Typography variant="subtitle1" fontWeight="bold" noWrap>
                                特征分布 ({distribution?.categories.length} categories)
                            </Typography>
                        </Box>

                        <Box flex={1} minHeight={0} sx={{ overflow: 'auto', pr: 0.5 }}>
                            <Grid container spacing={1}>
                                {distribution?.categories.map((cat, idx) => (
                                    <Grid key={cat.category} size={{ xs: 12, lg: 6 }}>
                                        <Card variant="outlined" sx={{ height: '100%', bgcolor: 'grey.50' }}>
                                            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                                                        {cat.category_name}
                                                    </Typography>
                                                    <Chip
                                                        label={(CATEGORY_TERM_TYPE[cat.category] || 'short') === 'long' ? '长周期' : '短周期'}
                                                        size="small"
                                                        sx={{
                                                            height: 20,
                                                            fontSize: '0.65rem',
                                                            bgcolor: (CATEGORY_TERM_TYPE[cat.category] || 'short') === 'long' ? 'primary.main' : 'success.main',
                                                            color: 'white',
                                                            fontWeight: 'bold',
                                                            px: 0.5,
                                                            '& .MuiChip-label': { px: 0.5 }
                                                        }}
                                                    />
                                                </Box>
                                                <Box display="flex" flexDirection="column" gap={0.5}>
                                                    {cat.items.slice(0, 5).map((item, itemIdx) => (
                                                        <Box key={item.name} display="flex" alignItems="center" gap={1}>
                                                            <Tooltip
                                                                arrow
                                                                slotProps={{
                                                                    tooltip: {
                                                                        sx: {
                                                                            bgcolor: 'background.paper',
                                                                            color: 'text.primary',
                                                                            boxShadow: 2,
                                                                            border: '1px solid #eee'
                                                                        }
                                                                    },
                                                                    arrow: {
                                                                        sx: {
                                                                            color: 'background.paper'
                                                                        }
                                                                    }
                                                                }}
                                                                title={
                                                                    TAG_DESCRIPTIONS[item.name] ? (
                                                                        <Box sx={{ p: 1 }}>
                                                                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>{item.name}</Typography>
                                                                            <Typography variant="body2" paragraph sx={{ mb: 1 }}>{TAG_DESCRIPTIONS[item.name].desc}</Typography>
                                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', bgcolor: 'grey.100', p: 0.5, borderRadius: 1 }}>
                                                                                📈 判定: {TAG_DESCRIPTIONS[item.name].criteria}
                                                                            </Typography>
                                                                        </Box>
                                                                    ) : item.name
                                                                }
                                                            >
                                                                <Typography variant="caption" sx={{ width: 60, flexShrink: 0, cursor: 'help', borderBottom: '1px dashed grey' }} noWrap>
                                                                    {item.name}
                                                                </Typography>
                                                            </Tooltip>
                                                            <Box flex={1}>
                                                                <LinearProgress
                                                                    variant="determinate"
                                                                    value={item.percentage * 100}
                                                                    sx={{
                                                                        height: 6,
                                                                        borderRadius: 3,
                                                                        bgcolor: 'grey.200',
                                                                        '& .MuiLinearProgress-bar': {
                                                                            bgcolor: COLORS[idx % COLORS.length]
                                                                        }
                                                                    }}
                                                                />
                                                            </Box>
                                                            <Typography variant="caption" color="text.secondary" sx={{ width: 30, textAlign: 'right' }}>
                                                                {item.value}
                                                            </Typography>
                                                        </Box>
                                                    ))}
                                                </Box>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                ))}
                            </Grid>
                        </Box>
                    </Paper>
                </Grid>

                {/* 规模-稳定性散点图 */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper variant="outlined" sx={{ p: 2, height: 320, display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="subtitle1" fontWeight="bold" mb={1}>规模-稳定性分布</Typography>
                        {scatterData.length > 0 ? (
                            <Box flex={1} minHeight={0}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} />
                                        <XAxis
                                            type="number"
                                            dataKey="avg_daily_load"
                                            name="日均负荷"
                                            unit="MWh"
                                            tickFormatter={(val) => val.toFixed(0)}
                                            allowDataOverflow={true}
                                            domain={[0, 'auto']}
                                            label={{ value: '日均负荷 (MWh)', position: 'insideBottom', offset: -5, fontSize: 10 }}
                                            tick={{ fontSize: 10 }}
                                        />
                                        <YAxis
                                            type="number"
                                            dataKey="cv"
                                            name="波动率"
                                            label={{ value: '波动率(CV)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                                            tick={{ fontSize: 10 }}
                                            tickFormatter={(val) => val.toFixed(1)}
                                        />
                                        <ZAxis type="number" dataKey="regularity_score" range={[30, 300]} name="规律性评分" />
                                        <RechartsTooltip
                                            cursor={{ strokeDasharray: '3 3' }}
                                            content={({ active, payload }: any) => {
                                                if (active && payload && payload.length) {
                                                    const data = payload[0].payload;
                                                    return (
                                                        <Paper sx={{ p: 1, border: '1px solid #eee', boxShadow: 2 }}>
                                                            <Typography variant="caption" fontWeight="bold" display="block">{data.customer_name}</Typography>
                                                            <Typography variant="caption" display="block">日均: {data.avg_daily_load.toFixed(0)} kWh</Typography>
                                                            <Typography variant="caption" display="block">波动: {(data.cv * 100).toFixed(0)}%</Typography>
                                                            <Typography variant="caption" display="block">评分: {data.regularity_score}</Typography>
                                                        </Paper>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Scatter
                                            name="客户"
                                            data={scatterData}
                                            fill={theme.palette.primary.main}
                                            fillOpacity={0.6}
                                            onClick={(data: any) => handleCustomerClick(data.customer_id, data.customer_name)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            {scatterData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </Box>
                        ) : (
                            <Box display="flex" justifyContent="center" alignItems="center" height="80%">
                                <CircularProgress size={24} />
                            </Box>
                        )}
                    </Paper>
                </Grid>
            </Grid>

            {/* 第三行：客户列表 */}
            <Paper variant="outlined" sx={{ width: '100%', mb: 2, p: { xs: 1, sm: 2 } }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={2}>
                    {/* 左侧：标题 + 搜索 + 筛选 */}
                    <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" sx={{ flexGrow: 1 }}>
                        <Typography variant="h6" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center' }}>
                            <PeopleIcon sx={{ mr: 1, color: 'primary.main' }} />
                            客户列表
                        </Typography>

                        <TextField
                            size="small"
                            placeholder="搜索客户名称"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" color="action" />
                                    </InputAdornment>
                                )
                            }}
                            sx={{ width: { xs: '100%', sm: 180 } }}
                        />

                        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 } }}>
                            <InputLabel>特征筛选</InputLabel>
                            <Select
                                value={filterTag}
                                label="特征筛选"
                                onChange={(e) => {
                                    setFilterTag(e.target.value);
                                    fetchCustomers(1, searchText, e.target.value, sortBy, orderDir);
                                }}
                            >
                                <MenuItem value="">全部</MenuItem>
                                {distribution?.categories.map(cat => [
                                    <ListSubheader key={`header-${cat.category}`} sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                        {cat.category_name} {(CATEGORY_TERM_TYPE[cat.category] === 'long' ? '(长)' : '(短)')}
                                    </ListSubheader>,
                                    ...cat.items.map(item => (
                                        <MenuItem key={item.name} value={item.name} sx={{ pl: 4 }}>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <span>{TAG_ICONS[item.name] || '🏷️'}</span>
                                                <span>{item.name}</span>
                                                <Typography variant="caption" color="text.secondary">({item.value})</Typography>
                                            </Box>
                                        </MenuItem>
                                    ))
                                ])}
                            </Select>
                        </FormControl>
                    </Box>

                    {/* 右侧：操作按钮 */}
                    <Box display="flex" gap={1} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' }, justifyContent: 'flex-end' }}>
                        <Tooltip title={canManualAnalyze ? '' : '当前角色无修改权限（需要 module:analysis_load_characteristics:edit）'}>
                            <span>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={analysisLoading ? <CircularProgress size={16} /> : <TrendingUpIcon />}
                                    onClick={handleManualAnalyze}
                                    disabled={loading || analysisLoading || !canManualAnalyze}
                                    sx={{
                                        height: 40,
                                        whiteSpace: 'nowrap',
                                        borderColor: 'divider',
                                        color: 'text.primary',
                                        '&:hover': {
                                            borderColor: 'primary.main',
                                            bgcolor: 'action.hover'
                                        }
                                    }}
                                >
                                    {analysisLoading ? '执行中...' : '手动执行'}
                                </Button>
                            </span>
                        </Tooltip>

                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                            onClick={fetchAllData}
                            disabled={loading || analysisLoading}
                            sx={{
                                height: 40,
                                whiteSpace: 'nowrap',
                                borderColor: 'divider',
                                color: 'text.primary',
                                '&:hover': {
                                    borderColor: 'primary.main',
                                    bgcolor: 'action.hover'
                                }
                            }}
                        >
                            数据刷新
                        </Button>
                    </Box>
                </Box>

                {isMobile ? (
                    <Box sx={{ mt: 1 }}>
                        <Grid container spacing={1.5}>
                            {customers.map((row) => (
                                <Grid key={row.customer_id} size={{ xs: 12 }}>
                                    <Card
                                        variant="outlined"
                                        sx={{
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: 'action.hover' }
                                        }}
                                        onClick={() => handleCustomerClick(row.customer_id, row.short_name || row.customer_name)}
                                    >
                                        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                            <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                                <Typography variant="subtitle1" fontWeight="bold" color="primary.main">
                                                    {row.short_name || row.customer_name}
                                                </Typography>
                                                <Chip
                                                    label={`${row.regularity_score || 0}分`}
                                                    size="small"
                                                    color={(row.regularity_score || 0) >= 80 ? 'success' : (row.regularity_score || 0) >= 60 ? 'warning' : 'error'}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </Box>

                                            <Tooltip
                                                arrow
                                                title={row.tags?.map(t => t.name).join('、') || '暂无特征'}
                                            >
                                                <Box display="flex" flexWrap="wrap" gap={0.5} mb={1.5}>
                                                    {row.tags?.length > 0 ? (
                                                        row.tags.slice(0, 4).map((tag, idx) => (
                                                            <Chip
                                                                key={idx}
                                                                label={tag.name}
                                                                size="small"
                                                                variant="outlined"
                                                                sx={{
                                                                    fontSize: '0.7rem',
                                                                    height: 20,
                                                                    bgcolor: 'rgba(0, 0, 0, 0.04)',
                                                                    border: 'none'
                                                                }}
                                                            />
                                                        ))
                                                    ) : (
                                                        <Typography variant="caption" color="text.disabled">暂无特征</Typography>
                                                    )}
                                                    {row.tags?.length > 4 && (
                                                        <Chip
                                                            label={`+${row.tags.length - 4}`}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ fontSize: '0.7rem', height: 20, bgcolor: 'rgba(0, 0, 0, 0.04)', border: 'none' }}
                                                        />
                                                    )}
                                                </Box>
                                            </Tooltip>

                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Typography variant="caption" color="text.secondary">
                                                    日均负荷: <Box component="span" color="text.primary" fontWeight="bold">{(row.long_term?.avg_daily_load || 0).toFixed(1)}</Box> MWh
                                                </Typography>
                                                <ArrowForwardIcon fontSize="small" color="action" />
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                            {customers.length === 0 && !loading && (
                                <Box sx={{ p: 4, textAlign: 'center', width: '100%' }}>
                                    <Typography color="text.secondary">无匹配客户数据</Typography>
                                </Box>
                            )}
                        </Grid>
                    </Box>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table
                            stickyHeader
                            size="medium"
                            sx={{
                                '& .MuiTableCell-root': {
                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                    px: { xs: 0.5, sm: 1.5 }
                                }
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell
                                        sx={{ fontWeight: 'bold', cursor: 'pointer' }}
                                        onClick={() => handleSort('customer_name')}
                                    >
                                        客户名称 {sortBy === 'customer_name' ? (orderDir === 'asc' ? '↑' : '↓') : ''}
                                    </TableCell>
                                    {!isMobile && <TableCell sx={{ fontWeight: 'bold', width: 140 }}>典型曲线(30天)</TableCell>}
                                    <TableCell sx={{ fontWeight: 'bold' }}>特征标签</TableCell>
                                    {!isMobile && (
                                        <TableCell
                                            align="center"
                                            sx={{ fontWeight: 'bold', width: 100, cursor: 'pointer' }}
                                            onClick={() => handleSort('score')}
                                        >
                                            规律性评分 {sortBy === 'score' ? (orderDir === 'asc' ? '↑' : '↓') : ''}
                                        </TableCell>
                                    )}
                                    <TableCell
                                        align="right"
                                        sx={{ fontWeight: 'bold', cursor: 'pointer' }}
                                        onClick={() => handleSort('avg_daily_load')}
                                    >
                                        日均负荷 (MWh) {sortBy === 'avg_daily_load' ? (orderDir === 'asc' ? '↑' : '↓') : ''}
                                    </TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold', width: 80 }}>操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {customers.map((row) => (
                                    <TableRow
                                        key={row.customer_id}
                                        hover
                                        sx={{ cursor: 'pointer' }}
                                        onClick={() => handleCustomerClick(row.customer_id, row.short_name || row.customer_name)}
                                    >
                                        <TableCell>
                                            <Typography variant="body2" fontWeight="medium" color="primary.main">{row.customer_name}</Typography>
                                            {row.short_name && row.short_name !== row.customer_name && (
                                                <Typography variant="caption" color="text.secondary" display="block">{row.short_name}</Typography>
                                            )}
                                        </TableCell>

                                        {!isMobile && (
                                            <TableCell>
                                                {row.short_term?.avg_curve && row.short_term.avg_curve.length > 0 ? (
                                                    <Box sx={{ width: 120, height: 40 }}>
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <LineChart data={row.short_term.avg_curve.map((val, i) => ({ i, val }))}>
                                                                <Line
                                                                    type="monotone"
                                                                    dataKey="val"
                                                                    stroke={theme.palette.primary.main}
                                                                    strokeWidth={1.5}
                                                                    dot={false}
                                                                />
                                                            </LineChart>
                                                        </ResponsiveContainer>
                                                    </Box>
                                                ) : (
                                                    <Typography variant="caption" color="text.secondary">-</Typography>
                                                )}
                                            </TableCell>
                                        )}

                                        <TableCell>
                                            <Tooltip
                                                arrow
                                                title={row.tags?.map(t => t.name).join('、') || '暂无特征'}
                                            >
                                                <Box display="flex" gap={0.5} flexWrap="wrap">
                                                    {row.tags?.slice(0, 4).map((t, idx) => (
                                                        <Chip
                                                            key={idx}
                                                            label={`${TAG_ICONS[t.name] || ''} ${t.name}`}
                                                            size="small"
                                                            variant="outlined"
                                                            color="default"
                                                            sx={{
                                                                height: 22,
                                                                fontSize: '0.75rem',
                                                                bgcolor: t.source === 'MANUAL' ? '#e3f2fd' : 'background.paper',
                                                                color: t.source === 'MANUAL' ? '#1565c0' : 'text.primary',
                                                                borderColor: t.source === 'MANUAL' ? '#90caf9' : 'divider',
                                                                fontWeight: t.source === 'MANUAL' ? 'medium' : 'normal'
                                                            }}
                                                        />
                                                    ))}
                                                    {row.tags?.length > 4 && (
                                                        <Chip
                                                            label={`+${row.tags.length - 4}`}
                                                            size="small"
                                                            sx={{ height: 22, fontSize: '0.75rem' }}
                                                        />
                                                    )}
                                                </Box>
                                            </Tooltip>
                                        </TableCell>

                                        {!isMobile && (
                                            <TableCell align="center">
                                                {row.regularity_score !== undefined ? (
                                                    <Box position="relative" display="inline-flex">
                                                        <CircularProgress
                                                            variant="determinate"
                                                            value={row.regularity_score}
                                                            size={32}
                                                            thickness={4}
                                                            sx={{
                                                                color: row.regularity_score >= 80 ? 'success.main' :
                                                                    row.regularity_score >= 60 ? 'warning.main' : 'error.main',
                                                                bgcolor: 'action.hover',
                                                                borderRadius: '50%'
                                                            }}
                                                        />
                                                        <Box
                                                            sx={{
                                                                top: 0,
                                                                left: 0,
                                                                bottom: 0,
                                                                right: 0,
                                                                position: 'absolute',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                        >
                                                            <Typography variant="caption" component="div" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}>
                                                                {row.regularity_score}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ) : '-'}
                                            </TableCell>
                                        )}

                                        <TableCell align="right">
                                            {row.long_term?.avg_daily_load ? (
                                                <>
                                                    <Typography variant="body2" fontWeight="medium">
                                                        {row.long_term.avg_daily_load.toFixed(1)}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">MWh</Typography>
                                                </>
                                            ) : '-'}
                                        </TableCell>

                                        <TableCell align="center">
                                            <Tooltip title="查看详情">
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCustomerClick(row.customer_id, row.short_name || row.customer_name);
                                                    }}
                                                >
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {customers.length === 0 && !loading && (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">无匹配客户数据</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
                <TablePagination
                    component="div"
                    count={totalCount}
                    page={page - 1} // MUI uses 0-index
                    onPageChange={handleChangePage}
                    rowsPerPage={10}
                    rowsPerPageOptions={[10]} // API currently fixed to 10? If not, can add options
                    labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count} 条`}
                />
            </Paper>

            {/* Mobile Detail Dialog */}
            <Dialog
                fullScreen
                open={!!mobileDetailCustomer}
                onClose={() => setMobileDetailCustomer(null)}
                TransitionComponent={Transition}
            >
                <AppBar position="fixed" sx={{ boxShadow: 1 }}>
                    <Toolbar variant="dense">
                        <IconButton
                            edge="start"
                            color="inherit"
                            onClick={() => setMobileDetailCustomer(null)}
                            aria-label="close"
                        >
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div" fontSize="1rem">
                            {mobileDetailCustomer?.name || '客户详情'}
                        </Typography>
                    </Toolbar>
                </AppBar>
                <Box sx={{ bgcolor: 'grey.50', minHeight: '100vh', pb: 4 }}>
                    <Toolbar variant="dense" />
                    {mobileDetailCustomer && (
                        <LoadCharacteristicsDetailPage customerId={mobileDetailCustomer.id} />
                    )}
                </Box>
            </Dialog>
        </Box>
    );
};

export default LoadCharacteristicsOverviewPage;
