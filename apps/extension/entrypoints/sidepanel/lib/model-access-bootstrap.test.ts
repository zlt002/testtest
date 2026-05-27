// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type {
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigRuntimeInfo,
  AgentUserClaudeSettingsSnapshot,
} from './agent-v2/types';
import {
  buildUnavailableAuthTestResult,
  hasStoredProjectModelConfig,
  hydrateModelConfig,
  loadBootstrapModelAccess,
  normalizeModelConfigForSubmit,
  probeBootstrapModelAccess,
  readBootstrapModelAccessSnapshot,
} from './model-access-bootstrap';

function runtimeInfo(
  overrides: Partial<AgentModelConfigRuntimeInfo> = {}
): AgentModelConfigRuntimeInfo {
  return {
    authSource: 'user_claude_settings',
    selectedAuthSource: 'user_claude_settings',
    available: true,
    claudeCliAvailable: true,
    hasProjectModelConfig: true,
    reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
    ...overrides,
  };
}

function modelConfig(overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return {
    configMode: 'official',
    modelProvider: 'anthropic',
    anthropicModelName: 'claude-sonnet-4-20250514',
    anthropicApiKey: 'sk-anthropic',
    anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
    providerVariant: 'standard',
    ...overrides,
  };
}

function testResult(
  ok: boolean,
  runtime: AgentModelConfigRuntimeInfo
): AgentModelConfigAuthTestResult {
  return {
    ok,
    message: ok ? '认证成功' : '认证失败',
    runtimeAuthSummary: '认证摘要',
    runtime,
  };
}

function userClaudeSettings(
  overrides: Partial<AgentUserClaudeSettingsSnapshot> = {}
): AgentUserClaudeSettingsSnapshot {
  return {
    path: '/Users/demo/.claude/settings.json',
    exists: true,
    rawJson: '{\n  "env": {}\n}\n',
    ...overrides,
  };
}

