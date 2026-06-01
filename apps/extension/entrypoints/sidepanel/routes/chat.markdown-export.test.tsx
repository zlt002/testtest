// @vitest-environment node

import { fireEvent, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRunItem, RunCard } from '../lib/agent-v2/run-cards';
import type { DisplayMessage, SessionSubagentSnapshot } from '../lib/agent-v2/types';

const toastMocks = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  mockClipboardWriteText: vi.fn(async () => undefined),
  mockCreateObjectURL: vi.fn(() => 'blob:mock-export'),
  mockRevokeObjectURL: vi.fn(),
}));

const mockStreamState = {
  status: 'idle' as const,
  error: null as string | null,
  contextPercent: 0,
  activeRunId: null as string | null,
  sessionId: null as string | null,
  tools: [] as unknown[],
  conversationItems: [] as ConversationRunItem[],
  sendMessage: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  loadHistory: vi.fn(),
  restoreSessionRunState: vi.fn(),
  appendAssistantMessage: vi.fn(),
  resolveInteraction: vi.fn(),
};

const mockSessionsState = {
  clearSessions: vi.fn(),
  loadHistory: vi.fn(async () => ({
    sessionId: 'session-1',
    messages: [],
  })),
};

const mockBootstrapGateResult = {
  status: 'ready',
  sync: {
    ok: true,
    status: 'completed',
    mode: 'remote',
  },
  modelAccess: {
    selectedAuthSource: 'user_claude_settings',
    runtimeInfo: {
      authSource: 'user_claude_settings',
      selectedAuthSource: 'user_claude_settings',
      available: true,
      claudeCliAvailable: true,
      hasProjectModelConfig: true,
      reason: '测试可用',
    },
    localConfig: {
      configMode: 'official',
      modelProvider: 'anthropic',
      providerVariant: 'standard',
      anthropicModelName: 'qwen3.6-plus',
      anthropicApiKey: 'sk-official',
      anthropicBaseUrl: 'https://example.com/v1',
    },
    userClaudeSettings: null,
    userClaudeSettingsText: '{}\n',
    userClaudeSettingsTestResult: {
      ok: true,
      message: '测试成功',
      runtimeAuthSummary: '认证摘要',
      runtime: {
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '测试成功',
      },
    },
    projectModelConfigTestResult: {
      ok: true,
      message: '测试成功',
      runtimeAuthSummary: '认证摘要',
      runtime: {
        authSource: 'project_model_config',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '测试成功',
      },
    },
    viewState: {
      overallStatus: 'available',
      summary: '已检测到可用模型配置。',
      userClaudeSettings: 'success',
      projectModelConfig: 'success',
    },
  },
};

function resetMockBootstrapGateResult() {
  mockBootstrapGateResult.modelAccess.selectedAuthSource = 'user_claude_settings';
  mockBootstrapGateResult.modelAccess.runtimeInfo = {
    authSource: 'user_claude_settings',
    selectedAuthSource: 'user_claude_settings',
    available: true,
    claudeCliAvailable: true,
    hasProjectModelConfig: true,
    reason: '测试可用',
  };
  mockBootstrapGateResult.modelAccess.localConfig = {
    configMode: 'official',
    modelProvider: 'anthropic',
    providerVariant: 'standard',
    anthropicModelName: 'qwen3.6-plus',
    anthropicApiKey: 'sk-official',
    anthropicBaseUrl: 'https://example.com/v1',
  };
  mockBootstrapGateResult.modelAccess.userClaudeSettings = null;
  mockBootstrapGateResult.modelAccess.userClaudeSettingsText = '{}\n';
  mockBootstrapGateResult.modelAccess.userClaudeSettingsTestResult = {
    ok: true,
    message: '测试成功',
    runtimeAuthSummary: '认证摘要',
    runtime: {
      authSource: 'user_claude_settings',
      selectedAuthSource: 'user_claude_settings',
      available: true,
      claudeCliAvailable: true,
      hasProjectModelConfig: true,
      reason: '测试成功',
    },
  };
  mockBootstrapGateResult.modelAccess.projectModelConfigTestResult = {
    ok: true,
    message: '测试成功',
    runtimeAuthSummary: '认证摘要',
    runtime: {
      authSource: 'project_model_config',
      selectedAuthSource: 'user_claude_settings',
      available: true,
      claudeCliAvailable: true,
      hasProjectModelConfig: true,
      reason: '测试成功',
    },
  };
  mockBootstrapGateResult.modelAccess.viewState = {
    overallStatus: 'available',
    summary: '已检测到可用模型配置。',
    userClaudeSettings: 'success',
    projectModelConfig: 'success',
  };
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
}));

