// @vitest-environment node

import { act, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAuthSource } from '../lib/agent-v2/types';

const mockStreamState = {
  status: 'idle' as const,
  error: null as string | null,
  contextPercent: 0,
  activeRunId: null as string | null,
  sessionId: null as string | null,
  tools: [] as unknown[],
  conversationItems: [] as unknown[],
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
  loadHistory: vi.fn(),
};

const mockOnMessageListeners = new Set<(message: unknown) => void>();

const sessionSelectionMocks = vi.hoisted(() => ({
  mockIsAgentV2ComposerAppendMessage: vi.fn(() => false),
  mockIsAgentV2ProjectSelectedMessage: vi.fn(() => false),
  mockIsAgentV2QuickActionFeedbackMessage: vi.fn(() => false),
  mockIsAgentV2SessionSelectedMessage: vi.fn(() => false),
  mockReadAgentV2ComposerAppend: vi.fn(async () => null),
  mockReadAgentV2ProjectSelection: vi.fn(async () => null),
  mockReadAgentV2QuickActionFeedback: vi.fn(async () => null),
  mockReadAgentV2SessionSelectedTabs: vi.fn(async () => null),
  mockReadAgentV2SessionSelection: vi.fn(async () => null),
  mockPublishAgentV2CurrentSession: vi.fn(async () => undefined),
  mockPublishAgentV2ProjectSelection: vi.fn(async () => undefined),
  mockPublishAgentV2WorkspaceIntent: vi.fn(async () => undefined),
  mockWriteAgentV2SessionSelectedTabs: vi.fn(async () => undefined),
}));

const activeRunSessionMocks = vi.hoisted(() => ({
  mockClearAgentV2ActiveRunSession: vi.fn(async () => undefined),
  mockReadAgentV2ActiveRunSession: vi.fn(async () => null),
}));

const clientMocks = vi.hoisted(() => ({
  mockGetCapabilities: vi.fn(async () => ({ workdir: '/tmp/project' })),
  mockListProjects: vi.fn(async () => [
    {
      projectKey: 'workspace',
      name: 'workspace',
      projectPath: '/tmp/project',
      sessionCount: 0,
    },
  ]),
  mockGetSystemUpdateInfo: vi.fn(async () => ({ updateAvailable: false })),
  mockAnalyzeDom: vi.fn(async () => ({})),
  mockMarkSessionInterrupted: vi.fn(async () => undefined),
  mockListCommands: vi.fn(async () => ({
    skills: [],
    project: [],
    user: [],
    localUi: [],
  })),
  mockExecuteCommand: vi.fn(async () => null),
  mockGetSessionRunState: vi.fn(async () => null),
  mockOpenFileEntry: vi.fn(async () => undefined),
  mockGetModelConfig: vi.fn(async () => ({
    config: {
      configMode: 'official',
      modelProvider: 'anthropic',
      anthropicModelName: 'claude-sonnet-4-20250514',
      anthropicApiKey: 'sk-official',
      anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
    },
    runtime: {
      authSource: 'user_claude_settings',
      selectedAuthSource: 'user_claude_settings',
      available: true,
      claudeCliAvailable: true,
      hasProjectModelConfig: true,
      reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
    },
    detectedCliConfig: null,
    userClaudeSettings: {
      path: '/Users/test/.claude/settings.json',
      exists: true,
      rawJson: '{}',
    },
  })),
  mockTestModelConfig: vi.fn(async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
    result: {
      ok: true,
      message:
        options?.targetAuthSource === 'project_model_config'
          ? '项目模型配置测试成功'
          : '用户级 Claude settings 测试成功',
      runtimeAuthSummary: `认证摘要 | source=${options?.targetAuthSource ?? 'user_claude_settings'}`,
      runtime: {
        authSource: options?.targetAuthSource ?? 'user_claude_settings',
        selectedAuthSource: options?.targetAuthSource ?? 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '测试成功',
      },
    },
  })),
}));

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
    getCapabilities: clientMocks.mockGetCapabilities,
    listProjects: clientMocks.mockListProjects,
    getSystemUpdateInfo: clientMocks.mockGetSystemUpdateInfo,
    analyzeDom: clientMocks.mockAnalyzeDom,
    markSessionInterrupted: clientMocks.mockMarkSessionInterrupted,
    listCommands: clientMocks.mockListCommands,
    executeCommand: clientMocks.mockExecuteCommand,
    getSessionRunState: clientMocks.mockGetSessionRunState,
    openFileEntry: clientMocks.mockOpenFileEntry,
    getModelConfig: clientMocks.mockGetModelConfig,
    testModelConfig: clientMocks.mockTestModelConfig,
  }),
}));

