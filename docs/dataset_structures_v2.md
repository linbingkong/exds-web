# 项目数据集结构文档

本文档详细描述了 "电力交易辅助决策系统" 项目中主要数据集（MongoDB 集合）的结构、字段含义及索引信息。

## 1. `customer_archives` - 客户档案

该集合存储所有客户的详细档案信息。

**模型文件**: `webapp/models/customer.py`

### 1.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 客户唯一ID |
| `user_name` | `String` | 客户全称 |
| `short_name` | `String` | 客户简称 |
| `needs_name_masking` | `Boolean \| Null` | 是否需要客户名称脱敏。`true` 表示演示角色默认显示脱敏名称；`false` 表示默认显示真实名称；历史数据兼容阶段允许为空，空值按规则回退判断。 |
| `location` | `String` | 地理位置信息,关联`weather_location` 集合 `name` 字段 |
| `source` | `String` | 客户来源（自营开发、居间代理A、居间代理B） |
| `manager` | `String` | 客户经理 |
| `accounts`| `Array` | 用电户号列表 |
| `accounts.account_id` | `String` | 用电户号 |
| `accounts.meters` | `Array` | 挂载在该户号下的电表列表 |
| `accounts.meters.meter_id` | `String` | 电表资产号 |
| `accounts.meters.multiplier` | `Number` | 倍率 |
| `accounts.meters.allocation_ratio` | `Number` | 分配系数，范围 0-1.0。**默认为空 (null)**，非空表示该电表已通过 RPA 校验。 |
| `accounts.metering_points` | `Array` | 挂载在该户号下的计量点列表 |
| `accounts.metering_points.mp_no` | `String` | 计量点编号 |
| `accounts.metering_points.mp_name` | `String` | 计量点名称 |
| `tags` | `Array` | 标签集合 |
| `tags.name` | `String` | 标签名/值 (核心字符串，如 "计划停产", "VIP") |
| `tags.source` | `String` | 来源 (AUTO:算法, MANUAL:人工) |
| `tags.expire` | `Date` | 失效时间 (用于临时标签，过期自动忽略) |
| `tags.reason` | `String` | 原因/备注 (解释为什么打这个标，存数值也可以放这里) |





### 1.2. 索引信息

- `_id_` (默认)
- `user_name`
- `short_name`
- `location`
- `needs_name_masking`
- `tags.name`
- `accounts.account_id`
- `accounts.meters.meter_id`
- `accounts.metering_points.mp_no`
- `created_at`
- `updated_at`

---

## 1.3. `customer_demo_aliases` - 客户演示脱敏别名

该集合存储需要脱敏客户的稳定演示名称映射，是客户名称脱敏的唯一真源。

- **数据来源**: `webapp/services/customer_name_masking_service.py`
- **用途**:
  - 为演示角色提供稳定的 `demo_name` / `demo_short_name`
  - 支持按演示名称反查 `customer_id`
  - 仅保留 `customer_archives.needs_name_masking = true` 的客户映射

### 1.3.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 主键，当前直接使用 `customer_id` |
| `customer_id` | `String` | 关联客户ID（来自 `customer_archives._id`） |
| `demo_name` | `String` | 演示用客户全称，要求全局唯一 |
| `demo_short_name` | `String` | 演示用客户简称 |
| `real_name` | `String \| Null` | 真实客户全称快照 |
| `real_short_name` | `String \| Null` | 真实客户简称快照 |
| `source_hash` | `String` | 基于 `customer_id + real_name` 生成的哈希摘要，用于辅助排查映射来源 |
| `status` | `String` | 映射状态，当前实现主要使用 `active`，保留 `disabled` 扩展位 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 最后更新时间 |
| `created_by` | `String` | 创建人，当前系统生成时固定为 `system` |
| `updated_by` | `String` | 更新人，当前系统生成时固定为 `system` |

### 1.3.2. 索引信息

- `_id_`（默认）
- `customer_id`（唯一索引）
- `demo_name`（唯一索引）
- `demo_short_name`
- `status`
- `status`, `customer_id`（复合索引）

### 1.3.3. 维护规则

- 只有需要脱敏的客户才应保留别名记录。
- `customer_archives.needs_name_masking` 批量回填规则当前为：客户全称包含 `国网`、`江西科晨`、`江西省送变电`、`江西送变电`、`送变电` 时自动置为 `true`。
- 可通过脚本 `webapp/scripts/backfill_customer_name_masking_flag.py` 回填客户脱敏标记。
- 可通过脚本 `webapp/scripts/ensure_customer_demo_aliases.py` 为全部脱敏客户预生成别名。
- 可通过脚本 `webapp/scripts/cleanup_customer_demo_aliases.py` 清理已不再需要的别名记录。

---

## 2. `retail_contracts` - 零售合同

该集合存储客户与公司签订的零售合同。在v1.py中，集合名称被硬编码为 'retail_contracts'。

**模型文件**: `webapp/models/contract.py`

