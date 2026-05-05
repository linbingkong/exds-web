# exds 三项目多市场主体改造方案（售电公司 / 储能电站 / 电厂）

## Context

exds 系统由三个并列子项目构成，共享同一 MongoDB（库名 `exds`）：

- **exds-web**（[d:/Gitworks/exds-web](.)）：FastAPI + React 前后端分离的业务系统，承载用户、客户、合同、套餐、结算、储能策略、UI 等。
- **exds-rpa**（[d:/Gitworks/exds-rpa](../exds-rpa)）：Playwright + Pandas 的数据抓取项目，单进程定时执行，把市场行情、长协合同、节点电价、调频、平台日清算、每日发布预测等从交易平台爬到 MongoDB。登录凭证与 MongoDB 配置都来自 `~/.exds/config.ini`，单账户单实例。
- **exds-stef**（[d:/Gitworks/exds-stef](../exds-stef)）：Windows 服务（NSSM 托管），统一调度框架 + D-1 价格预测 + 短期负荷预测 + 影子模型 + 申报策略。写入 `task_execution_logs` / `task_commands` / `system_alerts` / `price_forecast_results` / `load_forecast_results` / `bid_strategy_*` / `auxiliary_*_forecast` 等。与 exds-web 仅通过共享 MongoDB 集成，无 API 调用、无 auth 共享。

当前所有业务集合都是**单市场主体**架构。要支持同一部署同时承载四类主体（售电公司 / 独立储能 / 新能源电厂(风/光) / 火电厂），需引入会话级单主体上下文 + 数据范围隔离 + 结算分流，**三个项目协同改造**。

已确认决策：

- 会话级单主体（用户登录后绑定一个当前主体，可切换）。
- **价格预测、天气预测**全域共享（注意：负荷预测因为按客户预测，仍属 RETAIL 私有）。
- 储能不归属售电，独立主体。
- 售电与储能结算物理分流为不同集合。
- 电厂主体类型 = 新能源（风/光） + 火电；**本期仅在文档与菜单预留占位，不实现实质功能**。
- entity 字段迁移**不做双写过渡**：统一一次性增加 `org_id`，旧字段在切换完成后立即下线。
- `freq_comp_fee` 已确认为全局公共数据（不加 org_id）。
- 不构建灰度/影子校验，依赖 staging 全量回归。
- 实施按数据集分批，前期不影响生产。

---

## 一、主体模型与四类 org_type

### 仅新增 2 个核心集合（主体扩展项内嵌进 organizations，不再单独建 profile 表）

```
organizations                    # 主体注册表（含所有类型扩展字段）
  _id (str org_id, e.g. "RC-001"/"SS-001"/"PP-W-001"/"PP-T-002")
  name, org_type ∈ {retail_company, storage_station, power_plant}
  plant_subtype ∈ {wind, solar, thermal}      # 仅 power_plant 必填
  is_active, demo_mode, timezone
  created_at, updated_at

  # 按 org_type 使用对应子文档；非本类型字段为空
  retail_profile: {
    license_no, region, default_curtailment_ratio, ...
  }
  storage_profile: {                       # 替代原 storage_stations 集合
    capacity_mw, energy_mwh, max_soc, min_soc,
    charge_efficiency, discharge_efficiency, node_name, ...
  }
  plant_profile: {
    installed_capacity_mw, node_name, connect_voltage,
    ramp_rate, curtailment_cap, forecast_model_ref, dispatch_node
  }

user_org_memberships             # 用户↔主体绑定，多对多
  user_id, org_id, role_codes[], is_default
  unique: (user_id, org_id)
```

