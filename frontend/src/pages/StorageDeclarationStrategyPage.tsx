import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    Grid,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    STRATEGY_TYPE_OPTIONS,
    StorageStation,
    StorageStrategy,
    StrategyParam,
    StrategyPayload,
    storageDeclarationApi,
} from '../api/storageDeclaration';
import { useAuth } from '../contexts/AuthContext';
import DeclarationDayTab from './tabs/declaration/DeclarationDayTab';
import RevenueForecastTab from './tabs/declaration/RevenueForecastTab';
import ReviewDayTab from './tabs/declaration/ReviewDayTab';

const EDIT_PERMISSION = 'module:storage_declaration_strategy:edit';

const EMPTY_STRATEGY_PARAM: StrategyParam = {
    param_key: '',
    param_name: '',
    param_value: '',
    unit: '',
    description: '',
};

const FM_PRICE_THRESHOLD_PARAM: StrategyParam = {
    param_key: 'fm_price_threshold',
    param_name: '调频价差阈值',
    param_value: '300',
    unit: '元/MWh',
    description: '现货价差高于该阈值时，优先执行能量套利；否则优先参与调频。',
};

const MAX_SOC_PARAM: StrategyParam = {
    param_key: 'max_soc',
    param_name: '最高SOC',
    param_value: '90',
    unit: '%',
    description: '峰谷套利策略计算充放电功率时使用的目标 SOC 上限。',
};

const mergeFmThresholdParam = (params: StrategyParam[], threshold: number): StrategyParam[] => {
    const next = [...params];
    const index = next.findIndex((param) => param.param_key === FM_PRICE_THRESHOLD_PARAM.param_key);
    const value = String(threshold || 300);
    if (index >= 0) {
        next[index] = {
            ...FM_PRICE_THRESHOLD_PARAM,
            ...next[index],
            param_value: next[index].param_value || value,
            unit: next[index].unit || FM_PRICE_THRESHOLD_PARAM.unit,
            description: next[index].description || FM_PRICE_THRESHOLD_PARAM.description,
        };
        return next;
    }
    return [{ ...FM_PRICE_THRESHOLD_PARAM, param_value: value }, ...next];
};

const mergeDefaultStrategyParams = (params: StrategyParam[], threshold: number): StrategyParam[] => {
    const next = mergeFmThresholdParam(params, threshold);
    const index = next.findIndex((param) => param.param_key === MAX_SOC_PARAM.param_key);
    if (index >= 0) {
        next[index] = {
            ...MAX_SOC_PARAM,
            ...next[index],
            param_value: next[index].param_value || MAX_SOC_PARAM.param_value,
            unit: next[index].unit || MAX_SOC_PARAM.unit,
            description: next[index].description || MAX_SOC_PARAM.description,
        };
        return next;
    }
    return [...next, { ...MAX_SOC_PARAM }];
};

const getFmThresholdFromParams = (params: StrategyParam[], fallback: number): number => {
    const param = params.find((item) => item.param_key === FM_PRICE_THRESHOLD_PARAM.param_key);
    const value = Number(param?.param_value);
    return Number.isFinite(value) ? value : fallback;
};

const buildEmptyStrategyPayload = (stationId: string): StrategyPayload => ({
    station_id: stationId,
    strategy_name: '',
    strategy_type: 'simple_peak_valley',
    strategy_status: '启用',
    fm_price_threshold: 300,
    description: '',
    strategy_params: [{ ...FM_PRICE_THRESHOLD_PARAM }, { ...MAX_SOC_PARAM }],
});

const findStrategyTypeLabel = (type: string): string =>
    STRATEGY_TYPE_OPTIONS.find((opt) => opt.value === type)?.label || type;

export const StorageDeclarationStrategyPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission(EDIT_PERMISSION);

    const [stations, setStations] = useState<StorageStation[]>([]);
    const [strategies, setStrategies] = useState<StorageStrategy[]>([]);
    const [selectedStationId, setSelectedStationId] = useState<string>('');
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
    const [activePanel, setActivePanel] = useState(0);
    const [reviewTargetDate, setReviewTargetDate] = useState<string | undefined>(undefined);

    const [strategyMgmtOpen, setStrategyMgmtOpen] = useState(false);
    const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
    const [editingStrategy, setEditingStrategy] = useState<{ id?: string; payload: StrategyPayload }>({ payload: buildEmptyStrategyPayload('') });

    const [feedback, setFeedback] = useState<{ severity: 'success' | 'error' | 'info' | 'warning'; message: string } | null>(null);

    const refreshStations = async (preserveSelection = true) => {
        const list = await storageDeclarationApi.listStations();
        setStations(list);
        if (!preserveSelection || !selectedStationId) {
            const first = list[0];
            setSelectedStationId(first?.station_id || '');
        } else if (!list.find((s) => s.station_id === selectedStationId)) {
            setSelectedStationId(list[0]?.station_id || '');
        }
    };

    const refreshStrategies = async (preferredStrategyId?: string) => {
        const list = await storageDeclarationApi.listStrategies();
        setStrategies(list);
        const nextSelected = list.find((s) => s.strategy_id === (preferredStrategyId || selectedStrategyId)) || list[0];
        if (nextSelected) {
            setSelectedStrategyId(nextSelected.strategy_id);
            setSelectedStationId(nextSelected.station_id);
        } else {
            setSelectedStrategyId('');
        }
    };

    useEffect(() => {
        void (async () => {
            try {
                await refreshStations(false);
            } catch (e: any) {
                setFeedback({ severity: 'error', message: '加载电站列表失败' });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        void (async () => {
            try {
                await refreshStrategies();
            } catch (e: any) {
                setFeedback({ severity: 'error', message: '加载策略列表失败' });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentStrategy = useMemo<StorageStrategy | null>(
        () => strategies.find((s) => s.strategy_id === selectedStrategyId) || null,
        [strategies, selectedStrategyId],
    );
    const currentStation = useMemo<StorageStation | null>(
        () => stations.find((s) => s.station_id === (currentStrategy?.station_id || selectedStationId)) || stations[0] || null,
        [currentStrategy?.station_id, selectedStationId, stations],
    );

    // ============ 策略对话框 ============

    const openStrategyCreate = () => {
        const stationId = selectedStationId || stations[0]?.station_id || '';
        if (!stationId) {
            setFeedback({ severity: 'warning', message: '请先到电站运行信息页维护电站档案' });
            return;
        }
        setEditingStrategy({ payload: buildEmptyStrategyPayload(stationId) });
        setStrategyDialogOpen(true);
    };

    const openStrategyEdit = async (strategy: StorageStrategy) => {
        try {
            const detail = await storageDeclarationApi.getStrategy(strategy.strategy_id);
            setEditingStrategy({
                id: detail.strategy_id,
                payload: {
                    station_id: detail.station_id,
                    strategy_name: detail.strategy_name,
                    strategy_type: detail.strategy_type,
                    strategy_status: detail.strategy_status,
                    fm_price_threshold: detail.fm_price_threshold,
                    description: detail.description,
                    strategy_params: mergeDefaultStrategyParams(detail.strategy_params || [], detail.fm_price_threshold),
                },
            });
            setStrategyDialogOpen(true);
        } catch (e: any) {
            setFeedback({ severity: 'error', message: '加载策略详情失败' });
        }
    };

    const handleStrategySubmit = async () => {
        const payload = {
            ...editingStrategy.payload,
            fm_price_threshold: getFmThresholdFromParams(editingStrategy.payload.strategy_params, editingStrategy.payload.fm_price_threshold),
            strategy_params: mergeDefaultStrategyParams(editingStrategy.payload.strategy_params, editingStrategy.payload.fm_price_threshold),
        };
        if (!payload.strategy_name.trim()) {
            setFeedback({ severity: 'warning', message: '请填写策略名称' });
            return;
        }
        try {
            if (editingStrategy.id) {
                await storageDeclarationApi.updateStrategy(editingStrategy.id, payload);
                setFeedback({ severity: 'success', message: '策略已更新' });
            } else {
                const created = await storageDeclarationApi.createStrategy(payload);
                setFeedback({ severity: 'success', message: '策略已创建' });
                await refreshStrategies(created.strategy_id);
                setStrategyDialogOpen(false);
                return;
            }
            await refreshStrategies(editingStrategy.id);
            setStrategyDialogOpen(false);
        } catch (e: any) {
            setFeedback({ severity: 'error', message: e?.response?.data?.detail || '保存策略失败' });
        }
    };

    const handleStrategyDelete = async (strategy: StorageStrategy) => {
        if (!window.confirm(`确认删除策略「${strategy.strategy_name}」？`)) return;
        try {
            await storageDeclarationApi.deleteStrategy(strategy.strategy_id);
            await refreshStrategies();
            setFeedback({ severity: 'success', message: '策略已删除' });
        } catch (e: any) {
            setFeedback({ severity: 'error', message: e?.response?.data?.detail || '删除失败' });
        }
    };

    const handleStrategyStatusToggle = async (strategy: StorageStrategy) => {
        try {
            await storageDeclarationApi.setStrategyStatus(strategy.strategy_id, strategy.strategy_status === '启用' ? '停用' : '启用');
            await refreshStrategies();
        } catch (e: any) {
            setFeedback({ severity: 'error', message: '状态切换失败' });
        }
    };

    // ============ 渲染 ============

    const renderStrategyList = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <Box sx={{ p: { xs: 1.25, sm: 1.5 }, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
                    策略列表
                </Typography>
                {canEdit && (
                    <>
                        <IconButton size="small" onClick={() => setStrategyMgmtOpen((v) => !v)}><SettingsOutlinedIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={openStrategyCreate}><AddIcon fontSize="small" /></IconButton>
                    </>
                )}
            </Box>
            <Divider />
            <List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
                {strategies.length === 0 && (
                    <Box sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">暂无策略</Typography></Box>
                )}
                {strategies.map((strategy) => (
                    <ListItemButton
                        key={strategy.strategy_id}
                        selected={strategy.strategy_id === selectedStrategyId}
                        onClick={() => {
                            setSelectedStrategyId(strategy.strategy_id);
                            setSelectedStationId(strategy.station_id);
                        }}
                        sx={{ alignItems: 'flex-start', borderBottom: 1, borderColor: 'divider', py: { xs: 1, sm: 1.25 } }}
                    >
                        <ListItemText
                            primary={
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, color: strategy.strategy_status === '停用' ? 'text.disabled' : 'text.primary', flex: 1 }}>
                                        {strategy.strategy_name}
                                    </Typography>
                                    <Chip
                                        size="small"
                                        label={strategy.next_day_declare_status || '未申报'}
                                        color={strategy.next_day_declare_status === '已申报' ? 'success' : 'warning'}
                                    />
                                </Stack>
                            }
                            secondary={
                                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} useFlexGap flexWrap="wrap">
                                    <Chip size="small" variant="outlined" label={findStrategyTypeLabel(strategy.strategy_type)} />
                                    {strategy.strategy_status === '停用' && <Chip size="small" label="停用" />}
                                </Stack>
                            }
                            secondaryTypographyProps={{ component: 'div' }}
                        />
                        {strategyMgmtOpen && canEdit && (
                            <Stack direction="row" spacing={0.5}>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); void openStrategyEdit(strategy); }}><EditOutlinedIcon fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); void handleStrategyStatusToggle(strategy); }}>
                                    {strategy.strategy_status === '启用' ? <VisibilityOutlinedIcon fontSize="small" /> : <VisibilityOffOutlinedIcon fontSize="small" />}
                                </IconButton>
                                <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); void handleStrategyDelete(strategy); }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                            </Stack>
                        )}
                    </ListItemButton>
                ))}
            </List>
            {canEdit && (
                <Box sx={{ p: { xs: 1.25, sm: 1.5 }, borderTop: 1, borderColor: 'divider' }}>
                    <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={openStrategyCreate}>新增策略</Button>
                </Box>
            )}
        </Box>
    );

    const renderRightPanel = () => {
        if (!currentStation) {
            return <Alert severity="info">请先到电站运行信息页维护电站档案。</Alert>;
        }
        if (!currentStrategy) {
            return <Alert severity="info">暂无策略，请先新增策略。</Alert>;
        }
        return (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Paper variant="outlined" sx={{ borderRadius: 2, mb: 1.5, flexShrink: 0 }}>
                    <Tabs
                        value={activePanel}
                        onChange={(_e, v) => setActivePanel(v)}
                        variant="scrollable"
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        sx={{
                            minHeight: 40,
                            '& .MuiTab-root': {
                                minHeight: 40,
                                py: 0.5,
                                px: { xs: 1, sm: 1.5 },
                                minWidth: { xs: 72, sm: 'auto' },
                            },
                        }}
                    >
                        <Tab label={isMobile ? '申报' : '模拟申报'} />
                        <Tab label={isMobile ? '复盘' : '单日复盘'} />
                        <Tab label={isMobile ? '收益' : '策略收益'} />
                    </Tabs>
                </Paper>
                <Box sx={{ flex: 1, minHeight: 0, overflow: { xs: 'visible', md: 'hidden' } }}>
                    {activePanel === 0 && (
                        <DeclarationDayTab
                            station={currentStation}
                            strategy={currentStrategy}
                            canEdit={canEdit}
                            onSaved={() => void refreshStrategies()}
                        />
                    )}
                    {activePanel === 1 && (
                        <ReviewDayTab station={currentStation} strategy={currentStrategy} canEdit={canEdit} targetDate={reviewTargetDate} />
                    )}
                    {activePanel === 2 && (
                        <RevenueForecastTab
                            station={currentStation}
                            strategy={currentStrategy}
                            onOpenReview={(date) => {
                                setReviewTargetDate(date);
                                setActivePanel(1);
                            }}
                        />
                    )}
                </Box>
            </Box>
        );
    };

    const updateStrategyField = <K extends keyof StrategyPayload>(field: K, value: StrategyPayload[K]) => {
        setEditingStrategy((prev) => ({ ...prev, payload: { ...prev.payload, [field]: value } }));
    };

    const updateStrategyParam = (index: number, field: keyof StrategyParam, value: string) => {
        setEditingStrategy((prev) => {
            const next = [...prev.payload.strategy_params];
            next[index] = { ...next[index], [field]: value };
            return { ...prev, payload: { ...prev.payload, strategy_params: next } };
        });
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box
                sx={{
                    height: { xs: 'auto', md: '100%' },
                    minHeight: 0,
                    width: '100%',
                    bgcolor: 'background.default',
                    overflowX: 'hidden',
                    overflowY: isMobile ? 'auto' : 'hidden',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: { xs: 1.5, md: 2 },
                        px: 0,
                        py: 0,
                        height: { md: '100%' },
                        minHeight: 0,
                    }}
                >
                    {isMobile && (
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>储能运营 / 储能申报策略</Typography>
                    )}
                    {feedback && <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', md: 'row' },
                            gap: 1.5,
                            flex: 1,
                            minHeight: 0,
                            overflow: { xs: 'visible', md: 'hidden' },
                        }}
                    >
                        <Paper
                            variant="outlined"
                            sx={{
                                width: { xs: '100%', md: 300 },
                                display: 'flex',
                                flexDirection: 'column',
                                minWidth: 0,
                                minHeight: 0,
                                flexShrink: 0,
                                maxHeight: { xs: 360, md: 'none' },
                                overflow: 'hidden',
                                borderRadius: 2,
                                background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.96) 100%)',
                            }}
                        >
                            {renderStrategyList()}
                        </Paper>
                        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                            {renderRightPanel()}
                        </Box>
                    </Box>
                </Box>
            </Box>

            {/* 策略对话框 */}
            <Dialog open={strategyDialogOpen} onClose={() => setStrategyDialogOpen(false)} maxWidth="md" fullWidth fullScreen={isMobile}>
                <DialogTitle>{editingStrategy.id ? '编辑策略' : '新增策略'}</DialogTitle>
                <DialogContent>
                    <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <TextField fullWidth size="small" label="策略名称" value={editingStrategy.payload.strategy_name} onChange={(e) => updateStrategyField('strategy_name', e.target.value)} />
                            </Grid>
                            <Grid size={{ xs: 12, md: 3 }}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>策略类型</InputLabel>
                                    <Select label="策略类型" value={editingStrategy.payload.strategy_type} onChange={(e) => updateStrategyField('strategy_type', e.target.value)}>
                                        {STRATEGY_TYPE_OPTIONS.map((opt) => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, md: 3 }}>
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ height: '100%' }}>
                                    <Typography variant="body2">停用</Typography>
                                    <Switch checked={editingStrategy.payload.strategy_status === '启用'} onChange={(e) => updateStrategyField('strategy_status', e.target.checked ? '启用' : '停用')} />
                                    <Typography variant="body2">启用</Typography>
                                </Stack>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField fullWidth size="small" label="备注" value={editingStrategy.payload.description} onChange={(e) => updateStrategyField('description', e.target.value)} />
                            </Grid>
                        </Grid>
                        <Divider />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>策略参数</Typography>
                            <Button size="small" startIcon={<AddIcon />} onClick={() => updateStrategyField('strategy_params', [...editingStrategy.payload.strategy_params, { ...EMPTY_STRATEGY_PARAM }])}>新增参数</Button>
                        </Box>
                        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>参数键</TableCell>
                                        <TableCell>参数名</TableCell>
                                        <TableCell>参数值</TableCell>
                                        <TableCell>单位</TableCell>
                                        <TableCell>说明</TableCell>
                                        <TableCell width={48} />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {editingStrategy.payload.strategy_params.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center"><Typography variant="caption" color="text.secondary">暂无策略参数</Typography></TableCell>
                                        </TableRow>
                                    )}
                                    {editingStrategy.payload.strategy_params.map((p, i) => (
                                        <TableRow key={i}>
                                            <TableCell><TextField size="small" value={p.param_key} onChange={(e) => updateStrategyParam(i, 'param_key', e.target.value)} /></TableCell>
                                            <TableCell><TextField size="small" value={p.param_name} onChange={(e) => updateStrategyParam(i, 'param_name', e.target.value)} /></TableCell>
                                            <TableCell><TextField size="small" value={p.param_value} onChange={(e) => updateStrategyParam(i, 'param_value', e.target.value)} /></TableCell>
                                            <TableCell><TextField size="small" value={p.unit} onChange={(e) => updateStrategyParam(i, 'unit', e.target.value)} /></TableCell>
                                            <TableCell><TextField size="small" multiline maxRows={2} value={p.description} onChange={(e) => updateStrategyParam(i, 'description', e.target.value)} /></TableCell>
                                            <TableCell>
                                                <IconButton size="small" color="error" onClick={() => updateStrategyField('strategy_params', editingStrategy.payload.strategy_params.filter((_, idx) => idx !== i))}>
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setStrategyDialogOpen(false)}>取消</Button>
                    <Button variant="contained" onClick={() => void handleStrategySubmit()} disabled={!canEdit}>保存</Button>
                </DialogActions>
            </Dialog>
        </LocalizationProvider>
    );
};

export default StorageDeclarationStrategyPage;
