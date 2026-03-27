import logging
from calendar import monthrange
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymongo.database import Database

from webapp.models.load_enums import FusionStrategy
from webapp.models.trade_review import (
    MonthlyReviewDetailResponse,
    MonthlyReviewOverviewResponse,
)
from webapp.services.contract_service import ContractService
from webapp.services.load_query_service import LoadQueryService
from webapp.services.spot_price_service import get_spot_prices, resample_to_48

logger = logging.getLogger(__name__)

TRADE_TYPE_ORDER: List[Tuple[str, str]] = [
    ("annual", "年度交易"),
    ("monthly", "月度交易"),
    ("within_month", "月内交易"),
    ("day_ahead", "日前交易"),
]


class MonthlyTradeReviewService:
    def __init__(self, db: Database) -> None:
        self.db = db
        self.collection = db["trade_review_monthly_summary"]
        self.contracts_collection = db["contracts_aggregated_daily"]
        self.day_ahead_collection = db["day_ahead_energy_declare"]
        self.contract_service = ContractService(db)

    def get_monthly_overview(self, month: str, auto_build: bool = False) -> MonthlyReviewOverviewResponse:
        try:
            doc = self._get_or_build_doc(month) if auto_build else self._get_existing_doc(month)
        except ValueError as exc:
            return MonthlyReviewOverviewResponse(
                month=month,
                exists=False,
                calc_status="failed",
                calc_message=str(exc),
                data_range=None,
                overview=None,
                updated_at=None,
            )
        return MonthlyReviewOverviewResponse(
            month=month,
            exists=True,
            calc_status=doc.get("calc_status"),
            calc_message=doc.get("calc_message"),
            data_range=doc.get("data_range"),
            overview=doc.get("overview"),
            updated_at=doc.get("updated_at"),
        )

    def get_monthly_detail(self, month: str) -> MonthlyReviewDetailResponse:
        doc = self._get_or_build_doc(month)
        normalized = self._normalize_detail_doc(doc)
        return MonthlyReviewDetailResponse.model_validate(normalized)

    def recalculate_monthly_detail(self, month: str) -> MonthlyReviewDetailResponse:
        doc = self._build_monthly_summary(month)
        persisted = self._upsert_doc(month, doc)
        normalized = self._normalize_detail_doc(persisted)
        return MonthlyReviewDetailResponse.model_validate(normalized)

    def _get_existing_doc(self, month: str) -> Dict[str, Any]:
        doc = self.collection.find_one({"month": month}, {"_id": 0})
        if not doc:
            return {
                "month": month,
                "exists": False,
                "calc_status": "missing",
                "calc_message": "当前月份基于最新数据的复盘结果尚未生成，请点击立即计算。",
                "data_range": None,
                "overview": None,
                "updated_at": None,
            }

        if self._should_refresh_doc(month, doc):
            return {
                "month": month,
                "exists": False,
                "calc_status": "stale",
                "calc_message": "当前月份基于最新数据的复盘结果尚未生成，请点击立即计算。",
                "data_range": None,
                "overview": None,
                "updated_at": doc.get("updated_at"),
            }

        return doc

    def _get_or_build_doc(self, month: str) -> Dict[str, Any]:
        doc = self.collection.find_one({"month": month}, {"_id": 0})
        if doc and not self._should_refresh_doc(month, doc):
            return doc

        logger.info("月度交易复盘结果不存在或已过期，开始实时计算并回写: %s", month)
        built_doc = self._build_monthly_summary(month)
        return self._upsert_doc(month, built_doc)

    def _upsert_doc(self, month: str, built_doc: Dict[str, Any]) -> Dict[str, Any]:
        update_payload = dict(built_doc)
        created_at = update_payload.pop("created_at", self._now_iso())
        self.collection.update_one(
            {"month": month},
            {"$set": update_payload, "$setOnInsert": {"created_at": created_at}},
            upsert=True,
        )
        return self.collection.find_one({"month": month}, {"_id": 0}) or built_doc

    def _should_refresh_doc(self, month: str, doc: Dict[str, Any]) -> bool:
        start_date, natural_end_date = self._resolve_month_date_range(month)
        today_str = datetime.now().strftime("%Y-%m-%d")
        expected_end_date = self._resolve_calc_end_date(
            month=month,
            start_date=start_date,
            natural_end_date=natural_end_date,
            default_end_date=min(natural_end_date, today_str),
        )
        doc_end_date = (doc.get("data_range") or {}).get("end_date")
        return doc_end_date != expected_end_date

    def _build_monthly_summary(self, month: str) -> Dict[str, Any]:
        start_date, natural_end_date = self._resolve_month_date_range(month)
        today_str = datetime.now().strftime("%Y-%m-%d")
        end_date = self._resolve_calc_end_date(
            month=month,
            start_date=start_date,
            natural_end_date=natural_end_date,
            default_end_date=min(natural_end_date, today_str),
        )
        if end_date < start_date:
            raise ValueError(f"月份 {month} 尚未开始，无法计算月度交易复盘")

        all_dates = self._generate_dates(start_date, end_date)
        customer_ids = self.contract_service.get_active_customers(start_date, end_date)
        actual_curve_map = self._load_actual_curve_map(customer_ids, start_date, end_date)

        bucket_rows: List[Dict[str, Any]] = []
        missing_sources: set[str] = set()

        for date_str in all_dates:
            day_result = self._build_daily_bucket(date_str, actual_curve_map.get(date_str))
            bucket_rows.append(day_result)
            missing_sources.update(day_result.get("missing_sources") or [])

        return self._assemble_summary_doc(
            month=month,
            start_date=start_date,
            end_date=end_date,
            bucket_rows=bucket_rows,
            missing_sources=missing_sources,
        )

    def _resolve_calc_end_date(
        self,
        month: str,
        start_date: str,
        natural_end_date: str,
        default_end_date: str,
    ) -> str:
        candidate_dates = [default_end_date]
        for collection_name, field_name in [
            ("real_time_spot_price", "date_str"),
            ("day_ahead_energy_declare", "date_str"),
            ("contracts_aggregated_daily", "date"),
        ]:
            latest_date = self._get_latest_date_in_month(collection_name, field_name, month)
            if latest_date:
                candidate_dates.append(latest_date)

        latest_load_date = LoadQueryService.get_latest_data_date()
        if latest_load_date:
            candidate_dates.append(latest_load_date)

        filtered_dates = [
            value
            for value in candidate_dates
            if start_date <= value <= natural_end_date
        ]
        return min(filtered_dates) if filtered_dates else default_end_date

    def _assemble_summary_doc(
        self,
        month: str,
        start_date: str,
        end_date: str,
        bucket_rows: List[Dict[str, Any]],
        missing_sources: set[str],
    ) -> Dict[str, Any]:
        total_load_mwh = 0.0
        total_spot_cost = 0.0
        total_exposed_mwh = 0.0
        total_exposed_amount = 0.0
        total_contribution_amount = 0.0

        type_acc: Dict[str, Dict[str, Any]] = {
            trade_type: {
                "covered_abs_mwh": 0.0,
                "price_amount": 0.0,
                "spot_amount": 0.0,
                "contribution_amount": 0.0,
                "positive_bucket_count": 0,
                "negative_bucket_count": 0,
                "neutral_bucket_count": 0,
            }
            for trade_type, _ in TRADE_TYPE_ORDER
        }

        period_acc: Dict[int, Dict[str, Any]] = {
            period: {
                "actual_load_mwh": 0.0,
                "actual_load_days": 0,
                "spot_price_amount": 0.0,
                "spot_price_volume": 0.0,
                "total_contribution_amount": 0.0,
                "exposed_mwh": 0.0,
                "exposed_amount": 0.0,
                "trade_types": {
                    trade_type: {
                        "signed_volume_mwh": 0.0,
                        "abs_volume_mwh": 0.0,
                        "price_amount": 0.0,
                        "spot_amount": 0.0,
                        "contribution_amount": 0.0,
                    }
                    for trade_type, _ in TRADE_TYPE_ORDER
                },
            }
            for period in range(1, 49)
        }

        daily_view: List[Dict[str, Any]] = []

        for day_row in bucket_rows:
            daily_view.append(day_row["daily_view"])

            if day_row["actual_total_mwh"] is not None:
                total_load_mwh += day_row["actual_total_mwh"]
            if day_row["spot_cost_amount"] is not None:
                total_spot_cost += day_row["spot_cost_amount"]
            total_exposed_mwh += day_row["exposed_mwh"]
            total_exposed_amount += day_row["exposed_amount"]
            total_contribution_amount += day_row["contribution_amount"]

            for trade_type, acc in type_acc.items():
                type_day = day_row["type_cards"][trade_type]
                acc["covered_abs_mwh"] += type_day["covered_abs_mwh"]
                acc["price_amount"] += type_day["price_amount"]
                acc["spot_amount"] += type_day["spot_amount"]
                acc["contribution_amount"] += type_day["contribution_amount"]
                acc["positive_bucket_count"] += type_day["positive_bucket_count"]
                acc["negative_bucket_count"] += type_day["negative_bucket_count"]
                acc["neutral_bucket_count"] += type_day["neutral_bucket_count"]

            for period_detail in day_row["period_details"]:
                period_acc_item = period_acc[period_detail["period"]]
                if period_detail["actual_load_mwh"] is not None:
                    period_acc_item["actual_load_mwh"] += period_detail["actual_load_mwh"]
                    period_acc_item["actual_load_days"] += 1
                if period_detail["spot_price"] is not None and period_detail["actual_load_mwh"] is not None:
                    period_acc_item["spot_price_amount"] += (
                        period_detail["spot_price"] * period_detail["actual_load_mwh"]
                    )
                    period_acc_item["spot_price_volume"] += period_detail["actual_load_mwh"]
                period_acc_item["total_contribution_amount"] += period_detail["total_contribution_amount"]
                period_acc_item["exposed_mwh"] += period_detail["exposed_mwh"]
                period_acc_item["exposed_amount"] += period_detail["exposed_amount"]

                for trade_type, trade_detail in period_detail["trade_types"].items():
                    trade_acc = period_acc_item["trade_types"][trade_type]
                    trade_acc["signed_volume_mwh"] += trade_detail["signed_volume_mwh"]
                    trade_acc["abs_volume_mwh"] += trade_detail["abs_volume_mwh"]
                    trade_acc["price_amount"] += trade_detail["price_amount"]
                    trade_acc["spot_amount"] += trade_detail["spot_amount"]
                    trade_acc["contribution_amount"] += trade_detail["contribution_amount"]

        overview = {
            "total_load_mwh": self._round(total_load_mwh, 3) if total_load_mwh > 0 else None,
            "spot_avg_price": self._safe_div_round(total_spot_cost, total_load_mwh, 3),
            "total_contribution_amount": self._round(total_contribution_amount, 2),
            "total_exposed_mwh": self._round(total_exposed_mwh, 3),
            "total_exposed_amount": self._round(total_exposed_amount, 2),
            "settlement_price_impact_amount": self._round(total_contribution_amount, 2),
        }

        type_cards: List[Dict[str, Any]] = []
        for trade_type, label in TRADE_TYPE_ORDER:
            acc = type_acc[trade_type]
            effective_bucket_count = acc["positive_bucket_count"] + acc["negative_bucket_count"]
            avg_trade_price = self._safe_div(acc["price_amount"], acc["covered_abs_mwh"])
            spot_weighted_price = self._safe_div(acc["spot_amount"], acc["covered_abs_mwh"])
            type_cards.append(
                {
                    "trade_type": trade_type,
                    "label": label,
                    "covered_mwh": self._round(acc["covered_abs_mwh"], 3),
                    "energy_share": self._safe_div_round(acc["covered_abs_mwh"], total_load_mwh, 4),
                    "avg_trade_price": self._round(avg_trade_price, 3),
                    "spot_weighted_price": self._round(spot_weighted_price, 3),
                    "spot_spread": self._diff_round(spot_weighted_price, avg_trade_price, 3),
                    "contribution_amount": self._round(acc["contribution_amount"], 2),
                    "win_rate": self._safe_div_round(
                        acc["positive_bucket_count"], effective_bucket_count, 4
                    ),
                    "positive_bucket_count": acc["positive_bucket_count"],
                    "negative_bucket_count": acc["negative_bucket_count"],
                    "neutral_bucket_count": acc["neutral_bucket_count"],
                    "settlement_price_impact_amount": self._round(acc["contribution_amount"], 2),
                }
            )

        period_view: List[Dict[str, Any]] = []
        for period in range(1, 49):
            acc = period_acc[period]
            trade_types: List[Dict[str, Any]] = []
            for trade_type, _label in TRADE_TYPE_ORDER:
                trade_acc = acc["trade_types"][trade_type]
                avg_price = self._safe_div(trade_acc["price_amount"], trade_acc["abs_volume_mwh"])
                spot_price = self._safe_div(trade_acc["spot_amount"], trade_acc["abs_volume_mwh"])
                trade_types.append(
                    {
                        "trade_type": trade_type,
                        "volume_mwh": self._round(trade_acc["signed_volume_mwh"], 3),
                        "avg_price": self._round(avg_price, 3),
                        "contribution_amount": self._round(trade_acc["contribution_amount"], 2),
                        "spot_spread": self._diff_round(spot_price, avg_price, 3),
                    }
                )

            period_view.append(
                {
                    "period": period,
                    "time_label": self._build_period_label(period),
                    "actual_load_mwh": self._round(acc["actual_load_mwh"], 3) if acc["actual_load_days"] else None,
                    "spot_avg_price": self._safe_div_round(
                        acc["spot_price_amount"], acc["spot_price_volume"], 3
                    ),
                    "total_contribution_amount": self._round(acc["total_contribution_amount"], 2),
                    "exposed_mwh": self._round(acc["exposed_mwh"], 3),
                    "exposed_amount": self._round(acc["exposed_amount"], 2),
                    "trade_types": trade_types,
                }
            )

        calc_status = "success" if not missing_sources else "partial"
        calc_message = (
            "计算完成"
            if calc_status == "success"
            else f"已生成结果，但存在部分数据缺失: {', '.join(sorted(missing_sources))}"
        )
        source_meta = self._build_source_meta(month)
        diagnosis_texts = self._build_diagnosis_texts(type_cards, daily_view, period_view, overview)
        now_iso = self._now_iso()

        return {
            "_id": month,
            "month": month,
            "calc_status": calc_status,
            "calc_message": calc_message,
            "data_range": {
                "start_date": start_date,
                "end_date": end_date,
            },
            "overview": overview,
            "type_cards": type_cards,
            "daily_view": daily_view,
            "period_view": period_view,
            "diagnosis_texts": diagnosis_texts,
            "source_meta": source_meta,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

    def _build_daily_bucket(
        self,
        date_str: str,
        actual_values: Optional[List[float]],
    ) -> Dict[str, Any]:
        missing_sources: set[str] = set()
        rt_price_map = self._load_spot_price_map(date_str, "real_time")
        if not rt_price_map:
            missing_sources.add("real_time_spot_price")

        annual_qty_map, annual_price_map = self._load_contract_map(date_str, "年度")
        monthly_qty_map, monthly_price_map = self._load_contract_map(date_str, "月度")
        within_month_qty_map, within_month_price_map = self._load_contract_map(date_str, "月内")

        day_ahead_qty_map = self._load_day_ahead_volume_map(date_str)
        day_ahead_price_map = self._load_day_ahead_price_map(date_str)
        if not day_ahead_qty_map:
            missing_sources.add("day_ahead_energy_declare")
        if not day_ahead_price_map:
            missing_sources.add("day_ahead_spot_price")

        if actual_values is None:
            missing_sources.add("unified_load_curve")
            actual_values = [0.0] * 48
            actual_available = False
        else:
            actual_available = True
            actual_values = resample_to_48(actual_values, method="sum")

        period_details: List[Dict[str, Any]] = []
        type_cards: Dict[str, Dict[str, Any]] = {
            trade_type: {
                "covered_abs_mwh": 0.0,
                "price_amount": 0.0,
                "spot_amount": 0.0,
                "contribution_amount": 0.0,
                "positive_bucket_count": 0,
                "negative_bucket_count": 0,
                "neutral_bucket_count": 0,
            }
            for trade_type, _ in TRADE_TYPE_ORDER
        }

        actual_total_mwh = 0.0
        spot_cost_amount = 0.0
        exposed_mwh_total = 0.0
        exposed_amount_total = 0.0
        contribution_total = 0.0
        daily_trade_points: Dict[str, Dict[str, Any]] = {
            trade_type: {
                "signed_volume_mwh": 0.0,
                "abs_volume_mwh": 0.0,
                "price_amount": 0.0,
                "spot_amount": 0.0,
                "contribution_amount": 0.0,
            }
            for trade_type, _ in TRADE_TYPE_ORDER
        }

        for period in range(1, 49):
            actual_load_mwh = actual_values[period - 1] if len(actual_values) >= period else 0.0
            actual_total_mwh += actual_load_mwh

            spot_price = rt_price_map.get(period)
            if spot_price is not None:
                spot_cost_amount += actual_load_mwh * spot_price

            trade_period_detail: Dict[str, Dict[str, Any]] = {}
            coverage_sum = 0.0
            period_contribution_total = 0.0

            for trade_type, _label in TRADE_TYPE_ORDER:
                if trade_type == "annual":
                    volume = annual_qty_map.get(period, 0.0)
                    trade_price = annual_price_map.get(period)
                elif trade_type == "monthly":
                    volume = monthly_qty_map.get(period, 0.0)
                    trade_price = monthly_price_map.get(period)
                elif trade_type == "within_month":
                    volume = within_month_qty_map.get(period, 0.0)
                    trade_price = within_month_price_map.get(period)
                else:
                    volume = day_ahead_qty_map.get(period, 0.0)
                    trade_price = day_ahead_price_map.get(period)

                coverage_sum += volume
                abs_volume = abs(volume)
                contribution = 0.0
                is_effective = abs_volume > 0 and spot_price is not None and trade_price is not None
                if is_effective:
                    contribution = volume * (spot_price - float(trade_price))

                type_cards_item = type_cards[trade_type]
                type_cards_item["covered_abs_mwh"] += abs_volume
                if abs_volume > 0 and trade_price is not None:
                    type_cards_item["price_amount"] += abs_volume * float(trade_price)
                if abs_volume > 0 and spot_price is not None:
                    type_cards_item["spot_amount"] += abs_volume * spot_price
                type_cards_item["contribution_amount"] += contribution

                if is_effective:
                    if contribution > 0:
                        type_cards_item["positive_bucket_count"] += 1
                    elif contribution < 0:
                        type_cards_item["negative_bucket_count"] += 1
                    else:
                        type_cards_item["neutral_bucket_count"] += 1
                else:
                    type_cards_item["neutral_bucket_count"] += 1

                daily_trade_point = daily_trade_points[trade_type]
                daily_trade_point["signed_volume_mwh"] += volume
                daily_trade_point["abs_volume_mwh"] += abs_volume
                if abs_volume > 0 and trade_price is not None:
                    daily_trade_point["price_amount"] += abs_volume * float(trade_price)
                if abs_volume > 0 and spot_price is not None:
                    daily_trade_point["spot_amount"] += abs_volume * spot_price
                daily_trade_point["contribution_amount"] += contribution

                trade_period_detail[trade_type] = {
                    "signed_volume_mwh": volume,
                    "abs_volume_mwh": abs_volume,
                    "price_amount": abs_volume * float(trade_price) if abs_volume > 0 and trade_price is not None else 0.0,
                    "spot_amount": abs_volume * spot_price if abs_volume > 0 and spot_price is not None else 0.0,
                    "contribution_amount": contribution,
                    "avg_price": self._round(float(trade_price), 3) if trade_price is not None else None,
                    "spot_spread": self._diff_round(spot_price, trade_price, 3),
                }
                period_contribution_total += contribution

            exposed_mwh = max(actual_load_mwh - coverage_sum, 0.0)
            exposed_amount = exposed_mwh * spot_price if spot_price is not None else 0.0
            exposed_mwh_total += exposed_mwh
            exposed_amount_total += exposed_amount
            contribution_total += period_contribution_total

            period_details.append(
                {
                    "period": period,
                    "actual_load_mwh": self._round(actual_load_mwh, 3) if actual_available else None,
                    "spot_price": spot_price,
                    "total_contribution_amount": period_contribution_total,
                    "exposed_mwh": exposed_mwh,
                    "exposed_amount": exposed_amount,
                    "trade_types": trade_period_detail,
                }
            )

        daily_trade_types: List[Dict[str, Any]] = []
        for trade_type, _label in TRADE_TYPE_ORDER:
            point = daily_trade_points[trade_type]
            avg_price = self._safe_div(point["price_amount"], point["abs_volume_mwh"])
            spot_weighted_price = self._safe_div(point["spot_amount"], point["abs_volume_mwh"])
            daily_trade_types.append(
                {
                    "trade_type": trade_type,
                    "volume_mwh": self._round(point["signed_volume_mwh"], 3),
                    "avg_price": self._round(avg_price, 3),
                    "contribution_amount": self._round(point["contribution_amount"], 2),
                    "spot_spread": self._diff_round(spot_weighted_price, avg_price, 3),
                }
            )

        daily_spot_avg_price = self._safe_div_round(spot_cost_amount, actual_total_mwh, 3) if actual_available else None
        daily_view = {
            "date": date_str,
            "actual_load_mwh": self._round(actual_total_mwh, 3) if actual_available else None,
            "spot_avg_price": daily_spot_avg_price,
            "total_contribution_amount": self._round(contribution_total, 2),
            "exposed_mwh": self._round(exposed_mwh_total, 3),
            "exposed_amount": self._round(exposed_amount_total, 2),
            "trade_types": daily_trade_types,
        }

        return {
            "date": date_str,
            "actual_total_mwh": actual_total_mwh if actual_available else None,
            "spot_cost_amount": spot_cost_amount if actual_available else None,
            "contribution_amount": contribution_total,
            "exposed_mwh": exposed_mwh_total,
            "exposed_amount": exposed_amount_total,
            "type_cards": type_cards,
            "daily_view": daily_view,
            "period_details": period_details,
            "missing_sources": sorted(missing_sources),
        }

    def _load_actual_curve_map(
        self,
        customer_ids: List[str],
        start_date: str,
        end_date: str,
    ) -> Dict[str, List[float]]:
        if not customer_ids:
            return {}

        try:
            curve_docs = LoadQueryService.aggregate_curve_series(
                customer_ids,
                start_date,
                end_date,
                strategy=FusionStrategy.MP_COMPLETE,
                return_df=False,
            )
        except Exception as exc:
            logger.warning("加载月度复盘实际负荷失败: %s", exc)
            return {}

        curve_map: Dict[str, List[float]] = {}
        for item in curve_docs:
            values = list(getattr(item, "values", []) or [])
            if values:
                curve_map[str(getattr(item, "date"))] = values
        return curve_map

    def _load_contract_map(
        self,
        date_str: str,
        contract_period: str,
    ) -> Tuple[Dict[int, float], Dict[int, Optional[float]]]:
        docs = list(
            self.contracts_collection.find(
                {
                    "date": date_str,
                    "entity": "售电公司",
                    "contract_type": "整体",
                    "contract_period": contract_period,
                },
                {"_id": 0, "periods": 1},
            )
        )
        if not docs:
            return {}, {}

        qty_map: Dict[int, float] = {}
        price_map: Dict[int, Optional[float]] = {}
        for item in docs[0].get("periods", []):
            period = int(item.get("period") or 0)
            if period <= 0 or period > 48:
                continue
            qty_map[period] = self._safe_float(item.get("quantity_mwh"))
            price_raw = item.get("price_yuan_per_mwh")
            price_map[period] = round(float(price_raw), 3) if price_raw is not None else None
        return qty_map, price_map

    def _load_day_ahead_volume_map(self, date_str: str) -> Dict[int, float]:
        docs = list(
            self.day_ahead_collection.find(
                {"date_str": date_str},
                {"_id": 0, "energy_mwh": 1, "time_str": 1, "datetime": 1},
            ).sort("time_str", 1)
        )
        if not docs:
            start_dt = datetime.strptime(date_str, "%Y-%m-%d")
            end_dt = start_dt + timedelta(days=1)
            docs = list(
                self.day_ahead_collection.find(
                    {"datetime": {"$gt": start_dt, "$lte": end_dt}},
                    {"_id": 0, "energy_mwh": 1, "datetime": 1},
                ).sort("datetime", 1)
            )
        if not docs:
            return {}

        raw_values: List[float] = []
        for doc in docs:
            raw_values.append(self._safe_float(doc.get("energy_mwh")))
        values_48 = raw_values if len(raw_values) == 48 else resample_to_48(raw_values, method="sum")
        return {idx + 1: round(values_48[idx], 6) for idx in range(min(48, len(values_48)))}

    def _load_day_ahead_price_map(self, date_str: str) -> Dict[int, Optional[float]]:
        data_type = "day_ahead_econ" if date_str >= "2026-02-01" else "day_ahead"
        return self._load_spot_price_map(date_str, data_type)

    def _load_spot_price_map(
        self,
        date_str: str,
        data_type: str,
    ) -> Dict[int, Optional[float]]:
        try:
            curve = get_spot_prices(
                self.db,
                date_str,
                data_type=data_type,  # type: ignore[arg-type]
                resolution=48,
                include_volume=False,
            )
        except Exception as exc:
            logger.warning("加载现货价格失败 %s %s: %s", date_str, data_type, exc)
            return {}
        return {
            point.period: round(float(point.price), 3) if point.price is not None else None
            for point in curve.points
        }

    def _build_source_meta(self, month: str) -> Dict[str, Optional[str]]:
        month_regex = {"$regex": f"^{month}"}
        return {
            "contracts_last_updated_at": self._get_latest_collection_timestamp(
                "contracts_aggregated_daily",
                {"date": month_regex},
            ),
            "trade_last_updated_at": self._get_latest_collection_timestamp(
                "day_ahead_energy_declare",
                {"date_str": month_regex},
            ),
            "spot_last_updated_at": self._max_timestamp(
                self._get_latest_collection_timestamp("real_time_spot_price", {"date_str": month_regex}),
                self._get_latest_collection_timestamp("day_ahead_spot_price", {"date_str": month_regex}),
                self._get_latest_collection_timestamp("day_ahead_econ_price", {"date_str": month_regex}),
            ),
        }

    def _get_latest_date_in_month(
        self,
        collection_name: str,
        field_name: str,
        month: str,
    ) -> Optional[str]:
        doc = self.db[collection_name].find_one(
            {field_name: {"$regex": f"^{month}"}},
            {"_id": 0, field_name: 1},
            sort=[(field_name, -1)],
        )
        if not doc:
            return None
        value = doc.get(field_name)
        return str(value) if value else None

    def _get_latest_collection_timestamp(
        self,
        collection_name: str,
        query: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        collection = self.db[collection_name]
        for field in ["updated_at", "imported_at", "created_at", "datetime"]:
            doc = collection.find_one(query or {}, {"_id": 0, field: 1}, sort=[(field, -1)])
            if not doc or doc.get(field) is None:
                continue
            return self._normalize_time_value(doc.get(field))
        return None

    def _build_diagnosis_texts(
        self,
        type_cards: List[Dict[str, Any]],
        daily_view: List[Dict[str, Any]],
        period_view: List[Dict[str, Any]],
        overview: Dict[str, Any],
    ) -> List[str]:
        texts: List[str] = []
        valid_cards = [item for item in type_cards if item.get("contribution_amount") is not None]
        if valid_cards:
            best_card = max(valid_cards, key=lambda item: float(item.get("contribution_amount") or 0.0))
            worst_card = min(valid_cards, key=lambda item: float(item.get("contribution_amount") or 0.0))
            texts.append(
                f"{best_card['label']}贡献最高，月度贡献值 {float(best_card.get('contribution_amount') or 0.0):,.2f} 元。"
            )
            if float(worst_card.get("contribution_amount") or 0.0) < 0:
                texts.append(
                    f"{worst_card['label']}存在负贡献，累计影响 {float(worst_card.get('contribution_amount') or 0.0):,.2f} 元。"
                )

        valid_daily = [item for item in daily_view if item.get("total_contribution_amount") is not None]
        if valid_daily:
            worst_day = min(valid_daily, key=lambda item: float(item.get("total_contribution_amount") or 0.0))
            texts.append(
                f"{worst_day['date']}为本月表现最弱日期，合计贡献值 {float(worst_day.get('total_contribution_amount') or 0.0):,.2f} 元。"
            )

        valid_periods = [item for item in period_view if item.get("exposed_amount") is not None]
        if valid_periods:
            top_exposed_period = max(valid_periods, key=lambda item: float(item.get("exposed_amount") or 0.0))
            texts.append(
                f"{top_exposed_period['time_label']}风险暴露最高，暴露金额 {float(top_exposed_period.get('exposed_amount') or 0.0):,.2f} 元。"
            )

        if not texts:
            texts.append("当前月份已生成月度交易复盘结果，但暂未识别出明确诊断结论。")

        if overview.get("total_exposed_mwh") is not None:
            texts.append(
                f"当前统计范围内剩余风险暴露电量 {float(overview.get('total_exposed_mwh') or 0.0):,.3f} MWh。"
            )
        return texts[:4]

    def _normalize_detail_doc(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "month": doc.get("month"),
            "calc_status": doc.get("calc_status"),
            "calc_message": doc.get("calc_message"),
            "data_range": doc.get("data_range"),
            "overview": doc.get("overview"),
            "type_cards": doc.get("type_cards") or [],
            "daily_view": doc.get("daily_view") or [],
            "period_view": doc.get("period_view") or [],
            "diagnosis_texts": doc.get("diagnosis_texts") or [],
            "source_meta": doc.get("source_meta"),
            "updated_at": doc.get("updated_at"),
        }

    def _resolve_month_date_range(self, month: str) -> Tuple[str, str]:
        year, mon = map(int, month.split("-"))
        last_day = monthrange(year, mon)[1]
        return f"{year:04d}-{mon:02d}-01", f"{year:04d}-{mon:02d}-{last_day:02d}"

    def _generate_dates(self, start_date: str, end_date: str) -> List[str]:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        return [
            (start_dt + timedelta(days=offset)).strftime("%Y-%m-%d")
            for offset in range((end_dt - start_dt).days + 1)
        ]

    def _build_period_label(self, period: int) -> str:
        start_minutes = (period - 1) * 30
        end_minutes = period * 30
        start_hour, start_minute = divmod(start_minutes, 60)
        end_hour, end_minute = divmod(end_minutes, 60)
        return f"{start_hour:02d}:{start_minute:02d}-{end_hour:02d}:{end_minute:02d}"

    def _safe_float(self, value: Any, allow_none: bool = False) -> Optional[float]:
        if value is None:
            return None if allow_none else 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return None if allow_none else 0.0

    def _safe_div(self, numerator: float, denominator: float) -> Optional[float]:
        if denominator is None or abs(denominator) <= 1e-9:
            return None
        return numerator / denominator

    def _safe_div_round(self, numerator: float, denominator: float, digits: int) -> Optional[float]:
        result = self._safe_div(numerator, denominator)
        return self._round(result, digits) if result is not None else None

    def _diff_round(
        self,
        left: Optional[float],
        right: Optional[float],
        digits: int,
    ) -> Optional[float]:
        if left is None or right is None:
            return None
        return self._round(left - right, digits)

    def _round(self, value: Optional[float], digits: int) -> Optional[float]:
        if value is None:
            return None
        return round(float(value), digits)

    def _now_iso(self) -> str:
        return datetime.now().isoformat(timespec="seconds")

    def _normalize_time_value(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.replace(tzinfo=None).isoformat(timespec="seconds")
        return str(value)

    def _max_timestamp(self, *values: Optional[str]) -> Optional[str]:
        normalized = [value for value in values if value]
        if not normalized:
            return None
        return max(normalized)
