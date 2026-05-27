// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { runBootstrapGate } from './bootstrap-gate';

describe('runBootstrapGate', () => {
  it('并行执行远端同步和模型检查，并在二者可用后进入 ready', async () => {
    const result = await runBootstrapGate({
      syncRemote: vi.fn(async () => ({
        ok: true,
        status: 'completed',
        mode: 'remote',
      })),
      loadModelAccess: vi.fn(async () => ({
        selectedAuthSource: 'user_claude_settings',
        runtimeInfo: null,
        localConfig: {
          modelProvider: 'openai',
        },
        userClaudeSettings: null,
        userClaudeSettingsText: '{\n  "env": {}\n}\n',
        userClaudeSettingsTestResult: null,
        projectModelConfigTestResult: null,
        viewState: {
          phase: 'resolved',
          overallStatus: 'available',
          summary: '当前模型可用。',
          userClaudeSettings: 'success',
          projectModelConfig: 'needs_config',
        },
      })),
    });

    expect(result.status).toBe('ready');
  });

  it('同步失败时进入 sync_failed', async () => {
    const result = await runBootstrapGate({
      syncRemote: vi.fn(async () => ({
        ok: false,
        status: 'failed',
        error: 'sync failed',
      })),
      loadModelAccess: vi.fn(async () => ({
        selectedAuthSource: 'user_claude_settings',
        runtimeInfo: null,
        localConfig: {
          modelProvider: 'openai',
        },
        userClaudeSettings: null,
        userClaudeSettingsText: '{\n  "env": {}\n}\n',
        userClaudeSettingsTestResult: null,
        projectModelConfigTestResult: null,
        viewState: {
          phase: 'resolved',
          overallStatus: 'available',
          summary: '当前模型可用。',
          userClaudeSettings: 'success',
          projectModelConfig: 'needs_config',
        },
      })),
    });

    expect(result).toMatchObject({
      status: 'sync_failed',
      sync: {
        error: 'sync failed',
      },
    });
  });

  it('模型不可用时进入 blocked', async () => {
    const result = await runBootstrapGate({
      syncRemote: vi.fn(async () => ({
        ok: true,
        status: 'completed',
        mode: 'remote',
      })),
      loadModelAccess: vi.fn(async () => ({
        selectedAuthSource: 'user_claude_settings',
        runtimeInfo: null,
        localConfig: {
          modelProvider: 'openai',
        },
        userClaudeSettings: null,
        userClaudeSettingsText: '{\n  "env": {}\n}\n',
        userClaudeSettingsTestResult: null,
        projectModelConfigTestResult: null,
        viewState: {
          phase: 'resolved',
          overallStatus: 'needs_config',
          summary: '当前需先补齐模型配置。',
          userClaudeSettings: 'unavailable',
          projectModelConfig: 'needs_config',
        },
      })),
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockedReason: 'model_config',
    });
  });
});