vi.mock('../lib/config', () => ({
  config: {
    api: {
      agentV2BaseUrl: 'http://localhost:3000',
      agentV2Endpoint: '/api/agent-v2',
    },
  },
}));

vi.mock('../lib/agent-v2/useAgentV2Chat', () => ({
  useAgentV2Chat: () => mockStreamState,
}));

vi.mock('../lib/agent-v2/useAgentV2Sessions', () => ({
  useAgentV2Sessions: () => mockSessionsState,
}));

vi.mock('../lib/agent-v2/client', () => ({
  findRemovedUploadedSessionAttachments: vi.fn(() => []),
  createAgentV2Client: () => ({
    getCapabilities: vi.fn(async () => ({ workdir: '/tmp/project' })),
    getRuntimeCapabilities: vi.fn(async () => ({ selectedAuthSource: 'user_claude_settings' })),
    listProjects: vi.fn(async () => []),
    getSystemUpdateInfo: vi.fn(async () => ({ updateAvailable: false })),
    analyzeDom: vi.fn(async () => ({})),
    markSessionInterrupted: vi.fn(async () => undefined),
    listCommands: vi.fn(async () => ({
      skills: [],
      project: [],
      user: [],
      localUi: [],
    })),
    executeCommand: vi.fn(async () => null),
    getSessionRunState: vi.fn(async () => null),
    openFileEntry: vi.fn(async () => undefined),
    getModelConfig: vi.fn(async () => ({
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'qwen3.6-plus',
        anthropicApiKey: 'sk-official',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      runtime: {
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '测试可用',
      },
      detectedCliConfig: null,
      userClaudeSettings: {
        path: '/Users/test/.claude/settings.json',
        exists: true,
        rawJson: '{}',
      },
    })),
    testModelConfig: vi.fn(async () => ({
      result: {
        ok: true,
        message: '测试成功',
        runtimeAuthSummary: '认证摘要',
        runtime: {
          authSource: 'user_claude_settings',
          selectedAuthSource: 'user_claude_settings',
          available: true,
          claudeCliAvailable: true,
          hasProjectModelConfig: true,
          reason: '测试成功',
        },
      },
    })),
    updateModelConfig: vi.fn(async () => undefined),
    updateRuntimeCapabilities: vi.fn(async () => undefined),
  }),
}));

vi.mock('../lib/agent-v2/storage', () => ({
  persistToolEvents: vi.fn(),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  isAgentV2ComposerAppendMessage: vi.fn(() => false),
  isAgentV2ProjectSelectedMessage: vi.fn(() => false),
  isAgentV2QuickActionFeedbackMessage: vi.fn(() => false),
  isAgentV2SessionSelectedMessage: vi.fn(() => false),
  publishAgentV2CurrentSession: vi.fn(async () => undefined),
  publishAgentV2ProjectSelection: vi.fn(async () => undefined),
  publishAgentV2WorkspaceIntent: vi.fn(async () => undefined),
  readAgentV2ComposerAppend: vi.fn(async () => null),
  readAgentV2ProjectSelection: vi.fn(async () => ({
    projectPath: '/tmp/project',
    selectedAt: '2026-05-28T04:00:00.000Z',
  })),
  readAgentV2QuickActionFeedback: vi.fn(async () => null),
  readAgentV2SessionSelectedTabs: vi.fn(async () => null),
  readAgentV2SessionSelection: vi.fn(async () => null),
  writeAgentV2SessionSelectedTabs: vi.fn(async () => undefined),
}));

vi.mock('../lib/agent-v2/active-run-session', () => ({
  clearAgentV2ActiveRunSession: vi.fn(async () => undefined),
  readAgentV2ActiveRunSession: vi.fn(async () => null),
}));

vi.mock('../lib/browser-context', () => ({
  getBrowserContext: vi.fn(async () => undefined),
}));

