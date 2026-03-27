import React from 'react';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { MonthlyReviewOverviewResponse } from '../../types/tradeReview';

interface MonthlyTradeReviewFilterBarProps {
    month: string;
    overview: MonthlyReviewOverviewResponse | null;
    canRecalculate: boolean;
    recalculating: boolean;
    onMonthChange: (value: string) => void;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onRecalculate: () => void;
}

export const MonthlyTradeReviewFilterBar: React.FC<MonthlyTradeReviewFilterBarProps> = ({
    month,
    overview,
    canRecalculate,
    recalculating,
    onMonthChange,
    onPrevMonth,
    onNextMonth,
    onRecalculate,
}) => {
    const [open, setOpen] = React.useState(false);
    const resultMessage = overview?.calc_message || '当前月份基于最新数据的复盘结果尚未生成，请点击立即计算。';

    return (
        <>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    borderRadius: 3,
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
                }}
            >
                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', lg: 'center' }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={onPrevMonth}
                                sx={{ minWidth: 0, px: 1.2, borderRadius: 2 }}
                            >
                                <ArrowLeftIcon fontSize="small" />
                            </Button>
                            <TextField
                                label="月份"
                                type="month"
                                size="small"
                                value={month}
                                onChange={(event) => onMonthChange(event.target.value)}
                                InputLabelProps={{ shrink: true }}
                                sx={{ minWidth: { xs: '100%', sm: 180 } }}
                            />
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={onNextMonth}
                                sx={{ minWidth: 0, px: 1.2, borderRadius: 2 }}
                            >
                                <ArrowRightIcon fontSize="small" />
                            </Button>
                        </Stack>
                    </Stack>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <Tooltip title={canRecalculate ? '' : '无权限（需要 module:review_monthly:edit）'}>
                            <span>
                                <Button
                                    variant="contained"
                                    startIcon={<CalculateOutlinedIcon />}
                                    onClick={onRecalculate}
                                    disabled={!canRecalculate || recalculating}
                                    sx={{ borderRadius: 2.5, px: 2.2, textTransform: 'none', boxShadow: 'none' }}
                                >
                                    {recalculating ? '计算中...' : '重新计算'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Button
                            variant="outlined"
                            startIcon={<InfoOutlinedIcon />}
                            onClick={() => setOpen(true)}
                            sx={{ borderRadius: 2.5, px: 2.2, textTransform: 'none' }}
                        >
                            数据说明
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 800 }}>数据说明</DialogTitle>
                <DialogContent sx={{ pt: 1 }}>
                    <Stack spacing={1.25}>
                        <Alert severity="info" variant="outlined">
                            当前只按实时现货偏差结算口径复盘，不做完整月度结算总账单还原。
                        </Alert>
                        <Alert severity="info" variant="outlined">
                            暂不纳入资金余缺、超额回收等月结附加因素。
                        </Alert>
                        <Alert severity="info" variant="outlined">
                            月内交易直接使用合同聚合结果中的最终净值口径，不再额外推导买卖方向。
                        </Alert>
                        <Box sx={{ pt: 0.5 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a', mb: 0.75 }}>
                                结果说明
                            </Typography>
                            <Alert severity={overview?.exists ? 'success' : 'warning'} variant="outlined">
                                {resultMessage}
                            </Alert>
                        </Box>
                    </Stack>
                </DialogContent>
            </Dialog>
        </>
    );
};
