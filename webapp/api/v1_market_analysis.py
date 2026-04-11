import logging
import math
import statistics
import json
from typing import Any, List, Dict, Optional
from datetime import datetime, timedelta
import calendar
from bson import json_util
from fastapi import APIRouter, Query, HTTPException

from webapp.tools.mongo import DATABASE
from webapp.services.tou_service import get_tou_rule_by_date

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1-market-analysis"])

DA_PRICE_COLLECTION = DATABASE['day_ahead_spot_price']
RT_PRICE_COLLECTION = DATABASE['real_time_spot_price']
DA_ECON_PRICE_COLLECTION = DATABASE['day_ahead_econ_price']
NODE_SPOT_PRICE_DAILY_COLLECTION = DATABASE['node_spot_price_daily']

DEFAULT_NODE_SPOT_PRICE_NAME = "凌云站/500kV.Ⅰ母"


def _safe_finite_float(value: Any) -> Optional[float]:
    """将输入安全转换为有限浮点数，非有限值返回 None。"""
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    return numeric_value if math.isfinite(numeric_value) else None


def _sanitize_json_floats(value: Any) -> Any:
    """递归清理返回内容中的 NaN/Inf，避免 JSON 序列化报错。"""
    if isinstance(value, dict):
        return {key: _sanitize_json_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_floats(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _build_node_15m_price_map(points: List[Dict[str, Any]]) -> Dict[str, float]:
    """将节点 5 分钟价格点按 15 分钟窗口聚合为均值，仅保留完整三点窗口。"""
    if not points:
        return {}

    raw_price_map: Dict[str, float] = {}
    for point in points:
        time_str = point.get("time")
        cq_price = _safe_finite_float(point.get("cq_price"))
        if time_str and cq_price is not None:
            raw_price_map[time_str] = cq_price

    aggregated_map: Dict[str, float] = {}
    for quarter_index in range(1, 97):
        total_minutes = quarter_index * 15
        quarter_time = "24:00" if total_minutes == 1440 else f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"

        window_times = []
        for offset in (10, 5, 0):
            point_minutes = total_minutes - offset
            point_time = "24:00" if point_minutes == 1440 else f"{point_minutes // 60:02d}:{point_minutes % 60:02d}"
            window_times.append(point_time)

        if all(time_key in raw_price_map for time_key in window_times):
            aggregated_map[quarter_time] = round(
                sum(raw_price_map[time_key] for time_key in window_times) / 3,
                2
            )

    return aggregated_map

def get_tou_rule_for_date(date: datetime) -> Dict[str, str]:
    """
    获取指定日期的分时电价规则 (Base + Patch 模式)
    """
    return get_tou_rule_by_date(date)

@router.get("/available_months", summary="获取所有存在价格数据的月份")
def get_available_months():
    try:
        pipeline = [
            {'$project': {'month': {'$dateToString': {'format': '%Y-%m', 'date': '$datetime'}}}},
            {'$group': {'_id': '$month'}},
            {'$sort': {'_id': -1}}
        ]
        # 这里我们假设日前和实时数据的月份范围基本一致，使用日前价格集合进行查询
        months = [doc['_id'] for doc in DA_PRICE_COLLECTION.aggregate(pipeline)]
        return months
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@router.get("/price_comparison", summary="获取指定单日的日前与实时价格对比数据")
def get_price_comparison(date: str = Query(..., description="查询日期, 格式 YYYY-MM-DD")):
    try:
        start_date = datetime.strptime(date, "%Y-%m-%d")
        end_date = start_date + timedelta(days=1)
        tou_rules = get_tou_rule_for_date(start_date)

        # --- 优化：一次性查询当天所有数据 ---
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        da_docs = list(DA_PRICE_COLLECTION.find(query))
        rt_docs = list(RT_PRICE_COLLECTION.find(query))

        # --- 优化：将列表转换为字典以便快速查找 ---
        da_price_map = {doc['datetime']: doc for doc in da_docs}
        rt_price_map = {doc['datetime']: doc for doc in rt_docs}

        chart_data, da_prices_for_stats, rt_prices_for_stats = [], [], []
        tou_stats_collector = {period: {"da": [], "rt": []} for period in set(tou_rules.values())}

        for i in range(96):
            time_obj = start_date + timedelta(minutes=15 * i)
            # --- 优化：从字典中直接获取数据，而不是查询数据库 ---
            da_doc = da_price_map.get(time_obj)
            rt_doc = rt_price_map.get(time_obj)
            
            da_price = da_doc.get('avg_clearing_price') if da_doc else None
            rt_price = rt_doc.get('avg_clearing_price') if rt_doc else None
            time_str = time_obj.strftime("%H:%M")
            period_type = tou_rules.get(time_str, "平段")
            
            chart_data.append({"time": time_str, "day_ahead_price": da_price, "real_time_price": rt_price, "period_type": period_type})
            
            if da_price is not None:
                da_prices_for_stats.append(da_price)
                if period_type in tou_stats_collector: tou_stats_collector[period_type]["da"].append(da_price)
            if rt_price is not None:
                rt_prices_for_stats.append(rt_price)
                if period_type in tou_stats_collector: tou_stats_collector[period_type]["rt"].append(rt_price)

        stats = {
            "day_ahead_avg": statistics.mean(da_prices_for_stats) if da_prices_for_stats else None,
            "day_ahead_std_dev": statistics.stdev(da_prices_for_stats) if len(da_prices_for_stats) > 1 else 0,
            "day_ahead_max": max(da_prices_for_stats) if da_prices_for_stats else None,
            "day_ahead_min": min(da_prices_for_stats) if da_prices_for_stats else None,
            "real_time_avg": statistics.mean(rt_prices_for_stats) if rt_prices_for_stats else None,
            "real_time_std_dev": statistics.stdev(rt_prices_for_stats) if len(rt_prices_for_stats) > 1 else 0,
            "real_time_max": max(rt_prices_for_stats) if rt_prices_for_stats else None,
            "real_time_min": min(rt_prices_for_stats) if rt_prices_for_stats else None,
        }
        tou_stats = {}
        for period, values in tou_stats_collector.items():
            tou_stats[period] = {
                "day_ahead_avg": statistics.mean(values["da"]) if values["da"] else None,
                "real_time_avg": statistics.mean(values["rt"]) if values["rt"] else None,
            }
        flat_da_avg = tou_stats.get("平段", {}).get("day_ahead_avg")
        flat_rt_avg = tou_stats.get("平段", {}).get("real_time_avg")
        for period, values in tou_stats.items():
            if flat_da_avg and values["day_ahead_avg"] is not None: values["day_ahead_ratio"] = round(values["day_ahead_avg"] / flat_da_avg, 2)
            else: values["day_ahead_ratio"] = None
            if flat_rt_avg and values["real_time_avg"] is not None: values["real_time_ratio"] = round(values["real_time_avg"] / flat_rt_avg, 2)
            else: values["real_time_ratio"] = None
        return {"chart_data": chart_data, "stats": stats, "tou_stats": tou_stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@router.get("/timeslot_analysis", summary="获取指定月份、指定时段的每日价格数据")
def get_timeslot_analysis(month: str = Query(..., description="查询月份, 格式 YYYY-MM"), slot: str = Query(..., description="查询的单个时段, 格式 HH:MM")):
    try:
        year, mon = map(int, month.split('-'))
        num_days = calendar.monthrange(year, mon)[1]
        slot_hour, slot_minute = map(int, slot.split(':'))
        
        start_date = datetime(year, mon, 1)
        end_date = start_date + timedelta(days=num_days)

        pipeline = [
            {
                '$match': {
                    'datetime': {'$gte': start_date, '$lt': end_date},
                    '$expr': {
                        '$and': [
                            {'$eq': [{'$hour': '$datetime'}, slot_hour]},
                            {'$eq': [{'$minute': '$datetime'}, slot_minute]}
                        ]
                    }
                }
            }
        ]
        da_docs = list(DA_PRICE_COLLECTION.aggregate(pipeline))
        rt_docs = list(RT_PRICE_COLLECTION.aggregate(pipeline))

        da_price_map = {doc['datetime'].day: doc for doc in da_docs}
        rt_price_map = {doc['datetime'].day: doc for doc in rt_docs}

        chart_data, da_prices_for_stats, rt_prices_for_stats = [], [], []
        for day in range(1, num_days + 1):
            da_doc = da_price_map.get(day)
            rt_doc = rt_price_map.get(day)

            da_price = da_doc.get('avg_clearing_price') if da_doc else None
            rt_price = rt_doc.get('avg_clearing_price') if rt_doc else None
            chart_data.append({"day": day, "day_ahead_price": da_price, "real_time_price": rt_price})
            
            if da_price is not None: da_prices_for_stats.append(da_price)
            if rt_price is not None: rt_prices_for_stats.append(rt_price)

        stats = {
            "day_ahead_avg": statistics.mean(da_prices_for_stats) if da_prices_for_stats else None,
            "day_ahead_std_dev": statistics.stdev(da_prices_for_stats) if len(da_prices_for_stats) > 1 else 0,
            "day_ahead_max": max(da_prices_for_stats) if da_prices_for_stats else None,
            "day_ahead_min": min(da_prices_for_stats) if da_prices_for_stats else None,
            "real_time_avg": statistics.mean(rt_prices_for_stats) if rt_prices_for_stats else None,
            "real_time_std_dev": statistics.stdev(rt_prices_for_stats) if len(rt_prices_for_stats) > 1 else 0,
            "real_time_max": max(rt_prices_for_stats) if rt_prices_for_stats else None,
            "real_time_min": min(rt_prices_for_stats) if rt_prices_for_stats else None,
        }
        return {"chart_data": chart_data, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@router.get("/market-analysis/dashboard", summary="获取市场价格总览（Market Dashboard）")
def get_market_dashboard(date_str: str = Query(..., description="查询日期, 格式 YYYY-MM-DD")):
    """
    获取指定日期的市场价格总览数据，包括：
    - 财务KPI：VWAP、TWAP、价差
    - 风险KPI：最大/最小价差、极值价格
    - 96点时序数据：价格、市场竞价空间曲线
    - 时段汇总统计：按尖峰平谷分组
    
    [NEW] 增加日前经济出清价格（day_ahead_econ_price）展示和统计
    """
    try:
        start_date = datetime.strptime(date_str, "%Y-%m-%d")
        tou_rules = get_tou_rule_for_date(start_date)

        query = {"date_str": date_str}
        da_docs = list(DA_PRICE_COLLECTION.find(query).sort("datetime", 1))
        rt_docs = list(RT_PRICE_COLLECTION.find(query).sort("datetime", 1))
        # [NEW] 查询日前经济出清价格
        da_econ_docs = list(DA_ECON_PRICE_COLLECTION.find(query).sort("datetime", 1))

        has_rt_published = any(
            _safe_finite_float(doc.get('avg_clearing_price')) is not None
            for doc in rt_docs
        )

        node_price_map: Dict[str, float] = {}
        node_daily_doc = NODE_SPOT_PRICE_DAILY_COLLECTION.find_one(
            {"node_name": DEFAULT_NODE_SPOT_PRICE_NAME, "date": date_str},
            {"_id": 0, "points": 1}
        )
        node_price_map = _build_node_15m_price_map((node_daily_doc or {}).get("points", []))

        start_of_day = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        actual_operation_query = {"datetime": {"$gt": start_of_day, "$lte": end_of_day}}

        actual_operation_docs = list(DATABASE['actual_operation'].find(
            actual_operation_query,
            {'_id': 0, 'datetime': 1, 'time_str': 1, 'system_load': 1, 'tieline_flow': 1}
        ).sort("datetime", 1))

        real_time_generation_docs = list(DATABASE['real_time_generation'].find(
            actual_operation_query,
            {
                '_id': 0, 'datetime': 1, 'time_str': 1,
                'wind_generation': 1, 'solar_generation': 1, 'hydro_generation': 1,
                'pumped_storage_generation': 1, 'battery_storage_generation': 1
            }
        ).sort("datetime", 1))

        daily_release_docs = list(DATABASE['daily_release'].find(
            actual_operation_query,
            {
                '_id': 0, 'datetime': 1,
                'system_load_forecast': 1, 'wind_forecast': 1, 'pv_forecast': 1,
                'nonmarket_unit_forecast': 1, 'tieline_plan': 1
            }
        ).sort("datetime", 1))

        da_map = {doc['time_str']: doc for doc in da_docs}
        rt_map = {doc['time_str']: doc for doc in rt_docs}
        # [NEW] 经济出清价格映射
        da_econ_map = {doc['time_str']: doc for doc in da_econ_docs if 'time_str' in doc}
        
        actual_op_map = {doc['time_str']: doc for doc in actual_operation_docs if 'time_str' in doc}
        generation_map = {doc['time_str']: doc for doc in real_time_generation_docs if 'time_str' in doc}

        daily_release_map = {}
        for doc in daily_release_docs:
            dt = doc.get('datetime')
            if isinstance(dt, datetime):
                next_day = start_of_day + timedelta(days=1)
                if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date():
                    time_str = "24:00"
                else:
                    time_str = dt.strftime("%H:%M")
                daily_release_map[time_str] = doc

        time_series = []
        da_weighted_sum, da_volume_sum, rt_weighted_sum, rt_volume_sum = 0, 0, 0, 0
        da_prices, rt_prices = [], []
        # [NEW] 经济出清价格列表
        econ_prices = []

        max_positive_spread = {"value": float('-inf'), "time_str": "", "period": 0}
        max_negative_spread = {"value": float('inf'), "time_str": "", "period": 0}
        max_rt_price = {"value": float('-inf'), "time_str": "", "period": 0}
        min_rt_price = {"value": float('inf'), "time_str": "", "period": 0}
        
        period_collector = {}

        # 生成 96 个标准时段列表
        standard_times = []
        for i in range(1, 97):
            h = (i * 15) // 60
            m = (i * 15) % 60
            if h == 24 and m == 0:
                time_str = "24:00"
            else:
                time_str = f"{h:02d}:{m:02d}"
            standard_times.append(time_str)

        for i, time_str in enumerate(standard_times):
            period = i + 1
            
            da_doc = da_map.get(time_str, {})
            rt_doc = rt_map.get(time_str, {})
            # [NEW] 获取经济出清价格
            da_econ_doc = da_econ_map.get(time_str, {})
            actual_op_data = actual_op_map.get(time_str, {})
            generation_data = generation_map.get(time_str, {})
            daily_release_data = daily_release_map.get(time_str, {})

            da_price = _safe_finite_float(da_doc.get('avg_clearing_price'))
            da_volume = _safe_finite_float(da_doc.get('total_clearing_power')) or 0.0
            rt_price = _safe_finite_float(rt_doc.get('avg_clearing_price'))
            node_rt_price = node_price_map.get(time_str)
            rt_volume = _safe_finite_float(rt_doc.get('total_clearing_power')) or 0.0
            rt_wind = _safe_finite_float(rt_doc.get('wind_clearing_power')) or 0.0
            rt_solar = _safe_finite_float(rt_doc.get('solar_clearing_power')) or 0.0
            
            # [NEW] 提取经济出清价格
            price_econ = _safe_finite_float(da_econ_doc.get('clearing_price'))

            market_bidding_space_da = 0
            if daily_release_data:
                try:
                    load_forecast = _safe_finite_float(daily_release_data.get('system_load_forecast')) or 0.0
                    wind = _safe_finite_float(daily_release_data.get('wind_forecast')) or 0.0
                    pv = _safe_finite_float(daily_release_data.get('pv_forecast')) or 0.0
                    nonmarket = _safe_finite_float(daily_release_data.get('nonmarket_unit_forecast')) or 0.0
                    tieline = _safe_finite_float(daily_release_data.get('tieline_plan')) or 0.0
                    market_bidding_space_da = load_forecast - wind - pv - nonmarket - tieline
                except (TypeError, ValueError):
                    pass

            market_bidding_space_rt = 0
            if actual_op_data and generation_data:
                try:
                    system_load = _safe_finite_float(actual_op_data.get('system_load')) or 0.0
                    tieline_flow = _safe_finite_float(actual_op_data.get('tieline_flow')) or 0.0
                    wind = _safe_finite_float(generation_data.get('wind_generation')) or 0.0
                    solar = _safe_finite_float(generation_data.get('solar_generation')) or 0.0
                    hydro = _safe_finite_float(generation_data.get('hydro_generation')) or 0.0
                    pumped_storage = _safe_finite_float(generation_data.get('pumped_storage_generation')) or 0.0
                    battery_storage = _safe_finite_float(generation_data.get('battery_storage_generation')) or 0.0
                    nonmarket_unit = hydro + max(pumped_storage, 0) + max(battery_storage, 0)
                    market_bidding_space_rt = system_load - wind - solar - nonmarket_unit - tieline_flow
                except (TypeError, ValueError):
                    pass

            spread = (rt_price - da_price) if (rt_price is not None and da_price is not None) else None
            period_type = tou_rules.get(time_str, "平段")

            time_series.append({
                "period": period,
                "time": time_str,
                "time_str": time_str,
                "price_rt": rt_price,
                "node_rt_price": node_rt_price,
                "price_da": da_price,
                "price_econ": price_econ, # [NEW] 添加到响应中
                "volume_rt": market_bidding_space_rt,
                "volume_da": market_bidding_space_da,
                "spread": spread,
                "period_type": period_type
            })

            if da_price is not None and da_volume > 0:
                da_weighted_sum += da_price * da_volume
                da_volume_sum += da_volume
                da_prices.append(da_price)
            elif da_price is not None:
                da_prices.append(da_price)

            if rt_price is not None and rt_volume > 0:
                rt_weighted_sum += rt_price * rt_volume
                rt_volume_sum += rt_volume
                rt_prices.append(rt_price)
            elif rt_price is not None:
                rt_prices.append(rt_price)
            
            # [NEW] 收集经济出清价格
            if price_econ is not None:
                econ_prices.append(price_econ)

            if spread is not None:
                if spread > max_positive_spread["value"]:
                    max_positive_spread.update({"value": spread, "time_str": time_str, "period": period})
                if spread < max_negative_spread["value"]:
                    max_negative_spread.update({"value": spread, "time_str": time_str, "period": period})
            if rt_price is not None:
                if rt_price > max_rt_price["value"]:
                    max_rt_price.update({"value": rt_price, "time_str": time_str, "period": period})
                if rt_price < min_rt_price["value"]:
                    min_rt_price.update({"value": rt_price, "time_str": time_str, "period": period})
            
            if period_type not in period_collector:
                period_collector[period_type] = {
                    "da_weighted_sum": 0, "da_volume_sum": 0,
                    "rt_weighted_sum": 0, "rt_volume_sum": 0,
                    "rt_wind_sum": 0, "rt_solar_sum": 0, "count": 0
                }
            
            if da_price is not None and da_volume > 0:
                period_collector[period_type]["da_weighted_sum"] += da_price * da_volume
                period_collector[period_type]["da_volume_sum"] += da_volume
            if rt_price is not None and rt_volume > 0:
                period_collector[period_type]["rt_weighted_sum"] += rt_price * rt_volume
                period_collector[period_type]["rt_volume_sum"] += rt_volume
                period_collector[period_type]["rt_wind_sum"] += rt_wind
                period_collector[period_type]["rt_solar_sum"] += rt_solar
                period_collector[period_type]["count"] += 1

        vwap_da = da_weighted_sum / da_volume_sum if da_volume_sum > 0 else None
        vwap_rt = rt_weighted_sum / rt_volume_sum if rt_volume_sum > 0 else None
        vwap_spread = (vwap_rt - vwap_da) if (vwap_rt is not None and vwap_da is not None) else None
        twap_da = statistics.mean(da_prices) if da_prices else None
        twap_rt = statistics.mean(rt_prices) if rt_prices else None
        
        # [NEW] 计算经济出清价格统计
        twap_econ = statistics.mean(econ_prices) if econ_prices else None
        max_econ = max(econ_prices) if econ_prices else None
        min_econ = min(econ_prices) if econ_prices else None

        financial_kpis = {
            "vwap_rt": vwap_rt, "vwap_da": vwap_da, "vwap_spread": vwap_spread, 
            "twap_rt": twap_rt, "twap_da": twap_da,
            "twap_econ": twap_econ, "max_econ": max_econ, "min_econ": min_econ # [NEW]
        }

        risk_kpis = {
            "max_positive_spread": max_positive_spread if max_positive_spread["value"] != float('-inf') else None,
            "max_negative_spread": max_negative_spread if max_negative_spread["value"] != float('inf') else None,
            "max_rt_price": max_rt_price if max_rt_price["value"] != float('-inf') else None,
            "min_rt_price": min_rt_price if min_rt_price["value"] != float('inf') else None
        }

        period_summary = []
        period_order = ["尖峰", "高峰", "平段", "低谷", "深谷"]
        for period_name in period_order:
            if period_name not in period_collector: continue

            data = period_collector[period_name]
            vwap_da_period = data["da_weighted_sum"] / data["da_volume_sum"] if data["da_volume_sum"] > 0 else None
            vwap_rt_period = data["rt_weighted_sum"] / data["rt_volume_sum"] if data["rt_volume_sum"] > 0 else None
            vwap_spread_period = (vwap_rt_period - vwap_da_period) if (vwap_rt_period and vwap_da_period) else None
            avg_volume_rt = data["rt_volume_sum"] / data["count"] if data["count"] > 0 else None
            
            renewable_volume = data["rt_wind_sum"] + data["rt_solar_sum"]
            renewable_ratio = renewable_volume / data["rt_volume_sum"] if data["rt_volume_sum"] > 0 else None

            period_summary.append({
                "period_name": period_name, "vwap_da": vwap_da_period, "vwap_rt": vwap_rt_period,
                "vwap_spread": vwap_spread_period, "avg_volume_rt": avg_volume_rt, "renewable_ratio": renewable_ratio
            })

        return _sanitize_json_floats({
            "date": date_str,
            "financial_kpis": financial_kpis,
            "risk_kpis": risk_kpis,
            "time_series": time_series,
            "period_summary": period_summary,
            "node_rt_fallback": {
                "enabled": (not has_rt_published) and bool(node_price_map),
                "node_name": DEFAULT_NODE_SPOT_PRICE_NAME
            }
        })

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取市场总览数据时出错: {str(e)}")


@router.get("/market-analysis/day-ahead", summary="获取日前市场分析数据")
def get_day_ahead_analysis(date: str = Query(..., description="查询日期, 格式 YYYY-MM-DD")):
    """
    获取指定日期的日前市场分析数据，包括价格、总电量、各类电源的出力及市场竞价空间。
    [NEW] 增加日前经济出清价格（price_econ）
    """
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d")
        query = {"date_str": date}
        
        # 查询各集合数据
        price_docs = list(DA_PRICE_COLLECTION.find(query, {'_id': 0}))
        econ_docs = list(DA_ECON_PRICE_COLLECTION.find(query, {'_id': 0}))
        
        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        daily_release_query = {"datetime": {"$gt": start_of_day, "$lte": end_of_day}}
        daily_release_docs = list(DATABASE['daily_release'].find(
            daily_release_query,
            {   
                '_id': 0, 'datetime': 1, 'system_load_forecast': 1, 'wind_forecast': 1, 
                'pv_forecast': 1, 'nonmarket_unit_forecast': 1, 'tieline_plan': 1
            }
        ))

        # 构建映射表
        price_map = {doc['time_str']: doc for doc in price_docs if 'time_str' in doc}
        econ_map = {doc['time_str']: doc for doc in econ_docs if 'time_str' in doc}
        
        daily_release_map = {}
        for doc in daily_release_docs:
            dt = doc['datetime']
            if isinstance(dt, datetime):
                # 转换 00:00 (明日) 为 24:00
                if dt.hour == 0 and dt.minute == 0 and dt.date() > target_date.date():
                    t_str = "24:00"
                else:
                    t_str = dt.strftime("%H:%M")
                daily_release_map[t_str] = doc

        result = []
        prices = []
        spaces = []

        # 生成 96 个标准时点
        for i in range(1, 97):
            h = (i * 15) // 60
            m = (i * 15) % 60
            time_str = "24:00" if (h == 24 and m == 0) else f"{h:02d}:{m:02d}"
            
            p_doc = price_map.get(time_str, {})
            e_doc = econ_map.get(time_str, {})
            release_data = daily_release_map.get(time_str, {})
            
            # 合并数据
            merged_doc = {
                "time_str": time_str,
                "datetime": (start_of_day + timedelta(minutes=i*15)).isoformat(),
                "avg_clearing_price": p_doc.get("avg_clearing_price"),
                "total_clearing_power": p_doc.get("total_clearing_power", 0),
                "thermal_clearing_power": p_doc.get("thermal_clearing_power", 0),
                "hydro_clearing_power": p_doc.get("hydro_clearing_power", 0),
                "wind_clearing_power": p_doc.get("wind_clearing_power", 0),
                "solar_clearing_power": p_doc.get("solar_clearing_power", 0),
                "pumped_storage_clearing_power": p_doc.get("pumped_storage_clearing_power", 0),
                "battery_storage_clearing_power": p_doc.get("battery_storage_clearing_power", 0),
                "price_econ": e_doc.get("clearing_price"),
            }

            # 计算竞价空间
            try:
                load_forecast = float(release_data.get('system_load_forecast', 0))
                wind = float(release_data.get('wind_forecast', 0))
                pv = float(release_data.get('pv_forecast', 0))
                nonmarket = float(release_data.get('nonmarket_unit_forecast', 0))
                tieline = float(release_data.get('tieline_plan', 0))
                market_bidding_space = load_forecast - wind - pv - nonmarket - tieline
                merged_doc['market_bidding_space'] = round(market_bidding_space, 2)
                
                price_val = merged_doc.get('avg_clearing_price')
                if price_val is not None:
                    prices.append(float(price_val))
                    spaces.append(market_bidding_space)
            except (TypeError, ValueError):
                merged_doc['market_bidding_space'] = 0

            result.append(merged_doc)

        correlation = None
        if len(prices) >= 2 and len(spaces) >= 2:
            try:
                import numpy as np
                correlation = float(np.corrcoef(prices, spaces)[0, 1])
            except Exception: pass

        response_data = {
            "data": result,
            "metadata": {"correlation": round(correlation * 100, 1) if correlation is not None else None}
        }
        return json.loads(json_util.dumps(response_data))

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        logger.error(f"获取日前市场分析数据时出错: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取日前市场分析数据时出错: {str(e)}")

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        logger.error(f"获取日前市场分析数据时出错: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取日前市场分析数据时出错: {str(e)}")


@router.get("/market-analysis/real-time", summary="获取现货市场复盘数据")
def get_real_time_analysis(date: str = Query(..., description="查询日期, 格式 YYYY-MM-DD")):
    """
    获取指定日期的现货市场复盘数据，包括价格、电量、电源出力、价格波动以及市场竞价空间。
    """
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d")

        query = {"date_str": date}
        price_docs = list(RT_PRICE_COLLECTION.find(query, {'_id': 0}).sort("datetime", 1))

        if not price_docs:
            logger.warning(f"未找到日期 {date} 的实时现货价格数据")
            return []

        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        actual_operation_query = {"datetime": {"$gt": start_of_day, "$lte": end_of_day}}
        actual_operation_docs = list(DATABASE['actual_operation'].find(
            actual_operation_query,
            {'_id': 0, 'datetime': 1, 'system_load': 1, 'tieline_flow': 1}
        ).sort("datetime", 1))

        real_time_generation_docs = list(DATABASE['real_time_generation'].find(
            actual_operation_query,
            {
                '_id': 0, 'datetime': 1, 'wind_generation': 1, 'solar_generation': 1,
                'hydro_generation': 1, 'pumped_storage_generation': 1, 'battery_storage_generation': 1
            }
        ).sort("datetime", 1))

        actual_operation_map = {}
        for doc in actual_operation_docs:
            dt = doc['datetime']
            if isinstance(dt, datetime): actual_operation_map[dt] = doc

        real_time_generation_map = {}
        for doc in real_time_generation_docs:
            dt = doc['datetime']
            if isinstance(dt, datetime): real_time_generation_map[dt] = doc

        result = []
        prices = []
        spaces = []

        for i, price_doc in enumerate(price_docs):
            dt = price_doc.get('datetime')
            if isinstance(dt, str):
                try: dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
                except: continue
            if not isinstance(dt, datetime): continue

            if i > 0 and price_doc.get('avg_clearing_price') is not None and price_docs[i-1].get('avg_clearing_price') is not None:
                price_doc['price_ramp'] = price_doc['avg_clearing_price'] - price_docs[i-1]['avg_clearing_price']
            else:
                price_doc['price_ramp'] = None

            actual_op_data = actual_operation_map.get(dt, {})
            generation_data = real_time_generation_map.get(dt, {})

            if actual_op_data and generation_data:
                try:
                    system_load = float(actual_op_data.get('system_load', 0))
                    tieline_flow = float(actual_op_data.get('tieline_flow', 0))
                    wind = float(generation_data.get('wind_generation', 0))
                    solar = float(generation_data.get('solar_generation', 0))
                    hydro = float(generation_data.get('hydro_generation', 0))
                    pumped_storage = float(generation_data.get('pumped_storage_generation', 0))
                    battery_storage = float(generation_data.get('battery_storage_generation', 0))

                    nonmarket_unit = hydro + max(pumped_storage, 0) + max(battery_storage, 0)
                    market_bidding_space = system_load - wind - solar - nonmarket_unit - tieline_flow
                    price_doc['market_bidding_space'] = round(market_bidding_space, 2)

                    price_val = price_doc.get('avg_clearing_price')
                    if price_val is not None:
                        prices.append(float(price_val))
                        spaces.append(market_bidding_space)
                except (TypeError, ValueError):
                    price_doc['market_bidding_space'] = 0
            else:
                price_doc['market_bidding_space'] = 0

            result.append(price_doc)

        correlation = None
        if len(prices) >= 2 and len(spaces) >= 2:
            try:
                import numpy as np
                correlation = float(np.corrcoef(prices, spaces)[0, 1])
            except Exception: pass

        response_data = {
            "data": result,
            "metadata": {"correlation": round(correlation * 100, 1) if correlation is not None else None}
        }
        return json.loads(json_util.dumps(response_data))

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        logger.error(f"获取实时市场分析数据时出错: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取实时市场分析数据时出错: {str(e)}")


@router.get("/market-analysis/spread-attribution", summary="获取价差归因分析数据")
def get_spread_attribution_analysis(date: str = Query(..., description="查询日期, 格式 YYYY-MM-DD")):
    try:
        start_date = datetime.strptime(date, "%Y-%m-%d")
        query = {"date_str": date}

        da_docs = list(DA_PRICE_COLLECTION.find(query, {'_id': 0}).sort("datetime", 1))
        rt_docs = list(RT_PRICE_COLLECTION.find(query, {'_id': 0}).sort("datetime", 1))

        if not da_docs or not rt_docs:
            return {"time_series": [], "systematic_bias": []}

        rt_map = {doc['time_str']: doc for doc in rt_docs}
        
        start_of_day = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        datetime_query = {"datetime": {"$gt": start_of_day, "$lte": end_of_day}}

        daily_release_docs = list(DATABASE['daily_release'].find(
            datetime_query,
            {
                '_id': 0, 'datetime': 1, 'system_load_forecast': 1, 'wind_forecast': 1, 
                'pv_forecast': 1, 'nonmarket_unit_forecast': 1, 'tieline_plan': 1
            }
        ).sort("datetime", 1))

        actual_operation_docs = list(DATABASE['actual_operation'].find(
            datetime_query,
            {'_id': 0, 'datetime': 1, 'system_load': 1, 'tieline_flow': 1}
        ).sort("datetime", 1))

        real_time_generation_docs = list(DATABASE['real_time_generation'].find(
            datetime_query,
            {
                '_id': 0, 'datetime': 1, 'wind_generation': 1, 'solar_generation': 1, 
                'hydro_generation': 1, 'pumped_storage_generation': 1, 'battery_storage_generation': 1
            }
        ).sort("datetime", 1))

        daily_release_map = {}
        for doc in daily_release_docs:
            dt = doc.get('datetime')
            if isinstance(dt, datetime):
                next_day = start_of_day + timedelta(days=1)
                if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date(): time_str = "24:00"
                else: time_str = dt.strftime("%H:%M")
                daily_release_map[time_str] = doc

        actual_op_map = {}
        for doc in actual_operation_docs:
            dt = doc.get('datetime')
            if isinstance(dt, datetime):
                next_day = start_of_day + timedelta(days=1)
                if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date(): time_str = "24:00"
                else: time_str = dt.strftime("%H:%M")
                actual_op_map[time_str] = doc

        generation_map = {}
        for doc in real_time_generation_docs:
            dt = doc.get('datetime')
            if isinstance(dt, datetime):
                next_day = start_of_day + timedelta(days=1)
                if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date(): time_str = "24:00"
                else: time_str = dt.strftime("%H:%M")
                generation_map[time_str] = doc

        tou_rules = get_tou_rule_for_date(start_date)

        time_series = []
        period_collector = {}

        for da_point in da_docs:
            time_str = da_point.get("time_str")
            if not time_str: continue

            rt_point = rt_map.get(time_str, {})
            daily_release_data = daily_release_map.get(time_str, {})
            actual_op_data = actual_op_map.get(time_str, {})
            generation_data = generation_map.get(time_str, {})

            price_spread = (rt_point.get('avg_clearing_price') - da_point.get('avg_clearing_price')) \
                if rt_point.get('avg_clearing_price') is not None and da_point.get('avg_clearing_price') is not None else None

            market_bidding_space_da = 0
            if daily_release_data:
                try:
                    load_forecast = float(daily_release_data.get('system_load_forecast', 0))
                    wind = float(daily_release_data.get('wind_forecast', 0))
                    pv = float(daily_release_data.get('pv_forecast', 0))
                    nonmarket = float(daily_release_data.get('nonmarket_unit_forecast', 0))
                    tieline = float(daily_release_data.get('tieline_plan', 0))
                    market_bidding_space_da = load_forecast - wind - pv - nonmarket - tieline
                except (TypeError, ValueError): pass

            market_bidding_space_rt = 0
            if actual_op_data and generation_data:
                try:
                    system_load = float(actual_op_data.get('system_load', 0))
                    tieline_flow = float(actual_op_data.get('tieline_flow', 0))
                    wind = float(generation_data.get('wind_generation', 0))
                    solar = float(generation_data.get('solar_generation', 0))
                    hydro = float(generation_data.get('hydro_generation', 0))
                    pumped_storage = float(generation_data.get('pumped_storage_generation', 0))
                    battery_storage = float(generation_data.get('battery_storage_generation', 0))
                    nonmarket_unit = hydro + max(pumped_storage, 0) + max(battery_storage, 0)
                    market_bidding_space_rt = system_load - wind - solar - nonmarket_unit - tieline_flow
                except (TypeError, ValueError): pass

            bidding_space_deviation = market_bidding_space_rt - market_bidding_space_da

            system_load_deviation = 0
            renewable_deviation = 0
            nonmarket_unit_deviation = 0
            tieline_deviation = 0

            load_forecast, wind_forecast, pv_forecast = 0, 0, 0
            nonmarket_forecast, tieline_plan = 0, 0
            system_load, tieline_flow = 0, 0
            wind_rt, solar_rt, nonmarket_unit_rt = 0, 0, 0

            if daily_release_data and actual_op_data and generation_data:
                try:
                    load_forecast = float(daily_release_data.get('system_load_forecast', 0))
                    wind_forecast = float(daily_release_data.get('wind_forecast', 0))
                    pv_forecast = float(daily_release_data.get('pv_forecast', 0))
                    nonmarket_forecast = float(daily_release_data.get('nonmarket_unit_forecast', 0))
                    tieline_plan = float(daily_release_data.get('tieline_plan', 0))

                    system_load = float(actual_op_data.get('system_load', 0))
                    tieline_flow = float(actual_op_data.get('tieline_flow', 0))
                    wind_rt = float(generation_data.get('wind_generation', 0))
                    solar_rt = float(generation_data.get('solar_generation', 0))
                    hydro_rt = float(generation_data.get('hydro_generation', 0))
                    pumped_storage_rt = float(generation_data.get('pumped_storage_generation', 0))
                    battery_storage_rt = float(generation_data.get('battery_storage_generation', 0))
                    nonmarket_unit_rt = hydro_rt + max(pumped_storage_rt, 0) + max(battery_storage_rt, 0)

                    system_load_deviation = system_load - load_forecast
                    renewable_deviation = (wind_rt + solar_rt) - (wind_forecast + pv_forecast)
                    nonmarket_unit_deviation = nonmarket_unit_rt - nonmarket_forecast
                    tieline_deviation = tieline_flow - tieline_plan
                except (TypeError, ValueError): pass

            point_data = {
                "time_str": time_str,
                "price_spread": price_spread,
                "total_volume_deviation": bidding_space_deviation,
                "system_load_deviation": system_load_deviation,
                "renewable_deviation": renewable_deviation,
                "nonmarket_unit_deviation": nonmarket_unit_deviation,
                "tieline_deviation": tieline_deviation,
                "system_load_da": load_forecast,
                "system_load_rt": system_load,
                "renewable_da": wind_forecast + pv_forecast,
                "renewable_rt": wind_rt + solar_rt,
                "nonmarket_unit_da": nonmarket_forecast,
                "nonmarket_unit_rt": nonmarket_unit_rt,
                "tieline_da": tieline_plan,
                "tieline_rt": tieline_flow
            }
            time_series.append(point_data)

            period_type = tou_rules.get(time_str, "平段")
            if period_type not in period_collector:
                period_collector[period_type] = {key: [] for key in point_data if key != 'time_str'}
            
            for key, value in point_data.items():
                if key != 'time_str' and value is not None:
                    period_collector[period_type][key].append(value)

        systematic_bias = []
        period_order = ["尖峰", "高峰", "平段", "低谷", "深谷"]
        for period_name in period_order:
            if period_name in period_collector:
                agg_data = {"period_name": period_name}
                for key, values in period_collector[period_name].items():
                    if values: agg_data[f"avg_{key}"] = statistics.mean(values)
                    else: agg_data[f"avg_{key}"] = None
                systematic_bias.append(agg_data)

        price_spreads = [point['price_spread'] for point in time_series if point['price_spread'] is not None]
        price_distribution = []
        if price_spreads:
            min_spread = min(price_spreads)
            max_spread = max(price_spreads)
            spread_range = max_spread - min_spread
            if spread_range > 0:
                bin_width_candidates = [5, 10, 20, 50, 100]
                bin_width = 10
                for width in bin_width_candidates:
                    num_bins = spread_range / width
                    if 10 <= num_bins <= 20:
                        bin_width = width
                        break

                bin_start = (min_spread // bin_width) * bin_width
                bin_end = ((max_spread // bin_width) + 1) * bin_width
                current = bin_start
                while current < bin_end:
                    bin_min = current
                    bin_max = current + bin_width
                    count = sum(1 for spread in price_spreads if bin_min <= spread < bin_max)
                    if count > 0:
                        price_distribution.append({
                            "range_min": bin_min,
                            "range_max": bin_max,
                            "range_label": f"{bin_min:.0f}~{bin_max:.0f}",
                            "count": count
                        })
                    current += bin_width

        return {
            "time_series": time_series,
            "systematic_bias": systematic_bias,
            "price_distribution": price_distribution
        }

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取价差归因分析数据时出错: {str(e)}")
