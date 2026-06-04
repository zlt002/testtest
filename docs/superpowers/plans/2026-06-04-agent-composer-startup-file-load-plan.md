# Agent Composer 启动期轻量文件加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 避免 sidepanel 启动时 `AgentComposer` 触发重型文件树扫描，降低扩展徽标长期停留在 `...` 的概率。

**Architecture:** 保持后端 `/api/files/tree` 与工作区页面的按需加载逻辑不变，只收紧 `AgentComposer` 启动阶段的 `listFiles` 请求参数。首次加载只请求根目录浅层文件列表，不带元数据，让启动链路先拿到可用状态，后续更重的目录信息继续由既有工作区页按需获取。

**Tech Stack:** React 19、Vitest、Testing Library、Agent V2 client

---

### Task 1: 锁定启动期文件列表请求行为

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.test.tsx`
- Test: `apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('loads startup file suggestions with a shallow lightweight request', async () => {
  renderComposer();

  await waitFor(() => {
    expect(listFilesMock).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      maxDepth: 0,
      includeMetadata: false,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认先红**

Run: `pnpm --filter @mcp-b/extension test AgentComposer.test.tsx --runInBand`
Expected: FAIL，提示 `listFiles` 调用参数缺少 `maxDepth` / `includeMetadata`

- [ ] **Step 3: 写最小实现**

```tsx
client
  .listFiles({
    projectPath,
    maxDepth: 0,
    includeMetadata: false,
  })
  .then((entries) => {
    if (!cancelled) {
      setFiles(entries);
    }
  })
```

- [ ] **Step 4: 运行测试确认转绿**

Run: `pnpm --filter @mcp-b/extension test AgentComposer.test.tsx --runInBand`
Expected: PASS

- [ ] **Step 5: 运行相关回归测试**

Run: `pnpm --filter @mcp-b/extension test AgentComposer.test.tsx`
Expected: PASS
