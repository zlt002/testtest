// @vitest-environment node

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { StrictMode, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AgentAuthSource,
  AgentDetectedModelConfig,
  AgentModelConfig,
  AgentModelConfigRuntimeInfo,
} from '../lib/agent-v2/types';
import { MODEL_ACCESS_CHANGED_EVENT } from '../lib/model-access-events';

const routeSearch: {
  mode: string;
  projectPath?: string;
  entryPath?: string;
} = { mode: 'model' };

const baseRuntimeInfo = (
  overrides: Partial<AgentModelConfigRuntimeInfo> = {}
): AgentModelConfigRuntimeInfo => ({
  authSource: 'user_claude_settings',
  selectedAuthSource: 'user_claude_settings',
  available: true,
  claudeCliAvailable: true,
  hasProjectModelConfig: true,
  reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
  ...overrides,
});

const baseModelConfig = (overrides: Partial<AgentModelConfig> = {}): AgentModelConfig => ({
  configMode: 'official',
  modelProvider: 'anthropic',
  anthropicModelName: 'claude-sonnet-4-20250514',
  anthropicApiKey: 'sk-official',
  anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
  ...overrides,
});

const baseDetectedCliConfig = (
  overrides: Partial<AgentDetectedModelConfig> = {}
): AgentDetectedModelConfig => ({
  configMode: 'third_party',
  modelProvider: 'openai',
  openaiModelName: 'deepseek-chat',
  openaiApiKey: 'sk-cli-detected',
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  ...overrides,
});

const baseUserClaudeSettings = (
  overrides?: Partial<{ path: string; exists: boolean; rawJson: string | null }>
) => ({
  path: 'C:\\Users\\Administrator\\.claude\\settings.json',
  exists: true,
  rawJson: '{\n  "env": {\n    "OPENAI_BASE_URL": "https://api.deepseek.com/v1"\n  }\n}\n',
  ...overrides,
});

const agentClientMocks = vi.hoisted(() => ({
  getModelConfig: vi.fn(async () => ({
    config: baseModelConfig(),
    runtime: baseRuntimeInfo(),
    detectedCliConfig: null,
    userClaudeSettings: baseUserClaudeSettings(),
  })),
  updateUserClaudeSettings: vi.fn(async (rawJson: string) => ({
    path: 'C:\\Users\\Administrator\\.claude\\settings.json',
    exists: true,
    rawJson,
  })),
  updateModelConfig: vi.fn(async (config) => ({
    config,
    runtime: baseRuntimeInfo({
      authSource: 'project_model_config',
      selectedAuthSource: 'project_model_config',
      reason: '当前使用项目模型配置作为运行时认证来源。',
    }),
  })),
  testModelConfig: vi.fn(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
    result: {
      ok: true,
      message:
        options?.targetAuthSource === 'user_claude_settings'
          ? '用户级 Claude settings 测试成功'
          : '项目模型配置测试成功',
      runtimeAuthSummary: `认证摘要 | source=${options?.targetAuthSource ?? 'user_claude_settings'}`,
      runtime: baseRuntimeInfo({
        authSource: options?.targetAuthSource ?? 'user_claude_settings',
        selectedAuthSource: options?.targetAuthSource ?? 'user_claude_settings',
        reason:
          options?.targetAuthSource === 'project_model_config'
            ? '当前使用项目模型配置作为运行时认证来源。'
            : '当前使用用户级 Claude settings 作为运行时认证来源。',
      }),
    },
  })),
  listOfficialModelCatalog: vi.fn(async () => [
    { id: 'claude-sonnet-4-6', ownedBy: 'openai' },
    { id: 'gpt-5.4', ownedBy: 'openai' },
  ]),
  getOfficialQuota: vi.fn(async () => ({
    usagePercent: 15.6,
    nextResetTime: '2026-05-21T00:00:00+00:00',
    resetCycle: 'daily',
  })),
  getRuntimeCapabilities: vi.fn(async () => ({
    selectedAuthSource: 'user_claude_settings' as AgentAuthSource,
  })),
  updateRuntimeCapabilities: vi.fn(async (patch: { selectedAuthSource?: AgentAuthSource }) => ({
    selectedAuthSource: patch.selectedAuthSource ?? 'user_claude_settings',
  })),
  getSystemUpdateInfo: vi.fn(async () => ({ updateAvailable: false })),
  startSystemUpdate: vi.fn(async () => ({ success: true })),
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useSearch: () => routeSearch,
  }),
  useNavigate: () => routerMocks.navigate,
}));

vi.mock('../lib/config', () => ({
  config: {
    api: {
      agentV2BaseUrl: 'http://localhost:3000',
      agentV2Endpoint: '/api',
    },
  },
}));

vi.mock('../lib/modelConfig', () => ({
  ANTHROPIC_MODELS: ['claude-sonnet-4-20250514'],
  OPENAI_MODELS: ['gpt-4o'],
  defaultModelConfig: {
    modelProvider: 'openai',
    openaiModelName: 'gpt-4o',
    openaiApiKey: undefined,
    openaiBaseUrl: 'https://api.openai.com/v1',
    anthropicModelName: 'claude-sonnet-4-20250514',
    anthropicApiKey: undefined,
    anthropicBaseUrl: 'https://api.anthropic.com/v1',
  },
}));

