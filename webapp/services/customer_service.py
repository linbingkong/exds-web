import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from webapp.models.customer import Customer, CustomerCreate, CustomerUpdate, CustomerListItem, SyncCandidate
from webapp.tools.mongo import DATABASE


logger = logging.getLogger(__name__)


class CustomerService:
    """
    Service layer for customer management.
    Handles business logic for creating, retrieving, updating, and deleting customers.
    """

    def __init__(self, db: Database) -> None:
        self.db = db
        # 使用 customer_archives 集合 (v2 数据结构)
        self.collection = self.db.customer_archives
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        """确保数据库索引存在"""
        try:
            # v2 索引列表
            indexes = [
                # 1. 基础查询索引
                ([('user_name', 1)], {'name': 'idx_user_name'}),
                ([('short_name', 1)], {'name': 'idx_short_name'}),
                ([('location', 1)], {'name': 'idx_location'}),
                ([('needs_name_masking', 1)], {'name': 'idx_needs_name_masking'}),

                # 2. 标签查询索引
                ([('tags.name', 1)], {'name': 'idx_tags_name'}),

                # 3. 嵌套数据索引（用于户号和计量点查询）
                ([('accounts.account_id', 1)], {'name': 'idx_account_id'}),
                ([('accounts.meters.meter_id', 1)], {'name': 'idx_meter_id'}),
                ([('accounts.metering_points.mp_no', 1)], {'name': 'idx_mp_no'}),

                # 4. 时间索引
                ([('created_at', -1)], {'name': 'idx_created_at'}),
                ([('updated_at', -1)], {'name': 'idx_updated_at'}),
            ]

            existing_indexes = {idx.get('name') for idx in self.collection.list_indexes()}

            for keys, options in indexes:
                if options['name'] not in existing_indexes:
                    self.collection.create_index(keys, **options)

        except Exception as exc:  # pragma: no cover - best effort
            # 索引创建失败不应该阻止服务启动，记录错误即可
            logger.warning("创建客户索引时出错: %s", exc)

    @staticmethod
    def _infer_needs_name_masking(customer_name: Optional[str]) -> bool:
        normalized_name = str(customer_name or "").strip()
        return any(keyword in normalized_name for keyword in ("国网", "江西科晨", "江西省送变电", "江西送变电", "送变电"))

    def create(self, customer_data: Dict[str, Any], operator: str) -> Dict[str, Any]:
        """
        创建新客户

        Args:
            customer_data: 客户数据
            operator: 操作人

        Returns:
            创建的客户信息

        Raises:
            ValueError: 客户名称已存在
        """
        # 检查客户名称是否已存在（所有状态）
        existing_customer = self.collection.find_one({
            "user_name": customer_data.get("user_name")
        })
        if existing_customer:
            raise ValueError(f"客户名称 '{customer_data.get('user_name')}' 已存在")

        # 检查户号是否在当前客户内重复
        utility_accounts = customer_data.get("utility_accounts", [])
        account_ids = [account.get("account_id") for account in utility_accounts]
        if len(account_ids) != len(set(account_ids)):
            raise ValueError("户号在当前客户内重复")

        # 检查计量点ID是否在户号内重复
        for account in utility_accounts:
            metering_points = account.get("metering_points", [])
            mp_ids = [mp.get("metering_point_id") for mp in metering_points]
            if len(mp_ids) != len(set(mp_ids)):
                raise ValueError(f"户号 {account.get('account_id')} 内计量点ID重复")

        customer = Customer(**customer_data)
        customer.created_by = operator
        customer.updated_by = operator
        if customer.needs_name_masking is None:
            customer.needs_name_masking = self._infer_needs_name_masking(customer.user_name)

        # 准备插入文档
        doc_to_insert = customer.model_dump(by_alias=True)
        # 确保写入数据库的是ObjectId，而不是被Pydantic过早序列化为的字符串
        doc_to_insert['_id'] = customer.id

        # 插入数据库
        result = self.collection.insert_one(doc_to_insert)

        # 返回创建的客户信息
        created_customer = self.collection.find_one({"_id": result.inserted_id})
        return self._convert_to_dict(created_customer)

    def get_by_id(self, customer_id: str) -> Dict[str, Any]:
        """
        根据ID获取客户详情

        Args:
            customer_id: 客户ID

        Returns:
            客户详情

        Raises:
            ValueError: 客户不存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})

        if not customer:
            raise ValueError("客户不存在")

        return self._convert_to_dict(customer)

    def list(self, filters: Dict[str, Optional[str]], page: int = 1, page_size: int = 20, sort_field: str = "created_at", sort_order: str = "desc") -> Dict[str, Any]:
        """
        获取客户列表 (v2)

        Args:
            filters: 筛选条件
            page: 页码
            page_size: 每页大小
            sort_field: 排序字段 (created_at, user_name, short_name, location)
            sort_order: 排序顺序 (asc/desc)

        Returns:
            客户列表响应
        """
        # 构建查询条件 (v2 结构，不再有 status 字段)
        query = {}

        keyword_conditions = []

        # 关键词搜索 (客户名称或户号)
        if filters.get("keyword"):
            keyword = filters["keyword"]
            if filters.get("include_name_search", True):
                keyword_conditions.extend([
                    {"user_name": {"$regex": keyword, "$options": "i"}},
                    {"short_name": {"$regex": keyword, "$options": "i"}},
                ])
            if filters.get("include_account_search", True):
                keyword_conditions.append({"accounts.account_id": {"$regex": keyword, "$options": "i"}})

        matched_customer_ids = filters.get("customer_ids") or []
        valid_customer_object_ids = [
            ObjectId(customer_id)
            for customer_id in matched_customer_ids
            if isinstance(customer_id, str) and ObjectId.is_valid(customer_id)
        ]
        if valid_customer_object_ids:
            keyword_conditions.append({"_id": {"$in": valid_customer_object_ids}})

        if keyword_conditions:
            query["$or"] = keyword_conditions

        # 标签筛选 (tags 参数可能是逗号分隔的字符串或列表)
        tags_filter = filters.get("tags")
        if tags_filter:
            tag_list = tags_filter if isinstance(tags_filter, list) else [tags_filter]
            if tag_list:
                query["tags.name"] = {"$in": tag_list}

        # 计算总数
        total = self.collection.count_documents(query)

        # 排序处理
        direction = -1 if sort_order == "desc" else 1
        collation = {"locale": "zh"}
        
        # 准备聚合管道
        current_year = datetime.now().year
        start_of_year = datetime(current_year, 1, 1)
        end_of_year = datetime(current_year, 12, 31, 23, 59, 59)
        
        pipeline = [
            {"$match": query},
            # 关联 retail_contracts 计算当年电量
            {
                "$lookup": {
                    "from": "retail_contracts",
                    "let": {"cid_str": {"$toString": "$_id"}},
                    "pipeline": [
                        {
                            "$match": {
                                "$expr": {
                                    "$eq": ["$customer_id", "$$cid_str"]
                                }
                            }
                        },
                        {
                            "$group": {
                                "_id": None,
                                "total_quantity": {
                                    "$sum": {
                                        "$cond": [
                                            {
                                                "$and": [
                                                    {"$gte": ["$purchase_start_month", start_of_year]},
                                                    {"$lte": ["$purchase_start_month", end_of_year]}
                                                ]
                                            },
                                            "$purchasing_electricity_quantity",
                                            0
                                        ]
                                    }
                                },
                                "min_start_month": {"$min": "$purchase_start_month"}
                            }
                        }
                    ],
                    "as": "contract_stats"
                }
            },
            # 提取计算结果并转换单位 (kWh -> 万kWh)
            {
                "$addFields": {
                    "contract_stat_obj": {"$arrayElemAt": ["$contract_stats", 0]},
                    "current_year_contract_amount": {
                        "$round": [
                            {
                                "$divide": [
                                    {"$ifNull": [{"$arrayElemAt": ["$contract_stats.total_quantity", 0]}, 0]},
                                    10000
                                ]
                            },
                            2
                        ]
                    }
                }
            }
        ]

        # 添加排序阶段
        # 默认按本年度签约电量大小由大到小排序
        pipeline.append({"$sort": {"current_year_contract_amount": -1, "created_at": -1}})
        if page_size > 0:
            skip = (page - 1) * page_size
            pipeline.append({"$skip": skip})
            pipeline.append({"$limit": page_size})

        # 执行聚合查询
        cursor = self.collection.aggregate(pipeline, collation=collation)
        customer_docs = list(cursor)

        # 转换为列表项格式
        items = []
        for doc in customer_docs:
            # 计算资产统计
            accounts = doc.get("accounts", [])
            account_count = len(accounts)
            meter_count = 0
            mp_count = 0
            for account in accounts:
                meter_count += len(account.get("meters", []))
                mp_count += len(account.get("metering_points", []))

            # 构建标签列表
            tags_data = doc.get("tags", [])

            item = CustomerListItem(
                id=str(doc["_id"]),
                user_name=doc.get("user_name", ""),
                short_name=doc.get("short_name"),
                needs_name_masking=doc.get("needs_name_masking", self._infer_needs_name_masking(doc.get("user_name"))),
                location=doc.get("location"),
                tags=tags_data,
                account_count=account_count,
                meter_count=meter_count,
                mp_count=mp_count,
                created_at=doc.get("created_at", datetime.now()),
                updated_at=doc.get("updated_at", datetime.now()),
                current_year_contract_amount=doc.get("current_year_contract_amount", 0.0)
            )
            items.append(item.model_dump())

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": items
        }


    def update(self, customer_id: str, customer_data: Dict[str, Any], operator: str) -> Dict[str, Any]:
        """
        更新客户信息

        Args:
            customer_id: 客户ID
            customer_data: 更新数据
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或客户名称已存在或状态不允许编辑
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        # 检查客户是否存在
        existing_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not existing_customer:
            raise ValueError("客户不存在")

        current_status = existing_customer.get("status")

        # 状态编辑权限检查
        if current_status == "terminated":
            raise ValueError("已终止的客户不可编辑")

        # 如果尝试修改状态，需要通过状态转换方法，不允许直接修改
        if "status" in customer_data and customer_data["status"] != current_status:
            raise ValueError("不允许直接修改状态，请使用相应的状态转换操作")

        # 检查客户名称是否与其他客户重复
        new_user_name = customer_data.get("user_name")
        if new_user_name and new_user_name != existing_customer.get("user_name"):
            duplicate_customer = self.collection.find_one({
                "user_name": new_user_name,
                "_id": {"$ne": ObjectId(customer_id)}
            })
            if duplicate_customer:
                raise ValueError(f"客户名称 '{new_user_name}' 已存在")

        # 验证户号和计量点的唯一性
        if "utility_accounts" in customer_data:
            utility_accounts = customer_data["utility_accounts"]
            account_ids = [account.get("account_id") for account in utility_accounts]
            if len(account_ids) != len(set(account_ids)):
                raise ValueError("户号在当前客户内重复")

            for account in utility_accounts:
                metering_points = account.get("metering_points", [])
                mp_ids = [mp.get("metering_point_id") for mp in metering_points]
                if len(mp_ids) != len(set(mp_ids)):
                    raise ValueError(f"户号 {account.get('account_id')} 内计量点ID重复")

        # 更新数据
        update_data = customer_data.copy()
        if "needs_name_masking" not in update_data and "user_name" in update_data:
            update_data["needs_name_masking"] = self._infer_needs_name_masking(update_data.get("user_name"))
        update_data["updated_at"] = datetime.now()
        update_data["updated_by"] = operator

        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("客户不存在")

        # 同步更新关联的零售合同信息
        new_short_name = update_data.get("short_name")
        old_short_name = existing_customer.get("short_name")
        # new_user_name check from update_data because user_name might not be provided in partial updates
        new_user_name = update_data.get("user_name")
        old_user_name = existing_customer.get("user_name")

        contract_updates = {}
        
        if "user_name" in update_data and new_user_name != old_user_name:
            contract_updates["customer_name"] = new_user_name
            
        if "short_name" in update_data and new_short_name != old_short_name:
            # 合同名称依赖于客户简称，需要针对每个合同单独处理
            needs_contract_name_update = True
        else:
            needs_contract_name_update = False
            
        if contract_updates or needs_contract_name_update:
            contracts = self.db.retail_contracts.find({"customer_id": str(customer_id)})
            for contract in contracts:
                current_updates = contract_updates.copy()
                if needs_contract_name_update:
                    purchase_start = contract.get("purchase_start_month")
                    if purchase_start:
                        year_month_str = purchase_start.strftime("%Y%m")
                        short_name_to_use = new_short_name if new_short_name else "客户"
                        current_updates["contract_name"] = f"{short_name_to_use}{year_month_str}"
                
                if current_updates:
                    self.db.retail_contracts.update_one(
                        {"_id": contract["_id"]},
                        {"$set": current_updates}
                    )

        # 返回更新后的客户信息
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def delete(self, customer_id: str) -> None:
        """
        删除客户（物理删除，仅限意向客户）

        根据业务规则：只有"意向客户"(prospect)状态才能被物理删除。
        其他状态的客户不可删除，必须通过状态转换方法处理。

        Args:
            customer_id: 客户ID

        Raises:
            ValueError: 客户不存在或状态不允许删除
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        # 查找客户并检查状态
        customer = self.collection.find_one({"_id": ObjectId(customer_id)})

        if not customer:
            raise ValueError("客户不存在")

        # 不再检查客户状态，允许直接删除

        # 物理删除
        result = self.collection.delete_one({"_id": ObjectId(customer_id)})

        if result.deleted_count == 0:
            raise ValueError("删除失败")

    def add_utility_account(self, customer_id: str, account_data: dict, operator: str) -> dict:
        """
        为客户添加户号

        Args:
            customer_id: 客户ID
            account_data: 户号数据
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号已存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 检查户号是否已存在
        existing_accounts = customer.get("utility_accounts", [])
        account_id = account_data.get("account_id")
        for account in existing_accounts:
            if account.get("account_id") == account_id:
                raise ValueError(f"户号 '{account_id}' 已存在")

        # 添加新户号
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$push": {"utility_accounts": account_data},
                "$set": {"updated_at": datetime.now(), "updated_by": operator}
            }
        )

        if result.matched_count == 0:
            raise ValueError("客户不存在")

        # 返回更新后的客户信息
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def update_utility_account(self, customer_id: str, account_id: str, account_data: dict, operator: str) -> dict:
        """
        更新户号信息

        Args:
            customer_id: 客户ID
            account_id: 户号
            account_data: 更新数据
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号不存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 查找并更新户号
        accounts = customer.get("utility_accounts", [])
        account_found = False
        for i, account in enumerate(accounts):
            if account.get("account_id") == account_id:
                # 更新户号信息
                for key, value in account_data.items():
                    if key != "account_id":  # 不允许修改户号
                        accounts[i][key] = value
                account_found = True
                break

        if not account_found:
            raise ValueError(f"户号 '{account_id}' 不存在")

        # 更新数据库
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$set": {
                    "utility_accounts": accounts,
                    "updated_at": datetime.now(),
                    "updated_by": operator
                }
            }
        )

        if result.matched_count == 0:
            raise ValueError("客户不存在")

        # 返回更新后的客户信息
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def delete_utility_account(self, customer_id: str, account_id: str, operator: str) -> dict:
        """
        删除户号

        Args:
            customer_id: 客户ID
            account_id: 户号
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号不存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 删除户号
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$pull": {"utility_accounts": {"account_id": account_id}},
                "$set": {"updated_at": datetime.now(), "updated_by": operator}
            }
        )

        if result.matched_count == 0:
            raise ValueError("客户不存在")

        # 返回更新后的客户信息
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def add_metering_point(self, customer_id: str, account_id: str, metering_point_data: dict, operator: str) -> dict:
        """
        为户号添加计量点

        Args:
            customer_id: 客户ID
            account_id: 户号
            metering_point_data: 计量点数据
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号不存在或计量点ID已存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 查找对应的户号
        accounts = customer.get("utility_accounts", [])
        target_account = None
        for account in accounts:
            if account.get("account_id") == account_id:
                target_account = account
                break

        if not target_account:
            raise ValueError(f"户号 '{account_id}' 不存在")

        # 检查计量点ID是否已存在
        existing_metering_points = target_account.get("metering_points", [])
        metering_point_id = metering_point_data.get("metering_point_id")
        for mp in existing_metering_points:
            if mp.get("metering_point_id") == metering_point_id:
                raise ValueError(f"计量点ID '{metering_point_id}' 已存在")

        # 添加计量点
        target_account["metering_points"].append(metering_point_data)

        # 更新客户信息
        result = self.update(
            customer_id=customer_id,
            customer_data={"utility_accounts": accounts},
            operator=operator
        )
        return result

    def update_metering_point(self, customer_id: str, account_id: str, metering_point_id: str, metering_point_data: dict, operator: str) -> dict:
        """
        更新计量点信息

        Args:
            customer_id: 客户ID
            account_id: 户号
            metering_point_id: 计量点ID
            metering_point_data: 更新数据
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号不存在或计量点不存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 查找对应的户号
        accounts = customer.get("utility_accounts", [])
        target_account = None
        for account in accounts:
            if account.get("account_id") == account_id:
                target_account = account
                break

        if not target_account:
            raise ValueError(f"户号 '{account_id}' 不存在")

        # 查找并更新计量点
        metering_points = target_account.get("metering_points", [])
        metering_point_found = False
        for i, mp in enumerate(metering_points):
            if mp.get("metering_point_id") == metering_point_id:
                # 更新计量点信息
                for key, value in metering_point_data.items():
                    if key != "metering_point_id":  # 不允许修改计量点ID
                        metering_points[i][key] = value
                metering_point_found = True
                break

        if not metering_point_found:
            raise ValueError(f"计量点ID '{metering_point_id}' 不存在")

        # 更新客户信息
        result = self.update(
            customer_id=customer_id,
            customer_data={"utility_accounts": accounts},
            operator=operator
        )
        return result

    def delete_metering_point(self, customer_id: str, account_id: str, metering_point_id: str, operator: str) -> dict:
        """
        删除计量点

        Args:
            customer_id: 客户ID
            account_id: 户号
            metering_point_id: 计量点ID
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或户号不存在或计量点不存在
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({
            "_id": ObjectId(customer_id),
            "status": {"$ne": "deleted"}
        })
        if not customer:
            raise ValueError("客户不存在")

        # 查找对应的户号
        accounts = customer.get("utility_accounts", [])
        target_account = None
        for account in accounts:
            if account.get("account_id") == account_id:
                target_account = account
                break

        if not target_account:
            raise ValueError(f"户号 '{account_id}' 不存在")

        # 删除计量点
        metering_points = target_account.get("metering_points", [])
        original_length = len(metering_points)
        metering_points = [mp for mp in metering_points if mp.get("metering_point_id") != metering_point_id]

        if len(metering_points) == original_length:
            raise ValueError(f"计量点ID '{metering_point_id}' 不存在")

        # 更新户号的计量点列表
        for account in accounts:
            if account.get("account_id") == account_id:
                account["metering_points"] = metering_points
                break

        # 更新客户信息
        result = self.update(
            customer_id=customer_id,
            customer_data={"utility_accounts": accounts},
            operator=operator
        )
        return result

    def get_meter_info(self, meter_id: str) -> dict:
        """
        获取电表信息（用于自动填充）

        Args:
            meter_id: 电表资产号

        Returns:
            电表信息
        """
        pipeline = [
            {"$match": {"status": {"$ne": "deleted"}}},
            {"$unwind": "$utility_accounts"},
            {"$unwind": "$utility_accounts.metering_points"},
            {"$match": {"utility_accounts.metering_points.meter.meter_id": meter_id}},
            {"$group": {
                "_id": "$utility_accounts.metering_points.meter.meter_id",
                "multiplier": {"$first": "$utility_accounts.metering_points.meter.multiplier"},
                "meter_type": {"$first": "$utility_accounts.metering_points.meter.meter_type"},
                "installation_date": {"$first": "$utility_accounts.metering_points.meter.installation_date"},
                "usage_count": {"$sum": 1}
            }}
        ]

        result = list(self.collection.aggregate(pipeline))

        if result:
            return {
                "meter_id": result[0]["_id"],
                "multiplier": result[0]["multiplier"],
                "meter_type": result[0]["meter_type"],
                "installation_date": result[0]["installation_date"],
                "usage_count": result[0]["usage_count"]
            }

        return {}

    def sync_update_meter(self, meter_id: str, update_data: dict, sync_all: bool = True, operator: str = None) -> dict:
        """
        同步更新电表信息

        Args:
            meter_id: 电表资产号
            update_data: 更新数据
            sync_all: 是否同步更新所有计量点
            operator: 操作人

        Returns:
            更新结果
        """
        # 构建更新条件
        match_condition = {
            "status": {"$ne": "deleted"},
            "utility_accounts.metering_points.meter.meter_id": meter_id
        }

        if sync_all:
            # 更新所有匹配的计量点
            update_fields = {}
            for key, value in update_data.items():
                update_fields[f"utility_accounts.$[].metering_points.$[elem].meter.{key}"] = value

            result = self.collection.update_many(
                match_condition,
                {
                    "$set": {
                        **update_fields,
                        "updated_at": datetime.now(),
                        "updated_by": operator
                    }
                },
                array_filters=[{"elem.meter.meter_id": meter_id}]
            )

            return {
                "matched_count": result.matched_count,
                "modified_count": result.modified_count,
                "message": f"成功更新 {result.modified_count} 个计量点的电表信息"
            }
        else:
            # 这里可以根据需要实现单个更新的逻辑
            # 目前先返回全部更新的结果
            return self.sync_update_meter(meter_id, update_data, True, operator)

    # ==================== 状态转换方法 ====================

    def sign_contract(self, customer_id: str, operator: str, contract_id: Optional[str] = None) -> dict:
        """
        签约操作：将意向客户转换为待生效状态

        状态流转：prospect → pending

        Args:
            customer_id: 客户ID
            operator: 操作人
            contract_id: 关联的合同ID（可选）

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status != "prospect":
            raise ValueError(f"只有意向客户可以执行签约操作，当前状态: {current_status}")

        # 更新状态为待生效
        update_data = {
            "status": "pending",
            "updated_at": datetime.now(),
            "updated_by": operator
        }

        # 如果提供了合同ID，也保存
        if contract_id:
            update_data["contract_id"] = contract_id

        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def cancel_contract(self, customer_id: str, operator: str, reason: Optional[str] = None) -> dict:
        """
        撤销操作：将待生效客户转换为已终止状态

        状态流转：pending → terminated

        Args:
            customer_id: 客户ID
            operator: 操作人
            reason: 撤销原因（可选）

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status != "pending":
            raise ValueError(f"只有待生效客户可以执行撤销操作，当前状态: {current_status}")

        # 更新状态为已终止
        update_data = {
            "status": "terminated",
            "updated_at": datetime.now(),
            "updated_by": operator
        }

        if reason:
            update_data["termination_reason"] = reason

        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def activate(self, customer_id: str, operator: str) -> dict:
        """
        生效操作：将待生效客户转换为执行中状态

        状态流转：pending → active

        Args:
            customer_id: 客户ID
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status != "pending":
            raise ValueError(f"只有待生效客户可以执行生效操作，当前状态: {current_status}")

        # 更新状态为执行中
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": {
                "status": "active",
                "updated_at": datetime.now(),
                "updated_by": operator
            }}
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def suspend(self, customer_id: str, operator: str, reason: Optional[str] = None) -> dict:
        """
        暂停操作：将执行中客户转换为已暂停状态

        状态流转：active → suspended

        Args:
            customer_id: 客户ID
            operator: 操作人
            reason: 暂停原因（可选）

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status != "active":
            raise ValueError(f"只有执行中客户可以执行暂停操作，当前状态: {current_status}")

        # 更新状态为已暂停
        update_data = {
            "status": "suspended",
            "updated_at": datetime.now(),
            "updated_by": operator
        }

        if reason:
            update_data["suspension_reason"] = reason

        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def resume(self, customer_id: str, operator: str) -> dict:
        """
        恢复操作：将已暂停客户转换为执行中状态

        状态流转：suspended → active

        Args:
            customer_id: 客户ID
            operator: 操作人

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status != "suspended":
            raise ValueError(f"只有已暂停客户可以执行恢复操作，当前状态: {current_status}")

        # 更新状态为执行中，清除暂停原因
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$set": {
                    "status": "active",
                    "updated_at": datetime.now(),
                    "updated_by": operator
                },
                "$unset": {"suspension_reason": ""}
            }
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def terminate(self, customer_id: str, operator: str, reason: Optional[str] = None) -> dict:
        """
        终止操作：将执行中或已暂停客户转换为已终止状态

        状态流转：active/suspended → terminated

        Args:
            customer_id: 客户ID
            operator: 操作人
            reason: 终止原因（可选）

        Returns:
            更新后的客户信息

        Raises:
            ValueError: 客户不存在或状态不符合要求
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")

        current_status = customer.get("status")
        if current_status not in ["active", "suspended"]:
            raise ValueError(f"只有执行中或已暂停客户可以执行终止操作，当前状态: {current_status}")

        # 更新状态为已终止
        update_data = {
            "status": "terminated",
            "updated_at": datetime.now(),
            "updated_by": operator
        }

        if reason:
            update_data["termination_reason"] = reason

        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("更新失败")

        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    # ==================== 数据同步方法 ====================

    def preview_sync_data(self) -> List[SyncCandidate]:
        """
        预览待同步数据
        从 raw_mp_data 获取所有计量点，排除已在 customer_archives 中存在的
        """
        # 1. 聚合原始数据
        pipeline = [
            {"$group": {
                "_id": "$mp_id",
                "customer_name": {"$first": "$meta.customer_name"},
                "account_id": {"$first": "$meta.account_id"}
            }}
        ]
        raw_results = list(DATABASE.raw_mp_data.aggregate(pipeline))

        # 2. 获取现有计量点编号
        # 注意: accounts 是数组，accounts.metering_points 也是数组
        # 使用 distinct 获取所有已存在的计量点编号
        raw_existing = self.collection.distinct("accounts.metering_points.mp_no")
        # 确保转换为字符串并去除空格
        existing_mp_nos = {str(x).strip() for x in raw_existing if x}
        
        logger.info(f"Found {len(existing_mp_nos)} existing metering points for sync filter.")

        # 3. 过滤出不存在的
        candidates = []
        for item in raw_results:
            raw_mp_no = item["_id"]
            if not raw_mp_no:
                continue
                
            mp_no = str(raw_mp_no).strip()
            if mp_no and mp_no not in existing_mp_nos:
                candidates.append(SyncCandidate(
                    mp_no=mp_no,
                    customer_name=item["customer_name"] or "未命名客户",
                    account_id=item["account_id"] or "未知户号"
                ))
        
        logger.info(f"Sync preview found {len(candidates)} candidates after filtering.")
        return candidates

    def sync_customers(self, candidates: List[SyncCandidate], operator: str) -> Dict[str, int]:
        """
        批量同步客户数据
        """
        created_count = 0
        updated_count = 0
        
        for cand in candidates:
            # 1. 尝试按户号查找现有客户 (最强匹配)
            # 注意: 需要查找包含该户号的客户
            customer = self.collection.find_one({"accounts.account_id": cand.account_id})
            
            if customer:
                # 客户存在，且户号存在 -> 检查计量点是否需要添加
                accounts = customer.get("accounts", [])
                updated = False
                for acc in accounts:
                    if acc.get("account_id") == cand.account_id:
                        # 检查计量点是否存在
                        mp_exists = any(mp.get("mp_no") == cand.mp_no for mp in acc.get("metering_points", []))
                        if not mp_exists:
                            acc["metering_points"].append({
                                "mp_no": cand.mp_no,
                                "mp_name": "同步导入"
                            })
                            updated = True
                        break
                
                if updated:
                    self.collection.update_one(
                        {"_id": customer["_id"]},
                        {
                            "$set": {
                                "accounts": accounts,
                                "needs_name_masking": customer.get(
                                    "needs_name_masking",
                                    self._infer_needs_name_masking(customer.get("user_name")),
                                ),
                                "updated_at": datetime.now(),
                                "updated_by": operator,
                            }
                        }
                    )
                    updated_count += 1
                continue

            # 2. 尝试按客户名查找 (次级匹配)
            customer = self.collection.find_one({"user_name": cand.customer_name})
            
            if customer:
                # 客户存在 -> 添加新户号 (或合并到现有户号)
                accounts = customer.get("accounts", [])
                
                # 特殊情况: 刚刚按户号没查到，但这里也许户号已存在但未索引到? (不太可能，distinct逻辑已覆盖)
                # 还是直接添加新户号吧
                
                # 再次检查是否有同名户号 (防卫性)
                target_acc = next((a for a in accounts if a.get("account_id") == cand.account_id), None)
                if target_acc:
                     target_acc["metering_points"].append({
                        "mp_no": cand.mp_no,
                        "mp_name": "同步导入"
                    })
                else:
                    accounts.append({
                        "account_id": cand.account_id,
                        "meters": [],
                        "metering_points": [{
                            "mp_no": cand.mp_no,
                            "mp_name": "同步导入"
                        }]
                    })
                
                self.collection.update_one(
                    {"_id": customer["_id"]},
                    {
                        "$set": {
                            "accounts": accounts,
                            "needs_name_masking": customer.get(
                                "needs_name_masking",
                                self._infer_needs_name_masking(customer.get("user_name")),
                            ),
                            "updated_at": datetime.now(),
                            "updated_by": operator,
                        }
                    }
                )
                updated_count += 1
                continue

            # 3. 都不存在 -> 创建新客户
            new_customer = CustomerCreate(
                user_name=cand.customer_name,
                short_name=cand.customer_name[:4], # 默认简称
                accounts=[{
                    "account_id": cand.account_id,
                    "meters": [],
                    "metering_points": [{
                        "mp_no": cand.mp_no,
                        "mp_name": "同步导入"
                    }]
                }]
            )
            
            # 使用现有 create 逻辑太重(有重名检查等)，这里手动插入更灵活且安全(因为是批量)
            # 但为了保持一致性，还是手动构造文档插入
            doc = new_customer.model_dump(by_alias=True)
            doc["created_at"] = datetime.now()
            doc["updated_at"] = datetime.now()
            doc["created_by"] = operator
            doc["updated_by"] = operator
            doc["needs_name_masking"] = doc.get(
                "needs_name_masking",
                self._infer_needs_name_masking(doc.get("user_name")),
            )
            # 确保 tags 字段存在
            if "tags" not in doc:
                doc["tags"] = []
                
            try:
                self.collection.insert_one(doc)
                created_count += 1
            except DuplicateKeyError:
                # 极小概率并发冲突，忽略
                pass
                
        return {"created": created_count, "updated": updated_count}

    def add_tag(self, customer_id: str, tag_data: Dict[str, Any], operator: str) -> Dict[str, Any]:
        """
        添加客户标签
        
        Args:
            customer_id: 客户ID
            tag_data: 标签数据 {name, source, expire, reason}
            operator: 操作人
            
        Returns:
            更新后的客户信息
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        # 校验必填字段
        if not tag_data.get("name"):
            raise ValueError("标签名称不能为空")
        if not tag_data.get("source"):
            tag_data["source"] = "MANUAL"

        # 检查客户是否存在
        customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        if not customer:
            raise ValueError("客户不存在")
            
        # 检查标签是否已存在 (同名标签需更新而非重复添加)
        tags = customer.get("tags", [])
        tag_name = tag_data["name"]
        
        # 如果存在同名标签，先移除
        tags = [t for t in tags if t.get("name") != tag_name]
        
        # 添加新标签
        tags.append(tag_data)
        
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$set": {
                    "tags": tags,
                    "updated_at": datetime.now(),
                    "updated_by": operator
                }
            }
        )
        
        if result.matched_count == 0:
             raise ValueError("客户不存在")
             
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    def remove_tag(self, customer_id: str, tag_name: str, operator: str) -> Dict[str, Any]:
        """
        移除客户标签
        
        Args:
            customer_id: 客户ID
            tag_name: 标签名称
            operator: 操作人
            
        Returns:
            更新后的客户信息
        """
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")
            
        result = self.collection.update_one(
            {"_id": ObjectId(customer_id)},
            {
                "$pull": {"tags": {"name": tag_name}},
                "$set": {
                    "updated_at": datetime.now(),
                    "updated_by": operator
                }
            }
        )
        
        if result.matched_count == 0:
            raise ValueError("客户不存在")
            
        updated_customer = self.collection.find_one({"_id": ObjectId(customer_id)})
        return self._convert_to_dict(updated_customer)

    # ==================== 辅助方法 ====================

    def _convert_to_dict(self, doc: Dict[str, Any]) -> dict:
        """将MongoDB文档转换为字典"""
        if not doc:
            return {}

        # 转换ObjectId为字符串
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                if key == "_id":
                    result["id"] = str(value)  # 将_id转换为id
                else:
                    result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            else:
                result[key] = value

        if "needs_name_masking" not in result:
            result["needs_name_masking"] = self._infer_needs_name_masking(doc.get("user_name"))

        return result
