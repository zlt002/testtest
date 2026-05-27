import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAgentV2Route } from '../../routes/agent-v2.ts';
import { createAgentEvent } from '../domain/events.ts';
import { createAgentService } from './agent-service.ts';

test('run stream emits start and translated completion events', async () => {
  const events = [
    createAgentEvent({
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      type: 'run.started',
    }),
    createAgentEvent({
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 2,
      type: 'run.completed',
    }),
  ];

  async function* stream() {
    yield* events;
  }

  const collected = [];
  for await (const event of stream()) {
    collected.push(event.type);
  }

  assert.deepEqual(collected, ['run.started', 'run.completed']);
});

test('agent service starts a session run through runtime query stream', async () => {
  const completedRuns: string[] = [];
  const registeredRuns: string[] = [];
  const queryInputs: unknown[] = [];

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
    runtime: {
      query(input: unknown) {
        queryInputs.push(input);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun(runId: string) {
        registeredRuns.push(runId);
      },
      completeRun(runId: string) {
        completedRuns.push(runId);
      },
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    mcpServersProvider: {
      async listServers() {
        return {
          browser_extension: {
            type: 'http',
            url: 'http://127.0.0.1:12306/mcp',
          },
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project',
    browserContext: { tabId: 123 },
  });
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['run.started', 'run.completed']
  );
  assert.equal(events[0].runId, stream.runId);
  assert.equal(events[0].sessionId, null);
  assert.deepEqual(registeredRuns, [stream.runId]);
  assert.deepEqual(completedRuns, [stream.runId]);
  assert.equal(queryInputs.length, 1);
  const queryInput = queryInputs[0] as {
    prompt: string;
    options: {
      allowedTools?: string[];
      mcpServers: Record<string, unknown>;
      settingSources?: string[];
      skills?: string[] | 'all';
    };
  };
  assert.match(queryInput.prompt, /请始终使用中文/);
  assert.match(queryInput.prompt, /当前项目根目录：\/tmp\/project/);
  assert.match(queryInput.prompt, /默认所有新建或导出的文档、Markdown、代码和配置文件都必须写入当前项目根目录内/);
  assert.match(queryInput.prompt, /优先使用结构化写文件\/改文件工具/);
  assert.match(queryInput.prompt, /不要优先使用 Bash 的 cat、echo、printf、tee、heredoc 或重定向来直接写入文件内容/);
  assert.match(queryInput.prompt, /不要默认写到桌面、下载目录、用户主目录或任何项目外的绝对路径/);
  assert.match(queryInput.prompt, /用户原始请求/);
  assert.match(queryInput.prompt, /hello/);
  assert.match(queryInput.prompt, /<browser_context>/);
  assert.match(queryInput.prompt, /tabId: 123/);
  assert.deepEqual(queryInput.options.mcpServers.browser_extension, {
    type: 'http',
    url: 'http://127.0.0.1:12306/mcp',
  });
  assert.deepEqual(queryInput.options.allowedTools, [
    'mcp__browser_extension__read_current_page_content',
    'mcp__browser_extension__snapshot_locate_dom',
    'mcp__browser_extension__snapshot_find_css',
    'mcp__browser_extension__snapshot_patch_html',
    'mcp__browser_extension__snapshot_patch_css',
    'mcp__browser_extension__snapshot_patch_css_batch',
    'mcp__browser_extension__list_website_tools',
    'mcp__browser_extension__list_extension_tools',
    'mcp__browser_extension__call_website_tool',
    'mcp__browser_extension__call_extension_tool',
  ]);
  assert.deepEqual(queryInput.options.settingSources, ['project', 'local']);
  assert.equal(queryInput.options.skills, undefined);
});

test('agent service injects file-first interaction policy prompt for file urls', async () => {
  const queryInputs: Array<{ prompt: string }> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input: unknown) {
        queryInputs.push(input as { prompt: string });
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请分析当前 index.html 的源码结构',
    browserContext: {
      url: 'file:///Users/zhanglt21/Desktop/gjwl/index.html',
      tabId: 12,
      windowId: 3,
    },
  });
  for await (const _event of stream) {
    // drain
  }

  assert.match(queryInputs[0]?.prompt || '', /<interaction_policy>/);
  assert.match(queryInputs[0]?.prompt || '', /file:\/\/ 本地页面/);
  assert.match(queryInputs[0]?.prompt || '', /第一跳优先直接读取对应本地文件/);
  assert.match(queryInputs[0]?.prompt || '', /snapshot_locate_dom/);
});

