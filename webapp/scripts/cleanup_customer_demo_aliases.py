# -*- coding: utf-8 -*-
"""
清理不再需要的客户脱敏别名

保留规则：
- customer_archives 中存在对应客户
- 且 needs_name_masking == True

其余 customer_demo_aliases 记录会被删除。
"""
from __future__ import annotations

from webapp.tools.mongo import DATABASE


def main() -> None:
    customer_flags = {
        str(doc["_id"]): bool(doc.get("needs_name_masking"))
        for doc in DATABASE.customer_archives.find({}, {"needs_name_masking": 1})
    }

    aliases = list(DATABASE.customer_demo_aliases.find({}, {"_id": 1, "customer_id": 1}))
    removable_ids = []

    for doc in aliases:
        customer_id = str(doc.get("customer_id") or "")
        if customer_flags.get(customer_id) is True:
            continue
        removable_ids.append(doc["_id"])

    deleted_count = 0
    if removable_ids:
        result = DATABASE.customer_demo_aliases.delete_many({"_id": {"$in": removable_ids}})
        deleted_count = result.deleted_count

    print(f"别名总数: {len(aliases)}")
    print(f"保留数量: {len(aliases) - len(removable_ids)}")
    print(f"删除数量: {deleted_count}")


if __name__ == "__main__":
    main()
