import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Alert,
    CircularProgress,
    FormControl,
    FormLabel,
    RadioGroup,
    FormControlLabel,
    Radio,
    LinearProgress,
    Checkbox
} from '@mui/material';
import {
    PlayArrow as PlayArrowIcon,
    Close as CloseIcon,
    CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { reaggregateLoadData } from '../../api/load-data';
import apiClient from '../../api/client';

interface LoadDataAggregationDialogProps {
    customerId?: string; // Optional: if provided, single mode; else batch mode
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    canEdit?: boolean;
}

export const LoadDataAggregationDialog: React.FC<LoadDataAggregationDialogProps> = ({
    customerId,
    open,
    onClose,
    onSuccess,
    canEdit = true
}) => {
    // Stage
    const [stage, setStage] = useState<'config' | 'processing' | 'finished'>('config');
    const [mode, setMode] = useState<'incremental' | 'recalc'>('incremental');
    const [dateRangeType, setDateRangeType] = useState<'all' | 'last_month' | 'current_month' | 'current_year'>('all');
    const [deleteExisting, setDeleteExisting] = useState(false);
    const [result, setResult] = useState<{
        processed_customers: number;
        total_days: number;
        elapsed_seconds: number;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Progress
    const [currentCustomer, setCurrentCustomer] = useState<string>('');
    const [progress, setProgress] = useState(0); // 0-100
    const [processedCount, setProcessedCount] = useState(0);
    const [totalCount, setTotalCount] = useState(0);

    // Control
    const stopRequested = useRef(false);
    const [isStopping, setIsStopping] = useState(false);

    // Reset state on open
    useEffect(() => {
        if (open) {
            setStage('config');
            setMode('incremental');
            setDateRangeType('all');
            setDeleteExisting(false);
            setResult(null);
            setError(null);
            setProgress(0);
            setProcessedCount(0);
            setTotalCount(0);
            setCurrentCustomer('');
            stopRequested.current = false;
            setIsStopping(false);
        }
    }, [open]);

    // Helper to fetch all customers
    const fetchAllCustomers = async () => {
        let allCustomers: any[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const res = await apiClient.get('/api/v1/load-data/customers', {
                params: { page, page_size: 100 }
            });
            const list = res.data.customers || [];
            allCustomers = [...allCustomers, ...list];

            if (list.length < 100 || page * 100 >= res.data.total) {
                hasMore = false;
            } else {
                page++;
            }
        }
        return allCustomers;
    };

    const handleStart = async () => {
        if (!canEdit) return;
        setStage('processing');
        setError(null);
        setProcessedCount(0);
        setTotalCount(0);
        setProgress(0);
        stopRequested.current = false;
        setIsStopping(false);

        const startTime = Date.now();
        let aggregatedDays = 0;
        let processedCusts = 0;

        try {
            let targetCustomers: any[] = [];

            if (customerId) {
                // Single mode
                targetCustomers = [{ customer_id: customerId, customer_name: '当前客户' }]; // Name fetched or generic
            } else {
                // Batch mode
                setCurrentCustomer('正在获取客户列表...');
                targetCustomers = await fetchAllCustomers();
            }

            setTotalCount(targetCustomers.length);

            for (let i = 0; i < targetCustomers.length; i++) {
                if (stopRequested.current) {
                    break;
                }

                const cust = targetCustomers[i];
                setCurrentCustomer(cust.customer_name || cust.customer_id);

                // Calculate Dates
                let startDate: string | undefined = undefined;
                let endDate: string | undefined = undefined;

                if (mode === 'recalc' && dateRangeType !== 'all') {
                    const now = new Date();
                    if (dateRangeType === 'last_month') {
                        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
                        endDate = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
                    } else if (dateRangeType === 'current_month') {
                        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
                    } else if (dateRangeType === 'current_year') {
                        startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                        endDate = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
                    }
                }

                // Call aggregation API
                const params: any = {
                    customer_id: cust.customer_id,
                    mode: mode === 'recalc' ? 'full' : 'incremental',
                    delete_existing: mode === 'recalc' ? deleteExisting : false,
                    start_date: startDate,
                    end_date: endDate
                };

                try {
                    const res = await reaggregateLoadData('all', params);
                    // Accumulate stats if available from backend (backend currently returns processed records count)
                    // Assuming res.data.processed is records/days count
                    if (res.data && res.data.updated !== undefined) {
                        aggregatedDays += res.data.updated;
                    }
                } catch (err) {
                    console.error(`Failed to aggregate customer ${cust.customer_id}`, err);
                    // Continue to next customer even if one fails? Or stop?
                    // Usually batch process continues.
                }

                processedCusts++;
                setProcessedCount(processedCusts);
                setProgress(Math.round(((i + 1) / targetCustomers.length) * 100));
            }

            const endTime = Date.now();
            setResult({
                processed_customers: processedCusts,
                total_days: aggregatedDays,
                elapsed_seconds: (endTime - startTime) / 1000
            });
            setStage('finished');
            onSuccess();

        } catch (err: any) {
            console.error('Aggregation process failed:', err);
            setError(err.response?.data?.detail || err.message || '聚合执行失败');
            // If failed during fetching list, stay in processing or go back?
            // Let's stay in processing but show error? Or go to finished with error state?
            // Going back to config allows retry.
            setStage('config');
        }
    };

    const handleStop = () => {
        if (stopRequested.current) return;
        stopRequested.current = true;
        setIsStopping(true);
    };

    const handleClose = () => {
        if (stage === 'processing' && !stopRequested.current) return;
        onClose();
    };

    const renderConfigContent = () => (
        <Box sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2">
                    <strong>功能说明：</strong><br />
                    系统将检查{customerId ? '当前' : '所有签约'}客户的负荷数据，自动计算聚合客户的计量点电量数据和电表示度数据。
                </Typography>
            </Alert>

            <FormControl component="fieldset">
                <FormLabel component="legend">选择聚合模式</FormLabel>
                <RadioGroup
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'incremental' | 'recalc')}
                >
                    <FormControlLabel
                        value="incremental"
                        control={<Radio />}
                        label={
                            <Box>
                                <Typography variant="body1">增量聚合 (推荐)</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    仅处理尚未计算或缺失的数据，速度较快
                                </Typography>
                            </Box>
                        }
                        sx={{ mb: 2, mt: 1 }}
                    />
                    <FormControlLabel
                        value="recalc"
                        control={<Radio />}
                        label={
                            <Box>
                                <Typography variant="body1">全量重新计算</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    重新检查并计算所有历史数据，可能耗时较长
                                </Typography>
                            </Box>
                        }
                    />
                </RadioGroup>
            </FormControl>

            {mode === 'recalc' && (
                <Box>
                    <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>
                        <Typography variant="body2">
                            注意：全量重新计算会消耗较多系统资源，建议在非高峰时段执行。
                        </Typography>
                    </Alert>

                    {/* 日期范围选择 */}
                    <FormControl component="fieldset" sx={{ mb: 2, display: 'block' }}>
                        <FormLabel component="legend">聚合日期范围</FormLabel>
                        <RadioGroup
                            row
                            value={dateRangeType}
                            onChange={(e) => setDateRangeType(e.target.value as any)}
                        >
                            <FormControlLabel value="all" control={<Radio size="small" />} label="全部时间" />
                            <FormControlLabel value="last_month" control={<Radio size="small" />} label="上月" />
                            <FormControlLabel value="current_month" control={<Radio size="small" />} label="本月" />
                            <FormControlLabel value="current_year" control={<Radio size="small" />} label="今年" />
                        </RadioGroup>
                    </FormControl>

                    {/* 删除原数据选项 */}
                    <Box sx={{ mt: 1 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={deleteExisting}
                                    onChange={(e) => setDeleteExisting(e.target.checked)}
                                    color="error"
                                />
                            }
                            label={
                                <Typography color="error" variant="body2">
                                    计算前删除原数据 (彻底重算)
                                </Typography>
                            }
                        />
                    </Box>
                </Box>
            )}

            {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                </Alert>
            )}
        </Box>
    );

    const renderProcessingContent = () => (
        <Box sx={{ py: 4, textAlign: 'center' }}>
            <Box position="relative" display="inline-flex" mb={2}>
                <CircularProgress size={60} thickness={4} />
            </Box>

            <Typography variant="h6" gutterBottom>
                {isStopping ? '正在停止...' : '正在执行数据聚合...'}
            </Typography>

            <Box sx={{ width: '90%', mx: 'auto', mt: 3, mb: 1 }}>
                <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '90%', mx: 'auto', mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                    {currentCustomer ? `正在处理: ${currentCustomer}` : '准备中...'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {processedCount} / {totalCount || '-'}
                </Typography>
            </Box>

            {isStopping && (
                <Alert severity="warning" sx={{ mt: 2, mx: 3 }}>
                    将在当前客户处理完成后停止
                </Alert>
            )}
        </Box>
    );

    const renderFinishedContent = () => (
        <Box sx={{ py: 2, textAlign: 'center' }}>
            <Box sx={{ color: 'success.main', mb: 2 }}>
                <CheckCircleIcon sx={{ fontSize: 64 }} />
            </Box>
            <Typography variant="h6" gutterBottom>
                聚合执行完成
            </Typography>

            {result && (
                <Box sx={{ mt: 3, textAlign: 'left', bgcolor: 'background.default', p: 2, borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom>执行统计：</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <Typography variant="body2">聚合客户数：</Typography>
                        <Typography variant="body2" fontWeight="bold">{result.processed_customers}</Typography>

                        <Typography variant="body2">处理天数(合计)：</Typography>
                        <Typography variant="body2" fontWeight="bold" color="primary">{result.total_days}</Typography>

                        <Typography variant="body2">耗时：</Typography>
                        <Typography variant="body2" fontWeight="bold">{result.elapsed_seconds.toFixed(1)} 秒</Typography>
                    </Box>
                </Box>
            )}

            <Button variant="contained" onClick={handleClose} sx={{ mt: 4, minWidth: 120 }}>
                确定
            </Button>
        </Box>
    );

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">
                        {stage === 'processing' ? '正在聚合' : stage === 'finished' ? '聚合结果' : '数据聚合'}
                    </Typography>
                    {stage === 'config' && (
                        <Button
                            size="small"
                            onClick={handleClose}
                            sx={{ minWidth: 0, p: 0.5, borderRadius: '50%' }}
                        >
                            <CloseIcon />
                        </Button>
                    )}
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {stage === 'config' && renderConfigContent()}
                {stage === 'processing' && renderProcessingContent()}
                {stage === 'finished' && renderFinishedContent()}
            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                {stage === 'config' ? (
                    <>
                        <Button onClick={handleClose}>取消</Button>
                        <Button
                            variant="contained"
                            onClick={handleStart}
                            disabled={!canEdit}
                            startIcon={<PlayArrowIcon />}
                        >
                            开始执行
                        </Button>
                    </>
                ) : stage === 'processing' ? (
                    <Button
                        color="error"
                        onClick={handleStop}
                        disabled={isStopping}
                    >
                        {isStopping ? '停止中...' : '取消执行'}
                    </Button>
                ) : null}
            </DialogActions>
        </Dialog>
    );
};
