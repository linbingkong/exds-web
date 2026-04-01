import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    Select, MenuItem, FormControl, InputLabel, SelectChangeEvent,
    useMediaQuery, Theme, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Card, CardContent, Divider,
    ToggleButtonGroup, ToggleButton, Button, Dialog, DialogTitle,
    DialogContent, DialogActions, CircularProgress as MUICircularProgress,
    List, ListItem, ListItemText, Typography as MUITypography, alpha
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';
import { useNavigate } from 'react-router-dom';
import { useTabContext } from '../contexts/TabContext';
import { useAuth } from '../contexts/AuthContext';
import PreSettlementDetailPage from './PreSettlementDetailPage';
import Link from '@mui/material/Link';
import SettlementRecalculateDialog, {
    SettlementRecalculateOptions,
} from '../components/settlement/SettlementRecalculateDialog';

// ====== 类型定义 ======
interface DailyDetail {
    date: string;
    volume_mwh: number;
    wholesale_cost: number;
    deviation_recovery_fee: number;
    wholesale_avg_price: number;
    retail_revenue: number;
    retail_avg_price: number;
    price_spread: number;
    daily_profit: number;
    cumulative_profit: number;
}

interface Summary {
    customer_count: number;
    settlement_start: string;
    settlement_end: string;
    total_wholesale_cost: number;
    total_retail_revenue: number;
    total_volume_mwh: number;
    total_deviation_recovery_fee: number;
    wholesale_avg_price: number;
    retail_avg_price: number;
    price_spread: number;
    gross_profit: number;
    profit_margin: number;
}

interface OverviewData {
    month: string;
    version: string;
    summary: Summary;
    daily_details: DailyDetail[];
}

// 版本映射
const VERSION_OPTIONS = [
    { value: 'PLATFORM_DAILY', label: '平台日清数据' },
    { value: 'PRELIMINARY', label: '原始数据计算' },
];

const DEFAULT_RECALCULATE_OPTIONS: SettlementRecalculateOptions = {
    wholesalePreliminary: true,
    wholesalePlatform: false,
    retailDaily: true,
};

const resolveMuiColor = (theme: Theme, color: string): string => {
    if (!color.includes('.')) {
        return color;
    }

    const resolved = color.split('.').reduce<any>((current, key) => {
        if (current && typeof current === 'object' && key in current) {
            return current[key];
        }
        return undefined;
    }, theme.palette);

    return typeof resolved === 'string' ? resolved : color;
};

// 图表视图模式
type ChartViewMode = 'price' | 'amount';

// 图表系列 key
type PriceSeriesKey = 'wholesale_avg_price' | 'retail_avg_price';
type PriceSpreadSeriesKey = 'price_spread' | 'cumulative_avg_spread';
type AmountSeriesKey = 'wholesale_cost_wan' | 'retail_revenue_wan';
type ProfitSeriesKey = 'daily_profit_wan' | 'cumulative_profit_wan';

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
        sx={(theme) => {
            const resolvedCardColor = resolveMuiColor(theme, color);
            const resolvedValueColor = valueColor ? resolveMuiColor(theme, valueColor) : undefined;

            return {
            p: { xs: 1.5, sm: 2 },
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            borderRadius: 2,
            border: '1px solid',
            borderColor: alpha(resolvedCardColor, 0.2),
            background: `linear-gradient(135deg, ${alpha(resolvedCardColor, 0.03)} 0%, ${alpha(resolvedCardColor, 0.07)} 100%)`,
            '& .stat-card-icon': {
                color: resolvedCardColor,
            },
            '& .stat-card-value': {
                color: resolvedValueColor || theme.palette.text.primary,
            },
            };
        }}
    >
        <Box className="stat-card-icon" sx={{ fontSize: { xs: 30, sm: 40 }, mr: { xs: 1, sm: 2 }, display: 'flex', alignItems: 'center' }}>
            {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap>{title}</Typography>
            <Typography
                className="stat-card-value"
                variant="h6" component="div" fontWeight="bold" noWrap
                sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}
            >
                {value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap>{subtitle}</Typography>
            )}
        </Box>
    </Paper>
);

// ====== 工具函数 ======
const formatWanYuan = (val: number): string => `${(val / 10000).toFixed(2)}万`;

const formatYuan = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const profitColor = (val: number): string => val >= 0 ? '#4caf50' : '#f44336';

// ====== 自定义 Tooltip：均价图（含价差） ======
const PriceTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
        <Paper sx={{ p: 1, border: '1px solid #ccc' }}>
            <Typography variant="body2" fontWeight="bold">日期: {label}</Typography>
            <Typography variant="body2" sx={{ color: '#1976d2' }}>
                购电均价: {data.wholesale_avg_price?.toFixed(2)} 元/MWh
            </Typography>
            <Typography variant="body2" sx={{ color: '#4caf50' }}>
                售电均价: {data.retail_avg_price?.toFixed(2)} 元/MWh
            </Typography>
            <Typography variant="body2" sx={{ color: profitColor(data.price_spread), fontWeight: 'bold' }}>
                价差: {data.price_spread > 0 ? '+' : ''}{data.price_spread?.toFixed(2)} 元/MWh
            </Typography>
        </Paper>
    );
};

