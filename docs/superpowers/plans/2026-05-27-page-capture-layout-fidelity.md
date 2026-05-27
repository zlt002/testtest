# Page Capture Layout Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在继续忽略字体和图片资源的前提下，让页面采集结果对中后台页面的布局、层级、滚动状态和固定列结构保持高保真。

**Architecture:** 方案沿用现有 `capturePageDocument -> cleanup -> inline styles -> collect styles -> placeholders -> artifact` 流程，不新增资源下载逻辑，只在内容脚本采集阶段补齐“布局快照归一化”。核心改动分为三层：增强布局相关计算样式内联、为常见后台组件做 DOM 归一化、为悬浮外挂层增加显式忽略规则。

**Tech Stack:** TypeScript, Vitest, JSDOM, Chrome Extension content-script capture pipeline

---

## 文件结构

**新增文件**
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.ts`
  - 统一做静态布局归一化，先承接 Element UI 固定列表格、滚动容器和悬浮层快照处理。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.test.ts`
  - 覆盖固定列表格扁平化、滚动冻结、忽略外挂层等关键场景。

**修改文件**
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/index.ts`
  - 在 `cleanupCapturedDocument` 与 `inlineComputedLayoutStyles` 之间或之后插入布局归一化步骤。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.ts`
  - 从“极简结构样式”升级到“布局快照样式”，补齐尺寸、transform、box model、table layout 等。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.test.ts`
  - 新增布局属性复制测试。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/cleanup.ts`
  - 增加可配置的外挂层忽略规则，避免客服/反馈 SDK 污染主布局。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/cleanup.test.ts`
  - 新增忽略外挂层测试。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts`
  - 增加中后台布局夹具，验证固定列和滚动态采集结果。

**参考文件**
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/placeholders.ts`
  - 保持图片/媒体占位策略不变，不在本次计划内调整。
- `apps/extension/entrypoints/content/lib/page-capture/capture-core/css/collect.ts`
  - 保持 `@font-face` 与资源 URL 忽略策略不变，不在本次计划内调整。

---

### Task 1: 为固定列和外挂层问题补失败用例

**Files:**
- Test: `apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts`

- [ ] **Step 1: 写固定列表格扁平化失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeCapturedLayout } from './dom/layout-normalize';

describe('normalizeCapturedLayout', () => {
  it('removes duplicated element-ui fixed table layers after snapshotting', () => {
    document.body.innerHTML = `
      <div class="el-table">
        <div class="el-table__body-wrapper is-scrolling-left" style="overflow:auto hidden;">
          <table class="el-table__body"><tbody><tr><td>main</td><td>body</td></tr></tbody></table>
        </div>
        <div class="el-table__fixed" style="position:absolute; left:0; width:380px;">
          <div class="el-table__fixed-header-wrapper" style="position:absolute; inset:0 -10700px 100px 0;">
            <table class="el-table__header"><thead><tr><th>左固定</th></tr></thead></table>
          </div>
          <div class="el-table__fixed-body-wrapper" style="position:absolute; inset:37px -10700px 0 0;">
            <table class="el-table__body"><tbody><tr><td>左固定内容</td></tr></tbody></table>
          </div>
        </div>
        <div class="el-table__fixed-right" style="position:absolute; right:0; width:80px;">
          <div class="el-table__fixed-header-wrapper" style="position:absolute; inset:0 0 100px -11000px;">
            <table class="el-table__header"><thead><tr><th>操作</th></tr></thead></table>
          </div>
          <div class="el-table__fixed-body-wrapper" style="position:absolute; inset:37px 0 0 -11000px;">
            <table class="el-table__body"><tbody><tr><td>编辑</td></tr></tbody></table>
          </div>
        </div>
      </div>
    `;

    normalizeCapturedLayout(document, document);

    expect(document.querySelector('.el-table__fixed')).toBeNull();
    expect(document.querySelector('.el-table__fixed-right')).toBeNull();
    expect(document.body.textContent).toContain('main');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts -t "removes duplicated element-ui fixed table layers after snapshotting"`

Expected: FAIL with `Cannot find module './dom/layout-normalize'` or `normalizeCapturedLayout is not a function`

- [ ] **Step 3: 写外挂悬浮层忽略失败测试**

