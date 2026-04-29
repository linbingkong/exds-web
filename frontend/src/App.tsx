
import React from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
} from 'react-router-dom';
import { CustomerLoadOverviewPage } from './pages/CustomerLoadOverviewPage';
import LoadCharacteristicsOverviewPage from './pages/LoadCharacteristicsOverviewPage';
import LoadCharacteristicsDetailPage from './pages/LoadCharacteristicsDetailPage';
import {
    CssBaseline,
    useMediaQuery,
} from '@mui/material';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import theme from './theme';
import { LoadAnalysisPage } from './pages/LoadAnalysisPage';
import { SpotIntradayAnalysisPage } from './pages/SpotIntradayAnalysisPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import SecuritySetupPage from './pages/SecuritySetupPage';
import ProtectedRoute from './components/ProtectedRoute';
import PlaceholderPage from './components/PlaceholderPage';
import DashboardPage from './pages/DashboardPage';
import GridAgencyPricePage from './pages/GridAgencyPricePage';
import TouRulesPage from './pages/TouRulesPage';
import RetailPackagePage from './pages/RetailPackagePage';
import RetailContractPage from './pages/RetailContractPage';
import { CustomerManagementPage } from './pages/CustomerManagementPage';
import { ForecastBaseDataPage } from './pages/ForecastBaseDataPage';
import { SpotTrendAnalysisPage } from './pages/SpotTrendAnalysisPage';
import { ContractPriceDailyPage } from './pages/ContractPriceDailyPage';
import { ContractPriceTrendPage } from './pages/ContractPriceTrendPage';
import { RpaMonitorPage } from './pages/RpaMonitorPage';
import { SystemLogsPage } from './pages/SystemLogsPage';
import { DayAheadPriceForecastPage } from './pages/DayAheadPriceForecastPage';
import { WeatherDataPage } from './pages/WeatherDataPage';
import { LoadDataDiagnosisPage } from './pages/LoadDataDiagnosisPage';
import { LoadForecastWorkbench } from './pages/LoadForecastWorkbench';
import PreSettlementOverviewPage from './pages/PreSettlementOverviewPage';
import PreSettlementDetailPage from './pages/PreSettlementDetailPage';
import SingleCustomerSettlementDetailPage from './pages/SingleCustomerSettlementDetailPage';
import MonthlyManualDataPage from './pages/MonthlyManualDataPage';
import MonthlySettlementAnalysisPage from './pages/MonthlySettlementAnalysisPage';
import SingleCustomerMonthlyDetailPage from './pages/SingleCustomerMonthlyDetailPage';
import { MonthlySettlementOverviewPage } from './pages/MonthlySettlementOverviewPage';
import TradeReviewPage from './pages/TradeReviewPage';
import DayAheadTradeReviewPage from './pages/DayAheadTradeReviewPage';
import { IntentCustomerDiagnosisPage } from './pages/IntentCustomerDiagnosisPage';
import UserPermissionsPage from './pages/UserPermissionsPage';
import MonthlyTradeReviewPage from './pages/MonthlyTradeReviewPage';
import CustomerProfitAnalysisPage from './pages/CustomerProfitAnalysisPage';
import DayAheadSimulationPage from './pages/DayAheadSimulationPage';
import RollingMatchQuotesPage from './pages/RollingMatchQuotesPage';
import { TabProvider } from './contexts/TabContext';
import { AuthProvider } from './contexts/AuthContext';
import { DesktopTabLayout } from './layouts/DesktopTabLayout';
import { MobileSimpleLayout } from './layouts/MobileSimpleLayout';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// 响应式布局选择组件
const ResponsiveLayout: React.FC = () => {
    const theme = useTheme();
    // 使用 md 断点（960px）作为桌面端和移动端的分界
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

    if (isDesktop) {
        // 桌面端：使用多页签布局
        return <DesktopTabLayout />;
    } else {
        // 移动端：使用单页布局，需要配置路由
        return (
            <Routes>
                <Route path="/" element={<MobileSimpleLayout />}>
                    {/* 默认页 */}
                    <Route index element={<DashboardPage />} />

                    {/* 菜单路由 */}
                    <Route path="dashboard" element={<DashboardPage />} />

                    {/* 客户管理 */}
                    <Route path="customer/profiles" element={<CustomerManagementPage />} />
                    <Route path="customer/profiles/create" element={<CustomerManagementPage />} />
                    <Route path="customer/profiles/view/:customerId" element={<CustomerManagementPage />} />
                    <Route path="customer/profiles/edit/:customerId" element={<CustomerManagementPage />} />
                    <Route path="customer/profiles/copy/:customerId" element={<CustomerManagementPage />} />
                    <Route path="customer/retail-contracts" element={<RetailContractPage />} />
                    <Route path="customer/retail-contracts/create" element={<RetailContractPage />} />
                    <Route path="customer/retail-contracts/view/:contractId" element={<RetailContractPage />} />
                    <Route path="customer/retail-contracts/edit/:contractId" element={<RetailContractPage />} />
                    <Route path="customer/retail-packages" element={<RetailPackagePage />} />
                    <Route path="customer/retail-packages/create" element={<RetailPackagePage />} />
                    <Route path="customer/retail-packages/view/:packageId" element={<RetailPackagePage />} />
                    <Route path="customer/retail-packages/edit/:packageId" element={<RetailPackagePage />} />
                    <Route path="customer/retail-packages/copy/:packageId" element={<RetailPackagePage />} />
                    <Route path="customer/load-analysis" element={<CustomerLoadOverviewPage />} />
                    <Route path="customer/cluster-analysis" element={<PlaceholderPage />} />
                    <Route path="customer/load-characteristics" element={<LoadCharacteristicsOverviewPage />} />
                    <Route path="customer/load-characteristics/:customerId" element={<LoadCharacteristicsDetailPage />} />
                    <Route path="customer/external-diagnosis" element={<IntentCustomerDiagnosisPage />} />

                    {/* 负荷预测 */}
                    <Route path="load-forecast/overall-analysis" element={<LoadAnalysisPage />} />
                    <Route path="load-forecast/short-term" element={<LoadForecastWorkbench />} />
                    <Route path="load-forecast/accuracy-analysis" element={<PlaceholderPage />} />
                    <Route path="load-forecast/long-term" element={<PlaceholderPage />} />



                    {/* 价格分析 */}
                    <Route path="price-analysis/spot-market" element={<SpotIntradayAnalysisPage />} />
                    <Route path="price-analysis/spot-trend" element={<SpotTrendAnalysisPage />} />
                    <Route path="price-analysis/mid-long-term" element={<ContractPriceDailyPage />} />
                    <Route path="price-analysis/mid-long-trend" element={<ContractPriceTrendPage />} />

                    {/* 价格预测 */}
                    <Route path="price-forecast/baseline-data" element={<ForecastBaseDataPage />} />
                    <Route path="price-forecast/d-2" element={<PlaceholderPage />} />
                    <Route path="price-forecast/day-ahead" element={<DayAheadPriceForecastPage />} />
                    <Route path="price-forecast/monthly" element={<PlaceholderPage />} />

                    {/* 交易决策 */}
                    <Route path="strategy/rolling-match-quotes" element={<RollingMatchQuotesPage />} />
                    <Route path="trading-strategy/contract-curve" element={<PlaceholderPage />} />
                    <Route path="trading-strategy/monthly" element={<PlaceholderPage />} />
                    <Route path="trading-strategy/d-2" element={<PlaceholderPage />} />
                    <Route path="trading-strategy/day-ahead" element={<DayAheadSimulationPage />} />

                    {/* 交易复盘 */}
                    <Route path="trade-review/monthly-review" element={<MonthlyTradeReviewPage />} />
                    <Route path="trade-review/monthly-trading-review" element={<TradeReviewPage />} />
                    <Route path="trade-review/spot-review" element={<DayAheadTradeReviewPage />} />

                    {/* 结算管理 */}
                    <Route path="settlement/monthly-overview" element={<MonthlySettlementOverviewPage />} />
                    <Route path="settlement/pre-settlement-overview" element={<PreSettlementOverviewPage />} />
                    <Route path="settlement/pre-settlement-detail" element={<PreSettlementDetailPage />} />
                    <Route path="settlement/customer-settlement-detail" element={<SingleCustomerSettlementDetailPage />} />
                    <Route path="settlement/monthly-analysis" element={<MonthlySettlementAnalysisPage />} />
                    <Route path="settlement/monthly-customer-detail" element={<SingleCustomerMonthlyDetailPage />} />
                    <Route path="settlement/profit-analysis" element={<CustomerProfitAnalysisPage />} />

                    {/* 基础数据 */}
                    <Route path="basic-data/grid-price" element={<GridAgencyPricePage />} />
                    <Route path="basic-data/tou-definition" element={<TouRulesPage />} />
                    <Route path="basic-data/weather-data" element={<WeatherDataPage />} />
                    <Route path="basic-data/load-validation" element={<LoadDataDiagnosisPage />} />
                    <Route path="basic-data/monthly-manual-data" element={<MonthlyManualDataPage />} />

                    {/* 系统管理 */}
                    <Route path="system-settings/user-permissions" element={<UserPermissionsPage />} />
                    <Route path="system-settings/data-access" element={<RpaMonitorPage />} />
                    <Route path="system-settings/system-logs" element={<SystemLogsPage />} />
                    <Route path="system-settings/model-parameters" element={<PlaceholderPage />} />
                </Route>
            </Routes>
        );
    }
};

const queryClient = new QueryClient();

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <QueryClientProvider client={queryClient}>
                <Router>
                    <AuthProvider>
                        <Routes>
                            {/* 登录页面 */}
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                            <Route path="/security-setup" element={<SecuritySetupPage />} />

                            {/* 受保护的路由 */}
                            <Route element={<ProtectedRoute />}>
                                <Route
                                    path="/*"
                                    element={
                                        <TabProvider>
                                            <ResponsiveLayout />
                                        </TabProvider>
                                    }
                                />
                            </Route>
                        </Routes>
                    </AuthProvider>
                </Router>
            </QueryClientProvider>
        </ThemeProvider>
    );
}

export default App;

