# Markdown 预览大范围图片插入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Markdown 预览视图在正文大部分区域都能插入图片，并通过块级、章节级、文档末尾兜底策略降低失败率。

**Architecture:** 继续沿用“预览 DOM 定位 + Markdown 源码 offset 写回”的现有架构，但把插图定位从少量标签白名单升级为“正文 article 内优先寻找最近块级锚点，再逐级降级”。`file-preview.markdown-insert-position.ts` 负责定位规则与 offset 解析，`file-preview.tsx` 只复用统一结果，不额外分叉 UI 逻辑。

**Tech Stack:** React 19、TypeScript、Vitest、JSDOM、WXT 扩展侧边栏路由

---

### Task 1: 扩展插图定位规则的单元测试

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts`
- Test: `apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts`

- [ ] **Step 1: 写失败测试，覆盖“整表后插”和更宽松的正文区域**

```ts
it('inserts after the whole table instead of the table cell line', () => {
  const article = setup(
    '<p>前置段落</p><table><tbody><tr><td>核心诉求</td></tr></tbody></table><p>后置段落</p>'
  );
  const source = '前置段落\n\n| 字段 |\n| --- |\n| 核心诉求 |\n\n后置段落';

  expect(
    resolveMarkdownInsertOffset(
      source,
      buildMarkdownInsertTargetFromNode(article, article.querySelector('td')!)
    )
  ).toEqual({ ok: true, offset: '前置段落\n\n| 字段 |\n| --- |\n| 核心诉求 |'.length });
});

it('allows inserting from a table container or row target', () => {
  const article = setup('<table><tbody><tr><td>核心诉求</td></tr></tbody></table>');
  const source = '| 字段 |\n| --- |\n| 核心诉求 |';

  expect(
    resolveMarkdownInsertOffset(
      source,
      buildMarkdownInsertTargetFromNode(article, article.querySelector('tbody')!)
    )
  ).toEqual({ ok: true, offset: source.length });
});
```

- [ ] **Step 2: 写失败测试，覆盖重复文本时的正文内兜底**

```ts
it('falls back to the end of the document when the target text is duplicated inside article', () => {
  const article = setup('<p>重复内容</p><p>重复内容</p>');
  const target = buildMarkdownInsertTargetFromNode(article, article.querySelectorAll('p')[1]!);

  expect(resolveMarkdownInsertOffset('重复内容\n\n重复内容', target)).toEqual({
    ok: true,
    offset: '重复内容\n\n重复内容'.length,
  });
});
```

- [ ] **Step 3: 运行测试并确认先红灯**

Run:

```bash
pnpm --filter @mcp-b/extension test -- file-preview.markdown-insert-position.test.ts
```

Expected:

```text
FAIL  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts
- inserts after the whole table instead of the table cell line
- allows inserting from a table container or row target
- falls back to the end of the document when the target text is duplicated inside article
```

### Task 2: 实现更接近 Word 的插图目标解析

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.ts`
- Test: `apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts`

- [ ] **Step 1: 最小实现更宽松的块级锚点识别**

```ts
const SUPPORTED_INSERT_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'UL',
  'OL',
  'HR',
]);

function normalizeInsertAnchor(element: HTMLElement) {
  if (element.closest('pre, code, [data-mermaid-root=\"true\"]')) {
    return null;
  }
  const table = element.closest('table');
  if (table) {
    return table as HTMLElement;
  }
  const listItem = element.closest('li');
  if (listItem) {
    return listItem as HTMLElement;
  }
  return SUPPORTED_INSERT_TAGS.has(element.tagName) ? element : null;
}
```

- [ ] **Step 2: 最小实现 offset 解析的降级链路**

```ts
export function resolveMarkdownInsertOffset(source: string, target: MarkdownInsertTarget) {
  if (!target.ok) {
    return target;
  }

  const rawIndex = source.indexOf(target.text);
  if (rawIndex >= 0 && source.indexOf(target.text, rawIndex + 1) < 0) {
    return { ok: true as const, offset: rawIndex + target.text.length };
  }

  const normalizedIndex = normalize(source).indexOf(normalize(target.text));
  if (normalizedIndex >= 0) {
    return { ok: true as const, offset: source.length };
  }

  return { ok: true as const, offset: source.length };
}
```

