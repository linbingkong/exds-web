import logging
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymongo.database import Database

from webapp.models.load_enums import FusionStrategy
from webapp.models.trade_review import (
    ContractEarningCalculationResponse,
    ContractEarningPeriodRow,
    DayAheadReviewChartRow,
    DayAheadReviewResponse,
    DeliveryDateSummary,
    ExecutionAnalysisSummary,
    ExecutionChartRow,
    ExecutionTableRow,
    MonthlyContractDetailItem,
    MonthlyContractDetailResponse,
    MonthlyContractDetailSummary,
    OperationButtonItem,
    OperationChartRow,
    OperationDetailResponse,
    OperationOverviewCard,
    OperationSummary,
    OperationTableRow,
    OrderLevelItem,
    PeriodOverviewCard,
    RecordOverviewCard,
    SummaryCardsResponse,
    TradeDateListResponse,
    TradeDetailResponse,
    TradeOverviewCard,
    TradeOverviewResponse,
)
from webapp.services.contract_service import ContractService
from webapp.services.load_forecast_service import LoadForecastService
from webapp.services.load_query_service import LoadQueryService
from webapp.services.spot_price_service import get_spot_price_curve_48, resample_to_48
from webapp.services.tou_service import get_tou_timeline_by_date

logger = logging.getLogger(__name__)

AUTO_OFF_SHELF_TYPES = {"自动下架", "自动下架-成交"}


