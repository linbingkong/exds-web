# EXDS-RPA 数据集结构文档

本文档详细描述了 EXDS-RPA 项目中涉及的所有核心数据集（MongoDB 集合）的结构、字段含义及索引配置。


## 1. `weekly_forecast` - 周预测数据

该集合统一存储所有类型的周预测数据，通过 `info_name` 字段区分。

- **数据来源**: `rpa.pipelines.weekly_forecast`
- **更新频率**: 每周

### 1.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `info_name` | String | **[复合主键]** 信息名称，用于区分数据类型。可能的值包括: "系统负荷预测", "统调风电", "统调水电(含抽蓄)", "统调光伏", "省间联络线容量"。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `value` | Number | 预测值，精度4位小数。 |

### 1.2. 索引

- `(datetime: 1, info_name: 1)`: 唯一复合索引，确保每个时间点每种信息的数据唯一。
- `(date_str: 1)`: 普通索引，用于按日期查询。

## 2. `daily_release` - 每日预测数据（短期预测）

该集合存储每日发布的日前预测数据，如系统负荷、新能源出力等。

- **数据来源**: `rpa.pipelines.daily_release`
- **更新频率**: 每日

### 2.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `system_load_forecast` | Number | 短期系统负荷预测值 (MW)。 |
| `pv_forecast` | Number | 短期光伏总加预测值 (MW)。 |
| `wind_forecast` | Number | 短期风电总加预测值 (MW)。 |
| `tieline_plan` | Number | 联络线总计划值 (MW)。 |
| `nonmarket_unit_forecast` | Number | 非市场化机组出力预测值 (MW)。 |

### 2.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一性。

---


## 3. `real_time_generation` - 实时发电出力

该集合存储各类机组的实时发电出力和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 3.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `total_generation` | Number | 全网总出力 (MW)，精度4位小数。 |
| `total_generation_energy` | Number | 全网总出力电量 (MWh)，精度4位小数。 |
| `thermal_generation` / `_energy` | Number | 火电出力/电量，精度4位小数。 |
| `hydro_generation` / `_energy` | Number | 水电出力/电量，精度4位小数。 |
| `pumped_storage_generation` / `_energy` | Number | 抽蓄出力/电量，精度4位小数。 |
| `wind_generation` / `_energy` | Number | 风电出力/电量，精度4位小数。 |
| `solar_generation` / `_energy` | Number | 光电出力/电量，精度4位小数。 |
| `battery_storage_generation` / `_energy` | Number | 储能出力/电量，精度4位小数。 |
| `non_market_total_generation` | Number | 非市场化机组总出力 (MW)，精度4位小数。 |
| `renewable_total_generation` | Number | 新能源总出力 (MW)，精度4位小数。 |
| `hydro_with_pumped_total_generation` | Number | 水电（含抽蓄）总出力 (MW)，精度4位小数。 |

### 3.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---
---

## 4. `actual_operation` - 实际运行数据

该集合存储电网的实际运行数据，包括系统负荷、联络线潮流、正负备用等关键运行指标。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 4.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `positive_reserve` | Number | 正负荷备用 (MW)，精度4位小数。 |
| `negative_reserve` | Number | 负负荷备用 (MW)，精度4位小数。 |
| `system_load` | Number | 系统负荷 (MW)，精度4位小数。 |
| `tieline_flow` | Number | 联络线通道潮流 (MW)，精度4位小数。 |


### 4.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

### 4.3. 数据说明

- **数据粒度**: 15分钟，每天96个数据点。
- **数据范围**: 下载到前一天（T-1），与实时现货价格、实时发电出力保持一致。
- **业务意义**:
  - `positive_reserve` 和 `negative_reserve`: 系统正负备用容量，用于应对负荷波动和紧急情况。
  - `system_load`: 电网实际系统负荷，反映全网用电需求。
  - `tieline_flow`: 省间联络线的实际潮流值。


---



## 5. `real_time_spot_price` - 实时现货价格

该集合存储实时的现货市场出清价格和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 5.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `id_num` | Number | 原始序号字段。 |
| `total_clearing_power` | Number | 出清总电量 (MWh)，精度4位小数。 |
| `thermal_clearing_power` | Number | 火电出清电量 (MWh)，精度4位小数。 |
| `thermal_units` | Number | 火电台数，整数。 |
| `hydro_clearing_power` | Number | 水电出清电量 (MWh)，精度4位小数。 |
| `hydro_units` | Number | 水电台数，整数。 |
| `wind_clearing_power` | Number | 风电出清电量 (MWh)，精度4位小数。 |
| `wind_units` | Number | 风电台数，整数。 |
| `solar_clearing_power` | Number | 光伏出清电量 (MWh)，精度4位小数。 |
| `solar_units` | Number | 光伏台数，整数。 |
| `pumped_storage_clearing_power` | Number | 抽蓄出清电量 (MWh)，精度4位小数。 |
| `pumped_storage_units` | Number | 抽蓄台数，整数。 |
| `battery_storage_clearing_power` | Number | 储能出清电量 (MWh)，精度4位小数。 |
| `battery_storage_units` | Number | 储能台数，整数。 |
| `avg_clearing_price` | Number | 出清均价 (元/MWh)，精度3位小数。 |
| `arithmetic_avg_clearing_price` | Number | 算术平均出清价 (元/MWh)，仅在原始数据被识别为高频数据并聚合时出现，精度3位小数。 |
| `avg_bid_price` | Number | 申报均价 (元/MWh)，精度3位小数。 |

