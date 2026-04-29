import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Grid,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Divider,
    Button,
    useMediaQuery,
    Theme,
    useTheme
} from '@mui/material';
import { SvgIconProps } from '@mui/material/SvgIcon';
import apiClient from '../api/client';
import PriceCheckIcon from '@mui/icons-material/PriceCheck';
import ElectricMeterIcon from '@mui/icons-material/ElectricMeter';
import LanIcon from '@mui/icons-material/Lan';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { DataGrid, GridColDef, GridRenderCellParams, GridPaginationModel, GridRowSelectionModel } from '@mui/x-data-grid';
import { Snackbar } from '@mui/material';
import {
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { MobileDataCard } from '../components/MobileDataCard';
import { useSelectableSeries } from '../hooks/useSelectableSeries';
import { useAuth } from '../contexts/AuthContext';

// 对应后端 price_sgcc 集合的文档结构
interface SGCCPriceData {
    _id: string; // format: "YYYY-MM"
    attachment_name: string;
    avg_on_grid_price: number;
    historical_deviation_discount: number;
    network_loss_price: number;
    purchase_price: number;
    purchase_scale_kwh: number;
    system_op_cost_discount: number;
    full_data: {
        price_composition: (string | number)[][];
    };
}

// API响应的完整结构
interface PaginatedSgccResponse {
    total: number;
    pageData: SGCCPriceData[];
    chartData: SGCCPriceData[];
}

// Define a type for chart series keys
type SeriesKey = 'purchase_scale_kwh' | 'purchase_price' | 'avg_on_grid_price';

// 小卡片组件
const StatCard: React.FC<{ title: string; value: string; icon: React.ReactElement<SvgIconProps>; color?: string }> = ({ title, value, icon, color }) => (
    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', height: '100%' }} elevation={2}>
        {React.cloneElement(icon, { sx: { fontSize: 40, color: color || 'primary.main', mr: 2 } })}
        <Box>
            <Typography variant="h6" color="text.secondary">{title}</Typography>
            <Typography variant="h5" component="div" fontWeight="bold">{value}</Typography>
        </Box>
    </Paper>
);


const GridAgencyPricePage: React.FC = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:basic_sgcc_price:edit');
    // State for the grid
    const [gridData, setGridData] = useState<SGCCPriceData[]>([]);
    const [rowCount, setRowCount] = useState<number>(0);
    const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 10 });

    // State for other data
    const [chartData, setChartData] = useState<SGCCPriceData[]>([]);
    const [selectedData, setSelectedData] = useState<SGCCPriceData | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

    const { seriesVisibility, handleLegendClick } = useSelectableSeries<SeriesKey>({
        purchase_scale_kwh: true,
        purchase_price: true,
        avg_on_grid_price: true,
    });

    // General state
    const [loading, setLoading] = useState<boolean>(true);
    const [importLoading, setImportLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const chartRef = useRef<HTMLDivElement>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get<PaginatedSgccResponse>('/api/v1/prices/sgcc', {
                params: {
                    page: paginationModel.page + 1, // API is 1-based
                    pageSize: paginationModel.pageSize,
                },
            });

            const { total, pageData, chartData } = response.data;

            setGridData(pageData);
            setRowCount(total);

            // 图表数据只在第一页加载时刷新
            if (paginationModel.page === 0) {
                setChartData(chartData);
            }

            const nextSelectedData = selectedMonth
                ? pageData.find((item) => item._id === selectedMonth) || chartData.find((item) => item._id === selectedMonth) || selectedData
                : pageData[0] || chartData[0] || null;

            setSelectedData(nextSelectedData);
            setSelectedMonth(nextSelectedData?._id || null);

            setError(null);
        } catch (err) {
            setError('获取数据失败，请稍后重试。');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handlePreviousMonth = () => {
        console.log("Navigate to Previous Month");
    };

    const handleNextMonth = () => {
        console.log("Navigate to Next Month");
    };

    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons
    } = useChartFullscreen({
        chartRef: chartRef,
        title: '历史趋势图',
        onPrevious: handlePreviousMonth,
        onNext: handleNextMonth,
    });

    const theme = useTheme();
    const isMobile = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    const handleViewPdf = async (id: string | number) => {
        try {
            const response = await apiClient.get(`/api/v1/prices/sgcc/${id}/pdf`, {
                responseType: 'blob', // Important: expect a binary response
            });
            const file = new Blob([response.data], { type: 'application/pdf' });
            const fileURL = URL.createObjectURL(file);
            window.open(fileURL, '_blank');
            // Optional: Clean up the object URL after a short delay
            setTimeout(() => URL.revokeObjectURL(fileURL), 100);
        } catch (error) {
            console.error('Error fetching PDF:', error);
            setError('无法加载PDF文件，请检查网络或联系管理员。');
        }
    };

    const handleImportClick = () => {
        if (!canEdit) return;
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setImportError('只支持 PDF 格式的文件');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            setImportLoading(true);
            setImportError(null);
            setSuccessMessage(null);
            const response = await apiClient.post('/api/v1/prices/sgcc/import', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            if (response.data.status === 'success') {
                setSuccessMessage(response.data.message || '导入成功');
                fetchData(); // 重新加载数据
            } else {
                setImportError(response.data.message || '导入失败，请检查文件内容。');
            }
        } catch (err: any) {
            console.error('Error importing PDF:', err);
            setImportError(err.response?.data?.detail || '导入失败，请检查文件格式或重试。');
        } finally {
            setImportLoading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = ''; // 清除选择，允许重复上传同一文件
            }
        }
    };

    const handleSelectData = (data: SGCCPriceData) => {
        setSelectedData(data);
        setSelectedMonth(data._id);
    };

    const rowSelectionModel = useMemo<GridRowSelectionModel>(() => ({
        type: 'include',
        ids: new Set(selectedMonth ? [selectedMonth] : []),
    }), [selectedMonth]);

    const handleRowSelectionModelChange = (model: GridRowSelectionModel) => {
        const selectedId = Array.from(model.ids)[0];
        if (selectedId == null) return;

        const selectedRow = gridData.find((row) => row._id === String(selectedId))
            || chartData.find((row) => row._id === String(selectedId));

        if (selectedRow) {
            handleSelectData(selectedRow);
        }
    };

    // Define columns here to avoid re-creation on every render
    const columns: GridColDef[] = [
        { field: '_id', headerName: '月份', width: 120 },
        {
            field: 'purchase_scale_kwh',
            headerName: '代理购电规模 (万kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
        },
        {
            field: 'purchase_price',
            headerName: '代理购电价格 (元/kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toFixed(6) : '')
        },
        {
            field: 'avg_on_grid_price',
            headerName: '平均上网电价 (元/kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toFixed(6) : '')
        },
        {
            field: 'historical_deviation_discount',
            headerName: '历史偏差折价 (元/kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toFixed(6) : '')
        },
        {
            field: 'network_loss_price',
            headerName: '上网环节线损 (元/kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toFixed(6) : '')
        },
        {
            field: 'system_op_cost_discount',
            headerName: '系统运行费折价 (元/kWh)',
            width: 200,
            valueFormatter: (value: number) => (typeof value === 'number' ? value.toFixed(6) : '')
        },
        {
            field: 'actions',
            headerName: '操作',
            width: 150,
            renderCell: (params: GridRenderCellParams) => (
                <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleViewPdf(params.id)}
                >
                    查看公告
                </Button>
            ),
        },
    ];

    useEffect(() => {
        fetchData();
    }, [paginationModel]);

    const renderCards = (currentData: SGCCPriceData) => {
        const systemOpsBreakdown = currentData.full_data.price_composition.slice(8, 15);

        // 格式化日期：将 "YYYY-MM" 转换为 "YYYY年MM月"
        const formatMonth = (dateStr: string): string => {
            const [year, month] = dateStr.split('-');
            return `${year}年${month}月`;
        };

        return (
            <>
                <Grid container spacing={3}>
                    {/* Card 1: Main Price Breakdown */}
                    <Grid size={{ xs: 12, md: 6, lg: 4 }}>
                        <Paper sx={{ p: 3, height: '100%' }} elevation={2}>
                            {/* 第一行：数据月份（左对齐） */}
                            <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1.5 }}>
                                <Typography variant="h4" component="div" fontWeight="bold">
                                    {formatMonth(currentData._id)}
                                </Typography>
                            </Box>

                            <Divider sx={{ my: 1.5 }} />

                            {/* 第二行：左边标题，右边图标+价格 */}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6" component="div">代理购电价格</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <PriceCheckIcon sx={{ fontSize: 50, color: 'success.main', mr: 2 }} />
                                    <Typography variant="h4" component="div" fontWeight="bold">
                                        {currentData.purchase_price != null ? currentData.purchase_price.toFixed(6) : '-'}
                                    </Typography>
                                </Box>
                            </Box>

                            {/* 第三行：价格明细 */}
                            <Divider sx={{ my: 1.5 }} />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="body1">其中: 平均上网电价</Typography>
                                <Typography variant="body1" fontWeight="bold">{currentData.avg_on_grid_price != null ? currentData.avg_on_grid_price.toFixed(6) : '-'}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                                <Typography variant="body1">历史偏差折价</Typography>
                                <Typography variant="body1" fontWeight="bold">{currentData.historical_deviation_discount != null ? currentData.historical_deviation_discount.toFixed(6) : '-'}</Typography>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* Cards 2 & 3 Combined */}
                    <Grid size={{ xs: 12, md: 6, lg: 4 }}>
                        <Grid container spacing={2} sx={{ height: '100%', flexDirection: 'column' }}>
                            <Grid size={{ xs: 12 }} sx={{ flex: 1 }}>
                                <StatCard
                                    title="代理购电规模"
                                    value={currentData.purchase_scale_kwh != null ? `${currentData.purchase_scale_kwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万kWh` : '-'}
                                    icon={<ElectricMeterIcon />}
                                />
                            </Grid>
                            <Grid size={{ xs: 12 }} sx={{ flex: 1 }}>
                                <StatCard
                                    title="上网环节线損"
                                    value={currentData.network_loss_price != null ? `${currentData.network_loss_price.toFixed(6)} 元/kWh` : '-'}
                                    icon={<LanIcon />}
                                    color="warning.main"
                                />
                            </Grid>
                        </Grid>
                    </Grid>

                    {/* Card 4: System Ops Breakdown */}
                    <Grid size={{ xs: 12, md: 12, lg: 4 }}>
                        <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }} elevation={2}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant="h6">系统运行费及构成</Typography>
                                <Typography variant="h5" fontWeight="bold">{currentData.system_op_cost_discount != null ? currentData.system_op_cost_discount.toFixed(6) : '-'}</Typography>
                            </Box>
                            <Divider sx={{ my: 1 }} />
                            <Box sx={{ flexGrow: 1 }}>
                                {systemOpsBreakdown.map((item, index) => (
                                    <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', my: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary">{item[0]}</Typography>
                                        <Typography variant="body2" color="text.secondary" fontWeight="medium">{typeof item[1] === 'number' && item[1] != null ? item[1].toFixed(6) : (item[1] ?? '-')}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </>
        );
    }

    const renderChart = (allChartData: SGCCPriceData[]) => {
        return (
            <Paper sx={{ p: 2, mt: 3, height: 400 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">历史趋势图</Typography>
                    {!isMobile && (
                        <>
                            <input
                                type="file"
                                accept="application/pdf"
                                style={{ display: 'none' }}
                                ref={fileInputRef}
                                onChange={handleFileChange}
                            />
                            <Button
                                variant="outlined"
                                startIcon={importLoading ? <CircularProgress size={20} /> : <FileUploadIcon />}
                                onClick={handleImportClick}
                                disabled={importLoading || !canEdit}
                                size="small"
                            >
                                {importLoading ? '导入中...' : '导入公告'}
                            </Button>
                        </>
                    )}
                </Box>
                <Box ref={chartRef} sx={{ height: '90%', position: 'relative', backgroundColor: isFullscreen ? 'background.paper' : 'transparent', p: isFullscreen ? 2 : 0 }}>
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />
                    <NavigationButtons />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={allChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="_id" />
                            <YAxis yAxisId="left" label={{ value: '价格 (元/kWh)', angle: -90, position: 'insideLeft' }} domain={[dataMin => (dataMin * 0.95), dataMax => (dataMax * 1.05)]} tickFormatter={(value: number) => value.toFixed(2)} />
                            <YAxis yAxisId="right" orientation="right" label={{ value: '规模 (万kWh)', angle: -90, position: 'insideRight' }} tickFormatter={(value: number) => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <Tooltip formatter={(value: number, name: string) => {
                                if (name === '代理购电规模') {
                                    return `${value.toFixed(2)} 万kWh`;
                                }
                                return `${value.toFixed(6)} 元/kWh`;
                            }} />
                            <Legend onClick={handleLegendClick} />
                            <Bar yAxisId="right" dataKey="purchase_scale_kwh" name="代理购电规模" fill="#8884d8" hide={!seriesVisibility.purchase_scale_kwh} />
                            <Line yAxisId="left" type="monotone" dataKey="purchase_price" name="代理购电价格" stroke="#82ca9d" strokeWidth={2} hide={!seriesVisibility.purchase_price} />
                            <Line yAxisId="left" type="monotone" dataKey="avg_on_grid_price" name="平均上网电价" stroke="#ffc658" hide={!seriesVisibility.avg_on_grid_price} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>
        );
    }

    const renderTable = () => {
        return (
            <Paper sx={{ p: 2, mt: 3, width: '100%' }}>
                <Typography variant="h6" gutterBottom>历史数据详情</Typography>
                {isMobile ? (
                    <Box sx={{ mt: 2 }}>
                        {gridData.map((row) => (
                            <Box
                                key={row._id}
                                onClick={() => handleSelectData(row)}
                                sx={{
                                    cursor: 'pointer',
                                    mb: 2,
                                    border: 2,
                                    borderColor: selectedMonth === row._id ? 'primary.main' : 'transparent',
                                    borderRadius: 1,
                                    '& > .MuiPaper-root': { mb: 0 },
                                }}
                            >
                                <MobileDataCard
                                    data={row}
                                    onViewPdf={() => handleViewPdf(row._id)}
                                />
                            </Box>
                        ))}
                    </Box>
                ) : (
                    <DataGrid
                        rows={gridData}
                        columns={columns}
                        getRowId={(row: SGCCPriceData) => row._id}
                        paginationMode="server"
                        rowCount={rowCount}
                        loading={loading}
                        paginationModel={paginationModel}
                        onPaginationModelChange={setPaginationModel}
                        rowSelectionModel={rowSelectionModel}
                        onRowSelectionModelChange={handleRowSelectionModelChange}
                        disableMultipleRowSelection
                        keepNonExistentRowsSelected
                        pageSizeOptions={[10, 20, 50]}
                        autoHeight
                    />
                )}
            </Paper>
        );
    }

    const renderContent = () => {
        if (error) {
            return <Alert severity="error">{error}</Alert>;
        }

        // Show main loader only on initial load
        if (loading && paginationModel.page === 0) {
            return <CircularProgress />;
        }

        if (!selectedData) {
            return <Alert severity="info">暂无数据。</Alert>;
        }

        return (
            <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                    {renderCards(selectedData)}
                </Grid>

                <Grid size={{ xs: 12 }}>
                    {chartData.length > 0 && renderChart(chartData)}
                </Grid>

                <Grid size={{ xs: 12 }}>
                    {renderTable()}
                </Grid>
            </Grid>
        );
    };

    return (
        <Box sx={{ width: '100%' }}>
            {/* 移动端面包屑标题 */}
            {isTablet && (
                <Typography
                    variant="subtitle1"
                    sx={{
                        mb: 2,
                        fontWeight: 'bold',
                        color: 'text.primary'
                    }}
                >
                    基础数据 / 国网代理购电
                </Typography>
            )}

            {renderContent()}

            <Snackbar
                open={!!successMessage}
                autoHideDuration={3000}
                onClose={() => setSuccessMessage(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={() => setSuccessMessage(null)} severity="success" sx={{ width: '100%' }}>
                    {successMessage}
                </Alert>
            </Snackbar>

            <Snackbar
                open={!!importError}
                autoHideDuration={3000}
                onClose={() => setImportError(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={() => setImportError(null)} severity="error" sx={{ width: '100%' }}>
                    {importError}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default GridAgencyPricePage;
