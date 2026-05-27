import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentService } from './agent-service.ts';
import { continueSessionRun } from './continue-session-run.ts';
import { startSessionRun } from './start-session-run.ts';

function createControlledQueryRun() {
  const values: Record<string, unknown>[] = [];
  const waiters: Array<(result: IteratorResult<Record<string, unknown>>) => void> = [];
  let finished = false;

  function resolveNext(result: IteratorResult<Record<string, unknown>>) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(result);
      return true;
    }
    return false;
  }

  async function next(): Promise<IteratorResult<Record<string, unknown>>> {
    const value = values.shift();
    if (value) {
      return { value, done: false };
    }
    if (finished) {
      return { value: undefined, done: true };
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  async function* iterator() {
    while (true) {
      const item = await next();
      if (item.done) {
        return;
      }
      yield item.value;
    }
  }

  return {
    run: Object.assign(iterator(), {
      async interrupt() {
        finished = true;
        while (resolveNext({ value: undefined, done: true })) {
          // Drain waiters.
        }
      },
    }),
    push(value: Record<string, unknown>) {
      if (!resolveNext({ value, done: false })) {
        values.push(value);
      }
    },
    finish() {
      finished = true;
      while (resolveNext({ value: undefined, done: true })) {
        // Drain waiters.
      }
    },
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('getSessionHistory delegates to normalized Claude history', async () => {
  const service = createAgentService({
    historyReader: {
      async readSessionHistory(sessionId: string) {
        return [
          {
            id: 'msg-1',
            sessionId,
            role: 'assistant',
            kind: 'text',
            text: 'hi',
            timestamp: 'now',
          },
        ];
      },
    },
    runtime: { abortRun: async () => ({ aborted: false, reason: 'not_active' }) },
  });

  const history = await service.getSessionHistory({ sessionId: 'session-1' });
  assert.equal(history.messages[0]?.text, 'hi');
});

test('abortRun delegates to runtime and returns idempotent not_active result', async () => {
  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: { abortRun: async () => ({ aborted: false, reason: 'not_active' }) },
  });

  assert.deepEqual(await service.abortRun({ runId: 'run-1' }), {
    aborted: false,
    reason: 'not_active',
  });
});

test('agent service sends image attachments as SDK user message content blocks', async () => {
  const queryInputs: Array<{ prompt: unknown }> = [];
  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'describe image',
    images: [{ mimeType: 'image/png', data: 'abc123' }],
  });
  for await (const _event of stream) {
    // Drain stream.
  }

  const prompt = queryInputs[0]?.prompt;
  assert.equal(typeof prompt, 'object');
  assert.equal(Symbol.asyncIterator in (prompt as AsyncIterable<unknown>), true);
  const messages = [];
  for await (const message of prompt as AsyncIterable<Record<string, any>>) {
    messages.push(message);
  }
  assert.equal(messages[0].message.content[0].type, 'text');
  assert.match(messages[0].message.content[0].text, /请始终使用中文/);
  assert.match(messages[0].message.content[0].text, /describe image/);
  assert.deepEqual(messages[0].message.content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
  });
});

test('agent service reads mcp servers for the current project path', async () => {
  const calls: Array<{ projectPath?: string }> = [];
  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    mcpServersProvider: {
      async listServers(input) {
        calls.push({ projectPath: input?.projectPath });
        return {};
      },
    },
    runtime: {
      query() {
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project-a',
  });
  for await (const _event of stream) {
    // Drain stream.
  }

  assert.deepEqual(calls, [{ projectPath: '/tmp/project-a' }]);
});

test('agent service includes selected-tabs browser context metadata in the built prompt', async () => {
  const queryInputs: Array<{ prompt: unknown }> = [];
  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '总结这些页面',
    browserContext: {
      source: 'selected-tabs',
      tabId: 12,
      windowId: 5,
      title: 'Primary',
      url: 'https://primary.example.com',
      primaryTabId: 12,
      allowedTabIds: [11, 12],
      selectedTabs: [
        {
          tabId: 11,
          windowId: 5,
          title: 'Docs',
          url: 'https://docs.example.com',
          content: 'docs content',
        },
        {
          tabId: 12,
          windowId: 5,
          title: 'Primary',
          url: 'https://primary.example.com',
          captureError: 'capture failed',
        },
      ],
    },
  });
  for await (const _event of stream) {
    // Drain stream.
  }

  const prompt = String(queryInputs[0]?.prompt ?? '');
  assert.match(prompt, /allowedTabIds: \[11, 12\]/);
  assert.match(prompt, /primaryTabId: 12/);
  assert.match(prompt, /selectedTabs:/);
  assert.match(prompt, /tabId: 11/);
  assert.match(prompt, /title: Docs/);
  assert.match(prompt, /url: https:\/\/docs\.example\.com/);
  assert.match(prompt, /content: docs content/);
  assert.match(prompt, /captureError: capture failed/);
});