> **现有 `storage_stations` 集合处理**：阶段 1 数据迁移把 `storage_stations` 各文档合并进 `organizations.storage_profile`；阶段 4 改 [storage_declaration_service.py:128](webapp/services/storage_declaration_service.py#L128) 的 `self.stations = db.storage_stations` 为读 `organizations`；老集合作为 DEPRECATED 在阶段 7 删除。

会话上下文 [webapp/models/auth.py:29](webapp/models/auth.py#L29) `CurrentUserContext` 增加 `current_org_id` / `current_org_type` / `current_plant_subtype` / `available_orgs`；新增 `/auth/switch-org`。

---

## 二、完整集合清单（基于代码扫描，非依赖文档）

> 扫描方法：直接 grep 三个项目所有 `.py`，匹配 `DATABASE[...]`、`db.<name>`、`self.db.<name>`、`db['<name>']`、`get_collection(...)`、`COLLECTION_NAME = ...` 等模式；交叉核对 RPA pipeline 的 `task['collection']` 配置。每个集合标注首要写入方与代表性文件行。

### A. AUTH（9 个，跨主体共享，不加 org_id）

主体绑定通过 `user_org_memberships` 实现，`users` 仅增加 `default_org_id` 字段。

| 集合 | 主写入方 | 代表位置 |
|---|---|---|
| `users` | exds-web 登录/管理 | [webapp/main.py:206](webapp/main.py#L206)、[init_auth_data.py:354](webapp/scripts/init_auth_data.py#L354) |
| `auth_sessions` | webapp.security | [webapp/tools/security.py:466](webapp/tools/security.py#L466) |
| `auth_audit_logs` | webapp.main | [webapp/main.py:101](webapp/main.py#L101) |
| `auth_security_challenges` | webapp.security | [webapp/tools/security.py:244](webapp/tools/security.py#L244) |
| `auth_email_challenges` | webapp.main | [webapp/main.py:188](webapp/main.py#L188) |
| `auth_trusted_devices` | webapp.security | [webapp/tools/security.py:330](webapp/tools/security.py#L330) |
| `auth_modules` | webapp init script | [init_auth_data.py:332](webapp/scripts/init_auth_data.py#L332) |
| `auth_permissions` | webapp init script | [init_auth_data.py:339](webapp/scripts/init_auth_data.py#L339) |
| `auth_roles` | webapp init script | [init_auth_data.py:348](webapp/scripts/init_auth_data.py#L348) |

### B. GLOBAL（不加 org_id，全域共享）

#### B1. 现货市场行情（exds-rpa 写入，全平台共享）

| 集合 | 写入方 | 代表位置 |
|---|---|---|
| `real_time_spot_price` | rpa.spot_price | [spot_price.py:1102](../exds-rpa/rpa/pipelines/spot_price.py#L1102) |
| `day_ahead_spot_price` | rpa.spot_price | [spot_price.py:1109](../exds-rpa/rpa/pipelines/spot_price.py#L1109) |
| `day_ahead_econ_spot_price` | rpa.spot_price | [spot_price.py:1117](../exds-rpa/rpa/pipelines/spot_price.py#L1117) |
| `day_ahead_pre_sched_spot_price` | rpa.spot_price | [spot_price.py:1125](../exds-rpa/rpa/pipelines/spot_price.py#L1125) |
| `day_ahead_pre_sched_reserve` | rpa.spot_price | [spot_price.py:1133](../exds-rpa/rpa/pipelines/spot_price.py#L1133) |
| `day_ahead_econ_price` | rpa.day_ahead_declare | [day_ahead_declare.py:29](../exds-rpa/rpa/pipelines/day_ahead_declare.py#L29) |
| `real_time_generation` | rpa.spot_price | [spot_price.py:1141](../exds-rpa/rpa/pipelines/spot_price.py#L1141) |
| `real_time_tieline` | rpa.spot_price | [data_loader.py:122](../exds-stef/stef/utils/data_loader.py#L122) 读 |
| `actual_operation` | rpa.spot_price | [spot_price.py:1149](../exds-rpa/rpa/pipelines/spot_price.py#L1149) |
| `reserve_constraint` | rpa.spot_price | [spot_price.py:1157](../exds-rpa/rpa/pipelines/spot_price.py#L1157) |
| `node_spot_price_daily` | rpa.node_spot_price | [node_spot_price.py:18](../exds-rpa/rpa/pipelines/node_spot_price.py#L18) |
| `node_spot_price_targets` | rpa.node_spot_price | [node_spot_price.py:19](../exds-rpa/rpa/pipelines/node_spot_price.py#L19) |
| `rolling_match_snapshots` | rpa.rolling_match | [rolling_match.py:21](../exds-rpa/rpa/pipelines/rolling_match.py#L21) |
| `frequency_regulation_clearing` | rpa.frequency_regulation | [frequency_regulation.py:26](../exds-rpa/rpa/pipelines/frequency_regulation.py#L26) |
| `frequency_regulation_demand` | rpa.frequency_regulation | [frequency_regulation.py:25](../exds-rpa/rpa/pipelines/frequency_regulation.py#L25) |

#### B2. 公共预测/参考数据

| 集合 | 写入方 | 代表位置 |
|---|---|---|
| `weekly_forecast` | rpa.weekly_forecast | [weekly_forecast.py:25](../exds-rpa/rpa/pipelines/weekly_forecast.py#L25) |
| `daily_release` | rpa.daily_release | [daily_release.py:24](../exds-rpa/rpa/pipelines/daily_release.py#L24) |
| `maintenance_plans` | rpa.daily_release | [daily_release.py:25](../exds-rpa/rpa/pipelines/daily_release.py#L25) |
| `installed_capacity` | rpa | [capacity_features.py:37](../exds-stef/stef/features/shared/capacity_features.py#L37) 读 |
| `unit_capacity` | rpa | [maintenance_features.py:34](../exds-stef/stef/features/d1/maintenance_features.py#L34) 读 |
| `price_sgcc` | rpa.price_sgcc | [price_sgcc.py:168](../exds-rpa/rpa/pipelines/price_sgcc.py#L168) |
| `tou_rules` | webapp 维护 | [tou_service.py:7](webapp/services/tou_service.py#L7) |
| `freq_comp_fee` | webapp.v1_freq_comp_fee（PDF 导入） | [v1_freq_comp_fee.py:22](webapp/api/v1_freq_comp_fee.py#L22) — 全局公共数据 |
| `weather_actuals` | rpa（迁移自 stef.download_weather） | [download_weather.py:26](../exds-stef/stef/pipelines/download_weather.py#L26) |
| `weather_forecasts` | rpa | [download_weather.py:25](../exds-stef/stef/pipelines/download_weather.py#L25) |
| `weather_locations` | rpa | [download_weather.py:91](../exds-stef/stef/pipelines/download_weather.py#L91) |
| `fuel_futures_data` | stef.download_fuel_futures | [download_fuel_futures.py:116](../exds-stef/stef/pipelines/download_fuel_futures.py#L116) |
| `price_forecast_results` ⚠️ **核心，重度使用，非废弃** | stef.d1.predict_pipeline | [predict_pipeline.py:74](../exds-stef/stef/pipelines/d1/predict_pipeline.py#L74)、[main.py:407](../exds-stef/stef/main.py#L407)、[daily_trigger.py:88](../exds-stef/stef/tasks/d1/daily_trigger.py#L88) |
| `forecast_accuracy_daily` | stef.d1.evaluate_pipeline | [evaluate_pipeline.py:297](../exds-stef/stef/pipelines/d1/evaluate_pipeline.py#L297) |
| `typical_curves` | webapp.typical_curve_service | webapp services |

### C. RETAIL（加 org_id 必填，唯一索引升级）

| 集合 | 主写入方 | 当前唯一键 → 改造后 |
|---|---|---|
| `customer_archives` | webapp.customer_service | (user_name) → (org_id, user_name) |
| `customer_demo_aliases` | webapp.scripts | (customer_id) → (org_id, customer_id) |
| `customer_characteristics` | webapp.scheduler.characteristics_jobs | (customer_id) → (org_id, customer_id) |
| `customer_anomaly_alerts` | webapp.scheduler | (customer_id, alert_date) → (org_id, customer_id, alert_date) |
| `customer_monthly_energy` | webapp.retail_settlement_service | (month) → (org_id, month) |
| `analysis_history_log` | webapp.load_characteristics | (date, customer_id) → (org_id, date, customer_id) |
| `retail_contracts` | webapp.contract_service | (contract_name) → (org_id, contract_name) |
| `retail_packages` | webapp.contract_service | (package_name) → (org_id, package_name) |
| `retail_settlement_daily` | webapp.retail_settlement_service | (customer_id, date) → (org_id, customer_id, date) |
| `retail_settlement_monthly` | webapp.retail_monthly_settlement_service | (customer_id, month) → (org_id, customer_id, month) |
| `retail_settlement_prices` | webapp.retail_price_service | (price_key) → (org_id, price_key) |
| `pricing_models` | webapp.pricing_model_service | (model_code) → (org_id, model_code) |
| `intent_customer_profiles` | webapp.intent_customer_diagnosis | (customer_id) → (org_id, customer_id) |
| `intent_customer_meter_reads_daily` | webapp.intent_customer_diagnosis | (mp_id, date) → (org_id, mp_id, date) |
| `intent_customer_load_curve_daily` | webapp.intent_customer_diagnosis | (customer_id, date) → (org_id, customer_id, date) |
| `intent_customer_monthly_wholesale` | webapp.intent_customer_diagnosis | (customer_id, month) → (org_id, customer_id, month) |
| `intent_customer_monthly_retail_simulation` | webapp.intent_customer_diagnosis | (customer_id, month) → (org_id, customer_id, month) |
| `unified_load_curve` | rpa / webapp 聚合 | (mp_id, date) → (org_id, mp_id, date) |
| `raw_mp_data` | rpa.mp_load_curve | (mp_id, date) → (org_id, mp_id, date) |
| `raw_meter_data` | rpa | (meter_id, datetime) → (org_id, meter_id, datetime) |
| `load_forecast_results` ⚠️ **修正：非全域，按客户** | stef.load.predict_pipeline | (customer_id, target_date) → (org_id, customer_id, target_date) |
| `medium_term_load_forecast` | webapp.medium_term_load_forecast | (customer_id, target_date) → (org_id, customer_id, target_date) |
| `settlement_daily`（建议重命名 `retail_settlement_pre_daily`） | rpa.spot_settlement → webapp 接管 | (operating_date) → (org_id, operating_date) |
| `settlement_period`（建议重命名 `retail_settlement_pre_period`） | 同上 | (operating_date, period) → (org_id, operating_date, period) |
| `wholesale_settlement_monthly` | webapp.wholesale_monthly_settlement_service | (month) → (org_id, month) |
| `trade_review_monthly_summary` | webapp.monthly_trade_review_service | (month) → (org_id, month) |
| `bid_trade_sources` | stef.bid | (trade_source_id) → (org_id, trade_source_id) |
| `bid_strategy_results` | stef.bid.daily_trigger | (trade_source_id, target_date) → (org_id, trade_source_id, target_date) |
| `bid_strategy_evaluations` | stef.bid.rolling_evaluate | (trade_source_id, target_date) → (org_id, trade_source_id, target_date) |

### D. STORAGE（加 org_id 必填）

> 原 `storage_stations` 集合的内容并入 `organizations.storage_profile`，不再单独维护。

| 集合 | 主写入方 | 改造 |
|---|---|---|
| `storage_strategies` | webapp.storage_declaration_service | (strategy_id) → (org_id, strategy_id) |
| `storage_declarations` | webapp.storage_declaration_service | (declaration_id) → (org_id, declaration_id) |
| `storage_history` | webapp.storage_declaration_service | (date) → (org_id, date) |
| **新建** `storage_settlement_daily` | webapp.storage_settlement | (org_id, date) |
| **新建** `storage_settlement_period` | 同上 | (org_id, date, period) |
| **新建** `storage_settlement_monthly` | 同上 | (org_id, month) |

### E. PLANT（电厂私有，**本期文档级占位，不实现**）

> ⚠️ 电厂主体类型（风/光/火电）的具体集合与服务**本期仅在文档中预留，不进行编码实现**。后续真实接入电厂主体时再按本节定义启动建表与服务开发。
>
> 本期范围内电厂相关已落地的仅有：`organizations.plant_profile` 子文档（用于注册主体）、`org_type=power_plant` 的会话上下文与菜单切换骨架。

预留集合定义（后期实施参考）：

| 集合 | 用途 | 唯一键 |
|---|---|---|
| `plant_generation_forecasts` | 风/光出力预测 + 火电可用容量预测 | (org_id, target_date) |
| `plant_declarations` | 节点电价 + 96 点申报 | (org_id, declaration_id) |
| `plant_curtailment_logs` | 弃风弃光 / 火电限发记录 | (org_id, date) |
| `plant_settlement_daily` | 电厂日结算 | (org_id, date) |
| `plant_settlement_monthly` | 电厂月结算 | (org_id, month) |
| `plant_freq_regulation_records` | 火电参与调频补偿 | (org_id, date) |

### F. ORG_REWRITE（统一直接增加 org_id）

> **关键简化**（用户确认）：每个市场主体使用独立账号 + 独立 Playwright 浏览器实例登录平台抓取数据。**RPA 任务在执行时已经明确知道当前是哪个主体**（来自 `--org-id` 入参），因此**直接写 `org_id` 即可，不需要从平台返回中提取 `entity_name`**。这大幅简化了解析逻辑——无需识别市场成员名列。
>
> `entity_name` 字段：仅 `mechanism_energy_monthly` 已有该字段（webapp 手工导入），保留作为冗余可读字段。其他 ORG_REWRITE 集合不引入此字段。

| 集合 | 当前字段 | 改造 |
|---|---|---|
| `contracts_aggregated_daily` | 视角字段 `entity` ∈ {`售电公司`,`全市场`} | 新增 `org_id`（视角=组织时填，市场时 null） + `perspective` ∈ `{org, market}`；删除 `entity` 字段。索引 (entity, date, ct, cp) → (org_id, perspective, date, ct, cp) |
| `contracts_detailed_daily` | 固定 `entity = "售电公司"` | 新增 `org_id` 必填（来自 RPA 启动时的 `--org-id`）；删除 `entity`。RPA 去掉 [long_term_contracts.py:195/891/906/921](../exds-rpa/rpa/pipelines/long_term_contracts.py#L195) 4 处硬编码 |
| `mechanism_energy_monthly` | `entity_name` = 市场成员名 | 新增 `org_id`（按 entity_name → organizations.name 反查并固化）。索引 (month_str, entity_name) → (org_id, month_str)。`entity_name` 保留作可读冗余 |
| `spot_settlement_daily` | 无主体维度 | RPA 启动时已知 org_id，直接写入；历史回填 `DEFAULT_RC`。索引 (operating_date) → (org_id, operating_date) |
| `spot_settlement_period` | 同上（48 点分时） | 同上。索引 (operating_date, period) → (org_id, operating_date, period) |
| `trade_declare` | 无主体维度 | 同上 |
| `day_ahead_energy_declare` | 无主体维度 | 同上 |

**实施序列**（每集合独立 PR，按下表顺序）：

1. RPA 发布带 `--org-id` 参数与多账户配置的版本，写入文档时直接附加 `org_id` 字段（旧 `entity` 字段保持兼容）。
2. 历史回填脚本：所有现存文档按"实际归属售电公司"补 `org_id`（一期生产仅 1 家售电公司，统一 `DEFAULT_RC`）。
3. 创建新索引 `(org_id, ...)`（保留旧索引共存）。
4. webapp service 切换查询路径到 `org_id`（旧路径仍兼容）。
5. 观察 ≥ 1 周无回归 → 删除旧索引 + 删除 `entity` 字段（含 `contracts_aggregated_daily` 的视角字段重建为 perspective）。

> **简化收益**：相比之前方案，省去了"RPA 解析平台返回提取 entity_name"的逻辑改动，也省去了对应的单元测试与上线监控；历史数据回填也无需 entity_name 字段。RPA 改造的实际工作量从"补字段+改解析"减为"加 org_id 写入"。

### G. SYSTEM（跨主体审计与调度，加可空 org_id）

| 集合 | 主写入方 | 改造 |
|---|---|---|
| `task_execution_logs` | stef.task_logger / webapp.scheduler.logger | 加 `org_id` 可空：公共任务 null，按主体任务必填 |
| `task_execution_records` | rpa.task_tracker（每日摘要） | 加 `org_id` 可空 |
| `task_execution_history` | rpa.task_tracker / long_term_contracts | 加 `org_id` 可空 |
| `task_commands` | webapp.api.v1_price_forecast / 各重算入口 | 加 `org_id` 可空 + 消费端按 ctx 过滤 |
| `task_schedule_configs` | rpa.task_schedule + 多个 pipeline 自更新 | 改造为 `org_id` 字段：公共任务 null，按主体任务必填；调度器按主体过滤 |
| `system_alerts` | stef.alert_notifier / webapp.scheduler / aggregation_jobs / rpa.alert_manager | 加 `org_id` 可空 + UI 按主体过滤；super_admin 看全平台 |
| `dashboard_snapshot` | webapp.dashboard_service | 主键改为 `(org_id, snapshot_id)` |

**调度任务分类**（决定 org_id 是 null 还是必填）：

- **公共爬虫**（rpa.spot_price、weekly_forecast、daily_release、frequency_regulation、price_sgcc、node_spot_price、download_weather、download_fuel_futures、rolling_match）→ `org_id=null`。
- **公共预测**（stef.d1 价格预测、shadow 风/光影子模型、forecast_accuracy）→ `org_id=null`。
- **按主体业务任务**：
  - rpa.long_term_contracts（按各售电公司账户登录抓取）→ 必填 `org_id`，需要按主体循环执行。
  - rpa.mp_load_curve（按各售电公司客户范围抓表数据）→ 必填 `org_id`。
  - **rpa.spot_settlement**（按售电公司发布的日清算与分时结算）→ 必填 `org_id`。
  - **rpa.trade_declare**（按售电公司的交易申报）→ 必填 `org_id`。
  - **rpa.day_ahead_declare**（按售电公司的日前申报）→ 必填 `org_id`。
  - stef.load（按客户预测，归属各 retail org）→ 必填 `org_id`。
  - webapp.scheduler.aggregation_jobs（负荷聚合、客户特征分析）→ 必填 `org_id`。
  - webapp.scheduler.settlement_jobs（结算重算）→ 必填 `org_id`。
  - 储能、电厂结算与申报 → 必填对应 `org_id`。

**告警分级**：`system_alerts.org_id is null` = 系统级（爬虫故障、DB 故障）→ super_admin 可见；`org_id is not null` = 主体级业务告警 → 该主体 + super_admin 可见。

### H. DEPRECATED（确认已废弃，用户确认）

| 集合 | 状态依据 | 处理 |
|---|---|---|
| `weather_data` | [stef/utils/data_loader.py:232](../exds-stef/stef/utils/data_loader.py#L232) legacy 路径；主流程已切到 `weather_actuals/forecasts` | 阶段 0 注释引用，验证无回归后删除集合 |
| `auxiliary_wind_forecast` | 用户确认废弃（影子风电预测旧产物） | 阶段 0 移除 [stef/tasks/shadow/daily_forecast_all.py:199](../exds-stef/stef/tasks/shadow/daily_forecast_all.py#L199) 写入，删除集合 |
| `auxiliary_solar_forecast` | 用户确认废弃（影子光伏预测旧产物） | 阶段 0 移除 [stef/tasks/shadow/daily_forecast_all.py:225](../exds-stef/stef/tasks/shadow/daily_forecast_all.py#L225) 写入，删除集合 |
| `mp_load_curve` | 用户确认废弃（与 `raw_mp_data` 重叠的旧命名） | 阶段 0 清理引用，删除集合 |
| `price_forecast_daily_results` | 用户确认废弃 | 阶段 0 清理 [stef/tests/d1/test_trigger_common_unittest.py:33](../exds-stef/tests/d1/test_trigger_common_unittest.py#L33) 等引用，删除集合 |
| `backtest_results` | 用户确认废弃 | 阶段 0 移除 [stef/utils/data_saver.py:113](../exds-stef/stef/utils/data_saver.py#L113) 写入，删除集合 |
| `user_load_data` | 用户确认废弃 | 阶段 0 移除 [v1_common.py:15](webapp/api/v1_common.py#L15) 引用，删除集合 |
| `storage_stations` | 内容并入 `organizations.storage_profile` | 阶段 1 数据迁移；阶段 4 切读路径；阶段 7 删除集合 |

> `bid_strategy_evaluations` 暂时保留（用户确认本期不下线），归入 RETAIL 类按 org_id 改造。

> ⚠️ **重要纠正**：`price_forecast_results` 在前一版方案中被误判为 legacy。实际上它是 stef D-1 价格预测的**核心输出集合**，被 [predict_pipeline.py:74](../exds-stef/stef/pipelines/d1/predict_pipeline.py#L74)、[main.py:407](../exds-stef/stef/main.py#L407)、[daily_trigger.py](../exds-stef/stef/tasks/d1/daily_trigger.py) 等多处重度使用，**不废弃**。`price_forecast_daily_results` 是历史 v2/v3 输出，已确认废弃。

### I. UNCLEAR

> 用户已确认 `user_load_data` 废弃、`typical_curves` 归 GLOBAL（已合并到 GLOBAL B2 节）。本期无 UNCLEAR 集合。

### 集合数量汇总

| 类别 | 数量 | 备注 |
|---|---|---|
| AUTH | 9 | 跨主体，不动 |
| GLOBAL B1（行情） | 15 | spot_settlement_daily/period、trade_declare、day_ahead_energy_declare 移到 ORG_REWRITE |
| GLOBAL B2（公共预测/参考） | 14 | 含 freq_comp_fee（用户确认全局）、typical_curves |
| RETAIL | 28 | 含 bid_trade_sources、bid_strategy_results、bid_strategy_evaluations（暂保留） |
| STORAGE | 3 现有 + 3 新建 = 6 | 去除 storage_stations（并入 organizations） |
| PLANT | 6（**仅文档级占位，本期不实现**） | 后期接入电厂主体再实施 |
| ORG_REWRITE | 7 | 旧 DUAL_WRITE，简化为统一加 org_id：contracts_aggregated_daily / contracts_detailed_daily / mechanism_energy_monthly / spot_settlement_daily / spot_settlement_period / trade_declare / day_ahead_energy_declare |
| SYSTEM | 7 | task_execution_logs / records / history / commands / system_alerts / task_schedule_configs / dashboard_snapshot |
| DEPRECATED | 8 | weather_data / auxiliary_wind/solar_forecast / mp_load_curve / price_forecast_daily_results / backtest_results / user_load_data / storage_stations |
| **总计** | **约 100** | 本期实际实施约 94（PLANT 6 项不计入） |

---

## 三、三项目协同改造分工

### exds-web（约 75% 工作量）

- 实现主体上下文、`ScopedCollection` 抽象、白名单校验。
- service 层全员改造（约 30 个 service、150+ 处 collection 访问）。
- 前端菜单/路由按 org_type 动态裁剪。
- 新增主体管理页、储能结算页、电厂运营菜单（仅占位）。

### exds-rpa（约 15%，简化后工作量下调）

> **核心模式**：每主体独立账号 + 独立 Playwright 实例。RPA 启动时已知 `--org-id`，所有按主体的 pipeline 直接把 `org_id` 写入文档，**无需从平台返回提取市场成员名**。

1. [rpa/pipelines/long_term_contracts.py:195/891/906/921](../exds-rpa/rpa/pipelines/long_term_contracts.py#L195) **4 处硬编码** entity → 参数化为 `--org-id` CLI 入参；写入文档时附加 `org_id`。
2. **3 个按主体 pipeline 直接附加 org_id**（无需解析改动）：
   - [rpa/pipelines/spot_settlement.py](../exds-rpa/rpa/pipelines/spot_settlement.py) → `spot_settlement_daily/period`
   - [rpa/pipelines/trade_declare.py](../exds-rpa/rpa/pipelines/trade_declare.py) → `trade_declare`
   - [rpa/pipelines/day_ahead_declare.py](../exds-rpa/rpa/pipelines/day_ahead_declare.py) → `day_ahead_energy_declare`
3. **多账户配置**：`~/.exds/config.ini` 扩展为 `[LOGIN.<org_id>]` 节，pipeline 启动时按 `--org-id` 选择账户与浏览器实例。
4. **task_schedule_configs**（[rpa/tools/task_schedule.py:11](../exds-rpa/rpa/tools/task_schedule.py#L11)）增加 `org_id` 字段；调度器读取按主体过滤。公共爬虫任务 `org_id=null`。按主体的 pipeline 在调度器中按 `org_id` 循环唤起，每个 org_id 启动独立 Playwright 实例顺次执行。
5. **按主体写入**：`raw_mp_data` / `unified_load_curve` / `contracts_aggregated_daily` / `contracts_detailed_daily` / 上述 3 个 ORG_REWRITE 集合写入必带 `org_id`。
6. **task_execution_records / task_execution_history / system_alerts**（[rpa/tools/alert_manager.py:28](../exds-rpa/rpa/tools/alert_manager.py#L28)）注入 `org_id`。
7. **真正的公共爬虫保持单实例、单账户不变**：spot_price（爬现货行情）、weather、price_sgcc、node_spot_price、weekly_forecast、daily_release、frequency_regulation、rolling_match。

### exds-stef（约 10%）

1. **TaskLogger**（[task_logger.py:36](../exds-stef/stef/tasks/service_components/task_logger.py#L36)）`log_start` / `log_end` 增加 `org_id` 参数。
2. **CommandListener**（[command_listener.py:43](../exds-stef/stef/tasks/service_components/command_listener.py#L43)）拉取 `task_commands` 时按 `org_id` 过滤；按主体的命令仅匹配主体消费。
3. **AlertNotifier**（[alert_notifier.py:36](../exds-stef/stef/tasks/service_components/alert_notifier.py#L36)）`system_alerts.org_id` 注入；邮件模板加主体名。
4. **service_config.yaml** 扩展 `tenant_aware: bool`；按主体的 job 在 runtime 循环各 `org_id` 调用 handler。
5. **load 任务**（[stef/tasks/load/](../exds-stef/stef/tasks/load/)）`load_forecast_results` 写入必带 `org_id`，因为按客户预测。
6. **stef.bid 任务**：`bid_trade_sources` / `bid_strategy_results` / `bid_strategy_evaluations`（暂保留）已划入 RETAIL；任务执行时按 retail org 循环，写入必带 `org_id`。`backtest_results` 已废弃，对应代码移除。
7. **公共任务保持不变**：d1 价格预测、shadow 风/光、forecast_accuracy、download_weather、download_fuel_futures。

---

## 四、后端核心抽象（exds-web）

新建 [webapp/tools/scoped_db.py](webapp/tools/scoped_db.py)：

```python
RETAIL_SCOPED  = {...28 个集合，含 bid_trade_sources/bid_strategy_results/bid_strategy_evaluations}
STORAGE_SCOPED = {"storage_strategies","storage_declarations","storage_history",
                  "storage_settlement_daily","storage_settlement_period",
                  "storage_settlement_monthly"}                # 6 个
GLOBAL_SHARED  = {...29 个市场+公共预测，含 freq_comp_fee、typical_curves}
ORG_REWRITE    = {"contracts_aggregated_daily","contracts_detailed_daily",
                  "mechanism_energy_monthly",
                  "spot_settlement_daily","spot_settlement_period",
                  "trade_declare","day_ahead_energy_declare"}  # 7 个，统一加 org_id（无双写）
SYSTEM_SCOPED  = {"task_execution_logs","task_execution_records",
                  "task_execution_history","task_commands","system_alerts",
                  "task_schedule_configs","dashboard_snapshot"}
AUTH_GLOBAL    = {"users","auth_sessions","auth_audit_logs",
                  "auth_email_challenges","auth_security_challenges",
                  "auth_trusted_devices","auth_modules","auth_permissions","auth_roles"}
ORG_REGISTRY   = {"organizations","user_org_memberships"}      # 主体注册表本身
# PLANT_SCOPED 本期为空：电厂集合仅文档级占位，不实现

class ScopedCollection: ...
def org_scope(query, ctx, *, allow_none=False) -> dict: ...
def assert_collection_classified(name: str): ...   # 启动时校验
```

**关键改造文件**（按优先级）：

- [webapp/services/settlement_service.py](webapp/services/settlement_service.py) — line 153/456/581 entity 硬编码
- [webapp/services/storage_declaration_service.py:128-131](webapp/services/storage_declaration_service.py#L128) — 当前隐式单电站
- [webapp/services/customer_service.py](webapp/services/customer_service.py)、[contract_service.py](webapp/services/contract_service.py)、[package_service.py](webapp/services/package_service.py)、[retail_settlement_service.py](webapp/services/retail_settlement_service.py)、[retail_monthly_settlement_service.py](webapp/services/retail_monthly_settlement_service.py)、[wholesale_monthly_settlement_service.py](webapp/services/wholesale_monthly_settlement_service.py)、[load_aggregation_service.py](webapp/services/load_aggregation_service.py)、[customer_load_overview_service.py](webapp/services/customer_load_overview_service.py)、[customer_profit_analysis_service.py](webapp/services/customer_profit_analysis_service.py)
- [webapp/services/intent_customer_diagnosis_service.py:24-29](webapp/services/intent_customer_diagnosis_service.py#L24) — 5 个 intent 子集合
- [webapp/services/characteristics/service.py:82-85](webapp/services/characteristics/service.py#L82) — 4 个客户特征集合
- [webapp/services/contract_price_service.py](webapp/services/contract_price_service.py)、[contract_price_trend_service.py](webapp/services/contract_price_trend_service.py)、[trade_review_service.py](webapp/services/trade_review_service.py)、[monthly_trade_review_service.py](webapp/services/monthly_trade_review_service.py)
- [webapp/services/dashboard_service.py](webapp/services/dashboard_service.py) — 跨集合 dashboard 视图
- [webapp/scheduler/jobs/aggregation_jobs.py](webapp/scheduler/jobs/aggregation_jobs.py)、[settlement_jobs.py](webapp/scheduler/jobs/settlement_jobs.py)、[accuracy_jobs.py](webapp/scheduler/jobs/accuracy_jobs.py)、[characteristics_jobs.py](webapp/scheduler/jobs/characteristics_jobs.py)
- [webapp/api/v1_freq_comp_fee.py:22](webapp/api/v1_freq_comp_fee.py#L22)、[v1_freq_regulation.py:22-23](webapp/api/v1_freq_regulation.py#L22)、[v1_rolling_match.py:21](webapp/api/v1_rolling_match.py#L21)、[v1_system.py](webapp/api/v1_system.py)、[v1_market_analysis.py](webapp/api/v1_market_analysis.py)、[v1_load_diagnosis.py](webapp/api/v1_load_diagnosis.py)、[v1_load_characteristics.py](webapp/api/v1_load_characteristics.py)、[v1_weather.py](webapp/api/v1_weather.py)、[v1_price_forecast.py](webapp/api/v1_price_forecast.py)、[v1_retail_prices.py](webapp/api/v1_retail_prices.py)、[v1_customer_energy.py](webapp/api/v1_customer_energy.py)、[v1_mechanism_energy.py](webapp/api/v1_mechanism_energy.py)、[v1_bid.py](webapp/api/v1_bid.py)、[medium_term_forecast.py](webapp/api/medium_term_forecast.py)
- [webapp/tools/excel_handler.py](webapp/tools/excel_handler.py) — Excel 导入路径

---

## 五、前端菜单/路由按 org_type 动态裁剪

### 1. 主体切换器

`AppBar` 右上角下拉，单主体用户隐藏。切换调 `/auth/switch-org` 后清缓存重载首页。

### 2. 菜单 / 路由元数据扩展

[Sidebar.tsx:58](frontend/src/components/Sidebar.tsx#L58) 与 [routes.tsx:42](frontend/src/config/routes.tsx#L42) 增加：

```ts
requiredOrgType?: 'retail_company'|'storage_station'|'power_plant'|'any'
requiredPlantSubtype?: 'wind'|'solar'|'thermal'
```

| 一级菜单 | requiredOrgType | 备注 |
|---|---|---|
| 交易总览 | any | 看板内容按主体类型切换 |
| 客户管理、客户分析、交易策略、交易复盘 | retail_company | |
| 价格分析、市场预测、基础数据 | any | |
| 结算管理 | retail_company | |
| 储能运营 | storage_station | |
| 电厂运营 | power_plant | **本期菜单占位+"功能待开放"提示**，后期单独立项 |
| 系统管理 | any（且需 system_admin） | |

### 3. 新增前端页面

- 系统管理 → **经营主体管理**（CRUD organizations、绑定用户、设默认）
- 系统管理 → **告警与日志**：跨主体筛选器（super_admin）/ 当前主体过滤
- 系统管理 → **任务调度配置**（编辑 task_schedule_configs，按主体分组展示）
- 储能运营 → **电站参数管理**（读写 `organizations.storage_profile`）
- 储能运营 → **储能结算总览/详情**（读 `storage_settlement_*` 新建集合）
- 电厂运营 → **本期仅菜单壳 + "功能待开放"提示页**，不开发任何子页面
- 系统管理 → **用户与权限**（[UserPermissionsPage.tsx](frontend/src/pages/UserPermissionsPage.tsx)）增加"主体绑定 + 角色"对话框

### 4. 演示脱敏

[init_auth_data.py:68](webapp/scripts/init_auth_data.py#L68) `data:customer_name:view_real` 改为读 `organizations.demo_mode`，按主体维度独立。

---

## 六、安全分阶段实施计划（按数据集分批，前期不影响生产）

### 总原则

1. **每批一个 PR**：按数据集分组，每组独立可上线、可回滚；上线即冻结 1 个工作日观察。
2. **前期不影响生产**：阶段 1-3 全部为"加字段、加索引、回填、镜像写"，老代码读老字段照常工作。
3. **代码与数据解耦**：先回填数据（生产不受影响）→ 再发布支持新字段的代码（双轨运行）→ 最后切换读路径并删除老字段。
4. **每批 4 步**：① 历史数据回填 `org_id` → ② 新增 `(org_id, ...)` 索引（不删旧）→ ③ 改 RPA / webapp 代码写入新字段 → ④ 改 webapp 读路径切换 + 验证 + 删旧索引。

### 阶段 0：环境隔离、备份、清理、基线（独立 PR，2-3 天，零风险）

#### 0.1 隔离开发环境（必做，避免污染生产）

当前现状：开发代码与生产代码、生产数据库混在同一目录、同一 MongoDB 实例。多主体改造涉及索引重建、字段下线等生产敏感操作，必须先隔离：

- **代码隔离**：在 `d:\Gitworks\` 下新建独立工作目录（推荐方式选其一）：
  - 方式 A（推荐）：用 `git worktree add d:\Gitworks\exds-web-multi-tenant feature/multi-tenant`，三个项目各自建 worktree。优点：与现有目录共享 git 对象库，磁盘占用小；缺点：工作目录变量需重新配置。
  - 方式 B：完整 `git clone` 到新目录 `d:\Gitworks\exds-web-mt\` / `exds-rpa-mt\` / `exds-stef-mt\`，独立分支开发。
- **数据库隔离**：新建独立 MongoDB 实例或独立 database：
  - 推荐：用 `mongodump` 从生产库导出，`mongorestore` 到本地新 database `exds_staging`。
  - 改造代码的 `~/.exds/config.ini` 指向 `exds_staging`，**生产配置文件不动**。
- **服务端口隔离**：staging 后端用 8006（生产 8005）；前端用 3001（生产 3000）；避免误连。
- **数据刷新机制**：staging 数据可定期（每周）从生产 dump 一次保持新鲜；或仅在关键阶段前刷新一次。

#### 0.2 生产数据备份

- **完整备份**生产 MongoDB（所有库，不只是 exds 库）：`mongodump --out d:\backup\exds_prod_<date>\`，归档至少 30 天。
- 阶段 1 之后每个阶段开始前**只备份 exds 库**：`mongodump --db exds --out ...`，归档 ≥ 7 天作为该阶段回滚基线。

#### 0.3 下线 7 个 DEPRECATED 集合（独立 PR，与多主体改造解耦）

- `weather_data` / `auxiliary_wind_forecast` / `auxiliary_solar_forecast` / `mp_load_curve` / `price_forecast_daily_results` / `backtest_results` / `user_load_data`
- 每个：在 staging 清理代码引用 → 跑回归 → 上 staging 验证 1 天 → 上生产删除集合。
- 这一步**不依赖多主体改造**，可与生产并行运行。

#### 0.4 staging 全量回归基线

- 编写 [exds-a3-regression](docs/spec/) 四角色 + 关键写流程 + 结算端到端的回归脚本。
- 在 staging 跑通一次，记录所有页面与数据的 baseline，作为后续每阶段对照。

#### 0.5 三项目版本协议

- webapp / rpa / stef 各自分支命名：`feature/multi-tenant-stage-N`。
- 阶段间依赖关系明确（如 RPA 阶段 3 必须先于 webapp 阶段 4 上线）。

### 阶段 1：注册表与会话骨架（1 周，零业务影响）

- 建 `organizations` 与 `user_org_memberships` 集合（不建 profile 子集合）。
- 写入 `DEFAULT_RC`、`DEFAULT_SS`（如生产已有储能则真实记录）。
- **storage_stations → organizations.storage_profile 迁移**：读 `storage_stations` 所有文档 → 在 `organizations` 中创建/更新对应 storage org。原集合保留作为只读备份。
- webapp 实现 `ScopedCollection` + 6 张白名单 + 启动校验，但**默认旁路**（feature flag 关闭时所有调用走原路径）。
- `CurrentUserContext` 增加 `current_org_id` 字段；登录默认绑定 `DEFAULT_RC`。
- 所有现有用户在 `user_org_memberships` 中绑到 `DEFAULT_RC`。
- **本阶段生产无感知**：所有 service 仍按原路径运行，新字段未启用。

### 阶段 2：业务集合分批回填 org_id（按子领域分小批，每批 1-2 天）

> 每批仅做"加 org_id 字段 + 加 (org_id,...) 索引"，老唯一索引保留；老代码读老字段不受影响。

| 批次 | 集合（小组） | 回填脚本要点 |
|---|---|---|
| 2.1 客户域 | customer_archives / customer_demo_aliases / customer_characteristics / customer_anomaly_alerts / customer_monthly_energy / analysis_history_log | `update_many({org_id:null}, {$set:{org_id:DEFAULT_RC}})` |
| 2.2 合同套餐域 | retail_contracts / retail_packages / pricing_models / retail_settlement_prices | 同上 |
| 2.3 零售结算域 | retail_settlement_daily / retail_settlement_monthly / wholesale_settlement_monthly / settlement_daily / settlement_period / trade_review_monthly_summary | 同上；同步重命名 settlement_daily/period 为 retail_settlement_pre_* 在阶段 5 |
| 2.4 客户负荷域 | unified_load_curve / raw_mp_data / raw_meter_data / load_forecast_results / medium_term_load_forecast | 数据量较大，分页 batch；进度可观察 |
| 2.5 意向客户域 | 5 个 intent_customer_* 集合 | 同上 |
| 2.6 储能域 | storage_strategies / storage_declarations / storage_history | 若已有真实储能 org，按业务方提供的归属表回填，否则 DEFAULT_SS |
| 2.7 Bid 域 | bid_trade_sources / bid_strategy_results / bid_strategy_evaluations | 暂全归 DEFAULT_RC |
| 2.8 SYSTEM | task_execution_logs / records / history / task_commands / system_alerts / task_schedule_configs / dashboard_snapshot | 历史数据 `org_id=null`（系统级），新数据按规则填 |

每批：脚本 dry-run → 上 staging 回归 → 上生产 → 观察 1 天再启动下一批。

### 阶段 3：ORG_REWRITE 集合 RPA 加 org_id 写入 + 回填（1 周）

> RPA 启动时已知 `--org-id`，写入文档时直接附加 `org_id`，无需解析层改动。每个 pipeline 单独发版。

| 批次 | RPA 改动 | webapp 配套 |
|---|---|---|
| 3.1 contracts_aggregated_daily / contracts_detailed_daily | [long_term_contracts.py](../exds-rpa/rpa/pipelines/long_term_contracts.py) 4 处硬编码改 `--org-id` 入参；写文档附加 `org_id`；保留 `entity` 字段不动 | webapp 阶段不动读路径 |
| 3.2 mechanism_energy_monthly | webapp 月度导入页面增加 org_id 字段（业务方录入） | 历史按 entity_name 反查回填 |
| 3.3 spot_settlement_daily / spot_settlement_period | [spot_settlement.py](../exds-rpa/rpa/pipelines/spot_settlement.py) 启动时按 `--org-id` 选账户登录；写文档附加 `org_id` | 历史回填 DEFAULT_RC |
| 3.4 trade_declare | [trade_declare.py](../exds-rpa/rpa/pipelines/trade_declare.py) 同上 | 调度从公共爬虫改为按主体执行 |
| 3.5 day_ahead_energy_declare | [day_ahead_declare.py](../exds-rpa/rpa/pipelines/day_ahead_declare.py) 同上 | 调度从公共爬虫改为按主体执行 |

每批：RPA 在 staging 跑 3-7 天 → 校验新数据 `org_id` 字段非空率 = 100% → 上生产。

### 阶段 4：webapp 读路径分批切换（按子领域，1-2 周）

> 阶段 2/3 所有数据已带 `org_id`，本阶段把 service 层从老查询切到 `ScopedCollection`。每个 service 一个 PR。

切换顺序（从底层到顶层）：

1. customer_service / contract_service / package_service / pricing_model_service
2. retail_settlement_service / retail_monthly_settlement_service / wholesale_monthly_settlement_service
3. load_aggregation_service / customer_load_overview_service / characteristics/service / customer_profit_analysis_service
4. intent_customer_diagnosis_service（5 个 intent 子集合）
5. settlement_service（含 ORG_REWRITE 集合的读取） / contract_price_service / contract_price_trend_service / monthly_trade_review_service / trade_review_service
6. dashboard_service（最后切，因为聚合多个集合）
7. v1_freq_comp_fee / v1_mechanism_energy / v1_market_analysis / v1_load_diagnosis 等 API 层

每个 service 切换后：staging 回归 → 生产灰度 1 天 → 进入下一个。

### 阶段 5：唯一索引升级与强校验（1 周）

- 按子领域分批升级唯一索引：先 `createIndex {org_id, ...}` → 等 1 小时观察 → 再 `dropIndex` 旧索引。
- 关闭 `ScopedCollection` 的 "无 org_id 兜底全集" fallback；开 `org_id is None → raise`。
- 删除 ORG_REWRITE 集合中遗留的 `entity` 字段（仅当所有读路径已切换且观察 1 周无回归后）。
- 重命名 `settlement_daily` / `settlement_period` → `retail_settlement_pre_*`（rename + 双名读双写过渡）。

### 阶段 6：调度框架协同与多主体能力开启（exds-stef + 前端，1 周）

- exds-stef `TaskLogger` / `CommandListener` / `AlertNotifier` 全量注入 `org_id`。
- service_config.yaml 扩展 `tenant_aware`；按主体的 job 循环各 retail org 调用。
- `stef.tasks.load.*` 写 `load_forecast_results.org_id`（按客户归属反查 retail org）。
- webapp 上线**主体管理页 + 主体切换器**（仅 super_admin 默认可见）。
- 系统管理页适配 SYSTEM 集合 `org_id` 维度筛选。
- 构造第二个真实 RC 主体（RC-002），跑 A3 角色矩阵 + 数据隔离断言。

### 阶段 7：储能结算 + 老集合下线（1 周）

- 建 `storage_settlement_daily` / `_period` / `_monthly`，对应 service。
- 储能主体的"结算管理"菜单指向新集合。
- 下线 `storage_stations` 集合：确认所有读路径已切到 `organizations.storage_profile` → 删除集合。
- 删除 ORG_REWRITE 集合中已下线的 `entity` 字段（独立 PR，确认无回归后执行）。
- 评估 `task_execution_history` vs `task_execution_logs` vs `task_execution_records` 三表是否合并（独立任务）。

### 阶段 8（可选）：开放新主体接入

- 邀请第二家真实售电公司或独立储能电站接入。
- 观察 ≥ 30 天稳定后才考虑启动电厂主体的实际开发（独立立项，按本方案 E 节展开）。

---

### 总耗时估算

| 阶段 | 工时 | 是否影响生产 |
|---|---|---|
| 0 | 2-3 天 | 否（含环境隔离） |
| 1 | 1 周 | 否 |
| 2 | 2 周（8 批） | 否（仅加字段加索引） |
| 3 | 1 周（5 批，RPA 工作量简化后） | 否 |
| 4 | 1-2 周（按子领域切换） | 灰度切换，可回滚 |
| 5 | 1 周 | 索引切换有短暂窗口 |
| 6 | 1 周 | 上线切换器 |
| 7 | 1 周 | 储能新表上线 |
| **合计** | **7-9 周** | RPA 简化后整体节省约 1 周 |

---

## 七、风险点与对应措施

| 风险 | 措施 |
|---|---|
| 三个项目独立 Git 仓库，发版协调失败 | 阶段 0 明确版本协议；阶段 3 仅在依赖项目新版本上线后触发 |
| exds-stef Windows 服务重启窗口受限 | 阶段 6 选业务低峰发布；保留旧版本 fallback 二进制 |
| 唯一索引切换瞬间冲突 | 阶段 5 分两步发布：先 createIndex → 等 ≥ 1 小时观察 → 再 dropIndex |
| `mechanism_energy_monthly.entity_name → org_id` 映射不全 | 阶段 3 回填前先人工核对种子映射表 |
| 电厂集合本期不实现，前端菜单需占位 | 系统管理可创建 power_plant org，但运营菜单显示"功能待开放" |
| dashboard 跨主体聚合视角丢失 | 一期 super_admin 仅在主体管理页看清单，不做聚合看板 |
| `task_schedule_configs` 改造影响 RPA 现有调度 | 阶段 2.8 切到双字段：保留旧字段 + 新增 org_id（null 兼容） |
| RPA `~/.exds/config.ini` 单账户假设 | 阶段 3 改为多账户配置，公共爬虫沿用默认账户 |
| `storage_declaration_service` 隐式单电站 + 集合迁移 | 阶段 1 把 `storage_stations` 各文档迁移到 `organizations.storage_profile`；阶段 4 改 service 读 organizations |
| ORG_REWRITE 3 个集合 RPA 写入漏 org_id | 阶段 3 加单元测试：写文档前断言 `org_id != null`；上线后监控 3-7 天 |
| 历史 `spot_settlement_*` / `trade_declare` / `day_ahead_energy_declare` 无 org_id | 阶段 3 统一回填 `DEFAULT_RC`；若当前生产实际有多个售电公司数据混在一起，业务方先指认归属 |
| 一次性切换（不双写）失败需要回滚 | 每个 ORG_REWRITE 集合切换前 `mongodump` 备份；新索引保留 7 天兜底；rollback 仅需删 org_id 字段并回退索引 |
| 当前开发与生产共用同一 MongoDB | 阶段 0 必须先做环境隔离，新建独立 staging 库与代码 worktree，生产配置文件不动 |

---

## 八、验证方案

1. **单元 + 集成测试**：
   - `tests/test_scoped_db.py`：覆盖 `ScopedCollection` 在 7 类集合（RETAIL / STORAGE / GLOBAL_SHARED / ORG_REWRITE / SYSTEM / AUTH / ORG_REGISTRY）上的注入/拒绝行为。
   - `tests/test_org_isolation.py`：构造 RC-001、RC-002、SS-001 三主体（电厂本期不实现，不构造），分别写入业务数据，断言互相读不到对方。
   - `tests/test_org_rewrite_migration.py`：验证 ORG_REWRITE 7 个集合的 `org_id` 回填正确性、`entity_name` 字段非空率、新索引唯一性。

2. **A3 角色矩阵回归**：每阶段结束跑一次。

3. **ORG_REWRITE 切换校验**：阶段 3/4 每批上线后做对账：
   - `contracts_aggregated_daily`：`org_id == DEFAULT_RC` 数 + `org_id IS NULL`（perspective=market）数 = 总记录数。
   - `contracts_detailed_daily`、`mechanism_energy_monthly`：所有文档 `org_id` 非空，反查 `organizations` 必命中。
   - `spot_settlement_daily/period`、`trade_declare`、`day_ahead_energy_declare`：阶段 3 上线后 3-7 天内新数据 `org_id` 字段非空率 = 100%；历史数据 `org_id == DEFAULT_RC`。任一不一致即停止上线。

4. **后端启动校验**：所有 collection 必须分类；遗漏抛错阻断启动。

5. **前端构建检查**：`npm run build --prefix frontend` 通过；菜单按 `current_org_type` 过滤的快照测试覆盖 4 类主体。

6. **三项目联调**：staging 同时跑 exds-web、exds-rpa、exds-stef，触发并验证：
   - rpa 公共爬虫（spot_price、weather、price_sgcc 等）→ GLOBAL 集合无 org_id ✓
   - rpa 长协合同采集（带 `--org-id RC-001`）→ `contracts_aggregated_daily` / `contracts_detailed_daily` 含 org_id ✓
   - rpa 按主体抓取（spot_settlement / trade_declare / day_ahead_declare 带 `--org-id RC-001`）→ ORG_REWRITE 集合 entity_name + org_id 都正确写入 ✓
   - stef 公共预测（d1 价格、shadow） → `task_execution_logs.org_id=null` ✓
   - stef 按主体负荷预测 → `task_execution_logs.org_id` 正确 ✓
   - webapp 触发 task_command 重算 → 仅当前主体的命令被消费 ✓
   - 验证 `system_alerts` 跨主体过滤、`task_schedule_configs` 按主体分组生效。

7. **生产灰度**：先创建 1 个真实第二主体（友好客户），观察 ≥ 7 天再批量开放。

---

## 九、不在本方案范围

- **电厂主体的实质实现**：本期仅在文档预留 6 个 plant_* 集合定义与 `organizations.plant_profile` 子文档，不写代码、不建表。后续真实接入电厂时再按本方案 E 节启动开发。
- 跨主体聚合看板（super_admin 视角）——后续立项。
- 储能与售电的资金往来对账（`inter_org_settlement`）——按需立项。
- `task_execution_logs` 与 `task_execution_history` / `task_execution_records` 三个集合是否合并——独立任务评估。
- exds-rpa / exds-stef 拆分为多实例独立部署——本期保持单实例 + 多账户配置。