### 2.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 合同唯一ID |
| `contract_name` | `String` | 合同名称 |
| `package_name` | `String` | 关联的套餐名称 |
| `package_id` | `String` | 关联的套餐ID |
| `customer_name` | `String` | 关联的客户名称 |
| `customer_id` | `String` | 关联的客户ID |
| `purchasing_electricity_quantity` | `Number` | 购买电量 (kWh) |
| `purchase_start_month` | `DateTime` | 购电开始月份 |
| `purchase_end_month` | `DateTime` | 购电结束月份 |
| `package_snapshot` | `Object` | 套餐内容快照，用于存档 |
| `package_snapshot.package_type` | `String` | 套餐类型 |
| `package_snapshot.model_code` | `String` | 定价模型代码 |
| `package_snapshot.is_green_power`| `Boolean` | 是否绿电 |
| `package_snapshot.pricing_config`| `Object` | 定价配置详情 |
| `created_by` | `String` | 创建人 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_by` | `String` | 更新人 |
| `updated_at` | `DateTime` | 更新时间 |

### 2.2. 索引信息

- `_id_` (默认)
- `package_name`
- `customer_name`
- `purchase_start_month`
- `purchase_end_month`
- `package_id`
- `customer_id`
- `package_name`, `purchase_start_month` (复合索引)
- `customer_name`, `purchase_start_month` (复合索引)
- `created_at`
- `updated_at`
- `contract_name`
- `contract_name`, `purchase_start_month` (复合索引)
- `customer_id`, `purchase_start_month`, `purchase_end_month` (复合索引)

---

## 3. `retail_packages` - 零售套餐

该集合定义了可供客户选择的各类零售套餐。

**模型文件**: `webapp/models/retail_package.py`

### 3.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 套餐唯一ID |
| `package_name` | `String` | 套餐名称 |
| `package_description` | `String` | 套餐描述 |
| `package_type` | `String` | 套餐类型: "time_based" (分时) / "non_time_based" (不分时) |
| `model_code` | `String` | 关联的定价模型代码 |
| `pricing_config` | `Object` | 统一的定价配置字典，结构随 `model_code` 变化 |
| `is_green_power` | `Boolean` | 是否为绿电套餐 |
| `status` | `String` | 套餐状态: "draft", "active", "archived" |
| `validation` | `Object` | 价格比例校验结果 |
| `validation.price_ratio_compliant` | `Boolean`| 是否符合463号文比例 |
| `validation.actual_ratios` | `Object` | 实际比例 |
| `validation.expected_ratios` | `Object` | 标准比例 |
| `validation.warnings` | `Array` | 警告信息 |
| `created_by` | `String` | 创建人 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `updated_by` | `String` | 更新人 |
| `activated_at` | `DateTime` | 生效时间 |
| `archived_at` | `DateTime` | 归档时间 |

### 3.2. 索引信息

- `_id_` (默认)

---

## 4. `pricing_models` - 定价模型

该集合定义了零售套餐的计算逻辑和核心参数。

**模型文件**: `webapp/models/pricing_model.py`

### 4.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 模型唯一ID |
| `model_code` | `String` | 模型唯一标识，格式: `{pricing_mode}_{floating_type}_{package_type}` |
| `display_name` | `String` | 模型显示名称 |
| `package_type` | `String` | 套餐类型: "time_based" (分时) / "non_time_based" (不分时) |
| `pricing_mode` | `String` | 定价模式，例如: "fixed_linked", "price_spread_simple" 等 |
| `floating_type` | `String` | 浮动类型: "fee" (费用) / "price" (价格) |
| `formula` | `String` | 计算公式 (HTML格式) |
| `description` | `String` | 套餐说明 (HTML格式) |
| `enabled` | `Boolean` | 是否启用 |
| `sort_order` | `Number` | 排序顺序 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 4.2. 索引信息

- `_id_` (默认)
- `model_code` (唯一索引)
- `package_type`, `enabled` (复合索引)
- `sort_order`

---

## 5. `raw_meter_data` - 原始电表示度数据 (手工导入)

该集合存储手工导入的原始电表示数，采用**按日宽表**结构。

### 5.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
| `meter_id` | `String` | 电表资产号 (Meter ID) |
| `date` | `String` | 数据日期 (YYYY-MM-DD) |
| `readings` | `Array` | 当日示数数组 (Number) |
| `meta` | `Object` | 冗余元数据 (来自导入文件) |
| `meta.customer_name` | `String` | 用户名称 |
| `meta.account_id` | `String` | 用户编号 (户号) |
| `updated_at` | `DateTime` | 最后更新时间 |

### 5.2. 索引信息

- `_id_` (默认)
- `meter_id`, `date` (唯一复合索引)

---

## 6. `raw_mp_data` - 原始计量点负荷数据 (RPA导入)

该集合存储通过RPA自动采集的原始负荷数据，采用**按日宽表**结构。

### 6.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
| `mp_id` | `String` | 计量点ID (Metering Point ID) |
| `date` | `String` | 数据日期 (YYYY-MM-DD) |
| `load_values` | `Array` | 当日负荷数组 (Number，单位: MWh) |
| `total_load` | `Number` | 日电量合计 (校验用) |
| `meta` | `Object` | 冗余元数据 (来自RPA源) |
| `meta.customer_name` | `String` | 电力用户名称 |
| `meta.account_id` | `String` | 用户号 |
| `updated_at` | `DateTime` | 最后更新时间 |

### 6.2. 索引信息

- `_id_` (默认)
- `mp_id`, `date` (唯一复合索引)

---

## 7. `unified_load_curve` - 统一负荷曲线

该集合存储聚合后的用户级负荷数据，是系统内唯一的权威负荷曲线源。

**设计原则**: 采用**宽表 (Wide Format) + 双数组**结构，每个客户每天一条记录，计量点数据和电表示度数据分离存储。

### 7.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customer_archives._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `date` | `String` | 数据日期 (YYYY-MM-DD) | `"2025-11-11"` |
| `mp_load` | `Object` | 计量点数据（来自 `raw_mp_data`） | 见下表 |
| `meter_load` | `Object` | 电表示度数据（来自 `raw_meter_data`） | 见下表 |
| `deviation` | `Object` | 误差分析数据 | 见下表 |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

> **注意**：不再保存 `final_load`、`final_source`、`is_complete` 字段，融合逻辑改为后端 API 动态计算。

#### `mp_load` 子对象结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `values` | `Array[48]` | 48点电量数组 (MWh, **保留4位小数**) |
| `total` | `Number` | 日总电量 (MWh, **保留4位小数**) |
| `mp_count` | `Integer` | 实际参与聚合的计量点数量 |
| `missing_mps` | `Array[String]` | 缺失的计量点编号 |
| `tou_usage` | `Object` | **预计算时段电量** (MWh, 分时电价统计) |
| `tou_usage.tip` | `Number` | 尖峰电量 |
| `tou_usage.peak` | `Number` | 高峰电量 |
| `tou_usage.flat` | `Number` | 平段电量 |
| `tou_usage.valley` | `Number` | 低谷电量 |
| `tou_usage.deep` | `Number` | 深谷电量 |

#### `meter_load` 子对象结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `values` | `Array[48]` | 48点电量数组 (MWh, **保留4位小数**) |
| `total` | `Number` | 日总电量 (MWh, **保留4位小数**) |
| `meter_count` | `Integer` | 实际参与聚合的电表数量 |
| `missing_meters` | `Array[String]` | 缺失的电表资产编号 |
| `tou_usage` | `Object` | **预计算时段电量** (MWh, 分时电价统计) |
| `tou_usage.tip` | `Number` | 尖峰电量 |
| `tou_usage.peak` | `Number` | 高峰电量 |
| `tou_usage.flat` | `Number` | 平段电量 |
| `tou_usage.valley` | `Number` | 低谷电量 |
| `tou_usage.deep` | `Number` | 深谷电量 |
| `data_quality` | `Object` | 数据质量标记（可选） |
| `data_quality.interpolated_points` | `Array[Number]` | 被插值的时段索引 (0-47) |
| `data_quality.dirty_points` | `Array[Number]` | 脏数据时段索引（无法处理） |

#### `deviation` 误差分析字段

当 `mp_load` 和 `meter_load` 同时存在时，计算并存储误差信息：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `daily_error` | `Number` | 日电量误差 = (mp_total - meter_total) / meter_total |
| `daily_error_abs` | `Number` | 日电量绝对误差 (MWh) |
| `is_warning` | `Boolean` | 误差是否超过阈值 (默认5%) |


### 7.2. 动态融合规则

融合逻辑由后端 API 根据参数动态计算，不在数据库中存储：

```
GET /api/v1/load-data/curve/{customer_id}?priority=mp&threshold=0.95

if priority == "mp":  # 计量点优先（默认）
    if mp_load.coverage >= threshold:
        return mp_load.values
    elif meter_load exists:
        return meter_load.values
    else:
        return mp_load.values
else:  # priority == "meter"，电表优先
    if meter_load.coverage >= threshold:
        return meter_load.values
    elif mp_load exists:
        return mp_load.values
    else:
        return meter_load.values