vi.mock('../lib/page-capture', () => ({
  triggerWorkspacePageCapture: vi.fn(async () => ({
    entryPath: 'captures/mock.html',
    warningCount: 0,
  })),
}));

vi.mock('../lib/page-edit', () => ({
  getPageEditActivationSuccessMessage: vi.fn(() => '进入编辑成功'),
  getPageEditSuccessMessage: vi.fn(() => '退出编辑成功'),
  getPageEditToggleLabel: vi.fn(() => '页面编辑'),
  isPageEditActive: vi.fn(() => false),
  resolvePageEditTabId: vi.fn(async () => null),
}));

vi.mock('../lib/sidepanel-menu', () => ({
  openSidepanelRoute: vi.fn(async () => undefined),
  SIDEPANEL_MENU_ITEMS: [],
}));

vi.mock('../lib/bootstrap-gate', () => ({
  useBootstrapGateState: () => ({
    status: 'ready',
    result: mockBootstrapGateResult,
    backgroundSync: {
      status: 'completed',
    },
    retry: vi.fn(async () => undefined),
    retrySync: vi.fn(async () => undefined),
  }),
}));

vi.mock('../lib/trpc_client', () => ({
  trpc: {
    pageCapture: {
      capture: {
        useMutation: () => ({
          mutateAsync: vi.fn(async () => ({
            entryPath: 'captures/mock.html',
            warningCount: 0,
          })),
          isPending: false,
        }),
      },
    },
    pageSelection: {
      readPageContent: {
        useMutation: () => ({
          mutateAsync: vi.fn(async () => ({ text: '' })),
          isPending: false,
        }),
      },
    },
    pageEdit: {
      getState: {
        useQuery: () => ({
          data: null,
          isLoading: false,
          refetch: vi.fn(async () => ({ data: null })),
        }),
      },
      activate: {
        useMutation: () => ({
          mutateAsync: vi.fn(async () => null),
          isPending: false,
        }),
      },
      deactivate: {
        useMutation: () => ({
          mutateAsync: vi.fn(async () => null),
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock('../lib/window-takeover', () => ({
  allowWindowTakeoverNavigation: vi.fn(async () => undefined),
  getWindowTakeoverState: vi.fn(async () => null),
  isWindowTakeoverConfirmationRequiredMessage: vi.fn(() => false),
  isWindowTakeoverStateChangedMessage: vi.fn(() => false),
  resolveWindowTakeoverLeaveDecision: vi.fn(async () => undefined),
  startWindowTakeover: vi.fn(async () => null),
  stopWindowTakeover: vi.fn(async () => undefined),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.mockToastSuccess,
    error: toastMocks.mockToastError,
  },
}));

vi.mock('@/entrypoints/sidepanel/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/entrypoints/sidepanel/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/entrypoints/sidepanel/components/agent-composer/AgentComposer', () => ({
  AgentComposer: () => <textarea aria-label="对话输入框" />,
}));

import { Chat } from './chat.index';

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
  vi.stubGlobal('HTMLAnchorElement', dom.window.HTMLAnchorElement);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('NodeFilter', dom.window.NodeFilter);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('crypto', dom.window.crypto);
});

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

function installBrowserMocks() {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn((value: string) => value),
      sendMessage: vi.fn(async () => undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: 1 })),
    },
    tabs: {
      create: vi.fn(async () => ({ id: 2 })),
      get: vi.fn(async () => null),
      query: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: 2 })),
    },
  });

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: browserMocks.mockClipboardWriteText,
    },
  });
  Object.defineProperty(window.URL, 'createObjectURL', {
    configurable: true,
    value: browserMocks.mockCreateObjectURL,
  });
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    configurable: true,
    value: browserMocks.mockRevokeObjectURL,
  });
  vi.stubGlobal('URL', window.URL);
}

function message(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: overrides.id || 'message-1',
    sessionId: overrides.sessionId || 'session-1',
    role: overrides.role || 'assistant',
    kind: overrides.kind || 'text',
    text: overrides.text || '',
    timestamp: overrides.timestamp || '2026-05-28T04:00:00.000Z',
    ...overrides,
  };
}

