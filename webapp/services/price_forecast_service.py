"""
价格预测数据服务

提供日前价格预测结果的查询接口，包括：
- 预测版本列表
- 预测曲线与实际曲线合并数据
- 准确度评估详情
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from pymongo.database import Database

logger = logging.getLogger(__name__)


class PriceForecastService:
    """
    价格预测服务层

    职责：
    - 封装预测结果查询逻辑
    - 合并预测与实际数据
    - 提供准确度评估查询

    依赖：
    - db: MongoDB 数据库实例
    """

    def __init__(self, db: Database) -> None:
        """初始化服务"""
        self.db = db
        self.forecast_results = db['price_forecast_results']
        self.spot_price = db['day_ahead_spot_price']
        self.pre_sched_spot_price = db['day_ahead_pre_sched_spot_price']
        self.accuracy_daily = db['forecast_accuracy_daily']
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        """确保数据库索引存在"""
        try:
            # 预测结果集合索引
            forecast_indexes = [
                ([('target_date', 1), ('forecast_type', 1)], {'name': 'idx_target_date_type'}),
                ([('forecast_id', 1), ('target_date', 1)], {'name': 'idx_forecast_id_target'}),
            ]
            existing = {idx.get('name') for idx in self.forecast_results.list_indexes()}
            for keys, options in forecast_indexes:
                if options['name'] not in existing:
                    self.forecast_results.create_index(keys, **options)
                    logger.info(f"创建索引: {options['name']}")

            # 准确度集合索引
            accuracy_indexes = [
                ([('forecast_id', 1)], {'name': 'idx_forecast_id'}),
            ]
            existing = {idx.get('name') for idx in self.accuracy_daily.list_indexes()}
            for keys, options in accuracy_indexes:
                if options['name'] not in existing:
                    self.accuracy_daily.create_index(keys, **options)
                    logger.info(f"创建索引: {options['name']}")

        except Exception as e:
            logger.warning(f"创建索引时出错: {str(e)}")

    def get_versions(
        self,
        target_date: str,
        forecast_type: str = "d1_price"
    ) -> List[Dict[str, Any]]:
        """
        获取指定日期的预测版本列表

        Args:
            target_date: 目标日期 YYYY-MM-DD
            forecast_type: 预测类型，默认 d1_price

        Returns:
            预测版本列表，按 created_at 降序排列
            [{forecast_id, forecast_type, model_version, model_type, created_at}]
        """
        try:
            # 将日期字符串转换为 datetime
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")

            # 聚合查询：按 forecast_id 分组，获取唯一版本
            pipeline = [
                {
                    "$match": {
                        "target_date": target_dt,
                        "forecast_type": forecast_type
                    }
                },
                {
                    "$group": {
                        "_id": "$forecast_id",
                        "forecast_type": {"$first": "$forecast_type"},
                        "model_version": {"$first": "$model_version"},
                        "model_type": {"$first": "$model_type"},
                        "created_at": {"$first": "$created_at"}
                    }
                },
                {
                    "$sort": {"created_at": -1}
                },
                {
                    "$project": {
                        "_id": 0,
                        "forecast_id": "$_id",
                        "forecast_type": 1,
                        "model_version": 1,
                        "model_type": 1,
                        "created_at": 1
                    }
                }
            ]

            result = list(self.forecast_results.aggregate(pipeline))
            logger.info(f"获取 {target_date} 类型 {forecast_type} 的预测版本: {len(result)} 个")

            # 格式化 created_at 为 ISO 字符串
            for item in result:
                if item.get("created_at"):
                    item["created_at"] = item["created_at"].isoformat()

            return result

        except Exception as e:
            logger.error(f"获取预测版本列表失败: {e}", exc_info=True)
            raise ValueError(f"获取预测版本列表失败: {str(e)}")

    def get_chart_data(
        self,
        forecast_id: str,
        target_date: str
    ) -> List[Dict[str, Any]]:
        """
        获取图表数据（预测曲线 + 实际曲线）

        Args:
            forecast_id: 预测批次ID
            target_date: 目标日期 YYYY-MM-DD

        Returns:
            96个时间点的合并数据列表
            [{time, predicted_price, actual_price, confidence_80_lower, confidence_80_upper}]
        """
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
            next_day = target_dt + timedelta(days=1)

            # 1. 获取预测数据
            forecast_docs: List[Dict[str, Any]] = []
            if forecast_id:
                forecast_docs = list(self.forecast_results.find(
                    {
                        "forecast_id": forecast_id,
                        "target_date": target_dt
                    },
                    {
                        "_id": 0,
                        "datetime": 1,
                        "predicted_price": 1,
                        "confidence_80_lower": 1,
                        "confidence_80_upper": 1,
                        "confidence_90_lower": 1,
                        "confidence_90_upper": 1
                    }
                ).sort("datetime", 1))

            logger.info(f"获取预测数据: {len(forecast_docs)} 条")
            
            # 调试：输出前几条预测数据
            if forecast_docs:
                sample = forecast_docs[0]
                logger.info(f"预测数据样本: datetime={sample.get('datetime')}, predicted_price={sample.get('predicted_price')}")

            # 2. 获取日前实际价格数据
            actual_docs = list(self.spot_price.find(
                {"date_str": target_date},
                {"_id": 0, "time_str": 1, "avg_clearing_price": 1}
            ).sort("time_str", 1))

            logger.info(f"获取实际价格数据: {len(actual_docs)} 条")
            
            # 调试：输出前几条实际数据
            if actual_docs:
                sample = actual_docs[0]
                logger.info(f"实际价格数据样本: time_str={sample.get('time_str')}, avg_clearing_price={sample.get('avg_clearing_price')}")

            pre_sched_docs = list(self.pre_sched_spot_price.find(
                {"date_str": target_date},
                {"_id": 0, "time_str": 1, "avg_clearing_price": 1}
            ).sort("time_str", 1))
            logger.info(f"获取预计划日前价格数据: {len(pre_sched_docs)} 条")

            # 3. 构建价格映射表
            actual_map = {}
            for doc in actual_docs:
                time_str = doc.get("time_str", "")
                actual_map[time_str] = doc.get("avg_clearing_price")

            pre_sched_map = {}
            for doc in pre_sched_docs:
                time_str = doc.get("time_str", "")
                pre_sched_map[time_str] = doc.get("avg_clearing_price")

            # 调试：输出映射表的键
            if actual_map:
                sample_keys = list(actual_map.keys())[:5]
                logger.info(f"实际价格映射表样本键: {sample_keys}")

            forecast_map = {}
            for doc in forecast_docs:
                dt: Optional[datetime] = doc.get("datetime")
                if not dt:
                    continue
                if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date():
                    time_label = "24:00"
                else:
                    time_label = dt.strftime("%H:%M")
                forecast_map[time_label] = {
                    "predicted_price": doc.get("predicted_price"),
                    "confidence_80_lower": doc.get("confidence_80_lower"),
                    "confidence_80_upper": doc.get("confidence_80_upper"),
                    "confidence_90_lower": doc.get("confidence_90_lower"),
                    "confidence_90_upper": doc.get("confidence_90_upper"),
                }

            # 4. 合并数据，时间轴取预测/日前/预计划的并集
            all_time_labels = set(actual_map.keys()) | set(pre_sched_map.keys()) | set(forecast_map.keys())

            def sort_key(time_label: str) -> int:
                if time_label == "24:00":
                    return 24 * 60
                hour_str, minute_str = time_label.split(":")
                return int(hour_str) * 60 + int(minute_str)

            result = []
            for time_label in sorted(all_time_labels, key=sort_key):
                forecast_point = forecast_map.get(time_label, {})
                result.append({
                    "time": time_label,
                    "predicted_price": forecast_point.get("predicted_price"),
                    "actual_price": actual_map.get(time_label),
                    "pre_schedule_price": pre_sched_map.get(time_label),
                    "confidence_80_lower": forecast_point.get("confidence_80_lower"),
                    "confidence_80_upper": forecast_point.get("confidence_80_upper"),
                    "confidence_90_lower": forecast_point.get("confidence_90_lower"),
                    "confidence_90_upper": forecast_point.get("confidence_90_upper")
                })
            
            # 调试：输出合并后的前几条数据
            if result:
                sample = result[0]
                logger.info(f"合并数据样本: time={sample['time']}, predicted={sample['predicted_price']}, actual={sample['actual_price']}")

            return result

        except Exception as e:
            logger.error(f"获取图表数据失败: {e}", exc_info=True)
            raise ValueError(f"获取图表数据失败: {str(e)}")

    def get_accuracy(
        self,
        forecast_id: str,
        target_date: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        获取准确度评估数据

        Args:
            forecast_id: 预测批次ID
            target_date: 目标日期 YYYY-MM-DD (可选)

        Returns:
            准确度评估文档，如果不存在则返回 None
        """
        try:
            query = {"forecast_id": forecast_id}
            if target_date:
                target_dt = datetime.strptime(target_date, "%Y-%m-%d")
                query["target_date"] = target_dt

            doc = self.accuracy_daily.find_one(
                query,
                {"_id": 0}
            )

            if doc:
                # 格式化日期字段
                for field in ["target_date", "forecast_date", "calculated_at"]:
                    if doc.get(field) and isinstance(doc[field], datetime):
                        doc[field] = doc[field].isoformat()

                logger.info(f"获取预测 {forecast_id} 的准确度评估数据")
            else:
                logger.info(f"预测 {forecast_id} 暂无准确度评估数据")

            return doc

        except Exception as e:
            logger.error(f"获取准确度评估数据失败: {e}", exc_info=True)
            raise ValueError(f"获取准确度评估数据失败: {str(e)}")

    def get_accuracy_history(
        self,
        start_date: str,
        end_date: str,
        forecast_type: str = "d1_price"
    ) -> List[Dict[str, Any]]:
        """
        获取历史准确率曲线数据。

        规则：
        - 按 target_date 聚合
        - 同一天若存在多个版本，取 calculated_at 最新的一条
        """
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            end_exclusive = end_dt + timedelta(days=1)

            pipeline = [
                {
                    "$match": {
                        "forecast_type": forecast_type,
                        "target_date": {"$gte": start_dt, "$lt": end_exclusive},
                        "wmape_accuracy": {"$ne": None},
                    }
                },
                {
                    "$sort": {
                        "target_date": 1,
                        "calculated_at": -1,
                    }
                },
                {
                    "$group": {
                        "_id": "$target_date",
                        "target_date": {"$first": "$target_date"},
                        "forecast_id": {"$first": "$forecast_id"},
                        "wmape_accuracy": {"$first": "$wmape_accuracy"},
                        "mae": {"$first": "$mae"},
                        "rmse": {"$first": "$rmse"},
                        "direction_accuracy": {"$first": "$direction_accuracy"},
                        "rate_90_pass": {"$first": "$rate_90_pass"},
                        "rate_85_pass": {"$first": "$rate_85_pass"},
                        "calculated_at": {"$first": "$calculated_at"},
                    }
                },
                {"$sort": {"target_date": 1}},
                {
                    "$project": {
                        "_id": 0,
                        "target_date": 1,
                        "forecast_id": 1,
                        "wmape_accuracy": 1,
                        "mae": 1,
                        "rmse": 1,
                        "direction_accuracy": 1,
                        "rate_90_pass": 1,
                        "rate_85_pass": 1,
                        "calculated_at": 1,
                    }
                }
            ]

            result = list(self.accuracy_daily.aggregate(pipeline))
            for doc in result:
                for field in ["target_date", "calculated_at"]:
                    if doc.get(field) and isinstance(doc[field], datetime):
                        doc[field] = doc[field].isoformat()

            logger.info(f"获取历史准确率曲线成功: {start_date} ~ {end_date}, 共 {len(result)} 条")
            return result

        except Exception as e:
            logger.error(f"获取历史准确率曲线失败: {e}", exc_info=True)
            raise ValueError(f"获取历史准确率曲线失败: {str(e)}")

    def get_max_available_date(self) -> str:
        """获取页面可选择的最大日期。"""
        try:
            candidates: List[datetime] = []

            latest_forecast = self.forecast_results.find_one(
                {},
                {"_id": 0, "target_date": 1},
                sort=[("target_date", -1)]
            )
            if latest_forecast and isinstance(latest_forecast.get("target_date"), datetime):
                candidates.append(latest_forecast["target_date"])

            latest_day_ahead = self.spot_price.find_one(
                {},
                {"_id": 0, "date_str": 1},
                sort=[("date_str", -1)]
            )
            if latest_day_ahead and latest_day_ahead.get("date_str"):
                candidates.append(datetime.strptime(latest_day_ahead["date_str"], "%Y-%m-%d"))

            latest_pre_sched = self.pre_sched_spot_price.find_one(
                {},
                {"_id": 0, "date_str": 1},
                sort=[("date_str", -1)]
            )
            if latest_pre_sched and latest_pre_sched.get("date_str"):
                candidates.append(datetime.strptime(latest_pre_sched["date_str"], "%Y-%m-%d"))

            max_date = max(candidates) if candidates else datetime.now() + timedelta(days=1)
            return max_date.strftime("%Y-%m-%d")
        except Exception as e:
            logger.error(f"获取最大可用日期失败: {e}", exc_info=True)
            raise ValueError(f"获取最大可用日期失败: {str(e)}")
