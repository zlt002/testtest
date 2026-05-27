# VisBug 产品经理轻量工具条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 VisBug 底部工具条重构成面向产品经理的 9 图标轻量修改工具条，支持半严格灰态、统一退出规则和保守的表格场景限制。

**Architecture:** 先把底部工具条的“定义”和“能力判断”从 `vis-bug.element.js` 中抽离，再让渲染层消费统一的工具状态。交互上保留现有直接操作型 feature，但重新组织为固定 9 图标，并为灰态、提示文案、`Esc` 退出和顺序调整模式建立一致的状态流。

**Tech Stack:** Web Components、Vitest、JSDOM、`hotkeys-js`、现有 page-edit features（`EditText`、`Position`、`Padding`、`Margin`、`Flex`、`Font`、`ColorPicker`、`Moveable`）

---

## 文件结构

### 新建文件

- `apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.tools.js`
  - 维护 9 个一级工具定义、图标、交互类型、文案和 feature 映射。
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js`
  - 维护 `canEditText`、`canMove`、`canResize`、`canAdjustPadding`、`canAdjustMargin`、`canEditFlex`、`canEditTypography`、`canEditSurfaceColors`、`canReorder`。
- `apps/extension/tests/page-edit/bottom-toolbar-capabilities.test.ts`
  - 单测工具可用性和灰态原因。

### 修改文件

- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
  - 接入工具定义层、能力判断层、固定 9 图标渲染、灰态和 `Esc` 退出。
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
  - 增加灰态、hover 原因提示、固定 9 图标布局细节。
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js`
  - 由 CSS 重新生成内联字符串。
- `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
  - 更新工具顺序、9 图标固定输出、弹层职责和灰态行为测试。
- `apps/extension/tests/page-edit/selection-actions.test.ts`
  - 补 `Esc` 取消选中或退出工具态相关测试，如果现有覆盖不足。
- `apps/extension/tests/page-edit/position-resize.test.ts`
  - 如需，补尺寸和位置工具在被禁用元素上的保护测试。

### 只读参考文件

- `apps/extension/public/page-edit/vendor/app/features/color.js`
- `apps/extension/public/page-edit/vendor/app/features/hueshift.js`
- `apps/extension/public/page-edit/vendor/app/features/move.js`
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/model.js`

---

### Task 1: 固定 9 工具定义抽离

**Files:**
- Create: `apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.tools.js`
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`

- [ ] **Step 1: 先写失败测试，锁定 9 个一级工具和顺序**

```ts
it('exposes the 9 PM-facing toolbar tools in a fixed order', async () => {
  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  const tools = visbug.getBottomToolbarTools();

  expect(tools.map(tool => tool.id)).toEqual([
    'content',
    'move',
    'resize',
    'padding',
    'margin',
    'flex',
    'typography',
    'surface-colors',
    'reorder',
  ]);
});
```

- [ ] **Step 2: 运行单测并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
FAIL  page-edit bottom toolbar shell > exposes the 9 PM-facing toolbar tools in a fixed order
Expected: ["content", "move", "resize", "padding", "margin", "flex", "typography", "surface-colors", "reorder"]
Received: ...
```

- [ ] **Step 3: 新建工具定义文件，声明固定 9 图标配置**

```js
import * as Icons from './vis-bug.icons.js'

export const bottomToolbarTools = [
  { id: 'content', label: '内容编辑', interactionType: 'direct', feature: 'text', icon: Icons.text },
  { id: 'move', label: '位置移动', interactionType: 'direct', feature: 'position', icon: Icons.position },
  { id: 'resize', label: '宽高修改', interactionType: 'direct', feature: 'position', icon: Icons.resize },
  { id: 'padding', label: '内边距', interactionType: 'direct', feature: 'padding', icon: Icons.padding },
  { id: 'margin', label: '外边距', interactionType: 'direct', feature: 'margin', icon: Icons.margin },
  { id: 'flex', label: '弹性布局', interactionType: 'panel', feature: 'align', icon: Icons.align },
  { id: 'typography', label: '文本格式', interactionType: 'panel', feature: 'font', icon: Icons.font },
  { id: 'surface-colors', label: '背景/边框颜色', interactionType: 'panel', feature: 'surface-colors', icon: Icons.hueshift },
  { id: 'reorder', label: '顺序调整', interactionType: 'direct', feature: 'move', icon: Icons.move },
]

export const getBottomToolbarTool = toolId =>
  bottomToolbarTools.find(tool => tool.id === toolId) ?? null
```

