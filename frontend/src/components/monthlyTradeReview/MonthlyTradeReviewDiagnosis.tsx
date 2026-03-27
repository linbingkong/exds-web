import React from 'react';
import { Box, Chip, Divider, Paper, Stack, Typography, alpha } from '@mui/material';
import { MonthlyReviewDetailResponse } from '../../types/tradeReview';

const fmt = (value?: number | null, digits = 2) =>
    value === null || value === undefined || Number.isNaN(value)
        ? '-'
        : value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const getTagMeta = (text: string) => {
    if (text.includes('负') || text.includes('风险') || text.includes('暴露') || text.includes('缺失')) {
        return { label: '风险提示', color: '#b91c1c', bg: alpha('#ef4444', 0.1) };
    }
    if (text.includes('正') || text.includes('贡献') || text.includes('优于') || text.includes('改善')) {
        return { label: '正向贡献', color: '#15803d', bg: alpha('#22c55e', 0.1) };
    }
    if (text.includes('建议') || text.includes('关注') || text.includes('定位')) {
        return { label: '关注点', color: '#1d4ed8', bg: alpha('#3b82f6', 0.1) };
    }
    return { label: '诊断结论', color: '#475569', bg: alpha('#94a3b8', 0.14) };
};

interface MonthlyTradeReviewDiagnosisProps {
    detail: MonthlyReviewDetailResponse;
}

export const MonthlyTradeReviewDiagnosis: React.FC<MonthlyTradeReviewDiagnosisProps> = ({ detail }) => {
    const diagnosisTexts = detail.diagnosis_texts.length > 0 ? detail.diagnosis_texts : ['当前月份暂无自动诊断结论。'];
    const primaryText = diagnosisTexts[0];
    const secondaryTexts = diagnosisTexts.slice(1);

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 2,
                borderRadius: 3,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
            }}
        >
            <Stack spacing={2}>
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0f172a' }}>
                        自动诊断
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, color: '#64748b' }}>
                        系统基于日度与 48 时段结果提炼本月主要贡献来源、风险暴露位置与关注点。
                    </Typography>
                </Box>

                <Box
                    sx={{
                        p: 1.75,
                        borderRadius: 2.5,
                        border: '1px solid rgba(59, 130, 246, 0.18)',
                        background: 'linear-gradient(135deg, rgba(239,246,255,0.92) 0%, rgba(248,250,252,0.96) 100%)',
                    }}
                >
                    <Chip
                        size="small"
                        label="本月主结论"
                        sx={{
                            mb: 1,
                            bgcolor: alpha('#2563eb', 0.12),
                            color: '#1d4ed8',
                            fontWeight: 700,
                        }}
                    />
                    <Typography variant="body1" sx={{ color: '#0f172a', fontWeight: 700, lineHeight: 1.75 }}>
                        {primaryText}
                    </Typography>
                </Box>

                <Stack divider={<Divider flexItem sx={{ borderColor: 'rgba(148, 163, 184, 0.18)' }} />}>
                    {secondaryTexts.map((text) => {
                        const tagMeta = getTagMeta(text);
                        return (
                            <Stack
                                key={text}
                                direction={{ xs: 'column', md: 'row' }}
                                spacing={1.25}
                                alignItems={{ xs: 'flex-start', md: 'center' }}
                                sx={{ py: 1 }}
                            >
                                <Chip
                                    size="small"
                                    label={tagMeta.label}
                                    sx={{
                                        bgcolor: tagMeta.bg,
                                        color: tagMeta.color,
                                        fontWeight: 700,
                                        minWidth: 76,
                                    }}
                                />
                                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.8 }}>
                                    {text}
                                </Typography>
                            </Stack>
                        );
                    })}

                    {detail.calc_message && detail.calc_status === 'partial' && (
                        <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1.25}
                            alignItems={{ xs: 'flex-start', md: 'center' }}
                            sx={{ py: 1 }}
                        >
                            <Chip
                                size="small"
                                label="数据说明"
                                sx={{
                                    bgcolor: alpha('#f59e0b', 0.14),
                                    color: '#b45309',
                                    fontWeight: 700,
                                    minWidth: 76,
                                }}
                            />
                            <Typography variant="body2" sx={{ color: '#92400e', lineHeight: 1.8 }}>
                                {detail.calc_message}
                            </Typography>
                        </Stack>
                    )}
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={`月度总电量：${fmt(detail.overview?.total_load_mwh)} MWh`} />
                    <Chip label={`实时现货均价：${fmt(detail.overview?.spot_avg_price)} 元/MWh`} />
                    <Chip label={`总贡献值：${fmt(detail.overview?.total_contribution_amount)} 元`} />
                </Stack>
            </Stack>
        </Paper>
    );
};
