import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTabContext } from '../contexts/TabContext';
import SingleCustomerMonthlyDetailPage from './SingleCustomerMonthlyDetailPage';


import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    IconButton,
    Paper,
    Snackbar,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    Typography,
    useMediaQuery,
    useTheme,
    alpha,
    Divider,
    LinearProgress,
    Tooltip,
    Tab,
    Tabs
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import CalculateIcon from '@mui/icons-material/Calculate';
import PeopleIcon from '@mui/icons-material/People';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import BoltIcon from '@mui/icons-material/Bolt';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PriceCheckIcon from '@mui/icons-material/PriceCheck';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { format, addMonths } from 'date-fns';
import {
    BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';

import { WholesaleMonthlyTab } from './WholesaleMonthlyTab';
import { RetailMonthlyTab } from './RetailMonthlyTab';

// 类型定义
interface MonthlyCustomer {
    _id: string;
    customer_id?: string;
    customer_name: string;
    daily_energy_mwh: number;
    retail_fee: number;
    retail_avg_price: number;
    balancing_energy_mwh: number;
    balancing_fee: number;
    total_energy_mwh: number;
    retail_total_fee: number;
    total_fee: number;
    excess_refund_fee: number;
    settlement_avg_price: number;
    final_wholesale_fee?: number;
    final_wholesale_unit_price?: number;
    final_gross_profit?: number;
    final_price_spread_per_mwh?: number;
    package_name?: string;
    model_code?: string;
    price_model?: {
        is_capped?: boolean;
    };
}

interface RetailChartPoint {
    customer_name: string;
    package_name: string;
    model_code: string;
    is_capped: boolean;
    spread: number;
    load: number;
    profit: number;
    abs_profit: number;
}

interface RetailPackageSummary {
    name: string;
    profit: number;
    count: number;
    load: number;
}

interface RetailChartData {
    customer_points: RetailChartPoint[];
    package_summary: RetailPackageSummary[];
}

interface ReconciliationRow {
    group_key: string;
    group_label: string;
    metric: string;
    monthly_value: number;
    daily_agg_value: number;
    diff: number;
    diff_rate_pct: number | null;
}

interface ReconciliationData {
    month: string;
    rows: ReconciliationRow[];
    daily_side_adjustments?: {
        balancing_fee_added_to_energy_fee?: number;
    };
}

interface JobInfo {
    job_id: string;
    month: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | string;
    progress: number;
    message?: string;
}

interface WholesaleLedger {
    month: string;
    has_data: boolean;
    settlement_items: Record<string, any>;
    period_details?: any[];
}

// 辅助函数
const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

// 配色方案
const GROUP_COLORS: Record<string, string> = {
    基本信息: '#f5f5f5',
    批发结算: '#fce4ec',
    '零售结算（价格申报）': '#fff3e0',
    '月度结算（账单结果）': '#f3e5f5',
    超额返还: '#e0f7fa',
    账单数据: '#e8eaf6',
    月度收益: '#e8f5e9',
    操作: '#eeeeee',
};

const WHOLESALE_COLORS = {
    headerBg: '#f5f5f5',  // 浅灰背景 (参考其他页面的朴素风格)
    accent: '#1976d2',    // 依然用一点主色用来勾勒线条，但不抢眼
    light: '#ffffff'      // 内部卡片使用纯白
};

const RECON_COLORS = {
    headerBg: '#f5f5f5',  // 浅灰背景
    accent: '#d32f2f',
    light: '#ffffff'
};
type WholesaleDisplayField = {
    key: string;
    label: string;
    digits: number;
    reconGroup?: string;
    reconMetric?: string;
    calc?: (items: any) => number | null;
};

type WholesaleDisplayGroup = {
    title: string;
    fields: WholesaleDisplayField[];
};

const WHOLESALE_DISPLAY_GROUPS: WholesaleDisplayGroup[] = [];

// Waterfall chart helper
const getWaterfallData = (items: any) => {
    if (!items) return [];
    let currentTotal = 0;

    // Ordered steps for the waterfall (adjusted as per user request)
    const steps = [
        { name: '实时现货结算', key: 'real_time_deviation_fee', isSubtotal: false },
        { name: '中长期合同偏差', key: 'contract_fee', isSubtotal: false },
        { name: '日前现货偏差', key: 'day_ahead_deviation_fee', isSubtotal: false },
        { name: '偏差电量调平', key: 'balancing_fee', isSubtotal: false },
        { name: '发电侧成本分摊', key: 'gen_side_cost_allocation', isSubtotal: false },
        { name: '阻塞费分摊', key: 'congestion_fee_allocation', isSubtotal: false },
        { name: '不平衡资金分摊', key: 'imbalance_fund_allocation', isSubtotal: false },
        { name: '偏差回收费', key: 'deviation_recovery_fee', isSubtotal: false },
        { name: '偏差回收费返还', key: 'deviation_recovery_return_fee', isSubtotal: false },
        { name: '结算合计', key: 'settlement_fee_total', isSubtotal: true, totalKey: 'settlement_fee_total' },
    ];

    return steps.map(step => {
        const val = items[step.isSubtotal ? step.totalKey! : step.key] || 0;
        let start = 0;
        let end = 0;

        if (step.isSubtotal) {
            start = 0;
            end = val;
            currentTotal = val; // Synchronize with the explicit subtotal
        } else {
            start = currentTotal;
            end = currentTotal + val;
            currentTotal = end;
        }

        return {
            name: step.name,
            isSubtotal: step.isSubtotal,
            value: val,
            range: [start, end],
            color: step.isSubtotal ? '#1565c0' : (val >= 0 ? '#2e7d32' : '#d32f2f')
        };
    });
};

// Waterfall custom tooltip
const WaterfallTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <Paper sx={{ p: 1.5, minWidth: 200 }} elevation={3}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>{data.name}</Typography>
                <Divider sx={{ mb: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                        {data.isSubtotal ? '累计金额:' : '变动金额:'}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" color={data.value >= 0 && !data.isSubtotal ? 'success.main' : (data.value < 0 && !data.isSubtotal ? 'error.main' : 'text.primary')}>
                        {data.value >= 0 && !data.isSubtotal ? '+' : ''}{formatNumber(data.value, 2)} 元
                    </Typography>
                </Box>
                {!data.isSubtotal && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" color="text.secondary">变动后余额:</Typography>
                        <Typography variant="caption" fontWeight="bold">{formatNumber(data.range[1], 2)} 元</Typography>
                    </Box>
                )}
            </Paper>
        );
    }
    return null;
};

