# VisBug 文本格式面板改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VisBug 底部 `文本格式` 面板从动作按钮板改成编辑器型面板，支持数值输入、图标化对齐/样式操作、第一层文字颜色入口和高级颜色折叠区。

**Architecture:** 保持现有底部 9 图标工具条不变，只重构 `typography` 子面板。实现上先让 `vis-bug.element.js` 从“action rows 渲染”切换到“专用 typography panel 渲染”，再补一层 typography panel state 负责读取当前样式、暂存输入值、提交样式更新，最后把颜色入口与高级区挂回现有 `foreground` 颜色链路。

**Tech Stack:** Web Components、Vitest、JSDOM、现有 page-edit features（`font.js`、`color.js`、`hueshift.js`）、内联 CSS 字符串生成链路

---

## 文件结构

### 需要修改

- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
  - `typography` 面板专用渲染
  - typography panel state
  - 输入框事件绑定
  - 数值提交与样式写入
  - 对齐/加粗/斜体/下划线动作
  - 第一层文字颜色入口与高级区折叠
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
  - typography 面板输入框、图标组、颜色入口、高级区样式
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js`
  - 重新生成内联样式字符串
- `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.icons.js`
  - 新增对齐、加粗、斜体、下划线、颜色入口、高级折叠图标
- `apps/extension/public/page-edit/vendor/app/features/font.js`
  - 抽出或补充按具体值设置字体属性的 helper
- `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
  - 更新 `typography` 面板渲染断言
- `apps/extension/tests/page-edit/file-save.test.ts`
  - 验证本地快照面板里新的 typography 结构

### 建议新增

- `apps/extension/tests/page-edit/typography-panel.test.ts`
  - 单测 typography 输入提交、图标切换、非法值回退、高级区和颜色入口

### 只读参考

- `apps/extension/public/page-edit/vendor/app/features/color.js`
- `apps/extension/public/page-edit/vendor/app/features/hueshift.js`
- `apps/extension/public/page-edit/vendor/app/features/font.js`
- `docs/superpowers/specs/2026-05-28-visbug-typography-panel-design.md`

---

### Task 1: 锁定新的 typography 面板渲染结构