### 5.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---

## 6. `day_ahead_spot_price` - 日前现货价格

该集合存储日前的现货市场出清价格和电量信息，其结构与 `real_time_spot_price` 完全相同。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日
- **字段说明**: 同 `real_time_spot_price`。
- **索引**: 同 `real_time_spot_price`。

---

## 7. `day_ahead_econ_spot_price` - 全市场经济出清日前现货价格

该集合存储“全市场发布口径”的经济出清日前现货价格和电量信息，页面来源为“日前出清结果 > 经济出清日前现货出清信息”。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日
- **字段说明**: 同 `real_time_spot_price`。
- **索引**: 同 `real_time_spot_price`。

---

## 8. `day_ahead_pre_sched_spot_price` - 预计划日前现货价格

该集合存储“事前信息 > 预计划日前现货出清信息”页面发布的预计划日前现货价格和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日
- **字段说明**: 同 `real_time_spot_price`。
- **索引**: 同 `real_time_spot_price`。


---

## 9. `fuel_futures_data` - 燃料期货数据

该集合存储燃料期货（动力煤、焦煤、原油）的日频价格数据，用于辅助电力成本预测。

- **数据来源**: `pipelines/download_fuel_futures.py`
- **更新频率**: 每日
- **数据粒度**: 日频

### 9.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `date` | ISODate | **[主键]** 数据对应的日期（00:00:00）。 |
| `thermal_coal` | Object | 动力煤 (ZC0) 数据对象。 |
| `thermal_coal.close` | Number | 收盘价。 |
| `thermal_coal.open` | Number | 开盘价。 |
| `thermal_coal.high` | Number | 最高价。 |
| `thermal_coal.low` | Number | 最低价。 |
| `thermal_coal.volume` | Number | 成交量。 |
| `thermal_coal.open_interest` | Number | 持仓量。 |
| `thermal_coal.is_valid` | Boolean | 数据有效性标志 (基于持仓量判定)。 |
| `coking_coal` | Object | 焦煤 (JM0) 数据对象，结构同上。 |
| `crude_oil` | Object | 原油 (SC0) 数据对象，结构同上。 |
| `created_at` | ISODate | 记录创建时间。 |
| `updated_at` | ISODate | 记录更新时间。 |

### 9.2. 索引

- `(date: 1)`: 唯一索引，确保每天只有一条记录。


## 10. `price_forecast_results` - 价格预测结果

该集合存储日前价格预测模型的输出结果，支持 D-1 和 D-2 两种预测模式。

**业务价值**:
- 为交易决策提供日前价格预测
- 支持历史预测结果回溯和性能评估
- 区分不同预测视野（D-1 近期 vs D-2 远期）

- **数据来源**: 模型预测输出
- **更新频率**: 每个工作日
- **数据粒度**: 15分钟，每个目标日96个数据点
- **预测范围**: 
  - D-1 预测：D 日（次日1天）
  - D-2 预测：D ~ D+9 日（10个目标日，共960个预测点）

### 10.1 字段说明

| 字段名 | 数据类型 | 描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `forecast_id` | String | **[复合主键]** 预测批次唯一标识 | "20250117_0920" |
| `forecast_type` | String | **[复合主键]** 预测类型：`d1_price` 或 `d2_price` | "d1_price" |
| `forecast_date` | ISODate | **[复合主键]** 预测执行日期 | 2025-01-17 00:00 |
| `target_date` | ISODate | **[复合主键]** 目标日期 | 2025-01-18 00:00 |
| `datetime` | ISODate | **[复合主键]** 具体时间点（业务日96点） | 2025-01-18 00:15 |
| `predicted_price` | Number | 预测价格 (元/MWh)，精度2位小数 | 350.25 |
| `confidence_80_lower` | Number | 80%置信区间下界 (元/MWh) | 320.50 |
| `confidence_80_upper` | Number | 80%置信区间上界 (元/MWh) | 380.00 |
| `confidence_90_lower` | Number | 90%置信区间下界 (元/MWh) | 310.00 |
| `confidence_90_upper` | Number | 90%置信区间上界 (元/MWh) | 390.50 |
| `model_type` | String | 模型标识 | "d1_price_model" 或 "d2_near_term" |
| `model_version` | String | 模型版本 | "v1.0.3" |
| `created_at` | ISODate | 记录创建时间（UTC） | 2025-01-17 09:25 |

