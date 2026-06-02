// @vitest-environment node

import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAuthSource } from '../lib/agent-v2/types';

type MockConversationMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  kind: string;
  text?: string;
  timestamp: string;
  runId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  isError?: boolean;
};

type MockConversationItem = {
  type: 'user';
  message: MockConversationMessage;
} | {
  type: 'run';
  card: {
    id: string;
    sessionId: string;
    runId?: string | null;
    anchorMessageId: string | null;
    cardStatus: 'running' | 'waiting_for_input' | 'completed' | 'failed' | 'aborted';
    headline: string;
    finalResponse: string;
    responseMessages: Array<{ id: string; timestamp: string; body: string }>;
    processItems: Array<{
      id: string;
      timestamp: string;
      kind:
        | 'thinking'
        | 'tool_use'
        | 'tool_result'
        | 'interactive_prompt'
        | 'permission_request'
        | 'plan_approval'
        | 'session_status'
        | 'notice';
      title: string;
      body: string;
      tone?: 'neutral' | 'warning' | 'danger' | 'success';
      payload?: unknown;
    }>;
    processItemCount: number;
    previewItems: Array<{
      id: string;
      timestamp: string;
      kind:
        | 'thinking'
        | 'tool_use'
        | 'tool_result'
        | 'interactive_prompt'
        | 'permission_request'
        | 'plan_approval'
        | 'session_status'
        | 'notice';
      title: string;
      body: string;
      tone?: 'neutral' | 'warning' | 'danger' | 'success';
      payload?: unknown;
    }>;
    todos: unknown[];
    files: unknown[];
    activeInteraction:
      | null
      | {
          requestId: string;
          kind: 'interactive_prompt' | 'permission_request' | 'plan_approval';
          title: string;
          toolName?: string | null;
          message?: string | null;
          input?: unknown;
        };
    startedAt: string | null;
    updatedAt: string | null;
    source: 'sdk-live' | 'official-history';
    subagents?: unknown[];
  };
};

const mockStreamState = {
  status: 'idle' as const,
  error: null as string | null,
  contextPercent: 0,
  activeRunId: null as string | null,
  sessionId: null as string | null,
  tools: [] as unknown[],
  conversationItems: [] as MockConversationItem[],
  sendMessage: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  loadHistory: vi.fn(),
  restoreSessionRunState: vi.fn(
    (
      runState:
        | { sessionId: string; runId: string; status: 'connecting' | 'streaming' }
        | null
    ) => {
      if (!runState) {
        mockStreamState.sessionId = null;
        mockStreamState.activeRunId = null;
        mockStreamState.status = 'idle';
        return;
      }
      mockStreamState.sessionId = runState.sessionId;
      mockStreamState.activeRunId = runState.runId;
      mockStreamState.status = runState.status;
      mockStreamState.error = null;
    }
  ),
  resumeRun: vi.fn(),
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
  mockIsAgentV2DomAnalysisSuggestionMessage: vi.fn(() => false),
  mockIsAgentV2ProjectSelectedMessage: vi.fn(() => false),
  mockIsAgentV2QuickActionFeedbackMessage: vi.fn(() => false),
  mockIsAgentV2SessionSelectedMessage: vi.fn(() => false),
  mockReadAgentV2ComposerAppend: vi.fn(async () => null),
  mockReadAgentV2DomAnalysisSuggestion: vi.fn(async () => null),
  mockReadAgentV2ProjectSelection: vi.fn(async () => null),
  mockReadAgentV2QuickActionFeedback: vi.fn(async () => null),
  mockReadAgentV2SessionSelectedTabs: vi.fn(async () => null),
  mockReadAgentV2SessionSelection: vi.fn(async () => null),
  mockPublishAgentV2CurrentSession: vi.fn(async () => undefined),
  mockPublishAgentV2ProjectSelection: vi.fn(async () => undefined),
  mockPublishAgentV2WorkspaceIntent: vi.fn(async () => undefined),
  mockWriteAgentV2SessionSelectedTabs: vi.fn(async () => undefined),
}));

const sidepanelMenuMocks = vi.hoisted(() => ({
  mockOpenSidepanelRoute: vi.fn(async () => undefined),
}));

const pageEditMocks = vi.hoisted(() => ({
  mockGetPageEditActivationSuccessMessage: vi.fn(() => '进入编辑成功'),
  mockGetPageEditSuccessMessage: vi.fn(() => '退出编辑成功'),
  mockGetPageEditToggleLabel: vi.fn(() => '页面编辑'),
  mockIsPageEditActive: vi.fn(() => false),
  mockResolvePageEditTabId: vi.fn(async () => null),
  mockPageEditStateRefetch: vi.fn(async () => ({ data: null })),
  mockPageEditGetStateUseQuery: vi.fn(() => ({
    data: null,
    isLoading: false,
    refetch: pageEditMocks.mockPageEditStateRefetch,
  })),
  mockPageEditActivateMutateAsync: vi.fn(async () => null),
  mockPageEditDeactivateMutateAsync: vi.fn(async () => null),
}));

const bootstrapGateMocks = vi.hoisted(() => {
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

  return {
    mockBootstrapGateResult,
    mockUseBootstrapGateState: vi.fn(() => ({
      status: 'ready' as const,
      result: mockBootstrapGateResult,
      backgroundSync: {
        status: 'completed' as const,
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    })),
  };
});

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
  mockUpdateModelConfig: vi.fn(async () => undefined),
  mockUpdateRuntimeCapabilities: vi.fn(async () => undefined),
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
  findRemovedUploadedSessionAttachments: vi.fn((previousAttachments, nextAttachments) => {
    const nextAttachmentIds = new Set(
      (nextAttachments as Array<{ id: string }>).map((attachment) => attachment.id)
    );
    return (previousAttachments as Array<{ id: string; storage?: string }>).filter(
      (attachment) =>
        attachment.storage === 'session-temp' && !nextAttachmentIds.has(attachment.id)
    );
  }),
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
    updateModelConfig: clientMocks.mockUpdateModelConfig,
    updateRuntimeCapabilities: clientMocks.mockUpdateRuntimeCapabilities,
    getModelConfig: clientMocks.mockGetModelConfig,
    testModelConfig: clientMocks.mockTestModelConfig,
  }),
}));

vi.mock('../lib/agent-v2/storage', () => ({
  persistToolEvents: vi.fn(),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  isAgentV2ComposerAppendMessage: sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage,
  isAgentV2DomAnalysisSuggestionMessage:
    sessionSelectionMocks.mockIsAgentV2DomAnalysisSuggestionMessage,
  isAgentV2ProjectSelectedMessage: sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage,
  isAgentV2QuickActionFeedbackMessage: sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage,
  isAgentV2SessionSelectedMessage: sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage,
  publishAgentV2CurrentSession: sessionSelectionMocks.mockPublishAgentV2CurrentSession,
  publishAgentV2ProjectSelection: sessionSelectionMocks.mockPublishAgentV2ProjectSelection,
  publishAgentV2WorkspaceIntent: sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent,
  readAgentV2ComposerAppend: sessionSelectionMocks.mockReadAgentV2ComposerAppend,
  readAgentV2DomAnalysisSuggestion: sessionSelectionMocks.mockReadAgentV2DomAnalysisSuggestion,
  readAgentV2ProjectSelection: sessionSelectionMocks.mockReadAgentV2ProjectSelection,
  readAgentV2QuickActionFeedback: sessionSelectionMocks.mockReadAgentV2QuickActionFeedback,
  readAgentV2SessionSelectedTabs: sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs,
  readAgentV2SessionSelection: sessionSelectionMocks.mockReadAgentV2SessionSelection,
  writeAgentV2SessionSelectedTabs: sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs,
}));

