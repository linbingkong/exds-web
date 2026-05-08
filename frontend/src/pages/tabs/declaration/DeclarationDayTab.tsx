import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
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
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { addDays, format } from 'date-fns';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    Cell,
} from 'recharts';
import {
    EnergySlot,
    FmSlot,
    GenerateResult,
    StorageStation,
    StorageStrategy,
    simulateSoc,
    slotTimeLabel,
    storageDeclarationApi,
} from '../../../api/storageDeclaration';
import { useChartFullscreen } from '../../../hooks/useChartFullscreen';

interface DeclarationDayTabProps {
    station: StorageStation;
    strategy: StorageStrategy;
    canEdit: boolean;
    onSaved?: () => void;
}

const SLOT_COUNT = 96;
const HOUR_COUNT = 24;
const FM_PRICE_THRESHOLD_PARAM = 'fm_price_threshold';
const MAX_SOC_PARAM = 'max_soc';
const FM_PRICE_MIN = 6;
const FM_PRICE_MAX = 15;
const FM_OUTPUT_BASE_LIMIT_RATIO = 0.9;

const buildEmptyEnergy = (): EnergySlot[] =>
    Array.from({ length: SLOT_COUNT }, (_, i) => ({ time_point: slotTimeLabel(i), power_mw: 0 }));

const buildEmptyFm = (): FmSlot[] =>
    Array.from({ length: HOUR_COUNT }, (_, h) => ({
        period_start: `${String(h).padStart(2, '0')}:00`,
        period_end: h + 1 >= 24 ? '24:00' : `${String(h + 1).padStart(2, '0')}:00`,
        output_base_mw: 0,
        mileage_price: 0,
    }));

const hasUsableForecast = (prices?: number[]): boolean => {
    return Boolean(prices && prices.length >= SLOT_COUNT && prices.some((value) => Number(value) !== 0));
};

const formatApiErrorMessage = (detail: any, fallback: string): string => {
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail?.violations) && detail.violations.length > 0) return '风控校验失败，请修正后再提交';
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join('；') || fallback;
    if (detail?.message) return String(detail.message);
    return fallback;
};

const getFmPriceThreshold = (strategy: StorageStrategy): number => {
    const paramValue = strategy.strategy_params?.find((param) => param.param_key === FM_PRICE_THRESHOLD_PARAM)?.param_value;
    const parsed = Number(paramValue);
    return Number.isFinite(parsed) ? parsed : strategy.fm_price_threshold;
};

const getMaxSoc = (strategy: StorageStrategy): number => {
    const paramValue = strategy.strategy_params?.find((param) => param.param_key === MAX_SOC_PARAM)?.param_value;
    const parsed = Number(paramValue);
    if (!Number.isFinite(parsed)) return 0.9;
    return parsed > 1 ? parsed / 100 : parsed;
};

