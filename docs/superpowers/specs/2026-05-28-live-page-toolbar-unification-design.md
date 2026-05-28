# 真实网页工具栏统一设计

**目标**

将真实网页模式下的页面编辑工具栏，统一成与 `file:///` 本地快照模式一致的底部居中悬浮胶囊条；允许工具数量不同，但风格、位置和主交互壳层保持一致。

**现状**

- `file:///` 本地快照模式已经使用 `data-bottom-toolbar` 作为底部悬浮工具栏壳层。
- 真实网页模式仍使用单独的 `data-live-toolbar`，导致位置、排列方向和视觉风格不一致。

**设计决策**

- 真实网页模式复用 `data-bottom-toolbar` 作为唯一主工具栏壳层。
- 真实网页专属动作 `采集当前页面`、`切换标记显示` 并入底部工具栏的 action 区。
- 选中元素后的编辑工具继续沿用底部工具栏与上弹面板组合，不新建第二套主入口。
- 保留本地快照模式的保存按钮，仅真实网页不显示保存按钮。

**影响范围**

- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
- `apps/extension/tests/page-edit/file-save.test.ts`
- `apps/extension/tests/page-edit/selection-actions.test.ts`

**验证**

- 真实网页模式渲染 `data-bottom-toolbar`，不再依赖 `data-live-toolbar` 作为运行时壳层。
- 真实网页模式的 action 区包含采集按钮和标注计数按钮。
- 本地快照模式现有底部工具栏能力不回归。