vi.mock('../lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    getModelConfig: agentClientMocks.getModelConfig,
    updateUserClaudeSettings: agentClientMocks.updateUserClaudeSettings,
    updateModelConfig: agentClientMocks.updateModelConfig,
    testModelConfig: agentClientMocks.testModelConfig,
    listOfficialModelCatalog: agentClientMocks.listOfficialModelCatalog,
    getOfficialQuota: agentClientMocks.getOfficialQuota,
    getRuntimeCapabilities: agentClientMocks.getRuntimeCapabilities,
    updateRuntimeCapabilities: agentClientMocks.updateRuntimeCapabilities,
    getSystemUpdateInfo: agentClientMocks.getSystemUpdateInfo,
    startSystemUpdate: agentClientMocks.startSystemUpdate,
  }),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  readAgentV2ProjectSelection: vi.fn(async () => null),
}));

vi.mock('./agent-workspaces', () => ({
  AgentWorkspacesContent: ({
    embedded,
    projectPath,
    targetProjectPath,
    targetEntryPath,
  }: {
    embedded?: boolean;
    projectPath?: string;
    targetProjectPath?: string;
    targetEntryPath?: string;
  }) => (
    <div data-testid="agent-workspaces-content">
      {embedded ? 'embedded' : 'standalone'}:{projectPath || 'empty'}:
      {targetProjectPath || 'no-target-project'}:{targetEntryPath || 'no-target-entry'}
    </div>
  ),
}));

vi.mock('./mcp.index', () => ({
  McpSettingsContent: () => <div data-testid="mcp-settings-content">mcp-settings</div>,
}));

vi.mock('./userscripts.workspace', () => ({
  UserScriptsWorkspace: ({
    routeMode,
    routeScriptId,
  }: {
    routeMode?: string;
    routeScriptId?: string;
  }) => (
    <div data-testid="userscripts-workspace-content">
      userscripts:{routeMode || 'default'}:{routeScriptId || 'none'}
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  ModelSettings,
  SettingsPanel,
  trimOptionalValue,
} from './settings';

function getInputBySectionLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (element) => element.textContent?.trim() === labelText
  );
  if (!label?.parentElement) {
    throw new Error(`未找到标签: ${labelText}`);
  }
  const input = label.parentElement.querySelector('input');
  if (!input || input.tagName !== 'INPUT') {
    throw new Error(`标签 ${labelText} 下未找到 input`);
  }
  return input as HTMLInputElement;
}

async function waitForModelSettingsReady(view: ReturnType<typeof render>): Promise<void> {
  await view.findByRole('button', { name: '选择 用户级 Claude settings' });
  await waitFor(() => {
    expect(agentClientMocks.getModelConfig).toHaveBeenCalledTimes(1);
    expect(agentClientMocks.getRuntimeCapabilities).toHaveBeenCalledTimes(1);
  });
}

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com',
  });

  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
  vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
});

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  routeSearch.mode = 'model';
  routeSearch.projectPath = undefined;
  routeSearch.entryPath = undefined;
  agentClientMocks.getModelConfig.mockClear();
  agentClientMocks.updateUserClaudeSettings.mockClear();
  agentClientMocks.updateModelConfig.mockClear();
  agentClientMocks.testModelConfig.mockClear();
  agentClientMocks.listOfficialModelCatalog.mockClear();
  agentClientMocks.getOfficialQuota.mockClear();
  agentClientMocks.getRuntimeCapabilities.mockClear();
  agentClientMocks.updateRuntimeCapabilities.mockClear();
  agentClientMocks.getSystemUpdateInfo.mockClear();
  agentClientMocks.startSystemUpdate.mockClear();
  routerMocks.navigate.mockClear();
  // moved out of afterEach
    /*
    routeSearch.mode = 'workspace';
    routeSearch.projectPath = '/tmp/project';
    routeSearch.entryPath = 'captures/mock';

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<SettingsPanel />);
    });

    fireEvent.click(view.getByRole('button', { name: '模型设置' }));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: {
        mode: 'model',
        projectPath: '/tmp/project',
        entryPath: 'captures/mock',
      },
      replace: true,
    });
  });
    */
});

describe('Settings route sync', () => {
  it('updates route search when switching settings tabs', async () => {
    routeSearch.mode = 'workspace';
    routeSearch.projectPath = '/tmp/project';
    routeSearch.entryPath = 'captures/mock';

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<SettingsPanel />);
    });

    fireEvent.click(view.getByRole('button', { name: '工作区管理' }));
    fireEvent.click(view.getByRole('button', { name: '模型设置' }));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: {
        mode: 'model',
        projectPath: '/tmp/project',
        entryPath: 'captures/mock',
      },
      replace: true,
    });
  });
});