test('startSessionRun creates a run id and starts without an existing session', async () => {
  const stream = await startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project',
    executeRun(options) {
      assert.match(options.runId, /^run_/);
      assert.equal(options.sessionId, null);
      assert.equal(options.prompt, 'hello');
      assert.equal(options.projectPath, '/tmp/project');
      return Object.assign((async function* () {})(), {
        runId: options.runId,
        sessionId: options.sessionId,
      });
    },
  });

  assert.match(stream.runId, /^run_/);
  assert.equal(stream.sessionId, null);
});

test('continueSessionRun creates a run id and continues an existing session', async () => {
  const stream = await continueSessionRun({
    sessionId: 'session-1',
    prompt: 'continue',
    executeRun(options) {
      assert.match(options.runId, /^run_/);
      assert.equal(options.sessionId, 'session-1');
      assert.equal(options.prompt, 'continue');
      return Object.assign((async function* () {})(), {
        runId: options.runId,
        sessionId: options.sessionId,
      });
    },
  });

  assert.match(stream.runId, /^run_/);
  assert.equal(stream.sessionId, 'session-1');
});

test('agent service applies interaction policy before prompting for active web page tools', async () => {
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '帮我查看当前网页内容',
    browserContext: {
      tabId: 12,
      windowId: 5,
      url: 'https://example.com/',
    },
    permissionMode: 'bypassPermissions',
  });

  assert.equal(typeof capturedCanUseTool, 'function');
  const decision = await capturedCanUseTool!(
    'mcp__playwright__browser_navigate',
    {},
    { toolUseID: 'toolu-1' }
  );

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message || ''), /始终禁止外部浏览器自动化/);

  for await (const _event of stream) {
    // Drain stream.
  }
});

test('agent service treats plugin playwright snapshot as external browser for active web pages', async () => {
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '帮我查看当前网页内容',
    browserContext: {
      tabId: 12,
      windowId: 5,
      url: 'https://example.com/',
    },
    permissionMode: 'bypassPermissions',
  });

  assert.equal(typeof capturedCanUseTool, 'function');
  const decision = await capturedCanUseTool!(
    'mcp__plugin_playwright_playwright__browser_snapshot',
    {},
    { toolUseID: 'toolu-plugin-playwright-1' }
  );

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message || ''), /始终禁止外部浏览器自动化/);

  for await (const _event of stream) {
    // Drain stream.
  }
});

test('agent service blocks browser extension operate tools when browser context mismatches', async () => {
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '帮我点击当前网页按钮',
    browserContext: {
      tabId: 12,
      windowId: 5,
      url: 'https://example.com/',
    },
    permissionMode: 'bypassPermissions',
  });

  assert.equal(typeof capturedCanUseTool, 'function');
  const decision = await capturedCanUseTool!(
    'mcp__browser_extension__click',
    { tabId: 99, windowId: 5 },
    { toolUseID: 'toolu-2' }
  );

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message || ''), /browser_context 与工具输入不一致/);
  assert.match(String(decision.message || ''), /当前标签页上下文不一致/);

  for await (const _event of stream) {
    // Drain stream.
  }
});

test('agent service blocks browser extension read tools without bound browser context on active web pages', async () => {
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '帮我读取当前网页正文',
    browserContext: {
      tabId: 12,
      windowId: 5,
      url: 'https://example.com/',
    },
    permissionMode: 'bypassPermissions',
  });

  assert.equal(typeof capturedCanUseTool, 'function');
  const decision = await capturedCanUseTool!(
    'mcp__browser_extension__read_current_page_content',
    {},
    { toolUseID: 'toolu-read-missing-context' }
  );

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message || ''), /当前标签页上下文字段无效/);

  for await (const _event of stream) {
    // Drain stream.
  }
});

test('agent service unlocks active web page fallback after browser extension read error', async () => {
  const controlledRun = createControlledQueryRun();
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    env: {
      enableLiveWritePreviewDiagnostics: false,
    } as never,
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return controlledRun.run;
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '帮我查看当前网页内容',
    browserContext: {
      tabId: 12,
      windowId: 5,
      url: 'https://example.com/',
    },
    permissionMode: 'bypassPermissions',
  });

  const consumeStream = (async () => {
    for await (const _event of stream) {
      // Drain stream so tool outcomes update policy state.
    }
  })();

  assert.equal(typeof capturedCanUseTool, 'function');
  const firstDecision = await capturedCanUseTool!(
    'mcp__playwright__browser_navigate',
    {},
    { toolUseID: 'toolu-before-error' }
  );
  assert.equal(firstDecision.behavior, 'block');

  controlledRun.push({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu-extension-read',
        name: 'mcp__browser_extension__read_current_page_content',
      },
    },
  });
  controlledRun.push({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu-extension-read',
          is_error: true,
          content: [{ type: 'text', text: 'content unavailable' }],
        },
      ],
    },
  });

  await flushAsyncWork();

  const secondDecision = await capturedCanUseTool!(
    'mcp__playwright__browser_navigate',
    {},
    { toolUseID: 'toolu-after-error' }
  );
  assert.equal(secondDecision.behavior, 'block');
  assert.match(String(secondDecision.message || ''), /始终禁止外部浏览器自动化/);

  controlledRun.push({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
  });
  controlledRun.finish();
  await consumeStream;
});