```ts
it('removes known fixed overlay widgets marked as capture-noise', () => {
  document.body.innerHTML = `
    <main><section>业务区域</section></main>
    <div class="feedback_tabs_main" data-html2canvas-ignore="true">反馈浮层</div>
    <div id="INTELLIGENCE" class="cs-sdk-app-pc-wrap">客服浮层</div>
  `;

  normalizeCapturedLayout(document, document);

  expect(document.body.textContent).toContain('业务区域');
  expect(document.querySelector('.feedback_tabs_main')).toBeNull();
  expect(document.getElementById('INTELLIGENCE')).toBeNull();
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts -t "removes known fixed overlay widgets marked as capture-noise"`

Expected: FAIL because ignored overlay cleanup has not been implemented

- [ ] **Step 5: 给夹具测试补一个中后台表格场景**

```ts
it('captures admin table layouts without duplicated fixed columns', async () => {
  document.documentElement.innerHTML = `
    <head><title>Admin Table</title></head>
    <body>
      <div class="el-table">
        <div class="el-table__body-wrapper" style="overflow:auto hidden;">
          <table class="el-table__body"><tbody><tr><td>客户名称</td><td>企业集团</td></tr></tbody></table>
        </div>
        <div class="el-table__fixed"><div class="el-table__fixed-body-wrapper"><table><tbody><tr><td>选择</td></tr></tbody></table></div></div>
        <div class="el-table__fixed-right"><div class="el-table__fixed-body-wrapper"><table><tbody><tr><td>编辑</td></tr></tbody></table></div></div>
      </div>
      <div class="feedback_tabs_main" data-html2canvas-ignore="true">外挂</div>
    </body>
  `;

  const artifact = await capturePageDocument(document, {
    mode: 'page',
    baseUrl: 'https://example.com/admin',
  });

  expect(artifact.html).toContain('客户名称');
  expect(artifact.html).not.toContain('feedback_tabs_main');
  expect(artifact.html).not.toContain('el-table__fixed-right');
});
```

- [ ] **Step 6: 运行夹具测试确认失败**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts -t "captures admin table layouts without duplicated fixed columns"`

Expected: FAIL because the current capture output still contains duplicated fixed-column layers and overlay widgets

- [ ] **Step 7: 提交**

```bash
git add apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts
git commit -m "test: cover layout fidelity capture regressions"
```

### Task 2: 新增布局归一化模块并清理后台外挂层

**Files:**
- Create: `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/index.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/cleanup.ts`
- Test: `apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts`

- [ ] **Step 1: 创建布局归一化模块**

```ts
const DEFAULT_CAPTURE_NOISE_SELECTORS = [
  '[data-html2canvas-ignore="true"]',
  '.feedback_tabs_main',
  '#INTELLIGENCE',
];

function removeCaptureNoise(doc: Document): void {
  for (const selector of DEFAULT_CAPTURE_NOISE_SELECTORS) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      element.remove();
    }
  }
}

export function normalizeCapturedLayout(capturedDoc: Document, originalDoc: Document): void {
  removeCaptureNoise(capturedDoc);
  normalizeElementTables(capturedDoc, originalDoc);
  freezeScrollableRegions(capturedDoc, originalDoc);
}
```

- [ ] **Step 2: 实现 Element UI 固定列表格归一化**

```ts
function normalizeElementTables(capturedDoc: Document, originalDoc: Document): void {
  for (const tableRoot of Array.from(capturedDoc.querySelectorAll('.el-table'))) {
    const fixedLayers = tableRoot.querySelectorAll('.el-table__fixed, .el-table__fixed-right');
    if (fixedLayers.length === 0) {
      continue;
    }

    for (const patch of Array.from(tableRoot.querySelectorAll('.el-table__fixed-right-patch'))) {
      patch.remove();
    }

    for (const layer of Array.from(fixedLayers)) {
      layer.remove();
    }

    tableRoot.classList.add('webmcp-layout-normalized');
  }
}
```

- [ ] **Step 3: 把布局归一化插入采集主流程**

```ts
cleanupCapturedDocument(capturedDoc, doc);
normalizeCapturedLayout(capturedDoc, doc);
inlineComputedLayoutStyles(capturedDoc, doc);
const styleSources = await collectStyleSources(capturedDoc, baseUrl, warnings, {
  originalDoc: doc,
  pruneUnused: true,
  fetchStylesheet: options.fetchStylesheet,
  preserveInlineStyleElements: false,
});
```

- [ ] **Step 4: 给 `cleanup.ts` 补一个公共忽略钩子，避免逻辑分散**

```ts
export function isKnownCaptureNoise(element: Element): boolean {
  return (
    element.matches('[data-html2canvas-ignore="true"]') ||
    element.matches('.feedback_tabs_main') ||
    element.matches('#INTELLIGENCE')
  );
}
```

- [ ] **Step 5: 运行布局归一化相关测试**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts`