describe('ModelSettings', () => {
  it('renders a single unified form with source switcher and quick presets', () => {
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'openai',
          openaiModelName: 'gpt-4o',
          openaiApiKey: 'sk-openai-demo',
          openaiBaseUrl: 'https://api.openai.com/v1',
        })}
        setLocalConfig={vi.fn()}
        runtimeInfo={baseRuntimeInfo({
          authSource: 'project_model_config',
          selectedAuthSource: 'project_model_config',
          claudeCliAvailable: false,
          reason: '当前使用项目模型配置作为运行时认证来源。',
        })}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    expect(view.getByRole('button', { name: '选择 用户级 Claude settings' })).toBeTruthy();
    expect(view.getByRole('button', { name: '选择 项目模型配置' })).toBeTruthy();
    expect(view.getByText('统一模型配置')).toBeTruthy();
    expect(view.getByRole('button', { name: '快速填充 公司网关' })).toBeTruthy();
    expect(view.getByRole('button', { name: '快速填充 DeepSeek' })).toBeTruthy();
    expect(view.getByRole('button', { name: '快速填充 智谱' })).toBeTruthy();
    expect(view.getByRole('button', { name: '快速填充 MinMax' })).toBeTruthy();
  });

  it('applies DeepSeek preset through the unified form using the official Claude Code route', () => {
    const setLocalConfig = vi.fn();
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: 'sk-existing-anthropic',
          anthropicBaseUrl: 'https://api.anthropic.com/v1',
          openaiApiKey: 'sk-existing-openai',
        })}
        setLocalConfig={setLocalConfig}
        runtimeInfo={baseRuntimeInfo()}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    fireEvent.click(view.getByRole('button', { name: '快速填充 DeepSeek' }));

    expect(setLocalConfig).toHaveBeenCalledTimes(1);
    const updater = setLocalConfig.mock.calls[0][0] as (
      current: AgentModelConfig | null
    ) => AgentModelConfig;
    expect(
      updater(
        baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: 'sk-existing-anthropic',
          anthropicBaseUrl: 'https://api.anthropic.com/v1',
          openaiApiKey: 'sk-existing-openai',
        })
      )
    ).toMatchObject({
      configMode: 'third_party',
      modelProvider: 'anthropic',
      anthropicModelName: 'deepseek-v4-pro',
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
      anthropicApiKey: 'sk-existing-anthropic',
      openaiApiKey: 'sk-existing-openai',
    });
  });

  it('fills company gateway preset with official defaults and keeps existing api key', () => {
    const setLocalConfig = vi.fn();
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: 'sk-existing-anthropic',
          anthropicBaseUrl: 'https://api.anthropic.com/v1',
        })}
        setLocalConfig={setLocalConfig}
        runtimeInfo={baseRuntimeInfo()}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    fireEvent.click(view.getByRole('button', { name: '快速填充 公司网关' }));

    expect(setLocalConfig).toHaveBeenCalledTimes(1);
    const updater = setLocalConfig.mock.calls[0][0] as (
      current: AgentModelConfig | null
    ) => AgentModelConfig;
    expect(
      updater(
        baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: 'sk-existing-anthropic',
          anthropicBaseUrl: 'https://api.anthropic.com/v1',
        })
      )
    ).toMatchObject({
      configMode: 'official',
      modelProvider: 'anthropic',
      anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic',
      anthropicModelName: '',
      anthropicApiKey: 'sk-existing-anthropic',
    });
  });

  it('opens the official api key portal from model settings', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig()}
        setLocalConfig={vi.fn()}
        runtimeInfo={baseRuntimeInfo()}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    fireEvent.click(view.getByRole('button', { name: '查看Key' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://anapi-uat.annto.com/api-key-portal',
      '_blank',
      'noreferrer'
    );
  });

  it('shows warning when process_env fallback appears unexpectedly', () => {
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig()}
        setLocalConfig={vi.fn()}
        runtimeInfo={baseRuntimeInfo({
          authSource: 'process_env',
          selectedAuthSource: 'user_claude_settings',
          available: false,
          isUnexpectedProcessEnvFallback: true,
          reason: '检测到内部环境来源。',
        })}
        selectedAuthSource="user_claude_settings"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    expect(
      view.getByText(
        '检测到未受支持的内部环境来源，请重新选择“用户级 Claude settings”或“项目模型配置”并重新测试。'
      )
    ).toBeTruthy();
  });

  it('allows direct anthropic model input without datalist suggestions', () => {
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig({
          configMode: 'third_party',
          anthropicModelName: 'claude-sonnet-4-20250514',
        })}
        setLocalConfig={vi.fn()}
        runtimeInfo={null}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={null}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    const input = getInputBySectionLabel(view.container, 'Anthropic 模型');
    expect(input.getAttribute('list')).toBeNull();
    expect(document.getElementById('anthropic-model-suggestions')).toBeNull();
  });

  it('trims surrounding whitespace with trimOptionalValue', () => {
    expect(trimOptionalValue('  claude-3-7-sonnet  ')).toBe('claude-3-7-sonnet');
    expect(trimOptionalValue('   ')).toBeUndefined();
    expect(trimOptionalValue(undefined)).toBeUndefined();
  });


  it('renders official mode with fixed gateway and quota info', () => {
    const view = render(
      <ModelSettings
        localConfig={baseModelConfig({
          configMode: 'official',
          anthropicModelName: 'claude-sonnet-4-6',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        })}
        setLocalConfig={vi.fn()}
        runtimeInfo={null}
        selectedAuthSource="project_model_config"
        userClaudeSettings={baseUserClaudeSettings()}
        userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
        onChangeUserClaudeSettingsText={vi.fn()}
        officialModels={[{ id: 'claude-sonnet-4-6', ownedBy: 'openai' }]}
        officialModelsPending={false}
        officialModelsError={null}
        officialQuota={{
          usagePercent: 15.6,
          nextResetTime: '2026-05-21T00:00:00+00:00',
          resetCycle: 'daily',
        }}
        officialQuotaPending={false}
        officialQuotaError={null}
        onRefreshOfficialData={vi.fn()}
        onSelectAuthSource={vi.fn()}
        onSaveUserClaudeSettings={vi.fn()}
        onSaveProjectConfig={vi.fn()}
        onTestUserClaudeSettings={vi.fn()}
        onTestProjectModelConfig={vi.fn()}
        userClaudeSettingsTestResult={null}
        userClaudeSettingsSavePending={false}
        userClaudeSettingsTestPending={false}
        projectModelConfigTestResult={null}
        projectModelConfigTestPending={false}
      />
    );

    expect(view.getByDisplayValue('https://anapi-uat.annto.com/api-sse-anthropic')).toBeTruthy();
    expect(view.getByText('已使用 15.6%')).toBeTruthy();
    expect(view.getByText(/重置周期：daily/)).toBeTruthy();
  });

  it('does not warn when the official model select receives a value after first render', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const windowConsoleErrorSpy = vi.spyOn(window.console, 'error').mockImplementation(() => {});
    const sharedProps = {
      setLocalConfig: vi.fn(),
      runtimeInfo: null,
      selectedAuthSource: 'project_model_config' as const,
      userClaudeSettings: baseUserClaudeSettings(),
      userClaudeSettingsText: baseUserClaudeSettings().rawJson ?? '',
      onChangeUserClaudeSettingsText: vi.fn(),
      onSelectAuthSource: vi.fn(),
      officialModels: [{ id: 'claude-sonnet-4-6', ownedBy: 'openai' }],
      officialModelsPending: false,
      officialModelsError: null,
      officialQuota: null,
      officialQuotaPending: false,
      officialQuotaError: null,
      onRefreshOfficialData: vi.fn(),
      onSaveProjectConfig: vi.fn(),
      onSaveUserClaudeSettings: vi.fn(),
      onApplyDetectedCliConfig: vi.fn(),
      onTestUserClaudeSettings: vi.fn(),
      onTestProjectModelConfig: vi.fn(),
      userClaudeSettingsTestResult: null,
      userClaudeSettingsSavePending: false,
      userClaudeSettingsTestPending: false,
      projectModelConfigTestResult: null,
      projectModelConfigTestPending: false,
    };

    const view = render(
      <ModelSettings
        {...sharedProps}
        localConfig={baseModelConfig({
          configMode: 'official',
          anthropicModelName: undefined,
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        })}
      />
    );

    view.rerender(
      <ModelSettings
        {...sharedProps}
        localConfig={baseModelConfig({
          configMode: 'official',
          anthropicModelName: 'claude-sonnet-4-6',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        })}
      />
    );

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(windowConsoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    windowConsoleErrorSpy.mockRestore();
  });

  it('keeps the anthropic url input empty after clearing it in third-party mode', () => {
    function StatefulModelSettings() {
      const [localConfig, setLocalConfig] = useState<AgentModelConfig | null>(
        baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-third-party',
          anthropicBaseUrl: 'https://example.com/anthropic/v1',
        })
      );

      if (!localConfig) {
        throw new Error('localConfig 不应为空');
      }

      return (
        <ModelSettings
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          runtimeInfo={baseRuntimeInfo({
            authSource: 'project_model_config',
            selectedAuthSource: 'project_model_config',
            claudeCliAvailable: false,
            reason: '当前使用项目模型配置作为运行时认证来源。',
          })}
          selectedAuthSource="project_model_config"
          userClaudeSettings={baseUserClaudeSettings()}
          userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
          onChangeUserClaudeSettingsText={vi.fn()}
          officialModels={[]}
          officialModelsPending={false}
          officialModelsError={null}
          officialQuota={null}
          officialQuotaPending={false}
          officialQuotaError={null}
          onRefreshOfficialData={vi.fn()}
          onSelectAuthSource={vi.fn()}
          onSaveUserClaudeSettings={vi.fn()}
          onSaveProjectConfig={vi.fn()}
          onTestUserClaudeSettings={vi.fn()}
          onTestProjectModelConfig={vi.fn()}
          userClaudeSettingsTestResult={null}
          userClaudeSettingsSavePending={false}
          userClaudeSettingsTestPending={false}
          projectModelConfigTestResult={null}
          projectModelConfigTestPending={false}
        />
      );
    }

    const view = render(
      <StatefulModelSettings />
    );

    const input = getInputBySectionLabel(view.container, 'Anthropic URL');
    expect(input.value).toBe('https://example.com/anthropic/v1');

    fireEvent.change(input, { target: { value: '' } });

    expect(input.value).toBe('');
  });

  it('keeps the anthropic model input empty after clearing it in third-party mode', () => {
    function StatefulModelSettings() {
      const [localConfig, setLocalConfig] = useState<AgentModelConfig | null>(
        baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'anthropic',
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-third-party',
          anthropicBaseUrl: 'https://example.com/anthropic/v1',
        })
      );

      if (!localConfig) {
        throw new Error('localConfig 不应为空');
      }

      return (
        <ModelSettings
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          runtimeInfo={baseRuntimeInfo({
            authSource: 'project_model_config',
            selectedAuthSource: 'project_model_config',
            claudeCliAvailable: false,
            reason: '当前使用项目模型配置作为运行时认证来源。',
          })}
          selectedAuthSource="project_model_config"
          userClaudeSettings={baseUserClaudeSettings()}
          userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
          onChangeUserClaudeSettingsText={vi.fn()}
          officialModels={[]}
          officialModelsPending={false}
          officialModelsError={null}
          officialQuota={null}
          officialQuotaPending={false}
          officialQuotaError={null}
          onRefreshOfficialData={vi.fn()}
          onSelectAuthSource={vi.fn()}
          onSaveUserClaudeSettings={vi.fn()}
          onSaveProjectConfig={vi.fn()}
          onTestUserClaudeSettings={vi.fn()}
          onTestProjectModelConfig={vi.fn()}
          userClaudeSettingsTestResult={null}
          userClaudeSettingsSavePending={false}
          userClaudeSettingsTestPending={false}
          projectModelConfigTestResult={null}
          projectModelConfigTestPending={false}
        />
      );
    }

    const view = render(<StatefulModelSettings />);

    const input = getInputBySectionLabel(view.container, 'Anthropic 模型');
    expect(input.value).toBe('qwen3.6-plus');

    fireEvent.change(input, { target: { value: '' } });

    expect(input.value).toBe('');
  });

  it('keeps the openai model input empty after clearing it in third-party mode', () => {
    function StatefulModelSettings() {
      const [localConfig, setLocalConfig] = useState<AgentModelConfig | null>(
        baseModelConfig({
          configMode: 'third_party',
          modelProvider: 'openai',
          openaiModelName: 'gpt-4.1-mini',
          openaiApiKey: 'sk-openai-demo',
          openaiBaseUrl: 'https://example.com/openai/v1',
        })
      );

      if (!localConfig) {
        throw new Error('localConfig 不应为空');
      }

      return (
        <ModelSettings
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          runtimeInfo={baseRuntimeInfo({
            authSource: 'project_model_config',
            selectedAuthSource: 'project_model_config',
            claudeCliAvailable: false,
            reason: '当前使用项目模型配置作为运行时认证来源。',
          })}
          selectedAuthSource="project_model_config"
          userClaudeSettings={baseUserClaudeSettings()}
          userClaudeSettingsText={baseUserClaudeSettings().rawJson ?? ''}
          onChangeUserClaudeSettingsText={vi.fn()}
          officialModels={[]}
          officialModelsPending={false}
          officialModelsError={null}
          officialQuota={null}
          officialQuotaPending={false}
          officialQuotaError={null}
          onRefreshOfficialData={vi.fn()}
          onSelectAuthSource={vi.fn()}
          onSaveUserClaudeSettings={vi.fn()}
          onSaveProjectConfig={vi.fn()}
          onTestUserClaudeSettings={vi.fn()}
          onTestProjectModelConfig={vi.fn()}
          userClaudeSettingsTestResult={null}
          userClaudeSettingsSavePending={false}
          userClaudeSettingsTestPending={false}
          projectModelConfigTestResult={null}
          projectModelConfigTestPending={false}
        />
      );
    }

    const view = render(<StatefulModelSettings />);

    const input = getInputBySectionLabel(view.container, 'OpenAI 模型');
    expect(input.value).toBe('gpt-4.1-mini');

    fireEvent.change(input, { target: { value: '' } });

    expect(input.value).toBe('');
  });
});

