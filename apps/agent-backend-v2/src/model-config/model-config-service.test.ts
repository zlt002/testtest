import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createModelConfigService,
  DEFAULT_MODEL_CONFIG,
  resolveModelConfigRuntimeInfo,
} from './model-config-service.ts';

test('model config defaults to empty project config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-'));
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: null,
      },
    });

    assert.deepEqual(await service.getConfig(), DEFAULT_MODEL_CONFIG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('model config persists anthropic fallback settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-write-'));
  const configPath = join(dir, '.webmcp', 'model-config.json');
  try {
    const service = createModelConfigService({
      configPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: null,
      },
    });

    const next = await service.updateConfig({
      configMode: 'official',
      modelProvider: 'anthropic',
      anthropicModelName: 'qwen3.6-plus',
      anthropicApiKey: 'sk-ant-demo',
      anthropicBaseUrl: 'https://example.com/v1',
    });

    assert.equal(next.configMode, 'official');
    assert.equal(next.modelProvider, 'anthropic');
    assert.equal(next.anthropicModelName, 'qwen3.6-plus');
    assert.equal(next.anthropicApiKey, 'sk-ant-demo');
    assert.equal(next.anthropicBaseUrl, 'https://example.com/v1');
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), next);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('official model catalog and quota are loaded through gateway client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-official-'));
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: null,
      },
      officialGatewayClient: {
        async listModels(input) {
          assert.equal(input.apiKey, 'sk-official');
          return [{ id: 'claude-sonnet-4-6', ownedBy: 'openai' }];
        },
        async getQuota(input) {
          assert.equal(input.apiKey, 'sk-official');
          return {
            usagePercent: 15.6,
            nextResetTime: '2026-05-21T00:00:00+00:00',
            resetCycle: 'daily',
          };
        },
      },
    });

    assert.deepEqual(await service.listOfficialModels({ apiKey: '  sk-official  ' }), [
      { id: 'claude-sonnet-4-6', ownedBy: 'openai' },
    ]);
    assert.deepEqual(await service.getOfficialQuota({ apiKey: '  sk-official  ' }), {
      usagePercent: 15.6,
      nextResetTime: '2026-05-21T00:00:00+00:00',
      resetCycle: 'daily',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detects anthropic-compatible CLI settings from local Claude settings.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-cli-anthropic-'));
  const userClaudeSettingsPath = join(dir, '.claude', 'settings.json');
  try {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(
      userClaudeSettingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic/v1',
            ANTHROPIC_AUTH_TOKEN: 'sk-ant-local',
            ANTHROPIC_MODEL: 'glm-4.5',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      userClaudeSettingsPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: 'C:\\claude.exe',
      },
    });

    assert.deepEqual(await service.getDetectedCliConfig(), {
      configMode: 'third_party',
      modelProvider: 'anthropic',
      providerVariant: 'standard',
      anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic/v1',
      anthropicApiKey: 'sk-ant-local',
      anthropicModelName: 'glm-4.5',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detects openai-compatible CLI settings from local Claude settings.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-cli-openai-'));
  const userClaudeSettingsPath = join(dir, '.claude', 'settings.json');
  try {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(
      userClaudeSettingsPath,
      JSON.stringify(
        {
          env: {
            OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
            OPENAI_API_KEY: 'sk-openai-local',
            OPENAI_MODEL: 'deepseek-chat',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      userClaudeSettingsPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: 'C:\\claude.exe',
      },
    });

    assert.deepEqual(await service.getDetectedCliConfig(), {
      configMode: 'third_party',
      modelProvider: 'openai',
      providerVariant: 'standard',
      openaiBaseUrl: 'https://api.deepseek.com/v1',
      openaiApiKey: 'sk-openai-local',
      openaiModelName: 'deepseek-chat',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig injects both Anthropic auth env keys for project-model DeepSeek compatibility', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-deepseek-anthropic-'));
  let capturedQueryInput:
    | {
        prompt: string;
        options?: Record<string, unknown>;
      }
    | undefined;
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: '/usr/local/bin/claude',
      },
      authProbe: {
        query(input) {
          capturedQueryInput = input;
          return Object.assign(
            (async function* () {
              yield {
                type: 'result',
                subtype: 'success',
                is_error: false,
              };
            })(),
            {
              async interrupt() {},
            }
          );
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'deepseek-v4-pro',
        anthropicApiKey: 'sk-deepseek-demo',
        anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
      },
      {
        selectedAuthSource: 'project_model_config',
      }
    );

    assert.equal(result.ok, true);
    assert.equal(
      (capturedQueryInput?.options?.env as Record<string, string | undefined>).ANTHROPIC_API_KEY,
      'sk-deepseek-demo'
    );
    assert.equal(
      (capturedQueryInput?.options?.env as Record<string, string | undefined>).ANTHROPIC_AUTH_TOKEN,
      'sk-deepseek-demo'
    );
    assert.match(result.runtimeAuthSummary, /provider=anthropic/);
    assert.match(result.runtimeAuthSummary, /model=deepseek-v4-pro/);
    assert.match(result.runtimeAuthSummary, /baseUrl=https:\/\/api\.deepseek\.com\/anthropic/);
    assert.match(result.runtimeAuthSummary, /apiKey=present/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('persists raw user Claude settings json and creates parent directory when missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-user-claude-settings-write-'));
  const userClaudeSettingsPath = join(dir, '.claude', 'settings.json');
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      userClaudeSettingsPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: 'C:\\claude.exe',
      },
    });

    const rawJson = '{\n  "env": {\n    "OPENAI_MODEL": "deepseek-chat"\n  }\n}\n';
    const snapshot = await service.updateUserClaudeSettings(rawJson);

    assert.deepEqual(snapshot, {
      path: userClaudeSettingsPath,
      exists: true,
      rawJson,
    });
    assert.equal(await readFile(userClaudeSettingsPath, 'utf8'), rawJson);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime info prefers project model config when both CLI and project key are available', () => {
  const runtime = resolveModelConfigRuntimeInfo({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableLiveWritePreviewDiagnostics: false,
      claudeCodeExecutablePath: '/usr/local/bin/claude',
    },
    runtimeCapabilities: {
      selectedAuthSource: 'user_claude_settings',
    },
    modelConfig: {
      configMode: 'third_party',
      modelProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-demo',
    },
  });

  assert.equal(runtime.authSource, 'project_model_config');
  assert.equal(runtime.selectedAuthSource, 'project_model_config');
  assert.equal(runtime.available, true);
});

