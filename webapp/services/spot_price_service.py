"""
现货价格数据服务 - 通用模块

提供日前和实时现货价格数据的统一获取接口，支持多种时间粒度输出。
"""
import logging
from typing import List, Dict, Tuple, Literal, Optional, Union
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from pymongo.database import Database

logger = logging.getLogger(__name__)


@dataclass
class SpotDataPoint:
    """现货数据点"""
    period: int  # 时段序号
    time_str: str  # 时间字符串 HH:MM
    price: Optional[float] = None  # 价格 (元/MWh)
    volume: Optional[float] = None  # 电量 (MWh)


@dataclass
class SpotCurveData:
    """现货曲线数据"""
    date: str  # 日期 YYYY-MM-DD
    data_type: str  # 数据类型: "day_ahead" 或 "real_time"
    resolution: int  # 时间分辨率: 24, 48, 96
    points: List[SpotDataPoint] = field(default_factory=list)


# 时间分辨率类型
Resolution = Literal[24, 48, 96]


def get_spot_prices(
    db: Database,
    date_str: str,
    data_type: Literal["day_ahead", "real_time", "day_ahead_econ"] = "day_ahead",
    resolution: Resolution = 48,
    include_volume: bool = True
) -> SpotCurveData:
    """
    获取现货价格曲线数据
    
    Args:
        db: MongoDB数据库实例
        date_str: 日期字符串 YYYY-MM-DD
        data_type: 数据类型，"day_ahead" 日前 或 "real_time" 实时
        resolution: 输出时间分辨率，24点/48点/96点
        include_volume: 是否包含电量数据
    
    Returns:
        SpotCurveData: 包含曲线数据点的结构
    """
    # 数据集与字段映射
    mapping = {
        "day_ahead": ("day_ahead_spot_price", "avg_clearing_price"),
        "real_time": ("real_time_spot_price", "arithmetic_avg_clearing_price"),
        "day_ahead_econ": ("day_ahead_econ_price", "clearing_price")
    }
    collection_name, price_field = mapping.get(data_type, mapping["day_ahead"])
    collection = db[collection_name]
    
    # 查询字段
    projection = {"_id": 0, "time_str": 1, price_field: 1}
    if include_volume:
        projection["total_clearing_power"] = 1
    
    # 查询数据
    cursor = collection.find(
        {"date_str": date_str},
        projection
    ).sort("time_str", 1)
    
    raw_docs = list(cursor)
    
    if not raw_docs:
        logger.warning(f"未找到日期 {date_str} 的 {data_type} 现货数据")
        return SpotCurveData(
            date=date_str,
            data_type=data_type,
            resolution=resolution,
            points=[]
        )
    
    logger.info(f"获取 {date_str} {data_type} 现货数据: {len(raw_docs)} 条原始记录")
    
    # 按时间分辨率聚合
    if resolution == 96:
        # 96点: 15分钟间隔，直接使用原始数据
        points = _to_96_points(raw_docs, include_volume, price_field)
    elif resolution == 48:
        # 48点: 30分钟间隔，每2个15分钟聚合为1个
        points = _to_48_points(raw_docs, include_volume, price_field)
    elif resolution == 24:
        # 24点: 60分钟间隔，每4个15分钟聚合为1个
        points = _to_24_points(raw_docs, include_volume, price_field)
    else:
        raise ValueError(f"不支持的时间分辨率: {resolution}")
    
    return SpotCurveData(
        date=date_str,
        data_type=data_type,
        resolution=resolution,
        points=points
    )


def _to_96_points(docs: List[dict], include_volume: bool, price_field: str = "avg_clearing_price") -> List[SpotDataPoint]:
    """转换为96点数据（15分钟间隔）"""
    points = []
    for i, doc in enumerate(docs):
        time_str = doc.get("time_str", "")
        price = doc.get(price_field)
        volume = doc.get("total_clearing_power") if include_volume else None
        
        points.append(SpotDataPoint(
            period=i + 1,
            time_str=time_str,
            price=round(price, 2) if price is not None else None,
            volume=round(volume, 2) if volume is not None else None
        ))
    
    return points


