# Sidepanel Bootstrap Sync Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让扩展在点击图标后立即打开 sidepanel，并用启动门禁页拦截主界面，直到远端 ACCR 同步与模型配置检查完成。

**Architecture:** 保持 background 点击链路轻量，只负责现有 sidepanel 打开与 companion ready。把“远端同步 + 模型配置检查”的启动编排下沉到 sidepanel 根层，在 `__root.tsx` 上方挂一个统一 bootstrap gate。模型检查优先复用现有 `agent-v2 client` 与 `model-access-state`，避免再在设置页和聊天页各自维护一套分叉逻辑。

**Tech Stack:** WXT、React、TanStack Router、Vitest、Testing Library、现有 Agent V2 HTTP client

---

## 文件结构

- 修改 `apps/extension/entrypoints/background/index.ts`
  - 去掉 action click 时对 ACCR 同步的硬等待，保留 companion ready 与 page edit 切换。
- 修改 `apps/extension/entrypoints/background/index.test.ts`
  - 更新 background 点击测试，验证“不再在点击链路等待同步”。
- 新建 `apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.ts`
  - 启动门禁状态机、远端同步请求、模型检查编排、重试入口。
- 新建 `apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts`
  - 覆盖并行执行、失败态、阻塞态、重试逻辑。
- 新建 `apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.ts`
  - 从设置页抽出“读取运行时模型配置并自动探测来源可用性”的可复用逻辑。
- 新建 `apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts`
  - 覆盖 CLI 不可用、项目配置缺失、双源探测、错误回退。
- 修改 `apps/extension/entrypoints/sidepanel/routes/settings.tsx`
  - 改用新抽出的模型探测 helper，避免门禁层与设置页复制逻辑。
- 修改 `apps/extension/entrypoints/sidepanel/routes/__root.tsx`
  - 接入 bootstrap gate，在根路由渲染全屏门禁态、失败态、去设置按钮。
- 修改 `apps/extension/entrypoints/sidepanel/routes/__root.test.tsx`
  - 增加门禁态渲染与解锁后的路由渲染测试。

### Task 1: 精简 background 点击链路

**Files:**
- Modify: `apps/extension/entrypoints/background/index.ts`
- Modify: `apps/extension/entrypoints/background/index.test.ts`

- [ ] **Step 1: 先写失败测试，表达“点击图标不再等待同步完成”**

```ts
it('点击扩展图标时不会等待 ACCR 同步完成后才继续 companion ready 流程', async () => {
  let releaseSync: (() => void) | null = null;
  syncOnActionClick.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseSync = () =>
          resolve({
            ok: true,
            status: 'completed',
          });
      })
  );
  ensureCompanionReady.mockResolvedValue(undefined);

  const module = await import('./index');
  module.default.main();

  const clickHandler = addActionClickListener.mock.calls[0]?.[0];
  const clickPromise = clickHandler?.();

  expect(syncOnActionClick).not.toHaveBeenCalled();
  expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
  expect(pageEditService.toggleForActiveTab).toHaveBeenCalledTimes(1);

  releaseSync?.();
  await clickPromise;
});
```