**Files:**
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
- Modify: `apps/extension/tests/page-edit/file-save.test.ts`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`

- [ ] **Step 1: 先写失败测试，锁定 typography 第一层结构**

```ts
it('renders editor-style typography controls instead of action-only rows', async () => {
  document.documentElement.setAttribute(
    'data-webmcp-page-edit-config',
    JSON.stringify({ pageMode: 'local-snapshot' }),
  );
  document.body.innerHTML = '<p id="target">Hello</p>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  visbug.selectorEngine = {
    selection() {
      return [document.getElementById('target')];
    },
  };

  const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

  expect(markup).toContain('data-bottom-tool="typography"');
  expect(markup).toContain('data-typography-panel');
  expect(markup).toContain('data-typography-input="font-size"');
  expect(markup).toContain('data-typography-input="font-weight"');
  expect(markup).toContain('data-typography-input="line-height"');
  expect(markup).toContain('data-typography-input="letter-spacing"');
  expect(markup).toContain('data-typography-action="align-left"');
  expect(markup).toContain('data-typography-action="font-bold"');
  expect(markup).toContain('data-typography-color-trigger');
  expect(markup).not.toContain('data-bottom-action="font-plus-1"');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
FAIL  page-edit bottom toolbar shell > renders editor-style typography controls instead of action-only rows
Expected substring: data-typography-panel
Received: ...
```

- [ ] **Step 3: 实现 typography 专用渲染入口，替换旧 action rows 输出**

```js
renderBottomToolbarTool(tool) {
  const availability = this.getSelectedBottomToolbarAvailability()?.[tool.id] ?? {
    available: true,
    reason: '',
  }
  const isDisabled = availability.available === false

  return `
    <div data-bottom-tool-item data-tool-id="${tool.id}">
      <button ...>...</button>
      ${isDisabled
        ? `<div data-bottom-tooltip role="tooltip">${availability.reason || tool.label}</div>`
        : `
          <div data-bottom-menu>
            ${tool.id === 'typography'
              ? this.renderTypographyPanel()
              : tool.id === 'surface-colors'
                ? this.renderSurfaceColorPanel()
                : this.renderBottomToolbarActionRows(tool.id)}
          </div>
        `}
    </div>
  `
}

renderTypographyPanel() {
  const state = this.getTypographyPanelState()

  return `
    <section data-typography-panel>
      <div data-typography-input-row>
        ${this.renderTypographyInput('font-size', '字号', state.fontSize)}
        ${this.renderTypographyInput('font-weight', '字重', state.fontWeight)}
        ${this.renderTypographyInput('line-height', '行高', state.lineHeight)}
        ${this.renderTypographyInput('letter-spacing', '字距', state.letterSpacing)}
      </div>
      <div data-typography-toolbar-row>
        ${this.renderTypographyAlignGroup(state)}
        ${this.renderTypographyStyleGroup(state)}
        ${this.renderTypographyColorTrigger(state)}
      </div>
      ${this.renderTypographyAdvanced(state)}
    </section>
  `
}
```

- [ ] **Step 4: 更新 file-save 测试，让快照工具栏断言新的 typography 面板结构**

```ts
expect(markup).toContain('data-bottom-tool="typography"');
expect(markup).toContain('data-typography-panel');
expect(markup).toContain('data-typography-input-row');
expect(markup).toContain('data-typography-toolbar-row');
expect(markup).not.toContain('data-bottom-action="font-plus-1"');
```

- [ ] **Step 5: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar.test.ts \
  tests/page-edit/file-save.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts
PASS  tests/page-edit/file-save.test.ts
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts \
  apps/extension/tests/page-edit/file-save.test.ts
git commit -m "feat: render editor-style typography panel"
```

### Task 2: 接入 typography panel state 与当前值读取

**Files:**
- Create: `apps/extension/tests/page-edit/typography-panel.test.ts`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`

- [ ] **Step 1: 先写失败测试，锁定 typography 面板当前值读取**

```ts
it('reads current typography values from the selected element', async () => {
  document.body.innerHTML = '<p id="target" style="font-size: 18px; font-weight: 700; line-height: 24px; letter-spacing: 0.2px; text-align: center; font-style: italic; text-decoration: underline; color: rgb(37, 99, 235);">Hello</p>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  visbug.selectorEngine = {
    selection() {
      return [document.getElementById('target')];
    },
  };

  const state = visbug.getTypographyPanelState();

  expect(state.fontSize).toBe('18');
  expect(state.fontWeight).toBe('700');
  expect(state.lineHeight).toBe('24');
  expect(state.letterSpacing).toBe('0.2');
  expect(state.textAlign).toBe('center');
  expect(state.bold).toBe(true);
  expect(state.italic).toBe(true);
  expect(state.underline).toBe(true);
  expect(state.foreground).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
FAIL  TypeError: visbug.getTypographyPanelState is not a function
```

- [ ] **Step 3: 实现 typography state 读取函数**

```js
getTypographyPanelState() {
  const [selectedNode] = this.selectorEngine?.selection?.() ?? []
  if (!selectedNode) {
    return {
      fontSize: '',
      fontWeight: '',
      lineHeight: '',
      letterSpacing: '',
      textAlign: 'left',
      bold: false,
      italic: false,
      underline: false,
      foreground: '',
      advancedOpen: false,
    }
  }

  const style = getComputedStyle(selectedNode)
  return {
    fontSize: String(parseInt(style.fontSize || '', 10) || ''),
    fontWeight: String(style.fontWeight || ''),
    lineHeight: String(parseFloat(style.lineHeight || '') || ''),
    letterSpacing: style.letterSpacing === 'normal'
      ? '0'
      : String(parseFloat(style.letterSpacing || '') || 0),
    textAlign: style.textAlign || 'left',
    bold: Number(style.fontWeight) >= 600 || style.fontWeight === 'bold',
    italic: style.fontStyle === 'italic',
    underline: style.textDecorationLine.includes('underline'),
    foreground: style.color || '',
    advancedOpen: this._typographyPanelDraft?.advancedOpen === true,
  }
}
```

- [ ] **Step 4: 给组件增加 typography draft 状态容器**

```js
constructor() {
  super()
  this._bottomToolbarState = { activeSubtool: null }
  this._typographyPanelDraft = {
    values: {},
    advancedOpen: false,
  }
}
```

- [ ] **Step 5: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
PASS  tests/page-edit/typography-panel.test.ts
```

- [ ] **Step 6: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/typography-panel.test.ts
git commit -m "feat: read typography panel state from selection"
```

### Task 3: 接入四个输入框的提交、校验与回退

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/features/font.js`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/tests/page-edit/typography-panel.test.ts`

- [ ] **Step 1: 先写失败测试，锁定输入框提交与非法值回退**

```ts
it('commits numeric typography inputs on enter and reverts invalid values', async () => {
  document.body.innerHTML = '<p id="target" style="font-size: 16px; font-weight: 400; line-height: 22px; letter-spacing: 0px;">Hello</p>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  const target = document.getElementById('target') as HTMLElement;
  visbug.selectorEngine = {
    selection() {
      return [target];
    },
    recordStyleMutation: ({ mutate }: { mutate: () => void }) => mutate(),
    refreshSelectionUi: vi.fn(),
  };

  visbug.handleTypographyInputCommit('font-size', '24');
  visbug.handleTypographyInputCommit('font-weight', '700');
  visbug.handleTypographyInputCommit('line-height', '30');
  visbug.handleTypographyInputCommit('letter-spacing', '0.4');

  expect(target.style.fontSize).toBe('24px');
  expect(target.style.fontWeight).toBe('700');
  expect(target.style.lineHeight).toBe('30px');
  expect(target.style.letterSpacing).toBe('0.4px');

  expect(visbug.normalizeTypographyInputValue('font-size', 'abc', '24')).toBe('24');
  expect(visbug.normalizeTypographyInputValue('font-weight', '9999', '700')).toBe('700');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
FAIL  TypeError: visbug.handleTypographyInputCommit is not a function
```

- [ ] **Step 3: 在 `font.js` 中补充按具体值写入的 helper**

```js
export function setFontSize(els, rawValue) {
  const value = Math.max(6, Number(rawValue))
  els.map(el => showHideSelected(el))
    .forEach(el => {
      el.style.fontSize = `${value}px`
    })
}

export function setFontWeight(els, rawValue) {
  const value = Number(rawValue)
  const clamped = [100,200,300,400,500,600,700,800,900].includes(value) ? value : 400
  els.map(el => showHideSelected(el))
    .forEach(el => {
      el.style.fontWeight = String(clamped)
    })
}

export function setLineHeight(els, rawValue) {
  const value = Math.max(1, Number(rawValue))
  els.map(el => showHideSelected(el))
    .forEach(el => {
      el.style.lineHeight = `${value}px`
    })
}

export function setLetterSpacing(els, rawValue) {
  const value = Math.max(-2, Number(rawValue))
  els.map(el => showHideSelected(el))
    .forEach(el => {
      el.style.letterSpacing = `${value}px`
    })
}
```

- [ ] **Step 4: 在 `vis-bug.element.js` 中接入输入值校验与提交**

```js
normalizeTypographyInputValue(field, rawValue, fallbackValue = '') {
  const value = String(rawValue ?? '').trim()
  if (value === '') return fallbackValue

  const parsed = Number(value)
  if (Number.isNaN(parsed)) return fallbackValue

  if (field === 'font-weight')
    return [100,200,300,400,500,600,700,800,900].includes(parsed)
      ? String(parsed)
      : fallbackValue

  if (field === 'font-size' && parsed < 6) return fallbackValue
  if (field === 'line-height' && parsed <= 0) return fallbackValue
  if (field === 'letter-spacing' && parsed < -2) return fallbackValue

  return String(parsed)
}

handleTypographyInputCommit(field, rawValue) {
  const [selectedNode] = this.selectorEngine?.selection?.() ?? []
  if (!selectedNode) return

  const state = this.getTypographyPanelState()
  const fallbackMap = {
    'font-size': state.fontSize,
    'font-weight': state.fontWeight,
    'line-height': state.lineHeight,
    'letter-spacing': state.letterSpacing,
  }
  const nextValue = this.normalizeTypographyInputValue(field, rawValue, fallbackMap[field] || '')
  if (!nextValue) return

  this.applySelectedStyleMutation(`typography-input:${field}`, () => {
    const selectedNodes = this.selectorEngine?.selection?.() ?? []
    if (field === 'font-size') setFontSize(selectedNodes, nextValue)
    if (field === 'font-weight') setFontWeight(selectedNodes, nextValue)
    if (field === 'line-height') setLineHeight(selectedNodes, nextValue)
    if (field === 'letter-spacing') setLetterSpacing(selectedNodes, nextValue)
  })
}
```

- [ ] **Step 5: 绑定 `keydown` / `blur` 到 typography 输入框**

```js
$('input[data-typography-input]', this.$shadow).on('keydown', e => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  this.handleTypographyInputCommit(
    e.currentTarget.dataset.typographyInput,
    e.currentTarget.value,
  )
  this.refreshLocalSnapshotToolbar()
})

$('input[data-typography-input]', this.$shadow).on('blur', e => {
  this.handleTypographyInputCommit(
    e.currentTarget.dataset.typographyInput,
    e.currentTarget.value,
  )
  this.refreshLocalSnapshotToolbar()
})
```

- [ ] **Step 6: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
PASS  tests/page-edit/typography-panel.test.ts
```

- [ ] **Step 7: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/features/font.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/typography-panel.test.ts
git commit -m "feat: support direct typography input edits"
```

### Task 4: 接入对齐与常用样式图标按钮

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.icons.js`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/tests/page-edit/typography-panel.test.ts`

- [ ] **Step 1: 先写失败测试，锁定图标按钮和点击行为**

```ts
it('renders align and font style icon groups and toggles them on click', async () => {
  document.body.innerHTML = '<p id="target" style="text-align: left;">Hello</p>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  const target = document.getElementById('target') as HTMLElement;
  visbug.selectorEngine = {
    selection() {
      return [target];
    },
    recordStyleMutation: ({ mutate }: { mutate: () => void }) => mutate(),
    refreshSelectionUi: vi.fn(),
  };

  visbug.runTypographyToggleAction('align-center');
  visbug.runTypographyToggleAction('font-bold');
  visbug.runTypographyToggleAction('font-italic');
  visbug.runTypographyToggleAction('font-underline');

  expect(target.style.textAlign).toBe('center');
  expect(target.style.fontWeight).toBe('bold');
  expect(target.style.fontStyle).toBe('italic');
  expect(target.style.textDecoration).toContain('underline');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
FAIL  TypeError: visbug.runTypographyToggleAction is not a function
```

- [ ] **Step 3: 在 icons 文件中补齐 typography 图标**

```js
export const align_left = `...`
export const align_center = `...`
export const align_right = `...`
export const bold = `...`
export const italic = `...`
export const underline = `...`
export const color_foreground = `...`
export const tune = `...`
```

- [ ] **Step 4: 在 `vis-bug.element.js` 中渲染图标按钮并处理切换**

```js
renderTypographyAlignGroup(state) {
  return `
    <div data-typography-group="align">
      ${[
        ['align-left', Icons.align_left, '左对齐'],
        ['align-center', Icons.align_center, '居中'],
        ['align-right', Icons.align_right, '右对齐'],
      ].map(([id, icon, label]) => `
        <button
          type="button"
          data-typography-action="${id}"
          data-active="${state.textAlign === id.replace('align-', '') ? 'true' : 'false'}"
          title="${label}"
        >${icon}</button>
      `).join('')}
    </div>
  `
}

runTypographyToggleAction(actionId) {
  const selectedNodes = this.selectorEngine?.selection?.() ?? []
  if (!selectedNodes.length) return

  this.applySelectedStyleMutation(`typography-toggle:${actionId}`, () => {
    if (actionId === 'align-left') selectedNodes.forEach(el => { el.style.textAlign = 'left' })
    if (actionId === 'align-center') selectedNodes.forEach(el => { el.style.textAlign = 'center' })
    if (actionId === 'align-right') selectedNodes.forEach(el => { el.style.textAlign = 'right' })
    if (actionId === 'font-bold') selectedNodes.forEach(el => {
      el.style.fontWeight = el.style.fontWeight === 'bold' ? null : 'bold'
    })
    if (actionId === 'font-italic') selectedNodes.forEach(el => {
      el.style.fontStyle = el.style.fontStyle === 'italic' ? null : 'italic'
    })
    if (actionId === 'font-underline') selectedNodes.forEach(el => {
      el.style.textDecoration = el.style.textDecoration.includes('underline') ? '' : 'underline'
    })
  })
}
```

- [ ] **Step 5: 绑定图标按钮点击事件**

```js
$('button[data-typography-action]', this.$shadow).on('click', e => {
  e.preventDefault()
  e.stopPropagation()
  this.runTypographyToggleAction(e.currentTarget.dataset.typographyAction)
  this.refreshLocalSnapshotToolbar()
})
```

- [ ] **Step 6: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
PASS  tests/page-edit/typography-panel.test.ts
```

- [ ] **Step 7: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.icons.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/tests/page-edit/typography-panel.test.ts
git commit -m "feat: add typography icon controls"
```

### Task 5: 接入第一层文字颜色入口与高级区

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js`
- Modify: `apps/extension/tests/page-edit/typography-panel.test.ts`

- [ ] **Step 1: 先写失败测试，锁定颜色入口与高级区**

```ts
it('renders a first-layer foreground color trigger and collapsed advanced controls', async () => {
  document.body.innerHTML = '<p id="target" style="color: rgb(37, 99, 235);">Hello</p>';

  const { default: VisBug } = await import(
    '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
  );

  const visbug = new VisBug();
  visbug.selectorEngine = {
    selection() {
      return [document.getElementById('target')];
    },
  };

  const markup = visbug.renderTypographyPanel();

  expect(markup).toContain('data-typography-color-trigger');
  expect(markup).toContain('data-typography-advanced-toggle');
  expect(markup).toContain('data-typography-advanced="collapsed"');
  expect(markup).not.toContain('data-bottom-action="hue-plus"');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run tests/page-edit/typography-panel.test.ts
```

Expected:

```text
FAIL  Expected substring: data-typography-color-trigger
```

- [ ] **Step 3: 渲染文字颜色入口与高级区折叠**

```js
renderTypographyColorTrigger(state) {
  return `
    <div data-typography-color>
      <button
        type="button"
        data-typography-color-trigger
        style="--typography-foreground:${state.foreground || 'transparent'}"
        title="文字颜色"
      >${Icons.color_foreground}</button>
    </div>
  `
}

renderTypographyAdvanced(state) {
  return `
    <section data-typography-advanced="${state.advancedOpen ? 'open' : 'collapsed'}">
      <button type="button" data-typography-advanced-toggle>
        ${Icons.tune} 高级
      </button>
      ${state.advancedOpen
        ? `
          <div data-typography-advanced-body>
            ${this.renderBottomToolbarColorTargets('typography')}
            ${this.renderTypographyAdvancedActions()}
          </div>
        `
        : ''}
    </section>
  `
}
```

- [ ] **Step 4: 绑定文字颜色入口与高级开关**

```js
$('button[data-typography-color-trigger]', this.$shadow).on('click', e => {
  e.preventDefault()
  e.stopPropagation()
  this.colorPicker?.setActive?.('foreground')
  this._typographyPanelDraft = {
    ...(this._typographyPanelDraft || {}),
    advancedOpen: true,
  }
  this.refreshLocalSnapshotToolbar()
})

$('button[data-typography-advanced-toggle]', this.$shadow).on('click', e => {
  e.preventDefault()
  e.stopPropagation()
  this._typographyPanelDraft = {
    ...(this._typographyPanelDraft || {}),
    advancedOpen: !this._typographyPanelDraft?.advancedOpen,
  }
  this.refreshLocalSnapshotToolbar()
})
```

- [ ] **Step 5: 补 typography 面板样式**

```css
:host [data-typography-panel] {
  display: grid;
  gap: 10px;
}

:host [data-typography-input-row] {
  display: grid;
  grid-template-columns: repeat(4, minmax(72px, 1fr));
  gap: 8px;
}

:host [data-typography-toolbar-row] {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

:host [data-typography-color-trigger] {
  border: 1px solid var(--theme-card_border);
  background: var(--typography-foreground, transparent);
}
```

- [ ] **Step 6: 重新生成 CSS 内联字符串并跑测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/typography-panel.test.ts \
  tests/page-edit/bottom-toolbar.test.ts
```

Expected:

```text
PASS  tests/page-edit/typography-panel.test.ts
PASS  tests/page-edit/bottom-toolbar.test.ts
```

- [ ] **Step 7: 提交本任务**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js \
  apps/extension/tests/page-edit/typography-panel.test.ts \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts
git commit -m "feat: add foreground color entry and advanced typography controls"
```

### Task 6: 全量回归与清理

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`
- Modify: `apps/extension/tests/page-edit/typography-panel.test.ts`
- Modify: `apps/extension/tests/page-edit/bottom-toolbar.test.ts`
- Modify: `apps/extension/tests/page-edit/file-save.test.ts`

- [ ] **Step 1: 搜索并清理旧 typography action rows 依赖**

```bash
rg -n "font-plus-1|font-minus-1|weight-plus|leading-plus|kerning-plus|hue-plus" \
  apps/extension/public/page-edit/vendor/app/components/vis-bug \
  apps/extension/tests/page-edit
```

Expected:

```text
只剩 surface-colors 高级区或必要兼容代码，不再由 typography 第一层直接渲染
```

- [ ] **Step 2: 如仍有旧入口，收敛到 typography 专用渲染**

```js
getBottomToolbarToolActions(toolId) {
  switch (toolId) {
    case 'typography':
      return []
    case 'surface-colors':
      return [
        [{ id: 'hue-plus', label: '色相 +1' }, { id: 'hue-minus', label: '色相 -1' }, { id: 'light-plus', label: '亮度 +1%' }, { id: 'light-minus', label: '亮度 -1%' }],
        [{ id: 'sat-plus', label: '饱和 +1%' }, { id: 'sat-minus', label: '饱和 -1%' }, { id: 'alpha-plus', label: '透明 +1%' }, { id: 'alpha-minus', label: '透明 -1%' }],
      ]
    default:
      return ...
  }
}
```

- [ ] **Step 3: 运行完整回归**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  tests/page-edit/bottom-toolbar.test.ts \
  tests/page-edit/file-save.test.ts \
  tests/page-edit/selection-actions.test.ts \
  tests/page-edit/selection-escape.test.ts \
  tests/page-edit/typography-panel.test.ts
```

Expected:

```text
PASS  tests/page-edit/bottom-toolbar.test.ts
PASS  tests/page-edit/file-save.test.ts
PASS  tests/page-edit/selection-actions.test.ts
PASS  tests/page-edit/selection-escape.test.ts
PASS  tests/page-edit/typography-panel.test.ts
```

- [ ] **Step 4: 手动检查工作区只包含本次 typography 改动**

Run:

```bash
git status --short
git diff -- \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.icons.js \
  apps/extension/public/page-edit/vendor/app/features/font.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts \
  apps/extension/tests/page-edit/file-save.test.ts \
  apps/extension/tests/page-edit/typography-panel.test.ts
```

Expected:

```text
只看到本任务相关文件差异
```

- [ ] **Step 5: 提交最终结果**

```bash
git add \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js \
  apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.icons.js \
  apps/extension/public/page-edit/vendor/app/features/font.js \
  apps/extension/tests/page-edit/bottom-toolbar.test.ts \
  apps/extension/tests/page-edit/file-save.test.ts \
  apps/extension/tests/page-edit/typography-panel.test.ts
git commit -m "feat: redesign visbug typography panel"
```