// 指标卡组件
const StatCard: React.FC<{
    title: string;
    value: string | number;
    subValue?: string;
    extraValue?: string;
    icon: React.ReactElement;
    color: string;
}> = ({ title, value, subValue, extraValue, icon, color }) => (
    <Paper
        variant="outlined"
        sx={{
            p: 1.5,
            height: '100%',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            border: '1px solid',
            borderColor: alpha(color, 0.2),
            background: `linear-gradient(135deg, ${alpha(color, 0.02)} 0%, ${alpha(color, 0.05)} 100%)`,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: `0 8px 24px ${alpha(color, 0.12)}`,
                borderColor: alpha(color, 0.4)
            }
        }}
    >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Box sx={{ color, p: 0.8, borderRadius: '10px', bgcolor: alpha(color, 0.1), mr: 1, display: 'flex' }}>
                {React.cloneElement(icon as React.ReactElement<any>, { sx: { fontSize: 20 } })}
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.5 }}>
                {title}
            </Typography>
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>
            {value}
        </Typography>

        {subValue && (
            <Typography variant="caption" sx={{ mt: 0.5, fontWeight: 500, color: 'text.secondary' }}>
                {subValue}
            </Typography>
        )}

        {extraValue && (
            <Typography
                variant="caption"
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    fontWeight: 800,
                    color: color,
                    bgcolor: alpha(color, 0.1),
                    px: 0.8,
                    py: 0.2,
                    borderRadius: 1
                }}
            >
                {extraValue}
            </Typography>
        )}
    </Paper>
);

