import React, { useCallback, useEffect, useMemo, useState } from 'react';
import CalculateIcon from '@mui/icons-material/Calculate';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import { hasPermission } from '../auth/permissionPrecheck';
import { tradeReviewApi } from '../api/tradeReview';
import { MonthlyTradeReviewChartPanel } from '../components/monthlyTradeReview/MonthlyTradeReviewChartPanel';
import { MonthlyTradeReviewDiagnosis } from '../components/monthlyTradeReview/MonthlyTradeReviewDiagnosis';
import { MonthlyTradeReviewFilterBar } from '../components/monthlyTradeReview/MonthlyTradeReviewFilterBar';
import {
    MonthlyTradeReviewTypeCards,
    MonthlyTradeType,
} from '../components/monthlyTradeReview/MonthlyTradeReviewTypeCards';
import { MonthlyReviewDetailResponse, MonthlyReviewOverviewResponse } from '../types/tradeReview';

const monthOfToday = () => new Date().toISOString().slice(0, 7);

const shiftMonth = (month: string, offset: number) => {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) {
        return month;
    }
    const next = new Date(year, monthIndex + offset, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
};

const EmptyState: React.FC<{
    month: string;
    message: string;
    canRecalculate: boolean;
    recalculating: boolean;
    onExecute: () => void;
}> = ({ month, message, canRecalculate, recalculating, onExecute }) => (
    <Paper
        variant="outlined"
        sx={{
            p: { xs: 4, sm: 8 },
            textAlign: 'center',
            borderRadius: 4,
            bgcolor: 'background.paper',
            border: '1px dashed',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
        }}
    >
        <Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'action.hover', color: 'text.disabled', mb: 1 }}>
            <CalculateIcon sx={{ fontSize: { xs: 32, sm: 48 } }} />
        </Box>
        <Typography variant="h5" fontWeight={800} color="text.primary" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            未找到 {month} 的最新复盘结果
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500, mx: 'auto', mb: 2 }}>
            {message}
        </Typography>
        <Tooltip title={canRecalculate ? '' : '无权限（需要 module:review_monthly:edit）'}>
            <span>
                <Button
                    variant="contained"
                    size="large"
                    startIcon={<CalculateIcon />}
                    onClick={onExecute}
                    disabled={!canRecalculate || recalculating}
                    sx={{ borderRadius: 3, px: 4, py: 1.2, fontWeight: 700, boxShadow: 'none', textTransform: 'none' }}
                >
                    {recalculating ? '计算中...' : '立即计算'}
                </Button>
            </span>
        </Tooltip>
    </Paper>
);

const MonthlyTradeReviewPage: React.FC = () => {
    const [month, setMonth] = useState(monthOfToday());
    const [loading, setLoading] = useState(true);
    const [recalculating, setRecalculating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overview, setOverview] = useState<MonthlyReviewOverviewResponse | null>(null);
    const [detail, setDetail] = useState<MonthlyReviewDetailResponse | null>(null);
    const [selectedTradeType, setSelectedTradeType] = useState<MonthlyTradeType>('all');
    const canRecalculate = useMemo(() => hasPermission('module:review_monthly:edit'), []);

    const loadOverviewOnly = useCallback(async (targetMonth: string) => {
        const overviewRes = await tradeReviewApi.fetchMonthlyOverview(targetMonth, false);
        setOverview(overviewRes.data);
        if (!overviewRes.data.exists) {
            setDetail(null);
            return;
        }

        const detailRes = await tradeReviewApi.fetchMonthlyDetail(targetMonth);
        setDetail(detailRes.data);
    }, []);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            setSelectedTradeType('all');
            try {
                const overviewRes = await tradeReviewApi.fetchMonthlyOverview(month, false);
                if (cancelled) return;
                setOverview(overviewRes.data);
                if (!overviewRes.data.exists) {
                    setDetail(null);
                    return;
                }

                const detailRes = await tradeReviewApi.fetchMonthlyDetail(month);
                if (cancelled) return;
                setDetail(detailRes.data);
            } catch (err: any) {
                if (cancelled) return;
                setError(err.response?.data?.detail || err.message || '加载月度交易复盘数据失败');
                setDetail(null);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [month]);

    const handleRecalculate = useCallback(async () => {
        if (!canRecalculate) {
            return;
        }
        setRecalculating(true);
        setError(null);
        setSelectedTradeType('all');
        try {
            const detailRes = await tradeReviewApi.recalculateMonthly(month);
            setDetail(detailRes.data);
            await loadOverviewOnly(month);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '重新计算月度交易复盘失败');
        } finally {
            setRecalculating(false);
        }
    }, [canRecalculate, loadOverviewOnly, month]);

    const emptyMessage = overview?.calc_message || `月份 ${month} 基于最新数据的月度交易复盘结果尚未生成。`;

    return (
        <Box sx={{ px: 0, py: 0 }}>
            <Stack spacing={2}>
                <MonthlyTradeReviewFilterBar
                    month={month}
                    overview={overview}
                    canRecalculate={canRecalculate}
                    recalculating={recalculating}
                    onMonthChange={setMonth}
                    onPrevMonth={() => setMonth((prev) => shiftMonth(prev, -1))}
                    onNextMonth={() => setMonth((prev) => shiftMonth(prev, 1))}
                    onRecalculate={handleRecalculate}
                />

                {loading ? (
                    <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
                        <CircularProgress />
                    </Paper>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : overview && !overview.exists ? (
                    <EmptyState
                        month={month}
                        message={emptyMessage}
                        canRecalculate={canRecalculate}
                        recalculating={recalculating}
                        onExecute={handleRecalculate}
                    />
                ) : !detail ? (
                    <Alert severity="warning">未获取到可展示的月度交易复盘数据。</Alert>
                ) : (
                    <>
                        <MonthlyTradeReviewTypeCards
                            typeCards={detail.type_cards}
                            selectedTradeType={selectedTradeType}
                            onSelectTradeType={setSelectedTradeType}
                        />
                        <MonthlyTradeReviewChartPanel
                            month={month}
                            dailyView={detail.daily_view}
                            periodView={detail.period_view}
                            selectedTradeType="all"
                        />
                        <MonthlyTradeReviewDiagnosis detail={detail} />
                    </>
                )}
            </Stack>
        </Box>
    );
};

export default MonthlyTradeReviewPage;
