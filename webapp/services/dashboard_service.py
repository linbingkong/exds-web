# -*- coding: utf-8 -*-
"""交易总览聚合服务。"""

import calendar
import math
import statistics
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from webapp.services.contract_service import ContractService
from webapp.services.customer_load_overview_service import CustomerLoadOverviewService
from webapp.services.customer_profit_analysis_service import CustomerProfitAnalysisService
from webapp.services.monthly_trade_review_service import MonthlyTradeReviewService
from webapp.services.retail_monthly_settlement_service import RetailMonthlySettlementService
from webapp.services.settlement_service import SettlementService
from webapp.services.tou_service import get_tou_rule_by_date
from webapp.tools.mongo import DATABASE


class DashboardService:
    """聚合交易总览首页所需数据。"""
    CUSTOMER_ALERT_MIN_USAGE_SHARE = 3.0
    DEFAULT_NODE_SPOT_PRICE_NAME = "凌云站/500kV.Ⅰ母"

    def __init__(self):
        self.db = DATABASE
        self.contract_service = ContractService(DATABASE)
        self.settlement_service = SettlementService()
        self.retail_monthly_service = RetailMonthlySettlementService()
        self.customer_profit_service = CustomerProfitAnalysisService()
        self.customer_load_service = CustomerLoadOverviewService()
        self.monthly_trade_review_service = MonthlyTradeReviewService(DATABASE)

    def get_current_month(self) -> str:
        return datetime.now().strftime("%Y-%m")

    def get_current_year_month(self) -> tuple[int, int]:
        now = datetime.now()
        return now.year, now.month

    def get_settlement_display_month(self) -> str:
        latest_settlement_date = self._get_latest_settlement_date()
        if latest_settlement_date:
            return latest_settlement_date[:7]
        return self.get_current_month()

    def get_settlement_kpi(self, month: Optional[str] = None) -> Dict[str, Any]:
        month_str = month or self.get_settlement_display_month()
        year, mon = map(int, month_str.split("-"))
        ytd_data = self.customer_profit_service.get_dashboard_data(
            year=year,
            month=mon,
            view_mode="ytd",
            page=1,
            page_size=1,
        )
        overview_data = self._build_settlement_overview(month_str)
        summary = overview_data["summary"]
        return {
            "month": month_str,
            "as_of_date": self._resolve_settlement_as_of_date(overview_data["daily_details"]),
            "kpi": {
                "yearly_gross_profit": round(float(ytd_data["kpi"]["gross_profit"]), 2),
                "monthly_gross_profit": round(float(summary["gross_profit"]), 2),
                "wholesale_avg_price": round(float(summary["wholesale_avg_price"]), 3),
                "retail_avg_price": round(float(summary["retail_avg_price"]), 3),
                "price_spread": round(float(summary["price_spread"]), 3),
            },
            "source_summary": ytd_data["kpi"].get("source_summary") or {},
        }

    def get_settlement_chart(self, month: Optional[str] = None, view_mode: str = "monthly") -> Dict[str, Any]:
        month_str = month or self.get_settlement_display_month()
        if view_mode == "yearly":
            year = int(month_str.split("-")[0])
            return self._build_yearly_settlement_chart(year)

        overview_data = self._build_settlement_overview(month_str)
        detail_map = {item["date"]: item for item in overview_data["daily_details"]}
        year, mon = map(int, month_str.split("-"))
        _, last_day = calendar.monthrange(year, mon)

        cumulative_wholesale_cost = 0.0
        cumulative_wholesale_volume = 0.0
        cumulative_retail_revenue = 0.0
        cumulative_retail_load = 0.0
        chart_rows: List[Dict[str, Any]] = []

        for day in range(1, last_day + 1):
            date_str = f"{month_str}-{day:02d}"
            item = detail_map.get(date_str)
            if not item:
                chart_rows.append(
                    {
                        "date": date_str,
                        "day": f"{day:02d}",
                        "price_spread": None,
                        "cumulative_avg_spread": None,
                        "gross_profit": None,
                        "cumulative_gross_profit": None,
                        "data_status": "missing",
                    }
                )
                continue

            wholesale_cost = float(item.get("wholesale_cost") or 0.0)
            wholesale_volume = float(item.get("volume_mwh") or 0.0)
            retail_revenue = float(item.get("retail_revenue") or 0.0)
            retail_avg_price = float(item.get("retail_avg_price") or 0.0)

            retail_load = 0.0
            if retail_avg_price:
                retail_load = retail_revenue / retail_avg_price

            if item.get("data_status") == "complete":
                cumulative_wholesale_cost += wholesale_cost
                cumulative_wholesale_volume += wholesale_volume
                cumulative_retail_revenue += retail_revenue
                cumulative_retail_load += retail_load

            cumulative_wholesale_avg = (
                cumulative_wholesale_cost / cumulative_wholesale_volume
                if cumulative_wholesale_volume > 0
                else 0.0
            )
            cumulative_retail_avg = (
                cumulative_retail_revenue / cumulative_retail_load
                if cumulative_retail_load > 0
                else 0.0
            )
            cumulative_avg_spread = (
                round(cumulative_retail_avg - cumulative_wholesale_avg, 3)
                if cumulative_wholesale_volume > 0 and cumulative_retail_load > 0
                else None
            )

            chart_rows.append(
                {
                    "date": date_str,
                    "day": f"{day:02d}",
                    "price_spread": item.get("price_spread"),
                    "cumulative_avg_spread": cumulative_avg_spread,
                    "gross_profit": round(float(item.get("daily_profit") or 0.0), 2),
                    "cumulative_gross_profit": round(float(item.get("cumulative_profit") or 0.0), 2),
                    "data_status": item.get("data_status"),
                }
            )

        return {
            "month": month_str,
            "view_mode": "monthly",
            "as_of_date": self._resolve_settlement_as_of_date(overview_data["daily_details"]),
            "chart_data": chart_rows,
        }

    def _build_yearly_settlement_chart(self, year: int) -> Dict[str, Any]:
        current_year, current_month = self.get_current_year_month()
        monthly_summary_map = {
            item["month"]: item
            for item in self.retail_monthly_service.list_monthly_summaries(str(year))
        }
        chart_rows: List[Dict[str, Any]] = []
        cumulative_profit = 0.0
        cumulative_energy = 0.0
        as_of_date: Optional[str] = None

        for mon in range(1, 13):
            month_str = f"{year}-{mon:02d}"
            if year == current_year and mon > current_month:
                chart_rows.append(
                    {
                        "month": month_str,
                        "month_label": f"{mon:02d}",
                        "price_spread": None,
                        "cumulative_avg_spread": None,
                        "gross_profit": None,
                        "cumulative_gross_profit": None,
                        "display_mode": "future",
                    }
                )
                continue

            month_summary = monthly_summary_map.get(month_str) or {}
            has_monthly_settlement = (
                bool(month_summary)
                and bool(month_summary.get("wholesale_settled"))
                and month_summary.get("settlement_total_fee") is not None
                and float(month_summary.get("total_energy_mwh") or 0.0) > 0
            )

            if has_monthly_settlement:
                wholesale_cost = float(month_summary.get("wholesale_total_cost") or 0.0)
                total_energy_mwh = float(month_summary.get("total_energy_mwh") or 0.0)
                settlement_total_fee = float(month_summary.get("settlement_total_fee") or 0.0)
                wholesale_avg_price = float(month_summary.get("wholesale_avg_price") or 0.0)
                gross_profit = settlement_total_fee - wholesale_cost
                price_spread = (
                    round(settlement_total_fee / total_energy_mwh - wholesale_avg_price, 3)
                    if total_energy_mwh > 0
                    else None
                )
                display_mode = "final"
                status = month_summary.get("status") or {}
                month_as_of_date = (
                    status.get("updated_at")
                    or status.get("created_at")
                    or month_str
                )
            else:
                overview_data = self._build_settlement_overview(month_str)
                summary = overview_data["summary"]
                wholesale_cost = float(summary.get("total_wholesale_cost") or 0.0)
                total_energy_mwh = float(summary.get("total_volume_mwh") or 0.0)
                settlement_total_fee = float(summary.get("total_retail_revenue") or 0.0)
                wholesale_avg_price = float(summary.get("wholesale_avg_price") or 0.0)
                gross_profit = settlement_total_fee - wholesale_cost
                price_spread = summary.get("price_spread")
                display_mode = "estimated"
                month_as_of_date = self._resolve_settlement_as_of_date(overview_data["daily_details"])

            has_data = (
                total_energy_mwh > 0
                or settlement_total_fee > 0
                or wholesale_cost > 0
            )
            if has_data:
                cumulative_profit += gross_profit
                cumulative_energy += total_energy_mwh
                if month_as_of_date:
                    as_of_date = month_as_of_date

            cumulative_avg_spread = (
                round(cumulative_profit / cumulative_energy, 3)
                if cumulative_energy > 0
                else None
            )

            chart_rows.append(
                {
                    "month": month_str,
                    "month_label": f"{mon:02d}",
                    "price_spread": round(float(price_spread), 3) if price_spread is not None else None,
                    "cumulative_avg_spread": cumulative_avg_spread,
                    "gross_profit": round(float(gross_profit), 2),
                    "cumulative_gross_profit": round(float(cumulative_profit), 2),
                    "display_mode": display_mode,
                    "wholesale_avg_price": round(wholesale_avg_price, 3) if wholesale_avg_price else None,
                }
            )

        return {
            "month": f"{year}",
            "view_mode": "yearly",
            "as_of_date": as_of_date,
            "chart_data": chart_rows,
        }

    def get_trade_summary(self, month: Optional[str] = None) -> Dict[str, Any]:
        month_str = month or self.get_settlement_display_month()
        detail = self.monthly_trade_review_service.get_monthly_detail(month_str)
        return {
            "month": month_str,
            "type_cards": detail.type_cards,
            "updated_at": getattr(detail, "updated_at", None),
        }

    def get_customer_overview(self, year: Optional[int] = None, month: Optional[int] = None) -> Dict[str, Any]:
        target_year, target_month = self.get_current_year_month()
        query_year = year or target_year
        query_month = month or target_month

        monthly_load_data = self.customer_load_service.get_dashboard_data(
            year=query_year,
            month=query_month,
            view_mode="monthly",
            page=1,
            page_size=1,
        )
        ytd_load_data = self.customer_load_service.get_dashboard_data(
            year=query_year,
            month=query_month,
            view_mode="ytd",
            sort_field="actual_usage",
            sort_order="desc",
            page=1,
            page_size=1000,
        )
        actual_total_usage = round(float(ytd_load_data["kpi"].get("actual_total_usage") or 0.0), 2)
        top_customer_distribution = []
        top_usage_sum = 0.0
        for item in ytd_load_data.get("customer_list", {}).get("items", [])[:6]:
            usage = round(float(item.get("actual_usage") or 0.0), 2)
            top_usage_sum += usage
            percentage = round((usage / actual_total_usage * 100), 1) if actual_total_usage > 0 else 0.0
            top_customer_distribution.append(
                {
                    "name": item.get("short_name") or item.get("customer_name") or "未命名客户",
                    "usage_mwh": usage,
                    "percentage": percentage,
                }
            )
        others_usage = round(max(actual_total_usage - top_usage_sum, 0.0), 2)
        if others_usage > 0:
            top_customer_distribution.append(
                {
                    "name": "其他",
                    "usage_mwh": others_usage,
                    "percentage": round((others_usage / actual_total_usage * 100), 1) if actual_total_usage > 0 else 0.0,
                }
            )
        return {
            "year": query_year,
            "month": query_month,
            "current_valid_customers": monthly_load_data["kpi"]["valid_customers_count"],
            "yearly_contract_customers": monthly_load_data["kpi"]["signed_customers_count"],
            "signed_quantity_mwh": round(float(monthly_load_data["kpi"]["signed_total_quantity"] or 0.0), 2),
            "actual_total_usage_mwh": actual_total_usage,
            "signed_quantity_yoy": monthly_load_data["kpi"]["signed_quantity_yoy"],
            "top_customer_distribution": top_customer_distribution,
        }

    def get_customer_profit_contribution(self, year: Optional[int] = None, month: Optional[int] = None) -> Dict[str, Any]:
        target_year, target_month = self.get_current_year_month()
        query_year = year or target_year
        query_month = month or target_month
        data = self.customer_profit_service.get_dashboard_data(
            year=query_year,
            month=query_month,
            view_mode="ytd",
            page=1,
            page_size=1,
        )
        return {
            "year": query_year,
            "month": query_month,
            "positive_contribution": data["positive_contribution"],
            "negative_contribution": data["negative_contribution"],
        }

    def get_customer_load_ranking(self, year: Optional[int] = None, month: Optional[int] = None) -> Dict[str, Any]:
        target_year, target_month = self.get_current_year_month()
        query_year = year or target_year
        query_month = month or target_month
        data = self.customer_load_service.get_dashboard_data(
            year=query_year,
            month=query_month,
            view_mode="monthly",
            page=1,
            page_size=10,
        )
        contribution = data["contribution"]
        items = [
            {
                "customer_id": item.get("customer_id"),
                "short_name": item.get("short_name"),
                "usage": round(float(item.get("usage") or 0.0), 2),
                "percentage": round(float(item.get("percentage") or 0.0), 1),
            }
            for item in contribution.get("top5", [])
        ]
        others = contribution.get("others") or {"usage": 0.0, "percentage": 0.0}
        if float(others.get("usage") or 0.0) > 0:
            items.append(
                {
                    "customer_id": None,
                    "short_name": "其他",
                    "usage": round(float(others.get("usage") or 0.0), 2),
                    "percentage": round(float(others.get("percentage") or 0.0), 1),
                }
            )

        return {
            "year": query_year,
            "month": query_month,
            "total_usage_mwh": round(float(contribution.get("total") or 0.0), 2),
            "items": items,
        }

    def get_alerts(self, limit: int = 10) -> Dict[str, Any]:
        rows = self._load_system_alerts(limit)
        rows.sort(key=lambda item: item["created_at"], reverse=True)
        return {
            "items": rows[:limit],
            "total": len(rows[:limit]),
        }

    def get_market_intraday(self, date: Optional[str] = None) -> Dict[str, Any]:
        target_date = date or datetime.now().strftime("%Y-%m-%d")
        if not target_date:
            return {
                "date": None,
                "stats": {
                    "real_time_avg": None,
                    "econ_avg": None,
                    "avg_spread": None,
                },
                "fallback": {
                    "enabled": False,
                    "node_name": self.DEFAULT_NODE_SPOT_PRICE_NAME,
                },
                "chart_data": [],
            }

        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        rt_docs = list(
            self.db["real_time_spot_price"].find(
                {"date_str": target_date},
                {"_id": 0, "time_str": 1, "avg_clearing_price": 1},
            ).sort("datetime", 1)
        )
        econ_docs = list(
            self.db["day_ahead_econ_price"].find(
                {"date_str": target_date},
                {"_id": 0, "time_str": 1, "clearing_price": 1},
            ).sort("datetime", 1)
        )
        node_daily_doc = self.db["node_spot_price_daily"].find_one(
            {"node_name": self.DEFAULT_NODE_SPOT_PRICE_NAME, "date": target_date},
            {"_id": 0, "points": 1},
        )

        rt_map = {
            str(doc.get("time_str")): self._safe_finite_float(doc.get("avg_clearing_price"))
            for doc in rt_docs
            if doc.get("time_str")
        }
        econ_map = {
            str(doc.get("time_str")): self._safe_finite_float(doc.get("clearing_price"))
            for doc in econ_docs
            if doc.get("time_str")
        }
        node_map = self._build_node_15m_price_map((node_daily_doc or {}).get("points", []))
        has_rt_published = any(value is not None for value in rt_map.values())
        use_node_fallback = (not has_rt_published) and bool(node_map)

        times = sorted(set(rt_map.keys()) | set(econ_map.keys()) | set(node_map.keys()))
        if not times:
            times = [
                "24:00" if quarter == 96 else f"{(quarter * 15) // 60:02d}:{(quarter * 15) % 60:02d}"
                for quarter in range(1, 97)
            ]
        tou_rules = get_tou_rule_by_date(target_dt)

        chart_data: List[Dict[str, Any]] = []
        real_time_values: List[float] = []
        econ_values: List[float] = []
        spread_values: List[float] = []

        for time_str in times:
            price_rt = rt_map.get(time_str)
            node_rt_price = node_map.get(time_str)
            display_rt_price = node_rt_price if use_node_fallback else price_rt
            price_econ = econ_map.get(time_str)
            period_type = tou_rules.get(time_str, "平段")
            if display_rt_price is not None:
                real_time_values.append(display_rt_price)
            if price_econ is not None:
                econ_values.append(price_econ)
            if display_rt_price is not None and price_econ is not None:
                spread_values.append(display_rt_price - price_econ)

            chart_data.append(
                {
                    "time": time_str,
                    "price_rt": round(price_rt, 3) if price_rt is not None else None,
                    "price_rt_display": round(display_rt_price, 3) if display_rt_price is not None else None,
                    "price_rt_fallback": round(node_rt_price, 3) if node_rt_price is not None else None,
                    "price_rt_is_fallback": bool(use_node_fallback and node_rt_price is not None),
                    "price_econ": round(price_econ, 3) if price_econ is not None else None,
                    "period_type": period_type,
                }
            )

        real_time_avg = statistics.mean(real_time_values) if real_time_values else None
        econ_avg = statistics.mean(econ_values) if econ_values else None
        avg_spread = statistics.mean(spread_values) if spread_values else None

        return {
            "date": target_date,
            "stats": {
                "real_time_avg": round(real_time_avg, 3) if real_time_avg is not None else None,
                "econ_avg": round(econ_avg, 3) if econ_avg is not None else None,
                "avg_spread": round(avg_spread, 3) if avg_spread is not None else None,
            },
            "fallback": {
                "enabled": use_node_fallback,
                "node_name": self.DEFAULT_NODE_SPOT_PRICE_NAME,
            },
            "chart_data": chart_data,
        }

    def _build_settlement_overview(self, month: str) -> Dict[str, Any]:
        year, mon = map(int, month.split("-"))
        _, last_day = calendar.monthrange(year, mon)
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"
        db = self.settlement_service.db

        wholesale_cursor = db.settlement_daily.find(
            {"operating_date": {"$gte": start_date, "$lte": end_date}, "version": "PRELIMINARY"},
            projection={"period_details": 0},
        ).sort("operating_date", 1)

        wholesale_by_date: Dict[str, Dict[str, Any]] = {}
        for doc in wholesale_cursor:
            operating_date = str(doc["operating_date"])
            wholesale_by_date[operating_date] = {
                "volume_mwh": doc.get("real_time_volume", 0) or 0,
                "wholesale_cost": doc.get("predicted_wholesale_cost", 0) or 0,
                "deviation_recovery_fee": doc.get("deviation_recovery_fee", 0) or 0,
                "wholesale_avg_price": doc.get("predicted_wholesale_price", 0) or 0,
            }

        retail_results = list(
            db.retail_settlement_daily.aggregate(
                [
                    {
                        "$match": {
                            "date": {"$gte": start_date, "$lte": end_date},
                            "settlement_type": "daily",
                        }
                    },
                    {
                        "$group": {
                            "_id": "$date",
                            "total_fee": {"$sum": "$total_fee"},
                            "total_load": {"$sum": "$total_load_mwh"},
                            "customer_count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"_id": 1}},
                ]
            )
        )
        retail_by_date = {
            str(item["_id"]): {
                "retail_revenue": item.get("total_fee", 0) or 0,
                "retail_load": item.get("total_load", 0) or 0,
                "customer_count": item.get("customer_count", 0) or 0,
            }
            for item in retail_results
        }

        all_dates = sorted(set(list(wholesale_by_date.keys()) + list(retail_by_date.keys())))
        daily_details: List[Dict[str, Any]] = []
        cumulative_profit = 0.0
        total_wholesale_cost = 0.0
        total_retail_revenue = 0.0
        total_volume = 0.0
        total_retail_load = 0.0
        total_deviation_recovery = 0.0
        max_customer_count = 0

        for date_str in all_dates:
            wholesale_exists = date_str in wholesale_by_date
            wholesale = wholesale_by_date.get(
                date_str,
                {"volume_mwh": 0, "wholesale_cost": 0, "deviation_recovery_fee": 0, "wholesale_avg_price": 0},
            )
            retail = retail_by_date.get(date_str, {"retail_revenue": 0, "retail_load": 0, "customer_count": 0})

            retail_avg_price = (
                round(float(retail["retail_revenue"]) / float(retail["retail_load"]), 3)
                if float(retail["retail_load"]) > 0
                else 0
            )

            if wholesale_exists:
                price_spread = round(retail_avg_price - float(wholesale["wholesale_avg_price"]), 3)
                daily_profit = round(float(retail["retail_revenue"]) - float(wholesale["wholesale_cost"]), 2)
                cumulative_profit = round(cumulative_profit + daily_profit, 2)
                total_wholesale_cost += float(wholesale["wholesale_cost"])
                total_retail_revenue += float(retail["retail_revenue"])
                total_volume += float(wholesale["volume_mwh"])
                total_retail_load += float(retail["retail_load"])
                total_deviation_recovery += float(wholesale["deviation_recovery_fee"])
                max_customer_count = max(max_customer_count, int(retail["customer_count"]))
            else:
                price_spread = 0
                daily_profit = 0

            daily_details.append(
                {
                    "date": date_str,
                    "volume_mwh": round(float(wholesale["volume_mwh"]), 3),
                    "wholesale_cost": round(float(wholesale["wholesale_cost"]), 2),
                    "deviation_recovery_fee": round(float(wholesale["deviation_recovery_fee"]), 2),
                    "wholesale_avg_price": round(float(wholesale["wholesale_avg_price"]), 3),
                    "retail_revenue": round(float(retail["retail_revenue"]), 2),
                    "retail_avg_price": retail_avg_price,
                    "price_spread": price_spread,
                    "daily_profit": daily_profit,
                    "cumulative_profit": cumulative_profit,
                    "data_status": "complete" if wholesale_exists else "wholesale_missing",
                }
            )

        wholesale_avg = round(total_wholesale_cost / total_volume, 3) if total_volume > 0 else 0
        retail_avg = round(total_retail_revenue / total_retail_load, 3) if total_retail_load > 0 else 0
        gross_profit = round(total_retail_revenue - total_wholesale_cost, 2)

        return {
            "month": month,
            "summary": {
                "customer_count": max_customer_count,
                "settlement_start": all_dates[0] if all_dates else start_date,
                "settlement_end": all_dates[-1] if all_dates else end_date,
                "total_wholesale_cost": round(total_wholesale_cost, 2),
                "total_retail_revenue": round(total_retail_revenue, 2),
                "total_volume_mwh": round(total_volume, 3),
                "total_deviation_recovery_fee": round(total_deviation_recovery, 2),
                "wholesale_avg_price": wholesale_avg,
                "retail_avg_price": retail_avg,
                "price_spread": round(retail_avg - wholesale_avg, 3),
                "gross_profit": gross_profit,
            },
            "daily_details": daily_details,
        }

    def _resolve_settlement_as_of_date(self, daily_details: List[Dict[str, Any]]) -> Optional[str]:
        available = [
            item["date"]
            for item in daily_details
            if item.get("data_status") == "complete"
            and (
                float(item.get("volume_mwh") or 0) > 0
                or float(item.get("retail_revenue") or 0) > 0
            )
        ]
        return available[-1] if available else None

    def _get_latest_settlement_date(self) -> Optional[str]:
        cursor = self.db["settlement_daily"].find(
            {
                "version": "PRELIMINARY",
                "operating_date": {"$exists": True, "$ne": None},
            },
            {
                "_id": 0,
                "operating_date": 1,
                "real_time_volume": 1,
                "predicted_wholesale_cost": 1,
                "deviation_recovery_fee": 1,
            },
        ).sort("operating_date", -1).limit(60)

        for doc in cursor:
            operating_date = str(doc.get("operating_date") or "")
            if not operating_date:
                continue

            has_settlement_value = any(
                float(doc.get(field) or 0.0) != 0.0
                for field in ("real_time_volume", "predicted_wholesale_cost", "deviation_recovery_fee")
            )
            if has_settlement_value:
                return operating_date

        return None

    def _build_contract_distribution(self, year: int, month: int) -> List[Dict[str, Any]]:
        start_date = datetime(year, month, 1)
        _, last_day = calendar.monthrange(year, month)
        end_date = datetime(year, month, last_day, 23, 59, 59)
        pipeline = [
            {
                "$match": {
                    "purchase_start_month": {"$lte": end_date},
                    "purchase_end_month": {"$gte": start_date},
                }
            },
            {
                "$group": {
                    "_id": {"$ifNull": ["$package_name", "未分类"]},
                    "customer_count": {"$addToSet": "$customer_id"},
                    "signed_quantity": {"$sum": {"$ifNull": ["$purchasing_electricity_quantity", 0]}},
                }
            },
            {"$sort": {"signed_quantity": -1}},
        ]
        rows = []
        for item in self.db["retail_contracts"].aggregate(pipeline):
            rows.append(
                {
                    "name": str(item["_id"] or "未分类"),
                    "customer_count": len(item.get("customer_count", [])),
                    "signed_quantity_mwh": round(float(item.get("signed_quantity") or 0.0) / 1000, 2),
                }
            )
        return rows

    def _load_system_alerts(self, limit: int) -> List[Dict[str, Any]]:
        cursor = self.db["system_alerts"].find({"status": "ACTIVE"}).sort("created_at", -1).limit(limit)
        items = []
        for doc in cursor:
            created_at = doc.get("created_at")
            if not isinstance(created_at, datetime):
                continue
            items.append(
                {
                    "source": "system_alerts",
                    "alert_id": str(doc.get("alert_id") or doc.get("_id")),
                    "level": str(doc.get("level") or "P3"),
                    "title": str(doc.get("title") or "系统告警"),
                    "content": str(doc.get("content") or ""),
                    "status": str(doc.get("status") or "ACTIVE"),
                    "created_at": created_at,
                    "link": "/system-settings/system-logs",
                }
            )
        return items

    def _get_active_customer_ids(self) -> List[str]:
        now = datetime.now()
        start_of_month = datetime(now.year, now.month, 1)
        if now.month == 12:
            next_month = datetime(now.year + 1, 1, 1)
        else:
            next_month = datetime(now.year, now.month + 1, 1)
        end_of_month = next_month.replace(hour=23, minute=59, second=59) - datetime.resolution
        rows = self.contract_service.get_signed_customers_in_range(start_of_month, end_of_month)
        return [str(item.get("customer_id") or "") for item in rows if item.get("customer_id")]

    def _get_customer_usage_share_map(self) -> Dict[str, float]:
        year, month = self.get_current_year_month()
        data = self.customer_load_service.get_dashboard_data(
            year=year,
            month=month,
            view_mode="monthly",
            page=1,
            page_size=500,
        )
        total_usage = float((data.get("kpi") or {}).get("actual_total_usage") or 0.0)
        if total_usage <= 0:
            return {}

        result: Dict[str, float] = {}
        for item in ((data.get("customer_list") or {}).get("items") or []):
            customer_id = str(item.get("customer_id") or "")
            if not customer_id:
                continue
            usage = float(item.get("actual_usage") or 0.0)
            result[customer_id] = round(usage / total_usage * 100, 4)
        return result

    def _load_customer_anomaly_alerts(self, limit: int) -> List[Dict[str, Any]]:
        active_customer_ids = self._get_active_customer_ids()
        if not active_customer_ids:
            return []
        usage_share_map = self._get_customer_usage_share_map()
        qualified_customer_ids = [
            customer_id
            for customer_id in active_customer_ids
            if usage_share_map.get(customer_id, 0.0) > self.CUSTOMER_ALERT_MIN_USAGE_SHARE
        ]
        if not qualified_customer_ids:
            return []

        pipeline = [
            {"$match": {"acknowledged": False, "customer_id": {"$in": qualified_customer_ids}}},
            {"$sort": {"created_at": -1, "alert_date": -1}},
            {
                "$group": {
                    "_id": {"cid": "$customer_id", "type": "$alert_type"},
                    "doc": {"$first": "$$ROOT"},
                }
            },
            {"$replaceRoot": {"newRoot": "$doc"}},
            {"$sort": {"created_at": -1, "alert_date": -1}},
            {"$limit": limit},
        ]
        items = []
        for doc in self.db["customer_anomaly_alerts"].aggregate(pipeline):
            created_at = doc.get("created_at")
            if not isinstance(created_at, datetime):
                continue
            severity = str(doc.get("severity") or "warning")
            level = {
                "critical": "P1",
                "warning": "P2",
                "low": "P3",
            }.get(severity, "P3")
            items.append(
                {
                    "source": "customer_anomaly_alerts",
                    "alert_id": str(doc.get("_id")),
                    "customer_id": str(doc.get("customer_id") or ""),
                    "customer_name": str(doc.get("customer_name") or "未知客户"),
                    "level": level,
                    "title": f"{doc.get('customer_name') or '未知客户'} {doc.get('alert_type') or '异动告警'}",
                    "content": str(doc.get("reason") or ""),
                    "status": "ACTIVE",
                    "created_at": created_at,
                    "link": f"/customer/load-characteristics/{doc.get('customer_id')}",
                }
            )
        return items

    def _get_latest_market_intraday_date(self) -> Optional[str]:
        recent_econ_dates = [
            str(doc.get("date_str"))
            for doc in self.db["day_ahead_econ_price"].find(
                {},
                {"_id": 0, "date_str": 1},
                sort=[("date_str", -1)],
                limit=14,
            )
            if doc.get("date_str")
        ]
        for date_str in recent_econ_dates:
            has_rt = self.db["real_time_spot_price"].count_documents({"date_str": date_str}, limit=1) > 0
            if has_rt:
                return date_str
        latest_rt = self.db["real_time_spot_price"].find_one({}, {"_id": 0, "date_str": 1}, sort=[("date_str", -1)])
        return str(latest_rt.get("date_str")) if latest_rt and latest_rt.get("date_str") else None

    def _build_node_15m_price_map(self, points: List[Dict[str, Any]]) -> Dict[str, float]:
        if not points:
            return {}

        raw_price_map: Dict[str, float] = {}
        for point in points:
            time_str = point.get("time")
            cq_price = self._safe_finite_float(point.get("cq_price"))
            if time_str and cq_price is not None:
                raw_price_map[str(time_str)] = cq_price

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
                    2,
                )

        return aggregated_map

    def _safe_finite_float(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            return None
        return numeric_value if math.isfinite(numeric_value) else None
