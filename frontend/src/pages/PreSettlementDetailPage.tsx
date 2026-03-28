import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    Select, MenuItem, FormControl, InputLabel, SelectChangeEvent,
    useMediaQuery, Theme, Tabs, Tab, Button, Divider,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
    Drawer, alpha
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    Fullscreen as FullscreenIcon,
    FullscreenExit as FullscreenExitIcon,
    Refresh as RefreshIcon,
    FileDownload as FileDownloadIcon,
    Close as CloseIcon
} from '@mui/icons-material';
import { format, addDays, parseISO } from 'date-fns';
import { useSearchParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useTabContext } from '../contexts/TabContext';
import { useAuth } from '../contexts/AuthContext';
import SingleCustomerSettlementDetailPage from './SingleCustomerSettlementDetailPage';
import SettlementRecalculateDialog, {
    SettlementRecalculateOptions,
} from '../components/settlement/SettlementRecalculateDialog';

// ====== 图标组件导入 ======
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import BarChartIcon from '@mui/icons-material/BarChart';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import InsightsIcon from '@mui/icons-material/Insights';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';

import {
    ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ScatterChart, Scatter, ZAxis, Cell, ReferenceLine
} from 'recharts';

// ====== 类型定义 ======
interface Summary {
    wholesale_cost: number;
    retail_revenue: number;
    daily_profit: number;
    total_volume_mwh: number;
    wholesale_avg_price: number;
    retail_avg_price: number;
    price_spread: number;
    profit_margin: number;
    deviation_recovery_fee: number;
}

interface DetailData {
    date: string;
    version: string;
    summary: Summary;
    wholesale_period_details: any[];
    customer_list: any[];
}

const VERSION_OPTIONS = [
    { value: 'PLATFORM_DAILY', label: '平台日清数据' },
    { value: 'PRELIMINARY', label: '原始数据计算' },
];

const DEFAULT_RECALCULATE_OPTIONS: SettlementRecalculateOptions = {
    wholesalePreliminary: true,
    wholesalePlatform: false,
    retailDaily: true,
};

// ====== StatCard ======
const StatCard: React.FC<{
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color?: string;
    valueColor?: string;
}> = ({ title, value, subtitle, icon, color = 'primary.main', valueColor }) => (
    <Paper
        variant="outlined"
        sx={{
            p: { xs: 1.5, sm: 2 },
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            borderRadius: 2,
            border: '1px solid',
            borderColor: alpha(color, 0.2),
            background: `linear-gradient(135deg, ${alpha(color, 0.03)} 0%, ${alpha(color, 0.07)} 100%)`,
        }}
    >
        <Box sx={{ fontSize: { xs: 30, sm: 40 }, color, mr: { xs: 1, sm: 2 }, display: 'flex', alignItems: 'center' }}>
            {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap>{title}</Typography>
            <Typography
                variant="h6" component="div" fontWeight="bold" noWrap
                sx={{ fontSize: { xs: '1rem', sm: '1.25rem' }, color: valueColor || 'text.primary' }}
            >
                {value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap>{subtitle}</Typography>
            )}
        </Box>
    </Paper>
);

const formatYuan = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const profitColor = (val: number): string => val >= 0 ? '#4caf50' : '#f44336';

