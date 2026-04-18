---
name: exds-full-height-page
description: exds-web 页面需要改造成“满高内容页”时使用。适用于图表页、Tab 子页面、Dashboard/总览页等需要在桌面端贴合浏览器可视高度、移动端保持自然纵向排布的场景。用于识别页面挂载在 DesktopTabLayout、独立页面或全宽页面中的哪一种容器体系，并按场景选择高度、间距、overflow 与 Recharts 容器的正确改法，避免出现底部大留白、页面滚动条、图表空白不渲染或边距异常。
---

# exds-full-height-page

## 默认目标

1. 桌面端内容区贴合浏览器可视高度，避免无意义底部留白。
2. 移动端保持自然纵向排布，不强行满高。
3. 页面与浏览器边界的留白沿用同类页面口径，不重复叠加。
4. Recharts 图表在桌面端和移动端都能拿到稳定高度。

## 先做场景判定

先判断当前页面属于哪一类，再决定改法。不要一上来就在页面内部硬写 `100vh`。

1. `DesktopTabLayout` 下的普通 Tab 子页面。
2. `DesktopTabLayout` 下需要“满高内容页”的 Tab 子页面。
3. 独立页面自行控制视口高度，例如首页“交易总览”。
4. Full-bleed 页面，外层已经去掉内容区 `p`。

场景判定参考：

- `frontend/src/layouts/DesktopTabLayout.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `references/scenarios.md`

## 执行步骤

1. 先确认页面挂载路径与外层布局：
- 是否走 `DesktopTabLayout`
- 是否已经在 `FULL_BLEED_TAB_PATHS`
- 是否适合加入 `FULL_HEIGHT_TAB_PATHS`

2. 再确认页面内部结构：
- 页面根容器
- TabPanel 或内容包装层
- 主内容区
- 卡片容器
- 图表父容器

3. 按场景应用对应方案：
- 规则见 `references/scenarios.md`

4. 图表页额外检查 Recharts 容器：
- 规则见 `references/checklist.md`

5. 完成后至少执行：
- `npm run build --prefix frontend`

## 关键规则

1. 对 `DesktopTabLayout` 下的 Tab 子页面：
- 优先让外层通过 `FULL_HEIGHT_TAB_PATHS` 提供 `height: 100%`
- 页面内部用 `display: flex`、`flexDirection: column`、`flex: 1`、`minHeight: 0`
- 不要在页面根上额外叠加和外层重复的 `px/py`

2. 对独立 Dashboard/总览页：
- 可以在页面根按固定框架高度直接计算桌面端高度
- 参考首页“交易总览”的 `calc(100vh - 顶栏 - 页签栏)` 方式
- 页面主区使用 grid 或 flex 分发剩余高度

3. 对所有图表卡片：
- `Paper` 或卡片层通常使用 `height: { xs: 'auto', md: '100%' }`
- 图表直接父容器必须提供真实高度，例如 `height: { xs: 260, md: '100%' }`
- 仅有 `flex: 1` 往往不够，移动端常需显式 `height`

4. 对移动端：
- 不强行继承桌面端满高逻辑
- 一般使用 `height: 'auto'`
- `overflow` 多数应回到 `visible` 或自然滚动

5. 对间距：
- 优先复用同类页面现有 gutter
- 如果外层布局已有 `p`，页面内部不要再补一层明显外边距

## 常见失败模式

1. 底部留很大一截空白：
- 通常是页面没有真正吃满父层高度，或卡片最小高度过大。

2. 页面出现纵向滚动条：
- 通常是多层 `padding + gap + minHeight` 叠加，把总高度撑破。

3. 图表空白不显示：
- 通常是 `ResponsiveContainer` 的父容器没有稳定的实际高度。

4. 左右或顶部间距比首页大很多：
- 通常是页面自己加了 `px/py`，同时外层内容区已有 padding。

## 输出要求

输出结果时要明确说明：

1. 页面属于哪种场景。
2. 是否修改了 `DesktopTabLayout` 或路由级容器。
3. 图表高度兜底是如何处理的。
4. 是否已执行 `npm run build --prefix frontend`。
5. 是否还存在桌面端/移动端残留风险。
