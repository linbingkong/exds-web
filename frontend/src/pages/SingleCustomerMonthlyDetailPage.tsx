import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    Button, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Tooltip as MuiTooltip, Tabs, Tab,
    useTheme, useMediaQuery
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { format, addMonths, parse, addDays } from 'date-fns';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

// ====== 图标组件导入 ======
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';

import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell
} from 'recharts';

// ====== StatCard ======
const StatCard: React.FC<{
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color?: string;
    valueColor?: string;
}> = ({ title, value, subtitle, icon, color = 'primary.main', valueColor }) => (
    <Paper sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', alignItems: 'center', height: '100%' }} elevation={2}>
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
const formatMwh = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatPrice = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const profitColor = (val: number): string => val >= 0 ? '#4caf50' : '#f44336';

// ====== 时段类型颜色映射 ======
const PERIOD_TYPE_COLORS: Record<string, string> = {
    '尖峰': '#ff5252', '高峰': '#ff9800', '平段': '#4caf50', '低谷': '#2196f3', '深谷': '#3f51b5'
};
const PERIOD_TYPE_SHORT: Record<string, string> = {
    '尖峰': '尖', '高峰': '峰', '平段': '平', '低谷': '谷', '深谷': '深'
};

// ====== 阶段颜色 ======
const STAGE_COLORS = {
    pre: '#1976d2',        // 调平前 - 蓝
    balancing: '#ef6c00',  // 调平 - 橙
    post: '#2e7d32',       // 调平后 - 绿
    refund: '#d32f2f',     // 超额返还 - 红
    final: '#7b1fa2',      // 最终 - 紫
};

const SingleCustomerMonthlyDetailPage: React.FC<{
    initialMonth?: string;
    initialCustomerId?: string;
    initialCustomerName?: string;
}> = ({ initialMonth, initialCustomerId, initialCustomerName }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [searchParams] = useSearchParams();

    // Tab 嵌入模式：用 props；路由模式：用 searchParams
    const resolvedMonth = initialMonth || searchParams.get('month') || format(addMonths(new Date(), -1), 'yyyy-MM');
    const resolvedCustomerId = initialCustomerId || searchParams.get('customer_id') || '';
    const resolvedCustomerName = initialCustomerName || searchParams.get('customer_name') || '';

    const [monthStr, setMonthStr] = useState(resolvedMonth);
    const [loading, setLoading] = useState(false);
    const [loadingDaily, setLoadingDaily] = useState(false);
    const [data, setData] = useState<any>(null);
    const [dailyData, setDailyData] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [tabValue, setTabValue] = useState(0);

    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef: chartRef,
        title: `电量与价格时段分布图 (${monthStr})`
    });

    const fetchData = async (month: string, customerId: string, customerName: string) => {
        if (!customerId && !customerName) return;

        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get('/api/v1/retail-settlement/monthly-customer-detail', {
                params: {
                    month,
                    ...(customerId ? { customer_id: customerId } : {}),
                    ...(customerName ? { customer_name: customerName } : {}),
                }
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
    };

    useEffect(() => {
        if (resolvedCustomerId || resolvedCustomerName) {
            fetchData(monthStr, resolvedCustomerId, resolvedCustomerName);
        }
    }, [monthStr, resolvedCustomerId, resolvedCustomerName]);

    useEffect(() => {
        if ((resolvedCustomerId || resolvedCustomerName) && data?.customer_id) {
            // 获取日结算数据 (月结口径)
            setLoadingDaily(true);
            const d = parse(monthStr, 'yyyy-MM', new Date());
            const startDate = format(d, 'yyyy-MM-01');
            const nextMonth = addMonths(d, 1);
            const endDate = format(addDays(nextMonth, -1), 'yyyy-MM-dd');

            apiClient.get('/api/v1/retail-settlement/daily', {
                params: {
                    start_date: startDate,
                    end_date: endDate,
                    customer_id: data.customer_id,
                    settlement_type: 'monthly'
                }
            }).then(res => {
                if (res.data.code === 200) {
                    setDailyData(res.data.data);
                }
            }).catch(console.error)
                .finally(() => setLoadingDaily(false));
        } else {
            setDailyData([]);
        }
    }, [monthStr, data?.customer_id, resolvedCustomerId, resolvedCustomerName]);

    const handleShiftMonth = (months: number) => {
        const d = parse(monthStr, 'yyyy-MM', new Date());
        setMonthStr(format(addMonths(d, months), 'yyyy-MM'));
    };

    // ====== 定价模型标签 ======
    const modelLabels: Record<string, string> = {
        'price_spread_simple_price_time': '价差分成-分时',
        'price_spread_simple_price_non_time': '价差分成-非分时',
        'fixed_linked_price_time': '固定价联动-分时',
        'fixed_linked_price_non_time': '固定价联动-非分时',
        'reference_linked_price_time': '参考价联动-分时',
        'reference_linked_price_non_time': '参考价联动-非分时',
        'single_comprehensive_fixed_time': '单一综合价-固定-分时',
        'single_comprehensive_reference_time': '单一综合价-参考-分时',
    };

    // 计算封顶前名义价格（必须在 early return 之前）
    const nominalPrices = React.useMemo(() => {
        if (!data) return {};
        const pm = data.price_model || {};
        const isCapped = pm.is_capped || false;
        const capPrice = pm.cap_price || 0;
        const nominalAvgPrice = pm.nominal_avg_price || 0;
        const fp = pm.final_prices || {};

        if (!isCapped || !capPrice || !nominalAvgPrice) return fp;
        const k = capPrice / nominalAvgPrice;
        if (Math.abs(k - 1) < 1e-4) return fp;
        const result: Record<string, number> = {};
        Object.keys(fp).forEach(key => {
            result[key] = (fp[key] || 0) / k;
        });
        return result;
    }, [data]);

    if (loading && !data) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>;
    if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
    if (!resolvedCustomerId && !resolvedCustomerName) return <Alert severity="info" sx={{ m: 2 }}>无客户信息</Alert>;
    if (!data) return <Alert severity="info" sx={{ m: 2 }}>暂无数据</Alert>;

    const cd = data;
    const pm = cd.price_model || {};
    const pricingConfig = cd.pricing_config || {};
    const linkedCfg = pm.linked_config || null;
    const finalPrices = pm.final_prices || {};

    // 提取核心指标（最终阶段）
    const finalEnergy = cd.final_energy_mwh || 0;
    const finalRetailFee = cd.final_retail_fee || 0;
    const finalWholesaleFee = cd.final_wholesale_fee || 0;
    const finalGrossProfit = cd.final_gross_profit || 0;
    const finalRetailUnitPrice = cd.final_retail_unit_price || 0;
    const finalWholesaleUnitPrice = cd.final_wholesale_unit_price || 0;
    const finalPriceSpread = cd.final_price_spread_per_mwh || 0;
    const profitMargin = finalRetailFee !== 0 ? (finalGrossProfit / finalRetailFee) * 100 : 0;

    // 图表数据
    const chartData = (cd.period_details || []).map((p: any) => ({
        period: p.period,
        periodType: p.period_type || '',
        load: p.load_mwh || 0,
        unitPrice: (p.unit_price || 0) * 1000, // 转换为元/MWh
        wholesalePrice: p.wholesale_price || 0,
        fee: p.fee || 0,
        allocatedCost: p.allocated_cost || 0,
    }));

    // ====== 带颜色竖条的信息卡片 ======
    const renderInfoCard = (title: string, children: React.ReactNode, borderColor: string = 'primary.main') => (
        <Box
            sx={{
                bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200',
                borderRadius: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.02)', mb: 0.8,
                borderLeft: `4px solid`, borderLeftColor: borderColor,
                minHeight: '100px',
                display: 'flex', flexDirection: 'column'
            }}
        >
            <Box sx={{ p: '2px 8px', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.75rem', display: 'block', mb: 0.1 }}>{title}</Typography>
                {children}
            </Box>
        </Box>
    );

    // ====== 分时价格网格 ======
    const PriceGrid = ({ prices, colors }: { prices: Record<string, number>, colors?: Record<string, string> }) => (
        <Grid container spacing={0.5} sx={{ mt: 0 }}>
            {['尖峰', '高峰', '平段', '低谷', '深谷'].map(item => {
                const key = ({ '尖峰': 'tip', '高峰': 'peak', '平段': 'flat', '低谷': 'valley', '深谷': 'deep' } as any)[item];
                const val = prices[key];
                return (
                    <Grid key={item} size={2.4}>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: colors?.[item] || PERIOD_TYPE_COLORS[item], fontWeight: 'bold', display: 'block', lineHeight: 1 }}>{PERIOD_TYPE_SHORT[item]}</Typography>
                            <Typography variant="caption" sx={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.1 }}>{((val || 0) * 1000).toFixed(2)}</Typography>
                        </Box>
                    </Grid>
                );
            })}
        </Grid>
    );

    // ====== 阶段指标行 ======
    const StageRow = ({ label, value, unit, bold }: { label: string, value: number, unit?: string, bold?: boolean }) => (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.15 }}>
            <Typography variant="caption" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{label}</Typography>
            <Typography variant="caption" sx={{ fontSize: '0.8rem', fontWeight: bold ? 700 : 500 }}>
                {unit === 'MWh' ? formatMwh(value) : unit === '元/MWh' ? formatPrice(value) : formatYuan(value)}
                {unit && <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled', ml: 0.3 }}>{unit}</Box>}
            </Typography>
        </Box>
    );

    // 联动配置
    const refPrice = pm.reference_price || null;
    const linkedTargetLabel: Record<string, string> = {
        'real_time_avg': '实时市场均价',
        'day_ahead_avg': '日前市场均价',
        'grid_agency_price': '电网代理购电价',
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
                        结算管理 / 单客户月度结算详情
                    </Typography>
                )}
                {/* 顶部控制栏 */}
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <IconButton size="small" onClick={() => handleShiftMonth(-1)} disabled={loading}><ArrowLeftIcon /></IconButton>
                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{monthStr}</Typography>
                            <IconButton size="small" onClick={() => handleShiftMonth(1)} disabled={loading}><ArrowRightIcon /></IconButton>
                        </Box>
                        <Box sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            alignItems: { xs: 'flex-start', sm: 'center' },
                            gap: { xs: 0.5, sm: 1 },
                            ml: { xs: 0.5, sm: 1 }
                        }}>
                            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                                {cd.customer_name || resolvedCustomerName || resolvedCustomerId}
                            </Typography>
                            {cd.package_name && (
                                <Box sx={{
                                    px: 0.8,
                                    py: 0.1,
                                    bgcolor: 'primary.50',
                                    color: 'primary.dark',
                                    border: '1px solid',
                                    borderColor: 'primary.100',
                                    borderRadius: 0.5,
                                    fontSize: '10px',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {cd.package_name}
                                </Box>
                            )}
                        </Box>
                    </Box>
                    <Button size="small" startIcon={<RefreshIcon />} onClick={() => fetchData(monthStr, resolvedCustomerId, resolvedCustomerName)} disabled={loading}>刷新</Button>
                </Paper>

                {/* 第一层：6 个 Summary Cards */}
                <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="月总电量 (MWh)" value={`${formatMwh(finalEnergy)}`}
                            icon={<BarChartOutlinedIcon />} color="#1976d2" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="零售电费 (元)" value={`${formatYuan(finalRetailFee)}`}
                            icon={<MonetizationOnOutlinedIcon />} color="#2e7d32" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="采购成本 (元)" value={`${formatYuan(finalWholesaleFee)}`}
                            icon={<AccountBalanceWalletOutlinedIcon />} color="#ef6c00" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="月毛利 (元)" value={`${formatYuan(finalGrossProfit)}`}
                            subtitle={`利润率 ${profitMargin.toFixed(2)}%`}
                            icon={<TrendingUpOutlinedIcon />}
                            color={profitColor(finalGrossProfit)} valueColor={profitColor(finalGrossProfit)} />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="零售单价 (元/MWh)" value={`${formatPrice(finalRetailUnitPrice)}`}
                            icon={<PriceChangeOutlinedIcon />} color="#1565c0" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="价差 (元/MWh)" value={`${formatPrice(finalPriceSpread)}`}
                            subtitle={`采购均价 ${formatPrice(finalWholesaleUnitPrice)}`}
                            icon={<CompareArrowsOutlinedIcon />}
                            color="#7b1fa2" />
                    </Grid>
                </Grid>

                {/* 第二层 */}
                <Grid container spacing={{ xs: 1, sm: 2 }}>
                    {/* 左侧：结算基准 */}
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">结算基准</Typography>
                            </Box>

                            {/* 区域一：零售套餐详情 */}
                            {renderInfoCard('零售套餐', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mr: 1 }}>{cd.package_name || '-'}</Typography>
                                        <Box sx={{ px: 0.8, py: 0.1, bgcolor: 'primary.50', color: 'primary.dark', border: '1px solid', borderColor: 'primary.100', borderRadius: 0.5, fontSize: '10px', whiteSpace: 'nowrap' }}>
                                            {modelLabels[cd.model_code] || cd.model_code || '-'}
                                        </Box>
                                    </Box>

                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center', mb: 0.1 }}>
                                        {cd.model_code?.startsWith('price_spread') ? (
                                            <>
                                                {refPrice && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        基准: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{((refPrice.base_value || 0) * 1000).toFixed(2)}</Box>
                                                    </Typography>
                                                )}
                                                {pricingConfig.sharing_ratio !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        分成: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{pricingConfig.sharing_ratio}%</Box>
                                                    </Typography>
                                                )}
                                                {pricingConfig.agreed_price_spread !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        价差: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(parseFloat(pricingConfig.agreed_price_spread) * 1000).toFixed(1)}</Box>
                                                    </Typography>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                {pricingConfig.linked_ratio !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        比例: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{pricingConfig.linked_ratio || pricingConfig.ratio || 0}%</Box>
                                                    </Typography>
                                                )}
                                                {(pricingConfig.linked_target || linkedCfg?.target) && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        标的: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                                                            {linkedTargetLabel[pricingConfig.linked_target || linkedCfg?.target] || pricingConfig.linked_target || linkedCfg?.target || '-'}
                                                        </Box>
                                                    </Typography>
                                                )}
                                            </>
                                        )}
                                        {(pricingConfig.floating_price !== undefined || pricingConfig.floating_fee !== undefined) && (
                                            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                浮动: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                                                    {((parseFloat(pricingConfig.floating_price || 0) + parseFloat(pricingConfig.floating_fee || 0)) * 1000).toFixed(1)}
                                                </Box>
                                            </Typography>
                                        )}
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    <Box>
                                        {cd.model_code?.startsWith('price_spread') ? (
                                            <PriceGrid prices={(() => {
                                                const base = (refPrice?.base_value || 0);
                                                return {
                                                    tip: base * 1.8,
                                                    peak: base * 1.6,
                                                    flat: base * 1.0,
                                                    valley: base * 0.4,
                                                    deep: base * 0.3
                                                };
                                            })()} />
                                        ) : (
                                            <PriceGrid prices={pm.fixed_prices || {}} />
                                        )}
                                    </Box>
                                </Box>
                            ), 'primary.main')}

                            {/* 区域二：结算价格与比例校核 */}
                            {renderInfoCard('结算价格与比例校核', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.1 }}>
                                        <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>校核状态:</Typography>
                                        {pm.price_ratio_adjusted ? (
                                            <Box sx={{ px: 0.6, py: 0.1, bgcolor: 'warning.50', color: 'warning.dark', borderRadius: 0.5, border: '1px solid', borderColor: 'warning.100', fontSize: '12px', fontWeight: 'bold' }}>
                                                比例调节已应用
                                            </Box>
                                        ) : (
                                            <Typography variant="caption" sx={{ fontSize: '12px', color: 'success.main', fontWeight: 'bold' }}>正常</Typography>
                                        )}
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    <Box>
                                        <PriceGrid prices={nominalPrices} />
                                    </Box>
                                </Box>
                            ), 'warning.main')}

                            {/* 区域三：封顶校核与结算价格 */}
                            {renderInfoCard('封顶校核与结算价格', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography variant="caption" sx={{ fontSize: '12px', fontWeight: 'bold', color: pm.is_capped ? 'error.main' : 'success.main' }}>
                                                {pm.is_capped ? '封顶已触发' : '未触发'}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                                名义: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{((pm.nominal_avg_price || 0) * 1000).toFixed(2)}</Box>
                                            </Typography>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                                基准: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{((pm.cap_price || 0) * 1000).toFixed(2)}</Box>
                                            </Typography>
                                        </Box>
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    <Box>
                                        <PriceGrid prices={finalPrices} />
                                    </Box>
                                </Box>
                            ), 'error.main')}
                        </Paper>
                    </Grid>

                    {/* 右侧：月度结算阶段面板 */}
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: 4, height: 16, bgcolor: STAGE_COLORS.final, borderRadius: 1, mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">月度结算阶段</Typography>
                            </Box>

                            {/* ===== 三排布局容器，flex 撑满高度 ===== */}
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1 }}>

                                {/* 第一排：原始结算 + 调平电费 */}
                                <Grid container spacing={1} sx={{ flexGrow: 1 }}>
                                    {/* 左：阶段一原始数据结算 */}
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box sx={{
                                            height: '100%', bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200',
                                            borderRadius: 1, borderLeft: `4px solid ${STAGE_COLORS.pre}`,
                                            p: '6px 10px', display: 'flex', flexDirection: 'column'
                                        }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: STAGE_COLORS.pre, display: 'block', mb: 0.5 }}>
                                                阶段一：48时段数据结算
                                            </Typography>
                                            <StageRow label="结算电量" value={cd.pre_energy_mwh || 0} unit="MWh" />
                                            <StageRow label="结算单价" value={cd.pre_retail_unit_price || 0} unit="元/MWh" />
                                            <StageRow label="结算电费" value={cd.pre_retail_fee || 0} unit="元" bold />
                                        </Box>
                                    </Grid>
                                    {/* 右：调平电费 */}
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box sx={{
                                            height: '100%', bgcolor: '#fff9f0', border: '1px solid', borderColor: '#ffe0b2',
                                            borderRadius: 1, borderLeft: `4px solid ${STAGE_COLORS.balancing}`,
                                            p: '6px 10px', display: 'flex', flexDirection: 'column'
                                        }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: STAGE_COLORS.balancing, display: 'block', mb: 0.5 }}>
                                                调平电费
                                            </Typography>
                                            <StageRow label="调平电量" value={cd.sttl_balancing_energy_mwh || 0} unit="MWh" />
                                            <StageRow label="调平单价" value={
                                                ((cd.sttl_balancing_energy_mwh || 0) !== 0)
                                                    ? ((cd.sttl_balancing_retail_fee || 0) / (cd.sttl_balancing_energy_mwh || 1))
                                                    : 0
                                            } unit="元/MWh" />
                                            <StageRow label="调平电费" value={cd.sttl_balancing_retail_fee || 0} unit="元" bold />
                                        </Box>
                                    </Grid>
                                </Grid>

                                {/* 第二排：调平后结算 + 返还金额 */}
                                <Grid container spacing={1} sx={{ flexGrow: 1 }}>
                                    {/* 左：阶段二调平后结算 */}
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box sx={{
                                            height: '100%', bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200',
                                            borderRadius: 1, borderLeft: `4px solid ${STAGE_COLORS.post}`,
                                            p: '6px 10px', display: 'flex', flexDirection: 'column'
                                        }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: STAGE_COLORS.post, display: 'block', mb: 0.5 }}>
                                                阶段二：申报数据结算
                                            </Typography>
                                            <StageRow label="结算电量" value={cd.sttl_energy_mwh || 0} unit="MWh" />
                                            <StageRow label="结算单价" value={cd.sttl_retail_unit_price || 0} unit="元/MWh" />
                                            <StageRow label="结算电费" value={cd.sttl_retail_fee || 0} unit="元" bold />
                                        </Box>
                                    </Grid>
                                    {/* 右：返还金额 */}
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box sx={{
                                            height: '100%', bgcolor: '#fff5f5', border: '1px solid', borderColor: '#ffcdd2',
                                            borderRadius: 1, borderLeft: `4px solid ${STAGE_COLORS.refund}`,
                                            p: '6px 10px', display: 'flex', flexDirection: 'column'
                                        }}>
                                            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: STAGE_COLORS.refund, display: 'block', mb: 0.5 }}>
                                                返还金额
                                            </Typography>
                                            <StageRow label="结算电量" value={cd.sttl_energy_mwh || 0} unit="MWh" />
                                            <StageRow label="返还单价" value={
                                                ((cd.sttl_energy_mwh || 0) !== 0)
                                                    ? ((cd.final_excess_refund_fee || 0) / (cd.sttl_energy_mwh || 1))
                                                    : 0
                                            } unit="元/MWh" />
                                            <StageRow label="返还金额" value={cd.final_excess_refund_fee || 0} unit="元" bold />
                                        </Box>
                                    </Grid>
                                </Grid>

                                {/* 第三排：最终结算（全宽高亮） */}
                                <Box sx={{
                                    bgcolor: '#f3e5f5', border: '1px solid', borderColor: '#ce93d8',
                                    borderRadius: 1, borderLeft: `4px solid ${STAGE_COLORS.final}`,
                                    p: '6px 10px', flexGrow: 1, display: 'flex', flexDirection: 'column'
                                }}>
                                    <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.85rem', color: STAGE_COLORS.final, display: 'block', mb: 0.8 }}>
                                        ★ 阶段三：最终结算
                                    </Typography>
                                    <Grid container spacing={0.5}>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>结算电量</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatMwh(finalEnergy)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>MWh</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>零售单价</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#2e7d32' }}>{formatPrice(finalRetailUnitPrice)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元/MWh</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>零售电费</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#2e7d32' }}>{formatYuan(finalRetailFee)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>采购单价</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#1565c0' }}>{formatPrice(finalWholesaleUnitPrice)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元/MWh</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>采购金额</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#1565c0' }}>{formatYuan(finalWholesaleFee)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>月毛利</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '0.95rem', color: profitColor(finalGrossProfit) }}>{formatYuan(finalGrossProfit)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>价差</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '0.95rem', color: profitColor(finalPriceSpread) }}>{formatPrice(finalPriceSpread)} <Box component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>元/MWh</Box></Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary', display: 'block' }}>利润率</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '0.95rem', color: profitColor(profitMargin) }}>{profitMargin.toFixed(2)}%</Typography>
                                        </Grid>
                                    </Grid>
                                </Box>

                            </Box>{/* end 三排容器 */}
                        </Paper>
                    </Grid>
                </Grid>

                {/* 第三层：48 时段明细与图表 Tab 面板 */}
                <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 3 }, flexWrap: 'wrap' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">48 时段结算明细</Typography>
                            </Box>
                            <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} aria-label="settlement details tabs" sx={{ minHeight: 'unset' }}>
                                <Tab label="图表分析" id="tab-0" sx={{ minHeight: 'unset', py: 0.5, fontSize: '0.875rem' }} />
                                <Tab label="数据明细" id="tab-1" sx={{ minHeight: 'unset', py: 0.5, fontSize: '0.875rem' }} />
                            </Tabs>
                        </Box>
                        {tabValue === 0 && <FullscreenEnterButton />}
                    </Box>

                    <Box sx={{
                        height: { xs: 350, sm: 400 },
                        position: 'relative',
                        display: tabValue === 0 ? 'block' : 'none'
                    }}>
                        <Box ref={chartRef} sx={{
                            height: '100%', width: '100%',
                            position: 'relative',
                            bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                            p: isFullscreen ? 2 : 0,
                            ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                            '& .recharts-wrapper:focus': { outline: 'none' }
                        }}>
                            <FullscreenExitButton /><FullscreenTitle />
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={isFullscreen ? 1 : 3} />
                                    <YAxis yAxisId="left" label={{ value: '电量 (MWh)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                    <YAxis yAxisId="right" orientation="right" label={{ value: '价格 (元/MWh)', angle: 90, position: 'insideRight', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                    <Tooltip content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <Paper sx={{ p: 1, border: '1px solid', borderColor: 'grey.300', boxShadow: 3 }}>
                                                    <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>时段: {label}</Typography>
                                                    {payload.map((entry: any, idx: number) => (
                                                        <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                                            <Typography variant="caption" sx={{ color: entry.color }}>{entry.name}:</Typography>
                                                            <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                                                {entry.dataKey === 'load' ? entry.value.toFixed(3) : entry.value.toFixed(2)}
                                                            </Typography>
                                                        </Box>
                                                    ))}
                                                </Paper>
                                            );
                                        }
                                        return null;
                                    }} />
                                    <Legend />
                                    <Bar yAxisId="left" dataKey="load" name="月累计电量" barSize={20}>
                                        {chartData.map((entry: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={(PERIOD_TYPE_COLORS[entry.periodType] || '#ccc') + '88'} />
                                        ))}
                                    </Bar>
                                    <Line yAxisId="right" type="monotone" dataKey="unitPrice" name="零售单价" stroke="#2e7d32" strokeWidth={2} dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="wholesalePrice" name="批发均价" stroke="#1565c0" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Box>
                    </Box>

                    <Box sx={{
                        height: { xs: 350, sm: 400 },
                        overflowY: 'auto',
                        display: tabValue === 1 ? 'block' : 'none',
                        p: isMobile ? 1 : 0
                    }}>
                        {isMobile ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {chartData.map((p: any) => (
                                    <Paper key={p.period} variant="outlined" sx={{ p: 1.5, borderColor: 'divider' }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                            <Typography variant="subtitle2" fontWeight="bold">时段: {p.period}</Typography>
                                            {p.periodType !== 'period_type_mix' ? (
                                                <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: (PERIOD_TYPE_COLORS[p.periodType] || '#ccc') + '22', color: PERIOD_TYPE_COLORS[p.periodType] || '#999', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                                    {p.periodType}
                                                </Box>
                                            ) : (
                                                <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: '#f5f5f5', color: '#666', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                                    混合
                                                </Box>
                                            )}
                                        </Box>
                                        <Divider sx={{ mb: 1 }} />
                                        <Grid container spacing={1}>
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">电量 (MWh)</Typography>
                                                <Typography variant="body2" fontWeight="bold">{p.load.toFixed(3)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">零售单价 (元/MWh)</Typography>
                                                <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{p.unitPrice.toFixed(2)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">零售电费 (元)</Typography>
                                                <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{p.fee.toFixed(2)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">批发均价 (元/MWh)</Typography>
                                                <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{p.wholesalePrice.toFixed(2)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">采购金额 (元)</Typography>
                                                <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{p.allocatedCost.toFixed(2)}</Typography>
                                            </Grid>
                                        </Grid>
                                    </Paper>
                                ))}
                            </Box>
                        ) : (
                            <TableContainer sx={{ height: '100%' }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>时段</TableCell>
                                            <TableCell>类型</TableCell>
                                            <TableCell align="right">电量(MWh)</TableCell>
                                            <TableCell align="right" sx={{ color: 'success.dark' }}>零售单价<br />(元/MWh)</TableCell>
                                            <TableCell align="right" sx={{ color: 'success.dark' }}>零售电费(元)</TableCell>
                                            <TableCell align="right" sx={{ color: 'primary.dark' }}>批发均价<br />(元/MWh)</TableCell>
                                            <TableCell align="right" sx={{ color: 'primary.dark' }}>采购金额(元)</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {chartData.map((p: any) => (
                                            <TableRow key={p.period} hover>
                                                <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}>{p.period}</TableCell>
                                                <TableCell>
                                                    {p.periodType !== 'period_type_mix' ? (
                                                        <Box sx={{ px: 1, borderRadius: 1, bgcolor: (PERIOD_TYPE_COLORS[p.periodType] || '#ccc') + '22', color: PERIOD_TYPE_COLORS[p.periodType] || '#999', fontSize: '0.75rem', textAlign: 'center' }}>
                                                            {p.periodType}
                                                        </Box>
                                                    ) : (
                                                        <MuiTooltip title="当月该时段存在多种峰谷类型" arrow>
                                                            <Box sx={{ px: 1, borderRadius: 1, bgcolor: '#f5f5f5', color: '#666', fontSize: '0.75rem', textAlign: 'center', cursor: 'help' }}>
                                                                混合
                                                            </Box>
                                                        </MuiTooltip>
                                                    )}
                                                </TableCell>
                                                <TableCell align="right">{p.load.toFixed(3)}</TableCell>
                                                <TableCell align="right">{p.unitPrice.toFixed(3)}</TableCell>
                                                <TableCell align="right">{p.fee.toFixed(2)}</TableCell>
                                                <TableCell align="right">{p.wholesalePrice.toFixed(3)}</TableCell>
                                                <TableCell align="right">{p.allocatedCost.toFixed(2)}</TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow sx={{ bgcolor: 'grey.100', '& .MuiTableCell-root': { fontWeight: 'bold' }, position: 'sticky', bottom: 0, zIndex: 2 }}>
                                            <TableCell align="right">合计</TableCell>
                                            <TableCell>-</TableCell>
                                            <TableCell align="right">{chartData.reduce((s: number, p: any) => s + p.load, 0).toFixed(3)}</TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalLoad = chartData.reduce((s: number, p: any) => s + p.load, 0);
                                                    const totalFee = chartData.reduce((s: number, p: any) => s + p.fee, 0);
                                                    return totalLoad > 0 ? (totalFee / totalLoad).toFixed(3) : '0.000';
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">{formatYuan(chartData.reduce((s: number, p: any) => s + p.fee, 0))}</TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalLoad = chartData.reduce((s: number, p: any) => s + p.load, 0);
                                                    const totalCost = chartData.reduce((s: number, p: any) => s + p.allocatedCost, 0);
                                                    return totalLoad > 0 ? (totalCost / totalLoad).toFixed(3) : '0.000';
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">{formatYuan(chartData.reduce((s: number, p: any) => s + p.allocatedCost, 0))}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Box>
                </Paper>

                {/* 第四层：每日结算数据明细 */}
                <Paper variant="outlined" sx={{ mt: 2, p: 2, position: 'relative' }}>
                    {loadingDaily && (
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: 'rgba(255, 255, 255, 0.6)', zIndex: 10, borderRadius: 1
                        }}>
                            <CircularProgress size={24} />
                        </Box>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                        <Typography variant="subtitle1" fontWeight="bold">月度日度结算明细 (月结口径)</Typography>
                    </Box>

                    <TableContainer sx={{ maxHeight: 500 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ bgcolor: 'background.paper', zIndex: 3 }}>日期</TableCell>
                                    <TableCell align="right">日电量<br />(MWh)</TableCell>
                                    <TableCell align="right">批发均价<br />(元/MWh)</TableCell>
                                    <TableCell align="right">零售均价<br />(元/MWh)</TableCell>
                                    <TableCell align="right">批发成本<br />(元)</TableCell>
                                    <TableCell align="right">零售收入<br />(元)</TableCell>
                                    <TableCell align="right">毛利<br />(元)</TableCell>
                                    <TableCell align="right">毛利率</TableCell>
                                    <TableCell align="right">批零价差<br />(元/MWh)</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {dailyData.length > 0 ? (
                                    <>
                                        {dailyData.map((d: any) => {
                                            const profit = d.gross_profit || 0;
                                            const revenue = d.total_fee || 0;
                                            const margin = revenue !== 0 ? (profit / revenue) * 100 : 0;
                                            const spread = d.total_load_mwh !== 0 ? (profit / d.total_load_mwh) : 0;
                                            const wholesaleAvg = d.total_load_mwh !== 0 ? (d.total_allocated_cost / d.total_load_mwh) : 0;
                                            const retailAvg = d.total_load_mwh !== 0 ? (revenue / d.total_load_mwh) : 0;

                                            return (
                                                <TableRow key={d.date} hover>
                                                    <TableCell>{d.date}</TableCell>
                                                    <TableCell align="right">{formatMwh(d.total_load_mwh || 0)}</TableCell>
                                                    <TableCell align="right">{formatPrice(wholesaleAvg)}</TableCell>
                                                    <TableCell align="right">{formatPrice(retailAvg)}</TableCell>
                                                    <TableCell align="right">{formatYuan(d.total_allocated_cost || 0)}</TableCell>
                                                    <TableCell align="right">{formatYuan(revenue)}</TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(profit), fontWeight: 'bold' }}>
                                                        {formatYuan(profit)}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(margin) }}>
                                                        {margin.toFixed(2)}%
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(spread) }}>
                                                        {formatPrice(spread)}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}

                                        {/* 调平电量行 */}
                                        {(() => {
                                            const balEnergy = cd.sttl_balancing_energy_mwh || 0;
                                            const balFee = cd.sttl_balancing_retail_fee || 0;
                                            if (balEnergy === 0 && balFee === 0) return null;
                                            const balPrice = balEnergy !== 0 ? balFee / balEnergy : 0;
                                            return (
                                                <TableRow hover sx={{ bgcolor: 'rgba(255, 167, 38, 0.05)' }}>
                                                    <TableCell sx={{ color: 'warning.dark', fontWeight: 'medium' }}>调平电量</TableCell>
                                                    <TableCell align="right">{formatMwh(balEnergy)}</TableCell>
                                                    <TableCell align="right">{formatPrice(balPrice)}</TableCell>
                                                    <TableCell align="right">{formatPrice(balPrice)}</TableCell>
                                                    <TableCell align="right">{formatYuan(balFee)}</TableCell>
                                                    <TableCell align="right">{formatYuan(balFee)}</TableCell>
                                                    <TableCell align="right">0.00</TableCell>
                                                    <TableCell align="right">0.00%</TableCell>
                                                    <TableCell align="right">0.00</TableCell>
                                                </TableRow>
                                            );
                                        })()}

                                        {/* 合计栏 */}
                                        <TableRow sx={{ bgcolor: 'grey.100', '& .MuiTableCell-root': { fontWeight: 'bold' }, position: 'sticky', bottom: 0, zIndex: 2 }}>
                                            <TableCell>合计</TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const base = dailyData.reduce((s, x) => s + (x.total_load_mwh || 0), 0);
                                                    return formatMwh(base + (cd.sttl_balancing_energy_mwh || 0));
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalLoad = dailyData.reduce((s, x) => s + (x.total_load_mwh || 0), 0) + (cd.sttl_balancing_energy_mwh || 0);
                                                    const totalCost = dailyData.reduce((s, x) => s + (x.total_allocated_cost || 0), 0) + (cd.sttl_balancing_retail_fee || 0);
                                                    return totalLoad !== 0 ? formatPrice(totalCost / totalLoad) : '0.000';
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalLoad = dailyData.reduce((s, x) => s + (x.total_load_mwh || 0), 0) + (cd.sttl_balancing_energy_mwh || 0);
                                                    const totalRev = dailyData.reduce((s, x) => s + (x.total_fee || 0), 0) + (cd.sttl_balancing_retail_fee || 0);
                                                    return totalLoad !== 0 ? formatPrice(totalRev / totalLoad) : '0.000';
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">
                                                {formatYuan(dailyData.reduce((s, x) => s + (x.total_allocated_cost || 0), 0) + (cd.sttl_balancing_retail_fee || 0))}
                                            </TableCell>
                                            <TableCell align="right">
                                                {formatYuan(dailyData.reduce((s, x) => s + (x.total_fee || 0), 0) + (cd.sttl_balancing_retail_fee || 0))}
                                            </TableCell>
                                            <TableCell align="right" sx={{ color: profitColor(dailyData.reduce((s, x) => s + (x.gross_profit || 0), 0)) }}>
                                                {formatYuan(dailyData.reduce((s, x) => s + (x.gross_profit || 0), 0))}
                                            </TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalRev = dailyData.reduce((s, x) => s + (x.total_fee || 0), 0) + (cd.sttl_balancing_retail_fee || 0);
                                                    const totalProfit = dailyData.reduce((s, x) => s + (x.gross_profit || 0), 0);
                                                    return totalRev !== 0 ? ((totalProfit / totalRev) * 100).toFixed(2) + '%' : '0.00%';
                                                })()}
                                            </TableCell>
                                            <TableCell align="right">
                                                {(() => {
                                                    const totalLoad = dailyData.reduce((s, x) => s + (x.total_load_mwh || 0), 0) + (cd.sttl_balancing_energy_mwh || 0);
                                                    const totalProfit = dailyData.reduce((s, x) => s + (x.gross_profit || 0), 0);
                                                    return totalLoad !== 0 ? formatPrice(totalProfit / totalLoad) : '0.000';
                                                })()}
                                            </TableCell>
                                        </TableRow>
                                    </>
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={9} align="center" sx={{ py: 3 }}>
                                            <Typography variant="body2" color="text.secondary">暂无每日明细数据</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            </Box>
        </LocalizationProvider>
    );
};

export default SingleCustomerMonthlyDetailPage;