describe('model-access-bootstrap helpers', () => {
  it('hydrateModelConfig 会补齐 official 模式', () => {
    expect(
      hydrateModelConfig(
        modelConfig({
          configMode: undefined,
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
        })
      ).configMode
    ).toBe('official');
  });

  it('hasStoredProjectModelConfig 根据 provider 判断是否已有 key', () => {
    expect(hasStoredProjectModelConfig(modelConfig({ anthropicApiKey: 'sk-demo' }))).toBe(true);
    expect(hasStoredProjectModelConfig(modelConfig({ anthropicApiKey: '   ' }))).toBe(false);
    expect(
      hasStoredProjectModelConfig(
        modelConfig({
          modelProvider: 'openai',
          openaiApiKey: 'sk-openai',
          anthropicApiKey: undefined,
        })
      )
    ).toBe(true);
  });

  it('normalizeModelConfigForSubmit 会裁剪字段并强制 official 网关', () => {
    expect(
      normalizeModelConfigForSubmit(
        modelConfig({
          configMode: 'official',
          anthropicApiKey: '  sk-demo  ',
          anthropicBaseUrl: ' https://wrong.example.com ',
        })
      )
    ).toMatchObject({
      configMode: 'official',
      modelProvider: 'anthropic',
      anthropicApiKey: 'sk-demo',
      anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
    });
  });

  it('buildUnavailableAuthTestResult 会保留 runtime 选择来源并标记不可用', () => {
    const result = buildUnavailableAuthTestResult({
      targetAuthSource: 'project_model_config',
      runtime: runtimeInfo(),
      message: '项目模型配置不可用',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('项目模型配置不可用');
    expect(result.runtime.authSource).toBe('project_model_config');
    expect(result.runtime.selectedAuthSource).toBe('user_claude_settings');
    expect(result.runtime.available).toBe(false);
  });
});

describe('readBootstrapModelAccessSnapshot', () => {
  it('成功读取时会返回 hydrate 后配置和格式化后的 settings 文本', async () => {
    const snapshot = await readBootstrapModelAccessSnapshot({
      client: {
        getRuntimeCapabilities: vi.fn(async () => ({
          selectedAuthSource: 'project_model_config' as const,
        })),
        getModelConfig: vi.fn(async () => ({
          success: true,
          config: modelConfig({ configMode: undefined }),
          runtime: runtimeInfo(),
          detectedCliConfig: null,
          userClaudeSettings: userClaudeSettings(),
        })),
        testModelConfig: vi.fn(),
      },
      fallbackLocalConfig: modelConfig({ anthropicApiKey: undefined }),
    });

    expect(snapshot.selectedAuthSource).toBe('project_model_config');
    expect(snapshot.runtimeInfo?.selectedAuthSource).toBe('user_claude_settings');
    expect(snapshot.localConfig.configMode).toBe('official');
    expect(snapshot.userClaudeSettingsText).toContain('"env"');
  });

  it('读取失败时会回退到默认配置和默认来源', async () => {
    const snapshot = await readBootstrapModelAccessSnapshot({
      client: {
        getRuntimeCapabilities: vi.fn(async () => {
          throw new Error('capabilities failed');
        }),
        getModelConfig: vi.fn(async () => {
          throw new Error('config failed');
        }),
        testModelConfig: vi.fn(),
      },
      fallbackLocalConfig: modelConfig({ anthropicApiKey: undefined }),
    });

    expect(snapshot.selectedAuthSource).toBe('project_model_config');
    expect(snapshot.runtimeInfo).toBeNull();
    expect(snapshot.userClaudeSettings).toBeNull();
    expect(snapshot.userClaudeSettingsText).toContain('"env"');
  });
});

describe('probeBootstrapModelAccess', () => {
  it('会为两个来源执行探测并汇总 view state', async () => {
    const userRuntime = runtimeInfo({
      authSource: 'user_claude_settings',
      selectedAuthSource: 'user_claude_settings',
    });
    const projectRuntime = runtimeInfo({
      authSource: 'project_model_config',
      selectedAuthSource: 'project_model_config',
    });

    const result = await probeBootstrapModelAccess({
      client: {
        getRuntimeCapabilities: vi.fn(),
        getModelConfig: vi.fn(),
        testModelConfig: vi.fn(
          async (_config, input) =>
            ({
              result:
                input.targetAuthSource === 'user_claude_settings'
                  ? testResult(true, userRuntime)
                  : testResult(false, projectRuntime),
            }) as never
        ),
      },
      localConfig: modelConfig(),
      runtimeInfo: runtimeInfo(),
    });

    expect(result.userClaudeSettingsTestResult?.ok).toBe(true);
    expect(result.projectModelConfigTestResult?.ok).toBe(false);
    expect(result.viewState.overallStatus).toBe('partial');
  });

  it('CLI 缺失且项目未配置时直接生成不可用结果', async () => {
    const result = await probeBootstrapModelAccess({
      client: {
        getRuntimeCapabilities: vi.fn(),
        getModelConfig: vi.fn(),
        testModelConfig: vi.fn(),
      },
      localConfig: modelConfig({ anthropicApiKey: undefined }),
      runtimeInfo: runtimeInfo({
        available: false,
        claudeCliAvailable: false,
        hasProjectModelConfig: false,
      }),
    });

    expect(result.userClaudeSettingsTestResult?.ok).toBe(false);
    expect(result.projectModelConfigTestResult?.ok).toBe(false);
    expect(result.viewState.overallStatus).toBe('unavailable');
  });
});

describe('loadBootstrapModelAccess', () => {
  it('会串起读取快照、双来源探测和 view state 汇总', async () => {
    const result = await loadBootstrapModelAccess({
      client: {
        getRuntimeCapabilities: vi.fn(async () => ({
          selectedAuthSource: 'user_claude_settings' as const,
        })),
        getModelConfig: vi.fn(async () => ({
          success: true,
          config: modelConfig(),
          runtime: runtimeInfo(),
          detectedCliConfig: null,
          userClaudeSettings: userClaudeSettings(),
        })),
        testModelConfig: vi.fn(
          async (_config, input) =>
            ({
              result: testResult(
                input.targetAuthSource === 'user_claude_settings',
                runtimeInfo({
                  authSource: input.targetAuthSource,
                  selectedAuthSource: input.targetAuthSource,
                })
              ),
            }) as never
        ),
      },
      fallbackLocalConfig: modelConfig({ anthropicApiKey: undefined }),
    });

    expect(result.localConfig.modelProvider).toBe('anthropic');
    expect(result.userClaudeSettingsTestResult?.ok).toBe(true);
    expect(result.projectModelConfigTestResult?.ok).toBe(false);
    expect(result.viewState.overallStatus).toBe('partial');
  });
});
