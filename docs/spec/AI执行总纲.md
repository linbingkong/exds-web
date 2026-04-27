# AI 研发规则（总纲）

本文档是项目内所有 AI 助手与开发者的执行总纲，用于说明工作入口、规则读取顺序与不可跳过的安全边界。

具体规则已拆分到 `docs/spec` 目录，本文不重复维护细则，避免多处规则漂移。

## 1. 必读规则索引

AI 助手执行任务时，必须按任务类型读取对应文档：

1. 任何代码或文档修改：先阅读 `AGENTS.md` 与本文档。
2. 前端页面、组件、Hook、样式、请求、React/TypeScript 代码：阅读 `docs/spec/前端开发规范.md`。
3. 后端接口、数据库、脚本、服务、FastAPI 代码：阅读 `docs/spec/后端开发规范.md`。
4. 新增业务页面、菜单、模块权限、写接口、权限校验、权限检查：阅读 `docs/spec/权限与鉴权规则.md`。
5. 提交、提交日志、commit hook、提交前门禁：阅读 `docs/spec/Git提交规范.md`。
6. 新增业务页面、菜单、模块权限或写接口：优先使用项目技能 `exds-new-module`。

## 2. 不可跳过原则

1. 权限相关任务必须先确认权限码，再写业务代码；无法确定权限码时必须暂停确认。
2. 所有写操作必须落实 `R/B/Q/S` 四层鉴权；细则以 `docs/spec/权限与鉴权规则.md` 为准。
3. 前端体验优化不能替代后端兜底；后端权限依赖是最终安全边界。
4. 后端新增落库时间字段必须使用 `datetime.now()`（naive），禁止新增 `datetime.utcnow()` 与 `datetime.now(timezone.utc)`。
5. 默认最小改动，优先复用项目现有模式、Hook、工具与规范。
6. 本项目包含中文内容，修改文件必须使用 diff/patch 方式，避免整文件重写和编码破坏。

## 3. AI 助手执行流程

1. 开始前：读取本文件、`AGENTS.md` 和任务相关的 `docs/spec` 文档。
2. 修改中：只触碰与任务直接相关的文件；遇到已有未提交改动，不得回退用户改动。
3. 权限相关变更：同步检查前端按钮、请求拦截、路由访问、后端依赖和权限种子数据。
4. 完成后：运行与变更范围匹配的检查命令，并报告结果。
5. 无法运行检查时：说明原因和剩余风险，不隐瞒未验证项。

## 4. 常用检查入口

前端代码修改后必须执行：

```bash
npm run build --prefix frontend
```

权限相关改动或提交前必须执行：

```bash
.venv/Scripts/python scripts/check_auth_all.py
```

启用 Git Hook（按团队需要）：

```bash
git config core.hooksPath .githooks
```

## 5. PR 检查清单

1. 本次新增/修改了哪些写操作？
2. 对应权限码是什么？
3. 前端 `B/Q` 在哪里实现？
4. 后端 `S` 在哪里实现？
5. 是否更新 `webapp/scripts/init_auth_data.py`（适用时）？
6. 是否通过 `npm run build --prefix frontend`（前端适用）？
7. 是否通过 `.venv/Scripts/python scripts/check_auth_all.py`（权限相关适用）？
8. 提交日志是否符合 `docs/spec/Git提交规范.md`？