```

> **补录替换**：当 `raw_mp_data` 有新数据写入时，自动触发 `mp_load` 重新聚合，下次查询自动使用最新数据。

### 7.3. 索引信息

- `_id_` (默认)
- `customer_id`, `date` (唯一复合索引)
- `date` (时序查询优化)
- `customer_name` (检索优化)

---

## 8. `temporary_load_curve` - 临时负荷曲线 (开发分析用)

该集合存储**未签约客户**的手工导入负荷数据。此数据仅用于潜在客户开发阶段的用电分析，不参与正式结算或生产预测。

**设计原则**: 结构与 `unified_load_curve` 保持一致（宽表），便于后续客户签约时迁移数据。

### 8.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customer_archives._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `date` | `String` | 数据日期 (YYYY-MM-DD) | `"2025-11-11"` |
| `manual_load` | `Object` | 手工数据（结构同 unified_load_curve） | 见 7.1 |
| `final_load` | `Array[48]` | 最终曲线 (MWh) | `[0.85, 0.92, ...]` |
| `final_source` | `String` | 固定为 `"manual"` | `"manual"` |
| `is_complete` | `Boolean` | 数据完整性标记 | `true` |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

### 8.2. 索引信息

- `_id_` (默认)
- `customer_id`, `date` (唯一复合索引)
- `date` (时序查询优化)
- `customer_name` (检索优化)
- `is_complete` (快速筛选)

---

## 9. `customer_tags` - 客户标签定义

该集合用于统一管理客户标签，定义标签的分类、来源和判定规则。

**模型文件**: `webapp/models/customer_tag.py`

### 9.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID |
| `name` | `String` | 标签名称 (唯一主键，如 "计划停产") |
| `category` | `String` | 业务分类 (如 "风险", "生产") |
| `source_type` | `String` | 来源类型 (AUTO:仅算法, MANUAL:仅人工, HYBRID:混合) |
| `description` | `String` | 含义/判定规则描述 (用于鼠标悬停提示) |
| `is_active` | `Boolean` | 是否启用 (下架旧标签用) |

### 9.3. 预设标签枚举

以下是系统初始支持的标签库，实际使用中可动态通过管理后台增删。

| 业务分类 | 标签名称 | 来源类型 | 说明 |
| :--- | :--- | :--- | :--- |
| **用电特性** | `基荷稳定型` | AUTO | 负荷曲线平稳，波动小 |
| | `负荷波动` | AUTO | 用电负荷忽高忽低，波动率大 |
| | `全年无休` | AUTO | 节假日及周末保持正常用电 |
| | `周末双休` | AUTO | 周末负荷明显下降 |
| | `周末单休` | AUTO | 只有周六或周日负荷极低 |
| | `日间单班` | AUTO | 仅有白班生产，夜间负荷极低 |
| | `全天生产` | AUTO | 24小时连续生产，负荷率高 |
| | `午间填谷型` | AUTO | 午间用电量大，适合消纳光伏 |
| | `避峰生产` | AUTO | 主动避开高峰电价时段用电 |
| | `夏季气温敏感` | AUTO | 夏季负荷与气温强相关 (空调负荷大) |
| | `冬季气温敏感` | AUTO | 冬季负荷与气温强相关 (取暖负荷大) |
| **资源设施** | `具备光伏` | MANUAL | 厂区内安装了光伏发电设施 |
| | `疑似光伏` | AUTO | 算法检测出明显的“鸭子曲线”特征 |
| | `具备储能` | MANUAL | 厂区内配置了储能设备 |
| | `自备电厂` | MANUAL | 拥有自备燃煤/燃气发电机组 |
| **经营风险** | `产能下滑` | HYBRID | 用电量同比/环比持续显著下降 |
| | `关停风险` | HYBRID | 长期极低负荷或零负荷运行 |

| **生产状态** | `正常生产` | HYBRID | 系统默认状态，用电行为符合基线或人工确认正常 |
| | `节假日生产` | AUTO | 节假日负荷不降反升，或保持高位 |
| | `停产检修` | HYBRID | 负荷显著低于平时，或客户申报检修 |
| | `计划停产` | MANUAL | 客户提前告知的计划性停产 |
| | `季节性生产` | AUTO | 算法识别出明显的季节性用电特征 |
| | `产能爬坡` | HYBRID | 用电量呈持续上升趋势 |
| | `产能扩张期` | MANUAL | 企业正在扩建或新增产线，用电量预期增长 |
| | `订单爆满` | MANUAL | 企业反馈订单充足，预计保持满负荷生产 |
| **客户管理** | `VIP客户` | MANUAL | 战略大客户，享受高优先级服务 |
| | `关系户` | MANUAL | 需特殊维护的重要关系客户 |
| | `沉默客户` | MANUAL | 长期无互动反馈，需要激活 |
| | `纠纷敏感` | MANUAL | 曾发生过服务纠纷或投诉 |
| | `价格敏感` | MANUAL | 对电价波动极其敏感，容易流失 |
| | `信用优质` | MANUAL | 历史缴费记录良好，无违约 |
| | `欠费高危` | MANUAL | 近期有逾期或缴费延迟记录 |


### 9.2. 索引信息

- `_id_` (默认)
- `name` (唯一索引)
- `category`
- `is_active`

---

## 10. `typical_curves` - 典型曲线数据集

该集合存储交易平台发布的市场化典型曲线和工商业典型曲线，用于负荷预测、交易模拟及偏差考核分析。

### 10.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `year` | `Integer` | 适用年份 | `2025` |
| `month` | `Integer` | 适用月份 (0表示不特定月份的假日曲线) | `9` |
| `curve_type` | `String` | 曲线类型: `market` (市场化), `business_general` (工商业), `business_all` (全体工商业) | `"market"` |
| `name` | `String` | 曲线完整名称 (来自Excel原始数据) | `"2025年9月市场化典型曲线"` |
| `holiday` | `String` | 节假日名称 (如包含则填入，否则为 `null`) | `"国庆节"` |
| `points` | `Array[48]` | 48点标幺值/数值数组 (30分钟间隔) | `[2.09, 2.12, ...]` |

### 10.2. 索引信息

- `_id_` (默认)
- `year`, `month`, `curve_type`, `name` (唯一复合索引)

## 11. `customer_characteristics` - 客户特征画像

该集合存储每位客户的最新用电特征分析结果，包括长期指标、短期指标和标签。

- **数据来源**: `webapp.services.characteristics.service.CharacteristicService`
- **更新频率**: 每日特征分析时覆盖更新

### 11.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `customer_id` | String | **[主键]** 客户ID |
| `customer_name` | String | 客户名称 |
| `updated_at` | ISODate | 最后更新时间 |
| `data_date` | String | **特征分析日期** (负荷数据截至日期) YYYY-MM-DD |
| `regularity_score` | Number | 规律性评分 (0-100) |
| `quality_rating` | String | 质量评级: `A` (优) / `B` (良) / `C` (差) |
| `baseline_curve` | Array[Number] | 基准负荷曲线 (48点，每点30分钟) |
| `tags` | Array[Object] | 特征标签列表 |
| `long_term` | Object | 长期指标 (年度视角) |
| `short_term` | Object | 短期指标 (近30天) |

#### 11.1.1 `tags` 结构

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `name` | String | 标签名称 (如 "产能扩张", "连续生产") |
| `category` | String | 分类: "经营/气象" / "生产班次" / "异动风险" |
| `confidence` | Number | 置信度 (0-1) |

#### 11.1.2 `long_term` 结构

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `data_start` | String | 数据起始日期 |
| `data_end` | String | 数据截止日期 |
| `avg_daily_load` | Number | 日均电量 (MWh) |
| `total_annual_load` | Number | 年度总电量 (MWh) |
| `trend_slope` | Number | 趋势斜率 (增长为正) |
| `recent_3m_growth` | Number | 近3个月增长率 |
| `cv` | Number | 离散系数 (变异系数) |
| `zero_days` | Number | 零电量天数 |
| `weekend_ratio` | Number | 周末/工作日负荷比 |
| `summer_avg` | Number | 夏季日均电量 |
| `winter_avg` | Number | 冬季日均电量 |
| `spring_autumn_avg` | Number | 春秋季日均电量 |
| `temp_correlation` | Number | 气温相关系数 |

#### 11.1.3 `short_term` 结构

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `data_start` | String | 数据起始日期 |
| `data_end` | String | 数据截止日期 |
| `avg_curve` | Array[Number] | 平均负荷曲线 (48点) |
| `std_curve` | Array[Number] | 标准差曲线 (48点) |
| `avg_load_rate` | Number | 平均负荷率 |
| `min_max_ratio` | Number | 最小/最大值比 |
| `peak_hour` | Number | 峰值时刻 (点位索引) |
| `valley_hour` | Number | 谷值时刻 (点位索引) |
| `curve_similarity` | Number | 曲线相似度 (近30天一致性) |
| `cv` | Number | 曲线离散系数 |
| `tip_ratio` | Number | 尖时段电量占比 |
| `peak_ratio` | Number | 峰时段电量占比 |
| `flat_ratio` | Number | 平时段电量占比 |
| `valley_ratio` | Number | 谷时段电量占比 |
| `deep_ratio` | Number | 深谷时段电量占比 |

### 11.2. 索引

- `(customer_id: 1)`: 唯一索引

---

## 12. `analysis_history_log` - 特征分析历史日志

该集合记录每次特征分析的执行历史，用于追踪标签变化和调试。

- **数据来源**: `webapp.services.characteristics.service.CharacteristicService`
- **更新频率**: 每次分析时追加写入

### 12.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `customer_id` | String | 客户ID |
| `date` | String | 分析目标日期 (YYYY-MM-DD) |
| `execution_time` | ISODate | 执行时间 |
| `rule_ids` | Array[String] | 触发的规则ID列表 |
| `tags_snapshot` | Array[Object] | 生成的标签快照 |
| `metrics` | Object | 定量指标快照 (规律性、电量、趋势等) |
| `baseline_curve` | Array[Number] | 当日基准负荷曲线 (48点归一化) |

#### 12.1.1 `tags_snapshot` 结构

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `name` | String | 标签名称 |
| `source` | String | 来源: `AUTO` / `MANUAL` |
| `confidence` | Number | 置信度 |
| `rule_id` | String | 触发规则ID |
| `reason` | String | 触发原因 |

#### 12.1.2 `metrics` 结构

包含分析时的关键量化指标：

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `regularity_score` | Number | 规律性评分 (0-100) |
| `cv` | Number | 日内变异系数 / 日电量变异系数 |
| `avg_load_rate` | Number | 平均负荷率 |
| `min_max_ratio` | Number | 最小/最大负荷比 |
| `peak_hour` | Number | 峰值时刻 (0-47) |
| `valley_hour` | Number | 谷值时刻 (0-47) |
| `price_sensitivity` | Number | 价格敏感度评分 |
| `curve_similarity` | Number | 曲线相似度 |
| `avg_daily_load` | Number | 日均电量 |
| `trend_slope` | Number | 趋势线斜率 |
| `recent_3m_growth` | Number | 近3月环比增长率 |

### 12.2. 索引

- `(customer_id: 1, date: 1)`: 复合索引
- `(execution_time: -1)`: 按时间倒序

---

## 13. `customer_anomaly_alerts` - 客户异动告警历史

该集合用于追踪客户用电异动的历史记录，每次检测到异动时创建一条记录。

- **数据来源**: `webapp.services.characteristics.service.CharacteristicService`
- **更新频率**: 每日特征分析时自动写入

### 13.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `customer_id` | String | **[复合主键]** 客户ID |
| `alert_date` | String | **[复合主键]** 异动发生日期 (YYYY-MM-DD) |
| `alert_type` | String | **[复合主键]** 异动类型 |
| `customer_name` | String | 客户名称 |
| `severity` | String | 严重程度: `low` / `warning` / `critical` |
| `confidence` | Number | 置信度 (0-1) |
| `reason` | String | 触发原因详细说明 |
| `rule_id` | String | 触发规则ID |
| `metrics` | Object | 关键指标快照 |
| `metrics.total_load` | Number | 当日电量 (MWh) |
| `metrics.load_rate` | Number | 当日负荷率 |
| `metrics.avg_load_30d` | Number | 近30天日均电量 |
| `metrics.std_load_30d` | Number | 近30天电量标准差 |
| `created_at` | ISODate | 记录创建时间 |
| `acknowledged` | Boolean | 是否已处理 |
| `acknowledged_by` | String | 处理人 |
| `acknowledged_at` | ISODate | 处理时间 |
| `notes` | String | 备注 |

### 13.2. 异动类型

| 类型 | 默认严重程度 | 触发条件 |
| :--- | :--- | :--- |
| `形状异动` | `warning` | 曲线相似度 < 0.85 |
| `重心异动` | `low` | 峰值时刻偏移 > 2h |
| `力度异动` | `warning` | 电量偏离 > 50% (需 ≥ 20 MWh) |
| `规律异动` | `warning` | 近5天σ > 历史30天σ × 2 |
| `剧烈异动` | `critical` | 电量偏离 > 2.5σ (需 ≥ 20 MWh) |
| `日环比突变` | `critical` | 当日 vs 昨日变化 > 100% (需 ≥ 20 MWh) |
| `用电异动` | `warning` | IsolationForest 判定异常 |

### 13.3. 索引

- `(customer_id: 1, alert_date: 1, alert_type: 1)`: 唯一复合索引
- `(alert_date: -1)`: 按日期倒序，便于查询最近告警
- `(severity: 1, acknowledged: 1)`: 便于筛选待处理的高优告警

### 13.4. 查询示例

```python
# 查询某客户最近30天的所有异动
from datetime import datetime, timedelta
end_date = datetime.now().strftime("%Y-%m-%d")
start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