test('interaction policy still blocks wrong first hop when bypassPermissions is enabled', async () => {
  const toolDecisions: Array<Record<string, unknown>> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input: unknown) {
        const canUseTool = (input as { options: { canUseTool: Function } }).options.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            toolDecisions.push(
              await canUseTool(
                'mcp__browser_extension__read_current_page_content',
                {},
                { toolUseID: 'toolu-file-1' }
              )
            );
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请直接总结当前 file 页面内容',
    browserContext: {
      url: 'file:///Users/zhanglt21/Desktop/gjwl/index.html',
      tabId: 12,
      windowId: 3,
    },
    permissionMode: 'bypassPermissions',
  });
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  const finalEvent = events.at(-1);
  const policyAudit = Array.isArray(finalEvent?.payload.policyAudit)
    ? (finalEvent.payload.policyAudit as Array<Record<string, unknown>>)
    : [];

  assert.equal(toolDecisions[0]?.behavior, 'deny');
  assert.match(String(toolDecisions[0]?.message || ''), /file:\/\/ 页面默认先读文件/);
  assert.deepEqual(policyAudit, [
    {
      runId: stream.runId,
      type: 'wrong_primary_tool_attempted',
      resourceKind: 'local_file_url',
      toolName: 'mcp__browser_extension__read_current_page_content',
      detail: 'file:// 页面默认先读文件，再决定是否降级到页面读取或截图。',
      timestamp: policyAudit[0]?.timestamp,
    },
  ]);
  assert.equal(typeof policyAudit[0]?.timestamp, 'string');
});

test('interaction policy still blocks external browser fallback after extension read failure', async () => {
  const toolDecisions: Array<Record<string, unknown>> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input: unknown) {
        const canUseTool = (input as { options: { canUseTool: Function } }).options.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            toolDecisions.push(
              await canUseTool(
                'mcp__browser_extension__read_current_page_content',
                { tabId: 88, windowId: 6 },
                { toolUseID: 'toolu-read-1' }
              )
            );
            yield {
              type: 'user',
              message: {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: 'toolu-read-1',
                    content: 'permission denied',
                    is_error: true,
                  },
                ],
              },
            };
            toolDecisions.push(
              await canUseTool(
                'mcp__playwright__browser_navigate',
                {},
                { toolUseID: 'toolu-nav-1' }
              )
            );
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请分析当前 qq 页面内容',
    browserContext: {
      url: 'https://www.qq.com/',
      tabId: 88,
      windowId: 6,
    },
    permissionMode: 'bypassPermissions',
  });
  for await (const _event of stream) {
    // drain
  }

  assert.equal(toolDecisions[0]?.behavior, 'allow');
  assert.equal(toolDecisions[1]?.behavior, 'deny');
  assert.match(String(toolDecisions[1]?.message || ''), /始终禁止外部浏览器自动化/);
});

