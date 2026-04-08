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
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
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
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
    DailyReviewDetail,
    ProfitCurvePoint,
    ProfitDailyRow,
    ProfitMetric,
    ProfitSummary,
    SimulationDetail,
    TradeSourceDetail,
    TradeSourceListItem,
    TradeSourcePayload,
    TradeSourceParam,
    dayAheadBidApi,
} from '../api/dayAheadBid';
import { useAuth } from '../contexts/AuthContext';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

type PanelKey = 0 | 1 | 2 | 3;

const EDIT_PERMISSION = 'module:strategy_dayahead:edit';
const EMPTY_PARAM: TradeSourceParam = { param_key: '', param_name: '', param_value: '', unit: '', description: '' };
const PARAM_DOC_EXPLANATIONS: Record<string, { param_name: string; unit: string; description: string }> = {
    max_bid_mwh_per_period: { param_name: '单时段申报上限', unit: 'MWh', description: '单个 30 分钟时段的申报电量上限。最终 bid_mwh = bid_ratio × max_bid_mwh_per_period。' },
    daily_budget_ratio_base: { param_name: '全天预算基础比例', unit: '-', description: '全天总预算的基础比例。S5 会先按这个比例估算全天可分配总电量，再结合风险分和市场容量继续压缩或收敛。' },
    daily_budget_floor_ratio: { param_name: '全天预算下限比例', unit: '-', description: '全天预算下限。即使当天风险很高，预算压缩也不会低于这一保底比例。' },
    daily_budget_ceiling_ratio: { param_name: '全天预算上限比例', unit: '-', description: '全天预算上限。即使信号很强，全天总报量也不能超过这一上限比例。' },
    max_adjacent_jump: { param_name: '相邻时段最大跳变幅度', unit: '-', description: '相邻半小时时段的最大跳变幅度限制，用于抑制报量曲线过于尖锐，避免出现不合理的大起大落。' },
    strong_ev_quantile: { param_name: '强信号分位点', unit: '-', description: '用于识别强信号时段的 expected_value 分位点。值越高，只有更靠前的强信号时段才能进入高优先级分配。' },
    isolated_point_keep_quantile: { param_name: '孤立高分保留分位点', unit: '-', description: '用于保留孤立高分时段的阈值。值越高，只有非常强的孤立信号才会被保留下来，普通孤立点更容易被压缩或清零。' },
    impact_cap_ratio: { param_name: '市场冲击约束比例', unit: '-', description: '市场冲击约束比例。某时段的申报电量不能超过 market_cleared_mwh_reference × impact_cap_ratio。' },
    high_risk_floor_multiplier: { param_name: '高风险预算压缩系数', unit: '-', description: '当 abnormal_day_risk_score 超过高风险阈值时，用这个系数压缩全天预算。系数越小，风险日越保守。' },
    high_risk_threshold: { param_name: '高风险阈值', unit: '-', description: '高风险日阈值。风险分达到或超过该值时，S5 会触发更严格的预算压缩和单时段限仓。' },
    pre_sched_gap_penalty_threshold: { param_name: '预计划价差惩罚阈值', unit: '元/MWh', description: '预计划价格与自研价格预测之间的偏差阈值。如果二者差异过大，说明市场先验与模型判断冲突，S5 会对该时段额外降仓。' },
    high_risk_max_ratio: { param_name: '高风险单时段上限比例', unit: '-', description: '高风险日单时段最高允许申报比例。即使其他信号很强，只要当天被判定为高风险，也不能超过这个档位。' },
    model_path: { param_name: '模型文件路径', unit: '路径', description: 'AUTO_S5 默认加载的模型文件路径。日常自动预测、手工 bid-predict 在未显式指定模型路径时，默认使用这里的模型。' },
};
const PARAM_DOC_EXPLANATION_LIST = Object.entries(PARAM_DOC_EXPLANATIONS).map(([paramKey, meta]) => ({ paramKey, ...meta }));

const formatProfitAmountWan = (value: number) => `${(value / 10000).toFixed(3)} 万元`;

const formatProfitPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

const formatProfitRatio = (value: number) => (value > 0 ? value.toFixed(2) : '--');

const getMatchedParamDocMeta = (param: Pick<TradeSourceParam, 'param_key' | 'param_name'>) => {
    const key = (param.param_key || '').trim();
    const name = (param.param_name || '').trim();
    return PARAM_DOC_EXPLANATION_LIST.find((item) => item.paramKey === key || item.param_name === name) || null;
};

const getInferredParamDescription = (param: TradeSourceParam) => {
    if (param.description?.trim()) return param.description.trim();
    return getMatchedParamDocMeta(param)?.description || '';
};