### 10.2 预测类型定义

| forecast_type | 说明 | 执行时间 | 预测范围 |
| :--- | :--- | :--- | :--- |
| `d1_price` | D-1 日前价格预测 | D-1 日 09:20 | D 日（次日） |
| `d2_price` | D-2 日前价格预测 | D-2 日 09:20 | D ~ D+9 日（10天） |

### 10.3 索引配置

```javascript
// 复合唯一索引（包含 forecast_type）
db.price_forecast_results.createIndex({
    "forecast_id": 1,
    "forecast_type": 1,
    "target_date": 1,
    "datetime": 1
}, { unique: true })

// 按类型和日期查询
db.price_forecast_results.createIndex({ "forecast_type": 1, "target_date": 1, "datetime": 1 })
db.price_forecast_results.createIndex({ "forecast_date": 1, "target_date": 1 })
```

### 10.4 数据示例

**D-1 预测**:
```json
{
    "forecast_id": "20250117_0920",
    "forecast_type": "d1_price",
    "forecast_date": ISODate("2025-01-17T00:00:00Z"),
    "target_date": ISODate("2025-01-18T00:00:00Z"),
    "datetime": ISODate("2025-01-18T00:15:00Z"),
    "predicted_price": 350.25,
    "confidence_80_lower": 320.50,
    "confidence_80_upper": 380.00,
    "confidence_90_lower": 310.00,
    "confidence_90_upper": 390.50,
    "model_type": "d1_price_model",
    "model_version": "v1.0.0",
    "created_at": ISODate("2025-01-17T09:25:30Z")
}
```

**D-2 预测**:
```json
{
    "forecast_id": "20250117_0920",
    "forecast_type": "d2_price",
    "forecast_date": ISODate("2025-01-17T00:00:00Z"),
    "target_date": ISODate("2025-01-19T00:00:00Z"),
    "datetime": ISODate("2025-01-19T00:15:00Z"),
    "predicted_price": 365.50,
    "confidence_80_lower": 330.00,
    "confidence_80_upper": 400.00,
    "confidence_90_lower": 315.00,
    "confidence_90_upper": 415.00,
    "model_type": "d2_near_term",
    "model_version": "v2.0.0",
    "created_at": ISODate("2025-01-17T09:25:30Z")
}
```

## 11. `forecast_accuracy_daily` - 预测准确度日报

该集合存储各类预测模型的**日级别准确度评估结果**，支持多种预测类型和客户维度。

**业务价值**:
- 持续监控各类预测模型性能
- 支持多客户负荷预测准确度追踪
- 识别模型退化趋势
- 分析影响准确度的因素（负价格、极端天气等）

- **数据来源**: 定时任务自动计算
- **更新频率**: 每日（T+1 回测）
- **数据粒度**: 日级别（每个预测类型+客户每天 1 条记录）

### 11.1 字段说明

| 字段名 | 数据类型 | 描述 | 用途 |
| :--- | :--- | :--- | :--- |
| `target_date` | ISODate | **[复合主键]** 预测目标日期 | 时间索引 |
| `forecast_type` | String | **[复合主键]** 预测类型（见下表） | 区分预测类型 |
| `forecast_id` | String | **[复合主键]** 预测批次唯一标识 | 支持多批次评估 |
| `customer_id` | String | **[复合主键]** 客户ID（负荷预测用，其他类型填 "system"） | 客户维度 |
| `forecast_date` | ISODate | 预测执行日期 | 追溯预测时间 |
| `model_type` | String | 模型标识（如 d1_price_model, d2_price_model） | 模型区分 |
| `model_version` | String | 模型版本号 | 版本追踪 |
| `wmape_accuracy` | Number | WMAPE 准确率 (0-100%) | **主评估指标** |
| `mape` | Number | MAPE (%) | 百分比误差 |
| `mae` | Number | 平均绝对误差 | 误差分析 |
| `rmse` | Number | 均方根误差 | 误差分析 |
| `r2` | Number | 决定系数 R² | 拟合度 |
| `direction_accuracy` | Number | 方向准确率 (0-100%) | 涨跌/增减判断 |
| `period_accuracy` | Object | 分时段准确率（从 tou_rules 动态获取） | 分时段分析 |
| `stats` | Object | 当日统计信息 | 数据特征 |
| ├─ `min_value` | Number | 最低值 | |
| ├─ `max_value` | Number | 最高值 | |
| ├─ `mean_value` | Number | 平均值 | |
| ├─ `sum_value` | Number | 总值（负荷预测用） | |
| └─ `has_negative` | Boolean | 是否含负值 | 异常标识 |
| `rate_90_pass` | Boolean | 是否达 90% 准确率 | 达标标识 |
| `rate_85_pass` | Boolean | 是否达 85% 准确率 | 达标标识 |
| `calculated_at` | ISODate | 计算时间 | 数据管理 |
| `notes` | String | 备注（可选） | 特殊说明 |

