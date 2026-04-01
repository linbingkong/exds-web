import React from 'react';
import { LoadAnalysisPage } from '../pages/LoadAnalysisPage';
import { SpotIntradayAnalysisPage } from '../pages/SpotIntradayAnalysisPage';
import PlaceholderPage from '../components/PlaceholderPage';
import DashboardPage from '../pages/DashboardPage';
import GridAgencyPricePage from '../pages/GridAgencyPricePage';
import RetailPackagePage from '../pages/RetailPackagePage';
import { CustomerManagementPage } from '../pages/CustomerManagementPage';
import RetailContractPage from '../pages/RetailContractPage';
import { ForecastBaseDataPage } from '../pages/ForecastBaseDataPage';
import { SpotTrendAnalysisPage } from '../pages/SpotTrendAnalysisPage';
import TouRulesPage from '../pages/TouRulesPage';
import { ContractPriceDailyPage } from '../pages/ContractPriceDailyPage';
import { ContractPriceTrendPage } from '../pages/ContractPriceTrendPage';
import { RpaMonitorPage } from '../pages/RpaMonitorPage';
import { DayAheadPriceForecastPage } from '../pages/DayAheadPriceForecastPage';
import { WeatherDataPage } from '../pages/WeatherDataPage';
import { LoadDataDiagnosisPage } from '../pages/LoadDataDiagnosisPage';
import { CustomerLoadOverviewPage } from '../pages/CustomerLoadOverviewPage';
import LoadCharacteristicsOverviewPage from '../pages/LoadCharacteristicsOverviewPage';
import LoadCharacteristicsDetailPage from '../pages/LoadCharacteristicsDetailPage';
import { SystemLogsPage } from '../pages/SystemLogsPage';
import PreSettlementOverviewPage from '../pages/PreSettlementOverviewPage';
import PreSettlementDetailPage from '../pages/PreSettlementDetailPage';
import MonthlyManualDataPage from '../pages/MonthlyManualDataPage';
import SingleCustomerSettlementDetailPage from '../pages/SingleCustomerSettlementDetailPage';
import SingleCustomerMonthlyDetailPage from '../pages/SingleCustomerMonthlyDetailPage';
import MonthlySettlementAnalysisPage from '../pages/MonthlySettlementAnalysisPage';
import { MonthlySettlementOverviewPage } from '../pages/MonthlySettlementOverviewPage';
import { LoadForecastWorkbench } from '../pages/LoadForecastWorkbench';
import TradeReviewPage from '../pages/TradeReviewPage';
import DayAheadTradeReviewPage from '../pages/DayAheadTradeReviewPage';
import { IntentCustomerDiagnosisPage } from '../pages/IntentCustomerDiagnosisPage';
import UserPermissionsPage from '../pages/UserPermissionsPage';
import MonthlyTradeReviewPage from '../pages/MonthlyTradeReviewPage';
import CustomerProfitAnalysisPage from '../pages/CustomerProfitAnalysisPage';
import DayAheadSimulationPage from '../pages/DayAheadSimulationPage';

export interface RouteConfig {
    path: string;
    title: string;
    component: React.ComponentType;
    requiredPermission?: string;  // 新增：进入该路由需要的权限码
}

