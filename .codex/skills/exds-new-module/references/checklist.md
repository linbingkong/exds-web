# 新增页面/模块接入检查清单

## 1. 先判定范围

1. 是否新增 `module_code`。
2. 是否只是旧模块下新增路由。
3. 是否包含写操作。
4. 是否需要例外权限。

## 2. 前端入口

1. 菜单是否已补到 `frontend/src/components/Sidebar.tsx`。
2. 页签路由是否已补到 `frontend/src/config/routes.tsx`。
3. 移动端路由是否已补到 `frontend/src/App.tsx`。
4. 页面标题与菜单文案是否一致。

## 3. 路由与请求鉴权

1. `frontend/src/auth/permissionPrecheck.ts` 是否新增路由 `view` 校验。
2. 如有写请求，是否补齐 `MUTATION_PERMISSION_RULES`。
3. 写按钮是否做前置权限控制与提示文案。

## 4. 权限种子

1. `webapp/scripts/init_auth_data.py` 是否补入 `MODULE_DEFINITIONS`。
2. 新模块排序和菜单组是否正确。
3. 如角色默认权限应覆盖该模块，是否同步更新角色集合。
4. 如有例外权限，是否同步补齐说明与关联。

## 5. 后端兜底

1. 新增写接口是否加 `Depends(require_permission(...))`。
2. 高风险删除、重算、管理操作是否叠加例外权限。
3. 时间字段新增写入是否使用 `datetime.now()`。

## 6. 数据同步

1. 只要改了 `webapp/scripts/init_auth_data.py`，必须执行：

```bash
.venv/Scripts/python -m webapp.scripts.init_auth_data
```

2. 如用户反馈“角色配置页没有这一项”，优先检查数据库中的：
- `auth_modules`
- `auth_permissions`

## 7. 自动校验

```bash
npm run build --prefix frontend
.venv/Scripts/python scripts/check_auth_all.py
```

## 8. 输出结果时必须说明

1. 本次使用的 `module_code`。
2. 是否新增了菜单和路由。
3. 是否执行了权限种子同步。
4. 构建和鉴权检查是否通过。