def _to_48_points(docs: List[dict], include_volume: bool, price_field: str = "avg_clearing_price") -> List[SpotDataPoint]:
    """转换为48点数据（30分钟间隔）"""
    if len(docs) == 96:
        points = []
        for idx in range(48):
            pair = docs[idx * 2: idx * 2 + 2]
            prices = [doc.get(price_field) for doc in pair if doc.get(price_field) is not None]
            volumes = [doc.get("total_clearing_power") for doc in pair if doc.get("total_clearing_power") is not None]
            total_minutes = (idx + 1) * 30
            hour = total_minutes // 60
            minute = total_minutes % 60
            time_str = f"{hour:02d}:{minute:02d}"
            points.append(SpotDataPoint(
                period=idx + 1,
                time_str=time_str,
                price=round(sum(prices) / len(prices), 2) if prices else None,
                volume=round(sum(volumes), 2) if include_volume and volumes else None,
            ))
        return points

    # 按30分钟时段分组
    period_data: Dict[int, Dict[str, List[float]]] = {}
    
    for doc in docs:
        time_str = doc.get("time_str", "")
        price = doc.get(price_field)
        volume = doc.get("total_clearing_power")
        
        parts = time_str.split(":")
        if len(parts) >= 2:
            hour = int(parts[0])
            minute = int(parts[1])
            
            # 计算属于哪个30分钟时段 (1-48)
            # 00:00-00:29 -> 时段1, 00:30-00:59 -> 时段2, ...
            period = hour * 2 + (1 if minute < 30 else 2)
            
            if period not in period_data:
                period_data[period] = {"prices": [], "volumes": []}
            
            if price is not None:
                period_data[period]["prices"].append(price)
            if volume is not None:
                period_data[period]["volumes"].append(volume)
    
    # 计算每个时段的平均值
    points = []
    for period in range(1, 49):
        if period in period_data and period_data[period]["prices"]:
            data = period_data[period]
            avg_price = sum(data["prices"]) / len(data["prices"])
            sum_volume = sum(data["volumes"]) if data["volumes"] else None
            
            # 计算时间字符串（时段结束时间）
            # period 1 -> 00:30, period 48 -> 24:00
            total_minutes = period * 30
            hour = total_minutes // 60
            minute = total_minutes % 60
            time_str = f"{hour:02d}:{minute:02d}"
            
            points.append(SpotDataPoint(
                period=period,
                time_str=time_str,
                price=round(avg_price, 2),
                volume=round(sum_volume, 2) if sum_volume is not None else None
            ))
    
    return points


def _to_24_points(docs: List[dict], include_volume: bool, price_field: str = "avg_clearing_price") -> List[SpotDataPoint]:
    """转换为24点数据（60分钟间隔）"""
    if len(docs) == 96:
        points = []
        for idx in range(24):
            bucket = docs[idx * 4: idx * 4 + 4]
            prices = [doc.get(price_field) for doc in bucket if doc.get(price_field) is not None]
            volumes = [doc.get("total_clearing_power") for doc in bucket if doc.get("total_clearing_power") is not None]
            hour = idx + 1
            time_str = f"{hour:02d}:00"
            points.append(SpotDataPoint(
                period=idx + 1,
                time_str=time_str,
                price=round(sum(prices) / len(prices), 2) if prices else None,
                volume=round(sum(volumes), 2) if include_volume and volumes else None,
            ))
        return points

    # 按小时分组
    period_data: Dict[int, Dict[str, List[float]]] = {}
    
    for doc in docs:
        time_str = doc.get("time_str", "")
        price = doc.get(price_field)
        volume = doc.get("total_clearing_power")
        
        parts = time_str.split(":")
        if len(parts) >= 2:
            hour = int(parts[0])
            
            # 计算属于哪个小时时段 (1-24)
            # 特殊处理: 24:00 属于第24个时段
            if hour == 24 or (hour == 0 and time_str == "24:00"):
                period = 24
            else:
                period = hour + 1
            
            if period not in period_data:
                period_data[period] = {"prices": [], "volumes": []}
            
            if price is not None:
                period_data[period]["prices"].append(price)
            if volume is not None:
                period_data[period]["volumes"].append(volume)
    
    # 计算每个时段的平均值
    points = []
    for period in range(1, 25):
        if period in period_data and period_data[period]["prices"]:
            data = period_data[period]
            avg_price = sum(data["prices"]) / len(data["prices"])
            sum_volume = sum(data["volumes"]) if data["volumes"] else None
            
            # 时间字符串为该小时的结束时间
            # period 1 -> 01:00, period 24 -> 24:00
            hour = period
            time_str = f"{hour:02d}:00"
            
            points.append(SpotDataPoint(
                period=period,
                time_str=time_str,
                price=round(avg_price, 2),
                volume=round(sum_volume, 2) if sum_volume is not None else None
            ))
    
    return points


def get_spot_prices_dict(
    db: Database,
    date_str: str,
    data_type: Literal["day_ahead", "real_time", "day_ahead_econ"] = "day_ahead",
    resolution: Resolution = 48,
    include_volume: bool = True
) -> List[dict]:
    """
    获取现货价格曲线数据（字典格式，便于JSON序列化）
    
    返回格式: [{"period": 1, "time_str": "00:00", "price": 350.5, "volume": 1000}, ...]
    """
    curve_data = get_spot_prices(db, date_str, data_type, resolution, include_volume)
    
    return [
        {
            "period": p.period,
            "time_str": p.time_str,
            "price": p.price,
            "volume": p.volume
        }
        for p in curve_data.points
    ]

