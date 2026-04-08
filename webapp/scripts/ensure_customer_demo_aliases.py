# -*- coding: utf-8 -*-
"""
为所有需要脱敏的客户预生成演示别名
"""
from __future__ import annotations

from webapp.services.customer_name_masking_service import customer_name_masking_service
from webapp.tools.mongo import DATABASE


def main() -> None:
    collection = DATABASE.customer_archives
    total = 0
    for doc in collection.find(
        {"needs_name_masking": True},
        {"user_name": 1, "short_name": 1},
    ):
        customer_name_masking_service.get_or_create_demo_alias(
            str(doc["_id"]),
            real_name=doc.get("user_name"),
            real_short_name=doc.get("short_name"),
        )
        total += 1

    alias_total = DATABASE.customer_demo_aliases.count_documents({})
    print(f"预热客户数量: {total}")
    print(f"当前别名总数: {alias_total}")


if __name__ == "__main__":
    main()