export const routeConfigs: RouteConfig[] = [
    { path: '/dashboard', title: '交易总览', component: DashboardPage },

    // 客户管理
    { path: '/customer/profiles', title: '客户档案管理', component: CustomerManagementPage },
    { path: '/customer/retail-contracts', title: '零售合同管理', component: RetailContractPage },
    { path: '/customer/retail-packages', title: '零售套餐管理', component: RetailPackagePage },
    { path: '/customer/load-analysis', title: '客户负荷分析', component: CustomerLoadOverviewPage },
    { path: '/customer/load-characteristics', title: '负荷特征分析', component: LoadCharacteristicsOverviewPage },
    { path: '/customer/load-characteristics/:customerId', title: '客户特征详情', component: LoadCharacteristicsDetailPage },
    { path: '/customer/external-diagnosis', title: '意向客户诊断', component: IntentCustomerDiagnosisPage },

    // 负荷预测
    { path: '/load-forecast/overall-analysis', title: '总体负荷分析', component: LoadAnalysisPage },
    { path: '/load-forecast/short-term', title: '短期负荷预测', component: LoadForecastWorkbench },
    { path: '/load-forecast/accuracy-analysis', title: '预测精度分析', component: PlaceholderPage },
    { path: '/load-forecast/long-term', title: '中期负荷预测', component: PlaceholderPage },

    // 价格分析
    { path: '/price-analysis/spot-market', title: '现货日内分析', component: SpotIntradayAnalysisPage },
    { path: '/price-analysis/spot-trend', title: '现货趋势分析', component: SpotTrendAnalysisPage },
    { path: '/price-analysis/mid-long-term', title: '中长期日内分析', component: ContractPriceDailyPage },
    { path: '/price-analysis/mid-long-trend', title: '中长期趋势分析', component: ContractPriceTrendPage },

    // 价格预测
    { path: '/price-forecast/baseline-data', title: '价格基础数据', component: ForecastBaseDataPage },
    { path: '/price-forecast/d-2', title: 'D-2价格预测', component: PlaceholderPage },
    { path: '/price-forecast/day-ahead', title: '日前价格预测', component: DayAheadPriceForecastPage },
    { path: '/price-forecast/monthly', title: '月度价格预测', component: PlaceholderPage },

    // 交易决策
    { path: '/trading-strategy/contract-curve', title: '月内交易策略', component: PlaceholderPage },
    { path: '/trading-strategy/monthly', title: '月度交易策略', component: PlaceholderPage },
    { path: '/trading-strategy/d-2', title: 'D-2交易策略', component: PlaceholderPage },
    { path: '/trading-strategy/day-ahead', title: '日前模拟交易', component: DayAheadSimulationPage },

    // 交易复盘
    { path: '/trade-review/monthly-review', title: '月度交易复盘', component: MonthlyTradeReviewPage },
    { path: '/trade-review/monthly-trading-review', title: '月内交易复盘', component: TradeReviewPage },
    { path: '/trade-review/spot-review', title: '日前交易复盘', component: DayAheadTradeReviewPage },

    // 结算管理
    { path: '/settlement/monthly-overview', title: '月度结算总览', component: MonthlySettlementOverviewPage },
    { path: '/settlement/pre-settlement-overview', title: '日清结算总览', component: PreSettlementOverviewPage },
    { path: '/settlement/pre-settlement-detail', title: '日清结算详情', component: PreSettlementDetailPage },
    { path: '/settlement/customer-settlement-detail', title: '单客户结算详情', component: SingleCustomerSettlementDetailPage as any },
    { path: '/settlement/monthly-analysis', title: '月度结算详情', component: MonthlySettlementAnalysisPage },
    { path: '/settlement/monthly-customer-detail', title: '单客户月度结算详情', component: SingleCustomerMonthlyDetailPage },
    { path: '/settlement/profit-analysis', title: '客户收益分析', component: CustomerProfitAnalysisPage },

    // 基础数据
    { path: '/basic-data/grid-price', title: '国网代理购电', component: GridAgencyPricePage },
    { path: '/basic-data/tou-definition', title: '时段电价分布', component: TouRulesPage },
    { path: '/basic-data/weather-data', title: '天气预测数据', component: WeatherDataPage },
    { path: '/basic-data/load-validation', title: '负荷数据诊断', component: LoadDataDiagnosisPage },
    { path: '/basic-data/monthly-manual-data', title: '基础数据导入', component: MonthlyManualDataPage },

    // 系统管理
    { path: '/system-settings/user-permissions', title: '用户与权限', component: UserPermissionsPage },
    { path: '/system-settings/data-access', title: '数据下载监控', component: RpaMonitorPage },
    { path: '/system-settings/system-logs', title: '告警与日志', component: SystemLogsPage },
    { path: '/system-settings/model-parameters', title: '预测模型参数', component: PlaceholderPage },
];

export const getRouteConfig = (path: string): RouteConfig | undefined => {
    return routeConfigs.find((config) => config.path === path);
};
