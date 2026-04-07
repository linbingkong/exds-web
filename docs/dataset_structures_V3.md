# 意向客户诊断模块数据集结构（V3）

---

## 1. `intent_customer_profiles` - 意向客户主表

该集合存储意向客户诊断模块中的客户主信息、汇总统计和电表配置。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 1.1. 设计说明

- 一条记录对应一个意向客户
- 保存页面顶部和“负荷汇总与完整性信息”面板所需的核心字段
- 同时保存该客户名下电表配置，用于后续导入覆盖、自动聚合和页面展示
- 当前版本未单独设计 `import_batch` 集合，默认一次导入覆盖该客户历史导入数据

### 1.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_name` | `String` | 意向客户名称 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `last_imported_at` | `DateTime` | 最近一次导入时间 |
| `last_aggregated_at` | `DateTime` | 最近一次聚合时间 |
| `coverage_start` | `String` | 数据覆盖起始日期，格式 `YYYY-MM-DD` |
| `coverage_end` | `String` | 数据覆盖结束日期，格式 `YYYY-MM-DD` |
| `coverage_days` | `Number` | 覆盖天数 |
| `missing_days` | `Number` | 缺失天数 |
| `completeness` | `Number` | 完整率 |
| `avg_daily_load` | `Number` | 平均日电量，单位 `MWh` |
| `max_daily_load` | `Number` | 最大日电量，单位 `MWh` |
| `min_daily_load` | `Number` | 最小日电量，单位 `MWh` |
| `missing_meter_days` | `Number` | 存在缺表的天数 |
| `interpolated_days` | `Number` | 存在插值的天数 |
| `dirty_days` | `Number` | 存在脏数据的天数 |
| `meter_count` | `Number` | 电表数量 |
| `meters` | `Array` | 电表配置列表 |
| `meters[].meter_id` | `String` | 电表号 |
| `meters[].account_id` | `String` | 户号 |
| `meters[].extracted_customer_name` | `String` | 从文件中提取的用户名 |
| `meters[].multiplier` | `Number` | 倍率 |
| `meters[].source_filename` | `String` | 来源文件名 |

### 1.3. 索引信息

- `_id_`（默认）
- `customer_name`（唯一索引）
- `updated_at`

---

## 2. `intent_customer_meter_reads_daily` - 意向客户原始电表日数据

该集合存储意向客户模块导入后的原始电表示数，采用按日宽表结构。  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 2.1. 设计说明

- 一条记录表示“某意向客户的某块电表在某一天的原始示数”
- 数据来源于上传的 Excel 文件，经预解析后写入
- 与通用集合 `raw_meter_data` 分开保存，避免污染正式负荷诊断数据源
- 每次对某意向客户重新导入时，默认先删除该客户原有原始记录，再整体重写

### 2.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `meter_id` | `String` | 电表号 |
| `account_id` | `String` | 户号 |
| `date` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `readings` | `Array[96]` | 当日 96 点原始示数 |
| `source_filename` | `String` | 来源文件名 |
| `multiplier` | `Number` | 导入时确认的倍率 |
| `meta` | `Object` | 冗余元数据 |
| `meta.customer_name` | `String` | 文件中提取的用户名 |
| `meta.account_id` | `String` | 文件中提取的户号 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 2.3. 索引信息

- `_id_`（默认）
- `customer_id`, `meter_id`, `date`（唯一复合索引）
- `customer_id`, `date`

---

## 3. `intent_customer_load_curve_daily` - 意向客户聚合负荷日曲线

该集合存储意向客户聚合后的 48 点负荷结果，采用按日宽表结构。  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)  
**复用算法来源**: [`webapp/services/load_aggregation_service.py`](/d:/Gitworks/exds-web/webapp/services/load_aggregation_service.py)

### 3.1. 设计说明

- 一条记录表示“某意向客户在某一天的 48 点聚合负荷结果”
- 聚合过程复用了 `LoadAggregationService.calculate_meter_48_points()` 的核心算法
- 当前版本聚合时默认所有电表直接求和，未启用 `allocation_ratio`
- 如果某天部分电表缺失，系统仍允许聚合，但会记录 `missing_meters`

### 3.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `date` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `values` | `Array[48]` | 聚合后的 48 点电量数组，单位 `MWh` |
| `total` | `Number` | 当日电量合计，单位 `MWh` |
| `meter_count` | `Number` | 实际参与聚合的电表数 |
| `missing_meters` | `Array[String]` | 当天缺失的电表号列表 |
| `data_quality` | `Object` | 数据质量信息 |
| `data_quality.interpolated_points` | `Array[Number]` | 插值点索引（按 48 点口径） |
| `data_quality.dirty_points` | `Array[Number]` | 脏数据点索引（按 48 点口径） |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 3.3. 索引信息

- `_id_`（默认）
- `customer_id`, `date`（唯一复合索引）

---

## 4. 与模块相关的现有复用集合

以下集合不是本模块新增，但与当前实现直接相关：

### 4.1. `raw_meter_data`

- 位置：`dataset_structures_v2.md`
- 用途：通用负荷诊断模块的原始电表示数数据源
- 关系：意向客户诊断模块当前不直接写入该集合，改为写入 `intent_customer_meter_reads_daily`

### 4.2. `customer_archives`

- 位置：`dataset_structures_v2.md`
- 用途：正式客户档案
- 关系：意向客户诊断模块当前不直接复用正式客户档案，改用独立主表 `intent_customer_profiles`

### 4.3. `wholesale_settlement_monthly`

- 用途：正式批发月结结果
- 关系：意向客户批发模拟会读取该集合中的正式批发月结 `settlement_items`，结合意向客户负荷曲线生成批发侧模拟结果

### 4.4. `retail_packages`

- 用途：零售套餐主数据
- 关系：意向客户零售模拟只允许选择状态为 `active` 的零售套餐，并按 `package_id` 读取其定价模型配置

---

## 5. `intent_customer_monthly_wholesale` - 意向客户批发侧月度模拟结算结果

该集合用于保存意向客户在“批发结算模拟”Tab 子页面中的月度批发侧计算结果。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 5.1. 设计说明

- 一条记录对应“一个意向客户 + 一个结算月份”
- 同一意向客户同一月份只有一条记录
- 唯一键为 `customer_id + settlement_month`
- `_id` 当前格式为 `{customer_id}_{settlement_month}`
- 每次执行“计算批发侧结算”时，按唯一键覆盖原有记录
- 页面打开批发结算模拟 Tab 子页面时，默认读取该集合中已保存的结果并直接展示

