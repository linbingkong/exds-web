# -*- coding: utf-8 -*-
"""交易总览首页快照服务。"""

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict

from webapp.services.contract_price_trend_service import ContractPriceTrendService
from webapp.services.dashboard_service import DashboardService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


class DashboardSnapshotService:
    """管理交易总览首页快照。"""

    COLLECTION_NAME = "dashboard_summary_snapshots"
    SNAPSHOT_ID = "homepage:default"

    def __init__(self):
        self.db = DATABASE
        self.dashboard_service = DashboardService()
        self.contract_price_trend_service = ContractPriceTrendService(DATABASE)

    def get_summary(self) -> Dict[str, Any]:
        snapshot = self.db[self.COLLECTION_NAME].find_one({"_id": self.SNAPSHOT_ID})
        if snapshot and snapshot.get("data"):
            snapshot_data = snapshot.get("data") or {}
            cached_settlement_month = (snapshot_data.get("settlement_kpi") or {}).get("month")
            current_settlement_month = self.dashboard_service.get_settlement_display_month()
            if cached_settlement_month == current_settlement_month:
                return self._to_summary_response(snapshot)

            logger.info("交易总览首页快照的售电收益月份已变化，立即刷新快照: %s -> %s", cached_settlement_month, current_settlement_month)
            result = self.refresh_snapshot(force=True)
            return result["summary"]

        logger.info("交易总览首页快照不存在，立即构建首份快照")
        result = self.refresh_snapshot(force=True)
        return result["summary"]

    def refresh_snapshot(self, force: bool = False) -> Dict[str, Any]:
        summary_data = self._normalize_value(self._build_summary_data())
        signature = self._compute_signature(summary_data)
        now = datetime.now()

        snapshot = self.db[self.COLLECTION_NAME].find_one({"_id": self.SNAPSHOT_ID})
        if (
            not force
            and snapshot
            and snapshot.get("data")
            and snapshot.get("data_signature") == signature
        ):
            self.db[self.COLLECTION_NAME].update_one(
                {"_id": self.SNAPSHOT_ID},
                {"$set": {"last_checked_at": now, "updated_at": now}},
                upsert=True,
            )
            return {
                "status": "SKIPPED",
                "summary": self._to_summary_response(snapshot),
                "signature": signature,
            }

        document = {
            "_id": self.SNAPSHOT_ID,
            "snapshot_type": "homepage",
            "scope": "default",
            "status": "ready",
            "month": summary_data["month"],
            "data_signature": signature,
            "generated_at": now,
            "updated_at": now,
            "last_checked_at": now,
            "data": summary_data,
        }
        self.db[self.COLLECTION_NAME].replace_one({"_id": self.SNAPSHOT_ID}, document, upsert=True)
        return {
            "status": "SUCCESS",
            "summary": self._to_summary_response(document),
            "signature": signature,
        }

    def _build_summary_data(self) -> Dict[str, Any]:
        month = self.dashboard_service.get_current_month()
        settlement_month = self.dashboard_service.get_settlement_display_month()
        now = datetime.now()
        end_date = now
        start_date = now - timedelta(days=29)
        price_trend = self.contract_price_trend_service.get_price_trend(
            start_date=start_date,
            end_date=end_date,
            spot_type="real_time",
        )

        return {
            "month": month,
            "settlement_kpi": self.dashboard_service.get_settlement_kpi(settlement_month),
            "settlement_chart_monthly": self.dashboard_service.get_settlement_chart(settlement_month, "monthly"),
            "settlement_chart_yearly": self.dashboard_service.get_settlement_chart(settlement_month, "yearly"),
            "trade_summary": self.dashboard_service.get_trade_summary(settlement_month),
            "customer_overview": self.dashboard_service.get_customer_overview(now.year, now.month),
            "customer_profit_contribution": self.dashboard_service.get_customer_profit_contribution(now.year, now.month),
            "alerts": self.dashboard_service.get_alerts(8),
            "price_trend": self._normalize_value(price_trend.model_dump()),
        }

    def _to_summary_response(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        data = snapshot.get("data") or {}
        return {
            "snapshot_id": snapshot.get("_id"),
            "status": snapshot.get("status") or "ready",
            "month": data.get("month"),
            "generated_at": snapshot.get("generated_at"),
            "settlement_kpi": data.get("settlement_kpi"),
            "settlement_chart_monthly": data.get("settlement_chart_monthly"),
            "settlement_chart_yearly": data.get("settlement_chart_yearly"),
            "trade_summary": data.get("trade_summary"),
            "customer_overview": data.get("customer_overview"),
            "customer_profit_contribution": data.get("customer_profit_contribution"),
            "price_trend": data.get("price_trend"),
            "alerts": data.get("alerts"),
        }

    def _compute_signature(self, summary_data: Dict[str, Any]) -> str:
        raw = json.dumps(summary_data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _normalize_value(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if hasattr(value, "model_dump") and callable(value.model_dump):
            return self._normalize_value(value.model_dump())
        if isinstance(value, dict):
            return {str(key): self._normalize_value(val) for key, val in sorted(value.items(), key=lambda item: str(item[0]))}
        if isinstance(value, list):
            return [self._normalize_value(item) for item in value]
        if isinstance(value, tuple):
            return [self._normalize_value(item) for item in value]
        if hasattr(value, "__dict__"):
            return self._normalize_value(vars(value))
        return value
