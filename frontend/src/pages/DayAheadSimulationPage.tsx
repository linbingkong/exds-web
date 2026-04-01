import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    Grid,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AnalyticsOutlinedIcon from '@mui/icons-material/AnalyticsOutlined';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StyleOutlinedIcon from '@mui/icons-material/StyleOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { addDays, eachDayOfInterval, format } from 'date-fns';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
    DailyReviewDetail,
    ProfitCurvePoint,
    ProfitDailyRow,
    ProfitMetric,
    ProfitSummary,
    SimulationDetail,
    TradeSourceDetail,
    TradeSourceListItem,
    TradeSourceParam,
    dayAheadBidApi,
} from '../api/dayAheadBid';
import { useAuth } from '../contexts/AuthContext';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

type PanelKey = 0 | 1 | 2 | 3;

const EDIT_PERMISSION = 'module:strategy_dayahead:edit';
const EMPTY_PARAM: TradeSourceParam = { param_key: '', param_name: '', param_value: '', unit: '', description: '' };

const MetricCard: React.FC<{ title: string; value: string; color?: string }> = ({ title, value, color }) => (
    <Paper
        variant="outlined"
        sx={{
            p: 1.5,
            minWidth: 148,
            borderRadius: 2,
            background: 'linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(255,255,255,1) 100%)',
            boxShadow: '0 8px 24px rgba(15,23,42,0.04)',
        }}
    >
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.3 }}>{title}</Typography>
        <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 700, color: color || 'text.primary' }}>{value}</Typography>
    </Paper>
);

const formatProfitAmountWan = (value: number) => `${(value / 10000).toFixed(3)} 万元`;

const formatProfitPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

const formatProfitRatio = (value: number) => (value > 0 ? value.toFixed(2) : '--');