const PreSettlementDetailPage: React.FC<{ initialDate?: string, initialVersion?: string }> = ({ initialDate, initialVersion }) => {
    const { hasPermission } = useAuth();
    const canRecalculate = hasPermission('module:settlement_daily_detail:edit') && hasPermission('settlement:recalc:execute');
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const isTablet = useMediaQuery((t: Theme) => t.breakpoints.down('md'));
    const isMobile = useMediaQuery((t: Theme) => t.breakpoints.down('sm'));
    const tabContext = useTabContext();
    const { setActiveTab } = tabContext;

    // ====== 关键：区分 Tab 嵌入模式 vs 路由模式 ======
    // Tab 模式：有 initialDate props，此时 useSearchParams 读取的是浏览器实际 URL（总览页），不可靠
    // 路由模式：无 initialDate props，走 /settlement/pre-settlement-detail?date=xxx 路由，searchParams 可靠
    const isEmbeddedMode = !!initialDate;

    // Tab 模式使用内部状态管理日期和版本
    const [internalDate, setInternalDate] = useState<Date>(
        initialDate ? parseISO(initialDate) : addDays(new Date(), -2)
    );
    const [internalVersion, setInternalVersion] = useState<string>(
        initialVersion || 'PLATFORM_DAILY'
    );

    // 根据模式选择数据源
    const selectedDate = isEmbeddedMode
        ? internalDate
        : (searchParams.get('date') ? parseISO(searchParams.get('date')!) : addDays(new Date(), -2));
    const version = isEmbeddedMode
        ? internalVersion
        : (searchParams.get('version') || 'PLATFORM_DAILY');
    const dateStr = format(selectedDate, 'yyyy-MM-dd');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DetailData | null>(null);
    const [activeTabIdx, setActiveTabIdx] = useState(0);
    const [refreshCount, setRefreshCount] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [processStatus, setProcessStatus] = useState<string>('');

    // 重算弹窗状态
    const [reSettleDialogOpen, setReSettleDialogOpen] = useState(false);
    const [reSettleOptions, setReSettleOptions] = useState<SettlementRecalculateOptions>(DEFAULT_RECALCULATE_OPTIONS);

    const chartRef1 = useRef<HTMLDivElement>(null);
    const chartRef2 = useRef<HTMLDivElement>(null);
    const chartRef3 = useRef<HTMLDivElement>(null);

    // 移动端表格抽屉状态
    const [selectedWholesaleRow, setSelectedWholesaleRow] = useState<any | null>(null);

    // 零售侧表格排序状态
    const [retailOrder, setRetailOrder] = useState<'asc' | 'desc'>('desc');
    const [retailOrderBy, setRetailOrderBy] = useState<string>('profit');

    // 数据获取：监听派生的 dateStr 和 version 变化
    useEffect(() => {
        const fetchCurrentData = async () => {
            if (!dateStr) return;
            setLoading(true);
            setError(null);
            try {
                const res = await apiClient.get('/api/v1/settlement/detail', {
                    params: { date: dateStr, version },
                });
                if (res.data.code === 200) {
                    setData(res.data.data);
                } else if (res.data.code === 404) {
                    setError('暂无数据：' + dateStr + (version === 'PRELIMINARY' ? ' 预出清数据' : ' 平台日清数据'));
                } else {
                    setError(res.data.message || '加载失败');
                }
            } catch (err: any) {
                if (err.response?.status === 404) {
                    setError('暂无数据：该日期的结算数据尚未生成');
                } else {
                    setError(err.response?.data?.detail || err.message || '请求失败');
                }
            } finally {
                setLoading(false);
            }
        };

        fetchCurrentData();
    }, [dateStr, version, refreshCount]);

    // 统一的日期/版本更新方法：根据模式选择更新方式
    const handleShiftDate = (days: number) => {
        const newDate = addDays(selectedDate, days);
        if (isEmbeddedMode) {
            setInternalDate(newDate);
        } else {
            setSearchParams({ date: format(newDate, 'yyyy-MM-dd'), version });
        }
    };

    const handleDateChange = (date: Date | null) => {
        if (!date) return;
        if (isEmbeddedMode) {
            setInternalDate(date);
        } else {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('date', format(date, 'yyyy-MM-dd'));
            nextParams.set('version', version);
            setSearchParams(nextParams, { replace: true });
        }
    };

    const handleVersionChange = (e: SelectChangeEvent) => {
        const newVersion = e.target.value;
        if (isEmbeddedMode) {
            setInternalVersion(newVersion);
        } else {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('date', dateStr);
            nextParams.set('version', newVersion);
            setSearchParams(nextParams, { replace: true });
        }
    };

    const handleReSettle = () => {
        setReSettleDialogOpen(true);
    };

    const executeReSettle = async () => {
        if (!canRecalculate) return;
        if (!selectedDate) return;
        setProcessing(true);
        setReSettleDialogOpen(false);
        setError(null);
        try {
            // 1. 批发侧 - 原始数据计算
            if (reSettleOptions.wholesalePreliminary) {
                setProcessStatus('正在重算：批发侧(原始数据)...');
                await apiClient.post('/api/v1/settlement/calculate', {
                    date: dateStr,
                    version: 'PRELIMINARY',
                    force: true
                });
            }

            // 2. 批发侧 - 平台日清数据
            if (reSettleOptions.wholesalePlatform) {
                setProcessStatus('正在重算：批发侧(平台日清)...');
                await apiClient.post('/api/v1/settlement/calculate', {
                    date: dateStr,
                    version: 'PLATFORM_DAILY',
                    force: true
                });
            }

            if (reSettleOptions.retailDaily) {
                setProcessStatus('正在重算：零售侧日结预结算(默认PLATFORM_DAILY,缺失降级)...');
                try {
                    const res = await apiClient.post('/api/v1/retail-settlement/calculate', {
                        date: dateStr,
                        force: true,
                        wholesale_version: 'PLATFORM_DAILY'
                    });
                    if (res.data.code !== 200 || (res.data.data && res.data.data.failed > 0 && res.data.data.success === 0)) {
                        setProcessStatus('平台数据不足，降级依赖 PRELIMINARY 重算零售侧...');
                        await apiClient.post('/api/v1/retail-settlement/calculate', {
                            date: dateStr,
                            force: true,
                            wholesale_version: 'PRELIMINARY'
                        });
                    }
                } catch (err: any) {
                    setProcessStatus('请求异常，降级依赖 PRELIMINARY 重算零售侧...');
                    await apiClient.post('/api/v1/retail-settlement/calculate', {
                        date: dateStr,
                        force: true,
                        wholesale_version: 'PRELIMINARY'
                    });
                }
            }

            setProcessStatus('重算完成，正在刷新页面...');
            setRefreshCount((prev: number) => prev + 1);
        } catch (err: any) {
            console.error('重算失败:', err);
            setError(err.response?.data?.detail || err.message || '重算过程出现错误');
        } finally {
            setProcessing(false);
            setProcessStatus('');
        }
    };

    const handleExportExcel = async () => {
        if (!dateStr) return;
        setExporting(true);
        try {
            const response = await apiClient.get('/api/v1/settlement/export/wholesale', {
                params: { date: dateStr, version },
                responseType: 'blob'
            });

            // 从 header 获取文件名
            const disposition = response.headers['content-disposition'];
            let filename = `批发结算_${dateStr}.xlsx`;
            if (disposition && disposition.indexOf('filename*=UTF-8\'\'') !== -1) {
                filename = decodeURIComponent(disposition.split('filename*=UTF-8\'\'')[1]);
            }

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('导出失败:', err);
            alert('导出失败，请重试');
        } finally {
            setExporting(false);
        }
    };

    const jumpToCustomerDetail = (customerId: string, customerName?: string) => {
        const path = `/settlement/customer-settlement-detail?date=${dateStr}&version=${version}&customer_id=${customerId}`;
        if (isMobile) {
            navigate(path);
        } else if (tabContext) {
            tabContext.addTab({
                key: path,
                title: `单客户结算 - ${customerName || customerId}`,
                path: path,
                component: <SingleCustomerSettlementDetailPage
                    initialDate={dateStr}
                    initialVersion={version}
                    initialCustomerId={customerId}
                    initialCustomerName={customerName}
                />,
            });
        }
    };

    const { isFullscreen: isFs1, FullscreenEnterButton: Enter1, FullscreenExitButton: Exit1, FullscreenTitle: Title1 } = useChartFullscreen({
        chartRef: chartRef1, title: `批发侧盈亏归因 (${dateStr})`
    });

    const { isFullscreen: isFs2, FullscreenEnterButton: Enter2, FullscreenExitButton: Exit2, FullscreenTitle: Title2 } = useChartFullscreen({
        chartRef: chartRef2, title: `客户收益多维气泡图 (${dateStr})`
    });

    const { isFullscreen: isFs3, FullscreenEnterButton: Enter3, FullscreenExitButton: Exit3, FullscreenTitle: Title3 } = useChartFullscreen({
        chartRef: chartRef3, title: `套餐收益对比图 (${dateStr})`
    });


    const renderSummaryCards = () => {
        if (!data) return null;
        const { summary: s } = data;
        return (
            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="批发成本(元)" value={`${formatYuan(s.wholesale_cost)}`}
                        subtitle={`含偏差回收 ${formatYuan(s.deviation_recovery_fee)}`}
                        icon={<AccountBalanceWalletOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="零售收入(元)" value={`${formatYuan(s.retail_revenue)}`}
                        icon={<MonetizationOnOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="日毛利(元)" value={`${formatYuan(s.daily_profit)}`}
                        subtitle={`利润率 ${(s.profit_margin || 0).toFixed(2)}%`}
                        icon={<TrendingUpOutlinedIcon />}
                        color={profitColor(s.daily_profit)} valueColor={profitColor(s.daily_profit)} />
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="购电均价" value={`${(s.wholesale_avg_price || 0).toFixed(2)}`}
                        subtitle="元/MWh" icon={<PriceChangeOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="售电均价" value={`${(s.retail_avg_price || 0).toFixed(2)}`}
                        subtitle="元/MWh" icon={<LocalOfferOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard title="价差" value={`${(s.price_spread || 0) > 0 ? '+' : ''}${(s.price_spread || 0).toFixed(2)}`}
                        subtitle="元/MWh" icon={<CompareArrowsOutlinedIcon />}
                        color={profitColor(s.price_spread)} valueColor={profitColor(s.price_spread)} />
                </Grid>
            </Grid>
        );
    };



    // ====== 盈亏归因图 自定义 Tooltip ======
    const WholesalePLTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;
        const d = payload[0]?.payload;
        if (!d) return null;

        const contractPL = d.contractPL ?? 0;
        const dayAheadPL = d.dayAheadPL ?? 0;
        const cumPL = d.cumPL ?? 0;
        const totalFee = d.totalFee ?? 0;
        const rtFee = d.rtFee ?? 0;
        const contractVol = d.contractVol ?? 0;
        const mechanismVol = d.mechanismVol ?? 0;
        const dayAheadVol = d.dayAheadVol ?? 0;
        const realTimeVol = d.realTimeVol ?? 0;
        const hedgeVol = contractVol + mechanismVol;
        const coverageRate = realTimeVol > 0 ? (hedgeVol / realTimeVol * 100) : 0;

        return (
            <Paper sx={{ p: 1.5, minWidth: 220, fontSize: '0.8rem' }} elevation={3}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>时段 {label}</Typography>
                {/* 盈亏分项 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <span style={{ color: '#1565c0' }}>合同差价电费 ③</span>
                    <span style={{ color: contractPL >= 0 ? '#4caf50' : '#f44336', fontWeight: 600 }}>
                        {contractPL >= 0 ? '+' : ''}{contractPL.toFixed(2)}
                    </span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <span style={{ color: '#ef6c00' }}>日前差价电费 ⑥</span>
                    <span style={{ color: dayAheadPL >= 0 ? '#4caf50' : '#f44336', fontWeight: 600 }}>
                        {dayAheadPL >= 0 ? '+' : ''}{dayAheadPL.toFixed(2)}
                    </span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, fontWeight: 'bold' }}>
                    <span>累计盈亏</span>
                    <span style={{ color: cumPL >= 0 ? '#4caf50' : '#f44336' }}>
                        {cumPL >= 0 ? '+' : ''}{cumPL.toFixed(2)}
                    </span>
                </Box>
                <Divider sx={{ my: 0.5 }} />
                {/* 电费汇总 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <span style={{ color: '#90caf9' }}>全量电费 ⑨</span>
                    <span>{rtFee.toFixed(2)}</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3, fontWeight: 'bold' }}>
                    <span style={{ color: '#00897b' }}>电费合计 ⑩</span>
                    <span>{totalFee.toFixed(2)}</span>
                </Box>
                <Divider sx={{ my: 0.5 }} />
                {/* 电量覆盖（方案A） */}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.3 }}>
                    电量覆盖
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                    <span>合同①+机制⑫</span>
                    <span>{hedgeVol.toFixed(3)} MWh</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                    <span>日前补充 ④</span>
                    <span>{dayAheadVol.toFixed(3)} MWh</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                    <span>实际用量 ⑦</span>
                    <span>{realTimeVol.toFixed(3)} MWh</span>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>覆盖率</span>
                    <span style={{ color: coverageRate >= 95 ? '#4caf50' : coverageRate >= 80 ? '#ff9800' : '#f44336' }}>
                        {coverageRate.toFixed(1)}%
                    </span>
                </Box>
            </Paper>
        );
    };

    const renderWholesaleChart = () => {
        if (!data || !data.wholesale_period_details) return null;

        // 数据预处理：计算盈亏分项和累计值
        let cumSum = 0;
        const chartData = data.wholesale_period_details.map((p: any) => {
            const contractPL = p.contract?.fee ?? 0;
            const dayAheadPL = p.day_ahead?.fee ?? 0;
            cumSum += contractPL + dayAheadPL;
            return {
                period: p.period,
                contractPL,
                dayAheadPL,
                cumPL: cumSum,
                totalFee: p.total_energy_fee ?? 0,
                rtFee: p.real_time?.fee ?? 0,
                contractVol: p.contract?.volume ?? 0,
                dayAheadVol: p.day_ahead?.volume ?? 0,
                realTimeVol: p.real_time?.volume ?? 0,
                mechanismVol: p.mechanism_volume ?? 0,
            };
        });

        return (
            <Box ref={chartRef1} sx={{
                height: { xs: 300, sm: 360 }, position: 'relative',
                bgcolor: isFs1 ? 'background.paper' : 'transparent',
                p: isFs1 ? 2 : 0,
                ...(isFs1 && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                '& .recharts-wrapper:focus': { outline: 'none' }
            }}>
                <Enter1 /><Exit1 /><Title1 />
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis
                            yAxisId="left"
                            label={{ value: '时段盈亏 (元)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                            tick={{ fontSize: 11 }}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            label={{ value: '累计盈亏 (元)', angle: 90, position: 'insideRight', style: { fontSize: 12 } }}
                            tick={{ fontSize: 11 }}
                        />
                        <Tooltip content={<WholesalePLTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                        {/* 全量电费背景面积图 */}
                        <Area yAxisId="left" type="monotone" dataKey="rtFee" name="全量电费⑨" fill="#90caf9" stroke="none" fillOpacity={0.15} />
                        {/* 正负堆叠柱状图 */}
                        <Bar yAxisId="left" dataKey="contractPL" name="合同差价电费" fill="#1565c0" stackId="pl" />
                        <Bar yAxisId="left" dataKey="dayAheadPL" name="日前差价电费" fill="#ef6c00" stackId="pl" />
                        {/* 电费合计折线 */}
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="totalFee"
                            name="电费合计⑩"
                            stroke="#00897b"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            dot={false}
                        />
                        {/* 累计盈亏折线 */}
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumPL"
                            name="累计盈亏"
                            stroke="#7b1fa2"
                            strokeWidth={2}
                            dot={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </Box>
        );
    };

    const renderRetailBubbleChart = () => {
        if (!data || !data.customer_list) return null;

        const chartData: any[] = [];
        let hasFixed = false, hasAvg = false, hasUpper = false, hasOther = false;

        data.customer_list.forEach((c: any) => {
            const load = c.daily_load || 0;
            const entry = {
                customerName: c.customer_name,
                package: c.package_name || c.pricing_model || '无类别',
                pricing_model: c.pricing_model || '',
                is_capped: !!c.is_capped,
                spread: load > 0 ? (c.price_spread || 0) : 0,
                load: load,
                profit: c.daily_profit || 0,
                absProfit: Math.abs(c.daily_profit || 0),
                color: '#9e9e9e'
            };

            const packageStr = String(entry.package);

            if (packageStr.includes('上限')) {
                entry.color = '#ff5722';
                hasUpper = true;
            } else if (packageStr.includes('固定')) {
                entry.color = '#2196f3';
                hasFixed = true;
            } else if (packageStr.includes('平均上网电价')) {
                entry.color = '#4caf50';
                hasAvg = true;
            } else {
                hasOther = true;
            }

            chartData.push(entry);
        });

        const CustomTooltip = ({ active, payload }: any) => {
            if (active && payload && payload.length) {
                const d = payload[0].payload;
                return (
                    <Paper sx={{ p: 1.5, fontSize: '0.875rem' }} elevation={3}>
                        <Typography variant="subtitle2" fontWeight="bold">{d.customerName}</Typography>
                        <Divider sx={{ my: 0.5 }} />
                        <Typography variant="body2" color="text.secondary">套餐: {d.package}</Typography>
                        <Typography variant="body2">结算电量: {d.load.toFixed(3)} MWh</Typography>
                        <Typography variant="body2">批零价差: {d.spread.toFixed(2)} 元/MWh</Typography>
                        <Typography variant="body2" fontWeight="bold" color={d.profit >= 0 ? 'success.main' : 'error.main'}>
                            日总毛利: {formatYuan(d.profit)}
                        </Typography>
                    </Paper>
                );
            }
            return null;
        };

        return (
            <Box ref={chartRef2} sx={{
                height: { xs: 300, sm: 350 }, position: 'relative',
                bgcolor: isFs2 ? 'background.paper' : 'transparent',
                p: isFs2 ? 2 : 0,
                ...(isFs2 && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                '& .recharts-wrapper:focus': { outline: 'none' }
            }}>
                <Enter2 /><Exit2 /><Title2 />
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" dataKey="spread" name="均价差" unit="元" domain={['auto', 'auto']} label={{ value: '批零价差 (元/MWh)', position: 'bottom', offset: -10 }} />
                        <YAxis type="number" dataKey="load" name="负荷" unit="MWh" label={{ value: '电量 (MWh)', angle: -90, position: 'insideLeft' }} />
                        <ZAxis type="number" dataKey="absProfit" range={[50, 400]} name="利润大小" />
                        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                        <Legend wrapperStyle={{ fontSize: 12, bottom: 0 }} />

                        {/* 仅用于控制图例 */}
                        {hasFixed && <Scatter name="固定价" data={[]} fill="#2196f3" legendType="circle" />}
                        {hasAvg && <Scatter name="均价参考" data={[]} fill="#4caf50" legendType="circle" />}
                        {hasUpper && <Scatter name="上限价" data={[]} fill="#ff5722" legendType="circle" />}
                        {hasOther && <Scatter name="其它" data={[]} fill="#9e9e9e" legendType="circle" />}

                        {/* 真正的气泡图 */}
                        <Scatter name="客户分布" data={chartData} legendType="none">
                            {chartData.map((entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.7} />
                            ))}
                        </Scatter>

                        <ReferenceLine x={0} stroke="#999" />
                        <ReferenceLine y={0} stroke="#999" />
                    </ScatterChart>
                </ResponsiveContainer>
            </Box>
        );
    };

    const renderRetailPackageChart = () => {
        if (!data || !data.customer_list) return null;

        // 按照套餐统计人数、利润和电量
        const packageAggr = data.customer_list.reduce((acc: any, c: any) => {
            const pkg = c.package_name || c.pricing_model || '其它';
            if (!acc[pkg]) {
                acc[pkg] = { name: pkg, profit: 0, count: 0, load: 0 };
            }
            acc[pkg].profit += c.daily_profit || 0;
            acc[pkg].load += c.daily_load || 0;
            acc[pkg].count += 1;
            return acc;
        }, {});

        // 转为数组并按利润降序排序
        const chartData = Object.values(packageAggr).sort((a: any, b: any) => b.profit - a.profit);

        const PackageTooltip = ({ active, payload }: any) => {
            if (active && payload && payload.length) {
                const d = payload[0].payload;
                return (
                    <Paper sx={{ p: 1.5, fontSize: '0.875rem' }} elevation={3}>
                        <Typography variant="subtitle2" fontWeight="bold">{d.name}</Typography>
                        <Divider sx={{ my: 0.5 }} />
                        <Typography variant="body2">涉及客户: {d.count} 户</Typography>
                        <Typography variant="body2">结算电量: {d.load.toFixed(3)} MWh</Typography>
                        <Typography variant="body2" fontWeight="bold" color={d.profit >= 0 ? "success.main" : "error.main"}>
                            该套餐总毛利: {formatYuan(d.profit)}
                        </Typography>
                    </Paper>
                );
            }
            return null;
        };

        return (
            <Box ref={chartRef3} sx={{
                height: { xs: 300, sm: 350 }, position: 'relative',
                bgcolor: isFs3 ? 'background.paper' : 'transparent',
                p: isFs3 ? 2 : 0,
                ...(isFs3 && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                '& .recharts-wrapper:focus': { outline: 'none' }
            }}>
                <Enter3 /><Exit3 /><Title3 />
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="left" tickFormatter={(val) => `${(val / 10000).toFixed(0)}万`} width={50} label={{ value: '毛利 (元)', angle: -90, position: 'insideLeft', offset: 0 }} />
                        <YAxis yAxisId="right" orientation="right" width={50} label={{ value: '电量 (MWh)', angle: 90, position: 'insideRight', offset: 0 }} />
                        <Tooltip content={<PackageTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="left" dataKey="profit" name="套餐总毛利" barSize={40}>
                            {chartData.map((entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#4caf50' : '#f44336'} />
                            ))}
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="load" name="结算电量" stroke="#1976d2" strokeWidth={2} dot={{ r: 4 }} />
                        <ReferenceLine yAxisId="left" y={0} stroke="#000" />
                    </ComposedChart>
                </ResponsiveContainer>
            </Box>
        );
    };

    const renderWholesaleTable = () => {
        if (!data || !data.wholesale_period_details) return null;

        // 计算合计行
        const totals = data.wholesale_period_details.reduce((acc: any, p: any) => {
            acc.contractVol += p.contract?.volume ?? 0;
            acc.contractFee += p.contract?.fee ?? 0;
            acc.daVol += p.day_ahead?.volume ?? 0;
            acc.daFee += p.day_ahead?.fee ?? 0;
            acc.rtVol += p.real_time?.volume ?? 0;
            acc.rtFee += p.real_time?.fee ?? 0;
            acc.totalFee += p.total_energy_fee ?? 0;
            acc.mechanismVol += p.mechanism_volume ?? 0;
            acc.stdCost += p.standard_value_cost ?? 0;
            return acc;
        }, { contractVol: 0, contractFee: 0, daVol: 0, daFee: 0, rtVol: 0, rtFee: 0, totalFee: 0, mechanismVol: 0, stdCost: 0 });

        // 合计均价
        const totalContractAvgPrice = totals.contractVol > 0 ? (totals.contractFee / totals.contractVol) : 0;
        const totalDaAvgPrice = totals.daVol > 0 ? (totals.daFee / totals.daVol) : 0;
        const totalRtAvgPrice = totals.rtVol > 0 ? (totals.rtFee / totals.rtVol) : 0;
        const totalAvgPrice = totals.rtVol > 0 ? (totals.totalFee / totals.rtVol) : 0;

        const headerGroupSx = {
            fontWeight: 'bold',
            textAlign: 'center' as const,
            borderBottom: '2px solid',
            borderColor: 'divider',
            py: 0.5,
        };

        // 辅助函数：渲染抽屉行项
        const renderDetailItem = (label: string, value: string | number, formula?: string) => (
            <Box sx={{ mb: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>{label}</Typography>
                        {formula && <Typography variant="caption" sx={{ color: 'primary.main', opacity: 0.8, display: 'block' }}>{formula}</Typography>}
                    </Box>
                    <Typography variant="body1" fontWeight="bold">{value}</Typography>
                </Box>
            </Box>
        );

        return (
            <>
                <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small" stickyHeader sx={{
                        '& .MuiTableCell-root': {
                            fontSize: { xs: '0.7rem', sm: '0.8rem' },
                            px: { xs: 0.3, sm: 0.8 }, whiteSpace: 'nowrap', py: 0.3,
                        },
                        '& .MuiTableCell-head': {
                            backgroundColor: 'background.paper',
                        },
                    }}>
                        <TableHead>
                            {/* 第一级表头：大分组 */}
                            <TableRow>
                                <TableCell rowSpan={2} sx={{ ...headerGroupSx, position: 'sticky', left: 0, zIndex: 3, backgroundColor: 'background.paper' }}>
                                    时段
                                </TableCell>
                                <TableCell colSpan={3} sx={{ ...headerGroupSx, color: '#1565c0', borderBottomColor: '#1565c0', bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>
                                    中长期合约电费
                                </TableCell>
                                <TableCell colSpan={3} sx={{ ...headerGroupSx, color: '#ef6c00', borderBottomColor: '#ef6c00', bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>
                                    日前市场偏差
                                </TableCell>
                                <TableCell colSpan={3} sx={{ ...headerGroupSx, color: '#2e7d32', borderBottomColor: '#2e7d32', bgcolor: '#f5fff5', display: { xs: 'none', md: 'table-cell' } }}>
                                    实时市场偏差
                                </TableCell>
                                <TableCell colSpan={2} sx={{ ...headerGroupSx, color: '#c62828', borderBottomColor: '#c62828', bgcolor: '#fff5f5' }}>
                                    电能量
                                </TableCell>
                                <TableCell colSpan={4} sx={{ ...headerGroupSx, color: '#6a1b9a', borderBottomColor: '#6a1b9a', bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>
                                    标准值
                                </TableCell>
                            </TableRow>
                            {/* 第二级表头：子列 */}
                            <TableRow>
                                {/* 中长期 */}
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#1565c0', bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>合同电量<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>①</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#1565c0', bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>合同均价<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>②</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#1565c0', bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>差价电费<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>③=①×(②-⑤)</Box></TableCell>
                                {/* 日前 */}
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#ef6c00', bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>出清电量<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>④</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#ef6c00', bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>市场均价<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑤</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#ef6c00', bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>差价电费<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑥=④×(⑤-⑧)</Box></TableCell>
                                {/* 实时 */}
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#2e7d32', bgcolor: '#f5fff5', display: { xs: 'none', md: 'table-cell' } }}>实际用量<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑦</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#2e7d32', bgcolor: '#f5fff5', display: { xs: 'none', lg: 'table-cell' } }}>市场均价<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑧</Box></TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#2e7d32', bgcolor: '#f5fff5', display: { xs: 'none', md: 'table-cell' } }}>全量电费<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑨=⑦×⑧</Box></TableCell>
                                {/* 电能量 */}
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#c62828', bgcolor: '#fff5f5' }}>
                                    电费合计<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑩=③+⑥+⑨</Box>
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#c62828', bgcolor: '#fff5f5' }}>
                                    结算均价<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑪=⑩÷⑦</Box>
                                </TableCell>
                                {/* 标准值 */}
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#6a1b9a', bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>
                                    机制电量<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑫</Box>
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#6a1b9a', bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>
                                    签约比例<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑬=(①+⑫)÷⑦</Box>
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#6a1b9a', bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>
                                    电费合计<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑭</Box>
                                </TableCell>
                                <TableCell align="right" sx={{ fontWeight: 500, color: '#6a1b9a', bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>
                                    结算均价<br /><Box component="span" sx={{ fontSize: '0.6rem', opacity: 0.75 }}>⑮=⑭÷⑦</Box>
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.wholesale_period_details.map((p: any) => {
                                const cVol = p.contract?.volume ?? 0;
                                const cPrice = p.contract?.price ?? 0;
                                const cFee = p.contract?.fee ?? 0;

                                const daVol = p.day_ahead?.volume ?? 0;
                                const daPrice = p.day_ahead?.price ?? 0;
                                const daFee = p.day_ahead?.fee ?? 0;

                                const rtVol = p.real_time?.volume ?? 0;
                                const rtPrice = p.real_time?.price ?? 0;
                                const rtFee = p.real_time?.fee ?? 0;

                                const totalFee = p.total_energy_fee ?? 0;
                                const avgPrice = p.energy_avg_price ?? 0;
                                const ratio = p.contract_ratio ?? 0;
                                const mechanismVol = p.mechanism_volume ?? 0;
                                const stdCost = p.standard_value_cost ?? 0;
                                const stdAvgPrice = rtVol > 0 ? (stdCost / rtVol) : 0;

                                return (
                                    <TableRow
                                        key={p.period}
                                        hover
                                        sx={{ cursor: 'pointer' }}
                                        onClick={() => isMobile && setSelectedWholesaleRow(p)}
                                    >
                                        <TableCell sx={{ position: 'sticky', left: 0, backgroundColor: 'background.paper', zIndex: 1, fontWeight: 500 }}>
                                            {p.period}
                                        </TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>{cVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>{cPrice.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f0f7ff', display: { xs: 'none', lg: 'table-cell' } }}>{cFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>{daVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>{daPrice.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fff9f0', display: { xs: 'none', lg: 'table-cell' } }}>{daFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f5fff5', display: { xs: 'none', md: 'table-cell' } }}>{rtVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f5fff5', display: { xs: 'none', lg: 'table-cell' } }}>{rtPrice.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#f5fff5', display: { xs: 'none', md: 'table-cell' } }}>{rtFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fff5f5', fontWeight: 'bold' }}>{totalFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fff5f5', fontWeight: 'bold' }}>{avgPrice.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>{mechanismVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>{ratio.toFixed(2)}%</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>{stdCost.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ bgcolor: '#fdf5ff', display: { xs: 'none', md: 'table-cell' } }}>{stdAvgPrice.toFixed(2)}</TableCell>
                                    </TableRow>
                                );
                            })}
                            {/* 合计行 */}
                            {(() => {
                                const maxFee = Math.max(totals.totalFee, totals.stdCost);
                                const settlementAvgPrice = totals.rtVol > 0 ? (totals.totalFee / totals.rtVol) : 0;
                                const feeIsMax = totals.totalFee >= totals.stdCost;
                                const stdIsMax = totals.stdCost >= totals.totalFee;
                                const stdAvgPrice = totals.rtVol > 0 ? (totals.stdCost / totals.rtVol) : 0;
                                return (
                                    <TableRow
                                        sx={{
                                            backgroundColor: '#eeeeee',
                                            '& .MuiTableCell-root': { fontWeight: 'bold' },
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => isMobile && setSelectedWholesaleRow({
                                            period: '合计',
                                            contract: { volume: totals.contractVol, price: 0, fee: totals.contractFee },
                                            day_ahead: { volume: totals.daVol, price: 0, fee: totals.daFee },
                                            real_time: { volume: totals.rtVol, price: 0, fee: totals.rtFee },
                                            total_energy_fee: totals.totalFee,
                                            energy_avg_price: settlementAvgPrice,
                                            mechanism_volume: totals.mechanismVol,
                                            contract_ratio: totals.rtVol > 0 ? (((totals.contractVol + totals.mechanismVol) / totals.rtVol) * 100) : 0,
                                            standard_value_cost: totals.stdCost
                                        })}
                                    >
                                        <TableCell sx={{ position: 'sticky', left: 0, backgroundColor: '#eeeeee', zIndex: 1 }}>合计</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{totals.contractVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>-</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{totals.contractFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{totals.daVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>-</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{totals.daFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{totals.rtVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>-</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{totals.rtFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ color: feeIsMax ? '#c62828' : undefined }}>{totals.totalFee.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ color: feeIsMax ? '#c62828' : undefined }}>{settlementAvgPrice.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{totals.mechanismVol.toFixed(3)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>{totals.rtVol > 0 ? (((totals.contractVol + totals.mechanismVol) / totals.rtVol) * 100).toFixed(1) : '0.0'}%</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' }, color: stdIsMax ? '#c62828' : undefined }}>{totals.stdCost.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' }, color: stdIsMax ? '#c62828' : undefined }}>{stdAvgPrice.toFixed(2)}</TableCell>
                                    </TableRow>
                                );
                            })()}
                        </TableBody>
                    </Table>
                </TableContainer>

                <Box sx={{ mt: 1, p: { xs: 1, sm: 1.5 }, backgroundColor: '#fdfdfd', border: '1px solid #eeeeee', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
                        备注：合计栏中，当“标准值”电费⑭大于“电能量”电费⑩时，标准值电费⑭及均价⑮标红，表示最终采用该组数据；
                        若“电能量”电费⑩更高，则电能量电费⑩和均价⑪标红，表示采用电能量这组数据。
                        {isMobile && " (提示：点击表格行可查看全量明细及推导公式)"}
                    </Typography>
                </Box>

                <Drawer
                    anchor="bottom"
                    open={!!selectedWholesaleRow}
                    onClose={() => setSelectedWholesaleRow(null)}
                    PaperProps={{
                        sx: {
                            borderTopLeftRadius: 16,
                            borderTopRightRadius: 16,
                            maxHeight: '85vh',
                            p: 2
                        }
                    }}
                >
                    {selectedWholesaleRow && (
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6">时段 {selectedWholesaleRow.period} 结算详情</Typography>
                                <IconButton onClick={() => setSelectedWholesaleRow(null)} size="small">
                                    <CloseIcon />
                                </IconButton>
                            </Box>

                            <Divider sx={{ mb: 2 }} />

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12 }}>
                                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1, fontWeight: 'bold' }}>中长期合约 (Section 1)</Typography>
                                    {renderDetailItem("合同电量", (selectedWholesaleRow.contract?.volume ?? 0).toFixed(3), "①")}
                                    {renderDetailItem("合同均价", (selectedWholesaleRow.contract?.price ?? 0).toFixed(2), "②")}
                                    {renderDetailItem("差价电费", (selectedWholesaleRow.contract?.fee ?? 0).toFixed(2), "③ = ① × (② - ⑤)")}
                                </Grid>

                                <Grid size={{ xs: 12 }}>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="subtitle2" color="warning.main" sx={{ mb: 1, fontWeight: 'bold' }}>日前市场 (Section 2)</Typography>
                                    {renderDetailItem("出清电量", (selectedWholesaleRow.day_ahead?.volume ?? 0).toFixed(3), "④")}
                                    {renderDetailItem("市场均价", (selectedWholesaleRow.day_ahead?.price ?? 0).toFixed(2), "⑤")}
                                    {renderDetailItem("差价电费", (selectedWholesaleRow.day_ahead?.fee ?? 0).toFixed(2), "⑥ = ④ × (⑤ - ⑧)")}
                                </Grid>

                                <Grid size={{ xs: 12 }}>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="subtitle2" color="success.main" sx={{ mb: 1, fontWeight: 'bold' }}>实时市场 (Section 3)</Typography>
                                    {renderDetailItem("实际用量", (selectedWholesaleRow.real_time?.volume ?? 0).toFixed(3), "⑦")}
                                    {renderDetailItem("市场均价", (selectedWholesaleRow.real_time?.price ?? 0).toFixed(2), "⑧")}
                                    {renderDetailItem("全量电费", (selectedWholesaleRow.real_time?.fee ?? 0).toFixed(2), "⑨ = ⑦ × ⑧")}
                                </Grid>

                                <Grid size={{ xs: 12 }}>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="subtitle2" color="error.main" sx={{ mb: 1, fontWeight: 'bold' }}>电能量汇总</Typography>
                                    {renderDetailItem("电费合计", (selectedWholesaleRow.total_energy_fee ?? 0).toFixed(2), "⑩ = ③ + ⑥ + ⑨")}
                                    {renderDetailItem("结算均价", (selectedWholesaleRow.energy_avg_price ?? 0).toFixed(2), "⑪ = ⑩ ÷ ⑦")}
                                </Grid>

                                <Grid size={{ xs: 12 }}>
                                    <Divider sx={{ my: 1 }} />
                                    <Typography variant="subtitle2" color="secondary.main" sx={{ mb: 1, fontWeight: 'bold' }}>标准值对照</Typography>
                                    {renderDetailItem("机制电量", (selectedWholesaleRow.mechanism_volume ?? 0).toFixed(3), "⑫")}
                                    {renderDetailItem("签约比例", (selectedWholesaleRow.contract_ratio ?? 0).toFixed(2) + "%", "⑬ = (① + ⑫) ÷ ⑦")}
                                    {renderDetailItem("电费合计", (selectedWholesaleRow.standard_value_cost ?? 0).toFixed(2), "⑭")}
                                    {renderDetailItem("结算均价", (selectedWholesaleRow.real_time?.volume > 0 ? (selectedWholesaleRow.standard_value_cost / selectedWholesaleRow.real_time.volume) : 0).toFixed(2), "⑮ = ⑭ ÷ ⑦")}
                                </Grid>
                            </Grid>

                            <Box sx={{ mt: 3, mb: 1 }}>
                                <Button
                                    fullWidth
                                    variant="contained"
                                    onClick={() => setSelectedWholesaleRow(null)}
                                    sx={{ py: 1.2, borderRadius: 2 }}
                                >
                                    关闭
                                </Button>
                            </Box>
                        </Box>
                    )}
                </Drawer>
            </>
        );
    };

    const handleRetailRequestSort = (property: string) => {
        const isAsc = retailOrderBy === property && retailOrder === 'asc';
        setRetailOrder(isAsc ? 'desc' : 'asc');
        setRetailOrderBy(property);
    };

    const renderCustomerTable = () => {
        if (!data || !data.customer_list) return null;

        // 构建带计算字段的数组以便排序
        let totalLoad = 0;
        let totalFee = 0;
        let totalCost = 0;
        let totalProfit = 0;

        const enhancedList = data.customer_list.map((c: any) => {
            const profit = c.daily_profit || 0;
            const nominalP = c.nominal_avg_price || 0;
            const settledP = c.capped_avg_price || 0;
            const load = c.daily_load || 0;
            const cost = c.allocated_cost || 0;
            const fee = c.total_fee || 0;

            totalLoad += load;
            totalFee += fee;
            totalCost += cost;
            totalProfit += profit;

            // 计算其他需要展示的字段
            const buyingPrice = load > 0 ? (cost / load) : 0;
            const margin = fee > 0 ? (profit / fee * 100) : 0;
            const spread = load > 0 ? (settledP - buyingPrice) : 0;

            return {
                ...c,
                profit,
                nominalP,
                settledP,
                load,
                cost,
                fee,
                buyingPrice,
                margin,
                spread
            };
        });

        const totalBuyingPrice = totalLoad > 0 ? (totalCost / totalLoad) : 0;
        const totalSettledPrice = totalLoad > 0 ? (totalFee / totalLoad) : 0;
        const totalMargin = totalFee > 0 ? (totalProfit / totalFee * 100) : 0;
        const totalSpread = totalLoad > 0 ? (totalSettledPrice - totalBuyingPrice) : 0;

        // 排序函数
        const sortedList = [...enhancedList].sort((a, b) => {
            let valA = a[retailOrderBy];
            let valB = b[retailOrderBy];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) {
                return retailOrder === 'asc' ? -1 : 1;
            }
            if (valA > valB) {
                return retailOrder === 'asc' ? 1 : -1;
            }
            return 0;
        });

        // Headers
        const headCells = [
            { id: 'index', label: '序号', sortable: false, align: 'left' as const },
            { id: 'customer_name', label: '客户名称', sortable: true, align: 'left' as const },
            { id: 'package_name', label: '套餐名称', sortable: true, align: 'left' as const },
            { id: 'load', label: '电量(MWh)', sortable: true, align: 'right' as const },
            { id: 'buyingPrice', label: '购电均价', sortable: true, align: 'right' as const },
            { id: 'settledP', label: '售电均价', sortable: true, align: 'right' as const },
            { id: 'fee', label: '零售收入', sortable: true, align: 'right' as const },
            { id: 'cost', label: '采购成本', sortable: true, align: 'right' as const },
            { id: 'profit', label: '毛利(元)', sortable: true, align: 'right' as const },
            { id: 'margin', label: '毛利率(%)', sortable: true, align: 'right' as const },
            { id: 'spread', label: '批零差价', sortable: true, align: 'right' as const },
            { id: 'actions', label: '操作', sortable: false, align: 'center' as const }
        ];

        if (isMobile) {
            return (
                <Box>
                    {/* 合计卡片 */}
                    <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'action.hover', borderLeft: '4px solid', borderColor: 'primary.main' }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>列表合计 (均价加权)</Typography>
                        <Grid container spacing={1}>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">结算总电量</Typography>
                                <Typography variant="body2" fontWeight="bold">{(totalLoad || 0).toFixed(3)} MWh</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总毛利</Typography>
                                <Typography variant="body2" fontWeight="bold" sx={{ color: profitColor(totalProfit) }}>{formatYuan(totalProfit)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">平均批零价差</Typography>
                                <Typography variant="body2" sx={{ color: profitColor(totalSpread) }}>{totalSpread.toFixed(2)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">整体毛利率</Typography>
                                <Typography variant="body2" sx={{ color: profitColor(totalMargin) }}>{(totalMargin || 0).toFixed(2)}%</Typography>
                            </Grid>
                        </Grid>
                    </Paper>

                    {/* 客户卡片列表 */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {sortedList.map((c: any, idx: number) => (
                            <Paper key={c.customer_id || idx} variant="outlined" sx={{ p: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <Box
                                            sx={{
                                                width: 24, height: 24, borderRadius: '50%', bgcolor: 'primary.light',
                                                color: 'primary.contrastText', display: 'flex', alignItems: 'center',
                                                justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', mr: 1
                                            }}
                                        >
                                            {idx + 1}
                                        </Box>
                                        <Typography variant="subtitle1" fontWeight="bold">{c.customer_name}</Typography>
                                        {c.is_capped && (
                                            <Typography component="span" variant="caption" sx={{ ml: 1, color: 'error.main', border: '1px solid', borderColor: 'error.main', borderRadius: 1, px: 0.5 }}>
                                                封顶
                                            </Typography>
                                        )}
                                    </Box>
                                    <Button size="small" variant="text" onClick={() => jumpToCustomerDetail(c.customer_id, c.customer_name)} sx={{ minWidth: 'auto', p: 0.5 }}>
                                        详情
                                    </Button>
                                </Box>

                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                                    套餐：{c.package_name || c.pricing_model || '-'}
                                </Typography>

                                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">结算电量</Typography>
                                        <Typography variant="body2">{c.load.toFixed(3)} MWh</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">日毛利</Typography>
                                        <Typography variant="body2" fontWeight="bold" sx={{ color: profitColor(c.profit) }}>{formatYuan(c.profit)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 4 }}>
                                        <Typography variant="caption" color="text.secondary">售电均价</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{c.settledP.toFixed(2)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 4 }}>
                                        <Typography variant="caption" color="text.secondary">批零差价</Typography>
                                        <Typography variant="body2" sx={{ color: profitColor(c.spread), fontWeight: 'bold' }}>{c.spread.toFixed(2)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 4 }}>
                                        <Typography variant="caption" color="text.secondary">毛利率</Typography>
                                        <Typography variant="body2" sx={{ color: profitColor(c.margin) }}>{c.margin.toFixed(2)}%</Typography>
                                    </Grid>
                                </Grid>

                                <Divider sx={{ my: 1, borderStyle: 'dashed' }} />

                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        零售收入: <Box component="span" sx={{ color: 'success.main', fontWeight: 500 }}>{formatYuan(c.fee)}</Box>
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        采购成本: <Box component="span" sx={{ color: 'error.main', fontWeight: 500 }}>{formatYuan(c.cost)}</Box>
                                    </Typography>
                                </Box>
                            </Paper>
                        ))}
                    </Box>
                </Box>
            );
        }

        return (
            <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{
                    '& .MuiTableCell-root': {
                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                        px: { xs: 0.5, sm: 1.5 }, whiteSpace: 'nowrap',
                    },
                }}>
                    <TableHead>
                        <TableRow sx={{ backgroundColor: 'action.hover' }}>
                            {headCells.map((headCell) => (
                                <TableCell
                                    key={headCell.id}
                                    align={headCell.align}
                                    sortDirection={retailOrderBy === headCell.id ? retailOrder : false}
                                >
                                    {headCell.sortable ? (
                                        <TableSortLabel
                                            active={retailOrderBy === headCell.id}
                                            direction={retailOrderBy === headCell.id ? retailOrder : 'asc'}
                                            onClick={() => handleRetailRequestSort(headCell.id)}
                                        >
                                            {headCell.label}
                                        </TableSortLabel>
                                    ) : (
                                        headCell.label
                                    )}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedList.map((c: any, index: number) => {
                            return (
                                <TableRow key={c.customer_id || index} hover>
                                    <TableCell>{index + 1}</TableCell>
                                    <TableCell sx={{ fontWeight: '500' }}>
                                        <Box display="flex" alignItems="center">
                                            {c.customer_name}
                                            {c.is_capped && (
                                                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'error.main', border: '1px solid', borderColor: 'error.main', borderRadius: 1, px: 0.5 }}>
                                                    封顶
                                                </Typography>
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell>{c.package_name || c.pricing_model || '-'}</TableCell>

                                    <TableCell align="right">
                                        {c.load.toFixed(3)}
                                    </TableCell>

                                    <TableCell align="right">{c.buyingPrice.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>{c.settledP.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ color: 'success.main' }}>{formatYuan(c.fee)}</TableCell>
                                    <TableCell align="right" sx={{ color: 'error.main' }}>{formatYuan(c.cost)}</TableCell>

                                    <TableCell align="right" sx={{ color: profitColor(c.profit), fontWeight: 'bold' }}>
                                        {formatYuan(c.profit)}
                                    </TableCell>

                                    <TableCell align="right" sx={{ color: profitColor(c.margin) }}>
                                        {c.margin.toFixed(2)}%
                                    </TableCell>
                                    <TableCell align="right" sx={{ color: profitColor(c.spread) }}>
                                        {c.spread.toFixed(2)}
                                    </TableCell>
                                    <TableCell align="center">
                                        <Button size="small" variant="text" onClick={() => jumpToCustomerDetail(c.customer_id, c.customer_name)}>
                                            查看明细
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {/* 合计行 */}
                        <TableRow sx={{ backgroundColor: 'background.default' }}>
                            <TableCell colSpan={3} align="center" sx={{ fontWeight: 'bold' }}>合计 (均价加权)</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                                {totalLoad.toFixed(3)}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>{totalBuyingPrice.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{totalSettledPrice.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>{formatYuan(totalFee)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: 'error.main' }}>{formatYuan(totalCost)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(totalProfit) }}>
                                {formatYuan(totalProfit)}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(totalMargin) }}>{totalMargin.toFixed(2)}%</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(totalSpread) }}>{totalSpread.toFixed(2)}</TableCell>
                            <TableCell />
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };



    // ====== 时段类型颜色映射 ======
    const PERIOD_TYPE_COLORS: Record<string, string> = {
        '尖峰': '#ff5252', '高峰': '#ff9800', '平段': '#4caf50', '低谷': '#2196f3', '深谷': '#3f51b5'
    };
    const PERIOD_TYPE_SHORT: Record<string, string> = {
        '尖峰': '尖', '高峰': '峰', '平段': '平', '低谷': '谷', '深谷': '深'
    };


    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%', pb: 4 }}>
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
                        结算管理 / 日清结算详情
                    </Typography>
                )}

                {/* 顶部控制面板 */}
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => handleDateChange(date)}
                        disabled={loading}
                        slotProps={{ textField: { sx: { width: { xs: '150px', sm: '200px' } } } }}
                    />
                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>

                    <Box sx={{ flexGrow: 1 }} />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>版本</InputLabel>
                        <Select value={version} label="版本" onChange={handleVersionChange} disabled={loading}>
                            {VERSION_OPTIONS.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button
                        variant="contained"
                        startIcon={<RefreshIcon />}
                        onClick={handleReSettle}
                        disabled={loading || !canRecalculate}
                        color="primary"
                    >
                        重新结算
                    </Button>
                </Paper>

                {/* ====== 结算数据展示区域 ====== */}
                {loading && !data ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity={error.startsWith('暂无') ? 'info' : 'error'} sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                ) : data ? (
                    <Box sx={{ position: 'relative' }}>
                        {(loading || processing) && (
                            <Box sx={{
                                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000,
                            }}>
                                <CircularProgress />
                                {processStatus && (
                                    <Typography variant="body2" sx={{ mt: 2, color: 'primary.main', fontWeight: 'bold' }}>
                                        {processStatus}
                                    </Typography>
                                )}
                            </Box>
                        )}
                        {renderSummaryCards()}

                        {/* 主页签切换：批发 vs 零售 */}
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 3 }}>
                            <Tabs
                                value={activeTabIdx}
                                onChange={(_, val) => setActiveTabIdx(val)}
                            >
                                <Tab label="批发侧结算分析" />
                                <Tab label="零售侧结算分析" />
                            </Tabs>
                        </Box>

                        {/* 批发侧内容 */}
                        {activeTabIdx === 0 && (
                            <Box sx={{ mt: 2 }}>
                                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 1.5 } }}>
                                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ px: 1, pt: 0.5 }}>批发侧盈亏归因分析</Typography>
                                    {renderWholesaleChart()}
                                </Paper>

                                <Paper variant="outlined" sx={{ mt: 2, p: { xs: 1, sm: 2 } }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, px: 1, pt: 1 }}>
                                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>时段结算平衡表</Typography>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            startIcon={exporting ? <CircularProgress size={16} /> : <FileDownloadIcon />}
                                            onClick={handleExportExcel}
                                            disabled={loading || exporting || !data}
                                        >
                                            {exporting ? '导出中...' : '导出 Excel'}
                                        </Button>
                                    </Box>
                                    {renderWholesaleTable()}
                                </Paper>
                            </Box>
                        )}

                        {/* 零售侧内容 */}
                        {activeTabIdx === 1 && (
                            <Box sx={{ mt: 2 }}>
                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 12, lg: 6 }}>
                                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 1.5 }, height: '100%' }}>
                                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ px: 1, pt: 0.5 }}>客户收益多维气泡图</Typography>
                                            {renderRetailBubbleChart()}
                                        </Paper>
                                    </Grid>
                                    <Grid size={{ xs: 12, lg: 6 }}>
                                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 1.5 }, height: '100%' }}>
                                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ px: 1, pt: 0.5 }}>按套餐收益与电量对比图</Typography>
                                            {renderRetailPackageChart()}
                                        </Paper>
                                    </Grid>
                                </Grid>
                                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ px: 1, pt: 1 }}>客户结算明细列表</Typography>
                                    {renderCustomerTable()}
                                </Paper>
                            </Box>
                        )}
                    </Box>
                ) : null}
                <SettlementRecalculateDialog
                    open={reSettleDialogOpen}
                    title={`重新结算选择 (${dateStr})`}
                    options={reSettleOptions}
                    onClose={() => setReSettleDialogOpen(false)}
                    onChange={setReSettleOptions}
                    onConfirm={executeReSettle}
                    disabled={processing || !canRecalculate}
                />
            </Box>
        </LocalizationProvider >
    );
};

export default PreSettlementDetailPage;

