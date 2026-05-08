import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Paper,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import { eachDayOfInterval, endOfMonth, format, startOfMonth, startOfYear, subDays, subMonths } from 'date-fns';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    StorageProfitAnalysis,
    StorageProfitDailyRow,
    StorageStation,
    StorageStrategy,
    storageDeclarationApi,
} from '../../../api/storageDeclaration';
import { useChartFullscreen } from '../../../hooks/useChartFullscreen';

interface RevenueForecastTabProps {
    station: StorageStation;
    strategy: StorageStrategy;
    onOpenReview?: (date: string) => void;
}

type ProfitMetric = 'amount' | 'business';

const CHART_LEFT = 54;
const CHART_RIGHT = 16;
const ENERGY_COLOR = '#16a34a';
const FM_COLOR = '#2563eb';
const CUMULATIVE_COLOR = '#dc2626';

const formatDate = (date: Date): string => format(date, 'yyyy-MM-dd');

const formatMoney = (value?: number | null): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)} 万元`;
    return `${value.toFixed(2)} 元`;
};

const formatMoneyWanNumber = (value?: number | null): number => {
    if (value === undefined || value === null || Number.isNaN(value)) return 0;
    return Number((value / 10000).toFixed(4));
};

const formatMwh = (value?: number | null): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return `${value.toFixed(2)} MWh`;
};

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return value.toFixed(digits);
};

const ProfitTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload.find((item: any) => item?.payload)?.payload as (Partial<StorageProfitDailyRow> & { hasData?: boolean }) | undefined;
    if (!row) return null;
    if (!row.hasData) {
        return (
            <Paper variant="outlined" sx={{ p: 1.25, pointerEvents: 'none' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{label}</Typography>
                <Typography variant="body2" color="text.secondary">该日暂无已复盘收益数据</Typography>
            </Paper>
        );
    }
    return (
        <Paper variant="outlined" sx={{ p: 1.25, pointerEvents: 'none' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{label}</Typography>
            <Typography variant="body2">当日收益：{formatMoney(row.total_revenue)}</Typography>
            <Typography variant="body2">电能量收益：{formatMoney(row.energy_revenue)}</Typography>
            <Typography variant="body2">调频收益：{formatMoney(row.fm_revenue)}</Typography>
            <Typography variant="body2">累计收益：{formatMoney(row.cumulative_revenue)}</Typography>
            <Typography variant="body2">充电电量：{formatMwh(row.charge_mwh)}</Typography>
            <Typography variant="body2">放电电量：{formatMwh(row.discharge_mwh)}</Typography>
            <Typography variant="body2">中标时段：{row.winning_hours}/24</Typography>
            <Typography variant="body2">调频里程：{formatNumber(row.fm_mileage, 2)} MW</Typography>
        </Paper>
    );
};

export const RevenueForecastTab: React.FC<RevenueForecastTabProps> = ({ station, strategy, onOpenReview }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const defaultStart = useMemo(() => startOfMonth(new Date()), []);
    const defaultEnd = useMemo(() => new Date(), []);

    const [startDate, setStartDate] = useState<Date | null>(defaultStart);
    const [endDate, setEndDate] = useState<Date | null>(defaultEnd);
    const [metric, setMetric] = useState<ProfitMetric>('amount');
    const [viewMode, setViewMode] = useState(0);
    const [analysis, setAnalysis] = useState<StorageProfitAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chartRef = useRef<HTMLDivElement>(null);
    const fullscreen = useChartFullscreen({ chartRef, title: `${station.station_name} / ${strategy.strategy_name} 策略收益` });

    const startText = startDate ? formatDate(startDate) : '';
    const endText = endDate ? formatDate(endDate) : '';
    const rows = useMemo(() => analysis?.rows || [], [analysis?.rows]);
    const summary = analysis?.summary;
    const chartLeft = isMobile ? 8 : CHART_LEFT;
    const chartRight = isMobile ? 6 : CHART_RIGHT;
    const yAxisWidth = isMobile ? 34 : 54;

    const loadProfit = async () => {
        if (!startText || !endText) return;
        setLoading(true);
        setError(null);
        try {
            const data = await storageDeclarationApi.getProfitAnalysis(
                station.station_id,
                strategy.strategy_id,
                startText,
                endText,
            );
            setAnalysis(data);
        } catch (e: any) {
            setError(e?.response?.data?.detail || '加载策略收益数据失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadProfit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [station.station_id, strategy.strategy_id, startText, endText]);

    const applyRange = (preset: 'thisMonth' | 'lastMonth' | '30d' | '60d' | 'thisYear') => {
        const today = new Date();
        if (preset === 'thisMonth') {
            setStartDate(startOfMonth(today));
            setEndDate(today);
        } else if (preset === 'lastMonth') {
            const lastMonth = subMonths(today, 1);
            setStartDate(startOfMonth(lastMonth));
            setEndDate(endOfMonth(lastMonth));
        } else if (preset === '30d') {
            setStartDate(subDays(today, 29));
            setEndDate(today);
        } else if (preset === '60d') {
            setStartDate(subDays(today, 59));
            setEndDate(today);
        } else {
            setStartDate(startOfYear(today));
            setEndDate(today);
        }
    };

    const metricCards = [
        { label: '累计收益', value: formatMoney(summary?.total_revenue), color: 'success.main' },
        { label: '电能量收益', value: formatMoney(summary?.energy_revenue), color: 'success.main' },
        { label: '调频收益', value: formatMoney(summary?.fm_revenue), color: 'success.main' },
        { label: '日均收益', value: formatMoney(summary?.avg_daily_revenue) },
        { label: '复盘天数', value: summary ? `${summary.reviewed_days}/${summary.natural_days}` : '-' },
        { label: '充电电量', value: formatMwh(summary?.charge_mwh) },
        { label: '放电电量', value: formatMwh(summary?.discharge_mwh) },
        { label: '损耗电量', value: formatMwh(summary?.loss_mwh) },
        { label: '中标时段', value: summary ? `${summary.winning_hours}` : '-' },
        { label: '调频里程', value: summary ? `${formatNumber(summary.fm_mileage, 2)} MW` : '-' },
        { label: '出清均价', value: summary ? `${formatNumber(summary.avg_clearing_price, 2)} 元/MW` : '-' },
        { label: '时段收益', value: summary ? `${formatMoney(summary.fm_revenue_per_winning_hour)}/时段` : '-' },
    ];

    const chartRows = useMemo(() => {
        if (!startDate || !endDate || startDate > endDate) return [];
        const rowMap = new Map(rows.map((row) => [row.date, row]));
        return eachDayOfInterval({ start: startDate, end: endDate }).map((date) => {
            const dateStr = formatDate(date);
            const row = rowMap.get(dateStr);
            return {
                date: dateStr,
                hasData: Boolean(row),
                total_revenue: row?.total_revenue ?? null,
                energy_revenue: row?.energy_revenue ?? null,
                fm_revenue: row?.fm_revenue ?? null,
                cumulative_revenue: row?.cumulative_revenue ?? null,
                charge_mwh: row?.charge_mwh ?? null,
                discharge_mwh: row?.discharge_mwh ?? null,
                loss_mwh: row?.loss_mwh ?? null,
                winning_hours: row?.winning_hours ?? null,
                fm_mileage: row?.fm_mileage ?? null,
                avg_clearing_price: row?.avg_clearing_price ?? null,
                energyRevenueWan: row ? formatMoneyWanNumber(row.energy_revenue) : null,
                fmRevenueWan: row ? formatMoneyWanNumber(row.fm_revenue) : null,
                cumulativeRevenueWan: row ? formatMoneyWanNumber(row.cumulative_revenue) : null,
                chargeMwh: row?.charge_mwh ?? null,
                dischargeMwh: row?.discharge_mwh ?? null,
                fmMileage: row?.fm_mileage ?? null,
            };
        });
    }, [endDate, rows, startDate]);

    const dateTickInterval = useMemo(() => {
        if (chartRows.length <= 12) return 0;
        return Math.ceil(chartRows.length / (isMobile ? 5 : 10));
    }, [chartRows.length, isMobile]);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                height: { xs: 'auto', md: '100%' },
                minHeight: 0,
                overflow: { xs: 'visible', md: 'hidden' },
            }}
        >
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

            <Paper
                variant="outlined"
                sx={{
                    p: 1.5,
                    borderRadius: 2,
                    flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(255,255,255,1) 0%, rgba(241,245,249,0.96) 100%)',
                }}
            >
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }} useFlexGap flexWrap="wrap">
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <DatePicker label="开始日期" value={startDate} onChange={setStartDate} slotProps={{ textField: { size: 'small', sx: { width: { xs: '100%', sm: 150 } } } }} />
                        <Typography variant="body2" color="text.secondary">-</Typography>
                        <DatePicker label="结束日期" value={endDate} onChange={setEndDate} slotProps={{ textField: { size: 'small', sx: { width: { xs: '100%', sm: 150 } } } }} />
                    </Stack>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                        <Button size="small" variant="outlined" onClick={() => applyRange('thisMonth')}>本月</Button>
                        <Button size="small" variant="outlined" onClick={() => applyRange('lastMonth')}>上月</Button>
                        <Button size="small" variant="outlined" onClick={() => applyRange('30d')}>30天</Button>
                        <Button size="small" variant="outlined" onClick={() => applyRange('60d')}>60天</Button>
                        <Button size="small" variant="outlined" onClick={() => applyRange('thisYear')}>本年</Button>
                    </Stack>
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={metric}
                        onChange={(_event, value) => value && setMetric(value)}
                        sx={{ ml: { md: 'auto' }, width: { xs: '100%', sm: 'auto' } }}
                    >
                        <ToggleButton value="amount">金额收益</ToggleButton>
                        <ToggleButton value="business">业务量</ToggleButton>
                    </ToggleButtonGroup>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    仅统计已完成单日复盘的申报记录，未复盘日期不纳入收益汇总。
                </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, flexShrink: 0 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: 'repeat(2, minmax(0, 1fr))',
                            sm: 'repeat(4, minmax(0, 1fr))',
                            lg: 'repeat(6, minmax(0, 1fr))',
                        },
                        gap: 0.75,
                    }}
                >
                    {metricCards.map((item) => (
                        <Box
                            key={item.label}
                            sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                px: 0.85,
                                py: 0.55,
                                bgcolor: 'grey.50',
                                minHeight: 48,
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                            }}
                        >
                            <Typography variant="caption" color="text.secondary" noWrap>{item.label}</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: item.color || 'text.primary', lineHeight: 1.2, wordBreak: 'break-word' }}>
                                {item.value}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Paper>

            <Paper
                variant="outlined"
                sx={{
                    p: 0,
                    borderRadius: 2,
                    flex: { xs: 'none', md: '1 1 0' },
                    minHeight: { xs: 520, md: 0 },
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {loading && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(255,255,255,0.64)',
                        }}
                    >
                        <CircularProgress size={22} />
                    </Box>
                )}
                <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>策略收益趋势</Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ ml: { md: 'auto' } }}>
                        <Stack direction="row" spacing={0.5} alignItems="center"><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: CUMULATIVE_COLOR }} /><Typography variant="caption">累计收益</Typography></Stack>
                        <Stack direction="row" spacing={0.5} alignItems="center"><Box sx={{ width: 10, height: 10, bgcolor: ENERGY_COLOR }} /><Typography variant="caption">电能量收益</Typography></Stack>
                        <Stack direction="row" spacing={0.5} alignItems="center"><Box sx={{ width: 10, height: 10, bgcolor: FM_COLOR }} /><Typography variant="caption">调频收益</Typography></Stack>
                    </Stack>
                    <Tabs value={viewMode} onChange={(_event, value) => setViewMode(value)} variant="scrollable" scrollButtons="auto" sx={{ ml: { md: 1 } }}>
                        <Tab label="图表" />
                        <Tab label="表格" />
                    </Tabs>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 1.5 }}>
                    {rows.length === 0 && !loading ? (
                        <Alert severity="info">当前区间暂无已复盘申报数据，请先在单日复盘中完成复盘模拟。</Alert>
                    ) : viewMode === 0 ? (
                        <Box
                            ref={chartRef}
                            sx={{
                                height: { xs: 440, md: '100%' },
                                minHeight: { xs: 440, md: 0 },
                                display: 'flex',
                                flexDirection: 'column',
                                minWidth: 0,
                                backgroundColor: fullscreen.isFullscreen ? 'background.paper' : 'transparent',
                                p: fullscreen.isFullscreen ? 2 : 0,
                                position: 'relative',
                                ...(fullscreen.isFullscreen && {
                                    position: 'fixed',
                                    top: 0,
                                    left: 0,
                                    width: '100vw',
                                    height: '100vh',
                                    zIndex: 1400,
                                }),
                                '& .recharts-surface:focus': { outline: 'none' },
                                '& *:focus': { outline: 'none !important' },
                            }}
                        >
                            <fullscreen.FullscreenEnterButton />
                            <fullscreen.FullscreenExitButton />
                            <fullscreen.FullscreenTitle />
                            <Box sx={{ flex: '3 1 0', minHeight: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartRows} syncId="storage-profit" margin={{ top: 12, right: chartRight, left: chartLeft, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" hide />
                                        <YAxis
                                            width={yAxisWidth}
                                            tick={{ fontSize: isMobile ? 10 : 12 }}
                                            label={isMobile ? undefined : { value: '累计收益(万元)', angle: -90, position: 'insideLeft', offset: -40 }}
                                        />
                                        <RechartsTooltip content={<ProfitTooltip />} wrapperStyle={{ zIndex: 1401 }} />
                                        <Line type="monotone" dataKey="cumulativeRevenueWan" name="累计收益" stroke={CUMULATIVE_COLOR} strokeWidth={2.4} dot={{ r: 2 }} isAnimationActive={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                            <Box sx={{ flex: '2 1 0', minHeight: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartRows} syncId="storage-profit" margin={{ top: 8, right: chartRight, left: chartLeft, bottom: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.slice(5)} interval={dateTickInterval} height={36} />
                                        <YAxis
                                            width={yAxisWidth}
                                            tick={{ fontSize: isMobile ? 10 : 12 }}
                                            label={isMobile ? undefined : { value: metric === 'amount' ? '当日收益(万元)' : '业务量', angle: -90, position: 'insideLeft', offset: -40 }}
                                        />
                                        <RechartsTooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
                                        {metric === 'amount' ? (
                                            <>
                                                <Bar dataKey="energyRevenueWan" name="电能量收益" stackId="revenue" fill={ENERGY_COLOR} isAnimationActive={false} />
                                                <Bar dataKey="fmRevenueWan" name="调频收益" stackId="revenue" fill={FM_COLOR} isAnimationActive={false} />
                                            </>
                                        ) : (
                                            <>
                                                <Bar dataKey="chargeMwh" name="充电电量" fill="#93c5fd" isAnimationActive={false} />
                                                <Bar dataKey="dischargeMwh" name="放电电量" fill={ENERGY_COLOR} isAnimationActive={false} />
                                                <Line type="monotone" dataKey="fmMileage" name="调频里程" stroke={FM_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                                            </>
                                        )}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                        </Box>
                    ) : (
                        <TableContainer sx={{ height: '100%', minHeight: { xs: 360, md: 260 }, borderRadius: 2, border: 1, borderColor: 'divider', overflowX: 'auto' }}>
                            <Table stickyHeader size="small" sx={{ minWidth: 980 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>日期</TableCell>
                                        <TableCell align="right">当日收益</TableCell>
                                        <TableCell align="right">电能量收益</TableCell>
                                        <TableCell align="right">调频收益</TableCell>
                                        <TableCell align="right">充电电量</TableCell>
                                        <TableCell align="right">放电电量</TableCell>
                                        <TableCell align="right">损耗电量</TableCell>
                                        <TableCell align="right">中标时段</TableCell>
                                        <TableCell align="right">调频里程</TableCell>
                                        <TableCell align="right">出清均价</TableCell>
                                        <TableCell align="right">时段收益</TableCell>
                                        <TableCell align="right">操作</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rows.map((row) => (
                                        <TableRow key={row.date} hover>
                                            <TableCell>{row.date}</TableCell>
                                            <TableCell align="right">{formatMoney(row.total_revenue)}</TableCell>
                                            <TableCell align="right">{formatMoney(row.energy_revenue)}</TableCell>
                                            <TableCell align="right">{formatMoney(row.fm_revenue)}</TableCell>
                                            <TableCell align="right">{formatMwh(row.charge_mwh)}</TableCell>
                                            <TableCell align="right">{formatMwh(row.discharge_mwh)}</TableCell>
                                            <TableCell align="right">{formatMwh(row.loss_mwh)}</TableCell>
                                            <TableCell align="right">{row.winning_hours}/24</TableCell>
                                            <TableCell align="right">{formatNumber(row.fm_mileage, 2)} MW</TableCell>
                                            <TableCell align="right">{formatNumber(row.avg_clearing_price, 2)} 元/MW</TableCell>
                                            <TableCell align="right">{formatMoney(row.fm_period_revenue)}/时段</TableCell>
                                            <TableCell align="right">
                                                <Button size="small" onClick={() => onOpenReview?.(row.date)}>查看复盘</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

export default RevenueForecastTab;