vi.mock('../lib/browser-context', () => ({
  getBrowserContext: vi.fn(async () => undefined),
}));

vi.mock('../lib/page-codebase-mapping', () => ({
  loadPageCodebaseMappingConfig: vi.fn(async () => ({ rules: [] })),
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
  getPageEditActivationSuccessMessage: pageEditMocks.mockGetPageEditActivationSuccessMessage,
  getPageEditSuccessMessage: pageEditMocks.mockGetPageEditSuccessMessage,
  getPageEditToggleLabel: pageEditMocks.mockGetPageEditToggleLabel,
  isPageEditActive: pageEditMocks.mockIsPageEditActive,
  resolvePageEditTabId: pageEditMocks.mockResolvePageEditTabId,
}));

vi.mock('../lib/sidepanel-menu', () => ({
  openSidepanelRoute: sidepanelMenuMocks.mockOpenSidepanelRoute,
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
        useQuery: pageEditMocks.mockPageEditGetStateUseQuery,
      },
      activate: {
        useMutation: () => ({
          mutateAsync: pageEditMocks.mockPageEditActivateMutateAsync,
          isPending: false,
        }),
      },
      deactivate: {
        useMutation: () => ({
          mutateAsync: pageEditMocks.mockPageEditDeactivateMutateAsync,
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

vi.mock('../lib/bootstrap-gate', () => ({
  useBootstrapGateState: bootstrapGateMocks.mockUseBootstrapGateState,
}));

vi.mock('@/entrypoints/sidepanel/components/ui/dialog', () => ({
  Dialog: ({ children, open = true }: { children: ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/entrypoints/sidepanel/components/ui/sheet', () => ({
  Sheet: ({ children, open = true }: { children: ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/entrypoints/sidepanel/components/agent-composer/AgentComposer', () => ({
  AgentComposer: ({
    value,
    onChange,
    onSend,
    onStop,
    status,
    permissionMode = 'bypassPermissions',
    isDecisionBlocked,
    attachments = [],
    onAttachmentsChange,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSend?: () => void;
    onStop?: () => void;
    status?: 'idle' | 'connecting' | 'streaming' | 'error';
    permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
    isDecisionBlocked?: boolean;
    attachments?: Array<{ id: string }>;
    onAttachmentsChange?: (
      value: Array<{ id: string }> | ((current: Array<{ id: string }>) => Array<{ id: string }>)
    ) => void;
  }) => (
    <div>
      <button
        type="button"
        aria-label={`权限等级：${
          permissionMode === 'acceptEdits'
            ? '允许编辑'
            : permissionMode === 'bypassPermissions'
              ? '允许所有'
              : permissionMode === 'plan'
                ? '计划'
                : '默认'
        }`}
      >
        权限等级
      </button>
      <textarea
        aria-label="对话输入框"
        value={value}
        disabled={Boolean(isDecisionBlocked)}
        onChange={(event) => onChange(event.target.value)}
        onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
      <div data-testid="composer-attachment-count">{attachments.length}</div>
      {status === 'connecting' || status === 'streaming' ? (
        <button type="button" aria-label="停止" onClick={() => onStop?.()}>
          停止
        </button>
      ) : (
        <button
          type="button"
          aria-label="发送"
          disabled={Boolean(isDecisionBlocked)}
          onClick={() => onSend?.()}
        >
          发送
        </button>
      )}
      <button
        type="button"
        onClick={() =>
          onAttachmentsChange?.((current) => [...current, { id: `mock-${current.length + 1}` }])
        }
      >
        添加模拟附件
      </button>
    </div>
  ),
}));

import { Chat, resetChatModelAccessSnapshotCacheForTest } from './chat.index';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  vi.stubGlobal('NodeFilter', dom.window.NodeFilter);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
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

function setConversationItems(text = '这是对话流内可引用的一段文本') {
  mockStreamState.conversationItems = [
    {
      type: 'user',
      message: {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        kind: 'text',
        text,
        timestamp: '2026-05-19T10:00:00.000Z',
      },
    },
  ];
}

function setProcessConversationItems() {
  const longPayload =
    '{"command":"ls","timeout":120000,"description":"列出当前项目根目录文件","run_in_background":false,"dangerouslyDisableSandbox":false,"path":"C:\\\\Users\\\\Administrator\\\\Desktop\\\\webmcp\\\\some\\\\very\\\\long\\\\directory\\\\name\\\\that\\\\should\\\\wrap"}';
  const previewItem = {
    id: 'tool-call-1',
    timestamp: '2026-05-19T10:00:10.000Z',
    kind: 'tool_use' as const,
    title: '工具调用 · Bash',
    body: longPayload,
    payload: {
      command: 'ls',
      timeout: 120000,
      description: '列出当前项目根目录文件',
      run_in_background: false,
      dangerouslyDisableSandbox: false,
      path: 'C:\\Users\\Administrator\\Desktop\\webmcp\\some\\very\\long\\directory\\name\\that\\should\\wrap',
    },
  };
  const resultItem = {
    id: 'tool-result-1',
    timestamp: '2026-05-19T10:00:11.000Z',
    kind: 'tool_result' as const,
    title: '工具结果 · Bash',
    body: longPayload,
    payload: longPayload,
  };

  mockStreamState.sessionId = 'session-1';
  mockStreamState.conversationItems = [
    {
      type: 'user',
      message: {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        kind: 'text',
        text: '帮我看看刚才的工具调用',
        timestamp: '2026-05-19T10:00:00.000Z',
      },
    },
    {
      type: 'run',
      card: {
        id: 'run-1',
        sessionId: 'session-1',
        runId: 'run-1',
        anchorMessageId: 'message-1',
        cardStatus: 'running',
        headline: '执行中',
        finalResponse: '',
        responseMessages: [],
        processItems: [previewItem, resultItem],
        processItemCount: 2,
        previewItems: [previewItem, resultItem],
        todos: [],
        files: [],
        subagents: [],
        activeInteraction: null,
        startedAt: '2026-05-19T10:00:10.000Z',
        updatedAt: '2026-05-19T10:00:11.000Z',
        source: 'sdk-live',
      },
    },
  ];
}

function setCaptureProcessConversationItems() {
  const captureItem = {
    id: 'tool-result-capture-1',
    timestamp: '2026-05-19T10:00:11.000Z',
    kind: 'tool_result' as const,
    title: '工具结果 · capture_selection',
    body: '网页已保存到 captures/mock-selection.html',
    payload: '网页已保存到 captures/mock-selection.html',
  };

  mockStreamState.sessionId = 'session-1';
  mockStreamState.conversationItems = [
    {
      type: 'user',
      message: {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        kind: 'text',
        text: '帮我采集这个元素',
        timestamp: '2026-05-19T10:00:00.000Z',
      },
    },
    {
      type: 'run',
      card: {
        id: 'run-1',
        sessionId: 'session-1',
        runId: 'run-1',
        anchorMessageId: 'message-1',
        cardStatus: 'running',
        headline: '执行中',
        finalResponse: '',
        responseMessages: [],
        processItems: [captureItem],
        processItemCount: 1,
        previewItems: [captureItem],
        todos: [],
        files: [],
        subagents: [],
        activeInteraction: null,
        startedAt: '2026-05-19T10:00:10.000Z',
        updatedAt: '2026-05-19T10:00:11.000Z',
        source: 'sdk-live',
      },
    },
  ];
}

function dispatchSelectionLifecycle(target: Node) {
  act(() => {
    document.dispatchEvent(new window.Event('selectionchange'));
    fireEvent.mouseUp(target);
  });
}

function selectText(target: HTMLElement, selectedText: string) {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current.textContent?.includes(selectedText)) {
      textNode = current;
      break;
    }
  }

  if (!textNode || !textNode.textContent) {
    throw new Error(`未找到待选中文本: ${selectedText}`);
  }

  const start = textNode.textContent.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + selectedText.length);

  const selection = window.getSelection();
  if (!selection) {
    throw new Error('window.getSelection 不可用');
  }

  selection.removeAllRanges();
  selection.addRange(range);
  dispatchSelectionLifecycle(textNode.parentElement || target);
}

function dispatchRuntimeMessage(message: unknown) {
  act(() => {
    for (const listener of mockOnMessageListeners) {
      listener(message);
    }
  });
}

function createMockRect({
  top,
  left,
  right,
  bottom,
}: {
  top: number;
  left: number;
  right: number;
  bottom: number;
}) {
  return {
    top,
    left,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
}

describe('Chat chat selection quote interaction', () => {
  beforeEach(() => {
    resetChatModelAccessSnapshotCacheForTest();
    vi.clearAllMocks();
    mockOnMessageListeners.clear();
    installBrowserMocks();
    setConversationItems();
    mockStreamState.status = 'idle';
    mockStreamState.error = null;
    mockStreamState.contextPercent = 0;
    mockStreamState.activeRunId = null;
    mockStreamState.sessionId = null;
    mockStreamState.tools = [];
    mockStreamState.sendMessage = vi.fn();
    mockStreamState.stop = vi.fn();
    mockStreamState.reset = vi.fn();
    mockStreamState.loadHistory = vi.fn();
    mockStreamState.restoreSessionRunState = vi.fn(
      (
        runState:
          | { sessionId: string; runId: string; status: 'connecting' | 'streaming' }
          | null
      ) => {
        if (!runState) {
          mockStreamState.sessionId = null;
          mockStreamState.activeRunId = null;
          mockStreamState.status = 'idle';
          return;
        }
        mockStreamState.sessionId = runState.sessionId;
        mockStreamState.activeRunId = runState.runId;
        mockStreamState.status = runState.status;
        mockStreamState.error = null;
      }
    );
    mockStreamState.resumeRun = vi.fn();
    mockStreamState.appendAssistantMessage = vi.fn();
    mockStreamState.resolveInteraction = vi.fn();
    mockSessionsState.clearSessions.mockReset();
    mockSessionsState.loadHistory.mockReset();
    clientMocks.mockGetCapabilities.mockClear();
    clientMocks.mockListProjects.mockClear();
    clientMocks.mockAnalyzeDom.mockClear();
    clientMocks.mockMarkSessionInterrupted.mockClear();
    clientMocks.mockListCommands.mockClear();
    clientMocks.mockExecuteCommand.mockClear();
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
    clientMocks.mockGetSessionRunState.mockReset();
    clientMocks.mockGetSessionRunState.mockResolvedValue(null);
    clientMocks.mockOpenFileEntry.mockReset();
    clientMocks.mockOpenFileEntry.mockResolvedValue(undefined);
    clientMocks.mockUpdateModelConfig.mockReset();
    clientMocks.mockUpdateModelConfig.mockResolvedValue(undefined);
    clientMocks.mockUpdateRuntimeCapabilities.mockReset();
    clientMocks.mockUpdateRuntimeCapabilities.mockResolvedValue(undefined);
    sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2ComposerAppendMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2DomAnalysisSuggestionMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2DomAnalysisSuggestionMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage.mockReturnValue(false);
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockReset();
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockReturnValue(false);
    sessionSelectionMocks.mockReadAgentV2ComposerAppend.mockReset();
    sessionSelectionMocks.mockReadAgentV2ComposerAppend.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2DomAnalysisSuggestion.mockReset();
    sessionSelectionMocks.mockReadAgentV2DomAnalysisSuggestion.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockReset();
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2QuickActionFeedback.mockReset();
    sessionSelectionMocks.mockReadAgentV2QuickActionFeedback.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs.mockReset();
    sessionSelectionMocks.mockReadAgentV2SessionSelectedTabs.mockResolvedValue(null);
    sessionSelectionMocks.mockReadAgentV2SessionSelection.mockReset();
    sessionSelectionMocks.mockReadAgentV2SessionSelection.mockResolvedValue(null);
    sessionSelectionMocks.mockPublishAgentV2CurrentSession.mockReset();
    sessionSelectionMocks.mockPublishAgentV2CurrentSession.mockResolvedValue(undefined);
    sessionSelectionMocks.mockPublishAgentV2ProjectSelection.mockReset();
    sessionSelectionMocks.mockPublishAgentV2ProjectSelection.mockResolvedValue(undefined);
    sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent.mockReset();
    sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent.mockResolvedValue(undefined);
    sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs.mockReset();
    sessionSelectionMocks.mockWriteAgentV2SessionSelectedTabs.mockResolvedValue(undefined);
    clientMocks.mockGetSystemUpdateInfo.mockReset();
    clientMocks.mockGetSystemUpdateInfo.mockResolvedValue({ updateAvailable: false });
    sidepanelMenuMocks.mockOpenSidepanelRoute.mockReset();
    pageEditMocks.mockGetPageEditActivationSuccessMessage.mockReset();
    pageEditMocks.mockGetPageEditActivationSuccessMessage.mockReturnValue('进入编辑成功');
    pageEditMocks.mockGetPageEditSuccessMessage.mockReset();
    pageEditMocks.mockGetPageEditSuccessMessage.mockReturnValue('退出编辑成功');
    pageEditMocks.mockGetPageEditToggleLabel.mockReset();
    pageEditMocks.mockGetPageEditToggleLabel.mockReturnValue('页面编辑');
    pageEditMocks.mockIsPageEditActive.mockReset();
    pageEditMocks.mockIsPageEditActive.mockReturnValue(false);
    pageEditMocks.mockResolvePageEditTabId.mockReset();
    pageEditMocks.mockResolvePageEditTabId.mockResolvedValue(null);
    pageEditMocks.mockPageEditStateRefetch.mockReset();
    pageEditMocks.mockPageEditStateRefetch.mockResolvedValue({ data: null });
    pageEditMocks.mockPageEditGetStateUseQuery.mockReset();
    pageEditMocks.mockPageEditGetStateUseQuery.mockImplementation(() => ({
      data: null,
      isLoading: false,
      refetch: pageEditMocks.mockPageEditStateRefetch,
    }));
    pageEditMocks.mockPageEditActivateMutateAsync.mockReset();
    pageEditMocks.mockPageEditActivateMutateAsync.mockResolvedValue(null);
    pageEditMocks.mockPageEditDeactivateMutateAsync.mockReset();
    pageEditMocks.mockPageEditDeactivateMutateAsync.mockResolvedValue(null);
    bootstrapGateMocks.mockUseBootstrapGateState.mockReset();
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'ready',
      result: bootstrapGateMocks.mockBootstrapGateResult,
      backgroundSync: {
        status: 'completed',
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    });
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

  it('submits nextPermissionMode when the user accepts a generated plan', async () => {
    mockStreamState.resolveInteraction = vi.fn();
    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: {
          id: 'run-card-1',
          sessionId: 'session-1',
          runId: 'run-1',
          anchorMessageId: null,
          cardStatus: 'waiting_for_input',
          headline: '等待处理',
          finalResponse: '',
          responseMessages: [],
          processItems: [],
          processItemCount: 0,
          previewItems: [],
          todos: [],
          files: [],
          activeInteraction: {
            requestId: 'interaction-1',
            kind: 'plan_approval',
            title: '计划确认',
            toolName: 'ExitPlanMode',
            message: 'Claude 已完成计划，等待你确认后继续执行',
            input: { plan: '1. 更新后端\n2. 更新前端' },
          },
          startedAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:01.000Z',
          source: 'sdk-live',
          subagents: [],
        },
      },
    ];

    const view = render(<Chat />);
    fireEvent.click(await view.findByRole('button', { name: '按计划继续并允许编辑' }));

    await waitFor(() => {
      expect(mockStreamState.resolveInteraction).toHaveBeenCalledWith({
        runId: 'run-1',
        requestId: 'interaction-1',
        decision: {
          allow: true,
          nextPermissionMode: 'acceptEdits',
          updatedInput: { plan: '1. 更新后端\n2. 更新前端' },
        },
      });
    });
    expect(view.getByRole('button', { name: '权限等级：允许编辑' })).toBeTruthy();
  });

  it('switches the composer permission badge to allow-all when the user accepts allow-all plan execution', async () => {
    mockStreamState.resolveInteraction = vi.fn();
    mockStreamState.conversationItems = [
      {
        type: 'run',
        card: {
          id: 'run-card-bypass',
          sessionId: 'session-1',
          runId: 'run-bypass',
          anchorMessageId: null,
          cardStatus: 'waiting_for_input',
          headline: '等待处理',
          finalResponse: '',
          responseMessages: [],
          processItems: [],
          processItemCount: 0,
          previewItems: [],
          todos: [],
          files: [],
          activeInteraction: {
            requestId: 'interaction-bypass',
            kind: 'plan_approval',
            title: '计划确认',
            toolName: 'ExitPlanMode',
            message: 'Claude 已完成计划，等待你确认后继续执行',
            input: { plan: '1. 写文件\n2. 输出结果' },
          },
          startedAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:01.000Z',
          source: 'sdk-live',
          subagents: [],
        },
      },
    ];

    const view = render(<Chat />);
    fireEvent.click(await view.findByRole('button', { name: '按计划继续并允许所有' }));

    await waitFor(() => {
      expect(mockStreamState.resolveInteraction).toHaveBeenCalledWith({
        runId: 'run-bypass',
        requestId: 'interaction-bypass',
        decision: {
          allow: true,
          nextPermissionMode: 'bypassPermissions',
          updatedInput: { plan: '1. 写文件\n2. 输出结果' },
        },
      });
    });
    expect(view.getByRole('button', { name: '权限等级：允许所有' })).toBeTruthy();
  });

  it('clears current conversation and auto-sends continuation prompt after plan approval', async () => {
    mockStreamState.resolveInteraction = vi.fn();
    mockStreamState.stop = vi.fn(async () => {
      mockStreamState.activeRunId = null;
      mockStreamState.sessionId = null;
      mockStreamState.status = 'idle';
    });
    mockStreamState.reset = vi.fn();
    mockStreamState.sendMessage = vi.fn();
    mockStreamState.activeRunId = 'run-2';
    mockStreamState.conversationItems = [
      {
        type: 'user',
        message: {
          id: 'user-1',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: '修复计划模式并补测试',
          timestamp: '2026-05-19T10:00:00.000Z',
          runId: 'run-2',
        },
      },
      {
        type: 'run',
        card: {
          id: 'run-card-2',
          sessionId: 'session-1',
          runId: 'run-2',
          anchorMessageId: null,
          cardStatus: 'waiting_for_input',
          headline: '等待处理',
          finalResponse: '',
          responseMessages: [],
          processItems: [],
          processItemCount: 0,
          previewItems: [],
          todos: [],
          files: [],
          activeInteraction: {
            requestId: 'interaction-2',
            kind: 'plan_approval',
            title: '计划确认',
            toolName: 'ExitPlanMode',
            message: 'Claude 已完成计划，等待你确认后继续执行',
            input: { plan: '1. 更新后端\n2. 更新前端' },
          },
          startedAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:01.000Z',
          source: 'sdk-live',
          subagents: [],
        },
      },
    ];

    const view = render(<Chat />);
    fireEvent.click(await view.findByRole('button', { name: '清空上下文并允许编辑后继续' }));

    await waitFor(() => {
      expect(mockStreamState.resolveInteraction).toHaveBeenCalledWith({
        runId: 'run-2',
        requestId: 'interaction-2',
        decision: {
          allow: true,
          nextPermissionMode: 'acceptEdits',
          clearContext: true,
          updatedInput: { plan: '1. 更新后端\n2. 更新前端' },
        },
      });
      expect(mockStreamState.stop).toHaveBeenCalledWith('user_stop');
      expect(mockStreamState.reset).toHaveBeenCalled();
      expect(mockStreamState.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('<original_user_goal>\n修复计划模式并补测试'),
        expect.objectContaining({
          permissionMode: 'acceptEdits',
          attachments: [],
        })
      );
      expect(mockStreamState.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('<approved_plan>\n1. 更新后端\n2. 更新前端'),
        expect.any(Object)
      );
    });
    expect(view.getByRole('button', { name: '权限等级：允许编辑' })).toBeTruthy();
  });

  it('对话流内选中文本后显示“添加到对话”按钮', async () => {
    const view = render(<Chat />);
    expect(view.container.innerHTML).toContain('selection:bg-sky-200');

    const bubble = await view.findByText('这是对话流内可引用的一段文本');
    expect(view.getByRole('textbox', { name: '对话输入框' })).toBeTruthy();

    selectText(bubble, '可引用的一段文本');

    const button = await view.findByRole('button', { name: '添加到对话' });
    expect(button).toBeTruthy();
    expect(view.container.contains(button)).toBe(false);
    expect(window.getSelection()?.toString()).toBe('可引用的一段文本');
  });

  it('点击“添加到对话”后，把引用块写入输入框', async () => {
    const view = render(<Chat />);

    fireEvent.input(view.getByRole('textbox', { name: '对话输入框' }), {
      target: { value: '已有问题' },
    });

    await waitFor(() => {
      const textbox = view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement;
      expect(textbox.value).toBe('已有问题');
    });

    const bubble = await view.findByText('这是对话流内可引用的一段文本');
    selectText(bubble, '可引用的一段文本');

    await waitFor(() => {
      const textbox = view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement;
      expect(textbox.value).toBe('已有问题');
    });

    fireEvent.click(await view.findByRole('button', { name: '添加到对话' }));

    await waitFor(() => {
      const textbox = view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement;
      expect(textbox.value).toBe('已有问题\n\n补充上下文：\n“可引用的一段文本”');
      expect(view.queryByRole('button', { name: '添加到对话' })).toBeNull();
      expect(window.getSelection()?.toString()).toBe('');
    });
  });

  it('滚动后选中文本时，按钮仍出现在选区附近', async () => {
    const view = render(<Chat />);
    const bubble = await view.findByText('这是对话流内可引用的一段文本');
    const scrollContainer = view.container.querySelector(
      '.claude-mvp-conversation'
    ) as HTMLDivElement;

    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });

    const rangeDescriptor = Object.getOwnPropertyDescriptor(
      window.Range.prototype,
      'getBoundingClientRect'
    );
    const rangeRect = createMockRect({
      top: 120,
      left: 90,
      right: 150,
      bottom: 136,
    });

    Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => rangeRect,
    });

    try {
      selectText(bubble, '可引用的一段文本');

      const button = await view.findByRole('button', { name: '添加到对话' });
      const top = Number.parseFloat(button.style.top);

      expect(scrollContainer.scrollTop).toBe(240);
      expect(top).toBeCloseTo(80, 3);
      expect(top).toBeLessThan(150);
    } finally {
      if (rangeDescriptor) {
        Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', rangeDescriptor);
      } else {
        delete (window.Range.prototype as { getBoundingClientRect?: () => DOMRect })
          .getBoundingClientRect;
      }
    }
  });

  it('选区激活时，会话内容刷新不会立刻清掉当前选区', async () => {
    setConversationItems();
    const view = render(<Chat />);

    const bubble = await view.findByText('这是对话流内可引用的一段文本');
    selectText(bubble, '可引用的一段文本');

    expect(await view.findByRole('button', { name: '添加到对话' })).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe('可引用的一段文本');

    setConversationItems('这是对话流内可引用的一段文本，后面又补充了一句。');
    view.rerender(<Chat />);

    await waitFor(() => {
      expect(window.getSelection()?.toString()).toBe('可引用的一段文本');
      expect(view.getByRole('button', { name: '添加到对话' })).toBeTruthy();
    });
  });

  it('新建会话时不会影响当前选区按钮渲染', async () => {
    const view = render(<Chat />);
    const bubble = await view.findByText('这是对话流内可引用的一段文本');

    selectText(bubble, '可引用的一段文本');
    expect(await view.findByRole('button', { name: '添加到对话' })).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe('可引用的一段文本');

    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );
    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: '/tmp/project',
        selectedAt: '2026-05-20T12:00:00.000Z',
      },
    });

    fireEvent.click(view.getByRole('button', { name: '新建会话' }));

    await waitFor(() => {
      expect(view.getByRole('button', { name: '添加到对话' })).toBeTruthy();
    });
  });

  it('新建会话不会重复触发模型可用性检查', async () => {
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValue({
      projectPath: '/tmp/project',
    });

    const view = render(<Chat />);

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(0);
      expect(clientMocks.mockTestModelConfig).toHaveBeenCalledTimes(0);
      expect((view.getByRole('button', { name: '新建会话' }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    fireEvent.click(view.getByRole('button', { name: '新建会话' }));

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(0);
      expect(clientMocks.mockTestModelConfig).toHaveBeenCalledTimes(0);
    });
  });

  it('同一次侧边栏打开期间重新挂载聊天页时，复用已缓存的模型检查结果', async () => {
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValue({
      projectPath: '/tmp/project',
    });

    const firstView = render(<Chat />);

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(0);
      expect(clientMocks.mockTestModelConfig).toHaveBeenCalledTimes(0);
    });

    firstView.unmount();
    render(<Chat />);

    await waitFor(() => {
      expect(clientMocks.mockGetModelConfig).toHaveBeenCalledTimes(0);
      expect(clientMocks.mockTestModelConfig).toHaveBeenCalledTimes(0);
    });
  });

  it('点击左侧会话工作区头部后打开工作区页面', async () => {
    const view = render(<Chat />);

    fireEvent.click(view.getByRole('button', { name: '打开当前工作区' }));

    await waitFor(() => {
      expect(sidepanelMenuMocks.mockOpenSidepanelRoute).toHaveBeenCalledWith(
        '/settings?mode=workspace'
      );
    });
  });

  it('采集成功后可点击路径打开对应目录', async () => {
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });
    const view = render(<Chat />);

    await waitFor(() => {
      expect((view.getByRole('button', { name: '采集整页' }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });
    fireEvent.click(view.getByRole('button', { name: '采集整页' }));

    const headerFeedback = await view.findByTestId('chat-header-feedback');
    expect(within(headerFeedback).getByText('网页已保存到')).toBeTruthy();
    const pathButton = await view.findByRole('button', {
      name: '打开采集目录 captures/mock.html',
    });
    fireEvent.click(pathButton);

    await waitFor(() => {
      expect(sidepanelMenuMocks.mockOpenSidepanelRoute).toHaveBeenCalledWith(
        '/settings?mode=workspace&projectPath=%2Ftmp%2Fproject&entryPath=captures%2Fmock.html'
      );
    });
  });

  it('采集成功提示中的路径按钮保持单行截断展示', async () => {
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });
    const view = render(<Chat />);

    await waitFor(() => {
      expect((view.getByRole('button', { name: '采集整页' }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });
    fireEvent.click(view.getByRole('button', { name: '采集整页' }));

    const pathButton = await view.findByRole('button', {
      name: '打开采集目录 captures/mock.html',
    });

    expect(pathButton.className).toContain('truncate');
    expect(pathButton.className).toContain('whitespace-nowrap');
    expect(pathButton.className).toContain('min-w-0');
  });

  it('过程预览保持单行截断，展开详情后长工具参数和路径自动换行', async () => {
    setProcessConversationItems();
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: 'C:\\Users\\Administrator\\Desktop\\webmcp',
    });
    const view = render(<Chat />);

    expect(view.container.textContent).toContain(
      'C:\\\\Users\\\\Administrator\\\\Desktop\\\\webmcp'
    );
  });

  it('选中采集写入工作区后会提升到顶部提示，而不是留在过程预览里', async () => {
    setCaptureProcessConversationItems();
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });

    const view = render(<Chat />);

    const headerFeedback = await view.findByTestId('chat-header-feedback');
    expect(within(headerFeedback).getByText('网页已保存到')).toBeTruthy();
    expect(within(headerFeedback).getByText('captures/mock-selection.html')).toBeTruthy();
  });

  it('采集反馈在顶部优先显示，不会被后续页面编辑提示覆盖', async () => {
    setCaptureProcessConversationItems();
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });

    const view = render(<Chat />);
    const headerFeedback = await view.findByTestId('chat-header-feedback');
    expect(within(headerFeedback).getByText('网页已保存到')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '页面编辑' }));

    await waitFor(() => {
      const currentHeaderFeedback = view.getByTestId('chat-header-feedback');
      expect(within(currentHeaderFeedback).getByText('网页已保存到')).toBeTruthy();
      expect(within(currentHeaderFeedback).queryByText('进入编辑成功')).toBeNull();
    });
  });

  it('page-edit 采集反馈不会再追加到底部输入区，而是直接显示到顶部', async () => {
    sessionSelectionMocks.mockIsAgentV2QuickActionFeedbackMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_quick_action_feedback'
    );
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });

    const view = render(<Chat />);
    dispatchRuntimeMessage({
      type: 'agent_v2_quick_action_feedback',
      payload: {
        kind: 'success',
        message: '网页已保存到',
        entryPath: 'captures/from-page-edit.html',
        source: 'page-edit:capture',
        createdAt: '2026-05-24T08:00:00.000Z',
      },
    });

    const headerFeedback = await view.findByTestId('chat-header-feedback');
    expect(within(headerFeedback).getByText('网页已保存到')).toBeTruthy();
    expect(within(headerFeedback).getByText('captures/from-page-edit.html')).toBeTruthy();
    expect(
      (view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).value
    ).toBe('');
  });

  it('页面分析建议会以卡片展示，并在点击后才把命令插入输入框', async () => {
    sessionSelectionMocks.mockIsAgentV2DomAnalysisSuggestionMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_dom_analysis_suggestion'
    );

    const view = render(<Chat />);
    dispatchRuntimeMessage({
      type: 'agent_v2_dom_analysis_suggestion',
      payload: {
        card: {
          pageName: '快递询价',
          route: '#/entrustedOrderModule/expressInquiry',
          targetAction: '点击「搜索」',
          actionType: '列表查询',
          tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
          recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
          confidence: 'medium',
        },
        suggestedCommand:
          '/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"',
        createdAt: '2026-05-24T08:00:00.000Z',
      },
    });

    expect(await view.findByTestId('dom-analysis-suggestion-card')).toBeTruthy();
    expect(
      (view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).value
    ).toBe('');

    fireEvent.click(view.getByRole('button', { name: '插入命令' }));

    await waitFor(() => {
      expect(
        (view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).value
      ).toContain('/ewankb-server-query graph gls');
    });
    expect(view.queryByTestId('dom-analysis-suggestion-card')).toBeNull();
  });

  it('可以手动关闭采集反馈提示', async () => {
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });
    const view = render(<Chat />);

    await waitFor(() => {
      expect((view.getByRole('button', { name: '采集整页' }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });
    fireEvent.click(view.getByRole('button', { name: '采集整页' }));

    expect(await view.findByTestId('chat-header-feedback')).toBeTruthy();

    fireEvent.click(await view.findByRole('button', { name: '关闭提示' }));

    await waitFor(() => {
      expect(view.queryByTestId('chat-header-feedback')).toBeNull();
    });
  });

  it('新会话发送首条消息后，顶部标题会立刻更新为消息摘要', async () => {
    const sendDeferred = createDeferred<void>();
    mockStreamState.sendMessage = vi.fn(async () => {
      await sendDeferred.promise;
    });
    sessionSelectionMocks.mockReadAgentV2ProjectSelection.mockResolvedValueOnce({
      projectPath: '/tmp/project',
    });

    const view = render(<Chat />);
    const titleButton = view.getByRole('button', { name: '打开当前工作区' });
    expect(within(titleButton).getByText('新会话')).toBeTruthy();

    await waitFor(() => {
      expect(within(titleButton).getByText('project')).toBeTruthy();
    });

    fireEvent.input(view.getByRole('textbox', { name: '对话输入框' }), {
      target: { value: '请帮我分析当前项目里会话标题为什么没更新' },
    });
    fireEvent.click(view.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(
        within(titleButton).getByText('请帮我分析当前项目里会话标题为什么没更新')
      ).toBeTruthy();
    });

    await act(async () => {
      sendDeferred.resolve();
      await sendDeferred.promise;
    });
    await waitFor(() => {
      expect(mockStreamState.sendMessage).toHaveBeenCalled();
    });
  });

  it('未选择工作区时发送首条消息会先引导去工作区页，而不是直接发送', async () => {
    const view = render(<Chat />);
    const titleButton = view.getByRole('button', { name: '打开当前工作区' });
    const textbox = view.getByRole('textbox', { name: '对话输入框' });
    const sendButton = view.getByRole('button', { name: '发送' });
    const newSessionButton = view.getByRole('button', { name: '新建会话' });
    const captureButton = view.getByRole('button', { name: '采集整页' });
    const pageEditButton = view.getByRole('button', { name: '页面编辑' });

    expect(view.getByText('请选择工作区')).toBeTruthy();
    expect(view.getByText('先选择工作区，Claude 才能开始读取文件和发送消息。')).toBeTruthy();
    expect((textbox as HTMLTextAreaElement).disabled).toBe(true);
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    expect((newSessionButton as HTMLButtonElement).disabled).toBe(true);
    expect((captureButton as HTMLButtonElement).disabled).toBe(true);
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      titleButton.querySelector('.animate-\\[spin_3\\.2s_linear_infinite\\]')
    ).toBeTruthy();

    fireEvent.input(view.getByRole('textbox', { name: '对话输入框' }), {
      target: { value: '帮我看看这个报错' },
    });
    fireEvent.click(view.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(mockStreamState.sendMessage).not.toHaveBeenCalled();
      expect(sessionSelectionMocks.mockPublishAgentV2WorkspaceIntent).not.toHaveBeenCalled();
      expect(sidepanelMenuMocks.mockOpenSidepanelRoute).not.toHaveBeenCalled();
    });
  });

  it('配置同步进行中时，顶部和底部操作区会统一置灰并禁用', async () => {
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'running',
      title: '正在检查使用环境',
      description: '正在检查模型配置，请稍候。技能会在后台继续同步。',
      result: null,
      backgroundSync: {
        status: 'running',
        detail: '正在后台同步技能，完成后会自动刷新可用命令。',
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    });

    const view = render(<Chat />);

    const workspaceButton = await view.findByRole('button', { name: '打开当前工作区' });
    const newSessionButton = view.getByRole('button', { name: '新建会话' });
    const captureButton = view.getByRole('button', { name: '采集整页' });
    const pageEditButton = view.getByRole('button', { name: '页面编辑' });
    const moreConfigButton = view.getByRole('button', { name: '更多配置' });
    const textbox = view.getByRole('textbox', { name: '对话输入框' });
    const sendButton = view.getByRole('button', { name: '发送' });

    expect((workspaceButton as HTMLButtonElement).disabled).toBe(true);
    expect((newSessionButton as HTMLButtonElement).disabled).toBe(true);
    expect((captureButton as HTMLButtonElement).disabled).toBe(true);
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(true);
    expect((moreConfigButton as HTMLButtonElement).disabled).toBe(true);
    expect((textbox as HTMLTextAreaElement).disabled).toBe(true);
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('模型检查阻塞时，会禁用顶部和底部操作区，并直接展示官方 Key 表单', async () => {
    mockStreamState.conversationItems = [];
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'blocked',
      title: '模型不可用',
      description: '技能已同步，但当前模型不可用，需要配置官方 Key。',
      result: {
        ...bootstrapGateMocks.mockBootstrapGateResult,
        status: 'blocked',
      },
      backgroundSync: {
        status: 'completed',
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    });
    clientMocks.mockTestModelConfig.mockResolvedValue({
      result: {
        ok: false,
        message: '模型认证失败',
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
    });

    const view = render(<Chat />);

    expect(await view.findByPlaceholderText('输入官方 API Key')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '去配置' }));

    expect(sidepanelMenuMocks.mockOpenSidepanelRoute).toHaveBeenCalledWith('/settings?mode=model');

    expect((view.getByRole('button', { name: '打开当前工作区' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((view.getByRole('button', { name: '新建会话' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((view.getByRole('button', { name: '采集整页' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((view.getByRole('button', { name: '页面编辑' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((view.getByRole('button', { name: '更多配置' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).disabled).toBe(
      true
    );
    expect((view.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('模型不可交互时，若页面工作台已开启，仍允许点击按钮关闭', async () => {
    pageEditMocks.mockResolvePageEditTabId.mockResolvedValue(123);
    pageEditMocks.mockGetPageEditToggleLabel.mockReturnValue('退出编辑');
    pageEditMocks.mockIsPageEditActive.mockReturnValue(true);
    pageEditMocks.mockPageEditGetStateUseQuery.mockImplementation(() => ({
      data: {
        tabId: 123,
        status: 'active',
        pageMode: 'local-snapshot',
        capabilities: {},
      },
      isLoading: false,
      refetch: pageEditMocks.mockPageEditStateRefetch,
    }));
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'ready',
      result: {
        ...bootstrapGateMocks.mockBootstrapGateResult,
        modelAccess: {
          ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess,
          localConfig: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.localConfig,
            anthropicApiKey: '',
          },
          runtimeInfo: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.runtimeInfo,
            available: false,
            claudeCliAvailable: false,
            hasProjectModelConfig: false,
            reason: '缺少可用模型配置',
          },
          userClaudeSettingsTestResult: null,
          projectModelConfigTestResult: null,
          viewState: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.viewState,
            overallStatus: 'needs_config',
            summary: '请先配置模型后再发起对话。',
            userClaudeSettings: 'unavailable',
            projectModelConfig: 'needs_config',
          },
        },
      },
      backgroundSync: {
        status: 'completed',
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    });
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: '/tmp/project',
      },
    });

    const pageEditButton = await view.findByRole('button', { name: '退出编辑' });
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(pageEditButton);

    await waitFor(() => {
      expect(pageEditMocks.mockPageEditDeactivateMutateAsync).toHaveBeenCalledWith({ tabId: 123 });
    });
  });

  it('模型不可交互时，页面工作台关闭后仍允许再次点击进入', async () => {
    pageEditMocks.mockResolvePageEditTabId.mockResolvedValue(123);
    pageEditMocks.mockGetPageEditToggleLabel.mockReturnValue('进入编辑');
    pageEditMocks.mockIsPageEditActive.mockReturnValue(false);
    pageEditMocks.mockPageEditGetStateUseQuery.mockImplementation(() => ({
      data: null,
      isLoading: false,
      refetch: pageEditMocks.mockPageEditStateRefetch,
    }));
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'ready',
      result: {
        ...bootstrapGateMocks.mockBootstrapGateResult,
        modelAccess: {
          ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess,
          localConfig: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.localConfig,
            anthropicApiKey: '',
          },
          runtimeInfo: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.runtimeInfo,
            available: false,
            claudeCliAvailable: false,
            hasProjectModelConfig: false,
            reason: '缺少可用模型配置',
          },
          userClaudeSettingsTestResult: null,
          projectModelConfigTestResult: null,
          viewState: {
            ...bootstrapGateMocks.mockBootstrapGateResult.modelAccess.viewState,
            overallStatus: 'needs_config',
            summary: '请先配置模型后再发起对话。',
            userClaudeSettings: 'unavailable',
            projectModelConfig: 'needs_config',
          },
        },
      },
      backgroundSync: {
        status: 'completed',
      },
      retry: vi.fn(async () => undefined),
      retrySync: vi.fn(async () => undefined),
    });
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: '/tmp/project',
      },
    });

    const pageEditButton = await view.findByRole('button', { name: '进入编辑' });
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(pageEditButton);

    await waitFor(() => {
      expect(pageEditMocks.mockPageEditActivateMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('顶部铅笔在页面编辑状态回刷中仍保持可点击', async () => {
    pageEditMocks.mockResolvePageEditTabId.mockResolvedValue(123);
    pageEditMocks.mockGetPageEditToggleLabel.mockReturnValue('进入编辑');
    pageEditMocks.mockIsPageEditActive.mockReturnValue(false);
    pageEditMocks.mockPageEditGetStateUseQuery.mockImplementation(() => ({
      data: null,
      isLoading: true,
      refetch: pageEditMocks.mockPageEditStateRefetch,
    }));
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: '/tmp/project',
      },
    });

    const pageEditButton = await view.findByRole('button', { name: '进入编辑' });
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('顶部铅笔在进入编辑进行中允许再次点击，并在完成后按最后意图退出', async () => {
    const activateDeferred = createDeferred<{
      tabId: number;
      status: 'active';
      pageMode: 'local-snapshot';
      capabilities: Record<string, never>;
    } | null>();
    pageEditMocks.mockResolvePageEditTabId.mockResolvedValue(123);
    pageEditMocks.mockPageEditActivateMutateAsync.mockImplementation(() => activateDeferred.promise);
    pageEditMocks.mockPageEditDeactivateMutateAsync.mockResolvedValue(null);
    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: '/tmp/project',
      },
    });

    const pageEditButton = await view.findByRole('button', { name: '页面编辑' });
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(pageEditButton);

    await waitFor(() => {
      expect(pageEditMocks.mockPageEditActivateMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect((view.getByRole('button', { name: '页面编辑' }) as HTMLButtonElement).disabled).toBe(
      false
    );

    fireEvent.click(view.getByRole('button', { name: '页面编辑' }));

    await act(async () => {
      activateDeferred.resolve({
        tabId: 123,
        status: 'active',
        pageMode: 'local-snapshot',
        capabilities: {},
      });
      await activateDeferred.promise;
    });

    await waitFor(() => {
      expect(pageEditMocks.mockPageEditDeactivateMutateAsync).toHaveBeenCalledWith({ tabId: 123 });
    });
  });

  it('保存官方 Key 后不会再次触发实时模型探测', async () => {
    mockStreamState.conversationItems = [];
    const retryMock = vi.fn(async () => ({
      status: 'ready' as const,
      ...bootstrapGateMocks.mockBootstrapGateResult,
    }));
    bootstrapGateMocks.mockUseBootstrapGateState.mockReturnValue({
      status: 'blocked',
      title: '模型不可用',
      description: '技能已同步，但当前模型不可用，需要配置官方 Key。',
      result: {
        ...bootstrapGateMocks.mockBootstrapGateResult,
        status: 'blocked',
      },
      backgroundSync: {
        status: 'completed',
      },
      retry: retryMock,
      retrySync: vi.fn(async () => undefined),
    });
    clientMocks.mockTestModelConfig.mockImplementation(async () => {
      throw new Error('保存 Key 后不应触发实时模型探测');
    });

    const view = render(<Chat />);

    const input = await view.findByPlaceholderText('输入官方 API Key');
    fireEvent.change(input, {
      target: { value: 'sk-new-official-key' },
    });
    fireEvent.click(view.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(clientMocks.mockUpdateModelConfig).toHaveBeenCalledTimes(1);
      expect(clientMocks.mockUpdateRuntimeCapabilities).toHaveBeenCalledWith({
        selectedAuthSource: 'project_model_config',
      });
      expect(retryMock).toHaveBeenCalledTimes(1);
    });
    expect(clientMocks.mockTestModelConfig).not.toHaveBeenCalled();
  });

  it('选中工作区后会解除输入区锁定并清掉工作区提示', async () => {
    const view = render(<Chat />);
    const textbox = view.getByRole('textbox', { name: '对话输入框' });
    const sendButton = view.getByRole('button', { name: '发送' });
    const newSessionButton = view.getByRole('button', { name: '新建会话' });
    const captureButton = view.getByRole('button', { name: '采集整页' });
    const pageEditButton = view.getByRole('button', { name: '页面编辑' });

    expect(view.getByText('先选择工作区，Claude 才能开始读取文件和发送消息。')).toBeTruthy();
    expect((textbox as HTMLTextAreaElement).disabled).toBe(true);
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    expect((newSessionButton as HTMLButtonElement).disabled).toBe(true);
    expect((captureButton as HTMLButtonElement).disabled).toBe(true);
    expect((pageEditButton as HTMLButtonElement).disabled).toBe(true);

    sessionSelectionMocks.mockIsAgentV2ProjectSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent_v2_project_selected'
    );

    dispatchRuntimeMessage({
      type: 'agent_v2_project_selected',
      payload: {
        projectPath: 'C:\\Users\\Administrator\\Desktop\\tst',
        selectedAt: '2026-05-20T12:00:00.000Z',
      },
    });

    await waitFor(() => {
      expect(view.queryByText('先选择工作区，Claude 才能开始读取文件和发送消息。')).toBeNull();
      expect((view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).disabled).toBe(
        false
      );
      expect((view.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false);
      expect((view.getByRole('button', { name: '新建会话' }) as HTMLButtonElement).disabled).toBe(
        false
      );
      expect((view.getByRole('button', { name: '采集整页' }) as HTMLButtonElement).disabled).toBe(
        false
      );
      expect((view.getByRole('button', { name: '页面编辑' }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });
  });

  it('首次启动时输入框会保持禁用，直到工作区状态完成初始化', async () => {
    const view = render(<Chat />);

    await waitFor(() => {
      expect((view.getByRole('textbox', { name: '对话输入框' }) as HTMLTextAreaElement).disabled).toBe(
        true
      );
    });
  });

  it('切换已有会话后清掉旧的选区按钮和浏览器选区', async () => {
    const view = render(<Chat />);
    const bubble = await view.findByText('这是对话流内可引用的一段文本');

    selectText(bubble, '可引用的一段文本');
    expect(await view.findByRole('button', { name: '添加到对话' })).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe('可引用的一段文本');

    mockSessionsState.loadHistory.mockResolvedValueOnce({
      sessionId: 'session-2',
    });
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent-v2-session-selected'
    );

    dispatchRuntimeMessage({
      type: 'agent-v2-session-selected',
      payload: {
        sessionId: 'session-2',
        selectedAt: '2026-05-19T10:10:00.000Z',
        title: '历史会话',
        projectPath: '/tmp/project',
      },
    });

    await waitFor(() => {
      expect(mockSessionsState.loadHistory).toHaveBeenCalledWith('session-2', {
        projectPath: '/tmp/project',
      });
      expect(view.queryByRole('button', { name: '添加到对话' })).toBeNull();
      expect(window.getSelection()?.toString()).toBe('');
    });
  });

  it('切换已有会话后清空当前未发送的附件', async () => {
    const view = render(<Chat />);

    fireEvent.click(view.getByRole('button', { name: '添加模拟附件' }));

    await waitFor(() => {
      expect(view.getByTestId('composer-attachment-count').textContent).toBe('1');
    });

    mockSessionsState.loadHistory.mockResolvedValueOnce({
      sessionId: 'session-2',
    });
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent-v2-session-selected'
    );

    dispatchRuntimeMessage({
      type: 'agent-v2-session-selected',
      payload: {
        sessionId: 'session-2',
        selectedAt: '2026-05-19T10:10:00.000Z',
        title: '历史会话',
        projectPath: '/tmp/project',
      },
    });

    await waitFor(() => {
      expect(mockSessionsState.loadHistory).toHaveBeenCalledWith('session-2', {
        projectPath: '/tmp/project',
      });
      expect(view.getByTestId('composer-attachment-count').textContent).toBe('0');
    });
  });

  it('切回仍有 active run 的会话时显示恢复提示，并保留停止按钮', async () => {
    const restoreDeferred = createDeferred<{
      sessionId: string;
      projectPath: string;
      runId: string;
      status: 'streaming';
      startedAt: string;
      lastEventAt: string;
      latestSequence: number;
      hasActiveStream: true;
    } | null>();
    const resolvedRunState = {
      sessionId: 'session-2',
      projectPath: '/tmp/project',
      runId: 'run-2',
      status: 'streaming' as const,
      startedAt: '2026-05-19T10:00:00.000Z',
      lastEventAt: '2026-05-19T10:01:00.000Z',
      latestSequence: 12,
      hasActiveStream: true as const,
    };
    mockSessionsState.loadHistory.mockResolvedValueOnce({
      sessionId: 'session-2',
    });
    clientMocks.mockGetSessionRunState.mockReturnValueOnce(restoreDeferred.promise);
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent-v2-session-selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent-v2-session-selected',
      payload: {
        sessionId: 'session-2',
        selectedAt: '2026-05-19T10:10:00.000Z',
        title: '历史会话',
        projectPath: '/tmp/project',
      },
    });

    expect(await view.findByText('正在恢复会话运行状态...')).toBeTruthy();
    expect(clientMocks.mockGetSessionRunState).toHaveBeenCalledWith('session-2');

    await act(async () => {
      restoreDeferred.resolve(resolvedRunState);
      await restoreDeferred.promise;
    });

    await waitFor(() => {
      expect(mockStreamState.restoreSessionRunState).toHaveBeenCalledWith(resolvedRunState);
      expect(view.queryByText('正在恢复会话运行状态...')).toBeNull();
      expect(view.getByRole('button', { name: '停止' })).toBeTruthy();
      expect(view.queryByRole('button', { name: '发送' })).toBeNull();
    });
  });

  it('切回没有 active run 的会话时不阻塞发送', async () => {
    mockSessionsState.loadHistory.mockResolvedValueOnce({
      sessionId: 'session-2',
    });
    clientMocks.mockGetSessionRunState.mockResolvedValueOnce({
      sessionId: 'session-2',
      projectPath: '/tmp/project',
      runId: 'run-2',
      status: 'completed',
      startedAt: '2026-05-19T10:00:00.000Z',
      lastEventAt: '2026-05-19T10:01:00.000Z',
      latestSequence: 12,
      hasActiveStream: false,
    });
    sessionSelectionMocks.mockIsAgentV2SessionSelectedMessage.mockImplementation(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: string }).type === 'agent-v2-session-selected'
    );

    const view = render(<Chat />);

    dispatchRuntimeMessage({
      type: 'agent-v2-session-selected',
      payload: {
        sessionId: 'session-2',
        selectedAt: '2026-05-19T10:10:00.000Z',
        title: '历史会话',
        projectPath: '/tmp/project',
      },
    });

    await waitFor(() => {
      expect(clientMocks.mockGetSessionRunState).toHaveBeenCalledWith('session-2');
      expect(mockStreamState.restoreSessionRunState).toHaveBeenCalledWith({
        sessionId: 'session-2',
        projectPath: '/tmp/project',
        runId: 'run-2',
        status: 'completed',
        startedAt: '2026-05-19T10:00:00.000Z',
        lastEventAt: '2026-05-19T10:01:00.000Z',
        latestSequence: 12,
        hasActiveStream: false,
      });
      expect(view.queryByText('正在恢复会话运行状态...')).toBeNull();
      expect(view.getByRole('button', { name: '发送' })).toBeTruthy();
      expect(view.queryByRole('button', { name: '停止' })).toBeNull();
    });
  });

  it('对话流外的选区不显示该按钮', async () => {
    const view = render(<Chat />);
    await view.findByText('这是对话流内可引用的一段文本');

    const outside = document.createElement('div');
    outside.textContent = '这是对话流外的文本';
    document.body.appendChild(outside);

    selectText(outside, '对话流外');

    await waitFor(() => {
      expect(view.queryByRole('button', { name: '添加到对话' })).toBeNull();
    });
  });
});
