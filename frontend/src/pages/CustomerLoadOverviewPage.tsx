/**
 * 客户负荷总览页面
 * 
 * 功能：
 * 1. 全局时间控制栏（月份选择 + 月度/年累计切换）
 * 2. KPI卡片区（签约客户数、签约规模、当前总电量、综合峰谷比）
 * 3. 资产透视区（电量贡献构成、涨跌龙虎榜、峰谷比极值榜）
 * 4. 客户资产明细表
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    Card,
    CardContent,
    ToggleButton,
    ToggleButtonGroup,
    IconButton,
    TextField,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    TableSortLabel,
    CircularProgress,
    Alert,
    Tooltip,
    Chip,
    useTheme,
    useMediaQuery,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    Stack,
    Divider,
    alpha
} from '@mui/material';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    Search as SearchIcon,
    Visibility as VisibilityIcon,
    TrendingUp as TrendingUpIcon,
    TrendingDown as TrendingDownIcon,
    Warning as WarningIcon,
    People as PeopleIcon,
    ElectricBolt as ElectricBoltIcon,
    Speed as SpeedIcon,
    Assessment as AssessmentIcon,
    Refresh as RefreshIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

import { useTabContext } from '../contexts/TabContext';
import { CustomerLoadAnalysisPage } from './CustomerLoadAnalysisPage';
import customerLoadOverviewApi, {
    DashboardData,
    OverviewKpi,
    ContributionData,
    GrowthRankingData,
    EfficiencyRankingData,
    CustomerListResponse,
    CustomerListItem,
    ViewMode,
    TouUsage
} from '../api/customerLoadOverview';

// ---- 常量 ----
const YEAR = 2026;  // 固定年份
const TOU_COLORS = {
    tip: '#9c27b0',    // 尖峰 - 紫色
    peak: '#ff9800',   // 高峰 - 橙色
    flat: '#4caf50',   // 平段 - 绿色
    valley: '#2196f3', // 低谷 - 蓝色
    deep: '#00bcd4'    // 深谷 - 青色
};
const PIE_COLORS = ['#5E35B1', '#1976D2', '#0288D1', '#0097A7', '#388E3C', '#FBC02D'];

// ---- 工具函数 ----
const formatNumber = (num: number, decimals = 2): string => {
    if (num >= 10000) {
        return (num / 10000).toFixed(decimals) + ' 万';
    }
    return num.toFixed(decimals);
};

const formatYoy = (yoy: number | null): { text: string; color: string; icon: React.ReactNode } => {
    if (yoy === null) return { text: '新户', color: 'text.secondary', icon: null };
    const color = yoy >= 0 ? 'error.main' : 'success.main';
    const icon = yoy >= 0 ? <TrendingUpIcon sx={{ fontSize: 14 }} /> : <TrendingDownIcon sx={{ fontSize: 14 }} />;
    return { text: `${yoy >= 0 ? '+' : ''}${yoy}%`, color, icon };
};

// ---- 时段结构堆叠条组件 ----
const TouStackBar: React.FC<{ tou: TouUsage }> = ({ tou }) => {
    const total = tou.tip + tou.peak + tou.flat + tou.valley + tou.deep;
    if (total === 0) return <Typography color="text.secondary">--</Typography>;

    const segments = [
        { key: 'tip', value: tou.tip, color: TOU_COLORS.tip, label: '尖峰' },
        { key: 'peak', value: tou.peak, color: TOU_COLORS.peak, label: '高峰' },
        { key: 'flat', value: tou.flat, color: TOU_COLORS.flat, label: '平段' },
        { key: 'valley', value: tou.valley, color: TOU_COLORS.valley, label: '低谷' },
        { key: 'deep', value: tou.deep, color: TOU_COLORS.deep, label: '深谷' }
    ];

    const tooltipContent = segments
        .filter(s => s.value > 0)
        .map(s => `${s.label}: ${formatNumber(s.value)} MWh (${((s.value / total) * 100).toFixed(1)}%)`)
        .join('\n');

    return (
        <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tooltipContent}</pre>}>
            <Box sx={{ display: 'flex', height: 16, width: 100, borderRadius: 1, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                {segments.map(seg => (
                    <Box
                        key={seg.key}
                        sx={{
                            width: `${(seg.value / total) * 100}%`,
                            backgroundColor: seg.color,
                            minWidth: seg.value > 0 ? 2 : 0
                        }}
                    />
                ))}
            </Box>
        </Tooltip>
    );
};

// ---- 主组件 ----
export const CustomerLoadOverviewPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { addTab } = useTabContext();

    // 状态
    // 状态
    // 缓存 Key - 升级版本以清理旧缓存
    const CACHE_KEY = 'customer_overview_cache_v3';

    // 状态初始化辅助函数
    const getInitialParam = <T,>(key: string, defaultValue: T): T => {
        try {
            const cache = sessionStorage.getItem(CACHE_KEY);
            if (cache) {
                const parsed = JSON.parse(cache);
                if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
                    return parsed.params[key] ?? defaultValue;
                }
            }
        } catch (e) {
            console.error('读取缓存参数失败', e);
        }
        return defaultValue;
    };

    const getInitialData = <T,>(key: string): T | null => {
        try {
            const cache = sessionStorage.getItem(CACHE_KEY);
            if (cache) {
                const parsed = JSON.parse(cache);
                if (parsed.data && Date.now() - parsed.timestamp < 30 * 60 * 1000) {
                    return parsed.data[key] ?? null;
                }
            }
        } catch (e) {
            console.error('读取缓存数据失败', e);
        }
        return null;
    };

    const [month, setMonth] = useState<number>(() => getInitialParam('month', new Date().getMonth() + 1));
    const [viewMode, setViewMode] = useState<ViewMode>(() => getInitialParam('viewMode', 'monthly'));
    const [search, setSearch] = useState(() => getInitialParam('search', ''));
    const [page, setPage] = useState(() => getInitialParam('page', 0));
    const [pageSize, setPageSize] = useState(() => getInitialParam('pageSize', 10));
    const [sortField, setSortField] = useState(() => getInitialParam('sortField', 'signed_quantity'));
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => getInitialParam('sortOrder', 'desc'));

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 数据 - 尝试从缓存读取
    const [kpi, setKpi] = useState<OverviewKpi | null>(() => getInitialData('kpi'));
    const [contribution, setContribution] = useState<ContributionData | null>(() => getInitialData('contribution'));
    const [growthRanking, setGrowthRanking] = useState<GrowthRankingData | null>(() => getInitialData('growthRanking'));
    const [efficiencyRanking, setEfficiencyRanking] = useState<EfficiencyRankingData | null>(() => getInitialData('efficiencyRanking'));

    // 客户列表缓存结构特殊 ({ items: [], ... })
    const cachedList = getInitialData<any>('customerList');
    const [allCustomers, setAllCustomers] = useState<CustomerListItem[]>(() => cachedList?.items || []);

    // 用于跳过不必要的 Fetch
    const lastFetchKey = useRef<string>('');

    // 初始化 ref - 仅恢复上次的 fetchKey 标记，避免参数未变时重复请求（但若数据为空仍会请求）
    useEffect(() => {
        const cache = sessionStorage.getItem(CACHE_KEY);
        if (cache) {
            try {
                const parsed = JSON.parse(cache);
                if (parsed.params && Date.now() - parsed.timestamp < 30 * 60 * 1000) {
                    // 仅恢复 lastFetchKey，但不恢复数据
                    // 注意：由于数据状态初始化为 null，fetchData 中的检查 (kpi && ...) 会失败，从而强制刷新数据
                    // 这符合"不再缓存旧数据"的需求
                    lastFetchKey.current = `${parsed.params.month}-${parsed.params.viewMode}`;
                }
            } catch (e) { /* ignore */ }
        }
    }, []);

    // 加载数据（只依赖 month, viewMode）
    const fetchData = async () => {
        const fetchKey = `${month}-${viewMode}`;

        // 如果参数没变，且数据都有，则跳过
        // 注意：由于移除了数据缓存，kpi 等初始为 null，这里的条件通常为 false，会触发请求
        // 只有在组件内部状态更新（如搜索/排序）导致重渲染时，数据已存在，才会命中此缓存
        if (fetchKey === lastFetchKey.current && kpi && contribution && allCustomers.length > 0) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            // 使用统一看板接口获取所有数据
            const dashboardData = await customerLoadOverviewApi.getDashboardData(YEAR, month, viewMode, {
                page_size: -1 // 获取全量列表供前端分页
            });

            setKpi(dashboardData.kpi);
            setContribution(dashboardData.contribution);
            setGrowthRanking(dashboardData.rankings.growth);
            setEfficiencyRanking(dashboardData.rankings.efficiency);
            setAllCustomers(dashboardData.customer_list.items);

            lastFetchKey.current = fetchKey;

        } catch (err: any) {
            console.error('加载数据失败:', err);
            let errorMessage = '加载数据失败';
            if (err.response?.data?.detail) {
                if (typeof err.response.data.detail === 'string') {
                    errorMessage = err.response.data.detail;
                } else if (Array.isArray(err.response.data.detail)) {
                    // Pydantic 错误数组
                    errorMessage = err.response.data.detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
                } else {
                    errorMessage = JSON.stringify(err.response.data.detail);
                }
            } else if (err.message) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // 监听关键参数变化重新加载
    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [month, viewMode]);

    // 统一缓存更新（Debounced）
    useEffect(() => {
        const timer = setTimeout(() => {
            const cacheData = {
                params: { month, viewMode, search, page, pageSize, sortField, sortOrder },
                data: {
                    kpi,
                    contribution,
                    growthRanking,
                    efficiencyRanking,
                    customerList: { items: allCustomers, total: allCustomers.length, page: 1, page_size: -1 }
                },
                timestamp: Date.now()
            };
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        }, 500);

        return () => clearTimeout(timer);
    }, [month, viewMode, search, page, pageSize, sortField, sortOrder, kpi, contribution, growthRanking, efficiencyRanking, allCustomers]);


    // 月份切换
    const handleMonthChange = (delta: number) => {
        const newMonth = month + delta;
        if (newMonth >= 1 && newMonth <= 12) {
            setMonth(newMonth);
            setPage(0);
        }
    };

    // 查看客户详情
    const handleViewCustomer = (customerId: string, customerName: string) => {
        addTab({
            key: `customer-analysis-${customerId}`,
            title: `客户分析：${customerName}`,
            path: `/customer-analysis/${customerId}`,
            component: <CustomerLoadAnalysisPage customerId={customerId} />
        });
    };

    // 排序处理
    const handleSort = (field: string) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
        setPage(0);
    };

    // 手动刷新
    const handleRefresh = () => {
        lastFetchKey.current = ''; // 重置 key 强制刷新
        fetchData();
    };

    // ---- 前端处理数据 ----

    // 1. 过滤 & 排序
    const processedCustomers = useMemo(() => {
        let result = [...allCustomers];

        // 搜索
        if (search) {
            const key = search.toLowerCase();
            result = result.filter(c =>
                (c.customer_name || '').toLowerCase().includes(key) ||
                (c.short_name || '').toLowerCase().includes(key)
            );
        }

        // 排序
        result.sort((a, b) => {
            let valA: any = a[sortField as keyof CustomerListItem];
            let valB: any = b[sortField as keyof CustomerListItem];

            // 特殊字段处理
            if (sortField === 'signed_yoy') {
                valA = a.signed_yoy ?? -999;
                valB = b.signed_yoy ?? -999;
            } else if (sortField === 'actual_yoy') {
                valA = a.actual_yoy ?? -999;
                valB = b.actual_yoy ?? -999;
            } else if (sortField === 'customer_name') {
                valA = a.customer_name || '';
                valB = b.customer_name || '';
                return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            // 数字处理
            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });

        return result;
    }, [allCustomers, search, sortField, sortOrder]);

    // 2. 分页
    const paginatedCustomers = useMemo(() => {
        const start = page * pageSize;
        return processedCustomers.slice(start, start + pageSize);
    }, [processedCustomers, page, pageSize]);

    // 兼容之前的 customerList 结构
    const customerList = {
        items: paginatedCustomers,
        total: processedCustomers.length,
        page: page + 1,
        page_size: pageSize
    };

    // 环形图数据
    const pieData = useMemo(() => {
        if (!contribution) return [];
        const data = contribution.top5.map((item, index) => ({
            name: item.short_name,
            value: item.usage,
            percentage: item.percentage,
            fill: PIE_COLORS[index]
        }));
        if (contribution.others.usage > 0) {
            data.push({
                name: '其他',
                value: contribution.others.usage,
                percentage: contribution.others.percentage,
                fill: PIE_COLORS[5]
            });
        }
        return data;
    }, [contribution]);

    // 生成时间范围文本
    const dateRangeText = useMemo(() => {
        if (viewMode === 'ytd') {
            return `${YEAR}年1月-${month}月累计`;
        }
        return `${YEAR}年${month}月`;
    }, [month, viewMode]);

    // ---- 渲染 KPI 卡片 ----
    const renderKpiCards = () => {
        if (!kpi) return null;

        const cards = [
            {
                title: '签约客户',
                value: `${kpi.valid_customers_count} / ${kpi.signed_customers_count}`,
                unit: '户',
                icon: <PeopleIcon sx={{ fontSize: 'inherit' }} />,
                color: '#1976d2',
            },
            {
                title: '签约规模',
                value: formatNumber(kpi.signed_total_quantity),
                unit: 'MWh',
                icon: <AssessmentIcon sx={{ fontSize: 'inherit' }} />,
                color: '#7b1fa2',
                yoy: kpi.signed_quantity_yoy,
            },
            {
                title: '当前总电量',
                value: formatNumber(kpi.actual_total_usage),
                unit: 'MWh',
                icon: <ElectricBoltIcon sx={{ fontSize: 'inherit' }} />,
                color: '#388e3c',
                yoy: kpi.actual_usage_yoy,
            },
            {
                title: '综合峰谷比',
                value: kpi.avg_peak_valley_ratio.toFixed(2),
                unit: '',
                icon: <SpeedIcon sx={{ fontSize: 'inherit' }} />,
                color: '#f57c00',
            }
        ];

        return (
            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                {cards.map((card, index) => (
                    <Grid key={index} size={{ xs: 6, sm: 3 }}>
                        <Card
                            variant="outlined"
                            sx={{
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
                                    position: 'relative'
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
                                            fontSize: { xs: 18, sm: 22 }
                                        }}>
                                            {card.icon}
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
                                    {(card as any).yoy !== undefined && (
                                        <Box sx={{
                                            display: { xs: 'none', sm: 'flex' },
                                            alignItems: 'center',
                                            bgcolor: 'action.hover',
                                            px: 0.5,
                                            py: 0.2,
                                            borderRadius: 0.5
                                        }}>
                                            {formatYoy((card as any).yoy).icon}
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    color: formatYoy((card as any).yoy).color,
                                                    ml: 0.3,
                                                    fontWeight: 'bold',
                                                    fontSize: { xs: '0.65rem', sm: '0.75rem' }
                                                }}
                                            >
                                                {formatYoy((card as any).yoy).text}
                                            </Typography>
                                        </Box>
                                    )}
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

                                    {/* 移动端：同比数据 (与单位同处一行) */}
                                    {(card as any).yoy !== undefined && (
                                        <Box component="span" sx={{
                                            display: { xs: 'inline-flex', sm: 'none' },
                                            alignItems: 'center',
                                            bgcolor: 'action.hover',
                                            px: 0.5,
                                            py: 0.1,
                                            borderRadius: 0.5,
                                            ml: 1,
                                            verticalAlign: 'text-bottom'
                                        }}>
                                            {formatYoy((card as any).yoy).icon}
                                            <Typography
                                                component="span"
                                                variant="caption"
                                                sx={{
                                                    color: formatYoy((card as any).yoy).color,
                                                    ml: 0.2, // 紧凑一点
                                                    fontWeight: 'bold',
                                                    fontSize: '0.65rem',
                                                    lineHeight: 1
                                                }}
                                            >
                                                {formatYoy((card as any).yoy).text}
                                            </Typography>
                                        </Box>
                                    )}
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
        );
    };

    // ---- 渲染资产透视区 ----
    const renderAssetIntelligence = () => (
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
            {/* 电量贡献构成 */}
            <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2, height: 320, overflow: 'hidden' }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
                        {dateRangeText} 电量贡献构成
                    </Typography>
                    {pieData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius={isMobile ? 30 : 40}
                                    outerRadius={isMobile ? 55 : 70}
                                    paddingAngle={2}
                                    dataKey="value"
                                    label={isMobile ? false : ({ name, percentage }) => `${name} ${percentage}%`}
                                    labelLine={!isMobile}
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Pie>
                                <RechartsTooltip
                                    formatter={(value: number, name: string) => [`${formatNumber(value)} MWh`, name]}
                                />
                                {/* 移动端显示图例 */}
                                {isMobile && (
                                    <Legend
                                        layout="horizontal"
                                        verticalAlign="bottom"
                                        align="center"
                                        wrapperStyle={{ fontSize: '0.7rem', paddingTop: 8 }}
                                        formatter={(value, entry: any) => (
                                            <span style={{ color: entry.color }}>
                                                {value} {entry.payload?.percentage}%
                                            </span>
                                        )}
                                    />
                                )}
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" height={260}>
                            <Typography color="text.secondary">暂无数据</Typography>
                        </Box>
                    )}
                </Paper>
            </Grid>

            {/* 涨跌龙虎榜 */}
            <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2, height: 320, overflow: 'hidden' }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
                        {dateRangeText} 电量同比增减
                    </Typography>
                    <Grid container spacing={1} sx={{ height: 'calc(100% - 32px)', overflow: 'auto' }}>
                        {/* 增量榜 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="error.main" fontWeight="bold">📈 增量榜</Typography>
                            {growthRanking?.growth_top5.map((item, index) => (
                                <Box key={item.customer_id} sx={{ py: 0.5, borderBottom: '1px solid #f0f0f0' }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' }, fontSize: '0.8rem' }}
                                        onClick={() => handleViewCustomer(item.customer_id, item.short_name)}
                                    >
                                        {index + 1}. {item.short_name}
                                    </Typography>
                                    <Typography variant="caption" color="error.main" sx={{ fontSize: '0.7rem' }}>
                                        +{formatNumber(item.change)} MWh
                                    </Typography>
                                </Box>
                            ))}
                            {(!growthRanking || growthRanking.growth_top5.length === 0) && (
                                <Typography variant="caption" color="text.secondary">暂无数据</Typography>
                            )}
                        </Grid>
                        {/* 减量榜 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="success.main" fontWeight="bold">📉 减量榜</Typography>
                            {growthRanking?.decline_top5.map((item, index) => (
                                <Box key={item.customer_id} sx={{ py: 0.5, borderBottom: '1px solid #f0f0f0' }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' }, fontSize: '0.8rem' }}
                                        onClick={() => handleViewCustomer(item.customer_id, item.short_name)}
                                    >
                                        {index + 1}. {item.short_name}
                                    </Typography>
                                    <Typography variant="caption" color="success.main" sx={{ fontSize: '0.7rem' }}>
                                        {formatNumber(item.change)} MWh
                                    </Typography>
                                </Box>
                            ))}
                            {(!growthRanking || growthRanking.decline_top5.length === 0) && (
                                <Typography variant="caption" color="text.secondary">暂无数据</Typography>
                            )}
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            {/* 峰谷比极值榜 */}
            <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2, height: 320, overflow: 'hidden' }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
                        {dateRangeText} 峰谷比极值
                    </Typography>
                    <Grid container spacing={1} sx={{ height: 'calc(100% - 32px)', overflow: 'auto' }}>
                        {/* 高成本型 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="warning.main" fontWeight="bold">⚡️ 高成本型</Typography>
                            {efficiencyRanking?.high_pv_ratio.map((item, index) => (
                                <Box key={item.customer_id} sx={{ py: 0.5, borderBottom: '1px solid #f0f0f0' }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' }, fontSize: '0.8rem' }}
                                        onClick={() => handleViewCustomer(item.customer_id, item.short_name)}
                                    >
                                        {index + 1}. {item.short_name}
                                    </Typography>
                                    <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.7rem' }}>
                                        峰谷比 {item.pv_ratio}
                                    </Typography>
                                </Box>
                            ))}
                            {(!efficiencyRanking || efficiencyRanking.high_pv_ratio.length === 0) && (
                                <Typography variant="caption" color="text.secondary">暂无数据</Typography>
                            )}
                        </Grid>
                        {/* 优质平稳型 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="info.main" fontWeight="bold">🔋 优质平稳型</Typography>
                            {efficiencyRanking?.low_pv_ratio.map((item, index) => (
                                <Box key={item.customer_id} sx={{ py: 0.5, borderBottom: '1px solid #f0f0f0' }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' }, fontSize: '0.8rem' }}
                                        onClick={() => handleViewCustomer(item.customer_id, item.short_name)}
                                    >
                                        {index + 1}. {item.short_name}
                                    </Typography>
                                    <Typography variant="caption" color="info.main" sx={{ fontSize: '0.7rem' }}>
                                        峰谷比 {item.pv_ratio}
                                    </Typography>
                                </Box>
                            ))}
                            {(!efficiencyRanking || efficiencyRanking.low_pv_ratio.length === 0) && (
                                <Typography variant="caption" color="text.secondary">暂无数据</Typography>
                            )}
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>
        </Grid>
    );

    // ---- 渲染客户卡片（移动端）----
    const renderCustomerCard = (row: CustomerListItem) => {
        const yoyInfo = formatYoy(row.actual_yoy);
        const signedYoyInfo = formatYoy(row.signed_yoy);

        return (
            <Card
                key={row.customer_id}
                variant="outlined"
                sx={{ mb: 1.5 }}
            >
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    {/* 标题行 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography
                            variant="subtitle2"
                            fontWeight="bold"
                            color="primary.main"
                            noWrap
                            sx={{ flex: 1, cursor: 'pointer' }}
                            onClick={() => handleViewCustomer(row.customer_id, row.customer_name)}
                        >
                            {row.short_name || row.customer_name}
                        </Typography>
                        <IconButton
                            size="small"
                            sx={{ ml: 1 }}
                            onClick={() => handleViewCustomer(row.customer_id, row.customer_name)}
                        >
                            <VisibilityIcon fontSize="small" />
                        </IconButton>
                    </Box>

                    {/* 指标区 */}
                    <Grid container spacing={1}>
                        {/* 签约电量 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="text.secondary">签约电量</Typography>
                            <Typography variant="body2" fontWeight="medium">
                                {formatNumber(row.signed_quantity)} MWh
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                {row.signed_yoy_warning && (
                                    <WarningIcon color="warning" sx={{ fontSize: 12, mr: 0.3 }} />
                                )}
                                <Typography variant="caption" sx={{ color: signedYoyInfo.color }}>
                                    {signedYoyInfo.text}
                                </Typography>
                            </Box>
                        </Grid>

                        {/* 实测电量 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="text.secondary">实测电量</Typography>
                            <Typography variant="body2" fontWeight="medium">
                                {formatNumber(row.actual_usage)} MWh
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', color: yoyInfo.color }}>
                                {yoyInfo.icon}
                                <Typography variant="caption" sx={{ ml: 0.3 }}>{yoyInfo.text}</Typography>
                            </Box>
                        </Grid>

                        {/* 峰谷比 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="text.secondary">峰谷比</Typography>
                            <Typography variant="body2" fontWeight="medium" color="warning.main">
                                {row.peak_valley_ratio}
                            </Typography>
                        </Grid>

                        {/* 时段结构 */}
                        <Grid size={6}>
                            <Typography variant="caption" color="text.secondary">时段结构</Typography>
                            <Box sx={{ mt: 0.5 }}>
                                <TouStackBar tou={row.tou_breakdown} />
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>
        );
    };

    // ---- 渲染客户明细（移动端卡片 / 桌面端表格）----
    const renderCustomerList = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
            {/* 工具栏 */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                    placeholder="搜索客户名称"
                    size="small"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(0);
                    }}
                    InputProps={{
                        startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                    }}
                    sx={{ width: { xs: '100%', sm: 250 } }}
                />
            </Box>

            {/* 移动端：卡片列表 */}
            {isMobile ? (
                <Box>
                    {customerList?.items.map(row => renderCustomerCard(row))}
                    {(!customerList || customerList.items.length === 0) && (
                        <Typography color="text.secondary" textAlign="center" py={3}>
                            暂无数据
                        </Typography>
                    )}
                </Box>
            ) : (
                /* 桌面端：表格 */
                <TableContainer sx={{ overflowX: 'auto' }}>
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
                                        active={sortField === 'customer_name'}
                                        direction={sortField === 'customer_name' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('customer_name')}
                                    >
                                        客户名称
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">
                                    <TableSortLabel
                                        active={sortField === 'signed_quantity'}
                                        direction={sortField === 'signed_quantity' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('signed_quantity')}
                                    >
                                        签约电量
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">
                                    <TableSortLabel
                                        active={sortField === 'signed_yoy'}
                                        direction={sortField === 'signed_yoy' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('signed_yoy')}
                                    >
                                        签约涨幅
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">
                                    <TableSortLabel
                                        active={sortField === 'actual_usage'}
                                        direction={sortField === 'actual_usage' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('actual_usage')}
                                    >
                                        实测电量
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">
                                    <TableSortLabel
                                        active={sortField === 'actual_yoy'}
                                        direction={sortField === 'actual_yoy' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('actual_yoy')}
                                    >
                                        同比增减
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">
                                    <TableSortLabel
                                        active={sortField === 'peak_valley_ratio'}
                                        direction={sortField === 'peak_valley_ratio' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('peak_valley_ratio')}
                                    >
                                        峰谷比
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="center">时段结构</TableCell>
                                <TableCell align="center">操作</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {customerList?.items.map((row) => {
                                const yoyInfo = formatYoy(row.actual_yoy);
                                const signedYoyInfo = formatYoy(row.signed_yoy);
                                return (
                                    <TableRow key={row.customer_id} hover>
                                        <TableCell>
                                            <Typography
                                                sx={{
                                                    cursor: 'pointer',
                                                    color: 'primary.main',
                                                    '&:hover': { textDecoration: 'underline' }
                                                }}
                                                onClick={() => handleViewCustomer(row.customer_id, row.customer_name)}
                                            >
                                                {row.customer_name}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">{formatNumber(row.signed_quantity)} MWh</TableCell>
                                        <TableCell align="right">
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                                {row.signed_yoy_warning && (
                                                    <Tooltip title="涨幅超过50%，可能存在估算异常">
                                                        <WarningIcon color="warning" fontSize="small" sx={{ mr: 0.5 }} />
                                                    </Tooltip>
                                                )}
                                                <Typography sx={{ color: signedYoyInfo.color }}>
                                                    {signedYoyInfo.text}
                                                </Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">{formatNumber(row.actual_usage)} MWh</TableCell>
                                        <TableCell align="right">
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: yoyInfo.color }}>
                                                {yoyInfo.icon}
                                                <Typography variant="body2" sx={{ ml: 0.5 }}>{yoyInfo.text}</Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">{row.peak_valley_ratio}</TableCell>
                                        <TableCell align="center">
                                            <TouStackBar tou={row.tou_breakdown} />
                                        </TableCell>
                                        <TableCell align="center">
                                            <Tooltip title="查看详情">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleViewCustomer(row.customer_id, row.customer_name)}
                                                >
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {(!customerList || customerList.items.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={8} align="center">
                                        <Typography color="text.secondary">暂无数据</Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* 分页 */}
            <TablePagination
                component="div"
                count={customerList?.total || 0}
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
        </Paper>
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
                    负荷分析 / 客户负荷分析
                </Typography>
            )}

            {/* 全局时间控制栏 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* 月份选择器 */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton onClick={() => handleMonthChange(-1)} disabled={month <= 1 || loading}>
                            <ArrowLeftIcon />
                        </IconButton>
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                                value={month}
                                onChange={(e) => {
                                    setMonth(e.target.value as number);
                                    setPage(0);
                                }}
                                disabled={loading}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <MenuItem key={m} value={m}>{YEAR}年{m}月</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <IconButton onClick={() => handleMonthChange(1)} disabled={month >= 12 || loading}>
                            <ArrowRightIcon />
                        </IconButton>
                    </Box>

                    {/* 视图切换 */}
                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={(_, newMode) => {
                            if (newMode) {
                                setViewMode(newMode);
                                setPage(0);
                            }
                        }}
                        size="small"
                        disabled={loading}
                    >
                        <ToggleButton value="monthly">月度视图</ToggleButton>
                        <ToggleButton value="ytd">年累计视图</ToggleButton>
                    </ToggleButtonGroup>

                    <Tooltip title="刷新数据">
                        <IconButton onClick={handleRefresh} disabled={loading} size="small">
                            <RefreshIcon />
                        </IconButton>
                    </Tooltip>

                    {loading && <CircularProgress size={24} />}
                </Box>
            </Paper>

            {/* 错误提示 */}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {/* 加载中 */}
            {loading && !kpi ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
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

                    {/* KPI 卡片区 */}
                    {renderKpiCards()}

                    {/* 资产透视区 */}
                    {renderAssetIntelligence()}

                    {/* 客户明细 */}
                    {renderCustomerList()}
                </Box>
            )}
        </Box>
    );
};

export default CustomerLoadOverviewPage;
