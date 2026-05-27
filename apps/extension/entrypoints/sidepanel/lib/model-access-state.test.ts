// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type {
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigRuntimeInfo,
} from './agent-v2/types';
import { deriveModelAccessViewState } from './model-access-state';

function runtimeInfo(
  overrides: Partial<AgentModelConfigRuntimeInfo> = {}
): AgentModelConfigRuntimeInfo {
  return {
    authSource: 'user_claude_settings',
    selectedAuthSource: 'user_claude_settings',
    available: false,
    claudeCliAvailable: false,
    hasProjectModelConfig: false,
    reason: '当前没有可用认证来源。',
    ...overrides,
  };
}

function modelConfig(overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return {
    configMode: 'official',
    modelProvider: 'anthropic',
    anthropicModelName: 'claude-sonnet-4-20250514',
    anthropicApiKey: undefined,
    anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
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

describe('deriveModelAccessViewState', () => {
  it('CLI 不存在且项目未配置时，首屏直接显示需配置', () => {
    const result = deriveModelAccessViewState({
      runtimeInfo: runtimeInfo(),
      localConfig: modelConfig(),
      userClaudeSettingsTestResult: null,
      projectModelConfigTestResult: null,
      isProbing: false,
    });

    expect(result.phase).toBe('static');
    expect(result.overallStatus).toBe('needs_config');
    expect(result.userClaudeSettings).toBe('unavailable');
    expect(result.projectModelConfig).toBe('needs_config');
  });

  it('静态可试但探测未完成时，显示检测中', () => {
    const result = deriveModelAccessViewState({
      runtimeInfo: runtimeInfo({
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
      }),
      localConfig: modelConfig({
        anthropicApiKey: 'sk-demo',
      }),
      userClaudeSettingsTestResult: null,
      projectModelConfigTestResult: null,
      isProbing: true,
    });

    expect(result.phase).toBe('probing');
    expect(result.overallStatus).toBe('probing');
    expect(result.userClaudeSettings).toBe('probing');
    expect(result.projectModelConfig).toBe('probing');
  });

  it('CLI 可用但项目未配置时，探测结果返回前不应提前显示需配置', () => {
    const result = deriveModelAccessViewState({
      runtimeInfo: runtimeInfo({
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: false,
      }),
      localConfig: modelConfig(),
      userClaudeSettingsTestResult: null,
      projectModelConfigTestResult: null,
      isProbing: false,
    });

    expect(result.phase).toBe('static');
    expect(result.overallStatus).toBe('probing');
    expect(result.userClaudeSettings).toBe('probing');
    expect(result.projectModelConfig).toBe('needs_config');
    expect(result.summary).toContain('检查');
  });

  it('一边成功一边失败时，最终显示部分可用', () => {
    const baseRuntime = runtimeInfo({
      available: true,
      claudeCliAvailable: true,
      hasProjectModelConfig: true,
    });

    const result = deriveModelAccessViewState({
      runtimeInfo: baseRuntime,
      localConfig: modelConfig({
        anthropicApiKey: 'sk-demo',
      }),
      userClaudeSettingsTestResult: testResult(false, {
        ...baseRuntime,
        authSource: 'user_claude_settings',
      }),
      projectModelConfigTestResult: testResult(true, {
        ...baseRuntime,
        authSource: 'project_model_config',
      }),
      isProbing: false,
    });

    expect(result.phase).toBe('resolved');
    expect(result.overallStatus).toBe('partial');
    expect(result.userClaudeSettings).toBe('failed');
    expect(result.projectModelConfig).toBe('success');
  });
});
