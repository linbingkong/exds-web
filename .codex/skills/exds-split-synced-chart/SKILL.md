---
name: exds-split-synced-chart
description: exds-web 两层同步 Recharts 图表设计技能。用于前端页面需要把同一份时序数据拆成上下两层图表展示，并实现共用下方 X 轴、统一 tooltip、统一外置图例、syncId 联动、全屏容器和 Recharts 焦点样式的场景，例如价格曲线+电量柱/面积、收益曲线+申报电量、日前/日内/月度交易复盘图表。
---

# EXDS 两层同步图表

## 使用前

涉及代码修改时，先按项目规则读取：

- `docs/spec/AI执行总纲.md`
- `docs/spec/前端开发规范.md`

优先参考现有实现：

- `frontend/src/pages/DayAheadTradeReviewPage.tsx`：Recharts 原生同步，适合常规复盘图。
- `frontend/src/pages/DayAheadSimulationPage.tsx`：外层 hover 状态，适合框选、拖拽、跨图参考线。
- `frontend/src/pages/TradeReviewPage.tsx`：成交分析和申报复盘的两层价格/电量图。
- `frontend/src/components/monthlyTradeReview/MonthlyTradeReviewChartPanel.tsx`：月度复盘的统一 tooltip 和分层图表。

## 选型

优先使用 Recharts 原生同步模式：

- 上下图使用同一份 `data`、同一个 `xKey`、同一个 `syncId`。
- 上层图隐藏 `XAxis`，下层图显示 `XAxis`。
- 上层图渲染唯一真实 tooltip，下层图隐藏 tooltip。
- 图例放在图表外，用 `useSelectableSeries` 控制所有 series 的 `hide`。

改用外层 hover 模式的条件：

- 需要框选时段、拖拽编辑、跨图固定参考线。
- tooltip 位置要跟随整个容器而不是某个 Recharts 图。
- 多层图需要共用一个自绘浮层，并且内容来自当前 hover 行。

## 数据约束

- 上下图必须使用同一数组，顺序稳定，不要分别过滤后再渲染。
- `xKey` 类型必须一致，常用 `time`、`period`、`date`、`label`。
- 时序时间标签直接消费后端返回字段，禁止在前端重算 `24:00` 等业务时间。
- 若上下层 series 单位不同，分开设置各自 `YAxis`，不要用双轴挤在一个图里。

## 布局约束

容器使用纵向 flex，并保证子项可收缩：

```tsx
<Box
  ref={chartRef}
  sx={{
    height: { xs: 460, sm: 540 },
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    minHeight: 0,
    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
    p: isFullscreen ? 2 : 0,
    ...(isFullscreen && {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 1400,
    }),
    '& .recharts-surface:focus': { outline: 'none' },
    '& *:focus': { outline: 'none !important' },
  }}
>
  <FullscreenEnterButton />
  <FullscreenExitButton />
  <FullscreenTitle />
  {/* 图例、两层图表 */}
</Box>
```

上下层图建议使用比例而不是固定像素：

```tsx
<Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 1 }}>
  <Box sx={{ flex: '3 1 0', minHeight: 0 }}>{/* 上层图 */}</Box>
  <Box sx={{ flex: '2 1 0', minHeight: 0 }}>{/* 下层图 */}</Box>
</Box>
```

在移动端需要固定可读高度时，可使用 `flex: { xs: '0 0 240px', md: '3 1 0' }` 这类写法。

## Recharts 原生同步模板

