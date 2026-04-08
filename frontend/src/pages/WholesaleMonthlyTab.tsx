import React, { useMemo, useRef } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Divider,
    Grid,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip as MuiTooltip,
    Typography,
    alpha,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

interface ReconciliationRow {
    group_label: string;
    metric: string;
    daily_agg_value: number;
    diff: number;
}

interface ReconciliationData {
    rows: ReconciliationRow[];
}

interface PeriodMarketDetail {
    volume?: number;
    fee?: number;
}

interface PeriodDetail {
    period: number | string;
    contract?: PeriodMarketDetail;
    day_ahead?: PeriodMarketDetail;
    real_time?: PeriodMarketDetail;
    total_energy_fee?: number;
}

interface WholesaleLedgerData {
    month: string;
    has_data: boolean;
    settlement_items: Record<string, number>;
    period_details?: PeriodDetail[];
}

interface WholesaleMonthlyTabProps {
    data: WholesaleLedgerData | null;
    reconciliation?: ReconciliationData | null;
    loading: boolean;
    onImportWholesale?: () => void;
    importDisabled?: boolean;
}

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const WholesaleMobileList: React.FC<{
    items: Record<string, number>;
    reconciliation?: ReconciliationData | null;
}> = ({ items, reconciliation }) => {
    const theme = useTheme();

    const sections = [
        {
            title: '电能量电费',
            rows: [
                { label: '实时现货结算', volKey: 'actual_consumption_volume', priceKey: 'real_time_avg_price', feeKey: 'real_time_deviation_fee', reconGroup: '实时市场偏差' },
                { label: '中长期合同偏差', volKey: 'contract_volume', priceKey: 'contract_avg_price', feeKey: 'contract_fee', reconGroup: '中长期合约' },
                {
                    label: '日前现货偏差',
                    volKey: 'day_ahead_declared_volume',
                    feeKey: 'day_ahead_deviation_fee',
                    reconGroup: '日前市场偏差',
                    priceCalc: (rowItems: Record<string, number>) => {
                        const volume = Number(rowItems.day_ahead_declared_volume ?? 0);
                        const fee = Number(rowItems.day_ahead_deviation_fee ?? 0);
                        return volume > 0 ? fee / volume : null;
                    },
                },
                { label: '偏差电量调平电费', volKey: 'monthly_balancing_volume', priceKey: 'balancing_price', feeKey: 'balancing_fee' },
                { label: '电能量合计', volKey: 'actual_monthly_volume', priceKey: 'energy_avg_price', feeKey: 'energy_fee_total', reconGroup: '电能量合计', isTotal: true },
            ],
        },
        {
            title: '资金余缺费用',
            rows: [
                { label: '发电侧成本类费用分摊', feeKey: 'gen_side_cost_allocation' },
                { label: '阻塞费分摊', feeKey: 'congestion_fee_allocation' },
                { label: '不平衡资金分摊', feeKey: 'imbalance_fund_allocation' },
                { label: '偏差回收费', feeKey: 'deviation_recovery_fee', reconGroup: '资金余缺费用', reconMetric: '偏差回收费' },
                { label: '偏差回收费返还', feeKey: 'deviation_recovery_return_fee' },
                { label: '资金余缺费用合计', feeKey: 'fund_surplus_deficit_total', isTotal: true },
            ],
        },
        {
            title: '结算合计',
            rows: [
                { label: '结算合计', volKey: 'actual_monthly_volume', priceKey: 'settlement_avg_price', feeKey: 'settlement_fee_total', isGrandTotal: true },
            ],
        },
    ];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {sections.map((section, sectionIndex) => (
                <Box key={`${section.title}-${sectionIndex}`}>
                    <Box
                        sx={{
                            bgcolor: alpha(theme.palette.primary.main, 0.05),
                            px: 2,
                            py: 1,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main' }}>
                            {section.title}
                        </Typography>
                    </Box>
                    {section.rows.map((row: any, rowIndex) => {
                        const volume = row.volKey ? Number(items[row.volKey] ?? 0) : null;
                        const price = row.priceCalc ? row.priceCalc(items) : row.priceKey ? Number(items[row.priceKey] ?? 0) : null;
                        const fee = Number(items[row.feeKey] ?? 0);
                        const isHighlight = row.isTotal || row.isGrandTotal;
                        const diffRow = row.reconGroup
                            ? reconciliation?.rows?.find((item) => item.group_label === row.reconGroup && item.metric === (row.reconMetric || '电费'))
                            : undefined;

                        return (
                            <Box
                                key={`${row.label}-${rowIndex}`}
                                sx={{
                                    p: 2,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: isHighlight ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75, gap: 1 }}>
                                    <Typography variant="body2" sx={{ fontWeight: isHighlight ? 800 : 500 }}>
                                        {row.label}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ fontWeight: 800, color: fee < 0 ? 'error.main' : 'text.primary', whiteSpace: 'nowrap' }}
                                    >
                                        {formatNumber(fee, 2)}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                                    {row.volKey && (
                                        <Typography variant="caption" color="text.secondary">
                                            电量: {formatNumber(volume, 3)} MWh
                                        </Typography>
                                    )}
                                    {(row.priceKey || row.priceCalc) && (
                                        <Typography variant="caption" color="text.secondary">
                                            均价: {formatNumber(price, 3)}
                                        </Typography>
                                    )}
                                    {diffRow && (
                                        <Typography
                                            variant="caption"
                                            sx={{ fontWeight: 700, color: diffRow.diff >= 0 ? 'error.main' : 'success.main' }}
                                        >
                                            差异: {diffRow.diff >= 0 ? '+' : ''}{formatNumber(diffRow.diff, 2)}
                                        </Typography>
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

const WaterfallTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;

    return (
        <Paper sx={{ p: 1.5, minWidth: 200 }} elevation={3}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                {data.name}
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                    {data.isSubtotal ? '累计金额' : '变动金额'}
                </Typography>
                <Typography
                    variant="body2"
                    fontWeight="bold"
                    color={
                        data.value >= 0 && !data.isSubtotal
                            ? 'success.main'
                            : data.value < 0 && !data.isSubtotal
                                ? 'error.main'
                                : 'text.primary'
                    }
                >
                    {data.value >= 0 && !data.isSubtotal ? '+' : ''}
                    {formatNumber(data.value, 2)} 元
                </Typography>
            </Box>
            {!data.isSubtotal && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">
                        变动后余额
                    </Typography>
                    <Typography variant="caption" fontWeight="bold">
                        {formatNumber(data.range[1], 2)} 元
                    </Typography>
                </Box>
            )}
        </Paper>
    );
};

const AttributionTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const detail = payload[0]?.payload;
    if (!detail) return null;

    const hedgeVolume = (detail.contractVol ?? 0) + (detail.dayAheadVol ?? 0);
    const coverageRate = (detail.realTimeVol ?? 0) > 0 ? (hedgeVolume / detail.realTimeVol) * 100 : 0;

    return (
        <Paper sx={{ p: 1.5, minWidth: 240 }} elevation={3}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                时段 {label}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography variant="body2" color="primary.main">
                    中长期差价电费
                </Typography>
                <Typography variant="body2" fontWeight="bold" color={detail.contractPL >= 0 ? 'success.main' : 'error.main'}>
                    {detail.contractPL >= 0 ? '+' : ''}
                    {formatNumber(detail.contractPL, 2)}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography variant="body2" color="warning.main">
                    日前差价电费
                </Typography>
                <Typography variant="body2" fontWeight="bold" color={detail.dayAheadPL >= 0 ? 'success.main' : 'error.main'}>
                    {detail.dayAheadPL >= 0 ? '+' : ''}
                    {formatNumber(detail.dayAheadPL, 2)}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                    实时偏差电费
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                    {formatNumber(detail.rtFee, 2)}
                </Typography>
            </Box>
            <Divider sx={{ my: 0.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography variant="body2">电费合计</Typography>
                <Typography variant="body2" fontWeight="bold">
                    {formatNumber(detail.totalFee, 2)}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography variant="body2">累计盈亏</Typography>
                <Typography variant="body2" fontWeight="bold" color={detail.cumPL >= 0 ? 'success.main' : 'error.main'}>
                    {detail.cumPL >= 0 ? '+' : ''}
                    {formatNumber(detail.cumPL, 2)}
                </Typography>
            </Box>
            <Divider sx={{ my: 0.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
                电量覆盖
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">中长期 + 日前</Typography>
                <Typography variant="caption">{formatNumber(hedgeVolume, 3)} MWh</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">实际用量</Typography>
                <Typography variant="caption">{formatNumber(detail.realTimeVol, 3)} MWh</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">覆盖率</Typography>
                <Typography variant="caption" fontWeight="bold">
                    {formatNumber(coverageRate, 1)}%
                </Typography>
            </Box>
        </Paper>
    );
};

export const WholesaleMonthlyTab: React.FC<WholesaleMonthlyTabProps> = ({
    data,
    reconciliation,
    loading,
    onImportWholesale,
    importDisabled = false,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const waterfallRef = useRef<HTMLDivElement>(null);
    const attributionRef = useRef<HTMLDivElement>(null);
    const items = useMemo(() => data?.settlement_items || {}, [data]);
    const currentMonth = data?.month || '';
    const hasActualData = useMemo(() => {
        if (!data) {
            return false;
        }
        if (data.has_data === false) {
            return false;
        }
        return Object.keys(data.settlement_items || {}).length > 0;
    }, [data]);

    const waterfallData = useMemo(() => {
        if (Object.keys(items).length === 0) return [];

        let currentTotal = 0;
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
            { name: '结算合计', key: 'settlement_fee_total', isSubtotal: true },
        ];

        return steps.map((step) => {
            const value = Number(items[step.key] ?? 0);
            let start = 0;
            let end = 0;

            if (step.isSubtotal) {
                end = value;
                currentTotal = value;
            } else {
                start = currentTotal;
                end = currentTotal + value;
                currentTotal = end;
            }

            return {
                name: step.name,
                isSubtotal: step.isSubtotal,
                value,
                range: [start, end],
            };
        });
    }, [items]);

    const attributionData = useMemo(() => {
        const periodDetails = data?.period_details || [];
        let cumulative = 0;

        return periodDetails.map((detail) => {
            const contractPL = Number(detail.contract?.fee ?? 0);
            const dayAheadPL = Number(detail.day_ahead?.fee ?? 0);
            cumulative += contractPL + dayAheadPL;

            return {
                period: detail.period,
                contractPL,
                dayAheadPL,
                rtFee: Number(detail.real_time?.fee ?? 0),
                totalFee: Number(detail.total_energy_fee ?? 0),
                cumPL: cumulative,
                contractVol: Number(detail.contract?.volume ?? 0),
                dayAheadVol: Number(detail.day_ahead?.volume ?? 0),
                realTimeVol: Number(detail.real_time?.volume ?? 0),
            };
        });
    }, [data]);

    const tableRows = [
        {
            cat: '电能量电费',
            rowSpan: 5,
            label: '实时现货结算',
            volKey: 'actual_consumption_volume',
            priceKey: 'real_time_avg_price',
            feeKey: 'real_time_deviation_fee',
            reconGroup: '实时市场偏差',
        },
        {
            cat: '电能量电费',
            label: '中长期合同偏差',
            volKey: 'contract_volume',
            priceKey: 'contract_avg_price',
            feeKey: 'contract_fee',
            reconGroup: '中长期合约',
        },
        {
            cat: '电能量电费',
            label: '日前现货偏差',
            volKey: 'day_ahead_declared_volume',
            feeKey: 'day_ahead_deviation_fee',
            reconGroup: '日前市场偏差',
            priceCalc: (rowItems: Record<string, number>) => {
                const volume = Number(rowItems.day_ahead_declared_volume ?? 0);
                const fee = Number(rowItems.day_ahead_deviation_fee ?? 0);
                return volume > 0 ? fee / volume : null;
            },
        },
        {
            cat: '电能量电费',
            label: '偏差电量调平电费',
            volKey: 'monthly_balancing_volume',
            priceKey: 'balancing_price',
            feeKey: 'balancing_fee',
        },
        {
            cat: '电能量电费',
            label: '电能量合计',
            volKey: 'actual_monthly_volume',
            priceKey: 'energy_avg_price',
            feeKey: 'energy_fee_total',
            reconGroup: '电能量合计',
            isTotal: true,
        },
        {
            cat: '资金余缺费用',
            rowSpan: 6,
            label: '发电侧成本类费用分摊',
            feeKey: 'gen_side_cost_allocation',
            emptyColumns: true,
        },
        {
            cat: '资金余缺费用',
            label: '阻塞费分摊',
            feeKey: 'congestion_fee_allocation',
            emptyColumns: true,
        },
        {
            cat: '资金余缺费用',
            label: '不平衡资金分摊',
            feeKey: 'imbalance_fund_allocation',
            emptyColumns: true,
        },
        {
            cat: '资金余缺费用',
            label: '偏差回收费',
            feeKey: 'deviation_recovery_fee',
            reconGroup: '资金余缺费用',
            reconMetric: '偏差回收费',
            emptyColumns: true,
        },
        {
            cat: '资金余缺费用',
            label: '偏差回收费返还',
            feeKey: 'deviation_recovery_return_fee',
            emptyColumns: true,
        },
        {
            cat: '资金余缺费用',
            label: '资金余缺费用合计',
            feeKey: 'fund_surplus_deficit_total',
            isTotal: true,
            emptyColumns: true,
        },
        {
            cat: '结算合计',
            label: '结算合计',
            volKey: 'actual_monthly_volume',
            priceKey: 'settlement_avg_price',
            feeKey: 'settlement_fee_total',
            reconGroup: '结算合计',
            isGrandTotal: true,
            colSpanCat: 2,
        },
    ];

    const {
        isFullscreen: isWaterfallFullscreen,
        FullscreenEnterButton: WaterfallEnterButton,
        FullscreenExitButton: WaterfallExitButton,
        FullscreenTitle: WaterfallTitle,
    } = useChartFullscreen({
        chartRef: waterfallRef,
        title: `批发结算电费瀑布图 (${data?.month || ''})`,
    });

    const {
        isFullscreen: isAttributionFullscreen,
        FullscreenEnterButton: AttributionEnterButton,
        FullscreenExitButton: AttributionExitButton,
        FullscreenTitle: AttributionTitle,
    } = useChartFullscreen({
        chartRef: attributionRef,
        title: `批发侧盈亏归因分析 (${data?.month || ''})`,
    });

    if (loading && !hasActualData) {
        return (
            <Box sx={{ minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!hasActualData) {
        return (
            <Box sx={{ position: 'relative' }}>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                    }}
                    >
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                批发侧月度结算
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                当前月份 {currentMonth}，可在此导入批发结算文件并查看结算明细与瀑布图。
                            </Typography>
                        </Box>
                        <Button
                            variant="outlined"
                            onClick={onImportWholesale}
                        disabled={loading || importDisabled}
                        sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                    >
                        导入批发结算文件
                    </Button>
                </Paper>
                <Paper variant="outlined" sx={{ p: 4, mt: 2, textAlign: 'center' }}>
                    <Typography color="text.secondary">当前月份暂无批发侧月度结算数据。</Typography>
                </Paper>
            </Box>
        );
    }

    return (
        <Box sx={{ position: 'relative' }}>
            {loading && (
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

            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 12 }}>
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            display: 'flex',
                            gap: 1,
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                        }}
                    >
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                批发侧月度结算
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                当前月份 {currentMonth}，可在此导入批发结算文件并查看结算明细与瀑布图。
                            </Typography>
                        </Box>
                        <Button
                            variant="outlined"
                            onClick={onImportWholesale}
                            disabled={loading || importDisabled}
                            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                        >
                            导入批发结算文件
                        </Button>
                    </Paper>
                </Grid>
                <Grid size={{ xs: 12, lg: 7 }} sx={{ display: 'flex' }}>
                    <Paper
                        variant="outlined"
                        sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}
                    >
                        {isMobile ? (
                            <WholesaleMobileList items={items} reconciliation={reconciliation} />
                        ) : (
                            <TableContainer
                                sx={{
                                    overflowX: 'auto',
                                    flex: 1,
                                }}
                            >
                                <Table
                                    size="small"
                                    stickyHeader
                                    sx={{
                                        minWidth: 880,
                                        '& .MuiTableCell-root': {
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                            px: { xs: 0.5, sm: 1.5 },
                                            py: 1,
                                            whiteSpace: 'nowrap',
                                        },
                                    }}
                                >
                                    <TableHead>
                                        <TableRow>
                                            <TableCell colSpan={2} sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                                        批发月度结算明细
                                                    </Typography>
                                                    <MuiTooltip title="右侧差异值来自月结导入结果与日清汇总口径的对比。">
                                                        <InfoOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                                                    </MuiTooltip>
                                                </Box>
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                                                电量(MWh)
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                                                均价
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                                                金额(元)
                                            </TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                                                差异
                                            </TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {tableRows.map((row, index) => {
                                            const volume = row.volKey ? Number(items[row.volKey] ?? 0) : null;
                                            const price = row.priceCalc
                                                ? row.priceCalc(items)
                                                : row.priceKey
                                                    ? Number(items[row.priceKey] ?? 0)
                                                    : null;
                                            const fee = Number(items[row.feeKey] ?? 0);
                                            const isHighlight = row.isTotal || row.isGrandTotal;
                                            const diffRow = row.reconGroup
                                                ? reconciliation?.rows?.find(
                                                    (item) =>
                                                        item.group_label === row.reconGroup &&
                                                        item.metric === (row.reconMetric || '电费'),
                                                )
                                                : undefined;

                                            return (
                                                <TableRow
                                                    key={`${row.label}-${index}`}
                                                    sx={{
                                                        bgcolor: isHighlight ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                                                    }}
                                                >
                                                    {row.rowSpan && (
                                                        <TableCell
                                                            rowSpan={row.rowSpan}
                                                            align="center"
                                                            sx={{ fontWeight: 800, borderRight: '1px solid', borderColor: 'divider' }}
                                                        >
                                                            {row.cat}
                                                        </TableCell>
                                                    )}
                                                    {row.colSpanCat ? (
                                                        <TableCell colSpan={2} align="center" sx={{ fontWeight: 800 }}>
                                                            {row.cat}
                                                        </TableCell>
                                                    ) : (
                                                        <TableCell>{row.label}</TableCell>
                                                    )}

                                                    {row.emptyColumns ? (
                                                        <TableCell colSpan={2} align="center" sx={{ color: 'text.disabled' }}>
                                                            -
                                                        </TableCell>
                                                    ) : (
                                                        <>
                                                            <TableCell align="right">{formatNumber(volume, 3)}</TableCell>
                                                            <TableCell align="right">{formatNumber(price, 3)}</TableCell>
                                                        </>
                                                    )}

                                                    <TableCell
                                                        align="right"
                                                        sx={{
                                                            fontWeight: isHighlight ? 800 : 500,
                                                            color: fee < 0 ? 'error.main' : 'text.primary',
                                                        }}
                                                    >
                                                        {formatNumber(fee, 2)}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {diffRow ? (
                                                            <MuiTooltip title={`日清汇总值：${formatNumber(diffRow.daily_agg_value, 2)}`}>
                                                                <Typography
                                                                    component="span"
                                                                    variant="caption"
                                                                    sx={{
                                                                        fontWeight: 800,
                                                                        color: diffRow.diff >= 0 ? 'error.main' : 'success.main',
                                                                    }}
                                                                >
                                                                    {diffRow.diff >= 0 ? '+' : ''}
                                                                    {formatNumber(diffRow.diff, 2)}
                                                                </Typography>
                                                            </MuiTooltip>
                                                        ) : (
                                                            '--'
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12, lg: 5 }} sx={{ display: 'flex' }}>
                    <Paper
                        variant="outlined"
                        sx={{ p: { xs: 1, sm: 2 }, display: 'flex', flexDirection: 'column', flex: 1 }}
                    >
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
                            结算电费瀑布图
                        </Typography>
                        <Box
                            ref={waterfallRef}
                            sx={{
                                flex: 1,
                                minHeight: { xs: 320, sm: 360 },
                                position: 'relative',
                                backgroundColor: isWaterfallFullscreen ? 'background.paper' : 'transparent',
                                p: isWaterfallFullscreen ? 2 : 0,
                                ...(isWaterfallFullscreen && {
                                    position: 'fixed',
                                    top: 0,
                                    left: 0,
                                    width: '100vw',
                                    height: '100vh',
                                    zIndex: 1400,
                                }),
                                '& .recharts-wrapper:focus': {
                                    outline: 'none',
                                },
                            }}
                        >
                            <WaterfallEnterButton />
                            <WaterfallExitButton />
                            <WaterfallTitle />
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={waterfallData} margin={{ top: 16, right: 16, left: 12, bottom: 56 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={72} tick={{ fontSize: 11 }} />
                                    <YAxis tickFormatter={(value) => `${(Number(value) / 10000).toFixed(0)}万`} tick={{ fontSize: 11 }} />
                                    <Tooltip content={<WaterfallTooltip />} />
                                    <ReferenceLine y={0} stroke="#999" />
                                    <Bar dataKey="range">
                                        {waterfallData.map((entry, index) => (
                                            <Cell
                                                key={`${entry.name}-${index}`}
                                                fill={
                                                    entry.isSubtotal
                                                        ? theme.palette.primary.main
                                                        : entry.value >= 0
                                                            ? theme.palette.success.main
                                                            : theme.palette.error.main
                                                }
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </Box>
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12 }}>
                    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                        <Typography
                            variant="subtitle1"
                            sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                            <BarChartIcon color="primary" />
                            批发侧时段盈亏归因分析
                        </Typography>
                        <Box
                            ref={attributionRef}
                            sx={{
                                height: { xs: 350, sm: 400 },
                                position: 'relative',
                                backgroundColor: isAttributionFullscreen ? 'background.paper' : 'transparent',
                                p: isAttributionFullscreen ? 2 : 0,
                                ...(isAttributionFullscreen && {
                                    position: 'fixed',
                                    top: 0,
                                    left: 0,
                                    width: '100vw',
                                    height: '100vh',
                                    zIndex: 1400,
                                }),
                                '& .recharts-wrapper:focus': {
                                    outline: 'none',
                                },
                            }}
                        >
                            <AttributionEnterButton />
                            <AttributionExitButton />
                            <AttributionTitle />

                            {attributionData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={attributionData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                        <Tooltip content={<AttributionTooltip />} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                                        <Area yAxisId="left" type="monotone" dataKey="rtFee" name="全量电费⑨" fill="#90caf9" stroke="none" fillOpacity={0.15} />
                                        <Bar yAxisId="left" dataKey="contractPL" name="中长期差价电费" fill="#1565c0" stackId="pl" />
                                        <Bar yAxisId="left" dataKey="dayAheadPL" name="日前差价电费" fill="#ef6c00" stackId="pl" />
                                        <Line yAxisId="left" type="monotone" dataKey="totalFee" name="电费合计" stroke="#00897b" strokeWidth={1.5} dot={false} />
                                        <Line yAxisId="right" type="monotone" dataKey="cumPL" name="累计盈亏" stroke="#7b1fa2" strokeWidth={2} dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            ) : (
                                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography color="text.secondary">
                                        暂无时段归因数据，请确认日清数据已完成并包含 period_details。
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};