vi.mock('../lib/agent-v2/storage', () => ({
  persistToolEvents: vi.fn(),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  isAgentV2ComposerAppendMessage: sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage,
  isAgentV2ProjectSelectedMessage: sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage,
  isAgentV2QuickActionFeedbackMessage: sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage,
  isAgentV2SessionSelectedMessage: sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage,
  publishAgentV2CurrentSession: sessionSelectionMocks.mockPublishAgentV2CurrentSession,
  publishAgentV2ProjectSelection: sessionSelectionMocks.mockPublishAgentV2ProjectSelection,
  publishAgentV2WorkspaceIntent: sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent,
  readAgentV2ComposerAppend: sessionSelectionMocks.mockReadAgentV2ComposerAppend,
  readAgentV2ProjectSelection: sessionSelectionMocks.mockReadAgentV2ProjectSelection,
  readAgentV2QuickActionFeedback: sessionSelectionMocks.mockReadAgentV2QuickActionFeedback,
  readAgentV2SessionSelectedTabs: sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs,
  readAgentV2SessionSelection: sessionSelectionMocks.mockReadAgentV2SessionSelection,
  writeAgentV2SessionSelectedTabs: sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs,
}));

vi.mock('../lib/agent-v2/active-run-session', () => ({
  clearAgentV2ActiveRunSession: activeRunSessionMocks.mockClearAgentV2ActiveRunSession,
  readAgentV2ActiveRunSession: activeRunSessionMocks.mockReadAgentV2ActiveRunSession,
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

vi.mock('@/entrypoints/background/src/services/page-picker', () => ({
  captureDomAnalysisEvidenceForSession: vi.fn(async () => ({ text: '' })),
  startDomAnalysisSession: vi.fn(async () => ({ sessionId: 'dom-session' })),
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
  AgentComposer: ({
    value,
    onChange,
    isDecisionBlocked,
  }: {
    value: string;
    onChange: (value: string) => void;
    isDecisionBlocked?: boolean;
  }) => (
    <textarea
      aria-label="对话输入框"
      value={value}
      disabled={Boolean(isDecisionBlocked)}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
        addListener: vi.fn((listener: (message: unknown) => void) => {
          mockOnMessageListeners.add(listener);
        }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          mockOnMessageListeners.delete(listener);
        }),
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
}

describe('Chat active run restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessageListeners.clear();
    installBrowserMocks();
    mockStreamState.status = 'idle';
    mockStreamState.error = null;
    mockStreamState.contextPercent = 0;
    mockStreamState.activeRunId = null;
    mockStreamState.sessionId = null;
    mockStreamState.tools = [];
    mockStreamState.conversationItems = [];
    mockStreamState.sendMessage = vi.fn();
    mockStreamState.stop = vi.fn();
    mockStreamState.reset = vi.fn();
    mockStreamState.loadHistory = vi.fn();
    mockStreamState.restoreSessionRunState = vi.fn();
    mockStreamState.appendAssistantMessage = vi.fn();
    mockStreamState.resolveInteraction = vi.fn();
    mockSessionsState.clearSessions.mockReset();
    mockSessionsState.loadHistory.mockReset();
    mockSessionsState.loadHistory.mockResolvedValue({
      sessionId: 'session-active',
      messages: [],
    });
    clientMocks.mockGetCapabilities.mockClear();
    clientMocks.mockListProjects.mockClear();
    clientMocks.mockGetSystemUpdateInfo.mockReset();
    clientMocks.mockGetSystemUpdateInfo.mockResolvedValue({ updateAvailable: false });
    clientMocks.mockAnalyzeDom.mockClear();
    clientMocks.mockMarkSessionInterrupted.mockClear();
    clientMocks.mockListCommands.mockClear();
    clientMocks.mockExecuteCommand.mockClear();
    clientMocks.mockGetSessionRunState.mockReset();
    clientMocks.mockGetSessionRunState.mockResolvedValue(null);
    clientMocks.mockOpenFileEntry.mockReset();
    clientMocks.mockOpenFileEntry.mockResolvedValue(undefined);
    clientMocks.mockGetModelConfig.mockReset();
    clientMocks.mockGetModelConfig.mockResolvedValue({
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'claude-sonnet-4-20250514',
        anthropicApiKey: 'sk-official',
        anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
      },
      runtime: {
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
      },
      detectedCliConfig: null,
      userClaudeSettings: {
        path: '/Users/test/.claude/settings.json',
        exists: true,
        rawJson: '{}',
      },
    });
    clientMocks.mockTestModelConfig.mockReset();
    clientMocks.mockTestModelConfig.mockImplementation(
      async (_config, options?: { targetAuthSource?: AgentAuthSource }) => ({
        result: {
          ok: true,
          message:
            options?.targetAuthSource === 'project_model_config'
              ? '项目模型配置测试成功'
              : '用户级 Claude settings 测试成功',
          runtimeAuthSummary: `认证摘要 | source=${options?.targetAuthSource ?? 'user_claude_settings'}`,
          runtime: {
            authSource: options?.targetAuthSource ?? 'user_claude_settings',
            selectedAuthSource: options?.targetAuthSource ?? 'user_claude_settings',
            available: true,
            claudeCliAvailable: true,
            hasProjectModelConfig: true,
            reason: '测试成功',
          },
        },
      })
    );
    sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockReturnValue(false);
    sessionSelectionMocks.mockReadAgentV2ComposerAppend.mockReset();
    sessionSelectionMocks.mockReadAgentV2ComposerAppend.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockReset();
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2QuickActionFeedback.mockReset();
    sessionSelectionMocks.mockReadAgentV2QuickActionFeedback.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs.mockReset();
    sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2SessionSelection.mockReset();
    sessionSelectionMocks.mockReadAgentV2SessionSelection.mockResolvedValue({
      sessionId: 'session-fallback',
      projectPath: '/tmp/project-fallback',
      title: 'fallback session',
      selectedAt: '2026-05-22T10:00:00.000Z',
    });
    sessionSelectionMocks.mockPublishAgentV2CurrentSession.mockReset();
    sessionSelectionMocks.mockPublishAgentV2CurrentSession.mockResolvedValue(undefined);
    sessionSelectionMocks.mockPublishAgentV2ProjectSelection.mockReset();
    sessionSelectionMocks.mockPublishAgentV2ProjectSelection.mockResolvedValue(undefined);
    sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent.mockReset();
    sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent.mockResolvedValue(undefined);
    sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs.mockReset();
    sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs.mockResolvedValue(undefined);
    activeRunSessionMocks.mockReadAgentV2ActiveRunSession.mockReset();
    activeRunSessionMocks.mockReadAgentV2ActiveRunSession.mockResolvedValue({
      sessionId: 'session-active',
      projectPath: '/tmp/project-active',
      runId: 'run-1',
      status: 'streaming',
      updatedAt: '2026-05-22T10:00:00.000Z',
    });
    activeRunSessionMocks.mockClearAgentV2ActiveRunSession.mockReset();
    activeRunSessionMocks.mockClearAgentV2ActiveRunSession.mockResolvedValue(undefined);
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
  });

  it('启动时若存在 active run session，会优先恢复该会话', async () => {
    clientMocks.mockGetSessionRunState.mockResolvedValue({
      sessionId: 'session-active',
      projectPath: '/tmp/project-active',
      runId: 'run-1',
      status: 'streaming',
      startedAt: '2026-05-22T10:00:00.000Z',
      lastEventAt: '2026-05-22T10:00:01.000Z',
      latestSequence: 3,
      hasActiveStream: true,
    });

    render(<Chat />);

    await waitFor(() => {
      expect(mockSessionsState.loadHistory).toHaveBeenCalledWith('session-active', {
        projectPath: '/tmp/project-active',
      });
    });
    expect(mockStreamState.loadHistory).toHaveBeenCalledWith({
      sessionId: 'session-active',
      messages: [],
    });
    expect(clientMocks.mockGetSessionRunState).toHaveBeenCalledWith('session-active');
    expect(mockStreamState.restoreSessionRunState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-active',
        projectPath: '/tmp/project-active',
        runId: 'run-1',
        status: 'streaming',
        hasActiveStream: true,
      })
    );
    expect(mockSessionsState.loadHistory).toHaveBeenCalledTimes(1);
    expect(sessionSelectionMocks.mockReadAgentV2SessionSelection).not.toHaveBeenCalled();
  });

  it('首次启动时会自动选中后端默认工作区', async () => {
    activeRunSessionMocks.mockReadAgentV2ActiveRunSession.mockResolvedValue(null);

    render(<Chat />);

    await waitFor(() => {
      expect(sessionSelectionMocks.mockPublishAgentV2ProjectSelection).toHaveBeenCalledWith({
        projectPath: '/tmp/project',
      });
    });
  });

  it('active run 记录存在但无活动流时，会回退到 session selection', async () => {
    mockSessionsState.loadHistory.mockImplementation(async (sessionId: string) => ({
      sessionId,
      messages: [],
    }));
    clientMocks.mockGetSessionRunState.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    render(<Chat />);

    await waitFor(() => {
      expect(sessionSelectionMocks.mockReadAgentV2SessionSelection).toHaveBeenCalledTimes(1);
    });
    expect(activeRunSessionMocks.mockClearAgentV2ActiveRunSession).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockSessionsState.loadHistory).toHaveBeenNthCalledWith(2, 'session-fallback', {
        projectPath: '/tmp/project-fallback',
      });
    });
  });

  it('本地 Claude settings 与项目模型配置都不可用时，空态展示官方 API Key 提示', async () => {
    clientMocks.mockGetModelConfig.mockResolvedValue({
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'claude-sonnet-4-20250514',
        anthropicApiKey: undefined,
        anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
      },
      runtime: {
        authSource: 'project_model_config',
        selectedAuthSource: 'project_model_config',
        available: false,
        claudeCliAvailable: true,
        hasProjectModelConfig: true,
        reason: '当前没有可用认证来源。',
      },
      detectedCliConfig: null,
      userClaudeSettings: {
        path: '/Users/test/.claude/settings.json',
        exists: true,
        rawJson: '{}',
      },
    });
    clientMocks.mockTestModelConfig
      .mockResolvedValueOnce({
        result: {
          ok: false,
          message: '用户级 Claude settings 测试失败',
          runtimeAuthSummary: '认证摘要 | source=user_claude_settings',
          runtime: {
            authSource: 'user_claude_settings',
            selectedAuthSource: 'user_claude_settings',
            available: false,
            claudeCliAvailable: true,
            hasProjectModelConfig: true,
            reason: '测试失败',
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          ok: false,
          message: '项目模型配置测试失败',
          runtimeAuthSummary: '认证摘要 | source=project_model_config',
          runtime: {
            authSource: 'project_model_config',
            selectedAuthSource: 'project_model_config',
            available: false,
            claudeCliAvailable: true,
            hasProjectModelConfig: true,
            reason: '测试失败',
          },
        },
      });

    const view = render(<Chat />);

    await waitFor(() => {
      expect(clientMocks.mockTestModelConfig).toHaveBeenCalledTimes(2);
    });
    expect(await view.findByText('当前模型暂不可用')).toBeTruthy();
    const officialLink = await view.findByRole('link', { name: '官方 API Key 开通地址' });
    expect(officialLink.getAttribute('href')).toBe('https://anapi-uat.annto.com/api-key-portal');
  });

  it('仅用户级 Claude settings 可用时，空态明确提示可用来源而不是笼统显示当前模型可用', async () => {
    clientMocks.mockGetModelConfig.mockResolvedValue({
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'claude-sonnet-4-20250514',
        anthropicApiKey: undefined,
        anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
      },
      runtime: {
        authSource: 'user_claude_settings',
        selectedAuthSource: 'user_claude_settings',
        available: true,
        claudeCliAvailable: true,
        hasProjectModelConfig: false,
        reason: '当前使用用户级 Claude settings 作为运行时认证来源。',
      },
      detectedCliConfig: null,
      userClaudeSettings: {
        path: '/Users/test/.claude/settings.json',
        exists: true,
        rawJson: '{}',
      },
    });
    clientMocks.mockTestModelConfig.mockResolvedValueOnce({
      result: {
        ok: true,
        message: '用户级 Claude settings 测试成功',
        runtimeAuthSummary: '认证摘要 | source=user_claude_settings',
        runtime: {
          authSource: 'user_claude_settings',
          selectedAuthSource: 'user_claude_settings',
          available: true,
          claudeCliAvailable: true,
          hasProjectModelConfig: false,
          reason: '测试成功',
        },
      },
    });

    const view = render(<Chat />);

    await waitFor(() => {
      expect(view.container.textContent).toContain(
        '已检测到可用的用户级 Claude settings，可直接开始对话。'
      );
    });
    expect(view.container.textContent).not.toContain('当前模型可用。');
  });

  it('模型配置变更后会刷新右侧对话可用状态并恢复输入', async () => {
    clientMocks.mockGetModelConfig
      .mockResolvedValueOnce({
        config: {
          configMode: 'official',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: undefined,
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        },
        runtime: {
          authSource: 'project_model_config',
          selectedAuthSource: 'project_model_config',
          available: false,
          claudeCliAvailable: false,
          hasProjectModelConfig: false,
          reason: '当前项目模型配置不可用。',
        },
        detectedCliConfig: null,
        userClaudeSettings: {
          path: '/Users/test/.claude/settings.json',
          exists: true,
          rawJson: '{}',
        },
      })
      .mockResolvedValueOnce({
        config: {
          configMode: 'official',
          modelProvider: 'anthropic',
          anthropicModelName: 'claude-sonnet-4-20250514',
          anthropicApiKey: 'sk-official',
          anthropicBaseUrl: 'https://anapi-uat.annto.com/api-sse-anthropic/v1',
        },
        runtime: {
          authSource: 'project_model_config',
          selectedAuthSource: 'project_model_config',
          available: true,
          claudeCliAvailable: false,
          hasProjectModelConfig: true,
          reason: '当前项目模型配置可用。',
        },
        detectedCliConfig: null,
        userClaudeSettings: {
          path: '/Users/test/.claude/settings.json',
          exists: true,
          rawJson: '{}',
        },
      });
    clientMocks.mockTestModelConfig.mockImplementation(async (_config, options) => ({
      result: {
        ok: options?.targetAuthSource === 'project_model_config',
        message:
          options?.targetAuthSource === 'project_model_config'
            ? '项目模型配置测试成功'
            : '用户级 Claude settings 测试失败',
        runtimeAuthSummary: `认证摘要 | source=${options?.targetAuthSource ?? 'user_claude_settings'}`,
        runtime: {
          authSource: options?.targetAuthSource ?? 'user_claude_settings',
          selectedAuthSource: 'project_model_config',
          available: options?.targetAuthSource === 'project_model_config',
          claudeCliAvailable: false,
          hasProjectModelConfig: true,
          reason:
            options?.targetAuthSource === 'project_model_config' ? '测试成功' : 'Claude CLI 不可用',
        },
      },
    }));

    const view = render(<Chat />);

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(1);
      expect(view.getByLabelText('对话输入框').hasAttribute('disabled')).toBe(true);
    });

    await act(async () => {
      window.dispatchEvent(new window.CustomEvent('model-access-changed'));
    });

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(2);
      expect(view.getByLabelText('对话输入框').hasAttribute('disabled')).toBe(false);
    });
  });
});
