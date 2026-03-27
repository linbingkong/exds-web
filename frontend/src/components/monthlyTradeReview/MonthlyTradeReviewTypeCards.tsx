import React from 'react';
import { Box, Card, CardContent, Grid, Stack, Typography, alpha } from '@mui/material';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { MonthlyReviewTypeCard } from '../../types/tradeReview';

export type MonthlyTradeType = 'all' | 'annual' | 'monthly' | 'within_month' | 'day_ahead';

const COLORS = { annual: '#1d4ed8', monthly: '#0284c7', within_month: '#ea580c', day_ahead: '#16a34a' } as const;
const LABELS = { annual: '年度交易', monthly: '月度交易', within_month: '月内交易', day_ahead: '日前交易' } as const;

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
    selectedTradeType,
    onSelectTradeType,
}) => (
    <Grid container spacing={2}>
        {typeCards.map((card) => {
            const tradeType = card.trade_type as Exclude<MonthlyTradeType, 'all'>;
            const active = selectedTradeType === tradeType;
            const pieData = [
                { name: '正贡献', value: card.positive_bucket_count, color: '#16a34a' },
                { name: '负贡献', value: card.negative_bucket_count, color: '#dc2626' },
                { name: '无贡献', value: card.neutral_bucket_count, color: '#94a3b8' },
            ];

            return (
                <Grid key={card.trade_type} size={{ xs: 12, sm: 6, xl: 3 }}>
                    <Card
                        variant="outlined"
                        onClick={() => onSelectTradeType(selectedTradeType === tradeType ? 'all' : tradeType)}
                        sx={{
                            cursor: 'pointer',
                            borderRadius: 3,
                            borderColor: active ? COLORS[tradeType] : alpha(COLORS[tradeType], 0.2),
                            background: active ? `linear-gradient(180deg, ${alpha(COLORS[tradeType], 0.08)} 0%, #fff 100%)` : '#fff',
                            boxShadow: active ? `0 12px 24px ${alpha(COLORS[tradeType], 0.12)}` : 'none',
                        }}
                    >
                        <CardContent>
                            <Stack spacing={1.3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                                        {card.label || LABELS[tradeType]}
                                    </Typography>
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
                                        <Typography variant="caption" color="text.secondary">贡献值</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: (card.contribution_amount ?? 0) >= 0 ? '#15803d' : '#b91c1c' }}>{fmt(card.contribution_amount)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">现货价差</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{fmt(card.spot_spread)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">覆盖电量</Typography>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{fmt(card.covered_mwh)}</Typography>
                                    </Grid>
                                </Grid>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box sx={{ width: 86, height: 86 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={pieData} dataKey="value" innerRadius={22} outerRadius={34} paddingAngle={2} stroke="none">
                                                    {pieData.map((item) => <Cell key={item.name} fill={item.color} />)}
                                                </Pie>
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </Box>
                                    <Stack spacing={0.6} sx={{ flex: 1 }}>
                                        {pieData.map((item) => (
                                            <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color }} />
                                                    <Typography variant="caption" color="text.secondary">{item.name}</Typography>
                                                </Box>
                                                <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.value}</Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>
            );
        })}
    </Grid>
);
