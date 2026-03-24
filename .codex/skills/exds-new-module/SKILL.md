---
name: exds-new-module
description: exds-web 新增业务页面、菜单或模块权限时使用。用于统一补齐菜单、路由、权限种子、R/B/Q/S 校验、构建检查与权限数据同步，避免遗漏。
---

# exds-new-module

## 适用场景

1. 新增业务页面或菜单入口。
2. 新增模块权限或调整模块归属。
3. 新增写接口，需要补齐 `R/B/Q/S`。
4. 页面已接入，但角色配置页或权限清单未同步。

## 默认目标

1. 最小改动完成接入。
2. 不遗漏菜单、路由、权限种子和落库同步。
3. 前端构建与鉴权检查通过。

## 执行步骤

1. 先判断本次是：
- 新模块
- 旧模块下新增页面
- 旧页面仅调整权限
2. 对照检查清单执行接入：
- `references/checklist.md`
3. 如修改了 `webapp/scripts/init_auth_data.py`：
- 必须执行 `python -m webapp.scripts.init_auth_data`
4. 完成后至少执行：
- `npm run build --prefix frontend`
- `.venv/Scripts/python scripts/check_auth_all.py`
5. 输出结果时明确说明：
- 新增或复用的 `module_code`
- 是否已执行权限种子同步
- 是否通过构建与鉴权检查

## 关键文件

1. `frontend/src/components/Sidebar.tsx`
2. `frontend/src/config/routes.tsx`
3. `frontend/src/App.tsx`
4. `frontend/src/auth/permissionPrecheck.ts`
5. `frontend/src/api/client.ts`
6. `webapp/scripts/init_auth_data.py`

## 参考

1. `AGENTS.md`
2. `AI_RULES.md`
3. `frontend/src/auth/permissionPrecheck.ts`
4. `webapp/scripts/init_auth_data.py`
5. `scripts/check_auth_all.py`
6. `references/checklist.md`
