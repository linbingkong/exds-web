import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
    Box, Grid, Paper, Typography, Chip, Tabs, Tab, CircularProgress, Alert, Button, IconButton,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip as MuiTooltip, Stack, Divider,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Fab,
    FormControlLabel, Checkbox, List, ListItem, ListItemText, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { format, addDays, parseISO, startOfMonth, isSameDay, getMonth, getYear } from 'date-fns';
import { LocalizationProvider, DateCalendar, PickersDay, PickersDayProps } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import Badge from '@mui/material/Badge';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    Tooltip as RechartsTooltip, Legend,
    Area, AreaChart, ComposedChart, Cell, PieChart, Pie, Sector, ReferenceArea,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { loadCharacteristicsApi, CustomerCharacteristics, AnomalyAlertItem, AnalysisHistoryItem } from '../api/loadCharacteristics';
import customerApi from '../api/customer';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { getTouSummary, TouSummary } from '../api/tou';
import { useTouPeriodBackground, TouPeriodData } from '../hooks/useTouPeriodBackground';
import { useAuth } from '../contexts/AuthContext';
import { navigateBackWithFallback } from '../utils/mobileNavigation';

// --- Shared Components ---

// Matches MonthlyConsumptionChart Header Style
const PanelHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', fontSize: '1.1rem' }}>
            <Box component="span" sx={{ width: 4, height: 18, bgcolor: 'primary.main', mr: 1, borderRadius: 1 }} />
            {title}
        </Typography>
        {action && <Box>{action}</Box>}
    </Box>
);

// --- Block 1: 客户核心画像面板 ---
const CustomerIdentityPanel: React.FC<{
    data: CustomerCharacteristics,
    onRefresh: () => void
}> = ({ data, onRefresh }) => {
    return (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fff', borderRadius: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" spacing={2}>
                {/* Identity */}
                <Box>
                    <Stack direction="row" alignItems="center" spacing={2}>
                        <Typography variant="h5" fontWeight="bold" color="text.primary">
                            {data.customer_name}
                        </Typography>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={3} mt={1.5}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2" color="text.secondary">质量评级</Typography>
                            <Chip
                                label={data.quality_rating || 'N/A'}
                                size="small"
                                color={data.quality_rating === 'A' ? 'success' : data.quality_rating === 'B' ? 'primary' : 'default'}
                                sx={{ borderRadius: 1, minWidth: 32, fontWeight: 'bold', height: 24 }}
                            />
                        </Stack>
                        <Divider orientation="vertical" flexItem variant="middle" />
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2" color="text.secondary">规律评分</Typography>
                            <Typography variant="h6" fontWeight="bold" color="primary.main" sx={{ lineHeight: 1 }}>
                                {data.regularity_score ?? '-'}
                            </Typography>
                        </Stack>
                    </Stack>
                </Box>

                {/* Actions */}
                <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                        更新于: {data.updated_at ? format(parseISO(data.updated_at), 'yyyy-MM-dd HH:mm') : '-'}
                    </Typography>
                    <Button startIcon={<RefreshIcon />} size="small" variant="outlined" onClick={onRefresh} sx={{ borderRadius: 2, textTransform: 'none' }}>
                        刷新数据
                    </Button>
                </Stack>
            </Stack>
        </Paper>
    );
};

// --- Block 2-Left: 特征雷达 (Radar Only) ---
const CharacteristicsRadarPanel: React.FC<{ data: CustomerCharacteristics }> = ({ data }) => {
    // 构造雷达数据 (9维度 -> 5宏观维度)
    const radarData = useMemo(() => {
        const d = data.long_term;
        const s = data.short_term;
        if (!d || !s) return [];
        return [
            { subject: '稳定性', A: (d.cv ? Math.max(0, 100 - d.cv * 100) : 60), fullMark: 100 },
            { subject: '增长力', A: Math.round(d.recent_3m_growth ? 50 + d.recent_3m_growth * 100 : 50), fullMark: 100 },
            { subject: '规律性', A: (data.regularity_score || 0), fullMark: 100 },
            { subject: '调节潜质', A: (s.min_max_ratio ? Math.round(100 - s.min_max_ratio * 40) : 50), fullMark: 100 },
            { subject: '价格敏感', A: (s.price_sensitivity_score != null ? s.price_sensitivity_score : 50), fullMark: 100 },
        ];
    }, [data]);

    // Custom Tooltip Data
    const RADAR_TOOLTIP_INFO: Record<string, { desc: string; metric: string }> = {
        '稳定性': { desc: '评分越高越稳定', metric: '基于日电量离散系数(CV)' },
        '增长力': { desc: '评分越高增势越强', metric: '基于近3月电量环比增长率' },
        '规律性': { desc: '评分越高模式越固定', metric: '基于日负荷曲线余弦相似度' },
        '调节潜质': { desc: '评分越高调节空间越大', metric: '基于峰谷负荷比 (100 - 比率*40)' },
        '价格敏感': { desc: '评分越高越懂得避峰', metric: '基于负荷与电价的负相关性' },
    };

    const CustomRadarTooltip: React.FC<any> = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const dataPoint = payload[0];
            const info = RADAR_TOOLTIP_INFO[dataPoint.payload.subject];

            return (
                <Paper sx={{ p: 1.5, boxShadow: 3, border: '1px solid #eee', borderRadius: 2, maxWidth: 220 }}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="primary.main">
                        {dataPoint.payload.subject}: {dataPoint.value}分
                    </Typography>
                    {info && (
                        <Box mt={1}>
                            <Typography variant="caption" display="block" color="text.primary" fontWeight="500">
                                {info.desc}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
                                原理: {info.metric}
                            </Typography>
                        </Box>
                    )}
                </Paper>
            );
        }
        return null;
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, height: 500, display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
            <PanelHeader title="特征雷达" />
            <Box flex={1} minHeight={250} sx={{ mx: -1 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 13, fill: '#666' }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="特征评分" dataKey="A" stroke="#1976d2" fill="#1976d2" fillOpacity={0.4} />
                        <RechartsTooltip content={<CustomRadarTooltip />} />
                    </RadarChart>
                </ResponsiveContainer>
            </Box>
        </Paper>
    );
};

