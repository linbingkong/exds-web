# 项目协作指引（exds-web）

本文档用于统一 AI 助手与开发者在本项目中的开发行为，重点确保权限校验不遗漏。

## 1. 项目概览

- 项目名称：电力交易辅助决策系统（exds-web）
- 架构：前后端分离
- 后端：FastAPI + MongoDB
- 前端：React（TypeScript）+ Material UI + Recharts

## 2. 常用命令

### 后端

```bash
pip install -r webapp/requirements.txt
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8005
```

### 前端

```bash
npm install --prefix frontend
npm start --prefix frontend
npm run build --prefix frontend
npm test --prefix frontend
```

- 前端地址：`http://localhost:3000`
- 后端地址：`http://127.0.0.1:8005`
- 前端 `/api` 已代理到后端。

## 3. 前端开发工作流

1. 不要主动启动前端服务；若未启动，提示用户手工启动。
2. 修改前端代码后，必须执行：`npm run build --prefix frontend`。
3. 优先使用项目内现有可复用 Hook，不重复造轮子。
4. 所有请求必须通过：`frontend/src/api/client.ts`。

## 4. 权限模型（强制）

采用“模块两档 + 例外权限”模型：

- 模块权限：
- `module:{module_code}:view`
- `module:{module_code}:edit`

- 例外权限：
- `system:logs:resolve`
- `system:data_access:manage`
- `settlement:recalc:execute`
- `data:critical:delete`
- `system:auth:manage`

## 5. 鉴权实施要求（R/B/Q/S）

所有写操作（新增、编辑、删除、导入、同步、上传、重算、触发任务）必须同时满足：

1. `R`（Route）：路由访问校验 `module:*:view`
2. `B`（Button）：按钮前置校验 `module:*:edit`（必要时叠加例外权限）
3. `Q`（Query）：前端请求前拦截（`permissionPrecheck.ts`）
4. `S`（Server）：后端写接口兜底（`Depends(require_permission(...))`）

说明：前端体验优化不能替代后端 `S` 层安全边界。

## 6. 自动化检查（提交前必须通过）

```bash
.venv/Scripts/python scripts/check_auth_all.py
```

会执行：

1. `scripts/check_auth_backend.py`
2. `scripts/check_auth_frontend.py`
3. `scripts/check_auth_route_consistency.py`

任一失败，禁止提交。

补充约束：

1. 新增业务页面、菜单、模块权限或写接口时，除更新代码外，还必须同步更新 `webapp/scripts/init_auth_data.py`（适用时）。
2. 只要修改了 `webapp/scripts/init_auth_data.py`，必须执行：`python -m webapp.scripts.init_auth_data`，否则角色配置页与权限清单可能仍显示旧数据。
3. 此类任务优先使用项目技能：`exds-new-module`。

## 7. 后端开发规范

1. 所有数据库操作通过 `webapp.tools.mongo.DATABASE`。
2. 新增写接口必须挂权限依赖。
3. 删除等高风险操作需叠加 `data:critical:delete`（适用时）。
4. 使用类型提示、日志、RESTful 设计与统一错误处理。

## 8. 前端开发规范（关键）

1. Material UI Grid 使用 v7 语法：`size={{ xs: 12, md: 6 }}`。
2. 图表全屏统一使用 `useChartFullscreen`。
3. Recharts 图表默认必须去掉点击或键盘聚焦后的黑色焦点外框；图表容器统一补充 `& .recharts-surface:focus { outline: none; }`，必要时补充 `& *:focus { outline: none !important; }`。
4. 写操作按钮必须做前置权限控制（禁用/隐藏 + 清晰提示）。
5. 移动端优先，保持响应式布局。
6. 页面根容器的外层留白需与同类页面保持一致，默认不要额外叠加明显的左侧与顶部间距；如无特殊设计要求，优先复用现有页面的 gutter 和首屏间距。

## 9. 语言与协作约束

1. 全部沟通、注释、文档使用简体中文。
2. 信息不足时先说明不确定性，不做拍脑袋改动。
3. 默认最小改动，除非明确要求重构。

## 10. 时间字段规范（强制）

1. 项目统一使用 `datetime.now()`（naive）生成时间，禁止新增 `datetime.utcnow()` 与 `datetime.now(timezone.utc)`。
2. 涉及数据库落库时间字段（如 `created_at`、`updated_at`、`imported_at`、`login_at`、`logout_at`）必须按本规则执行。
3. 历史数据若包含时区信息，读取时可做兼容转换，但新写入必须保持 naive 格式一致。

## 11. 参考文件

- `AI_RULES.md`
- `frontend/src/auth/permissionPrecheck.ts`
- `webapp/scripts/init_auth_data.py`
- `scripts/check_auth_all.py`
- `docs/todo/用户权限管理实施计划1.1.md`

## 12. 提交日志规范（强制）

1. 提交信息必须使用以下格式：
- `type(scope): 中文描述`

2. `type` 允许值：
- `feat`
- `fix`
- `refactor`
- `docs`
- `chore`
- `perf`
- `test`
- `build`
- `ci`
- `revert`

3. `scope` 规则：
- 使用英文小写 + kebab-case（示例：`auth`、`user-permissions`、`settlement`）
- 禁止中文、空格、下划线、驼峰
- 推荐 scope 白名单（优先使用）：
- `auth`
- `user-permissions`
- `settlement`
- `pricing`
- `customer`
- `load-analysis`
- `trade-review`
- `frontend`
- `backend`
- `docs`

4. 描述规则：
- 必须为中文语义，简洁明确
- 示例：`feat(auth): 新增登录失败锁定与自动解锁机制`

5. 提交门禁：
- 可通过 `commit-msg` hook 对提交日志格式进行自动校验（按团队需要启用）。

# 🚨 中文编码保护规则（必须遵守）

## 基本原则

* 本项目包含中文，严禁出现乱码
* 所有文件必须保持原始编码（默认 UTF-8）
* 不得修改已有中文内容（注释 / 字符串）

## 文件修改策略

* 必须使用 diff / patch 方式修改文件
* 禁止整文件重写（特别是含中文文件）
* 禁止使用以下方式写文件：

  * echo > file
  * Set-Content
  * Out-File
  * 重定向 >

## 中文处理规则

* 不得改变中文内容（包括标点）
* 不得将中文转义为 unicode（如 \u4e2d\u6587）
* 如果检测到中文：

  * 只修改相关代码片段
  * 避免触碰中文所在行

## 执行环境要求

* 必须使用 PowerShell 7（pwsh）
* 默认编码必须为 UTF-8（无 BOM）

## 异常处理（非常重要）

* 如果无法保证不会破坏中文：

  * 停止修改
  * 输出说明，而不是强行写入
