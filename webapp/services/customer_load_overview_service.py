# -*- coding: utf-8 -*-
"""
客户负荷总览服务
提供客户总览页面的KPI、图表、列表数据查询
"""

import logging
from typing import List, Dict, Optional, Any
from datetime import datetime
from calendar import monthrange
from pymongo.database import Database
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.services.load_query_service import LoadQueryService
from webapp.services.contract_service import ContractService
from webapp.models.load_models import TouUsage, MonthlyTotal

logger = logging.getLogger(__name__)


class CustomerLoadOverviewService:
    """客户负荷总览服务"""
    
    def __init__(self, db: Database = None):
        self.db = db if db is not None else DATABASE
        self.load_service = LoadQueryService()
        self.contract_service = ContractService(self.db)
        self.customer_collection = self.db['customer_archives']
        self.contract_collection = self.db['retail_contracts']
        self.load_collection = self.db['unified_load_curve']
    
    def _get_date_range(self, year: int, month: int, view_mode: str) -> tuple:
        """
        根据年月和视图模式获取日期范围
        """
        if view_mode == 'ytd':
            start_date = f"{year}-01-01"
        else:
            start_date = f"{year}-{month:02d}-01"
        
        _, last_day = monthrange(year, month)
        end_date = f"{year}-{month:02d}-{last_day:02d}"
        
        return start_date, end_date
    
    def _get_last_year_comparison_range(self, year: int, month: int, view_mode: str) -> tuple:
        """
        计算去年同期的日期范围。
        如果是当前月份，则限制去年同期的结束日期为"同月同日"（MTD对比）。
        """
        last_year = year - 1
        now = datetime.now()
        is_current_month = (year == now.year and month == now.month)
        
        if view_mode == 'ytd':
            ly_start = f"{last_year}-01-01"
        else:
            ly_start = f"{last_year}-{month:02d}-01"
            
        _, ly_last_day = monthrange(last_year, month)
        ly_end = f"{last_year}-{month:02d}-{ly_last_day:02d}"
        
        if is_current_month:
            try:
                cap_date = datetime(last_year, now.month, now.day)
                ly_end_cap = cap_date.strftime("%Y-%m-%d")
                if ly_end_cap < ly_end:
                    ly_end = ly_end_cap
            except ValueError:
                if now.month == 2 and now.day == 29:
                    pass

        return ly_start, ly_end

    def _get_signed_customers(self, year: int, month: int) -> List[Dict]:
        """获取指定年月的签约客户列表"""
        return self._get_signed_customers_by_ids(year, month, None)

    def _get_signed_customers_by_ids(self, year: int, month: int, customer_ids: Optional[List[str]]) -> List[Dict]:
        """获取指定年月的签约客户列表，可按 customer_id 预过滤"""
        if customer_ids is not None and not customer_ids:
            return []

        start_of_year = datetime(year, 1, 1)
        end_of_year = datetime(year, 12, 31, 23, 59, 59)

        match_query = {
            "purchase_start_month": {"$lte": end_of_year},
            "purchase_end_month": {"$gte": start_of_year}
        }
        if customer_ids is not None:
            match_query["customer_id"] = {"$in": customer_ids}

        pipeline = [
            {"$match": match_query},
            {
                "$group": {
                    "_id": "$customer_id",
                    "customer_name": {"$first": "$customer_name"},
                    "signed_quantity": {"$sum": "$purchasing_electricity_quantity"},
                    "contract_start_month": {"$min": {"$month": "$purchase_start_month"}},
                    "contract_end_month": {"$max": {"$month": "$purchase_end_month"}}
                }
            }
        ]
        
        contracts = list(self.contract_collection.aggregate(pipeline))
        
        # 批量获取客户简称
        customer_ids = [ObjectId(c["_id"]) for c in contracts if ObjectId.is_valid(c["_id"])]
        cid_map = {}
        if customer_ids:
            customers = list(self.customer_collection.find(
                {"_id": {"$in": customer_ids}}, 
                {"short_name": 1}
            ))
            for cust in customers:
                cid_map[str(cust["_id"])] = cust.get("short_name")

        result = []
        for c in contracts:
            customer_id = c["_id"]
            short_name = cid_map.get(customer_id, c["customer_name"])
            
            result.append({
                "customer_id": customer_id,
                "customer_name": c["customer_name"],
                "short_name": short_name,
                "signed_quantity": c["signed_quantity"] / 1000,  # kWh -> MWh
                "contract_start_month": c["contract_start_month"],
                "contract_end_month": c["contract_end_month"]
            })
        
        return result

    def _get_customer_usage_map_batch(
        self, 
        customer_ids: List[str], 
        start_date: str, 
        end_date: str
    ) -> Dict[str, Dict]:
        """
        批量获取客户负荷数据 (Backend Batch Processing)
        Returns: {customer_id: {"total": float, "tou_usage": TouUsage}}
        """
        if not customer_ids:
            return {}
            
        # 使用 LoadQueryService.batch_get_daily_totals 一次性获取所有日数据
        # 结果为 {cid: [DailyTotal, ...]}
        batch_daily_data = self.load_service.batch_get_daily_totals(customer_ids, start_date, end_date)
        
        result_map = {}
        for cid, days in batch_daily_data.items():
            total_val = 0.0
            tou_agg = TouUsage()
            
            for dt in days:
                total_val += dt.total
                if dt.tou_usage:
                    tou_agg.tip += dt.tou_usage.tip
                    tou_agg.peak += dt.tou_usage.peak
                    tou_agg.flat += dt.tou_usage.flat
                    tou_agg.valley += dt.tou_usage.valley
                    tou_agg.deep += dt.tou_usage.deep
            
            result_map[cid] = {
                "total": total_val,
                "tou_usage": tou_agg
            }
            
        # 补全没有数据的客户
        for cid in customer_ids:
            if cid not in result_map:
                result_map[cid] = {"total": 0.0, "tou_usage": TouUsage()}
                
        return result_map

    def _calc_peak_valley_ratio(self, tou: TouUsage) -> float:
        """计算峰谷比"""
        peak_usage = tou.tip + tou.peak
        valley_usage = tou.valley + tou.deep
        if valley_usage == 0:
            return 0.0
        return round(peak_usage / valley_usage, 2)

    def get_dashboard_data(
        self, 
        year: int, 
        month: int, 
        view_mode: str,
        search: Optional[str] = None,
        customer_ids: Optional[List[str]] = None,
        sort_field: str = "signed_quantity",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20
    ) -> Dict:
        """
        统一获取概览页所有数据 (Dashboard Unified API)
        
        Returns:
            {
                "kpi": {...},
                "contribution": {...},
                "rankings": {"growth": ..., "efficiency": ...},
                "customer_list": {...}
            }
        """
        # 1. 获取签约客户列表 (Single Query)
        signed_customers = self._get_signed_customers_by_ids(year, month, customer_ids)
        if not signed_customers:
             # 空数据结构返回
             return self._empty_dashboard_response(page, page_size)
             
        customer_ids = [c["customer_id"] for c in signed_customers]
        
        # 2. 准备日期范围
        # 当前时段
        current_start, current_end = self._get_date_range(year, month, view_mode)
        # 去年同期 (用于 KPI 同比, 列表实测同比, 龙虎榜)
        ly_start, ly_end = self._get_last_year_comparison_range(year, month, view_mode)
        # 去年全年 (用于 列表签约规模同比 - 对应各自的合同月)
        # 策略：直接拉取去年全年(1-12月)数据到内存，然后按需切分？
        # 或者更简单：因为 batch_get_daily_totals 是按日聚合的。如果拉取全年365天数据
        # {cid: [DailyTotal(date='2025-01-01'), ...]}
        # 这样我们可以根据每个客户的 contract_start/end_month 在内存中做筛选和累加。
        # 365天 * 100客户 = 3.6万个对象，Python处理完全没问题。
        full_ly_start = f"{year-1}-01-01"
        full_ly_end = f"{year-1}-12-31"
        
        # 3. 批量获取数据 (Batch Queries)
        # Query 1: 当前时段汇总数据 {cid: {total, tou_usage}}
        current_usage_map = self._get_customer_usage_map_batch(customer_ids, current_start, current_end)
        
        # Query 2: 去年同期汇总数据 {cid: {total, tou_usage}}
        last_year_usage_map = self._get_customer_usage_map_batch(customer_ids, ly_start, ly_end)
        
        # Query 3: 去年全年明细数据 {cid: [DailyTotal, ...]} (为了计算变动合同期的同比)
        # 注意：这里调用的是 batch_get_daily_totals 原生返回 list
        full_last_year_days = self.load_service.batch_get_daily_totals(customer_ids, full_ly_start, full_ly_end)
        
        # ---------------- KPI 计算 ----------------
        
        # 静态指标
        signed_customers_count = len(signed_customers)
        signed_total_quantity = sum(c["signed_quantity"] for c in signed_customers)
        
        # 计算当前选中月份的有效客户数 (合同覆盖该月的客户)
        valid_customers_count = sum(1 for c in signed_customers if c["contract_start_month"] <= month <= c["contract_end_month"])
        
        # 签约规模同比 (vs 去年同期实测，按签约期范围)
        last_year_contract_actual = 0.0
        
        # 预处理去年全年数据索引，加速查询
        # full_last_year_days: {cid: [DailyTotal, ...]}
        # 我们可以不需要太复杂的索引，直接遍历 list 筛选 date 范围即可。
        # data is sorted by date.
        
        for c in signed_customers:
            cid = c["customer_id"]
            c_start_mon = c["contract_start_month"]
            c_end_mon = c["contract_end_month"]
            
            # 筛选日期范围
            # 去年对应的月份范围
            # 简单起见，字符串比较 YYYY-MM
            days = full_last_year_days.get(cid, [])
            c_ly_total = 0.0
            for d in days:
                # d.date format YYYY-MM-DD
                d_mon = int(d.date.split("-")[1])
                if c_start_mon <= d_mon <= c_end_mon:
                    c_ly_total += d.total
            
            last_year_contract_actual += c_ly_total
            # 保存到客户对象中供列表使用
            c["ly_contract_usage"] = c_ly_total

        signed_quantity_yoy = None
        if last_year_contract_actual > 0:
            signed_quantity_yoy = round((signed_total_quantity - last_year_contract_actual) / last_year_contract_actual * 100, 1)
        
        # 动态指标：当前总电量
        total_usage = 0.0
        total_tou = TouUsage()
        
        # 去年同期实测总电量
        last_year_total = 0.0
        
        for cid, u_data in current_usage_map.items():
            total_usage += u_data["total"]
            t = u_data["tou_usage"]
            total_tou.tip += t.tip
            total_tou.peak += t.peak
            total_tou.flat += t.flat
            total_tou.valley += t.valley
            total_tou.deep += t.deep
            
        for cid, u_data in last_year_usage_map.items():
            last_year_total += u_data["total"]
            
        actual_usage_yoy = None
        if last_year_total > 0:
             actual_usage_yoy = round((total_usage - last_year_total) / last_year_total * 100, 1)
             
        avg_pv_ratio = self._calc_peak_valley_ratio(total_tou)
        
        kpi_data = {
            "signed_customers_count": signed_customers_count,
            "valid_customers_count": valid_customers_count,
            "signed_total_quantity": round(signed_total_quantity, 2),
            "signed_quantity_yoy": signed_quantity_yoy,
            "actual_total_usage": round(total_usage, 2),
            "actual_usage_yoy": actual_usage_yoy,
            "avg_peak_valley_ratio": avg_pv_ratio,
            "tou_breakdown": total_tou.model_dump()
        }
        
        # ---------------- 贡献图表 & 排名数据准备 ----------------
        
        # 组装每个客户的完整信息对象
        enriched_customers = []
        for c in signed_customers:
            cid = c["customer_id"]
            current_u = current_usage_map.get(cid, {"total": 0.0, "tou_usage": TouUsage()})
            ly_u = last_year_usage_map.get(cid, {"total": 0.0})
            
            curr_total = current_u["total"]
            ly_total = ly_u["total"]
            
            # 同比计算
            actual_yoy_pct = None
            if ly_total > 0:
                actual_yoy_pct = round((curr_total - ly_total) / ly_total * 100, 1)
                
            # 签约同比计算 (已在 KPI 循环中计算了 ly_contract_usage)
            ly_contract_total = c.get("ly_contract_usage", 0.0)
            signed_yoy_pct = None
            signed_yoy_warning = False
            if ly_contract_total > 0:
                signed_yoy_pct = round((c["signed_quantity"] - ly_contract_total) / ly_contract_total * 100, 1)
                signed_yoy_warning = abs(signed_yoy_pct) > 50
                
            change_val = curr_total - ly_total
            pv_ratio = self._calc_peak_valley_ratio(current_u["tou_usage"])
            
            enriched_customers.append({
                "customer_id": cid,
                "customer_name": c["customer_name"],
                "short_name": c["short_name"],
                "signed_quantity": c["signed_quantity"],
                "signed_yoy": signed_yoy_pct,
                "signed_yoy_warning": signed_yoy_warning,
                "actual_usage": curr_total,
                "actual_yoy": actual_yoy_pct,
                "change_val": change_val,  # 增量值
                "peak_valley_ratio": pv_ratio,
                "tou_breakdown": current_u["tou_usage"],
                "contract_start_month": c["contract_start_month"],
                "contract_end_month": c["contract_end_month"],
                "ly_contract_usage": ly_contract_total # Keep for debug if needed
            })
            
        # ---------------- 贡献图表 ----------------
        # 按使用量降序
        by_usage = sorted(enriched_customers, key=lambda x: x["actual_usage"], reverse=True)
        contrib_top5 = []
        chart_total_usage = sum(x["actual_usage"] for x in by_usage) or 1.0 # Avoid div/0
        
        for x in by_usage[:5]:
             pct = round(x["actual_usage"] / chart_total_usage * 100, 1) if x["actual_usage"] > 0 else 0
             contrib_top5.append({
                 "customer_id": x["customer_id"],
                 "short_name": x["short_name"],
                 "usage": round(x["actual_usage"], 2),
                 "percentage": pct
             })
        
        others_usage = sum(x["actual_usage"] for x in by_usage[5:])
        others_pct = round(others_usage / chart_total_usage * 100, 1) if others_usage > 0 else 0
        
        contribution_data = {
            "top5": contrib_top5,
            "others": {"usage": round(others_usage, 2), "percentage": others_pct},
            "total": round(chart_total_usage if chart_total_usage > 1.0 else 0, 2)
        }
        
        # ---------------- 龙虎榜 & 峰谷榜 ----------------
        
        # 涨跌榜 (Non-zero change ideally, unless we want to show 0s)
        # Filter out zero current usage? No, decline might assume current is 0.
        growth_list = [x for x in enriched_customers if x["change_val"] > 0]
        growth_list.sort(key=lambda x: x["change_val"], reverse=True)
        
        decline_list = [x for x in enriched_customers if x["change_val"] < 0]
        decline_list.sort(key=lambda x: x["change_val"]) # Ascending (most negative first)
        
        def format_rank_item(item):
            return {
                "customer_id": item["customer_id"],
                "short_name": item["short_name"],
                "change": round(item["change_val"], 2),
                "yoy_pct": item["actual_yoy"]
            }
            
        growth_top5 = [format_rank_item(x) for x in growth_list[:5]]
        decline_top5 = [format_rank_item(x) for x in decline_list[:5]]
        
        # 峰谷榜 (Usage > 0 only)
        # 过滤掉 usage=0 的，因为 pv_ratio 也是 0
        valid_usage_custs = [x for x in enriched_customers if x["actual_usage"] > 0]
        valid_usage_custs.sort(key=lambda x: x["peak_valley_ratio"], reverse=True)
        
        high_pv = [{"customer_id": x["customer_id"], "short_name": x["short_name"], "pv_ratio": x["peak_valley_ratio"]} for x in valid_usage_custs[:5]]
        # For low PV, sort ascending
        low_pv_list = sorted(valid_usage_custs, key=lambda x: x["peak_valley_ratio"])
        low_pv = [{"customer_id": x["customer_id"], "short_name": x["short_name"], "pv_ratio": x["peak_valley_ratio"]} for x in low_pv_list[:5]]
        
        ranking_data = {
            "growth": {"growth_top5": growth_top5, "decline_top5": decline_top5},
            "efficiency": {"high_pv_ratio": high_pv, "low_pv_ratio": low_pv}
        }
        
        # ---------------- 客户列表 (过滤、排序、分页) ----------------
        
        filtered_items = enriched_customers
        if search:
            s = search.lower()
            filtered_items = [
                x for x in filtered_items 
                if s in x["customer_name"].lower() or s in x["short_name"].lower()
            ]
            
        # 排序
        reverse = sort_order == "desc"
        # Map frontend sort fields to dict keys
        field_map = {
            "signed_quantity": "signed_quantity",
            "actual_usage": "actual_usage",
            "peak_valley_ratio": "peak_valley_ratio",
            "signed_yoy": "signed_yoy",
            "actual_yoy": "actual_yoy",
            "customer_name": "customer_name"
        }
        key = field_map.get(sort_field, "signed_quantity")
        
        # Safe sort for None values
        def sort_key_fn(x):
            val = x.get(key)
            if val is None:
                return -float('inf') if reverse else float('inf')
            return val
            
        filtered_items.sort(key=sort_key_fn, reverse=reverse)
        
        # 分页
        total_items = len(filtered_items)
        if page_size > 0:
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            paginated = filtered_items[start_idx:end_idx]
        else:
            paginated = filtered_items
            
        # Format for response (TouUsage to dict, rounding)
        formatted_list = []
        for x in paginated:
            formatted_list.append({
                "customer_id": x["customer_id"],
                "customer_name": x["customer_name"],
                "short_name": x["short_name"],
                "signed_quantity": round(x["signed_quantity"], 2),
                "signed_yoy": x["signed_yoy"],
                "signed_yoy_warning": x["signed_yoy_warning"],
                "actual_usage": round(x["actual_usage"], 2),
                "actual_yoy": x["actual_yoy"],
                "peak_valley_ratio": x["peak_valley_ratio"],
                "tou_breakdown": x["tou_breakdown"].model_dump(),
                "contract_start_month": x["contract_start_month"],
                "contract_end_month": x["contract_end_month"]
            })
            
        customer_list_data = {
            "total": total_items,
            "page": page,
            "page_size": page_size,
            "items": formatted_list
        }
        
        return {
            "kpi": kpi_data,
            "contribution": contribution_data,
            "rankings": ranking_data,
            "customer_list": customer_list_data
        }

    def _empty_dashboard_response(self, page, page_size):
        return {
            "kpi": {
                "signed_customers_count": 0, "valid_customers_count": 0, "signed_total_quantity": 0, "signed_quantity_yoy": None,
                "actual_total_usage": 0, "actual_usage_yoy": None, "avg_peak_valley_ratio": 0, "tou_breakdown": TouUsage().model_dump()
            },
            "contribution": {"top5": [], "others": {"usage": 0, "percentage": 0}, "total": 0},
            "rankings": {
                "growth": {"growth_top5": [], "decline_top5": []},
                "efficiency": {"high_pv_ratio": [], "low_pv_ratio": []}
            },
            "customer_list": {"total": 0, "page": page, "page_size": page_size, "items": []}
        }