const TAG_DESCRIPTIONS: Record<string, { desc: string; criteria: string }> = {
    // 1. Shift
    '连续生产': { desc: '日均负荷率高，通常为 24 小时连续作业（如三班倒）', criteria: '日均负荷率 > 60%' },
    '全天生产': { desc: '全天有较高负荷，无明显停产时段', criteria: '日均负荷率 > 40% 或 匹配双班模板' },
    '单班生产': { desc: '典型“日出而作，日落而息”，仅在白班时段生产', criteria: '匹配单班(早8晚5)模板 (置信度>0.6)' },
    '双班生产': { desc: '生产时间较长，覆盖白班和小夜班', criteria: '匹配双班(早8晚12)模板 (置信度>0.6)' },
    '间歇生产': { desc: '生产过程断断续续，负荷起停频繁', criteria: '匹配间歇模板' },
    '夜间生产': { desc: '主要负荷集中在夜间（可能为避峰生产）', criteria: '夜间负荷占比高' },
    '不规律生产': { desc: '无固定生产班次规律', criteria: '无法匹配已知模板且负荷率 < 60%' },

    // 2. Trend
    '产能扩张': { desc: '近期用电量呈现显著上升趋势', criteria: '趋势斜率 > 0.1%/日 (STL分解)' },
    '产能萎缩': { desc: '近期用电量呈现显著下降趋势', criteria: '趋势斜率 < -0.1%/日 (STL分解)' },
    '经营稳健': { desc: '用电量保持相对稳定，波动较小', criteria: '离散系数(CV) < 0.3 且 无显著趋势' },

    // 3. Cost
    '成本敏感型': { desc: '尖峰时段用电占比极低，主动避峰用电', criteria: '尖峰电量占比 < 20%' },
    '刚性用电型': { desc: '尖峰时段用电占比高，对电价不敏感', criteria: '尖峰电量占比 > 30%' },
    '移谷填峰': { desc: '具备显著的负荷转移行为，在低谷时段增加用电', criteria: '谷电量占比显著高于平段' },
    '避峰用电': { desc: '在高峰电价时段主动压降负荷', criteria: '高峰电量占比显著低于平段' },

    // 4. Seasonal
    '冬夏双峰型': { desc: '夏季和冬季均为用电高峰（典型空调用电特征）', criteria: '1月与7月负荷 > 春秋 * 1.3' },
    '冬季单峰型': { desc: '仅在冬季出现显著用电高峰', criteria: '1月负荷 > 春秋 * 1.3' },
    '夏季单峰型': { desc: '仅在夏季出现显著用电高峰', criteria: '7月负荷 > 春秋 * 1.3' },
    '气温敏感型': { desc: '负荷大小与气温变化高度相关', criteria: '负荷与|气温-20℃|相关系数 > 0.6' },
    '气温钝化型': { desc: '负荷受气温变化影响极小', criteria: '相关系数绝对值 < 0.2' },

    // 5. Stability
    '极度规律型': { desc: '每日负荷曲线极其相似，生产计划性极强', criteria: '近30天日电量 CV < 0.2' },
    '剧烈波动型': { desc: '负荷波动大，缺乏稳定性', criteria: 'CV > 0.5' },
    '间歇停产型': { desc: '出现非节假日的长时段停产行为', criteria: '近一年零电量天数占比 > 20%' },

    // 6. Behavior
    '机器规律型': { desc: '负荷曲线呈现典型的机械化特征', criteria: '日曲线余弦相似度 > 0.9' },
    '随机波动型': { desc: '负荷变化无章可循', criteria: '日曲线余弦相似度 < 0.7' },

    // 7. Facility
    '光伏自备': { desc: '识别出午间负荷凹陷特征', criteria: '午间负荷显著低于基线' },
    '储能套利': { desc: '识别出明显的“谷充峰放”特征', criteria: '夜间谷充电、高峰放电特征显著' },
    '分布式光伏': { desc: '明确识别为分布式光伏接入', criteria: '人工或档案识别' },
    '分布式储能': { desc: '明确识别为分布式储能接入', criteria: '人工或档案识别' },

    // Calendar
    '标准双休型': { desc: '周六、周日负荷显著低于工作日', criteria: '周末/工作日负荷比 < 0.6' },
    '周末单休型': { desc: '仅周日（或周六）负荷降低', criteria: '周日/工作日负荷比 < 0.6' },
    '周末生产型': { desc: '周末与工作日负荷无明显差异', criteria: '周末/工作日负荷比 > 0.8' },
    '春节深调型': { desc: '春节期间负荷大幅下降', criteria: '春节/平时负荷比 < 0.3' },
    '节后慢热型': { desc: '节后复工缓慢', criteria: '节后首周/平时负荷比 < 0.5' }
};