### 5.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 记录主键，格式 `{customer_id}_{settlement_month}` |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `settlement_month` | `String` | 结算月份，格式 `YYYY-MM` |
| `calc_status` | `String` | 计算状态，当前成功时为 `success` |
| `calc_message` | `String` | 结果消息 |
| `summary` | `Object` | 月度汇总结果 |
| `summary.settlement_month` | `String` | 结算月份 |
| `summary.total_energy_mwh` | `Number` | 总电量，单位 `MWh` |
| `summary.daily_cost_total` | `Number` | 每日成本汇总，单位 `元` |
| `summary.daily_cost_unit_price` | `Number` | 每日成本均价，按 `daily_cost_total / total_energy_mwh` 计算，单位 `元/MWh` |
| `summary.surplus_unit_price` | `Number` | 资金余缺分摊单价，单位 `元/MWh` |
| `summary.surplus_cost` | `Number` | 资金余缺分摊金额，单位 `元` |
| `summary.total_cost` | `Number` | 批发总成本，单位 `元` |
| `summary.unit_cost_yuan_per_mwh` | `Number` | 批发单价，单位 `元/MWh` |
| `summary.unit_cost_yuan_per_kwh` | `Number` | 批发单价，单位 `元/kWh` |
| `summary.status` | `String` | 月度结果状态 |
| `summary.message` | `String` | 月度结果消息 |
| `period_details` | `Array[48]` | 48 时段成本明细 |
| `period_details[].period` | `Number` | 时段序号，1~48 |
| `period_details[].time_label` | `String` | 时段标签，如 `00:00-00:30` |
| `period_details[].load_mwh` | `Number` | 该时段月累计电量，单位 `MWh` |
| `period_details[].daily_cost_total` | `Number` | 该时段每日成本汇总，单位 `元` |
| `period_details[].surplus_cost` | `Number` | 该时段资金余缺分摊金额，单位 `元` |
| `period_details[].total_cost` | `Number` | 该时段总成本，单位 `元` |
| `period_details[].period_type` | `String` | 月度时段类型，取值为 `尖峰 / 高峰 / 平段 / 低谷 / 深谷 / period_type_mix` |
| `period_details[].daily_cost_unit_price` | `Number` | 该时段每日成本均价，单位 `元/MWh` |
| `period_details[].final_unit_price` | `Number` | 该时段最终单价，单位 `元/MWh` |
| `daily_details` | `Array` | 每日成本明细 |
| `daily_details[].date` | `String` | 日期，格式 `YYYY-MM-DD` |
| `daily_details[].total_energy_mwh` | `Number` | 当日总电量，单位 `MWh` |
| `daily_details[].daily_cost_total` | `Number` | 当日每日成本汇总，单位 `元` |
| `daily_details[].surplus_cost` | `Number` | 当日资金余缺分摊金额，单位 `元` |
| `daily_details[].total_cost` | `Number` | 当日总成本，单位 `元` |
| `daily_details[].unit_cost_yuan_per_mwh` | `Number` | 当日日均成本单价，单位 `元/MWh` |
| `created_at` | `DateTime` | 首次创建时间 |
| `updated_at` | `DateTime` | 最近更新时间 |

### 5.3. 索引信息

- `_id_`（默认）
- `customer_id`, `settlement_month`（唯一复合索引）
- `customer_id`, `updated_at`

---

## 6. `intent_customer_monthly_retail_simulation` - 意向客户零售侧月度模拟结算结果

该集合用于保存意向客户在“零售结算模拟”Tab 子页面中的套餐级零售结算结果。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_retail_simulation_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_retail_simulation_service.py)

### 6.1. 设计说明

- 一条记录对应“一个意向客户 + 一个结算月份 + 一个零售套餐”
- 同一客户、同一月份、同一套餐只有一条记录
- 唯一键为 `customer_id + settlement_month + package_id`
- `_id` 当前格式为 `{customer_id}_{settlement_month}_{package_id}`
- 套餐来源为 `retail_packages` 中状态为 `active` 的零售套餐
- 发起“增加套餐结算”时，系统会基于当前客户已有的批发模拟月份，批量生成该套餐在所有月份的零售模拟结果
- 页面中“已计算套餐”列表直接从该结果集聚合获取，不再单独维护客户套餐集合
- 删除套餐时，会删除该客户该套餐下所有月份的模拟结果

