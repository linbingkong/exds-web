import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    SelectChangeEvent,
    Snackbar,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import apiClient from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

interface MonthMeta {
    _id: string;
    month: string;
    count: number;
}

interface FreqCompFeeRecord {
    plant_name: string;
    on_grid_energy: number;
    compensation_fee: number;
    allocation_fee: number;
    settlement_fee: number;
}

interface MonthData {
    month: string;
    records: FreqCompFeeRecord[];
}

const formatMonth = (month: string): string => {
    if (!/^\d{6}$/.test(month)) return month;
    return `${month.slice(0, 4)}年${month.slice(4, 6)}月`;
};

const formatNumber = (value?: number): string => {
    if (value === undefined || value === null) return '—';
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
};

const FreqCompFeeTab: React.FC = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:basic_monthly_manual_import:edit');
    const [months, setMonths] = useState<MonthMeta[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [monthData, setMonthData] = useState<MonthData | null>(null);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
        open: false,
        msg: '',
        severity: 'success',
    });

    const fetchMonths = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await apiClient.get('/api/v1/freq-comp-fee');
            const list: MonthMeta[] = res.data.months || [];
            setMonths(list);
            setSelectedMonth(prev => prev || list[0]?._id || '');
        } catch (e: any) {
            setError(e.response?.data?.detail || e.message || '加载月份列表失败');
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        fetchMonths();
    }, [fetchMonths]);

    useEffect(() => {
        if (!selectedMonth) {
            setMonthData(null);
            return;
        }

        setLoadingDetail(true);
        setError(null);
        apiClient.get(`/api/v1/freq-comp-fee/${selectedMonth}`)
            .then(res => setMonthData(res.data))
            .catch(e => setError(e.response?.data?.detail || e.message || '加载调频补偿费用失败'))
            .finally(() => setLoadingDetail(false));
    }, [selectedMonth]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const file = e.target.files?.[0] || null;
        setImportFile(file);
        if (file) {
            setImportDialogOpen(true);
        }
    };

    const resetFileInput = () => {
        const fileInput = document.getElementById('freq-comp-fee-file-upload') as HTMLInputElement | null;
        if (fileInput) fileInput.value = '';
    };

    const handleImport = async () => {
        if (!canEdit || !importFile) return;

        setImporting(true);
        const formData = new FormData();
        formData.append('file', importFile);

        try {
            const res = await apiClient.post('/api/v1/freq-comp-fee/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const { month, count } = res.data;
            setSnackbar({ open: true, msg: `${formatMonth(month)} 调频补偿费用导入成功，共 ${count} 条`, severity: 'success' });
            setImportDialogOpen(false);
            setImportFile(null);
            await fetchMonths();
            setSelectedMonth(month);
            resetFileInput();
        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || e.message || '导入失败', severity: 'error' });
        } finally {
            setImporting(false);
        }
    };

    const handleDelete = async () => {
        if (!canEdit || !selectedMonth) return;

        setDeleting(true);
        try {
            await apiClient.delete(`/api/v1/freq-comp-fee/${selectedMonth}`);
            setSnackbar({ open: true, msg: `${formatMonth(selectedMonth)} 数据已删除`, severity: 'success' });
            setDeleteDialogOpen(false);
            setMonthData(null);
            const remaining = months.filter(m => m._id !== selectedMonth);
            setMonths(remaining);
            setSelectedMonth(remaining[0]?._id || '');
        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || e.message || '删除失败', severity: 'error' });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Box>
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {months.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>选择月份</InputLabel>
                        <Select
                            value={selectedMonth}
                            label="选择月份"
                            onChange={(e: SelectChangeEvent) => setSelectedMonth(e.target.value)}
                        >
                            {months.map(m => (
                                <MenuItem key={m._id} value={m._id}>{formatMonth(m.month)}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                <Box sx={{ flexGrow: 1 }} />

                <Button variant="contained" startIcon={<UploadFileIcon />} component="label" disabled={!canEdit}>
                    导入调频辅助服务费用文件
                    <input id="freq-comp-fee-file-upload" type="file" hidden accept=".pdf" onChange={handleFileChange} />
                </Button>

                {selectedMonth && (
                    <IconButton color="error" size="small" onClick={() => setDeleteDialogOpen(true)} title={`删除 ${formatMonth(selectedMonth)} 数据`} disabled={!canEdit}>
                        <DeleteOutlineIcon />
                    </IconButton>
                )}
            </Paper>

            {loadingList && <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!loadingList && months.length === 0 && (
                <Alert severity="info">暂无调频补偿费用数据，请点击导入。</Alert>
            )}

            {selectedMonth && !loadingList && (
                loadingDetail
                    ? <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
                    : monthData && (
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                调频辅助服务市场费用表
                            </Typography>
                            <TableContainer sx={{ overflowX: 'auto', maxHeight: 500 }}>
                                <Table stickyHeader size="small" sx={{ '& .MuiTableCell-root': { fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 1, sm: 2 } } }}>
                                    <TableHead>
                                        <TableRow sx={{ '& th': { bgcolor: 'background.paper', zIndex: 1 } }}>
                                            <TableCell>序号</TableCell>
                                            <TableCell sx={{ minWidth: 160 }}>电厂名称</TableCell>
                                            <TableCell align="right">上网电量</TableCell>
                                            <TableCell align="right">补偿费用</TableCell>
                                            <TableCell align="right">分摊费用</TableCell>
                                            <TableCell align="right">结算费用</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {monthData.records.map((record, idx) => (
                                            <TableRow key={`${record.plant_name}-${idx}`} hover>
                                                <TableCell>{idx + 1}</TableCell>
                                                <TableCell>{record.plant_name}</TableCell>
                                                <TableCell align="right">{formatNumber(record.on_grid_energy)}</TableCell>
                                                <TableCell align="right">{formatNumber(record.compensation_fee)}</TableCell>
                                                <TableCell align="right">{formatNumber(record.allocation_fee)}</TableCell>
                                                <TableCell align="right">{formatNumber(record.settlement_fee)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    )
            )}

            <Dialog open={importDialogOpen} onClose={() => !importing && setImportDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>确认导入数据</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        即将从 <strong>{importFile?.name}</strong> 中导入调频辅助服务市场费用表。
                        <br /><br />
                        <em>年月将从 PDF 文件内容识别；同一年月重复导入会以本次文件内容覆盖。</em>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportDialogOpen(false)} disabled={importing}>取消</Button>
                    <Button onClick={handleImport} variant="contained" disabled={importing || !canEdit} startIcon={importing ? <CircularProgress size={16} /> : undefined}>
                        {importing ? '导入中...' : '确认导入'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
                <DialogTitle>删除确认</DialogTitle>
                <DialogContent>
                    <DialogContentText>确定删除 <strong>{formatMonth(selectedMonth)}</strong> 的调频补偿费用数据？不可撤销。</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>取消</Button>
                    <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting || !canEdit} startIcon={deleting ? <CircularProgress size={16} /> : undefined}>
                        {deleting ? '删除中...' : '确认删除'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default FreqCompFeeTab;
