import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    Card,
    CardContent,
    Stack,
    CircularProgress,
    Button,
    Chip,
    Divider,
    IconButton,
    Autocomplete,
    TextField,
    useTheme,
    useMediaQuery,
    Tooltip,
    Alert,
    alpha,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, subDays, addDays, parseISO, getDay } from 'date-fns';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
    ReferenceArea
} from 'recharts';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import DeleteIcon from '@mui/icons-material/Delete';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { CustomTooltip } from '../components/CustomTooltip';

import { customerAnalysisApi, DailyViewResponse, AnalysisStats, AutoTag } from '../api/customerAnalysis';
import customerApi, { CustomerListItem, Tag } from '../api/customer';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import TagSelector from '../components/customer/TagSelector';
import { useAuth } from '../contexts/AuthContext';

// Props 接口：支持从总览页面 Tab 传入 customerId
interface CustomerLoadAnalysisPageProps {
    customerId?: string;  // 从Tab传入时使用
}

export const CustomerLoadAnalysisPage: React.FC<CustomerLoadAnalysisPageProps> = ({ customerId: propCustomerId }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:analysis_customer_load:edit');

    // State
    const [selectedDate, setSelectedDate] = useState<Date | null>(subDays(new Date(), 2));
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerListItem | null>(null);
    const [customers, setCustomers] = useState<CustomerListItem[]>([]);

    // Data State
    const [dailyData, setDailyData] = useState<DailyViewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [historyType, setHistoryType] = useState<'daily' | 'monthly'>('daily');
    const [historyData, setHistoryData] = useState<any[]>([]);

    const [aiAnalyzing, setAiAnalyzing] = useState(false);
    const [aiSummary, setAiSummary] = useState<string | null>(null);

    // Tags State (Local cache for display)
    const [manualTags, setManualTags] = useState<Tag[]>([]);
    const [autoTags, setAutoTags] = useState<Tag[]>([]);

    const chartRef = useRef<HTMLDivElement>(null);

    // 是否为Tab模式（有propCustomerId传入时不显示客户选择器）
    const isTabMode = !!propCustomerId;

    // Date String for Title
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // Hooks
    const { FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons, isFullscreen } = useChartFullscreen({
        chartRef,
        title: selectedCustomer ? `${selectedCustomer.user_name} 负荷分析 ${dateStr}` : `客户负荷分析 ${dateStr}`,
        onPrevious: () => handleDateShift(-1),
        onNext: () => handleDateShift(1)
    });

    // TOU Background - use period_type from backend data
    const { TouPeriodAreas } = useTouPeriodBackground(dailyData?.main_curve || null);

    // Initial Customer Load
    useEffect(() => {
        // Sort by contract amount descending by default for selection list
        customerApi.getCustomers({
            page_size: 100,
            sort_field: 'current_year_contract_amount',
            sort_order: 'desc'
        }).then(res => {
            if (res.data.items && res.data.items.length > 0) {
                setCustomers(res.data.items);

                // 如果有 propCustomerId，自动选中对应客户
                if (propCustomerId) {
                    const targetCustomer = res.data.items.find(c => c.id === propCustomerId);
                    if (targetCustomer) {
                        setSelectedCustomer(targetCustomer);
                    } else {
                        // 如果在列表中找不到，尝试单独获取
                        customerApi.getCustomer(propCustomerId).then(custRes => {
                            // 构造一个兼容的对象
                            const custData = custRes.data;
                            setSelectedCustomer({
                                id: custData.id,
                                user_name: custData.user_name,
                                short_name: custData.short_name || custData.user_name,
                                tags: custData.tags || [],
                                accounts: custData.accounts,
                                current_year_contract_amount: 0,
                                created_at: custData.created_at,
                                updated_at: custData.updated_at
                            } as any);
                        }).catch(err => {
                            console.error('获取指定客户失败:', err);
                        });
                    }
                } else {
                    // Default select first one for convenience
                    setSelectedCustomer(res.data.items[0]);
                }
            }
        });
    }, [propCustomerId]);

    // Unified Data Fetching
    useEffect(() => {
        if (!selectedCustomer || !selectedDate) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            // Reset dailyData to ensure UI doesn't show stale top part while bottom is loading (or vice versa)
            // But to achieve "show together", we can keep old data until new comes, OR clear it to show loading spinner.
            // User requested "show together", likely implies a clean transition.
            setDailyData(null);

            try {
                const dateStr = format(selectedDate, 'yyyy-MM-dd');

                // Parallel requests
                const [dailyRes, historyRes, custRes] = await Promise.all([
                    customerAnalysisApi.fetchDailyView(selectedCustomer.id, dateStr),
                    customerAnalysisApi.fetchHistory(selectedCustomer.id, historyType, dateStr),
                    customerApi.getCustomer(selectedCustomer.id)
                ]);

                setDailyData(dailyRes.data);
                setHistoryData(historyRes.data);

                // Process Tags
                const tags = custRes.data.tags || [];
                setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
                setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));

            } catch (err: any) {
                console.error(err);
                setError(err.response?.data?.detail || '获取数据失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCustomer, selectedDate]); // Remove historyType from here

    // Separate effect for History Type toggle to avoid full reload
    useEffect(() => {
        if (!selectedCustomer || !selectedDate || !dailyData) return; // Only run if main data is loaded

        const updateHistory = async () => {
            try {
                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                const res = await customerAnalysisApi.fetchHistory(selectedCustomer.id, historyType, dateStr);
                setHistoryData(res.data);
            } catch (err) {
                console.error(err);
            }
        };
        updateHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [historyType]);

    const handleDateShift = (days: number) => {
        if (selectedDate) {
            setSelectedDate(addDays(selectedDate, days));
        }
    };

    const handleAiDiagnose = async () => {
        if (!canEdit) return;
        if (!selectedCustomer || !selectedDate) return;
        setAiAnalyzing(true);
        try {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await customerAnalysisApi.triggerAiDiagnose(selectedCustomer.id, dateStr);
            setAiSummary(res.data.summary);

            for (const tag of res.data.auto_tags) {
                try {
                    await customerAnalysisApi.addTag(selectedCustomer.id, {
                        name: tag.name,
                        source: 'AUTO',
                        reason: tag.reason
                    });
                } catch (e) {
                    // ignore duplicates
                }
            }

            // Refresh tags
            const custRes = await customerApi.getCustomer(selectedCustomer.id);
            const tags = custRes.data.tags || [];
            setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
            setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));

        } catch (err) {
            console.error(err);
        } finally {
            setAiAnalyzing(false);
        }
    };

    const handleManualTagChange = async (newTags: Tag[]) => {
        if (!canEdit) return;
        if (!selectedCustomer) return;

        const currentNames = new Set(manualTags.map(t => t.name));
        const newNames = new Set(newTags.map(t => t.name));

        // Find added
        for (const tag of newTags) {
            if (!currentNames.has(tag.name)) {
                await customerAnalysisApi.addTag(selectedCustomer.id, { name: tag.name, source: 'MANUAL' });
            }
        }

        // Find removed
        for (const tag of manualTags) {
            if (!newNames.has(tag.name)) {
                await customerAnalysisApi.removeTag(selectedCustomer.id, tag.name);
            }
        }

        // Refresh
        const custRes = await customerApi.getCustomer(selectedCustomer.id);
        const tags = custRes.data.tags || [];
        setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
        setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));
    };

    const handleRemoveAutoTag = async (tagName: string) => {
        if (!canEdit) return;
        if (!selectedCustomer) return;
        await customerAnalysisApi.removeTag(selectedCustomer.id, tagName);

        // Refresh
        const custRes = await customerApi.getCustomer(selectedCustomer.id);
        const tags = custRes.data.tags || [];
        setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
        setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));
    };

    const getKpiCardSx = (color: string) => ({
        height: '100%',
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha(color, 0.2),
        background: `linear-gradient(135deg, ${alpha(color, 0.03)} 0%, ${alpha(color, 0.07)} 100%)`,
        boxShadow: 'none',
    });

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 - 仅非 Tab 模式下显示 */}
                {isTablet && !isTabMode && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        负荷分析 / 客户负荷分析 / {selectedCustomer?.short_name || '请选择客户'}
                    </Typography>
                )}

                {/* 客户选择器 - Tab模式下隐藏 */}
                {!isTabMode && (
                    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                            <Autocomplete
                                options={customers}
                                getOptionLabel={(option) => option.user_name}
                                value={selectedCustomer}
                                onChange={(_, newValue) => setSelectedCustomer(newValue)}
                                renderInput={(params) => <TextField {...params} label="选择客户" size="small" />}
                                sx={{ width: { xs: '100%', md: 400 } }}
                            />
                        </Stack>
                    </Paper>
                )}

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {loading && !dailyData && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                        <CircularProgress />
                    </Box>
                )}

                {dailyData && (
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        {/* Main Chart */}
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Paper variant="outlined" sx={{ p: 1.5, height: '100%', position: 'relative' }}>
                                <Box ref={chartRef} sx={{
                                    height: 390,
                                    display: 'flex', flexDirection: 'column',
                                    position: 'relative',
                                    ...(isFullscreen && { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1400, bgcolor: 'background.paper', height: '100vh', p: 2 })
                                }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', mb: isFullscreen ? 1 : 0, flexShrink: 0 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 32 }}>
                                            {!isFullscreen && (
                                                <Stack direction="row" alignItems="center">
                                                    <Stack direction="row" alignItems="center" spacing={1}>
                                                        <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                                        <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">
                                                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>日内48点负荷曲线</Box>
                                                            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>日内曲线</Box>
                                                        </Typography>
                                                    </Stack>

                                                    <Box sx={{
                                                        display: { xs: 'none', sm: 'flex' },
                                                        alignItems: 'center',
                                                        bgcolor: 'grey.50',
                                                        borderRadius: 2,
                                                        px: 0.5,
                                                        py: 0.25,
                                                        border: '1px solid',
                                                        borderColor: 'divider',
                                                        ml: 2
                                                    }}>
                                                        <IconButton size="small" onClick={() => handleDateShift(-1)} disabled={loading}>
                                                            <ArrowLeftIcon fontSize="small" />
                                                        </IconButton>
                                                        <DatePicker
                                                            value={selectedDate}
                                                            onChange={(date) => setSelectedDate(date)}
                                                            disabled={loading}
                                                            slotProps={{
                                                                textField: {
                                                                    variant: 'standard',
                                                                    size: 'small',
                                                                    InputProps: { disableUnderline: true },
                                                                    sx: {
                                                                        width: 170,
                                                                        '& .MuiInputBase-input': {
                                                                            textAlign: 'center',
                                                                            fontSize: '0.875rem',
                                                                            fontWeight: 500,
                                                                            py: 0.3,
                                                                            cursor: 'pointer'
                                                                        }
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                        <IconButton size="small" onClick={() => handleDateShift(1)} disabled={loading}>
                                                            <ArrowRightIcon fontSize="small" />
                                                        </IconButton>
                                                    </Box>
                                                </Stack>
                                            )}

                                            <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: isFullscreen ? 'auto' : 0 }}>
                                                <Box>
                                                    <FullscreenEnterButton />
                                                    <FullscreenExitButton />
                                                </Box>
                                            </Stack>
                                        </Box>

                                        {!isFullscreen && (
                                            <Box sx={{
                                                display: { xs: 'flex', sm: 'none' },
                                                alignItems: 'center',
                                                bgcolor: 'grey.50',
                                                borderRadius: 2,
                                                px: 0.5,
                                                py: 0.25,
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                mt: 1,
                                                mb: 1.5,
                                                alignSelf: 'flex-start'
                                            }}>
                                                <IconButton size="small" onClick={() => handleDateShift(-1)} disabled={loading}>
                                                    <ArrowLeftIcon fontSize="small" />
                                                </IconButton>
                                                <DatePicker
                                                    value={selectedDate}
                                                    onChange={(date) => setSelectedDate(date)}
                                                    disabled={loading}
                                                    slotProps={{
                                                        textField: {
                                                            variant: 'standard',
                                                            size: 'small',
                                                            InputProps: { disableUnderline: true },
                                                            sx: {
                                                                width: 130,
                                                                '& .MuiInputBase-input': {
                                                                    textAlign: 'center',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 500,
                                                                    py: 0.3,
                                                                    cursor: 'pointer'
                                                                }
                                                            }
                                                        }
                                                    }}
                                                />
                                                <IconButton size="small" onClick={() => handleDateShift(1)} disabled={loading}>
                                                    <ArrowRightIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                        )}
                                    </Box>
                                    <FullscreenTitle />
                                    <NavigationButtons />

                                    <Box sx={{ flex: 1, minHeight: 0 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={dailyData.main_curve} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                                                {TouPeriodAreas}
                                                <XAxis
                                                    dataKey="time"
                                                    tick={{ fill: '#888', fontSize: 11 }}
                                                    tickLine={{ stroke: '#ccc' }}
                                                    axisLine={{ stroke: '#ccc' }}
                                                    interval={11}
                                                    tickFormatter={(value, index) => {
                                                        const totalPoints = dailyData?.main_curve?.length || 48;
                                                        if (index === 0) return '00:30';
                                                        if (index === totalPoints - 1) return '24:00';
                                                        return value;
                                                    }}
                                                />
                                                <YAxis
                                                    tick={{ fill: '#888', fontSize: 12 }}
                                                    tickLine={{ stroke: '#ccc' }}
                                                    axisLine={{ stroke: '#ccc' }}
                                                    tickCount={5}
                                                />
                                                <RechartsTooltip content={<CustomTooltip unit="MWh" />} />
                                                <Legend
                                                    verticalAlign="top"
                                                    align="right"
                                                    iconType="circle"
                                                    iconSize={8}
                                                    wrapperStyle={{ top: -10, right: 20, fontSize: 11 }}
                                                />
                                                <Line type="monotone" dataKey="current" name="当日" stroke="#2196f3" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                                                <Line type="monotone" dataKey="last_day" name="昨日" stroke="#4caf50" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="benchmark" name="基准" stroke="#9e9e9e" strokeDasharray="3 3" dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </Box>

                                    {/* 当日指标展示条 */}
                                    <Box sx={{
                                        mt: 0.2,
                                        p: 0.8,
                                        bgcolor: 'grey.50',
                                        borderRadius: 1,
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: { xs: 1, sm: 2 },
                                        alignItems: 'center',
                                        border: '1px solid',
                                        borderColor: 'grey.200'
                                    }}>
                                        {/* 总量 */}
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.7rem' }}>当日总量</Typography>
                                            <Typography sx={{ fontWeight: 'bold', lineHeight: 1, fontSize: '1.1rem' }}>
                                                {dailyData.selected_date_stats.total} <Typography component="span" sx={{ fontSize: '0.7rem', fontWeight: 'normal', color: 'text.secondary' }}>MWh</Typography>
                                            </Typography>
                                        </Box>

                                        {/* 分时结构 - 紧凑型 */}
                                        <Box sx={{ display: 'flex', gap: 0.8, flex: 1, minWidth: { xs: '100%', sm: 'auto' }, borderLeft: { sm: '1px solid' }, borderRight: { sm: '1px solid' }, borderColor: { sm: 'divider' }, px: { sm: 2 } }}>
                                            {[
                                                { label: '尖', value: dailyData.selected_date_stats.tou_usage.tip, color: '#ff5252' },
                                                { label: '峰', value: dailyData.selected_date_stats.tou_usage.peak, color: '#ff9800' },
                                                { label: '平', value: dailyData.selected_date_stats.tou_usage.flat, color: '#4caf50' },
                                                { label: '谷', value: dailyData.selected_date_stats.tou_usage.valley, color: '#2196f3' },
                                                { label: '深', value: dailyData.selected_date_stats.tou_usage.deep, color: '#3f51b5' },
                                            ].map((item) => (
                                                <Box key={item.label} sx={{ textAlign: 'center', flex: 1 }}>
                                                    <Typography variant="caption" sx={{ color: item.color, fontWeight: 'bold', display: 'block', fontSize: '0.7rem', lineHeight: 1 }}>{item.label}</Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'text.primary', lineHeight: 1.2 }}>{item.value || 0}</Typography>
                                                </Box>
                                            ))}
                                        </Box>

                                        {/* 峰谷比 */}
                                        <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, minWidth: '80px' }}>
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: '0.7rem' }}>当日峰谷比</Typography>
                                            <Typography sx={{ fontWeight: 'bold', color: 'primary.main', lineHeight: 1, fontSize: '1.1rem' }}>
                                                {dailyData.selected_date_stats.peak_valley_ratio}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </Box>
                            </Paper>
                        </Grid>

                        {/* Statistics */}
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                <Box sx={{ height: 390, display: 'flex', flexDirection: 'column' }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ height: 32, mb: 1, flexShrink: 0 }}>
                                        <Stack direction="row" alignItems="center" spacing={1}>
                                            <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                            <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">统计指标</Typography>
                                        </Stack>
                                    </Stack>

                                    <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
                                        {/* 第一排：去年总量 & 本年签约量 */}
                                        <Box sx={{ height: 72 }}>
                                            <Grid container spacing={1} sx={{ height: '100%' }}>
                                                {[
                                                    { label: '去年用电量', value: dailyData.stats.last_year_total, unit: 'MWh', color: 'info' as const },
                                                    { label: '本年签约量', value: dailyData.stats.this_year_contract, unit: 'MWh', color: 'primary' as const, yoy: dailyData.stats.contract_yoy }
                                                ].map((item) => (
                                                    <Grid key={item.label} size={6} sx={{ height: '100%' }}>
                                                        <Card variant="outlined" sx={getKpiCardSx(item.color === 'info' ? '#0288d1' : '#1565c0')}>
                                                            <CardContent sx={{ p: '6px 10px !important', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{item.label}</Typography>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.1 }}>
                                                                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: '1.15rem', lineHeight: 1 }}>
                                                                        {item.value} <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>{item.unit}</Typography>
                                                                    </Typography>
                                                                    {item.yoy !== undefined && item.yoy !== null && (
                                                                        <Box sx={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            color: item.yoy >= 0 ? 'error.main' : 'success.main',
                                                                            bgcolor: item.yoy >= 0 ? 'error.lighter' : 'success.lighter',
                                                                            px: 0.5,
                                                                            py: 0.1,
                                                                            borderRadius: 0.5,
                                                                            ml: 0.5
                                                                        }}>
                                                                            {item.yoy >= 0 ? <TrendingUpIcon sx={{ fontSize: '0.75rem' }} /> : <TrendingDownIcon sx={{ fontSize: '0.75rem' }} />}
                                                                            <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.7rem', ml: 0.2 }}>
                                                                                {Math.abs(item.yoy)}%
                                                                            </Typography>
                                                                        </Box>
                                                                    )}
                                                                </Box>
                                                            </CardContent>
                                                        </Card>
                                                    </Grid>
                                                ))}
                                            </Grid>
                                        </Box>

                                        {/* 第二排：累计用电量 */}
                                        <Card variant="outlined" sx={{ ...getKpiCardSx('#00838f'), flex: 1, minHeight: 0 }}>
                                            <CardContent sx={{ p: '8px 12px !important', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                                    <Box>
                                                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>累计用电量</Typography>
                                                        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: '1.2rem', lineHeight: 1 }}>
                                                            {dailyData.stats.cumulative_usage} <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>MWh</Typography>
                                                        </Typography>
                                                    </Box>
                                                    {dailyData.stats.cumulative_yoy !== null && (
                                                        <Box sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            color: dailyData.stats.cumulative_yoy >= 0 ? 'error.main' : 'success.main',
                                                            bgcolor: dailyData.stats.cumulative_yoy >= 0 ? 'error.lighter' : 'success.lighter',
                                                            px: 0.6,
                                                            py: 0.1,
                                                            borderRadius: 0.5
                                                        }}>
                                                            {dailyData.stats.cumulative_yoy >= 0 ? <TrendingUpIcon sx={{ fontSize: '0.8rem' }} /> : <TrendingDownIcon sx={{ fontSize: '0.8rem' }} />}
                                                            <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: '0.75rem', ml: 0.3 }}>
                                                                {Math.abs(dailyData.stats.cumulative_yoy)}%
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </Stack>

                                                <Box sx={{ mt: 1, pt: 0.8, borderTop: '1px solid', borderColor: 'divider' }}>
                                                    <Grid container spacing={0}>
                                                        {[
                                                            { label: '尖', val: dailyData.stats.cumulative_tou.tip, color: '#ff5252' },
                                                            { label: '峰', val: dailyData.stats.cumulative_tou.peak, color: '#ff9800' },
                                                            { label: '平', val: dailyData.stats.cumulative_tou.flat, color: '#4caf50' },
                                                            { label: '谷', val: dailyData.stats.cumulative_tou.valley, color: '#2196f3' },
                                                            { label: '深', val: dailyData.stats.cumulative_tou.deep, color: '#3f51b5' },
                                                        ].map((t) => (
                                                            <Grid key={t.label} size={2.4}>
                                                                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', display: 'block', textAlign: 'center', lineHeight: 1.2 }}>
                                                                    <span style={{ color: t.color, fontWeight: 'bold' }}>{t.label}</span>
                                                                    <Box sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary' }}>{t.val}</Box>
                                                                </Typography>
                                                            </Grid>
                                                        ))}
                                                        <Grid size={12} sx={{ mt: 0.8 }}>
                                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'rgba(237, 108, 2, 0.08)', px: 0.8, py: 0.3, borderRadius: 0.5 }}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#ed6c02', fontSize: '0.65rem' }}>累计峰谷比:</Typography>
                                                                <Typography variant="caption" sx={{ fontWeight: 800, color: '#ed6c02', fontSize: '0.8rem' }}>{dailyData.stats.cumulative_pv_ratio}</Typography>
                                                            </Box>
                                                        </Grid>
                                                    </Grid>
                                                </Box>
                                            </CardContent>
                                        </Card>

                                        {/* 第三排：当月用电量 */}
                                        <Card variant="outlined" sx={{ ...getKpiCardSx('#2e7d32'), flex: 1, minHeight: 0 }}>
                                            <CardContent sx={{ p: '8px 12px !important', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                                    <Box>
                                                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>当月用电量</Typography>
                                                        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: '1.2rem', lineHeight: 1 }}>
                                                            {dailyData.stats.this_month_usage} <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>MWh</Typography>
                                                        </Typography>
                                                    </Box>
                                                    {dailyData.stats.month_yoy !== null && (
                                                        <Box sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            color: dailyData.stats.month_yoy >= 0 ? 'error.main' : 'success.main',
                                                            bgcolor: dailyData.stats.month_yoy >= 0 ? 'error.lighter' : 'success.lighter',
                                                            px: 0.6,
                                                            py: 0.1,
                                                            borderRadius: 0.5
                                                        }}>
                                                            {dailyData.stats.month_yoy >= 0 ? <TrendingUpIcon sx={{ fontSize: '0.8rem' }} /> : <TrendingDownIcon sx={{ fontSize: '0.8rem' }} />}
                                                            <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: '0.75rem', ml: 0.3 }}>
                                                                {Math.abs(dailyData.stats.month_yoy)}%
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </Stack>

                                                <Box sx={{ mt: 1, pt: 0.8, borderTop: '1px solid', borderColor: 'divider' }}>
                                                    <Grid container spacing={0}>
                                                        {[
                                                            { label: '尖', val: dailyData.stats.month_tou.tip, color: '#ff5252' },
                                                            { label: '峰', val: dailyData.stats.month_tou.peak, color: '#ff9800' },
                                                            { label: '平', val: dailyData.stats.month_tou.flat, color: '#4caf50' },
                                                            { label: '谷', val: dailyData.stats.month_tou.valley, color: '#2196f3' },
                                                            { label: '深', val: dailyData.stats.month_tou.deep, color: '#3f51b5' },
                                                        ].map((t) => (
                                                            <Grid key={t.label} size={2.4}>
                                                                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', display: 'block', textAlign: 'center', lineHeight: 1.2 }}>
                                                                    <span style={{ color: t.color, fontWeight: 'bold' }}>{t.label}</span>
                                                                    <Box sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary' }}>{t.val}</Box>
                                                                </Typography>
                                                            </Grid>
                                                        ))}
                                                        <Grid size={12} sx={{ mt: 0.8 }}>
                                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'rgba(46, 125, 50, 0.08)', px: 0.8, py: 0.3, borderRadius: 0.5 }}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#2e7d32', fontSize: '0.65rem' }}>本月峰谷比:</Typography>
                                                                <Typography variant="caption" sx={{ fontWeight: 800, color: '#2e7d32', fontSize: '0.8rem' }}>{dailyData.stats.month_pv_ratio}</Typography>
                                                            </Box>
                                                        </Grid>
                                                    </Grid>
                                                </Box>
                                            </CardContent>
                                        </Card>
                                    </Stack>
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                )
                }

                <Grid container spacing={2}>
                    {/* Tags & AI */}
                    <Grid size={{ xs: 12, md: 5 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">用电特征标签与模式识别</Typography>
                                </Stack>
                                <Button
                                    variant="outlined"
                                    color="secondary"
                                    startIcon={aiAnalyzing ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                                    onClick={handleAiDiagnose}
                                    disabled={aiAnalyzing || !canEdit}
                                    size="small"
                                >
                                    AI 模式识别
                                </Button>
                            </Stack>

                            {aiSummary && (
                                <Alert severity="info" sx={{ mb: 2, fontSize: '0.875rem' }}>
                                    {aiSummary}
                                </Alert>
                            )}

                            <Box sx={{ mb: 3 }}>
                                <Typography variant="subtitle2" gutterBottom color="text.secondary">手工标签</Typography>
                                <TagSelector tags={manualTags} onChange={handleManualTagChange} readonly={!canEdit} />
                            </Box>

                            <Box>
                                <Typography variant="subtitle2" gutterBottom color="text.secondary">自动标签</Typography>
                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {autoTags.length === 0 && <Typography variant="caption" color="text.disabled">暂无自动标签</Typography>}
                                    {autoTags.map(tag => (
                                        <Chip
                                            key={tag.name}
                                            label={tag.name}
                                            color="secondary"
                                            variant="outlined"
                                            size="small"
                                            onDelete={canEdit ? () => handleRemoveAutoTag(tag.name) : undefined}
                                            deleteIcon={canEdit ? <DeleteIcon /> : undefined}
                                        />
                                    ))}
                                </Stack>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* History Chart */}
                    <Grid size={{ xs: 12, md: 7 }}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">历史趋势</Typography>
                                </Stack>
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        variant={historyType === 'daily' ? 'contained' : 'outlined'}
                                        size="small"
                                        onClick={() => setHistoryType('daily')}
                                    >
                                        30天
                                    </Button>
                                    <Button
                                        variant={historyType === 'monthly' ? 'contained' : 'outlined'}
                                        size="small"
                                        onClick={() => setHistoryType('monthly')}
                                    >
                                        12个月
                                    </Button>
                                </Stack>
                            </Stack>

                            <Box sx={{ height: 220 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={historyData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                        <YAxis />
                                        <RechartsTooltip content={<CustomTooltip unit="MWh" />} />
                                        <Bar dataKey="value" name="电量 (MWh)">
                                            {historyData.map((entry, index) => {
                                                let color = historyType === 'daily' ? "#8caac4" : "#e0e0e0"; // Soft Blue for daily, Grey for monthly history
                                                if (historyType === 'daily') {
                                                    try {
                                                        const day = getDay(parseISO(entry.date));
                                                        if (day === 0 || day === 6) {
                                                            color = "#c48c8c"; // Morandi Rose for weekend
                                                        }
                                                    } catch (e) {
                                                        // Fallback
                                                    }
                                                } else if (historyType === 'monthly') {
                                                    // Highlight current month
                                                    const currentMonthStr = selectedDate ? format(selectedDate, 'yyyy-MM') : '';
                                                    if (entry.date === currentMonthStr) {
                                                        color = theme.palette.primary.main; // Primary Blue for current month
                                                    }
                                                }
                                                return <Cell key={`cell-${index}`} fill={color} />;
                                            })}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Box >
        </LocalizationProvider >
    );
};