test('runtime info still prefers project model config when CLI is missing but project key exists', () => {
  const runtime = resolveModelConfigRuntimeInfo({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableLiveWritePreviewDiagnostics: false,
      claudeCodeExecutablePath: null,
    },
    runtimeCapabilities: {
      selectedAuthSource: 'user_claude_settings',
    },
    modelConfig: {
      configMode: 'third_party',
      modelProvider: 'anthropic',
      anthropicApiKey: 'sk-ant-demo',
    },
  });

  assert.equal(runtime.authSource, 'project_model_config');
  assert.equal(runtime.selectedAuthSource, 'project_model_config');
  assert.equal(runtime.available, true);
  assert.match(runtime.reason, /项目模型配置/);
});

test('runtime info uses selected project model config without any auto fallback logic', () => {
  const env = {
    host: '127.0.0.1',
    port: 8792,
    workdir: '/tmp/project',
    model: null,
    enableBrowserExtensionMcp: true,
    browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
    enableLiveWritePreviewDiagnostics: false,
    claudeCodeExecutablePath: null,
  };
  const modelConfig = {
    configMode: 'third_party' as const,
    modelProvider: 'anthropic' as const,
    anthropicApiKey: 'sk-ant-demo',
  };
  const runtime = resolveModelConfigRuntimeInfo({
    env,
    runtimeCapabilities: {
      selectedAuthSource: 'project_model_config',
    },
    modelConfig,
  });
  assert.equal(runtime.authSource, 'project_model_config');
  assert.equal(runtime.selectedAuthSource, 'project_model_config');
  assert.equal(runtime.available, true);
});

test('runtime info prefers project model config when project key exists even if stored source is user settings', () => {
  const runtime = resolveModelConfigRuntimeInfo({
    env: {
      host: '127.0.0.1',
      port: 8792,
      workdir: '/tmp/project',
      model: null,
      enableBrowserExtensionMcp: true,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableLiveWritePreviewDiagnostics: false,
      claudeCodeExecutablePath: '/usr/local/bin/claude',
    },
    runtimeCapabilities: {
      selectedAuthSource: 'user_claude_settings',
    },
    modelConfig: {
      configMode: 'official',
      modelProvider: 'anthropic',
      anthropicModelName: 'qwen3.6-plus',
      anthropicApiKey: 'sk-project-demo',
      anthropicBaseUrl: 'https://example.com/v1',
    },
  });

  assert.equal(runtime.authSource, 'project_model_config');
  assert.equal(runtime.selectedAuthSource, 'project_model_config');
  assert.equal(runtime.available, true);
  assert.equal(runtime.claudeCliAvailable, true);
  assert.equal(runtime.hasProjectModelConfig, true);
});