### 11.2 预测类型定义

| forecast_type | 说明 | 单位 | 数据粒度 |
| :--- | :--- | :--- | :--- |
| `d1_price` | D-1 日前价格预测 | CNY/MWh | 96点/天 |
| `d2_price` | D-2 日前价格预测 | CNY/MWh | 96点/天 |
| `d2_shadow_wind` | D-2 风电影子预测 | MW | 96点/天 |
| `d2_shadow_pv` | D-2 光伏影子预测 | MW | 96点/天 |
| `d2_shadow_tieline` | D-2 联络线影子预测 | MW | 96点/天 |
| `d2_shadow_nonmarket` | D-2 非市场化机组影子预测 | MW | 96点/天 |
| `load_forecast` | 负荷预测（客户级） | MWh | 48点/天 |

### 11.3 索引配置

```javascript
// 复合唯一索引（包含 forecast_id，支持多批次准确度评估）
db.forecast_accuracy_daily.createIndex({ 
    "target_date": 1, 
    "forecast_type": 1,
    "forecast_id": 1,
    "customer_id": 1 
}, { unique: true })

// 按类型和日期查询
db.forecast_accuracy_daily.createIndex({ "forecast_type": 1, "target_date": -1 })

// 按 forecast_id 查询
db.forecast_accuracy_daily.createIndex({ "forecast_id": 1 })

// 按客户查询（负荷预测用）
db.forecast_accuracy_daily.createIndex({ "customer_id": 1, "target_date": -1 })
```

### 11.4 数据示例

**D-1 价格预测**:
```json
{
    "target_date": ISODate("2025-12-10T00:00:00Z"),
    "forecast_type": "d1_price",
    "forecast_id": "D1_20251209_092015",
    "customer_id": "system",
    "forecast_date": ISODate("2025-12-09T00:00:00Z"),
    "model_type": "d1_price_model",
    "model_version": "v1.0.0",
    "wmape_accuracy": 88.29,
    "mae": 50.5,
    "rmse": 68.2,
    "r2": 0.85,
    "direction_accuracy": 75.8,
    "period_accuracy": {
        "高峰": 86.5,
        "平段": 82.3,
        "低谷": 91.2
    },
    "stats": {
        "min_value": 120.5,
        "max_value": 580.0,
        "mean_value": 385.2,
        "has_negative": false
    },
    "rate_90_pass": false,
    "rate_85_pass": true,
    "calculated_at": ISODate("2025-12-11T09:25:00Z")
}
```

**负荷预测（某客户）**:
```json
{
    "target_date": ISODate("2025-12-10T00:00:00Z"),
    "forecast_type": "load_forecast",
    "customer_id": "customer_001",
    "forecast_date": ISODate("2025-12-08T00:00:00Z"),
    "model_type": "load_model",
    "model_version": "v2.1.0",
    "wmape_accuracy": 92.5,
    "mape": 7.5,
    "mae": 12.3,
    "stats": {
        "min_value": 50.0,
        "max_value": 250.0,
        "mean_value": 150.5,
        "sum_value": 7224.0
    },
    "rate_90_pass": true,
    "rate_85_pass": true,
    "calculated_at": ISODate("2025-12-11T09:30:00Z")
}
```

## 12. 天气数据 (双集合架构 v2.2)

天气数据采用**双集合架构**，彻底分离实况与预测数据，避免数据泄露。

**业务价值**:
- 影子模型（负荷、风电、光伏预测）的核心输入特征
- 支持 **D-1 ~ D+5** 的天气预测数据（每个发布日168条记录）
- 提供历史实况用于误差分析和模型训练

- **数据来源**: Open-Meteo API (Archive API + Forecast API + Previous Runs API)
- **更新频率**: 每日
- **数据粒度**: 1小时（需要插值到15分钟）
- **覆盖范围**: 江西省11个地市
- **预测范围**: **D-1到D+5** (D-2日发布的预测覆盖未来7天，共168条)
- **数据起始日期**:
  - 实况: 2023-08-01
  - 预测: 2024-02-15 (Previous Runs API起始)

### 12.1 集合定义

| 集合名称 | 用途 | 唯一键 | 数据来源 |
| :--- | :--- | :--- | :--- |
| `weather_actuals` | 历史实况 | `(location_id, timestamp)` | Archive API |
| `weather_forecasts` | 历史预测版本 | `(location_id, forecast_date, target_timestamp)` | Forecast API / Previous Runs API |
| `weather_locations` | 站点配置管理 | `location_id` | 自定义配置 |