const normalizeParamForSave = (param: TradeSourceParam): TradeSourceParam => {
    const paramKey = param.param_key.trim();
    const paramName = param.param_name.trim();
    const matched = getMatchedParamDocMeta(param);
    return {
        ...param,
        param_key: paramKey || paramName,
        param_name: paramName || matched?.param_name || paramKey,
        unit: param.unit.trim() || matched?.unit || '',
        description: param.description.trim() || matched?.description || '',
    };
};

const sortTradeSources = (list: TradeSourceListItem[]) => [...list].sort((left, right) => {
    const leftActive = left.trade_source_status === '启用' ? 1 : 0;
    const rightActive = right.trade_source_status === '启用' ? 1 : 0;
    if (leftActive !== rightActive) {
        return rightActive - leftActive;
    }
    return left.trade_source_name.localeCompare(right.trade_source_name, 'zh-CN');
});

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
    const [reviewHoveredPeriod, setReviewHoveredPeriod] = useState<number | null>(null);
    const [reviewTooltipPosition, setReviewTooltipPosition] = useState<{ x: number; y: number; containerWidth: number } | null>(null);

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
                const list = sortTradeSources(await dayAheadBidApi.getTradeSources());
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
        if (isMobile && activePanel === 3) {
            setActivePanel(0);
        }
    }, [isMobile, activePanel]);

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
            setDailyReview(null);
            setReviewHoveredPeriod(null);
            setReviewTooltipPosition(null);
            if (error?.response?.status !== 404) {
                setFeedback({ severity: 'error', message: '加载单日复盘数据失败' });
            }
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

    const reviewChartRows = useMemo(() => (
        dailyReview?.chart_rows.map((row) => {
            const econPrice = row.econ_price_yuan_per_mwh ?? 0;
            const realtimePrice = row.realtime_price_yuan_per_mwh ?? 0;
            return {
                ...row,
                positivePriceBase: econPrice,
                positivePriceGap: Math.max(realtimePrice - econPrice, 0),
                negativePriceBase: realtimePrice,
                negativePriceGap: Math.max(econPrice - realtimePrice, 0),
                barColor: row.period_pnl_yuan >= 0 ? '#16a34a' : '#f97316',
            };
        }) ?? []
    ), [dailyReview]);

    const reviewHoveredRow = useMemo(
        () => reviewChartRows.find((row) => row.period === reviewHoveredPeriod) ?? null,
        [reviewChartRows, reviewHoveredPeriod],
    );

    const reviewPriceDomain = useMemo<[number, number]>(() => {
        const values = reviewChartRows.flatMap((row) => [row.econ_price_yuan_per_mwh, row.realtime_price_yuan_per_mwh])
            .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
        if (values.length === 0) return [0, 100];
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const padding = Math.max((maxValue - minValue) * 0.12, 8);
        return [Math.floor(minValue - padding), Math.ceil(maxValue + padding)];
    }, [reviewChartRows]);

    const reviewTooltipSx = useMemo(() => {
        if (!reviewTooltipPosition) {
            return {
                top: 12,
                right: 12,
            };
        }
        const tooltipWidth = 236;
        const placeLeft = reviewTooltipPosition.x <= reviewTooltipPosition.containerWidth - tooltipWidth - 24;
        return {
            left: reviewTooltipPosition.x + (placeLeft ? 16 : -16),
            top: Math.max(reviewTooltipPosition.y - 12, 12),
            transform: placeLeft ? 'translateY(-100%)' : 'translate(-100%, -100%)',
        };
    }, [reviewTooltipPosition]);

    const reviewMetricItems = useMemo(() => {
        if (!dailyReview) {
            return [
                { title: '当日收益', value: '-' },
                { title: '预期收益', value: '-' },
                { title: '申报电量', value: '-' },
                { title: '申报时段数', value: '-' },
                { title: '时段胜率', value: '-' },
                { title: '平均价差', value: '-' },
                { title: '平均申报电量', value: '-' },
                { title: '平均时段收益', value: '-' },
                { title: '单位电量收益', value: '-' },
                { title: '盈利金额', value: '-' },
                { title: '亏损金额', value: '-' },
                { title: '盈亏比', value: '-' },
                { title: '最大时段盈利', value: '-' },
                { title: '最大时段亏损', value: '-' },
                { title: '最大盈亏比', value: '-' },
                { title: '盈利时段平均', value: '-' },
                { title: '亏损时段平均', value: '-' },
                { title: '平均盈亏比', value: '-' },
            ];
        }
        const rows = dailyReview.chart_rows;
        const realizedValues = rows.map((row) => row.period_pnl_yuan ?? 0);
        const activeRows = rows.filter((row) => row.bid_mwh > 0);
        const profitValues = realizedValues.filter((value) => value > 0);
        const lossValues = realizedValues.filter((value) => value < 0);
        const totalBidMwh = dailyReview.summary.total_bid_mwh ?? 0;
        const avgPeriodPnl = rows.length > 0 ? dailyReview.summary.realized_pnl_yuan / rows.length : 0;
        const avgBidMwh = activeRows.length > 0 ? totalBidMwh / activeRows.length : 0;
        const totalSettledPeriods = dailyReview.summary.win_periods + dailyReview.summary.loss_periods;
        const totalProfit = profitValues.reduce((sum, value) => sum + value, 0);
        const totalLoss = Math.abs(lossValues.reduce((sum, value) => sum + value, 0));
        const avgProfit = profitValues.length > 0 ? totalProfit / profitValues.length : 0;
        const avgLoss = lossValues.length > 0 ? Math.abs(lossValues.reduce((sum, value) => sum + value, 0) / lossValues.length) : 0;
        const maxProfit = Math.max(...realizedValues, 0);
        const maxLoss = Math.min(...realizedValues, 0);
        return [
            { title: '当日收益', value: formatProfitAmountWan(dailyReview.summary.realized_pnl_yuan), color: dailyReview.summary.realized_pnl_yuan >= 0 ? '#dc2626' : '#2563eb' },
            { title: '预期收益', value: formatProfitAmountWan(dailyReview.summary.expected_pnl_yuan) },
            { title: '申报电量', value: `${totalBidMwh.toFixed(1)} MWh` },
            { title: '申报时段数', value: `${activeRows.length}` },
            { title: '时段胜率', value: totalSettledPeriods > 0 ? formatProfitPercent(dailyReview.summary.win_periods / totalSettledPeriods) : '-' },
            { title: '平均价差', value: `${dailyReview.summary.avg_spread_yuan_per_mwh.toFixed(2)} 元/MWh` },
            { title: '平均申报电量', value: `${avgBidMwh.toFixed(2)} MWh` },
            { title: '平均时段收益', value: formatProfitAmountWan(avgPeriodPnl) },
            { title: '单位电量收益', value: totalBidMwh > 0 ? `${(dailyReview.summary.realized_pnl_yuan / totalBidMwh).toFixed(3)} 元/MWh` : '-' },
            { title: '盈利金额', value: formatProfitAmountWan(totalProfit), color: '#dc2626' },
            { title: '亏损金额', value: totalLoss > 0 ? formatProfitAmountWan(-totalLoss) : '-', color: '#2563eb' },
            { title: '盈亏比', value: totalLoss > 0 ? formatProfitRatio(totalProfit / totalLoss) : '-' },
            { title: '最大时段盈利', value: formatProfitAmountWan(maxProfit), color: '#dc2626' },
            { title: '最大时段亏损', value: maxLoss < 0 ? formatProfitAmountWan(maxLoss) : '-', color: '#2563eb' },
            { title: '最大盈亏比', value: maxLoss < 0 ? formatProfitRatio(maxProfit / Math.abs(maxLoss)) : '-' },
            { title: '盈利时段平均', value: profitValues.length > 0 ? formatProfitAmountWan(avgProfit) : '-' },
            { title: '亏损时段平均', value: lossValues.length > 0 ? formatProfitAmountWan(-avgLoss) : '-', color: '#2563eb' },
            { title: '平均盈亏比', value: avgLoss > 0 ? formatProfitRatio(avgProfit / avgLoss) : '-' },
        ];
    }, [dailyReview]);

    const refreshTradeSources = async () => {
        const list = sortTradeSources(await dayAheadBidApi.getTradeSources());
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

    const shiftReviewDate = (days: number) => {
        if (!reviewTargetDate) return;
        setReviewTargetDate(addDays(reviewTargetDate, days));
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
        const payload: TradeSourcePayload = {
            trade_source_name: editingDetail?.trade_source_name || '',
            trade_type: editingDetail?.trade_type === 'auto' ? 'auto' : 'manual',
            strategy_code: editingDetail?.strategy_code || '',
            trade_source_status: editingDetail?.trade_source_status || '启用',
            description: editingDetail?.description || '',
            params: (editingDetail?.params || [EMPTY_PARAM])
                .map((item) => normalizeParamForSave(item))
                .filter((item) => item.param_name || item.param_key),
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

    const handleReviewMouseMove = (event: any) => {
        if (!event || typeof event.activeLabel !== 'number') return;
        setReviewHoveredPeriod(event.activeLabel);
    };

    const handleReviewMouseLeave = () => {
        setReviewHoveredPeriod(null);
        setReviewTooltipPosition(null);
    };

    const handleReviewContainerMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setReviewTooltipPosition({
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
                source_kind: 'simulation',
                readonly: false,
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
                ? (simulation.declaration_time ? format(new Date(simulation.declaration_time), 'yyyy-MM-dd HH:mm') : '--')
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
                    <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 }, flex: 1.2, display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 2, overflow: 'hidden', backgroundColor: 'background.paper' }}>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>申报曲线</Typography>
                            {simulation.trade_type === 'real' && <Alert severity="info" sx={{ mb: 1.25, flexShrink: 0 }}>真实日前交易来源只读展示，用于和模拟策略做收益分析与复盘对比。</Alert>}
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
                                    height: { xs: 'auto', md: '100%' },
                                    minHeight: { xs: 420, sm: 460, md: 260 },
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
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
                                            minWidth: { xs: 0, md: 188 },
                                            maxWidth: { xs: 'calc(100% - 16px)', md: 220 },
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
                                <Box sx={{ height: { md: '58%' }, flex: { xs: '0 0 240px', sm: '0 0 270px', md: '0 0 auto' }, minHeight: { xs: 240, sm: 270, md: 0 } }}>
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
                                            <Line type="monotone" dataKey="priceForecast" stroke="#1d4ed8" dot={false} strokeWidth={2.2} isAnimationActive={false} />
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
                                <Box sx={{ height: { md: '42%' }, flex: { xs: '0 0 180px', sm: '0 0 190px', md: '0 0 auto' }, minHeight: { xs: 180, sm: 190, md: 0 } }}>
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
                                            <Bar dataKey="bidMwh" fill={simulation.trade_type === 'manual' ? '#2563eb' : '#0f766e'} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: { xs: 420, md: 0 },
                            borderRadius: 2,
                            background: 'linear-gradient(180deg, rgba(255,247,237,0.65) 0%, rgba(255,255,255,1) 100%)',
                            overflow: 'hidden',
                        }}
                    >
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0, flex: 1, px: { xs: 1.25, sm: 1.5 }, pt: { xs: 1.25, sm: 1.5 } }}>
                                <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, flexShrink: 0 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mb: 1 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{simulationSelectionLabel}</Typography>
                                        {simulationSelection && (
                                            <Button size="small" onClick={clearSimulationSelection}>清除选择</Button>
                                        )}
                                    </Box>
                                    <Box
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: { xs: 'minmax(0, 1fr) repeat(3, 48px)', sm: 'minmax(0, 1fr) repeat(3, 56px)' },
                                            alignItems: 'stretch',
                                            minWidth: 0,
                                        }}
                                    >
                                        <TextField
                                            size="small"
                                            placeholder="数值"
                                            value={batchValue}
                                            onChange={(event) => setBatchValue(event.target.value)}
                                            fullWidth
                                            sx={{
                                                minWidth: 0,
                                                '& .MuiOutlinedInput-root': {
                                                    borderTopRightRadius: 0,
                                                    borderBottomRightRadius: 0,
                                                },
                                            }}
                                            disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}
                                        />
                                        <Button variant="outlined" sx={{ minWidth: 0, borderLeft: 0, borderRadius: 0, px: 0 }} onClick={() => applySimulationBatch('percent')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>%</Button>
                                        <Button variant="outlined" sx={{ minWidth: 0, borderLeft: 0, borderRadius: 0, px: 0 }} onClick={() => applySimulationBatch('set')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>=</Button>
                                        <Button variant="outlined" sx={{ minWidth: 0, borderLeft: 0, borderRadius: '0 8px 8px 0', px: 0 }} onClick={() => applySimulationBatch('add')} disabled={!simulation.is_editable || !canEdit || simulation.trade_type !== 'manual' || !simulationSelection}>+</Button>
                                    </Box>
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
                                                        }} inputProps={{ min: 0, max: 300, step: 0.1, style: { textAlign: 'right' } }} sx={{ width: { xs: 84, sm: 110 } }} />
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
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ px: { xs: 1.25, sm: 1.5 }, pb: { xs: 1.25, sm: 1.5 }, pt: 0 }}>
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
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                            <DatePicker label="开始日期" value={profitStartDate} onChange={setProfitStartDate} slotProps={{ textField: { size: 'small', fullWidth: true, sx: { width: { xs: '100%', sm: 150 } } } }} />
                            <Typography variant="body2" color="text.secondary">-</Typography>
                            <DatePicker label="结束日期" value={profitEndDate} onChange={setProfitEndDate} slotProps={{ textField: { size: 'small', fullWidth: true, sx: { width: { xs: '100%', sm: 150 } } } }} />
                        </Stack>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('thisMonth')}>本月</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('lastMonth')}>上月</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('30d')}>30天</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('60d')}>60天</Button>
                            <Button size="small" variant="outlined" onClick={() => applyProfitRange('thisYear')}>本年</Button>
                        </Stack>
                        <ToggleButtonGroup size="small" exclusive value={profitMetric} onChange={(_event, value) => value && setProfitMetric(value)} sx={{ ml: { md: 'auto' }, width: { xs: '100%', sm: 'auto' } }}>
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
                                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
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
                        <Tabs value={profitTab} onChange={(_event, value) => setProfitTab(value)} variant="scrollable" scrollButtons="auto">
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
                                    height: { xs: 'auto', md: '100%' },
                                    minHeight: { xs: 400, sm: 440, md: 260 },
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
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
                                            minWidth: { xs: 0, md: 188 },
                                            maxWidth: { xs: 'calc(100% - 16px)', md: 220 },
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
                                <Box sx={{ height: { md: '52%' }, flex: { xs: '0 0 220px', sm: '0 0 250px', md: '0 0 auto' }, minHeight: { xs: 220, sm: 250, md: 0 } }}>
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
                                            <Line type="monotone" dataKey="strategyValue" stroke="#1d4ed8" strokeWidth={2.2} dot={false} connectNulls={false} name="策略收益" isAnimationActive={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: { md: '48%' }, flex: { xs: '0 0 180px', sm: '0 0 190px', md: '0 0 auto' }, minHeight: { xs: 180, sm: 190, md: 0 } }}>
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
                                            <Bar dataKey="bidTotalMwh" fill="#2563eb" name="申报电量" isAnimationActive={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Box>
                        ) : (
                            <TableContainer sx={{ height: '100%', minHeight: { xs: 320, md: 260 }, borderRadius: 2, border: 1, borderColor: 'divider', overflowX: 'auto' }}>
                                <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
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
                        <Box
                            sx={{
                                width: { xs: '100%', sm: 'auto' },
                                minWidth: 0,
                                display: 'grid',
                                gridTemplateColumns: { xs: '32px minmax(0, 1fr) 32px', sm: '36px minmax(0, 180px) 36px' },
                                alignItems: 'center',
                                columnGap: 0.5,
                            }}
                        >
                            <IconButton
                                size="small"
                                onClick={() => shiftReviewDate(-1)}
                                sx={{ border: 1, borderColor: 'divider', width: { xs: 32, sm: 36 }, height: { xs: 32, sm: 36 } }}
                            >
                                <ArrowLeftIcon fontSize="small" />
                            </IconButton>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <DatePicker
                                    label={isMobile ? '日期' : '日期选择'}
                                    value={reviewTargetDate}
                                    onChange={setReviewTargetDate}
                                    slotProps={{
                                        textField: {
                                            size: 'small',
                                            fullWidth: true,
                                            sx: {
                                                width: '100%',
                                                minWidth: 0,
                                                '& .MuiInputBase-root': { minWidth: 0 },
                                            },
                                        },
                                    }}
                                />
                            </Box>
                            <IconButton
                                size="small"
                                onClick={() => shiftReviewDate(1)}
                                sx={{ border: 1, borderColor: 'divider', width: { xs: 32, sm: 36 }, height: { xs: 32, sm: 36 } }}
                            >
                                <ArrowRightIcon fontSize="small" />
                            </IconButton>
                        </Box>
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
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>复盘指标</Typography>
                    </Box>
                    <Box sx={{ p: 1.25 }}>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(9, minmax(0, 1fr))' },
                                gridAutoRows: 'minmax(0, 1fr)',
                                gap: 0.75,
                                alignItems: 'stretch',
                            }}
                        >
                            {reviewMetricItems.map((item) => (
                                <Box
                                    key={item.title}
                                    sx={{
                                        px: { xs: 1, md: 0.75 },
                                        py: { xs: 0.75, md: 0.625 },
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
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ lineHeight: 1.15, fontSize: { md: '0.68rem', lg: '0.72rem' } }}
                                    >
                                        {item.title}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            mt: 0.25,
                                            fontWeight: 700,
                                            color: item.color || 'text.primary',
                                            fontSize: { xs: '0.92rem', md: '0.82rem', lg: '0.88rem' },
                                            lineHeight: 1.15,
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
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>复盘图表</Typography>
                        </Box>
                        <Tabs value={reviewTab} onChange={(_event, value) => setReviewTab(value)} variant="scrollable" scrollButtons="auto">
                            <Tab label="曲线图表" />
                            <Tab label="时段收益表" />
                        </Tabs>
                    </Box>
                    <Box sx={{ pt: 1, px: 1.5, pb: 0.75, flex: 1, minHeight: 0 }}>
                        {reviewTab === 0 ? (
                            <Box
                                onMouseMove={handleReviewContainerMouseMove}
                                onMouseLeave={handleReviewMouseLeave}
                                sx={{
                                    height: { xs: 'auto', md: '100%' },
                                    minHeight: { xs: 420, sm: 460, md: 260 },
                                    position: 'relative',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
                                    '& .recharts-surface:focus': { outline: 'none' },
                                    '& *:focus': { outline: 'none !important' },
                                }}
                            >
                                {reviewHoveredRow && (
                                    <Paper
                                        variant="outlined"
                                        sx={{
                                            position: 'absolute',
                                            zIndex: 3,
                                            px: 1.5,
                                            py: 1.25,
                                            minWidth: { xs: 0, md: 188 },
                                            maxWidth: { xs: 'calc(100% - 16px)', md: 236 },
                                            pointerEvents: 'none',
                                            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
                                            ...reviewTooltipSx,
                                        }}
                                    >
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                            时段 {reviewHoveredRow.period} {reviewHoveredRow.time_label}
                                        </Typography>
                                        <Typography variant="body2">经济出清价格：{reviewHoveredRow.econ_price_yuan_per_mwh.toFixed(2)} 元/MWh</Typography>
                                        <Typography variant="body2">实时现货价格：{reviewHoveredRow.realtime_price_yuan_per_mwh.toFixed(2)} 元/MWh</Typography>
                                        <Typography variant="body2">实时减日前价差：{reviewHoveredRow.spread_yuan_per_mwh.toFixed(2)} 元/MWh</Typography>
                                        <Typography variant="body2">申报电量：{reviewHoveredRow.bid_mwh.toFixed(1)} MWh</Typography>
                                        <Typography variant="body2">时段收益：{reviewHoveredRow.period_pnl_yuan.toFixed(2)} 元</Typography>
                                    </Paper>
                                )}
                                {!dailyReview && (
                                    <Alert severity="info" sx={{ mb: 1.25, flexShrink: 0 }}>
                                        当前策略在所选日期暂无交易数据。
                                    </Alert>
                                )}
                                <Box sx={{ height: { md: '54%' }, flex: { xs: '0 0 240px', sm: '0 0 270px', md: '0 0 auto' }, minHeight: { xs: 240, sm: 270, md: 0 } }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={reviewChartRows}
                                            syncId="daily-review"
                                            margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                                            onMouseMove={handleReviewMouseMove}
                                            onMouseLeave={handleReviewMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" hide />
                                            <YAxis tick={{ fontSize: 12 }} domain={reviewPriceDomain} />
                                            {reviewHoveredPeriod != null && <ReferenceLine x={reviewHoveredPeriod} stroke="#64748b" strokeDasharray="4 4" />}
                                            <Area type="monotone" dataKey="positivePriceBase" stackId="positiveSpread" fill="transparent" stroke="none" isAnimationActive={false} />
                                            <Area type="monotone" dataKey="positivePriceGap" stackId="positiveSpread" fill="#86efac" fillOpacity={0.55} stroke="none" isAnimationActive={false} />
                                            <Area type="monotone" dataKey="negativePriceBase" stackId="negativeSpread" fill="transparent" stroke="none" isAnimationActive={false} />
                                            <Area type="monotone" dataKey="negativePriceGap" stackId="negativeSpread" fill="#fdba74" fillOpacity={0.55} stroke="none" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="econ_price_yuan_per_mwh" stroke="#2563eb" strokeWidth={2.2} dot={false} name="经济出清价格" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="realtime_price_yuan_per_mwh" stroke="#475569" strokeWidth={2.2} dot={false} name="实时现货价格" isAnimationActive={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                                <Box sx={{ height: { md: '46%' }, flex: { xs: '0 0 180px', sm: '0 0 190px', md: '0 0 auto' }, minHeight: { xs: 180, sm: 190, md: 0 } }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={reviewChartRows}
                                            syncId="daily-review"
                                            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
                                            onMouseMove={handleReviewMouseMove}
                                            onMouseLeave={handleReviewMouseLeave}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="period" interval={3} tick={{ fontSize: 11 }} height={36} />
                                            <YAxis tick={{ fontSize: 12 }} />
                                            {reviewHoveredPeriod != null && <ReferenceLine x={reviewHoveredPeriod} stroke="#64748b" strokeDasharray="4 4" />}
                                            <Bar dataKey="bid_mwh" name="申报电量" isAnimationActive={false}>
                                                {reviewChartRows.map((row) => (
                                                    <Cell key={`review-bar-${row.period}`} fill={row.barColor} />
                                                ))}
                                            </Bar>
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Box>
                        ) : (
                            <TableContainer sx={{ height: '100%', minHeight: { xs: 320, md: 260 }, borderRadius: 2, border: 1, borderColor: 'divider', overflowX: 'auto' }}>
                                <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>时段</TableCell>
                                            <TableCell>时间</TableCell>
                                            <TableCell align="right">经济价</TableCell>
                                            <TableCell align="right">实时价</TableCell>
                                            <TableCell align="right">价差</TableCell>
                                            <TableCell align="right">申报电量</TableCell>
                                            <TableCell align="right">时段收益</TableCell>
                                            <TableCell align="right">结果</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {(dailyReview?.period_profit_rows ?? []).map((row) => (
                                            <TableRow key={row.period} hover>
                                                <TableCell>{row.period}</TableCell>
                                                <TableCell>{row.time_label}</TableCell>
                                                <TableCell align="right">{row.econ_price_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.realtime_price_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.spread_yuan_per_mwh.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.bid_mwh.toFixed(1)}</TableCell>
                                                <TableCell align="right">{row.period_pnl_yuan.toFixed(2)}</TableCell>
                                                <TableCell align="right">{row.result_flag}</TableCell>
                                            </TableRow>
                                        ))}
                                        {!dailyReview && (
                                            <TableRow>
                                                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                                    当前策略在所选日期暂无交易数据
                                                </TableCell>
                                            </TableRow>
                                        )}
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
                    maxWidth: '100%',
                    bgcolor: 'background.default',
                    overflowX: 'hidden',
                    overflowY: isMobile ? 'auto' : 'hidden',
                }}
            >
                <Box sx={{ ...(isMobile ? mobileLayoutSx : desktopLayoutSx), maxWidth: '100%' }}>
                    {isMobile && <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>交易策略 / 日前模拟交易</Typography>}
                    {feedback && <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 1.5, md: 1.5 }, flex: 1, minHeight: 0, minWidth: 0, overflow: { xs: 'visible', md: 'hidden' } }}>
                    <Paper
                        variant="outlined"
                        sx={{
                            width: { xs: '100%', md: 300 },
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 0,
                            minHeight: { md: 0 },
                            maxHeight: { xs: 320, md: 'none' },
                            overflow: 'hidden',
                            borderRadius: 2,
                            background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.96) 100%)',
                        }}
                    >
                        <Box sx={{ p: { xs: 1.25, sm: 1.5 }, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>策略列表</Typography>
                            {canEdit && <>
                                <IconButton size="small" onClick={() => setManagementOpen((prev) => !prev)}><SettingsOutlinedIcon fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={openCreateDialog}><AddIcon fontSize="small" /></IconButton>
                            </>}
                        </Box>
                        <Divider />
                        <List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
                            {tradeSources.map((item) => (
                                <ListItemButton key={item.trade_source_id} selected={selectedTradeSourceId === item.trade_source_id} onClick={() => setSelectedTradeSourceId(item.trade_source_id)} sx={{ alignItems: 'flex-start', borderBottom: 1, borderColor: 'divider', py: { xs: 1, sm: 1.25 } }}>
                                    <ListItemText
                                        primary={<Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                                            {item.source_kind === 'real_trade' && <Chip size="small" label="真实" color="info" variant="outlined" />}
                                            <Typography variant="body2" sx={{ fontWeight: 700, color: item.trade_source_status === '停用' ? 'text.disabled' : 'text.primary', flex: 1 }}>
                                                {item.trade_source_name}
                                            </Typography>
                                            <Chip size="small" label={item.next_day_declare_status} color={item.next_day_declare_status === '已申报' ? 'success' : 'warning'} />
                                        </Stack>}
                                        secondaryTypographyProps={{ noWrap: true }}
                                        secondary={item.strategy_code || item.trade_source_id}
                                    />
                                    {managementOpen && canEdit && !item.readonly && <Stack direction="row" spacing={0.5} sx={{ ml: 1 }}>
                                        <IconButton size="small" onClick={(event) => { event.stopPropagation(); void openEditDialog(item.trade_source_id); }}><EditOutlinedIcon fontSize="small" /></IconButton>
                                        <IconButton size="small" onClick={(event) => { event.stopPropagation(); void handleStatusToggle(item); }}>{item.trade_source_status === '启用' ? <VisibilityOutlinedIcon fontSize="small" /> : <ArrowRightIcon fontSize="small" />}</IconButton>
                                        <IconButton size="small" color="error" onClick={(event) => { event.stopPropagation(); void handleDelete(item.trade_source_id); }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                    </Stack>}
                                </ListItemButton>
                            ))}
                        </List>
                        {canEdit && <Box sx={{ p: { xs: 1.25, sm: 1.5 }, borderTop: 1, borderColor: 'divider' }}>
                            <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={openCreateDialog}>新增策略</Button>
                        </Box>}
                    </Paper>

                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, gap: 1.25, overflow: { xs: 'visible', md: 'hidden' } }}>
                        <Paper
                            variant="outlined"
                            sx={{
                                px: { xs: 0.75, sm: 1 },
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
                                allowScrollButtonsMobile
                                sx={{
                                    minHeight: 40,
                                    '& .MuiTabs-scroller': {
                                        overflowX: 'auto !important',
                                    },
                                    '& .MuiTabs-flexContainer': {
                                        gap: { xs: 0.5, sm: 0.5 },
                                    },
                                    '& .MuiTab-root': {
                                        minHeight: 40,
                                        py: 0.5,
                                        px: { xs: 0.75, sm: 1.25 },
                                        minWidth: { xs: 82, sm: 'auto' },
                                        flexShrink: 0,
                                        whiteSpace: 'nowrap',
                                    },
                                    '& .MuiTabs-scrollButtons': {
                                        width: { xs: 28, sm: 32 },
                                    },
                                    '& .MuiTabs-scrollButtons.Mui-disabled': {
                                        opacity: 0.28,
                                    },
                                }}
                            >
                                <Tab icon={<TimelineOutlinedIcon />} iconPosition="start" label={isMobile ? '申报' : '模拟申报'} />
                                <Tab icon={<AnalyticsOutlinedIcon />} iconPosition="start" label={isMobile ? '收益' : '策略收益'} />
                                <Tab icon={<StyleOutlinedIcon />} iconPosition="start" label={isMobile ? '复盘' : '单日复盘'} />
                                {!isMobile && <Tab label="策略对比" />}
                            </Tabs>
                        </Paper>
                        <Box
                            sx={{
                                p: 0,
                                flex: 1,
                                minHeight: 0,
                                minWidth: 0,
                                overflow: { xs: 'visible', md: 'auto' },
                            }}
                        >
                            {activePanel === 0 && renderSimulationPanel()}
                            {activePanel === 1 && renderProfitPanel()}
                            {activePanel === 2 && renderReviewPanel()}
                            {!isMobile && activePanel === 3 && (
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
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                    <Box>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>参数表格</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            常见字段会按文档自动回填中文说明；参数键和参数名填写一个即可，保存时会自动互补。
                                        </Typography>
                                    </Box>
                                    <Button size="small" startIcon={<AddIcon />} onClick={() => updateEditingField('params', [...(editingDetail?.params || [EMPTY_PARAM]), { ...EMPTY_PARAM }])} disabled={!canEdit}>新增参数</Button>
                                </Box>
                                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell sx={{ minWidth: 240 }}>参数键</TableCell>
                                                <TableCell>参数值</TableCell>
                                                <TableCell sx={{ minWidth: 320 }}>中文说明</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {(editingDetail?.params || [EMPTY_PARAM]).map((param, index) => (
                                                <TableRow key={`${param.param_key}-${index}`}>
                                                    <TableCell>
                                                        <TextField
                                                            size="small"
                                                            fullWidth
                                                            value={param.param_key || param.param_name}
                                                            disabled
                                                            slotProps={{
                                                                input: {
                                                                    readOnly: true,
                                                                },
                                                            }}
                                                        />
                                                    </TableCell>
                                                    <TableCell><TextField size="small" value={param.param_value} onChange={(event) => updateEditingParam(index, 'param_value', event.target.value)} disabled={!canEdit} /></TableCell>
                                                    <TableCell>
                                                        <TextField
                                                            size="small"
                                                            fullWidth
                                                            multiline
                                                            minRows={2}
                                                            value={param.description || getInferredParamDescription(param)}
                                                            disabled
                                                            slotProps={{
                                                                input: {
                                                                    readOnly: true,
                                                                },
                                                            }}
                                                        />
                                                    </TableCell>
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
