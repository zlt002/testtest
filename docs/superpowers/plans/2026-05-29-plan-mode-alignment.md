# 计划模式对齐 Claude 官方 SDK/CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 agent v2 的计划模式对齐到 Claude 官方 Agent SDK 的权限语义，并补齐接近 Claude Code CLI 的“计划确认后再执行”工作流。

**Architecture:** 后端分离“SDK 原生权限模式”和“本地交互策略”，新增轻量 plan mode 适配层，显式建模 `plan_approval` 交互和运行阶段；前端在现有 run card/interaction 流上增加计划确认卡片与继续执行分支，而不是把计划确认混入普通写权限审批。

**Tech Stack:** TypeScript、Node test runner、React、Vitest、Testing Library、Claude SDK 运行时封装

---

## 文件结构

### 需要修改

- `apps/agent-backend-v2/src/agent/runtime/claude-request-builder.ts`
  - 修正 `permissionMode` 到 SDK 选项的单一映射
- `apps/agent-backend-v2/src/agent/application/agent-service.ts`
  - 拆分 plan 模式判定、计划确认交互、继续执行逻辑
- `apps/agent-backend-v2/src/agent/application/agent-service.test.ts`
  - 覆盖 plan / bypass / plan approval 的主流程
- `apps/agent-backend-v2/src/agent/runtime/claude-request-builder.test.ts`
  - 覆盖 `allowDangerouslySkipPermissions`
- `apps/agent-backend-v2/src/agent/domain/events.ts`
  - 为计划确认/运行阶段扩展事件 payload 约定
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`
  - 增加 `plan_approval` 与 `runPhase`
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/project-events.ts`
  - 将后端计划确认事件投影成前端显示消息
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.ts`
  - 把计划确认展示成独立卡片
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.test.ts`
  - 覆盖计划确认卡映射
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts`
  - 支持“确认计划后继续执行”请求体
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/useAgentV2Chat.ts`
  - 封装计划确认交互动作
- `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
  - 增加计划确认卡、默认权限模式调整、继续执行入口
- `apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.tsx`
  - 调整 `plan` / `bypassPermissions` 文案

### 需要新增

- `apps/agent-backend-v2/src/agent/runtime/plan-mode.ts`
  - 统一封装 plan 模式规则、交互分类与继续执行参数
- `apps/agent-backend-v2/src/agent/runtime/plan-mode.test.ts`
  - 覆盖 plan 规则纯函数
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.ts`
  - 前端的计划确认文案、按钮模型和显示辅助
- `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts`
  - 覆盖计划确认展示映射

### 只读参考

- `docs/superpowers/specs/2026-05-28-chat-markdown-export-design.md`
- `apps/agent-backend-v2/src/agent/runtime/interaction-policy-router.ts`
- `apps/agent-backend-v2/src/routes/agent-v2.ts`
- `apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`

## Task 1: 修复 `bypassPermissions` 的 SDK 契约

**Files:**
- Modify: `apps/agent-backend-v2/src/agent/runtime/claude-request-builder.test.ts`
- Modify: `apps/agent-backend-v2/src/agent/runtime/claude-request-builder.ts`
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.ts`

- [ ] **Step 1: 先补失败测试，锁定 `bypassPermissions` 应向 SDK 透传危险跳过权限开关**

```ts
test('enables allowDangerouslySkipPermissions when permissionMode is bypassPermissions', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    permissionMode: 'bypassPermissions',
  });

  assert.equal(options.permissionMode, 'bypassPermissions');
  assert.equal(options.allowDangerouslySkipPermissions, true);
});

test('does not enable allowDangerouslySkipPermissions for plan mode', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    permissionMode: 'plan',
  });

  assert.equal(options.permissionMode, 'plan');
  assert.equal(options.allowDangerouslySkipPermissions, false);
});
```

- [ ] **Step 2: 运行测试并确认当前实现至少有一条失败**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='allowDangerouslySkipPermissions|bypassPermissions'
```

Expected:

```text
FAIL  ...claude-request-builder.test.ts
Expected values to be strictly equal:
false !== true
```

- [ ] **Step 3: 删除后端对 `allowDangerouslySkipPermissions` 的二次硬覆盖，只保留 builder 作为单一真值来源**

```ts
const options = deps.env
  ? buildClaudeRequestOptions({
      env: deps.env,
      projectPath: input.projectPath,
      resume: input.sessionId ?? undefined,
      model: requestModel,
      mcpServers,
      allowedTools: toolPermissions?.allowedTools,
      useDefaultAllowedTools,
      disallowedTools: toolPermissions?.disallowedTools,
      permissionMode: input.permissionMode,
      effort: input.effort,
      settingSources,
      skills: skillPlan?.skills,
      plugins: runtimePlugins,
      sdkEnv,
      systemPrompt: skillPlan?.systemPrompt,
      appendSystemPrompt: CHINESE_USER_SYSTEM_PROMPT,
    })
  : { ... };
```