test('agent service exposes project and session run state from streamed session events', async () => {
  const controlledRun = createControlledQueryRun();
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query() {
        return controlledRun.run;
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project-a',
  });
  const consumeStream = (async () => {
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  })();

  controlledRun.push({
    type: 'stream_event',
    session_id: 'claude-session-1',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
      },
    },
  });
  await flushAsyncWork();

  const activeState = await service.getSessionRunState({ sessionId: 'claude-session-1' });
  assert.ok(activeState);
  assert.equal(activeState.status, 'streaming');
  assert.equal(activeState.projectPath, '/tmp/project-a');

  controlledRun.push({
    type: 'stream_event',
    session_id: 'claude-session-1',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: '正在生成摘要',
      },
    },
  });
  await flushAsyncWork();

  const projectRuns = await service.listProjectSessionRuns({
    projectPath: '/tmp/project-a',
  });
  assert.deepEqual(projectRuns.sessions.map((item) => item.sessionId), ['claude-session-1']);
  assert.equal(projectRuns.sessions[0]?.latestPreviewText, '正在生成摘要');
  assert.equal(projectRuns.sessions[0]?.status, 'streaming');

  controlledRun.push({
    type: 'result',
    session_id: 'claude-session-1',
    subtype: 'success',
    is_error: false,
    result: 'done',
  });
  controlledRun.finish();

  await consumeStream;

  const completedState = await service.getSessionRunState({ sessionId: 'claude-session-1' });
  assert.ok(completedState);
  assert.equal(completedState.status, 'completed');
  assert.equal(completedState.hasActiveStream, false);
});

test('session.bound 后的手工交互事件会继承真实 sessionId 并刷新 run state', async () => {
  const controlledRun = createControlledQueryRun();
  let capturedCanUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
        context?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>)
    | undefined;

  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        capturedCanUseTool = (
          input.options as { canUseTool?: typeof capturedCanUseTool } | undefined
        )?.canUseTool;
        return controlledRun.run;
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project-interaction',
  });

  const events: Array<Record<string, unknown>> = [];
  const consumeStream = (async () => {
    for await (const event of stream) {
      events.push(event as unknown as Record<string, unknown>);
    }
  })();

  controlledRun.push({
    type: 'stream_event',
    session_id: 'claude-session-1',
    event: {
      type: 'unknown',
    },
  });
  await flushAsyncWork();

  assert.equal(typeof capturedCanUseTool, 'function');
  const decisionPromise = capturedCanUseTool!(
    'AskUserQuestion',
    { question: '继续吗？' },
    { toolUseID: 'toolu-interaction-1', title: '需要确认' }
  );
  await flushAsyncWork();

  const requiredEvent = events.find((event) => event.type === 'interaction.required');
  assert.ok(requiredEvent);
  assert.equal(requiredEvent.sessionId, 'claude-session-1');

  const requiredRequestId = requiredEvent.payload as { requestId?: string };
  assert.equal(
    service.resolveInteraction({
      runId: stream.runId,
      requestId: String(requiredRequestId.requestId || ''),
      decision: { allow: true, message: '继续执行' },
    }).resolved,
    true
  );

  const decision = await decisionPromise;
  assert.equal(decision.behavior, 'allow');
  await flushAsyncWork();

  const resolvedEvent = events.find((event) => event.type === 'interaction.resolved');
  assert.ok(resolvedEvent);
  assert.equal(resolvedEvent.sessionId, 'claude-session-1');

  const runState = await service.getSessionRunState({ sessionId: 'claude-session-1' });
  assert.ok(runState);
  assert.equal(runState.latestSequence, Number(resolvedEvent.sequence));
  assert.equal(runState.status, 'streaming');

  controlledRun.push({
    type: 'result',
    session_id: 'claude-session-1',
    subtype: 'success',
    is_error: false,
    result: 'done',
  });
  controlledRun.finish();
  await consumeStream;
});