// --- Block 2-Middle: 标签管理面板 (Auto/Manual Tabs) ---
const TagManagementPanel: React.FC<{ data: CustomerCharacteristics; onRefresh: () => void; canEdit: boolean }> = ({ data, onRefresh, canEdit }) => {
    const [tab, setTab] = useState(0);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingTag, setEditingTag] = useState<CustomerCharacteristics['tags'][0] | null>(null);
    const [formData, setFormData] = useState({ name: '', reason: '' });
    const [saving, setSaving] = useState(false);

    const autoTags = useMemo(() => data.tags.filter(t => t.source !== 'MANUAL'), [data.tags]);
    const manualTags = useMemo(() => data.tags.filter(t => t.source === 'MANUAL'), [data.tags]);

    // Group auto tags
    const groupedAutoTags = useMemo(() => {
        const groups: Record<string, typeof data.tags> = {};
        autoTags.forEach(tag => {
            const cat = tag.category || '其它';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(tag);
        });
        return groups;
    }, [autoTags]);

    const handleAddClick = () => {
        setEditingTag(null);
        setFormData({ name: '', reason: '' });
        setDialogOpen(true);
    };

    const handleEditClick = (tag: typeof data.tags[0]) => {
        setEditingTag(tag);
        setFormData({ name: tag.name, reason: tag.reason || '' });
        setDialogOpen(true);
    };

    const handleClose = () => {
        setDialogOpen(false);
        setSaving(false);
    };

    const handleSave = async () => {
        if (!canEdit) return;
        if (!formData.name) return;
        setSaving(true);
        try {
            let newTags = [...data.tags];
            if (editingTag) {
                // Edit
                newTags = newTags.map(t =>
                    (t.name === editingTag.name && t.source === 'MANUAL')
                        ? { ...t, name: formData.name, reason: formData.reason }
                        : t
                );
            } else {
                // Add new
                if (newTags.some(t => t.name === formData.name)) return;
                newTags.push({
                    name: formData.name,
                    category: '人工',
                    source: 'MANUAL',
                    reason: formData.reason,
                    confidence: 1.0
                });
            }

            await customerApi.updateCustomer(data.customer_id, {
                tags: newTags.map(t => ({
                    name: t.name,
                    source: (t.source as 'AUTO' | 'MANUAL') || 'MANUAL',
                    reason: t.reason
                }))
            });

            onRefresh();
            handleClose();
        } catch (error) {
            console.error("Failed to save tag", error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (tagName: string) => {
        if (!canEdit) return;
        if (!window.confirm(`确定删除标签 "${tagName}" 吗 ? `)) return;
        try {
            const newTags = data.tags.filter(t => !(t.name === tagName && t.source === 'MANUAL'));
            await customerApi.updateCustomer(data.customer_id, {
                tags: newTags.map(t => ({
                    name: t.name,
                    source: (t.source as 'AUTO' | 'MANUAL') || 'MANUAL',
                    reason: t.reason
                }))
            });
            onRefresh();
        } catch (error) {
            console.error("Failed to delete tag", error);
        }
    };

    return (
        <Paper variant="outlined" sx={{ height: 500, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
            <Box px={2} pt={2} pb={0}>
                <PanelHeader
                    title="标签画像"
                    action={
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Tabs
                                value={tab}
                                onChange={(_, v) => setTab(v)}
                                sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0, fontSize: '0.8rem', px: 1 } }}
                            >
                                <Tab label={`自动识别(${autoTags.length})`} />
                                <Tab label={`人工标注(${manualTags.length})`} />
                            </Tabs>

                        </Stack>
                    }
                />
            </Box>
            <Divider />

            <Box flex={1} sx={{ overflowY: 'auto', minHeight: 0, position: 'relative' }}>
                <Box p={2} pb={4} sx={{ width: '100%' }}>
                    {tab === 0 ? (
                        // Auto Tags View
                        <>
                            {autoTags.length === 0 && (
                                <Box display="flex" justifyContent="center" alignItems="center" height="100%" color="text.secondary">
                                    <Typography variant="caption">暂无自动标签</Typography>
                                </Box>
                            )}
                            <Stack spacing={1.5}>
                                {autoTags.map((tag, idx) => {
                                    const meta = TAG_DESCRIPTIONS[tag.name] || {};
                                    const confidenceVal = tag.confidence ? Math.round(tag.confidence * 100) : 0;
                                    const confidenceColor = confidenceVal >= 80 ? 'success.main' : confidenceVal >= 60 ? 'warning.main' : 'text.secondary';

                                    return (
                                        <Paper key={idx} variant="outlined" sx={{ p: 1.5, bgcolor: 'background.default' }}>
                                            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                                                <Box flex={1} sx={{ mr: 1 }}>
                                                    <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap">
                                                        <Typography variant="body2" fontWeight="bold" color="primary.main">{tag.name}</Typography>
                                                        {tag.category && (
                                                            <Chip
                                                                label={tag.category}
                                                                size="small"
                                                                variant="outlined"
                                                                sx={{ height: 20, fontSize: '0.65rem', color: 'text.secondary', borderColor: 'divider' }}
                                                            />
                                                        )}
                                                    </Box>
                                                    {meta.desc && (
                                                        <Stack spacing={0.5} mt={1}>
                                                            <Typography variant="caption" color="text.secondary" display="block">
                                                                <Box component="span" fontWeight="bold">特征: </Box>{meta.desc}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary" display="block">
                                                                <Box component="span" fontWeight="bold">规则: </Box>{meta.criteria}
                                                            </Typography>
                                                        </Stack>
                                                    )}
                                                </Box>

                                                {/* Right: Confidence */}
                                                {tag.confidence !== undefined && (
                                                    <Box textAlign="right" sx={{ minWidth: 40 }}>
                                                        <Typography
                                                            variant="h6"
                                                            sx={{ fontSize: '1.1rem', fontWeight: 'bold', color: confidenceColor, lineHeight: 1 }}
                                                        >
                                                            {confidenceVal}%
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block', mt: 0.5 }}>
                                                            置信度
                                                        </Typography>
                                                    </Box>
                                                )}
                                            </Box>
                                        </Paper>
                                    );
                                })}
                            </Stack>
                        </>
                    ) : (
                        // Manual Tags View
                        <Stack spacing={1}>
                            {manualTags.length === 0 && (
                                <Box display="flex" justifyContent="center" alignItems="center" height={100} color="text.secondary">
                                    <Typography variant="caption">暂无人工标签，点击上方按钮添加</Typography>
                                </Box>
                            )}
                            {manualTags.map((tag, idx) => (
                                <Paper key={idx} variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper', borderLeft: 3, borderLeftColor: 'secondary.main' }}>
                                    <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                                        <Box flex={1}>
                                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                <Typography variant="body2" fontWeight="bold">{tag.name}</Typography>
                                                <Chip label="人工" color="secondary" size="small" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
                                            </Box>
                                            {tag.reason && (
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                                    说明: {tag.reason}
                                                </Typography>
                                            )}
                                        </Box>
                                        <Box display="flex" gap={0.5}>
                                            <IconButton size="small" onClick={() => handleEditClick(tag)} disabled={!canEdit}><EditIcon fontSize="small" sx={{ fontSize: 16 }} /></IconButton>
                                            <IconButton size="small" onClick={() => handleDelete(tag.name)} disabled={!canEdit}><DeleteIcon fontSize="small" sx={{ fontSize: 16 }} /></IconButton>
                                        </Box>
                                    </Box>
                                </Paper>
                            ))}
                            <Box display="flex" justifyContent="flex-end" mt={1}>
                                <Fab
                                    color="primary"
                                    size="small"
                                    onClick={handleAddClick}
                                    disabled={!canEdit}
                                    sx={{ boxShadow: 1, width: 26, height: 26, minHeight: 26 }}
                                >
                                    <AddIcon sx={{ fontSize: 16 }} />
                                </Fab>
                            </Box>
                        </Stack>
                    )}
                </Box>
            </Box>

            {/* Edit Dialog */}
            <Dialog open={dialogOpen} onClose={handleClose} fullWidth maxWidth="xs">
                <DialogTitle>{editingTag ? '编辑标签' : '添加标签'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="标签名称"
                            fullWidth
                            size="small"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            disabled={!canEdit}
                        />
                        <TextField
                            label="说明 / 备注"
                            fullWidth
                            multiline
                            rows={3}
                            size="small"
                            value={formData.reason}
                            onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                            disabled={!canEdit}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose}>取消</Button>
                    <Button onClick={handleSave} variant="contained" disabled={saving || !formData.name || !canEdit}>保存</Button>
                </DialogActions>
            </Dialog>
        </Paper >
    );
};

// --- 风险管控相关描述字典 ---
const ALERT_KNOWLEDGE_BASE: Record<string, { method: string; baseSuggestion: string }> = {
    'shape_drift': {
        method: '基于动态时间规整(DTW)算法，计算当日负荷曲线与历史基准曲线（近30天典型日）的形态相似度。',
        baseSuggestion: '建议核查企业生产排班是否调整，或是否有新设备接入/旧设备停用。'
    },
    'scale_drift': {
        method: '基于统计过程控制(SPC)理论，监测日用电量是否偏离历史正常波动范围（均值±2倍标准差）。',
        baseSuggestion: '建议确认企业是否有停产检修、突发订单增加或产能大幅调整情况。'
    },
    'peak_shift': {
        method: '分析日最大负荷出现时间点，监测峰值时刻是否发生显著偏移（>2小时）。',
        baseSuggestion: '建议调研企业是否实施了错峰用电策略，或生产工艺流程发生了改变。'
    },
    'stability_decay': {
        method: '计算负荷波动率（变异系数CV），监测用电稳定性是否显著下降（波动率增幅>30%）。',
        baseSuggestion: '建议关注企业生产连续性，排查是否存在设备频繁启停或故障隐患。'
    },
    'default': {
        method: '基于多维统计特征进行的异常检测规则。',
        baseSuggestion: '请结合企业近期经营状况与用电行为进行人工研判。'
    }
};

const getAlertSuggestion = (type: string, confidence: number) => {
    const kb = ALERT_KNOWLEDGE_BASE[type] || ALERT_KNOWLEDGE_BASE['default'];
    let prefix = "";
    if (confidence >= 0.9) prefix = "【高置信度】特征极其典型，";
    else if (confidence >= 0.7) prefix = "【中置信度】特征较明显，";
    else prefix = "【低置信度】信号稍弱，建议观察，";

    return prefix + kb.baseSuggestion;
};

// --- Block 2-Right: 风险管控面板 (Condensed) ---
const RiskControlPanel: React.FC<{ customerId: string; canEdit: boolean }> = ({ customerId, canEdit }) => {
    const [tab, setTab] = useState(0);
    const [alerts, setAlerts] = useState<AnomalyAlertItem[]>([]);
    const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        loadCharacteristicsApi.getCustomerAlerts(customerId)
            .then(res => setAlerts(res.data.items))
            .finally(() => setLoading(false));
    }, [customerId]);

    const handleStatusChange = async (alertId: string, currentStatus: boolean, currentNotes: string | undefined) => {
        if (!canEdit) return;
        const newStatus = !currentStatus;
        try {
            // Optimistic Update
            setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: newStatus } : a));
            await loadCharacteristicsApi.acknowledgeAlert(alertId, { acknowledged: newStatus, notes: currentNotes });
        } catch (error) {
            console.error("Failed to update alert status", error);
            // Revert on error
            setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: currentStatus } : a));
        }
    };

    const handleNoteSave = async (alertId: string, status: boolean, newNotes: string) => {
        if (!canEdit) return;
        try {
            // Optimistic Update
            setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, notes: newNotes } : a));
            await loadCharacteristicsApi.acknowledgeAlert(alertId, { acknowledged: status, notes: newNotes });
        } catch (error) {
            console.error("Failed to save note", error);
        }
    };

    const getSeverityLabel = (severity: string) => {
        switch (severity) {
            case 'high': return { label: '高风险', color: 'error.main', bg: 'error.light' };
            case 'medium': return { label: '中风险', color: 'warning.main', bg: 'warning.light' };
            default: return { label: '低风险', color: 'info.main', bg: 'info.light' };
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 0, height: 500, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
            <Box p={2} pb={0}>
                <PanelHeader
                    title="风险管控"
                />
            </Box>
            <Divider sx={{ mt: 2 }} />

            <Box flex={1} overflow="auto" p={0} bgcolor="grey.50">
                {loading ? <Box p={4} display="flex" justifyContent="center"><CircularProgress size={24} /></Box> : (
                    tab === 0 ? (
                        <Box sx={{ p: 1 }}>
                            {alerts.length === 0 && (
                                <Box display="flex" justifyContent="center" alignItems="center" height={200} color="text.secondary">
                                    <Typography variant="caption">暂无异动告警</Typography>
                                </Box>
                            )}
                            {alerts.map((alert, index) => {
                                const kb = ALERT_KNOWLEDGE_BASE[alert.alert_type] || ALERT_KNOWLEDGE_BASE['default'];
                                const severityStyle = getSeverityLabel(alert.severity);
                                const suggestion = getAlertSuggestion(alert.alert_type, alert.confidence);

                                return (
                                    <Accordion
                                        key={alert.id}
                                        defaultExpanded={index === 0}
                                        variant="outlined"
                                        sx={{
                                            mb: 1,
                                            '&:before': { display: 'none' },
                                            borderLeft: 4,
                                            borderLeftColor: severityStyle.color,
                                            borderRadius: '4px !important',
                                            overflow: 'hidden'
                                        }}
                                    >
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                            <Box display="flex" flexDirection="column">
                                                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                    <Typography variant="subtitle2" fontWeight="bold">{alert.alert_type}</Typography>
                                                    <Chip
                                                        label={severityStyle.label}
                                                        size="small"
                                                        sx={{ height: 18, fontSize: '0.65rem', bgcolor: severityStyle.bg, color: '#fff' }}
                                                    />
                                                    <MuiTooltip title="置信度: 反映算法对异常判断的确定程度">
                                                        <Chip
                                                            icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: alert.confidence > 0.8 ? 'success.main' : 'warning.main', ml: 0.5 }} />}
                                                            label={`${Math.round(alert.confidence * 100)}% 置信度`}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ height: 16, fontSize: '0.65rem', border: '1px solid #e0e0e0', ml: 0.5 }}
                                                        />
                                                    </MuiTooltip>
                                                </Box>
                                                <Box display="flex" gap={1} alignItems="center">
                                                    <Typography variant="caption" color="text.secondary">{alert.alert_date}</Typography>
                                                    {alert.rule_id && <Chip label={alert.rule_id} size="small" sx={{ height: 14, fontSize: '0.6rem', bgcolor: 'grey.100' }} />}
                                                </Box>
                                            </Box>
                                        </AccordionSummary>
                                        <AccordionDetails sx={{ pt: 0, px: 2, pb: 2 }}>
                                            <Stack spacing={1.5}>

                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block">🔎 异动原因：</Typography>
                                                    <Typography variant="body2" color="text.primary">
                                                        {alert.reason || "未提供详细原因"}
                                                    </Typography>
                                                </Box>

                                                <Box>
                                                    <Typography variant="caption" color="text.secondary" fontWeight="bold" display="block">📐 判定依据：</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {kb.method}
                                                    </Typography>
                                                </Box>

                                                <Box p={1} bgcolor="action.hover" borderRadius={1} border="1px dashed" borderColor="divider">
                                                    <Typography variant="caption" color="primary.main" fontWeight="bold" display="block" mb={0.5}>💡 智能建议：</Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                                                        {suggestion}
                                                    </Typography>
                                                </Box>

                                                <Divider />

                                                <Box display="flex" alignItems="center" gap={2}>
                                                    <FormControlLabel
                                                        control={
                                                            <Checkbox
                                                                size="small"
                                                                checked={alert.acknowledged}
                                                                onChange={() => handleStatusChange(alert.id, alert.acknowledged, alert.notes)}
                                                                disabled={!canEdit}
                                                                color="success"
                                                            />
                                                        }
                                                        label={<Typography variant="caption" color={alert.acknowledged ? 'success.main' : 'text.primary'}>已处理</Typography>}
                                                        sx={{ mr: 0 }}
                                                    />
                                                    <TextField
                                                        fullWidth
                                                        size="small"
                                                        variant="standard"
                                                        placeholder="填写处理意见"
                                                        defaultValue={alert.notes}
                                                        onBlur={(e) => {
                                                            if (e.target.value !== alert.notes) {
                                                                handleNoteSave(alert.id, alert.acknowledged, e.target.value);
                                                            }
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                (e.target as HTMLElement).blur();
                                                            }
                                                        }}
                                                        disabled={!canEdit}
                                                        InputProps={{ sx: { fontSize: '0.8rem' } }}
                                                    />
                                                </Box>
                                            </Stack>
                                        </AccordionDetails>
                                    </Accordion>
                                );
                            })}
                        </Box>
                    ) : null
                )}
            </Box>
        </Paper>
    );
};