### 6.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 记录主键，格式 `{customer_id}_{settlement_month}_{package_id}` |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `settlement_month` | `String` | 结算月份，格式 `YYYY-MM` |
| `package_id` | `String` | 关联 `retail_packages._id` |
| `package_name` | `String` | 冗余套餐名称 |
| `model_code` | `String` | 套餐定价模型编码 |
| `price_model` | `Object` | 套餐价格模型快照 |
| `price_model.reference_price` | `Object` | 参考价来源与数值快照 |
| `price_model.fixed_prices` | `Object` | 固定价格配置快照 |
| `price_model.linked_config` | `Object` | 联动价格配置快照 |
| `price_model.final_prices` | `Object` | 5 段最终价格，键为 `tip / peak / flat / valley / deep` |
| `price_model.final_prices_48` | `Array[48]` | 规则日模板 48 时段结算价格 |
| `price_model.price_ratio_adjusted` | `Boolean` | 是否进行了 436 号文比例校核调整 |
| `price_model.price_ratio_adjusted_base` | `Boolean` | 比例校核前是否基于基准价调整 |
| `price_model.is_capped` | `Boolean` | 是否触发封顶 |
| `price_model.nominal_avg_price` | `Number` | 名义均价，单位 `元/kWh` |
| `price_model.cap_price` | `Number` | 封顶均价，单位 `元/kWh` |
| `price_model.package_type` | `String` | 套餐类型 |
| `price_model.is_green_power` | `Boolean` | 是否绿电套餐 |
| `pre_stage` | `Object` | 阶段一：48 时段数据结算结果 |
| `pre_stage.energy_mwh` | `Number` | 结算电量，单位 `MWh` |
| `pre_stage.retail_fee` | `Number` | 零售电费，单位 `元` |
| `pre_stage.retail_unit_price` | `Number` | 零售单价，单位 `元/MWh` |
| `pre_stage.wholesale_fee` | `Number` | 批发成本，单位 `元` |
| `pre_stage.wholesale_unit_price` | `Number` | 批发单价，单位 `元/MWh` |
| `pre_stage.gross_profit` | `Number` | 毛利，单位 `元` |
| `pre_stage.price_spread_per_mwh` | `Number` | 批零价差，单位 `元/MWh` |
| `sttl_stage` | `Object` | 阶段二：申报数据结算结果 |
| `sttl_stage.balancing_energy_mwh` | `Number` | 调平电量，单位 `MWh` |
| `sttl_stage.balancing_retail_fee` | `Number` | 调平零售电费，单位 `元` |
| `sttl_stage.balancing_wholesale_fee` | `Number` | 调平批发电费，单位 `元` |
| `sttl_stage.energy_mwh` | `Number` | 调平后结算电量，单位 `MWh` |
| `sttl_stage.retail_fee` | `Number` | 调平后零售电费，单位 `元` |
| `sttl_stage.retail_unit_price` | `Number` | 调平后零售单价，单位 `元/MWh` |
| `sttl_stage.wholesale_fee` | `Number` | 调平后批发成本，单位 `元` |
| `sttl_stage.wholesale_unit_price` | `Number` | 调平后批发单价，单位 `元/MWh` |
| `sttl_stage.gross_profit` | `Number` | 调平后毛利，单位 `元` |
| `sttl_stage.price_spread_per_mwh` | `Number` | 调平后批零价差，单位 `元/MWh` |
| `refund_context` | `Object` | 超额返还上下文 |
| `refund_context.trigger_excess_refund` | `Boolean` | 是否触发超额返还 |
| `refund_context.retail_avg_price_before_refund` | `Number` | 返还前零售均价，单位 `元/MWh` |
| `refund_context.wholesale_avg_price` | `Number` | 批发均价，单位 `元/MWh` |
| `refund_context.excess_profit_threshold_per_mwh` | `Number` | 超额返还阈值，单位 `元/MWh` |
| `refund_context.excess_profit_per_mwh` | `Number` | 超额利润单价，单位 `元/MWh` |
| `refund_context.refund_pool` | `Number` | 本条模拟结果的返还金额，单位 `元` |
| `refund_context.refund_allocated_method` | `String` | 当前返还分配方式，固定为 `single_customer_full_amount` |
| `final_stage` | `Object` | 阶段三：最终结算结果 |
| `final_stage.excess_profit_threshold_per_mwh` | `Number` | 超额返还阈值，单位 `元/MWh` |
| `final_stage.excess_profit_total` | `Number` | 超额利润总额，单位 `元` |
| `final_stage.excess_refund_ratio` | `Number` | 返还比例 |
| `final_stage.excess_refund_pool` | `Number` | 返还池金额，单位 `元` |
| `final_stage.excess_refund_fee` | `Number` | 返还金额，单位 `元` |
| `final_stage.energy_mwh` | `Number` | 最终结算电量，单位 `MWh` |
| `final_stage.retail_fee` | `Number` | 最终零售电费，单位 `元` |
| `final_stage.retail_unit_price` | `Number` | 最终零售单价，单位 `元/MWh` |
| `final_stage.wholesale_fee` | `Number` | 最终批发成本，单位 `元` |
| `final_stage.wholesale_unit_price` | `Number` | 最终批发单价，单位 `元/MWh` |
| `final_stage.gross_profit` | `Number` | 最终毛利，单位 `元` |
| `final_stage.price_spread_per_mwh` | `Number` | 最终批零价差，单位 `元/MWh` |
| `final_stage.gross_margin` | `Number` | 最终毛利率 |
| `period_details` | `Array[48]` | 48 时段零售结算明细 |
| `period_details[].period` | `Number` | 时段序号，1~48 |
| `period_details[].time_label` | `String` | 时段标签，如 `00:00-00:30` |
| `period_details[].period_type` | `String` | 时段类型，取值为 `尖峰 / 高峰 / 平段 / 低谷 / 深谷 / period_type_mix` |
| `period_details[].load_mwh` | `Number` | 时段电量，单位 `MWh` |
| `period_details[].unit_price` | `Number` | 零售结算单价，单位 `元/kWh` |
| `period_details[].fee` | `Number` | 零售结算电费，单位 `元` |
| `period_details[].wholesale_price` | `Number` | 批发单价，单位 `元/MWh` |
| `period_details[].allocated_cost` | `Number` | 批发成本，单位 `元` |
| `period_details[].retail_unit_price` | `Number` | 零售结算单价，单位 `元/MWh` |
| `period_details[].retail_revenue` | `Number` | 零售收入，单位 `元` |
| `period_details[].wholesale_unit_price` | `Number` | 批发单价，单位 `元/MWh` |
| `period_details[].wholesale_cost` | `Number` | 批发成本，单位 `元` |
| `period_details[].gross_profit` | `Number` | 毛利，单位 `元` |
| `period_details[].spread_yuan_per_mwh` | `Number` | 批零价差，单位 `元/MWh` |
| `period_details[].period_type_breakdown` | `Array` | 混合时段的分项拆解 |
| `daily_details` | `Array` | 月度日度结算明细 |
| `daily_details[].date` | `String` | 日期，格式 `YYYY-MM-DD` |
| `daily_details[].total_load_mwh` | `Number` | 当日电量，单位 `MWh` |
| `daily_details[].total_allocated_cost` | `Number` | 当日批发成本，单位 `元` |
| `daily_details[].total_fee` | `Number` | 当日零售电费，单位 `元` |
| `daily_details[].gross_profit` | `Number` | 当日毛利，单位 `元` |
| `daily_details[].avg_price` | `Number` | 当日零售均价，单位 `元/MWh` |
| `daily_details[].retail_avg_price` | `Number` | 当日零售均价，单位 `元/MWh` |
| `daily_details[].wholesale_avg_price` | `Number` | 当日批发均价，单位 `元/MWh` |
| `daily_details[].price_spread_per_mwh` | `Number` | 当日批零价差，单位 `元/MWh` |
| `daily_details[].period_breakdown` | `Object` | 当日峰平谷深谷电量拆分 |
| `pre_energy_mwh` | `Number` | `pre_stage.energy_mwh` 的平铺字段 |
| `pre_retail_fee` | `Number` | `pre_stage.retail_fee` 的平铺字段 |
| `pre_retail_unit_price` | `Number` | `pre_stage.retail_unit_price` 的平铺字段 |
| `pre_wholesale_fee` | `Number` | `pre_stage.wholesale_fee` 的平铺字段 |
| `pre_wholesale_unit_price` | `Number` | `pre_stage.wholesale_unit_price` 的平铺字段 |
| `pre_gross_profit` | `Number` | `pre_stage.gross_profit` 的平铺字段 |
| `pre_price_spread_per_mwh` | `Number` | `pre_stage.price_spread_per_mwh` 的平铺字段 |
| `sttl_balancing_energy_mwh` | `Number` | `sttl_stage.balancing_energy_mwh` 的平铺字段 |
| `sttl_balancing_retail_fee` | `Number` | `sttl_stage.balancing_retail_fee` 的平铺字段 |
| `sttl_balancing_wholesale_fee` | `Number` | `sttl_stage.balancing_wholesale_fee` 的平铺字段 |
| `sttl_energy_mwh` | `Number` | `sttl_stage.energy_mwh` 的平铺字段 |
| `sttl_retail_fee` | `Number` | `sttl_stage.retail_fee` 的平铺字段 |
| `sttl_retail_unit_price` | `Number` | `sttl_stage.retail_unit_price` 的平铺字段 |
| `sttl_wholesale_fee` | `Number` | `sttl_stage.wholesale_fee` 的平铺字段 |
| `sttl_wholesale_unit_price` | `Number` | `sttl_stage.wholesale_unit_price` 的平铺字段 |
| `sttl_gross_profit` | `Number` | `sttl_stage.gross_profit` 的平铺字段 |
| `sttl_price_spread_per_mwh` | `Number` | `sttl_stage.price_spread_per_mwh` 的平铺字段 |
| `final_energy_mwh` | `Number` | `final_stage.energy_mwh` 的平铺字段 |
| `final_retail_fee` | `Number` | `final_stage.retail_fee` 的平铺字段 |
| `final_retail_unit_price` | `Number` | `final_stage.retail_unit_price` 的平铺字段 |
| `final_wholesale_fee` | `Number` | `final_stage.wholesale_fee` 的平铺字段 |
| `final_wholesale_unit_price` | `Number` | `final_stage.wholesale_unit_price` 的平铺字段 |
| `final_gross_profit` | `Number` | `final_stage.gross_profit` 的平铺字段 |
| `final_price_spread_per_mwh` | `Number` | `final_stage.price_spread_per_mwh` 的平铺字段 |
| `final_excess_refund_fee` | `Number` | `final_stage.excess_refund_fee` 的平铺字段 |
| `created_at` | `DateTime` | 首次创建时间 |
| `updated_at` | `DateTime` | 最近更新时间 |