test('run.failed includes runtime auth summary for upstream authentication errors', async () => {
  const controlledRun = createControlledQueryRun();
  const service = createAgentService({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      claudeCodeExecutablePath: null,
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
    },
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'project_model_config',
        };
      },
    },
    runtime: {
      query() {
        return controlledRun.run;
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    modelConfigProvider: {
      async getConfig() {
        return {
          configMode: 'official' as const,
          modelProvider: 'anthropic' as const,
          anthropicModelName: 'glm-5.1',
          anthropicApiKey: 'sk-test',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project',
  });

  const consumeStream = (async () => {
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  })();

  controlledRun.push({
    type: 'result',
    subtype: 'error',
    is_error: true,
    error:
      'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
  });
  controlledRun.finish();

  const events = await consumeStream;
  const failedEvent = events.find((event) => event.type === 'run.failed');
  assert.ok(failedEvent);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /source=project_model_config/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /provider=anthropic/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /model=glm-5\.1/);
  assert.match(
    String(failedEvent.payload.runtimeAuthSummary || ''),
    /baseUrl=https:\/\/anapi-uat\.annto\.com\/api-sse-anthropic\/v1/
  );
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /apiKey=present/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /settingSources=project,local/);
  assert.match(String(failedEvent.payload.error || ''), /Failed to authenticate/);
  assert.match(String(failedEvent.payload.error || ''), /认证摘要/);
  assert.equal(failedEvent.payload.authGuidance, undefined);
});

test('project model config send path does not run auth probe before runtime query starts', async () => {
  let queryCalled = false;
  let testConfigCalls = 0;
  const service = createAgentService({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      claudeCodeExecutablePath: '/usr/local/bin/claude',
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
    },
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'project_model_config',
        };
      },
    },
    runtime: {
      query() {
        queryCalled = true;
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    modelConfigProvider: {
      async getConfig() {
        return {
          configMode: 'official' as const,
          modelProvider: 'anthropic' as const,
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-test',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
        };
      },
      async testConfig() {
        testConfigCalls += 1;
        return {
          ok: false as const,
          message:
            'Failed to authenticate. API Error: 401 {"error":{"message":"Authentication Error","type":"token_not_found_in_db","code":401}}',
          runtimeAuthSummary:
            '认证摘要 | source=project_model_config | provider=anthropic | model=qwen3.6-plus',
          runtime: {
            authSource: 'project_model_config' as const,
            selectedAuthSource: 'project_model_config' as const,
            available: true,
            claudeCliAvailable: true,
            hasProjectModelConfig: true,
            reason: '当前项目已选择项目模型配置，并检测到有效的项目模型认证信息。',
          },
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project',
  });

  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  assert.equal(testConfigCalls, 0);
  assert.equal(queryCalled, true);
  assert.deepEqual(events.map((event) => event.type), ['run.started']);
});

test('run.failed when first runtime event does not arrive before timeout', async () => {
  let interrupted = false;
  const controlledRun = Object.assign(
    (async function* () {
      await new Promise(() => {});
    })(),
    {
      async interrupt() {
        interrupted = true;
      },
    }
  );
  const service = createAgentService({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      claudeCodeExecutablePath: '/usr/local/bin/claude',
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
    },
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query() {
        return controlledRun;
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    firstEventTimeoutMs: 20,
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project',
  });

  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  assert.equal(interrupted, true);
  assert.deepEqual(
    events.map((event) => event.type),
    ['run.started', 'run.failed']
  );
  const failedEvent = events.find((event) => event.type === 'run.failed');
  assert.ok(failedEvent);
  assert.match(String(failedEvent.payload.error || ''), /首个响应超时|首个事件超时|超时/);
});

test('run.failed exposes auth guidance when Claude settings fallback has no local CLI or project key', async () => {
  const service = createAgentService({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: 'claude-sonnet-4-20250514',
      claudeCodeExecutablePath: null,
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
    },
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return { selectedAuthSource: 'user_claude_settings' };
      },
    },
    runtime: {
      query() {
        throw new Error('query should not run when selected auth source is unavailable');
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    modelConfigProvider: {
      async getConfig() {
        return {
          configMode: 'official' as const,
          modelProvider: 'anthropic' as const,
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '你好',
    projectPath: '/tmp/project',
  });

  const consumeStream = (async () => {
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  })();

  const events = await consumeStream;
  const failedEvent = events.find((event) => event.type === 'run.failed');
  assert.ok(failedEvent);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /source=user_claude_settings/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /apiKey=missing/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /settingSources=user,local/);
  assert.match(String(failedEvent.payload.error || ''), /未检测到可用的本机 Claude CLI/);
  assert.equal(
    failedEvent.payload.authGuidance,
    '当前未检测到本地 Claude Code，请联系管理员申请官方模型 Key，并在侧边栏“模型设置”中填写后重试。'
  );
});
