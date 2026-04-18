# 场景分流

## 1. DesktopTabLayout 下的满高 Tab 子页面

适用特征：

1. 页面是桌面端页签内容的一部分。
2. 路径由 `DesktopTabLayout` 承载。
3. 页面本身不应该再独立计算 `100vh`。

推荐改法：

1. 在 `frontend/src/layouts/DesktopTabLayout.tsx` 中把对应路径加入 `FULL_HEIGHT_TAB_PATHS`。
2. 让页签内容区对该路径使用：
- `overflow: hidden`
- `display: flex`
3. 让当前页面根容器使用：
- `height: '100%'`
- `minHeight: 0`
- `display: 'flex'`
- `flexDirection: 'column'`
4. 若存在 `TabPanel`，保证 `TabPanel -> 页面根 -> 内容主区` 这一整条链路都能传递高度。
5. 页面内部不要再自己补浏览器级 `px/py`，避免与外层内容区 padding 叠加。

典型例子：

- `frontend/src/pages/ContractPriceTrendPage.tsx`
- `frontend/src/components/contract-price-trend/PriceTrendTab.tsx`
- `frontend/src/components/contract-price-trend/CurveCompareTab.tsx`
- `frontend/src/components/contract-price-trend/QuantityStructureTab.tsx`

## 2. 独立 Dashboard / 总览页

适用特征：

1. 页面本身就是一级内容页。
2. 整个桌面首屏要被卡片网格直接占满。
3. 页面希望和浏览器视口直接建立高度关系。

推荐改法：

1. 页面根容器桌面端可直接使用：
- `height: 'calc(100vh - 顶栏高度 - 页签栏高度)'`
- `overflowY: 'hidden'`
2. 页面内部主内容区可使用 grid/flex 直接分行分列。
3. 卡片组件统一用：
- `height: { xs: 'auto', md: '100%' }`
- `minHeight: 0`
4. 图表容器统一用：
- `height: { xs: 固定值, md: '100%' }`

典型例子：

- `frontend/src/pages/DashboardPage.tsx`

## 3. Full-bleed 页面

适用特征：

1. 页面需要吃满页签内容区，不保留默认外层 padding。
2. 页面通常是画布、策略工作台或强视觉布局页。

推荐改法：

1. 路径加入 `FULL_BLEED_TAB_PATHS`。
2. 页面自行定义完整边距体系。
3. 不要再依赖外层默认 `p: 3`。

## 4. 图表页通用补充

不论属于哪种场景，只要有 Recharts，就继续检查：

1. `ResponsiveContainer` 的直接父容器必须有真实高度。
2. 移动端优先显式高度，例如 `220`、`260`、`320`。
3. 桌面端满高时，链路上每层都要有 `minHeight: 0`。
4. 若图表卡片内部使用 `flex: 1`，仍要确认某一层最终落成具体高度。

## 5. 自动决策建议

遇到新页面时按下面顺序判断：

1. 页面是否在 `DesktopTabLayout` 中？
- 是：优先按“满高 Tab 子页面”处理。

2. 页面是否像首页总览一样直接控制整屏卡片网格？
- 是：优先按“独立 Dashboard / 总览页”处理。

3. 页面是否需要去掉外层内容区 padding？
- 是：再叠加 full-bleed 规则。

4. 页面是否包含 Recharts？
- 是：必须追加图表高度兜底，不可只改页面根容器。