test('agent service applies configured MCP tool permissions to SDK options', async () => {
  const queryInputs: unknown[] = [];
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
    runtime: {
      query(input) {
        queryInputs.push(input);
        return {
          async interrupt() {},
          async *[Symbol.asyncIterator]() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    mcpServersProvider: {
      async listServers() {
        return {
          browser_extension: {
            type: 'http',
            url: 'http://127.0.0.1:12306/mcp',
          },
        };
      },
    },
    toolPermissionsProvider: {
      async getToolPermissions() {
        return {
          allowedTools: ['mcp__browser_extension__read_current_page_content'],
          disallowedTools: ['mcp__browser_extension__call_extension_tool'],
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project',
  });
  for await (const _event of stream) {
    // drain
  }

  const queryInput = queryInputs[0] as {
    options: {
      allowedTools?: string[];
      disallowedTools?: string[];
      settingSources?: string[];
      skills?: string[] | 'all';
    };
  };
  assert.deepEqual(queryInput.options.allowedTools, [
    'mcp__browser_extension__read_current_page_content',
  ]);
  assert.deepEqual(queryInput.options.disallowedTools, [
    'mcp__browser_extension__call_extension_tool',
  ]);
  assert.deepEqual(queryInput.options.settingSources, ['project', 'local']);
});

test('agent service does not apply default allowed tools when enabled managed plugins are injected', async () => {
  const queryInputs: unknown[] = [];
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
    runtime: {
      query(input) {
        queryInputs.push(input);
        return {
          async interrupt() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', subtype: 'success', is_error: false };
          },
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    mcpServersProvider: {
      async listServers() {
        return {
          browser_extension: {
            type: 'http',
            url: 'http://127.0.0.1:12306/mcp',
          },
        };
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'project_model_config',
          inheritUserMcpServers: false,
          allowExternalBrowserAutomation: false,
          allowedUserMcpServers: [],
          allowedPluginIds: ['legacy-plugin-id-that-should-be-ignored'],
          allowedToolPrefixes: ['legacy_tool_prefix_that_should_be_ignored'],
        };
      },
    },
    managedPluginProvider: {
      async listManagedPlugins() {
        return [
          {
            id: 'playwright@claude-plugins-official',
            name: 'playwright',
            version: '1.0.0',
            path: '/Users/demo/.claude/plugins/playwright',
            enabled: true,
            type: 'local',
            local: true,
            sdkResolved: true,
            source: {
              kind: 'cli',
              path: '/Users/demo/.claude/settings.json',
              writable: true,
              removable: false,
            },
          },
          {
            id: 'disabled-plugin@claude-plugins-official',
            name: 'disabled-plugin',
            version: '1.0.0',
            path: '/Users/demo/.claude/plugins/disabled-plugin',
            enabled: false,
            type: 'local',
            local: true,
            sdkResolved: true,
            source: {
              kind: 'cli',
              path: '/Users/demo/.claude/settings.json',
              writable: true,
              removable: false,
            },
          },
        ];
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请分析 https://example.com',
    projectPath: '/tmp/project',
  });
  for await (const _event of stream) {
    // drain
  }

  const queryInput = queryInputs[0] as {
    options: {
      plugins?: Array<{ type: 'local'; path: string }>;
      allowedTools?: string[];
    };
  };
  assert.deepEqual(queryInput.options.plugins, [
    {
      type: 'local',
      path: '/Users/demo/.claude/plugins/playwright',
    },
  ]);
  assert.equal(queryInput.options.allowedTools, undefined);
});

test('agent service fails fast when selected user Claude settings are unavailable', async () => {
  const queryInputs: unknown[] = [];
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
    modelConfigProvider: {
      async getConfig() {
        return {
          configMode: 'third_party' as const,
          modelProvider: 'anthropic',
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-ant-fallback',
          anthropicBaseUrl: 'https://example.com/v1',
        };
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'user_claude_settings',
          inheritUserMcpServers: false,
          allowExternalBrowserAutomation: false,
          allowedPluginIds: [],
          allowedUserMcpServers: [],
          allowedToolPrefixes: [],
        };
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return {
          async interrupt() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', subtype: 'success', is_error: false };
          },
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project',
  });

  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  assert.equal(queryInputs.length, 0);
  const failedEvent = events.find((event) => event.type === 'run.failed');
  assert.ok(failedEvent);
  assert.match(String(failedEvent.payload.error || ''), /未检测到可用的本机 Claude CLI/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /source=user_claude_settings/);
  assert.match(String(failedEvent.payload.runtimeAuthSummary || ''), /settingSources=user,local/);
});

test('runtime capabilities always block external browser automation even when legacy config enables it', async () => {
  const toolDecisions: Array<Record<string, unknown>> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'project_model_config',
          inheritUserMcpServers: false,
          allowExternalBrowserAutomation: true,
          allowedUserMcpServers: [],
          allowedPluginIds: [],
          allowedToolPrefixes: ['mcp__plugin_playwright_playwright__'],
        };
      },
    },
    runtime: {
      query(input: unknown) {
        const canUseTool = (input as { options: { canUseTool: Function } }).options.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            toolDecisions.push(
              await canUseTool(
                'mcp__plugin_playwright_playwright__browser_snapshot',
                {},
                { toolUseID: 'toolu-plugin-browser-1' }
              )
            );
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请分析 https://example.com',
    permissionMode: 'bypassPermissions',
  });
  for await (const _event of stream) {
    // drain
  }

  assert.equal(toolDecisions[0]?.behavior, 'deny');
  assert.match(String(toolDecisions[0]?.message || ''), /始终禁止外部浏览器自动化|默认禁止外部浏览器自动化/);
});

test('general plugin tools are not gated by allowed tool prefixes', async () => {
  const toolDecisions: Array<Record<string, unknown>> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtimeCapabilitiesProvider: {
      async getCapabilities() {
        return {
          selectedAuthSource: 'project_model_config',
          inheritUserMcpServers: false,
          allowExternalBrowserAutomation: false,
          allowedPluginIds: [],
          allowedUserMcpServers: [],
          allowedToolPrefixes: ['mcp__plugin_example_tools__'],
        };
      },
    },
    runtime: {
      query(input: unknown) {
        const canUseTool = (input as { options: { canUseTool: Function } }).options.canUseTool;
        return {
          async *[Symbol.asyncIterator]() {
            toolDecisions.push(
              await canUseTool(
                'mcp__plugin_example_tools__run_task',
                {},
                { toolUseID: 'toolu-plugin-example-1' }
              )
            );
            yield { type: 'result', subtype: 'success', is_error: false };
          },
          async interrupt() {},
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请分析 https://example.com',
    permissionMode: 'bypassPermissions',
  });
  for await (const _event of stream) {
    // drain
  }

  assert.equal(toolDecisions[0]?.behavior, 'allow');
});

test('agent service injects builtin WebEdit plugin, skills, and system prompt for document sessions', async () => {
  const queryInputs: unknown[] = [];
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
    runtime: {
      query(input) {
        queryInputs.push(input);
        return {
          async interrupt() {},
          async *[Symbol.asyncIterator]() {
            yield { type: 'result', subtype: 'success', is_error: false };
          },
        };
      },
      registerActiveRun() {},
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    mcpServersProvider: {
      async listServers() {
        return {
          browser_extension: {
            type: 'http',
            url: 'http://127.0.0.1:12306/mcp',
          },
        };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请总结当前文档并把选中段落润色一下',
    browserContext: {
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
      tabId: 101,
    },
  });

  for await (const _event of stream) {
    // drain
  }

  const queryInput = queryInputs[0] as {
    options: {
      skills?: string[];
      plugins?: Array<{ type: 'local'; path: string }>;
      systemPrompt?: { type: 'preset'; preset: 'claude_code'; append?: string };
      settingSources?: string[];
      allowedTools?: string[];
    };
  };
  assert.deepEqual(queryInput.options.settingSources, ['project', 'local']);
  assert.deepEqual(queryInput.options.skills, [
    'webedit-assistant:webedit-office',
    'webedit-assistant:webedit-word',
  ]);
  assert.equal(queryInput.options.plugins?.[0]?.type, 'local');
  assert.match(
    (queryInput.options.plugins?.[0]?.path || '').replaceAll('\\', '/'),
    /apps\/agent-backend-v2\/builtin-plugins\/webedit-assistant$/
  );
  assert.deepEqual(queryInput.options.systemPrompt?.type, 'preset');
  assert.deepEqual(queryInput.options.systemPrompt?.preset, 'claude_code');
  assert.match(queryInput.options.systemPrompt?.append || '', /优先使用 webedit-assistant skills/);
  assert.equal(queryInput.options.allowedTools, undefined);
});

test('agent service emits run.aborted after an interrupted stream', async () => {
  const registeredRun: { interrupt?: () => Promise<void> } = {};

  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'stream_event', event: { type: 'unknown' } };
            throw new Error('interrupted');
          },
          async interrupt() {},
        };
      },
      registerActiveRun(_runId: string, run: { interrupt(): Promise<void> }) {
        registeredRun.interrupt = run.interrupt;
      },
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({ prompt: 'hello' });
  assert.ok(registeredRun.interrupt);
  await registeredRun.interrupt();

  const events = [];
  for await (const event of stream) {
    events.push(event.type);
  }

  assert.deepEqual(events, ['run.started', 'run.aborted']);
});