// --- Block 4: 深度特征分析 ---
const DeepAnalysisPanel: React.FC<{ data: CustomerCharacteristics }> = ({ data }) => {
    const [activeTab, setActiveTab] = useState(0);
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [touSummary, setTouSummary] = useState<TouSummary | null>(null);
    const [currentSlope, setCurrentSlope] = useState<number | null>(null);

    // Fetch TOU summary once
    useEffect(() => {
        getTouSummary('latest').then(res => setTouSummary(res)).catch(e => console.error("Failed to load TOU rules", e));
    }, []);

    useEffect(() => {
        setLoading(true);
        if (activeTab === 0) {
            // Long Term
            const end = new Date();
            const start = new Date();
            start.setFullYear(end.getFullYear() - 1);
            loadCharacteristicsApi.getDailyTrend(data.customer_id, start.toISOString().split('T')[0], end.toISOString().split('T')[0])
                .then(res => {
                    const rawData = res.data;
                    if (!rawData || rawData.length === 0) {
                        setChartData([]);
                        return;
                    }
                    // Calculate Trend Line
                    const n = rawData.length;
                    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
                    for (let i = 0; i < n; i++) {
                        sumX += i;
                        sumY += (rawData[i].total || 0);
                        sumXY += i * (rawData[i].total || 0);
                        sumXX += i * i;
                    }
                    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
                    const intercept = (sumY - slope * sumX) / n;
                    setCurrentSlope(slope);
                    const withTrend = rawData.map((item: any, i: number) => ({
                        ...item,
                        trend: slope * i + intercept
                    }));
                    setChartData(withTrend);
                })
                .catch(console.error)
                .finally(() => setLoading(false));
        } else if (activeTab === 1) {
            // Short Term
            setCurrentSlope(null);
            if (data.short_term) {
                const metrics = data.short_term;
                const currentMonth = new Date().getMonth() + 1;
                const rule = touSummary?.months[currentMonth.toString()];

                const formatted = metrics.avg_curve.map((val: number, idx: number) => {
                    const ruleIdx = Math.min(idx * 2, 95); // Safely map 48 points to 96 points (2 per point)
                    const hour = Math.floor((idx + 1) / 2);
                    const minute = (idx + 1) % 2 === 0 ? '00' : '30';
                    const timeStr = hour === 24 ? "24:00" : `${hour.toString().padStart(2, "0")}:${minute}`;

                    return {
                        time: timeStr,
                        avg: val,
                        upper: val + (metrics.std_curve ? metrics.std_curve[idx] : 0),
                        lower: Math.max(0, val - (metrics.std_curve ? metrics.std_curve[idx] : 0)),
                        period_type: (rule && rule[ruleIdx]) || '平段'
                    };
                });
                setChartData(formatted);
            } else {
                setChartData([]);
            }
            setLoading(false);
        } else {
            // History Tab
            setLoading(false);
        }
    }, [activeTab, data, touSummary]);

    const chartRef = useRef(null);
    // Use TOU background hook for short term
    const { TouPeriodAreas } = useTouPeriodBackground(
        activeTab === 1 ? (chartData as TouPeriodData[]) : null,
        '24:00'
    );

    const { FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, isFullscreen } = useChartFullscreen({
        chartRef,
        title: activeTab === 0 ? "长周期负荷趋势" : "短周期典型曲线"
    });

    // Custom Tooltip for precise values
    const CustomChartTooltip: React.FC<any> = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <Paper sx={{ p: 1.5, boxShadow: 3, border: '1px solid #eee', borderRadius: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>{label}</Typography>
                    {payload.map((entry: any, index: number) => (
                        <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
                            <Typography variant="caption" sx={{ color: entry.color, fontWeight: 500 }}>
                                {entry.name}:
                            </Typography>
                            <Typography variant="caption" fontWeight="bold">
                                {typeof entry.value === 'number' ? entry.value.toFixed(4) : entry.value}
                            </Typography>
                        </Box>
                    ))}
                    {activeTab === 0 && currentSlope !== null && (
                        <Box sx={{ mt: 1, pt: 0.5, borderTop: '1px dashed #ddd' }}>
                            <Typography variant="caption" color="text.secondary">
                                趋势斜率: <strong>{currentSlope.toFixed(4)}</strong>
                            </Typography>
                        </Box>
                    )}
                    {activeTab === 1 && payload[0]?.payload?.period_type && (
                        <Box sx={{ mt: 1, pt: 0.5, borderTop: '1px dashed #ddd' }}>
                            <Typography variant="caption" color="text.secondary">
                                时段类型: <strong>{payload[0].payload.period_type}</strong>
                            </Typography>
                        </Box>
                    )}
                </Paper>
            );
        }
        return null;
    };

    // Metric Item Component (Styled Card)
    const MetricItem = ({ label, value }: { label: string, value: React.ReactNode }) => (
        <Paper elevation={0} sx={{ p: 1.5, bgcolor: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 2, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>{label}</Typography>
            <Typography variant="body1" fontWeight="bold" color="text.primary">{value}</Typography>
        </Paper>
    );

    const lMetrics = data.long_term;
    const sMetrics = data.short_term;

    return (
        <Paper variant="outlined" sx={{ p: 0, display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
            <Box px={2} pt={2}>
                <PanelHeader
                    title="特征分析"
                    action={
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Tabs
                                value={activeTab}
                                onChange={(e, v) => setActiveTab(v)}
                                sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontSize: '0.9rem' } }}
                            >
                                <Tab label="长周期" />
                                <Tab label="短周期" />
                                <Tab label="特征历史" />
                            </Tabs>
                        </Stack>
                    }
                />
            </Box>
            <Divider />

            <Box p={2}>
                <Grid container spacing={2} sx={{ height: 420, overflow: 'hidden' }}>
                    {activeTab === 2 ? (
                        <Grid size={{ xs: 12 }} sx={{ height: '100%' }}>
                            {loading ? <Box display="flex" justifyContent="center" height="100%" alignItems="center"><CircularProgress /></Box> : (
                                <CharacteristicHistoryCalendar customerId={data.customer_id} />
                            )}
                        </Grid>
                    ) : (
                        <>
                            {/* Chart Section (Left) */}
                            <Grid size={{ xs: 12, md: 8 }} sx={{ height: '100%' }}>
                                <Box
                                    ref={chartRef}
                                    sx={{
                                        height: '100%',
                                        position: 'relative',
                                        bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                                        p: isFullscreen ? 2 : 0,
                                        ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                                        '& .recharts-wrapper:focus': {
                                            outline: 'none'
                                        }
                                    }}
                                >
                                    <FullscreenEnterButton />
                                    <FullscreenExitButton />
                                    <FullscreenTitle />
                                    {loading ? <Box display="flex" justifyContent="center" height="100%" alignItems="center"><CircularProgress /></Box> : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            {activeTab === 0 ? (
                                                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#2e7d32" stopOpacity={0.15} />
                                                            <stop offset="95%" stopColor="#2e7d32" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                    <XAxis dataKey="date" tickFormatter={v => v?.slice(5)} interval={30} tick={{ fontSize: 11, fill: '#666' }} axisLine={{ stroke: '#e0e0e0' }} />
                                                    <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip content={<CustomChartTooltip />} />
                                                    <Area type="monotone" dataKey="total" stroke="#2e7d32" fill="url(#colorTrend)" strokeWidth={2} name="日电量" />
                                                    <Line type="monotone" dataKey="trend" stroke="#d32f2f" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="趋势线" />
                                                    <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: '12px' }} />
                                                </ComposedChart>
                                            ) : (
                                                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#1976d2" stopOpacity={0.15} />
                                                            <stop offset="95%" stopColor="#1976d2" stopOpacity={0.01} />
                                                        </linearGradient>
                                                    </defs>
                                                    {TouPeriodAreas}
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                    <XAxis
                                                        dataKey="time"
                                                        interval={11}
                                                        tick={{ fontSize: 11, fill: '#666' }}
                                                        axisLine={{ stroke: '#e0e0e0' }}
                                                        tickFormatter={(value, index) => {
                                                            const totalPoints = chartData.length;
                                                            if (index === 0) return '00:30';
                                                            if (index === totalPoints - 1) return '24:00';
                                                            return value;
                                                        }}
                                                    />
                                                    <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip content={<CustomChartTooltip />} />
                                                    <Area type="monotone" dataKey="avg" stroke="#1976d2" fill="url(#colorAvg)" name="平均负荷" strokeWidth={2} />
                                                    <Line type="monotone" dataKey="upper" stroke="#ff9800" dot={false} strokeDasharray="3 3" strokeWidth={1} name="波动上限" />
                                                    <Line type="monotone" dataKey="lower" stroke="#ff9800" dot={false} strokeDasharray="3 3" strokeWidth={1} name="波动下限" />
                                                    <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: '12px' }} />
                                                </ComposedChart>
                                            )}
                                        </ResponsiveContainer>
                                    )}
                                </Box>
                            </Grid>

                            {/* Metrics Section (Right) */}
                            <Grid size={{ xs: 12, md: 4 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderLeft: { md: '1px solid' }, borderColor: 'divider', pl: { md: 2 } }}>
                                <Typography variant="subtitle2" gutterBottom color="text.secondary" sx={{ fontWeight: 'bold' }}>关键指标统计</Typography>
                                <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1, '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#eee', borderRadius: 2 } }}>
                                    <Grid container spacing={1.5}>
                                        {activeTab === 0 && lMetrics && [
                                            { l: '日均电量', v: `${lMetrics.avg_daily_load} kWh` },
                                            { l: '年累计电量', v: `${(lMetrics.total_annual_load / 10000).toFixed(2)} 万kWh` },
                                            { l: '趋势斜率', v: lMetrics.trend_slope.toFixed(4) },
                                            { l: '近3月增长', v: lMetrics.recent_3m_growth ? `${(lMetrics.recent_3m_growth * 100).toFixed(1)}% ` : '-' },
                                            { l: '离散系数(CV)', v: lMetrics.cv },
                                            { l: '零电量天数', v: lMetrics.zero_days },
                                            { l: '气温相关性', v: lMetrics.temp_correlation ?? '-' },
                                            { l: '周末效应', v: lMetrics.weekend_ratio ?? '-' }
                                        ].map((item, i) => (
                                            <Grid size={{ xs: 6 }} key={i}>
                                                <MetricItem label={item.l} value={item.v} />
                                            </Grid>
                                        ))}

                                        {activeTab === 1 && sMetrics && [
                                            { l: '平均负荷率', v: `${(sMetrics.avg_load_rate * 100).toFixed(1)}% ` },
                                            { l: '峰谷比', v: sMetrics.min_max_ratio.toFixed(2) },
                                            { l: '曲线相似度', v: sMetrics.curve_similarity ? (sMetrics.curve_similarity * 100).toFixed(1) : '-' },
                                            { l: '峰值时刻', v: sMetrics.peak_hour ? `${Math.floor(sMetrics.peak_hour / 2)}:${sMetrics.peak_hour % 2 === 0 ? '00' : '30'} ` : '-' },
                                            { l: '谷值时刻', v: sMetrics.valley_hour ? `${Math.floor(sMetrics.valley_hour / 2)}:${sMetrics.valley_hour % 2 === 0 ? '00' : '30'} ` : '-' },
                                            { l: '尖峰占比', v: sMetrics.tip_ratio ? `${(sMetrics.tip_ratio * 100).toFixed(1)}% ` : '-' },
                                            { l: '低谷占比', v: sMetrics.valley_ratio ? `${(sMetrics.valley_ratio * 100).toFixed(1)}% ` : '-' },
                                            { l: '深谷占比', v: sMetrics.deep_ratio ? `${(sMetrics.deep_ratio * 100).toFixed(1)}% ` : '-' },
                                        ].map((item, i) => (
                                            <Grid size={{ xs: 6 }} key={i}>
                                                <MetricItem label={item.l} value={item.v} />
                                            </Grid>
                                        ))}
                                    </Grid>
                                </Box>
                            </Grid>
                        </>
                    )}
                </Grid>
            </Box>
        </Paper>
    );
};