### 6.3. 索引信息

- `_id_`（默认）
- `customer_id`, `settlement_month`, `package_id`（唯一复合索引）
- `customer_id`, `package_id`, `updated_at`

---

## 7. 当前版本边界说明

### 7.1. 已实现

- 意向客户主表保存
- 原始电表日数据保存
- 聚合负荷日曲线保存
- 批发侧月度模拟结果保存
- 零售侧套餐化月度模拟结果保存
- 活跃零售套餐选择、批量计算与删除
- 页面按月、按日、按 48 时段读取和展示模拟结果

### 7.2. 当前未实现或未启用

- `intent_customer_import_batches` 独立导入批次表
- 电表 `allocation_ratio` 分摊系数
- 严格“缺一块表则整天禁止聚合”的门禁策略
- 与正式客户档案、正式统一负荷曲线的数据同步
- 意向客户零售模拟复用正式月结的“全员统一返还单价”口径

---

## 8. 命名汇总

本模块当前新增的 5 个核心集合如下：

- `intent_customer_profiles`
- `intent_customer_meter_reads_daily`
- `intent_customer_load_curve_daily`
- `intent_customer_monthly_wholesale`
- `intent_customer_monthly_retail_simulation`

---

## 7. `day_ahead_energy_declare` - 日前申报电量

该集合用于存储日前申报电量时序数据，供交易复盘、结算等模块使用。  
**代码依据**: [`webapp/services/settlement_service.py`](/d:/Gitworks/exds-web/webapp/services/settlement_service.py)、[`webapp/services/trade_review_service.py`](/d:/Gitworks/exds-web/webapp/services/trade_review_service.py)

### 7.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `date_str` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `datetime` | `DateTime` | 时间戳，支持按日区间查询（`(date, date+1]`） |
| `time_str` | `String` | 时刻标签（常见为 96 点：`00:15` ... `24:00`） |
| `energy_mwh` | `Number` | 该时刻申报电量，单位 `MWh` |
| `period` | `Number` | 可选字段，时段序号（如 1~48 或 1~96） |

### 7.2. 使用口径（当前实现）

- 复盘与结算的 48 时段口径由原始序列重采样得到。
- 当源数据为 96 点时：按相邻两个点求和聚合为 48 点（电量口径使用 `sum`，非 `mean`）。
- 当源数据为 48 点时：直接使用。
- 查询优先级：优先按 `date_str` 查询；若无结果，回退到 `datetime` 日区间查询。

### 7.3. 相关说明

- 该集合是“日前交易复盘”页面申报电量曲线与红点标注的核心数据源。
- 盈亏计算中使用的申报电量即来自该集合重采样后的 48 时段序列。

---

## 9. 用户权限与认证数据集（1.2）

本章节补充用户权限管理 1.2 相关的数据集合结构，依据当前实现：
- `webapp/scripts/init_auth_data.py`
- `webapp/main.py`
- `webapp/api/v1_auth.py`
- `webapp/models/auth.py`
- `webapp/tools/security.py`

### 9.1 `auth_modules` - 模块字典

用途：定义菜单模块、模块编码与路由归属，是 `module:{module_code}:{view/edit}` 的源头。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `module_code` | `String` | 模块唯一编码（唯一索引），如 `customer_profiles` |
| `module_name` | `String` | 模块显示名称 |
| `menu_group` | `String` | 上级菜单分组 |
| `route_paths` | `Array[String]` | 模块关联路由列表 |
| `sort_order` | `Number` | 排序值 |
| `is_active` | `Boolean` | 是否启用 |
| `is_system` | `Boolean` | 是否系统内置 |
| `seed_version` | `String` | 初始化版本标识（当前 `1.1`） |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `module_code`（唯一）
- `(menu_group, sort_order)`

### 9.2 `auth_permissions` - 权限点字典

用途：存放模块两档权限、例外权限、以及为兼容后端保留的 legacy 动作级权限。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `String` | 权限码（唯一索引），如 `module:customer_profiles:edit` |
| `name` | `String` | 权限名称 |
| `module` | `String` | 逻辑模块（模块码或 `exception`/legacy 域） |
| `module_code` | `String \| null` | 模块权限时为模块码，例外/legacy 可为空 |
| `action` | `String` | 动作（`view/edit/manage/create/...`） |
| `permission_type` | `String` | `module_view/module_edit/exception/legacy_action` |
| `is_exception` | `Boolean` | 是否例外权限 |
| `is_system` | `Boolean` | 是否系统内置 |
| `is_active` | `Boolean` | 是否启用 |
| `description` | `String` | 说明 |
| `seed_version` | `String` | 初始化版本标识 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `code`（唯一）
- `(module_code, permission_type)`
- `(is_exception, is_active)`

### 9.3 `auth_roles` - 角色定义

用途：定义角色及其权限集合，当前内置 `super_admin/system_admin/business_admin/analyst/viewer`。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `String` | 角色编码（唯一），如 `viewer` |
| `name` | `String` | 角色名称 |
| `description` | `String` | 角色描述 |
| `permissions` | `Array[String]` | 权限码列表（内嵌） |
| `is_system` | `Boolean` | 是否系统内置角色 |
| `is_active` | `Boolean` | 是否启用 |
| `seed_version` | `String` | 初始化版本标识 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `code`（唯一）
- `is_active`

### 9.4 `users` - 用户与角色绑定（权限相关字段）

用途：保存用户账号，同时通过 `roles` 与 `auth_roles` 关联，运行时汇总得到最终权限。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `username` | `String` | 用户名（唯一索引） |
| `hashed_password` | `String` | 加密密码 |
| `display_name` | `String` | 显示名 |
| `email` | `String` | 邮箱 |
| `email_verified` | `Boolean` | 邮箱是否已验证 |
| `roles` | `Array[String]` | 角色编码列表 |
| `is_active` | `Boolean` | 是否启用 |
| `must_change_password` | `Boolean` | 是否首次登录强制改密 |
| `password_changed_at` | `String(DateTime ISO)` | 密码最近修改时间 |
| `security_actions_completed_at` | `String(DateTime ISO) \| null` | 首登安全动作全部完成时间 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |
| `last_active_at` | `String(DateTime ISO)` | 最后活跃时间 |
| `current_session_sid` | `String` | 当前有效会话 SID（单账号互斥登录） |
| `login_failed_count` | `Number` | 连续登录失败次数 |
| `login_locked_until` | `String(DateTime ISO) \| null` | 临时锁定截止时间 |
| `last_login_failed_at` | `String(DateTime ISO) \| null` | 最近一次登录失败时间 |