test('agent service keeps the bound Claude session id on an aborted stream', async () => {
  const registeredRun: { interrupt?: () => Promise<void> } = {};

  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'stream_event',
              session_id: 'claude-session-1',
              event: { type: 'unknown' },
            };
            throw new Error('interrupted');
          },
          async interrupt() {},
        };
      },
      registerActiveRun(_runId: string, run: { interrupt(): Promise<void> }) {
        registeredRun.interrupt = run.interrupt;
      },
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({ prompt: 'hello' });
  assert.ok(registeredRun.interrupt);
  await registeredRun.interrupt();

  const events = [];
  for await (const event of stream) {
    events.push(event);
  }

  assert.equal(events.at(-1)?.type, 'run.aborted');
  assert.equal(events.at(-1)?.sessionId, 'claude-session-1');
});

test('agent service tracks aborted session runs as terminal state', async () => {
  const registeredRun: { interrupt?: () => Promise<void> } = {};

  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'stream_event',
              session_id: 'claude-session-1',
              event: { type: 'unknown' },
            };
            throw new Error('interrupted');
          },
          async interrupt() {},
        };
      },
      registerActiveRun(_runId: string, run: { interrupt(): Promise<void> }) {
        registeredRun.interrupt = run.interrupt;
      },
      completeRun() {},
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: 'hello',
    projectPath: '/tmp/project-abort',
  });
  assert.ok(registeredRun.interrupt);
  await registeredRun.interrupt();

  for await (const _event of stream) {
    // drain
  }

  const runState = await service.getSessionRunState({ sessionId: 'claude-session-1' });
  assert.ok(runState);
  assert.equal(runState.status, 'aborted');
  assert.equal(runState.hasActiveStream, false);
});

