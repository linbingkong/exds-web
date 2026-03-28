import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Grid,
    IconButton,
    MenuItem,
    Paper,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TableSortLabel,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
    alpha,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    AssessmentOutlined as AssessmentOutlinedIcon,
    BoltOutlined as BoltOutlinedIcon,
    CompareArrowsOutlined as CompareArrowsOutlinedIcon,
    MonetizationOnOutlined as MonetizationOnOutlinedIcon,
    PeopleAltOutlined as PeopleAltOutlinedIcon,
    WalletOutlined as WalletOutlinedIcon,
} from '@mui/icons-material';
import {
    Bar,
    BarChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    ContributionGroup,
    CustomerProfitDashboard,
    CustomerProfitRow,
    customerProfitAnalysisApi,
    ProfitViewMode,
    RankingItem,
} from '../api/customerProfitAnalysis';

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const CACHE_KEY = 'customer_profit_analysis_cache_v1';
const PIE_COLORS = ['#1565c0', '#2e7d32', '#ef6c00', '#8e24aa', '#00838f', '#90a4ae'];

type SortField = 'gross_profit' | 'price_spread' | 'energy_mwh' | 'retail_revenue' | 'wholesale_cost' | 'customer_name';
type ContributionMode = 'positive' | 'negative';

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const formatWan = (value?: number | null): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return `${(Number(value) / 10000).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} 万元`;
};

const getValueColor = (value?: number | null): string => {
    if (value === null || value === undefined) return 'text.primary';
    return value >= 0 ? '#2e7d32' : '#d32f2f';
};

const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, payload }: any) => {
    if (!percent) return null;
    if (!payload?.forceLabel && percent < 0.06) return null;
    const RADIAN = Math.PI / 180;
    const sin = Math.sin(-midAngle * RADIAN);
    const cos = Math.cos(-midAngle * RADIAN);
    const sx = cx + (outerRadius + 2) * cos;
    const sy = cy + (outerRadius + 2) * sin;
    const mx = cx + (outerRadius + 18) * cos;
    const my = cy + (outerRadius + 18) * sin;
    const ex = mx + (cos >= 0 ? 20 : -20);
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';
    const label = `${payload?.labelName || payload?.name} ${(percent * 100).toFixed(1)}%`;

    return (
        <g style={{ pointerEvents: 'none' }}>
            <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={payload?.fill || '#666'} fill="none" strokeWidth={1.5} />
            <text
                x={ex + (cos >= 0 ? 4 : -4)}
                y={ey}
                textAnchor={textAnchor}
                dominantBaseline="central"
                fill={payload?.fill || '#666'}
                fontSize={12}
                fontWeight={500}
            >
                {label}
            </text>
        </g>
    );
};

const StatCard: React.FC<{
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color: string;
    valueColor?: string;
}> = ({ title, value, subtitle, icon, color, valueColor }) => (
    <Paper
        variant="outlined"
        sx={{
            p: 2,
            height: '100%',
            borderRadius: 2,
            border: '1px solid',
            borderColor: alpha(color, 0.2),
            background: `linear-gradient(135deg, ${alpha(color, 0.03)} 0%, ${alpha(color, 0.07)} 100%)`,
        }}
    >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Box
                sx={{
                    width: 34,
                    height: 34,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color,
                    bgcolor: alpha(color, 0.12),
                }}
            >
                {icon}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
                {title}
            </Typography>
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 800, color: valueColor || 'text.primary', lineHeight: 1.2 }}>
            {value}
        </Typography>
        {subtitle && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: 'block' }}>
                {subtitle}
            </Typography>
        )}
    </Paper>
);

const buildRankingChartData = (top5: RankingItem[], bottom5: RankingItem[]) => {
    const topRows = [...top5]
        .reverse()
        .map((item) => ({ name: item.short_name || item.customer_name, value: Number(item.value || 0), type: 'top' as const }));
    const bottomRows = bottom5.map((item) => ({ name: item.short_name || item.customer_name, value: Number(item.value || 0), type: 'bottom' as const }));
    return [...topRows, ...bottomRows];
};