const formatMoney = (value: number): string => {
    if (!Number.isFinite(value)) return '-';
    if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)} 万元`;
    return `${value.toFixed(2)} 元`;
};

const EnergyTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload.find((item: any) => item?.payload)?.payload ?? payload[0]?.payload;
    if (!row) return null;
    return (
        <Paper variant="outlined" sx={{ p: 1.25, pointerEvents: 'none' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>时刻 {row.time ?? label ?? '-'}</Typography>
            <Typography variant="body2">充电：{Number(row.charge || 0).toFixed(3)} MW</Typography>
            <Typography variant="body2">放电：{Number(row.discharge || 0).toFixed(3)} MW</Typography>
            <Typography variant="body2">LMP预测：{Number(row.lmp || 0).toFixed(2)} 元/MWh</Typography>
            <Typography variant="body2">SOC：{Number(row.soc || 0).toFixed(2)}%</Typography>
        </Paper>
    );
};

const FmTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload.find((item: any) => item?.payload)?.payload ?? payload[0]?.payload;
    if (!row) return null;
    return (
        <Paper variant="outlined" sx={{ p: 1.25, pointerEvents: 'none' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>时段 {row.period ?? label ?? '-'}</Typography>
            <Typography variant="body2">出力基值：{Number(row.fmCapacity || 0).toFixed(3)} MW</Typography>
            <Typography variant="body2">申报价格：{Number(row.fmPrice || 0).toFixed(2)} 元/MW</Typography>
        </Paper>
    );
};

export const DeclarationDayTab: React.FC<DeclarationDayTabProps> = ({ station, strategy, canEdit, onSaved }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const defaultTargetDate = useMemo(() => {
        return format(addDays(new Date(), 1), 'yyyy-MM-dd');
    }, []);
    const [targetDate, setTargetDate] = useState(defaultTargetDate);
    const [availableForecastDates, setAvailableForecastDates] = useState<string[]>([]);
    const fmPriceThreshold = useMemo(() => getFmPriceThreshold(strategy), [strategy]);
    const strategyMaxSoc = useMemo(() => getMaxSoc(strategy), [strategy]);

    const [socInitial, setSocInitial] = useState<number>(station.default_soc ?? 0.1);
    const [energy, setEnergy] = useState<EnergySlot[]>(buildEmptyEnergy());
    const [fm, setFm] = useState<FmSlot[]>(buildEmptyFm());
    const [socTrajectory, setSocTrajectory] = useState<number[]>([]);
    const [priceForecast, setPriceForecast] = useState<number[]>([]);
    const [violations, setViolations] = useState<string[]>([]);
    const [generateInfo, setGenerateInfo] = useState<GenerateResult | null>(null);
    const [generationMessage, setGenerationMessage] = useState('');
    const [declareStatus, setDeclareStatus] = useState<'已申报' | '未申报'>('未申报');
    const [generationDialogOpen, setGenerationDialogOpen] = useState(false);
    const [generationSocInitial, setGenerationSocInitial] = useState<number>(station.default_soc ?? 0.1);
    const [generationThreshold, setGenerationThreshold] = useState<number>(fmPriceThreshold);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ severity: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [viewMode, setViewMode] = useState(0);
    const [detailTab, setDetailTab] = useState(0);

    const chartRef = useRef<HTMLDivElement>(null);
    const fullscreen = useChartFullscreen({ chartRef, title: `${station.station_name} / ${strategy.strategy_name} 当日申报` });
    const isSubmitted = declareStatus === '已申报';
    const editable = canEdit && !isSubmitted;
    const fmOutputBaseLimit = station.fm_power_mw * FM_OUTPUT_BASE_LIMIT_RATIO;

    useEffect(() => {
        setSocInitial(station.default_soc ?? 0.1);
        setGenerationSocInitial(station.default_soc ?? 0.1);
    }, [station.station_id, station.default_soc]);

    useEffect(() => {
        setGenerationThreshold(fmPriceThreshold);
    }, [fmPriceThreshold, strategy.strategy_id]);

    useEffect(() => {
        let cancelled = false;
        storageDeclarationApi
            .listSpotForecastDates(station.station_id)
            .then((dates) => {
                if (!cancelled) setAvailableForecastDates(dates || []);
            })
            .catch(() => {
                if (!cancelled) setAvailableForecastDates([]);
            });
        return () => {
            cancelled = true;
        };
    }, [station.station_id]);

    const previousForecastDate = useMemo(() => {
        return availableForecastDates.filter((date) => date < targetDate).pop();
    }, [availableForecastDates, targetDate]);

    const nextForecastDate = useMemo(() => {
        return availableForecastDates.find((date) => date > targetDate);
    }, [availableForecastDates, targetDate]);

    useEffect(() => {
        // 加载已保存的申报（若有）
        let cancelled = false;
        const load = async () => {
            try {
                setEnergy(buildEmptyEnergy());
                setFm(buildEmptyFm());
                setSocTrajectory(Array.from({ length: SLOT_COUNT }, () => station.default_soc ?? 0.1));
                setViolations([]);
                setGenerateInfo(null);
                setGenerationMessage('');
                setDeclareStatus('未申报');
                const decl = await storageDeclarationApi.getDeclaration(station.station_id, targetDate, strategy.strategy_id);
                if (cancelled) return;
                if (decl) {
                    let nextPriceForecast = decl.spot_price_forecast_96 || [];
                    if (!hasUsableForecast(nextPriceForecast)) {
                        const forecast = await storageDeclarationApi.getSpotForecast(targetDate, station.station_id);
                        if (cancelled) return;
                        if (hasUsableForecast(forecast.prices)) {
                            nextPriceForecast = forecast.prices;
                        }
                    }
                    setEnergy(decl.energy_slots_96?.length ? decl.energy_slots_96 : buildEmptyEnergy());
                    setFm(decl.fm_slots_24?.length ? decl.fm_slots_24 : buildEmptyFm());
                    setSocTrajectory(decl.soc_trajectory_96?.length ? decl.soc_trajectory_96 : Array.from({ length: SLOT_COUNT }, () => station.default_soc ?? 0.1));
                    setPriceForecast(nextPriceForecast);
                    setViolations(decl.violations || []);
                    setGenerationMessage(decl.generation_message || (decl.arbitrage_executed ? '已生成峰谷套利策略' : '未达价差阈值，已退回全天调频策略'));
                    setDeclareStatus(decl.declare_status);
                    setGenerateInfo({
                        energy_declaration: decl.energy_slots_96,
                        fm_declaration: decl.fm_slots_24,
                        soc_trajectory: decl.soc_trajectory_96,
                        spot_price_forecast: nextPriceForecast,
                        arbitrage_executed: decl.arbitrage_executed,
                        charge_hours: decl.charge_hours || [],
                        discharge_hours: decl.discharge_hours || [],
                        p_charge_mw: decl.p_charge_mw || 0,
                        p_discharge_mw: decl.p_discharge_mw || 0,
                        target_date: decl.target_date,
                        violations: decl.violations || [],
                        forecast_revenue: decl.forecast_revenue,
                        generation_message: decl.generation_message || '',
                    });
                    return;
                }
                const forecast = await storageDeclarationApi.getSpotForecast(targetDate, station.station_id);
                if (!cancelled) {
                    setPriceForecast(forecast.prices || []);
                }
            } catch (e) {
                // 没有数据时静默
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [station.station_id, station.default_soc, strategy.strategy_id, targetDate]);

    const handleGenerate = async () => {
        if (isSubmitted) return;
        setLoading(true);
        setFeedback(null);
        try {
            const result = await storageDeclarationApi.generate({
                station_id: station.station_id,
                strategy_id: strategy.strategy_id,
                target_date: targetDate,
                soc_initial_override: Number(generationSocInitial),
                threshold_override: Number(generationThreshold),
            });
            setSocInitial(Number(generationSocInitial));
            setEnergy(result.energy_declaration);
            setFm(result.fm_declaration);
            setSocTrajectory(result.soc_trajectory);
            setPriceForecast(result.spot_price_forecast);
            setViolations(result.violations || []);
            setGenerateInfo(result);
            const nextGenerationMessage = result.generation_message || (result.arbitrage_executed ? '已生成峰谷套利策略' : '未达价差阈值，已退回全天调频策略');
            setGenerationMessage(nextGenerationMessage);
            setDeclareStatus('未申报');
            setGenerationDialogOpen(false);
            const saved = await storageDeclarationApi.save({
                station_id: station.station_id,
                strategy_id: strategy.strategy_id,
                target_date: targetDate,
                declare_status: '未申报',
                energy_declaration: result.energy_declaration,
                fm_declaration: result.fm_declaration,
                soc_trajectory: result.soc_trajectory,
                spot_price_forecast: result.spot_price_forecast,
                params_snapshot: {
                    station: {
                        station_id: station.station_id,
                        rated_power_mw: station.rated_power_mw,
                        rated_capacity_mwh: station.rated_capacity_mwh,
                        charge_efficiency: station.charge_efficiency ?? station.efficiency ?? 0.93,
                        discharge_efficiency: station.discharge_efficiency ?? station.efficiency ?? 0.93,
                        discharge_depth: station.discharge_depth,
                    },
                    strategy: {
                        strategy_id: strategy.strategy_id,
                        strategy_type: strategy.strategy_type,
                        fm_price_threshold: generationThreshold,
                        max_soc: strategyMaxSoc,
                    },
                    soc_initial: Number(generationSocInitial),
                    fm_price_basis: result.fm_price_basis,
                    forecast_revenue: result.forecast_revenue,
                },
                result_meta: {
                    arbitrage_executed: result.arbitrage_executed,
                    charge_hours: result.charge_hours || [],
                    discharge_hours: result.discharge_hours || [],
                    p_charge_mw: result.p_charge_mw || 0,
                    p_discharge_mw: result.p_discharge_mw || 0,
                    violations: result.violations || [],
                    generation_message: nextGenerationMessage,
                    forecast_revenue: result.forecast_revenue,
                },
            });
            setGenerateInfo((current) => current ? { ...current, forecast_revenue: saved.forecast_revenue } : current);
            onSaved?.();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (Array.isArray(detail?.violations)) {
                setViolations(detail.violations);
            }
            setFeedback({ severity: 'error', message: formatApiErrorMessage(detail, '生成策略失败') });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (declareStatus: '已申报' | '未申报') => {
        if (isSubmitted) return;
        setSaving(true);
        setFeedback(null);
        try {
            const saved = await storageDeclarationApi.save({
                station_id: station.station_id,
                strategy_id: strategy.strategy_id,
                target_date: targetDate,
                declare_status: declareStatus,
                energy_declaration: energy,
                fm_declaration: fm,
                soc_trajectory: socTrajectory,
                spot_price_forecast: priceForecast,
                params_snapshot: {
                    station: {
                        station_id: station.station_id,
                        rated_power_mw: station.rated_power_mw,
                        rated_capacity_mwh: station.rated_capacity_mwh,
                        charge_efficiency: station.charge_efficiency ?? station.efficiency ?? 0.93,
                        discharge_efficiency: station.discharge_efficiency ?? station.efficiency ?? 0.93,
                        discharge_depth: station.discharge_depth,
                    },
                    strategy: {
                        strategy_id: strategy.strategy_id,
                        strategy_type: strategy.strategy_type,
                        fm_price_threshold: generationThreshold,
                        max_soc: strategyMaxSoc,
                    },
                    soc_initial: socInitial,
                    fm_price_basis: generateInfo?.fm_price_basis,
                    forecast_revenue: generateInfo?.forecast_revenue,
                },
                result_meta: {
                    arbitrage_executed: generateInfo?.arbitrage_executed || false,
                    charge_hours: generateInfo?.charge_hours || [],
                    discharge_hours: generateInfo?.discharge_hours || [],
                    p_charge_mw: generateInfo?.p_charge_mw || 0,
                    p_discharge_mw: generateInfo?.p_discharge_mw || 0,
                    violations,
                    generation_message: generationMessage,
                    forecast_revenue: generateInfo?.forecast_revenue,
                },
            });
            setGenerateInfo((current) => current ? { ...current, forecast_revenue: saved.forecast_revenue } : current);
            setDeclareStatus(declareStatus);
            if (declareStatus === '未申报') {
                setFeedback({ severity: 'success', message: '申报已暂存' });
            }
            onSaved?.();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (detail?.violations) {
                setViolations(detail.violations);
                setFeedback({ severity: 'error', message: '风控校验失败，请修正后再提交' });
            } else {
                setFeedback({ severity: 'error', message: formatApiErrorMessage(detail, '保存失败') });
            }
        } finally {
            setSaving(false);
        }
    };

    const handleEnergyChange = (slot: number, value: string) => {
        if (!editable) return;
        const numValue = Number(value);
        if (!Number.isFinite(numValue)) return;
        const next = energy.map((row, i) => (i === slot ? { ...row, power_mw: numValue } : row));
        setEnergy(next);
        setSocTrajectory(simulateSoc(
            next,
            station.rated_capacity_mwh,
            station.charge_efficiency ?? station.efficiency ?? 0.93,
            station.discharge_efficiency ?? station.efficiency ?? 0.93,
            socInitial,
        ));
    };

    const handleFmChange = (hour: number, value: string) => {
        if (!editable) return;
        const numValue = Number(value);
        if (!Number.isFinite(numValue)) return;
        setFm(fm.map((row, i) => (i === hour ? { ...row, mileage_price: numValue } : row)));
    };

    const handleFmOutputBaseChange = (hour: number, value: string) => {
        if (!editable) return;
        const numValue = Number(value);
        if (!Number.isFinite(numValue)) return;
        setFm(fm.map((row, i) => (i === hour ? { ...row, output_base_mw: numValue } : row)));
    };

    const chartData = useMemo(() => {
        return Array.from({ length: SLOT_COUNT }, (_, i) => {
            const power = energy[i]?.power_mw ?? 0;
            return {
                slot: i + 1,
                time: slotTimeLabel(i),
                charge: power < 0 ? Math.abs(power) : 0,
                discharge: power > 0 ? power : 0,
                lmp: priceForecast[i] ?? 0,
                soc: (socTrajectory[i] ?? 0) * 100,
            };
        });
    }, [energy, priceForecast, socTrajectory]);

    const fmChartData = useMemo(() => {
        return Array.from({ length: HOUR_COUNT }, (_, hour) => {
            const row = fm[hour];
            const fmPrice = row?.mileage_price ?? 0;
            const outputBase = row?.output_base_mw ?? 0;
            return {
                hour,
                period: `${String(hour).padStart(2, '0')}:00`,
                periodRange: row ? `${row.period_start}-${row.period_end}` : '',
                fmCapacity: fmPrice > 0 ? outputBase : 0,
                fmPrice,
            };
        });
    }, [fm]);

    const summary = useMemo(() => {
        const totalCharge = energy.reduce((sum, s) => sum + (s.power_mw < 0 ? Math.abs(s.power_mw) * 0.25 : 0), 0);
        const totalDischarge = energy.reduce((sum, s) => sum + (s.power_mw > 0 ? s.power_mw * 0.25 : 0), 0);
        const fmHours = fm.filter((f) => f.mileage_price > 0).length;
        const chargeSlotCount = energy.filter((s) => s.power_mw < 0).length;
        const dischargeSlotCount = energy.filter((s) => s.power_mw > 0).length;
        const energyExpectedRevenue = energy.reduce((sum, slot, index) => {
            const price = priceForecast[index] ?? 0;
            return sum + slot.power_mw * price * 0.25;
        }, 0);
        const activeFm = fm.filter((row) => row.mileage_price > 0);
        const avgFmPrice = activeFm.length > 0 ? activeFm.reduce((sum, row) => sum + row.mileage_price, 0) / activeFm.length : 0;
        const avgFmCapacity = activeFm.length > 0 ? activeFm.reduce((sum, row) => sum + (row.output_base_mw ?? 0), 0) / activeFm.length : 0;
        const forecastRevenue = generateInfo?.forecast_revenue;
        const clearingPrice = forecastRevenue?.params?.clearing_price ?? 0;
        const beta = forecastRevenue?.params?.beta ?? station.default_mileage_beta ?? 1;
        const kp = forecastRevenue?.params?.kp ?? station.fm_k_value ?? 1;
        const fmExpectedRevenue = activeFm.reduce((sum, row) => sum + (row.output_base_mw ?? 0) * beta * kp * clearingPrice, 0);
        const chargePrices = energy
            .map((slot, index) => (slot.power_mw < 0 ? priceForecast[index] ?? 0 : undefined))
            .filter((value): value is number => value !== undefined);
        const dischargePrices = energy
            .map((slot, index) => (slot.power_mw > 0 ? priceForecast[index] ?? 0 : undefined))
            .filter((value): value is number => value !== undefined);
        const avgChargePrice = chargePrices.length > 0 ? chargePrices.reduce((sum, value) => sum + value, 0) / chargePrices.length : 0;
        const avgDischargePrice = dischargePrices.length > 0 ? dischargePrices.reduce((sum, value) => sum + value, 0) / dischargePrices.length : 0;
        const peakValleySpread = forecastRevenue?.peak_valley_spread ?? (avgDischargePrice - avgChargePrice);
        const backendEnergyRevenue = forecastRevenue?.energy_revenue ?? energyExpectedRevenue;
        const backendFmRevenue = forecastRevenue?.fm_revenue ?? fmExpectedRevenue;
        const backendTotalRevenue = forecastRevenue?.net_revenue ?? (backendEnergyRevenue + backendFmRevenue);
        return {
            totalCharge,
            totalDischarge,
            energyDeclaredMwh: totalCharge + totalDischarge,
            chargeSlotCount,
            dischargeSlotCount,
            chargeHours: chargeSlotCount / 4,
            dischargeHours: dischargeSlotCount / 4,
            energyExpectedRevenue: backendEnergyRevenue,
            fmHours,
            avgFmPrice,
            avgFmCapacity,
            fmExpectedRevenue: backendFmRevenue,
            totalExpectedRevenue: backendTotalRevenue,
            peakValleySpread,
        };
    }, [energy, fm, generateInfo?.forecast_revenue, priceForecast, station.default_mileage_beta, station.fm_k_value]);

    const declarationInfoItems = useMemo(() => [
        { label: '目标日期', value: targetDate },
        { label: '预期总收益', value: formatMoney(summary.totalExpectedRevenue), color: summary.totalExpectedRevenue >= 0 ? 'success.main' : 'error.main' },
        { label: '电能量申报电量', value: `${summary.energyDeclaredMwh.toFixed(2)} MWh` },
        { label: '充/放电时段', value: `${summary.chargeSlotCount}/${summary.dischargeSlotCount}/96` },
        { label: '峰谷价差预测', value: `${summary.peakValleySpread.toFixed(2)} 元/MWh` },
        { label: '电能量预期收益', value: formatMoney(summary.energyExpectedRevenue), color: summary.energyExpectedRevenue >= 0 ? 'success.main' : 'error.main' },
        { label: '调频申报时段数', value: `${summary.fmHours}/24` },
        { label: '平均出力基值', value: `${summary.avgFmCapacity.toFixed(2)} MW` },
        { label: '平均申报价格', value: `${summary.avgFmPrice.toFixed(2)} 元/MW` },
        { label: '调频预期收益', value: formatMoney(summary.fmExpectedRevenue), color: summary.fmExpectedRevenue >= 0 ? 'success.main' : 'error.main' },
    ], [summary, targetDate]);

    const renderChart = () => (
        <Box
            ref={chartRef}
            sx={{
                position: 'relative',
                height: { xs: 460, md: '100%' },
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                bgcolor: fullscreen.isFullscreen ? 'background.paper' : 'transparent',
                p: fullscreen.isFullscreen ? 2 : 0,
                '& .recharts-surface:focus': { outline: 'none' },
                '& *:focus': { outline: 'none !important' },
            }}
        >
            <fullscreen.FullscreenEnterButton />
            <fullscreen.FullscreenExitButton />
            <fullscreen.FullscreenTitle />
            {generationMessage && (
                <Typography
                    variant="caption"
                    sx={{
                        display: 'block',
                        mb: 0.75,
                        color: generateInfo?.arbitrage_executed ? 'success.main' : 'warning.main',
                        fontWeight: 700,
                        whiteSpace: 'normal',
                    }}
                >
                    {generationMessage}
                </Typography>
            )}
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexShrink: 0 }}>申报图表</Typography>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ fontSize: 12, color: 'text.secondary', flexWrap: 'wrap', minWidth: 0 }}>
                    {[
                        { label: '充电', color: '#dc2626' },
                        { label: '放电', color: '#16a34a' },
                        { label: 'LMP预测', color: '#6b7280' },
                        { label: 'SOC', color: '#9333ea' },
                        { label: '出力基值', color: '#3b82f6' },
                        { label: '调频价格', color: '#f59e0b' },
                    ].map((item) => (
                        <Stack key={item.label} direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                            <Typography variant="caption" color="text.secondary" noWrap>{item.label}</Typography>
                        </Stack>
                    ))}
                </Stack>
            </Stack>
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 1 }}>
                <Box sx={{ flex: '3 1 0', minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" hide />
                            <YAxis yAxisId="power" width={52} tick={{ fontSize: 11 }} label={{ value: '功率 MW', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                            <YAxis yAxisId="price" width={68} orientation="right" tick={{ fontSize: 11 }} label={{ value: '价格 元/MWh', angle: 90, position: 'insideRight', fontSize: 11 }} />
                            <YAxis yAxisId="soc" width={0} orientation="right" domain={[0, 100]} tick={false} axisLine={false} tickLine={false} />
                            <Tooltip content={<EnergyTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} wrapperStyle={{ zIndex: 1401 }} />
                            <ReferenceLine y={0} yAxisId="power" stroke="#94a3b8" />
                            <Bar yAxisId="power" dataKey="discharge" fill="#16a34a" name="放电" stackId="energy" isAnimationActive={false} />
                            <Bar yAxisId="power" dataKey="charge" fill="#dc2626" name="充电" stackId="energy" isAnimationActive={false}>
                                {chartData.map((entry, idx) => (
                                    <Cell key={idx} fill={entry.charge > 0 ? '#dc2626' : 'transparent'} />
                                ))}
                            </Bar>
                            <Line yAxisId="price" type="monotone" dataKey="lmp" stroke="#6b7280" strokeWidth={1.5} dot={false} name="LMP预测" isAnimationActive={false} />
                            <Line yAxisId="soc" type="monotone" dataKey="soc" stroke="#9333ea" strokeWidth={2} dot={false} name="SOC" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
                <Box sx={{ flex: '2 1 0', minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={fmChartData} margin={{ top: 4, right: 8, left: 4, bottom: 12 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="period" interval={0} tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="capacity" width={52} tick={{ fontSize: 11 }} label={{ value: '基值 MW', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                            <YAxis yAxisId="fmPrice" width={68} orientation="right" tick={{ fontSize: 11 }} label={{ value: '价格 元/MW', angle: 90, position: 'insideRight', fontSize: 11 }} />
                            <Tooltip content={<FmTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} wrapperStyle={{ zIndex: 1401 }} />
                            <ReferenceLine y={0} yAxisId="capacity" stroke="#94a3b8" />
                            <Bar yAxisId="capacity" dataKey="fmCapacity" fill="#3b82f6" name="出力基值" isAnimationActive={false} />
                            <Line yAxisId="fmPrice" type="monotone" dataKey="fmPrice" stroke="#f59e0b" strokeWidth={2} dot={false} name="调频价格" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            </Box>
        </Box>
    );

    const renderDeclarationTable = () => (
        <Box sx={{ height: { xs: 'auto', md: '100%' }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Tabs
                value={detailTab}
                onChange={(_e, v) => setDetailTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
            >
                <Tab label={isMobile ? '电能量(96)' : '电能量市场申报 (96)'} />
                <Tab label={isMobile ? '调频(24)' : '调频市场申报 (24)'} />
            </Tabs>
            <Box
                sx={{
                    flex: { xs: '0 0 360px', md: '1 1 0' },
                    minHeight: 0,
                    overflow: 'hidden',
                    pb: 3,
                    boxSizing: 'border-box',
                    bgcolor: 'grey.50',
                    '& .MuiTableCell-body': {
                        bgcolor: 'background.paper',
                    },
                }}
            >
                {detailTab === 0 && (
                    <TableContainer sx={{ height: '100%', overflow: 'auto' }}>
                        <Table
                            size="small"
                            stickyHeader
                            sx={{
                                minWidth: { xs: 520, md: 0 },
                                '& .MuiTableCell-root': {
                                    px: { xs: 0.75, md: 1 },
                                    py: { xs: 0.5, md: 0.75 },
                                    fontSize: { xs: '0.75rem', md: '0.8125rem' },
                                    whiteSpace: 'nowrap',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell>时刻点</TableCell>
                                    <TableCell align="right">{isMobile ? '出力(MW)' : '出力 (MW，正放电/负充电)'}</TableCell>
                                    <TableCell align="right">SOC</TableCell>
                                    <TableCell align="right">{isMobile ? 'LMP(元/MWh)' : 'LMP预测 (元/MWh)'}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {energy.map((row, i) => (
                                    <TableRow key={i} hover>
                                        <TableCell>{row.time_point}</TableCell>
                                        <TableCell align="right">
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={row.power_mw}
                                                onChange={(e) => handleEnergyChange(i, e.target.value)}
                                                inputProps={{ step: 0.1, min: -station.rated_power_mw, max: station.rated_power_mw }}
                                                sx={{ width: { xs: 78, md: 100 } }}
                                                disabled={!editable}
                                            />
                                        </TableCell>
                                        <TableCell align="right">{((socTrajectory[i] ?? 0) * 100).toFixed(2)}%</TableCell>
                                        <TableCell align="right">{(priceForecast[i] ?? 0).toFixed(2)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
                {detailTab === 1 && (
                    <TableContainer sx={{ height: '100%', overflow: 'auto' }}>
                        <Table
                            size="small"
                            stickyHeader
                            sx={{
                                minWidth: { xs: 420, md: 0 },
                                '& .MuiTableCell-root': {
                                    px: { xs: 0.75, md: 1 },
                                    py: { xs: 0.5, md: 0.75 },
                                    fontSize: { xs: '0.75rem', md: '0.8125rem' },
                                    whiteSpace: 'nowrap',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell>时段区间</TableCell>
                                    <TableCell align="right">{isMobile ? '基值(MW)' : '出力基值 (MW)'}</TableCell>
                                    <TableCell align="right">{isMobile ? '报价(元/MW)' : '里程报价 (元/MW)'}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {fm.map((row, i) => (
                                    <TableRow key={i} hover>
                                        <TableCell>{`${row.period_start}-${row.period_end}`}</TableCell>
                                        <TableCell align="right">
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={row.output_base_mw ?? 0}
                                                onChange={(e) => handleFmOutputBaseChange(i, e.target.value)}
                                                inputProps={{ step: 0.1, min: 0, max: Math.max(fmOutputBaseLimit, 0) }}
                                                sx={{ width: { xs: 82, md: 120 } }}
                                                disabled={!editable}
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            <TextField
                                                size="small"
                                                type="number"
                                                value={row.mileage_price}
                                                onChange={(e) => handleFmChange(i, e.target.value)}
                                                inputProps={{ step: 0.1, min: FM_PRICE_MIN, max: FM_PRICE_MAX }}
                                                sx={{ width: { xs: 82, md: 120 } }}
                                                disabled={!editable}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Box>
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
            {feedback && (
                <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
                    {feedback.message}
                </Alert>
            )}

            <Paper
                variant="outlined"
                sx={{
                    p: 0,
                    borderRadius: 2,
                    overflow: 'hidden',
                    flex: { xs: 'none', md: '0 0 auto' },
                    backgroundColor: 'background.paper',
                }}
            >
                <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, flex: { xs: '1 0 100%', sm: 1 }, minWidth: 0 }}>策略申报信息</Typography>
                    <Box
                        sx={{
                            px: 1,
                            py: 0.25,
                            borderRadius: 1,
                            border: 1,
                            borderColor: isSubmitted ? 'success.light' : 'warning.light',
                            color: isSubmitted ? 'success.main' : 'warning.main',
                            fontSize: 12,
                            fontWeight: 700,
                            lineHeight: 1.5,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {declareStatus}
                    </Box>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                        onClick={() => setGenerationDialogOpen(true)}
                        disabled={loading || !editable}
                    >
                        生成
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SendOutlinedIcon />}
                        onClick={() => handleSave('已申报')}
                        disabled={saving || !editable || violations.length > 0 || !generateInfo}
                    >
                        {saving ? '提交中' : '提交'}
                    </Button>
                </Box>
                <Box sx={{ p: 1 }}>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' },
                            gap: 0.5,
                        }}
                    >
                        {declarationInfoItems.map((item) => (
                            <Box
                                key={item.label}
                                sx={{
                                    px: 0.875,
                                    py: 0.5,
                                    border: 1,
                                    borderColor: 'divider',
                                    borderRadius: 1.5,
                                    bgcolor: 'grey.50',
                                    minWidth: 0,
                                    minHeight: 48,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                }}
                            >
                                {item.label === '目标日期' ? (
                                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.15 }}>{item.label}</Typography>
                                            <Typography variant="body2" sx={{ mt: 0.125, fontWeight: 700, lineHeight: 1.2, fontSize: { xs: '0.82rem', md: '0.86rem' }, color: item.color || 'text.primary' }}>
                                                {item.value}
                                            </Typography>
                                        </Box>
                                        <Stack spacing={0} sx={{ flexShrink: 0 }}>
                                            <IconButton
                                                size="small"
                                                title="后一个可用日期"
                                                disabled={!nextForecastDate || loading || saving}
                                                onClick={() => nextForecastDate && setTargetDate(nextForecastDate)}
                                                sx={{ width: 20, height: 17, p: 0 }}
                                            >
                                                <ArrowDropUpIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton
                                                size="small"
                                                title="前一个可用日期"
                                                disabled={!previousForecastDate || loading || saving}
                                                onClick={() => previousForecastDate && setTargetDate(previousForecastDate)}
                                                sx={{ width: 20, height: 17, p: 0 }}
                                            >
                                                <ArrowDropDownIcon fontSize="small" />
                                            </IconButton>
                                        </Stack>
                                    </Stack>
                                ) : (
                                    <>
                                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.15 }}>{item.label}</Typography>
                                        <Typography variant="body2" sx={{ mt: 0.125, fontWeight: 700, lineHeight: 1.2, fontSize: { xs: '0.82rem', md: '0.86rem' }, color: item.color || 'text.primary' }}>
                                            {item.value}
                                        </Typography>
                                    </>
                                )}
                            </Box>
                        ))}
                    </Box>
                    {generateInfo && generateInfo.arbitrage_executed && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                            充电小时: {generateInfo.charge_hours.join(', ')} | 放电小时: {generateInfo.discharge_hours.join(', ')} | 充电功率: {generateInfo.p_charge_mw.toFixed(2)} MW | 放电功率: {generateInfo.p_discharge_mw.toFixed(2)} MW
                        </Typography>
                    )}
                    {violations.length > 0 && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>风控违规明细</Typography>
                            {violations.map((v, i) => (
                                <Typography key={i} variant="caption" sx={{ display: 'block' }}>{`${i + 1}. ${v}`}</Typography>
                            ))}
                        </Alert>
                    )}
                </Box>
            </Paper>

            <Paper
                variant="outlined"
                sx={{
                    p: 0,
                    borderRadius: 2,
                    overflow: 'hidden',
                    flex: { xs: 'none', md: '1 1 0' },
                    minHeight: { xs: 'auto', md: 0 },
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', pr: 1 }}>
                    <Tabs
                        value={viewMode}
                        onChange={(_e, v) => setViewMode(v)}
                        variant="scrollable"
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        sx={{ flex: 1, minWidth: 0 }}
                    >
                        <Tab label="图表" />
                        <Tab label="表格" />
                    </Tabs>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleSave('未申报')}
                        disabled={saving || !editable || !generateInfo}
                    >
                        {saving ? '保存中' : '保存修改'}
                    </Button>
                </Box>
                <Box sx={{ p: viewMode === 0 ? 1.5 : 0, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {viewMode === 0 ? renderChart() : renderDeclarationTable()}
                </Box>
            </Paper>

            <Dialog open={generationDialogOpen} onClose={() => setGenerationDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>生成策略申报数据</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            size="small"
                            label="初始 SOC (0-1)"
                            type="number"
                            value={generationSocInitial}
                            onChange={(event) => setGenerationSocInitial(Number(event.target.value))}
                            inputProps={{ step: 0.05, min: 0, max: 1 }}
                            fullWidth
                        />
                        <TextField
                            size="small"
                            label="调频价差阈值"
                            type="number"
                            value={generationThreshold}
                            onChange={(event) => setGenerationThreshold(Number(event.target.value))}
                            inputProps={{ step: 1, min: 0 }}
                            helperText={`默认值来自策略参数：${fmPriceThreshold.toFixed(2)} 元/MWh`}
                            fullWidth
                        />
                        {generateInfo?.fm_price_basis && (
                            <Alert severity="info">
                                调频报价将参考日前调频需求与近期日前出清价格生成。
                            </Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setGenerationDialogOpen(false)}>取消</Button>
                    <Button
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                        onClick={() => void handleGenerate()}
                        disabled={loading || !editable}
                    >
                        {loading ? '生成中' : '生成'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default DeclarationDayTab;