- [ ] **Step 4: 在 `vis-bug.element.js` 中接入定义文件**

```js
import {
  bottomToolbarTools,
  getBottomToolbarTool,
} from './bottom-toolbar.tools.js'

getBottomToolbarTools() {
  return bottomToolbarTools
}

getBottomToolbarTool(toolId) {
  return getBottomToolbarTool(toolId)
}
```

- [ ] **Step 5: 运行单测并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts > page-edit bottom toolbar shell > exposes the 9 PM-facing toolbar tools in a fixed order
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.tools.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts
git commit -m "refactor: extract pm toolbar tool definitions"
```

### Task 2: 抽离工具能力判断和灰态原因

**Files:**
- Create: `apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js`
- Create: `apps/extension/tests/page-edit/bottom-toolbar-capabilities.test.ts`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`

- [ ] **Step 1: 先写失败测试，锁定关键灰态规则**

```ts
it('marks table cells as unavailable for move, resize, margin, and reorder', async () => {
  const { getBottomToolbarAvailability } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js'
  );

  document.body.innerHTML = '<table><tr><td id="cell">A</td></tr></table>';
  const cell = document.getElementById('cell') as HTMLElement;

  expect(getBottomToolbarAvailability(cell).move.available).toBe(false);
  expect(getBottomToolbarAvailability(cell).resize.available).toBe(false);
  expect(getBottomToolbarAvailability(cell).margin.available).toBe(false);
  expect(getBottomToolbarAvailability(cell).reorder.available).toBe(false);
});
```

- [ ] **Step 2: 运行单测并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar-capabilities.test.ts
```

Expected:

```text
FAIL  Cannot find module '../../public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js'
```

- [ ] **Step 3: 实现能力判断文件**

```js
const isTableCell = node => ['TD', 'TH'].includes(node?.tagName || '')
const hasDirectText = node =>
  [...(node?.childNodes || [])].some(child =>
    child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '')

export function canMove(node) {
  if (!node) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素不适合直接拖动位置')
  return enabled()
}

export function canResize(node) {
  if (!node) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素当前不支持调整宽高')
  return enabled()
}

export function canEditText(node) {
  if (!node) return disabled('当前没有选中元素')
  if (!hasDirectText(node)) return disabled('当前元素没有可直接编辑的文本内容')
  return enabled()
}

export function getBottomToolbarAvailability(node) {
  return {
    content: canEditText(node),
    move: canMove(node),
    resize: canResize(node),
    padding: canAdjustPadding(node),
    margin: canAdjustMargin(node),
    flex: canEditFlex(node),
    typography: canEditTypography(node),
    'surface-colors': canEditSurfaceColors(node),
    reorder: canReorder(node),
  }
}
```

- [ ] **Step 4: 在 `vis-bug.element.js` 中接入 availability 结果**

```js
import { getBottomToolbarAvailability } from './bottom-toolbar.capabilities.js'

getSelectedBottomToolbarAvailability() {
  const [selectedNode] = this.selectorEngine?.selection?.() ?? []
  return getBottomToolbarAvailability(selectedNode)
}
```

- [ ] **Step 5: 运行能力判断与底部栏测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar-capabilities.test.ts \
  tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar-capabilities.test.ts
PASS  tests/page-edit/bottom-toolbar.test.ts
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/bottom-toolbar-capabilities.test.ts \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts
git commit -m "feat: add pm toolbar capability gating"
```

