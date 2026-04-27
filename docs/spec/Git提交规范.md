# Git 提交规范

本文档用于集中维护 exds-web 的提交日志格式与提交前门禁要求。

## 1. 提交日志格式（强制）

提交信息必须使用以下格式：

- `type(scope): 中文描述`

示例：

- `feat(auth): 新增登录失败锁定与自动解锁机制`

## 2. type 允许值

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

## 3. scope 规则

1. 使用英文小写 + kebab-case（示例：`auth`、`user-permissions`、`settlement`）。
2. 禁止中文、空格、下划线、驼峰。
3. 推荐 scope 白名单（优先使用）：

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

## 4. 描述规则

1. 必须为中文语义。
2. 简洁明确，说明本次提交的核心变更。

## 5. 提交门禁

1. 权限相关改动必须先通过 `docs/spec/权限与鉴权规则.md` 中的自动化检查。
2. 可通过 `commit-msg` hook 对提交日志格式进行自动校验（按团队需要启用）。