索引（权限体系直接依赖）：
- `username`（唯一）
- `roles`
- `last_active_at`

### 9.5 `auth_audit_logs` - 权限审计日志

用途：记录认证与授权相关审计事件（来源包括 `/api/v1/token` 登录流程、`/api/v1/auth/*` 用户角色权限管理接口）。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `event` | `String` | 审计事件类型 |
| `operator` | `String` | 操作人用户名 |
| `target` | `String` | 被操作对象（角色码/用户名等） |
| `detail` | `Object` | 事件详情（不同事件字段不同） |
| `created_at` | `String(DateTime ISO)` | 记录时间 |

当前已落地事件（代码已实现）：
- 登录相关：`AUTH_LOGIN_FAILED`、`AUTH_LOGIN_BLOCKED_LOCKED`、`AUTH_LOGIN_LOCKED`、`AUTH_LOGIN_CONFLICT`、`AUTH_SESSION_KICKED`、`AUTH_LOGIN_SUCCESS`
- 首登安全相关：`AUTH_REQUIRED_ACTIONS_TRIGGERED`、`AUTH_PASSWORD_CHANGED_BY_REQUIRED_ACTION`、`AUTH_EMAIL_BIND_SENT`、`AUTH_EMAIL_VERIFIED`、`AUTH_REQUIRED_ACTIONS_COMPLETED`
- 忘记密码相关：`AUTH_FORGOT_PASSWORD_CODE_SENT`、`AUTH_FORGOT_PASSWORD_RESET_SUCCESS`、`AUTH_FORGOT_PASSWORD_RESET_FAILED`
- 个人账号：`SELF_PROFILE_UPDATED`、`SELF_PASSWORD_CHANGED`
- 角色管理：`ROLE_CREATED`、`ROLE_UPDATED`、`ROLE_PERMISSIONS_UPDATED`、`ROLE_DELETED`
- 用户管理：`USER_CREATED`、`USER_ROLES_UPDATED`、`USER_ENABLED`、`USER_DISABLED`、`USER_PASSWORD_RESET`、`USER_DELETED`

`detail` 字段常见结构：
- 登录地理信息：`detail.login_ip`、`detail.login_city`
- 会话信息：`detail.sid`、`detail.active_sid`、`detail.kicked_sid`、`detail.force_login`、`detail.reason`
- 变更前后对比：`detail.before`、`detail.after`
- 其他上下文：例如 `roles`、`used_default_password`、`name` 等

建议索引（当前代码未统一创建，建议补齐）：
- `(created_at)`
- `(operator, created_at)`
- `(event, created_at)`

### 9.6 `auth_sessions` - 登录会话记录

用途：记录用户会话生命周期，用于在线会话、登录历史、登出时间与会话时长查询。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `username` | `String` | 用户名 |
| `sid` | `String` | 会话ID（JWT内嵌） |
| `status` | `String` | 会话状态：`active/logout/kicked/expired` |
| `login_at` | `String(DateTime ISO)` | 登录时间 |
| `logout_at` | `String(DateTime ISO)` | 登出/失效时间 |
| `duration_seconds` | `Number` | 会话时长（秒） |
| `login_ip` | `String` | 登录 IP |
| `login_city` | `String` | 登录城市（IP2Region 解析） |
| `logout_reason` | `String` | 下线原因（如 `user_logout/force_login/token_expired/idle_timeout`） |
| `expires_at` | `String(DateTime ISO)` | 会话过期时间 |
| `last_seen_at` | `String(DateTime ISO)` | 最近活跃时间（心跳刷新） |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引（已在代码中创建）：
- `(username, status)`
- `(sid)` 唯一
- `(expires_at)`
- `(login_at)`

### 9.7 `auth_security_challenges` - 首登安全挑战会话

用途：在账号密码校验通过但仍存在必做安全动作时，保存短期 challenge 会话；完成全部动作前，不创建正式业务会话。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `cid` | `String` | challenge ID（唯一索引） |
| `username` | `String` | 用户名 |
| `required_actions` | `Array[String]` | 当前待完成动作列表，取值如 `CHANGE_PASSWORD/BIND_EMAIL/VERIFY_EMAIL` |
| `status` | `String` | challenge 状态：`active/completed/expired/replaced/failed` |
| `login_ip` | `String` | 触发 challenge 时的登录 IP |
| `login_city` | `String` | 触发 challenge 时的登录城市 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |
| `expires_at` | `String(DateTime ISO)` | challenge 过期时间 |
| `invalidated_at` | `String(DateTime ISO)` | challenge 失效时间 |

索引（已在代码中创建）：
- `(cid)` 唯一
- `(username, status, created_at)`
- `(expires_at)`

### 9.8 `auth_email_challenges` - 邮箱验证码挑战记录

用途：保存首登邮箱绑定/验证流程中的验证码记录，验证码仅存哈希，不存明文。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `challenge_id` | `String` | 验证码挑战ID（唯一索引） |
| `username` | `String` | 用户名 |
| `email` | `String` | 本次验证的邮箱 |
| `scene` | `String` | 验证码使用场景，如 `first_login_verify_email`、`forgot_password` |
| `code_hash` | `String` | 验证码哈希 |
| `expire_at` | `String(DateTime ISO)` | 验证码过期时间 |
| `used_at` | `String(DateTime ISO) \| null` | 验证码使用时间 |
| `send_count` | `Number` | 当前验证码发送次数 |
| `verify_failed_count` | `Number` | 当前验证码校验失败次数 |
| `last_sent_at` | `String(DateTime ISO)` | 最近一次发送时间 |
| `request_ip` | `String` | 请求来源 IP |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引（已在代码中创建）：
- `(challenge_id)` 唯一
- `(username, email, used_at, expire_at)`

### 9.9 关系与读取路径说明

1. 登录后前端调用 `/api/v1/auth/me`，后端按 `users.roles -> auth_roles.permissions` 聚合权限码。  
2. 前端路由、菜单与按钮按权限码做 `view/edit` 前置控制。  
3. 后端写接口使用 `require_permission(...)` 做最终兜底。  
4. 若 `/api/v1/token` 发现 `users.must_change_password=true`、`email` 为空或 `email_verified=false`，则先创建 `auth_security_challenges`，返回 `challenge_token + required_actions`。  
5. 首登安全页通过 `/api/v1/auth/security/*` 推进动作；邮箱验证码明细写入 `auth_email_challenges`。  
6. 全部安全动作完成后，后端才创建 `auth_sessions` 并回写 `users.security_actions_completed_at/current_session_sid`。  
7. 角色权限变更后，用户下次请求 `auth/me` 即可获取最新权限快照。



## 10. `contracts_detailed_daily` - 中长期日分解合同（明细）

该集合存储按天分解的、精细到具体合同的“市场化”和“绿电”中长期交易数据。

- **数据来源**: `rpa.pipelines.long_term_contracts`
- **更新频率**: 每日

