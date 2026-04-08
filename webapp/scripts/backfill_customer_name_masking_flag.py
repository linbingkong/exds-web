# -*- coding: utf-8 -*-
"""
回填客户名称脱敏标记

规则：
- customer_archives 中 user_name 包含“国网”“江西科晨”“江西省送变电”“江西送变电”“送变电”的客户：needs_name_masking = True
- 其他客户：needs_name_masking = False
"""
from __future__ import annotations

from pymongo import UpdateOne

from webapp.tools.mongo import DATABASE


MASK_KEYWORDS = ("国网", "江西科晨", "江西省送变电", "江西送变电", "送变电")


def infer_needs_name_masking(user_name: str | None) -> bool:
    normalized_name = str(user_name or "").strip()
    return any(keyword in normalized_name for keyword in MASK_KEYWORDS)


def main() -> None:
    collection = DATABASE.customer_archives
    operations: list[UpdateOne] = []
    total = 0
    mask_true_count = 0
    mask_false_count = 0

    for doc in collection.find({}, {"user_name": 1}):
        total += 1
        customer_id = doc.get("_id")
        needs_name_masking = infer_needs_name_masking(doc.get("user_name"))
        if needs_name_masking:
            mask_true_count += 1
        else:
            mask_false_count += 1
        operations.append(
            UpdateOne(
                {"_id": customer_id},
                {"$set": {"needs_name_masking": needs_name_masking}},
            )
        )

    modified_count = 0
    if operations:
        result = collection.bulk_write(operations, ordered=False)
        modified_count = result.modified_count

    print(f"客户总数: {total}")
    print(f"脱敏标记为 true 数量: {mask_true_count}")
    print(f"脱敏标记为 false 数量: {mask_false_count}")
    print(f"实际更新文档数量: {modified_count}")


if __name__ == "__main__":
    main()