**关键设计**:
- **时间维度分离**: actuals用`timestamp`（观测时间），forecasts用`forecast_date`（发布日） + `target_timestamp`（预测目标）
- **防止数据泄露**: 特征工程时根据`forecast_date`筛选，确保只用发布日之前的数据
- **站点管理**: 使用 `weather_locations` 集中管理需要下载和处理的站点，通过 `enabled` 字段动态控制

### 12.2 `weather_locations` 字段说明

| 字段名 | 数据类型 | 描述 | 用途 |
| :--- | :--- | :--- | :--- |
| `location_id` | String | **[主键]** 站点唯一标识（如 "nanchang"） | 配置索引 |
| `name` | String | 站点中文名称 | 显示用途 |
| `latitude` | Number | 纬度 (WGS84) | API请求参数 |
| `longitude` | Number | 经度 (WGS84) | API请求参数 |
| `enabled` | Boolean | 是否启用 | **下载控制开关** |

### 12.3 `weather_actuals` 字段说明

| 字段名 | 数据类型 | 描述 | 用途 |
| :--- | :--- | :--- | :--- |
| `location_id` | String | **[复合主键]** 城市ID (nanchang, ganzhou等11个) | 区分地点 |
| `timestamp` | ISODate | **[复合主键]** 观测时间（小时粒度） | 时间索引 |
| `apparent_temperature` | Number | 体感温度 (°C) | 影子模型特征 |
| `shortwave_radiation` | Number | 短波辐射 (W/m²) | **光伏预测关键** |
| `wind_speed_10m` | Number | 10米风速 (km/h) | 风电特征 |
| `wind_speed_100m` | Number | 100米风速 (km/h) | **风电预测关键** |
| `relative_humidity_2m` | Number | 相对湿度 (%) | 辅助特征 |
| `precipitation` | Number | 降水量 (mm) | 辅助特征 |
| `cloud_cover` | Number | 云量 (%) | **光伏预测关键** |
| `creation_timestamp` | ISODate | 数据写入时间 | 数据管理 |

### 12.4 `weather_forecasts` 字段说明

| 字段名 | 数据类型 | 描述 | 用途 |
| :--- | :--- | :--- | :--- |
| `location_id` | String | **[复合主键]** 城市ID | 区分地点 |
| `forecast_date` | ISODate | **[复合主键]** 预测发布日期（无时分秒） | **防泄露关键** |
| `target_timestamp` | ISODate | **[复合主键]** 预测目标时间（小时粒度） | 时间索引 |
| `apparent_temperature` | Number | 体感温度预测 (°C) | 影子模型特征 |
| `shortwave_radiation` | Number | 短波辐射预测 (W/m²) | 光伏预测 |
| `wind_speed_10m` | Number | 10米风速预测 (km/h) | 风电特征 |
| `wind_speed_100m` | Number | 100米风速预测 (km/h) | 风电预测 |
| `relative_humidity_2m` | Number | 相对湿度预测 (%) | 辅助特征 |
| `precipitation` | Number | 降水量预测 (mm) | 辅助特征 |
| `cloud_cover` | Number | 云量预测 (%) | 光伏预测 |
| `creation_timestamp` | ISODate | 数据写入时间 | 数据管理 |

**预测版本范围**:
- previous_day1~7: 共7个版本（1到7天前发布的预测）
- **关键理解**: previous_dayN表示target_timestamp这个时间点在N天前发布的预测
  - 例如: target_timestamp=2025-12-01的previous_day3 = 在2025-11-28发布的预测
- **D-2日(如11-28)发布的预测**:
  - 使用previous_day1~5 获取11-29到12-03的预测（覆盖D-1到D+5）
  - 每个发布日包含7天×24小时=168条记录
- Day 1-5: 数据质量较好
- Day 6-7: 质量下降（官方警告）
- Day 8+: API不提供

### 12.5 索引配置

```javascript
// weather_actuals
db.weather_actuals.createIndex({
    "location_id": 1,
    "timestamp": 1
}, { unique: true })

// weather_forecasts
db.weather_forecasts.createIndex({
    "location_id": 1,
    "forecast_date": 1,
    "target_timestamp": 1
}, { unique: true })

db.weather_forecasts.createIndex({ "forecast_date": 1 })
db.weather_forecasts.createIndex({ "location_id": 1, "target_timestamp": 1 })
```

### 12.6 数据示例

**weather_actuals** (历史实况):
```json
{
    "location_id": "nanchang",
    "timestamp": ISODate("2025-11-30T01:00:00Z"),
    "apparent_temperature": 12.5,
    "shortwave_radiation": 0.0,
    "wind_speed_10m": 8.3,
    "wind_speed_100m": 15.2,
    "relative_humidity_2m": 75.0,
    "precipitation": 0.0,
    "cloud_cover": 60.0,
    "creation_timestamp": ISODate("2025-12-01T08:00:00Z")
}
```