- [ ] **Step 4: 回归测试，确认 builder 和 service 层不会再把 bypass 关回去**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='allowDangerouslySkipPermissions|bypassPermissions|plan 模式'
```

Expected:

```text
PASS  ...claude-request-builder.test.ts
PASS  ...agent-service.test.ts
```

## Task 2: 抽出 plan mode 规则层并显式建模计划确认

**Files:**
- Create: `apps/agent-backend-v2/src/agent/runtime/plan-mode.test.ts`
- Create: `apps/agent-backend-v2/src/agent/runtime/plan-mode.ts`
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.ts`
- Modify: `apps/agent-backend-v2/src/agent/domain/events.ts`

- [ ] **Step 1: 先写纯函数失败测试，锁定 plan 模式下的工具分类和交互分类**

```ts
test('plan mode allows readonly tools but marks exit-plan interactions as plan approval', () => {
  assert.deepEqual(
    classifyPlanModeToolUse({
      permissionMode: 'plan',
      toolName: 'Read',
      toolInput: { file_path: '/tmp/README.md' },
    }),
    { behavior: 'allow' }
  );

  assert.deepEqual(
    classifyPlanModeToolUse({
      permissionMode: 'plan',
      toolName: 'ExitPlanMode',
      toolInput: {
        plan: '1. 修改权限流\n2. 增加前端确认卡\n3. 回归测试',
      },
    }),
    {
      behavior: 'ask',
      interactionKind: 'plan_approval',
      nextPhase: 'awaiting_plan_approval',
    }
  );
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='plan mode allows readonly tools'
```

Expected:

```text
FAIL  ...plan-mode.test.ts
Error: Cannot find module './plan-mode'
```

- [ ] **Step 3: 新增 `plan-mode.ts`，集中封装 plan 规则，避免 `agent-service.ts` 继续膨胀**

```ts
export type PlanModeDecision =
  | { behavior: 'allow' }
  | {
      behavior: 'ask';
      interactionKind: 'plan_approval' | 'permission_request';
      nextPhase: 'awaiting_plan_approval' | 'planning';
      title?: string;
    };

export function classifyPlanModeToolUse(input: {
  permissionMode?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}): PlanModeDecision | null {
  if (input.permissionMode !== 'plan') {
    return null;
  }

  if (input.toolName === 'ExitPlanMode') {
    return {
      behavior: 'ask',
      interactionKind: 'plan_approval',
      nextPhase: 'awaiting_plan_approval',
      title: 'Claude 已完成计划，等待你确认后继续执行',
    };
  }

  if (!requiresApprovalForSideEffects(input.toolName, input.toolInput)) {
    return { behavior: 'allow' };
  }

  return {
    behavior: 'ask',
    interactionKind: 'permission_request',
    nextPhase: 'planning',
  };
}
```

- [ ] **Step 4: 在 `agent-service.ts` 接入纯函数分类，并在 `interaction.required` 里写入 `plan_approval` 与 `runPhase` payload**

```ts
const planModeDecision = classifyPlanModeToolUse({
  permissionMode: input.permissionMode,
  toolName,
  toolInput: effectiveToolInput,
});

if (planModeDecision?.behavior === 'allow') {
  allowedToolUses.set(requestId, toolName);
  return {
    behavior: 'allow',
    updatedInput: effectiveToolInput,
    toolUseID: requestId,
  };
}

manualEvents.push(
  nextManualEvent('interaction.required', {
    requestId,
    kind: planModeDecision?.interactionKind ?? defaultInteractionKind,
    runPhase: planModeDecision?.nextPhase ?? 'planning',
    toolName,
    message: planModeDecision?.title ?? `Claude 请求使用 ${toolName}`,
    input: effectiveToolInput,
    context,
  })
);
```

- [ ] **Step 5: 回归测试 plan 规则与 `interaction.required` payload**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='plan mode|plan_approval|ExitPlanMode'
```

Expected:

```text
PASS  ...plan-mode.test.ts
PASS  ...agent-service.test.ts
```

## Task 3: 支持“确认计划后继续执行”的后端协议

**Files:**
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.test.ts`
- Modify: `apps/agent-backend-v2/src/routes/agent-v2.ts`
- Modify: `apps/agent-backend-v2/src/agent/application/agent-service.ts`

- [ ] **Step 1: 先写失败测试，锁定计划确认后可以切换到执行权限模式**