alerts = db.customer_anomaly_alerts.find({
    "customer_id": "690f039915fdeb957cdd228f",
    "alert_date": {"$gte": start_date, "$lte": end_date}
}).sort("alert_date", -1)

# 查询所有未处理的高优告警
critical_alerts = db.customer_anomaly_alerts.find({
    "severity": "critical",
    "acknowledged": False
}).sort("alert_date", -1)
```

---

## 14. `retail_settlement_daily` - 零售日结算单

该集合存储客户每日的零售电费结算结果（预结算/正式结算），包含分时电费明细和汇总数据。

**模型文件**: `webapp/models/retail_settlement.py`

### 14.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID |
| `customer_id` | `String` | 客户ID |
| `customer_name` | `String` | 客户名称 |
| `date` | `String` | 结算日期 (YYYY-MM-DD) |
| `contract_id` | `String` | 关联合同ID |
| `package_name` | `String` | 套餐名称 |
| `model_code` | `String` | 定价模型代码 |
| `settlement_type` | `String` | 结算类型: "daily" (预结算) / "monthly" (月结口径重算，不含调平电量) |
| `actual_monthly_volume` | `Number` | **[注]** 仅 `monthly` 记录存在，用于计算资金余缺分摊的月度总电量基准 |
| `reference_price` | `Object` | 参考价信息 (价差分成类) |
| `reference_price.type` | `String` | 类型: market_monthly_avg / upper_limit_price |
| `reference_price.base_value` | `Number` | 基准值 (元/kWh) |
| `reference_price.source` | `String` | 来源: official / simulated |
| `reference_price.source_month` | `String` | 参考价所属月份 (YYYY-MM) |
| `fixed_prices` | `Object` | 固定分时价格 (固定联动类) `{tip, peak, flat, valley, deep}` |
| `linked_config` | `Object` | 联动配置 (固定联动类) |
| `linked_config.ratio` | `Number` | 联动比例 (%) |
| `linked_config.target` | `String` | 联动标的类型 |
| `linked_config.target_prices` | `Object` | 联动标的分时价格 `{tip, peak, ...}` |
| `final_prices` | `Object` | **最终结算价格** `{tip, peak, flat, valley, deep}` |
| `price_ratio_adjusted` | `Boolean` | 是否经过463号文比例调节 |
| `is_capped` | `Boolean` | 是否触发了封顶保护 |
| `nominal_avg_price` | `Number` | 封顶前的名义均价 (元/kWh) |
| `cap_price` | `Number` | 计算所依据的封顶价基准 (元/kWh) |
| `period_details` | `Array` | 48点明细列表 |
| `period_details.period` | `Integer` | 时段号 (1-48) |
| `period_details.period_type` | `String` | 时段类型 (尖峰/高峰/平段/低谷/深谷) |
| `period_details.load_mwh` | `Number` | 时段电量 (MWh) |
| `period_details.unit_price` | `Number` | 时段单价 (元/kWh) |
| `period_details.fee` | `Number` | 时段电费 (元) |
| `period_details.allocated_cost` | `Number` | 该时段采购分摊成本 (元) |
| `period_details.wholesale_price` | `Number` | 计算该成本所依据的代理拿货单价 (元/MWh) |
| `total_load_mwh` | `Number` | 日总电量 (MWh) |
| `total_fee` | `Number` | 日总电费 (元) |
| `avg_price` | `Number` | 日加权均价 (元/kWh) |
| `total_allocated_cost` | `Number` | 日总采购分摊成本 (元) |
| `gross_profit` | `Number` | 日毛利 (元) |
| `tou_summary` | `Object` | 分时段汇总 `{tip, peak, flat, valley, deep}` |
| `tou_summary.tip.load_mwh` | `Number` | 尖峰总电量 |
| `tou_summary.tip.fee` | `Number` | 尖峰总电费 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 14.2. 索引信息

- `_id_` (默认)
- `customer_id`, `date`, `settlement_type` (唯一复合索引)
- `date`
- `contract_id`






## 15. `settlement_daily` - 批发侧日结算单 (预结算/正式)

该集合存储每日**批发侧**结算结果，用于支持电费账单生成、偏差分析及趋势预测。数据粒度为日汇总+48点明细。

**模型文件**: `webapp/models/settlement.py`

### 15.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID |
| `operating_date` | `String` | 结算日期 (YYYY-MM-DD) |
| `version` | `Integer` | 计算版本号，包括 PRELIMINARY 和 PLATFORM_DAILY 版本 |
| `contract_volume` | `Number` | 中长期合同电量 (MWh) |
| `contract_avg_price` | `Number` | 中长期合同均价 (元/MWh) |
| `contract_fee` | `Number` | 中长期差价电费 (元) |
| `day_ahead_volume` | `Number` | 日前出清电量 (MWh) |
| `day_ahead_fee` | `Number` | 日前差价电费 (元) |
| `real_time_volume` | `Number` | 实际用电量 (MWh) |
| `real_time_fee` | `Number` | 实时全电量电费 (元) |
| `total_energy_fee` | `Number` | 电能量费用合计 (元) |
| `energy_avg_price` | `Number` | 结算均价 (元/MWh) |
| `deviation_recovery_fee` | `Number` | **偏差回收费用** (元，日净额后) |
| `total_standard_value_cost` | `Number` | **标准值费用合计** (元，用于偏差回收计算) |
| `predicted_wholesale_cost` | `Number` | 预测批发总费用 (元，含回收费) |
| `predicted_wholesale_price` | `Number` | 预测批发均价 (元/MWh) |
| `period_details` | `Array` | 48点分时明细 |
| `period_details.period` | `Integer` | 时段号 |
| `period_details.mechanism_volume` | `Number` | 机制电量 |
| `period_details.contract` | `Object` | 中长期分量 `{volume, price, fee}` |
| `period_details.day_ahead` | `Object` | 日前分量 `{volume, price, fee}` |
| `period_details.real_time` | `Object` | 实时分量 `{volume, price, fee}` |
| `period_details.total_energy_fee` | `Number` | 时段电能量费用 |
| `period_details.contract_ratio` | `Number` | 签约比例 (%) |
| `period_details.standard_value_cost` | `Number` | 标准值费用 (模拟) |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 15.2. 索引信息

- `_id_` (默认)
- `operating_date`, `version` (唯一复合索引)
- `operating_date`

---

## 16. `retail_settlement_prices` - 零售结算价格定义

该集合存储平台每月发布的零售侧结算价格定义数据（对应每月发布的"现货市场零售侧结算价格定义"Excel文件），为零售套餐结算时的各类参考价提供数据支撑。

### 16.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 月份字符串（`YYYY-MM`），作为唯一主键 |
| `month` | `String` | 月份（冗余，便于查询），格式 `YYYY-MM` |
| `imported_at` | `DateTime` | 导入时间 |
| `imported_by` | `String` | 导入人 |
| `regular_prices` | `Array` | 常规价格列表（不分时，每月约14种价格类型） |
| `period_prices` | `Array` | 分时价格列表（48个时段，每时段含多种价格） |

#### `regular_prices` 子元素结构

每条记录对应一种价格类型。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `price_type` | `String` | 价格类型原始中文名称 |
| `price_type_key` | `String` | 价格类型英文键名（与零售套餐 `reference_type` 保持一致） |
| `value` | `Number` | 价格数值（元/MWh） |
| `definition` | `String` | 价格定义说明文字 |

**`price_type_key` 枚举值说明**（与 `retail_packages.pricing_config.reference_type` / `linked_target` 命名一致）：

| `price_type_key` | 中文含义 |
| :--- | :--- |
| `market_monthly_avg` | 中长期市场月度交易均价（不分时） |
| `market_annual_avg` | 中长期市场年度交易均价（不分时） |
| `market_avg` | 中长期市场交易均价（不分时） |
| `market_monthly_on_grid` | 中长期市场当月平均上网电价 |
| `retailer_monthly_settle_weighted` | 售电公司月度结算加权价 |
| `retailer_monthly_avg` | 售电公司月度交易均价（不分时） |
| `retailer_annual_avg` | 售电公司年度交易均价（不分时） |
| `retailer_avg` | 售电公司交易均价（不分时） |
| `retailer_side_settle_weighted` | 售电侧月度结算加权价（含批发用户） |
| `real_time_avg` | 省内现货实时市场加权平均价 |
| `coal_capacity_discount` | 煤电容量电费折价 |
| `genside_annual_bilateral` | 发电侧火电年度中长期双边协商交易合同分月平段价 |
| `grid_agency_price` | 电网代理购电价格 |
| `market_longterm_flat_avg` | 市场化用户中长期交易平段合同加权平均价 |

#### `period_prices` 子元素结构

每条记录对应一个时段（1-48），字段名与零售套餐 `reference_type` / `linked_target` 保持一致。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `period` | `Integer` | 时段编号（1-48） |
| `period_type` | `String` | 时段类型：`谷段` / `平段` / `峰段` / `尖峰` |
| `float_ratio` | `Number` | 时段浮动比例（谷0.4 / 平1 / 峰1.6 / 尖峰1.8） |
| `upper_limit_price` | `Number` | 上限价（分时）（元/MWh） |
| `market_monthly_avg` | `Number` | 中长期市场月度交易均价（分时） |
| `market_annual_avg` | `Number` | 中长期市场年度交易均价（分时） |
| `market_avg` | `Number` | 中长期市场交易均价（分时） |
| `market_monthly_on_grid` | `Number` | 中长期市场当月平均上网电价（分时） |
| `retailer_monthly_avg` | `Number` | 售电公司月度交易均价（分时） |
| `retailer_annual_avg` | `Number` | 售电公司年度交易均价（分时） |
| `retailer_avg` | `Number` | 售电公司交易均价（分时） |
| `real_time_avg` | `Number` | 实时市场均价（分时） |
| `day_ahead_avg` | `Number` | 日前市场均价（分时） |
| `genside_annual_bilateral` | `Number` | 发电侧火电年度中长期双边协商交易合同分月平段价（分时） |
| `grid_agency_price` | `Number` | 电网代理购电价格（分时） |

### 16.2. 索引信息

- `_id_`（默认，即月份字符串的唯一主键）
- `month`（唯一索引）
- `imported_at`（时间倒序查询）

---

---

## 17. `wholesale_settlement_monthly` - 批发月度结算台账

该集合存储交易中心发布的**批发侧月度结算**主体数据（按月一条），用于月度台账展示与日清聚合对账分析。

- **数据来源**: 月度结算 Excel（`.xls/.xlsx`）导入  
- **业务约束**:
  - 每月仅保留一条记录（同月覆盖导入）
  - 仅导入本公司主体行
  - 不导入“合计”“全市场合计”行

**实现文件**:
- 服务: `webapp/services/wholesale_monthly_settlement_service.py`
- API: `webapp/api/v1_wholesale_monthly_settlement.py`

### 17.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 月份主键（`YYYY-MM`） |
| `month` | `String` | 月份（冗余字段，`YYYY-MM`） |
| `subject_name` | `String` | 市场主体名称（本公司） |
| `user_type` | `String` | 用户类型（如：售电公司） |
| `agency_purchase_type` | `String` | 代理购电类型 |
| `settlement_items` | `Object` | 月度结算明细对象（见 17.2） |
| `source_file_name` | `String` | 导入文件名 |
| `imported_at` | `DateTime` | 导入时间 |
| `imported_by` | `String` | 导入人 |
| `period_details` | `Array` | 48 点分时明细（基于日清聚合） |
| `reconciliation_results` | `Array` | 日清汇总差异对比结果（导入时计算） |
| `updated_at` | `DateTime` | 最后更新时间 |

### 17.2. `settlement_items` 子结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `contract_volume` | `Number` | 合同电量 |
| `contract_avg_price` | `Number` | 合同均价 |
| `contract_fee` | `Number` | 合同电费 |
| `day_ahead_declared_volume` | `Number` | 日前申报电量 |
| `day_ahead_deviation_fee` | `Number` | 日前偏差电费 |
| `actual_consumption_volume` | `Number` | 实际用电量 |
| `real_time_deviation_fee` | `Number` | 实时偏差电费 |
| `green_transfer_fee` | `Number` | 绿色电能量合同转让收支费用 |
| `daily_24h_total_volume` | `Number` | 日24时段用电量合计 |
| `actual_monthly_volume` | `Number` | 实际月度用电量 |
| `monthly_balancing_volume` | `Number` | 月度调平电量 |
| `monthly_balancing_deviation_rate_pct` | `Number` | 月度调平偏差率(%) |
| `balancing_price` | `Number` | 调平电价 |
| `balancing_fee` | `Number` | 调平电费 |
| `energy_fee_total` | `Number` | 电能量电费 |
| `energy_avg_price` | `Number` | 电能量均价 |
| `gen_side_cost_allocation` | `Number` | 发电侧成本类费用分摊 |
| `congestion_fee_allocation` | `Number` | 阻塞费分摊 |
| `imbalance_fund_allocation` | `Number` | 不平衡资金分摊 |
| `deviation_recovery_fee` | `Number` | 偏差回收费 |
| `deviation_recovery_return_fee` | `Number` | 偏差回收费补偿居农损益后返还 |
| `fund_surplus_deficit_total` | `Number` | 资金余缺费用合计 |
| `settlement_fee_total` | `Number` | 结算电费 |
| `settlement_avg_price` | `Number` | 结算均价 |
| `clearing_retroactive_total_fee` | `Number` | 清算退补总费（展示用） |
| `retroactive_to_retail_users` | `Number` | 退补零售用户（展示用） |
| `retroactive_to_retail_company` | `Number` | 退补售电公司（展示用） |
| `remark` | `String` | 备注信息 |
| `confirmation_status` | `String` | 确认状态（来自文件，仅展示） |
| `confirmation_time` | `String` | 确认时间（来自文件，仅展示） |
| `dispute_content` | `String` | 争议内容（来自文件，仅展示） |

### 17.3. `period_details` 子结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `period` | `Integer` | 时段号 (1-48) |
| `contract` | `Object` | 中长期分量 `{volume, price, fee}` |
| `day_ahead` | `Object` | 日前分量 `{volume, price, fee}` |
| `real_time` | `Object` | 实时分量 `{volume, price, fee}` |
| `total_energy_fee` | `Number` | 时段电能量费用合计 |

### 17.4. `reconciliation_results` 子结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `group_key` | `String` | 分组标识 (contract/day_ahead/...) |
| `group_label` | `String` | 分组显示名称 |
| `metric` | `String` | 指标名 (电量/均价/电费/偏差回收费) |
| `monthly_value` | `Number` | 月结文件中的数值 |
| `daily_agg_value` | `Number` | 日清汇总的数值 |
| `diff` | `Number` | 差异额 |
| `diff_rate_pct` | `Number` | 差异率 (%) |

### 17.3. 索引信息

- `_id_`（默认，月份主键）
- `month`（唯一索引）

### 17.4. 示例文档

```json
{
  "_id": "2026-01",
  "month": "2026-01",
  "subject_name": "国网江西综合能源服务有限公司",
  "user_type": "售电公司",
  "agency_purchase_type": "",
  "settlement_items": {
    "contract_volume": 38650.404,
    "contract_avg_price": 422.566,
    "contract_fee": -1640166.8,
    "day_ahead_declared_volume": 48477.158,
    "day_ahead_deviation_fee": -2007412.79,
    "actual_consumption_volume": 68913.307,
    "real_time_deviation_fee": 31187086.83,
    "green_transfer_fee": 0.0,
    "daily_24h_total_volume": 68913.307,
    "actual_monthly_volume": 68919.909,
    "monthly_balancing_volume": 6.602,
    "monthly_balancing_deviation_rate_pct": 0.01,
    "balancing_price": 460.005,
    "balancing_fee": 3036.95,
    "energy_fee_total": 27542544.19,
    "energy_avg_price": 399.631,
    "gen_side_cost_allocation": 43124.17,
    "congestion_fee_allocation": 430.93,
    "imbalance_fund_allocation": -188417.81,
    "deviation_recovery_fee": 517055.31,
    "deviation_recovery_return_fee": -1092213.77,
    "fund_surplus_deficit_total": -720021.17,
    "settlement_fee_total": 26822523.02,
    "settlement_avg_price": 389.184,
    "clearing_retroactive_total_fee": null,
    "retroactive_to_retail_users": null,
    "retroactive_to_retail_company": null,
    "remark": "",
    "confirmation_status": "已确认",
    "confirmation_time": "2026-02-08 19:12",
    "dispute_content": ""
  },
  "source_file_name": "现货月度结算.xls",
  "imported_at": "2026-03-03T10:00:00",
  "imported_by": "admin",
  "updated_at": "2026-03-03T10:00:00"
}
```

---

## 18. `customer_monthly_energy` - 客户结算月度电量

### 18.1. 集合用途

用于“基础数据导入 -> 客户结算月度电量”子页面，按月份存储客户月度电量导入结果。  
每个月 1 份版本，导入时按月份覆盖（`_id = month`）。

### 18.2. 字段定义

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `_id` | `String` | 文档主键，格式 `YYYY-MM` |
| `month` | `String` | 数据月份，格式 `YYYY-MM` |
| `imported_at` | `DateTime` | 导入时间（UTC） |
| `imported_by` | `String` | 导入操作人 |
| `records` | `Array[Object]` | 当月客户电量明细列表 |
| `records.customer_no` | `String` | 用户号 |
| `records.customer_name` | `String` | 代理零售用户名称 |
| `records.mp_no` | `String` | 计量点号（导入时规范化为字符串，避免 `12345.0`） |
| `records.energy_mwh` | `Number` | 本月电量（MWh） |
| `records.auth_status` | `String` | 用户授权状态 |
| `records.auth_end_date` | `String` | 授权查询截止月份/日期（按原文件内容保存） |

### 18.3. 索引信息

- `_id_`（默认主键索引，月份唯一）
- `month`（建议唯一索引）

### 18.4. 示例文档

```json
{
  "_id": "2026-01",
  "month": "2026-01",
  "imported_at": "2026-03-03T10:00:00Z",
  "imported_by": "admin",
  "records": [
    {
      "customer_no": "320100001234",
      "customer_name": "某工业用户A",
      "mp_no": "120000000123",
      "energy_mwh": 1289.537,
      "auth_status": "已授权",
      "auth_end_date": "2026-12"
    },
    {
      "customer_no": "320100009999",
      "customer_name": "某商业用户B",
      "mp_no": "120000000456",
      "energy_mwh": 0.0,
      "auth_status": "未授权",
      "auth_end_date": ""
    }
  ]
}
```

---

## 19. `retail_settlement_monthly_status` - 零售月度结算状态汇总

### 19.1. 集合用途

用于存储“零售月度结算”每个月的状态与核心汇总指标（按月一条），供月度结算台账读取，并与 `retail_settlement_monthly` 同批次同步更新。

### 19.2. 字段定义

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `_id` | `String` | 文档主键，格式 `YYYY-MM` |
| `month` | `String` | 月份，格式 `YYYY-MM` |
| `wholesale_settled` | `Boolean` | 批发月度结算是否已完成 |
| `wholesale_avg_price` | `Number` | 批发月度结算均价（元/MWh） |
| `balancing_price` | `Number` | 批发月度调平电价（元/MWh） |
| `retail_daily_recomputed` | `Boolean` | 兼容字段（历史流程遗留），当前月结流程固定为 `false` |
| `retail_avg_price` | `Number` | 零售月度均价（元/kWh） |
| `retail_total_energy` | `Number` | 零售月度总电量（MWh，日清+调平口径） |
| `retail_total_fee` | `Number` | 零售月度总电费（元，日清+调平口径，未扣返还） |
| `excess_profit_threshold` | `Number` | 超额收益阈值（元/MWh） |
| `excess_profit_total` | `Number` | 超额收益总额（元） |
| `excess_refund_pool` | `Number` | 超额返还资金池（元） |
| `force` | `Boolean` | 本次结算是否强制重算 |
| `created_at` | `DateTime` | 创建时间（UTC） |
| `updated_at` | `DateTime` | 最后更新时间（UTC） |

### 19.3. 索引信息

- `_id_`（默认主键索引，月份唯一）

---

## 20. `retail_settlement_monthly` - 客户零售月度结算结果

### 20.1. 集合用途

用于存储客户维度的零售月度结算结果明细（按“月份+客户”一条），作为月度结算页面客户明细数据源。该结构对齐 `retail_settlement_daily`，保留月度48时段电量、尖峰平谷汇总及价格计算过程字段。月结流程完成后，会自动触发对 `retail_settlement_daily` 集合中 `settlement_type=monthly` 记录的重算生成。

> 约束：
> 1. 与定价模型相关的字段统一封装在 `price_model` 对象中（保持原有口径与精度）。
> 2. 三阶段字段中的价格（`retail_unit_price` / `wholesale_unit_price` / `price_spread_per_mwh`）统一使用元/MWh，保留3位小数。

### 20.2. 字段定义

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `_id` | `String` | 文档主键，格式 `{month}_{safe_customer_name}` |
| `month` | `String` | 月份，格式 `YYYY-MM` |
| `settlement_type` | `String` | 固定为 `monthly` |
| `customer_id` | `String\|Null` | 客户档案ID（若能解析） |
| `customer_name` | `String` | 客户名称 |
| `contract_id` | `String` | 关联合同ID |
| `package_name` | `String` | 套餐名称 |
| `model_code` | `String` | 定价模型代码 |
| `price_model` | `Object` | 定价模型计算过程对象（保留原有口径） |
| `price_model.reference_price` | `Object\|Null` | 参考价信息（价差分成类） |
| `price_model.reference_price.type` | `String` | 参考价类型（如 `market_monthly_avg`） |
| `price_model.reference_price.base_value` | `Number` | 参考价基准值（元/kWh） |
| `price_model.reference_price.source` | `String` | 参考价来源（`official` / `fallback` 等） |
| `price_model.reference_price.source_month` | `String` | 参考价所属月份（`YYYY-MM`） |
| `price_model.fixed_prices` | `Object\|Null` | 固定分时价格（固定联动类）`{tip, peak, flat, valley, deep}` |
| `price_model.linked_config` | `Object\|Null` | 联动配置（固定联动类） |
| `price_model.linked_config.ratio` | `Number` | 联动比例 |
| `price_model.linked_config.target` | `String` | 联动标的类型 |
| `price_model.linked_config.target_prices` | `Object` | 联动标的分时价格 |
| `price_model.linked_config.target_prices_48` | `Array\|Null` | 联动标的48时段价格向量（如有） |
| `price_model.final_prices` | `Object` | 最终结算分时价格 `{tip, peak, flat, valley, deep}` |
| `price_model.price_ratio_adjusted` | `Boolean` | 是否触发463比例调节 |
| `price_model.price_ratio_adjusted_base` | `Boolean` | 基准分时价是否触发463比例调节 |
| `price_model.is_capped` | `Boolean` | 是否触发封顶保护 |
| `price_model.nominal_avg_price` | `Number` | 封顶前名义均价（元/kWh） |
| `price_model.cap_price` | `Number` | 月度封顶价（元/kWh） |
| `period_details` | `Array` | 月度48时段明细 |
| `period_details.period` | `Integer` | 时段号（1-48） |
| `period_details.period_type` | `String` | 时段类型（尖峰/高峰/平段/低谷/深谷） |
| `period_details.period_type` | `String` | 当月该时段存在混合类型时取值 `period_type_mix` |
| `period_details.period_type_breakdown` | `Array\|Null` | 仅 `period_type_mix` 时存在，按类型拆分的明细数组 |
| `period_details.period_type_breakdown.period_type` | `String` | 分解类型（尖峰/高峰/平段/低谷/深谷） |
| `period_details.period_type_breakdown.load_mwh` | `Number` | 该类型在该时段的月累计电量（MWh） |
| `period_details.period_type_breakdown.fee` | `Number` | 该类型在该时段对应电费（元） |
| `period_details.period_type_breakdown` | `说明` | 月结口径日清重算时，可通过 `fee / load_mwh / 1000` 反推该类型在该时段的月均结算单价（元/kWh） |
| `period_details.load_mwh` | `Number` | 时段电量（MWh） |
| `period_details.unit_price` | `Number` | 时段单价（元/kWh） |
| `period_details.fee` | `Number` | 时段电费（元） |
| `period_details.allocated_cost` | `Number` | 时段采购金额（元，来自 `retail_settlement_daily` 按月聚合） |
| `period_details.wholesale_price` | `Number` | 时段批发均价（元/MWh，`allocated_cost / load_mwh`） |
| `tou_summary` | `Object` | 尖峰平谷汇总 `{tip, peak, flat, valley, deep}` |
| `tou_summary.tip.load_mwh` | `Number` | 尖峰总电量（MWh） |
| `tou_summary.tip.fee` | `Number` | 尖峰总电费（元） |
| `pre_energy_mwh` | `Number` | 调平前电量（MWh） |
| `pre_retail_fee` | `Number` | 调平前零售电费（元） |
| `pre_retail_unit_price` | `Number` | 调平前零售单价（元/MWh，3位） |
| `pre_wholesale_fee` | `Number` | 调平前采购金额（元） |
| `pre_wholesale_unit_price` | `Number` | 调平前采购均价（元/MWh，3位） |
| `pre_gross_profit` | `Number` | 调平前毛利（元） |
| `pre_price_spread_per_mwh` | `Number` | 调平前价差（元/MWh，3位） |
| `sttl_balancing_energy_mwh` | `Number` | 调平电量（MWh） |
| `sttl_balancing_retail_fee` | `Number` | 调平零售电费（元） |
| `sttl_balancing_wholesale_fee` | `Number` | 调平批发金额（元） |
| `sttl_energy_mwh` | `Number` | 调平后电量（MWh） |
| `sttl_retail_fee` | `Number` | 调平后零售电费（元，返还前） |
| `sttl_retail_unit_price` | `Number` | 调平后零售单价（元/MWh，3位） |
| `sttl_wholesale_fee` | `Number` | 调平后采购金额（元） |
| `sttl_wholesale_unit_price` | `Number` | 调平后采购均价（元/MWh，3位） |
| `sttl_gross_profit` | `Number` | 调平后毛利（元，返还前） |
| `sttl_price_spread_per_mwh` | `Number` | 调平后价差（元/MWh，3位） |
| `final_excess_refund_fee` | `Number` | 超额返还金额（元） |
| `final_energy_mwh` | `Number` | 最终结算电量（MWh） |
| `final_retail_fee` | `Number` | 最终零售电费（元，返还后） |
| `final_retail_unit_price` | `Number` | 最终零售单价（元/MWh，3位） |
| `final_wholesale_fee` | `Number` | 最终采购金额（元） |
| `final_wholesale_unit_price` | `Number` | 最终采购均价（元/MWh，3位） |
| `final_gross_profit` | `Number` | 最终毛利（元） |
| `final_price_spread_per_mwh` | `Number` | 最终价差（元/MWh，3位） |
| `created_at` | `DateTime` | 创建时间（UTC） |
| `updated_at` | `DateTime` | 最后更新时间（UTC） |

### 20.3. 索引信息

- `_id_`（默认主键索引）
- `month`（建议索引，支持按月份查询）
- `month + customer_name`（建议唯一索引，防止同月同客户重复）

---

## 21. `retail_monthly_jobs` - 零售月度结算任务进度

### 21.1. 集合用途

用于记录零售月度结算后台任务的执行进度，支撑前端“结算进度”弹窗轮询显示。

### 21.2. 字段定义

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `_id` | `String` | 任务ID（`uuid4().hex`） |
| `month` | `String` | 结算月份（`YYYY-MM`） |
| `status` | `String` | 任务状态：`pending` / `running` / `completed` / `failed` |
| `force` | `Boolean` | 是否强制重算 |
| `total_customers` | `Integer` | 客户总数 |
| `processed_customers` | `Integer` | 已处理客户数 |
| `success_count` | `Integer` | 成功客户数 |
| `failed_count` | `Integer` | 失败客户数 |
| `progress` | `Integer` | 进度百分比（0-100） |
| `current_customer` | `String` | 当前处理客户名称 |
| `message` | `String` | 任务提示信息 |
| `started_at` | `DateTime` | 任务开始时间（UTC） |
| `updated_at` | `DateTime` | 最后更新时间（UTC） |

### 21.3. 索引信息

- `_id_`（默认主键索引）
- `month`（建议索引，支持按月查询任务）
- `updated_at`（建议索引，支持任务清理与排序）


## 22. `trade_declare` - 交易申报记录

该集合存储“交易申报记录”页面下载后的 D-2 交易申报明细数据，采用**按交易日聚合**的文档结构（每个 `trade_date` 一条文档）。

- **数据来源**: `rpa.pipelines.trade_declare`
- **更新频率**: 每日（支持从集合最后一天自动回补到当天）
- **页面路径**: `交易及出清结果 > 交易申报记录`

### 22.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `trade_date` | String | **[主键]** 交易日期，格式 `YYYY-MM-DD`。 |
| `delivery_groups` | Array | 按目标日期分组的申报记录列表。 |
| `delivery_groups.delivery_date` | String | 目标日期（成交时间），格式 `YYYY-MM-DD`。 |
| `delivery_groups.records` | Array | 该目标日期下的全部申报明细记录。 |
| `delivery_groups.records.period` | Number | 时段（1-48）。 |
| `delivery_groups.records.listing_side` | String | 挂牌类型（如“用电侧增持/减持”等）。 |
| `delivery_groups.records.listing_mwh` | Number | 挂牌电量（MWh）。 |
| `delivery_groups.records.listing_price` | Number | 挂牌电价（元/MWh）。 |
| `delivery_groups.records.remaining_mwh` | Number | 剩余电量（MWh）。 |
| `delivery_groups.records.trade_type` | String | 交易类型（如“市场化挂牌”）。 |
| `delivery_groups.records.off_shelf_type` | String | 下架类型（如“自动下架/未下架”）。 |
| `delivery_groups.records.listing_time` | String | 挂牌时间，格式 `YYYY-MM-DD HH:mm:ss`。 |
| `delivery_groups.records.off_shelf_time` | String/Null | 下架时间，格式 `YYYY-MM-DD HH:mm:ss`；未下架时为空。 |
| `delivery_groups.records.record_key` | String | 去重键（基于 trade_date + delivery_date + period + listing_side + listing_mwh + listing_price + listing_time 生成）。 |
| `delivery_dates` | Array | 该交易日包含的全部 `delivery_date` 列表（便于快速检索）。 |
| `record_count` | Number | 该交易日去重后的明细总条数。 |
| `is_empty` | Boolean | 历史回补场景下，若当日无数据会写入空文档并置为 `true`。 |
| `updated_at` | ISODate | 文档最后更新时间。 |

### 22.2. 索引

- `(trade_date: 1)`: 唯一索引，确保每个交易日仅一条聚合文档。
- `(updated_at: -1)`: 普通索引，用于按更新时间倒序查询。

### 22.3. 规则说明

- 同一 `trade_date` 每次执行采用覆盖式 upsert（`replace_one + upsert`），保证当日数据可被最新结果刷新。
- 历史回补时，若某个历史交易日查询无数据，也会写入空文档（`record_count=0, is_empty=true`），避免后续重复对该日期进行空下载。

