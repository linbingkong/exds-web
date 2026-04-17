"""
中长期趋势分析 - 业务服务
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict
import statistics

from pymongo.database import Database

from webapp.models.contract_price_trend import (
    ContractPriceTrendResponse,
    DailyTrendPoint,
    SpreadStats,
    SpreadDistribution,
    Period48TrendPoint,
    CurveAnalysisResponse,
    CurveData,
    DailyCurvePoint,
    CurvePeriod48Point,
    QuantityStructureResponse,
    DailyQuantityPoint
)

logger = logging.getLogger(__name__)


class ContractPriceTrendService:
    """中长期趋势分析服务"""

    def __init__(self, db: Database):
        self.db = db
        self.contracts_collection = db["contracts_aggregated_daily"]
        self.da_collection = db["day_ahead_spot_price"]
        self.rt_collection = db["real_time_spot_price"]

    def get_price_trend(
        self, 
        start_date: datetime, 
        end_date: datetime, 
        spot_type: str = "day_ahead"
    ) -> ContractPriceTrendResponse:
        """
        获取中长期合同价格趋势分析数据
        
        Args:
            start_date: 开始日期 (包含)
            end_date: 结束日期 (包含)
            spot_type: 现货类型 day_ahead(日前) 或 real_time(实时)
            
        Returns:
            ContractPriceTrendResponse 包含每日趋势、价差统计和分布
        """
        logger.info(f"[ContractPriceTrendService] get_price_trend: {start_date} - {end_date}, spot_type={spot_type}")
        
        # 1. 获取日期范围内的所有日期列表
        date_list = []
        current = start_date
        while current <= end_date:
            date_list.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        
        logger.info(f"[ContractPriceTrendService] 日期范围: {len(date_list)} 天")
        
        # 2. 获取中长期合同数据（每日VWAP）
        contract_daily_vwap = self._get_contract_daily_vwap(date_list)
        logger.info(f"[ContractPriceTrendService] 获取合同VWAP: {len(contract_daily_vwap)} 天")
        
        # 3. 获取现货数据（每日VWAP）
        spot_daily_vwap = self._get_spot_daily_vwap(date_list, spot_type)
        logger.info(f"[ContractPriceTrendService] 获取现货VWAP: {len(spot_daily_vwap)} 天")
        
        # 4. 获取时段级别价差统计（正负价差时段数）
        spread_counts = self._get_period_spread_counts(date_list, spot_type)
        logger.info(f"[ContractPriceTrendService] 获取时段价差统计: {len(spread_counts)} 天")
        
        # 5. 构建每日趋势数据
        daily_trends = []
        all_spreads = []
        
        for date_str in date_list:
            contract_vwap = contract_daily_vwap.get(date_str)
            spot_vwap = spot_daily_vwap.get(date_str)
            counts = spread_counts.get(date_str, {"positive": 0, "negative": 0})
            
            # 计算价差 = 中长期 - 现货
            vwap_spread = None
            if contract_vwap is not None and spot_vwap is not None:
                vwap_spread = round(contract_vwap - spot_vwap, 2)
                all_spreads.append(vwap_spread)
            
            daily_trends.append(DailyTrendPoint(
                date=date_str,
                contract_vwap=round(contract_vwap, 2) if contract_vwap is not None else None,
                spot_vwap=round(spot_vwap, 2) if spot_vwap is not None else None,
                vwap_spread=vwap_spread,
                positive_spread_count=counts["positive"],
                negative_spread_count=counts["negative"]
            ))
        
        # 6. 计算价差统计指标
        spread_stats = self._calc_spread_stats(all_spreads)
        
        # 7. 计算价差分布
        spread_distribution = self._calc_spread_distribution(all_spreads)
        
        # 8. 计算区间内48时段聚合均价
        period_48_trends = self._get_period_48_trends(date_list, spot_type)
        
        return ContractPriceTrendResponse(
            daily_trends=daily_trends,
            spread_stats=spread_stats,
            spread_distribution=spread_distribution,
            period_48_trends=period_48_trends
        )

    def _get_contract_daily_vwap(self, date_list: List[str]) -> Dict[str, float]:
        """
        获取中长期合同每日加权平均价格
        
        使用 "整体+整体" 记录中的预计算字段
        """
        result = {}
        
        # 批量查询
        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场",
            "contract_type": "整体",
            "contract_period": "整体"
        })
        
        for doc in cursor:
            date_str = doc.get("date")
            # 优先使用预计算的日均价
            avg_price = doc.get("daily_avg_price")
            if avg_price is not None and avg_price > 0:
                result[date_str] = avg_price
            else:
                # 兜底：从 periods 计算
                periods = doc.get("periods", [])
                if periods:
                    total_qty = 0
                    total_cost = 0
                    for p in periods:
                        qty = p.get("quantity_mwh", 0) or 0
                        price = p.get("price_yuan_per_mwh", 0) or 0
                        total_qty += qty
                        total_cost += qty * price
                    if total_qty > 0:
                        result[date_str] = total_cost / total_qty
        
        return result

    def _get_spot_daily_vwap(self, date_list: List[str], spot_type: str) -> Dict[str, float]:
        """
        获取现货每日加权平均价格
        
        Args:
            date_list: 日期列表
            spot_type: day_ahead 或 real_time
        """
        collection = self.da_collection if spot_type == "day_ahead" else self.rt_collection
        
        # 将日期列表转换为datetime范围
        if not date_list:
            return {}
        
        start_dt = datetime.strptime(date_list[0], "%Y-%m-%d")
        end_dt = datetime.strptime(date_list[-1], "%Y-%m-%d") + timedelta(days=1)
        
        # 查询数据（使用左开右闭以正确处理24:00点）
        query = {"datetime": {"$gt": start_dt, "$lte": end_dt}}
        docs = list(collection.find(query))
        
        # 按日期聚合
        daily_stats = defaultdict(lambda: {"cost": 0, "vol": 0})
        
        for doc in docs:
            dt = doc.get("datetime")
            if not dt:
                continue
            
            # 处理24:00（存储为次日00:00）的业务日期归属
            if dt.hour == 0 and dt.minute == 0:
                business_date = (dt.date() - timedelta(days=1)).strftime("%Y-%m-%d")
            else:
                business_date = dt.date().strftime("%Y-%m-%d")
            
            price = doc.get("avg_clearing_price")
            vol = doc.get("total_clearing_power", 0) or 0
            
            if price is not None:
                daily_stats[business_date]["cost"] += price * vol
                daily_stats[business_date]["vol"] += vol
        
        # 计算VWAP
        result = {}
        for date_str in date_list:
            stats = daily_stats.get(date_str)
            if stats and stats["vol"] > 0:
                result[date_str] = stats["cost"] / stats["vol"]
        
        return result

    def _get_period_spread_counts(self, date_list: List[str], spot_type: str) -> Dict[str, Dict[str, int]]:
        """
        获取每日正负价差时段数
        
        需要逐时段对比中长期与现货价格
        """
        result = {date_str: {"positive": 0, "negative": 0} for date_str in date_list}
        
        # 获取中长期时段价格
        contract_periods = self._get_contract_period_prices(date_list)
        
        # 获取现货时段价格
        spot_periods = self._get_spot_period_prices(date_list, spot_type)
        
        # 逐时段对比
        for date_str in date_list:
            contract_prices = contract_periods.get(date_str, {})
            spot_prices = spot_periods.get(date_str, {})
            
            # 取两者共同的时段
            common_periods = set(contract_prices.keys()) & set(spot_prices.keys())
            
            for period in common_periods:
                contract_price = contract_prices[period]
                spot_price = spot_prices[period]
                spread = contract_price - spot_price
                
                if spread > 0:
                    result[date_str]["positive"] += 1
                elif spread < 0:
                    result[date_str]["negative"] += 1
        
        return result

    def _get_contract_period_prices(self, date_list: List[str]) -> Dict[str, Dict[int, float]]:
        """获取中长期合同时段价格"""
        result = {}
        
        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场",
            "contract_type": "整体",
            "contract_period": "整体"
        })
        
        for doc in cursor:
            date_str = doc.get("date")
            periods = doc.get("periods", [])
            result[date_str] = {}
            for p in periods:
                period_num = p.get("period")
                price = p.get("price_yuan_per_mwh")
                if period_num and price is not None:
                    result[date_str][period_num] = price
        
        return result

    def _get_contract_period_48_trends(self, date_list: List[str]) -> Dict[int, Optional[float]]:
        """获取区间内中长期合同48时段均价"""
        period_stats = {period: {"cost": 0.0, "qty": 0.0} for period in range(1, 49)}

        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场",
            "contract_type": "整体",
            "contract_period": "整体"
        })

        for doc in cursor:
            periods = doc.get("periods", []) or []
            point_count = len(periods)
            if point_count not in (24, 48, 96):
                point_count = 48

            for idx, period_doc in enumerate(periods, start=1):
                price = period_doc.get("price_yuan_per_mwh")
                qty = period_doc.get("quantity_mwh", 0) or 0
                if price is None or qty <= 0:
                    continue

                normalized_points = self._normalize_contract_period_to_48(point_count, idx)
                if not normalized_points:
                    continue

                allocated_qty = qty / len(normalized_points)
                for target_period in normalized_points:
                    period_stats[target_period]["cost"] += price * allocated_qty
                    period_stats[target_period]["qty"] += allocated_qty

        return {
            period: round(stats["cost"] / stats["qty"], 2) if stats["qty"] > 0 else None
            for period, stats in period_stats.items()
        }

    def _normalize_contract_period_to_48(self, point_count: int, period: int) -> List[int]:
        """将24/48/96点中长期时段映射到48时段"""
        if point_count == 48:
            return [period] if 1 <= period <= 48 else []

        if point_count == 24:
            target_period = (period - 1) * 2 + 1
            return [target_period, target_period + 1] if 1 <= target_period <= 47 else []

        if point_count == 96:
            target_period = (period + 1) // 2
            return [target_period] if 1 <= target_period <= 48 else []

        return [period] if 1 <= period <= 48 else []

    def _get_contract_period_48_trends_by_type(self, date_list: List[str]) -> Dict[str, Dict[int, Optional[float]]]:
        """获取各合同类型区间内48时段均价"""
        period_stats_by_curve = {
            curve_key: {period: {"cost": 0.0, "qty": 0.0} for period in range(1, 49)}
            for curve_key in self.CURVE_CONFIG.keys()
        }

        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场"
        })

        for doc in cursor:
            contract_type = doc.get("contract_type")
            contract_period = doc.get("contract_period")
            curve_key = f"{contract_type}-{contract_period}"
            if curve_key not in self.CURVE_CONFIG:
                continue

            periods = doc.get("periods", []) or []
            point_count = len(periods)
            if point_count not in (24, 48, 96):
                point_count = 48

            for idx, period_doc in enumerate(periods, start=1):
                price = period_doc.get("price_yuan_per_mwh")
                qty = period_doc.get("quantity_mwh", 0) or 0
                if price is None or qty <= 0:
                    continue

                normalized_points = self._normalize_contract_period_to_48(point_count, idx)
                if not normalized_points:
                    continue

                allocated_qty = qty / len(normalized_points)
                for target_period in normalized_points:
                    period_stats_by_curve[curve_key][target_period]["cost"] += price * allocated_qty
                    period_stats_by_curve[curve_key][target_period]["qty"] += allocated_qty

        return {
            curve_key: {
                period: round(stats["cost"] / stats["qty"], 2) if stats["qty"] > 0 else None
                for period, stats in period_map.items()
            }
            for curve_key, period_map in period_stats_by_curve.items()
        }

    def _get_spot_period_prices(self, date_list: List[str], spot_type: str) -> Dict[str, Dict[int, float]]:
        """
        获取现货时段价格
        
        注意：现货是96点，中长期可能是24/48/96点
        需要将现货聚合到中长期的粒度
        """
        collection = self.da_collection if spot_type == "day_ahead" else self.rt_collection
        
        if not date_list:
            return {}
        
        start_dt = datetime.strptime(date_list[0], "%Y-%m-%d")
        end_dt = datetime.strptime(date_list[-1], "%Y-%m-%d") + timedelta(days=1)
        
        query = {"datetime": {"$gt": start_dt, "$lte": end_dt}}
        docs = list(collection.find(query))
        
        # 96点原始数据
        raw_prices = defaultdict(dict)  # date -> {period_96: price}
        
        for doc in docs:
            dt = doc.get("datetime")
            if not dt:
                continue
            
            if dt.hour == 0 and dt.minute == 0:
                business_date = (dt.date() - timedelta(days=1)).strftime("%Y-%m-%d")
                period_96 = 96  # 24:00 对应第96个点
            else:
                business_date = dt.date().strftime("%Y-%m-%d")
                # 计算96点编号 (1-96)
                period_96 = (dt.hour * 60 + dt.minute) // 15
                if period_96 == 0:
                    period_96 = 96
            
            price = doc.get("avg_clearing_price")
            if price is not None:
                raw_prices[business_date][period_96] = price
        
        # 获取中长期的时段粒度，然后聚合现货数据
        # 简化处理：先获取每天的中长期点数，然后相应聚合
        contract_point_counts = self._get_contract_point_counts(date_list)
        
        result = {}
        for date_str in date_list:
            contract_points = contract_point_counts.get(date_str, 48)  # 默认48点
            spot_prices_96 = raw_prices.get(date_str, {})
            
            if contract_points == 96:
                # 96点：直接使用
                result[date_str] = spot_prices_96
            elif contract_points == 48:
                # 48点：每2个96点聚合为1个48点
                result[date_str] = {}
                for period_48 in range(1, 49):
                    p1 = period_48 * 2 - 1
                    p2 = period_48 * 2
                    prices = []
                    if p1 in spot_prices_96:
                        prices.append(spot_prices_96[p1])
                    if p2 in spot_prices_96:
                        prices.append(spot_prices_96[p2])
                    if prices:
                        result[date_str][period_48] = sum(prices) / len(prices)
            elif contract_points == 24:
                # 24点：每4个96点聚合为1个24点
                result[date_str] = {}
                for period_24 in range(1, 25):
                    start_p = (period_24 - 1) * 4 + 1
                    prices = []
                    for p in range(start_p, start_p + 4):
                        if p in spot_prices_96:
                            prices.append(spot_prices_96[p])
                    if prices:
                        result[date_str][period_24] = sum(prices) / len(prices)
            else:
                # 其他情况：默认按48点处理
                result[date_str] = {}
                for period_48 in range(1, 49):
                    p1 = period_48 * 2 - 1
                    p2 = period_48 * 2
                    prices = []
                    if p1 in spot_prices_96:
                        prices.append(spot_prices_96[p1])
                    if p2 in spot_prices_96:
                        prices.append(spot_prices_96[p2])
                    if prices:
                        result[date_str][period_48] = sum(prices) / len(prices)
        
        return result

    def _get_spot_period_48_trends(self, date_list: List[str], spot_type: str) -> Dict[int, Optional[float]]:
        """获取区间内现货48时段均价"""
        collection = self.da_collection if spot_type == "day_ahead" else self.rt_collection

        if not date_list:
            return {}

        start_dt = datetime.strptime(date_list[0], "%Y-%m-%d")
        end_dt = datetime.strptime(date_list[-1], "%Y-%m-%d") + timedelta(days=1)
        query = {"datetime": {"$gt": start_dt, "$lte": end_dt}}
        docs = list(collection.find(query))

        period_stats = {period: {"cost": 0.0, "vol": 0.0} for period in range(1, 49)}

        for doc in docs:
            dt = doc.get("datetime")
            if not dt:
                continue

            if dt.hour == 0 and dt.minute == 0:
                business_date = (dt.date() - timedelta(days=1)).strftime("%Y-%m-%d")
                period_96 = 96
            else:
                business_date = dt.date().strftime("%Y-%m-%d")
                period_96 = (dt.hour * 60 + dt.minute) // 15
                if period_96 == 0:
                    period_96 = 96

            if business_date not in date_list:
                continue

            price = doc.get("avg_clearing_price")
            vol = doc.get("total_clearing_power", 0) or 0
            if price is None or vol <= 0:
                continue

            period_48 = (period_96 + 1) // 2
            period_stats[period_48]["cost"] += price * vol
            period_stats[period_48]["vol"] += vol

        return {
            period: round(stats["cost"] / stats["vol"], 2) if stats["vol"] > 0 else None
            for period, stats in period_stats.items()
        }

    def _get_period_48_trends(self, date_list: List[str], spot_type: str) -> List[Period48TrendPoint]:
        """获取区间内48时段中长期与现货均价对比"""
        contract_period_vwap = self._get_contract_period_48_trends(date_list)
        spot_period_vwap = self._get_spot_period_48_trends(date_list, spot_type)

        rows = []
        for period in range(1, 49):
            contract_vwap = contract_period_vwap.get(period)
            spot_vwap = spot_period_vwap.get(period)
            spread = None
            if contract_vwap is not None and spot_vwap is not None:
                spread = round(contract_vwap - spot_vwap, 2)

            rows.append(Period48TrendPoint(
                period=period,
                label=f"{period:02d}",
                contract_vwap=contract_vwap,
                spot_vwap=spot_vwap,
                vwap_spread=spread
            ))

        return rows

    def _get_contract_point_counts(self, date_list: List[str]) -> Dict[str, int]:
        """获取每日中长期合同的时段点数（24/48/96）"""
        result = {}
        
        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场",
            "contract_type": "整体",
            "contract_period": "整体"
        })
        
        for doc in cursor:
            date_str = doc.get("date")
            periods = doc.get("periods", [])
            result[date_str] = len(periods)
        
        return result

    def _calc_spread_stats(self, spreads: List[float]) -> SpreadStats:
        """计算价差统计指标"""
        if not spreads:
            return SpreadStats()
        
        avg_spread = statistics.mean(spreads)
        max_spread = max(spreads)
        min_spread = min(spreads)
        
        positive_count = sum(1 for s in spreads if s > 0)
        negative_count = sum(1 for s in spreads if s < 0)
        total_count = len(spreads)
        
        positive_ratio = (positive_count / total_count) * 100
        negative_ratio = (negative_count / total_count) * 100
        
        return SpreadStats(
            avgSpread=round(avg_spread, 2),
            positiveSpreadRatio=round(positive_ratio, 1),
            negativeSpreadRatio=round(negative_ratio, 1),
            maxSpread=round(max_spread, 2),
            minSpread=round(min_spread, 2)
        )

    def _calc_spread_distribution(self, spreads: List[float]) -> List[SpreadDistribution]:
        """计算价差分布直方图数据"""
        if not spreads:
            return []
        
        step = 50  # 每50元一个区间
        min_val = int(min(spreads) // step * step)
        max_val = int(max(spreads) // step * step + step)
        
        # 初始化区间
        buckets = defaultdict(int)
        for i in range(min_val, max_val, step):
            label = f"{i}~{i + step}"
            buckets[label] = 0
        
        # 统计分布
        for s in spreads:
            bucket_start = int(s // step * step)
            label = f"{bucket_start}~{bucket_start + step}"
            buckets[label] += 1
        
        # 排序并转换
        sorted_buckets = sorted(buckets.items(), key=lambda x: int(x[0].split('~')[0]))
        return [SpreadDistribution(range=k, count=v) for k, v in sorted_buckets]

    # ========== 曲线分析 ==========
    
    # 曲线配置：类型 -> 颜色
    CURVE_CONFIG = {
        # 市场化
        "市场化-整体": {"type": "市场化", "period": "整体", "label": "市场化整体", "color": "#0d47a1"},
        "市场化-年度": {"type": "市场化", "period": "年度", "label": "市场化年度", "color": "#1565c0"},
        "市场化-月度": {"type": "市场化", "period": "月度", "label": "市场化月度", "color": "#1976d2"},
        "市场化-月内": {"type": "市场化", "period": "月内", "label": "市场化月内", "color": "#42a5f5"},
        # 绿电
        "绿电-整体": {"type": "绿电", "period": "整体", "label": "绿电整体", "color": "#1b5e20"},
        "绿电-年度": {"type": "绿电", "period": "年度", "label": "绿电年度", "color": "#2e7d32"},
        "绿电-月度": {"type": "绿电", "period": "月度", "label": "绿电月度", "color": "#43a047"},
        "绿电-月内": {"type": "绿电", "period": "月内", "label": "绿电月内", "color": "#66bb6a"},
        # 代理购电
        "代理购电-整体": {"type": "代理购电", "period": "整体", "label": "代购电整体", "color": "#bf360c"},
        "代理购电-年度": {"type": "代理购电", "period": "年度", "label": "代购电年度", "color": "#e65100"},
        "代理购电-月度": {"type": "代理购电", "period": "月度", "label": "代购电月度", "color": "#ff9800"},
    }

    def get_curve_analysis(
        self,
        start_date: datetime,
        end_date: datetime,
        spot_type: str = "day_ahead"
    ) -> CurveAnalysisResponse:
        """
        获取曲线分析数据 - 按合同类型分组的日均值
        
        Args:
            start_date: 开始日期 (包含)
            end_date: 结束日期 (包含)
            spot_type: 现货类型 day_ahead(日前) 或 real_time(实时)
            
        Returns:
            CurveAnalysisResponse 包含所有类型曲线的日均值数据
        """
        logger.info(f"[ContractPriceTrendService] get_curve_analysis: {start_date} - {end_date}, spot_type={spot_type}")
        
        # 1. 获取日期范围
        date_list = []
        current = start_date
        while current <= end_date:
            date_list.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        
        logger.info(f"[ContractPriceTrendService] 日期范围: {len(date_list)} 天")
        
        # 2. 获取所有类型的日均值数据
        all_curves_data = self._get_all_contract_daily_vwap_by_type(date_list)
        logger.info(f"[ContractPriceTrendService] 获取合同类型曲线: {len(all_curves_data)} 条")
        
        # 3. 获取现货日均值
        spot_daily_vwap = self._get_spot_daily_vwap(date_list, spot_type)
        logger.info(f"[ContractPriceTrendService] 获取现货VWAP: {len(spot_daily_vwap)} 天")

        # 3.1 获取各合同类型48时段均值
        curve_period_48_data = self._get_contract_period_48_trends_by_type(date_list)
        logger.info(f"[ContractPriceTrendService] 获取合同类型48时段曲线: {len(curve_period_48_data)} 条")

        # 3.2 获取现货48时段均值
        spot_period_48_vwap = self._get_spot_period_48_trends(date_list, spot_type)
        
        # 4. 构建曲线数据
        curves = []
        for curve_key, config in self.CURVE_CONFIG.items():
            daily_data = all_curves_data.get(curve_key, {})
            points = [
                DailyCurvePoint(
                    date=date_str,
                    vwap=round(daily_data.get(date_str), 2) if daily_data.get(date_str) is not None else None
                )
                for date_str in date_list
            ]
            # 只有当曲线有数据时才添加
            if any(p.vwap is not None for p in points):
                curves.append(CurveData(
                    key=curve_key,
                    contract_type=config["type"],
                    contract_period=config["period"],
                    label=config["label"],
                    color=config["color"],
                    points=points,
                    period_48_points=[
                        CurvePeriod48Point(
                            period=period,
                            label=f"{period:02d}",
                            vwap=curve_period_48_data.get(curve_key, {}).get(period)
                        )
                        for period in range(1, 49)
                    ]
                ))
        
        # 5. 构建现货曲线
        spot_label = "日前现货" if spot_type == "day_ahead" else "实时现货"
        spot_points = [
            DailyCurvePoint(
                date=date_str,
                vwap=round(spot_daily_vwap.get(date_str), 2) if spot_daily_vwap.get(date_str) is not None else None
            )
            for date_str in date_list
        ]
        spot_curve = CurveData(
            key=spot_type,
            contract_type="现货",
            contract_period="",
            label=spot_label,
            color="#f44336",
            points=spot_points,
            period_48_points=[
                CurvePeriod48Point(
                    period=period,
                    label=f"{period:02d}",
                    vwap=spot_period_48_vwap.get(period)
                )
                for period in range(1, 49)
            ]
        )
        
        return CurveAnalysisResponse(
            curves=curves,
            spot_curve=spot_curve,
            date_range=date_list
        )

    def _get_all_contract_daily_vwap_by_type(self, date_list: List[str]) -> Dict[str, Dict[str, float]]:
        """
        获取所有合同类型的日均价
        
        Returns:
            Dict[curve_key, Dict[date, vwap]]
            例如: {"市场化-月内": {"2024-11-01": 350.5, ...}, ...}
        """
        result = defaultdict(dict)
        
        # 查询所有类型的数据
        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场"
        })
        
        for doc in cursor:
            date_str = doc.get("date")
            contract_type = doc.get("contract_type")
            contract_period = doc.get("contract_period")
            
            if not date_str or not contract_type or not contract_period:
                continue
            
            # 构建曲线键
            curve_key = f"{contract_type}-{contract_period}"
            
            # 跳过不在配置中的类型
            if curve_key not in self.CURVE_CONFIG:
                continue
            
            # 获取日均价
            avg_price = doc.get("daily_avg_price")
            if avg_price is not None and avg_price > 0:
                result[curve_key][date_str] = avg_price
            else:
                # 兜底：从 periods 计算
                periods = doc.get("periods", [])
                if periods:
                    total_qty = 0
                    total_cost = 0
                    for p in periods:
                        qty = p.get("quantity_mwh", 0) or 0
                        price = p.get("price_yuan_per_mwh", 0) or 0
                        total_qty += qty
                        total_cost += qty * price
                    if total_qty > 0:
                        result[curve_key][date_str] = total_cost / total_qty
        
        return dict(result)

    # ========== 电量结构分析 ==========

    def get_quantity_structure(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> QuantityStructureResponse:
        """
        获取电量结构分析数据 - 按日期展示每天的电量组成
        
        Args:
            start_date: 开始日期 (包含)
            end_date: 结束日期 (包含)
            
        Returns:
            QuantityStructureResponse 包含每日电量和汇总统计
        """
        logger.info(f"[ContractPriceTrendService] get_quantity_structure: {start_date} - {end_date}")
        
        # 1. 获取日期范围
        date_list = []
        current = start_date
        while current <= end_date:
            date_list.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        
        logger.info(f"[ContractPriceTrendService] 日期范围: {len(date_list)} 天")
        
        # 2. 获取每日电量数据
        daily_data = self._get_daily_quantity_by_type(date_list)
        logger.info(f"[ContractPriceTrendService] 获取每日电量: {len(daily_data)} 天")
        
        # 3. 构建每日电量点
        daily_quantities = []
        period_totals = {"年度": 0, "月度": 0, "月内": 0}
        type_totals = {"市场化": 0, "绿电": 0, "代购电": 0}
        total_quantity = 0
        
        for date_str in date_list:
            day_data = daily_data.get(date_str, {})
            
            yearly = day_data.get("年度", 0)
            monthly = day_data.get("月度", 0)
            within_month = day_data.get("月内", 0)
            market = day_data.get("市场化", 0)
            green = day_data.get("绿电", 0)
            agency = day_data.get("代购电", 0)
            
            # 日总量 = 各类型之和
            daily_total = market + green + agency
            
            daily_quantities.append(DailyQuantityPoint(
                date=date_str,
                yearly_qty=round(yearly, 2),
                monthly_qty=round(monthly, 2),
                within_month_qty=round(within_month, 2),
                market_qty=round(market, 2),
                green_qty=round(green, 2),
                agency_qty=round(agency, 2),
                total_qty=round(daily_total, 2)
            ))
            
            # 累加汇总
            period_totals["年度"] += yearly
            period_totals["月度"] += monthly
            period_totals["月内"] += within_month
            type_totals["市场化"] += market
            type_totals["绿电"] += green
            type_totals["代购电"] += agency
            total_quantity += daily_total
        
        return QuantityStructureResponse(
            daily_quantities=daily_quantities,
            total_quantity=round(total_quantity, 2),
            period_totals={k: round(v, 2) for k, v in period_totals.items()},
            type_totals={k: round(v, 2) for k, v in type_totals.items()},
            date_range=date_list
        )

    def _get_daily_quantity_by_type(self, date_list: List[str]) -> Dict[str, Dict[str, float]]:
        """
        获取每日各类型/周期的电量
        
        Returns:
            Dict[date, Dict[type_or_period, quantity]]
            例如: {"2024-11-01": {"年度": 1000, "月度": 500, "市场化": 800, ...}, ...}
        """
        result = defaultdict(lambda: defaultdict(float))
        
        # 查询所有日期的电量数据
        cursor = self.contracts_collection.find({
            "date": {"$in": date_list},
            "entity": "全市场"
        })
        
        for doc in cursor:
            date_str = doc.get("date")
            contract_type = doc.get("contract_type")
            contract_period = doc.get("contract_period")
            
            if not date_str or not contract_type or not contract_period:
                continue
            
            # 跳过"整体"类型的记录（避免重复计算）
            if contract_type == "整体" or contract_period == "整体":
                continue
            
            # 获取日电量
            daily_qty = doc.get("daily_total_quantity", 0) or 0
            
            if daily_qty > 0:
                # 按周期累加
                result[date_str][contract_period] += daily_qty
                # 按类型累加（代理购电 -> 代购电）
                type_name = "代购电" if contract_type == "代理购电" else contract_type
                result[date_str][type_name] += daily_qty
        
        return dict(result)
