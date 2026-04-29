import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    IconButton,
    Select,
    MenuItem,
    FormControl,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Drawer,
    Divider,
    CircularProgress,
    Alert,
    Tooltip,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import BarChartIcon from '@mui/icons-material/BarChart';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, addDays } from 'date-fns';
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ReferenceLine,
    ReferenceArea,
} from 'recharts';
import apiClient from '../api/client';

interface DayItem {
    cj_time: string;
    label: string;
    weekday: string;
    sum_energy: number | null;
}

interface PeriodQuote {
    period: number;
    time_label: string;
    sf_energy: number | null;
    gf_energy: number | null;
    last_price: number | null;
    last_energy: number | null;
    sum_energy: number | null;
    sum_price: number | null;
}

interface QuotesData {
    jy_time: string;
    cj_time: string;
    snapshot_slot: string;
    summary: Record<string, number> | null;
    periods: PeriodQuote[];
}

interface HistoryPoint {
    jy_time: string;
    snapshot_slot: string;
    x_label: string;
    sum_price: number | null;
    sum_energy: number | null;
    sf_energy: number | null;
    gf_energy: number | null;
}

interface PeriodHistoryData {
    cj_time: string;
    period: number;
    history: HistoryPoint[];
}

const VALID_MORNING = ['09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'];
const VALID_AFTERNOON = ['14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00', '16:15', '16:30'];
const ALL_VALID_SLOTS = [...VALID_MORNING, ...VALID_AFTERNOON];

function getMarketStatus(selectedDate: Date, selectedSlot: string): { label: string; color: 'error' | 'default' | 'primary' } {
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const selStr = format(selectedDate, 'yyyy-MM-dd');
    if (selStr !== today) return { label: '已收盘', color: 'primary' };
    const nowTime = format(now, 'HH:mm');
    if (nowTime < '09:30') return { label: '未开盘', color: 'default' };
    if (nowTime > '16:30') return { label: '已收盘', color: 'primary' };
    return { label: '交易中', color: 'error' };
}

function getLatestValidSlot(): string {
    const now = new Date();
    const nowTime = format(now, 'HH:mm');
    const passed = ALL_VALID_SLOTS.filter((s) => s <= nowTime);
    return passed.length > 0 ? passed[passed.length - 1] : ALL_VALID_SLOTS[0];
}

function fmt(val: number | null | undefined, digits = 1): string {
    if (val == null) return '-';
    return val.toFixed(digits);
}

function getPeriodTypeColor(timeLabel: string): string {
    if (!timeLabel) return '#9e9e9e';
    const t = timeLabel;
    if (t.includes('尖')) return '#b71c1c';
    if (t.includes('峰')) return '#e65100';
    if (t.includes('谷')) return '#1565c0';
    if (t.includes('深谷')) return '#0d47a1';
    return '#9e9e9e';
}