test('agent v2 session route streams agent events as SSE', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun() {
      return { aborted: false as const, reason: 'not_active' as const };
    },
    async startSessionRun() {
      return Object.assign(
        (async function* () {
          yield createAgentEvent({
            runId: 'run-1',
            sessionId: null,
            sequence: 1,
            type: 'run.started',
          });
          yield createAgentEvent({
            runId: 'run-1',
            sessionId: null,
            sequence: 2,
            type: 'run.completed',
          });
        })(),
        { runId: 'run-1', sessionId: null }
      );
    },
    async continueSessionRun() {
      return Object.assign((async function* () {})(), { runId: 'run-2', sessionId: 'session-1' });
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    assert.match(body, /"type":"run.started"/);
    assert.match(body, /"type":"run.completed"/);
  } finally {
    server.close();
  }
});

test('agent v2 continue route streams agent events as SSE', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun() {
      return { aborted: false as const, reason: 'not_active' as const };
    },
    async startSessionRun() {
      return Object.assign((async function* () {})(), { runId: 'run-1', sessionId: null });
    },
    async continueSessionRun({ sessionId }) {
      return Object.assign(
        (async function* () {
          yield createAgentEvent({
            runId: 'run-2',
            sessionId,
            sequence: 1,
            type: 'run.started',
          });
        })(),
        { runId: 'run-2', sessionId }
      );
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/sessions/session-1/runs`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt: 'continue' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /"sessionId":"session-1"/);
    assert.match(body, /"type":"run.started"/);
  } finally {
    server.close();
  }
});

test('agent v2 abort route returns abort result', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun({ runId }) {
      return { aborted: true as const, runId };
    },
    async startSessionRun() {
      return Object.assign((async function* () {})(), { runId: 'run-1', sessionId: null });
    },
    async continueSessionRun() {
      return Object.assign((async function* () {})(), { runId: 'run-2', sessionId: 'session-1' });
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/runs/run-1/abort`,
      { method: 'POST' }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { aborted: true, runId: 'run-1' });
  } finally {
    server.close();
  }
});