// --- 辅助组件：月度摘要 ---
const MonthlySummaryWidget: React.FC<{ history: AnalysisHistoryItem[] }> = ({ history }) => {
    const totalDays = history.length;
    const changeDays = history.filter((item, idx) => {
        if (idx === 0) return false;
        const prev = history[idx - 1];
        const tagsA = item.tags.map(t => t.name).sort();
        const tagsB = prev.tags.map(t => t.name).sort();
        return JSON.stringify(tagsA) !== JSON.stringify(tagsB);
    }).length;

    return (
        <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" gutterBottom display="block">
                本月概览
            </Typography>
            <Grid container spacing={1}>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="h5" color="primary.main" fontWeight="bold">{totalDays}</Typography>
                    <Typography variant="caption" color="text.secondary">分析天数</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                    <Typography variant="h5" color="warning.main" fontWeight="bold">{changeDays}</Typography>
                    <Typography variant="caption" color="text.secondary">特征变动</Typography>
                </Grid>
            </Grid>
        </Paper>
    );
};

// --- Block 5: 特征历史日历视图 ---
const CharacteristicHistoryCalendar: React.FC<{ customerId: string }> = ({ customerId }) => {
    const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
    const [selectedItem, setSelectedItem] = useState<AnalysisHistoryItem | null>(null);
    const [subTab, setSubTab] = useState(0); // 0: 指标, 1: 曲线, 2: 溯源

    // 获取当月数据
    useEffect(() => {
        setLoading(true);
        const monthStr = format(currentMonth, 'yyyy-MM');
        loadCharacteristicsApi.getCustomerHistory(customerId, 100, monthStr)
            .then(res => {
                const sorted = [...res.data.items].sort((a, b) => a.date.localeCompare(b.date));
                setHistory(sorted);
                // 默认选中最后一条记录
                if (sorted.length > 0) {
                    setSelectedItem(sorted[sorted.length - 1]);
                } else {
                    setSelectedItem(null);
                }
            })
            .finally(() => setLoading(false));
    }, [customerId, currentMonth]);

    // 自定义日历天渲染
    const ServerSideDay = (props: PickersDayProps & { history?: AnalysisHistoryItem[] }) => {
        const { day, history = [], ...other } = props;
        const dateStr = format(day, 'yyyy-MM-dd');
        const item = history.find(h => h.date === dateStr);

        const isSelected = selectedItem?.date === dateStr;
        const hasData = !!item;

        // 判断是否有标签变动
        const hasChange = useMemo(() => {
            if (!item) return false;
            const idx = history.findIndex(h => h.date === item.date);
            if (idx <= 0) return false;
            const prev = history[idx - 1];
            const tagsA = item.tags.map(t => t.name).sort();
            const tagsB = prev.tags.map(t => t.name).sort();
            return JSON.stringify(tagsA) !== JSON.stringify(tagsB);
        }, [item, history]);

        return (
            <Badge
                key={day.toString()}
                overlap="circular"
                badgeContent={hasChange ? '!' : undefined}
                color="warning"
                sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 14, minWidth: 14, right: 3, top: 3 } }}
            >
                <PickersDay
                    {...other}
                    day={day}
                    disabled={!hasData}
                    sx={{
                        width: 38,
                        height: 38,
                        fontSize: '0.875rem',
                        ...(hasData && {
                            bgcolor: isSelected ? 'primary.main' : 'primary.50',
                            color: isSelected ? '#fff' : 'primary.main',
                            fontWeight: 'bold',
                            '&:hover': { bgcolor: isSelected ? 'primary.dark' : 'primary.100' }
                        }),
                        ...(hasChange && !isSelected && {
                            border: '1px solid',
                            borderColor: 'warning.main'
                        })
                    }}
                    onClick={() => item && setSelectedItem(item)}
                />
            </Badge>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Grid container spacing={1} sx={{ height: '100%', alignItems: 'stretch' }}>
                {/* Left: Detail View with Sub-Tabs (Main Content) */}
                <Grid size={{ xs: 12, md: 8 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {!selectedItem ? (
                        <Box sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2 }}>
                            <Typography color="text.secondary">请从右侧日历选择特定日期查看分析档案</Typography>
                        </Box>
                    ) : (
                        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', pr: { md: 1 } }}>
                            {/* Detail Header */}
                            <Box sx={{ mb: 1, px: 2 }}>
                                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                                    <Typography variant="subtitle1" fontWeight="bold" color="primary.main">
                                        档案快照: {selectedItem.date}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        生成时间: {new Date(selectedItem.execution_time).toLocaleString()}
                                    </Typography>
                                </Box>
                            </Box>

                            {/* Sub Tabs */}
                            <Tabs
                                value={subTab}
                                onChange={(_, v) => setSubTab(v)}
                                sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', mb: 1, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.85rem' } }}
                            >
                                <Tab label="关键指标" />
                                <Tab label="典型形态" />
                                <Tab label="特征溯源" />
                            </Tabs>

                            {/* Tab Panels */}
                            <Box sx={{ flexGrow: 1, overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#eee', borderRadius: 2 } }}>
                                {subTab === 0 && selectedItem.metrics && (
                                    <Box px={1}>
                                        <Grid container spacing={1}>
                                            {[
                                                { l: '规律得分', v: selectedItem.metrics.regularity_score },
                                                { l: '波动率(CV)', v: selectedItem.metrics.cv?.toFixed(3) },
                                                { l: '平均负荷率', v: selectedItem.metrics.avg_load_rate ? (selectedItem.metrics.avg_load_rate * 100).toFixed(1) + '%' : '-' },
                                                { l: '峰谷比', v: (selectedItem.metrics.min_max_ratio * 100).toFixed(1) + '%' },
                                                { l: '日均电量', v: selectedItem.metrics.avg_daily_load + ' kWh' },
                                                { l: '价格敏感性', v: selectedItem.metrics.price_sensitivity },
                                            ].map((m, i) => (
                                                <Grid key={i} size={{ xs: 6, sm: 4 }}>
                                                    <Box sx={{ p: 1, bgcolor: '#f8f9fa', borderRadius: 1.5, border: '1px solid #edf2f7', textAlign: 'center' }}>
                                                        <Typography variant="caption" color="text.secondary" display="block">{m.l}</Typography>
                                                        <Typography variant="body2" fontWeight="bold" color="primary.main">{m.v ?? '-'}</Typography>
                                                    </Box>
                                                </Grid>
                                            ))}
                                        </Grid>
                                    </Box>
                                )}

                                {subTab === 1 && selectedItem.baseline_curve && (
                                    <Box px={1} sx={{ height: '240px' }}>
                                        <Box sx={{ height: '100%', bgcolor: '#fcfcfc', p: 1, borderRadius: 2, border: '1px solid #f0f0f0' }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={selectedItem.baseline_curve.map((v, i) => ({ time: i, value: v }))}>
                                                    <defs>
                                                        <linearGradient id="colorBaseline" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#1976d2" stopOpacity={0.2} />
                                                            <stop offset="95%" stopColor="#1976d2" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                                    <XAxis dataKey="time" interval={23} tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.floor(v / 2)}:00`} />
                                                    <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                                    <RechartsTooltip />
                                                    <Area type="monotone" dataKey="value" stroke="#1976d2" fill="url(#colorBaseline)" strokeWidth={2} />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    </Box>
                                )}

                                {subTab === 2 && (
                                    <Box px={1}>
                                        <TableContainer sx={{ border: '1px solid #f0f0f0', borderRadius: 2 }}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow sx={{ bgcolor: '#f8f9fa' }}>
                                                        <TableCell sx={{ fontWeight: 'bold', py: 0.5, fontSize: '0.75rem' }}>标签</TableCell>
                                                        <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>置信度</TableCell>
                                                        <TableCell sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>触发原因</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {selectedItem.tags.map((tag, i) => (
                                                        <TableRow key={i}>
                                                            <TableCell sx={{ py: 0.5 }}>
                                                                <Chip label={tag.name} size="small" color="primary" variant="outlined" sx={{ fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                                                            </TableCell>
                                                            <TableCell sx={{ fontSize: '0.75rem' }}>{(tag.confidence || 0).toFixed(2)}</TableCell>
                                                            <TableCell sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                                                                {tag.reason || (tag.rule_id ? `匹配: ${tag.rule_id}` : '-')}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    )}
                </Grid>

                {/* Right: Calendar Navigation (Secondary) */}
                <Grid size={{ xs: 12, md: 4 }} sx={{ borderLeft: { md: '1px solid' }, borderColor: 'divider', pl: { md: 2 } }}>
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ pb: 1, mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">采样日历</Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box sx={{ width: 8, height: 8, bgcolor: 'primary.50', borderRadius: '50%', border: '1px solid', borderColor: 'primary.light' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '10px' }}>快照</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box sx={{ width: 8, height: 8, border: '1px solid', borderColor: 'warning.main', borderRadius: '50%', bgcolor: 'warning.50' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '10px' }}>变动</Typography>
                                </Box>
                            </Box>
                        </Box>
                        <Divider sx={{ mb: 1 }} />
                        {loading && history.length === 0 ? (
                            <Box display="flex" justifyContent="center" p={8}><CircularProgress size={32} /></Box>
                        ) : (
                            <DateCalendar
                                value={currentMonth}
                                onChange={(newValue) => newValue && setCurrentMonth(newValue)}
                                onMonthChange={(newMonth) => setCurrentMonth(newMonth)}
                                slots={{ day: ServerSideDay }}
                                slotProps={{ day: { history } as any }}
                                sx={{
                                    width: '100%',
                                    maxWidth: '100%',
                                    height: 'auto',
                                    maxHeight: 'none',
                                    '& .MuiPickersCalendarHeader-root': { px: 0, mb: 0, minHeight: 'unset' },
                                    '& .MuiPickersCalendarHeader-labelContainer': { fontSize: '0.85rem' },
                                    '& .MuiDayCalendar-header': { justifyContent: 'space-around', mb: 0 },
                                    '& .MuiDayCalendar-weekContainer': { justifyContent: 'space-around', mb: 0 },
                                    '& .MuiTypography-caption': { fontSize: '0.75rem', fontWeight: 'bold', width: 38 },
                                    '& .MuiPickersDay-root': { width: 38, height: 38 }
                                }}
                            />
                        )}
                    </Box>
                </Grid>
            </Grid>
        </LocalizationProvider>
    );
};

// --- Page Wrapper ---
const LoadCharacteristicsDetailPage: React.FC<{ customerId?: string }> = (props) => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:analysis_load_characteristics:edit');
    const params = useParams<{ customerId: string }>();
    const customerId = props.customerId || params.customerId;
    const navigate = useNavigate();
    const location = useLocation();

    const [data, setData] = useState<CustomerCharacteristics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = () => {
        if (!customerId) return;
        setLoading(true);
        loadCharacteristicsApi.getCustomerDetail(customerId)
            .then(res => setData(res.data))
            .catch(err => {
                console.error(err);
                setError("无法加载客户详情数据");
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchData();
    }, [customerId]);

    if (loading && !data) return <Box p={4} display="flex" justifyContent="center"><CircularProgress /></Box>;
    if (error) return <Alert severity="error">{error}</Alert>;
    if (!data) return <Alert severity="warning">未找到该客户数据</Alert>;

    return (
        <Box sx={{ p: { xs: 1, sm: 2 } }}>
            {/* Optional Back Button */}
            {!props.customerId && (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <IconButton
                        onClick={() => navigateBackWithFallback(navigate, location.pathname, location.search)}
                        size="small"
                        sx={{ bgcolor: 'background.paper', border: '1px solid #e0e0e0' }}
                    >
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="h6" color="text.primary">客户详情</Typography>
                </Stack>
            )}

            <Stack spacing={2}>
                {/* Row 1 */}
                <CustomerIdentityPanel data={data} onRefresh={fetchData} />

                {/* Row 2 */}
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <CharacteristicsRadarPanel data={data} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <TagManagementPanel data={data} onRefresh={fetchData} canEdit={canEdit} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <RiskControlPanel customerId={data.customer_id} canEdit={canEdit} />
                    </Grid>
                </Grid>

                {/* Row 3 */}
                <Grid container>
                    <Grid size={{ xs: 12 }}>
                        <DeepAnalysisPanel data={data} />
                    </Grid>
                </Grid>
            </Stack>
        </Box>
    );
};

export default LoadCharacteristicsDetailPage;

