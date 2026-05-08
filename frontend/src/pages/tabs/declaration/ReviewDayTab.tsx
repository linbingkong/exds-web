import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    IconButton,
    Paper,
    Stack,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { DatePicker } from '@mui/x-date-pickers';
import { addDays, format, parseISO } from 'date-fns';
import {
    Bar,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    StorageDeclaration,
    StorageStation,
    StorageStrategy,
    storageDeclarationApi,
    slotTimeLabel,
} from '../../../api/storageDeclaration';
import { useChartFullscreen } from '../../../hooks/useChartFullscreen';

interface ReviewDayTabProps {
    station: StorageStation;
    strategy: StorageStrategy;
    canEdit: boolean;
    targetDate?: string;
}

const CHART_LEFT = 52;
const CHART_RIGHT = 56;
const CHART_MARGIN_RIGHT = 8;

const formatMoney = (value?: number): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)} 万元`;
    return `${value.toFixed(2)} 元`;
};

const formatMwh = (value?: number): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return `${value.toFixed(2)} MWh`;
};

const formatNumber = (value?: number, digits = 2): string => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return value.toFixed(digits);
};

export const ReviewDayTab: React.FC<ReviewDayTabProps> = ({ station, strategy, canEdit, targetDate }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const initialDate = useMemo(() => addDays(new Date(), -1), []);
    const [date, setDate] = useState<Date | null>(initialDate);
    const [declaration, setDeclaration] = useState<StorageDeclaration | null>(null);
    const [loading, setLoading] = useState(false);
    const [simulating, setSimulating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const chartRef = useRef<HTMLDivElement>(null);
    const fullscreen = useChartFullscreen({ chartRef, title: '单日复盘图表' });

    const dateStr = useMemo(() => (date ? format(date, 'yyyy-MM-dd') : ''), [date]);

    useEffect(() => {
        if (targetDate) {
            setDate(parseISO(targetDate));
        }
    }, [targetDate]);

    useEffect(() => {
        if (!dateStr) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setInfo(null);
        storageDeclarationApi
            .getDeclaration(station.station_id, dateStr, strategy.strategy_id)
            .then((data) => {
                if (cancelled) return;
                setDeclaration(data);
                if (!data) setInfo('该日未生成申报数据');
            })
            .catch((e: any) => {
                if (cancelled) return;
                setDeclaration(null);
                setError(e?.response?.data?.detail || '加载申报记录失败');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [dateStr, station.station_id, strategy.strategy_id]);

    const readiness = declaration?.review_readiness;
    const canReview = readiness?.can_review === true;
    const metrics = canReview ? declaration?.review_metrics : undefined;
    const hasDeclaration = Boolean(declaration);
    const hasReview = Boolean(metrics);

    const energyChartData = useMemo(() => {
        if (canReview && declaration?.review_energy_slots_96?.length) {
            return declaration.review_energy_slots_96.map((row, index) => ({
                slot: index + 1,
                time: row.time_point || slotTimeLabel(index),
                chargeEnergy: row.charge_mwh ? -row.charge_mwh : 0,
                dischargeEnergy: row.discharge_mwh || 0,
                price: row.node_realtime_price || 0,
                soc: (row.soc || 0) * 100,
                reviewed: true,
            }));
        }
        return [];
    }, [canReview, declaration]);

    const fmChartData = useMemo(() => {
        if (canReview && declaration?.review_fm_slots_24?.length) {
            return declaration.review_fm_slots_24.map((row, index) => ({
                hour: row.hour || index + 1,
                label: `${String(index).padStart(2, '0')}:00`,
                outputBase: row.output_base_mw || 0,
                bidPrice: row.mileage_price || 0,
                clearingPrice: row.intraday_clearing_price || 0,
                isWinning: Boolean(row.is_winning),
                reviewed: true,
            }));
        }
        return [];
    }, [canReview, declaration]);

    const handleSimulate = async () => {
        if (!dateStr || !declaration) return;
        setSimulating(true);
        setError(null);
        setInfo(null);
        try {
            const updated = await storageDeclarationApi.simulateReview({
                station_id: station.station_id,
                strategy_id: strategy.strategy_id,
                target_date: dateStr,
            });
            setDeclaration(updated);
            setInfo('复盘模拟已完成');
        } catch (e: any) {
            setError(e?.response?.data?.detail || '复盘模拟失败');
        } finally {
            setSimulating(false);
        }
    };

    const simulateDisabled = !canEdit || !hasDeclaration || !canReview || loading || simulating;
    const simulateTip = !canEdit
        ? '无编辑权限，无法执行复盘模拟'
        : !hasDeclaration
            ? '该日未生成申报数据'
            : !canReview
                ? readiness?.message || '复盘数据未完整'
                : '';

    const fmPeriodRevenue = metrics && metrics.winning_hours > 0
        ? metrics.fm_revenue_per_winning_hour ?? metrics.fm_revenue / metrics.winning_hours
        : undefined;

    const metricCards = [
        { label: '当日收益', value: formatMoney(metrics?.total_revenue), color: (metrics?.total_revenue ?? 0) >= 0 ? 'success.main' : 'error.main' },
        { label: '电能量收益', value: formatMoney(metrics?.energy_revenue), color: 'success.main' },
        { label: '峰谷价差', value: metrics ? `${formatNumber(metrics.peak_valley_spread, 2)} 元/MWh` : '-' },
        { label: '充电电量', value: formatMwh(metrics?.charge_mwh) },
        { label: '充电电费', value: formatMoney(metrics?.charge_fee), tip: '充电电价 = LMP实时电价 + 上网环节线损 + 系统运行费 - 峰谷分时电价损益' },
        { label: '放电电量', value: formatMwh(metrics?.discharge_mwh) },
        { label: '放电收益', value: formatMoney(metrics?.discharge_revenue), tip: '放电电价 = LMP实时电价' },
        { label: '损耗电量', value: formatMwh(metrics?.loss_mwh) },
        { label: '损耗电费', value: formatMoney(metrics?.loss_fee), tip: '损耗电价 = 充电电价 + 输配电价 + 政府基金及附加' },
        { label: '调频收益', value: formatMoney(metrics?.fm_revenue), color: 'success.main' },
        { label: '中标时段', value: metrics ? `${metrics.winning_hours}/24` : '-' },
        { label: '调频里程', value: metrics ? `${formatNumber(metrics.fm_mileage, 2)} MW` : '-' },
        { label: '出清均价', value: metrics ? `${formatNumber(metrics.avg_clearing_price, 2)} 元/MW` : '-' },
        { label: '时段收益', value: metrics ? `${formatMoney(fmPeriodRevenue)}/时段` : '-' },
    ];

    const renderTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        return (
            <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{label}</Typography>
                {payload.map((item: any) => (
                    <Typography key={item.dataKey} variant="caption" component="div" sx={{ color: item.color }}>
                        {item.name}: {Number(item.value || 0).toFixed(2)}
                    </Typography>
                ))}
            </Paper>
        );
    };

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
            {info && <Alert severity={hasReview ? 'success' : 'info'} onClose={() => setInfo(null)}>{info}</Alert>}

            <Paper
                variant="outlined"
                sx={{
                    p: 1.5,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                    flexShrink: 0,
                }}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: { xs: 0, md: 1 } }}>复盘日期</Typography>
                <IconButton size="small" onClick={() => date && setDate(addDays(date, -1))} sx={{ border: 1, borderColor: 'divider' }}>
                    <ArrowLeftIcon fontSize="small" />
                </IconButton>
                <DatePicker
                    value={date}
                    onChange={setDate}
                    slotProps={{ textField: { size: 'small', sx: { width: { xs: 158, sm: 190 } } } }}
                />
                <IconButton size="small" onClick={() => date && setDate(addDays(date, 1))} sx={{ border: 1, borderColor: 'divider' }}>
                    <ArrowRightIcon fontSize="small" />
                </IconButton>
                <Chip size="small" label={declaration?.review_status || (hasDeclaration ? '未复盘' : '无申报')} color={hasReview ? 'success' : 'default'} />
                {loading && <Chip size="small" label="加载中..." />}
                <Box sx={{ flex: 1 }} />
                <Tooltip title={simulateTip}>
                    <span>
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<PlayArrowIcon />}
                            disabled={simulateDisabled}
                            onClick={handleSimulate}
                        >
                            {simulating ? '模拟中' : '复盘模拟'}
                        </Button>
                    </span>
                </Tooltip>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, flexShrink: 0 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: 'repeat(2, minmax(0, 1fr))',
                            sm: 'repeat(4, minmax(0, 1fr))',
                            lg: 'repeat(7, minmax(0, 1fr))',
                        },
                        gap: 1,
                    }}
                >
                    {metricCards.map((item) => (
                        <Box
                            key={item.label}
                            sx={{
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1,
                                px: 0.85,
                                py: 0.55,
                                bgcolor: 'background.default',
                                minHeight: 50,
                                minWidth: 0,
                            }}
                        >
                            <Stack direction="row" alignItems="center" spacing={0.35} sx={{ minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                                    {item.label}
                                </Typography>
                                {item.tip && (
                                    <Tooltip title={item.tip}>
                                        <HelpOutlineIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                                    </Tooltip>
                                )}
                            </Stack>
                            <Typography
                                variant="body2"
                                fontWeight={700}
                                noWrap
                                sx={{
                                    color: item.color || 'text.primary',
                                    mt: 0.2,
                                    fontSize: { xs: '0.78rem', md: '0.82rem' },
                                    lineHeight: 1.25,
                                }}
                            >
                                {item.value}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Paper>

            <Paper
                variant="outlined"
                sx={{
                    p: 1.5,
                    borderRadius: 2,
                    flex: 1,
                    minHeight: { xs: 620, md: 0 },
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>复盘图表</Typography>
                    <Stack direction="row" spacing={1.5} useFlexGap sx={{ fontSize: 12, color: 'text.secondary', flexWrap: 'wrap' }}>
                        <span style={{ color: '#2563eb' }}>● 放电电量</span>
                        <span style={{ color: '#38bdf8' }}>● 充电电量</span>
                        <span style={{ color: '#f97316' }}>● 节点实时价格</span>
                        <span style={{ color: '#7c3aed' }}>● SOC</span>
                        <span style={{ color: '#16a34a' }}>● 中标容量</span>
                        <span style={{ color: '#ef4444' }}>● 未中标容量</span>
                    </Stack>
                    <Box sx={{ flex: 1 }} />
                    {!hasReview && hasDeclaration && <Chip size="small" label={canReview ? '请先执行复盘模拟' : readiness?.message || '复盘数据未完整'} />}
                </Stack>

                <Box
                    ref={chartRef}
                    sx={{
                        position: 'relative',
                        flex: 1,
                        minHeight: { xs: 540, md: 0 },
                        bgcolor: fullscreen.isFullscreen ? 'background.paper' : 'transparent',
                        p: fullscreen.isFullscreen ? 2 : 0,
                        display: 'grid',
                        gridTemplateRows: 'minmax(0, 1.12fr) minmax(0, 0.88fr)',
                        gap: 1.5,
                        '& .recharts-surface:focus': { outline: 'none' },
                        '& *:focus': { outline: 'none !important' },
                    }}
                >
                    <fullscreen.FullscreenEnterButton />
                    <fullscreen.FullscreenExitButton />
                    <fullscreen.FullscreenTitle />

                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={energyChartData} margin={{ top: 8, right: CHART_MARGIN_RIGHT, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="slot" type="number" domain={[1, 96]} tick={{ fontSize: 11 }} interval={isMobile ? 15 : 7} />
                            <YAxis yAxisId="energy" width={CHART_LEFT} tick={{ fontSize: 11 }} label={{ value: '电量 MWh', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                            <YAxis yAxisId="price" orientation="right" width={CHART_RIGHT} tick={{ fontSize: 11 }} label={{ value: '元/MWh', angle: 90, position: 'insideRight', fontSize: 11 }} />
                            <YAxis yAxisId="soc" orientation="right" width={0} domain={[0, 100]} hide />
                            <RechartsTooltip content={renderTooltip} />
                            <ReferenceLine yAxisId="energy" y={0} stroke="#94a3b8" />
                            <Bar yAxisId="energy" dataKey="chargeEnergy" name="充电电量(MWh)" fill="#38bdf8" isAnimationActive={false} />
                            <Bar yAxisId="energy" dataKey="dischargeEnergy" name="放电电量(MWh)" fill="#2563eb" isAnimationActive={false} />
                            <Line yAxisId="price" type="monotone" dataKey="price" name="节点实时价格" stroke="#f97316" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                            <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC(%)" stroke="#7c3aed" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>

                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={fmChartData} margin={{ top: 8, right: CHART_MARGIN_RIGHT, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={isMobile ? 3 : 1} />
                            <YAxis yAxisId="capacity" width={CHART_LEFT} tick={{ fontSize: 11 }} label={{ value: '容量 MW', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                            <YAxis yAxisId="price" orientation="right" width={CHART_RIGHT} tick={{ fontSize: 11 }} label={{ value: '元/MW', angle: 90, position: 'insideRight', fontSize: 11 }} />
                            <RechartsTooltip content={renderTooltip} />
                            <Bar yAxisId="capacity" dataKey="outputBase" name="调频出力基值(MW)" isAnimationActive={false}>
                                {fmChartData.map((entry) => (
                                    <Cell
                                        key={entry.hour}
                                        fill={!entry.reviewed ? '#94a3b8' : entry.isWinning ? '#16a34a' : '#ef4444'}
                                    />
                                ))}
                            </Bar>
                            <Line yAxisId="price" type="monotone" dataKey="clearingPrice" name="日内出清价格" stroke="#f97316" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>
        </Box>
    );
};

export default ReviewDayTab;
