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
            "positive_contribution": self._build_positive_contribution(merged_rows),
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
        return {
            month: ("monthly" if self._is_month_finalized(month) else "platform_daily")
            for month in months
        }

    def _is_month_finalized(self, month: str) -> bool:
        status_doc = self.monthly_service.get_month_status(month)
        if not status_doc:
            return False

        status = str(status_doc.get("status") or "").lower()
        has_customer_docs = self.db[self.monthly_service.CUSTOMER_COLLECTION].count_documents({"month": month}) > 0
        has_final_fields = status_doc.get("retail_total_fee") is not None and status_doc.get("retail_avg_price") is not None
        return status == "completed" and has_customer_docs and has_final_fields

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
        total_energy_mwh = sum(float(row.get("energy_mwh") or 0.0) for row in rows)
        retail_revenue = sum(float(row.get("retail_revenue") or 0.0) for row in rows)
        wholesale_cost = sum(float(row.get("wholesale_cost") or 0.0) for row in rows)
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

    def _build_positive_contribution(self, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        positive_rows = [row for row in rows if float(row.get("gross_profit") or 0.0) > 0]
        total_positive_profit = sum(float(row["gross_profit"]) for row in positive_rows)
        sorted_rows = sorted(positive_rows, key=lambda item: item["gross_profit"], reverse=True)
        top5 = []
        for row in sorted_rows[:5]:
            profit = float(row["gross_profit"])
            top5.append(
                {
                    "customer_id": row.get("customer_id"),
                    "customer_name": row.get("customer_name"),
                    "short_name": row.get("short_name"),
                    "profit": round(profit, 2),
                    "avg_spread": round(float(row.get("price_spread") or 0.0), 6),
                    "percentage": round((profit / total_positive_profit * 100) if total_positive_profit > 0 else 0.0, 2),
                }
            )

        top5_profit = sum(item["profit"] for item in top5)
        others_profit = round(total_positive_profit - top5_profit, 2)

        return {
            "top5": top5,
            "others": {
                "profit": others_profit,
                "percentage": round((others_profit / total_positive_profit * 100) if total_positive_profit > 0 else 0.0, 2),
            },
            "total_positive_profit": round(total_positive_profit, 2),
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