function runCard(overrides: Partial<RunCard> = {}): RunCard {
  return {
    id: overrides.id || 'run-1',
    sessionId: overrides.sessionId || 'session-1',
    runId: overrides.runId || 'run-1',
    anchorMessageId: overrides.anchorMessageId || null,
    cardStatus: overrides.cardStatus || 'completed',
    headline: overrides.headline || '已完成',
    finalResponse: overrides.finalResponse || '',
    responseMessages: overrides.responseMessages || [],
    processItems: overrides.processItems || [],
    processItemCount: overrides.processItemCount || 0,
    previewItems: overrides.previewItems || [],
    todos: overrides.todos || [],
    files: overrides.files || [],
    activeInteraction: overrides.activeInteraction || null,
    startedAt: overrides.startedAt || '2026-05-28T04:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-05-28T04:00:10.000Z',
    source: overrides.source || 'sdk-live',
    subagents: overrides.subagents || [],
  };
}

function subagent(overrides: Partial<SessionSubagentSnapshot> = {}): SessionSubagentSnapshot {
  return {
    agentId: overrides.agentId || 'subagent-1',
    title: overrides.title || '调研佛山天气气候',
    status: overrides.status || 'running',
    startedAt: overrides.startedAt || '2026-05-28T04:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-05-28T04:00:04.000Z',
    latestSummary: overrides.latestSummary || '正在查询近 7 天天气',
    latestToolName: overrides.latestToolName || 'WebSearch',
    messageCount: overrides.messageCount || 1,
    toolCount: overrides.toolCount || 1,
    activities: overrides.activities || [
      {
        id: 'activity-1',
        timestamp: '2026-05-28T04:00:04.000Z',
        kind: 'message',
        title: '最新进展',
        detail: '正在查询近 7 天天气',
      },
    ],
  };
}