### 10.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `合同名称` | String | **[复合主键]** 合同的唯一名称。 |
| `date` | String | **[复合主键]** 数据所属日期，格式 `YYYY-MM-DD`。 |
| `periods` | Array | 包含分时段数据的数组，每个元素是一个对象。 |
| `periods.period` | Number | 时段序号 (1-48)。 |
| `periods.quantity_mwh` | Number | 该时段的合同电量 (MWh)。 |
| `periods.price_yuan_per_mwh` | Number | 该时段的合同电价 (元/MWh)。 |
| `daily_total_quantity` | Number | 当日总电量 (MWh)。 |
| `daily_avg_price` | Number | 当日加权平均价 (元/MWh)。 |
| `contract_type` | String | 合同类型，如 "市场化", "绿电"。 |
| `contract_period` | String | 合同周期，如 "年度", "月度", "月内"。 |
| `entity` | String | 实体，固定为 "售电公司"。 |
| `合同类型` | String | 原始合同类型。 |
| `交易序列名称` | String | 交易序列的名称。 |
| `售方名称` | String | 合同的售方。 |
| `购方名称` | String | 合同的购方。 |
| `购电类型` | String | 购电类型。 |

### 10.2. 索引

- `(合同名称: 1, date: 1)`: 唯一复合索引，确保每个合同每天的数据唯一。
- `(contract_type: 1, contract_period: 1, date: -1)`: 普通复合索引，用于快速查询特定类型和周期的合同数据。

---

## 11. `contracts_aggregated_daily` - 中长期日分解合同（聚合）

该集合存储按天、按合同类型、按合同周期聚合的中长期交易数据。

- **数据来源**: `rpa.pipelines.long_term_contracts`
- **更新频率**: 每日

### 11.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `entity` | String | **[复合主键]** 实体，如 "全市场", "售电公司"。 |
| `date` | String | **[复合主键]** 数据所属日期，格式 `YYYY-MM-DD`。 |
| `contract_type` | String | **[复合主键]** 合同类型，如 "整体", "市场化", "绿电"。 |
| `contract_period` | String | **[复合主键]** 合同周期，如 "整体", "年度", "月度"。 |
| `periods` | Array | 包含分时段数据的数组，结构同 `contracts_detailed_daily`。 |
| `daily_total_quantity` | Number | 当日总电量 (MWh)。 |
| `daily_avg_price` | Number | 当日加权平均价 (元/MWh)。 |

### 11.2. 索引

- `(entity: 1, date: 1, contract_type: 1, contract_period: 1)`: 唯一复合索引，确保每个维度组合下的日聚合数据唯一。

---

## 12. `trade_review_monthly_summary` - 月度交易复盘聚合结果

该集合用于保存“按月聚合后的交易复盘结果”，供“月度交易复盘”页面直接读取。

- **用途定位**: 结果集 / 预聚合集
- **设计目标**:
  1. 统一页面卡片、日度 Tab、48 时段 Tab 的指标口径
  2. 避免前端每次打开页面都跨多个原始集合实时重算
  3. 为后续重算、版本升级、自动诊断预留结果落点

### 12.1. 设计说明

- 一条记录对应“一个统计月份”的复盘结果
- 建议主键使用 `month`
- 首版只保存当前有效版本；如后续需要保留历史版本，可扩展 `_id = {month}_{version}`
- 本集合不替代原始数据源，仅沉淀标准化复盘结果

### 12.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 记录主键，建议为 `YYYY-MM` |
| `month` | `String` | 统计月份，格式 `YYYY-MM` |
| `calc_version` | `String` | 计算口径版本号 |
| `calc_status` | `String` | 计算状态，取值如 `success / failed / partial` |
| `calc_message` | `String` | 计算结果说明 |
| `data_range` | `Object` | 数据覆盖范围 |
| `data_range.start_date` | `String` | 起始日期，格式 `YYYY-MM-DD` |
| `data_range.end_date` | `String` | 结束日期，格式 `YYYY-MM-DD` |
| `overview` | `Object` | 页面顶部总览信息 |
| `overview.total_load_mwh` | `Number` | 月度实际总电量，单位 `MWh` |
| `overview.spot_avg_price` | `Number` | 全月实时现货加权均价，单位 `元/MWh` |
| `overview.total_contribution_amount` | `Number` | 四类交易合计贡献值，单位 `元` |
| `overview.total_exposed_mwh` | `Number` | 剩余风险暴露电量，单位 `MWh` |
| `overview.total_exposed_amount` | `Number` | 剩余风险暴露金额，单位 `元` |
| `overview.settlement_price_impact_amount` | `Number` | 对采购结算成本的合计影响金额，单位 `元` |
| `type_cards` | `Array` | 四类交易对比卡数据 |
| `type_cards[].trade_type` | `String` | 交易类型，取值如 `annual / monthly / within_month / day_ahead` |
| `type_cards[].label` | `String` | 展示名称，如“年度交易” |
| `type_cards[].covered_mwh` | `Number` | 覆盖电量，单位 `MWh` |
| `type_cards[].energy_share` | `Number` | 电量占比 |
| `type_cards[].avg_trade_price` | `Number` | 交易均价，单位 `元/MWh` |
| `type_cards[].spot_weighted_price` | `Number` | 按覆盖电量加权的实时现货均价，单位 `元/MWh` |
| `type_cards[].spot_spread` | `Number` | 现货价差，单位 `元/MWh` |
| `type_cards[].contribution_amount` | `Number` | 贡献值，单位 `元` |
| `type_cards[].win_rate` | `Number` | 胜率 |
| `type_cards[].positive_bucket_count` | `Number` | 正贡献单元数 |
| `type_cards[].negative_bucket_count` | `Number` | 负贡献单元数 |
| `type_cards[].neutral_bucket_count` | `Number` | 无贡献或无数据单元数 |
| `type_cards[].settlement_price_impact_amount` | `Number` | 对采购结算成本的影响金额，单位 `元` |
| `daily_view` | `Array` | 日度视图数据 |
| `daily_view[].date` | `String` | 日期，格式 `YYYY-MM-DD` |
| `daily_view[].actual_load_mwh` | `Number` | 当日实际电量，单位 `MWh` |
| `daily_view[].spot_avg_price` | `Number` | 当日实时现货均价，单位 `元/MWh` |
| `daily_view[].total_contribution_amount` | `Number` | 当日合计贡献值，单位 `元` |
| `daily_view[].exposed_mwh` | `Number` | 当日风险暴露电量，单位 `MWh` |
| `daily_view[].exposed_amount` | `Number` | 当日风险暴露金额，单位 `元` |
| `daily_view[].trade_types` | `Array` | 四类交易的当日明细 |
| `daily_view[].trade_types[].trade_type` | `String` | 交易类型 |
| `daily_view[].trade_types[].volume_mwh` | `Number` | 当日电量，单位 `MWh` |
| `daily_view[].trade_types[].avg_price` | `Number` | 当日交易均价，单位 `元/MWh` |
| `daily_view[].trade_types[].contribution_amount` | `Number` | 当日贡献值，单位 `元` |
| `daily_view[].trade_types[].spot_spread` | `Number` | 当日现货价差，单位 `元/MWh` |
| `period_view` | `Array` | 48 时段视图数据 |
| `period_view[].period` | `Number` | 时段序号，1~48 |
| `period_view[].time_label` | `String` | 时段标签，如 `00:00-00:30` |
| `period_view[].actual_load_mwh` | `Number` | 该时段月累计或日均实际电量，单位 `MWh` |
| `period_view[].spot_avg_price` | `Number` | 该时段实时现货均价，单位 `元/MWh` |
| `period_view[].total_contribution_amount` | `Number` | 该时段合计贡献值，单位 `元` |
| `period_view[].exposed_mwh` | `Number` | 该时段风险暴露电量，单位 `MWh` |
| `period_view[].exposed_amount` | `Number` | 该时段风险暴露金额，单位 `元` |
| `period_view[].trade_types` | `Array` | 四类交易的时段明细 |
| `period_view[].trade_types[].trade_type` | `String` | 交易类型 |
| `period_view[].trade_types[].volume_mwh` | `Number` | 电量，单位 `MWh` |
| `period_view[].trade_types[].avg_price` | `Number` | 交易均价，单位 `元/MWh` |
| `period_view[].trade_types[].contribution_amount` | `Number` | 贡献值，单位 `元` |
| `period_view[].trade_types[].spot_spread` | `Number` | 现货价差，单位 `元/MWh` |
| `diagnosis_texts` | `Array[String]` | 自动诊断结论列表 |
| `source_meta` | `Object` | 数据来源更新时间摘要 |
| `source_meta.contracts_last_updated_at` | `String(DateTime ISO)` | 合同数据最近更新时间 |
| `source_meta.trade_last_updated_at` | `String(DateTime ISO)` | 交易数据最近更新时间 |
| `source_meta.spot_last_updated_at` | `String(DateTime ISO)` | 现货数据最近更新时间 |
| `created_at` | `String(DateTime ISO)` | 首次创建时间 |
| `updated_at` | `String(DateTime ISO)` | 最近更新时间 |