test('agent v2 session runs route returns project session run summaries', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun() {
      return { aborted: false as const, reason: 'not_active' as const };
    },
    async listProjectSessionRuns({ projectPath }) {
      return {
        projectPath,
        sessions: [
          {
            sessionId: 'session-1',
            projectPath: projectPath || '',
            runId: 'run-1',
            status: 'streaming',
            startedAt: '2026-05-19T00:00:00.000Z',
            lastEventAt: '2026-05-19T00:00:01.000Z',
            latestSequence: 3,
            latestPreviewText: '正在执行',
            hasActiveStream: true,
          },
        ],
      };
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/session-runs?projectPath=%2Ftmp%2Fproject-a`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      projectPath: '/tmp/project-a',
      sessions: [
        {
          sessionId: 'session-1',
          projectPath: '/tmp/project-a',
          runId: 'run-1',
          status: 'streaming',
          startedAt: '2026-05-19T00:00:00.000Z',
          lastEventAt: '2026-05-19T00:00:01.000Z',
          latestSequence: 3,
          latestPreviewText: '正在执行',
          hasActiveStream: true,
        },
      ],
    });
  } finally {
    server.close();
  }
});

test('agent v2 session runs route rejects missing projectPath with explicit 400 error', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun() {
      return { aborted: false as const, reason: 'not_active' as const };
    },
    async listProjectSessionRuns({ projectPath }) {
      return { projectPath, sessions: [] };
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/session-runs`
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'projectPath is required',
      code: 'missing_project_path',
    });
  } finally {
    server.close();
  }
});

test('agent v2 session runs route returns single session run state', async () => {
  const route = createAgentV2Route({
    async getSessionHistory() {
      return { messages: [] };
    },
    async abortRun() {
      return { aborted: false as const, reason: 'not_active' as const };
    },
    async getSessionRunState({ sessionId }) {
      return {
        sessionId,
        projectPath: '/tmp/project-a',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-05-19T00:00:00.000Z',
        lastEventAt: '2026-05-19T00:00:02.000Z',
        latestSequence: 4,
        latestPreviewText: '执行完成',
        hasActiveStream: false,
      };
    },
  });
  const server = createServer(async (req, res) => {
    await route(req, res, req.url || '/');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const response = await fetch(
      `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}/api/agent-v2/session-runs/session-1`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sessionId: 'session-1',
      projectPath: '/tmp/project-a',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-05-19T00:00:00.000Z',
      lastEventAt: '2026-05-19T00:00:02.000Z',
      latestSequence: 4,
      latestPreviewText: '执行完成',
      hasActiveStream: false,
    });
  } finally {
    server.close();
  }
});
