import logging
from bson import ObjectId
from typing import Optional, Dict, Any, List
from pymongo.database import Database
from webapp.tools.mongo import DATABASE
from webapp.models.contract import (
    Contract, ContractCreate, ContractListItem, calculate_contract_status
)
from datetime import datetime
from dateutil.relativedelta import relativedelta


logger = logging.getLogger(__name__)

_YEARS_CACHE: dict[str, Any] = {"years": None, "expires_at": None}


class ContractService:
    """
    Service layer for contract management.
    Handles business logic for creating, retrieving, updating, and deleting contracts.
    """

    def __init__(self, db: Database) -> None:
        self.db = db
        self.collection = self.db.retail_contracts
        self._ensure_indexes()

    def _ensure_indexes(self):
        """确保数据库索引存在"""
        try:
            # 要创建的索引列表
            indexes = [
                # 1. 基础查询索引
                ([('package_name', 1)], {'name': 'idx_package_name'}),
                ([('customer_name', 1)], {'name': 'idx_customer_name'}),
                ([('contract_name', 1)], {'name': 'idx_contract_name'}),
                ([('purchase_start_month', 1)], {'name': 'idx_purchase_start_month'}),
                ([('purchase_end_month', 1)], {'name': 'idx_purchase_end_month'}),

                # 2. 关联查询索引
                ([('package_id', 1)], {'name': 'idx_package_id'}),
                ([('customer_id', 1)], {'name': 'idx_customer_id'}),

                # 3. 组合查询索引（优化筛选查询）
                ([('package_name', 1), ('purchase_start_month', -1)],
                 {'name': 'idx_package_start'}),
                ([('customer_name', 1), ('purchase_start_month', -1)],
                 {'name': 'idx_customer_start'}),
                ([('contract_name', 1), ('purchase_start_month', -1)],
                 {'name': 'idx_contract_start'}),

                # 4. 日期范围重叠检查索引
                ([('customer_id', 1), ('purchase_start_month', 1), ('purchase_end_month', 1)],
                 {'name': 'idx_customer_date_range'}),

                # 5. 时间索引
                ([('created_at', -1)], {'name': 'idx_created_at'}),
                ([('updated_at', -1)], {'name': 'idx_updated_at'}),
            ]

            existing_indexes = {idx.get('name') for idx in self.collection.list_indexes()}

            for keys, options in indexes:
                if options['name'] not in existing_indexes:
                    self.collection.create_index(keys, **options)

        except Exception as e:
            # 索引创建失败不应该阻止服务启动，记录错误即可
            logger.warning(f"创建合同索引时出错: {str(e)}")

    def create(self, contract_data: dict, operator: str) -> dict:
        """
        创建新合同

        Args:
            contract_data: 合同数据
            operator: 操作人

        Returns:
            创建的合同信息

        Raises:
            ValueError: 数据校验失败或关联数据不存在
        """
        # 1. 验证套餐存在且状态为 active
        package_id = contract_data.get("package_id")
        if not ObjectId.is_valid(package_id):
            raise ValueError("无效的套餐ID")

        package = self.db.retail_packages.find_one({
            "_id": ObjectId(package_id)
        })
        if not package:
            raise ValueError(f"套餐不存在")

        # 2. 验证客户存在且状态为 active
        customer_id = contract_data.get("customer_id")
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        customer = self.db.customer_archives.find_one({
            "_id": ObjectId(customer_id)
        })
        if not customer:
            raise ValueError(f"客户不存在")

        # 3. 检查日期范围重叠
        start_month = contract_data.get("purchase_start_month")
        end_month = contract_data.get("purchase_end_month")

        # 校验年份一致性
        self._validate_same_year(start_month, end_month)

        if self._check_date_range_overlap(customer_id, start_month, end_month):
            raise ValueError("该客户在指定日期范围内已存在合同，请检查日期设置")

        # 4. 自动生成合同名称（如果没有提供）
        if "contract_name" not in contract_data or not contract_data["contract_name"]:
            contract_name = self._generate_contract_name(customer_id, start_month)
            contract_data["contract_name"] = contract_name

        # 5. 创建合同对象
        contract = Contract(**contract_data)
        contract.created_by = operator
        contract.updated_by = operator
        contract.created_at = datetime.now()
        contract.updated_at = datetime.now()

        # 6. 准备插入文档
        doc_to_insert = contract.model_dump(by_alias=True, exclude_unset=True)
        # 确保写入数据库的是ObjectId，而不是被Pydantic过早序列化为的字符串
        doc_to_insert['_id'] = contract.id

        # 7. 插入数据库
        result = self.collection.insert_one(doc_to_insert)

        # 8. 返回创建的合同信息（包含虚拟状态字段）
        created_contract = self.collection.find_one({"_id": result.inserted_id})
        return self._convert_to_dict_with_status(created_contract)

    def get_by_id(self, contract_id: str) -> dict:
        """
        根据ID获取合同详情

        Args:
            contract_id: 合同ID

        Returns:
            合同详情（包含虚拟状态字段）

        Raises:
            ValueError: 合同不存在
        """
        if not ObjectId.is_valid(contract_id):
            raise ValueError("无效的合同ID")

        contract = self.collection.find_one({"_id": ObjectId(contract_id)})

        if not contract:
            raise ValueError("合同不存在")

        return self._convert_to_dict_with_status(contract)

    def list(self, filters: dict, page: int = 1, page_size: int = 20, 
             sort_field: str = "created_at", sort_order: str = "desc") -> dict:
        """
        获取合同列表

        Args:
            filters: 筛选条件
            page: 页码
            page_size: 每页大小
            sort_field: 排序字段
            sort_order: 排序方向 (asc/desc)

        Returns:
            合同列表响应（包含虚拟状态字段）
        """
        # 构建查询条件
        query = {}

        # 添加筛选条件
        if filters.get("contract_name"):
            query["contract_name"] = {"$regex": filters["contract_name"], "$options": "i"}

        if filters.get("package_name"):
            query["package_name"] = {"$regex": filters["package_name"], "$options": "i"}

        if filters.get("customer_name"):
            query["customer_name"] = {"$regex": filters["customer_name"], "$options": "i"}

        customer_ids = [customer_id for customer_id in (filters.get("customer_ids") or []) if customer_id]
        if customer_ids:
            customer_id_query = {"customer_id": {"$in": customer_ids}}
            if query.get("customer_name"):
                query = {
                    "$and": [
                        {"$or": [customer_id_query, {"customer_name": query.pop("customer_name")}]},
                        query,
                    ]
                }
            else:
                query.update(customer_id_query)

        if filters.get("year"):
            try:
                year = int(filters["year"])
                start_of_year = datetime(year, 1, 1)
                end_of_year = datetime(year, 12, 31, 23, 59, 59)
                # 逻辑：开始日期和结束日期必须在同一年，所以只需查询 purchase_start_month 在该年即可
                query["purchase_start_month"] = {"$gte": start_of_year, "$lte": end_of_year}
            except (ValueError, TypeError):
                pass
        else:
            if filters.get("purchase_start_month"):
                query["purchase_start_month"] = {"$gte": filters["purchase_start_month"]}

            if filters.get("purchase_end_month"):
                query["purchase_end_month"] = {"$lte": filters["purchase_end_month"]}

        # 注意：status 是虚拟字段，需要在查询后过滤
        status_filter = filters.get("status")

        # 计算总数（状态筛选前）
        total_before_status = self.collection.count_documents(query)

        # 分页查询
        skip = (page - 1) * page_size if page_size > 0 else 0
        # 排序处理
        direction = 1 if sort_order == "asc" else -1
        
        # 允许排序的字段白名单
        allowed_sort_fields = [
            "created_at", "contract_name", "customer_name", 
            "package_name", "purchasing_electricity_quantity", 
            "purchase_start_month"
        ]
        if sort_field not in allowed_sort_fields:
            sort_field = "created_at"

        # 如果有状态筛选，需要多取一些数据以便过滤后仍能满足分页要求
        # 为简化实现，这里先取所有数据再过滤（生产环境可优化）
        # 使用中文校对规则进行排序
        collation = {"locale": "zh"}
        
        if status_filter or page_size <= 0:
            docs = list(self.collection.find(query).collation(collation).sort(sort_field, direction))
        else:
            docs = list(self.collection.find(query).collation(collation).sort(sort_field, direction).skip(skip).limit(page_size))

        package_object_ids = list({
            ObjectId(str(doc.get("package_id")))
            for doc in docs
            if doc.get("package_id") and ObjectId.is_valid(str(doc.get("package_id")))
        })
        package_status_map = {}
        if package_object_ids:
            package_cursor = self.db.retail_packages.find(
                {"_id": {"$in": package_object_ids}},
                {"status": 1},
            )
            package_status_map = {
                str(package["_id"]): package.get("status")
                for package in package_cursor
            }

        # 转换为列表项格式（计算虚拟状态）
        items = []
        for doc in docs:
            # 计算虚拟状态
            status = calculate_contract_status(
                doc.get("purchase_start_month"),
                doc.get("purchase_end_month")
            )

            # 如果有状态筛选，进行过滤
            if status_filter and status != status_filter:
                continue

            # 获取套餐状态
            package_status = package_status_map.get(str(doc.get("package_id") or ""))

            item = ContractListItem(
                id=str(doc["_id"]),
                contract_name=doc.get("contract_name", ""),
                package_name=doc.get("package_name", ""),
                package_status=package_status,
                customer_name=doc.get("customer_name", ""),
                purchasing_electricity_quantity=doc.get("purchasing_electricity_quantity", 0),
                purchase_start_month=doc.get("purchase_start_month"),
                purchase_end_month=doc.get("purchase_end_month"),
                status=status,
                created_at=doc.get("created_at"),
                updated_at=doc.get("updated_at")
            )
            items.append(item.model_dump())

        # 如果有状态筛选，进行分页
        if status_filter:
            total = len(items)
            items = items[skip:skip + page_size] if page_size > 0 else items
        else:
            total = total_before_status

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": items
        }

    def update(self, contract_id: str, contract_data: dict, operator: str) -> dict:
        """
        更新合同（仅待生效状态）

        Args:
            contract_id: 合同ID
            contract_data: 更新数据
            operator: 操作人

        Returns:
            更新后的合同信息

        Raises:
            ValueError: 合同不存在或状态不允许编辑
        """
        if not ObjectId.is_valid(contract_id):
            raise ValueError("无效的合同ID")

        # 1. 查询现有合同
        existing_contract = self.collection.find_one({"_id": ObjectId(contract_id)})
        if not existing_contract:
            raise ValueError("合同不存在")

        # 2. 计算当前状态
        current_status = calculate_contract_status(
            existing_contract.get("purchase_start_month"),
            existing_contract.get("purchase_end_month")
        )

        # 3. 如果状态不是 pending，返回错误
        if current_status != "pending":
            raise ValueError(f"只能编辑待生效状态的合同，当前状态为：{current_status}")

        # 4. 验证套餐和客户存在性（如果有更新）
        customer = None
        if "package_id" in contract_data:
            package_id = contract_data.get("package_id")
            if not ObjectId.is_valid(package_id):
                raise ValueError("无效的套餐ID")

            package = self.db.retail_packages.find_one({
                "_id": ObjectId(package_id)
            })
            if not package:
                raise ValueError("套餐不存在")

        if "customer_id" in contract_data:
            customer_id = contract_data.get("customer_id")
            if not ObjectId.is_valid(customer_id):
                raise ValueError("无效的客户ID")

            customer = self.db.customer_archives.find_one({
                "_id": ObjectId(customer_id)
            })
            if not customer:
                raise ValueError("客户不存在")

        # 5. 检查日期范围重叠（如果更新了日期或客户）
        customer_id_for_check = contract_data.get("customer_id", existing_contract.get("customer_id"))
        start_month_for_check = contract_data.get("purchase_start_month", existing_contract.get("purchase_start_month"))
        end_month_for_check = contract_data.get("purchase_end_month", existing_contract.get("purchase_end_month"))

        if (contract_data.get("customer_id") or
            contract_data.get("purchase_start_month") or
            contract_data.get("purchase_end_month")):

            if self._check_date_range_overlap(customer_id_for_check, start_month_for_check, end_month_for_check, exclude_contract_id=contract_id):
                raise ValueError("该客户在指定日期范围内已存在其他合同，请检查日期设置")

        # 6. 自动生成合同名称（如果更新了客户或日期）
        if (contract_data.get("customer_id") or contract_data.get("purchase_start_month")) and (
            "contract_name" not in contract_data or not contract_data["contract_name"]):

            # 确定要使用的客户ID
            customer_id_for_name = contract_data.get("customer_id") or existing_contract.get("customer_id")

            contract_name = self._generate_contract_name(customer_id_for_name, start_month_for_check)
            contract_data["contract_name"] = contract_name

        # 7. 更新审计字段
        update_data = contract_data.copy()
        update_data["updated_at"] = datetime.now()
        update_data["updated_by"] = operator

        # 8. 执行更新
        result = self.collection.update_one(
            {"_id": ObjectId(contract_id)},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            raise ValueError("合同不存在")

        # 9. 返回更新后的合同
        updated_contract = self.collection.find_one({"_id": ObjectId(contract_id)})
        return self._convert_to_dict_with_status(updated_contract)

    def delete(self, contract_id: str) -> None:
        """
        删除合同（仅待生效状态）

        Args:
            contract_id: 合同ID

        Raises:
            ValueError: 合同不存在或状态不允许删除
        """
        if not ObjectId.is_valid(contract_id):
            raise ValueError("无效的合同ID")

        # 1. 查询现有合同
        existing_contract = self.collection.find_one({"_id": ObjectId(contract_id)})
        if not existing_contract:
            raise ValueError("合同不存在")

        # 2. 计算当前状态
        current_status = calculate_contract_status(
            existing_contract.get("purchase_start_month"),
            existing_contract.get("purchase_end_month")
        )

        # 3. 如果状态不是 pending，返回错误
        if current_status != "pending":
            raise ValueError(f"只能删除待生效状态的合同，当前状态为：{current_status}")

        # 4. 执行删除（硬删除）
        result = self.collection.delete_one({"_id": ObjectId(contract_id)})

        if result.deleted_count == 0:
            raise ValueError("合同不存在")

    def _convert_to_dict_with_status(self, doc: Dict[str, Any]) -> dict:
        """
        将MongoDB文档转换为字典，并添加虚拟状态字段

        Args:
            doc: MongoDB文档

        Returns:
            包含虚拟状态的字典
        """
        if not doc:
            return {}

        # 需要排除的字段（二进制数据不应该返回给API）
        excluded_fields = {'pdf_binary_data'}

        # 转换ObjectId为字符串
        result = {}
        for key, value in doc.items():
            # 跳过需要排除的字段
            if key in excluded_fields:
                continue
            if isinstance(value, ObjectId):
                if key == "_id":
                    result["id"] = str(value)  # 将_id转换为id
                else:
                    result[key] = str(value)
            else:
                result[key] = value
        
        # 添加一个has_pdf标志字段（不返回二进制数据本身）
        result["has_pdf"] = bool(doc.get("pdf_filename"))

        # 计算并添加虚拟状态字段
        if "purchase_start_month" in doc and "purchase_end_month" in doc:
            result["status"] = calculate_contract_status(
                doc["purchase_start_month"],
                doc["purchase_end_month"]
            )

        return result

    def _generate_contract_name(self, customer_id: str, purchase_start_month: datetime) -> str:
        """
        生成合同名称（客户简称 + 购电开始年月）

        Args:
            customer_id: 客户ID
            purchase_start_month: 购电开始月份

        Returns:
            合同名称，如"供服中心202509"
        """
        # 从客户档案获取客户简称
        customer = self.db.customer_archives.find_one({
            "_id": ObjectId(customer_id)
        })

        if customer and customer.get("short_name"):
            short_name = customer["short_name"]
        else:
            # 如果无法获取客户简称，使用默认值
            short_name = "客户"

        # 生成年月字符串（YYYYMM格式）
        year_month_str = purchase_start_month.strftime("%Y%m")

        return f"{short_name}{year_month_str}"

    def get_available_years(self) -> List[int]:
        """
        获取所有合同中涉及的年份（去重）
        """
        now = datetime.now()
        expires_at = _YEARS_CACHE.get("expires_at")
        if _YEARS_CACHE.get("years") is not None and expires_at and expires_at > now:
            return list(_YEARS_CACHE["years"])

        pipeline = [
            {"$project": {
                "start_year": {"$year": "$purchase_start_month"},
                "end_year": {"$year": "$purchase_end_month"}
            }},
            {"$group": {
                "_id": None,
                "years_start": {"$addToSet": "$start_year"},
                "years_end": {"$addToSet": "$end_year"}
            }}
        ]
        
        result = list(self.collection.aggregate(pipeline))
        if not result:
            return [datetime.now().year]
            
        years = set()
        for y in result[0].get("years_start", []):
            try:
                years.add(int(y))
            except:
                pass
        for y in result[0].get("years_end", []):
            try:
                years.add(int(y))
            except:
                pass
                
        # 确保当前年份总是存在
        years.add(datetime.now().year)

        sorted_years = sorted(list(years), reverse=True)
        _YEARS_CACHE["years"] = sorted_years
        _YEARS_CACHE["expires_at"] = now + relativedelta(minutes=10)
        return sorted_years

    def _validate_same_year(self, start_date: datetime, end_date: datetime):
        """校验开始和结束日期必须在同一年"""
        if isinstance(start_date, str):
            start_date = datetime.strptime(start_date, "%Y-%m")
        if isinstance(end_date, str):
            end_date = datetime.strptime(end_date, "%Y-%m")
            
        if start_date.year != end_date.year:
            raise ValueError(f"合同不允许跨年：开始年份({start_date.year})与结束年份({end_date.year})不一致")

    def _check_date_range_overlap(self, customer_id: str, start_month: datetime, end_month: datetime, exclude_contract_id: Optional[str] = None) -> bool:
        """
        检查同一客户的日期范围是否重叠

        Args:
            customer_id: 客户ID
            start_month: 新合同的开始月份
            end_month: 新合同的结束月份
            exclude_contract_id: 要排除的合同ID（用于更新时检查）

        Returns:
            True 如果有重叠，False 如果无重叠
        """
        query = {
            "customer_id": customer_id,
            "$or": [
                # 新合同开始时间在现有合同期间内
                {
                    "purchase_start_month": {"$lte": start_month},
                    "purchase_end_month": {"$gte": start_month}
                },
                # 新合同结束时间在现有合同期间内
                {
                    "purchase_start_month": {"$lte": end_month},
                    "purchase_end_month": {"$gte": end_month}
                },
                # 新合同完全包含现有合同
                {
                    "purchase_start_month": {"$gte": start_month},
                    "purchase_end_month": {"$lte": end_month}
                },
                # 现有合同完全包含新合同
                {
                    "purchase_start_month": {"$lte": start_month},
                    "purchase_end_month": {"$gte": end_month}
                }
            ]
        }

        # 如果是更新操作，排除当前合同
        if exclude_contract_id and ObjectId.is_valid(exclude_contract_id):
            query["_id"] = {"$ne": ObjectId(exclude_contract_id)}

        # 查找重叠的合同
        overlapping_contracts = list(self.collection.find(query))

    def get_active_customers(self, start_date: datetime, end_date: datetime) -> List[str]:
        """
        获取指定时间范围内有有效合同的客户ID列表
        
        Args:
            start_date: 查询范围开始时间
            end_date: 查询范围结束时间
            
        Returns:
            客户ID列表
        """
        # 确保时间类型正确
        if isinstance(start_date, str):
            try:
                start_date = datetime.strptime(start_date, "%Y-%m-%d")
            except ValueError:
                start_date = datetime.strptime(start_date, "%Y-%m")
                
        if isinstance(end_date, str):
            try:
                end_date = datetime.strptime(end_date, "%Y-%m-%d")
            except ValueError:
                # 如果只有年月，默认到该月最后一天还是第一天？
                # 通常作为结束时间，应涵盖该月？这里简单处理，假设调用方已处理好
                end_date = datetime.strptime(end_date, "%Y-%m")

        # 查询条件：合同有效期与查询范围有重叠
        # 即：合同开始时间 <= 查询结束时间 AND 合同结束时间 >= 查询开始时间
        query = {
            "purchase_start_month": {"$lte": end_date},
            "purchase_end_month": {"$gte": start_date},
            # 状态过滤：根据实际业务需求，可能需要过滤 active 状态
            # 但 calculate_contract_status 是动态计算的，数据库中不一定实时准确
            # 这里先假设只要有合同记录且日期匹配即视为签约
        }
        
        # 优化：如果是明确的 status 字段
        # query["status"] = {"$in": ["active", "有效", "执行中"]}
        
        cursor = self.collection.find(query, {"customer_id": 1})
        customer_ids = list(set(str(doc["customer_id"]) for doc in cursor if doc.get("customer_id")))
        
        return customer_ids

    def get_signed_customers_in_range(self, start_date: datetime, end_date: datetime) -> List[Dict[str, str]]:
        """
        获取指定时间范围内有有效合同的客户列表（包含ID和名称）
        
        Args:
            start_date: 查询范围开始时间
            end_date: 查询范围结束时间
            
        Returns:
            客户列表 [{"customer_id": str, "customer_name": str}, ...]
        """
        # 确保时间类型正确
        if isinstance(start_date, str):
            try:
                start_date = datetime.strptime(start_date, "%Y-%m-%d")
            except ValueError:
                start_date = datetime.strptime(start_date, "%Y-%m")
                
        if isinstance(end_date, str):
            try:
                end_date = datetime.strptime(end_date, "%Y-%m-%d")
            except ValueError:
                end_date = datetime.strptime(end_date, "%Y-%m")

        # 查询条件：合同有效期与查询范围有重叠
        query = {
            "purchase_start_month": {"$lte": end_date},
            "purchase_end_month": {"$gte": start_date}
        }
        
        cursor = self.collection.find(query, {"customer_id": 1, "customer_name": 1})
        
        # 去重
        customer_map = {}
        for doc in cursor:
            cid = str(doc.get("customer_id", ""))
            if cid and cid not in customer_map:
                customer_map[cid] = {
                    "customer_id": cid,
                    "customer_name": doc.get("customer_name", "未知")
                }
        
        return list(customer_map.values())
