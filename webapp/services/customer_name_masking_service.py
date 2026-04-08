# -*- coding: utf-8 -*-
"""
客户名称脱敏服务
"""
from __future__ import annotations

import copy
import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


REGION_WORDS = [
    "赣东",
    "赣西",
    "赣北",
    "江南",
    "南昌高新",
    "新余",
    "宜春",
    "抚州",
]

BRAND_WORDS = [
    "恒创",
    "鼎盛",
    "华启",
    "安泰",
    "瑞成",
    "宏远",
    "嘉和",
    "启元",
]

INDUSTRY_WORDS = [
    "能源",
    "制造",
    "新材料",
    "供应链",
    "工业",
    "科技",
    "实业",
    "商贸",
]

SUFFIX_WORDS = [
    "有限公司",
    "实业有限公司",
    "科技有限公司",
    "发展有限公司",
]

REAL_NAME_PERMISSION = "data:customer_name:view_real"
NAME_KEYS = ("customer_name", "user_name", "short_name")
MASK_NAME_KEYWORDS = ("国网", "江西科晨", "江西省送变电", "江西送变电", "送变电")


class CustomerNameMaskingService:
    def __init__(self) -> None:
        self.db = DATABASE
        self.alias_collection = self.db.customer_demo_aliases
        self.customer_collection = self.db.customer_archives
        self._alias_cache: Dict[str, Dict[str, Any]] = {}
        self._customer_cache: Dict[str, Dict[str, Any]] = {}
        self._mask_flag_cache: Dict[str, bool] = {}
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        try:
            self.alias_collection.create_index("customer_id", unique=True)
            self.alias_collection.create_index("demo_name", unique=True)
            self.alias_collection.create_index("demo_short_name")
            self.alias_collection.create_index("status")
            self.alias_collection.create_index([("status", 1), ("customer_id", 1)])
        except Exception as exc:  # pragma: no cover
            logger.warning("创建 customer_demo_aliases 索引失败: %s", exc)

    def should_view_real_name(self, permission_codes: Iterable[str], is_super_admin: bool = False) -> bool:
        return bool(is_super_admin or REAL_NAME_PERMISSION in set(permission_codes))

    def get_or_create_demo_alias(
        self,
        customer_id: str,
        real_name: Optional[str] = None,
        real_short_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        customer_id = str(customer_id or "").strip()
        if not customer_id:
            raise ValueError("customer_id 不能为空")

        existing = self._get_cached_alias(customer_id)
        if existing:
            return existing

        customer_doc = self._load_customer_archive(customer_id)
        resolved_real_name = str(real_name or customer_doc.get("user_name") or "").strip()
        resolved_real_short_name = str(real_short_name or customer_doc.get("short_name") or "").strip() or None
        if not self.should_mask_customer(customer_id=customer_id, real_name=resolved_real_name):
            return {
                "customer_id": customer_id,
                "demo_name": resolved_real_name,
                "demo_short_name": resolved_real_short_name or resolved_real_name,
            }

        if not resolved_real_name:
            logger.warning("创建脱敏别名时缺少真实名称，customer_id=%s", customer_id)

        alias_doc = self._build_alias_doc(
            customer_id=customer_id,
            real_name=resolved_real_name or None,
            real_short_name=resolved_real_short_name,
        )
        update_fields = dict(alias_doc)
        created_at = update_fields.pop("created_at", None)
        try:
            self.alias_collection.update_one(
                {"customer_id": customer_id},
                {
                    "$set": update_fields,
                    "$setOnInsert": {"created_at": created_at} if created_at is not None else {},
                },
                upsert=True,
            )
        except DuplicateKeyError:
            logger.warning("客户脱敏别名并发创建冲突，回退为读取已有记录: customer_id=%s", customer_id)
        logger.info("首次生成客户脱敏别名: customer_id=%s demo_name=%s", customer_id, alias_doc["demo_name"])
        saved_alias = self.alias_collection.find_one({"customer_id": customer_id}) or alias_doc
        self._alias_cache[customer_id] = saved_alias
        return saved_alias

    def mask_customer_fields(self, data: Any, can_view_real_name: bool) -> Any:
        if can_view_real_name:
            return data
        copied = copy.deepcopy(data)
        self._warm_up_masking_cache(copied)
        return self._mask_any(copied)

    def should_mask_customer_name(self, customer_name: Optional[str]) -> bool:
        name = str(customer_name or "").strip()
        if not name:
            return False
        return any(keyword in name for keyword in MASK_NAME_KEYWORDS)

    def should_mask_customer(self, customer_id: Optional[str] = None, real_name: Optional[str] = None) -> bool:
        normalized_customer_id = str(customer_id or "").strip()
        if normalized_customer_id in self._mask_flag_cache:
            return self._mask_flag_cache[normalized_customer_id]
        if normalized_customer_id:
            customer_doc = self._load_customer_archive(normalized_customer_id)
            explicit_flag = customer_doc.get("needs_name_masking")
            if explicit_flag is not None:
                should_mask = bool(explicit_flag)
                self._mask_flag_cache[normalized_customer_id] = should_mask
                return should_mask
        if real_name:
            should_mask = self.should_mask_customer_name(real_name)
            if normalized_customer_id:
                self._mask_flag_cache[normalized_customer_id] = should_mask
            return should_mask
        customer_doc = self._load_customer_archive(normalized_customer_id)
        should_mask = self.should_mask_customer_name(customer_doc.get("user_name"))
        self._mask_flag_cache[normalized_customer_id] = should_mask
        return should_mask

    def filter_records_by_keyword(self, records: list[dict], keyword: str, fields: list[str]) -> list[dict]:
        search_key = str(keyword or "").strip().lower()
        if not search_key:
            return records

        result = []
        for item in records:
            haystacks = [str(item.get(field) or "").lower() for field in fields]
            if any(search_key in hay for hay in haystacks):
                result.append(item)
        return result

    def search_customer_ids_by_keyword(self, keyword: str) -> list[str]:
        search_key = str(keyword or "").strip()
        if not search_key:
            return []

        regex = {"$regex": search_key, "$options": "i"}
        customer_ids: set[str] = set()

        alias_cursor = self.alias_collection.find(
            {
                "status": {"$ne": "disabled"},
                "$or": [
                    {"demo_name": regex},
                    {"demo_short_name": regex},
                ],
            },
            {"customer_id": 1},
        )
        for doc in alias_cursor:
            customer_id = str(doc.get("customer_id") or "").strip()
            if customer_id:
                customer_ids.add(customer_id)

        customer_cursor = self.customer_collection.find(
            {
                "$or": [
                    {"user_name": regex},
                    {"short_name": regex},
                ]
            },
            {"_id": 1, "user_name": 1, "short_name": 1, "needs_name_masking": 1},
        )
        for doc in customer_cursor:
            customer_id = str(doc.get("_id") or "").strip()
            if not customer_id:
                continue
            customer_name = str(doc.get("user_name") or "").strip()
            self._customer_cache[customer_id] = dict(doc)
            if not self.should_mask_customer(customer_id=customer_id, real_name=customer_name):
                customer_ids.add(customer_id)

        return list(customer_ids)

    def resolve_customer_id_by_display_name(self, display_name: str) -> Optional[str]:
        name = str(display_name or "").strip()
        if not name:
            return None

        alias_doc = self.alias_collection.find_one({"demo_name": name, "status": {"$ne": "disabled"}}, {"customer_id": 1})
        if alias_doc and alias_doc.get("customer_id"):
            return str(alias_doc["customer_id"])

        customer_doc = self.customer_collection.find_one({"user_name": name}, {"_id": 1})
        if customer_doc:
            return str(customer_doc["_id"])
        return None

    def _mask_any(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self._mask_any(item) for item in value]
        if isinstance(value, tuple):
            return [self._mask_any(item) for item in value]
        if not isinstance(value, dict):
            return value

        masked = {key: self._mask_any(item) for key, item in value.items()}
        return self.mask_customer_record(masked, can_view_real_name=False)

    def mask_customer_record(self, record: Dict[str, Any], can_view_real_name: bool) -> Dict[str, Any]:
        if can_view_real_name:
            return record

        customer_id = self._resolve_customer_id(record)
        if not customer_id:
            if any(key in record for key in NAME_KEYS):
                logger.warning("检测到客户名称字段但无法解析 customer_id，keys=%s", list(record.keys()))
            return record

        real_name = record.get("customer_name") or record.get("user_name")
        real_short_name = record.get("short_name")
        if not self.should_mask_customer(customer_id=customer_id, real_name=real_name):
            return record
        alias = self.get_or_create_demo_alias(customer_id, real_name=real_name, real_short_name=real_short_name)
        demo_name = str(alias.get("demo_name") or "")
        demo_short_name = str(alias.get("demo_short_name") or demo_name)

        if "customer_name" in record:
            record["customer_name"] = demo_name
        if "user_name" in record:
            record["user_name"] = demo_name
        if "short_name" in record:
            record["short_name"] = demo_short_name
        if "contract_name" in record:
            record["contract_name"] = self._mask_contract_name(
                contract_name=record.get("contract_name"),
                real_name=real_name,
                real_short_name=real_short_name or self._load_customer_archive(customer_id).get("short_name"),
                demo_name=demo_name,
                demo_short_name=demo_short_name,
            )
        return record

    def _mask_contract_name(
        self,
        contract_name: Any,
        real_name: Optional[str],
        real_short_name: Optional[str],
        demo_name: str,
        demo_short_name: str,
    ) -> Any:
        normalized_contract_name = str(contract_name or "")
        if not normalized_contract_name:
            return contract_name

        masked_contract_name = normalized_contract_name
        if real_name:
            masked_contract_name = masked_contract_name.replace(str(real_name), demo_name)
        if real_short_name:
            masked_contract_name = masked_contract_name.replace(str(real_short_name), demo_short_name)
        return masked_contract_name

    def _resolve_customer_id(self, record: Dict[str, Any]) -> Optional[str]:
        for key in ("customer_id", "user_id"):
            value = record.get(key)
            if value:
                return str(value)

        record_id = record.get("id")
        if record_id and any(key in record for key in ("user_name", "short_name")):
            return str(record_id)

        for key in ("customer_name", "user_name"):
            candidate = str(record.get(key) or "").strip()
            if not candidate:
                continue
            customer_id = self.resolve_customer_id_by_display_name(candidate)
            if customer_id:
                return customer_id
        return None

    def _load_customer_archive(self, customer_id: str) -> Dict[str, Any]:
        if customer_id in self._customer_cache:
            return self._customer_cache[customer_id]
        query_id: Any = customer_id
        if ObjectId.is_valid(customer_id):
            query_id = ObjectId(customer_id)
        customer_doc = self.customer_collection.find_one(
            {"_id": query_id},
            {"user_name": 1, "short_name": 1, "needs_name_masking": 1},
        ) or {}
        if customer_doc:
            self._customer_cache[customer_id] = customer_doc
        return customer_doc

    def _get_cached_alias(self, customer_id: str) -> Optional[Dict[str, Any]]:
        if customer_id in self._alias_cache:
            return self._alias_cache[customer_id]
        alias_doc = self.alias_collection.find_one({"customer_id": customer_id, "status": {"$ne": "disabled"}})
        if alias_doc:
            self._alias_cache[customer_id] = alias_doc
        return alias_doc

    def _warm_up_masking_cache(self, data: Any) -> None:
        refs: Dict[str, Dict[str, Optional[str]]] = {}
        self._collect_customer_refs(data, refs)
        if not refs:
            return

        customer_ids = list(refs.keys())
        self._preload_customer_archives(customer_ids)
        masked_customer_ids = [
            customer_id
            for customer_id, names in refs.items()
            if self.should_mask_customer(customer_id=customer_id, real_name=names.get("real_name"))
        ]
        self._preload_aliases(masked_customer_ids)

    def _collect_customer_refs(self, value: Any, refs: Dict[str, Dict[str, Optional[str]]]) -> None:
        if isinstance(value, list):
            for item in value:
                self._collect_customer_refs(item, refs)
            return
        if isinstance(value, tuple):
            for item in value:
                self._collect_customer_refs(item, refs)
            return
        if not isinstance(value, dict):
            return

        customer_id = self._resolve_customer_id(value)
        if customer_id:
            refs.setdefault(
                customer_id,
                {
                    "real_name": str(value.get("customer_name") or value.get("user_name") or "").strip() or None,
                    "real_short_name": str(value.get("short_name") or "").strip() or None,
                },
            )

        for item in value.values():
            self._collect_customer_refs(item, refs)

    def _preload_customer_archives(self, customer_ids: list[str]) -> None:
        uncached_ids = [customer_id for customer_id in customer_ids if customer_id not in self._customer_cache and ObjectId.is_valid(customer_id)]
        if not uncached_ids:
            return
        query_ids = [ObjectId(customer_id) for customer_id in uncached_ids]
        for doc in self.customer_collection.find(
            {"_id": {"$in": query_ids}},
            {"user_name": 1, "short_name": 1, "needs_name_masking": 1},
        ):
            self._customer_cache[str(doc["_id"])] = doc

    def _preload_aliases(self, customer_ids: list[str]) -> None:
        uncached_ids = [customer_id for customer_id in customer_ids if customer_id not in self._alias_cache]
        if not uncached_ids:
            return
        for doc in self.alias_collection.find(
            {"customer_id": {"$in": uncached_ids}, "status": {"$ne": "disabled"}},
        ):
            customer_id = str(doc.get("customer_id") or "")
            if customer_id:
                self._alias_cache[customer_id] = doc

    def _build_alias_doc(
        self,
        customer_id: str,
        real_name: Optional[str],
        real_short_name: Optional[str],
    ) -> Dict[str, Any]:
        for salt in range(0, 64):
            demo_name = self._generate_demo_name(customer_id, salt)
            if self._demo_name_conflicts(customer_id, demo_name):
                continue
            demo_short_name = self._generate_demo_short_name(demo_name)
            now = datetime.now()
            source_hash = hashlib.sha256(f"{customer_id}|{real_name or ''}".encode("utf-8")).hexdigest()[:16]
            return {
                "_id": customer_id,
                "customer_id": customer_id,
                "demo_name": demo_name,
                "demo_short_name": demo_short_name,
                "real_name": real_name,
                "real_short_name": real_short_name,
                "source_hash": source_hash,
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "created_by": "system",
                "updated_by": "system",
            }
        raise RuntimeError(f"无法为 customer_id={customer_id} 生成唯一脱敏名称")

    def _generate_demo_name(self, customer_id: str, salt: int) -> str:
        seed = hashlib.sha256(f"{customer_id}:{salt}".encode("utf-8")).digest()
        region = REGION_WORDS[seed[0] % len(REGION_WORDS)]
        brand = BRAND_WORDS[seed[1] % len(BRAND_WORDS)]
        industry = INDUSTRY_WORDS[seed[2] % len(INDUSTRY_WORDS)]
        suffix = SUFFIX_WORDS[seed[3] % len(SUFFIX_WORDS)]
        return f"{region}{brand}{industry}{suffix}"

    def _generate_demo_short_name(self, demo_name: str) -> str:
        short_name = demo_name
        for prefix in ("南昌高新", "赣东", "赣西", "赣北", "江南", "新余", "宜春", "抚州"):
            if short_name.startswith(prefix):
                short_name = short_name[len(prefix):]
                break
        for suffix in ("实业有限公司", "科技有限公司", "发展有限公司", "有限公司"):
            if short_name.endswith(suffix):
                short_name = short_name[: -len(suffix)]
                break
        short_name = short_name.strip()
        return short_name[:6] if short_name else demo_name[:6]

    def _demo_name_conflicts(self, customer_id: str, demo_name: str) -> bool:
        alias_conflict = self.alias_collection.find_one(
            {"demo_name": demo_name, "customer_id": {"$ne": customer_id}, "status": {"$ne": "disabled"}},
            {"_id": 1},
        )
        if alias_conflict:
            return True
        real_conflict = self.customer_collection.find_one({"user_name": demo_name}, {"_id": 1})
        return bool(real_conflict)


customer_name_masking_service = CustomerNameMaskingService()