// 移动端专用组件：批发侧列表
const WholesaleMobileList: React.FC<{ items: any; reconciliation?: ReconciliationData }> = ({ items, reconciliation }) => {
    const theme = useTheme();

    const sections = [
        {
            title: '电能量电费',
            rows: [
                { label: '实时现货结算', volKey: 'actual_consumption_volume', priceKey: 'real_time_avg_price', feeKey: 'real_time_deviation_fee', reconGroup: '实时市场偏差', priceCalc: (items: any) => items.actual_consumption_volume ? items.real_time_deviation_fee / items.actual_consumption_volume : null },
                { label: '中长期合同偏差', volKey: 'contract_volume', priceKey: 'contract_avg_price', feeKey: 'contract_fee', reconGroup: '中长期合约' },
                { label: '日前现货偏差', volKey: 'day_ahead_declared_volume', priceKey: 'day_ahead_avg_price', feeKey: 'day_ahead_deviation_fee', reconGroup: '日前市场偏差', priceCalc: (items: any) => items.day_ahead_declared_volume ? items.day_ahead_deviation_fee / items.day_ahead_declared_volume : null },
                { label: '偏差电量调平电费', volKey: 'monthly_balancing_volume', priceKey: 'balancing_price', feeKey: 'balancing_fee' },
                { label: '电能量合计', volKey: 'actual_monthly_volume', priceKey: 'energy_avg_price', feeKey: 'energy_fee_total', isTotal: true },
            ]
        },
        {
            title: '资金余缺费用',
            rows: [
                { label: '发电侧成本类费用分摊', feeKey: 'gen_side_cost_allocation' },
                { label: '阻塞费分摊', feeKey: 'congestion_fee_allocation' },
                { label: '不平衡资金分摊', feeKey: 'imbalance_fund_allocation' },
                { label: '偏差回收费', feeKey: 'deviation_recovery_fee' },
                { label: '偏差回收费返还', feeKey: 'deviation_recovery_return_fee' },
                { label: '资金余缺费用合计', feeKey: 'fund_surplus_deficit_total', isTotal: true },
            ]
        },
        {
            title: '结算合计',
            rows: [
                { label: '结算合计', volKey: 'actual_monthly_volume', priceKey: 'settlement_avg_price', feeKey: 'settlement_fee_total', isGrandTotal: true },
            ]
        }
    ];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {sections.map((section, sIdx) => (
                <Box key={sIdx}>
                    <Box sx={{ bgcolor: alpha(WHOLESALE_COLORS.accent, 0.05), px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" sx={{ fontWeight: 800, color: WHOLESALE_COLORS.accent }}>{section.title}</Typography>
                    </Box>
                    {section.rows.map((row: any, rIdx) => {
                        const vol = items[row.volKey || ''] ?? null;
                        const price = row.priceCalc ? row.priceCalc(items) : (items[row.priceKey || ''] ?? null);
                        const fee = items[row.feeKey || ''] ?? null;
                        const isHighlight = row.isTotal || row.isGrandTotal;

                        return (
                            <Box key={rIdx} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: isHighlight ? alpha(theme.palette.primary.main, 0.02) : 'transparent' }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                                    <Typography variant="body2" sx={{ fontWeight: isHighlight ? 800 : 500 }}>{row.label}</Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 800, color: fee !== null && fee < 0 ? 'error.main' : 'text.primary' }}>
                                        {formatNumber(fee, 2)}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                                    {row.volKey && (
                                        <Typography variant="caption" color="text.secondary">电量: {formatNumber(vol, 3)}</Typography>
                                    )}
                                    {row.priceKey && (
                                        <Typography variant="caption" color="text.secondary">均价: {formatNumber(price, 3)}</Typography>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
};

// 移动端专用组件：客户结算卡片
const CustomerMobileCard: React.FC<{
    customer: MonthlyCustomer;
    index: number;
    onClick?: (customer: MonthlyCustomer) => void;
}> = ({ customer, index, onClick }) => {
    const theme = useTheme();
    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ px: 0.8, py: 0.2, bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', borderRadius: 1, fontSize: '0.7rem', fontWeight: 800 }}>
                        {index + 1}
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{customer.customer_name}</Typography>
                </Box>
                <Button
                    size="small"
                    variant="text"
                    color="primary"
                    endIcon={<ArrowForwardIosIcon sx={{ fontSize: '10px !important' }} />}
                    onClick={() => onClick?.(customer)}
                    sx={{ p: 0, minWidth: 'auto', fontWeight: 800, fontSize: '0.75rem' }}
                >
                    查看明细
                </Button>
            </Box>

            <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">结算电量 (MWh)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(customer.total_energy_mwh, 3)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">结算均价 (元)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(customer.settlement_avg_price, 3)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">结算电费 (元)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(customer.total_fee, 2)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">超额返还 (元)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>{formatNumber(customer.excess_refund_fee, 2)}</Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: customer.final_gross_profit && customer.final_gross_profit >= 0 ? 'error.main' : 'success.main', display: 'flex', justifyContent: 'flex-end' }}>
                        月度毛利: {formatNumber(customer.final_gross_profit, 2)}
                    </Typography>
                </Grid>
            </Grid>
        </Paper>
    );
};

const EmptyState: React.FC<{
    month: string;
    onImportWholesale: () => void;
    importDisabled?: boolean;
}> = ({ month, onImportWholesale, importDisabled = false }) => (
    <Paper
        variant="outlined"
        sx={{
            p: { xs: 4, sm: 8 },
            textAlign: 'center',
            borderRadius: 4,
            bgcolor: 'background.paper',
            border: '1px dashed',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            my: 4
        }}
    >
        <Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'action.hover', color: 'text.disabled', mb: 1 }}>
            <CalculateIcon sx={{ fontSize: { xs: 32, sm: 48 } }} />
        </Box>
        <Typography variant="h5" fontWeight={800} color="text.primary" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            未找到 {month} 的结算数据
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 450, mx: 'auto', mb: 2 }}>
            该月份尚未导入批发结算数据。请先完成批发侧月度结算导入，随后再进入零售侧执行月度结算。
        </Typography>
        <Button
            variant="outlined"
            size="large"
            onClick={onImportWholesale}
            disabled={importDisabled}
            sx={{ borderRadius: 3, px: 4, py: 1.2, fontWeight: 700, textTransform: 'none' }}
        >
            导入批发结算文件
        </Button>
    </Paper>
);

const MonthlySettlementAnalysisPage: React.FC<{ initialMonth?: string }> = ({ initialMonth }) => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:settlement_monthly_detail:edit');
    const canExecuteSettlement = canEdit && hasPermission('settlement:recalc:execute');
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isMd = useMediaQuery(theme.breakpoints.down('md'));
    const fileInputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const tabContext = useTabContext();



    // 状态管理
    const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
        if (initialMonth) return new Date(`${initialMonth}-01`);
        const monthParam = new URLSearchParams(window.location.search).get('month');
        if (monthParam) return new Date(`${monthParam}-01`);
        return addMonths(new Date(), -1);
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 数据状态
    const [wholesaleLedger, setWholesaleLedger] = useState<WholesaleLedger | null>(null);
    const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
    const [customers, setCustomers] = useState<MonthlyCustomer[]>([]);
    const [retailChartData, setRetailChartData] = useState<RetailChartData>({
        customer_points: [],
        package_summary: [],
    });
    const [retailSummary, setRetailSummary] = useState<any>(null);

    // 排序状态
    const [orderBy, setOrderBy] = useState<keyof MonthlyCustomer>('final_gross_profit');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');

    const reconciliationGroups = useMemo(() => {
        const map = new Map<string, ReconciliationRow[]>();
        (reconciliation?.rows || []).forEach((row) => {
            const arr = map.get(row.group_label) || [];
            arr.push(row);
            map.set(row.group_label, arr);
        });
        return Array.from(map.entries()).map(([groupLabel, items]) => ({
            groupLabel,
            items,
        }));
    }, [reconciliation]);

    const [tabValue, setTabValue] = useState(0);

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    // 任务执行状态
    const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
    const [progressOpen, setProgressOpen] = useState(false);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const monthStr = selectedDate ? format(selectedDate, 'yyyy-MM') : '';

    const handleViewDetail = useCallback((customerId: string, customerName: string) => {
        const path = `/settlement/monthly-customer-detail?month=${monthStr}&customer_id=${encodeURIComponent(customerId)}&customer_name=${encodeURIComponent(customerName)}`;
        if (isMobile) {
            navigate(path);
        } else if (tabContext) {
            tabContext.addTab({
                key: path,
                title: `月度结算 - ${customerName}`,
                path: path,
                component: <SingleCustomerMonthlyDetailPage
                    initialMonth={monthStr}
                    initialCustomerId={customerId}
                    initialCustomerName={customerName}
                />,
            });
        }
    }, [monthStr, isMobile, navigate, tabContext]);

    const waterfallChartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef: waterfallChartRef,
        title: `批发结算电费瀑布图 (${monthStr})`
    });

    // 数据抓取
    const fetchData = useCallback(async (month: string) => {
        if (!month) return;
        setLoading(true);
        setError(null);
        setWholesaleLedger(null);
        setCustomers([]);
        setRetailChartData({ customer_points: [], package_summary: [] });
        try {
            const [wsRes, wsDetailRes, recRes, custRes, chartRes, rSumRes] = await Promise.all([
                apiClient.get(`/api/v1/wholesale-monthly-settlement/year/${month.split('-')[0]}`),
                apiClient.get(`/api/v1/wholesale-monthly-settlement/${month}`).catch(() => ({ data: null })),
                apiClient.get(`/api/v1/wholesale-monthly-settlement/${month}/reconciliation`).catch(() => ({ data: null })),
                apiClient.get('/api/v1/retail-settlement/monthly-customers', { params: { month } }).catch(() => ({ data: { data: [] } })),
                apiClient.get('/api/v1/retail-settlement/monthly-chart-data', { params: { month } }).catch(() => ({ data: { data: { customer_points: [], package_summary: [] } } })),
                apiClient.get('/api/v1/retail-settlement/monthly-summaries').catch(() => ({ data: { data: { summaries: [] } } }))
            ]);

            // 解析批发侧台账
            const wsRows: WholesaleLedger[] = wsRes.data?.rows || [];
            const currentWs = wsRows.find(r => r.month === month) || null;
            const currentWsDetail = wsDetailRes.data?.month === month ? wsDetailRes.data : null;
            setWholesaleLedger(currentWsDetail || currentWs);

            // 解析对账结论
            setReconciliation(recRes.data);

            // 解析零售客户
            const rawCust = custRes.data?.data || [];
            const mappedCust = (Array.isArray(rawCust) ? rawCust : rawCust.records || []).map((row: any) => ({
                ...row,
                daily_energy_mwh: Number(row.daily_energy_mwh ?? row.pre_energy_mwh ?? 0),
                retail_fee: Number(row.retail_fee ?? row.pre_retail_fee ?? 0),
                balancing_energy_mwh: Number(row.balancing_energy_mwh ?? row.sttl_balancing_energy_mwh ?? 0),
                balancing_fee: Number(row.balancing_fee ?? row.sttl_balancing_retail_fee ?? 0),
                total_energy_mwh: Number(row.total_energy_mwh ?? row.final_energy_mwh ?? row.sttl_energy_mwh ?? 0),
                retail_total_fee: Number(row.retail_total_fee ?? row.sttl_retail_fee ?? 0),
                total_fee: Number(row.total_fee ?? row.final_retail_fee ?? row.sttl_retail_fee ?? 0),
                excess_refund_fee: Number(row.excess_refund_fee ?? row.final_excess_refund_fee ?? 0),
                settlement_avg_price: Number(row.settlement_avg_price ?? row.final_retail_unit_price ?? row.sttl_retail_unit_price ?? 0),
            }));
            setCustomers(mappedCust);
            setRetailChartData(chartRes.data?.data || { customer_points: [], package_summary: [] });

            // 解析零售概览
            const sums = rSumRes.data?.data?.summaries || [];
            setRetailSummary(sums.find((s: any) => s.month === month) || null);

        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.response?.data?.detail || err.message || '加载月度数据失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const monthParam = searchParams.get('month');
        if (monthParam) {
            try {
                const date = new Date(`${monthParam}-01`);
                if (!isNaN(date.getTime())) {
                    setSelectedDate(prev => {
                        // 避免重复设置导致不必要的刷新
                        if (prev && format(prev, 'yyyy-MM') === monthParam) return prev;
                        return date;
                    });
                }
            } catch (e) {
                console.error('Invalid month parameter:', monthParam);
            }
        }
    }, [searchParams]);

    useEffect(() => {
        if (initialMonth) {
            setSelectedDate(new Date(`${initialMonth}-01`));
        }
    }, [initialMonth]);

    useEffect(() => {
        if (monthStr) {
            fetchData(monthStr);
        }
    }, [monthStr, fetchData]);

    // 计算指标卡数据
    const stats = useMemo(() => {
        const customerCount = customers.length;
        const totalEnergy = customers.reduce((sum, c) => sum + (c.total_energy_mwh || 0), 0);

        const wholesaleCost = wholesaleLedger?.settlement_items?.settlement_fee_total || 0;
        const wholesaleAvgPrice = wholesaleLedger?.settlement_items?.settlement_avg_price || 0;

        const retailRevenue = customers.reduce((sum, c) => sum + (c.total_fee || 0), 0);
        const retailAvgPrice = totalEnergy > 0 ? retailRevenue / totalEnergy : 0;

        const monthlyProfit = retailRevenue - wholesaleCost;
        const totalExcessRefund = customers.reduce((sum, c) => sum + (c.excess_refund_fee || 0), 0);
        const avgExcessRefund = totalEnergy > 0 ? totalExcessRefund / totalEnergy : 0;
        const priceSpread = retailAvgPrice - wholesaleAvgPrice;

        return [
            {
                title: '结算电量',
                value: formatNumber(totalEnergy, 3),
                subValue: '单位: MWh',
                extraValue: `${customerCount} 户`,
                icon: <BoltIcon />,
                color: '#ed6c02'
            },
            {
                title: '批发单价',
                value: formatNumber(wholesaleAvgPrice, 3),
                subValue: '单位: 元/MWh',
                icon: <PriceCheckIcon />,
                color: '#01579b'
            },
            {
                title: '零售单价',
                value: formatNumber(retailAvgPrice, 3),
                subValue: '单位: 元/MWh',
                icon: <LocalOfferIcon />,
                color: '#1b5e20'
            },
            {
                title: '批零价差',
                value: formatNumber(priceSpread, 3),
                subValue: '单位: 元/MWh',
                icon: <CompareArrowsIcon />,
                color: priceSpread >= 0 ? '#d32f2f' : '#2e7d32'
            },
            {
                title: '月度收益',
                value: formatNumber(monthlyProfit, 2),
                subValue: '单位: 元',
                icon: <TrendingUpIcon />,
                color: monthlyProfit >= 0 ? '#d32f2f' : '#2e7d32'
            },
            {
                title: '超额返还',
                value: formatNumber(totalExcessRefund, 2),
                subValue: `均价: ${formatNumber(avgExcessRefund, 3)} 元/MWh`,
                icon: <MonetizationOnIcon />,
                color: '#2e7d32'
            },
        ];
    }, [customers, wholesaleLedger, theme]);

    // 排序逻辑
    const handleRequestSort = (property: keyof MonthlyCustomer) => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    const sortedCustomers = useMemo(() => {
        const comparator = (a: MonthlyCustomer, b: MonthlyCustomer) => {
            let valA: any = a[orderBy] ?? 0;
            let valB: any = b[orderBy] ?? 0;

            // 处理特殊计算字段
            if (orderBy === 'retail_avg_price') {
                valA = a.total_energy_mwh ? a.retail_total_fee / a.total_energy_mwh : 0;
                valB = b.total_energy_mwh ? b.retail_total_fee / b.total_energy_mwh : 0;
            } else if (orderBy === 'settlement_avg_price') {
                valA = a.total_energy_mwh ? a.total_fee / a.total_energy_mwh : 0;
                valB = b.total_energy_mwh ? b.total_fee / b.total_energy_mwh : 0;
            }

            if (typeof valA === 'string' && typeof valB === 'string') {
                return order === 'desc'
                    ? valB.localeCompare(valA)
                    : valA.localeCompare(valB);
            }

            return order === 'desc' ? (valB - valA) : (valA - valB);
        };

        return [...customers].sort(comparator);
    }, [customers, order, orderBy]);

    const hasWholesaleData = Boolean(wholesaleLedger?.has_data || wholesaleLedger);
    const hasRetailData = customers.length > 0;
    const hasAnyData = hasWholesaleData || hasRetailData;
    const canExecuteRetailSettlement = canExecuteSettlement && hasWholesaleData;

    // 事件处理
    const handleShiftMonth = (months: number) => {
        if (!selectedDate) return;
        setSelectedDate(addMonths(selectedDate, months));
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const file = event.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        setLoading(true);
        setError(null);
        try {
            await apiClient.post('/api/v1/wholesale-monthly-settlement/import', formData, {
                params: { overwrite: true },
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setSnackbarOpen(true);
            await fetchData(monthStr);
        } catch (err: any) {
            setError(err.response?.data?.detail || '导入失败');
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    const pollProgress = useCallback((jobId: string, month: string) => {
        stopPolling();
        pollingRef.current = setInterval(async () => {
            try {
                const res = await apiClient.get(`/api/v1/retail-settlement/monthly-progress/${jobId}`);
                const currentJob = res.data?.data;
                setJobInfo(currentJob);
                if (currentJob?.status !== 'pending' && currentJob?.status !== 'running') {
                    stopPolling();
                    fetchData(month);
                }
            } catch {
                stopPolling();
            }
        }, 1500);
    }, [fetchData, stopPolling]);

    const handleExecuteRetailSettlement = () => {
        if (!canExecuteSettlement || !monthStr) return;
        setJobInfo(null); // 清空旧任务，进入确认模式
        setProgressOpen(true);
    };

    const handleStartSettlement = async () => {
        if (!canExecuteSettlement || !monthStr) return;
        setJobInfo({ job_id: '', month: monthStr, status: 'pending', progress: 0, message: '正在启动月度结算任务...' });
        try {
            const res = await apiClient.post('/api/v1/retail-settlement/monthly-calc', { month: monthStr, force: true });
            if (res.data?.code && res.data.code !== 200) {
                const message = res.data?.message || '启动月度结算失败';
                setJobInfo(prev => prev ? { ...prev, status: 'failed', message } : { job_id: '', month: monthStr, status: 'failed', progress: 0, message });
                return;
            }
            const jobId = res.data?.data?.job_id;
            if (jobId) pollProgress(jobId, monthStr);
            else {
                const message = res.data?.message || '未获取到任务ID';
                setJobInfo(prev => prev ? { ...prev, status: 'failed', message } : { job_id: '', month: monthStr, status: 'failed', progress: 0, message });
            }
        } catch (err: any) {
            const message = err.response?.data?.message || err.response?.data?.detail || err.message || '启动月度结算失败';
            setJobInfo(prev => prev ? { ...prev, status: 'failed', message } : { job_id: '', month: monthStr, status: 'failed', progress: 0, message });
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ p: { xs: 1, sm: 2 } }}>
                {/* 移动端面包屑标题 */}
                {isMobile && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        结算管理 / 月度结算分析
                    </Typography>
                )}
                {/* 顶部操作栏 */}
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 2, px: 1 }}>
                        <IconButton onClick={() => handleShiftMonth(-1)} disabled={loading} size="small"><ArrowLeftIcon /></IconButton>
                        <DatePicker
                            label="选择月份"
                            value={selectedDate}
                            onChange={(date) => setSelectedDate(date)}
                            disabled={loading}
                            views={['year', 'month']}
                            slotProps={{
                                textField: {
                                    size: 'small',
                                    variant: 'standard',
                                    sx: { width: 130, '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' } }
                                }
                            }}
                        />
                        <IconButton onClick={() => handleShiftMonth(1)} disabled={loading} size="small"><ArrowRightIcon /></IconButton>
                    </Box>
                    <Box sx={{ flexGrow: 1 }} />
                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImport} accept=".xls,.xlsx" />
                </Paper>

                {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

                {/* 8个指标卡片 */}
                <Grid container spacing={1.5} sx={{ mb: 3 }}>
                    {stats.map((stat, index) => (
                        <Grid key={index} size={{ xs: 6, sm: 4, md: 4, lg: 2 }}>
                            <StatCard {...stat} />
                        </Grid>
                    ))}
                </Grid>

                {/* 统一空状态提示 */}
                {!loading && !hasAnyData && (
                    <EmptyState
                        month={monthStr}
                        onImportWholesale={() => fileInputRef.current?.click()}
                        importDisabled={loading || !canEdit}
                    />
                )}

                {/* 选项卡导航 */}
                {hasAnyData && (
                    <>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                    <Tabs value={tabValue} onChange={handleTabChange} aria-label="settlement analysis tabs">
                        <Tab label="批发侧结算" icon={<CompareArrowsIcon />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 700 }} />
                        <Tab label="零售侧结算" icon={<PeopleIcon />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 700 }} />
                    </Tabs>
                </Box>

                {/* 选项卡内容 */}
                {tabValue === 0 && (
                    <WholesaleMonthlyTab
                        data={wholesaleLedger}
                        reconciliation={reconciliation}
                        loading={loading}
                        onImportWholesale={() => fileInputRef.current?.click()}
                        importDisabled={loading || !canEdit}
                    />
                )}

                {tabValue === 1 && (
                    <RetailMonthlyTab
                        month={monthStr}
                        customers={customers}
                        chartData={retailChartData}
                        handleViewDetail={handleViewDetail}
                        loading={loading}
                        onExecuteRetailSettlement={handleExecuteRetailSettlement}
                        onStartSettlement={handleStartSettlement}
                        progressOpen={progressOpen}
                        onCloseProgress={() => setProgressOpen(false)}
                        jobInfo={jobInfo}
                        snackbarOpen={snackbarOpen}
                        onCloseSnackbar={() => setSnackbarOpen(false)}
                        canExecuteSettlement={canExecuteRetailSettlement}
                    />
                )}
                    </>
                )}
                <Snackbar open={snackbarOpen} autoHideDuration={3000} onClose={() => setSnackbarOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                    <Alert severity="success" variant="filled" sx={{ borderRadius: 2 }}>
                        批发结算文件导入成功，数据已刷新
                    </Alert>
                </Snackbar>
            </Box >
        </LocalizationProvider >
    );
};

// 缺少的 Icon
const AnalyticsOutlined: React.FC<any> = (props) => (
    <Box component="svg" {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" sx={{ width: 24, height: 24, ...props.sx }}>
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
    </Box>
);

export default MonthlySettlementAnalysisPage;