### 12.3. 索引建议

- `month`（唯一索引）
- `calc_status`
- `updated_at`

---


## 18. `bid_trade_sources` - 模拟交易来源配置

该集合用于维护模拟交易所需的交易来源主数据，支持人工方案和自动策略的统一管理。

**业务价值**:
- 为外部交易系统提供可维护的交易来源列表
- 支持新增、停用、删除人工方案和自动策略
- 作为 `bid_strategy_results.trade_source_id` 的引用来源

- **数据来源**: Web 页面维护 / 后端管理接口
- **更新频率**: 按需
- **数据粒度**: 配置级

### 13.1 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `trade_source_id` | String | **[主键]** 交易来源唯一标识 |
| `trade_type` | String | 交易类型：`manual` / `auto` |
| `trade_source_name` | String | 交易来源名称 |
| `strategy_id` | String | 自动策略标识；人工方案可为空 |
| `status` | String | 状态：`active` / `inactive` |
| `params` | Object | 交易来源运行参数。自动策略必须保存当前生效参数；人工方案通常至少保存 `max_bid_mwh_per_period` |
| `created_at` | ISODate | 创建时间 |
| `updated_at` | ISODate | 更新时间 |

### 13.2 `params` 参数字典表

`bid_trade_sources.params` 用于保存“该交易来源当前实际使用的运行参数”。

- 文档负责说明字段含义、默认值来源和适用策略
- 数据集负责保存每个 `trade_source_id` 当前实际生效的参数值
- 新建交易来源时，后端会按 `strategy_id` 自动补齐默认参数并写入 `params`
- 前端修改参数后，预测和结算流程直接读取该交易来源的 `params`

| 参数名 | 数据类型 | 适用策略 | 默认值来源 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `max_bid_mwh_per_period` | Number | 全部策略 / 人工方案 | `config.ini` 的 `BID.max_bid_mwh_per_period` | 单时段申报电量上限。`bid_mwh = bid_ratio × max_bid_mwh_per_period` |
| `max_adjacent_jump` | Number | `S2_SmoothLinkedPeriods`、`S3_DailyBudgetAllocator` | 代码默认值 | 相邻时段最大允许报量跳变档差 |
| `spike_shave_min_ratio` | Number | `S2_SmoothLinkedPeriods` | 代码默认值 | 判定“中心时段为孤立尖峰”的最小申报比例阈值 |
| `spike_shave_neighbor_max_ratio` | Number | `S2_SmoothLinkedPeriods` | 代码默认值 | 判定“孤立尖峰”时，两侧时段允许的最大申报比例 |
| `continuous_lift_min_ratio` | Number | `S2_SmoothLinkedPeriods` | 代码默认值 | 连续正信号联动抬升时，中间时段的最小申报比例阈值 |
| `weak_positive_quantile` | Number | `S2_SmoothLinkedPeriods` | 代码默认值 | 弱正信号判定使用的 `expected_value` 分位点 |
| `daily_budget_ratio_base` | Number | `S3_DailyBudgetAllocator` | `config.ini` 的 `BID.daily_budget_ratio_base` | 全天总报量预算的基础比例 |
| `daily_budget_floor_ratio` | Number | `S3_DailyBudgetAllocator` | `config.ini` 的 `BID.daily_budget_floor_ratio` | 全天总报量预算的下限比例 |
| `daily_budget_ceiling_ratio` | Number | `S3_DailyBudgetAllocator` | `config.ini` 的 `BID.daily_budget_ceiling_ratio` | 全天总报量预算的上限比例 |
| `strong_ev_quantile` | Number | `S3_DailyBudgetAllocator` | 代码默认值 | 识别强信号时段使用的 `expected_value` 分位点 |
| `isolated_point_keep_quantile` | Number | `S3_DailyBudgetAllocator` | 代码默认值 | 保留孤立高分时段使用的分位点阈值 |
| `impact_cap_ratio` | Number | `S4_RiskControlledRefactor`、`S5_RiskControlledRefactor` | `config.ini` 的 `BID.impact_cap_ratio` | 单时段申报量占市场参考电量的最大比例上限，用于限制市场冲击 |
| `high_risk_floor_multiplier` | Number | `S4_RiskControlledRefactor`、`S5_RiskControlledRefactor` | `config.ini` 的 `BID.high_risk_floor_multiplier` | 高风险日下对全天预算做进一步压缩时使用的系数 |
| `high_risk_threshold` | Number | `S4_RiskControlledRefactor`、`S5_RiskControlledRefactor` | `config.ini` 的 `BID.high_risk_threshold` | 判定“高风险日”的风险分阈值 |
| `pre_sched_gap_penalty_threshold` | Number | `S5_RiskControlledRefactor` | `config.ini` 的 `BID.pre_sched_gap_penalty_threshold` | 预计划价格与自研价格预测偏差过大时触发额外降仓的阈值 |
| `high_risk_max_ratio` | Number | `S5_RiskControlledRefactor` | `config.ini` 的 `BID.high_risk_max_ratio` | 高风险日单时段允许的最高申报比例上限 |
| `model_path` | String | 自动策略 | 代码默认值或主数据显式配置 | 该交易来源预测时默认加载的模型文件路径 |

