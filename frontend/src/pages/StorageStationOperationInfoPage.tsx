import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Grid,
    IconButton,
    Paper,
    Stack,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import {
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { addDays, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
    StationOperationPoint,
    StorageStation,
    storageDeclarationApi,
} from '../api/storageDeclaration';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

const SLOT_COUNT = 96;
const CHART_SYNC_ID = 'storage-station-operation-sync';

const DEMO_STATION: StorageStation = {
    station_id: 'demo_station',
    station_name: '演示储能电站',
    control_unit_name: '演示控制单元',
    node_name: '凌云站/500kV.Ⅰ母',
    voltage_level: '110',
    rated_power_mw: 50,
    rated_capacity_mwh: 100,
    is_hybrid: false,
    fm_power_mw: 25,
    fm_capacity_mwh: 50,
    charge_efficiency: 0.93,
    discharge_efficiency: 0.93,
    discharge_depth: 0.9,
    fm_k_value: 1,
    default_mileage_beta: 1,
    default_soc: 0.45,
    degradation_cost_per_mwh: 35,
    status: '启用',
};

const slotTimeLabel = (slotIndex: number): string => {
    const totalMinutes = (slotIndex + 1) * 15;
    if (totalMinutes >= 24 * 60) return '24:00';
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const hashSeed = (value: string): number => {
    let seed = 0;
    for (let i = 0; i < value.length; i += 1) {
        seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
    }
    return seed || 1;
};

const seededNoise = (seed: number, index: number): number => {
    const x = Math.sin(seed + index * 12.9898) * 43758.5453;
    return x - Math.floor(x);
};

const buildOperationData = (station: StorageStation, dateText: string): StationOperationPoint[] => {
    const seed = hashSeed(`${station.station_id}-${dateText}`);
    const ratedPower = Math.max(station.rated_power_mw || DEMO_STATION.rated_power_mw, 1);
    const ratedCapacity = Math.max(station.rated_capacity_mwh || DEMO_STATION.rated_capacity_mwh, 1);
    const chargeEfficiency = Math.max(station.charge_efficiency || station.efficiency || 0.93, 0.01);
    const dischargeEfficiency = Math.max(station.discharge_efficiency || station.efficiency || 0.93, 0.01);
    let soc = Math.max(0.1, Math.min(0.85, station.default_soc || 0.45));

    return Array.from({ length: SLOT_COUNT }, (_, i) => {
        const hour = Math.floor(i / 4);
        let sced = 0;
        if (hour >= 1 && hour < 4) sced = -ratedPower * 0.42;
        if (hour >= 10 && hour < 12) sced = ratedPower * 0.36;
        if (hour >= 18 && hour < 21) sced = ratedPower * 0.5;
        if (hour >= 22 && hour < 23) sced = -ratedPower * 0.28;

        const unitPower = sced + (seededNoise(seed, i) - 0.5) * ratedPower * 0.08;
        const meterPower = unitPower + (seededNoise(seed + 97, i) - 0.5) * ratedPower * 0.04;
        if (unitPower > 0) {
            soc -= (unitPower * 0.25) / (ratedCapacity * dischargeEfficiency);
        } else if (unitPower < 0) {
            soc += (Math.abs(unitPower) * chargeEfficiency * 0.25) / ratedCapacity;
        }
        soc = Math.max(0.05, Math.min(0.98, soc));

        return {
            time: slotTimeLabel(i),
            sced_mw: Number(sced.toFixed(3)),
            unit_power_mw: Number(unitPower.toFixed(3)),
            meter_power_mw: Number(meterPower.toFixed(3)),
            soc_percent: Number((soc * 100).toFixed(2)),
        };
    });
};

const formatMw = (value: number): string => `${value.toFixed(2)} MW`;
const formatMwh = (value: number): string => `${value.toFixed(2)} MWh`;
const formatPercent = (value?: number | null, digits = 1): string => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return `${(Number(value) * 100).toFixed(digits)}%`;
};
const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(digits);
};

const SharedOperationTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload.find((item: any) => item?.payload)?.payload ?? payload[0]?.payload;
    if (!row) return null;

    return (
        <Paper variant="outlined" sx={{ p: 1.25, pointerEvents: 'none' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                时刻 {row.time ?? label ?? '-'}
            </Typography>
            <Typography variant="body2">SCED指令：{formatMw(Number(row.sced_mw || 0))}</Typography>
            <Typography variant="body2">机组功率：{formatMw(Number(row.unit_power_mw || 0))}</Typography>
            <Typography variant="body2">电表计量功率：{formatMw(Number(row.meter_power_mw || 0))}</Typography>
            <Typography variant="body2">SOC：{Number(row.soc_percent || 0).toFixed(2)}%</Typography>
        </Paper>
    );
};

export const StorageStationOperationInfoPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [station, setStation] = useState<StorageStation>(DEMO_STATION);
    const [hasRealStation, setHasRealStation] = useState(false);
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState<{ severity: 'error' | 'info'; message: string } | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

    const chartRef = useRef<HTMLDivElement>(null);
    const chartFullscreen = useChartFullscreen({ chartRef, title: '电站运行曲线' });

    const dateText = useMemo(() => format(selectedDate || new Date(), 'yyyy-MM-dd'), [selectedDate]);
    const operationData = useMemo(() => buildOperationData(station, dateText), [station, dateText]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        storageDeclarationApi
            .listStations()
            .then((stations) => {
                if (cancelled) return;
                const first = stations[0];
                if (first) {
                    setStation(first);
                    setHasRealStation(true);
                    setFeedback(null);
                } else {
                    setStation(DEMO_STATION);
                    setHasRealStation(false);
                    setFeedback({ severity: 'info', message: '当前未接入真实电站，页面展示本地演示数据。' });
                }
            })
            .catch((e: any) => {
                if (cancelled) return;
                setStation(DEMO_STATION);
                setHasRealStation(false);
                setFeedback({ severity: 'error', message: e?.response?.data?.detail || '加载电站档案失败，已切换为演示数据。' });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const stationParamRows = [
        { label: '电站类型', value: station.is_hybrid ? '混合储能' : '独立储能' },
        { label: '额定功率', value: formatMw(station.rated_power_mw || 0) },
        { label: '额定容量', value: formatMwh(station.rated_capacity_mwh || 0) },
        { label: '调频功率', value: formatMw(station.fm_power_mw || 0) },
        { label: '调频容量', value: formatMwh(station.fm_capacity_mwh || 0) },
        { label: '充电效率', value: formatPercent(station.charge_efficiency ?? station.efficiency) },
        { label: '放电效率', value: formatPercent(station.discharge_efficiency ?? station.efficiency) },
        { label: '放电深度 DoD', value: formatPercent(station.discharge_depth) },
        { label: '调频 K 值', value: formatNumber(station.fm_k_value) },
        { label: '里程乘数 β', value: formatNumber(station.default_mileage_beta) },
        { label: '默认初始 SOC', value: formatPercent(station.default_soc) },
        { label: '度电衰减折旧', value: `${formatNumber(station.degradation_cost_per_mwh)} 元/MWh` },
    ];

    const stationIdentityRows = [
        { label: '电站名称', value: station.station_name || '--' },
        { label: '控制单元名称', value: station.control_unit_name || '--' },
        { label: '节点名称', value: station.node_name || '--' },
    ];

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box
                sx={{
                    width: '100%',
                    px: 0,
                    py: 0,
                    height: { xs: 'auto', md: '100%' },
                    display: 'flex',
                    flexDirection: 'column',
                    gap: { xs: 1.5, md: 1.5 },
                    overflow: { xs: 'visible', md: 'hidden' },
                    minHeight: 0,
                    minWidth: 0,
                }}
            >
                {isMobile && (
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        储能运营 / 电站运行信息
                    </Typography>
                )}

                {feedback && <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}

                <Paper variant="outlined" sx={{ p: { xs: 1, md: 1.25 }, borderRadius: 2, position: 'relative', flex: '0 0 auto' }}>
                    {loading && (
                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.65)', zIndex: 2 }}>
                            <CircularProgress size={24} />
                        </Box>
                    )}
                    {!hasRealStation && (
                        <Alert severity="warning" sx={{ mb: 1.25 }}>暂无真实电站档案，当前展示演示档案与演示曲线。</Alert>
                    )}

                    <Grid container spacing={1} sx={{ mb: 1 }}>
                        {stationIdentityRows.map((item) => (
                            <Grid key={item.label} size={{ xs: 12, md: 4 }}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="caption" color="text.secondary" noWrap>{item.label}</Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ mt: 0.25, fontWeight: 700, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        title={item.value}
                                    >
                                        {item.value}
                                    </Typography>
                                </Box>
                            </Grid>
                        ))}
                    </Grid>

                    <Grid container spacing={1}>
                        {stationParamRows.map((item) => (
                            <Grid key={item.label} size={{ xs: 6, sm: 4, md: 2 }}>
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        px: { xs: 0.9, md: 1 },
                                        py: { xs: 0.75, md: 0.85 },
                                        borderRadius: 1.5,
                                        height: '100%',
                                        bgcolor: 'background.default',
                                        minWidth: 0,
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary" noWrap>{item.label}</Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ mt: 0.25, fontWeight: 700, color: 'text.primary', wordBreak: 'break-word', lineHeight: 1.25 }}
                                    >
                                        {item.value}
                                    </Typography>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                </Paper>

                <Paper
                    variant="outlined"
                    sx={{
                        p: { xs: 1.25, md: 1.5 },
                        borderRadius: 2,
                        flex: { xs: '0 0 auto', md: '1 1 0' },
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: { xs: 'visible', md: 'hidden' },
                    }}
                >
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ lg: 'center' }} sx={{ mb: 1.5, flex: '0 0 auto' }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>电站运行数据</Typography>
                            <Typography variant="caption" color="text.secondary">当前曲线为前端演示数据，后续接入真实运行数据源。</Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <IconButton size="small" onClick={() => selectedDate && setSelectedDate(addDays(selectedDate, -1))} sx={{ border: 1, borderColor: 'divider', width: 36, height: 36 }}>
                                <ArrowLeftIcon fontSize="small" />
                            </IconButton>
                            <DatePicker
                                label="运行日期"
                                value={selectedDate}
                                onChange={setSelectedDate}
                                slotProps={{ textField: { size: 'small', sx: { width: { xs: '100%', sm: 180 } } } }}
                            />
                            <IconButton size="small" onClick={() => selectedDate && setSelectedDate(addDays(selectedDate, 1))} sx={{ border: 1, borderColor: 'divider', width: 36, height: 36 }}>
                                <ArrowRightIcon fontSize="small" />
                            </IconButton>
                            <Chip size="small" label="数据完整率 96/96" color="success" variant="outlined" />
                        </Stack>
                    </Stack>

                    <Box
                        ref={chartRef}
                        sx={{
                            position: 'relative',
                            height: chartFullscreen.isFullscreen ? '100vh' : { xs: 560, md: '100%' },
                            flex: { xs: '0 0 auto', md: '1 1 0' },
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            bgcolor: chartFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                            p: chartFullscreen.isFullscreen ? 2 : 0,
                            '& .recharts-surface:focus': { outline: 'none' },
                            '& *:focus': { outline: 'none !important' },
                        }}
                    >
                        <chartFullscreen.FullscreenEnterButton />
                        <chartFullscreen.FullscreenExitButton />
                        <chartFullscreen.FullscreenTitle />
                        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                            {[
                                { label: 'SCED指令', color: '#f97316' },
                                { label: '机组功率', color: '#2563eb' },
                                { label: '电表计量功率', color: '#16a34a' },
                                { label: 'SOC', color: '#9333ea' },
                            ].map((item) => (
                                <Stack key={item.label} direction="row" spacing={0.75} alignItems="center">
                                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                                    <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 1 }}>
                            <Box sx={{ flex: { xs: '3 1 0', md: '3 1 0' }, minHeight: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={operationData} syncId={CHART_SYNC_ID} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="time" hide />
                                        <YAxis tick={{ fontSize: 11 }} label={{ value: '功率 MW', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                                        <Tooltip content={<SharedOperationTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} wrapperStyle={{ zIndex: 1401 }} />
                                        <ReferenceLine y={0} stroke="#94a3b8" />
                                        <Line type="stepAfter" dataKey="sced_mw" stroke="#f97316" strokeWidth={1.8} dot={false} name="SCED指令" isAnimationActive={false} />
                                        <Line type="monotone" dataKey="unit_power_mw" stroke="#2563eb" strokeWidth={2} dot={false} name="机组功率" isAnimationActive={false} />
                                        <Line type="monotone" dataKey="meter_power_mw" stroke="#16a34a" strokeWidth={1.8} dot={false} name="电表计量功率" isAnimationActive={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                            <Box sx={{ flex: { xs: '2 1 0', md: '2 1 0' }, minHeight: 0 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={operationData} syncId={CHART_SYNC_ID} margin={{ top: 4, right: 24, left: 0, bottom: 12 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="time" interval={11} tick={{ fontSize: 11 }} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: 'SOC %', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                                        <Tooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
                                        <ReferenceLine y={Math.max(1 - station.discharge_depth, 0.05) * 100} stroke="#dc2626" strokeDasharray="3 3" label={{ value: 'SOC 下限', fontSize: 10 }} />
                                        <ReferenceLine y={100} stroke="#dc2626" strokeDasharray="3 3" label={{ value: 'SOC 上限', fontSize: 10 }} />
                                        <Line type="monotone" dataKey="soc_percent" stroke="#9333ea" strokeWidth={2} dot={false} name="SOC" isAnimationActive={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                        </Box>
                    </Box>
                </Paper>
            </Box>
        </LocalizationProvider>
    );
};

export default StorageStationOperationInfoPage;
