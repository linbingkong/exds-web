import React from 'react';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';

const MonthlyTradeReviewPage: React.FC = () => {
    return (
        <Box
            sx={{
                minHeight: 'calc(100vh - 160px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 2,
                py: 4,
                background: 'linear-gradient(180deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.7) 100%)',
            }}
        >
            <Card
                elevation={0}
                sx={{
                    width: '100%',
                    maxWidth: 720,
                    borderRadius: 4,
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)',
                }}
            >
                <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                    <Stack spacing={2.5}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <Box
                                sx={{
                                    width: 52,
                                    height: 52,
                                    borderRadius: 3,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#0f766e',
                                    background: 'linear-gradient(135deg, rgba(204, 251, 241, 0.9) 0%, rgba(186, 230, 253, 0.85) 100%)',
                                }}
                            >
                                <CalendarMonthOutlinedIcon />
                            </Box>
                            <Box>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: '#0f172a' }}>
                                    月度交易复盘
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.5, color: '#64748b' }}>
                                    页面已预留，后续可在此承接月度复盘总览、关键指标和复盘明细能力。
                                </Typography>
                            </Box>
                        </Stack>

                        <Chip
                            label="建设中"
                            color="primary"
                            variant="outlined"
                            sx={{ width: 'fit-content', fontWeight: 600 }}
                        />

                        <Typography variant="body1" sx={{ color: '#334155', lineHeight: 1.8 }}>
                            当前已完成菜单、路由与模块权限占位接入。后续如果开始正式开发，可直接在本页扩展筛选区、指标卡片、图表和明细表格。
                        </Typography>
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    );
};

export default MonthlyTradeReviewPage;
