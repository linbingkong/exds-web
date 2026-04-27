# AI 鉴权提示词模板

将以下模板粘贴给任意 AI 助手，可强制其按项目鉴权规则开发：

```text
你在 exds-web 项目中开发。必须遵循 `docs/spec/AI执行总纲.md` 与 `docs/spec/权限与鉴权规则.md`：
1) 涉及新增、编辑、删除、导入、重算、同步、上传、触发任务时，必须同时实现 R+B+Q+S。
2) 前端必须通过 apiClient，并补齐 permissionPrecheck.ts 的 MUTATION_PERMISSION_RULES。
3) 后端所有写接口必须挂 Depends(require_permission(...))，高风险操作补例外权限。
4) 交付前必须运行 .venv/Scripts/python scripts/check_auth_all.py 并报告结果。
5) 如权限码无法确认，先暂停并给出待确认项，不允许自行猜测上线。
```
