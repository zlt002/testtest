# Live Page Toolbar Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实网页模式复用本地快照模式的底部悬浮工具栏壳层，并把真实网页专属动作并入同一条工具栏。

**Architecture:** 复用 `vis-bug` 现有的 `data-bottom-toolbar` 模板与状态机，不再为真实网页单独输出 `data-live-toolbar`。真实网页与本地快照共享同一套渲染壳层，只在 action 按钮集合上按页面模式分支。

**Tech Stack:** Web Components, VisBug runtime, Vitest, JSDOM

---

### Task 1: 用测试锁定统一壳层

**Files:**
- Modify: `apps/extension/tests/page-edit/file-save.test.ts`
- Modify: `apps/extension/tests/page-edit/selection-actions.test.ts`

- [x] 写出真实网页也要渲染 `data-bottom-toolbar` 的失败测试
- [x] 运行相关 Vitest 用例并确认失败

### Task 2: 合并真实网页与快照页工具栏渲染

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js`

- [x] 让 `render()` 统一走 `renderBottomToolbar()`
- [x] 让真实网页 action 区输出 `capture-page` 与 `toggle-annotation-markers`
- [x] 让 selection 更新后两种模式都刷新底部工具栏

### Task 3: 补齐统一样式细节

**Files:**
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css`
- Modify: `apps/extension/public/page-edit/vendor/app/components/vis-bug/vis-bug.element.css.js`

- [x] 为底部 action 区中的标注按钮补齐纵向 icon/count 排版
- [x] 保持按钮尺寸与底部工具栏视觉 token 一致

### Task 4: 回归验证

**Files:**
- Test: `apps/extension/tests/page-edit/file-save.test.ts`
- Test: `apps/extension/tests/page-edit/selection-actions.test.ts`

- [x] 运行 `pnpm exec vitest run tests/page-edit/file-save.test.ts tests/page-edit/selection-actions.test.ts`
- [x] 确认 59 个相关测试全部通过
