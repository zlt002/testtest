# 会话 Markdown 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为侧边栏聊天实现整会话导出 Markdown，以及单条助手回答复制/导出 Markdown。

**Architecture:** 新增一个独立的聊天 Markdown 导出模块，负责把当前 `ConversationRunItem` 与 `RunCard` 投影为纯对话 Markdown；聊天页只负责挂接会话级和回答级入口，并复用现有前端下载与提示能力。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、浏览器 Clipboard API、前端 Blob 下载

---

## 文件结构

### 需要修改

- `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
  - 接入整会话导出入口
  - 接入单条助手回答复制/导出入口
  - 复用导出模块和下载/提示逻辑
- `apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx`
  - 覆盖整会话导出与单条回答复制交互

### 需要新增

- `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.ts`
  - 统一封装 Markdown 生成、时间格式化、文件名生成
- `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts`
  - 覆盖纯函数导出规则

### 只读参考

- `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.ts`
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`
- `apps/extension/entrypoints/sidepanel/lib/file-download-export.ts`
- `docs/superpowers/specs/2026-05-28-chat-markdown-export-design.md`

## Task 1: 锁定 Markdown 导出规则

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts`
- Create: `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.ts`

- [ ] **Step 1: 先写失败测试，锁定整会话与单条回答 Markdown 结构**

```ts
it('exports a conversation markdown document with timestamps', () => {
  const markdown = buildConversationMarkdown({
    sessionId: 'session-1',
    sessionTitle: '客户管理列表',
    exportedAt: '2026-05-28T04:30:00.000Z',
    items: [
      { type: 'user', message: message({ role: 'user', text: '帮我分析这个页面' }) },
      {
        type: 'run',
        card: runCard({
          responseMessages: [
            {
              id: 'assistant-1',
              timestamp: '2026-05-28T04:00:08.000Z',
              body: '这是第一段回答',
            },
            {
              id: 'assistant-2',
              timestamp: '2026-05-28T04:00:09.000Z',
              body: '这是第二段回答',
            },
          ],
        }),
      },
    ],
  });

  expect(markdown).toContain('# 会话记录');
  expect(markdown).toContain('> 会话标题：客户管理列表');
  expect(markdown).toContain('## 用户 · 2026-05-28 12:00:00');
  expect(markdown).toContain('## 助手 · 2026-05-28 12:00:08');
  expect(markdown).toContain('这是第一段回答\n\n这是第二段回答');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts
```

Expected:

```text
FAIL  ...chat-markdown-export.test.ts
Error: Cannot find module './chat-markdown-export'
```

- [ ] **Step 3: 写最小实现，生成纯对话 Markdown、默认文件名和 fallback 回答**

```ts
export function buildAssistantResponseMarkdown(card: RunCard) {
  const response = assistantResponseFromCard(card);
  return [`## 助手 · ${formatMarkdownTimestamp(response.timestamp)}`, '', response.body].join('\n');
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts
```

Expected:

```text
PASS  ...chat-markdown-export.test.ts
```

## Task 2: 接入聊天页整会话导出

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`

- [ ] **Step 1: 先写失败测试，锁定整会话导出入口和下载行为**

```tsx
it('exports current conversation as markdown from the header menu', async () => {
  mockStreamState.conversationItems = [
    { type: 'user', message: message({ id: 'user-1', role: 'user', text: '你好' }) },
    { type: 'run', card: runCard({ id: 'run-1', headline: '已完成', responseText: '世界' }) },
  ];

  const view = render(<Chat />);
  fireEvent.click(view.getByRole('button', { name: '更多配置' }));
  fireEvent.click(await view.findByRole('button', { name: '导出 Markdown' }));

  expect(downloadSpy).toHaveBeenCalledWith(
    expect.stringContaining('# 会话记录'),
    expect.stringMatching(/\.md$/)
  );
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx
```

Expected:

```text
FAIL  ...chat.active-run-restore.test.tsx
Unable to find role "button" with name "导出 Markdown"
```

- [ ] **Step 3: 在聊天页顶部更多菜单加入“导出 Markdown”，调用统一导出模块并触发 Blob 下载**

```ts
const handleExportConversationMarkdown = useCallback(() => {
  const markdown = buildConversationMarkdown({
    sessionId: stream.sessionId || 'unknown-session',
    sessionTitle: deriveSessionTitleFromMessage(...),
    exportedAt: new Date().toISOString(),
    items: visibleConversationSource,
  });
  downloadTextFile({
    content: markdown,
    fileName: buildConversationMarkdownFileName(...),
    mimeType: 'text/markdown;charset=utf-8',
  });
}, [...]);
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx
```

Expected:

```text
PASS  ...chat.active-run-restore.test.tsx
```

## Task 3: 接入单条助手回答复制和导出

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`

- [ ] **Step 1: 先写失败测试，锁定单条助手回答操作**

```tsx
it('copies assistant response markdown from the run card action', async () => {
  mockStreamState.conversationItems = [
    { type: 'run', card: runCard({ id: 'run-1', headline: '已完成', responseText: '导出内容' }) },
  ];

  const view = render(<Chat />);
  fireEvent.click(await view.findByRole('button', { name: '助手回答操作 run-1' }));
  fireEvent.click(await view.findByRole('button', { name: '复制 Markdown' }));

  await waitFor(() => {
    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('导出内容'));
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx
```

Expected:

```text
FAIL  ...chat.active-run-restore.test.tsx
Unable to find role "button" with name "复制 Markdown"
```

- [ ] **Step 3: 在助手回答卡片头部增加轻量操作菜单，支持复制和导出**

```tsx
<button
  type="button"
  aria-label={`助手回答操作 ${card.id}`}
  onClick={() => setIsExportMenuOpen((value) => !value)}
>
  <MoreVerticalIcon className="h-4 w-4" />
</button>
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx
```

Expected:

```text
PASS  ...chat.active-run-restore.test.tsx
```

## Task 4: 汇总验证

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.ts`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- Test: `apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts`
- Test: `apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx`

- [ ] **Step 1: 运行目标测试集**

Run:

```bash
pnpm --filter @mcp-b/extension test --run \
  apps/extension/entrypoints/sidepanel/lib/chat-markdown-export.test.ts \
  apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx
```

Expected:

```text
PASS  ...chat-markdown-export.test.ts
PASS  ...chat.active-run-restore.test.tsx
```

- [ ] **Step 2: 运行扩展侧类型/静态检查**

Run:

```bash
pnpm --filter @mcp-b/extension exec tsc --noEmit
```

Expected:

```text
exit 0
```