class TradeReviewService:
    def __init__(self, db: Database) -> None:
        self.db = db
        self.trade_declare_collection = db["trade_declare"]
        self.contracts_collection = db["contracts_aggregated_daily"]
        self.contracts_detailed_collection = db["contracts_detailed_daily"]
        self.mechanism_collection = db["mechanism_energy_monthly"]
        self.contract_service = ContractService(db)
        self.load_forecast_service = LoadForecastService(db)
        self.load_query_service = LoadQueryService

    def get_trade_dates(self) -> TradeDateListResponse:
        trade_dates = sorted(
            [item for item in self.trade_declare_collection.distinct("trade_date") if item],
            reverse=True,
        )
        return TradeDateListResponse(
            latest_trade_date=trade_dates[0] if trade_dates else None,
            trade_dates=trade_dates,
        )

    def get_trade_overview(self, trade_date: str) -> TradeOverviewResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_summaries = [
            DeliveryDateSummary(
                delivery_date=str(group.get("delivery_date", "")),
                record_count=len(group.get("records", [])),
            )
            for group in doc.get("delivery_groups", [])
            if group.get("delivery_date")
        ]
        delivery_summaries.sort(key=lambda item: item.delivery_date)
        return TradeOverviewResponse(trade_date=trade_date, delivery_summaries=delivery_summaries)

    def get_trade_detail(self, trade_date: str, delivery_date: str) -> TradeDetailResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        spot_price_map = self._load_spot_prices(delivery_date)

        operations = self._build_operations(records)
        execution_chart = self._build_execution_rows(trade_date, delivery_date, records, spot_price_map)
        execution_table = [ExecutionTableRow(**row.model_dump()) for row in execution_chart]
        summary_cards = self._build_summary_cards(records, operations)
        execution_analysis_summary = self._build_execution_analysis_summary(records, spot_price_map)
        default_operation = operations[0] if operations else None

        return TradeDetailResponse(
            trade_date=trade_date,
            delivery_date=delivery_date,
            summary_cards=summary_cards,
            execution_analysis_summary=execution_analysis_summary,
            execution_chart=execution_chart,
            execution_table=execution_table,
            operation_buttons=[self._to_operation_button_item(operation) for operation in operations],
            default_operation_id=default_operation["operation_id"] if default_operation else None,
            default_operation_detail=(
                self._build_operation_detail(default_operation, records, delivery_date, spot_price_map)
                if default_operation
                else None
            ),
            review_texts=self._build_review_texts(summary_cards),
        )

    def get_operation_detail(
        self,
        trade_date: str,
        delivery_date: str,
        operation_id: str,
    ) -> OperationDetailResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        spot_price_map = self._load_spot_prices(delivery_date)
        operations = self._build_operations(records)
        target_operation = next(
            (operation for operation in operations if operation["operation_id"] == operation_id),
            None,
        )
        if target_operation is None:
            raise ValueError(f"未找到对应操作: {operation_id}")
        return self._build_operation_detail(target_operation, records, delivery_date, spot_price_map)

    def get_monthly_contract_details(
        self,
        trade_date: str,
        delivery_date: str,
        period: int,
    ) -> MonthlyContractDetailResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        contract_result = self._build_monthly_contract_match_result(
            trade_date=trade_date,
            delivery_date=delivery_date,
            period=period,
            records=records,
        )

        return MonthlyContractDetailResponse(
            trade_date=trade_date,
            delivery_date=delivery_date,
            period=period,
            matched=contract_result["matched"],
            manual_match_required=not contract_result["matched"],
            match_message=contract_result["match_message"],
            summary=contract_result["summary"],
            contracts=contract_result["display_contracts"],
        )

    def calculate_contract_earnings(
        self,
        trade_date: str,
        delivery_date: str,
    ) -> ContractEarningCalculationResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        current_day_map, _, _, _ = self._load_trade_day_aggregates(records)
        spot_price_map = self._load_spot_prices(delivery_date)

        period_rows: List[ContractEarningPeriodRow] = []
        pnl_values: List[float] = []

        for period in range(1, 49):
            trade_net_mwh = round(current_day_map.get(period, 0.0), 3)
            if abs(trade_net_mwh) <= 0.001:
                continue

            contract_result = self._build_monthly_contract_match_result(
                trade_date=trade_date,
                delivery_date=delivery_date,
                period=period,
                records=records,
            )
            contract_avg_price = contract_result["summary"].avg_price_yuan_per_mwh
            spot_price = spot_price_map.get(period)
            period_profit_amount: Optional[float] = None
            if contract_result["matched"] and contract_avg_price is not None and spot_price is not None:
                if trade_net_mwh > 0:
                    period_profit_amount = round((spot_price - contract_avg_price) * abs(trade_net_mwh), 2)
                else:
                    period_profit_amount = round((contract_avg_price - spot_price) * abs(trade_net_mwh), 2)
                pnl_values.append(period_profit_amount)

            period_rows.append(
                ContractEarningPeriodRow(
                    period=period,
                    matched=contract_result["matched"],
                    trade_net_mwh=trade_net_mwh,
                    contract_avg_price_yuan_per_mwh=contract_avg_price,
                    spot_price=spot_price,
                    period_profit_amount=period_profit_amount,
                )
            )

        summary: Optional[ExecutionAnalysisSummary] = None
        if period_rows and all(row.period_profit_amount is not None for row in period_rows):
            profit_values = [value for value in pnl_values if value >= 0]
            loss_values = [value for value in pnl_values if value < 0]
            summary = ExecutionAnalysisSummary(
                profit_count=len(profit_values),
                profit_amount=round(sum(profit_values), 2),
                loss_count=len(loss_values),
                loss_amount=round(abs(sum(loss_values)), 2),
                total_profit_amount=round(sum(pnl_values), 2),
            )

        return ContractEarningCalculationResponse(
            trade_date=trade_date,
            delivery_date=delivery_date,
            summary=summary,
            period_rows=period_rows,
        )

    def _build_monthly_contract_match_result(
        self,
        trade_date: str,
        delivery_date: str,
        period: int,
        records: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        raw_contracts = self._load_raw_monthly_contracts(delivery_date, period)
        all_contracts = [
            MonthlyContractDetailItem(
                contract_id=item["contract_id"],
                seller_name=item["seller_name"],
                date=item["date"],
                period=item["period"],
                quantity_mwh=round(item["quantity_mwh_raw"], 3),
                price_yuan_per_mwh=item["price_yuan_per_mwh"],
            )
            for item in raw_contracts
        ]

        historical_map = self._load_historical_within_month_net(delivery_date, trade_date)
        current_day_map, _, _, _ = self._load_trade_day_aggregates(records)
        historical_quantity_mwh = round(historical_map.get(period, 0.0), 3)
        current_quantity_mwh = round(current_day_map.get(period, 0.0), 3)

        matched_contract_ids = self._match_monthly_contract_ids(
            raw_contracts,
            historical_quantity_mwh=historical_quantity_mwh,
            current_quantity_mwh=current_quantity_mwh,
        )
        matched = matched_contract_ids is not None and len(matched_contract_ids) > 0
        display_contracts = (
            [item for item in all_contracts if item.contract_id in matched_contract_ids]
            if matched_contract_ids is not None and len(matched_contract_ids) > 0
            else all_contracts
        )
        summary = self._build_monthly_contract_detail_summary(
            display_contracts,
            historical_quantity_mwh=historical_quantity_mwh,
            current_quantity_mwh=current_quantity_mwh,
        )

        if matched:
            match_message = "已按历史电量与当前成交电量自动匹配合同。"
        elif abs(current_quantity_mwh) <= 0.001:
            match_message = "当前时段成交电量为0，未执行自动匹配，请手工核对。"
        else:
            match_message = "未能根据历史电量和当前成交电量自动匹配合同，已显示全部合同，请手工匹配。"

        return {
            "matched": matched,
            "match_message": match_message,
            "summary": summary,
            "display_contracts": display_contracts,
        }

    def _load_raw_monthly_contracts(self, delivery_date: str, period: int) -> List[Dict[str, Any]]:
        pipeline = [
            {
                "$match": {
                    "date": delivery_date,
                    "entity": "售电公司",
                    "contract_type": "市场化",
                    "contract_period": "月内",
                    "periods.period": period,
                }
            },
            {"$unwind": "$periods"},
            {"$match": {"periods.period": period}},
            {"$sort": {"_id": 1}},
            {
                "$project": {
                    "_id": {"$toString": "$_id"},
                    "seller_name": {"$ifNull": ["$售方名称", ""]},
                    "date": "$date",
                    "period": "$periods.period",
                    "quantity_mwh": {"$ifNull": ["$periods.quantity_mwh", 0]},
                    "price_yuan_per_mwh": "$periods.price_yuan_per_mwh",
                }
            },
        ]

        return [
            {
                "contract_id": str(item.get("_id") or ""),
                "seller_name": str(item.get("seller_name") or ""),
                "date": str(item.get("date") or delivery_date),
                "period": int(item.get("period") or period),
                "quantity_mwh_raw": self._safe_float(item.get("quantity_mwh")),
                "price_yuan_per_mwh": (
                    round(float(item["price_yuan_per_mwh"]), 3)
                    if item.get("price_yuan_per_mwh") is not None
                    else None
                ),
            }
            for item in self.contracts_detailed_collection.aggregate(pipeline)
        ]

    def _match_monthly_contract_ids(
        self,
        contracts: List[Dict[str, Any]],
        historical_quantity_mwh: float,
        current_quantity_mwh: float,
    ) -> Optional[List[str]]:
        tolerance = 0.001
        if not contracts or abs(current_quantity_mwh) <= tolerance:
            return None

        prefix_quantity = 0.0
        start_index: Optional[int] = None
        for index, contract in enumerate(contracts):
            if abs(prefix_quantity - historical_quantity_mwh) <= tolerance:
                start_index = index
                break
            prefix_quantity += float(contract.get("quantity_mwh_raw") or 0.0)

        if start_index is None:
            if abs(prefix_quantity - historical_quantity_mwh) <= tolerance:
                return []
            return None

        running_quantity = 0.0
        for end_index in range(start_index, len(contracts)):
            running_quantity += float(contracts[end_index].get("quantity_mwh_raw") or 0.0)
            if abs(running_quantity - current_quantity_mwh) <= tolerance:
                return [str(item.get("contract_id") or "") for item in contracts[start_index:end_index + 1]]
        return None

    def _build_monthly_contract_detail_summary(
        self,
        contracts: List[MonthlyContractDetailItem],
        historical_quantity_mwh: float,
        current_quantity_mwh: float,
    ) -> MonthlyContractDetailSummary:
        displayed_quantity_mwh = round(sum(item.quantity_mwh for item in contracts), 3)
        weighted_amount = sum(
            abs(item.quantity_mwh) * float(item.price_yuan_per_mwh)
            for item in contracts
            if item.price_yuan_per_mwh is not None
        )
        quantity_for_price = sum(
            abs(item.quantity_mwh)
            for item in contracts
            if item.price_yuan_per_mwh is not None
        )
        avg_price = round(weighted_amount / quantity_for_price, 3) if quantity_for_price > 0 else None
        return MonthlyContractDetailSummary(
            historical_quantity_mwh=historical_quantity_mwh,
            current_quantity_mwh=current_quantity_mwh,
            displayed_quantity_mwh=displayed_quantity_mwh,
            avg_price_yuan_per_mwh=avg_price,
            contract_count=len(contracts),
        )

    def get_day_ahead_review(self, target_date: str) -> DayAheadReviewResponse:
        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        use_econ_price = target_date >= "2026-02-01"
        settlement_price_type = "econ" if use_econ_price else "physical"

        rt_curve = get_spot_price_curve_48(
            self.db,
            target_date,
            "real_time_spot_price",
            price_field="arithmetic_avg_clearing_price",
        )
        da_curve = get_spot_price_curve_48(
            self.db,
            target_date,
            "day_ahead_spot_price",
            price_field="avg_clearing_price",
        )
        da_econ_curve = get_spot_price_curve_48(
            self.db,
            target_date,
            "day_ahead_econ_price",
            price_field="clearing_price",
        )

        rt_map = {period: value for period, value in enumerate(rt_curve[:48], start=1)}
        da_map = {period: value for period, value in enumerate(da_curve[:48], start=1)}
        da_econ_map = {period: value for period, value in enumerate(da_econ_curve[:48], start=1)}
        declared_map = self._load_day_ahead_declared_volume_map(target_date)
        actual_load_map = self._load_aggregate_actual_curve(target_date)
        forecast_gap_min_map = self._load_forecast_curve_from_service(target_date)
        tou_timeline_48 = get_tou_timeline_by_date(target_dt, points=48)

        chart_rows: List[DayAheadReviewChartRow] = []
        can_compute_summary = True
        period_pnl_list: List[float] = []

        for period in range(1, 49):
            minutes = period * 30
            hour = minutes // 60
            minute = minutes % 60
            time_str = f"{hour:02d}:{minute:02d}"
            period_type = tou_timeline_48[period - 1] if len(tou_timeline_48) == 48 else "平段"
            declared_mwh = round(float(declared_map.get(period, 0.0) or 0.0), 6)
            actual_load_mwh = actual_load_map.get(period)
            forecast_gap_min_mwh = forecast_gap_min_map.get(period)
            rt_price = rt_map.get(period)
            da_price = da_map.get(period)
            da_econ_price = da_econ_map.get(period)

            chosen_da_price = da_econ_price if use_econ_price else da_price
            if declared_mwh > 0:
                if rt_price is None or chosen_da_price is None:
                    can_compute_summary = False
                else:
                    period_pnl_list.append((rt_price - chosen_da_price) * declared_mwh)

            chart_rows.append(
                DayAheadReviewChartRow(
                    period=period,
                    time=time_str,
                    period_type=period_type,
                    declared_mwh=declared_mwh,
                    actual_load_mwh=round(actual_load_mwh, 3) if actual_load_mwh is not None else None,
                    forecast_gap_min_mwh=round(forecast_gap_min_mwh, 3) if forecast_gap_min_mwh is not None else None,
                    price_rt=round(rt_price, 3) if rt_price is not None else None,
                    price_da=round(da_price, 3) if da_price is not None else None,
                    price_da_econ=round(da_econ_price, 3) if da_econ_price is not None else None,
                    price_da_forecast=None,
                )
            )

        summary: Optional[ExecutionAnalysisSummary] = None
        if can_compute_summary and period_pnl_list:
            profit_values = [value for value in period_pnl_list if value >= 0]
            loss_values = [value for value in period_pnl_list if value < 0]
            summary = ExecutionAnalysisSummary(
                profit_count=len(profit_values),
                profit_amount=round(sum(profit_values), 2),
                loss_count=len(loss_values),
                loss_amount=round(abs(sum(loss_values)), 2),
                total_profit_amount=round(sum(period_pnl_list), 2),
            )

        return DayAheadReviewResponse(
            target_date=target_date,
            settlement_price_type=settlement_price_type,
            chart_rows=chart_rows,
            execution_analysis_summary=summary,
        )

    def _load_day_ahead_declared_volume_map(self, target_date: str) -> Dict[int, float]:
        docs = list(
            self.db.day_ahead_energy_declare.find(
                {"date_str": target_date},
                {"_id": 0, "energy_mwh": 1, "time_str": 1, "period": 1, "datetime": 1},
            ).sort("time_str", 1)
        )
        if not docs:
            start_dt = datetime.strptime(target_date, "%Y-%m-%d")
            end_dt = start_dt + timedelta(days=1)
            docs = list(
                self.db.day_ahead_energy_declare.find(
                    {"datetime": {"$gt": start_dt, "$lte": end_dt}},
                    {"_id": 0, "energy_mwh": 1, "time_str": 1, "period": 1, "datetime": 1},
                ).sort("datetime", 1)
            )
        if not docs:
            return {}

        raw_values: List[float] = []
        for doc in docs:
            try:
                raw_values.append(float(doc.get("energy_mwh", 0) or 0))
            except (TypeError, ValueError):
                raw_values.append(0.0)

        values_48 = resample_to_48(raw_values, method="sum")
        return {idx + 1: round(values_48[idx], 6) for idx in range(min(48, len(values_48)))}

    def _get_trade_doc(self, trade_date: str) -> Dict[str, Any]:
        doc = self.trade_declare_collection.find_one({"trade_date": trade_date}, {"_id": 0})
        if doc is None:
            raise ValueError(f"未找到交易日 {trade_date} 的交易申报记录")
        return doc

    def _get_delivery_group(self, doc: Dict[str, Any], delivery_date: str) -> Dict[str, Any]:
        for group in doc.get("delivery_groups", []):
            if group.get("delivery_date") == delivery_date:
                return group
        raise ValueError(f"交易日 {doc.get('trade_date')} 下未找到目标日 {delivery_date} 的记录")

    def _normalize_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        listing_mwh = self._safe_float(record.get("listing_mwh"))
        remaining_mwh = self._safe_float(record.get("remaining_mwh"))
        traded_mwh = max(listing_mwh - remaining_mwh, 0.0)
        normalized = {
            "record_key": str(record.get("record_key") or ""),
            "period": int(record.get("period") or 0),
            "trade_direction": self._map_trade_direction(record.get("listing_side")),
            "listing_mwh": listing_mwh,
            "remaining_mwh": remaining_mwh,
            "traded_mwh": traded_mwh,
            "listing_price": self._safe_float(record.get("listing_price"), allow_none=True),
            "listing_time": record.get("listing_time"),
            "off_shelf_time": record.get("off_shelf_time"),
            "off_shelf_type": record.get("off_shelf_type"),
            "is_traded": traded_mwh > 0,
        }
        normalized["holding_seconds"] = self._calc_holding_seconds(
            normalized.get("listing_time"), normalized.get("off_shelf_time")
        )
        normalized["record_result"] = self._resolve_record_result(normalized)
        return normalized

    def _build_summary_cards(
        self,
        records: List[Dict[str, Any]],
        operations: List[Dict[str, Any]],
    ) -> SummaryCardsResponse:
        traded_records = [record for record in records if record["is_traded"]]
        buy_traded_mwh = sum(
            record["traded_mwh"] for record in traded_records if record["trade_direction"] == "buy"
        )
        sell_traded_mwh = sum(
            record["traded_mwh"] for record in traded_records if record["trade_direction"] == "sell"
        )
        buy_periods = {record["period"] for record in traded_records if record["trade_direction"] == "buy"}
        sell_periods = {record["period"] for record in traded_records if record["trade_direction"] == "sell"}

        return SummaryCardsResponse(
            record_overview=RecordOverviewCard(
                total_records=len(records),
                traded_records=len(traded_records),
            ),
            trade_overview=TradeOverviewCard(
                traded_mwh=round(sum(record["traded_mwh"] for record in traded_records), 3),
                buy_traded_mwh=round(buy_traded_mwh, 3),
                sell_traded_mwh=round(sell_traded_mwh, 3),
            ),
            period_overview=PeriodOverviewCard(
                traded_period_count=len(buy_periods | sell_periods),
                buy_traded_period_count=len(buy_periods),
                sell_traded_period_count=len(sell_periods),
            ),
            operation_overview=OperationOverviewCard(
                listing_operation_count=sum(1 for operation in operations if operation["operation_type"] == "listing"),
                manual_off_shelf_operation_count=sum(
                    1 for operation in operations if operation["operation_type"] == "manual_off_shelf"
                ),
                auto_off_shelf_operation_count=sum(
                    1 for operation in operations if operation["operation_type"] == "auto_off_shelf"
                ),
            ),
        )

    def _build_execution_rows(
        self,
        trade_date: str,
        delivery_date: str,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> List[ExecutionChartRow]:
        annual_map = self._load_contract_period_quantities(delivery_date, "年度")
        monthly_map = self._load_contract_period_quantities(delivery_date, "月度")
        mechanism_map = self._load_mechanism_quantities(delivery_date)
        historical_map = self._load_historical_within_month_net(delivery_date, trade_date)
        current_day_map, price_map, count_map, volume_map = self._load_trade_day_aggregates(records)
        period_profit_map = self._build_period_profit_map(records, spot_price_map)
        market_price_map = self._load_marketized_annual_monthly_weighted_prices(delivery_date)
        load_map, load_source = self._load_target_load_curve(delivery_date)

        rows: List[ExecutionChartRow] = []
        for period in range(1, 49):
            annual_monthly_mwh = annual_map.get(period, 0.0)
            monthly_mwh = monthly_map.get(period, 0.0)
            mechanism_mwh = mechanism_map.get(period, 0.0)
            historical_net = historical_map.get(period, 0.0)
            trade_day_net = current_day_map.get(period, 0.0)
            final_position = annual_monthly_mwh + monthly_mwh + mechanism_mwh + historical_net + trade_day_net
            rows.append(
                ExecutionChartRow(
                    period=period,
                    annual_monthly_mwh=round(annual_monthly_mwh, 3),
                    monthly_mwh=round(monthly_mwh, 3),
                    mechanism_mwh=round(mechanism_mwh, 3),
                    historical_within_month_net_mwh=round(historical_net, 3),
                    trade_day_net_mwh=round(trade_day_net, 3),
                    final_position_mwh=round(final_position, 3),
                    actual_or_forecast_load_mwh=load_map.get(period),
                    load_source=load_source,
                    trade_avg_price=price_map.get(period),
                    trade_count=count_map.get(period, 0),
                    trade_volume_mwh=round(volume_map.get(period, 0.0), 3),
                    market_monthly_price=market_price_map.get(period),
                    spot_price=spot_price_map.get(period),
                    period_profit_amount=period_profit_map.get(period),
                )
            )
        return rows

    def _build_period_profit_map(
        self,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> Dict[int, Optional[float]]:
        traded_records = [record for record in records if record["is_traded"] and record["period"] > 0]
        empty_profit_map = {period: None for period in range(1, 49)}
        if not traded_records or not spot_price_map:
            return empty_profit_map

        period_profit_map: Dict[int, float] = defaultdict(float)
        for record in traded_records:
            spot_price = spot_price_map.get(record["period"])
            listing_price = record.get("listing_price")
            if spot_price is None or listing_price is None:
                return empty_profit_map

            traded_mwh = record["traded_mwh"]
            if record["trade_direction"] == "buy":
                pnl = (spot_price - float(listing_price)) * traded_mwh
            elif record["trade_direction"] == "sell":
                pnl = (float(listing_price) - spot_price) * traded_mwh
            else:
                continue

            period_profit_map[record["period"]] += pnl

        return {period: round(period_profit_map.get(period, 0.0), 2) for period in range(1, 49)}

    def _build_execution_analysis_summary(
        self,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> Optional[ExecutionAnalysisSummary]:
        traded_records = [record for record in records if record["is_traded"] and record["period"] > 0]
        if not traded_records or not spot_price_map:
            return None

        period_profit_map: Dict[int, float] = defaultdict(float)

        for record in traded_records:
            spot_price = spot_price_map.get(record["period"])
            listing_price = record.get("listing_price")
            if spot_price is None or listing_price is None:
                return None

            traded_mwh = record["traded_mwh"]
            if record["trade_direction"] == "buy":
                pnl = (spot_price - float(listing_price)) * traded_mwh
            elif record["trade_direction"] == "sell":
                pnl = (float(listing_price) - spot_price) * traded_mwh
            else:
                continue

            period_profit_map[record["period"]] += pnl

        period_pnl_values = [round(value, 2) for value in period_profit_map.values()]
        profit_values = [value for value in period_pnl_values if value >= 0]
        loss_values = [value for value in period_pnl_values if value < 0]

        return ExecutionAnalysisSummary(
            profit_count=len(profit_values),
            profit_amount=round(sum(profit_values), 2),
            loss_count=len(loss_values),
            loss_amount=round(abs(sum(loss_values)), 2),
            total_profit_amount=round(sum(period_pnl_values), 2),
        )

    def _load_trade_day_aggregates(
        self,
        records: List[Dict[str, Any]],
    ) -> Tuple[Dict[int, float], Dict[int, Optional[float]], Dict[int, int], Dict[int, float]]:
        net_map: Dict[int, float] = defaultdict(float)
        price_weighted_sum: Dict[int, float] = defaultdict(float)
        volume_map: Dict[int, float] = defaultdict(float)
        count_map: Dict[int, int] = defaultdict(int)

        for record in records:
            period = record["period"]
            traded_mwh = record["traded_mwh"]
            if traded_mwh <= 0 or period <= 0:
                continue
            sign = 1.0 if record["trade_direction"] == "buy" else -1.0 if record["trade_direction"] == "sell" else 0.0
            net_map[period] += traded_mwh * sign
            volume_map[period] += traded_mwh
            count_map[period] += 1
            if record.get("listing_price") is not None:
                price_weighted_sum[period] += traded_mwh * float(record["listing_price"])

        avg_price_map: Dict[int, Optional[float]] = {}
        for period, total_volume in volume_map.items():
            if total_volume > 0:
                avg_price_map[period] = round(price_weighted_sum.get(period, 0.0) / total_volume, 3)
        return net_map, avg_price_map, count_map, volume_map

    def _load_historical_within_month_net(self, delivery_date: str, trade_date: str) -> Dict[int, float]:
        period_map: Dict[int, float] = defaultdict(float)
        cursor = self.trade_declare_collection.find(
            {"trade_date": {"$lt": trade_date}, "delivery_dates": delivery_date},
            {"_id": 0, "delivery_groups": 1},
        )
        for doc in cursor:
            group = next(
                (item for item in doc.get("delivery_groups", []) if item.get("delivery_date") == delivery_date),
                None,
            )
            if group is None:
                continue
            for raw_record in group.get("records", []):
                record = self._normalize_record(raw_record)
                if not record["is_traded"] or record["period"] <= 0:
                    continue
                sign = 1.0 if record["trade_direction"] == "buy" else -1.0 if record["trade_direction"] == "sell" else 0.0
                period_map[record["period"]] += record["traded_mwh"] * sign
        return period_map

    def _load_contract_period_quantities(self, delivery_date: str, contract_period: str) -> Dict[int, float]:
        doc = self.contracts_collection.find_one(
            {
                "date": delivery_date,
                "entity": "售电公司",
                "contract_type": "整体",
                "contract_period": contract_period,
            },
            {"_id": 0, "periods": 1},
        )
        result: Dict[int, float] = {}
        if not doc:
            return result
        for item in doc.get("periods", []):
            period = int(item.get("period") or 0)
            if period > 0:
                result[period] = self._safe_float(item.get("quantity_mwh"))
        return result

    def _load_marketized_annual_monthly_weighted_prices(self, delivery_date: str) -> Dict[int, Optional[float]]:
        docs = list(
            self.contracts_collection.find(
                {
                    "date": delivery_date,
                    "entity": "售电公司",
                    "contract_type": "市场化",
                    "contract_period": {"$in": ["年度", "月度"]},
                },
                {"_id": 0, "contract_period": 1, "periods": 1},
            )
        )

        period_price_qty: Dict[str, Dict[int, Tuple[Optional[float], float]]] = {"年度": {}, "月度": {}}
        for doc in docs:
            period_key = str(doc.get("contract_period") or "")
            if period_key not in period_price_qty:
                continue
            target = period_price_qty[period_key]
            for item in doc.get("periods", []):
                period = int(item.get("period") or 0)
                if period <= 0:
                    continue
                price_raw = item.get("price_yuan_per_mwh")
                price = float(price_raw) if price_raw is not None else None
                qty = self._safe_float(item.get("quantity_mwh"))
                target[period] = (price, qty)

        result: Dict[int, Optional[float]] = {}
        for period in range(1, 49):
            annual_price, annual_qty = period_price_qty["年度"].get(period, (None, 0.0))
            monthly_price, monthly_qty = period_price_qty["月度"].get(period, (None, 0.0))

            weighted_sum = 0.0
            total_qty = 0.0
            if annual_price is not None and annual_qty > 0:
                weighted_sum += annual_price * annual_qty
                total_qty += annual_qty
            if monthly_price is not None and monthly_qty > 0:
                weighted_sum += monthly_price * monthly_qty
                total_qty += monthly_qty

            if total_qty > 0:
                result[period] = round(weighted_sum / total_qty, 3)
                continue

            candidates = [price for price in [annual_price, monthly_price] if price is not None]
            if not candidates:
                result[period] = None
            elif len(candidates) == 1:
                result[period] = round(candidates[0], 3)
            else:
                result[period] = round(sum(candidates) / 2, 3)

        return result

    def _load_mechanism_quantities(self, delivery_date: str) -> Dict[int, float]:
        month_str = delivery_date[:7]
        doc = self.mechanism_collection.find_one({"month_str": month_str}, {"_id": 0, "period_values": 1})
        if not doc:
            return {}
        try:
            year, month = [int(part) for part in month_str.split("-")]
            days_in_month = monthrange(year, month)[1]
        except (TypeError, ValueError):
            days_in_month = 1
        values = doc.get("period_values", [])
        return {
            index + 1: round(self._safe_float(value) / days_in_month, 3)
            for index, value in enumerate(values[:48])
        }

    def _load_spot_prices(self, delivery_date: str) -> Dict[int, Optional[float]]:
        try:
            spot_curve = get_spot_price_curve_48(
                self.db,
                delivery_date,
                "real_time_spot_price",
                price_field="arithmetic_avg_clearing_price",
            )
        except Exception as exc:
            logger.warning("加载现货价格失败: %s", exc)
            return {}
        return {
            period: round(price, 3) if price is not None else None
            for period, price in enumerate(spot_curve[:48], start=1)
        }

    def _load_target_load_curve(self, delivery_date: str) -> Tuple[Dict[int, float], Optional[str]]:
        actual_map = self._load_aggregate_actual_curve(delivery_date)
        if actual_map:
            return actual_map, "actual"

        forecast_map = self._load_forecast_curve_from_service(delivery_date)
        if forecast_map:
            return forecast_map, "forecast"

        return {}, None

    def _load_aggregate_actual_curve(self, delivery_date: str) -> Dict[int, float]:
        try:
            customer_ids = self.contract_service.get_active_customers(delivery_date, delivery_date)
            if not customer_ids:
                return {}
            curves = self.load_query_service.aggregate_curve_series(
                customer_ids=customer_ids,
                start_date=delivery_date,
                end_date=delivery_date,
                strategy=FusionStrategy.MP_COMPLETE,
            )
            if not curves:
                return {}
            values = curves[0].values or []
            return {
                index + 1: round(self._safe_float(value), 3)
                for index, value in enumerate(values[:48])
            }
        except Exception as exc:
            logger.warning("加载聚合实际电量失败: %s", exc)
            return {}

    def _load_forecast_curve_from_service(self, delivery_date: str) -> Dict[int, float]:
        try:
            versions = self.load_forecast_service.get_versions(delivery_date)
            if not versions:
                return {}
            version = min(
                versions,
                key=lambda item: (
                    int(item.get("gap") or 999999),
                    str(item.get("forecast_date") or ""),
                ),
            )
            forecast_date = version.get("forecast_date")
            if not forecast_date:
                return {}
            forecast_data = self.load_forecast_service.get_forecast_data(
                delivery_date,
                forecast_date,
                customer_id="AGGREGATE",
            )
            if not forecast_data:
                return {}
            values = forecast_data.get("values") or []
            return {
                index + 1: round(self._safe_float(value), 3)
                for index, value in enumerate(values[:48])
            }
        except Exception as exc:
            logger.warning("加载聚合预测电量失败: %s", exc)
            return {}

    def _build_operations(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        listing_operations = self._build_operation_groups(
            records,
            time_field="listing_time",
            operation_type="listing",
        )
        manual_operations = self._build_operation_groups(
            records,
            time_field="off_shelf_time",
            operation_type="manual_off_shelf",
            off_shelf_type="人工下架",
        )
        auto_operations = self._build_operation_groups(
            records,
            time_field="off_shelf_time",
            operation_type="auto_off_shelf",
            off_shelf_types=list(AUTO_OFF_SHELF_TYPES),
        )
        partial_fill_operations = self._build_operation_groups(
            records,
            time_field="listing_time",
            operation_type="partial_fill",
            record_filter=self._is_partial_fill_record,
        )
        operations = listing_operations + manual_operations + auto_operations + partial_fill_operations
        operations.sort(key=lambda item: item["sort_time"])
        return operations

    def _build_operation_groups(
        self,
        records: List[Dict[str, Any]],
        time_field: str,
        operation_type: str,
        off_shelf_type: Optional[str] = None,
        off_shelf_types: Optional[List[str]] = None,
        record_filter: Optional[Any] = None,
    ) -> List[Dict[str, Any]]:
        candidates: List[Tuple[datetime, Dict[str, Any]]] = []
        for record in records:
            if record_filter is not None and not record_filter(record):
                continue
            if off_shelf_type is not None and record.get("off_shelf_type") != off_shelf_type:
                continue
            if off_shelf_types is not None and record.get("off_shelf_type") not in off_shelf_types:
                continue
            dt = self._parse_datetime(record.get(time_field))
            if dt is not None:
                candidates.append((dt, record))
        candidates.sort(key=lambda item: item[0])

        operations: List[Dict[str, Any]] = []
        current_records: List[Dict[str, Any]] = []
        current_start: Optional[datetime] = None
        current_end: Optional[datetime] = None
        seen_periods: set[int] = set()
        index = 1

        def flush_operation() -> None:
            nonlocal current_records, current_start, current_end, seen_periods, index
            if not current_records or current_start is None or current_end is None:
                return
            operations.append(
                {
                    "operation_id": f"{operation_type}_{index:03d}",
                    "operation_type": operation_type,
                    "operation_time": current_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "operation_end_time": current_end.strftime("%Y-%m-%d %H:%M:%S"),
                    "record_count": len(current_records),
                    "covered_period_count": len(
                        {record["period"] for record in current_records if record["period"] > 0}
                    ),
                    "buy_record_count": sum(
                        1 for record in current_records if record["trade_direction"] == "buy"
                    ),
                    "sell_record_count": sum(
                        1 for record in current_records if record["trade_direction"] == "sell"
                    ),
                    "records": [dict(record) for record in current_records],
                    "sort_time": current_start,
                }
            )
            current_records = []
            current_start = None
            current_end = None
            seen_periods = set()
            index += 1

        for dt, record in candidates:
            should_split = False
            if current_end is not None:
                if (dt - current_end).total_seconds() > 5:
                    should_split = True
                if record["period"] in seen_periods:
                    should_split = True
            if should_split:
                flush_operation()
            if current_start is None:
                current_start = dt
            current_end = dt
            seen_periods.add(record["period"])
            current_records.append(record)
        flush_operation()
        return operations

    def _build_operation_detail(
        self,
        operation: Dict[str, Any],
        all_records: List[Dict[str, Any]],
        delivery_date: str,
        spot_price_map: Dict[int, Optional[float]],
    ) -> OperationDetailResponse:
        snapshot_records = self._build_post_operation_snapshot_v2(all_records, operation)
        load_map, load_source = self._load_target_load_curve(delivery_date)
        market_price_map = self._load_marketized_annual_monthly_weighted_prices(delivery_date)
        operation_record_keys = {record["record_key"] for record in operation["records"]}

        chart_rows: List[OperationChartRow] = []
        table_rows: List[OperationTableRow] = []
        for period in range(1, 49):
            period_records = [record for record in snapshot_records if record["period"] == period]
            buy_levels = self._build_order_levels(period_records, "buy")
            sell_levels = self._build_order_levels(period_records, "sell")

            chart_rows.append(
                OperationChartRow(
                    period=period,
                    buy_order_levels=buy_levels,
                    sell_order_levels=sell_levels,
                    market_monthly_price=market_price_map.get(period),
                    spot_price=spot_price_map.get(period),
                    actual_or_forecast_load_mwh=load_map.get(period),
                    load_source=load_source,
                )
            )

            table_rows.extend(
                self._build_operation_table_rows(
                    period_records=period_records,
                    period=period,
                    spot_price=spot_price_map.get(period),
                    operation_type=operation["operation_type"],
                    operation_record_keys=operation_record_keys,
                )
            )

        return OperationDetailResponse(
            operation_id=operation["operation_id"],
            operation_type=operation["operation_type"],
            operation_time=operation["operation_time"],
            operation_summary=self._build_operation_summary(operation, snapshot_records),
            chart_rows=chart_rows,
            table_rows=table_rows,
        )

    def _build_post_operation_snapshot(
        self,
        all_records: List[Dict[str, Any]],
        operation: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        operation_time = self._parse_datetime(operation.get("operation_end_time") or operation["operation_time"])
        if operation_time is None:
            return []

        snapshot_records: List[Dict[str, Any]] = []
        operation_record_keys = {record["record_key"] for record in operation["records"]}
        for record in all_records:
            listing_dt = self._parse_datetime(record.get("listing_time"))
            if listing_dt is None or listing_dt > operation_time:
                continue
            off_shelf_dt = self._parse_datetime(record.get("off_shelf_time"))
            if off_shelf_dt is not None and off_shelf_dt <= operation_time:
                continue
            if record["period"] <= 0 or record["trade_direction"] not in {"buy", "sell"}:
                continue
            if record.get("listing_price") is None:
                continue
            snapshot_record = dict(record)
            # 第四层展示的是历史时点的挂单状态，挂牌后在下架前按原始挂牌电量计入。
            snapshot_record["active_mwh"] = record["listing_mwh"]
            snapshot_records.append(snapshot_record)

        return snapshot_records

    def _build_post_operation_snapshot_v2(
        self,
        all_records: List[Dict[str, Any]],
        operation: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        operation_time = self._parse_datetime(operation.get("operation_end_time") or operation["operation_time"])
        if operation_time is None:
            return []

        operation_record_keys = {record["record_key"] for record in operation["records"]}
        snapshot_records: List[Dict[str, Any]] = []
        for record in all_records:
            listing_dt = self._parse_datetime(record.get("listing_time"))
            if listing_dt is None or listing_dt > operation_time:
                continue
            off_shelf_dt = self._parse_datetime(record.get("off_shelf_time"))
            if off_shelf_dt is not None and off_shelf_dt <= operation_time:
                continue
            if record["period"] <= 0 or record["trade_direction"] not in {"buy", "sell"}:
                continue
            if record.get("listing_price") is None:
                continue

            snapshot_record = dict(record)
            if operation["operation_type"] == "partial_fill" and record["record_key"] in operation_record_keys:
                snapshot_record["active_mwh"] = record["remaining_mwh"]
            else:
                snapshot_record["active_mwh"] = record["listing_mwh"]
            snapshot_records.append(snapshot_record)

        return snapshot_records

    def _build_order_levels(
        self,
        period_records: List[Dict[str, Any]],
        direction: str,
    ) -> List[OrderLevelItem]:
        grouped: Dict[float, float] = defaultdict(float)
        for record in period_records:
            if record["trade_direction"] != direction or record.get("listing_price") is None:
                continue
            grouped[float(record["listing_price"])] += record["active_mwh"]

        sorted_prices = sorted(grouped.keys(), reverse=True)
        return [
            OrderLevelItem(
                level_index=index,
                price=round(price, 3),
                volume_mwh=round(grouped[price], 3),
                color_token=f"{direction}_level_{index}",
            )
            for index, price in enumerate(sorted_prices, start=1)
        ]

    def _build_operation_table_rows(
        self,
        period_records: List[Dict[str, Any]],
        period: int,
        spot_price: Optional[float],
        operation_type: str,
        operation_record_keys: set[str],
    ) -> List[OperationTableRow]:
        rows: List[OperationTableRow] = []
        for direction in ("buy", "sell"):
            direction_records = [
                record
                for record in period_records
                if record["trade_direction"] == direction and record.get("listing_price") is not None
            ]
            sorted_records = sorted(
                direction_records,
                key=lambda item: float(item["listing_price"]),
                reverse=True,
            )
            same_direction_level_count = len(sorted_records)
            for index, record in enumerate(sorted_records, start=1):
                effect_type = "keep"
                effect_mwh = 0.0
                if record["record_key"] in operation_record_keys and operation_type == "listing":
                    effect_type = "add"
                    effect_mwh = record["listing_mwh"]
                elif record["record_key"] in operation_record_keys and operation_type == "partial_fill":
                    effect_type = "partial_fill"
                    effect_mwh = record["traded_mwh"]

                rows.append(
                    OperationTableRow(
                        record_key=record["record_key"],
                        period=period,
                        trade_direction=direction,
                        price_level_index=index,
                        same_direction_level_count=same_direction_level_count,
                        listing_price=record.get("listing_price"),
                        listing_mwh=round(record["active_mwh"], 3),
                        spot_price=spot_price,
                        operation_effect_type=effect_type,
                        operation_effect_mwh=round(effect_mwh, 3),
                    )
                )
        return rows

    def _build_operation_summary(
        self,
        operation: Dict[str, Any],
        snapshot_records: List[Dict[str, Any]],
    ) -> OperationSummary:
        buy_period_count = len(
            {
                record["period"]
                for record in operation["records"]
                if record["trade_direction"] == "buy" and record["period"] > 0
            }
        )
        sell_period_count = len(
            {
                record["period"]
                for record in operation["records"]
                if record["trade_direction"] == "sell" and record["period"] > 0
            }
        )
        remaining_period_count = len({record["period"] for record in snapshot_records if record["period"] > 0})
        remaining_buy_mwh = round(
            sum(record["active_mwh"] for record in snapshot_records if record["trade_direction"] == "buy"),
            3,
        )
        remaining_sell_mwh = round(
            sum(record["active_mwh"] for record in snapshot_records if record["trade_direction"] == "sell"),
            3,
        )

        operation_title = f"{self._get_operation_label(operation['operation_type'])} {operation['operation_time'][11:]}"
        if operation["operation_type"] == "listing":
            effect_text = f"新增买入挂单 {buy_period_count} 个时段，新增卖出挂单 {sell_period_count} 个时段"
        elif operation["operation_type"] == "manual_off_shelf":
            effect_text = f"撤销买入挂单 {buy_period_count} 个时段，撤销卖出挂单 {sell_period_count} 个时段"
        elif operation["operation_type"] == "partial_fill":
            traded_buy_mwh = round(
                sum(record["traded_mwh"] for record in operation["records"] if record["trade_direction"] == "buy"),
                3,
            )
            traded_sell_mwh = round(
                sum(record["traded_mwh"] for record in operation["records"] if record["trade_direction"] == "sell"),
                3,
            )
            effect_text = (
                f"部分成交买入挂单 {buy_period_count} 个时段，部分成交卖出挂单 {sell_period_count} 个时段；"
                f"买入成交 {traded_buy_mwh:.2f} MWh，卖出成交 {traded_sell_mwh:.2f} MWh"
            )
        else:
            effect_text = f"自动下架买入挂单 {buy_period_count} 个时段，自动下架卖出挂单 {sell_period_count} 个时段"

        post_operation_text = (
            f"操作后保留 {remaining_period_count} 个时段有效挂单，"
            f"买入总量 {remaining_buy_mwh:.2f} MWh，卖出总量 {remaining_sell_mwh:.2f} MWh"
        )

        return OperationSummary(
            operation_title=operation_title,
            operation_effect_text=effect_text,
            post_operation_text=post_operation_text,
        )

    def _to_operation_button_item(self, operation: Dict[str, Any]) -> OperationButtonItem:
        return OperationButtonItem(
            operation_id=operation["operation_id"],
            operation_type=operation["operation_type"],
            operation_time=operation["operation_time"],
            button_title=f"{self._get_operation_label(operation['operation_type'])} {operation['operation_time'][11:]}",
            button_subtitle=f"买{operation['buy_record_count']} 卖{operation['sell_record_count']}",
            record_count=operation["record_count"],
            covered_period_count=operation["covered_period_count"],
            buy_record_count=operation["buy_record_count"],
            sell_record_count=operation["sell_record_count"],
        )

    def _build_review_texts(self, summary_cards: SummaryCardsResponse) -> List[str]:
        return [
            f"本目标日共 {summary_cards.record_overview.total_records} 条申报记录，其中 {summary_cards.record_overview.traded_records} 笔产生了成交。",
            f"累计成交电量 {summary_cards.trade_overview.traded_mwh:.3f} MWh，其中买入 {summary_cards.trade_overview.buy_traded_mwh:.3f} MWh，卖出 {summary_cards.trade_overview.sell_traded_mwh:.3f} MWh。",
            (
                f"共识别挂牌申报 {summary_cards.operation_overview.listing_operation_count} 次，"
                f"人工下架 {summary_cards.operation_overview.manual_off_shelf_operation_count} 次，"
                f"自动下架 {summary_cards.operation_overview.auto_off_shelf_operation_count} 次。"
            ),
        ]

    def _get_operation_label(self, operation_type: str) -> str:
        if operation_type == "listing":
            return "挂牌申报"
        if operation_type == "manual_off_shelf":
            return "人工下架"
        if operation_type == "auto_off_shelf":
            return "自动下架"
        if operation_type == "partial_fill":
            return "部分成交"
        return "未知动作"

    def _map_trade_direction(self, listing_side: Optional[str]) -> str:
        value = str(listing_side or "")
        if any(keyword in value for keyword in ["增持", "买", "购入", "买入"]):
            return "buy"
        if any(keyword in value for keyword in ["减持", "卖", "售出", "卖出"]):
            return "sell"
        return "unknown"

    def _resolve_record_result(self, record: Dict[str, Any]) -> str:
        if record["is_traded"] and record.get("off_shelf_type") in AUTO_OFF_SHELF_TYPES:
            return "成交自动下架"
        if record["is_traded"]:
            return "成交未下架"
        if record.get("off_shelf_type") == "人工下架":
            return "人工下架"
        return "未成交结束"

    def _is_partial_fill_record(self, record: Dict[str, Any]) -> bool:
        return (
            record["is_traded"]
            and record["remaining_mwh"] > 0
            and record.get("off_shelf_type") not in AUTO_OFF_SHELF_TYPES
            and record.get("off_shelf_type") != "人工下架"
        )

    def _calc_holding_seconds(self, listing_time: Optional[str], off_shelf_time: Optional[str]) -> Optional[int]:
        listing_dt = self._parse_datetime(listing_time)
        off_shelf_dt = self._parse_datetime(off_shelf_time)
        if listing_dt is None or off_shelf_dt is None:
            return None
        return int((off_shelf_dt - listing_dt).total_seconds())

    def _parse_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None

    def _safe_float(self, value: Any, allow_none: bool = False) -> Optional[float]:
        if value is None:
            return None if allow_none else 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return None if allow_none else 0.0


