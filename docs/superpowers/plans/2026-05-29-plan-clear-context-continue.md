# 计划确认后的 Clear Context Continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在计划确认卡中增加 “clear context and continue” 执行分支，清空当前本地会话上下文后，用“原始用户目标 + 已批准计划内容”作为新会话第一条请求继续执行。

**Architecture:** 复用前端现有的 `stream.reset()`、`setConversationId()` 和 `sendMessage()` 流程，不新增后端专用接口；在前端新增一个轻量 continuation payload 状态，先 resolve 当前 `plan_approval`，再本地重置会话，最后自动发送一条新的执行请求。后端仅需透传计划确认时的 `nextPermissionMode` 与 `clearContext` 意图。

**Tech Stack:** React、TypeScript、Vitest、Node test runner、Claude SDK 运行时封装

---

## 文件结构

### 需要修改

- `apps/agent-backend-v2/src/agent/application/agent-service.ts`
  - 在 `ExitPlanMode` 通过时支持附带 `clearContext` 标记
- `apps/agent-backend-v2/src/agent/application/agent-service.test.ts`
  - 覆盖计划确认通过且要求 clear context 的 updatedInput
- `apps/agent-backend-v2/src/routes/agent-v2.ts`
  - 透传 `clearContext` 交互决策字段
- `apps/agent-backend-v2/src/app.test.ts`
  - 覆盖 interaction resolve route 的 `clearContext` 透传
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`
  - 扩展 `InteractionDecision` 与 continuation payload 类型
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.ts`
  - 为计划确认补充两种 clear context 动作
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts`
  - 覆盖 clear context 动作定义
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/useAgentV2Chat.ts`
  - 支持在 reset 后自动发送 continuation 请求
- `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
  - 从计划确认卡构造 continuation payload，触发 reset + new conversation + resend
- `apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`
  - 覆盖 clear context continue 的卡片点击与自动续跑

### 需要新增

- `apps/extension/entrypoints/sidepanel/lib/agent-v2/continuation.ts`
  - 统一构造 continuation prompt 与 payload
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/continuation.test.ts`
  - 覆盖 prompt 拼装和 fallback 规则

### 只读参考

- `docs/superpowers/plans/2026-05-29-plan-mode-alignment.md`
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.ts`
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/project-events.ts`
- `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`

