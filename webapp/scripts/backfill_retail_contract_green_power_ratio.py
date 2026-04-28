# -*- coding: utf-8 -*-
"""
回填零售合同绿电占比默认值

规则：
- retail_contracts 中缺少 green_power_ratio 的合同：写入 0
- 已存在 green_power_ratio 的合同：保持原值不变
"""
from __future__ import annotations

from webapp.tools.mongo import DATABASE


def main() -> None:
    collection = DATABASE.retail_contracts
    missing_filter = {"green_power_ratio": {"$exists": False}}

    missing_count = collection.count_documents(missing_filter)
    result = collection.update_many(missing_filter, {"$set": {"green_power_ratio": 0}})

    print(f"缺少 green_power_ratio 的合同数量: {missing_count}")
    print(f"实际更新文档数量: {result.modified_count}")


if __name__ == "__main__":
    main()