- [ ] **Step 2: 跑测试确认当前实现失败**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/background/index.test.ts
```

Expected: 失败，原因是当前 `chrome.action.onClicked` 会先 `await actionClickSyncService.syncOnActionClick()`。

- [ ] **Step 3: 最小实现，移除点击时的同步阻塞**

```ts
chrome.action?.onClicked?.addListener(async () => {
  const ensureTask = ensureCompanionReady().catch((error) => {
    console.warn('[native] Failed to ensure companion readiness on action click:', error);
  });

  void pageEditService.toggleForActiveTab();
  await ensureTask;
});
```

如果 `createActionClickSyncService` 与 `ACTION_CLICK_SYNC_TIMEOUT_MS` 已经完全无用，同一任务里一起删除对应 import、常量与初始化代码。

- [ ] **Step 4: 更新旧测试断言**

```ts
it('点击扩展图标时不再请求 /api/accr-sync/run', async () => {
  ensureCompanionReady.mockResolvedValue(undefined);

  const module = await import('./index');
  module.default.main();

  const clickHandler = addActionClickListener.mock.calls[0]?.[0];
  await clickHandler?.();

  expect(fetchMock).not.toHaveBeenCalled();
  expect(syncOnActionClick).not.toHaveBeenCalled();
  expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: 运行 background 相关测试**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/background/index.test.ts apps/extension/entrypoints/background/src/services/action-click-sync.test.ts
```

Expected: `index.test.ts` 通过；如果 `action-click-sync.ts` 已删除，则同步删除对应 test，并改成只跑 `index.test.ts`。

- [ ] **Step 6: 提交当前小步**

```bash
git add apps/extension/entrypoints/background/index.ts apps/extension/entrypoints/background/index.test.ts
git commit -m "refactor: remove blocking sync from action click flow"
```

### Task 2: 抽出可复用的模型启动探测逻辑

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.ts`
- Create: `apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts`
- Modify: `apps/extension/entrypoints/sidepanel/routes/settings.tsx`

- [ ] **Step 1: 先写 helper 的失败测试，固化启动探测 contract**

```ts
it('当 Claude CLI 可用且项目模型已配置时，会并行探测两个来源并汇总 view state', async () => {
  const client = {
    getModelConfig: vi.fn().mockResolvedValue({
      config: {
        modelProvider: 'openai',
        openaiApiKey: 'sk-test',
      },
      runtime: {
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        selectedAuthSource: 'project_model_config',
      },
      userClaudeSettings: null,
    }),
    testModelConfig: vi
      .fn()
      .mockResolvedValueOnce({ result: { ok: true, message: 'user ok' } })
      .mockResolvedValueOnce({ result: { ok: true, message: 'project ok' } }),
  };

  const result = await loadBootstrapModelAccess(client as never);

  expect(client.testModelConfig).toHaveBeenCalledTimes(2);
  expect(result.viewState.overallStatus).toBe('available');
  expect(result.userClaudeSettingsTestResult?.ok).toBe(true);
  expect(result.projectModelConfigTestResult?.ok).toBe(true);
});
```

- [ ] **Step 2: 跑 helper 测试，确认失败**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts
```

Expected: 失败，因为 `loadBootstrapModelAccess` 还不存在。

- [ ] **Step 3: 编写最小 helper，实现获取配置、探测来源、汇总状态**

```ts
export async function loadBootstrapModelAccess(
  client: Pick<ReturnType<typeof createAgentV2Client>, 'getModelConfig' | 'testModelConfig'>
): Promise<BootstrapModelAccessResult> {
  const payload = await client.getModelConfig();
  const localConfig = hydrateModelConfig(payload.config);
  const runtimeInfo = payload.runtime;
  let userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null = null;
  let projectModelConfigTestResult: AgentModelConfigAuthTestResult | null = null;

  const tasks: Promise<void>[] = [];

  if (runtimeInfo.claudeCliAvailable) {
    tasks.push(
      client
        .testModelConfig(normalizeModelConfigForSubmit(localConfig), {
          targetAuthSource: 'user_claude_settings',
        })
        .then((response) => {
          userClaudeSettingsTestResult = response.result;
        })
        .catch((error) => {
          userClaudeSettingsTestResult = buildUnavailableAuthTestResult({
            targetAuthSource: 'user_claude_settings',
            runtime: runtimeInfo,
            message: error instanceof Error ? error.message : '用户级来源自动测试失败',
          });
        })
    );
  }

  if (hasStoredProjectModelConfig(localConfig)) {
    tasks.push(
      client
        .testModelConfig(normalizeModelConfigForSubmit(localConfig), {
          targetAuthSource: 'project_model_config',
        })
        .then((response) => {
          projectModelConfigTestResult = response.result;
        })
        .catch((error) => {
          projectModelConfigTestResult = buildUnavailableAuthTestResult({
            targetAuthSource: 'project_model_config',
            runtime: runtimeInfo,
            message: error instanceof Error ? error.message : '项目模型配置自动测试失败',
          });
        })
    );
  }

  await Promise.allSettled(tasks);

  return {
    runtimeInfo,
    localConfig,
    userClaudeSettings: payload.userClaudeSettings,
    userClaudeSettingsTestResult,
    projectModelConfigTestResult,
    viewState: deriveModelAccessViewState({
      runtimeInfo,
      localConfig,
      userClaudeSettingsTestResult,
      projectModelConfigTestResult,
      isProbing: false,
    }),
  };
}
```

如果 `settings.tsx` 里的 `hydrateModelConfig`、`normalizeModelConfigForSubmit`、`hasStoredProjectModelConfig`、`buildUnavailableAuthTestResult` 仍为私有函数，则同任务内把它们迁到 `model-access-bootstrap.ts` 或新增 `model-access-helpers.ts` 并导出，随后在设置页复用。

- [ ] **Step 4: 把设置页切换到复用 helper 或 helpers**

```ts
import {
  buildUnavailableAuthTestResult,
  hasStoredProjectModelConfig,
  hydrateModelConfig,
  normalizeModelConfigForSubmit,
} from '../lib/model-access-bootstrap';
```

目标是让 `settings.tsx` 不再维护一套只存在于页面内部、门禁层无法复用的模型探测工具函数。

- [ ] **Step 5: 运行相关测试**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts apps/extension/entrypoints/sidepanel/lib/model-access-state.test.ts apps/extension/entrypoints/sidepanel/routes/settings.test.tsx
```

Expected: 全部通过；如果 `settings.test.tsx` 因导出位置变更失败，修正 import/mock 后再跑绿。

- [ ] **Step 6: 提交当前小步**

```bash
git add apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.ts apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts apps/extension/entrypoints/sidepanel/routes/settings.tsx
git commit -m "refactor: extract reusable model access bootstrap helpers"
```

### Task 3: 实现 sidepanel 启动门禁状态机

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.ts`
- Create: `apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/config.ts`

- [ ] **Step 1: 先写状态机失败测试**

```ts
it('并行执行远端同步和模型检查，并在二者成功后进入 ready', async () => {
  const syncRemote = vi.fn().mockResolvedValue({
    ok: true,
    status: 'completed',
    mode: 'remote',
  });
  const loadModelAccess = vi.fn().mockResolvedValue({
    viewState: { overallStatus: 'available', summary: '当前模型可用。' },
  });

  const gate = createBootstrapGate({ syncRemote, loadModelAccess });
  const result = await gate.run();

  expect(syncRemote).toHaveBeenCalledTimes(1);
  expect(loadModelAccess).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('ready');
});
```

- [ ] **Step 2: 再加两个失败分支测试**

```ts
it('同步失败时进入 sync_failed 并暴露错误信息', async () => {
  const gate = createBootstrapGate({
    syncRemote: vi.fn().mockResolvedValue({
      ok: false,
      status: 'failed',
      error: 'sync failed',
    }),
    loadModelAccess: vi.fn().mockResolvedValue({
      viewState: { overallStatus: 'available', summary: 'ok' },
    }),
  });

  await expect(gate.run()).resolves.toMatchObject({
    status: 'sync_failed',
    sync: { error: 'sync failed' },
  });
});

it('模型不可用时进入 blocked，并要求跳转设置页', async () => {
  const gate = createBootstrapGate({
    syncRemote: vi.fn().mockResolvedValue({
      ok: true,
      status: 'completed',
      mode: 'remote',
    }),
    loadModelAccess: vi.fn().mockResolvedValue({
      viewState: { overallStatus: 'needs_config', summary: '当前需先补齐模型配置。' },
    }),
  });

  await expect(gate.run()).resolves.toMatchObject({
    status: 'blocked',
    blockedReason: 'model_config',
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts
```

Expected: 失败，因为 `createBootstrapGate` 尚未实现。

- [ ] **Step 4: 最小实现 bootstrap gate**

```ts
export type BootstrapGateStatus = 'running' | 'ready' | 'sync_failed' | 'blocked';

export function createBootstrapGate(input: {
  syncRemote: () => Promise<ActionClickSyncResult>;
  loadModelAccess: () => Promise<BootstrapModelAccessResult>;
}) {
  async function run(): Promise<BootstrapGateResult> {
    const [syncResult, modelResult] = await Promise.all([
      input.syncRemote(),
      input.loadModelAccess(),
    ]);

    if (!syncResult.ok) {
      return {
        status: 'sync_failed',
        sync: syncResult,
        modelAccess: modelResult,
      };
    }

    if (
      modelResult.viewState.overallStatus === 'needs_config' ||
      modelResult.viewState.overallStatus === 'unavailable'
    ) {
      return {
        status: 'blocked',
        blockedReason: 'model_config',
        sync: syncResult,
        modelAccess: modelResult,
      };
    }

    return {
      status: 'ready',
      sync: syncResult,
      modelAccess: modelResult,
    };
  }

  return {
    run,
    retry: run,
  };
}
```

远端同步函数请直接对接：

```ts
await fetch('http://127.0.0.1:8792/api/accr-sync/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    mode: 'remote',
    force: true,
    trigger: 'extension-action-click',
  }),
});
```

如需避免硬编码，给 `config.ts` 新增：

```ts
accrSyncUrl: z.string().url('ACCR sync URL must be a valid URL')
```

默认值可设为 `http://127.0.0.1:8792/api/accr-sync/run`。

- [ ] **Step 5: 增加重试测试并跑绿**

```ts
it('retry 会重新触发同步与模型检查', async () => {
  const syncRemote = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 'failed', error: 'boom' })
    .mockResolvedValueOnce({ ok: true, status: 'completed', mode: 'remote' });
  const loadModelAccess = vi.fn().mockResolvedValue({
    viewState: { overallStatus: 'available', summary: 'ok' },
  });

  const gate = createBootstrapGate({ syncRemote, loadModelAccess });
  await gate.run();
  const retried = await gate.retry();

  expect(syncRemote).toHaveBeenCalledTimes(2);
  expect(loadModelAccess).toHaveBeenCalledTimes(2);
  expect(retried.status).toBe('ready');
});
```

Run:

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts
```

Expected: 全绿。

- [ ] **Step 6: 提交当前小步**

```bash
git add apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.ts apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts apps/extension/entrypoints/sidepanel/lib/config.ts
git commit -m "feat: add sidepanel bootstrap gate state machine"
```

### Task 4: 在根路由挂载门禁 UI

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/routes/__root.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/routes/__root.test.tsx`

- [ ] **Step 1: 先写根路由失败测试**

```tsx
it('bootstrap gate 运行中时显示全屏同步门禁文案', () => {
  mockUseBootstrapGateState.mockReturnValue({
    status: 'running',
    syncLabel: '技能同步中',
    modelLabel: '模型配置检查中',
  });

  const { getByText, queryByTestId } = render(<RootComponent />);

  expect(getByText('配置内容同步中...')).toBeTruthy();
  expect(getByText('技能同步中')).toBeTruthy();
  expect(getByText('模型配置检查中')).toBeTruthy();
  expect(queryByTestId('mock-outlet')).toBeNull();
});
```

- [ ] **Step 2: 添加阻塞态与解锁态测试**

```tsx
it('模型配置不可用时显示去模型设置按钮', () => {
  mockUseBootstrapGateState.mockReturnValue({
    status: 'blocked',
    summary: '当前需先补齐模型配置。',
    retry: vi.fn(),
  });

  const { getByRole, getByText } = render(<RootComponent />);

  expect(getByText('当前需先补齐模型配置。')).toBeTruthy();
  expect(getByRole('button', { name: '去模型设置' })).toBeTruthy();
});

it('bootstrap gate ready 后渲染真实路由内容', () => {
  mockUseBootstrapGateState.mockReturnValue({ status: 'ready' });

  const { getByTestId, queryByText } = render(<RootComponent />);

  expect(getByTestId('mock-outlet')).toBeTruthy();
  expect(queryByText('配置内容同步中...')).toBeNull();
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/routes/__root.test.tsx
```

Expected: 失败，因为根路由还没有门禁层。

- [ ] **Step 4: 在根路由实现门禁 UI 与跳转**

```tsx
export function RootComponent() {
  const navigate = useNavigate();
  const gate = useBootstrapGateState();

  if (gate.status !== 'ready') {
    return (
      <>
        <div className="flex h-screen items-center justify-center bg-background px-6">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold">配置内容同步中...</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              正在同步远端技能与检查模型配置
            </p>
            <div className="mt-6 space-y-3">
              <div>{gate.syncLabel}</div>
              <div>{gate.modelLabel}</div>
            </div>
            {gate.status === 'sync_failed' ? (
              <Button onClick={() => void gate.retry()}>重试同步</Button>
            ) : null}
            {gate.status === 'blocked' ? (
              <Button
                onClick={() =>
                  void navigate({ to: '/settings', search: { mode: 'model' } as never })
                }
              >
                去模型设置
              </Button>
            ) : null}
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col h-screen">
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </>
  );
}
```

如果希望减少 `__root.tsx` 复杂度，同任务内新增 `components/bootstrap-gate/BootstrapGateScreen.tsx`，但不要额外扩散到多个组件层级。

- [ ] **Step 5: 跑根路由与交互相关测试**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/sidepanel/routes/__root.test.tsx apps/extension/entrypoints/sidepanel/routes/settings.test.tsx
```

Expected: 全绿。

- [ ] **Step 6: 提交当前小步**

```bash
git add apps/extension/entrypoints/sidepanel/routes/__root.tsx apps/extension/entrypoints/sidepanel/routes/__root.test.tsx
git commit -m "feat: gate sidepanel until sync and model checks finish"
```

### Task 5: 全量验证与收口

**Files:**
- Modify: `docs/superpowers/plans/2026-05-26-sidepanel-bootstrap-sync-gate.md`

- [ ] **Step 1: 运行 extension 相关测试集**

```bash
pnpm --filter @mcp-b/extension test -- apps/extension/entrypoints/background/index.test.ts apps/extension/entrypoints/sidepanel/lib/model-access-bootstrap.test.ts apps/extension/entrypoints/sidepanel/lib/bootstrap-gate.test.ts apps/extension/entrypoints/sidepanel/routes/__root.test.tsx apps/extension/entrypoints/sidepanel/routes/settings.test.tsx
```

Expected: 全部通过。

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter @mcp-b/extension compile
```

Expected: `TypeScript` 通过，无新的类型错误。

- [ ] **Step 3: 手工验证 sidepanel 启动门禁**

```bash
pnpm --filter @mcp-b/extension dev
pnpm --filter @mcp-b/agent-backend-v2 dev
```

手工检查：

```text
1. 点击扩展图标，sidepanel 立即打开，不再有点击无反馈。
2. 首屏看到“配置内容同步中...”门禁页。
3. 后端收到 POST /api/accr-sync/run，body 包含 {"mode":"remote","force":true,"trigger":"extension-action-click"}。
4. 同步成功且模型可用后，主界面自动解锁。
5. 人为让模型不可用时，门禁页保持拦截并可跳去模型设置。
6. 人为让同步失败时，门禁页显示失败原因并可重试。
```

- [ ] **Step 4: 回写计划勾选状态并记录实际偏差**

```md
- [x] Step N: ...
- [x] Step N+1: ...

实施备注：
- `action-click-sync.ts` 最终被删除 / 保留（按实际结果填写）
- `settings.tsx` 中哪些 helper 被抽出（按实际结果填写）
```

- [ ] **Step 5: 提交最终验证收口**

```bash
git add docs/superpowers/plans/2026-05-26-sidepanel-bootstrap-sync-gate.md
git commit -m "docs: record sidepanel bootstrap gate implementation progress"
```

## Self-Review

- Spec coverage:
  - `sidepanel 秒开`：Task 1
  - `sidepanel 门禁页拦截`：Task 3、Task 4
  - `远端同步 + 模型配置检查并行`：Task 2、Task 3
  - `force: true`：Task 3
  - `同步失败可重试`：Task 3、Task 4
  - `模型不可用继续拦截并跳设置`：Task 3、Task 4
  - `测试补齐`：Task 1-5
- Placeholder scan: 已去掉 `TODO/TBD` 类占位。
- Type consistency:
  - 门禁状态统一使用 `running | ready | sync_failed | blocked`
  - 模型阻塞原因统一走 `blockedReason: 'model_config'`
  - 同步请求固定带 `mode: 'remote'`、`force: true`、`trigger: 'extension-action-click'`
