/**
 * 中长期趋势分析页面
 * 
 * 参考 SpotTrendAnalysisPage 的结构
 */
import React, { useState, useEffect } from 'react';
import {
    Box, Tabs, Tab, Typography, Paper, useMediaQuery, useTheme, Button
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';
import TimelineIcon from '@mui/icons-material/Timeline';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import BarChartIcon from '@mui/icons-material/BarChart';
import { PriceTrendTab } from '../components/contract-price-trend/PriceTrendTab';
import { CurveCompareTab } from '../components/contract-price-trend/CurveCompareTab';
import { QuantityStructureTab } from '../components/contract-price-trend/QuantityStructureTab';
import { contractPriceTrendApi, ContractPriceTrendResponse } from '../api/contractPriceTrend';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`contract-trend-tabpanel-${index}`}
            aria-labelledby={`contract-trend-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ pt: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

// 缓存数据类型定义
interface CachedData<T> {
    data: T | null;
    cacheKey: string; // 格式: "startDate-endDate-spotType"
}

export const ContractPriceTrendPage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // 日期区间状态 - 默认最近30天
    const [startDate, setStartDate] = useState<Date | null>(subDays(new Date(), 30));
    const [endDate, setEndDate] = useState<Date | null>(subDays(new Date(), 1));

    // 基准现货类型
    const [spotBenchmark, setSpotBenchmark] = useState<'day_ahead' | 'real_time'>('real_time');

    // ========== 状态提升：数据管理 ==========
    // 价格走势数据
    const [trendData, setTrendData] = useState<CachedData<ContractPriceTrendResponse>>({ data: null, cacheKey: '' });
    const [trendLoading, setTrendLoading] = useState(false);
    const [trendError, setTrendError] = useState<string | null>(null);

    // 获取当前缓存键
    const getCurrentCacheKey = (): string => {
        if (!startDate || !endDate) return '';
        return `${format(startDate, 'yyyy-MM-dd')}-${format(endDate, 'yyyy-MM-dd')}-${spotBenchmark}`;
    };

    // 加载价格走势数据
    const fetchTrendData = async () => {
        if (!startDate || !endDate) return;

        const cacheKey = getCurrentCacheKey();

        // 缓存命中检查
        if (trendData.data && trendData.cacheKey === cacheKey) {
            return;
        }

        setTrendLoading(true);
        setTrendError(null);

        try {
            const start = format(startDate, 'yyyy-MM-dd');
            const end = format(endDate, 'yyyy-MM-dd');
            const response = await contractPriceTrendApi.fetchPriceTrend({
                start_date: start,
                end_date: end,
                spot_type: spotBenchmark
            });
            setTrendData({ data: response.data, cacheKey });
        } catch (err: any) {
            console.error('Error fetching price trend:', err);
            setTrendError(err.response?.data?.detail || '获取数据失败');
        } finally {
            setTrendLoading(false);
        }
    };

    // 日期或基准变化时清空缓存
    useEffect(() => {
        const newCacheKey = getCurrentCacheKey();

        if (trendData.cacheKey && trendData.cacheKey !== newCacheKey) {
            setTrendData({ data: null, cacheKey: '' });
        }
    }, [startDate, endDate, spotBenchmark]);

    // 根据当前 Tab 懒加载数据
    useEffect(() => {
        if (tabIndex === 0) {
            fetchTrendData();
        }
    }, [tabIndex, startDate, endDate, spotBenchmark]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    // 快捷按钮处理
    const handleQuickSelect = (type: 'last30' | 'last60' | 'thisMonth' | 'lastMonth') => {
        const today = new Date();
        switch (type) {
            case 'last30':
                setStartDate(subDays(today, 30));
                setEndDate(today);
                break;
            case 'last60':
                setStartDate(subDays(today, 60));
                setEndDate(today);
                break;
            case 'thisMonth':
                setStartDate(startOfMonth(today));
                setEndDate(endOfMonth(today));
                break;
            case 'lastMonth':
                const lastMonth = subDays(startOfMonth(today), 1);
                setStartDate(startOfMonth(lastMonth));
                setEndDate(endOfMonth(lastMonth));
                break;
        }
    };

    // Tab 配置
    const tabsConfig = [
        { icon: <TimelineIcon />, label: '价格走势', mobileLabel: '走势' },
        { icon: <CompareArrowsIcon />, label: '曲线分析', mobileLabel: '曲线' },
        { icon: <BarChartIcon />, label: '电量结构', mobileLabel: '电量' },
    ];

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        价格分析 / 中长期趋势分析
                    </Typography>
                )}

                {/* 日期区间选择器 */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                    {/* 日期选择器 */}
                    <DatePicker
                        label="开始"
                        value={startDate}
                        onChange={(date) => setStartDate(date)}
                        slotProps={{
                            textField: {
                                size: "small",
                                sx: {
                                    width: { xs: '105px', sm: '150px' },
                                    '& .MuiInputBase-input': { fontSize: { xs: '0.8rem', sm: '1rem' }, px: { xs: 1, sm: 1.5 } }
                                }
                            }
                        }}
                    />
                    <Typography sx={{ px: 0.5, fontSize: '0.875rem' }}>至</Typography>
                    <DatePicker
                        label="结束"
                        value={endDate}
                        onChange={(date) => setEndDate(date)}
                        slotProps={{
                            textField: {
                                size: "small",
                                sx: {
                                    width: { xs: '105px', sm: '150px' },
                                    '& .MuiInputBase-input': { fontSize: { xs: '0.8rem', sm: '1rem' }, px: { xs: 1, sm: 1.5 } }
                                }
                            }
                        }}
                    />

                    {/* 快捷按钮 */}
                    <Button variant="outlined" size="small" onClick={() => handleQuickSelect('last30')}
                        sx={{ minWidth: 'auto', px: 1, fontSize: '0.75rem' }}>
                        近30天
                    </Button>
                    <Button variant="outlined" size="small" onClick={() => handleQuickSelect('last60')}
                        sx={{ minWidth: 'auto', px: 1, fontSize: '0.75rem' }}>
                        近60天
                    </Button>
                    <Button variant="outlined" size="small" onClick={() => handleQuickSelect('thisMonth')}
                        sx={{ minWidth: 'auto', px: 1, fontSize: '0.75rem' }}>
                        本月
                    </Button>
                    <Button variant="outlined" size="small" onClick={() => handleQuickSelect('lastMonth')}
                        sx={{ minWidth: 'auto', px: 1, fontSize: '0.75rem' }}>
                        上月
                    </Button>

                    {/* 基准价格选择 - 放置在最右侧 */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
                        <Typography variant="body2" color="text.secondary">基准:</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {['日前', '实时'].map(benchmark => (
                                <Box
                                    key={benchmark}
                                    onClick={() => setSpotBenchmark(benchmark === '日前' ? 'day_ahead' : 'real_time')}
                                    sx={{
                                        px: 1,
                                        py: 0.25,
                                        borderRadius: 1,
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        border: '1px solid',
                                        borderColor: (spotBenchmark === 'day_ahead' && benchmark === '日前') ||
                                            (spotBenchmark === 'real_time' && benchmark === '实时')
                                            ? '#f44336' : 'divider',
                                        backgroundColor: (spotBenchmark === 'day_ahead' && benchmark === '日前') ||
                                            (spotBenchmark === 'real_time' && benchmark === '实时')
                                            ? '#f44336' : 'transparent',
                                        color: (spotBenchmark === 'day_ahead' && benchmark === '日前') ||
                                            (spotBenchmark === 'real_time' && benchmark === '实时')
                                            ? 'white' : 'text.primary',
                                        fontWeight: (spotBenchmark === 'day_ahead' && benchmark === '日前') ||
                                            (spotBenchmark === 'real_time' && benchmark === '实时')
                                            ? 'bold' : 'normal',
                                        transition: 'all 0.2s',
                                        '&:hover': {
                                            borderColor: '#f44336',
                                            opacity: 0.8
                                        }
                                    }}
                                >
                                    {benchmark}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Paper>

                <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
                    <Tabs
                        value={tabIndex}
                        onChange={handleTabChange}
                        aria-label="contract price trend analysis tabs"
                        variant="scrollable"
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        sx={{
                            '& .MuiTabs-scrollButtons': {
                                '&.Mui-disabled': { opacity: 0.3 }
                            },
                            '& .MuiTab-root': {
                                minWidth: { xs: 60, sm: 120 },
                                maxWidth: { xs: 'none', sm: 'none' },
                                fontSize: { xs: '0.75rem', sm: '0.9375rem' },
                                px: { xs: 0.5, sm: 2 },
                                minHeight: { xs: 60, sm: 48 },
                                py: { xs: 1, sm: 1.5 }
                            }
                        }}
                    >
                        {tabsConfig.map((tab, index) => (
                            <Tab
                                key={index}
                                icon={tab.icon}
                                iconPosition="top"
                                label={isMobile ? tab.mobileLabel : tab.label}
                                id={`contract-trend-tab-${index}`}
                                aria-controls={`contract-trend-tabpanel-${index}`}
                            />
                        ))}
                    </Tabs>
                </Paper>

                {/* TabPanel 容器 */}
                <Box sx={{ position: 'relative' }}>
                    <TabPanel value={tabIndex} index={0}>
                        <PriceTrendTab
                            data={trendData.data}
                            loading={trendLoading}
                            error={trendError}
                            spotBenchmark={spotBenchmark}
                        />
                    </TabPanel>
                    <TabPanel value={tabIndex} index={1}>
                        <CurveCompareTab
                            startDate={startDate}
                            endDate={endDate}
                            spotBenchmark={spotBenchmark}
                            dateRange={startDate && endDate ? `${format(startDate, 'yyyy-MM-dd')} ~ ${format(endDate, 'yyyy-MM-dd')}` : ''}
                        />
                    </TabPanel>
                    <TabPanel value={tabIndex} index={2}>
                        <QuantityStructureTab
                            startDate={startDate}
                            endDate={endDate}
                            dateRange={startDate && endDate ? `${format(startDate, 'yyyy-MM-dd')} ~ ${format(endDate, 'yyyy-MM-dd')}` : ''}
                        />
                    </TabPanel>
                </Box>
            </Box>
        </LocalizationProvider>
    );
};