### Task 3: 重构底部栏渲染为固定 9 图标 + 灰态提示

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js`
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`

- [ ] **Step 1: 先写失败测试，锁定灰态与 hover 文案输出**

```ts
it('renders disabled tools with reason text when the selected element cannot use them', async () => {
  document.documentElement.setAttribute(
    'data-webmcp-page-edit-config',
    JSON.stringify({ pageMode: 'local-snapshot' }),
  );
  document.body.innerHTML = '<table><tr><td id="cell">A</td></tr></table>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  visbug.selectorEngine = {
    selection() {
      return [document.getElementById('cell')];
    },
  };

  const markup = visbug.render();
  expect(markup).toContain('data-bottom-tool="move"');
  expect(markup).toContain('data-disabled="true"');
  expect(markup).toContain('当前元素不适合直接拖动位置');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
FAIL  ... Expected string to contain "data-disabled=\"true\""
```

- [ ] **Step 3: 更新工具渲染模板**

```js
renderBottomToolbarTool(tool) {
  const availability = this.getSelectedBottomToolbarAvailability()[tool.id]
  const isDisabled = availability?.available === false
  const disabledReason = availability?.reason || ''

  return `
    <div data-bottom-tool-item data-tool-id="${tool.id}">
      <button
        type="button"
        data-bottom-tool="${tool.id}"
        data-tool="${tool.feature}"
        data-active="${this.isBottomToolbarToolActive(tool) ? 'true' : 'false'}"
        data-disabled="${isDisabled ? 'true' : 'false'}"
        aria-disabled="${isDisabled ? 'true' : 'false'}"
        title="${isDisabled ? disabledReason : tool.label}"
      >
        <span class="tool-icon">${tool.icon}</span>
      </button>
      ${isDisabled ? `<div data-bottom-tooltip>${disabledReason}</div>` : this.renderBottomToolbarMenu(tool)}
    </div>
  `
}
```

- [ ] **Step 4: 更新灰态样式并生成内联 CSS**

```css
:host [data-bottom-tool][data-disabled="true"] {
  opacity: 0.38;
  cursor: default;
}

:host [data-bottom-tool-item]:hover [data-bottom-tooltip] {
  opacity: 1;
  visibility: visible;
}
```

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const css = fs.readFileSync('apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css', 'utf8');
fs.writeFileSync(
  'apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js',
  `export default ${JSON.stringify(css)};\n`
);
NODE
```

- [ ] **Step 5: 运行底部栏测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts
git commit -m "feat: render disabled pm toolbar actions with reasons"
```