Expected: PASS for overlay cleanup and fixed-layer removal cases

- [ ] **Step 6: 提交**

```bash
git add apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/index.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/cleanup.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts
git commit -m "feat: normalize captured admin layout structure"
```

### Task 3: 扩大计算样式内联范围，冻结布局细节

**Files:**
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.test.ts`

- [ ] **Step 1: 写尺寸、transform、box model 的失败测试**

```ts
it('copies snapshot-critical box, sizing, and transform properties', () => {
  document.head.innerHTML = `
    <style>
      .runtime-panel {
        display: flex;
        width: 1280px;
        min-height: 720px;
        padding: 24px;
        margin-left: 12px;
        box-sizing: border-box;
        transform: translateX(-11000px);
        transform-origin: left top;
        white-space: nowrap;
      }
    </style>
  `;
  document.body.innerHTML = '<section class="runtime-panel">panel</section>';

  const capturedDoc = document.implementation.createHTMLDocument('capture');
  capturedDoc.body.innerHTML = `<section ${SOURCE_INDEX_ATTRIBUTE}="0">panel</section>`;

  inlineComputedLayoutStyles(capturedDoc, document);

  const panel = capturedDoc.querySelector('section') as HTMLElement;
  expect(panel.style.width).toBe('1280px');
  expect(panel.style.minHeight).toBe('720px');
  expect(panel.style.padding).toBe('24px');
  expect(panel.style.boxSizing).toBe('border-box');
  expect(panel.style.transform).toBe('translateX(-11000px)');
  expect(panel.style.transformOrigin).toBe('left top');
  expect(panel.style.whiteSpace).toBe('nowrap');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.test.ts -t "copies snapshot-critical box, sizing, and transform properties"`

Expected: FAIL because width, transform, padding, boxSizing, and whiteSpace are not copied today

- [ ] **Step 3: 扩展 `computed-styles.ts` 的属性集合**

```ts
const BOX_MODEL_PROPERTIES = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'padding',
  'box-sizing',
  'white-space',
  'text-overflow',
  'table-layout',
  'border-collapse',
  'transform',
  'transform-origin',
] as const;
```

- [ ] **Step 4: 只复制“快照关键属性”，避免样式爆炸**

```ts
function shouldKeepProperty(property: ComputedProperty, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (property === 'width' || property === 'height') {
    return normalized !== 'auto' && normalized !== '0px';
  }

  if (property === 'transform') {
    return normalized !== 'none';
  }

  if (property === 'box-sizing') {
    return normalized === 'border-box';
  }

  return existingStructuralRules(property, normalized);
}
```

- [ ] **Step 5: 在 `applyMinimalComputedLayoutStyle` 中加入快照布局属性复制**

```ts
copyComputedProperties(target, source, BOX_MODEL_PROPERTIES);

if (position === 'sticky' || position === 'fixed' || position === 'absolute') {
  copyComputedProperties(target, source, POSITION_PROPERTIES);
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.test.ts`

Expected: PASS for the existing flex/grid tests plus new snapshot-critical property coverage

- [ ] **Step 7: 提交**

```bash
git add apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/computed-styles.test.ts
git commit -m "feat: inline snapshot-critical layout styles"
```

### Task 4: 冻结滚动状态，避免静态页展开成运行时全量结构

**Files:**
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts`

- [ ] **Step 1: 写滚动状态冻结失败测试**

```ts
it('freezes horizontal scroll containers using the source scroll offset', () => {
  document.body.innerHTML = `
    <div class="el-table__body-wrapper" style="overflow:auto hidden; width:400px;">
      <div class="scroll-content" style="width:1200px;">内容</div>
    </div>
  `;

  const sourceWrapper = document.querySelector('.el-table__body-wrapper') as HTMLElement;
  Object.defineProperty(sourceWrapper, 'scrollLeft', { value: 320, configurable: true });

  const capturedDoc = document.implementation.createHTMLDocument('capture');
  capturedDoc.body.innerHTML = document.body.innerHTML;

  normalizeCapturedLayout(capturedDoc, document);

  const normalized = capturedDoc.querySelector('.el-table__body-wrapper') as HTMLElement;
  expect(normalized.dataset.webmcpScrollLeft).toBe('320');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts -t "freezes horizontal scroll containers using the source scroll offset"`

Expected: FAIL because scroll offsets are not persisted

- [ ] **Step 3: 在布局归一化模块里记录滚动容器状态**

```ts
function freezeScrollableRegions(capturedDoc: Document, originalDoc: Document): void {
  const capturedScrollRoots = Array.from(
    capturedDoc.querySelectorAll('.el-table__body-wrapper, .el-scrollbar__wrap, [style*="overflow"]')
  );
  const originalScrollRoots = Array.from(
    originalDoc.querySelectorAll('.el-table__body-wrapper, .el-scrollbar__wrap, [style*="overflow"]')
  );

  for (const [index, element] of capturedScrollRoots.entries()) {
    const source = originalScrollRoots[index] as HTMLElement | undefined;
    const target = element as HTMLElement;
    if (!source) {
      continue;
    }

    target.dataset.webmcpScrollLeft = String(source.scrollLeft);
    target.dataset.webmcpScrollTop = String(source.scrollTop);
  }
}
```

- [ ] **Step 4: 对固定表格补静态偏移修正**

```ts
const scrollLeft = Number(target.dataset.webmcpScrollLeft || '0');
if (scrollLeft > 0) {
  target.style.setProperty('--webmcp-scroll-left', `${scrollLeft}px`);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts`

Expected: PASS for fixed-layer cleanup, overlay removal, and scroll-state freezing

- [ ] **Step 6: 提交**

```bash
git add apps/extension/entrypoints/content/lib/page-capture/capture-core/dom/layout-normalize.ts \
  apps/extension/entrypoints/content/lib/page-capture/capture-core/layout-normalize.test.ts
git commit -m "feat: preserve scroll state in page capture snapshots"
```

### Task 5: 做一次端到端回归验证

**Files:**
- Test: `apps/extension/entrypoints/content/lib/page-capture/capture-core/fixture.test.ts`
- Modify: `apps/extension/entrypoints/content/lib/page-capture/capture-core/index.ts`

- [ ] **Step 1: 运行 capture-core 相关测试**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture/capture-core`

Expected: PASS with all existing and new capture-core tests green

- [ ] **Step 2: 运行页面采集相关测试**

Run: `pnpm vitest apps/extension/entrypoints/content/lib/page-capture apps/extension/entrypoints/background/src/services/page-capture.test.ts`

Expected: PASS with no regression in artifact generation, placeholders, and workspace save flow

- [ ] **Step 3: 手工验证 CRM 客户管理页**

```text
1. 打开 https://crm-uat.annto.com/index.html#/mod/mdm/customer-manage
2. 触发“采集整页”
3. 用本地浏览器打开生成的 capture/index.html
4. 检查：
   - 左侧固定选择列不再单独飘出
   - 右侧“操作”固定列不再重复成一层浮层
   - 右下角 IT5000 / 我要建议 / 帮助中心不再出现在快照中
   - 主表格宽度、表头、搜索栏、分页位置与在线页接近
   - 图片和图标字体仍允许缺失，不作为失败标准
```

- [ ] **Step 4: 记录验证结果**

```md
- CRM 客户管理页固定列：通过 / 不通过
- CRM 客户管理页搜索区布局：通过 / 不通过
- CRM 客户管理页外挂浮层清理：通过 / 不通过
- 备注：仅忽略图片与图标字体，不忽略结构偏差
```

- [ ] **Step 5: 提交**

```bash
git add apps/extension/entrypoints/content/lib/page-capture/capture-core
git commit -m "test: verify layout fidelity capture flow"
```

---

## 自检结果

- **Spec coverage:** 已覆盖固定列表格扁平化、滚动状态冻结、计算样式增强、外挂悬浮层忽略这四个核心需求；未包含字体和图片恢复，符合本次范围。
- **Placeholder scan:** 计划中未使用 `TODO`、`TBD` 或“自行补充测试”类空描述。
- **Type consistency:** 统一使用 `normalizeCapturedLayout` 作为布局归一化入口，测试与实现文件路径保持一致。

