import React, { useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    LinearProgress,
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
    alpha,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import CalculateIcon from '@mui/icons-material/Calculate';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

interface MonthlyCustomer {
    _id: string;
    customer_id?: string;
    customer_name: string;
    total_energy_mwh: number;
    retail_total_fee: number;
    total_fee: number;
    excess_refund_fee: number;
    settlement_avg_price: number;
    final_wholesale_fee?: number;
    final_wholesale_unit_price?: number;
    final_gross_profit?: number;
    final_price_spread_per_mwh?: number;
    pricing_model?: string;
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

interface JobInfo {
    job_id: string;
    month: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | string;
    progress: number;
    message?: string;
}

interface RetailMonthlyTabProps {
    month: string;
    customers: MonthlyCustomer[];
    chartData: RetailChartData;
    loading: boolean;
    handleViewDetail: (customerId: string, customerName: string) => void;
    onExecuteRetailSettlement: () => void;
    onStartSettlement: () => void;
    progressOpen: boolean;
    onCloseProgress: () => void;
    jobInfo: JobInfo | null;
    snackbarOpen: boolean;
    onCloseSnackbar: () => void;
    canExecuteSettlement: boolean;
}

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const getPricingModelColor = (model?: string) => {
    switch (model) {
        case 'fixed_price':
            return '#2196f3';
        case 'market_linked':
            return '#4caf50';
        case 'fixed_linked_price_time':
            return '#ff9800';
        case 'fixed_linked_retail':
            return '#8e24aa';
        default:
            return '#90a4ae';
    }
};

const getPricingModelName = (model?: string) => {
    switch (model) {
        case 'fixed_price':
            return '固定价格';
        case 'market_linked':
            return '市场联动';
        case 'fixed_linked_price_time':
            return '时段联动';
        case 'fixed_linked_retail':
            return '零售联动';
        default:
            return '其他';
    }
};

const CustomerMobileCard: React.FC<{
    customer: MonthlyCustomer;
    index: number;
    onClick: (customerId: string, customerName: string) => void;
}> = ({ customer, index, onClick }) => {
    const theme = useTheme();

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                        sx={{
                            px: 0.8,
                            py: 0.2,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            color: 'primary.main',
                            borderRadius: 1,
                            fontSize: '0.7rem',
                            fontWeight: 800,
                        }}
                    >
                        {index + 1}
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {customer.customer_name}
                    </Typography>
                </Box>
                <Button
                    size="small"
                    variant="text"
                    color="primary"
                    endIcon={<ArrowForwardIosIcon sx={{ fontSize: '10px !important' }} />}
                    onClick={() => onClick(customer.customer_id || customer._id, customer.customer_name)}
                    sx={{ p: 0, minWidth: 'auto', fontWeight: 800, fontSize: '0.75rem' }}
                >
                    查看明细
                </Button>
            </Box>

            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">结算电量 (MWh)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatNumber(customer.total_energy_mwh, 3)}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary" display="block">结算均价 (元/MWh)</Typography>
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
                    <Typography
                        variant="caption"
                        sx={{
                            fontWeight: 800,
                            color: (customer.final_gross_profit || 0) >= 0 ? 'success.main' : 'error.main',
                            display: 'flex',
                            justifyContent: 'flex-end',
                        }}
                    >
                        月度毛利: {formatNumber(customer.final_gross_profit, 2)}
                    </Typography>
                </Grid>
            </Grid>
        </Paper>
    );
};

export const RetailMonthlyTab: React.FC<RetailMonthlyTabProps> = ({
    month,
    customers,
    chartData,
    loading,
    handleViewDetail,
    onExecuteRetailSettlement,
    onStartSettlement,
    progressOpen,
    onCloseProgress,
    jobInfo,
    snackbarOpen,
    onCloseSnackbar,
    canExecuteSettlement,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const bubbleRef = useRef<HTMLDivElement>(null);
    const packageRef = useRef<HTMLDivElement>(null);
    const [orderBy, setOrderBy] = useState<keyof MonthlyCustomer | 'retail_avg_price'>('final_gross_profit');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');

    const bubbleLegend = useMemo(() => {
        let hasFixed = false;
        let hasAvg = false;
        let hasUpper = false;
        let hasOther = false;

        chartData.customer_points.forEach((item) => {
            const packageStr = String(item.package_name || item.model_code || '');
            if (item.is_capped || packageStr.includes('上限')) {
                hasUpper = true;
            } else if (packageStr.includes('固定')) {
                hasFixed = true;
            } else if (packageStr.includes('平均上网电价') || packageStr.includes('均价')) {
                hasAvg = true;
            } else {
                hasOther = true;
            }
        });

        return { hasFixed, hasAvg, hasUpper, hasOther };
    }, [chartData]);

    const bubbleData = useMemo(
        () =>
            chartData.customer_points.map((item) => {
                const packageStr = String(item.package_name || item.model_code || '');
                let color = '#9e9e9e';
                if (item.is_capped || packageStr.includes('上限')) color = '#ff5722';
                else if (packageStr.includes('固定')) color = '#2196f3';
                else if (packageStr.includes('平均上网电价') || packageStr.includes('均价')) color = '#4caf50';

                return {
                    customerName: item.customer_name,
                    package: item.package_name || item.model_code || '无类别',
                    pricing_model: item.model_code || '',
                    is_capped: item.is_capped,
                    spread: item.spread || 0,
                    load: item.load || 0,
                    profit: item.profit || 0,
                    absProfit: item.abs_profit || 0,
                    color,
                };
            }),
        [chartData],
    );

    const packageData = useMemo(() => chartData.package_summary, [chartData]);

    const sortedCustomers = useMemo(() => {
        return [...customers].sort((a, b) => {
            const getValue = (customer: MonthlyCustomer) => {
                if (orderBy === 'retail_avg_price') {
                    return customer.total_energy_mwh ? customer.retail_total_fee / customer.total_energy_mwh : 0;
                }
                return customer[orderBy] ?? 0;
            };
            const valueA = getValue(a);
            const valueB = getValue(b);
            if (typeof valueA === 'string' && typeof valueB === 'string') {
                return order === 'desc' ? valueB.localeCompare(valueA) : valueA.localeCompare(valueB);
            }
            return order === 'desc' ? Number(valueB) - Number(valueA) : Number(valueA) - Number(valueB);
        });
    }, [customers, order, orderBy]);

    const totalEnergy = useMemo(() => customers.reduce((sum, customer) => sum + (customer.total_energy_mwh || 0), 0), [customers]);
    const totalRetailFee = useMemo(() => customers.reduce((sum, customer) => sum + (customer.retail_total_fee || 0), 0), [customers]);
    const totalSettlementFee = useMemo(() => customers.reduce((sum, customer) => sum + (customer.total_fee || 0), 0), [customers]);
    const totalWholesaleFee = useMemo(() => customers.reduce((sum, customer) => sum + (customer.final_wholesale_fee || 0), 0), [customers]);
    const totalGrossProfit = useMemo(() => customers.reduce((sum, customer) => sum + (customer.final_gross_profit || 0), 0), [customers]);
    const totalExcessRefund = useMemo(() => customers.reduce((sum, customer) => sum + (customer.excess_refund_fee || 0), 0), [customers]);
    const retailColumnBg = alpha(theme.palette.warning.main, 0.08);
    const settlementColumnBg = alpha(theme.palette.info.main, 0.08);
    const analysisColumnBg = alpha(theme.palette.success.main, 0.08);

    const { isFullscreen: isBubbleFullscreen, FullscreenEnterButton: BubbleEnterButton, FullscreenExitButton: BubbleExitButton, FullscreenTitle: BubbleTitle } = useChartFullscreen({
        chartRef: bubbleRef,
        title: `客户收益多维气泡图 (${month})`,
    });

    const { isFullscreen: isPackageFullscreen, FullscreenEnterButton: PackageEnterButton, FullscreenExitButton: PackageExitButton, FullscreenTitle: PackageTitle } = useChartFullscreen({
        chartRef: packageRef,
        title: `按套餐收益与电量对比图 (${month})`,
    });

    const handleRequestSort = (property: keyof MonthlyCustomer | 'retail_avg_price') => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    if (loading && customers.length === 0) {
        return <Box sx={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ position: 'relative' }}>
            {loading && customers.length > 0 && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.6)',
                        zIndex: 1000,
                    }}
                >
                    <CircularProgress />
                </Box>
            )}

            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    mb: 2,
                    display: 'flex',
                    gap: 1,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                }}
            >
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>零售侧月度结算</Typography>
                    <Typography variant="body2" color="text.secondary">
                        当前月份 {month}，共 {customers.length} 家客户
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<CalculateIcon />}
                    onClick={onExecuteRetailSettlement}
                    disabled={loading || !canExecuteSettlement}
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}
                >
                    测算所有客户
                </Button>
            </Paper>

            {customers.length === 0 && !loading ? (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">当前月份暂无零售月结客户数据。</Typography>
                </Paper>
            ) : (
                <Grid container spacing={{ xs: 1, sm: 2 }}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%' }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <BubbleChartIcon color="primary" />
                                客户收益多维气泡图
                            </Typography>
                            <Box
                                ref={bubbleRef}
                                sx={{
                                    height: { xs: 350, sm: 400 },
                                    position: 'relative',
                                    backgroundColor: isBubbleFullscreen ? 'background.paper' : 'transparent',
                                    p: isBubbleFullscreen ? 2 : 0,
                                    ...(isBubbleFullscreen && {
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        width: '100vw',
                                        height: '100vh',
                                        zIndex: 1400,
                                    }),
                                    '& .recharts-wrapper:focus': { outline: 'none' },
                                }}
                            >
                                <BubbleEnterButton />
                                <BubbleExitButton />
                                <BubbleTitle />
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 20, right: 24, bottom: 16, left: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" dataKey="spread" name="价差" unit="元/MWh" />
                                        <YAxis type="number" dataKey="load" name="电量" unit="MWh" />
                                        <ZAxis type="number" dataKey="profit" range={[60, 800]} />
                                        <Tooltip
                                            cursor={{ strokeDasharray: '3 3' }}
                                            content={({ active, payload }: any) => {
                                                if (!active || !payload?.length) return null;
                                                const detail = payload[0].payload;
                                                return (
                                                    <Paper sx={{ p: 1.5, minWidth: 220, fontSize: '0.875rem' }} elevation={3}>
                                                        <Typography variant="subtitle2" fontWeight="bold">
                                                            {detail.customerName || '--'}
                                                        </Typography>
                                                        <Divider sx={{ my: 0.5 }} />
                                                        <Typography variant="body2" color="text.secondary">
                                                            套餐: {detail.package}
                                                        </Typography>
                                                        <Typography variant="body2">
                                                            结算电量: {formatNumber(detail.load, 3)} MWh
                                                        </Typography>
                                                        <Typography variant="body2">
                                                            批零价差: {formatNumber(detail.spread, 2)} 元/MWh
                                                        </Typography>
                                                        <Typography
                                                            variant="body2"
                                                            fontWeight="bold"
                                                            color={detail.profit >= 0 ? 'success.main' : 'error.main'}
                                                        >
                                                            月总毛利: {formatNumber(detail.profit, 2)} 元
                                                        </Typography>
                                                    </Paper>
                                                );
                                            }}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 12, bottom: 0 }} />
                                        {bubbleLegend.hasFixed && <Scatter name="固定价" data={[]} fill="#2196f3" legendType="circle" />}
                                        {bubbleLegend.hasAvg && <Scatter name="均价参考" data={[]} fill="#4caf50" legendType="circle" />}
                                        {bubbleLegend.hasUpper && <Scatter name="上限价" data={[]} fill="#ff5722" legendType="circle" />}
                                        {bubbleLegend.hasOther && <Scatter name="其它" data={[]} fill="#9e9e9e" legendType="circle" />}
                                        <Scatter data={bubbleData} name="客户分布" legendType="none">
                                            {bubbleData.map((entry, index) => (
                                                <Cell key={`${entry.customerName}-${index}`} fill={entry.color} fillOpacity={0.7} />
                                            ))}
                                        </Scatter>
                                        <ReferenceLine x={0} stroke="#999" />
                                        <ReferenceLine y={0} stroke="#999" />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%' }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <TrendingUpIcon color="primary" />
                                按套餐收益与电量对比图
                            </Typography>
                            <Box
                                ref={packageRef}
                                sx={{
                                    height: { xs: 350, sm: 400 },
                                    position: 'relative',
                                    backgroundColor: isPackageFullscreen ? 'background.paper' : 'transparent',
                                    p: isPackageFullscreen ? 2 : 0,
                                    ...(isPackageFullscreen && {
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        width: '100vw',
                                        height: '100vh',
                                        zIndex: 1400,
                                    }),
                                    '& .recharts-wrapper:focus': { outline: 'none' },
                                }}
                            >
                                <PackageEnterButton />
                                <PackageExitButton />
                                <PackageTitle />
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={packageData} margin={{ top: 20, right: 24, bottom: 16, left: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                        <YAxis yAxisId="left" tickFormatter={(val) => `${(Number(val) / 10000).toFixed(0)}万`} width={50} />
                                        <YAxis yAxisId="right" orientation="right" width={50} />
                                        <Tooltip
                                            content={({ active, payload }: any) => {
                                                if (!active || !payload?.length) return null;
                                                const detail = payload[0].payload;
                                                return (
                                                    <Paper sx={{ p: 1.5, fontSize: '0.875rem' }} elevation={3}>
                                                        <Typography variant="subtitle2" fontWeight="bold">{detail.name}</Typography>
                                                        <Divider sx={{ my: 0.5 }} />
                                                        <Typography variant="body2">涉及客户: {detail.count} 户</Typography>
                                                        <Typography variant="body2">结算电量: {formatNumber(detail.load, 3)} MWh</Typography>
                                                        <Typography variant="body2" fontWeight="bold" color={detail.profit >= 0 ? 'success.main' : 'error.main'}>
                                                            该套餐总毛利: {formatNumber(detail.profit, 2)} 元
                                                        </Typography>
                                                    </Paper>
                                                );
                                            }}
                                            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar yAxisId="left" dataKey="profit" name="套餐总毛利" barSize={40}>
                                            {packageData.map((entry, index) => (
                                                <Cell key={`${entry.name}-${index}`} fill={entry.profit >= 0 ? '#4caf50' : '#f44336'} />
                                            ))}
                                        </Bar>
                                        <Line yAxisId="right" type="monotone" dataKey="load" name="结算电量" stroke="#1976d2" strokeWidth={2} dot={{ r: 4 }} />
                                        <ReferenceLine yAxisId="left" y={0} stroke="#000" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
                            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.success.main, 0.03) }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>零售客户月结详情总账</Typography>
                            </Box>
                            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.primary.main, 0.01) }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    单位说明：电量 MWh，均价/价差 元/MWh，电费/毛利/返还 元
                                </Typography>
                            </Box>

                            {isMobile ? (
                                <Box sx={{ p: 2 }}>
                                    {sortedCustomers.map((customer, index) => (
                                        <CustomerMobileCard key={customer._id} customer={customer} index={index} onClick={handleViewDetail} />
                                    ))}
                                </Box>
                            ) : (
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                        <Table
                                            size="small"
                                            sx={{
                                                minWidth: 1000,
                                                '& .MuiTableCell-root': {
                                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                px: { xs: 0.5, sm: 1.5 },
                                                    py: 1,
                                                    whiteSpace: 'nowrap',
                                                },
                                                '& .MuiTableRow-root > .MuiTableCell-root:nth-of-type(3), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(4), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(5)': {
                                                    bgcolor: retailColumnBg,
                                                },
                                                '& .MuiTableRow-root > .MuiTableCell-root:nth-of-type(6), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(7), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(8)': {
                                                    bgcolor: settlementColumnBg,
                                                },
                                                '& .MuiTableRow-root > .MuiTableCell-root:nth-of-type(9), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(10), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(11), & .MuiTableRow-root > .MuiTableCell-root:nth-of-type(12)': {
                                                    bgcolor: analysisColumnBg,
                                                },
                                            }}
                                        >
                                        <TableHead>
                                            <TableRow sx={{ '& th': { bgcolor: alpha(theme.palette.success.main, 0.05), fontWeight: 800 } }}>
                                                <TableCell align="center">序号</TableCell>
                                                <TableCell>
                                                    <TableSortLabel active={orderBy === 'customer_name'} direction={orderBy === 'customer_name' ? order : 'asc'} onClick={() => handleRequestSort('customer_name')}>
                                                        客户名称
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <TableSortLabel active={orderBy === 'total_energy_mwh'} direction={orderBy === 'total_energy_mwh' ? order : 'asc'} onClick={() => handleRequestSort('total_energy_mwh')}>
                                                        结算电量
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <TableSortLabel active={orderBy === 'retail_avg_price'} direction={orderBy === 'retail_avg_price' ? order : 'asc'} onClick={() => handleRequestSort('retail_avg_price')}>
                                                        零售均价
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell align="right">零售电费</TableCell>
                                                <TableCell align="right">超额返还</TableCell>
                                                <TableCell align="right">结算总额</TableCell>
                                                <TableCell align="right">结算均价</TableCell>
                                                <TableCell align="right">采购成本</TableCell>
                                                <TableCell align="right">采购单价</TableCell>
                                                <TableCell align="right">
                                                    <TableSortLabel active={orderBy === 'final_gross_profit'} direction={orderBy === 'final_gross_profit' ? order : 'asc'} onClick={() => handleRequestSort('final_gross_profit')}>
                                                        毛利
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell align="right">批零价差</TableCell>
                                                <TableCell align="center">操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {sortedCustomers.map((customer, index) => (
                                                <TableRow key={customer._id} hover>
                                                    <TableCell align="center" sx={{ fontWeight: 700 }}>{index + 1}</TableCell>
                                                    <TableCell sx={{ fontWeight: 700 }}>{customer.customer_name}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.total_energy_mwh, 3)}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.total_energy_mwh ? customer.retail_total_fee / customer.total_energy_mwh : 0, 3)}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.retail_total_fee, 2)}</TableCell>
                                                    <TableCell align="right" sx={{ color: 'success.main', fontWeight: 700 }}>{formatNumber(customer.excess_refund_fee, 2)}</TableCell>
                                                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatNumber(customer.total_fee, 2)}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.settlement_avg_price, 3)}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.final_wholesale_fee, 2)}</TableCell>
                                                    <TableCell align="right">{formatNumber(customer.final_wholesale_unit_price, 3)}</TableCell>
                                                    <TableCell align="right" sx={{ fontWeight: 800, color: (customer.final_gross_profit || 0) >= 0 ? 'success.main' : 'error.main' }}>
                                                        {formatNumber(customer.final_gross_profit, 2)}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ fontWeight: 800, color: (customer.final_price_spread_per_mwh || 0) >= 0 ? 'success.main' : 'error.main' }}>
                                                        {formatNumber(customer.final_price_spread_per_mwh, 3)}
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Button
                                                            size="small"
                                                            color="primary"
                                                            endIcon={<ArrowForwardIosIcon sx={{ fontSize: '12px !important' }} />}
                                                            onClick={() => handleViewDetail(customer.customer_id || customer._id, customer.customer_name)}
                                                            sx={{ minWidth: 'auto', fontWeight: 700, whiteSpace: 'nowrap' }}
                                                        >
                                                            查看明细
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            <TableRow sx={{ bgcolor: theme.palette.grey[100], '& td': { fontWeight: 800 } }}>
                                                <TableCell align="center">--</TableCell>
                                                <TableCell>全量合计</TableCell>
                                                <TableCell align="right">{formatNumber(totalEnergy, 3)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalEnergy > 0 ? totalRetailFee / totalEnergy : 0, 3)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalRetailFee, 2)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalExcessRefund, 2)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalSettlementFee, 2)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalEnergy > 0 ? totalSettlementFee / totalEnergy : 0, 3)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalWholesaleFee, 2)}</TableCell>
                                                <TableCell align="right">{formatNumber(totalEnergy > 0 ? totalWholesaleFee / totalEnergy : 0, 3)}</TableCell>
                                                <TableCell align="right" sx={{ color: totalGrossProfit >= 0 ? 'success.main' : 'error.main' }}>{formatNumber(totalGrossProfit, 2)}</TableCell>
                                                <TableCell align="right" sx={{ color: totalGrossProfit >= 0 ? 'success.main' : 'error.main' }}>{formatNumber(totalEnergy > 0 ? totalGrossProfit / totalEnergy : 0, 3)}</TableCell>
                                                <TableCell align="center" />
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </Paper>
                    </Grid>
                </Grid>
            )}

            <Dialog open={progressOpen} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
                <DialogTitle sx={{ fontWeight: 800 }}>
                    {jobInfo ? `月度结算进度 - ${jobInfo.month}` : '月度零售结算确认'}
                </DialogTitle>
                <DialogContent>
                    {!jobInfo ? (
                        <Box sx={{ py: 2 }}>
                            <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
                                确认要开始 <strong>{month}</strong> 的零售月度结算吗？
                                <br />
                                系统将重新计算该月份所有客户的电量分配、零售电费及超额返还。
                            </Alert>
                        </Box>
                    ) : (
                        <Box sx={{ mt: 2 }}>
                            <Box sx={{ mb: 2, p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 2 }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>当前状态</Typography>
                                <Typography variant="subtitle1" fontWeight="bold">{jobInfo.message}</Typography>
                            </Box>
                            <LinearProgress variant="determinate" value={jobInfo.progress || 0} sx={{ height: 10, borderRadius: 5, mb: 1 }} />
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Typography variant="h6" fontWeight="bold" color="primary">{jobInfo.progress}%</Typography>
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 2, px: 3 }}>
                    {!jobInfo ? (
                        <>
                            <Button onClick={onCloseProgress} color="inherit" sx={{ borderRadius: 2, fontWeight: 600 }}>取消</Button>
                            <Button variant="contained" onClick={onStartSettlement} startIcon={<CalculateIcon />} disabled={!canExecuteSettlement} sx={{ borderRadius: 2, px: 3, fontWeight: 600, boxShadow: 'none' }}>
                                开始结算
                            </Button>
                        </>
                    ) : (
                        <Button
                            variant="contained"
                            disableElevation
                            onClick={onCloseProgress}
                            disabled={jobInfo.status === 'pending' || jobInfo.status === 'running'}
                            sx={{ borderRadius: 2, px: 4, fontWeight: 600 }}
                        >
                            {jobInfo.status === 'completed' || jobInfo.status === 'failed' ? '完成' : '计算中...'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbarOpen} autoHideDuration={3000} onClose={onCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity="success" variant="filled" sx={{ borderRadius: 2 }}>操作成功，数据已刷新</Alert>
            </Snackbar>
        </Box>
    );
};