### Task 4: 统一工具激活、面板职责和 `Esc` 退出

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
- Modify: `apps/extension/tests/page-edit/selection-actions.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 `Esc` 取消选中和灰态点击无效**

```ts
it('ignores disabled toolbar clicks and clears active selection on Escape', async () => {
  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  visbug.selectorEngine = {
    selection: () => [document.getElementById('cell')],
    clearSelection: vi.fn(),
    refreshSelectionUi: vi.fn(),
  };

  visbug.activateBottomToolbarTool('move');
  expect(visbug.activeTool).toBe(null);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(visbug.selectorEngine.clearSelection).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 运行相关测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar.test.ts \
  tests/page-edit/selection-actions.test.ts
```

Expected:

```text
FAIL  ... expected "clearSelection" to have been called
```

- [ ] **Step 3: 在工具激活路径中先判断 availability，并绑定 `Escape`**

```js
activateBottomToolbarTool(toolId) {
  const tool = this.getBottomToolbarTool(toolId)
  const availability = this.getSelectedBottomToolbarAvailability()[toolId]
  if (!tool || availability?.available === false) return

  this.deactivate_feature?.()
  this._bottomToolbarState = { activeToolId: tool.id }
  this.activateTool(tool.feature)
  this.refreshLocalSnapshotToolbar()
}

bindEscapeForBottomToolbar() {
  hotkeys('esc', event => {
    event.preventDefault()
    this.deactivate_feature?.()
    this.selectorEngine?.clearSelection?.()
    this._bottomToolbarState = {}
    this.refreshLocalSnapshotToolbar()
  })
}
```

- [ ] **Step 4: 收敛面板职责**

```js
getBottomToolbarToolActions(toolId) {
  switch (toolId) {
    case 'typography':
      return this.getTypographyActions()
    case 'surface-colors':
      return this.getSurfaceColorActions()
    case 'flex':
      return this.getFlexActions()
    default:
      return []
  }
}
```

- [ ] **Step 5: 运行交互测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar.test.ts \
  tests/page-edit/selection-actions.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts
PASS  tests/page-edit/selection-actions.test.ts
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts \
  apps/extension/tests/page-edit/selection-actions.test.ts
git commit -m "feat: unify pm toolbar activation and escape exit"
```

### Task 5: 调整颜色职责、排序模式命名和回归验证

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
- Modify: `apps/extension/tests/page-edit/selection-overlay-position.test.ts`
- Modify: `apps/extension/tests/page-edit/position-resize.test.ts`

- [ ] **Step 1: 先写失败测试，锁定颜色职责拆分和排序入口**

```ts
it('keeps text color in typography and restricts surface colors to background and border', async () => {
  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();

  expect(visbug.getBottomToolbarToolActions('typography').flat().map(action => action.id)).toContain('text-color');
  expect(visbug.renderBottomToolbarSurfaceColorTargets()).toContain('背景');
  expect(visbug.renderBottomToolbarSurfaceColorTargets()).toContain('边框');
  expect(visbug.renderBottomToolbarSurfaceColorTargets()).not.toContain('文字');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
FAIL  ... Expected string not to contain "文字"
```

- [ ] **Step 3: 调整面板渲染和排序入口标签**

```js
renderBottomToolbarSurfaceColorTargets() {
  const targets = [
    { id: 'background', label: '背景' },
    { id: 'border', label: '边框' },
  ]
  return `
    <div data-bottom-menu-row data-color-targets>
      ${targets.map(target => `
        <button
          type="button"
          data-bottom-color-target="${target.id}"
        >${target.label}</button>
      `).join('')}
    </div>
  `
}
```

```js
// reorder 继续映射到现有 move 排序模式
{ id: 'reorder', label: '顺序调整', interactionType: 'direct', feature: 'move', icon: Icons.move }
```

- [ ] **Step 4: 运行完整回归测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar.test.ts \
  tests/page-edit/position-resize.test.ts \
  tests/page-edit/selection-overlay-position.test.ts \
  tests/page-edit/selection-actions.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts
PASS  tests/page-edit/position-resize.test.ts
PASS  tests/page-edit/selection-overlay-position.test.ts
PASS  tests/page-edit/selection-actions.test.ts
```

- [ ] **Step 5: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts \
  apps/extension/tests/page-edit/position-resize.test.ts \
  apps/extension/tests/page-edit/selection-overlay-position.test.ts \
  apps/extension/tests/page-edit/selection-actions.test.ts
git commit -m "feat: finalize pm toolbar interactions"
```

## 自检

### Spec coverage

- 固定 9 图标：Task 1、Task 3
- 半严格模式和灰态：Task 2、Task 3
- hover 原因提示：Task 3
- `Esc` 取消选中：Task 4
- 文本格式与背景/边框颜色拆分：Task 4、Task 5
- 顺序调整保留现有排序态：Task 5
- 表格场景保守策略：Task 2、Task 5

### Placeholder scan

- 本计划没有 `TBD`、`TODO`、`后续再定`、`类似 Task N` 之类占位语。
- 每个任务都包含具体文件、测试命令、预期结果和最小代码骨架。

### Type consistency

- 工具 ID 统一使用：`content`、`move`、`resize`、`padding`、`margin`、`flex`、`typography`、`surface-colors`、`reorder`
- 能力判断统一通过 `getBottomToolbarAvailability(node)`
- 颜色面板专用入口统一为 `renderBottomToolbarSurfaceColorTargets()`