const PeriodTable: React.FC<{
    periods: PeriodQuote[];
    prevPeriods: PeriodQuote[];
    onChartClick: (period: PeriodQuote) => void;
}> = ({ periods, prevPeriods, onChartClick }) => {
    const getPrevPrice = (periodNum: number) => prevPeriods.find((p) => p.period === periodNum)?.last_price ?? null;

    const renderRow = (p: PeriodQuote) => {
        const prev = getPrevPrice(p.period);
        const diff = p.last_price != null && prev != null ? p.last_price - prev : null;
        const diffPct = diff != null && prev != null && prev !== 0 ? (diff / prev) * 100 : null;
        const netHang = p.gf_energy != null && p.sf_energy != null ? p.gf_energy - p.sf_energy : null;
        const isUp = diff != null && diff > 0;
        const isDown = diff != null && diff < 0;
        const priceColor = isUp ? '#d32f2f' : isDown ? '#388e3c' : 'inherit';
        const netHangBg = netHang == null ? 'transparent' : netHang > 0 ? 'rgba(211,47,47,0.08)' : netHang < 0 ? 'rgba(56,142,60,0.08)' : 'transparent';
        const typeColor = getPeriodTypeColor(p.time_label);

        return (
            <TableRow key={p.period} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                <TableCell sx={{ p: 0.5, pl: 0, position: 'relative' }}>
                    <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: typeColor }} />
                    <Box sx={{ pl: 1 }}>{p.period}</Box>
                </TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                    {p.time_label ? p.time_label.split('(')[0].trim() : '-'}
                </TableCell>
                <TableCell sx={{ p: 0.5, color: priceColor, fontWeight: 'bold' }}>{fmt(p.last_price)}</TableCell>
                <TableCell sx={{ p: 0.5, color: priceColor, fontSize: '0.75rem' }}>
                    {diff == null ? '-' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                </TableCell>
                <TableCell sx={{ p: 0.5, color: priceColor, fontSize: '0.75rem' }}>
                    {diffPct == null ? '-' : `${diffPct > 0 ? '+' : ''}${fmt(diffPct)}%`}
                </TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.75rem' }}>{fmt(p.sf_energy)}</TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.75rem' }}>{fmt(p.gf_energy)}</TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.75rem', bgcolor: netHangBg }}>
                    {netHang == null ? '-' : `${netHang > 0 ? '+' : ''}${fmt(netHang)}`}
                </TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.75rem' }}>{fmt(p.sum_energy)}</TableCell>
                <TableCell sx={{ p: 0.5, fontSize: '0.75rem' }}>{fmt(p.sum_price)}</TableCell>
                <TableCell sx={{ p: 0.5 }}>
                    <Tooltip title="查看历史走势">
                        <IconButton size="small" onClick={() => onChartClick(p)}>
                            <BarChartIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                </TableCell>
            </TableRow>
        );
    };

    const colHeaders = (
        <TableRow sx={{ bgcolor: 'background.default' }}>
            <TableCell sx={{ p: 0.5, pl: 1, fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>时段</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>时间</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>最新价</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>涨跌</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>涨跌%</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>卖挂</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>买挂</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>净挂</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>成交量</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>均价</TableCell>
            <TableCell sx={{ p: 0.5, fontWeight: 'bold', fontSize: '0.75rem' }}>操作</TableCell>
        </TableRow>
    );

    const left = periods.filter((p) => p.period <= 24);
    const right = periods.filter((p) => p.period > 24);

    return (
        <Box sx={{ display: 'flex', gap: 1, flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
            <TableContainer component={Box} sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <Table size="small" stickyHeader>
                    <TableHead>{colHeaders}</TableHead>
                    <TableBody>{left.map(renderRow)}</TableBody>
                </Table>
            </TableContainer>
            <Divider orientation="vertical" flexItem />
            <TableContainer component={Box} sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <Table size="small" stickyHeader>
                    <TableHead>{colHeaders}</TableHead>
                    <TableBody>{right.map(renderRow)}</TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

const DRAWER_YAXIS_W = 52;
const DRAWER_CHART_R = 16;

const PeriodHistoryDrawer: React.FC<{
    open: boolean;
    onClose: () => void;
    cjTime: string;
    period: PeriodQuote | null;
    periods: PeriodQuote[];
    onPeriodChange: (period: PeriodQuote) => void;
}> = ({ open, onClose, cjTime, period, periods, onPeriodChange }) => {
    const [historyData, setHistoryData] = useState<PeriodHistoryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hoveredX, setHoveredX] = useState<string | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; w: number } | null>(null);

    const fetchHistory = useCallback(async () => {
        if (!period || !cjTime) return;
        setLoading(true);
        setError(null);
        setHistoryData(null);
        try {
            const resp = await apiClient.get('/api/v1/rolling-match/period-history', {
                params: { cj_time: cjTime, period: period.period },
            });
            setHistoryData(resp.data);
        } catch (e: any) {
            setError(e.response?.data?.detail || '加载失败');
        } finally {
            setLoading(false);
        }
    }, [cjTime, period?.period]);

    useEffect(() => {
        if (open && period) fetchHistory();
    }, [open, fetchHistory]);

    const chartData = useMemo(() => {
        const h = historyData?.history ?? [];
        return h.map((pt) => ({
            ...pt,
            net_hang: pt.gf_energy != null && pt.sf_energy != null ? +(pt.gf_energy - pt.sf_energy).toFixed(1) : null,
            sum_price: pt.sum_energy == null || pt.sum_energy === 0 ? null : pt.sum_price,
        }));
    }, [historyData]);

    // 按交易日分组，用于交替色带和日期标注
    const dateGroups = useMemo(() => {
        const groups: { jy_time: string; first: string; last: string; count: number }[] = [];
        let cur: string | null = null;
        let firstX = '';
        let lastX = '';
        let cnt = 0;
        for (const pt of chartData) {
            if (pt.jy_time !== cur) {
                if (cur !== null) groups.push({ jy_time: cur, first: firstX, last: lastX, count: cnt });
                cur = pt.jy_time;
                firstX = pt.x_label;
                cnt = 0;
            }
            lastX = pt.x_label;
            cnt++;
        }
        if (cur !== null) groups.push({ jy_time: cur, first: firstX, last: lastX, count: cnt });
        return groups;
    }, [chartData]);

    const hoveredPoint = chartData.find((d) => d.x_label === hoveredX) ?? null;

    const tooltipSx = useMemo(() => {
        if (!tooltipPos) return { top: 12, right: 16 };
        const tw = 170;
        const placeLeft = tooltipPos.x <= tooltipPos.w - tw - 20;
        return {
            left: placeLeft ? tooltipPos.x + 12 : tooltipPos.x - tw - 12,
            top: Math.max(tooltipPos.y - 10, 8),
        };
    }, [tooltipPos]);

    const handleChartMouseMove = (state: any) => {
        if (state?.activeLabel) setHoveredX(state.activeLabel as string);
        else setHoveredX(null);
    };

    const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width });
    };

    const handleMouseLeave = () => {
        setHoveredX(null);
        setTooltipPos(null);
    };

    const tickFormatter = (v: string) => (v.length >= 5 ? v.slice(-5) : v);

    const bandFill = (idx: number) => (idx % 2 === 0 ? 'rgba(25,118,210,0.06)' : 'transparent');

    return (
        <Drawer
            anchor="right"
            open={open}
            onClose={onClose}
            sx={{
                '& .MuiDrawer-paper': {
                    top: { xs: 56, sm: 64 },
                    height: { xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)' },
                    width: { xs: '95vw', md: '65vw' },
                    display: 'flex',
                    flexDirection: 'column',
                },
            }}
        >
            {/* ── 标题栏：关闭 | 交割日+标题 | 时段选择器 ── */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'stretch',
                    borderBottom: 1,
                    borderColor: 'divider',
                    flexShrink: 0,
                    bgcolor: 'background.default',
                    minHeight: 56,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, flexShrink: 0 }}>
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
                <Divider orientation="vertical" flexItem />
                <Box sx={{ flex: 1, minWidth: 0, px: 2, py: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
                        交割日 {cjTime}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                        {period
                            ? `时段 ${period.period}${period.time_label ? '  ' + period.time_label.split('(')[0].trim() : ''}  历史走势`
                            : '时段历史走势'}
                    </Typography>
                </Box>
                {period && (
                    <>
                        <Divider orientation="vertical" flexItem />
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, gap: 1, flexShrink: 0 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                切换时段
                            </Typography>
                            <FormControl size="small" sx={{ minWidth: 180, maxWidth: 260 }}>
                                <Select
                                    value={period.period}
                                    onChange={(e) => {
                                        const p = periods.find((x) => x.period === Number(e.target.value));
                                        if (p) onPeriodChange(p);
                                    }}
                                >
                                    {periods.map((p) => (
                                        <MenuItem key={p.period} value={p.period}>
                                            时段 {p.period}
                                            {p.time_label ? `  ${p.time_label.split('(')[0].trim()}` : ''}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>
                    </>
                )}
            </Box>

            {/* ── 图表区域 ── */}
            <Box sx={{ flex: 1, minHeight: 0, px: 2, pt: 1.5, pb: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                        <CircularProgress />
                    </Box>
                )}
                {error && <Alert severity="error">{error}</Alert>}
                {!loading && !error && chartData.length === 0 && (
                    <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                        暂无历史数据
                    </Typography>
                )}
                {!loading && chartData.length > 0 && (
                    <Box
                        onMouseMove={handleContainerMouseMove}
                        onMouseLeave={handleMouseLeave}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                            '& .recharts-surface:focus': { outline: 'none' },
                            '& *:focus': { outline: 'none !important' },
                        }}
                    >
                        {/* 悬浮 Tooltip */}
                        {hoveredPoint && (
                            <Paper
                                variant="outlined"
                                sx={{
                                    position: 'absolute',
                                    zIndex: 3,
                                    px: 1.5,
                                    py: 1,
                                    minWidth: 155,
                                    pointerEvents: 'none',
                                    boxShadow: '0 8px 20px rgba(15,23,42,0.10)',
                                    ...tooltipSx,
                                }}
                            >
                                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                                    {hoveredPoint.jy_time}  {hoveredPoint.snapshot_slot}
                                </Typography>
                                <Typography variant="caption" sx={{ display: 'block' }}>
                                    均价：{hoveredPoint.sum_price != null ? `${hoveredPoint.sum_price.toFixed(1)} 元/MWh` : '—'}
                                </Typography>
                                <Typography variant="caption" sx={{ display: 'block' }}>
                                    成交量：{hoveredPoint.sum_energy != null ? `${hoveredPoint.sum_energy.toFixed(1)} MWh` : '—'}
                                </Typography>
                                <Typography variant="caption" sx={{ display: 'block' }}>
                                    净挂量：{hoveredPoint.net_hang != null ? `${hoveredPoint.net_hang.toFixed(1)} MWh` : '—'}
                                </Typography>
                            </Paper>
                        )}

                        {/* 上图：均价走势（隐藏X轴刻度） */}
                        <Box sx={{ flex: '0 0 54%', minHeight: 0 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart
                                    data={chartData}
                                    syncId="period-history"
                                    margin={{ top: 8, right: DRAWER_CHART_R, left: 0, bottom: 0 }}
                                    onMouseMove={handleChartMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="x_label" hide />
                                    <YAxis
                                        width={DRAWER_YAXIS_W}
                                        tick={{ fontSize: 10 }}
                                        label={{ value: '元/MWh', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10 }}
                                    />
                                    {dateGroups.map((g, idx) => (
                                        <ReferenceArea key={g.jy_time} x1={g.first} x2={g.last} fill={bandFill(idx)} stroke="none" ifOverflow="hidden" />
                                    ))}
                                    {hoveredX && <ReferenceLine x={hoveredX} stroke="#64748b" strokeDasharray="4 4" />}
                                    <Line type="monotone" dataKey="sum_price" stroke="#1565c0" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} name="成交均价" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Box>

                        {/* 下图：成交量 & 净挂量（显示时间刻度） */}
                        <Box sx={{ flex: '0 0 38%', minHeight: 0 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart
                                    data={chartData}
                                    syncId="period-history"
                                    margin={{ top: 0, right: DRAWER_CHART_R, left: 0, bottom: 4 }}
                                    onMouseMove={handleChartMouseMove}
                                    onMouseLeave={handleMouseLeave}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="x_label"
                                        tick={{ fontSize: 10 }}
                                        tickFormatter={tickFormatter}
                                        interval="preserveStartEnd"
                                        height={20}
                                    />
                                    <YAxis
                                        width={DRAWER_YAXIS_W}
                                        tick={{ fontSize: 10 }}
                                        label={{ value: 'MWh', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10 }}
                                    />
                                    <ReferenceLine y={0} stroke="#94a3b8" />
                                    {dateGroups.map((g, idx) => (
                                        <ReferenceArea key={g.jy_time} x1={g.first} x2={g.last} fill={bandFill(idx)} stroke="none" ifOverflow="hidden" />
                                    ))}
                                    {hoveredX && <ReferenceLine x={hoveredX} stroke="#64748b" strokeDasharray="4 4" />}
                                    <Bar dataKey="sum_energy" name="成交量" fill="#42a5f5" isAnimationActive={false} />
                                    <Line type="monotone" dataKey="net_hang" name="净挂量" stroke="#ef5350" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Box>

                        {/* 交易日期区域标注行（紧接下图X轴之下，按数据比例对齐） */}
                        <Box
                            sx={{
                                display: 'flex',
                                height: 18,
                                flexShrink: 0,
                                pl: `${DRAWER_YAXIS_W}px`,
                                pr: `${DRAWER_CHART_R}px`,
                                borderTop: 1,
                                borderColor: 'divider',
                            }}
                        >
                            {dateGroups.map((g, idx) => (
                                <Box
                                    key={g.jy_time}
                                    sx={{
                                        flex: g.count,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        bgcolor: bandFill(idx),
                                        borderLeft: idx > 0 ? '1px solid' : 'none',
                                        borderColor: 'divider',
                                        overflow: 'hidden',
                                        minWidth: 0,
                                    }}
                                >
                                    <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', lineHeight: 1, whiteSpace: 'nowrap' }}>
                                        {g.jy_time.slice(5)}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}
            </Box>
        </Drawer>
    );
};

const RollingMatchQuotesPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [rounds, setRounds] = useState<string[]>([]);
    const [selectedRound, setSelectedRound] = useState<string>('');
    const [days, setDays] = useState<DayItem[]>([]);
    const [selectedCjTime, setSelectedCjTime] = useState<string>('');
    const [quotesData, setQuotesData] = useState<QuotesData | null>(null);
    const [prevQuotesData, setPrevQuotesData] = useState<QuotesData | null>(null);
    const [loadingDays, setLoadingDays] = useState(false);
    const [loadingRounds, setLoadingRounds] = useState(false);
    const [loadingQuotes, setLoadingQuotes] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerPeriod, setDrawerPeriod] = useState<PeriodQuote | null>(null);

    const jyTime = format(selectedDate, 'yyyy-MM-dd');
    const status = getMarketStatus(selectedDate, selectedRound);

    const fetchRounds = useCallback(async (jy: string) => {
        setLoadingRounds(true);
        try {
            const resp = await apiClient.get('/api/v1/rolling-match/rounds', { params: { jy_time: jy } });
            const slots: string[] = resp.data.rounds || [];
            setRounds(slots);
            if (slots.length > 0) {
                const latest = getLatestValidSlot();
                const best = slots.includes(latest) ? latest : slots[slots.length - 1];
                setSelectedRound(best);
            } else {
                setSelectedRound('');
            }
        } catch (e: any) {
            setError(e.response?.data?.detail || '加载轮次失败');
        } finally {
            setLoadingRounds(false);
        }
    }, []);

    const fetchDays = useCallback(async (jy: string) => {
        setLoadingDays(true);
        try {
            const resp = await apiClient.get('/api/v1/rolling-match/days', { params: { jy_time: jy } });
            const data: DayItem[] = resp.data || [];
            setDays(data);
            if (data.length > 0 && !selectedCjTime) {
                setSelectedCjTime(data[0].cj_time);
            }
        } catch (e: any) {
            setError(e.response?.data?.detail || '加载标的列表失败');
        } finally {
            setLoadingDays(false);
        }
    }, [selectedCjTime]);

    const fetchQuotes = useCallback(async (jy: string, cj: string, slot: string) => {
        if (!jy || !cj || !slot) return;
        setLoadingQuotes(true);
        try {
            const resp = await apiClient.get('/api/v1/rolling-match/quotes', {
                params: { jy_time: jy, cj_time: cj, snapshot_slot: slot },
            });
            setPrevQuotesData(quotesData);
            setQuotesData(resp.data);
        } catch (e: any) {
            setError(e.response?.data?.detail || '加载行情数据失败');
        } finally {
            setLoadingQuotes(false);
        }
    }, [quotesData]);

    useEffect(() => {
        setError(null);
        fetchDays(jyTime);
        fetchRounds(jyTime);
        setSelectedCjTime('');
        setQuotesData(null);
    }, [jyTime]);

    useEffect(() => {
        if (days.length > 0 && !selectedCjTime) {
            setSelectedCjTime(days[0].cj_time);
        }
    }, [days]);

    useEffect(() => {
        if (selectedCjTime && selectedRound) {
            fetchQuotes(jyTime, selectedCjTime, selectedRound);
        }
    }, [selectedCjTime, selectedRound, jyTime]);

    const handleRoundPrev = () => {
        const idx = rounds.indexOf(selectedRound);
        if (idx > 0) setSelectedRound(rounds[idx - 1]);
    };

    const handleRoundNext = () => {
        const idx = rounds.indexOf(selectedRound);
        if (idx < rounds.length - 1) setSelectedRound(rounds[idx + 1]);
    };

    const handleDatePrev = () => setSelectedDate((d) => addDays(d, -1));
    const handleDateNext = () => setSelectedDate((d) => addDays(d, 1));

    // 刷新并跳回最新记录（今日交易日 + 最新轮次 + D+2标的）
    const handleRefreshToLatest = useCallback(async () => {
        const today = new Date();
        const todayStr = format(today, 'yyyy-MM-dd');
        setError(null);
        setQuotesData(null);

        if (todayStr !== jyTime) {
            // 切换到今日，useEffect([jyTime]) 会自动触发数据加载
            setSelectedCjTime('');
            setSelectedRound('');
            setSelectedDate(today);
            return;
        }

        // 当日：直接重新拉取并定位到最新
        setSelectedCjTime('');
        setSelectedRound('');
        setDays([]);
        setRounds([]);
        setLoadingDays(true);
        setLoadingRounds(true);
        try {
            const [daysResp, roundsResp] = await Promise.all([
                apiClient.get('/api/v1/rolling-match/days', { params: { jy_time: todayStr } }),
                apiClient.get('/api/v1/rolling-match/rounds', { params: { jy_time: todayStr } }),
            ]);
            const newDays: DayItem[] = daysResp.data || [];
            setDays(newDays);
            if (newDays.length > 0) setSelectedCjTime(newDays[0].cj_time);

            const newSlots: string[] = roundsResp.data.rounds || [];
            setRounds(newSlots);
            if (newSlots.length > 0) {
                const latest = getLatestValidSlot();
                setSelectedRound(newSlots.includes(latest) ? latest : newSlots[newSlots.length - 1]);
            }
        } catch (e: any) {
            setError(e.response?.data?.detail || '刷新失败');
        } finally {
            setLoadingDays(false);
            setLoadingRounds(false);
        }
    }, [jyTime]);

    const handleChartClick = (p: PeriodQuote) => {
        setDrawerPeriod(p);
        setDrawerOpen(true);
    };

    const periods = quotesData?.periods ?? [];
    const maxEnergy = useMemo(() => Math.max(...days.map((d) => d.sum_energy ?? 0), 0.01), [days]);

    return (
        <Box
            sx={{
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}
        >
            {isTablet && (
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'text.primary', mb: 1 }}>
                    交易策略 / 月内滚动行情
                </Typography>
            )}

            {/* 顶部控制栏 */}
            <Paper
                variant="outlined"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                    px: 2,
                    py: 1,
                    flexShrink: 0,
                }}
            >
                {/* 交易日快捷导航 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton size="small" onClick={handleDatePrev} disabled={loadingDays || loadingRounds}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
                        <DatePicker
                            label="交易日"
                            value={selectedDate}
                            onChange={(d) => d && setSelectedDate(d)}
                            slotProps={{ textField: { size: 'small', sx: { width: 160 } } }}
                        />
                    </LocalizationProvider>
                    <IconButton size="small" onClick={handleDateNext} disabled={loadingDays || loadingRounds}>
                        <ArrowRightIcon />
                    </IconButton>
                </Box>

                <Divider orientation="vertical" flexItem />

                {/* 轮次快捷导航 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton size="small" onClick={handleRoundPrev} disabled={loadingRounds || rounds.indexOf(selectedRound) <= 0}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <FormControl size="small" sx={{ minWidth: 100 }}>
                        <Select
                            value={selectedRound}
                            onChange={(e) => setSelectedRound(e.target.value)}
                            disabled={loadingRounds || rounds.length === 0}
                            displayEmpty
                        >
                            {rounds.length === 0 && <MenuItem value="">暂无轮次</MenuItem>}
                            {rounds.map((r) => (
                                <MenuItem key={r} value={r}>{r}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <IconButton size="small" onClick={handleRoundNext} disabled={loadingRounds || rounds.indexOf(selectedRound) >= rounds.length - 1}>
                        <ArrowRightIcon />
                    </IconButton>
                </Box>

                <Chip
                    label={status.label}
                    color={status.color}
                    size="small"
                    variant="filled"
                />

                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={handleRefreshToLatest}
                    disabled={loadingQuotes || loadingDays || loadingRounds}
                    sx={{ whiteSpace: 'nowrap' }}
                >
                    刷新
                </Button>

                {error && <Alert severity="error" sx={{ py: 0, flex: 1 }}>{error}</Alert>}
            </Paper>

            {/* 主体区：左栏 + 右侧表格 */}
            <Box sx={{ display: 'flex', flex: '1 1 0', minHeight: 0, gap: 1 }}>
                {/* 左栏：交割标的列表 */}
                <Paper
                    variant="outlined"
                    sx={{
                        width: 162,
                        flexShrink: 0,
                        display: { xs: 'none', md: 'flex' },
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    <Box
                        sx={{
                            px: 1.5,
                            py: 0.75,
                            bgcolor: 'background.default',
                            borderBottom: 1,
                            borderColor: 'divider',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                        }}
                    >
                        <Typography variant="caption" sx={{ fontWeight: 700, flex: 1, letterSpacing: 0.5 }}>
                            交割标的
                        </Typography>
                        {!loadingDays && days.length > 0 && (
                            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                                {days.length}个
                            </Typography>
                        )}
                    </Box>
                    <Box sx={{ flex: 1, overflowY: 'auto' }}>
                        {loadingDays ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={20} />
                            </Box>
                        ) : (
                            days.map((d) => {
                                const isSelected = d.cj_time === selectedCjTime;
                                const pct = d.sum_energy != null ? Math.round((d.sum_energy / maxEnergy) * 100) : 0;
                                return (
                                    <Box
                                        key={d.cj_time}
                                        onClick={() => setSelectedCjTime(d.cj_time)}
                                        sx={{
                                            px: 1.25,
                                            py: 0.9,
                                            cursor: 'pointer',
                                            position: 'relative',
                                            borderBottom: 1,
                                            borderColor: 'divider',
                                            bgcolor: isSelected ? 'rgba(25,118,210,0.07)' : 'transparent',
                                            transition: 'background-color 0.15s',
                                            '&:hover': { bgcolor: isSelected ? 'rgba(25,118,210,0.11)' : 'action.hover' },
                                            '&::before': isSelected
                                                ? {
                                                    content: '""',
                                                    position: 'absolute',
                                                    left: 0,
                                                    top: 0,
                                                    bottom: 0,
                                                    width: 3,
                                                    bgcolor: 'primary.main',
                                                    borderRadius: '0 2px 2px 0',
                                                }
                                                : {},
                                        }}
                                    >
                                        {/* 第一行：D+N 标签 + 日期 + 星期 */}
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                            <Box
                                                component="span"
                                                sx={{
                                                    fontSize: '0.58rem',
                                                    fontWeight: 700,
                                                    px: 0.6,
                                                    borderRadius: 0.5,
                                                    bgcolor: isSelected ? 'primary.main' : 'action.disabledBackground',
                                                    color: isSelected ? 'primary.contrastText' : 'text.secondary',
                                                    lineHeight: 1.7,
                                                    flexShrink: 0,
                                                    letterSpacing: 0.2,
                                                }}
                                            >
                                                {d.label}
                                            </Box>
                                            <Typography
                                                variant="caption"
                                                sx={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.72rem', flex: 1, lineHeight: 1.3 }}
                                            >
                                                {d.cj_time.slice(5)}
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    fontSize: '0.6rem',
                                                    color: isSelected ? 'primary.main' : 'text.disabled',
                                                    flexShrink: 0,
                                                    lineHeight: 1.3,
                                                }}
                                            >
                                                {d.weekday}
                                            </Typography>
                                        </Box>
                                        {/* 第二行：成交量进度条 + 数值 */}
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <Box
                                                sx={{
                                                    flex: 1,
                                                    height: 3,
                                                    bgcolor: 'action.disabledBackground',
                                                    borderRadius: 1.5,
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: `${pct}%`,
                                                        height: '100%',
                                                        bgcolor: isSelected ? 'primary.main' : 'text.disabled',
                                                        borderRadius: 1.5,
                                                        transition: 'width 0.3s ease',
                                                    }}
                                                />
                                            </Box>
                                            <Typography
                                                variant="caption"
                                                sx={{ fontSize: '0.6rem', color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1, flexShrink: 0 }}
                                            >
                                                {d.sum_energy != null ? `${Math.round(d.sum_energy)} MWh` : '—'}
                                            </Typography>
                                        </Box>
                                    </Box>
                                );
                            })
                        )}
                    </Box>
                </Paper>

                {/* 右侧 48 时段表格 */}
                <Paper
                    variant="outlined"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    {/* 表格头部信息 */}
                    <Box
                        sx={{
                            px: 1.5,
                            py: 0.75,
                            borderBottom: 1,
                            borderColor: 'divider',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            flexShrink: 0,
                        }}
                    >
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                            {selectedCjTime || '-'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            轮次：{selectedRound || '-'}
                        </Typography>
                        {quotesData?.summary && (
                            <>
                                <Typography variant="caption" color="text.secondary">
                                    成交量：{fmt(quotesData.summary.sum_energy)} MWh
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    均价：{fmt(quotesData.summary.sum_price)} 元/MWh
                                </Typography>
                            </>
                        )}
                        {loadingQuotes && <CircularProgress size={16} />}
                    </Box>

                    {/* 双列表格 */}
                    <Box sx={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', p: 0.5 }}>
                        {periods.length === 0 && !loadingQuotes ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                                <Typography color="text.secondary">
                                    {selectedCjTime && selectedRound ? '暂无数据' : '请选择交割日和轮次'}
                                </Typography>
                            </Box>
                        ) : (
                            <PeriodTable
                                periods={periods}
                                prevPeriods={prevQuotesData?.periods ?? []}
                                onChartClick={handleChartClick}
                            />
                        )}
                    </Box>
                </Paper>
            </Box>

            {/* 时段历史 Drawer */}
            <PeriodHistoryDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                cjTime={selectedCjTime}
                period={drawerPeriod}
                periods={periods}
                onPeriodChange={(p) => setDrawerPeriod(p)}
            />
        </Box>
    );
};

export default RollingMatchQuotesPage;