```ts
test('plan approval can switch next execution mode to acceptEdits', async () => {
  let capturedDecision:
    | ((toolName: string, input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    historyReader: { async readSessionHistory() { return []; } },
    runtime: {
      query(input) {
        capturedDecision = (input.options as { canUseTool?: typeof capturedDecision }).canUseTool;
        return Object.assign((async function* () {})(), { async interrupt() {} });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '先研究后修改',
    projectPath: '/tmp/project-plan-approval',
    permissionMode: 'plan',
  });

  const result = await capturedDecision!(
    'ExitPlanMode',
    { plan: '1. 更新后端\n2. 更新前端' },
    { toolUseID: 'toolu-plan-exit-1' }
  );

  assert.equal(result.behavior, 'ask');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='plan approval can switch'
```

Expected:

```text
FAIL  ...agent-service.test.ts
Expected values to be strictly equal:
'allow' !== 'ask'
```

- [ ] **Step 3: 扩展 `resolveInteraction` 协议，允许计划确认携带 `nextPermissionMode`**

```ts
type InteractionDecision = {
  allow?: boolean;
  message?: string;
  updatedInput?: unknown;
  answers?: Record<string, unknown>;
  nextPermissionMode?: 'acceptEdits' | 'bypassPermissions';
};
```

```ts
const updatedInput =
  decision.nextPermissionMode && toolName === 'ExitPlanMode'
    ? {
        ...effectiveToolInput,
        nextPermissionMode: decision.nextPermissionMode,
      }
    : decision.updatedInput && typeof decision.updatedInput === 'object'
      ? (decision.updatedInput as Record<string, unknown>)
      : decision.answers
        ? { ...effectiveToolInput, answers: decision.answers }
        : effectiveToolInput;
```

- [ ] **Step 4: 在 route 层补齐 `nextPermissionMode` 解析，保证前端能提交该字段**

```ts
type InteractionDecisionBody = {
  allow?: unknown;
  message?: unknown;
  updatedInput?: unknown;
  answers?: unknown;
  nextPermissionMode?: unknown;
};
```

