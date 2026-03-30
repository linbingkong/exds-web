import logging
from fastapi import APIRouter

from webapp.api import (
    v1_retail_packages, v1_customers, v1_retail_contracts,
    v1_forecast_base_data, v1_trend_analysis, v1_contract_price,
    v1_contract_price_trend, v1_price_forecast, v1_weather,
    v1_load_diagnosis, v1_total_load, v1_load_characteristics,
    v1_rpa_monitor, v1_customer_analysis, v1_customer_load_overview,
    # New modules
    v1_common, v1_market_analysis, v1_sgcc_price,
    v1_pricing_model, v1_customer_tags, v1_system,
    v1_load_forecast, v1_manual_adjustment, v1_settlement,
    v1_retail_settlement,
    v1_retail_prices,
    v1_mechanism_energy,
    v1_trade_review,
    v1_customer_energy,
    v1_wholesale_monthly_settlement,
    v1_intent_customer_diagnosis,
    v1_customer_profit_analysis,
    v1_dashboard,
    medium_term_forecast  # New module
)
from webapp.api import v1_auth

logger = logging.getLogger(__name__)

# 创建一个API路由器
router = APIRouter(prefix="/api/v1", tags=["v1"])
public_router = APIRouter(prefix="/api/v1", tags=["v1-public"])

# Include routers
router.include_router(v1_retail_packages.router)
router.include_router(v1_customers.router)  # 客户管理路由
router.include_router(v1_retail_contracts.router)  # 零售合同管理路由
router.include_router(v1_forecast_base_data.router)  # 预测基础数据路由
router.include_router(v1_trend_analysis.router)  # 现货趋势分析路由
router.include_router(v1_contract_price.router)  # 中长期合同价格分析路由
router.include_router(v1_contract_price_trend.router)  # 中长期趋势分析路由
router.include_router(v1_price_forecast.router)  # 价格预测路由
router.include_router(v1_weather.router)  # 天气数据路由
router.include_router(v1_load_diagnosis.router)  # 负荷数据校核路由
router.include_router(v1_total_load.router) # 整体负荷分析路由
router.include_router(v1_load_characteristics.router) # 负荷特征分析路由

# Include new refactored routers
router.include_router(v1_common.router)
router.include_router(v1_market_analysis.router)
router.include_router(v1_sgcc_price.router)
router.include_router(v1_pricing_model.router)
router.include_router(v1_customer_tags.router)
router.include_router(v1_settlement.router)
router.include_router(v1_retail_settlement.router)
router.include_router(v1_retail_prices.router)  # 零售结算价格定义
router.include_router(v1_mechanism_energy.router)
router.include_router(v1_trade_review.router)
router.include_router(v1_customer_energy.router)
router.include_router(v1_wholesale_monthly_settlement.router)
router.include_router(v1_intent_customer_diagnosis.router)
router.include_router(v1_customer_profit_analysis.router, prefix="/customer-profit-analysis", tags=["Customer Profit Analysis"])
router.include_router(v1_dashboard.router)

# Include additional routers previously in main.py
router.include_router(v1_rpa_monitor.router, prefix="/rpa", tags=["RPA监控"])
router.include_router(v1_customer_analysis.router, prefix="/customer-analysis", tags=["Customer Analysis"])
router.include_router(v1_customer_load_overview.router, prefix="/customer-load-overview", tags=["Customer Load Overview"])
router.include_router(v1_load_forecast.router)
router.include_router(v1_manual_adjustment.router)
router.include_router(v1_system.router)
router.include_router(medium_term_forecast.router, prefix="/load-forecast/medium-term", tags=["LoadForecast"])
router.include_router(v1_auth.router)  # 认证与授权管理

# Include public routers
public_router.include_router(v1_sgcc_price.public_router)
public_router.include_router(v1_auth.public_router)