test('testConfig returns structured auth diagnostics from probe result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-auth-test-'));
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: null,
      },
      authProbe: {
        query() {
          return Object.assign(
            (async function* () {
              yield {
                type: 'result',
                subtype: 'error',
                is_error: true,
                error:
                  'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
              };
            })(),
            {
              async interrupt() {},
            }
          );
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'project_model_config',
      }
    );

    assert.equal(result.ok, false);
    assert.match(result.message, /Failed to authenticate/);
    assert.match(result.runtimeAuthSummary, /source=project_model_config/);
    assert.match(result.runtimeAuthSummary, /provider=anthropic/);
    assert.match(result.runtimeAuthSummary, /model=glm-5\.1/);
    assert.match(result.runtimeAuthSummary, /baseUrl=https:\/\/example\.com\/v1/);
    assert.match(result.runtimeAuthSummary, /apiKey=present/);
    assert.equal(result.runtime.authSource, 'project_model_config');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig uses runtime capability override when probing auth source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-auth-override-'));
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: '/usr/local/bin/claude',
      },
      runtimeCapabilitiesProvider: {
        async getCapabilities() {
          return {
            selectedAuthSource: 'user_claude_settings',
          };
        },
      },
      authProbe: {
        query() {
          return Object.assign(
            (async function* () {
              yield {
                type: 'result',
                subtype: 'success',
                is_error: false,
              };
            })(),
            {
              async interrupt() {},
            }
          );
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'project_model_config',
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.runtime.authSource, 'project_model_config');
    assert.match(result.runtimeAuthSummary, /source=project_model_config/);
    assert.match(result.runtimeAuthSummary, /apiKey=present/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig fails directly when selected user Claude settings are unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-auth-unavailable-'));
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: null,
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'user_claude_settings',
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.runtime.authSource, 'user_claude_settings');
    assert.equal(result.runtime.available, false);
    assert.match(result.message, /未检测到可用的本机 Claude CLI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig fails when user Claude settings do not contain supported auth config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-user-settings-invalid-'));
  const userClaudeSettingsPath = join(dir, '.claude', 'settings.json');
  try {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(
      userClaudeSettingsPath,
      JSON.stringify(
        {
          env: {
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      userClaudeSettingsPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: '/usr/local/bin/claude',
      },
      authProbe: {
        query() {
          assert.fail('auth probe should not run when user Claude settings are invalid');
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'user_claude_settings',
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.runtime.authSource, 'user_claude_settings');
    assert.match(result.message, /settings\.json/);
    assert.match(result.message, /有效认证配置/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig probes user Claude settings with detected CLI config instead of project config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-user-settings-probe-'));
  const userClaudeSettingsPath = join(dir, '.claude', 'settings.json');
  let capturedQueryInput:
    | {
        prompt: string;
        options?: Record<string, unknown>;
      }
    | undefined;
  try {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(
      userClaudeSettingsPath,
      JSON.stringify(
        {
          env: {
            OPENAI_API_KEY: 'sk-openai-local',
            OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
            OPENAI_MODEL: 'deepseek-chat',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      userClaudeSettingsPath,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: '/usr/local/bin/claude',
      },
      authProbe: {
        query(input) {
          capturedQueryInput = input;
          return Object.assign(
            (async function* () {
              yield {
                type: 'result',
                subtype: 'success',
                is_error: false,
              };
            })(),
            {
              async interrupt() {},
            }
          );
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'user_claude_settings',
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.runtime.authSource, 'user_claude_settings');
    assert.equal(capturedQueryInput?.prompt, 'Reply with exactly OK.');
    assert.equal(capturedQueryInput?.options?.model, 'deepseek-chat');
    assert.match(result.runtimeAuthSummary, /source=user_claude_settings/);
    assert.match(result.runtimeAuthSummary, /provider=openai/);
    assert.match(result.runtimeAuthSummary, /model=deepseek-chat/);
    assert.match(result.runtimeAuthSummary, /baseUrl=https:\/\/api\.deepseek\.com\/v1/);
    assert.match(result.runtimeAuthSummary, /apiKey=present/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('testConfig returns timeout failure when auth probe does not finish', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-model-config-auth-timeout-'));
  let interrupted = false;
  try {
    const service = createModelConfigService({
      configPath: join(dir, '.webmcp', 'model-config.json'),
      authProbeTimeoutMs: 20,
      env: {
        host: '127.0.0.1',
        port: 8792,
        workdir: dir,
        model: null,
        enableBrowserExtensionMcp: true,
        browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
        enableLiveWritePreviewDiagnostics: false,
        claudeCodeExecutablePath: '/usr/local/bin/claude',
      },
      authProbe: {
        query() {
          return Object.assign(
            (async function* () {
              await new Promise(() => {});
            })(),
            {
              async interrupt() {
                interrupted = true;
              },
            }
          );
        },
      },
    });

    const result = await service.testConfig(
      {
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      {
        selectedAuthSource: 'user_claude_settings',
      }
    );

    assert.equal(result.ok, false);
    assert.match(result.message, /认证测试超时/);
    assert.equal(interrupted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