// ====== 自定义 Tooltip：收益图（含利润） ======
const RevenueTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    const profit = (data.retail_revenue_wan ?? 0) - (data.wholesale_cost_wan ?? 0);
    return (
        <Paper sx={{ p: 1, border: '1px solid #ccc' }}>
            <Typography variant="body2" fontWeight="bold">日期: {label}</Typography>
            <Typography variant="body2" sx={{ color: '#1976d2' }}>
                购电成本: {data.wholesale_cost_wan?.toFixed(2)} 万元
            </Typography>
            <Typography variant="body2" sx={{ color: '#4caf50' }}>
                售电收入: {data.retail_revenue_wan?.toFixed(2)} 万元
            </Typography>
            <Typography variant="body2" sx={{ color: profitColor(profit), fontWeight: 'bold' }}>
                利润: {profit > 0 ? '+' : ''}{profit.toFixed(2)} 万元
            </Typography>
        </Paper>
    );
};

// ====== 主组件 ======
const PreSettlementOverviewPage: React.FC = () => {
    const { hasPermission } = useAuth();
    const canRecalculate = hasPermission('module:settlement_daily_overview:edit') && hasPermission('settlement:recalc:execute');
    const isTablet = useMediaQuery((t: Theme) => t.breakpoints.down('md'));
    const isMobile = useMediaQuery((t: Theme) => t.breakpoints.down('sm'));

    const [selectedMonth, setSelectedMonth] = useState<Date | null>(new Date());
    const [version, setVersion] = useState<string>('PLATFORM_DAILY');
    const [metadata, setMetadata] = useState<any>(null);
    const [hasInitializedVersion, setHasInitializedVersion] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<OverviewData | null>(null);
    const [chartView, setChartView] = useState<ChartViewMode>('price');

    const chartData = React.useMemo(() => {
        if (!selectedMonth || !data) return [];

        const start = startOfMonth(selectedMonth);
        const end = endOfMonth(selectedMonth);
        const days = eachDayOfInterval({ start, end });

        const detailsMap = new Map(data.daily_details.map(d => [d.date, d]));
        const result: any[] = [];
        let lastCumulativeProfit = 0;

        days.forEach((day, idx) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const d = detailsMap.get(dateStr);
            const hasData = d && (d.volume_mwh > 0 || d.wholesale_cost > 0);

            if (d && d.cumulative_profit !== undefined) {
                lastCumulativeProfit = d.cumulative_profit;
            }

            result.push({
                date: dateStr,
                dateLabel: dateStr.substring(5),
                // 基础数据补全：无结算数据时设为 null，以便图表不显示
                volume_mwh: hasData ? (d?.volume_mwh ?? 0) : 0, // 电量内部计算需用0，显示逻辑由均价/金额控制
                wholesale_cost_wan: hasData ? ((d?.wholesale_cost ?? 0) / 10000) : null,
                retail_revenue_wan: hasData ? ((d?.retail_revenue ?? 0) / 10000) : null,
                daily_profit_wan: hasData ? ((d?.daily_profit ?? 0) / 10000) : null,
                // 累计值处理
                cumulative_profit_wan: lastCumulativeProfit / 10000,
                // 均价类字段：无数据时设为 null 以免图表掉落到 0
                wholesale_avg_price: hasData ? d.wholesale_avg_price : null,
                retail_avg_price: hasData ? d.retail_avg_price : null,
                price_spread: hasData ? d.price_spread : null,
            });
        });

        // 计算累计平均价差
        let runningVolume = 0;
        let runningProfit = 0;
        return result.map(item => {
            runningVolume += item.volume_mwh;
            runningProfit += (item.daily_profit_wan * 10000);

            // 如果当天没有数据（未结算），则累计值设为 null，不在图表上显示延长的水平线
            const hasDataAtThisPoint = item.wholesale_avg_price !== null;

            return {
                ...item,
                cumulative_profit_wan: hasDataAtThisPoint ? item.cumulative_profit_wan : null,
                cumulative_avg_spread: (hasDataAtThisPoint && runningVolume > 0)
                    ? parseFloat((runningProfit / runningVolume).toFixed(2))
                    : null
            };
        });
    }, [data, selectedMonth]);

    // 校验状态
    const [validateDialogOpen, setValidateDialogOpen] = useState(false);
    const [validating, setValidating] = useState(false);
    const [validateResult, setValidateResult] = useState<any>(null);
    const [validateError, setValidateError] = useState<string | null>(null);
    const [reSettleDialogOpen, setReSettleDialogOpen] = useState(false);
    const [reSettleOptions, setReSettleOptions] = useState<SettlementRecalculateOptions>(DEFAULT_RECALCULATE_OPTIONS);
    const [reSettling, setReSettling] = useState(false);
    const [reSettleStatus, setReSettleStatus] = useState<string>('');
    const [reSettleProgress, setReSettleProgress] = useState({ current: 0, total: 0, currentDate: '' });
    const reSettleStopRequestedRef = useRef(false);

    const leftChartRef = useRef<HTMLDivElement>(null);
    const rightChartRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const tabContext = useTabContext();

    const monthStr = selectedMonth ? format(selectedMonth, 'yyyy-MM') : '';

    const handleShiftMonth = (offset: number) => {
        if (!selectedMonth) return;
        setSelectedMonth(addMonths(selectedMonth, offset));
        setHasInitializedVersion(false); // 换月份重跑初始化
    };

    const handleVersionChange = (e: SelectChangeEvent) => {
        setVersion(e.target.value);
        setHasInitializedVersion(true); // 锁定手动选择
    };

    // 全屏 — 左图
    const {
        isFullscreen: isLeftFs,
        FullscreenEnterButton: LeftFsEnter,
        FullscreenExitButton: LeftFsExit,
        FullscreenTitle: LeftFsTitle,
        NavigationButtons: LeftNavBtns,
    } = useChartFullscreen({
        chartRef: leftChartRef,
        title: chartView === 'price' ? `购电/售电均价走势 (${monthStr})` : `购电成本/售电收入走势 (${monthStr})`,
        onPrevious: () => handleShiftMonth(-1),
        onNext: () => handleShiftMonth(1),
    });

    // 全屏 — 右图
    const {
        isFullscreen: isRightFs,
        FullscreenEnterButton: RightFsEnter,
        FullscreenExitButton: RightFsExit,
        FullscreenTitle: RightFsTitle,
        NavigationButtons: RightNavBtns,
    } = useChartFullscreen({
        chartRef: rightChartRef,
        title: chartView === 'price' ? `日批零价差走势 (${monthStr})` : `日毛利与累计毛利 (${monthStr})`,
        onPrevious: () => handleShiftMonth(-1),
        onNext: () => handleShiftMonth(1),
    });

    // 曲线选择
    const { seriesVisibility: priceVis, handleLegendClick: onPriceLegend } = useSelectableSeries<PriceSeriesKey>({
        wholesale_avg_price: true, retail_avg_price: true,
    });
    const { seriesVisibility: spreadVis, handleLegendClick: onSpreadLegend } = useSelectableSeries<PriceSpreadSeriesKey>({
        price_spread: true, cumulative_avg_spread: true,
    });
    const { seriesVisibility: amountVis, handleLegendClick: onAmountLegend } = useSelectableSeries<AmountSeriesKey>({
        wholesale_cost_wan: true, retail_revenue_wan: true,
    });
    const { seriesVisibility: profitVis, handleLegendClick: onProfitLegend } = useSelectableSeries<ProfitSeriesKey>({
        daily_profit_wan: true, cumulative_profit_wan: true,
    });

    // 获取元数据并初始化版本
    const fetchMetadataAndInit = useCallback(async () => {
        try {
            const res = await apiClient.get('/api/v1/settlement/metadata');
            if (res.data.code === 200) {
                const meta = res.data.data;
                setMetadata(meta);

                // 智能初始化版本：如果还没手动初始化过
                if (!hasInitializedVersion && selectedMonth) {
                    const monthKey = format(selectedMonth, 'yyyy-MM');
                    const platDate = meta.platform_daily_latest_date || '';
                    const prelDate = meta.preliminary_latest_date || '';

                    // 如果日清最新日期不在当前月或进度明显落后于预结算，且预结算在当前月有数据，则切到预结算
                    if (prelDate.startsWith(monthKey) && (!platDate.startsWith(monthKey) || prelDate > platDate)) {
                        setVersion('PRELIMINARY');
                    }
                    setHasInitializedVersion(true);
                }
            }
        } catch (err) {
            console.error('Failed to fetch metadata', err);
        }
    }, [selectedMonth, hasInitializedVersion]);

    // 数据获取
    const fetchData = useCallback(async () => {
        if (!selectedMonth) return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get('/api/v1/settlement/overview', {
                params: { month: format(selectedMonth, 'yyyy-MM'), version },
            });
            if (res.data.code === 200) {
                setData(res.data.data);
            } else {
                setError(res.data.message || '加载失败');
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '请求失败');
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, version]);

    const handleValidate = async () => {
        if (!selectedMonth) return;
        setValidateDialogOpen(true);
        setValidating(true);
        setValidateResult(null);
        setValidateError(null);
        try {
            const res = await apiClient.get('/api/v1/settlement/validate', {
                params: { month: format(selectedMonth, 'yyyy-MM') },
            });
            if (res.data.code === 200) {
                setValidateResult(res.data.data);
            } else {
                setValidateError(res.data.message || '校验失败');
            }
        } catch (err: any) {
            setValidateError(err.response?.data?.detail || err.message || '请求失败');
        } finally {
            setValidating(false);
        }
    };

    const executeDailyRecalculateTasks = async (targetDate: string) => {
        if (reSettleOptions.wholesalePreliminary) {
            await apiClient.post('/api/v1/settlement/calculate', {
                date: targetDate,
                version: 'PRELIMINARY',
                force: true,
            });
        }

        if (reSettleOptions.wholesalePlatform) {
            await apiClient.post('/api/v1/settlement/calculate', {
                date: targetDate,
                version: 'PLATFORM_DAILY',
                force: true,
            });
        }

        if (reSettleOptions.retailDaily) {
            try {
                const res = await apiClient.post('/api/v1/retail-settlement/calculate', {
                    date: targetDate,
                    force: true,
                    wholesale_version: 'PLATFORM_DAILY',
                });

                // 如果后端返回 code != 200 或执行全失败，则降级
                if (res.data.code !== 200 || (res.data.data && res.data.data.failed > 0 && res.data.data.success === 0)) {
                    await apiClient.post('/api/v1/retail-settlement/calculate', {
                        date: targetDate,
                        force: true,
                        wholesale_version: 'PRELIMINARY',
                    });
                }
            } catch (err: any) {
                // 出现 HTTP 异常也尝试降级兜底
                await apiClient.post('/api/v1/retail-settlement/calculate', {
                    date: targetDate,
                    force: true,
                    wholesale_version: 'PRELIMINARY',
                });
            }
        }
    };

    const handleMonthlyReSettle = async () => {
        if (!canRecalculate) return;
        if (!selectedMonth) return;

        const days = eachDayOfInterval({
            start: startOfMonth(selectedMonth),
            end: endOfMonth(selectedMonth),
        });

        setReSettling(true);
        reSettleStopRequestedRef.current = false;
        setError(null);
        setReSettleProgress({ current: 0, total: days.length, currentDate: '' });

        try {
            for (let index = 0; index < days.length; index += 1) {
                if (reSettleStopRequestedRef.current) {
                    setReSettleStatus(`已中断，停止在第 ${index + 1} 天之前`);
                    break;
                }

                const currentDate = format(days[index], 'yyyy-MM-dd');
                setReSettleProgress({ current: index + 1, total: days.length, currentDate });
                setReSettleStatus(`正在重算日结预结算 ${currentDate} (${index + 1}/${days.length})`);
                await executeDailyRecalculateTasks(currentDate);
            }

            if (reSettleStopRequestedRef.current) {
                setReSettleStatus('已中断执行，正在刷新页面...');
            } else {
                setReSettleStatus('重新结算完成，正在刷新页面...');
            }
            await fetchData();
        } catch (err: any) {
            setError(err.response?.data?.detail || err.response?.data?.message || err.message || '重新结算过程出现错误');
        } finally {
            setReSettling(false);
            reSettleStopRequestedRef.current = false;
        }
    };

    const handleStopMonthlyReSettle = () => {
        reSettleStopRequestedRef.current = true;
        setReSettleStatus('正在等待当前日期执行完成后中断...');
    };

    const navigateToDetail = (date: string) => {
        const path = `/settlement/pre-settlement-detail?date=${date}&version=${version}`;
        if (isMobile) {
            navigate(path);
        } else if (tabContext) {
            tabContext.addTab({
                key: path, // Use full path with params as key for unique tabs per date/version
                title: `结算明细 ${date}`,
                path: path,
                component: <PreSettlementDetailPage initialDate={date} initialVersion={version} />,
            });
        }
    };

    useEffect(() => {
        fetchMetadataAndInit();
    }, [fetchMetadataAndInit]);

    useEffect(() => {
        if (hasInitializedVersion) {
            fetchData();
        }
    }, [fetchData, hasInitializedVersion]);


    // ====== 渲染：汇总卡片 ======
    const renderSummaryCards = () => {
        if (!data) return null;
        const s = data.summary;
        const hasData = s.total_volume_mwh > 0;

        return (
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="购电成本" value={hasData ? `${formatWanYuan(s.total_wholesale_cost)}元` : '-'}
                        subtitle={hasData ? `含偏差回收 ${formatWanYuan(s.total_deviation_recovery_fee)}` : ''}
                        icon={<AccountBalanceWalletOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="售电收入" value={hasData ? `${formatWanYuan(s.total_retail_revenue)}元` : '-'}
                        icon={<MonetizationOnOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="当月毛利" value={hasData ? `${formatWanYuan(s.gross_profit)}元` : '-'}
                        subtitle={hasData ? `利润率 ${(s.profit_margin || 0).toFixed(2)}%` : ''}
                        icon={<TrendingUpOutlinedIcon />}
                        color={hasData ? profitColor(s.gross_profit) : 'text.disabled'} valueColor={hasData ? profitColor(s.gross_profit) : 'text.disabled'} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="购电均价" value={hasData ? `${s.wholesale_avg_price.toFixed(2)}` : '-'}
                        subtitle={hasData ? "元/MWh" : ""} icon={<PriceChangeOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="售电均价" value={hasData ? `${s.retail_avg_price.toFixed(2)}` : '-'}
                        subtitle={hasData ? "元/MWh" : ""} icon={<StorefrontOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="批零价差" value={hasData ? `${s.price_spread > 0 ? '+' : ''}${s.price_spread.toFixed(2)}` : '-'}
                        subtitle={hasData ? "元/MWh" : ""} icon={<CompareArrowsOutlinedIcon />}
                        color={hasData ? profitColor(s.price_spread) : 'text.disabled'} valueColor={hasData ? profitColor(s.price_spread) : 'text.disabled'} />
                </Grid>
            </Grid>
        );
    };

    // ====== 全屏容器样式 ======
    const chartBoxSx = (isFs: boolean) => ({
        height: { xs: 300, sm: 350 },
        position: 'relative' as const,
        backgroundColor: isFs ? 'background.paper' : 'transparent',
        p: isFs ? 2 : 0,
        ...(isFs && { position: 'fixed' as const, top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
        '& .recharts-wrapper:focus': { outline: 'none' },
    });

    // ====== 渲染：左图 ======
    const renderLeftChart = () => {
        if (chartData.length === 0) return null;

        if (chartView === 'price') {
            return (
                <Box ref={leftChartRef} sx={chartBoxSx(isLeftFs)}>
                    <LeftFsEnter /><LeftFsExit /><LeftFsTitle /><LeftNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }}
                                label={{ value: '元/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <Tooltip content={<PriceTooltip />} />
                            <Legend onClick={onPriceLegend} />
                            <Line type="monotone" dataKey="wholesale_avg_price" name="购电均价"
                                stroke="#1976d2" strokeWidth={2} dot={{ r: 3 }} hide={!priceVis.wholesale_avg_price} />
                            <Line type="monotone" dataKey="retail_avg_price" name="售电均价"
                                stroke="#4caf50" strokeWidth={2} dot={{ r: 3 }} hide={!priceVis.retail_avg_price} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        } else {
            return (
                <Box ref={leftChartRef} sx={chartBoxSx(isLeftFs)}>
                    <LeftFsEnter /><LeftFsExit /><LeftFsTitle /><LeftNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }}
                                label={{ value: '万元', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <Tooltip content={<RevenueTooltip />} />
                            <Legend onClick={onAmountLegend} />
                            <Line type="monotone" dataKey="wholesale_cost_wan" name="购电成本"
                                stroke="#1976d2" strokeWidth={2} dot={{ r: 3 }} hide={!amountVis.wholesale_cost_wan} />
                            <Line type="monotone" dataKey="retail_revenue_wan" name="售电收入"
                                stroke="#4caf50" strokeWidth={2} dot={{ r: 3 }} hide={!amountVis.retail_revenue_wan} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        }
    };

    // ====== 渲染：右图 ======
    const renderRightChart = () => {
        if (chartData.length === 0) return null;

        if (chartView === 'price') {
            return (
                <Box ref={rightChartRef} sx={chartBoxSx(isRightFs)}>
                    <RightFsEnter /><RightFsExit /><RightFsTitle /><RightNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }}
                                label={{ value: '元/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }}
                                label={{ value: '累计均价差', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} />
                            <Tooltip formatter={(value: number, name: string) => [`${value.toFixed(2)} 元/MWh`, name]}
                                labelFormatter={(label: string) => `日期: ${label}`} />
                            <Legend onClick={onSpreadLegend} />
                            <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                            <Bar yAxisId="left" dataKey="price_spread" name="日批零价差" hide={!spreadVis.price_spread}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`s-${index}`} fill={entry.price_spread >= 0 ? '#4caf50' : '#f44336'} />
                                ))}
                            </Bar>
                            <Line yAxisId="right" type="monotone" dataKey="cumulative_avg_spread" name="累计均价差"
                                stroke="#ff9800" strokeWidth={2} dot={{ r: 3 }} hide={!spreadVis.cumulative_avg_spread} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        } else {
            return (
                <Box ref={rightChartRef} sx={chartBoxSx(isRightFs)}>
                    <RightFsEnter /><RightFsExit /><RightFsTitle /><RightNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }}
                                label={{ value: '万元', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }}
                                label={{ value: '累计(万元)', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} />
                            <Tooltip formatter={(value: number, name: string) => [`${value.toFixed(2)} 万元`, name]}
                                labelFormatter={(label: string) => `日期: ${label}`} />
                            <Legend onClick={onProfitLegend} />
                            <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                            <Bar yAxisId="left" dataKey="daily_profit_wan" name="日毛利" hide={!profitVis.daily_profit_wan}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`p-${index}`} fill={entry.daily_profit_wan >= 0 ? '#4caf50' : '#f44336'} />
                                ))}
                            </Bar>
                            <Line yAxisId="right" type="monotone" dataKey="cumulative_profit_wan" name="累计毛利"
                                stroke="#ff9800" strokeWidth={2} dot={{ r: 3 }} hide={!profitVis.cumulative_profit_wan} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        }
    };

    const renderMobileCards = () => {
        if (!data) return null;
        const s = data.summary;
        return (
            <Box sx={{ mt: 2, display: { xs: 'block', sm: 'none' } }}>
                {data.daily_details.map((d) => {
                    const hasRowData = d.volume_mwh > 0 || d.wholesale_cost > 0;
                    return (
                        <Card key={d.date} variant="outlined" sx={{ mb: 1.5, borderRadius: 2 }}>
                            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.5 }}>
                                    <Link
                                        component="button"
                                        variant="subtitle2"
                                        onClick={() => navigateToDetail(d.date)}
                                        sx={{ fontWeight: 'bold', textAlign: 'left', textDecoration: 'none' }}
                                    >
                                        {d.date}
                                    </Link>
                                    <Typography variant="body2" sx={{ color: hasRowData ? profitColor(d.daily_profit) : 'text.disabled', fontWeight: 'bold' }}>
                                        {hasRowData ? `利: ${formatYuan(d.daily_profit)}` : '-'}
                                    </Typography>
                                </Box>
                                <Grid container spacing={1}>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">电量 (MWh)</Typography>
                                        <Typography variant="body2">{hasRowData ? d.volume_mwh.toFixed(3) : '-'}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">价差 (元/MWh)</Typography>
                                        <Typography variant="body2" sx={{ color: hasRowData ? profitColor(d.price_spread) : 'text.disabled' }}>
                                            {hasRowData ? `${d.price_spread > 0 ? '+' : ''}${d.price_spread.toFixed(2)}` : '-'}
                                        </Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">批发均价</Typography>
                                        <Typography variant="body2">{hasRowData ? d.wholesale_avg_price.toFixed(2) : '-'}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">零售均价</Typography>
                                        <Typography variant="body2">{hasRowData ? d.retail_avg_price.toFixed(2) : '-'}</Typography>
                                    </Grid>
                                </Grid>
                            </CardContent>
                        </Card>
                    );
                })}
                <Card variant="outlined" sx={{ mb: 2, backgroundColor: 'action.hover', borderRadius: 2 }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.5 }}>
                            <Typography variant="subtitle2" fontWeight="bold">月度累计</Typography>
                            <Typography variant="body2" sx={{ color: profitColor(s.gross_profit), fontWeight: 'bold' }}>
                                利: {formatYuan(s.gross_profit)}
                            </Typography>
                        </Box>
                        <Grid container spacing={1}>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总电量 (MWh)</Typography>
                                <Typography variant="body2">{s.total_volume_mwh.toFixed(3)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">批零价差 (元/MWh)</Typography>
                                <Typography variant="body2" sx={{ color: profitColor(s.price_spread), fontWeight: 'bold' }}>
                                    {s.price_spread > 0 ? '+' : ''}{s.price_spread.toFixed(2)}
                                </Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">购电均价</Typography>
                                <Typography variant="body2">{s.wholesale_avg_price.toFixed(2)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">售电均价</Typography>
                                <Typography variant="body2">{s.retail_avg_price.toFixed(2)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总成本</Typography>
                                <Typography variant="body2">{formatYuan(s.total_wholesale_cost)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总收入</Typography>
                                <Typography variant="body2">{formatYuan(s.total_retail_revenue)}</Typography>
                            </Grid>
                        </Grid>
                    </CardContent>
                </Card>
            </Box>
        );
    };

    const renderDesktopTable = () => {
        if (!data) return null;
        const s = data.summary;
        return (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, overflowX: 'auto' }}>
                <Table size="small" sx={{
                    '& .MuiTableCell-root': {
                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                        px: { xs: 0.5, sm: 1.5 }, whiteSpace: 'nowrap',
                    },
                }}>
                    <TableHead>
                        <TableRow sx={{ backgroundColor: 'action.hover' }}>
                            <TableCell>日期</TableCell>
                            <TableCell align="right">电量(MWh)</TableCell>
                            <TableCell align="right">批发成本(元)</TableCell>
                            <TableCell align="right">偏差回收(元)</TableCell>
                            <TableCell align="right">购电均价</TableCell>
                            <TableCell align="right">零售收入(元)</TableCell>
                            <TableCell align="right">售电均价</TableCell>
                            <TableCell align="right">价差</TableCell>
                            <TableCell align="right">日毛利(元)</TableCell>
                            <TableCell align="right">累计毛利(元)</TableCell>
                            <TableCell align="center">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {data.daily_details.map((d) => {
                            const hasRowData = d.volume_mwh > 0 || d.wholesale_cost > 0;
                            return (
                                <TableRow key={d.date} hover>
                                    <TableCell>
                                        <Link
                                            component="button"
                                            onClick={() => navigateToDetail(d.date)}
                                            sx={{ cursor: 'pointer', textDecoration: 'none' }}
                                        >
                                            {d.date.substring(5)}
                                        </Link>
                                    </TableCell>
                                    <TableCell align="right">{hasRowData ? d.volume_mwh.toFixed(3) : '-'}</TableCell>
                                    <TableCell align="right">{hasRowData ? formatYuan(d.wholesale_cost) : '-'}</TableCell>
                                    <TableCell align="right">{hasRowData ? formatYuan(d.deviation_recovery_fee) : '-'}</TableCell>
                                    <TableCell align="right">{hasRowData ? d.wholesale_avg_price.toFixed(2) : '-'}</TableCell>
                                    <TableCell align="right">{hasRowData ? formatYuan(d.retail_revenue) : '-'}</TableCell>
                                    <TableCell align="right">{hasRowData ? d.retail_avg_price.toFixed(2) : '-'}</TableCell>
                                    <TableCell align="right" sx={{ color: hasRowData ? profitColor(d.price_spread) : 'text.disabled' }}>
                                        {hasRowData ? `${d.price_spread > 0 ? '+' : ''}${d.price_spread.toFixed(2)}` : '-'}
                                    </TableCell>
                                    <TableCell align="right" sx={{ color: hasRowData ? profitColor(d.daily_profit) : 'text.disabled' }}>
                                        {hasRowData ? formatYuan(d.daily_profit) : '-'}
                                    </TableCell>
                                    <TableCell align="right">{hasRowData ? formatYuan(d.cumulative_profit) : '-'}</TableCell>
                                    <TableCell align="center">
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={() => navigateToDetail(d.date)}
                                            sx={{ minWidth: 'auto', py: 0.25 }}
                                        >
                                            查看详情
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        <TableRow sx={{ backgroundColor: 'action.selected', '& .MuiTableCell-root': { fontWeight: 'bold' } }}>
                            <TableCell>月累计</TableCell>
                            <TableCell align="right">{s.total_volume_mwh.toFixed(3)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_wholesale_cost)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_deviation_recovery_fee)}</TableCell>
                            <TableCell align="right">{s.wholesale_avg_price.toFixed(2)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_retail_revenue)}</TableCell>
                            <TableCell align="right">{s.retail_avg_price.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ color: profitColor(s.price_spread) }}>
                                {s.price_spread > 0 ? '+' : ''}{s.price_spread.toFixed(2)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: profitColor(s.gross_profit) }}>
                                {formatYuan(s.gross_profit)}
                            </TableCell>
                            <TableCell align="right">{formatYuan(s.gross_profit)}</TableCell>
                            <TableCell></TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    const renderValidateDialog = () => {
        const r1Errors = validateResult?.rule1_errors || [];
        const r2Errors = validateResult?.rule2_errors || [];
        const hasErrors = r1Errors.length > 0 || r2Errors.length > 0;

        return (
            <Dialog open={validateDialogOpen} onClose={() => setValidateDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>数据校验结果 ({monthStr})</DialogTitle>
                <DialogContent dividers>
                    {validating ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4, flexDirection: 'column', alignItems: 'center' }}>
                            <MUICircularProgress size={40} sx={{ mb: 2 }} />
                            <MUITypography>正在比对平台数据与结算结果...</MUITypography>
                        </Box>
                    ) : validateError ? (
                        <Alert severity="error">{validateError}</Alert>
                    ) : validateResult ? (
                        !hasErrors ? (
                            <Alert severity="success" sx={{ py: 3, '& .MuiAlert-message': { fontSize: '1.1rem' } }}>
                                恭喜！当月平台侧与结算侧数据比对完全一致。
                            </Alert>
                        ) : (
                            <Box>
                                <Alert severity="warning" sx={{ mb: 2 }}>
                                    发现不一致数据，请核查以下日期的结算单：
                                </Alert>

                                {r1Errors.length > 0 && (
                                    <Box sx={{ mb: 3 }}>
                                        <Typography variant="subtitle1" fontWeight="bold" color="error.main" gutterBottom>
                                            规则1：电能量费用异常 (平台每日原始电能量费 vs 结算单确权版总电费)
                                        </Typography>
                                        <TableContainer component={Paper} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                                                        <TableCell>日期</TableCell>
                                                        <TableCell align="right">平台原始电费(元)</TableCell>
                                                        <TableCell align="right">结算单确权电费(元)</TableCell>
                                                        <TableCell align="right">误差绝对值(元)</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {r1Errors.map((e: any) => (
                                                        <TableRow key={e.date}>
                                                            <TableCell>{e.date}</TableCell>
                                                            <TableCell align="right">{e.platform_original_fee.toFixed(2)}</TableCell>
                                                            <TableCell align="right">{e.settlement_fee.toFixed(2)}</TableCell>
                                                            <TableCell align="right" sx={{ color: 'error.main', fontWeight: 'bold' }}>{e.diff.toFixed(2)}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    </Box>
                                )}

                                {r2Errors.length > 0 && (
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="bold" color="error.main" gutterBottom>
                                            规则2：标准值电费异常 (结算单预结算版 vs 结算单确权版)
                                        </Typography>
                                        <TableContainer component={Paper} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                                                        <TableCell>日期</TableCell>
                                                        <TableCell align="right">预结算标准值电费(元)</TableCell>
                                                        <TableCell align="right">确权版标准值电费(元)</TableCell>
                                                        <TableCell align="right">误差绝对值(元)</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {r2Errors.map((e: any) => (
                                                        <TableRow key={e.date}>
                                                            <TableCell>{e.date}</TableCell>
                                                            <TableCell align="right">{e.preliminary_std_cost.toFixed(2)}</TableCell>
                                                            <TableCell align="right">{e.platform_std_cost.toFixed(2)}</TableCell>
                                                            <TableCell align="right" sx={{ color: 'error.main', fontWeight: 'bold' }}>{e.diff.toFixed(2)}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    </Box>
                                )}
                            </Box>
                        )
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setValidateDialogOpen(false)} variant="contained">
                        关闭
                    </Button>
                </DialogActions>
            </Dialog>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}>
                        结算管理 / 日清结算总览
                    </Typography>
                )}

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftMonth(-1)} disabled={loading || reSettling}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="选择月份"
                        value={selectedMonth}
                        onChange={(date) => setSelectedMonth(date)}
                        views={['year', 'month']}
                        minDate={new Date(2026, 0, 1)}
                        disabled={loading || reSettling}
                        slotProps={{ textField: { sx: { width: { xs: '150px', sm: '200px' } } } }}
                    />
                    <IconButton onClick={() => handleShiftMonth(1)} disabled={loading || reSettling}>
                        <ArrowRightIcon />
                    </IconButton>

                    <Box sx={{ flexGrow: 1 }} />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>版本</InputLabel>
                        <Select value={version} label="版本" onChange={handleVersionChange} disabled={loading || reSettling}>
                            {VERSION_OPTIONS.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button
                        variant="contained"
                        startIcon={<RefreshIcon />}
                        onClick={() => {
                            setReSettleStatus('');
                            setReSettleProgress({ current: 0, total: 0, currentDate: '' });
                            if (canRecalculate) setReSettleDialogOpen(true);
                        }}
                        disabled={loading || reSettling || !canRecalculate}
                        sx={{ ml: 1 }}
                    >
                        重新结算
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        onClick={handleValidate}
                        disabled={loading || reSettling}
                        sx={{ ml: 1 }}
                    >
                        数据校验
                    </Button>
                </Paper>

                {loading && !data ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                ) : data ? (
                    <Box sx={{ position: 'relative' }}>
                        {loading && (
                            <Box sx={{
                                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000,
                            }}>
                                <CircularProgress />
                            </Box>
                        )}

                        <Box sx={{ mt: 2 }}>{renderSummaryCards()}</Box>

                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                                <Typography variant="h6">
                                    {chartView === 'price' ? '价格走势' : '收益走势'}
                                </Typography>
                                <ToggleButtonGroup
                                    value={chartView}
                                    exclusive
                                    onChange={(_, val) => val && setChartView(val)}
                                    size="small"
                                >
                                    <ToggleButton value="price">价格</ToggleButton>
                                    <ToggleButton value="amount">收益</ToggleButton>
                                </ToggleButtonGroup>
                            </Box>
                            <Grid container spacing={{ xs: 1, sm: 2 }}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    {renderLeftChart()}
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    {renderRightChart()}
                                </Grid>
                            </Grid>
                        </Paper>

                        {isMobile && <Typography variant="h6" sx={{ mt: 2 }}>日度明细</Typography>}
                        {isMobile ? renderMobileCards() : renderDesktopTable()}
                        {renderValidateDialog()}
                    </Box>
                ) : null}
                <SettlementRecalculateDialog
                    open={reSettleDialogOpen}
                    title={`重新结算选择 (${monthStr})`}
                    options={reSettleOptions}
                    onClose={() => {
                        if (!reSettling) {
                            setReSettleDialogOpen(false);
                            setReSettleStatus('');
                            setReSettleProgress({ current: 0, total: 0, currentDate: '' });
                        }
                    }}
                    onChange={setReSettleOptions}
                    onConfirm={handleMonthlyReSettle}
                    disabled={reSettling || !canRecalculate}
                    processing={reSettling}
                    progress={reSettleProgress}
                    statusText={reSettleStatus}
                    onStop={handleStopMonthlyReSettle}
                />
            </Box>
        </LocalizationProvider>
    );
};

export default PreSettlementOverviewPage;

