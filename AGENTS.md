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

## 4. 规则索引（必须按需阅读）

以下细则从主文件拆分到独立文档。AI 助手执行相关任务前必须先阅读对应文档，并按其中要求执行。

1. 开始任何代码或文档修改前，必须阅读：`docs/spec/AI执行总纲.md`。
2. 涉及后端接口、数据库、脚本、服务、权限依赖或 FastAPI 代码时，必须阅读：`docs/spec/后端开发规范.md`。
3. 涉及前端页面、组件、Hook、样式、请求或 React/TypeScript 代码时，必须阅读：`docs/spec/前端开发规范.md`。
4. 涉及新增业务页面、菜单、模块权限、写接口、权限校验或提交前权限检查时，必须阅读：`docs/spec/权限与鉴权规则.md`。
5. 涉及提交、提交日志、commit hook 或提交前门禁时，必须阅读：`docs/spec/Git提交规范.md`。
6. 引用文档通常不会被自动展开到全局提示词中；必须通过主文件中的“按需阅读”要求触发读取。对高风险规则，应在主文件保留索引与触发条件。

## 5. 后端开发规范

1. 所有数据库操作通过 `webapp.tools.mongo.DATABASE`。
2. 新增写接口必须挂权限依赖。
3. 删除等高风险操作需叠加 `data:critical:delete`（适用时）。
4. 使用类型提示、日志、RESTful 设计与统一错误处理。

## 6. 前端开发规范（关键）

1. Material UI Grid 使用 v7 语法：`size={{ xs: 12, md: 6 }}`。
2. 图表全屏统一使用 `useChartFullscreen`。
3. Recharts 图表默认必须去掉点击或键盘聚焦后的黑色焦点外框；图表容器统一补充 `& .recharts-surface:focus { outline: none; }`，必要时补充 `& *:focus { outline: none !important; }`。
4. 写操作按钮必须做前置权限控制（禁用/隐藏 + 清晰提示）。
5. 移动端优先，保持响应式布局。
6. 页面根容器的外层留白需与同类页面保持一致，默认不要额外叠加明显的左侧与顶部间距；如无特殊设计要求，优先复用现有页面的 gutter 和首屏间距。

## 7. 语言与协作约束

1. 全部沟通、注释、文档使用简体中文。
2. 信息不足时先说明不确定性，不做拍脑袋改动。
3. 默认最小改动，除非明确要求重构。

## 8. 时间字段规范（强制）

1. 项目统一使用 `datetime.now()`（naive）生成时间，禁止新增 `datetime.utcnow()` 与 `datetime.now(timezone.utc)`。
2. 涉及数据库落库时间字段（如 `created_at`、`updated_at`、`imported_at`、`login_at`、`logout_at`）必须按本规则执行。
3. 历史数据若包含时区信息，读取时可做兼容转换，但新写入必须保持 naive 格式一致。

## 9. 参考文件

- `docs/spec/AI执行总纲.md`
- `docs/spec/后端开发规范.md`
- `docs/spec/前端开发规范.md`
- `docs/spec/权限与鉴权规则.md`
- `docs/spec/Git提交规范.md`
- `frontend/src/auth/permissionPrecheck.ts`
- `webapp/scripts/init_auth_data.py`
- `scripts/check_auth_all.py`
- `docs/pages/用户权限管理/用户权限管理实施计划1.1.md`

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
