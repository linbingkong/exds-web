import React from 'react';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined';
import { Box, Card, CardContent, Chip, Grid, Stack, Typography, alpha } from '@mui/material';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { MonthlyReviewTypeCard } from '../../types/tradeReview';

export type MonthlyTradeType = 'all' | 'annual' | 'monthly' | 'within_month' | 'day_ahead';

const COLORS = { annual: '#1d4ed8', monthly: '#0284c7', within_month: '#ea580c', day_ahead: '#16a34a' } as const;
const LABELS = { annual: '年度交易', monthly: '月度交易', within_month: '月内交易', day_ahead: '日前交易' } as const;
const ICONS = {
    annual: <AccountBalanceOutlinedIcon fontSize="small" />,
    monthly: <CalendarMonthOutlinedIcon fontSize="small" />,
    within_month: <QueryStatsOutlinedIcon fontSize="small" />,
    day_ahead: <TodayOutlinedIcon fontSize="small" />,
} as const;

const fmt = (value?: number | null, digits = 2) =>
    value === null || value === undefined || Number.isNaN(value)
        ? '-'
        : value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const pct = (value?: number | null) => (value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`);

interface MonthlyTradeReviewTypeCardsProps {
    typeCards: MonthlyReviewTypeCard[];
    selectedTradeType: MonthlyTradeType;
    onSelectTradeType: (value: MonthlyTradeType) => void;
}

export const MonthlyTradeReviewTypeCards: React.FC<MonthlyTradeReviewTypeCardsProps> = ({
    typeCards,
    selectedTradeType: _selectedTradeType,
    onSelectTradeType: _onSelectTradeType,
}) => (
    <Grid container spacing={2}>
        {typeCards.map((card) => {
            const tradeType = card.trade_type as Exclude<MonthlyTradeType, 'all'>;
            const pieData = [
                { name: '正贡献', value: card.positive_bucket_count, color: '#16a34a' },
                { name: '负贡献', value: card.negative_bucket_count, color: '#dc2626' },
                { name: '无贡献', value: card.neutral_bucket_count, color: '#94a3b8' },
            ];
            const contributionColor = (card.contribution_amount ?? 0) >= 0 ? '#15803d' : '#b91c1c';
            const totalBuckets = (card.positive_bucket_count ?? 0) + (card.negative_bucket_count ?? 0) + (card.neutral_bucket_count ?? 0);

            return (
                <Grid key={card.trade_type} size={{ xs: 12, sm: 6, xl: 3 }}>
                    <Card
                        variant="outlined"
                        sx={{
                            height: '100%',
                            borderRadius: 3,
                            borderColor: alpha(COLORS[tradeType], 0.24),
                            background: `linear-gradient(180deg, ${alpha(COLORS[tradeType], 0.1)} 0%, rgba(255,255,255,0.98) 36%, rgba(248,250,252,0.96) 100%)`,
                            boxShadow: `0 14px 28px ${alpha(COLORS[tradeType], 0.12)}`,
                        }}
                    >
                        <CardContent sx={{ p: { xs: 1.5, sm: 1.75, lg: 2 } }}>
                            <Stack spacing={1.35} sx={{ height: '100%' }}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                            <Box
                                                sx={{
                                                    width: 34,
                                                    height: 34,
                                                    borderRadius: 1.75,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: COLORS[tradeType],
                                                    bgcolor: alpha(COLORS[tradeType], 0.14),
                                                    boxShadow: `inset 0 0 0 1px ${alpha(COLORS[tradeType], 0.1)}`,
                                                }}
                                            >
                                                {ICONS[tradeType]}
                                            </Box>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 900, color: '#0f172a', lineHeight: 1.3 }}>
                                                {card.label || LABELS[tradeType]}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                                            <Typography
                                                variant="h5"
                                                sx={{
                                                    fontWeight: 900,
                                                    color: contributionColor,
                                                    fontSize: { xs: '1.35rem', sm: '1.55rem' },
                                                    lineHeight: 1.1,
                                                    wordBreak: 'break-word',
                                                }}
                                            >
                                                {fmt(card.contribution_amount)}
                                            </Typography>
                                            <Chip
                                                label="贡献值"
                                                size="small"
                                                sx={{
                                                    height: 24,
                                                    fontWeight: 700,
                                                    color: COLORS[tradeType],
                                                    bgcolor: alpha(COLORS[tradeType], 0.1),
                                                    border: `1px solid ${alpha(COLORS[tradeType], 0.16)}`,
                                                }}
                                            />
                                        </Box>
                                    </Box>
                                    <Box
                                        sx={{
                                            px: 1,
                                            py: 0.45,
                                            borderRadius: 999,
                                            bgcolor: alpha(COLORS[tradeType], 0.1),
                                            color: COLORS[tradeType],
                                            fontSize: 12,
                                            fontWeight: 800,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {LABELS[tradeType]}
                                    </Box>
                                </Box>

                                <Grid container spacing={1}>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">胜率</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{pct(card.win_rate)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">电量占比</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{pct(card.energy_share)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">交易均价</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{fmt(card.avg_trade_price)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">现货价差</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{fmt(card.spot_spread)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 12 }}>
                                        <Box
                                            sx={{
                                                px: 1.1,
                                                py: 0.9,
                                                borderRadius: 2,
                                                bgcolor: 'rgba(255,255,255,0.74)',
                                                border: `1px solid ${alpha(COLORS[tradeType], 0.12)}`,
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary">覆盖电量</Typography>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{fmt(card.covered_mwh)}</Typography>
                                        </Box>
                                    </Grid>
                                </Grid>

                                <Box sx={{ borderTop: `1px dashed ${alpha(COLORS[tradeType], 0.28)}` }} />

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                                    <Box sx={{ width: 92, height: 92, flexShrink: 0 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={pieData} dataKey="value" innerRadius={24} outerRadius={36} paddingAngle={2} stroke="none">
                                                    {pieData.map((item) => <Cell key={item.name} fill={item.color} />)}
                                                </Pie>
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </Box>
                                    <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700 }}>
                                            贡献时段分布
                                        </Typography>
                                        {pieData.map((item) => (
                                            <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, minWidth: 0 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color, flexShrink: 0 }} />
                                                    <Typography variant="caption" color="text.secondary" noWrap>{item.name}</Typography>
                                                </Box>
                                                <Typography variant="caption" sx={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                                    {item.value}
                                                </Typography>
                                            </Box>
                                        ))}
                                        <Typography variant="caption" sx={{ color: '#64748b' }}>
                                            合计 {totalBuckets} 个时段
                                        </Typography>
                                    </Stack>
                                </Box>

                                <Typography variant="caption" sx={{ color: '#64748b', lineHeight: 1.5 }}>
                                    当前卡片仅作为摘要展示，不联动下方图形筛选。
                                </Typography>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>
            );
        })}
    </Grid>
);