**weather_forecasts** (D-2日发布的D-1日预测):
```json
{
    "location_id": "nanchang",
    "forecast_date": ISODate("2025-11-28T00:00:00Z"),  // D-2日(11-28)发布
    "target_timestamp": ISODate("2025-11-29T12:00:00Z"), // 预测D-1日(11-29)12点
    "apparent_temperature": 15.2,
    "shortwave_radiation": 350.5,
    "wind_speed_10m": 10.1,
    "wind_speed_100m": 18.3,
    "relative_humidity_2m": 65.0,
    "precipitation": 0.0,
    "cloud_cover": 40.0,
    "creation_timestamp": ISODate("2025-11-29T08:00:00Z")
}
```

**说明**: D-2日(11-28)发布的预测覆盖D-1到D+5(11-29到12-03)，共7天168条记录

### 12.7 数据可用性

**在 D-2 日预测时**:
- ✅ **可用**: D-1 ~ D+5 的天气预测（`weather_forecasts`, forecast_date=D-2, 共168条）
- ✅ **可用**: D-2 日及之前的历史实况（`weather_actuals`）
- ℹ️ **说明**: D-2日发布时，预测覆盖"未来7天"，即D-1, D, D+1, D+2, D+3, D+4, D+5

**查询示例**:
```python
from datetime import datetime, timedelta

# 查询D-2日发布的D日预测
d_minus_2 = datetime(2025, 11, 28)
target_day = datetime(2025, 11, 30)

forecast_data = db.weather_forecasts.find({
    'location_id': 'nanchang',
    'forecast_date': d_minus_2.replace(hour=0, minute=0, second=0),
    'target_timestamp': {
        '$gte': target_day.replace(hour=0, minute=0),
        '$lt': (target_day + timedelta(days=1)).replace(hour=0, minute=0)
    }
}).sort('target_timestamp', 1)

# 查询D-3日的历史实况
d_minus_3 = datetime(2025, 11, 27)
actual_data = db.weather_actuals.find({
    'location_id': 'nanchang',
    'timestamp': {
        '$gte': d_minus_3.replace(hour=0, minute=0),
        '$lt': (d_minus_3 + timedelta(days=1)).replace(hour=0, minute=0)
    }
}).sort('timestamp', 1)
```

### 12.8 迁移说明

**⚠️ 重要**: 旧的单集合 `weather_data` 已废弃，请使用新的双集合架构。

**旧集合字段映射**:
- `weather_data.is_forecast=false` → `weather_actuals`
- `weather_data.is_forecast=true` → `weather_forecasts`
- `weather_data.target_timestamp` → actuals用`timestamp`，forecasts用`target_timestamp`
- 新增: `forecast_date`字段用于标识预测发布日

---


## 13. `day_ahead_econ_price` - 日前经济出清价格

该集合存储用于差价结算的日前经济出清价格数据（通常来源于“日前出清结果_用户”页面）。

- **数据来源**: `rpa.pipelines.day_ahead_auction`
- **更新频率**: 每日
- **业务意义**: 专门用于电力市场差价结算的经济出清价格。

### 13.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `clearing_power` | Number | 出清电量 (MWh)，精度4位小数。 |
| `clearing_price` | Number | 经济出清价格 (元/MWh)，即 `econ_clearing_price`，精度2位小数。 |

### 13.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 复合索引，用于按日期和时间点查询。

---


## 14. `task_execution_logs` - 系统/任务执行日志

该集合用于统一记录系统各类后台任务（定时任务、事件驱动任务等）的执行过程和结果。

- **数据来源**: `webapp.scheduler.logger.TaskLogger`
- **更新频率**: 实时记录任务开始与结束

### 14.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `task_id` | String | **[主键]** 任务执行唯一标识，通常由 `service_type_task_type_timestamp_rand` 组成。 |
| `service_type` | String | 服务类型。可选值: `web`, `rpa`, `forecast`。 |
| `task_type` | String | 任务类型标识。如: `load_aggregation`, `forecast_daily`。 |
| `task_name` | String | 任务显示名称。 |
| `trigger_type` | String | 触发方式。可选值: `schedule` (定时), `event` (事件推动), `manual` (手工确认)。 |
| `status` | String | 执行状态。可选值: `RUNNING`, `SUCCESS`, `FAILED`, `PARTIAL`。 |
| `start_time` | ISODate | 任务开始时间（系统本地时间）。 |
| `end_time` | ISODate | 任务结束时间（系统本地时间）。 |
| `duration` | Number | 执行耗时（秒）。 |
| `summary` | String | 执行结果摘要描述。 |
| `details` | Object | 详细执行数据/指标。 |
| `error` | Object | 错误详情信息（若失败）。 |
| `error.code` | String | 错误码。 |
| `error.message` | String | 错误消息详情。 |
| `created_at` | ISODate | 记录创建时间。 |
| `updated_at` | ISODate | 记录最后更新时间。 |