## Task 1: 扩展计划确认动作与 continuation payload

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/lib/agent-v2/continuation.test.ts`
- Create: `apps/extension/entrypoints/sidepanel/lib/agent-v2/continuation.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`

- [ ] **Step 1: 先写失败测试，锁定 clear context continuation 的动作与 prompt 结构**

```ts
it('builds clear-context plan approval actions and continuation prompt', () => {
  expect(buildPlanApprovalActions()).toEqual([
    expect.objectContaining({ id: 'accept-edits', nextPermissionMode: 'acceptEdits' }),
    expect.objectContaining({ id: 'bypass', nextPermissionMode: 'bypassPermissions' }),
    expect.objectContaining({ id: 'clear-accept-edits', clearContext: true }),
    expect.objectContaining({ id: 'clear-bypass', clearContext: true }),
    expect.objectContaining({ id: 'revise', nextPermissionMode: null }),
  ]);

  expect(
    buildContinuationPrompt({
      originalGoal: '修复计划模式并补测试',
      approvedPlan: '1. 更新后端\n2. 更新前端\n3. 跑回归',
    })
  ).toContain('<original_user_goal>');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts entrypoints/sidepanel/lib/agent-v2/continuation.test.ts
```

Expected:

```text
FAIL  ...continuation.test.ts
Error: Cannot find module './continuation'
```

- [ ] **Step 3: 新增 continuation 工具模块，统一构造续跑 payload 和 prompt**

```ts
export function buildContinuationPrompt(input: {
  originalGoal: string;
  approvedPlan: string;
}) {
  return [
    '请基于以下目标和已批准计划直接进入执行阶段。',
    '',
    '<original_user_goal>',
    input.originalGoal.trim(),
    '</original_user_goal>',
    '',
    '<approved_plan>',
    input.approvedPlan.trim(),
    '</approved_plan>',
    '',
    '执行要求：',
    '1. 现在已经进入执行阶段，不要重新做长篇规划。',
    '2. 按已批准计划直接实施。',
    '3. 如需偏离计划，先说明原因。',
  ].join('\\n');
}
```

- [ ] **Step 4: 扩展 `buildPlanApprovalActions()`，增加两种 clear context 动作**

```ts
{
  id: 'clear-accept-edits',
  label: '清空上下文并允许编辑后继续',
  nextPermissionMode: 'acceptEdits',
  clearContext: true,
}
```

- [ ] **Step 5: 回归测试**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts entrypoints/sidepanel/lib/agent-v2/continuation.test.ts
```

Expected:

```text
PASS  ...plan-mode.test.ts
PASS  ...continuation.test.ts
```

## Task 2: 后端交互协议支持 `clearContext`

**Files:**
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.ts`
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.test.ts`
- Modify: `apps/agent-backend-v2/src/routes/agent-v2.ts`
- Modify: `apps/agent-backend-v2/src/app.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 `resolveInteraction` 对 `clearContext` 的 updatedInput 透传**

```ts
test('plan approval can carry clearContext together with nextPermissionMode', async () => {
  const decision = await capturedCanUseTool!(
    'ExitPlanMode',
    { plan: '1. 更新后端\\n2. 更新前端' },
    { toolUseID: 'toolu-plan-clear-1' }
  );

  service.resolveInteraction({
    runId: stream.runId,
    requestId: 'toolu-plan-clear-1',
    decision: {
      allow: true,
      nextPermissionMode: 'acceptEdits',
      clearContext: true,
    },
  });

  expect((await decision).updatedInput).toEqual({
    plan: '1. 更新后端\\n2. 更新前端',
    nextPermissionMode: 'acceptEdits',
    clearContext: true,
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/agent/application/agent-service.test.ts src/app.test.ts --test-name-pattern='clearContext'
```

Expected:

```text
FAIL  ...agent-service.test.ts
Expected updatedInput.clearContext to equal true
```

- [ ] **Step 3: 扩展后端 `InteractionDecision` 和 route body，支持 `clearContext?: boolean`**

```ts
type InteractionDecision = {
  allow?: boolean;
  message?: string;
  updatedInput?: unknown;
  answers?: Record<string, unknown>;
  nextPermissionMode?: 'acceptEdits' | 'bypassPermissions';
  clearContext?: boolean;
};
```

- [ ] **Step 4: 在 `ExitPlanMode` 的 `updatedInput` 中一并写入 `clearContext`**

```ts
decision.nextPermissionMode && toolName === 'ExitPlanMode'
  ? {
      ...effectiveToolInput,
      nextPermissionMode: decision.nextPermissionMode,
      ...(decision.clearContext === true ? { clearContext: true } : {}),
    }
```

- [ ] **Step 5: 回归测试**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/agent/application/agent-service.test.ts src/app.test.ts --test-name-pattern='clearContext|nextPermissionMode'
```

Expected:

```text
PASS  ...agent-service.test.ts
PASS  ...app.test.ts
```

## Task 3: 聊天页实现 reset + 新会话 + 自动续跑

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/useAgentV2Chat.ts`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定 clear context continuation 会 reset 当前会话并自动发新请求**

```tsx
it('clears current conversation and auto-sends continuation prompt after plan approval', async () => {
  mockStreamState.resolveInteraction = vi.fn();
  mockStreamState.sendMessage = vi.fn();

  // 准备一个带原始用户消息和 plan_approval 的 run card

  const view = render(<Chat />);
  fireEvent.click(await view.findByRole('button', { name: '清空上下文并允许编辑后继续' }));

  await waitFor(() => {
    expect(mockStreamState.reset).toHaveBeenCalled();
    expect(mockStreamState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: 'acceptEdits',
        prompt: expect.stringContaining('<original_user_goal>'),
      })
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx -t 'clears current conversation and auto-sends continuation prompt after plan approval'
```

Expected:

```text
FAIL  ...chat-selection-quote.interaction.test.tsx
Expected mockStreamState.reset to have been called
```

- [ ] **Step 3: 在聊天页新增 `pendingContinuation` 状态，保存 clear context 后要续跑的 payload**

```ts
const [pendingContinuation, setPendingContinuation] = useState<null | {
  permissionMode: 'acceptEdits' | 'bypassPermissions';
  prompt: string;
}>(null);
```

- [ ] **Step 4: 在 `PlanApprovalCard` 点击 clear context 动作时，先 resolveInteraction，再 reset、本地清空、换新 `conversationId`，最后触发自动 `sendMessage`**

```ts
await stream.resolveInteraction(...);
stream.reset();
setCurrentSessionTitle(undefined);
setConversationId(crypto.randomUUID());
setPendingContinuation({
  permissionMode: 'acceptEdits',
  prompt: buildContinuationPrompt(...),
});
```

- [ ] **Step 5: 用 `useEffect` 监听 `pendingContinuation`，在新会话状态稳定后自动发消息并清掉 pending**

```ts
useEffect(() => {
  if (!pendingContinuation) return;
  void stream.sendMessage({
    prompt: pendingContinuation.prompt,
    permissionMode: pendingContinuation.permissionMode,
    projectPath: activeProjectPath,
    browserContext: resolvedBrowserContext,
  }).finally(() => setPendingContinuation(null));
}, [pendingContinuation, stream, activeProjectPath, resolvedBrowserContext]);
```

- [ ] **Step 6: 回归测试**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx -t 'plan approval'
```

Expected:

```text
PASS  ...chat-selection-quote.interaction.test.tsx
```

## Task 4: 提取“原始用户目标 + 已批准计划内容”的来源规则

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定 continuation 使用“原始目标 + 批准计划”**

```tsx
expect(mockStreamState.sendMessage).toHaveBeenCalledWith(
  expect.objectContaining({
    prompt: expect.stringContaining('<original_user_goal>修复计划模式'),
  })
);
expect(mockStreamState.sendMessage).toHaveBeenCalledWith(
  expect.objectContaining({
    prompt: expect.stringContaining('<approved_plan>1. 更新后端'),
  })
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx -t 'original_user_goal'
```

Expected:

```text
FAIL  ...chat-selection-quote.interaction.test.tsx
Expected prompt to contain original_user_goal
```

- [ ] **Step 3: 在聊天页实现两个提取函数**

```ts
function deriveOriginalGoal(card: ActiveInteractionCard, items: ConversationRunItem[]) {
  return [...items]
    .reverse()
    .find((item) => item.type === 'user' && item.message.runId === card.runId)?.message.text || '';
}

function deriveApprovedPlan(interaction: ActiveInteractionCard['activeInteraction']) {
  const input = interaction.input;
  if (input && typeof input === 'object' && typeof (input as { plan?: unknown }).plan === 'string') {
    return String((input as { plan: string }).plan);
  }
  return interaction.message || '';
}
```

- [ ] **Step 4: 用这两个提取结果构造 continuation prompt**

```ts
const prompt = buildContinuationPrompt({
  originalGoal,
  approvedPlan,
});
```

- [ ] **Step 5: 回归测试**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx -t 'original_user_goal|approved_plan'
```

Expected:

```text
PASS  ...chat-selection-quote.interaction.test.tsx
```

## Task 5: 任务范围回归

**Files:**
- Modify: `docs/superpowers/plans/2026-05-29-plan-clear-context-continue.md`

- [ ] **Step 1: 跑后端定向测试**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/agent/application/agent-service.test.ts src/app.test.ts --test-name-pattern='clearContext|nextPermissionMode|ExitPlanMode'
```

Expected:

```text
PASS  ...agent-service.test.ts
PASS  ...app.test.ts
```

- [ ] **Step 2: 跑前端定向测试**

Run:

```bash
pnpm --filter @mcp-b/extension exec vitest --run entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts entrypoints/sidepanel/lib/agent-v2/continuation.test.ts entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx -t 'plan approval|clear context|continuation'
```

Expected:

```text
PASS  ...plan-mode.test.ts
PASS  ...continuation.test.ts
PASS  ...chat-selection-quote.interaction.test.tsx
```

- [ ] **Step 3: 手工验收**

Run:

```bash
pnpm dev:agent-v2
pnpm dev:extension
```

Expected:

```text
1. 计划确认卡出现 5 个动作，其中包含两种 clear context continue
2. 点击 clear context continue 后，当前聊天记录被清空
3. 新会话自动发出一条执行请求
4. 新请求里同时包含 original_user_goal 和 approved_plan
5. 新请求的 permissionMode 为 acceptEdits 或 bypassPermissions，而不是 plan
```

## 自检结论

- 已覆盖：
  - clear context 动作定义
  - continuation prompt 结构
  - 后端 `clearContext` 透传
  - 前端 reset + new conversation + auto-send
  - original goal / approved plan 提取
- 刻意不做：
  - 跨刷新持久化 continuation
  - 二次确认弹窗
  - 后端专用 continue-from-plan 新接口
