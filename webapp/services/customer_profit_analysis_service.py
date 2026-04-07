# -*- coding: utf-8 -*-
"""客户收益分析聚合服务。"""

import calendar
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId

from webapp.models.settlement import SettlementVersion
from webapp.services.retail_monthly_settlement_service import RetailMonthlySettlementService
from webapp.tools.mongo import DATABASE


class CustomerProfitAnalysisService:
    """聚合客户收益分析页面所需数据。"""

    def __init__(self):
        self.db = DATABASE
        self.monthly_service = RetailMonthlySettlementService()

    def get_dashboard_data(
        self,
        year: int,
        month: int,
        view_mode: str,
        search: Optional[str] = None,
        sort_field: str = "gross_profit",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        months = self._resolve_months(year, month, view_mode)
        source_map = self._resolve_month_sources(months)

        monthly_rows: List[Dict[str, Any]] = []
        for month_str in months:
            if source_map[month_str] == "monthly":
                monthly_rows.extend(self._load_monthly_customer_profit(month_str))
            else:
                monthly_rows.extend(self._load_platform_daily_customer_profit(month_str))

        merged_rows = self._attach_customer_short_names(self._merge_customer_profit_rows(monthly_rows))

        return {
            "kpi": self._build_kpi(merged_rows, source_map),
            "positive_contribution": self._build_contribution(merged_rows, positive=True),
            "negative_contribution": self._build_contribution(merged_rows, positive=False),
            "rankings": self._build_rankings(merged_rows),
            "customer_list": self._build_customer_list(
                merged_rows,
                search=search,
                sort_field=sort_field,
                sort_order=sort_order,
                page=page,
                page_size=page_size,
            ),
        }

    def _resolve_months(self, year: int, month: int, view_mode: str) -> List[str]:
        if month < 1 or month > 12:
            raise ValueError("month 必须在 1 到 12 之间")
        if view_mode not in {"monthly", "ytd"}:
            raise ValueError("view_mode 仅支持 monthly 或 ytd")

        if view_mode == "monthly":
            return [f"{year}-{month:02d}"]
        return [f"{year}-{mon:02d}" for mon in range(1, month + 1)]

    def _resolve_month_sources(self, months: List[str]) -> Dict[str, str]:
        summary_map: Dict[str, Dict[str, Any]] = {}
        years = sorted({month.split("-")[0] for month in months})
        for year in years:
            for item in self.monthly_service.list_monthly_summaries(year):
                summary_map[str(item.get("month") or "")] = item

        return {
            month: (
                "monthly"
                if self._is_month_finalized(month, summary_map.get(month))
                else "platform_daily"
            )
            for month in months
        }

    def _is_month_finalized(self, month: str, monthly_summary: Optional[Dict[str, Any]] = None) -> bool:
        summary = monthly_summary
        if summary is None:
            year = month.split("-")[0]
            summary = next(
                (item for item in self.monthly_service.list_monthly_summaries(year) if item.get("month") == month),
                None,
            )
        if not summary:
            return False

        has_customer_docs = int(summary.get("customer_count") or 0) > 0
        has_wholesale_settlement = bool(summary.get("wholesale_settled"))
        has_settlement_fee = summary.get("settlement_total_fee") is not None
        has_energy = float(summary.get("total_energy_mwh") or 0.0) > 0
        return has_customer_docs and has_wholesale_settlement and has_settlement_fee and has_energy

    def _load_monthly_customer_profit(self, month: str) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for record in self.monthly_service.get_customer_records(month):
            energy_mwh = float(record.get("final_energy_mwh") or record.get("total_energy_mwh") or 0.0)
            retail_revenue = float(record.get("final_retail_fee") or record.get("total_fee") or 0.0)
            wholesale_cost = float(record.get("final_wholesale_fee") or 0.0)
            gross_profit = float(record.get("final_gross_profit") or (retail_revenue - wholesale_cost))
            retail_unit_price = float(record.get("final_retail_unit_price") or (retail_revenue / energy_mwh if energy_mwh > 0 else 0.0))
            wholesale_unit_price = float(record.get("final_wholesale_unit_price") or (wholesale_cost / energy_mwh if energy_mwh > 0 else 0.0))
            price_spread = float(record.get("final_price_spread_per_mwh") or (retail_unit_price - wholesale_unit_price))

            rows.append(
                {
                    "customer_id": str(record.get("customer_id") or ""),
                    "customer_name": str(record.get("customer_name") or ""),
                    "package_name": str(record.get("package_name") or record.get("model_code") or ""),
                    "energy_mwh": round(energy_mwh, 6),
                    "retail_revenue": round(retail_revenue, 2),
                    "wholesale_cost": round(wholesale_cost, 2),
                    "gross_profit": round(gross_profit, 2),
                    "retail_unit_price": round(retail_unit_price, 6),
                    "wholesale_unit_price": round(wholesale_unit_price, 6),
                    "price_spread": round(price_spread, 6),
                    "source_type": "monthly",
                    "months": [month],
                    "detail_ready": False,
                }
            )
        return rows

    def _attach_customer_short_names(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        customer_ids = [
            ObjectId(row["customer_id"])
            for row in rows
            if row.get("customer_id") and ObjectId.is_valid(str(row["customer_id"]))
        ]
        short_name_map: Dict[str, str] = {}
        if customer_ids:
            cursor = self.db["customer_archives"].find(
                {"_id": {"$in": customer_ids}},
                {"short_name": 1},
            )
            short_name_map = {
                str(doc["_id"]): str(doc.get("short_name") or "")
                for doc in cursor
            }

        for row in rows:
            customer_id = str(row.get("customer_id") or "")
            row["short_name"] = short_name_map.get(customer_id) or str(row.get("customer_name") or "")
        return rows

    def _load_platform_daily_customer_profit(self, month: str) -> List[Dict[str, Any]]:
        year, mon = map(int, month.split("-"))
        last_day = calendar.monthrange(year, mon)[1]
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        pipeline = [
            {
                "$match": {
                    "date": {"$gte": start_date, "$lte": end_date},
                    "settlement_type": "daily",
                    "$or": [
                        {"wholesale_version": SettlementVersion.PLATFORM_DAILY.value},
                        {"wholesale_version": {"$exists": False}},
                        {"wholesale_version": None},
                    ],
                }
            },
            {
                "$group": {
                    "_id": {
                        "customer_id": "$customer_id",
                        "customer_name": "$customer_name",
                    },
                    "package_name": {"$last": "$package_name"},
                    "energy_mwh": {"$sum": {"$ifNull": ["$total_load_mwh", 0]}},
                    "retail_revenue": {"$sum": {"$ifNull": ["$total_fee", 0]}},
                    "wholesale_cost": {"$sum": {"$ifNull": ["$total_allocated_cost", 0]}},
                }
            },
            {"$sort": {"_id.customer_name": 1}},
        ]

        rows: List[Dict[str, Any]] = []
        for item in self.db["retail_settlement_daily"].aggregate(pipeline):
            customer_id = str(item.get("_id", {}).get("customer_id") or "")
            customer_name = str(item.get("_id", {}).get("customer_name") or "")
            energy_mwh = float(item.get("energy_mwh") or 0.0)
            retail_revenue = float(item.get("retail_revenue") or 0.0)
            wholesale_cost = float(item.get("wholesale_cost") or 0.0)
            gross_profit = retail_revenue - wholesale_cost
            retail_unit_price = retail_revenue / energy_mwh if energy_mwh > 0 else 0.0
            wholesale_unit_price = wholesale_cost / energy_mwh if energy_mwh > 0 else 0.0

            rows.append(
                {
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "package_name": str(item.get("package_name") or ""),
                    "energy_mwh": round(energy_mwh, 6),
                    "retail_revenue": round(retail_revenue, 2),
                    "wholesale_cost": round(wholesale_cost, 2),
                    "gross_profit": round(gross_profit, 2),
                    "retail_unit_price": round(retail_unit_price, 6),
                    "wholesale_unit_price": round(wholesale_unit_price, 6),
                    "price_spread": round(retail_unit_price - wholesale_unit_price, 6),
                    "source_type": "platform_daily",
                    "months": [month],
                    "detail_ready": False,
                }
            )
        return rows

    def _merge_customer_profit_rows(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            customer_id = row.get("customer_id") or ""
            customer_name = row.get("customer_name") or ""
            merge_key = customer_id or customer_name
            if not merge_key:
                continue

            if merge_key not in merged:
                merged[merge_key] = {
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "package_name": row.get("package_name") or "",
                    "energy_mwh": 0.0,
                    "retail_revenue": 0.0,
                    "wholesale_cost": 0.0,
                    "gross_profit": 0.0,
                    "retail_unit_price": 0.0,
                    "wholesale_unit_price": 0.0,
                    "price_spread": 0.0,
                    "source_type": row.get("source_type") or "platform_daily",
                    "detail_ready": False,
                    "_source_types": set(),
                    "_months": [],
                }

            target = merged[merge_key]
            target["energy_mwh"] += float(row.get("energy_mwh") or 0.0)
            target["retail_revenue"] += float(row.get("retail_revenue") or 0.0)
            target["wholesale_cost"] += float(row.get("wholesale_cost") or 0.0)
            target["gross_profit"] += float(row.get("gross_profit") or 0.0)
            if row.get("package_name"):
                target["package_name"] = row["package_name"]
            target["_source_types"].add(row.get("source_type") or "platform_daily")
            target["_months"].extend(row.get("months") or [])

        result: List[Dict[str, Any]] = []
        for item in merged.values():
            energy_mwh = float(item["energy_mwh"] or 0.0)
            retail_unit_price = item["retail_revenue"] / energy_mwh if energy_mwh > 0 else 0.0
            wholesale_unit_price = item["wholesale_cost"] / energy_mwh if energy_mwh > 0 else 0.0
            source_types = item.pop("_source_types", set())
            item.pop("_months", [])
            if len(source_types) == 1:
                item["source_type"] = next(iter(source_types))
            else:
                item["source_type"] = "mixed"
            item["retail_unit_price"] = round(retail_unit_price, 6)
            item["wholesale_unit_price"] = round(wholesale_unit_price, 6)
            item["price_spread"] = round(retail_unit_price - wholesale_unit_price, 6)
            item["energy_mwh"] = round(item["energy_mwh"], 6)
            item["retail_revenue"] = round(item["retail_revenue"], 2)
            item["wholesale_cost"] = round(item["wholesale_cost"], 2)
            item["gross_profit"] = round(item["gross_profit"], 2)
            result.append(item)

        return result

    def _build_kpi(self, rows: List[Dict[str, Any]], source_map: Dict[str, str]) -> Dict[str, Any]:
        months = sorted(source_map.keys())
        total_energy_mwh = 0.0
        retail_revenue = 0.0
        wholesale_cost = 0.0

        summary_map: Dict[str, Dict[str, Any]] = {}
        years = sorted({month.split("-")[0] for month in months})
        for year in years:
            for item in self.monthly_service.list_monthly_summaries(year):
                summary_map[str(item.get("month") or "")] = item

        for month in months:
            if source_map.get(month) == "monthly":
                summary = summary_map.get(month) or {}
                total_energy_mwh += float(summary.get("total_energy_mwh") or 0.0)
                retail_revenue += float(summary.get("settlement_total_fee") or 0.0)
                wholesale_cost += float(summary.get("wholesale_total_cost") or 0.0)
            else:
                platform_summary = self._load_platform_daily_month_summary(month)
                total_energy_mwh += float(platform_summary.get("total_energy_mwh") or 0.0)
                retail_revenue += float(platform_summary.get("retail_revenue") or 0.0)
                wholesale_cost += float(platform_summary.get("wholesale_cost") or 0.0)

        gross_profit = retail_revenue - wholesale_cost
        retail_avg_price = retail_revenue / total_energy_mwh if total_energy_mwh > 0 else 0.0
        wholesale_avg_price = wholesale_cost / total_energy_mwh if total_energy_mwh > 0 else 0.0

        monthly_months = [month for month, source in source_map.items() if source == "monthly"]
        platform_daily_months = [month for month, source in source_map.items() if source == "platform_daily"]

        return {
            "customer_count": len(rows),
            "total_energy_mwh": round(total_energy_mwh, 6),
            "retail_revenue": round(retail_revenue, 2),
            "retail_avg_price": round(retail_avg_price, 6),
            "wholesale_cost": round(wholesale_cost, 2),
            "wholesale_avg_price": round(wholesale_avg_price, 6),
            "gross_profit": round(gross_profit, 2),
            "avg_spread": round(retail_avg_price - wholesale_avg_price, 6),
            "source_summary": {
                "monthly_months": monthly_months,
                "platform_daily_months": platform_daily_months,
            },
        }

    def _load_platform_daily_month_summary(self, month: str) -> Dict[str, float]:
        year, mon = map(int, month.split("-"))
        last_day = calendar.monthrange(year, mon)[1]
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        wholesale_cursor = self.db["settlement_daily"].find(
            {"operating_date": {"$gte": start_date, "$lte": end_date}, "version": "PRELIMINARY"},
            {"operating_date": 1, "real_time_volume": 1, "predicted_wholesale_cost": 1},
        ).sort("operating_date", 1)
        wholesale_by_date = {
            str(doc.get("operating_date")): {
                "volume_mwh": float(doc.get("real_time_volume") or 0.0),
                "wholesale_cost": float(doc.get("predicted_wholesale_cost") or 0.0),
            }
            for doc in wholesale_cursor
        }

        retail_results = self.db["retail_settlement_daily"].aggregate(
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
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
        retail_by_date = {
            str(item["_id"]): {
                "retail_revenue": float(item.get("total_fee") or 0.0),
                "retail_load": float(item.get("total_load") or 0.0),
            }
            for item in retail_results
        }

        total_energy_mwh = 0.0
        retail_revenue = 0.0
        wholesale_cost = 0.0
        for date_str in sorted(set(wholesale_by_date.keys()) | set(retail_by_date.keys())):
            if date_str not in wholesale_by_date:
                continue
            wholesale = wholesale_by_date[date_str]
            retail = retail_by_date.get(date_str, {"retail_revenue": 0.0, "retail_load": 0.0})
            total_energy_mwh += float(wholesale.get("volume_mwh") or 0.0)
            retail_revenue += float(retail.get("retail_revenue") or 0.0)
            wholesale_cost += float(wholesale.get("wholesale_cost") or 0.0)

        return {
            "total_energy_mwh": round(total_energy_mwh, 6),
            "retail_revenue": round(retail_revenue, 2),
            "wholesale_cost": round(wholesale_cost, 2),
        }

    def _build_contribution(self, rows: List[Dict[str, Any]], positive: bool) -> Dict[str, Any]:
        if positive:
            contribution_rows = [row for row in rows if float(row.get("gross_profit") or 0.0) > 0]
            sorted_rows = sorted(contribution_rows, key=lambda item: item["gross_profit"], reverse=True)
            total_profit = sum(float(row["gross_profit"]) for row in contribution_rows)
        else:
            contribution_rows = [row for row in rows if float(row.get("gross_profit") or 0.0) < 0]
            sorted_rows = sorted(contribution_rows, key=lambda item: item["gross_profit"])
            total_profit = sum(abs(float(row["gross_profit"])) for row in contribution_rows)

        top5 = []
        for row in sorted_rows[:5]:
            profit = float(row["gross_profit"])
            contribution_value = abs(profit)
            top5.append(
                {
                    "customer_id": row.get("customer_id"),
                    "customer_name": row.get("customer_name"),
                    "short_name": row.get("short_name"),
                    "profit": round(profit, 2),
                    "avg_spread": round(float(row.get("price_spread") or 0.0), 6),
                    "percentage": round((contribution_value / total_profit * 100) if total_profit > 0 else 0.0, 2),
                    "contribution_value": round(contribution_value, 2),
                }
            )

        top5_contribution = sum(item["contribution_value"] for item in top5)
        others_contribution = round(total_profit - top5_contribution, 2)
        others_profit = round(
            sum(float(row["gross_profit"]) for row in sorted_rows[5:]),
            2,
        )

        return {
            "top5": top5,
            "others": {
                "profit": others_profit,
                "percentage": round((others_contribution / total_profit * 100) if total_profit > 0 else 0.0, 2),
                "contribution_value": others_contribution,
            },
            "customer_count": len(contribution_rows),
            "total_profit": round(total_profit if positive else -total_profit, 2),
            "contribution_type": "positive" if positive else "negative",
        }

    def _build_rankings(self, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        profit_sorted_desc = sorted(rows, key=lambda item: item["gross_profit"], reverse=True)
        spread_sorted_desc = sorted(rows, key=lambda item: item["price_spread"], reverse=True)

        return {
            "profit": {
                "top5": self._serialize_ranking(profit_sorted_desc[:5], "gross_profit"),
                "bottom5": self._serialize_ranking(sorted(rows, key=lambda item: item["gross_profit"])[:5], "gross_profit"),
            },
            "spread": {
                "top5": self._serialize_ranking(spread_sorted_desc[:5], "price_spread"),
                "bottom5": self._serialize_ranking(sorted(rows, key=lambda item: item["price_spread"])[:5], "price_spread"),
            },
        }

    def _serialize_ranking(self, rows: List[Dict[str, Any]], field: str) -> List[Dict[str, Any]]:
        payload = []
        for row in rows:
            payload.append(
                {
                    "customer_id": row.get("customer_id"),
                    "customer_name": row.get("customer_name"),
                    "short_name": row.get("short_name"),
                    "package_name": row.get("package_name"),
                    "value": round(float(row.get(field) or 0.0), 6),
                }
            )
        return payload

    def _build_customer_list(
        self,
        rows: List[Dict[str, Any]],
        search: Optional[str],
        sort_field: str,
        sort_order: str,
        page: int,
        page_size: int,
    ) -> Dict[str, Any]:
        filtered_rows = list(rows)
        if search:
            search_key = search.strip().lower()
            filtered_rows = [
                row for row in filtered_rows
                if search_key in str(row.get("customer_name") or "").lower()
                or search_key in str(row.get("package_name") or "").lower()
            ]

        sort_key = sort_field if sort_field in {
            "energy_mwh",
            "retail_revenue",
            "wholesale_cost",
            "gross_profit",
            "price_spread",
            "customer_name",
        } else "gross_profit"
        reverse = sort_order != "asc"
        filtered_rows.sort(
            key=lambda item: self._sort_value(item, sort_key),
            reverse=reverse,
        )

        total = len(filtered_rows)
        safe_page = max(page, 1)
        if page_size == -1:
            paged_rows = filtered_rows
        else:
            safe_page_size = max(page_size, 1)
            start = (safe_page - 1) * safe_page_size
            end = start + safe_page_size
            paged_rows = filtered_rows[start:end]

        return {
            "total": total,
            "page": safe_page,
            "page_size": page_size,
            "items": paged_rows,
        }

    def _sort_value(self, row: Dict[str, Any], field: str) -> Tuple[int, Any]:
        value = row.get(field)
        if field == "customer_name":
            return (0, str(value or ""))
        if value is None:
            return (1, 0)
        return (0, float(value))