### 14.2. 索引

- `(task_id: 1)`: 唯一索引。
- `(task_type: 1, start_time: -1)`: 用于按任务类型查询执行历史。
- `(status: 1, start_time: -1)`: 用于按状态刷选日志。

---

## 15. `system_alerts` - 系统告警

该集合存储系统自动触发的所有异常告警信息，包括数据质量异常、系统错误等。

- **数据来源**: 任务自动逻辑（如 `aggregation_jobs.py`）
- **更新频率**: 异常发生时实时创建

### 15.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `alert_id` | String | **[主键]** 告警唯一标识。 |
| `level` | String | 告警级别。可选值: `P1` (严重), `P2` (一般), `P3` (提醒)。 |
| `category` | String | 告警分类。可选值: `DATA_QUALITY` (数据质量), `SYSTEM_ERROR` (系统错误)。 |
| `title` | String | 告警标题。 |
| `content` | String | 告警详细内容描述。 |
| `status` | String | 告警状态。可选值: `ACTIVE` (激活中), `RESOLVED` (已解决)。 |
| `service_type` | String | 产生告警的服务类型。 |
| `task_type` | String | 产生告警的任务类型。 |
| `related_task_id` | String | 关联的任务执行 ID (`task_execution_logs.task_id`)。 |
| `context` | Object | 告警上下文（如错误详情、具体参数等）。 |
| `created_at` | ISODate | 告警创建时间。 |
| `resolved_at` | ISODate | 解决时间（若已解决）。 |
| `resolved_by` | String | 解决人。 |
| `resolution_note` | String | 解决说明备注。 |

### 15.2. 索引

- `(alert_id: 1)`: 唯一索引。
- `(status: 1, level: 1)`: 用于控制台显示活跃的高级告警。
- `(created_at: -1)`: 按时间倒序查询告警。

---

## 16. `task_commands` - 远程任务/指令

该集合作为指令中转站，用于前端向后端工作进程或外部服务（如 RPA）下发执行指令。

- **数据来源**: 前端 API 触发
- **消费端**: 后端调度器/执行器

### 16.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `command_id` | String | **[主键]** 指令唯一 ID。 |
| `command` | String | 执行指令。如: `re-predict`, `rerun_aggregation`。 |
| `task_type` | String | 关联的任务类型。 |
| `service_type` | String | 目标服务类型。 |
| `status` | String | 指令状态。可选值: `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`。 |
| `parameters` | Object | 执行参数。如: `{"target_date": "2026-02-04"}`。 |
| `priority` | Number | 优先级（数字越大优先级越高）。 |
| `created_at` | ISODate | 创建时间。 |
| `created_by` | String | 创建人/触发人账号名。 |
| `started_at` | ISODate | 开始执行时间。 |
| `completed_at` | ISODate | 完成执行时间。 |
| `result_message` | String | 执行结果消息反馈。 |

### 16.2. 索引

- `(status: 1, priority: -1, created_at: 1)`: 消费端轮询索引。
- `(command_id: 1)`: 唯一索引。

## 17. `load_forecast_results` - 客户负荷预测结果

该集合存储客户级别的负荷预测输出，包括单客户预测、聚合预测及配套的精度指标。

**业务价值**:
- 提供代理用户电量预测 (D ~ D+2)
- 为交易申报提供数据支撑
- 集成实时精度评估，反馈模型质量

- **数据来源**: 负荷预测流水线输出
- **更新频率**: 每日
- **数据粒度**: 30分钟，每日48个数据点
- **预测视野**: D, D+1, D+2 (通过 Gap 区分)

### 17.1 字段说明

