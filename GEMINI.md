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

## 7. 后端开发规范

1. 所有数据库操作通过 `webapp.tools.mongo.DATABASE`。
2. 新增写接口必须挂权限依赖。
3. 删除等高风险操作需叠加 `data:critical:delete`（适用时）。
4. 使用类型提示、日志、RESTful 设计与统一错误处理。

## 8. 前端开发规范（关键）

1. Material UI Grid 使用 v7 语法：`size={{ xs: 12, md: 6 }}`。
2. 图表全屏统一使用 `useChartFullscreen`。
3. 写操作按钮必须做前置权限控制（禁用/隐藏 + 清晰提示）。
4. 移动端优先，保持响应式布局。

## 9. 语言与协作约束

1. 全部沟通、注释、文档使用简体中文。
2. 信息不足时先说明不确定性，不做拍脑袋改动。
3. 默认最小改动，除非明确要求重构。

## 10. 时间字段规范（强制）

1. 项目统一使用 `datetime.now()`（naive）生成时间，禁止新增 `datetime.utcnow()` 与 `datetime.now(timezone.utc)`。
2. 涉及数据库落库时间字段（如 `created_at`、`updated_at`、`imported_at`、`login_at`、`logout_at`）必须按本规则执行。
3. 历史数据若包含时区信息，读取时可做兼容转换，但新写入必须保持 naive 格式一致。

## 11. 参考文件

- `docs/spec/AI执行总纲.md`
- `frontend/src/auth/permissionPrecheck.ts`
- `webapp/scripts/init_auth_data.py`
- `scripts/check_auth_all.py`
- `docs/todo/用户权限管理实施计划1.1.md`
