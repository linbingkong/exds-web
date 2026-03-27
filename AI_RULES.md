# AI 研发规则（鉴权强制版）

本文档是项目内所有 AI 助手与开发者的统一约束，目标是杜绝“遗漏鉴权”。

## 1. 强制原则（不可跳过）

1. 所有会修改数据集的操作（新增、编辑、删除、导入、重算、同步、上传、触发任务）必须同时满足：
- `R`：路由访问权限（`module:*:view`）
- `B`：按钮前置权限（`module:*:edit` + 例外权限）
- `Q`：前端请求前拦截（`frontend/src/auth/permissionPrecheck.ts`）
- `S`：后端写接口兜底（`Depends(require_permission(...))`）
2. 任何前端体验优化都不能替代后端兜底；后端 `S` 是最终安全边界。
3. 新增页面或接口时，必须先定义权限码，再写业务代码。

## 2. 权限模型（两档 + 例外）

1. 模块两档权限：
- `module:{module_code}:view`
- `module:{module_code}:edit`

2. 例外权限（高风险）：
- `system:logs:resolve`
- `system:data_access:manage`
- `settlement:recalc:execute`
- `data:critical:delete`
- `system:auth:manage`

## 3. 前端开发硬规则

1. 禁止直接使用 `axios`，必须使用 `frontend/src/api/client.ts`。
2. 写按钮必须绑定权限（禁用或隐藏），并给出明确提示文案。
3. 新增写请求时，必须在 `MUTATION_PERMISSION_RULES` 增加匹配规则。
4. 菜单和路由的访问权限必须走 `getRequiredViewPermissionForRoute`。
5. Recharts 图表默认必须去掉点击或键盘聚焦后的黑色焦点外框；图表容器需补充 `& .recharts-surface:focus { outline: none; }`，必要时补充 `& *:focus { outline: none !important; }`。
6. 页面根容器的左右与顶部留白需和同类页面保持一致；没有明确设计要求时，不要额外增加首屏左侧和顶部间距。

## 4. 后端开发硬规则

1. 所有 `POST/PUT/PATCH/DELETE` 路由必须挂权限依赖：
- `Depends(require_permission("module:xxx:edit"))`
- 删除类高风险操作同时加：`Depends(require_permission("data:critical:delete"))`（适用时）
2. 不允许仅依赖前端拦截。

## 5. 自动化检查（必须通过）

提交前必须执行：

```bash
.venv/Scripts/python scripts/check_auth_all.py
```

该命令会执行：
1. 后端写接口鉴权扫描：`scripts/check_auth_backend.py`
2. 前端写请求规则覆盖扫描：`scripts/check_auth_frontend.py`
3. 路由与菜单权限一致性检查：`scripts/check_auth_route_consistency.py`

任一失败，禁止提交。

## 6. Git Hook（建议强制）

```bash
git config core.hooksPath .githooks
```

启用后，`pre-commit` 会自动执行鉴权检查脚本。

## 7. AI 助手执行要求

1. 开始开发前必须先读取本文件。
2. 完成代码后必须运行 `scripts/check_auth_all.py` 并报告结果。
3. 若发现“新增写接口但无法确定权限码”，必须暂停并让业务方确认，不允许猜测上线。

## 8. PR 检查清单（必须填写）

1. 本次新增/修改了哪些写操作？
2. 对应权限码是什么？
3. 前端 `B/Q` 在哪里实现？
4. 后端 `S` 在哪里实现？
5. 自动化检查是否通过？

## 9. 时间字段统一规则（强制）

1. 后端统一使用 `datetime.now()`（naive）生成时间。
2. 禁止新增 `datetime.utcnow()` 与 `datetime.now(timezone.utc)`。
3. 涉及落库时间字段（`created_at/updated_at/imported_at/login_at/logout_at` 等）必须保持同一格式。

## 10. 提交日志规则（强制）

1. 提交日志格式必须为：
- `type(scope): 中文描述`

2. `type` 仅允许：
- `feat|fix|refactor|docs|chore|perf|test|build|ci|revert`

3. `scope` 仅允许英文小写 kebab-case（如 `auth`、`user-permissions`、`settlement`）。
建议优先 scope：
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

4. 描述必须是中文语义，不允许空描述。

5. 建议通过 `commit-msg` hook 自动检查提交日志格式。