- [ ] **Step 5: 回归测试确认 route 与 service 都接受计划确认的下一阶段模式**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='plan approval|resolveInteraction|agent v2'
```

Expected:

```text
PASS  ...agent-service.test.ts
PASS  ...app.test.ts
```

## Task 4: 前端增加 `plan_approval` 类型与展示映射

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts`
- Create: `apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/project-events.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 `plan_approval` 会被映射为独立交互卡**

```ts
it('projects plan approval interactions into dedicated run card actions', () => {
  const messages = projectAgentEventsToMessages([
    {
      eventId: 'evt-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      timestamp: '2026-05-29T08:00:00.000Z',
      type: 'interaction.required',
      payload: {
        requestId: 'interaction-1',
        kind: 'plan_approval',
        runPhase: 'awaiting_plan_approval',
        toolName: 'ExitPlanMode',
        message: 'Claude 已完成计划，等待你确认后继续执行',
        input: { plan: '1. 调整 builder\n2. 调整 chat UI' },
      },
    },
  ]);

  const card = buildRunCard({
    runId: 'run-1',
    sessionId: 'session-1',
    messages,
  });

  expect(card.activeInteraction?.kind).toBe('plan_approval');
  expect(card.activeInteraction?.title).toContain('继续执行');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.test.ts
```

Expected:

```text
FAIL  ...run-cards.test.ts
Expected 'permission_request' to be 'plan_approval'
```

- [ ] **Step 3: 扩展前端类型和投影逻辑，支持 `plan_approval` 与 `runPhase`**

```ts
export type DisplayMessage = {
  // ...
  interactionKind?: 'interactive_prompt' | 'permission_request' | 'plan_approval' | null;
  runPhase?: 'planning' | 'awaiting_plan_approval' | 'executing' | 'completed' | 'aborted' | null;
};
```

```ts
const interactionKind =
  event.payload.kind === 'interactive_prompt'
    ? 'interactive_prompt'
    : event.payload.kind === 'plan_approval'
      ? 'plan_approval'
      : 'permission_request';
```

- [ ] **Step 4: 新增前端 `plan-mode.ts`，统一计划确认标题、按钮、说明文案**

```ts
export function buildPlanApprovalActions() {
  return [
    { id: 'accept-edits', label: '按计划继续并允许编辑', nextPermissionMode: 'acceptEdits' as const },
    { id: 'bypass', label: '按计划继续并允许所有', nextPermissionMode: 'bypassPermissions' as const },
    { id: 'revise', label: '留在计划模式继续调整', nextPermissionMode: null },
  ];
}
```

- [ ] **Step 5: 回归测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/lib/agent-v2/plan-mode.test.ts apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.test.ts
```

Expected:

```text
PASS  ...plan-mode.test.ts
PASS  ...run-cards.test.ts
```

## Task 5: 在聊天页接入计划确认交互并调整默认权限模式

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/useAgentV2Chat.ts`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定聊天页显示计划确认按钮并传递 `nextPermissionMode`**

```tsx
it('submits nextPermissionMode when the user accepts a generated plan', async () => {
  mockStreamState.resolveInteraction = vi.fn();
  mockStreamState.conversationItems = [
    runWithPlanApprovalCard({
      requestId: 'interaction-1',
      title: 'Claude 已完成计划，等待你确认后继续执行',
    }),
  ];

  const view = render(<Chat />);
  fireEvent.click(await view.findByRole('button', { name: '按计划继续并允许编辑' }));

  await waitFor(() => {
    expect(mockStreamState.resolveInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'interaction-1',
        decision: expect.objectContaining({
          allow: true,
          nextPermissionMode: 'acceptEdits',
        }),
      })
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx
```

Expected:

```text
FAIL  ...chat-selection-quote.interaction.test.tsx
Unable to find role "button" with name "按计划继续并允许编辑"
```

- [ ] **Step 3: 在聊天页接入计划确认卡动作，并将默认权限模式从 `bypassPermissions` 改为 `default`**

```ts
const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
```

```ts
const handleResolvePlanApproval = useCallback(
  async (requestId: string, nextPermissionMode: 'acceptEdits' | 'bypassPermissions' | null) => {
    await stream.resolveInteraction({
      runId: stream.runId,
      requestId,
      decision: nextPermissionMode
        ? { allow: true, nextPermissionMode }
        : { allow: false, message: '继续留在计划模式调整方案' },
    });
  },
  [stream]
);
```

- [ ] **Step 4: 调整 Composer 文案，明确 `plan` 是“研究/规划，不直接执行修改”，`bypassPermissions` 是高风险模式**

```ts
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: '默认',
  plan: '计划',
  acceptEdits: '允许编辑',
  bypassPermissions: '允许所有',
};
```

```ts
const PERMISSION_MODE_DESCRIPTIONS = {
  plan: '先研究并给出计划，默认不直接执行修改',
  bypassPermissions: '跳过大部分权限确认，仅适合明确授权场景',
};
```

- [ ] **Step 5: 回归测试并做一次前端关键链路验证**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.test.tsx
```

Expected:

```text
PASS  ...chat-selection-quote.interaction.test.tsx
PASS  ...AgentComposer.test.tsx
```

## Task 6: 全链路回归与手工验收

**Files:**
- Modify: `apps/agent-backend-v2/src/agent/application/run-stream.test.ts`
- Modify: `apps/extension/entrypoints/sidepanel/routes/chat.active-run-restore.test.tsx`

- [ ] **Step 1: 补一条后端回归测试，确认 plan 模式下自定义 interaction policy 仍优先于权限模式**

```ts
test('interaction policy still blocks forbidden browser fallback after plan approval mode changes', async () => {
  // 先进入 plan，再模拟继续执行，最后验证外部浏览器仍被 interaction policy 拦截
});
```

- [ ] **Step 2: 运行后端测试**

Run:

```bash
pnpm --filter @mcp-b/agent-backend-v2 test -- --test-name-pattern='plan|permission|bypass|interaction policy'
```

Expected:

```text
PASS  ...agent-service.test.ts
PASS  ...run-stream.test.ts
PASS  ...plan-mode.test.ts
```

- [ ] **Step 3: 运行前端测试**

Run:

```bash
pnpm --filter @mcp-b/extension test --run apps/extension/entrypoints/sidepanel/lib/agent-v2/run-cards.test.ts apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx apps/extension/entrypoints/sidepanel/components/agent-composer/AgentComposer.test.tsx
```

Expected:

```text
PASS  ...run-cards.test.ts
PASS  ...chat-selection-quote.interaction.test.tsx
PASS  ...AgentComposer.test.tsx
```

- [ ] **Step 4: 本地手工验收**

Run:

```bash
pnpm dev:agent-v2
pnpm dev:extension
```

Expected:

```text
1. 选择“计划”模式发起“先分析再改代码”请求时，只读工具直接运行
2. 计划产出后，UI 出现独立的“按计划继续执行”确认卡
3. 选择“按计划继续并允许编辑”后，后续写工具走 acceptEdits 语义
4. 选择“按计划继续并允许所有”后，后续写工具不再逐个确认
5. 即使已经继续执行，interaction policy 仍然阻止不允许的外部浏览器路径
```

## 自检结论

- 已覆盖的核心要求：
  - `bypassPermissions` 与 SDK 契约对齐
  - `plan` 模式下只读/写入分流
  - `plan_approval` 作为独立交互类型
  - 计划确认后切换执行权限模式
  - 前后端类型、事件和 UI 联动
  - interaction policy 独立生效
- 当前刻意不做的范围：
  - 不实现“clear context and continue”完整上下文重建
  - 不改动现有 SDK 事件翻译主链路之外的大规模架构
  - 不引入新的持久化会话状态表