const ProfitTableMobileCard: React.FC<{ row: CustomerProfitRow }> = ({ row }) => {
    const profitColor = getValueColor(row.gross_profit);
    return (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{row.customer_name || '--'}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.package_name || '未匹配套餐'}</Typography>
                </Box>
                <Tooltip title="已预留，暂未接入跳转">
                    <span>
                        <Button size="small" disabled>参考详情</Button>
                    </span>
                </Tooltip>
            </Box>
            <Grid container spacing={1}>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">结算电量</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(row.energy_mwh, 3)} MWh</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">毛利</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: profitColor }}>{formatNumber(row.gross_profit, 2)} 元</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">零售收入</Typography>
                    <Typography variant="body2">{formatNumber(row.retail_revenue, 2)} 元</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">采购成本</Typography>
                    <Typography variant="body2">{formatNumber(row.wholesale_cost, 2)} 元</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">零售价</Typography>
                    <Typography variant="body2">{formatNumber(row.retail_unit_price, 3)} 元/MWh</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">价差</Typography>
                    <Typography variant="body2" sx={{ color: getValueColor(row.price_spread), fontWeight: 700 }}>
                        {formatNumber(row.price_spread, 3)} 元/MWh
                    </Typography>
                </Grid>
            </Grid>
        </Paper>
    );
};

const CustomerProfitAnalysisPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const getCachedState = <T,>(key: string, fallback: T): T => {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.timestamp > 30 * 60 * 1000) return fallback;
            return parsed[key] ?? fallback;
        } catch {
            return fallback;
        }
    };

    const [month, setMonth] = useState<number>(() => getCachedState('month', CURRENT_MONTH));
    const [viewMode, setViewMode] = useState<ProfitViewMode>(() => getCachedState('viewMode', 'monthly'));
    const [search, setSearch] = useState<string>(() => getCachedState('search', ''));
    const [page, setPage] = useState<number>(() => getCachedState('page', 0));
    const [pageSize, setPageSize] = useState<number>(() => getCachedState('pageSize', 10));
    const [sortField, setSortField] = useState<SortField>(() => getCachedState('sortField', 'gross_profit'));
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => getCachedState('sortOrder', 'desc'));
    const [contributionMode, setContributionMode] = useState<ContributionMode>(() => getCachedState('contributionMode', 'positive'));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dashboard, setDashboard] = useState<CustomerProfitDashboard | null>(null);

    const monthOptions = useMemo(
        () => Array.from({ length: CURRENT_MONTH }, (_, index) => index + 1),
        []
    );

    useEffect(() => {
        sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                month,
                viewMode,
                search,
                page,
                pageSize,
                sortField,
                sortOrder,
                contributionMode,
                timestamp: Date.now(),
            })
        );
    }, [month, viewMode, search, page, pageSize, sortField, sortOrder, contributionMode]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await customerProfitAnalysisApi.getDashboardData({
                    year: CURRENT_YEAR,
                    month,
                    view_mode: viewMode,
                    search,
                    sort_field: sortField,
                    sort_order: sortOrder,
                    page: page + 1,
                    page_size: pageSize,
                });
                setDashboard(data);
            } catch (err: any) {
                setError(err?.response?.data?.detail || err?.message || '加载客户收益分析数据失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [month, viewMode, search, sortField, sortOrder, page, pageSize]);

    const contributionGroup = useMemo<ContributionGroup | null>(() => {
        if (!dashboard) return null;
        return contributionMode === 'positive' ? dashboard.positive_contribution : dashboard.negative_contribution;
    }, [contributionMode, dashboard]);

    const contributionData = useMemo(() => {
        if (!contributionGroup) return [];
        const topRows = contributionGroup.top5.map((item, index) => ({
            name: item.customer_name,
            labelName: item.short_name || item.customer_name,
            value: item.contribution_value,
            profit: item.profit,
            avgSpread: item.avg_spread ?? null,
            percentage: item.percentage,
            fill: PIE_COLORS[index % PIE_COLORS.length],
            forceLabel: true,
        }));

        if (contributionGroup.others.contribution_value > 0) {
            topRows.push({
                name: '其他',
                labelName: '其他',
                value: contributionGroup.others.contribution_value,
                profit: contributionGroup.others.profit,
                avgSpread: null,
                percentage: contributionGroup.others.percentage,
                fill: PIE_COLORS[5],
                forceLabel: false,
            });
        }

        return topRows;
    }, [contributionGroup]);

    const profitRankingData = useMemo(() => {
        if (!dashboard) return [];
        return buildRankingChartData(
            dashboard.rankings.profit.top5,
            dashboard.rankings.profit.bottom5,
        );
    }, [dashboard]);

    const spreadRankingData = useMemo(() => {
        if (!dashboard) return [];
        return buildRankingChartData(
            dashboard.rankings.spread.top5,
            dashboard.rankings.spread.bottom5,
        );
    }, [dashboard]);

    const handleChangeMonth = (delta: number) => {
        const nextMonth = month + delta;
        if (nextMonth < 1 || nextMonth > CURRENT_MONTH) return;
        setMonth(nextMonth);
        setPage(0);
    };

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder(field === 'customer_name' ? 'asc' : 'desc');
        }
        setPage(0);
    };

    return (
        <Box sx={{ px: { xs: 1, sm: 2, md: 0 }, pb: { xs: 1, sm: 2 } }}>
            {isMobile && (
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 700 }}>
                    客户分析 / 客户收益分析
                </Typography>
            )}

            <Paper
                variant="outlined"
                sx={{
                    p: { xs: 1.5, sm: 2 },
                    mb: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    flexWrap: 'wrap',
                }}
            >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <IconButton size="small" onClick={() => handleChangeMonth(-1)} disabled={month <= 1 || loading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <Select
                        size="small"
                        value={month}
                        onChange={(event) => {
                            setMonth(Number(event.target.value));
                            setPage(0);
                        }}
                        sx={{ minWidth: 120 }}
                    >
                        {monthOptions.map((item) => (
                            <MenuItem key={item} value={item}>{`${CURRENT_YEAR}-${String(item).padStart(2, '0')}`}</MenuItem>
                        ))}
                    </Select>
                    <IconButton size="small" onClick={() => handleChangeMonth(1)} disabled={month >= CURRENT_MONTH || loading}>
                        <ArrowRightIcon />
                    </IconButton>
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={viewMode}
                        onChange={(_, value: ProfitViewMode | null) => {
                            if (!value) return;
                            setViewMode(value);
                            setPage(0);
                        }}
                    >
                        <ToggleButton value="monthly">月度视图</ToggleButton>
                        <ToggleButton value="ytd">累计视图</ToggleButton>
                    </ToggleButtonGroup>
                </Stack>
            </Paper>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {loading && !dashboard ? (
                <Box sx={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : dashboard ? (
                <>
                    <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 1.5 }}>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="客户数"
                                value={`${dashboard.kpi.customer_count}`}
                                subtitle={viewMode === 'monthly' ? '当前月份客户数' : '年内累计客户'}
                                icon={<PeopleAltOutlinedIcon fontSize="small" />}
                                color="#1565c0"
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="结算电量"
                                value={`${formatNumber(dashboard.kpi.total_energy_mwh, 3)} MWh`}
                                icon={<BoltOutlinedIcon fontSize="small" />}
                                color="#2e7d32"
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="零售结算收入"
                                value={formatWan(dashboard.kpi.retail_revenue)}
                                subtitle={`零售均价 ${formatNumber(dashboard.kpi.retail_avg_price, 3)} 元/MWh`}
                                icon={<MonetizationOnOutlinedIcon fontSize="small" />}
                                color="#00838f"
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="批发采购成本"
                                value={formatWan(dashboard.kpi.wholesale_cost)}
                                subtitle={`批发均价 ${formatNumber(dashboard.kpi.wholesale_avg_price, 3)} 元/MWh`}
                                icon={<WalletOutlinedIcon fontSize="small" />}
                                color="#ef6c00"
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="毛利"
                                value={formatWan(dashboard.kpi.gross_profit)}
                                icon={<AssessmentOutlinedIcon fontSize="small" />}
                                color="#7b1fa2"
                                valueColor={getValueColor(dashboard.kpi.gross_profit)}
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <StatCard
                                title="平均价差"
                                value={`${formatNumber(dashboard.kpi.avg_spread, 3)} 元/MWh`}
                                icon={<CompareArrowsOutlinedIcon fontSize="small" />}
                                color="#5d4037"
                                valueColor={getValueColor(dashboard.kpi.avg_spread)}
                            />
                        </Grid>
                    </Grid>

                    <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>贡献构成</Typography>
                                    <ToggleButtonGroup
                                        size="small"
                                        exclusive
                                        value={contributionMode}
                                        onChange={(_, value: ContributionMode | null) => {
                                            if (!value) return;
                                            setContributionMode(value);
                                        }}
                                        sx={{
                                            '& .MuiToggleButton-root': {
                                                px: 1.25,
                                                py: 0.4,
                                                fontSize: 12,
                                                fontWeight: 700,
                                            },
                                        }}
                                    >
                                        <ToggleButton value="positive">正收益</ToggleButton>
                                        <ToggleButton value="negative">负收益</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                                <Box sx={{ height: 320, '& .recharts-surface:focus': { outline: 'none' } }}>
                                    {contributionData.length === 0 ? (
                                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Typography color="text.secondary">
                                                {contributionMode === 'positive' ? '暂无正收益数据' : '暂无负收益数据'}
                                            </Typography>
                                        </Box>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={contributionData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={62}
                                                    outerRadius={100}
                                                    paddingAngle={2}
                                                    labelLine={false}
                                                    label={renderPieLabel}
                                                >
                                                    {contributionData.map((entry, index) => (
                                                        <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                                                    ))}
                                                </Pie>
                                                <RechartsTooltip
                                                    content={({ active, payload }: any) => {
                                                        if (!active || !payload?.length) return null;
                                                        const detail = payload[0]?.payload;
                                                        return (
                                                            <Paper sx={{ p: 1.5 }} elevation={3}>
                                                                <Typography variant="body2">利润：{formatNumber(detail?.profit ?? detail?.value, 2)} 元</Typography>
                                                                <Typography variant="body2">
                                                                    平均价差：{detail?.avgSpread === null ? '--' : `${formatNumber(detail?.avgSpread, 3)} 元/MWh`}
                                                                </Typography>
                                                            </Paper>
                                                        );
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    )}
                                </Box>
                            </Paper>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>毛利排名</Typography>
                                <Box sx={{ height: 320, '& .recharts-surface:focus': { outline: 'none' } }}>
                                    {profitRankingData.length === 0 ? (
                                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Typography color="text.secondary">暂无排名数据</Typography>
                                        </Box>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={profitRankingData} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
                                                <XAxis type="number" tickFormatter={(value) => `${(Number(value) / 10000).toFixed(1)}万`} />
                                                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12 }} />
                                                <RechartsTooltip formatter={(value: number) => [`${formatNumber(value, 2)} \u5143`, '\u6bdb\u5229']} />
                                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                                    {profitRankingData.map((item, index) => (
                                                        <Cell key={`${item.name}-${index}`} fill={item.type === 'top' ? '#2e7d32' : '#d32f2f'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </Box>
                            </Paper>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>价差排名</Typography>
                                <Box sx={{ height: 320, '& .recharts-surface:focus': { outline: 'none' } }}>
                                    {spreadRankingData.length === 0 ? (
                                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Typography color="text.secondary">暂无排名数据</Typography>
                                        </Box>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={spreadRankingData} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
                                                <XAxis type="number" tickFormatter={(value) => `${Number(value).toFixed(1)}`} />
                                                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12 }} />
                                                <RechartsTooltip formatter={(value: number) => [`${formatNumber(value, 3)} \u5143/MWh`, '\u4ef7\u5dee']} />
                                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                                                    {spreadRankingData.map((item, index) => (
                                                        <Cell key={`${item.name}-${index}`} fill={item.type === 'top' ? '#1565c0' : '#ef6c00'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>

                    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
                        <Box
                            sx={{
                                p: 2,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                bgcolor: alpha(theme.palette.primary.main, 0.03),
                                display: 'flex',
                                alignItems: { xs: 'stretch', sm: 'center' },
                                justifyContent: 'space-between',
                                gap: 1.5,
                                flexDirection: { xs: 'column', sm: 'row' },
                            }}
                        >
                            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>客户收益明细</Typography>
                            <TextField
                                size="small"
                                placeholder="搜索客户或套餐"
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setPage(0);
                                }}
                                sx={{ width: { xs: '100%', sm: 260 } }}
                            />
                        </Box>

                        {isMobile ? (
                            <Box sx={{ p: 1.5 }}>
                                {dashboard.customer_list.items.map((row) => (
                                    <ProfitTableMobileCard key={`${row.customer_id || row.customer_name}`} row={row} />
                                ))}
                            </Box>
                        ) : (
                            <TableContainer>
                                <Table size="small" sx={{ minWidth: 1080 }}>
                                    <TableHead>
                                        <TableRow sx={{ '& th': { fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04), whiteSpace: 'nowrap' } }}>
                                            <TableCell align="center">{'序号'}</TableCell>
                                            <TableCell sortDirection={sortField === 'customer_name' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'customer_name'}
                                                    direction={sortField === 'customer_name' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('customer_name')}
                                                >
                                                    {'客户名称'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell>{'套餐名称'}</TableCell>
                                            <TableCell align="right" sortDirection={sortField === 'energy_mwh' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'energy_mwh'}
                                                    direction={sortField === 'energy_mwh' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('energy_mwh')}
                                                >
                                                    {'结算电量'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell align="right" sortDirection={sortField === 'retail_revenue' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'retail_revenue'}
                                                    direction={sortField === 'retail_revenue' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('retail_revenue')}
                                                >
                                                    {'零售收入'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell align="right" sortDirection={sortField === 'wholesale_cost' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'wholesale_cost'}
                                                    direction={sortField === 'wholesale_cost' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('wholesale_cost')}
                                                >
                                                    {'采购成本'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell align="right" sortDirection={sortField === 'gross_profit' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'gross_profit'}
                                                    direction={sortField === 'gross_profit' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('gross_profit')}
                                                >
                                                    {'毛利'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell align="right">{'零售价'}</TableCell>
                                            <TableCell align="right">{'采购价'}</TableCell>
                                            <TableCell align="right" sortDirection={sortField === 'price_spread' ? sortOrder : false}>
                                                <TableSortLabel
                                                    active={sortField === 'price_spread'}
                                                    direction={sortField === 'price_spread' ? sortOrder : 'asc'}
                                                    onClick={() => handleSort('price_spread')}
                                                >
                                                    {'价差'}
                                                </TableSortLabel>
                                            </TableCell>
                                            <TableCell align="center">{'参考详情'}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {dashboard.customer_list.items.map((row, index) => (
                                            <TableRow key={`${row.customer_id || row.customer_name}-${index}`} hover>
                                                <TableCell align="center">{page * pageSize + index + 1}</TableCell>
                                                <TableCell sx={{ fontWeight: 700 }}>{row.customer_name || '--'}</TableCell>
                                                <TableCell>{row.package_name || '--'}</TableCell>
                                                <TableCell align="right">{formatNumber(row.energy_mwh, 3)}</TableCell>
                                                <TableCell align="right">{formatNumber(row.retail_revenue, 2)}</TableCell>
                                                <TableCell align="right">{formatNumber(row.wholesale_cost, 2)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 800, color: getValueColor(row.gross_profit) }}>
                                                    {formatNumber(row.gross_profit, 2)}
                                                </TableCell>
                                                <TableCell align="right">{formatNumber(row.retail_unit_price, 3)}</TableCell>
                                                <TableCell align="right">{formatNumber(row.wholesale_unit_price, 3)}</TableCell>
                                                <TableCell align="right" sx={{ color: getValueColor(row.price_spread), fontWeight: 700 }}>
                                                    {formatNumber(row.price_spread, 3)}
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Tooltip title="已预留，暂未接入跳转">
                                                        <span>
                                                            <Button size="small" disabled>参考详情</Button>
                                                        </span>
                                                    </Tooltip>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}

                        <TablePagination
                            component="div"
                            count={dashboard.customer_list.total}
                            page={page}
                            onPageChange={(_, nextPage) => setPage(nextPage)}
                            rowsPerPage={pageSize}
                            onRowsPerPageChange={(event) => {
                                setPageSize(Number(event.target.value));
                                setPage(0);
                            }}
                            rowsPerPageOptions={[10, 20, 50]}
                            labelRowsPerPage="每页行数"
                        />
                    </Paper>
                </>
            ) : null}
        </Box>
    );
};

export default CustomerProfitAnalysisPage;