### 13.3 `AUTO_S5.params` 中文说明

当前库中 `AUTO_S5` 对应 `strategy_id = S5_RiskControlledRefactor`，其 `params` 字段保存的是 **S5 工程化模拟运行时的实际生效参数**。预测、滚动训练后的策略输出都会优先读取这份参数，而不是重新使用代码默认值。

当前 `AUTO_S5.params` 示例：

```json
{
  "max_bid_mwh_per_period": 300.0,
  "daily_budget_ratio_base": 0.35,
  "daily_budget_floor_ratio": 0.2,
  "daily_budget_ceiling_ratio": 0.6,
  "max_adjacent_jump": 0.4,
  "strong_ev_quantile": 0.85,
  "isolated_point_keep_quantile": 0.95,
  "impact_cap_ratio": 0.03,
  "high_risk_floor_multiplier": 0.6,
  "high_risk_threshold": 1.0,
  "pre_sched_gap_penalty_threshold": 35.0,
  "high_risk_max_ratio": 0.4,
  "model_path": "models_saved/bid/bid_s5_model.joblib"
}
```

字段解释如下：

- `max_bid_mwh_per_period`
  单个 30 分钟时段的申报电量上限。最终 `bid_mwh = bid_ratio × max_bid_mwh_per_period`。

- `daily_budget_ratio_base`
  全天总预算的基础比例。S5 会先按这个比例估算全天可分配总电量，再结合风险分和市场容量继续压缩或收敛。

- `daily_budget_floor_ratio`
  全天预算下限。即使当天风险很高，预算压缩也不会低于这一保底比例。

- `daily_budget_ceiling_ratio`
  全天预算上限。即使信号很强，全天总报量也不能超过这一上限比例。

- `max_adjacent_jump`
  相邻半小时时段的最大跳变幅度限制。用于抑制报量曲线过于尖锐，避免出现不合理的大起大落。

- `strong_ev_quantile`
  用于识别强信号时段的 `expected_value` 分位点。值越高，只有更靠前的强信号时段才能进入高优先级分配。

- `isolated_point_keep_quantile`
  用于保留“孤立高分时段”的阈值。值越高，只有非常强的孤立信号才会被保留下来，普通孤立点更容易被压缩或清零。

- `impact_cap_ratio`
  市场冲击约束比例。某时段的申报电量不能超过 `market_cleared_mwh_reference × impact_cap_ratio`。

- `high_risk_floor_multiplier`
  当 `abnormal_day_risk_score` 超过高风险阈值时，用这个系数压缩全天预算。系数越小，风险日越保守。

- `high_risk_threshold`
  高风险日阈值。风险分达到或超过该值时，S5 会触发更严格的预算压缩和单时段限仓。

- `pre_sched_gap_penalty_threshold`
  预计划价格与自研价格预测之间的偏差阈值。如果二者差异过大，说明市场先验与模型判断冲突，S5 会对该时段额外降仓。

- `high_risk_max_ratio`
  高风险日单时段最高允许申报比例。即使其他信号很强，只要当天被判定为高风险，也不能超过这个档位。

- `model_path`
  `AUTO_S5` 默认加载的模型文件路径。日常自动预测、手工 `bid-predict` 在未显式指定模型路径时，默认使用这里的模型。

### 13.4 索引配置

```javascript
db.bid_trade_sources.createIndex({
    "trade_source_id": 1
}, { unique: true })

db.bid_trade_sources.createIndex({
    "trade_type": 1,
    "status": 1
})
```

---

## 14. `bid_strategy_results` - 模拟交易结果

该集合用于保存模拟交易页面中的每笔交易记录，以及目标日后续结算回填的收益结果。

**业务价值**:
- 统一承载人工交易和自动交易结果
- 保存 48 点申报曲线和对应申报电量
- 在实时现货价格发布后回填 48 点结算价差和收益
- 支撑页面展示、收益统计和历史查询

- **数据来源**: 自动交易任务 / Web 页面人工录入 / 结算回填任务
- **更新频率**: 每日多次
- **数据粒度**: 30分钟，每日48个数据点

### 14.1 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `trade_id` | String | **[复合主键]** 交易记录唯一标识，当前自动交易默认格式为 `{trade_source_id}_{YYYYMMDD}` |
| `trade_type` | String | 交易类型：`manual` / `auto` |
| `trade_source_id` | String | 交易来源 ID，引用 `bid_trade_sources.trade_source_id` |
| `trade_source_name` | String | 交易来源名称快照，便于历史展示 |
| `strategy_id` | String | 策略标识；仅自动交易必填 |
| `forecast_date` | ISODate | 交易生成时间 |
| `target_date` | ISODate | **[复合主键]** 申报目标日期 |
| `trade_date_str` | String | 日期字符串，格式 `YYYY-MM-DD` |
| `status` | String | 记录状态：`created` / `settled` |
| `max_bid_mwh_per_period` | Number | 单时段申报电量上限 |
| `bid_ratio` | Array[48] | 48 点申报比例，范围 0~1 |
| `bid_mwh` | Array[48] | 48 点申报电量，计算方式为 `bid_ratio × max_bid_mwh_per_period` |
| `rt_price_30m` | Array[48] | 结算回填后的 48 点实时现货价格 |
| `econ_price_30m` | Array[48] | 结算回填后的 48 点经济出清价格 |
| `settlement_spread` | Array[48] | 48 点实际结算价差 `rt - econ` |
| `period_pnl` | Array[48] | 48 点实际收益 |
| `period_result_flag` | Array[48] | 48 点结果标记：`win` / `loss` / `flat` |
| `daily_bid_mwh` | Number | 全天申报总电量 |
| `daily_expected_pnl` | Number | 全天预期收益 |
| `daily_realized_pnl` | Number | 全天实际收益 |
| `daily_win_periods` | Number | 全天正收益时段数 |
| `daily_loss_periods` | Number | 全天负收益时段数 |
| `daily_avg_spread` | Number | 全天平均结算价差 |
| `settled_at` | ISODate | 完成结算回填的时间 |
| `created_at` | ISODate | 创建时间 |
| `updated_at` | ISODate | 更新时间 |

**说明**:
- 自动交易当前会额外保存模型输出 `p_positive`、`expected_value`，用于策略复盘和结果解释。
- 页面中的交易对比、收益排序等优先基于本表实时计算，不单独持久化复杂对比字段。
- 当前代码采用 `trade_id + target_date` 做唯一约束，同一交易来源对同一目标日重复生成时执行覆盖更新，而不是保留多版本记录。

### 14.2 索引配置

```javascript
db.bid_strategy_results.createIndex({
    "trade_id": 1,
    "target_date": 1
}, { unique: true })

db.bid_strategy_results.createIndex({
    "target_date": 1,
    "trade_type": 1,
    "strategy_id": 1
})

db.bid_strategy_results.createIndex({
    "status": 1,
    "target_date": 1
})

db.bid_strategy_results.createIndex({
    "trade_source_id": 1,
    "target_date": 1
})
```

---