export const DayAheadSimulationPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission(EDIT_PERMISSION);

    const [tradeSources, setTradeSources] = useState<TradeSourceListItem[]>([]);
    const [selectedTradeSourceId, setSelectedTradeSourceId] = useState('');
    const [activePanel, setActivePanel] = useState<PanelKey>(0);
    const [managementOpen, setManagementOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingDetail, setEditingDetail] = useState<TradeSourceDetail | null>(null);
    const [currentDetail, setCurrentDetail] = useState<TradeSourceDetail | null>(null);
    const [feedback, setFeedback] = useState<{ severity: 'success' | 'error' | 'info'; message: string } | null>(null);

    const [simulation, setSimulation] = useState<SimulationDetail | null>(null);
    const [simulationDraft, setSimulationDraft] = useState<number[]>([]);
    const [batchValue, setBatchValue] = useState('');
    const [simulationRefAreaLeft, setSimulationRefAreaLeft] = useState<number | null>(null);
    const [simulationRefAreaRight, setSimulationRefAreaRight] = useState<number | null>(null);
    const [simulationSelection, setSimulationSelection] = useState<{ start: number; end: number } | null>(null);
    const [simulationHoveredPeriod, setSimulationHoveredPeriod] = useState<number | null>(null);
    const [simulationTooltipPosition, setSimulationTooltipPosition] = useState<{ x: number; y: number; containerWidth: number } | null>(null);

    const range = useMemo(() => dayAheadBidApi.buildDefaultProfitRange(), []);
    const [profitStartDate, setProfitStartDate] = useState<Date | null>(new Date(range.start_date));
    const [profitEndDate, setProfitEndDate] = useState<Date | null>(new Date(range.end_date));
    const [profitMetric, setProfitMetric] = useState<ProfitMetric>('amount');
    const [profitSummary, setProfitSummary] = useState<ProfitSummary | null>(null);
    const [profitCurve, setProfitCurve] = useState<ProfitCurvePoint[]>([]);
    const [profitRows, setProfitRows] = useState<ProfitDailyRow[]>([]);
    const [profitHoveredDate, setProfitHoveredDate] = useState<string | null>(null);
    const [profitTooltipPosition, setProfitTooltipPosition] = useState<{ x: number; y: number; containerWidth: number } | null>(null);
    const [profitTab, setProfitTab] = useState(0);

    const [reviewTargetDate, setReviewTargetDate] = useState<Date | null>(addDays(new Date(), -1));
    const [reviewTab, setReviewTab] = useState(0);
    const [dailyReview, setDailyReview] = useState<DailyReviewDetail | null>(null);

    const strategyDetailCacheRef = useRef<Record<string, TradeSourceDetail | null>>({});
    const simulationCacheRef = useRef<Record<string, SimulationDetail>>({});
    const profitCacheRef = useRef<Record<string, { summary: ProfitSummary; curve: ProfitCurvePoint[]; rows: ProfitDailyRow[] }>>({});
    const reviewCacheRef = useRef<Record<string, DailyReviewDetail>>({});

    const simulationChartRef = useRef<HTMLDivElement>(null);
    const simulationFullscreen = useChartFullscreen({
        chartRef: simulationChartRef,
        title: simulation ? `模拟申报 - ${simulation.strategy_name}` : '模拟申报',
    });

    useEffect(() => {
        const load = async () => {
            try {
                const list = await dayAheadBidApi.getTradeSources();
                setTradeSources(list);
                setSelectedTradeSourceId((prev) => prev || list[0]?.trade_source_id || '');
            } catch (error) {
                console.error(error);
                setFeedback({ severity: 'error', message: '加载策略列表失败' });
            }
        };
        void load();
    }, []);

    useEffect(() => {
        if (!selectedTradeSourceId || activePanel !== 0) return;
        let cancelled = false;
        const cachedDetail = strategyDetailCacheRef.current[selectedTradeSourceId];
        const cachedSimulation = simulationCacheRef.current[selectedTradeSourceId];
        if (cachedDetail !== undefined) {
            setCurrentDetail(cachedDetail);
        }
        if (cachedSimulation) {
            setSimulation(cachedSimulation);
            setSimulationDraft(cachedSimulation.bid_mwh_30m);
            return;
        }
        void Promise.all([
            dayAheadBidApi.getTradeSourceDetail(selectedTradeSourceId),
            dayAheadBidApi.getNextDaySimulation(selectedTradeSourceId),
        ]).then(([detail, data]) => {
            if (cancelled) return;
            strategyDetailCacheRef.current[selectedTradeSourceId] = detail;
            simulationCacheRef.current[selectedTradeSourceId] = data;
            setCurrentDetail(detail);
            setSimulation(data);
            setSimulationDraft(data.bid_mwh_30m);
        }).catch((error) => {
            if (cancelled) return;
            console.error(error);
            setCurrentDetail(null);
            setFeedback({ severity: 'error', message: '加载模拟申报数据失败' });
        });
        return () => {
            cancelled = true;
        };
    }, [selectedTradeSourceId, activePanel]);

    useEffect(() => {
        if (!selectedTradeSourceId || !profitStartDate || !profitEndDate || activePanel !== 1) return;
        let cancelled = false;
        const startDate = format(profitStartDate, 'yyyy-MM-dd');
        const endDate = format(profitEndDate, 'yyyy-MM-dd');
        const cacheKey = `${selectedTradeSourceId}|${startDate}|${endDate}|${profitMetric}`;
        const cached = profitCacheRef.current[cacheKey];
        if (cached) {
            setProfitSummary(cached.summary);
            setProfitCurve(cached.curve);
            setProfitRows(cached.rows);
            return;
        }
        void Promise.all([
            dayAheadBidApi.getProfitSummary(selectedTradeSourceId, startDate, endDate),
            dayAheadBidApi.getProfitCurve(selectedTradeSourceId, startDate, endDate, profitMetric),
            dayAheadBidApi.getProfitDaily(selectedTradeSourceId, startDate, endDate),
        ]).then(([summary, curve, daily]) => {
            if (cancelled) return;
            const nextValue = { summary, curve: curve.points, rows: daily.rows };
            profitCacheRef.current[cacheKey] = nextValue;
            setProfitSummary(summary);
            setProfitCurve(curve.points);
            setProfitRows(daily.rows);
        }).catch((error) => {
            if (cancelled) return;
            console.error(error);
            setFeedback({ severity: 'error', message: '加载策略收益数据失败' });
        });
        return () => {
            cancelled = true;
        };
    }, [selectedTradeSourceId, profitStartDate, profitEndDate, profitMetric, activePanel]);

    useEffect(() => {
        if (!selectedTradeSourceId || !reviewTargetDate || activePanel !== 2) return;
        let cancelled = false;
        const targetDate = format(reviewTargetDate, 'yyyy-MM-dd');
        const cacheKey = `${selectedTradeSourceId}|${targetDate}`;
        const cached = reviewCacheRef.current[cacheKey];
        if (cached) {
            setDailyReview(cached);
            return;
        }
        void dayAheadBidApi.getDailyReview(selectedTradeSourceId, targetDate).then((data) => {
            if (cancelled) return;
            reviewCacheRef.current[cacheKey] = data;
            setDailyReview(data);
        }).catch((error) => {
            if (cancelled) return;
            console.error(error);
            setFeedback({ severity: 'error', message: '加载单日复盘数据失败' });
        });
        return () => {
            cancelled = true;
        };
    }, [selectedTradeSourceId, reviewTargetDate, activePanel]);

    const simulationRows = useMemo(() => {
        if (!simulation) return [];
        const rowCount = Math.max(48, simulation.price_forecast_30m.length, simulation.bid_mwh_30m.length, simulationDraft.length);
        return Array.from({ length: rowCount }, (_, index) => ({
            period: index + 1,
            priceForecast: simulation.price_forecast_30m[index] ?? 0,
            bidMwh: simulationDraft[index] ?? 0,
            originalBidMwh: simulation.bid_mwh_30m[index] ?? 0,
        }));
    }, [simulation, simulationDraft]);

    const simulationSelectionLabel = useMemo(() => {
        if (!simulationSelection) return '未选择区域（请在图表中框选）';
        const startMinutes = (simulationSelection.start + 1) * 30;
        const endMinutes = (simulationSelection.end + 2) * 30;
        const formatMinutes = (minutes: number) => {
            if (minutes >= 1440) return '24:00';
            const hour = Math.floor(minutes / 60);
            const minute = minutes % 60;
            return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        };
        return `已选择区域：${formatMinutes(startMinutes)} - ${formatMinutes(endMinutes)}`;
    }, [simulationSelection]);

    const simulationHoveredRow = useMemo(
        () => simulationRows.find((row) => row.period === simulationHoveredPeriod) ?? null,
        [simulationHoveredPeriod, simulationRows],
    );

    const profitChartRows = useMemo(() => {
        if (!profitStartDate || !profitEndDate || profitStartDate > profitEndDate) return [];
        const curveMap = new Map(profitCurve.map((item) => [item.date, item]));
        const volumeMap = new Map(profitRows.map((item) => [item.date, item.bid_total_mwh]));
        return eachDayOfInterval({ start: profitStartDate, end: profitEndDate }).map((date) => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const curveItem = curveMap.get(dateStr);
            const isAmountMetric = profitMetric === 'amount';
            const strategyValue = curveItem?.strategy_value ?? null;
            return {
                date: dateStr,
                strategyValue: strategyValue == null
                    ? null
                    : (isAmountMetric ? Number((strategyValue / 10000).toFixed(3)) : Number(strategyValue.toFixed(3))),
                strategyUnit: isAmountMetric ? '万元' : (curveItem?.unit_label || '元/MWh'),
                bidTotalMwh: volumeMap.get(dateStr) ?? null,
            };
        });
    }, [profitCurve, profitEndDate, profitMetric, profitRows, profitStartDate]);

    const profitHoveredRow = useMemo(
        () => profitChartRows.find((row) => row.date === profitHoveredDate) ?? null,
        [profitChartRows, profitHoveredDate],
    );

    const profitDateTickInterval = useMemo(() => {
        if (profitChartRows.length <= 8) return 0;
        return Math.max(Math.ceil(profitChartRows.length / 8) - 1, 0);
    }, [profitChartRows.length]);

    const profitMetricItems = useMemo(() => {
        if (!profitSummary) return [];
        const avgBidMwhPerActivePeriod = Number(profitSummary.avg_bid_mwh_per_active_period ?? 0);
        return [
            { title: '策略收益', value: formatProfitAmountWan(profitSummary.total_realized_pnl_yuan), color: profitSummary.total_realized_pnl_yuan >= 0 ? '#dc2626' : '#2563eb' },
            { title: '交易天数', value: `${profitSummary.trading_days}` },
            { title: '日均收益', value: formatProfitAmountWan(profitSummary.avg_daily_realized_pnl_yuan) },
            { title: '日胜率', value: formatProfitPercent(profitSummary.daily_win_rate), color: '#dc2626' },
            { title: '时段胜率', value: formatProfitPercent(profitSummary.period_win_rate) },
            { title: '盈利金额', value: formatProfitAmountWan(profitSummary.profitable_amount_yuan), color: '#dc2626' },
            { title: '亏损金额', value: formatProfitAmountWan(profitSummary.loss_amount_yuan), color: '#2563eb' },
            { title: '盈亏比', value: formatProfitRatio(profitSummary.profit_loss_ratio) },
            { title: '日均盈利', value: formatProfitAmountWan(profitSummary.avg_profit_yuan), color: '#dc2626' },
            { title: '日均亏损', value: formatProfitAmountWan(profitSummary.avg_loss_yuan), color: '#2563eb' },
            { title: '平均盈亏比', value: formatProfitRatio(profitSummary.avg_profit_loss_ratio) },
            { title: '单日最大盈利', value: formatProfitAmountWan(profitSummary.max_single_day_profit_yuan), color: '#dc2626' },
            { title: '单日最大亏损', value: formatProfitAmountWan(profitSummary.max_single_day_loss_yuan), color: '#2563eb' },
            { title: '最大盈亏比', value: formatProfitRatio(profitSummary.max_profit_loss_ratio) },
            { title: '最大回撤', value: formatProfitAmountWan(profitSummary.max_drawdown_yuan) },
            { title: '单位电量收益', value: `${profitSummary.unit_pnl_yuan_per_mwh.toFixed(3)} 元/MWh` },
            { title: '平均时段电量', value: `${avgBidMwhPerActivePeriod.toFixed(2)} MWh` },
            { title: '时段平均收益', value: formatProfitAmountWan(profitSummary.avg_period_pnl_yuan) },
        ];
    }, [profitSummary]);

    const simulationTooltipSx = useMemo(() => {
        if (!simulationTooltipPosition) {
            return {
                top: 12,
                right: 16,
            };
        }
        const tooltipWidth = 220;
        const placeLeft = simulationTooltipPosition.x <= simulationTooltipPosition.containerWidth - tooltipWidth - 24;
        return {
            left: simulationTooltipPosition.x + (placeLeft ? 16 : -16),
            top: Math.max(simulationTooltipPosition.y - 12, 12),
            transform: placeLeft ? 'translateY(-100%)' : 'translate(-100%, -100%)',
        };
    }, [simulationTooltipPosition]);

    const profitTooltipSx = useMemo(() => {
        if (!profitTooltipPosition) {
            return {
                top: 12,
                right: 12,
            };
        }
        const tooltipWidth = 220;
        const placeLeft = profitTooltipPosition.x <= profitTooltipPosition.containerWidth - tooltipWidth - 24;
        return {
            left: profitTooltipPosition.x + (placeLeft ? 16 : -16),
            top: Math.max(profitTooltipPosition.y - 12, 12),
            transform: placeLeft ? 'translateY(-100%)' : 'translate(-100%, -100%)',
        };
    }, [profitTooltipPosition]);

    const refreshTradeSources = async () => {
        const list = await dayAheadBidApi.getTradeSources();
        setTradeSources(list);
    };

    const applyProfitRange = (preset: 'thisMonth' | 'lastMonth' | '30d' | '60d' | 'thisYear') => {
        const next = dayAheadBidApi.buildQuickRange(preset);
        setProfitStartDate(new Date(next.start_date));
        setProfitEndDate(new Date(next.end_date));
    };

    const openDailyReviewFromProfitRow = (date: string) => {
        setReviewTargetDate(new Date(date));
        setReviewTab(0);
        setActivePanel(2);
    };

    const openCreateDialog = () => {
        setEditingDetail(null);
        setDialogOpen(true);
    };

    const openEditDialog = async (tradeSourceId: string) => {
        const detail = await dayAheadBidApi.getTradeSourceDetail(tradeSourceId);
        setEditingDetail(detail);
        setDialogOpen(true);
    };

    const handleDialogSubmit = async () => {
        const payload = {
            trade_source_name: editingDetail?.trade_source_name || '',
            trade_type: editingDetail?.trade_type || 'manual',
            strategy_code: editingDetail?.strategy_code || '',
            trade_source_status: editingDetail?.trade_source_status || '启用',
            description: editingDetail?.description || '',
            params: (editingDetail?.params || [EMPTY_PARAM]).filter((item) => item.param_name || item.param_key),
        };
        if (editingDetail?.trade_source_id) {
            await dayAheadBidApi.updateTradeSource(editingDetail.trade_source_id, payload);
            setFeedback({ severity: 'success', message: '策略已更新' });
        } else {
            await dayAheadBidApi.createTradeSource(payload);
            setFeedback({ severity: 'success', message: '策略已创建' });
        }
        await refreshTradeSources();
        setDialogOpen(false);
    };

    const handleDelete = async (tradeSourceId: string) => {
        if (!window.confirm('确认删除该策略吗？')) return;
        await dayAheadBidApi.deleteTradeSource(tradeSourceId);
        await refreshTradeSources();
        setSelectedTradeSourceId((prev) => prev === tradeSourceId ? '' : prev);
        setFeedback({ severity: 'success', message: '策略已删除' });
    };

    const handleStatusToggle = async (item: TradeSourceListItem) => {
        await dayAheadBidApi.setTradeSourceStatus(item.trade_source_id, item.trade_source_status === '启用' ? '停用' : '启用');
        await refreshTradeSources();
        setFeedback({ severity: 'success', message: '状态已更新' });
    };

    const applySimulationBatch = (mode: 'set' | 'percent' | 'add') => {
        if (!simulation || !simulation.is_editable || !canEdit || !simulationSelection) return;
        setSimulationDraft((prev) => {
            const nextValue = Number(batchValue);
            if (!Number.isFinite(nextValue)) return prev;
            return prev.map((value, index) => {
                if (index < simulationSelection.start || index > simulationSelection.end) return value;
                if (mode === 'percent') {
                    return Number((value * (1 + nextValue / 100)).toFixed(1));
                }
                if (mode === 'add') {
                    return Number((value + nextValue).toFixed(1));
                }
                return nextValue;
            });
        });
    };

    const resetSimulationDraft = async () => {
        if (!simulation || !canEdit || simulation.trade_type !== 'manual') return;
        const next = await dayAheadBidApi.resetManualSimulation(simulation.trade_source_id, simulation.target_date);
        const detail = await dayAheadBidApi.getTradeSourceDetail(simulation.trade_source_id);
        simulationCacheRef.current[simulation.trade_source_id] = next;
        strategyDetailCacheRef.current[simulation.trade_source_id] = detail;
        setSimulation(next);
        setSimulationDraft(next.bid_mwh_30m);
        setCurrentDetail(detail);
        setSimulationSelection(null);
        setSimulationRefAreaLeft(null);
        setSimulationRefAreaRight(null);
        await refreshTradeSources();
        setBatchValue('');
        setFeedback({ severity: 'success', message: '人工方案已重置' });
    };

    const handleSimulationMouseDown = (event: any) => {
        if (!event || typeof event.activeLabel !== 'number') return;
        setSimulationHoveredPeriod(event.activeLabel);
        setSimulationRefAreaLeft(event.activeLabel);
        setSimulationRefAreaRight(null);
    };

    const handleSimulationMouseMove = (event: any) => {
        if (!event || typeof event.activeLabel !== 'number') return;
        setSimulationHoveredPeriod(event.activeLabel);
        if (simulationRefAreaLeft != null) {
            setSimulationRefAreaRight(event.activeLabel);
        }
    };

    const handleSimulationMouseUp = () => {
        if (simulationRefAreaLeft == null || simulationRefAreaRight == null) {
            setSimulationRefAreaLeft(null);
            setSimulationRefAreaRight(null);
            return;
        }
        const start = Math.min(simulationRefAreaLeft, simulationRefAreaRight) - 1;
        const end = Math.max(simulationRefAreaLeft, simulationRefAreaRight) - 1;
        if (start >= 0 && end >= 0) {
            setSimulationSelection({ start, end });
        }
        setSimulationRefAreaLeft(null);
        setSimulationRefAreaRight(null);
    };

    const handleSimulationMouseLeave = () => {
        setSimulationHoveredPeriod(null);
        setSimulationTooltipPosition(null);
        if (simulationRefAreaLeft == null) {
            setSimulationRefAreaRight(null);
        }
    };

    const handleSimulationContainerMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setSimulationTooltipPosition({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            containerWidth: rect.width,
        });
    };

    const handleProfitMouseMove = (event: any) => {
        if (!event || typeof event.activeLabel !== 'string') return;
        setProfitHoveredDate(event.activeLabel);
    };

    const handleProfitMouseLeave = () => {
        setProfitHoveredDate(null);
        setProfitTooltipPosition(null);
    };

    const handleProfitContainerMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setProfitTooltipPosition({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            containerWidth: rect.width,
        });
    };

    const clearSimulationSelection = () => {
        setSimulationSelection(null);
        setSimulationRefAreaLeft(null);
        setSimulationRefAreaRight(null);
        setBatchValue('');
    };

    const saveSimulation = async () => {
        if (!simulation || !canEdit) return;
        const next = await dayAheadBidApi.saveManualSimulation(simulation.trade_source_id, simulation.target_date, simulationDraft);
        const detail = await dayAheadBidApi.getTradeSourceDetail(simulation.trade_source_id);
        simulationCacheRef.current[simulation.trade_source_id] = next;
        strategyDetailCacheRef.current[simulation.trade_source_id] = detail;
        setSimulation(next);
        setSimulationDraft(next.bid_mwh_30m);
        setCurrentDetail(detail);
        await refreshTradeSources();
        setFeedback({ severity: 'success', message: '人工方案次日申报已保存' });
    };

    const updateEditingField = (key: keyof TradeSourceDetail, value: any) => {
        setEditingDetail((prev) => {
            if (!prev) {
                return {
                    trade_source_id: '',
                    trade_source_name: '',
                    trade_type: 'manual',
                    strategy_id: '',
                    strategy_code: '',
                    trade_source_status: '启用',
                    next_day_declare_status: '未申报',
                    description: '',
                    params: [EMPTY_PARAM],
                    created_at: '',
                    updated_at: '',
                    [key]: value,
                } as TradeSourceDetail;
            }
            return { ...prev, [key]: value };
        });
    };

    const updateEditingParam = (index: number, key: keyof TradeSourceParam, value: string) => {
        setEditingDetail((prev) => {
            const base = prev || {
                trade_source_id: '',
                trade_source_name: '',
                trade_type: 'manual',
                strategy_id: '',
                strategy_code: '',
                trade_source_status: '启用',
                next_day_declare_status: '未申报',
                description: '',
                params: [EMPTY_PARAM],
                created_at: '',
                updated_at: '',
            };
            return {
                ...base,
                params: base.params.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
            };
        });
    };

    const declarationInfoItems = simulation ? [
        { label: '申报目标日期', value: simulation.target_date },
        { label: '申报总电量', value: `${simulation.summary.total_bid_mwh.toFixed(1)} MWh` },
        { label: '申报时段数', value: `${simulation.summary.active_period_count}` },
        { label: '最大时段电量', value: `${simulation.summary.max_bid_mwh_per_period.toFixed(1)} MWh` },
        {
            label: '平均时段电量',
            value: simulation.summary.active_period_count > 0
                ? `${(simulation.summary.total_bid_mwh / simulation.summary.active_period_count).toFixed(1)} MWh`
                : '--',
        },
        {
            label: '预期收益',
            value: simulation.next_day_declare_status === '已申报'
                ? `${simulationRows.reduce((sum, row) => sum + row.bidMwh * (row.priceForecast - 300), 0).toFixed(2)} 元`
                : '--',
        },
        {
            label: '申报时间',
            value: simulation.next_day_declare_status === '已申报'
                ? (currentDetail?.updated_at ? format(new Date(currentDetail.updated_at), 'yyyy-MM-dd HH:mm') : '--')
                : '--',
        },
        { label: '申报状态', value: simulation.next_day_declare_status },
    ] : [];

    const renderSimulationPanel = () => {
        if (!simulation) return <Alert severity="info">请选择左侧策略后查看模拟申报。</Alert>;
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 0,
                        flex: { xs: 'none', lg: '0 0 24%' },
                        minHeight: { xs: 'auto', lg: 0 },
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 2,
                        overflow: 'hidden',
                        backgroundColor: 'background.paper',
                    }}
                >
                    <Box sx={{ px: 1.5, py: 1.25, backgroundColor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>策略申报信息</Typography>
                    </Box>
                    <Box sx={{ p: 1.25, flex: 1, minHeight: 0 }}>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                                gridAutoRows: 'minmax(0, 1fr)',
                                gap: 0.75,
                                alignItems: 'stretch',
                                height: '100%',
                            }}
                        >
                            {declarationInfoItems.map((item) => (
                                <Box
                                    key={item.label}
                                    sx={{
                                        px: 1,
                                        py: 0.75,
                                        border: 1,
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        bgcolor: 'grey.50',
                                        minWidth: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        minHeight: 0,
                                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                                        overflow: 'hidden',
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>{item.label}</Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            mt: 0.25,
                                            fontWeight: 700,
                                            wordBreak: 'break-word',
                                            lineHeight: 1.25,
                                            color: item.label === '申报状态'
                                                ? (item.value === '已申报' ? 'success.main' : 'warning.main')
                                                : 'text.primary',
                                        }}
                                    >
                                        {item.value}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Paper>

                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', xl: 'row' }, gap: 1.5, minHeight: 0, flex: 1 }}>
                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1.2, display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 2, overflow: 'hidden', backgroundColor: 'background.paper' }}>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>未申报曲线</Typography>
                            {simulation.trade_type === 'auto' && <Alert severity="info" sx={{ mb: 1.25, flexShrink: 0 }}>自动策略申报只读展示，不支持前端编辑。</Alert>}
                            {simulation.trade_type === 'manual' && !canEdit && <Alert severity="warning" sx={{ mb: 1.25, flexShrink: 0 }}>当前账号缺少写权限，仅支持查看人工方案。</Alert>}
                            {simulation.trade_type === 'manual' && canEdit && !simulation.is_editable && <Alert severity="warning" sx={{ mb: 1.25, flexShrink: 0 }}>{simulation.lock_reason || '当前不可编辑'}</Alert>}
                            {simulation.trade_type === 'manual' && canEdit && simulation.is_editable && (
                                <Alert severity="info" sx={{ mb: 1.25, flexShrink: 0 }}>
                                    可在上下图表中直接框选时段，随后在右侧使用批量编辑快速调整申报电量。
                                </Alert>
                            )}
                            <Box
                                ref={simulationChartRef}
                                onMouseMove={handleSimulationContainerMouseMove}
                                onMouseLeave={handleSimulationMouseLeave}
                                sx={{
                                    flex: 1,
                                    minHeight: 260,
                                    position: 'relative',
                                    ...(simulationFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1300, backgroundColor: 'background.paper', p: 2 }),
                                    '& .recharts-surface:focus': { outline: 'none' },
                                    '& *:focus': { outline: 'none !important' },
                                }}
                            >
                                <simulationFullscreen.FullscreenEnterButton />
                                <simulationFullscreen.FullscreenExitButton />
                                <simulationFullscreen.FullscreenTitle />
                                {simulationHoveredRow && (
                                    <Paper
                                        variant="outlined"
                                        sx={{
                                            position: 'absolute',
                                            zIndex: 3,
                                            px: 1.5,
                                            py: 1.25,
                                            minWidth: 188,
                                            maxWidth: 220,
                                            pointerEvents: 'none',
                                            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
                                            ...simulationTooltipSx,
                                        }}
                                    >
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>时段 {simulationHoveredRow.period}</Typography>
                                        <Typography variant="body2">预测价格：{simulationHoveredRow.priceForecast.toFixed(1)} 元/MWh</Typography>
                                        <Typography variant="body2">申报电量：{simulationHoveredRow.bidMwh.toFixed(1)} MWh</Typography>
                                    </Paper>
                                )}
                                <Box sx={{ height: '58%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={simulationRows}
                                            syncId="bid-simulation"
                                            margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                                            onMouseDown={handleSimulationMouseDown}
                                            onMouseMove={handleSimulationMouseMove}
                                            onMouseUp={handleSimulationMouseUp}
                                            onMouseLeave={handleSimulationMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis
                                                dataKey="period"
                                                interval={3}
                                                height={20}
                                                tick={false}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <YAxis width={44} label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                            <Line type="monotone" dataKey="priceForecast" stroke="#1d4ed8" dot={false} strokeWidth={2.2} />
                                            {simulationHoveredPeriod != null && <ReferenceLine x={simulationHoveredPeriod} stroke="#64748b" strokeDasharray="4 4" />}
                                            {simulationRefAreaLeft != null && simulationRefAreaRight != null && (
                                                <ReferenceArea
                                                    x1={Math.min(simulationRefAreaLeft, simulationRefAreaRight)}
                                                    x2={Math.max(simulationRefAreaLeft, simulationRefAreaRight)}
                                                    strokeOpacity={0.2}
                                                    fill="#93c5fd"
                                                    fillOpacity={0.25}
                                                />
                                            )}
                                            {simulationSelection && (
                                                <ReferenceArea
                                                    x1={simulationSelection.start + 1}
                                                    x2={simulationSelection.end + 1}
                                                    strokeOpacity={0.15}
                                                    fill="#bfdbfe"
                                                    fillOpacity={0.18}
                                                />
                                            )}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: '42%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={simulationRows}
                                            syncId="bid-simulation"
                                            margin={{ top: 6, right: 16, left: 0, bottom: 8 }}
                                            onMouseDown={handleSimulationMouseDown}
                                            onMouseMove={handleSimulationMouseMove}
                                            onMouseUp={handleSimulationMouseUp}
                                            onMouseLeave={handleSimulationMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" interval={3} height={20} tick={{ fontSize: 12 }} />
                                            <YAxis width={44} label={{ value: 'MWh', angle: -90, position: 'insideLeft' }} />
                                            <ReferenceLine y={0} stroke="#94a3b8" />
                                            {simulationHoveredPeriod != null && <ReferenceLine x={simulationHoveredPeriod} stroke="#64748b" strokeDasharray="4 4" />}
                                            {simulationRefAreaLeft != null && simulationRefAreaRight != null && (
                                                <ReferenceArea
                                                    x1={Math.min(simulationRefAreaLeft, simulationRefAreaRight)}
                                                    x2={Math.max(simulationRefAreaLeft, simulationRefAreaRight)}
                                                    strokeOpacity={0.2}
                                                    fill="#93c5fd"
                                                    fillOpacity={0.25}
                                                />
                                            )}
                                            {simulationSelection && (
                                                <ReferenceArea
                                                    x1={simulationSelection.start + 1}
                                                    x2={simulationSelection.end + 1}
                                                    strokeOpacity={0.15}
                                                    fill="#bfdbfe"
                                                    fillOpacity={0.18}
                                                />
                                            )}
                                            <Bar dataKey="bidMwh" fill={simulation.trade_type === 'auto' ? '#0f766e' : '#2563eb'} radius={[4, 4, 0, 0]} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Box>
                    </Paper>

                    <Paper
                        variant="outlined"
                        sx={{
                            p: 0,
                            width: { xs: '100%', xl: 420 },
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            borderRadius: 2,
                            background: 'linear-gradient(180deg, rgba(255,247,237,0.65) 0%, rgba(255,255,255,1) 100%)',
                            overflow: 'hidden',
                        }}
                    >
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0, flex: 1, px: 1.5, pt: 1.5 }}>
                                <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, flexShrink: 0 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mb: 1 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{simulationSelectionLabel}</Typography>
                                        {simulationSelection && (
                                            <Button size="small" onClick={clearSimulationSelection}>清除选择</Button>
                                        )}
                                    </Box>
                                    <Stack direction="row" spacing={0} sx={{ alignItems: 'stretch' }}>
                                        <TextField
                                            size="small"
                                            placeholder="数值"
                                            value={batchValue}
                                            onChange={(event) => setBatchValue(event.target.value)}
                                            fullWidth
                                            disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}
                                        />
                                        <Button variant="outlined" sx={{ minWidth: 56, borderLeft: 0, borderRadius: 0 }} onClick={() => applySimulationBatch('percent')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>%</Button>
                                        <Button variant="outlined" sx={{ minWidth: 56, borderLeft: 0, borderRadius: 0 }} onClick={() => applySimulationBatch('set')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>=</Button>
                                        <Button variant="outlined" sx={{ minWidth: 56, borderLeft: 0, borderRadius: '0 8px 8px 0' }} onClick={() => applySimulationBatch('add')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>+</Button>
                                    </Stack>
                                </Paper>
                            <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
                                <Table stickyHeader size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>时段</TableCell>
                                            <TableCell align="right">当前值</TableCell>
                                            <TableCell align="right">原始值</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {simulationRows.map((row, index) => (
                                            <TableRow key={row.period} hover>
                                                <TableCell>{row.period}</TableCell>
                                                <TableCell align="right">
                                                    {simulation.trade_type === 'manual' ? (
                                                        <TextField size="small" type="number" value={simulationDraft[index] ?? 0} disabled={!simulation.is_editable || !canEdit} onChange={(event) => {
                                                            const next = Number(event.target.value);
                                                            setSimulationDraft((prev) => prev.map((item, itemIndex) => itemIndex === index ? next : item));
                                                        }} inputProps={{ min: 0, max: 300, step: 0.1, style: { textAlign: 'right' } }} sx={{ width: 110 }} />
                                                    ) : (
                                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{(simulationDraft[index] || 0).toFixed(1)}</Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell align="right">{(simulation.bid_mwh_30m[index] || 0).toFixed(1)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                                <Stack direction="row" spacing={1.5} sx={{ px: 1.5, pb: 1.5, pt: 0 }}>
                                    <Button
                                        fullWidth
                                        variant="contained"
                                        startIcon={<SaveOutlinedIcon />}
                                        onClick={() => void saveSimulation()}
                                        disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual'}
                                    >
                                        保存调整
                                    </Button>
                                        <Button
                                            fullWidth
                                            variant="outlined"
                                            onClick={() => void resetSimulationDraft()}
                                            disabled={!canEdit || simulation.trade_type !== 'manual'}
                                        >
                                            重置
                                        </Button>
                                </Stack>
                    </Box>
                    </Paper>
                </Box>
            </Box>
        );
    };

    const mobileLayoutSx = {
        display: 'flex',
        flexDirection: 'column',
        gap: { xs: 1.5, sm: 2 },
        px: { xs: 1.5, sm: 2 },
        pt: { xs: 1.5, sm: 2 },
        pb: { xs: 1.5, sm: 2 },
        minHeight: '100%',
    } as const;

    const desktopLayoutSx = {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        px: 2,
        py: 2,
        height: 'calc(100vh - 64px - 49px)',
        minHeight: 0,
        overflow: 'hidden',
    } as const;

    const renderProfitPanel = () => {
        if (!profitSummary) return <Alert severity="info">请选择左侧策略后查看收益分析。</Alert>;
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 1.5,
                        borderRadius: 2,
                        background: 'linear-gradient(135deg, rgba(255,255,255,1) 0%, rgba(241,245,249,0.96) 100%)',
                    }}
                >
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" alignItems={{ md: 'center' }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <DatePicker label="开始日期" value={profitStartDate} onChange={setProfitStartDate} slotProps={{ textField: { size: 'small', sx: { width: 150 } } }} />
                            <Typography variant="body2" color="text.secondary">-</Typography>
                            <DatePicker label="结束日期" value={profitEndDate} onChange={setProfitEndDate} slotProps={{ textField: { size: 'small', sx: { width: 150 } } }} />
                        </Stack>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('thisMonth')}>本月</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('lastMonth')}>上月</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('30d')}>30天</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('60d')}>60天</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('thisYear')}>本年</Button>
                        </Stack>
                        <ToggleButtonGroup size="small" exclusive value={profitMetric} onChange={(_event, value) => value && setProfitMetric(value)} sx={{ ml: { md: 'auto' } }}>
                            <ToggleButton value="amount">金额收益</ToggleButton>
                            <ToggleButton value="unit">兆瓦时收益</ToggleButton>
                        </ToggleButtonGroup>
                    </Stack>
                </Paper>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 0,
                        borderRadius: 2,
                        overflow: 'hidden',
                        backgroundColor: 'background.paper',
                    }}
                >
                    <Box sx={{ px: 1.5, py: 1.25, backgroundColor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>策略指标</Typography>
                    </Box>
                    <Box sx={{ p: 1.25 }}>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
                                gridAutoRows: 'minmax(0, 1fr)',
                                gap: 0.75,
                                alignItems: 'stretch',
                            }}
                        >
                            {profitMetricItems.map((item) => (
                                <Box
                                    key={item.title}
                                    sx={{
                                        px: 1,
                                        py: 0.75,
                                        border: 1,
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        bgcolor: 'grey.50',
                                        minWidth: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        minHeight: 0,
                                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                                        overflow: 'hidden',
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                                        {item.title}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            mt: 0.25,
                                            fontWeight: 700,
                                            color: item.color || 'text.primary',
                                            fontSize: { xs: '0.92rem', md: '1rem' },
                                            lineHeight: 1.2,
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {item.value}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Paper>
                <Paper
                    variant="outlined"
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        flex: 1,
                        borderRadius: 2,
                        background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.96) 100%)',
                    }}
                >
                    <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>策略收益曲线</Typography>
                        </Box>
                        <Tabs value={profitTab} onChange={(_event, value) => setProfitTab(value)}>
                            <Tab label="联合图表" />
                            <Tab label="数据表格" />
                        </Tabs>
                    </Box>
                    <Box sx={{ pt: 1, px: 1.5, pb: 0.75, flex: 1, minHeight: 0 }}>
                        {profitTab === 0 ? (
                            <Box
                                onMouseMove={handleProfitContainerMouseMove}
                                onMouseLeave={handleProfitMouseLeave}
                                sx={{
                                    height: '100%',
                                    minHeight: 260,
                                    position: 'relative',
                                    '& .recharts-surface:focus': { outline: 'none' },
                                    '& *:focus': { outline: 'none !important' },
                                }}
                            >
                                {profitHoveredRow && (
                                    <Paper
                                        variant="outlined"
                                        sx={{
                                            position: 'absolute',
                                            zIndex: 3,
                                            px: 1.5,
                                            py: 1.25,
                                            minWidth: 188,
                                            maxWidth: 220,
                                            pointerEvents: 'none',
                                            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
                                            ...profitTooltipSx,
                                        }}
                                    >
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{profitHoveredRow.date}</Typography>
                                        <Typography variant="body2">策略收益：{profitHoveredRow.strategyValue == null ? '-' : `${profitHoveredRow.strategyValue.toFixed(3)} ${profitHoveredRow.strategyUnit}`}</Typography>
                                        <Typography variant="body2">申报电量：{profitHoveredRow.bidTotalMwh == null ? '-' : `${profitHoveredRow.bidTotalMwh.toFixed(1)} MWh`}</Typography>
                                    </Paper>
                                )}
                                <Box sx={{ height: '52%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={profitChartRows}
                                            syncId="profit-analysis"
                                            margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                                            onMouseMove={handleProfitMouseMove}
                                            onMouseLeave={handleProfitMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" hide interval={0} />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            {profitHoveredDate && <ReferenceLine x={profitHoveredDate} stroke="#64748b" strokeDasharray="4 4" />}
                                            <Line type="monotone" dataKey="strategyValue" stroke="#1d4ed8" strokeWidth={2.2} dot={false} connectNulls={false} name="策略收益" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: '48%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={profitChartRows}
                                            syncId="profit-analysis"
                                            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
                                            onMouseMove={handleProfitMouseMove}
                                            onMouseLeave={handleProfitMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis
                                                dataKey="date"
                                                tick={{ fontSize: 11 }}
                                                tickFormatter={(value: string) => format(new Date(value), 'MM-dd')}
                                                interval={profitDateTickInterval}
                                                height={36}
                                            />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            {profitHoveredDate && <ReferenceLine x={profitHoveredDate} stroke="#64748b" strokeDasharray="4 4" />}
                                            <Bar dataKey="bidTotalMwh" fill="#2563eb" name="申报电量" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Box>
                        ) : (
                            <TableContainer sx={{ height: '100%', minHeight: 260, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                                <Table stickyHeader size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>日期</TableCell>
                                            <TableCell align="right">申报电量</TableCell>
                                            <TableCell align="right">策略收益</TableCell>
                                            <TableCell align="right">单位收益</TableCell>
                                            <TableCell align="right">盈利时段</TableCell>
                                            <TableCell align="right">亏损时段</TableCell>
                                            <TableCell align="right">平均价差</TableCell>
                                            <TableCell align="right">操作</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {profitRows.map((row) => (
                                            <TableRow key={row.date} hover>
                                                <TableCell>{row.date}</TableCell>
                                                <TableCell align="right">{row.bid_total_mwh.toFixed(1)} MWh</TableCell>
                                                <TableCell align="right">{(row.realized_pnl_yuan / 10000).toFixed(3)} 万元</TableCell>
                                                <TableCell align="right">{row.unit_pnl_yuan_per_mwh.toFixed(3)} 元/MWh</TableCell>
                                                <TableCell align="right">{row.win_periods}</TableCell>
                                                <TableCell align="right">{row.loss_periods}</TableCell>
                                                <TableCell align="right">{row.avg_spread_yuan_per_mwh.toFixed(2)} 元/MWh</TableCell>
                                                <TableCell align="right">
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={() => openDailyReviewFromProfitRow(row.date)}
                                                    >
                                                        查看复盘
                                                    </Button>
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

    const renderReviewPanel = () => {
        if (!dailyReview) return <Alert severity="info">请选择策略和日期后查看单日复盘。</Alert>;
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', minHeight: 0 }}>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 1.5,
                        borderRadius: 2,
                        background: 'linear-gradient(135deg, rgba(15,118,110,0.05) 0%, rgba(14,165,233,0.05) 100%)',
                    }}
                >
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" alignItems={{ md: 'center' }}>
                        <FormControl size="small" sx={{ minWidth: 240 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>策略选择</Typography>
                            <Select value={selectedTradeSourceId} onChange={(event) => setSelectedTradeSourceId(event.target.value)}>
                                {tradeSources.map((item) => <MenuItem key={item.trade_source_id} value={item.trade_source_id}>{item.trade_source_name}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <DatePicker label="日期选择" value={reviewTargetDate} onChange={setReviewTargetDate} slotProps={{ textField: { size: 'small', sx: { width: 180 } } }} />
                    </Stack>
                </Paper>
                <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
                    <MetricCard title="预期收益" value={`${dailyReview.summary.expected_pnl_yuan.toFixed(2)} 元`} />
                    <MetricCard title="实际收益" value={`${dailyReview.summary.realized_pnl_yuan.toFixed(2)} 元`} color={dailyReview.summary.realized_pnl_yuan >= 0 ? '#166534' : '#b91c1c'} />
                    <MetricCard title="总电量" value={`${dailyReview.summary.total_bid_mwh.toFixed(1)} MWh`} />
                    <MetricCard title="正收益时段数" value={`${dailyReview.summary.win_periods}`} />
                    <MetricCard title="负收益时段数" value={`${dailyReview.summary.loss_periods}`} />
                </Stack>
                <Paper
                    variant="outlined"
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        flex: 1,
                        borderRadius: 2,
                        background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.96) 100%)',
                    }}
                >
                    <Box sx={{ px: 1.5, pt: 1.25, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>单日复盘工作台</Typography>
                            <Typography variant="body2" color="text.secondary">图表与时段收益表同面板切换，便于对照查看单日结果。</Typography>
                        </Box>
                        <Tabs value={reviewTab} onChange={(_event, value) => setReviewTab(value)}>
                            <Tab label="联合图表" />
                            <Tab label="时段收益表" />
                        </Tabs>
                    </Box>
                    <Box sx={{ p: 1.5, flex: 1, minHeight: 0 }}>
                        {reviewTab === 0 ? (
                            <Box sx={{ height: 440, '& .recharts-surface:focus': { outline: 'none' }, '& *:focus': { outline: 'none !important' } }}>
                                <Box sx={{ height: '54%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={dailyReview.chart_rows} syncId="daily-review" margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" hide />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            <Tooltip formatter={(value: number) => value.toFixed(2)} />
                                            <Line type="monotone" dataKey="price_forecast_yuan_per_mwh" stroke="#1d4ed8" dot={false} name="预测价格" />
                                            <Line type="monotone" dataKey="econ_price_yuan_per_mwh" stroke="#ea580c" dot={false} name="经济出清价格" />
                                            <Line type="monotone" dataKey="realtime_price_yuan_per_mwh" stroke="#6b7280" dot={false} name="实时价格" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: '24%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={dailyReview.chart_rows} syncId="daily-review" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" hide />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            <Bar dataKey="bid_mwh" fill="#0f766e" name="申报电量" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: '22%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={dailyReview.chart_rows} syncId="daily-review" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" interval={3} tick={{ fontSize: 12 }} />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            <Bar dataKey="period_pnl_yuan" fill="#f59e0b" name="时段收益" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Box>
                        ) : (
                            <TableContainer sx={{ maxHeight: 440, borderRadius: 2 }}>
                                <Table stickyHeader size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>时段</TableCell>
                                            <TableCell>时间</TableCell>
                                            <TableCell align="right">预测价</TableCell>
                                            <TableCell align="right">经济价</TableCell>
                                            <TableCell align="right">实时价</TableCell>
                                            <TableCell align="right">申报电量</TableCell>
                                            <TableCell align="right">时段收益</TableCell>
                                            <TableCell align="right">结果</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {dailyReview.period_profit_rows.map((row) => (
                                            <TableRow key={row.period} hover>
                                                <TableCell>{row.period}</TableCell>
                                                <TableCell>{row.time_label}</TableCell>
                                                <TableCell align="right">{row.price_forecast_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.econ_price_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.realtime_price_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.bid_mwh.toFixed(1)}</TableCell>
                                                <TableCell align="right">{row.period_pnl_yuan.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.result_flag}</TableCell>
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

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box
                sx={{
                    height: isMobile ? 'auto' : 'calc(100vh - 64px - 49px)',
                    minHeight: isMobile ? '100%' : 0,
                    width: '100%',
                    bgcolor: 'background.default',
                    overflowX: 'hidden',
                    overflowY: isMobile ? 'auto' : 'hidden',
                }}
            >
                <Box sx={isMobile ? mobileLayoutSx : desktopLayoutSx}>
                    {isMobile && <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>交易策略 / 日前模拟交易</Typography>}
                    {feedback && <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 1.5, md: 1.5 }, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <Paper
                        variant="outlined"
                        sx={{
                            width: { xs: '100%', md: 300 },
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: { md: 0 },
                            overflow: 'hidden',
                            borderRadius: 2,
                            background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.96) 100%)',
                        }}
                    >
                        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>策略列表</Typography>
                            {canEdit && <>
                                <IconButton size="small" onClick={() => setManagementOpen((prev) => !prev)}><SettingsOutlinedIcon fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={openCreateDialog}><AddIcon fontSize="small" /></IconButton>
                            </>}
                        </Box>
                        <Divider />
                        <List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
                            {tradeSources.map((item) => (
                                <ListItemButton key={item.trade_source_id} selected={selectedTradeSourceId === item.trade_source_id} onClick={() => setSelectedTradeSourceId(item.trade_source_id)} sx={{ alignItems: 'flex-start', borderBottom: 1, borderColor: 'divider' }}>
                                    <ListItemText
                                        primary={<Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                                            <Typography variant="body2" sx={{ fontWeight: 700, color: item.trade_source_status === '停用' ? 'text.disabled' : 'text.primary', flex: 1 }}>
                                                {item.trade_source_name}
                                            </Typography>
                                            <Chip size="small" label={item.next_day_declare_status} color={item.next_day_declare_status === '已申报' ? 'success' : 'warning'} />
                                        </Stack>}
                                        secondary={item.strategy_code || item.trade_source_id}
                                    />
                                    {managementOpen && canEdit && <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
                                        <IconButton size="small" onClick={(event) => { event.stopPropagation(); void openEditDialog(item.trade_source_id); }}><EditOutlinedIcon fontSize="small" /></IconButton>
                                        <IconButton size="small" onClick={(event) => { event.stopPropagation(); void handleStatusToggle(item); }}>{item.trade_source_status === '启用' ? <VisibilityOutlinedIcon fontSize="small" /> : <ArrowRightIcon fontSize="small" />}</IconButton>
                                        <IconButton size="small" color="error" onClick={(event) => { event.stopPropagation(); void handleDelete(item.trade_source_id); }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                    </Stack>}
                                </ListItemButton>
                            ))}
                        </List>
                        {canEdit && <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
                            <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={openCreateDialog}>新增策略</Button>
                        </Box>}
                    </Paper>

                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1.25, overflow: 'hidden' }}>
                        <Paper
                            variant="outlined"
                            sx={{
                                px: 1,
                                py: 0.25,
                                flexShrink: 0,
                                borderRadius: 2,
                                background: 'linear-gradient(135deg, rgba(255,255,255,1) 0%, rgba(241,245,249,0.96) 100%)',
                            }}
                        >
                            <Tabs
                                value={activePanel}
                                onChange={(_event, value) => setActivePanel(value)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{
                                    minHeight: 40,
                                    '& .MuiTab-root': {
                                        minHeight: 40,
                                        py: 0.5,
                                        px: 1.25,
                                    },
                                }}
                            >
                                <Tab icon={<TimelineOutlinedIcon />} iconPosition="start" label="模拟申报" />
                                <Tab icon={<AnalyticsOutlinedIcon />} iconPosition="start" label="策略收益" />
                                <Tab icon={<StyleOutlinedIcon />} iconPosition="start" label="单日复盘" />
                                <Tab label="策略对比" />
                            </Tabs>
                        </Paper>
                        <Box
                            sx={{
                                p: 0,
                                flex: 1,
                                minHeight: 0,
                                overflow: 'auto',
                            }}
                        >
                            {activePanel === 0 && renderSimulationPanel()}
                            {activePanel === 1 && renderProfitPanel()}
                            {activePanel === 2 && renderReviewPanel()}
                            {activePanel === 3 && (
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        p: 2,
                                        borderRadius: 2,
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.04) 0%, rgba(249,115,22,0.05) 100%)',
                                    }}
                                >
                                    <Stack spacing={1.5}>
                                        <Box>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>策略对比</Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                首版先保留面板位置与视觉容器，后续可直接接入多策略对比曲线、指标卡和差值分析。
                                            </Typography>
                                        </Box>
                                        <Alert severity="info">策略对比首版暂不开放真实计算，当前保留占位说明。</Alert>
                                    </Stack>
                                </Paper>
                            )}
                        </Box>
                    </Box>
                    </Box>

                    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
                        <DialogTitle>{editingDetail?.trade_source_id ? '编辑策略' : '新增策略'}</DialogTitle>
                        <DialogContent>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <TextField fullWidth label="策略名称" value={editingDetail?.trade_source_name || ''} onChange={(event) => updateEditingField('trade_source_name', event.target.value)} disabled={!canEdit} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <FormControl fullWidth size="small">
                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>类型</Typography>
                                            <Select value={editingDetail?.trade_type || 'manual'} disabled={!canEdit || Boolean(editingDetail?.trade_source_id)} onChange={(event) => updateEditingField('trade_type', event.target.value as 'manual' | 'auto')}>
                                                <MenuItem value="manual">人工</MenuItem>
                                                <MenuItem value="auto">自动</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <TextField fullWidth label="策略编号" value={editingDetail?.strategy_code || ''} onChange={(event) => updateEditingField('strategy_code', event.target.value)} disabled={!canEdit} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 9 }}>
                                        <TextField fullWidth label="策略说明" value={editingDetail?.description || ''} onChange={(event) => updateEditingField('description', event.target.value)} disabled={!canEdit} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 3 }}>
                                        <Stack direction="row" spacing={1} alignItems="center" sx={{ height: '100%' }}>
                                            <Typography variant="body2">停用</Typography>
                                            <Switch checked={(editingDetail?.trade_source_status || '启用') === '启用'} onChange={(event) => updateEditingField('trade_source_status', event.target.checked ? '启用' : '停用')} disabled={!canEdit} />
                                            <Typography variant="body2">启用</Typography>
                                        </Stack>
                                    </Grid>
                                </Grid>
                                <Divider />
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>参数表格</Typography>
                                    <Button size="small" startIcon={<AddIcon />} onClick={() => updateEditingField('params', [...(editingDetail?.params || [EMPTY_PARAM]), { ...EMPTY_PARAM }])} disabled={!canEdit}>新增参数</Button>
                                </Box>
                                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>参数键</TableCell>
                                                <TableCell>参数名</TableCell>
                                                <TableCell>参数值</TableCell>
                                                <TableCell>单位</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {(editingDetail?.params || [EMPTY_PARAM]).map((param, index) => (
                                                <TableRow key={`${param.param_key}-${index}`}>
                                                    <TableCell><TextField size="small" value={param.param_key} onChange={(event) => updateEditingParam(index, 'param_key', event.target.value)} disabled={!canEdit} /></TableCell>
                                                    <TableCell><TextField size="small" value={param.param_name} onChange={(event) => updateEditingParam(index, 'param_name', event.target.value)} disabled={!canEdit} /></TableCell>
                                                    <TableCell><TextField size="small" value={param.param_value} onChange={(event) => updateEditingParam(index, 'param_value', event.target.value)} disabled={!canEdit} /></TableCell>
                                                    <TableCell><TextField size="small" value={param.unit} onChange={(event) => updateEditingParam(index, 'unit', event.target.value)} disabled={!canEdit} /></TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Box>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setDialogOpen(false)}>取消</Button>
                            <Button variant="contained" onClick={() => void handleDialogSubmit()} disabled={!canEdit || !(editingDetail?.trade_source_name || '').trim()}>保存</Button>
                        </DialogActions>
                    </Dialog>
                </Box>
            </Box>
        </LocalizationProvider>
    );
};

export default DayAheadSimulationPage;