- [ ] **Step 3: 运行测试并修到变绿**

Run:

```bash
pnpm --filter @mcp-b/extension test -- file-preview.markdown-insert-position.test.ts
```

Expected:

```text
PASS  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts
```

- [ ] **Step 4: 轻量重构，收紧禁区与错误提示**

```ts
const unsupportedMessage =
  '当前位置暂不支持插入图片，请点到正文内容区域、列表、表格或标题附近';
```

并保证：

```ts
if (!element || !text) {
  return { ok: false, message: unsupportedMessage };
}
```

- [ ] **Step 5: 再跑一次同文件测试，确认重构后仍绿**

Run:

```bash
pnpm --filter @mcp-b/extension test -- file-preview.markdown-insert-position.test.ts
```

Expected:

```text
PASS  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts
```

### Task 3: 验证侧边栏图片入口仍复用统一规则

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/file-preview.tsx`
- Test: `apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx`

- [ ] **Step 1: 补一条交互测试，锁定默认插图弹层仍能正常工作**

```ts
it('keeps the markdown image insert overlay behavior unchanged after resolver changes', () => {
  render(
    <MarkdownImageInsertOverlay
      draft={{
        file: new File(['image'], 'image.png', { type: 'image/png' }),
        offset: 12,
        alt: '图片',
      }}
      saving={false}
      onAltChange={() => undefined}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />
  );

  expect(screen.getByRole('button', { name: '插入' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 如需要，仅做最小实现整理，让 `file-preview.tsx` 继续统一使用 resolver 返回值**

```ts
const resolvedTarget = resolveCurrentSelectionImageInsertTarget();
if (!resolvedTarget?.ok) {
  setError(resolvedTarget?.message || '请先在预览正文中点击要插入图片的位置');
  return;
}
imageFileInputRef.current?.click();
```

要求：

```ts
handlePointerUp
handlePointerMove
resolveCurrentSelectionImageInsertTarget
```

都继续复用 `buildMarkdownInsertTargetFromNode` 和 `resolveMarkdownInsertOffset`，不在 UI 层新增一套定位分支。

- [ ] **Step 3: 跑交互测试确认没有回归**

Run:

```bash
pnpm --filter @mcp-b/extension test -- file-preview.image-insert.test.tsx
```

Expected:

```text
PASS  apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx
```

### Task 4: 全量验证与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-06-01-markdown-preview-image-insert-design.md`
- Modify: `docs/superpowers/plans/2026-06-01-markdown-preview-image-insert.md`
- Test: `apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts`
- Test: `apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx`

- [ ] **Step 1: 跑本次相关测试集**

Run:

```bash
pnpm --filter @mcp-b/extension test -- file-preview.markdown-insert-position.test.ts file-preview.image-insert.test.tsx
```

Expected:

```text
PASS  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts
PASS  apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx
```

- [ ] **Step 2: 跑扩展包 typecheck**

Run:

```bash
pnpm --filter @mcp-b/extension typecheck
```

Expected:

```text
Found 0 errors
```

- [ ] **Step 3: 对照设计稿自查实现范围**

检查点：

```text
- 表格内部点击是否已统一改为整表后插
- 重复文本是否不再直接失败
- 禁区是否仍然禁止插图
- UI 层是否没有分叉出第二套定位逻辑
```

- [ ] **Step 4: 提交本次改动**

```bash
git add \
  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.ts \
  apps/extension/entrypoints/sidepanel/routes/file-preview.markdown-insert-position.test.ts \
  apps/extension/entrypoints/sidepanel/routes/file-preview.image-insert.test.tsx \
  apps/extension/entrypoints/sidepanel/routes/file-preview.tsx \
  docs/superpowers/specs/2026-06-01-markdown-preview-image-insert-design.md \
  docs/superpowers/plans/2026-06-01-markdown-preview-image-insert.md
git commit -m "feat: 放宽 markdown 预览图片插入位置"
```