| 字段名 | 数据类型 | 描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `customer_id` | String | **[复合主键]** 客户ID 或 `"AGGREGATE"` (聚合结果) | 区分维度 |
| `forecast_date` | ISODate | **[复合主键]** 预测执行参考日期 (基准日) | 2026-01-31 00:00 |
| `gap` | Number | **[复合主键]** 偏移天数。0:当天, 1:次日, 2:第三日 | 1 |
| `target_date` | ISODate | 预测目标日期 (forecast_date + gap + 1) | 2026-02-02 00:00 |
| `forecast_id` | String | 预测批次号 | "LOAD_20260131_0000" |
| `values` | Array | 48个预测电量值 (MWh) | 预测输出 |
| `confidence_90_lower`| Array | 90%置信区间下界 (48点) | 风险控制 |
| `confidence_90_upper`| Array | 90%置信区间上界 (48点) | 风险控制 |
| `manual_adjustment` | Object | 手工调整信息 | **用户干预** |
| ├─ `is_modified` | Boolean | 是否有人工修改 (True/False) | |
| ├─ `original_values` | Array | 备份的原始算法预测值 (48点) | 回退依据 |
| └─ `logs` | Array | 修改日志 `[{user, time, action, reason}]` | 审计 |
| `accuracy` | Object | 精度评价嵌入文档 (当实际值可用时更新) | **性能追踪** |
| ├─ `wmape_accuracy` | Number | WMAPE 准确率 (0-100%) | 主指标 |
| ├─ `mae` | Number | 平均绝对误差 | |
| ├─ `rmse` | Number | 均方根误差 | |
| └─ `calculated_at` | ISODate | 指标计算时间 | |
| `aggregated_count` | Number | 聚合客户统计 (仅针对 AGGREGATE 记录) | 验证覆盖率 |
| `created_at` | ISODate | 记录创建时间 | |

### 17.2 索引配置

```javascript
// 复合唯一索引
db.customer_load_forecasts.createIndex({
    "customer_id": 1,
    "forecast_date": 1,
    "gap": 1
}, { unique: true })

// 目标日期查询（用于对外展示/聚合）
db.customer_load_forecasts.createIndex({ "target_date": 1, "customer_id": 1 })
```

## 18. `spot_settlement_daily` - 平台日报结算数据

该集合存储交易平台发布的批发侧**日清算结果（电能量）**，用于与本地预结算数据进行比对。

- **数据来源**: 交易平台发布（来源于《现货结算--用电侧日结算信息.xls》）
- **更新频率**: 每日 (D+2)
- **业务意义**: 官方电能量结算依据。

### 18.1 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `operating_date` | String | **[主键]** 结算日期 (YYYY-MM-DD)。 |
| `contract_volume` | Number | 中长期合同电量 (MWh)。 |
| `contract_avg_price` | Number | 中长期合同均价 (元/MWh)。 |
| `contract_fee` | Number | 中长期差价电费 (元)。 |
| `day_ahead_volume` | Number | 日前出清电量 (MWh)。 |
| `day_ahead_fee` | Number | 日前差价电费 (元)。 |
| `real_time_volume` | Number | 实际用电量 (MWh)。 |
| `real_time_fee` | Number | 实时全电量电费 (元)。 |
| `total_fee` | Number | 电能量电费合计 (元)。 |
| `avg_price` | Number | 结算均价 (元/MWh)。 |

### 18.2 索引

- `(operating_date: 1)`: 唯一索引。

---

## 19. `spot_settlement_period` - 平台分时结算数据

该集合存储交易平台发布的批发侧**分时结算详情** (48点)，提供精细化的费用构成分析。

- **数据来源**: 交易平台发布（来源于《现货结算--用电侧24时段结算明细信息.xls》）
- **更新频率**: 每日 (D+2)
- **数据粒度**: 30分钟，每日48点

### 19.1 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `operating_date` | String | **[复合主键]** 结算日期 (YYYY-MM-DD)。 |
| `period` | Number | **[复合主键]** 时段号 (1-48)。 |
| `contract_volume` | Number | 中长期合同电量 (MWh)。 |
| `contract_price` | Number | 中长期合同价格 (元/MWh)。 |
| `contract_fee` | Number | 中长期差价电费 (元)。 |
| `day_ahead_volume` | Number | 日前出清电量 (MWh)。 |
| `day_ahead_price` | Number | 日前价格 (元/MWh)。 |
| `day_ahead_fee` | Number | 日前差价电费 (元)。 |
| `real_time_volume` | Number | 实际用电量 (MWh)。 |
| `real_time_price` | Number | 实时价格 (元/MWh)。 |
| `real_time_fee` | Number | 实时全电量电费 (元)。 |
| `total_fee` | Number | 电能量电费合计 (元)。 |
| `avg_price` | Number | 结算均价 (元/MWh)。 |


## 20. `mechanism_energy_monthly` - 机制电量月度数据

该集合存储**机制电量**（新能源机制）的月度分时数据。机制电量不参与市场化差价结算，在计算偏差考核时需从实际用电量中扣除。

- **数据来源**: 线下导入（来源于《机制电量明细.xls》）
- **更新频率**: 每月发布
- **数据处理**: 结算时需将月度值平均分配到当月每一天。

### 20.1 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `month_str` | String | **[主键]** 月份 (YYYY-MM)。 |
| `entity_name` | String | 市场成员名称。 |
| `period_values` | Array\<Float\> | 48点电量值数组 (MWh) - **月度总值**。数组下标对应时段 (0 -> Period 1)。 |

### 20.2 索引

- `(month_str: 1, entity_name: 1)`: 唯一索引。