describe('SettingsPanel', () => {
  it('loads model settings after the StrictMode development remount', async () => {
    routeSearch.mode = 'model';

    const view = render(
      <StrictMode>
        <SettingsPanel />
      </StrictMode>
    );

    await waitFor(() => {
      expect(view.queryByText('Loading settings...')).toBeNull();
      expect(view.container.textContent).toContain('统一模型配置');
    });
  });

  it('still renders model settings when runtime capabilities request is pending', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(
      () => new Promise(() => undefined)
    );
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));

    const view = render(<SettingsPanel />);

    await waitFor(() => {
      expect(view.queryByText('Loading settings...')).toBeNull();
      expect(view.container.textContent).toContain('统一模型配置');
    });
  });

  it('renders workspace as the left-most tab and keeps the remaining settings in the numbered order', async () => {
    routeSearch.mode = 'workspace';

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<SettingsPanel />);
    });
    await waitFor(() => {
      expect(agentClientMocks.getModelConfig).toHaveBeenCalledTimes(1);
      expect(agentClientMocks.getRuntimeCapabilities).toHaveBeenCalledTimes(1);
    });
    const settingsTabLabels = new Set([
      '工作区管理',
      '模型设置',
      'MCP 管理',
      '技能管理',
      '插件管理',
      '命令管理',
      '钩子管理',
      '用户脚本',
    ]);

    const tabButtons = view
      .getAllByRole('button')
      .map((button) => button.textContent?.trim() || '')
      .filter((text) => settingsTabLabels.has(text));

    expect(tabButtons).toEqual([
      '工作区管理',
      '模型设置',
      'MCP 管理',
      '技能管理',
      '插件管理',
      '命令管理',
      '钩子管理',
      '用户脚本',
    ]);
  });

  it('loads official model catalog and quota for official mode config', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'project_model_config' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));

    const view = render(<SettingsPanel />);

    expect(await view.findByText('额度信息')).toBeTruthy();
    await waitFor(() => {
      expect(agentClientMocks.listOfficialModelCatalog).toHaveBeenCalledWith('sk-official');
      expect(agentClientMocks.getOfficialQuota).toHaveBeenCalledWith('sk-official');
    });
    expect(view.getByText('已使用 15.6%')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '保存项目模型配置' }));
    await waitFor(() => {
      expect(agentClientMocks.updateModelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          anthropicModelName: 'gpt-5.4',
        })
      );
    });
  });

  it('loads raw user Claude settings json when project config is empty', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: {
        configMode: 'third_party',
        modelProvider: 'openai',
      },
      runtime: baseRuntimeInfo({
        hasProjectModelConfig: false,
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings({
        rawJson:
          '{\n  "env": {\n    "OPENAI_MODEL": "glm-4.5-air",\n    "OPENAI_BASE_URL": "https://open.bigmodel.cn/api/paas/v4"\n  }\n}\n',
      }),
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.getByDisplayValue(/"OPENAI_MODEL": "glm-4\.5-air"/)).toBeTruthy();
    expect(
      view.getByDisplayValue(/"OPENAI_BASE_URL": "https:\/\/open\.bigmodel\.cn\/api\/paas\/v4"/)
    ).toBeTruthy();
  });

  it('shows 工作区管理 tab and renders embedded workspace content', async () => {
    routeSearch.mode = 'workspace';
    routeSearch.projectPath = '/tmp/project';
    routeSearch.entryPath = 'captures/mock';

    const view = render(<SettingsPanel />);

    expect(view.getByRole('button', { name: '工作区管理' })).toBeTruthy();
    expect(await view.findByTestId('agent-workspaces-content')).toBeTruthy();
    expect(view.getByText('embedded:empty:/tmp/project:captures/mock')).toBeTruthy();
  });

  it('shows 用户脚本 tab and renders embedded userscripts workspace content', async () => {
    routeSearch.mode = 'userscripts';

    const view = render(<SettingsPanel />);

    expect(view.getByRole('button', { name: '用户脚本' })).toBeTruthy();
    expect(await view.findByTestId('userscripts-workspace-content')).toBeTruthy();
    expect(view.getByText('userscripts:default:none')).toBeTruthy();
  });

  it('shows MCP 管理 tab and renders mcp settings content', async () => {
    routeSearch.mode = 'mcp';

    const view = render(<SettingsPanel />);

    expect(view.getByRole('button', { name: 'MCP 管理' })).toBeTruthy();
    expect(await view.findByTestId('mcp-settings-content')).toBeTruthy();
    expect(view.getByText('mcp-settings')).toBeTruthy();
  });

  it('does not show 运行时能力 tab in settings', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.queryByRole('button', { name: '运行时能力' })).toBeNull();
  });

  it('falls back to model when route mode is legacy runtime', async () => {
    routeSearch.mode = 'runtime';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.getByRole('button', { name: '模型设置' }).getAttribute('class')).toContain(
      'bg-primary'
    );
    expect(view.queryByRole('button', { name: '运行时能力' })).toBeNull();
  });

  it('shows source switcher with unified form and hides legacy top chooser', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.queryByText('当前使用方式')).toBeNull();
    expect(view.queryByText('当前生效状态')).toBeNull();
    expect(view.queryByRole('button', { name: '应用当前使用方式' })).toBeNull();
    expect(view.getByText('统一模型配置')).toBeTruthy();
    expect(view.getByRole('button', { name: '选择 项目模型配置' })).toBeTruthy();
    expect(view.getByRole('button', { name: '选择 用户级 Claude settings' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '选择 项目模型配置' }));
    expect(view.getByRole('button', { name: '快速填充 公司网关' })).toBeTruthy();
    expect(view.queryByText('继承用户级 Claude settings')).toBeNull();
    expect(view.queryByText('允许外部浏览器自动化')).toBeNull();
  });

  it('prefers project model config defaults when project config is empty', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'project_model_config' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: {
        configMode: 'third_party',
        modelProvider: 'openai',
      },
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        hasProjectModelConfig: false,
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.getByDisplayValue('https://anapi-uat.annto.com/api-sse-anthropic')).toBeTruthy();
  });

  it('switches current auth source immediately when clicking another auth card', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    fireEvent.click(view.getByRole('button', { name: '选择 项目模型配置' }));

    await waitFor(() => {
      expect(agentClientMocks.updateRuntimeCapabilities).toHaveBeenCalledWith({
        selectedAuthSource: 'project_model_config',
      });
    });
  });

  it('tests user Claude settings independently from project config', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    agentClientMocks.testModelConfig.mockClear();
    fireEvent.click(view.getByRole('button', { name: '测试用户级 Claude settings' }));

    await waitFor(() => {
      expect(agentClientMocks.testModelConfig).toHaveBeenCalledTimes(1);
    });
    expect(agentClientMocks.testModelConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetAuthSource: 'user_claude_settings',
      })
    );
  });

  it('saves current user Claude settings json to disk', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    fireEvent.click(view.getByRole('button', { name: '保存用户级 Claude settings' }));

    await waitFor(() => {
      expect(agentClientMocks.updateUserClaudeSettings).toHaveBeenCalledTimes(1);
    });
    expect(agentClientMocks.updateUserClaudeSettings).toHaveBeenCalledWith(
      expect.stringContaining('"OPENAI_BASE_URL": "https://api.deepseek.com/v1"')
    );
  });

  it('tests project model config independently from user Claude settings', async () => {
    routeSearch.mode = 'model';

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    agentClientMocks.testModelConfig.mockClear();
    fireEvent.click(view.getByRole('button', { name: '选择 项目模型配置' }));
    fireEvent.click(view.getByRole('button', { name: '测试项目模型配置' }));

    await waitFor(() => {
      expect(agentClientMocks.testModelConfig).toHaveBeenCalledTimes(1);
    });
    expect(agentClientMocks.testModelConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetAuthSource: 'project_model_config',
      })
    );
  });

  it('auto tests both auth sources after the model settings panel loads for the first time', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'user_claude_settings' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    await waitFor(() => {
      expect(agentClientMocks.testModelConfig).toHaveBeenCalledTimes(2);
    });
    expect(agentClientMocks.testModelConfig).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({
        targetAuthSource: 'user_claude_settings',
      })
    );
    expect(agentClientMocks.testModelConfig).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        targetAuthSource: 'project_model_config',
      })
    );
    expect(view.queryByText('尚未测试')).toBeNull();
  });

  it('clears unavailable-source warning after project model config test succeeds', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'project_model_config' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        available: false,
        reason: '当前选中的来源不可用。',
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));
    agentClientMocks.testModelConfig
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: false,
          message: '用户级 Claude settings 自动测试失败',
          runtimeAuthSummary: '认证摘要 | source=user_claude_settings | available=false',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'user_claude_settings',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '自动测试失败',
          }),
        },
      }))
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: false,
          message: '项目模型配置自动测试失败',
          runtimeAuthSummary: '认证摘要 | source=project_model_config | available=false',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'project_model_config',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '自动测试失败',
          }),
        },
      }))
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: true,
          message: '项目模型配置测试成功',
          runtimeAuthSummary: '认证摘要 | source=project_model_config | available=true',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'project_model_config',
            selectedAuthSource: options?.targetAuthSource ?? 'project_model_config',
            available: true,
            reason: '测试成功',
          }),
        },
      }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(
      view.getByText('当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。')
    ).toBeTruthy();

    agentClientMocks.testModelConfig.mockClear();
    fireEvent.click(view.getByRole('button', { name: '测试项目模型配置' }));

    await waitFor(() => {
      expect(agentClientMocks.testModelConfig).toHaveBeenCalledTimes(1);
      expect(
        view.queryByText(
          '当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。'
        )
      ).toBeNull();
    });
  });

  it('updates runtime warning state after saving project model config', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'project_model_config' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        available: false,
        reason: '当前选中的来源不可用。',
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));
    agentClientMocks.testModelConfig
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: false,
          message: '用户级 Claude settings 自动测试失败',
          runtimeAuthSummary: '认证摘要 | source=user_claude_settings | available=false',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'user_claude_settings',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '自动测试失败',
          }),
        },
      }))
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: false,
          message: '项目模型配置自动测试失败',
          runtimeAuthSummary: '认证摘要 | source=project_model_config | available=false',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'project_model_config',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '自动测试失败',
          }),
        },
      }));
    agentClientMocks.updateModelConfig.mockImplementationOnce(async (config) => ({
      config,
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        available: true,
        reason: '保存后已可用。',
      }),
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(
      view.getByText('当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。')
    ).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '保存项目模型配置' }));

    await waitFor(() => {
      expect(agentClientMocks.updateModelConfig).toHaveBeenCalledTimes(1);
      expect(agentClientMocks.updateRuntimeCapabilities).toHaveBeenCalledWith({
        selectedAuthSource: 'project_model_config',
      });
      expect(
        view.queryByText(
          '当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。'
        )
      ).toBeNull();
    });
  });

  it('keeps project model config editor selected after saving even when runtime stays on user Claude settings', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'user_claude_settings' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));
    agentClientMocks.updateModelConfig.mockImplementationOnce(async (config) => ({
      config,
      runtime: baseRuntimeInfo({
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
      }),
    }));
    agentClientMocks.updateRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'user_claude_settings' as AgentAuthSource,
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    fireEvent.click(view.getByRole('button', { name: '选择 项目模型配置' }));
    fireEvent.click(view.getByRole('button', { name: '保存项目模型配置' }));

    await waitFor(() => {
      expect(agentClientMocks.updateModelConfig).toHaveBeenCalledTimes(1);
    });

    expect(view.getByRole('button', { name: '选择 项目模型配置' }).getAttribute('class')).toContain(
      'bg-primary'
    );
    expect(view.container.textContent).toContain('当前生效：用户级 Claude settings');
  });

  it('hides unavailable-source warning when the selected source test already succeeded', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities.mockImplementationOnce(async () => ({
      selectedAuthSource: 'project_model_config' as AgentAuthSource,
    }));
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig(),
      runtime: baseRuntimeInfo({
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        available: false,
        reason: '当前选中的来源不可用。',
      }),
      detectedCliConfig: null,
      userClaudeSettings: baseUserClaudeSettings(),
    }));
    agentClientMocks.testModelConfig
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: false,
          message: '用户级 Claude settings 自动测试失败',
          runtimeAuthSummary: '认证摘要 | source=user_claude_settings | available=false',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'user_claude_settings',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '自动测试失败',
          }),
        },
      }))
      .mockImplementationOnce(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: true,
          message: '项目模型配置测试成功',
          runtimeAuthSummary: '认证摘要 | source=project_model_config | available=true',
          runtime: baseRuntimeInfo({
            authSource: options?.targetAuthSource ?? 'project_model_config',
            selectedAuthSource: 'project_model_config',
            available: false,
            reason: '运行时状态尚未刷新',
          }),
        },
      }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(
      view.queryByText('当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。')
    ).toBeNull();
    expect(view.container.textContent).toContain('测试成功');
  });

  it('refreshes model settings when model access changes externally', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getRuntimeCapabilities
      .mockImplementationOnce(async () => ({
        selectedAuthSource: 'user_claude_settings' as AgentAuthSource,
      }))
      .mockImplementationOnce(async () => ({
        selectedAuthSource: 'project_model_config' as AgentAuthSource,
      }));
    agentClientMocks.getModelConfig
      .mockImplementationOnce(async () => ({
        config: baseModelConfig({
          anthropicApiKey: undefined,
        }),
        runtime: baseRuntimeInfo({
          authSource: 'user_claude_settings',
          selectedAuthSource: 'user_claude_settings',
          available: false,
        }),
        detectedCliConfig: null,
        userClaudeSettings: baseUserClaudeSettings(),
      }))
      .mockImplementationOnce(async () => ({
        config: baseModelConfig({
          anthropicApiKey: 'sk-official-updated',
        }),
        runtime: baseRuntimeInfo({
          authSource: 'project_model_config',
          selectedAuthSource: 'project_model_config',
          available: true,
        }),
        detectedCliConfig: null,
        userClaudeSettings: baseUserClaudeSettings(),
      }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.container.textContent).toContain('当前生效：用户级 Claude settings');

    act(() => {
      window.dispatchEvent(new window.CustomEvent(MODEL_ACCESS_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(agentClientMocks.getModelConfig).toHaveBeenCalledTimes(2);
      expect(agentClientMocks.getRuntimeCapabilities).toHaveBeenCalledTimes(2);
      expect(view.container.textContent).toContain('当前生效：项目模型配置');
    });
  });

  it('does not expose process_env as a selectable third option', async () => {
    routeSearch.mode = 'model';
    agentClientMocks.getModelConfig.mockImplementationOnce(async () => ({
      config: baseModelConfig({
        configMode: 'third_party',
        modelProvider: 'openai',
        openaiModelName: 'gpt-4o',
        openaiBaseUrl: 'https://api.openai.com/v1',
      }),
      runtime: baseRuntimeInfo({
        authSource: 'process_env',
        selectedAuthSource: 'user_claude_settings',
        available: false,
        hasProjectModelConfig: false,
        claudeCliAvailable: false,
        isUnexpectedProcessEnvFallback: true,
        reason: '检测到内部环境来源。',
      }),
    }));

    const view = render(<SettingsPanel />);

    await waitForModelSettingsReady(view);
    expect(view.container.textContent).toContain('未检测到本地 Claude Code CLI');
    expect(view.queryByRole('radio', { name: /进程环境变量/ })).toBeNull();
  });
});