```tsx
<ResponsiveContainer width="100%" height="100%">
  <ComposedChart data={rows} syncId={syncId} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey={xKey} hide />
    <YAxis label={{ value: '价格(元/MWh)', angle: -90, position: 'insideLeft' }} />
    <Tooltip
      content={<SharedTooltip />}
      cursor={{ stroke: '#9e9e9e', strokeDasharray: '3 3' }}
      wrapperStyle={{ zIndex: 1401 }}
    />
    <Line dataKey="price_rt" name="实时价格" dot={false} hide={!priceVisible.price_rt} />
  </ComposedChart>
</ResponsiveContainer>

<ResponsiveContainer width="100%" height="100%">
  <ComposedChart data={rows} syncId={syncId} margin={{ top: 4, right: 20, left: 8, bottom: 12 }}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey={xKey} interval={3} tick={{ fontSize: 12 }} />
    <YAxis label={{ value: '电量(MWh)', angle: -90, position: 'insideLeft' }} />
    <Tooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
    <ReferenceLine y={0} stroke="#94a3b8" />
    <Bar dataKey="declared_mwh" name="申报电量" hide={!volumeVisible.declared_mwh} />
  </ComposedChart>
</ResponsiveContainer>
```

关键点：

- 下层隐藏 tooltip 必须同时设置 `content={() => null}`、`cursor={false}`、`wrapperStyle={{ display: 'none' }}`。
- 上下图的 `margin.left/right` 尽量一致，避免 X 轴刻度和 hover cursor 横向错位。
- 若上层有分时背景，优先复用 `useTouPeriodBackground(chartRows)`。

## 统一 tooltip

tooltip 内容从当前行拿完整业务数据，同时展示上下层指标：

```tsx
const SharedTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload.find((item: any) => item?.payload)?.payload ?? payload[0]?.payload;
  if (!row) return null;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, pointerEvents: 'none' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        时段 {row.period ?? '-'}（{row.time ?? label ?? '-'}）
      </Typography>
      <Typography variant="body2">实时价格：{formatNumber(row.price_rt, 3)} 元/MWh</Typography>
      <Typography variant="body2">申报电量：{formatNumber(row.declared_mwh, 3)} MWh</Typography>
    </Paper>
  );
};
```

## 外层 hover 模式

用于单日复盘、模拟申报等强交互图表：

```tsx
const [hoveredX, setHoveredX] = useState<number | string | null>(null);
const hoveredRow = useMemo(
  () => rows.find((row) => row[xKey] === hoveredX) ?? null,
  [rows, hoveredX],
);

const handleChartMouseMove = (event: any) => {
  if (!event || event.activeLabel === undefined || event.activeLabel === null) return;
  setHoveredX(event.activeLabel);
};

const handleChartMouseLeave = () => {
  setHoveredX(null);
};
```

上下图都绑定同一组事件，并渲染同一条参考线：

```tsx
<ComposedChart
  data={rows}
  syncId={syncId}
  onMouseMove={handleChartMouseMove}
  onMouseLeave={handleChartMouseLeave}
>
  <XAxis dataKey={xKey} hide />
  {hoveredX != null && <ReferenceLine x={hoveredX} stroke="#64748b" strokeDasharray="4 4" />}
</ComposedChart>
```

自绘 tooltip 放在外层容器中，内容用 `hoveredRow` 渲染。需要跟随鼠标时，在外层 `Box` 的 `onMouseMove` 中记录 `clientX/clientY` 相对容器的位置。

## 图例

外置图例优先使用 `useSelectableSeries`：

```tsx
const { seriesVisibility, handleLegendClick } = useSelectableSeries<PriceSeriesKey>({
  price_rt: true,
  price_da: true,
});

{(Object.keys(PRICE_SERIES_META) as PriceSeriesKey[]).map((key) => (
  <Box key={key} onClick={() => handleLegendClick({ dataKey: key } as any)}>
    <Checkbox checked={seriesVisibility[key]} size="small" />
    <Typography variant="body2">{PRICE_SERIES_META[key].label}</Typography>
  </Box>
))}
```

价格组和电量组可以分别调用一次 `useSelectableSeries`，但都要放在图表外，避免上下两个图各自出现独立 `Legend`。

## 完成检查

- 上下图共用同一 `data`、`xKey`、`syncId`。
- 只有下层图显示 X 轴。
- 页面只有一个可见 tooltip。
- 图例状态能同时控制对应 `Line`、`Bar`、`Area` 的 `hide`。
- 图表容器包含 Recharts 焦点 outline 清理样式。
- 如果修改了前端代码，执行 `npm run build --prefix frontend`。