describe('Chat markdown export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockBootstrapGateResult();
    installBrowserMocks();
    mockStreamState.status = 'idle';
    mockStreamState.error = null;
    mockStreamState.contextPercent = 0;
    mockStreamState.activeRunId = null;
    mockStreamState.sessionId = 'session-1';
    mockStreamState.tools = [];
    mockStreamState.conversationItems = [];
    mockStreamState.sendMessage = vi.fn();
    mockStreamState.stop = vi.fn();
    mockStreamState.reset = vi.fn();
    mockStreamState.loadHistory = vi.fn();
    mockStreamState.restoreSessionRunState = vi.fn();
    mockStreamState.appendAssistantMessage = vi.fn();
    mockStreamState.resolveInteraction = vi.fn();
    toastMocks.mockToastSuccess.mockReset();
    toastMocks.mockToastError.mockReset();
    browserMocks.mockClipboardWriteText.mockReset();
    browserMocks.mockCreateObjectURL.mockClear();
    browserMocks.mockRevokeObjectURL.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('exports current conversation as markdown from the header menu', async () => {
    mockStreamState.conversationItems = [
      {
        type: 'user',
        message: message({
          id: 'user-1',
          role: 'user',
          text: '请总结当前页面',
          timestamp: '2026-05-28T04:00:00.000Z',
        }),
      },
      {
        type: 'run',
        card: runCard({
          id: 'run-export',
          responseMessages: [
            {
              id: 'assistant-1',
              timestamp: '2026-05-28T04:00:08.000Z',
              body: '这是导出的回答',
            },
          ],
        }),
      },
    ];

    const view = render(<Chat />);

    fireEvent.click(view.getByRole('button', { name: '更多配置' }));
    fireEvent.click(await view.findByRole('button', { name: '导出 Markdown' }));

    await waitFor(async () => {
      expect(browserMocks.mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const blob = browserMocks.mockCreateObjectURL.mock.calls[0]?.[0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      await expect(blob.text()).resolves.toContain('# 会话记录');
      await expect(blob.text()).resolves.toContain('请总结当前页面');
      await expect(blob.text()).resolves.toContain('这是导出的回答');
    });
    expect(toastMocks.mockToastSuccess).toHaveBeenCalledWith('会话 Markdown 已开始导出');
  });

  it('copies assistant response markdown from the run card action', async () => {
    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: runCard({
          id: 'run-copy',
          responseMessages: [
            {
              id: 'assistant-copy',
              timestamp: '2026-05-28T06:00:08.000Z',
              body: '复制这段回答',
            },
          ],
        }),
      },
    ];

    const view = render(<Chat />);

    fireEvent.click(await view.findByRole('button', { name: '助手回答操作 run-copy' }));
    fireEvent.click(await view.findByRole('button', { name: '复制 Markdown' }));

    await waitFor(() => {
      expect(browserMocks.mockClipboardWriteText).toHaveBeenCalledWith(
        '## 助手 · 2026-05-28 14:00:08\n\n复制这段回答'
      );
    });
    expect(toastMocks.mockToastSuccess).toHaveBeenCalledWith('Markdown 已复制');
  });

  it('用户手动收起子代理后，后续更新不会自动重新展开，并在折叠行显示最新活动', async () => {
    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: runCard({
          id: 'run-subagents',
          runId: 'run-subagents',
          cardStatus: 'running',
          headline: '执行中',
          subagents: [
            subagent({
              agentId: 'subagent-weather',
              title: '调研佛山天气气候',
              updatedAt: '2026-05-28T04:00:04.000Z',
              latestSummary: '正在查询近 7 天天气',
            }),
          ],
        }),
      },
    ];

    const view = render(<Chat />);

    expect(await view.findByText('调研佛山天气气候')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /子代理 1 个/i }));
    await waitFor(() => {
      expect(view.queryByText('调研佛山天气气候')).toBeNull();
    });

    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: runCard({
          id: 'run-subagents',
          runId: 'run-subagents',
          cardStatus: 'running',
          headline: '执行中',
          subagents: [
            subagent({
              agentId: 'subagent-weather',
              title: '调研佛山天气气候',
              updatedAt: '2026-05-28T04:00:10.000Z',
              latestSummary: '已切换到逐小时天气整理',
              activities: [
                {
                  id: 'activity-2',
                  timestamp: '2026-05-28T04:00:10.000Z',
                  kind: 'message',
                  title: '最新进展',
                  detail: '已切换到逐小时天气整理',
                },
              ],
            }),
          ],
        }),
      },
    ];

    view.rerender(<Chat />);

    await waitFor(() => {
      expect(view.queryByText('调研佛山天气气候')).toBeNull();
      expect(view.getByText(/最近活动：调研佛山天气气候/)).toBeTruthy();
      expect(view.getByText(/已切换到逐小时天气整理/)).toBeTruthy();
    });
  });

  it('子代理等待状态合并到子代理卡标签里，不再单独显示黄色摘要块', async () => {
    const activeUpdatedAt = new Date(Date.now() - 5_000).toISOString();
    const waitingUpdatedAt = new Date(Date.now() - 20_000).toISOString();

    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: runCard({
          id: 'run-subagent-tags',
          runId: 'run-subagent-tags',
          cardStatus: 'running',
          headline: '执行中',
          subagents: [
            subagent({
              agentId: 'subagent-economy',
              title: '调研佛山经济情况',
              updatedAt: activeUpdatedAt,
              latestSummary: '正在读取统计公报',
            }),
            subagent({
              agentId: 'subagent-weather',
              title: '调研佛山天气情况',
              updatedAt: waitingUpdatedAt,
              latestSummary: '正在等待网页读取结果',
            }),
          ],
        }),
      },
    ];

    const view = render(<Chat />);

    expect(await view.findByRole('button', { name: /子代理 2 个/i })).toBeTruthy();
    expect(view.getByText('活跃 2')).toBeTruthy();
    expect(view.getByText('工具等待 1')).toBeTruthy();
    expect(
      view.queryByText('父代理正在等待 2 个活跃子代理返回，其中 1 个疑似等待工具响应。')
    ).toBeNull();
  });

  it('首屏 bootstrap 静态判定可用时，不应回退成检测中文案', async () => {
    mockBootstrapGateResult.modelAccess.userClaudeSettingsTestResult = null;
    mockBootstrapGateResult.modelAccess.projectModelConfigTestResult = null;
    mockBootstrapGateResult.modelAccess.viewState = {
      overallStatus: 'available',
      summary: '已检测到模型配置，可直接开始对话。',
      userClaudeSettings: 'success',
      projectModelConfig: 'success',
    };

    const view = render(<Chat />);

    await waitFor(() => {
      expect(view.getByText('Claude Code 可开始使用')).toBeTruthy();
    });
    expect(view.queryByText('模型配置检测中')).toBeNull();
    expect(view.getByText('已检测到用户级 Claude settings 配置，可直接开始对话。')).toBeTruthy();
  });
});
