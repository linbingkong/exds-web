import io
import logging
import os
import re
from calendar import monthrange
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from webapp.models.settlement import SettlementVersion
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


class WholesaleMonthlySettlementService:
    """批发月度结算服务"""

    SUBJECT_NAME_ENV_KEY = "WHOLESALE_SUBJECT_NAME"
    DEFAULT_SUBJECT_NAME = "国网江西综合能源服务有限公司"

    def __init__(self) -> None:
        self.db = DATABASE
        self.collection = self.db["wholesale_settlement_monthly"]
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        self.collection.create_index("month", unique=True)

    @staticmethod
    def _normalize_text(value: Any) -> str:
        if value is None:
            return ""
        # pandas 读取多级表头时，空单元格通常会生成 Unnamed:* 占位文本
        # 这些值应当按空字符串处理，避免破坏字段识别逻辑
        if isinstance(value, str) and value.strip().lower().startswith("unnamed:"):
            return ""
        if isinstance(value, float) and pd.isna(value):
            return ""
        text = str(value).strip()
        return text.replace("\n", "").replace("\r", "")

    @staticmethod
    def _to_optional_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, str) and value.strip() == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _normalize_month(self, value: Any) -> str:
        if isinstance(value, datetime):
            return value.strftime("%Y-%m")
        text = self._normalize_text(value)
        if not text:
            raise ValueError("结算月份为空")

        # 支持 YYYY-MM / YYYY/MM / YYYY年MM月
        match = re.search(r"(\d{4})[-/年](\d{1,2})", text)
        if not match:
            raise ValueError(f"无法识别结算月份: {text}")

        year = int(match.group(1))
        month = int(match.group(2))
        if month < 1 or month > 12:
            raise ValueError(f"月份不合法: {text}")
        return f"{year:04d}-{month:02d}"

    def _build_column_mapping(self, columns: List[Tuple[Any, Any]]) -> Dict[str, int]:
        """把两行表头转成字段索引映射"""
        mapped: Dict[str, int] = {}

        key_aliases = {
            "市场主体名称": "subject_name",
            "用户类型": "user_type",
            "代理购电类型": "agency_purchase_type",
            "结算月份": "month",
            "合同电量": "contract_volume",
            "合同均价": "contract_avg_price",
            "合同电费": "contract_fee",
            "日前申报电量": "day_ahead_declared_volume",
            "日前偏差电费": "day_ahead_deviation_fee",
            "实际用电量": "actual_consumption_volume",
            "实时偏差电费": "real_time_deviation_fee",
            "绿色电能量合同转让收支费用": "green_transfer_fee",
            "日24时段用电量合计": "daily_24h_total_volume",
            "实际月度用电量": "actual_monthly_volume",
            "月度调平电量": "monthly_balancing_volume",
            "月度调平偏差率(%)": "monthly_balancing_deviation_rate_pct",
            "调平电价": "balancing_price",
            "调平电费": "balancing_fee",
            "电能量电费": "energy_fee_total",
            "电能量均价": "energy_avg_price",
            "发电侧成本类费用分摊": "gen_side_cost_allocation",
            "阻塞费分摊": "congestion_fee_allocation",
            "不平衡资金分摊": "imbalance_fund_allocation",
            "偏差回收费": "deviation_recovery_fee",
            "偏差回收费补偿居农损益后返还": "deviation_recovery_return_fee",
            "资金余缺费用合计": "fund_surplus_deficit_total",
            "结算电费": "settlement_fee_total",
            "结算均价": "settlement_avg_price",
            "清算退补总费": "clearing_retroactive_total_fee",
            "退补零售用户": "retroactive_to_retail_users",
            "退补售电公司": "retroactive_to_retail_company",
            "备注信息": "remark",
            "确认状态": "confirmation_status",
            "确认时间": "confirmation_time",
            "争议内容": "dispute_content",
        }

        last_group = ""
        for idx, (group_raw, field_raw) in enumerate(columns):
            group = self._normalize_text(group_raw)
            field = self._normalize_text(field_raw)
            if group:
                last_group = group
            else:
                group = last_group

            display_key = field if field else group
            if display_key in key_aliases:
                mapped[key_aliases[display_key]] = idx

        return mapped

    def _is_summary_row(self, name: str) -> bool:
        normalized = name.replace(" ", "")
        return normalized == "合计" or "全市场合计" in normalized

    def _extract_subject_row(
        self,
        df: pd.DataFrame,
        column_map: Dict[str, int],
    ) -> Dict[str, Any]:
        subject_idx = column_map.get("subject_name")
        if subject_idx is None:
            raise ValueError("未识别到字段：市场主体名称")

        month_idx = column_map.get("month")
        if month_idx is None:
            raise ValueError("未识别到字段：结算月份")

        subject_name_expected = os.getenv(self.SUBJECT_NAME_ENV_KEY, self.DEFAULT_SUBJECT_NAME).strip()

        candidate_rows: List[pd.Series] = []
        for _, row in df.iterrows():
            name = self._normalize_text(row.iloc[subject_idx])
            if not name or self._is_summary_row(name):
                continue
            candidate_rows.append(row)

        if not candidate_rows:
            raise ValueError("未找到可导入的主体数据行")

        matched_rows = []
        for row in candidate_rows:
            name = self._normalize_text(row.iloc[subject_idx])
            if name == subject_name_expected:
                matched_rows.append(row)

        if not matched_rows:
            if len(candidate_rows) == 1:
                matched_rows = candidate_rows
                logger.warning(
                    "未匹配到配置主体名称，使用唯一候选主体行: expected=%s, actual=%s",
                    subject_name_expected,
                    self._normalize_text(candidate_rows[0].iloc[subject_idx]),
                )
            else:
                raise ValueError(
                    f"未匹配到主体名称[{subject_name_expected}]，且候选主体行不唯一，无法确定导入对象"
                )

        if len(matched_rows) != 1:
            raise ValueError(f"主体行匹配数量异常: {len(matched_rows)}")

        row = matched_rows[0]
        month = self._normalize_month(row.iloc[month_idx])
        subject_name = self._normalize_text(row.iloc[subject_idx])

        def _v(key: str) -> Any:
            idx = column_map.get(key)
            if idx is None:
                return None
            return row.iloc[idx]

        return {
            "month": month,
            "subject_name": subject_name,
            "user_type": self._normalize_text(_v("user_type")),
            "agency_purchase_type": self._normalize_text(_v("agency_purchase_type")),
            "settlement_items": {
                "contract_volume": self._to_optional_float(_v("contract_volume")),
                "contract_avg_price": self._to_optional_float(_v("contract_avg_price")),
                "contract_fee": self._to_optional_float(_v("contract_fee")),
                "day_ahead_declared_volume": self._to_optional_float(_v("day_ahead_declared_volume")),
                "day_ahead_deviation_fee": self._to_optional_float(_v("day_ahead_deviation_fee")),
                "actual_consumption_volume": self._to_optional_float(_v("actual_consumption_volume")),
                "real_time_deviation_fee": self._to_optional_float(_v("real_time_deviation_fee")),
                "green_transfer_fee": self._to_optional_float(_v("green_transfer_fee")),
                "daily_24h_total_volume": self._to_optional_float(_v("daily_24h_total_volume")),
                "actual_monthly_volume": self._to_optional_float(_v("actual_monthly_volume")),
                "monthly_balancing_volume": self._to_optional_float(_v("monthly_balancing_volume")),
                "monthly_balancing_deviation_rate_pct": self._to_optional_float(
                    _v("monthly_balancing_deviation_rate_pct")
                ),
                "balancing_price": self._to_optional_float(_v("balancing_price")),
                "balancing_fee": self._to_optional_float(_v("balancing_fee")),
                "energy_fee_total": self._to_optional_float(_v("energy_fee_total")),
                "energy_avg_price": self._to_optional_float(_v("energy_avg_price")),
                "gen_side_cost_allocation": self._to_optional_float(_v("gen_side_cost_allocation")),
                "congestion_fee_allocation": self._to_optional_float(_v("congestion_fee_allocation")),
                "imbalance_fund_allocation": self._to_optional_float(_v("imbalance_fund_allocation")),
                "deviation_recovery_fee": self._to_optional_float(_v("deviation_recovery_fee")),
                "deviation_recovery_return_fee": self._to_optional_float(_v("deviation_recovery_return_fee")),
                "fund_surplus_deficit_total": self._to_optional_float(_v("fund_surplus_deficit_total")),
                "settlement_fee_total": self._to_optional_float(_v("settlement_fee_total")),
                "settlement_avg_price": self._to_optional_float(_v("settlement_avg_price")),
                "clearing_retroactive_total_fee": self._to_optional_float(_v("clearing_retroactive_total_fee")),
                "retroactive_to_retail_users": self._to_optional_float(_v("retroactive_to_retail_users")),
                "retroactive_to_retail_company": self._to_optional_float(_v("retroactive_to_retail_company")),
                "remark": self._normalize_text(_v("remark")),
                "confirmation_status": self._normalize_text(_v("confirmation_status")),
                "confirmation_time": self._normalize_text(_v("confirmation_time")),
                "dispute_content": self._normalize_text(_v("dispute_content")),
            },
        }

    def import_excel(
        self,
        file_content: bytes,
        file_name: str,
        imported_by: str,
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        try:
            df = pd.read_excel(io.BytesIO(file_content), header=[0, 1])
        except Exception as exc:
            logger.error("解析月度结算文件失败: %s", exc, exc_info=True)
            raise ValueError(f"Excel 解析失败: {exc}") from exc

        if df.empty:
            raise ValueError("Excel 无有效数据")

        column_map = self._build_column_mapping(list(df.columns))
        data = self._extract_subject_row(df, column_map)
        month = data["month"]

        existing = self.collection.find_one({"_id": month}, projection={"_id": 1})
        if existing and not overwrite:
            raise FileExistsError(f"月份 {month} 已存在，请确认覆盖导入")

        now = datetime.now()
        doc = {
            "_id": month,
            "month": month,
            "subject_name": data["subject_name"],
            "user_type": data["user_type"],
            "agency_purchase_type": data["agency_purchase_type"],
            "settlement_items": data["settlement_items"],
            "period_details": self._get_monthly_period_details(month),
            "reconciliation_results": self._calculate_reconciliation_results(month, data["settlement_items"]),
            "source_file_name": file_name,
            "imported_at": now,
            "imported_by": imported_by,
            "updated_at": now,
        }

        self.collection.replace_one({"_id": month}, doc, upsert=True)
        return {"month": month, "overwritten": bool(existing)}

    def list_years(self) -> List[int]:
        months = self.collection.distinct("month")
        years: List[int] = []
        for month in months:
            if isinstance(month, str) and re.match(r"^\d{4}-\d{2}$", month):
                years.append(int(month[:4]))
        return sorted(list(set(years)), reverse=True)

    def get_year_rows(self, year: int) -> List[Dict[str, Any]]:
        month_prefix = f"{year:04d}-"
        docs = list(self.collection.find({"month": {"$regex": f"^{month_prefix}"}}))
        doc_map = {doc.get("month"): doc for doc in docs}

        rows: List[Dict[str, Any]] = []
        for mon in range(1, 13):
            month = f"{year:04d}-{mon:02d}"
            doc = doc_map.get(month)
            if doc:
                rows.append(
                    {
                        "month": month,
                        "has_data": True,
                        "subject_name": doc.get("subject_name", ""),
                        "settlement_items": doc.get("settlement_items", {}),
                        "updated_at": doc.get("updated_at"),
                    }
                )
            else:
                rows.append(
                    {
                        "month": month,
                        "has_data": False,
                        "subject_name": "",
                        "settlement_items": {},
                        "updated_at": None,
                    }
                )
        return rows

    def get_month_detail(self, month: str) -> Optional[Dict[str, Any]]:
        doc = self.collection.find_one({"_id": month})
        return doc

    def _get_daily_aggregate(self, month: str) -> Dict[str, float]:
        year = int(month[:4])
        mon = int(month[5:7])
        last_day = monthrange(year, mon)[1]
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        pipeline = [
            {
                "$match": {
                    "operating_date": {"$gte": start_date, "$lte": end_date},
                    "version": SettlementVersion.PLATFORM_DAILY.value,
                }
            },
            {
                "$group": {
                    "_id": None,
                    "contract_volume": {"$sum": "$contract_volume"},
                    "contract_fee": {"$sum": "$contract_fee"},
                    "contract_price_x_volume": {
                        "$sum": {"$multiply": ["$contract_avg_price", "$contract_volume"]}
                    },
                    "day_ahead_volume": {"$sum": "$day_ahead_volume"},
                    "day_ahead_fee": {"$sum": "$day_ahead_fee"},
                    "real_time_volume": {"$sum": "$real_time_volume"},
                    "real_time_fee": {"$sum": "$real_time_fee"},
                    "deviation_recovery_fee": {"$sum": "$deviation_recovery_fee"},
                    "total_energy_fee": {"$sum": "$total_energy_fee"},
                }
            },
        ]
        result = list(self.db.settlement_daily.aggregate(pipeline))
        if not result:
            return {
                "contract_fee": 0.0,
                "contract_volume": 0.0,
                "contract_avg_price": 0.0,
                "day_ahead_volume": 0.0,
                "day_ahead_avg_price": 0.0,
                "day_ahead_fee": 0.0,
                "real_time_volume": 0.0,
                "real_time_avg_price": 0.0,
                "real_time_fee": 0.0,
                "deviation_recovery_fee": 0.0,
                "total_energy_fee": 0.0,
                "settlement_fee_total": 0.0,
                "energy_avg_price": 0.0,
                "settlement_avg_price": 0.0,
            }

        agg = result[0]
        contract_volume = float(agg.get("contract_volume", 0.0) or 0.0)
        contract_fee = float(agg.get("contract_fee", 0.0) or 0.0)
        contract_price_x_volume = float(agg.get("contract_price_x_volume", 0.0) or 0.0)
        day_ahead_volume = float(agg.get("day_ahead_volume", 0.0) or 0.0)
        day_ahead_fee = float(agg.get("day_ahead_fee", 0.0) or 0.0)
        real_time_fee = float(agg.get("real_time_fee", 0.0) or 0.0)
        deviation_recovery_fee = float(agg.get("deviation_recovery_fee", 0.0) or 0.0)
        total_energy_fee = float(agg.get("total_energy_fee", 0.0) or 0.0)
        real_time_volume = float(agg.get("real_time_volume", 0.0) or 0.0)

        contract_avg_price = contract_price_x_volume / contract_volume if contract_volume > 0 else 0.0
        day_ahead_avg_price = day_ahead_fee / day_ahead_volume if day_ahead_volume > 0 else 0.0
        real_time_avg_price = real_time_fee / real_time_volume if real_time_volume > 0 else 0.0
        settlement_fee_total = total_energy_fee + deviation_recovery_fee
        energy_avg_price = total_energy_fee / real_time_volume if real_time_volume > 0 else 0.0
        settlement_avg_price = settlement_fee_total / real_time_volume if real_time_volume > 0 else 0.0

        return {
            "contract_volume": contract_volume,
            "contract_avg_price": contract_avg_price,
            "contract_fee": contract_fee,
            "day_ahead_volume": day_ahead_volume,
            "day_ahead_avg_price": day_ahead_avg_price,
            "day_ahead_fee": day_ahead_fee,
            "real_time_volume": real_time_volume,
            "real_time_avg_price": real_time_avg_price,
            "real_time_fee": real_time_fee,
            "deviation_recovery_fee": deviation_recovery_fee,
            "total_energy_fee": total_energy_fee,
            "settlement_fee_total": settlement_fee_total,
            "energy_avg_price": energy_avg_price,
            "settlement_avg_price": settlement_avg_price,
        }

    def _get_monthly_period_details(self, month: str) -> List[Dict[str, Any]]:
        """从 settlement_daily 聚合当月 48 时段明细数据"""
        year = int(month[:4])
        mon = int(month[5:7])
        last_day = monthrange(year, mon)[1]
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        pipeline = [
            {
                "$match": {
                    "operating_date": {"$gte": start_date, "$lte": end_date},
                    "version": SettlementVersion.PLATFORM_DAILY.value,
                    "period_details": {"$exists": True, "$not": {"$size": 0}},
                }
            },
            {"$unwind": "$period_details"},
            {
                "$group": {
                    "_id": "$period_details.period",
                    "contract_volume": {"$sum": "$period_details.contract.volume"},
                    "contract_fee": {"$sum": "$period_details.contract.fee"},
                    "day_ahead_volume": {"$sum": "$period_details.day_ahead.volume"},
                    "day_ahead_fee": {"$sum": "$period_details.day_ahead.fee"},
                    "real_time_volume": {"$sum": "$period_details.real_time.volume"},
                    "real_time_fee": {"$sum": "$period_details.real_time.fee"},
                    "total_energy_fee": {"$sum": "$period_details.total_energy_fee"},
                }
            },
            {"$sort": {"_id": 1}},
        ]
        
        results = list(self.db.settlement_daily.aggregate(pipeline))
        if not results:
            return []

        period_details = []
        for res in results:
            p_val = res["_id"]
            cv = float(res.get("contract_volume", 0.0) or 0.0)
            cf = float(res.get("contract_fee", 0.0) or 0.0)
            dv = float(res.get("day_ahead_volume", 0.0) or 0.0)
            df = float(res.get("day_ahead_fee", 0.0) or 0.0)
            rv = float(res.get("real_time_volume", 0.0) or 0.0)
            rf = float(res.get("real_time_fee", 0.0) or 0.0)
            tef = float(res.get("total_energy_fee", 0.0) or 0.0)

            period_details.append({
                "period": p_val,
                "contract": {
                    "volume": round(cv, 6),
                    "price": round(cf / cv, 6) if cv != 0 else 0.0,
                    "fee": round(cf, 2)
                },
                "day_ahead": {
                    "volume": round(dv, 6),
                    "price": round(df / dv, 6) if dv != 0 else 0.0,
                    "fee": round(df, 2)
                },
                "real_time": {
                    "volume": round(rv, 6),
                    "price": round(rf / rv, 6) if rv != 0 else 0.0,
                    "fee": round(rf, 2)
                },
                "total_energy_fee": round(tef, 2)
            })
        
        return period_details

    def _calculate_reconciliation_results(self, month: str, monthly_items: Dict[str, Any]) -> List[Dict[str, Any]]:
        """计算月结导入数据与日清汇总之间的差异详情"""
        daily_agg = self._get_daily_aggregate(month)
        
        monthly_day_ahead_volume = float(self._to_optional_float(monthly_items.get("day_ahead_declared_volume")) or 0.0)
        monthly_day_ahead_fee = float(self._to_optional_float(monthly_items.get("day_ahead_deviation_fee")) or 0.0)
        monthly_day_ahead_avg = monthly_day_ahead_fee / monthly_day_ahead_volume if monthly_day_ahead_volume > 0 else 0.0

        monthly_real_time_volume = float(self._to_optional_float(monthly_items.get("actual_consumption_volume")) or 0.0)
        monthly_real_time_fee = float(self._to_optional_float(monthly_items.get("real_time_deviation_fee")) or 0.0)
        monthly_real_time_avg = monthly_real_time_fee / monthly_real_time_volume if monthly_real_time_volume > 0 else 0.0

        balancing_fee = float(self._to_optional_float(monthly_items.get("balancing_fee")) or 0.0)
        daily_energy_fee_with_balancing = float(daily_agg.get("total_energy_fee", 0.0) or 0.0) + balancing_fee
        daily_settlement_fee_with_balancing = daily_energy_fee_with_balancing + float(
            daily_agg.get("deviation_recovery_fee", 0.0) or 0.0
        )

        compare_items = [
            ("contract", "中长期合约", "电量", float(self._to_optional_float(monthly_items.get("contract_volume")) or 0.0), float(daily_agg.get("contract_volume", 0.0) or 0.0)),
            ("contract", "中长期合约", "均价", float(self._to_optional_float(monthly_items.get("contract_avg_price")) or 0.0), float(daily_agg.get("contract_avg_price", 0.0) or 0.0)),
            ("contract", "中长期合约", "电费", float(self._to_optional_float(monthly_items.get("contract_fee")) or 0.0), float(daily_agg.get("contract_fee", 0.0) or 0.0)),
            ("day_ahead", "日前市场偏差", "电量", monthly_day_ahead_volume, float(daily_agg.get("day_ahead_volume", 0.0) or 0.0)),
            ("day_ahead", "日前市场偏差", "均价", monthly_day_ahead_avg, float(daily_agg.get("day_ahead_avg_price", 0.0) or 0.0)),
            ("day_ahead", "日前市场偏差", "电费", monthly_day_ahead_fee, float(daily_agg.get("day_ahead_fee", 0.0) or 0.0)),
            ("real_time", "实时市场偏差", "电量", monthly_real_time_volume, float(daily_agg.get("real_time_volume", 0.0) or 0.0)),
            ("real_time", "实时市场偏差", "均价", monthly_real_time_avg, float(daily_agg.get("real_time_avg_price", 0.0) or 0.0)),
            ("real_time", "实时市场偏差", "电费", monthly_real_time_fee, float(daily_agg.get("real_time_fee", 0.0) or 0.0)),
            ("energy", "电能量合计", "电费", float(self._to_optional_float(monthly_items.get("energy_fee_total")) or 0.0), daily_energy_fee_with_balancing),
            ("energy", "电能量合计", "均价", float(self._to_optional_float(monthly_items.get("energy_avg_price")) or 0.0), float(daily_agg.get("energy_avg_price", 0.0) or 0.0)),
            ("settlement", "结算合计", "电费", float(self._to_optional_float(monthly_items.get("settlement_fee_total")) or 0.0), daily_settlement_fee_with_balancing),
            ("settlement", "结算合计", "均价", float(self._to_optional_float(monthly_items.get("settlement_avg_price")) or 0.0), float(daily_agg.get("settlement_avg_price", 0.0) or 0.0)),
            ("fund", "资金余缺费用", "偏差回收费", float(self._to_optional_float(monthly_items.get("deviation_recovery_fee")) or 0.0), float(daily_agg.get("deviation_recovery_fee", 0.0) or 0.0)),
        ]

        rows = []
        for group_key, group_label, metric_label, monthly_num, daily_num in compare_items:
            diff = monthly_num - daily_num
            diff_rate = (diff / daily_num * 100) if abs(daily_num) > 1e-9 else None
            rows.append({
                "group_key": group_key,
                "group_label": group_label,
                "metric": metric_label,
                "monthly_value": round(monthly_num, 6),
                "daily_agg_value": round(daily_num, 6),
                "diff": round(diff, 6),
                "diff_rate_pct": round(diff_rate, 4) if diff_rate is not None else None,
            })
        return rows

    def get_reconciliation(self, month: str) -> Dict[str, Any]:
        doc = self.get_month_detail(month)
        if not doc:
            raise ValueError(f"月份 {month} 数据不存在")

        # 对账结果依赖日清聚合，日清数据后续可能被重算，因此这里始终按最新数据实时计算，
        # 避免导入时缓存的 reconciliation_results 变成过期值。
        reconcile_results = self._calculate_reconciliation_results(month, doc.get("settlement_items", {}))

        items = doc.get("settlement_items", {})
        # 为了兼容性，仍计算 balancing_fee 用于前端特殊展示（如果需要）
        balancing_fee = float(self._to_optional_float(items.get("balancing_fee")) or 0.0)

        return {
            "month": month,
            "subject_name": doc.get("subject_name", ""),
            "version": SettlementVersion.PLATFORM_DAILY.value,
            "rows": reconcile_results,
            "daily_side_adjustments": {
                "balancing_fee_added_to_energy_fee": round(balancing_fee, 6),
            },
            "display_only_fields": {
                "clearing_retroactive_total_fee": items.get("clearing_retroactive_total_fee"),
                "retroactive_to_retail_users": items.get("retroactive_to_retail_users"),
                "retroactive_to_retail_company": items.get("retroactive_to_retail_company"),
            },
        }