def get_monthly_avg_spot_prices_48(
    db: Database,
    month_str: str,
    end_date_str: str,
    data_type: Literal["day_ahead", "real_time", "day_ahead_econ"] = "day_ahead"
) -> List[float]:
    """
    获取月初至指定结算日期的 48 点现货平均价格向量 (元/kWh)
    
    Args:
        db: MongoDB数据库实例
        month_str: 月份 YYYY-MM
        end_date_str: 截止日期 YYYY-MM-DD
        data_type: "day_ahead" 或 "real_time"
        
    Returns:
        List[float]: 48维价格向量
    """
    # 数据集与字段映射
    mapping = {
        "day_ahead": ("day_ahead_spot_price", "avg_clearing_price"),
        "real_time": ("real_time_spot_price", "arithmetic_avg_clearing_price"),
        "day_ahead_econ": ("day_ahead_econ_price", "clearing_price")
    }
    collection_name, price_field = mapping.get(data_type, mapping["day_ahead"])
    
    # 执行 MongoDB 聚合：计算本月每个时段的累积均值
    # 逻辑: 15分钟点对点分组 -> 聚合为30分钟点
    pipeline = [
        {
            "$match": {
                "date_str": {"$regex": f"^{month_str}"},
                "date_str": {"$lte": end_date_str}
            }
        },
        {
            "$addFields": {
                "hour": {"$toInt": {"$substr": ["$time_str", 0, 2]}},
                "minute": {"$toInt": {"$substr": ["$time_str", 3, 2]}}
            }
        },
        {
            "$addFields": {
                # 计算分钟偏移，00:15->15, 00:30->30...
                # 聚合为 30 分时段: (min-1)//30
                # 特殊处理 00:00 情况（若有）
                "total_min": {"$add": [{"$multiply": ["$hour", 60]}, "$minute"]}
            }
        },
        {
            "$group": {
                "_id": {"$floor": {"$divide": [{"$subtract": ["$total_min", 1]}, 30]}},
                "avg_price_mwh": {"$avg": f"${price_field}"}
            }
        },
        {
            "$sort": {"_id": 1}
        }
    ]
    
    try:
        results = list(db[collection_name].aggregate(pipeline))
        
        # 补齐 48 点
        price_vec = [0.0] * 48
        for r in results:
            idx = int(r["_id"])
            if 0 <= idx < 48:
                # 元/MWh -> 元/kWh
                price_vec[idx] = round(float(r["avg_price_mwh"]) / 1000.0, 6)
        
        # 日志记录 (若点数不足，可能是数据缺失)
        if len(results) < 48:
            logger.warning(f"MTD 聚合结果点数不足: {month_str} 至 {end_date_str} ({data_type}), 仅得到 {len(results)} 个时段")
            
        return price_vec
        
    except Exception as e:
        logger.error(f"聚合 MTD 现货价格失败: {e}")
        return [0.0] * 48

def resample_to_48(values: List[float], method: Literal["mean", "sum"] = "mean") -> List[float]:
    """重采样工具：将 96 点、48 点或 24 点数据对齐为稳定的 48 点向量"""
    n = len(values)
    if n == 48:
        return values
    elif n == 96:
        # 96 -> 48 (每2点取均值/和)
        res = []
        for i in range(48):
            v1, v2 = values[2 * i], values[2 * i + 1]
            res.append((v1 + v2) / 2 if method == "mean" else (v1 + v2))
        return res
    elif n == 24:
        # 24 -> 48 (每个点拆分为2点)
        res = []
        for v in values:
            res.extend([v, v] if method == "mean" else [v / 2, v / 2])
        return res
    else:
        # 异常长度补足或截断
        if n > 48:
            return values[:48]
        return values + [0.0] * (48 - n)


def get_spot_price_curve_48(
    db: Database,
    date_str: str,
    collection_name: str,
    price_field: str = "avg_clearing_price"
) -> List[float]:
    """
    通用单日现货曲线获取接口 (Robust)
    支持 datetime 范围查询与 date_str 字段兼容，并自动重采样为 48 点。
    
    Args:
        db: MongoDB数据库实例
        date_str: 日期 YYYY-MM-DD
        collection_name: 标的集合名
        price_field: 价格字段名
    """
    # 1. 构造时间范围查询 (Robust)
    try:
        start_dt = datetime.strptime(date_str, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=1)
    except Exception:
        return [0.0] * 48

    # 优先尝试 datetime 索引索引
    cursor = db[collection_name].find({
        "datetime": {"$gt": start_dt, "$lte": end_dt}
    }).sort("datetime", 1)
    
    docs = list(cursor)
    
    # 2. 兜底尝试 date_str 索引
    if not docs:
        cursor = db[collection_name].find({"date_str": date_str}).sort("time_str", 1)
        docs = list(cursor)
        
    if not docs:
        logger.warning(f"集合 {collection_name} 中未找到日期 {date_str} 的现货数据")
        return [0.0] * 48

    # 3. 提取价格值
    values = []
    for d in docs:
        val = d.get(price_field)
        # 兼容性处理: 如果 price_field 为空，尝试 clearing_price (针对日前Econ) 或 arithmetic_... (针对实时)
        if val is None:
            for fallback_field in ("clearing_price", "arithmetic_avg_clearing_price", "avg_clearing_price"):
                val = d.get(fallback_field)
                if val is not None:
                    break
        values.append(float(val or 0.0))

    # 4. 统一重采样
    return resample_to_48(values, method="mean")
