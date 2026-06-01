import { createFileRoute } from '@tanstack/react-router';
import {
  ArrowDownIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FileCode2Icon,
  FileCodeIcon,
  GitBranchIcon,
  MoreVerticalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import type { ElementType, KeyboardEvent, ReactNode } from 'react';
import {
  Children,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { AgentComposer } from '@/entrypoints/sidepanel/components/agent-composer/AgentComposer';
import { AssistantBubble } from '@/entrypoints/sidepanel/components/chat/AssistantBubble';
import { SystemUpdateEntry } from '@/entrypoints/sidepanel/components/settings/SystemUpdateEntry';
import { UserBubble } from '@/entrypoints/sidepanel/components/chat/UserBubble';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Badge } from '@/entrypoints/sidepanel/components/ui/badge';
import { Input } from '@/entrypoints/sidepanel/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/entrypoints/sidepanel/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/entrypoints/sidepanel/components/ui/sheet';
import { localizeUserFacingError, localizeUserFacingMessage } from '../lib/user-facing-error';
import { deriveDisplayedTodoStatus, formatDisplayedTodoStatus } from '../lib/todo-display';
import { createAgentV2Client, findRemovedUploadedSessionAttachments } from '../lib/agent-v2/client';
import {
  completeBackendLivePreview,
  isBackendLivePreviewFilePath,
  livePreviewDirectoryKey,
  publishBackendLivePreview,
  publishLiveWritePreview,
  shouldPublishBackendLivePreviewUpdate,
  shouldPublishLiveWritePreviewUpdate,
} from '../lib/agent-v2/live-write-preview';
import {
  createLiveWritePreviewTabUpdate,
  shouldAutoOpenLiveWritePreview,
} from '../lib/agent-v2/live-write-preview-tab';
import { collectIncrementalToolDisplayRecords } from '../lib/agent-v2/tool-display-record-delta';
import type {
  ConversationRunItem,
  RunCard,
  RunFileReference,
  RunProcessItem,
  SubagentWaitingSummary,
  TodoItem,
} from '../lib/agent-v2/run-cards';
import {
  deriveSubagentRuntimeState,
  localizeTodoContent,
  sanitizeUserVisibleProcessText,
  sliceConversationRunItems,
  summarizeSubagentWaitingState,
} from '../lib/agent-v2/run-cards';
import {
  buildPlanApprovalActions,
  resolvePlanApprovalAction,
  type ExecutablePermissionMode,
  type PendingContinuation,
} from '../lib/agent-v2/plan-mode';
import { buildContinuationPrompt } from '../lib/agent-v2/continuation';
import {
  clearAgentV2ActiveRunSession,
  readAgentV2ActiveRunSession,
} from '../lib/agent-v2/active-run-session';
import {
  releaseRetainedAttachmentPreviewUrls,
  retainAttachmentPreviewUrls,
} from '../lib/agent-v2/attachment-preview-lifecycle';
import {
  type AgentV2ProjectSelection,
  type AgentV2SessionSelection,
  isAgentV2ComposerAppendMessage,
  isAgentV2ProjectSelectedMessage,
  isAgentV2QuickActionFeedbackMessage,
  isAgentV2SessionSelectedMessage,
  publishAgentV2CurrentSession,
  publishAgentV2ProjectSelection,
  publishAgentV2WorkspaceIntent,
  readAgentV2ComposerAppend,
  readAgentV2ProjectSelection,
  readAgentV2QuickActionFeedback,
  readAgentV2SessionSelectedTabs,
  readAgentV2SessionSelection,
  writeAgentV2SessionSelectedTabs,
} from '../lib/agent-v2/session-selection';
import { persistToolEvents } from '../lib/agent-v2/storage';
import type {
  AgentAuthSource,
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigRuntimeInfo,
  BrowserContext,
  BrowserContextTabSnapshot,
  CommandCatalogEntry,
  DisplayMessage,
  PermissionMode,
  SessionAttachment,
  SessionSubagentSnapshot,
  ThinkingMode,
  ToolDisplayRecord,
} from '../lib/agent-v2/types';
import { resolveCommandInput } from '../lib/agent-v2/resolve-command-input';
import { useAgentV2Chat } from '../lib/agent-v2/useAgentV2Chat';
import { useAgentV2Sessions } from '../lib/agent-v2/useAgentV2Sessions';
import { getBrowserContext } from '../lib/browser-context';
import { hasScrollableContentBelow } from '../lib/chat-scroll';
import {
  getActiveConversationSelection,
  shouldAutoScrollToLatest,
} from '../lib/chat-selection-guard';
import { appendChatSelectionQuote } from '../lib/chat-selection-quote';
import { config } from '../lib/config';
import {
  deriveCurrentChatContext,
  deriveSessionTitleFromMessage,
} from '../lib/current-chat-context';
import { OFFICIAL_API_KEY_PORTAL_URL } from '../lib/model-access-bootstrap';
import { deriveModelAccessViewState } from '../lib/model-access-state';
import { subscribeModelAccessChanged } from '../lib/model-access-events';
import {
  buildFileBrowserPreviewUrl,
  buildHtmlBrowserPreviewUrl,
  buildSidepanelFilePreviewUrl,
  openHtmlBrowserPreview,
  reloadHtmlBrowserPreview,
} from '../lib/file-preview-browser';
import { triggerWorkspacePageCapture } from '../lib/page-capture';
import {
  buildAssistantResponseMarkdown,
  buildAssistantResponseMarkdownFileName,
  buildConversationMarkdown,
  buildConversationMarkdownFileName,
} from '../lib/chat-markdown-export';
import {
  getPageEditActivationSuccessMessage,
  getPageEditSuccessMessage,
  getPageEditToggleLabel,
  isPageEditActive,
  type PageEditState,
  resolvePageEditTabId,
} from '../lib/page-edit';
import {
  DEFAULT_SELECTED_TAB_SOURCE,
  createInitialSelectedTabIds,
  getCurrentWindowTabs,
  pruneSelectedTabIds,
  type SessionTabSummary,
} from '../lib/session-tab-selection';
import { buildSelectedTabsBrowserContext } from '../lib/selected-tab-context';
import {
  getSessionTabSelectionScopeKey,
  includeTabInSessionSelection,
  resolveSessionPrimaryTabIdForScope,
  resolveSessionTabSelectionForScope,
  shouldPersistSessionTabSelection,
  shouldRestoreSessionTabSelection,
} from '../lib/session-tab-selection-state';
import { openSidepanelRoute, SIDEPANEL_MENU_ITEMS } from '../lib/sidepanel-menu';
import { trpc } from '../lib/trpc_client';
import {
  allowWindowTakeoverNavigation,
  getWindowTakeoverState,
  isWindowTakeoverConfirmationRequiredMessage,
  isWindowTakeoverStateChangedMessage,
  resolveWindowTakeoverLeaveDecision,
  startWindowTakeover,
  stopWindowTakeover,
  type WindowTakeoverConfirmationRequiredMessage,
  type WindowTakeoverState,
} from '../lib/window-takeover';
import { type BootstrapGateResult, useBootstrapGateState } from '../lib/bootstrap-gate';
import { resolveRunFileOpenTarget } from './chat-file-open';

function ClaudeCodeEmptyStateIcon() {
  return (
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[#D97757]/20 bg-[#D97757]/10 shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl shadow-inner">
        <img
          aria-hidden="true"
          className="h-full w-full"
          src={chrome.runtime.getURL('/icon/claude-ai-icon.svg')}
          alt=""
        />
      </div>
    </div>
  );
}

const OFFICIAL_MODEL_GATEWAY_BASE_URL = 'https://anapi-uat.annto.com/api-sse-anthropic';
const OFFICIAL_MODEL_GATEWAY_DEFAULT_MODEL = 'qwen3.6-plus';

type EmptyStateModelAccessStatus =
  | 'unknown'
  | 'available'
  | 'needs_config'
  | 'requires_official_api_key';

function trimOptionalValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDefaultWorkspacePath(workdir: string): string {
  const normalized = workdir.replace(/[\\/]+$/, '');
  const separator = normalized.includes('\\') ? '\\' : '/';
  return `${normalized}${separator}workspace${separator}project`;
}

function buildOfficialApiKeyPatch(
  currentConfig: AgentModelConfig | null,
  apiKey: string
): Partial<AgentModelConfig> {
  return {
    ...currentConfig,
    configMode: 'official',
    modelProvider: 'anthropic',
    anthropicApiKey: apiKey.trim(),
    anthropicBaseUrl: OFFICIAL_MODEL_GATEWAY_BASE_URL,
    anthropicModelName:
      trimOptionalValue(currentConfig?.anthropicModelName) ?? OFFICIAL_MODEL_GATEWAY_DEFAULT_MODEL,
  };
}

function hasSuccessfulModelConfigTest(result: AgentModelConfigAuthTestResult | null): boolean {
  return Boolean(result?.ok);
}

function formatAuthSourceLabel(source: AgentAuthSource): string {
  return source === 'user_claude_settings' ? '用户级 Claude settings' : '项目模型配置';
}

function ClaudeCodeModelAccessNotice({
  status,
  value,
  inputRef,
  isSubmitting,
  error,
  forceVisible = false,
  onConfig,
  onApiKeyChange,
  onOpenPortal,
  onSubmit,
}: {
  status: EmptyStateModelAccessStatus;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isSubmitting: boolean;
  error: string | null;
  forceVisible?: boolean;
  onConfig?: () => void;
  onApiKeyChange: (value: string) => void;
  onOpenPortal: () => void;
  onSubmit: () => void;
}) {
  if (!forceVisible && status !== 'requires_official_api_key' && status !== 'needs_config') {
    return null;
  }

  const isHardFailure = status === 'requires_official_api_key';
  const hasConfigAction = Boolean(onConfig);

  return (
    <div className="mt-5 w-full max-w-[360px] text-left">
      <div className="space-y-3">
        <Input
          className="text-xs"
          ref={inputRef}
          type="password"
          value={value}
          placeholder="输入官方 API Key"
          autoComplete="off"
          spellCheck={false}
          disabled={isSubmitting}
          onChange={(event) => onApiKeyChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className={hasConfigAction ? "grid grid-cols-3 gap-2" : "flex justify-end gap-2"}>
          {onConfig ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onConfig}
            >
              去配置
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={hasConfigAction ? "w-full" : "min-w-[8.5rem]"}
            onClick={onOpenPortal}
          >
            查看Key
          </Button>
          <Button
            type="button"
            size="sm"
            className={hasConfigAction ? "w-full" : "min-w-[8.5rem]"}
            disabled={isSubmitting}
            onClick={onSubmit}
          >
            {isSubmitting ? "启用中..." : isHardFailure ? "保存" : "保存"}
          </Button>
        </div>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </div>
    </div>
  );
}

function resolveEmptyStateHeading(input: {
  modelAccessLoaded: boolean;
  overallStatus: ReturnType<typeof deriveModelAccessViewState>['overallStatus'];
}): string {
  if (!input.modelAccessLoaded || input.overallStatus === 'probing') {
    return '模型配置检测中';
  }
  if (input.overallStatus === 'available' || input.overallStatus === 'partial') {
    return 'Claude Code 可开始使用';
  }
  return '当前模型需先配置';
}

function resolveEmptyStateSummary(input: {
  modelAccessLoaded: boolean;
  summary: string;
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  userClaudeSettingsStatus: ReturnType<typeof deriveModelAccessViewState>['userClaudeSettings'];
  projectModelConfigStatus: ReturnType<typeof deriveModelAccessViewState>['projectModelConfig'];
  overallStatus: ReturnType<typeof deriveModelAccessViewState>['overallStatus'];
}): string {
  if (!input.modelAccessLoaded) {
    return '正在检查本地 CLI 和项目模型配置，请稍候。';
  }

  const { runtimeInfo, userClaudeSettingsStatus, projectModelConfigStatus, overallStatus } = input;
  const activeSource = runtimeInfo?.selectedAuthSource ?? runtimeInfo?.authSource;

  if (overallStatus === 'available' || overallStatus === 'partial') {
    if (activeSource === 'user_claude_settings' && userClaudeSettingsStatus === 'success') {
      return projectModelConfigStatus === 'failed' || projectModelConfigStatus === 'needs_config'
        ? '已检测到用户级 Claude settings 配置，可直接开始对话。项目模型配置暂未就绪。'
        : '已检测到用户级 Claude settings 配置，可直接开始对话。';
    }

    if (activeSource === 'project_model_config' && projectModelConfigStatus === 'success') {
      return userClaudeSettingsStatus === 'failed' || userClaudeSettingsStatus === 'unavailable'
        ? '已检测到项目模型配置，可直接开始对话。用户级 Claude settings 暂未就绪。'
        : '已检测到项目模型配置，可直接开始对话。';
    }

    if (userClaudeSettingsStatus === 'success' && projectModelConfigStatus === 'success') {
      return '已检测到用户级 Claude settings 和项目模型配置。';
    }

    if (userClaudeSettingsStatus === 'success') {
      return `已检测到${formatAuthSourceLabel('user_claude_settings')}配置，可直接开始对话。`;
    }

    if (projectModelConfigStatus === 'success') {
      return `已检测到${formatAuthSourceLabel('project_model_config')}，可直接开始对话。`;
    }
  }

  return input.summary;
}

function shouldSuggestModelConfigFromError(error: string): boolean {
  const normalizedError = error.toLowerCase();
  return (
    normalizedError.includes('api key') ||
    normalizedError.includes('authentication') ||
    normalizedError.includes('auth') ||
    normalizedError.includes('401') ||
    normalizedError.includes('403') ||
    normalizedError.includes('模型') ||
    normalizedError.includes('配置') ||
    normalizedError.includes('claude settings')
  );
}

type ChatModelAccessSnapshot = {
  runtimeInfo: AgentModelConfigRuntimeInfo;
  localConfig: AgentModelConfig;
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
  isProbePending: boolean;
  emptyStateStatus: EmptyStateModelAccessStatus;
};

let chatModelAccessSnapshotCache: ChatModelAccessSnapshot | null = null;
let chatModelAccessSnapshotPromise: Promise<ChatModelAccessSnapshot> | null = null;

function clearChatModelAccessSnapshotCache() {
  chatModelAccessSnapshotCache = null;
  chatModelAccessSnapshotPromise = null;
}

function deriveEmptyStateModelAccessStatus(input: {
  overallStatus: ReturnType<typeof deriveModelAccessViewState>['overallStatus'];
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
}): EmptyStateModelAccessStatus {
  const bothSourcesFailed =
    input.userClaudeSettingsTestResult != null &&
    input.projectModelConfigTestResult != null &&
    !hasSuccessfulModelConfigTest(input.userClaudeSettingsTestResult) &&
    !hasSuccessfulModelConfigTest(input.projectModelConfigTestResult);

  return bothSourcesFailed
    ? 'requires_official_api_key'
    : input.overallStatus === 'available' || input.overallStatus === 'partial'
      ? 'available'
      : input.overallStatus === 'needs_config'
        ? 'needs_config'
        : 'unknown';
}

function createChatModelAccessSnapshotFromBootstrapResult(
  result: BootstrapGateResult
): ChatModelAccessSnapshot {
  return {
    runtimeInfo: result.modelAccess.runtimeInfo ?? {
      authSource: result.modelAccess.selectedAuthSource,
      selectedAuthSource: result.modelAccess.selectedAuthSource,
      available: false,
      claudeCliAvailable: false,
      hasProjectModelConfig: false,
      reason: '当前模型运行时信息暂不可用。',
    },
    localConfig: result.modelAccess.localConfig,
    userClaudeSettingsTestResult: result.modelAccess.userClaudeSettingsTestResult,
    projectModelConfigTestResult: result.modelAccess.projectModelConfigTestResult,
    isProbePending: false,
    emptyStateStatus: deriveEmptyStateModelAccessStatus({
      overallStatus: result.modelAccess.viewState.overallStatus,
      userClaudeSettingsTestResult: result.modelAccess.userClaudeSettingsTestResult,
      projectModelConfigTestResult: result.modelAccess.projectModelConfigTestResult,
    }),
  };
}

export function resetChatModelAccessSnapshotCacheForTest() {
  clearChatModelAccessSnapshotCache();
}

async function resolveChatModelAccessSnapshot(
  agentClient: ReturnType<typeof createAgentV2Client>,
  options?: { force?: boolean }
): Promise<ChatModelAccessSnapshot> {
  if (options?.force) {
    clearChatModelAccessSnapshotCache();
  }

  if (chatModelAccessSnapshotCache) {
    return chatModelAccessSnapshotCache;
  }

  if (chatModelAccessSnapshotPromise) {
    return chatModelAccessSnapshotPromise;
  }

  chatModelAccessSnapshotPromise = (async () => {
    const payload = await agentClient.getModelConfig();
    const localConfig = payload.config;
    let userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null = null;
    let projectModelConfigTestResult: AgentModelConfigAuthTestResult | null = null;
    const probeTasks: Promise<void>[] = [];

    if (payload.runtime.claudeCliAvailable) {
      probeTasks.push(
        agentClient
          .testModelConfig(localConfig, {
            targetAuthSource: 'user_claude_settings',
          })
          .then((response) => {
            userClaudeSettingsTestResult = response.result;
          })
          .catch(() => {
            userClaudeSettingsTestResult = null;
          })
      );
    }

    if (payload.runtime.hasProjectModelConfig) {
      probeTasks.push(
        agentClient
          .testModelConfig(localConfig, {
            targetAuthSource: 'project_model_config',
          })
          .then((response) => {
            projectModelConfigTestResult = response.result;
          })
          .catch(() => {
            projectModelConfigTestResult = null;
          })
      );
    }

    await Promise.allSettled(probeTasks);

    const viewState = deriveModelAccessViewState({
      runtimeInfo: payload.runtime,
      localConfig,
      userClaudeSettingsTestResult,
      projectModelConfigTestResult,
      isProbing: false,
    });

    const emptyStateStatus = deriveEmptyStateModelAccessStatus({
      overallStatus: viewState.overallStatus,
      userClaudeSettingsTestResult,
      projectModelConfigTestResult,
    });

    const snapshot: ChatModelAccessSnapshot = {
      runtimeInfo: payload.runtime,
      localConfig,
      userClaudeSettingsTestResult,
      projectModelConfigTestResult,
      isProbePending: false,
      emptyStateStatus,
    };

    chatModelAccessSnapshotCache = snapshot;
    return snapshot;
  })();

  try {
    return await chatModelAccessSnapshotPromise;
  } finally {
    chatModelAccessSnapshotPromise = null;
  }
}

function preserveMarkdownHref(value: string) {
  const trimmed = value.trim();
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return '';
  }
  return value;
}

type ChatSelectionQuoteState = {
  text: string;
  top: number;
  left: number;
};

function ChatMarkdownPre({ children }: { children?: ReactNode }) {
  const firstChild = Children.toArray(children)[0];

  if (
    isValidElement<{
      className?: string;
      children?: ReactNode;
    }>(firstChild)
  ) {
    return (
      <pre className="my-3 max-w-full select-text whitespace-pre-wrap break-words rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100 [overflow-wrap:anywhere]">
        <code
          className={`${firstChild.props.className || ''} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
        >
          {firstChild.props.children}
        </code>
      </pre>
    );
  }

  return (
    <pre className="my-3 max-w-full select-text whitespace-pre-wrap break-words rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100 [overflow-wrap:anywhere]">
      {children}
    </pre>
  );
}

function ChatMarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const raw = String(children ?? '');
  if (className || /[\r\n]/.test(raw)) {
    return (
      <code className={`${className || ''} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
        {children}
      </code>
    );
  }

  return (
    <code className="break-words rounded bg-muted px-1 py-0.5 text-[0.92em] [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

const AssistantMarkdown = memo(function AssistantMarkdown({ content }: { content: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const markdownComponents = useMemo(
    () => ({
      pre: ({ children }: { children?: ReactNode }) => <ChatMarkdownPre>{children}</ChatMarkdownPre>,
      code: ({ className, children }: { className?: string; children?: ReactNode }) => (
        <ChatMarkdownCode className={className}>{children}</ChatMarkdownCode>
      ),
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="mb-2 mt-3 text-lg font-semibold">{children}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3 className="mb-1.5 mt-3 text-sm font-semibold">{children}</h3>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <div className="my-2 select-text whitespace-pre-wrap">{children}</div>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
      ),
      li: ({ children }: { children?: ReactNode }) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="my-2 select-text border-l-2 border-border pl-3 text-muted-foreground">
          {children}
        </blockquote>
      ),
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {children}
        </a>
      ),
      table: ({ children }: { children?: ReactNode }) => (
        <div className="my-3 max-w-full overflow-x-auto rounded-md border">
          <table className="w-full table-fixed select-text border-collapse text-xs">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: ReactNode }) => <thead className="bg-muted/60">{children}</thead>,
      th: ({ children }: { children?: ReactNode }) => (
        <th className="select-text break-words border-b border-r px-2 py-1.5 text-left font-semibold last:border-r-0 [overflow-wrap:anywhere]">
          {children}
        </th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td className="select-text break-words border-b border-r px-2 py-1.5 align-top last:border-r-0 [overflow-wrap:anywhere]">
          {children}
        </td>
      ),
      hr: () => <hr className="my-4 border-border" />,
    }),
    []
  );

  return (
    <div className="agent-chat-markdown min-w-0 break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={preserveMarkdownHref}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

const TextBlock = memo(function TextBlock({ message }: { message: DisplayMessage }) {
  return <AssistantMarkdown content={message.text || ''} />;
},
(previousProps, nextProps) =>
  previousProps.message.id === nextProps.message.id &&
  previousProps.message.text === nextProps.message.text &&
  previousProps.message.timestamp === nextProps.message.timestamp
);

function QuickActionFeedbackBanner({
  feedback,
  onOpenEntry,
  onClose,
}: {
  feedback: QuickActionFeedback;
  onOpenEntry: (entryPath: string) => void | Promise<void>;
  onClose: () => void;
}) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      data-testid="chat-header-feedback"
      className={`mx-3 mt-2 flex items-start justify-between gap-2 rounded-md px-2 py-1 text-xs ${
        feedback.kind === 'error'
          ? 'bg-destructive/8 text-destructive'
          : feedback.kind === 'pending'
            ? 'bg-muted text-muted-foreground'
            : 'bg-emerald-500/8 text-emerald-700'
      }`}
    >
      <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden">
        <span className="shrink-0">{feedback.message}</span>
        {feedback.entryPath ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate p-0 text-left underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
            onClick={() => void onOpenEntry(feedback.entryPath!)}
            aria-label={`打开采集目录 ${feedback.entryPath}`}
            title={feedback.entryPath}
          >
            {feedback.entryPath}
          </button>
        ) : null}
        {feedback.suffixMessage ? <span className="shrink-0">{feedback.suffixMessage}</span> : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-sm p-0.5 hover:bg-black/5"
        aria-label="关闭提示"
        onClick={onClose}
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function parseCaptureQuickActionFeedback(message: string): QuickActionFeedback {
  const trimmedMessage = message.trim();
  const successMatch = /^网页已保存到\s+(\S+)(.*)$/u.exec(trimmedMessage);
  if (successMatch) {
    return {
      kind: 'success',
      message: '网页已保存到',
      entryPath: successMatch[1],
      suffixMessage: successMatch[2] || '',
    };
  }

  if (/^采集(?:选中内容|当前页面)?失败[:：]/u.test(trimmedMessage)) {
    return {
      kind: 'error',
      message: trimmedMessage,
    };
  }

  return null;
}

function findLatestCaptureQuickActionFeedback(
  items: ConversationRunItem[]
): { itemId: string; feedback: NonNullable<QuickActionFeedback> } | null {
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    if (item.type !== 'run') {
      continue;
    }

    for (
      let processIndex = item.card.processItems.length - 1;
      processIndex >= 0;
      processIndex -= 1
    ) {
      const processItem = item.card.processItems[processIndex];
      const feedback = parseCaptureQuickActionFeedback(processItem.body);
      if (feedback) {
        return {
          itemId: processItem.id,
          feedback,
        };
      }
    }
  }

  return null;
}

function ProcessLabel({ item }: { item: RunProcessItem }) {
  const labels: Record<RunProcessItem['kind'], string> = {
    thinking: '思考',
    tool_use: '工具',
    tool_result: '结果',
    interactive_prompt: '提问',
    permission_request: '审批',
    plan_approval: '计划',
    session_status: '状态',
    notice: '过程',
  };
  return (
    <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {labels[item.kind]}
    </span>
  );
}

function formatProcessTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function ProcessRow({ item }: { item: RunProcessItem }) {
  const processTime = formatProcessTime(item.timestamp);

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
      <ProcessLabel item={item} />
      {processTime ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/80" title="过程时间">
          {processTime}
        </span>
      ) : null}

      <span className="min-w-0 flex-1 truncate">{item.body}</span>
    </div>
  );
}

function formatProcessPayload(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ProcessDetailCard({ item }: { item: RunProcessItem }) {
  const processTime = formatProcessTime(item.timestamp);
  const payload = formatProcessPayload(item.payload);
  const showSummary = item.body && item.body !== payload;

  return (
    <div className="space-y-3 rounded-lg border bg-card/80 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ProcessLabel item={item} />
        {processTime ? (
          <span className="tabular-nums text-muted-foreground/80">{processTime}</span>
        ) : null}
        <span className="font-medium text-foreground">{item.title}</span>
      </div>
      {showSummary ? (
        <div className="rounded-md bg-muted/35 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {item.body}
        </div>
      ) : null}
      {payload ? (
        <pre className="overflow-x-auto rounded-md bg-muted/50 px-3 py-3 text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {payload}
        </pre>
      ) : (
        <div className="rounded-md bg-muted/35 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {item.body}
        </div>
      )}
    </div>
  );
}

function TodoListPreview({
  todos,
  cardStatus,
}: {
  todos: TodoItem[];
  cardStatus: RunCard['cardStatus'];
}) {
  if (todos.length === 0) {
    return null;
  }

  const visible = todos.slice(0, 5);
  return (
    <div className="rounded-md bg-muted/35 px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-foreground">待办</div>
      <div className="space-y-1">
        {visible.map((todo, index) => (
          <div key={`${todo.content}-${index}`} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">
              {formatTodoStatus(todo.status, cardStatus)}
            </span>
            <span className="min-w-0 flex-1 truncate">{formatTodoContent(todo.content)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTodoStatus(status: string, cardStatus: RunCard['cardStatus']) {
  return formatDisplayedTodoStatus(deriveDisplayedTodoStatus(status, cardStatus));
}

function formatTodoContent(content: string) {
  return localizeTodoContent(content);
}

function formatSubagentDuration(startedAt: string | null, updatedAt: string | null) {
  if (!startedAt || !updatedAt) {
    return null;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function useStatusClock(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function summarizeCollapsedSubagentActivity(
  subagents: SessionSubagentSnapshot[],
  now: number
): string | null {
  if (subagents.length === 0) {
    return null;
  }

  const latestSubagent = [...subagents].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.startedAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.startedAt || 0).getTime();
    return rightTime - leftTime;
  })[0];

  if (!latestSubagent) {
    return null;
  }

  const latestActivity = latestSubagent.activities.at(-1);
  const runtimeState = deriveSubagentRuntimeState(latestSubagent, now);
  const detail =
    latestSubagent.latestSummary ||
    latestActivity?.detail ||
    runtimeState.detail ||
    runtimeState.label;

  if (!detail) {
    return `最近活动：${latestSubagent.title}`;
  }

  return `最近活动：${latestSubagent.title} · ${sanitizeUserVisibleProcessText(detail)}`;
}

function SubagentPreview({
  subagents,
  waitingSummaryState,
  canStopForOrphanedSubagents,
  onStop,
}: {
  subagents: SessionSubagentSnapshot[];
  waitingSummaryState: SubagentWaitingSummary;
  canStopForOrphanedSubagents?: boolean;
  onStop?: () => void | Promise<void>;
}) {
  const now = useStatusClock();
  const [expanded, setExpanded] = useState(() =>
    subagents.some((subagent) => subagent.status === 'running')
  );
  const collapsedActivitySummary = summarizeCollapsedSubagentActivity(subagents, now);

  if (subagents.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-xs text-muted-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span>子代理 {subagents.length} 个</span>
            {waitingSummaryState.activeWaitingCount > 0 ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                活跃 {waitingSummaryState.activeWaitingCount}
              </Badge>
            ) : null}
            {waitingSummaryState.waitingCount > 0 ? (
              <Badge
                variant="outline"
                className="h-5 border-amber-300 px-1.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
              >
                工具等待 {waitingSummaryState.waitingCount}
              </Badge>
            ) : null}
            {waitingSummaryState.orphanedCount > 0 ? (
              <Badge
                variant="outline"
                className="h-5 border-red-300 px-1.5 text-[10px] text-red-700 dark:border-red-800 dark:text-red-300"
              >
                失联 {waitingSummaryState.orphanedCount}
              </Badge>
            ) : null}
          </span>
          {!expanded && collapsedActivitySummary ? (
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
              {collapsedActivitySummary}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1">
          <span>{expanded ? '收起' : '展开'}</span>
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {subagents.map((subagent) => {
            const latestActivity = subagent.activities.at(-1);
            const duration = formatSubagentDuration(subagent.startedAt, subagent.updatedAt);
            const runtimeState = deriveSubagentRuntimeState(subagent, now);
            return (
              <div key={subagent.agentId} className="rounded-md bg-background/80 px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{subagent.title}</span>
                    <Badge
                      variant="outline"
                      className={`h-5 px-1.5 text-[10px] ${
                        runtimeState.phase === 'stalled'
                          ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
                          : runtimeState.phase === 'waiting'
                            ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300'
                            : ''
                      }`}
                    >
                      {runtimeState.label}
                    </Badge>
                    {duration ? (
                      <span className="tabular-nums text-muted-foreground">{duration}</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {subagent.messageCount} 消息 · {subagent.toolCount} 工具
                  </span>
                </div>
                <div className="mt-1 space-y-1 text-muted-foreground">
                  {subagent.latestToolName ? <div>工具：{subagent.latestToolName}</div> : null}
                  {runtimeState.detail ? <div>{runtimeState.detail}</div> : null}
                  {subagent.latestSummary ? (
                    <div className="line-clamp-2">
                      摘要：{sanitizeUserVisibleProcessText(subagent.latestSummary)}
                    </div>
                  ) : latestActivity ? (
                    <div className="line-clamp-2">
                      动作：{sanitizeUserVisibleProcessText(latestActivity.detail)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {canStopForOrphanedSubagents ? (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => void onStop?.()}
              >
                停止当前运行
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RunProcessPreview({
  card,
  onStop,
}: {
  card: RunCard;
  onStop?: () => void | Promise<void>;
}) {
  const now = useStatusClock();
  const items = card.previewItems;
  if (card.processItems.length === 0 && card.subagents.length === 0) {
    return null;
  }

  const waitingSummaryState = summarizeSubagentWaitingState(card.subagents, now, {
    parentLastActivityAt: card.updatedAt,
  });
  const canStopForOrphanedSubagents =
    waitingSummaryState.orphanedCount > 0 && card.cardStatus === 'running' && Boolean(onStop);

  return (
    <div className="space-y-2">
      {card.processItems.length > 0 ? (
        <div className="rounded-md bg-muted/30 px-3 py-2">
          <div className="space-y-0.5">
            {items.map((item) => (
              <ProcessRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      ) : null}
      <SubagentPreview
        subagents={card.subagents}
        waitingSummaryState={waitingSummaryState}
        canStopForOrphanedSubagents={canStopForOrphanedSubagents}
        onStop={onStop}
      />
    </div>
  );
}

function RunProcessSheet({
  card,
  open,
  onOpenChange,
}: {
  card: RunCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (card.processItems.length === 0) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-none gap-0 border-0 p-0 sm:max-w-none">
        <SheetHeader className="gap-1 border-b px-4 py-4">
          <SheetTitle>过程详情</SheetTitle>
          <SheetDescription className="whitespace-normal [overflow-wrap:anywhere]">
            共 {card.processItemCount} 条过程，已完整展示。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {card.processItems.length > 0 ? (
              card.processItems.map((item) => <ProcessDetailCard key={item.id} item={item} />)
            ) : (
              <div className="rounded-md bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                暂无过程详情
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type InteractionDecisionInput = {
  runId: string;
  requestId: string;
  decision: {
    allow?: boolean;
    message?: string;
    updatedInput?: unknown;
    answers?: Record<string, unknown>;
    nextPermissionMode?: 'acceptEdits' | 'bypassPermissions';
  };
};

type ActiveInteractionCard = RunCard & {
  activeInteraction: NonNullable<RunCard['activeInteraction']>;
  runId: string;
};

type AskQuestionOption = {
  label: string;
  description?: string;
};

type AskQuestion = {
  question: string;
  header?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function formatUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeAskQuestions(input: unknown, fallback: string | null | undefined): AskQuestion[] {
  const rawQuestions = isRecord(input) && Array.isArray(input.questions) ? input.questions : [];
  const questions = rawQuestions
    .map((item): AskQuestion | null => {
      if (!isRecord(item) || typeof item.question !== 'string') {
        return null;
      }
      const options = Array.isArray(item.options)
        ? item.options
            .map((option): AskQuestionOption | null => {
              if (typeof option === 'string') {
                return { label: option };
              }
              if (isRecord(option) && typeof option.label === 'string') {
                return {
                  label: option.label,
                  description:
                    typeof option.description === 'string' ? option.description : undefined,
                };
              }
              return null;
            })
            .filter((option): option is AskQuestionOption => Boolean(option))
        : [];
      return {
        question: item.question,
        header: typeof item.header === 'string' ? item.header : undefined,
        options,
        multiSelect: item.multiSelect === true,
      };
    })
    .filter((question): question is AskQuestion => Boolean(question));

  if (questions.length > 0) {
    return questions;
  }

  const fallbackText =
    fallback || (isRecord(input) && typeof input.prompt === 'string' ? input.prompt : '');
  return fallbackText ? [{ question: fallbackText, options: [] }] : [];
}

function deriveOriginalGoal(card: ActiveInteractionCard, items: ConversationRunItem[]): string {
  const reversed = [...items].reverse();
  const matchedUser = reversed.find(
    (item) =>
      item.type === 'user' &&
      typeof item.message.text === 'string' &&
      (!card.runId || item.message.runId === card.runId || !item.message.runId)
  );
  return matchedUser?.type === 'user' ? matchedUser.message.text || '' : '';
}

function deriveApprovedPlan(interaction: ActiveInteractionCard['activeInteraction']): string {
  const input = interaction.input;
  if (input && typeof input === 'object' && typeof (input as { plan?: unknown }).plan === 'string') {
    return String((input as { plan: string }).plan);
  }
  return interaction.message || '';
}

function AskUserQuestionPanel({
  card,
  onResolveInteraction,
}: {
  card: ActiveInteractionCard;
  onResolveInteraction: (input: {
    runId: string;
    requestId: string;
    decision: {
      allow?: boolean;
      message?: string;
      updatedInput?: unknown;
      answers?: Record<string, unknown>;
    };
  }) => Promise<void>;
}) {
  const interaction = card.activeInteraction;
  const panelRef = useRef<HTMLFieldSetElement | null>(null);
  const input = isRecord(interaction.input) ? interaction.input : {};
  const questions = normalizeAskQuestions(interaction.input, interaction.message);
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherText, setOtherText] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [answer, setAnswer] = useState('');
  const question = questions[currentStep];
  const isStructured = Boolean(question?.options.length);
  const isFirst = currentStep === 0;
  const isLast = currentStep === Math.max(0, questions.length - 1);

  useEffect(() => {
    if (currentStep >= 0) {
      panelRef.current?.focus();
    }
  }, [currentStep]);

  const buildAnswers = () => {
    if (!isStructured) {
      return answer.trim() ? { answer: answer.trim() } : {};
    }
    const answers: Record<string, string> = {};
    questions.forEach((item, index) => {
      const values = Array.from(selections.get(index) || []);
      const custom = (otherText.get(index) || '').trim();
      if (otherActive.get(index) && custom) {
        values.push(custom);
      }
      if (values.length) {
        answers[item.question] = values.join(', ');
      }
    });
    return answers;
  };

  const resolve = (allow: boolean) => {
    const answers = buildAnswers();
    void onResolveInteraction({
      runId: card.runId,
      requestId: interaction.requestId,
      decision: {
        allow,
        message: allow ? undefined : '用户拒绝',
        updatedInput: { ...input, answers },
        answers,
      },
    });
  };

  const toggleOption = (label: string) => {
    if (!question) {
      return;
    }
    setSelections((current) => {
      const next = new Map(current);
      const selected = new Set(next.get(currentStep) || []);
      if (question.multiSelect) {
        if (selected.has(label)) {
          selected.delete(label);
        } else {
          selected.add(label);
        }
      } else {
        selected.clear();
        selected.add(label);
        setOtherActive((active) => {
          const nextActive = new Map(active);
          nextActive.set(currentStep, false);
          return nextActive;
        });
      }
      next.set(currentStep, selected);
      return next;
    });
  };

  const toggleOther = () => {
    setOtherActive((current) => {
      const next = new Map(current);
      const nextValue = !next.get(currentStep);
      next.set(currentStep, nextValue);
      if (nextValue && !question?.multiSelect) {
        setSelections((selection) => {
          const nextSelection = new Map(selection);
          nextSelection.set(currentStep, new Set());
          return nextSelection;
        });
      }
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Escape') {
        event.preventDefault();
        resolve(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      resolve(true);
      return;
    }
    if (question) {
      const index = Number.parseInt(event.key, 10);
      if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
        event.preventDefault();
        toggleOption(question.options[index - 1].label);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        toggleOther();
        return;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (questions.length > 1 && !isLast) {
        setCurrentStep((step) => step + 1);
      } else {
        resolve(true);
      }
    }
  };

  return (
    <fieldset
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="rounded-lg border bg-card px-3 py-2.5 text-xs text-card-foreground shadow-lg outline-none ring-1 ring-primary/20"
    >
      {question ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {question.header ? (
              <div className="inline-flex rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {question.header}
              </div>
            ) : null}
            <span className="min-w-0 text-sm font-medium leading-5 text-foreground">
              {question.question}
            </span>
          </div>
          {questions.length > 1 ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {currentStep + 1}/{questions.length}
            </span>
          ) : null}
          {question.multiSelect ? (
            <div className="mt-1 text-[10px] text-muted-foreground">可多选</div>
          ) : null}
        </div>
      ) : null}

      {isStructured && question ? (
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
          {question.options.map((option, index) => {
            const selected = selections.get(currentStep)?.has(option.label) || false;
            return (
              <button
                key={`${option.label}-${index}`}
                type="button"
                className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                  selected
                    ? 'border-primary/35 bg-primary/5 text-foreground'
                    : 'border-border bg-background/60 hover:bg-muted/50'
                }`}
                onClick={() => toggleOption(option.label)}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {selected ? <CheckIcon className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-left ${
              otherActive.get(currentStep)
                ? 'border-primary/35 bg-primary/5 text-foreground'
                : 'border-border bg-background/40 text-muted-foreground hover:bg-muted/50'
            }`}
            onClick={toggleOther}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[10px]">
              0
            </span>
            <span>其他</span>
          </button>
          {otherActive.get(currentStep) ? (
            <input
              value={otherText.get(currentStep) || ''}
              onChange={(event) => {
                const nextValue = event.target.value;
                setOtherText((current) => {
                  const next = new Map(current);
                  next.set(currentStep, nextValue);
                  return next;
                });
              }}
              className="h-8 w-full rounded-md border bg-background px-2 text-foreground outline-none focus:border-primary/50"
              placeholder="输入其他回答"
            />
          ) : null}
        </div>
      ) : (
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          className="mt-2 h-8 w-full rounded-md border bg-background px-2 text-foreground outline-none focus:border-primary/50"
          placeholder="输入回答"
        />
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => resolve(true)}
        >
          跳过
        </Button>
        <div className="flex gap-2">
          {questions.length > 1 && !isFirst ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setCurrentStep((step) => step - 1)}
            >
              <ChevronLeftIcon className="mr-1 h-3 w-3" />
              上一步
            </Button>
          ) : null}
          {questions.length > 1 && !isLast ? (
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setCurrentStep((step) => step + 1)}
            >
              下一步
            </Button>
          ) : (
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => resolve(true)}>
              提交
            </Button>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function ToolApprovalCard({
  card,
  onResolveInteraction,
}: {
  card: ActiveInteractionCard;
  onResolveInteraction: (input: InteractionDecisionInput) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const interaction = card.activeInteraction;
  const rawInput = formatUnknown(interaction.input);
  const resolve = (allow: boolean) => {
    void onResolveInteraction({
      runId: card.runId,
      requestId: interaction.requestId,
      decision: {
        allow,
        message: allow ? undefined : '用户拒绝',
        updatedInput: interaction.input,
      },
    });
  };

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 text-xs text-card-foreground shadow-lg ring-1 ring-primary/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate font-medium">
          授权{' '}
          <span className="font-mono text-muted-foreground">
            {interaction.toolName || 'unknown'}
          </span>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '查看输入'}
        </button>
      </div>
      {interaction.message ? (
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{interaction.message}</div>
      ) : null}
      {expanded && rawInput ? (
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-[11px] leading-4 text-foreground">
          {rawInput}
        </pre>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => resolve(true)}>
          允许
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => resolve(false)}
        >
          <XIcon className="mr-1 h-3 w-3" />
          拒绝
        </Button>
      </div>
    </div>
  );
}

function PlanApprovalCard({
  card,
  conversationItems,
  onResolveInteraction,
  onContinueWithClearContext,
  onPermissionModeSelected,
}: {
  card: ActiveInteractionCard;
  conversationItems: ConversationRunItem[];
  onResolveInteraction: (input: InteractionDecisionInput) => Promise<void>;
  onContinueWithClearContext: (input: PendingContinuation) => void;
  onPermissionModeSelected: (mode: ExecutablePermissionMode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const interaction = card.activeInteraction;
  const rawInput = formatUnknown(interaction.input);
  const actions = buildPlanApprovalActions();

  const resolve = async (input: {
    nextPermissionMode: ExecutablePermissionMode | null;
    clearContext?: boolean;
  }) => {
    const { nextPermissionMode, clearContext } = input;
    const continuationPrompt =
      clearContext && nextPermissionMode
        ? buildContinuationPrompt({
            originalGoal: deriveOriginalGoal(card, conversationItems),
            approvedPlan: deriveApprovedPlan(interaction),
          })
        : null;
    const resolution = resolvePlanApprovalAction({
      nextPermissionMode,
      clearContext,
      interactionInput: interaction.input,
      continuationPrompt,
    });

    if (resolution.selectedPermissionMode) {
      onPermissionModeSelected(resolution.selectedPermissionMode);
    }

    await onResolveInteraction({
      runId: card.runId,
      requestId: interaction.requestId,
      decision: resolution.decision,
    });

    if (resolution.continuation) {
      onContinueWithClearContext(resolution.continuation);
    }
  };

  const handleActionClick = (action: (typeof actions)[number]) => {
    void resolve({
      nextPermissionMode: action.nextPermissionMode,
      clearContext: action.clearContext,
    });
  };

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 text-xs text-card-foreground shadow-lg ring-1 ring-primary/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate font-medium">{interaction.title || '计划确认'}</div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '查看计划'}
        </button>
      </div>
      {interaction.message ? (
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{interaction.message}</div>
      ) : null}
      {expanded && rawInput ? (
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-[11px] leading-4 text-foreground">
          {rawInput}
        </pre>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.nextPermissionMode ? 'default' : 'outline'}
            className="h-7 px-2 text-xs"
            onClick={() => handleActionClick(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FileReferencesPreview({
  files,
  projectPath,
}: {
  files: RunFileReference[];
  projectPath?: string;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex max-h-16 flex-wrap gap-1.5 overflow-hidden">
      {files.map((file) => (
        <button
          key={`${file.source || 'file'}:${file.filePath}`}
          type="button"
          className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
          title={file.filePath}
          onClick={() => openFilePreview(file, projectPath)}
        >
          <FileCodeIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 max-w-[180px] truncate">{file.label}</span>
        </button>
      ))}
    </div>
  );
}

const AssistantRunCard = memo(function AssistantRunCard({
  card,
  projectPath,
  onCopyMarkdown,
  onExportMarkdown,
  onStop,
}: {
  card: RunCard;
  projectPath?: string;
  onCopyMarkdown: (card: RunCard) => void | Promise<void>;
  onExportMarkdown: (card: RunCard) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}) {
  const [isProcessSheetOpen, setIsProcessSheetOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setIsProcessSheetOpen(false);
    setIsExportMenuOpen(false);
  }, [card.id]);
  useEffect(() => {
    if (!isExportMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (exportMenuRef.current?.contains(target)) {
        return;
      }
      setIsExportMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isExportMenuOpen]);
  const fallbackMessage: DisplayMessage = {
    id: `${card.id}-fallback`,
    sessionId: card.sessionId,
    role: 'assistant',
    kind: card.cardStatus === 'failed' ? 'error' : 'text',
    text: card.finalResponse || (card.cardStatus === 'running' ? '正在处理...' : card.headline),
    timestamp: card.updatedAt || new Date(0).toISOString(),
  };

  return (
    <div className="flex justify-start">
      <div className="min-h-16 max-w-full min-w-0 flex-1 rounded-lg border bg-card/70 px-3 py-3 text-sm shadow-xs">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{card.headline}</span>
            <div className="flex items-center gap-2">
              {card.processItemCount > 0 ? (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsProcessSheetOpen(true)}
                >
                  {card.processItemCount} 条过程
                </button>
              ) : null}
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`助手回答操作 ${card.id}`}
                  aria-expanded={isExportMenuOpen}
                  onClick={() => setIsExportMenuOpen((value) => !value)}
                >
                  <MoreVerticalIcon className="h-4 w-4" />
                </button>
                {isExportMenuOpen ? (
                  <div className="absolute right-0 top-7 z-20 w-40 overflow-hidden rounded-md border bg-popover p-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        void onCopyMarkdown(card);
                      }}
                    >
                      复制 Markdown
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        void onExportMarkdown(card);
                      }}
                    >
                      导出 Markdown
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <RunProcessPreview card={card} onStop={onStop} />
          <RunProcessSheet
            card={card}
            open={isProcessSheetOpen}
            onOpenChange={setIsProcessSheetOpen}
          />
          <TodoListPreview todos={card.todos} cardStatus={card.cardStatus} />
          <FileReferencesPreview files={card.files} projectPath={projectPath} />
          {card.responseMessages.length > 0 ? (
            <AssistantBubble>
              <div className="space-y-3">
                {card.responseMessages.map((message) => (
                  <TextBlock
                    key={message.id}
                    message={{
                      id: message.id,
                      sessionId: card.sessionId,
                      role: 'assistant',
                      kind: 'text',
                      text: message.body,
                      timestamp: message.timestamp,
                    }}
                  />
                ))}
              </div>
            </AssistantBubble>
          ) : (
            <AssistantBubble>
              <TextBlock message={fallbackMessage} />
            </AssistantBubble>
          )}
        </div>
      </div>
    </div>
  );
});

const ConversationTimeline = memo(function ConversationTimeline({
  items,
  projectPath,
  hiddenCount,
  isFullConversationVisible,
  onShowFullConversation,
  onCollapseConversation,
  onCopyAssistantMarkdown,
  onExportAssistantMarkdown,
  onStopRun,
}: {
  items: ConversationRunItem[];
  projectPath?: string;
  hiddenCount: number;
  isFullConversationVisible: boolean;
  onShowFullConversation: () => void;
  onCollapseConversation: () => void;
  onCopyAssistantMarkdown: (card: RunCard) => void | Promise<void>;
  onExportAssistantMarkdown: (card: RunCard) => void | Promise<void>;
  onStopRun: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {hiddenCount > 0 ? (
        <div className="sticky top-0 z-10 flex justify-center py-1">
          <button
            type="button"
            className="rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            onClick={onShowFullConversation}
          >
            显示更早的 {hiddenCount} 条
          </button>
        </div>
      ) : null}
      {isFullConversationVisible ? (
        <div className="sticky top-0 z-10 flex justify-center py-1">
          <button
            type="button"
            className="rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            onClick={onCollapseConversation}
          >
            收起较早消息
          </button>
        </div>
      ) : null}
      {items.map((item) =>
        item.type === 'user' ? (
          <div key={item.message.id} data-chat-conversation-item="true">
            <UserBubble message={item.message} />
          </div>
        ) : (
          <div key={item.card.id} data-chat-conversation-item="true">
            <AssistantRunCard
              card={item.card}
              projectPath={projectPath}
              onCopyMarkdown={onCopyAssistantMarkdown}
              onExportMarkdown={onExportAssistantMarkdown}
              onStop={onStopRun}
            />
          </div>
        )
      )}
    </div>
  );
});

function writeToolPayload(tool: ToolDisplayRecord) {
  const toolName = (tool.toolName || '').toLowerCase();
  if (toolName !== 'write' && toolName !== 'edit') {
    return null;
  }
  const input = tool.input;
  if (!input || typeof input !== 'object') {
    return tool.partialInputJson
      ? writeToolPayloadFromPartialJson(toolName, tool.partialInputJson)
      : null;
  }
  const record = input as Record<string, unknown>;
  const filePath = record.file_path || record.filePath || record.path;
  if (toolName === 'edit') {
    const oldString = record.old_string || record.oldString;
    const newString = record.new_string || record.newString;
    if (
      typeof filePath === 'string' &&
      typeof oldString === 'string' &&
      typeof newString === 'string'
    ) {
      return {
        filePath,
        content: newString,
        operation: 'edit' as const,
        oldString,
        newString,
        replaceAll: record.replace_all === true || record.replaceAll === true,
      };
    }
  }

  const content = record.content;
  if (typeof filePath !== 'string' || typeof content !== 'string') {
    if (tool.partialInputJson) {
      return writeToolPayloadFromPartialJson(toolName, tool.partialInputJson);
    }
    return null;
  }
  return { filePath, content, operation: 'write' as const };
}

function writeToolPayloadFromPartialJson(toolName: string, partialJson: string) {
  const filePath = extractPartialJsonStringValue(partialJson, ['file_path', 'filePath', 'path'], {
    allowPartial: false,
  });
  if (toolName === 'edit') {
    const oldString = extractPartialJsonStringValue(partialJson, ['old_string', 'oldString'], {
      allowPartial: false,
    });
    const newString = extractPartialJsonStringValue(partialJson, ['new_string', 'newString']);
    if (!filePath || oldString === null || newString === null) {
      return null;
    }
    return {
      filePath,
      content: newString,
      operation: 'edit' as const,
      oldString,
      newString,
      replaceAll: /"replace_(all|All)"\s*:\s*true/.test(partialJson),
    };
  }

  const content = extractPartialJsonStringValue(partialJson, ['content']);
  if (!filePath || content === null) {
    return null;
  }
  return { filePath, content, operation: 'write' as const };
}

function extractPartialJsonStringValue(
  partialJson: string,
  fields: string[],
  options: { allowPartial?: boolean } = {}
) {
  for (const field of fields) {
    const keyIndex = partialJson.search(new RegExp(`"${field}"\\s*:`));
    if (keyIndex < 0) {
      continue;
    }
    const afterKey = partialJson.slice(keyIndex);
    const colonIndex = afterKey.indexOf(':');
    const firstQuoteIndex = afterKey.indexOf('"', colonIndex + 1);
    if (colonIndex < 0 || firstQuoteIndex < 0) {
      continue;
    }

    let value = '';
    let escaped = false;
    for (let index = firstQuoteIndex + 1; index < afterKey.length; index += 1) {
      const char = afterKey[index];
      if (escaped) {
        if (char === 'n') value += '\n';
        else if (char === 'r') value += '\r';
        else if (char === 't') value += '\t';
        else value += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        return value;
      }
      value += char;
    }
    return options.allowPartial === false ? null : value;
  }
  return null;
}

function resolveWritePreviewLocation(projectPath: string | undefined, filePath: string) {
  const normalizeWindowsDrivePath = (value: string) => {
    const legacyDrivePath = value.match(/^\/([a-zA-Z])\/+(.+)$/);
    if (!legacyDrivePath) {
      return value;
    }
    return `${legacyDrivePath[1].toUpperCase()}:/${legacyDrivePath[2]}`;
  };

  const normalizeComparablePath = (value: string) =>
    normalizeWindowsDrivePath(value)
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/([A-Za-z]:\/)/, '$1')
      .replace(/\/+$/, '');

  if (projectPath) {
    const normalizedProject = normalizeComparablePath(projectPath);
    const normalizedFilePath = normalizeComparablePath(filePath);
    if (normalizedFilePath === normalizedProject) {
      return {
        projectPath: normalizedProject,
        filePath: '',
      };
    }
    if (normalizedFilePath.startsWith(`${normalizedProject}/`)) {
      return {
        projectPath: normalizedProject,
        filePath: normalizedFilePath.slice(normalizedProject.length + 1),
      };
    }
    return { projectPath: normalizedProject, filePath: normalizedFilePath };
  }

  const normalizedFilePath = normalizeComparablePath(filePath);
  if (/^[A-Za-z]:\//.test(normalizedFilePath)) {
    const parts = normalizedFilePath.split('/').filter(Boolean);
    const drive = parts.shift();
    const name = parts.at(-1);
    if (drive && name) {
      const parent = parts.slice(0, -1).join('/');
      return {
        projectPath: parent ? `${drive}/${parent}` : drive,
        filePath: name,
      };
    }
  }
  if (normalizedFilePath.startsWith('/')) {
    const parts = normalizedFilePath.split('/').filter(Boolean);
    const name = parts.at(-1);
    if (name) {
      return {
        projectPath: `/${parts.slice(0, -1).join('/')}`,
        filePath: name,
      };
    }
  }

  return null;
}

function isHtmlPreviewFilePath(filePath: string) {
  return /\.html?$/i.test(filePath.trim());
}

function sameProjectPath(left?: string, right?: string) {
  if (!left || !right) {
    return false;
  }
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase();
}

function openFilePreview(file: RunFileReference, fallbackProjectPath: string | undefined) {
  const target = resolveRunFileOpenTarget(file, fallbackProjectPath);
  if (!target) {
    return;
  }
  if (target.kind === 'browser-preview') {
    void openHtmlBrowserPreview(target.url);
    return;
  }
  void chrome.tabs.create({ url: target.url, active: true });
}

function isLivePreviewUrl(value: string | undefined) {
  return Boolean(
    value?.startsWith(chrome.runtime.getURL('/sidepanel.html')) &&
      value.includes('route=/file-preview')
  );
}

async function openLiveWritePreviewTab(input: {
  previewUrl: string;
  currentTabId: number | null;
  setCurrentTabId: (tabId: number | null) => void;
  takeoverState: WindowTakeoverState | null;
}) {
  const markAllowedNavigation = async (toTabId?: number) => {
    if (input.takeoverState?.status !== 'active') {
      return;
    }
    await allowWindowTakeoverNavigation({
      windowId: input.takeoverState.windowId,
      fromTabId: input.takeoverState.lockedTabId,
      toTabId,
      reason: 'ai-tab-switch',
      expiresAt: Date.now() + 10_000,
    }).catch((error) => {
      console.debug('[takeover] failed to mark AI preview tab switch:', error);
    });
  };

  if (typeof input.currentTabId === 'number') {
    const existingTab = await chrome.tabs.get(input.currentTabId).catch(() => null);
    if (existingTab && isLivePreviewUrl(existingTab.url)) {
      await markAllowedNavigation(input.currentTabId);
      await chrome.tabs.update(
        input.currentTabId,
        createLiveWritePreviewTabUpdate(existingTab.url, input.previewUrl)
      );
      return;
    }
    input.setCurrentTabId(null);
  }

  const [existingPreviewTab] = await chrome.tabs.query({
    url: chrome.runtime.getURL('/sidepanel.html*'),
  });
  if (existingPreviewTab?.id && isLivePreviewUrl(existingPreviewTab.url)) {
    input.setCurrentTabId(existingPreviewTab.id);
    await markAllowedNavigation(existingPreviewTab.id);
    await chrome.tabs.update(
      existingPreviewTab.id,
      createLiveWritePreviewTabUpdate(existingPreviewTab.url, input.previewUrl)
    );
    return;
  }

  await markAllowedNavigation();
  const tab = await chrome.tabs.create({ url: input.previewUrl, active: true });
  input.setCurrentTabId(typeof tab.id === 'number' ? tab.id : null);
}

const menuIcons: Record<string, ElementType> = {
  'mcp-tools': ServerIcon,
  settings: SlidersHorizontalIcon,
  'plugin-management': PackageIcon,
  'skill-management': FileCode2Icon,
  'command-management': TerminalIcon,
  'hook-management': GitBranchIcon,
  userscripts: FileCodeIcon,
  sessions: WorkflowIcon,
};

const DEFAULT_VISIBLE_CONVERSATION_ITEMS = 40;

type QuickActionFeedback = {
  kind: 'success' | 'error' | 'pending';
  message: string;
  entryPath?: string;
  suffixMessage?: string;
} | null;

function areTabIdListsEqual(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64Marker = ';base64,';
      const markerIndex = dataUrl.indexOf(base64Marker);
      resolve(markerIndex >= 0 ? dataUrl.slice(markerIndex + base64Marker.length) : dataUrl);
    };
    reader.onerror = () => reject(reader.error || new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function createAttachmentPreviewUrl(file: File) {
  if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  return URL.createObjectURL(file);
}

function downloadTextFile(content: string, fileName: string, mimeType = 'text/markdown;charset=utf-8') {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前环境不支持文件下载');
  }

  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function deriveConversationExportTitle(
  currentSessionTitle: string | undefined,
  items: ConversationRunItem[]
) {
  if (currentSessionTitle?.trim()) {
    return currentSessionTitle.trim();
  }

  for (const item of items) {
    if (item.type !== 'user') {
      continue;
    }
    const nextTitle = deriveSessionTitleFromMessage(item.message.text || '');
    if (nextTitle) {
      return nextTitle;
    }
  }

  return '未命名会话';
}

export function Chat() {
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [isFullConversationVisible, setIsFullConversationVisible] = useState(false);
  const [input, setInput] = useState('');
  const [selectionQuote, setSelectionQuote] = useState<ChatSelectionQuoteState | null>(null);
  const [selectionLockedConversationItems, setSelectionLockedConversationItems] = useState<
    ConversationRunItem[] | null
  >(null);
  const [selectionLockedHiddenCount, setSelectionLockedHiddenCount] = useState<number | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('high');
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [windowTabs, setWindowTabs] = useState<SessionTabSummary[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [selectedPrimaryTabId, setSelectedPrimaryTabId] = useState<number | null>(null);
  const [isWindowTabsLoaded, setIsWindowTabsLoaded] = useState(false);
  const [resolvedTabSelectionScopeKey, setResolvedTabSelectionScopeKey] = useState<string | null>(
    null
  );
  const [activeProjectPath, setActiveProjectPath] = useState<string | undefined>(undefined);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | undefined>(undefined);
  const [backendWorkdir, setBackendWorkdir] = useState<string | undefined>(undefined);
  const [hasAttemptedDefaultWorkspaceBootstrap, setHasAttemptedDefaultWorkspaceBootstrap] =
    useState(false);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [pendingContinuation, setPendingContinuation] = useState<PendingContinuation | null>(null);
  const [hasContentBelow, setHasContentBelow] = useState(false);
  const [isRestoringSessionRun, setIsRestoringSessionRun] = useState(false);
  const [takeoverState, setTakeoverState] = useState<WindowTakeoverState | null>(null);
  const [pendingTakeoverConfirmation, setPendingTakeoverConfirmation] = useState<
    WindowTakeoverConfirmationRequiredMessage['payload'] | null
  >(null);
  const [isResolvingTakeoverConfirmation, setIsResolvingTakeoverConfirmation] = useState(false);
  const [sidepanelWindowId, setSidepanelWindowId] = useState<number | null>(null);
  const [pageEditTabId, setPageEditTabId] = useState<number | null>(null);
  const [isResolvingPageEditTab, setIsResolvingPageEditTab] = useState(true);
  const [pageEditStateOverride, setPageEditStateOverride] = useState<PageEditState | undefined>(
    undefined
  );
  const [isQuickPageEditActionPending, setIsQuickPageEditActionPending] = useState(false);
  const [quickActionFeedback, setQuickActionFeedback] = useState<QuickActionFeedback>(null);
  const [dismissedCaptureFeedbackItemId, setDismissedCaptureFeedbackItemId] = useState<
    string | null
  >(null);
  const [emptyStateModelAccessStatus, setEmptyStateModelAccessStatus] =
    useState<EmptyStateModelAccessStatus>('unknown');
  const [modelAccessRuntimeInfo, setModelAccessRuntimeInfo] =
    useState<AgentModelConfigRuntimeInfo | null>(null);
  const [modelAccessLocalConfig, setModelAccessLocalConfig] = useState<AgentModelConfig | null>(null);
  const [userClaudeSettingsTestResult, setUserClaudeSettingsTestResult] =
    useState<AgentModelConfigAuthTestResult | null>(null);
  const [projectModelConfigTestResult, setProjectModelConfigTestResult] =
    useState<AgentModelConfigAuthTestResult | null>(null);
  const [isModelAccessProbePending, setIsModelAccessProbePending] = useState(false);
  const [hasLoadedModelAccess, setHasLoadedModelAccess] = useState(false);
  const [officialApiKeyInput, setOfficialApiKeyInput] = useState('');
  const [isSavingOfficialApiKey, setIsSavingOfficialApiKey] = useState(false);
  const [officialApiKeyError, setOfficialApiKeyError] = useState<string | null>(null);
  const bootstrapGate = useBootstrapGateState();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectionQuoteTimerRef = useRef<number | null>(null);
  const officialApiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const lastBackgroundSyncStatusRef = useRef(bootstrapGate.backgroundSync.status);
  const inputRef = useRef('');
  const attachmentsRef = useRef<SessionAttachment[]>([]);
  const browserContextRef = useRef<BrowserContext | undefined>(undefined);
  const configMenuRef = useRef<HTMLDivElement | null>(null);
  const activeProjectPathRef = useRef<string | undefined>(undefined);
  const selectedTabIdsRef = useRef<number[]>([]);
  const selectedPrimaryTabIdRef = useRef<number | null>(null);
  const selectedSessionMarkerRef = useRef<string | null>(null);
  const sessionRunRestoreRequestIdRef = useRef(0);
  const liveWritePreviewRef = useRef<Set<string>>(new Set());
  const liveBackendPreviewDirectoryEntriesRef = useRef<Map<string, string>>(new Map());
  const openedLiveWritePreviewIdsRef = useRef<Set<string>>(new Set());
  const liveWritePreviewTabRef = useRef<number | null>(null);
  const liveWritePreviewOpenTaskRef = useRef<Promise<void> | null>(null);
  const processedToolSignaturesRef = useRef<Map<string, string>>(new Map());
  const hasHydratedProcessedToolsRef = useRef(false);
  const takeoverRunIdRef = useRef<string | null>(null);
  const attachmentUploadSessionIdsRef = useRef<Map<string, string>>(new Map());
  const attachmentPreviewUrlsRef = useRef<Map<string, string>>(new Map());
  const retainedAttachmentPreviewUrlsRef = useRef<Set<string>>(new Set());
  const lastCaptureFeedbackItemIdRef = useRef<string | null>(null);
  const pendingTakeoverConfirmationRef = useRef<
    WindowTakeoverConfirmationRequiredMessage['payload'] | null
  >(null);
  const isResolvingTakeoverConfirmationRef = useRef(false);
  const handledTakeoverConfirmationRequestIdsRef = useRef<Set<number>>(new Set());
  const effectivePageEditStateRef = useRef<PageEditState>(null);
  const pageEditTabIdRef = useRef<number | null>(null);
  const quickPageEditExecutingTargetRef = useRef<'active' | 'inactive' | null>(null);
  const quickPageEditQueuedTargetRef = useRef<'active' | 'inactive' | null>(null);
  const takeoverUiDebugSeqRef = useRef(0);
  const logTakeoverUi = useCallback((event: string, payload?: Record<string, unknown>) => {
    const entry = {
      seq: ++takeoverUiDebugSeqRef.current,
      event,
      pending: pendingTakeoverConfirmationRef.current,
      resolving: isResolvingTakeoverConfirmationRef.current,
      ...payload,
    };
    console.debug('[takeover:ui]', entry);
    console.debug('[takeover:ui:json]', JSON.stringify(entry));
  }, []);

  const stream = useAgentV2Chat({
    baseUrl: config.api.agentV2BaseUrl,
    endpoint: config.api.agentV2Endpoint,
  });
  const sessions = useAgentV2Sessions({
    baseUrl: config.api.agentV2BaseUrl,
    endpoint: config.api.agentV2Endpoint,
  });
  const agentClient = useMemo(
    () =>
      createAgentV2Client({
        baseUrl: config.api.agentV2BaseUrl,
        endpoint: config.api.agentV2Endpoint,
      }),
    []
  );
  const pageCaptureMutation = trpc.pageCapture.capture.useMutation();
  const pageSelectionMutation = trpc.pageSelection.readPageContent.useMutation();
  const pageEditStateQuery = trpc.pageEdit.getState.useQuery(
    { tabId: pageEditTabId ?? -1 },
    {
      enabled: pageEditTabId != null,
    }
  );
  const activatePageEditMutation = trpc.pageEdit.activate.useMutation();
  const deactivatePageEditMutation = trpc.pageEdit.deactivate.useMutation();
  const effectivePageEditState = useMemo(() => {
    if (pageEditStateOverride !== undefined) {
      return pageEditStateOverride;
    }
    return (pageEditStateQuery.data as PageEditState | undefined) ?? null;
  }, [pageEditStateOverride, pageEditStateQuery.data]);
  const isQuickCapturePending = pageCaptureMutation.isPending;
  const isQuickPageEditPending =
    isResolvingPageEditTab ||
    pageEditStateQuery.isLoading ||
    isQuickPageEditActionPending ||
    activatePageEditMutation.isPending ||
    deactivatePageEditMutation.isPending;
  const quickPageEditLabel = getPageEditToggleLabel(effectivePageEditState);
  const isWorkspaceSelectionRequired = !activeProjectPath && !stream.sessionId;
  const isBootstrapGateBlocking = bootstrapGate.status !== 'ready';
  const quickProjectPath = activeProjectPath || backendWorkdir;
  const tabSelectionScopeKey = useMemo(
    () =>
      getSessionTabSelectionScopeKey({
        sessionId: stream.sessionId,
        conversationId,
      }),
    [conversationId, stream.sessionId]
  );
  const currentChatContext = useMemo(
    () =>
      deriveCurrentChatContext({
        sessionTitle: currentSessionTitle,
        projectPath: activeProjectPath,
      }),
    [activeProjectPath, currentSessionTitle]
  );
  const modelAccessViewState = useMemo(
    () =>
      deriveModelAccessViewState({
        runtimeInfo: modelAccessRuntimeInfo,
        localConfig: modelAccessLocalConfig,
        userClaudeSettingsTestResult,
        projectModelConfigTestResult,
        isProbing: isModelAccessProbePending,
      }),
    [
      isModelAccessProbePending,
      modelAccessLocalConfig,
      modelAccessRuntimeInfo,
      projectModelConfigTestResult,
      userClaudeSettingsTestResult,
    ]
  );
  const displayModelAccessSnapshot = useMemo(() => {
    if (hasLoadedModelAccess) {
      return {
        modelAccessLoaded: true,
        overallStatus: modelAccessViewState.overallStatus,
        summary: modelAccessViewState.summary,
        runtimeInfo: modelAccessRuntimeInfo,
        userClaudeSettingsStatus: modelAccessViewState.userClaudeSettings,
        projectModelConfigStatus: modelAccessViewState.projectModelConfig,
      };
    }

    if (bootstrapGate.status === 'ready' && bootstrapGate.result) {
      return {
        modelAccessLoaded: true,
        overallStatus: bootstrapGate.result.modelAccess.viewState.overallStatus,
        summary: bootstrapGate.result.modelAccess.viewState.summary,
        runtimeInfo: bootstrapGate.result.modelAccess.runtimeInfo,
        userClaudeSettingsStatus: bootstrapGate.result.modelAccess.viewState.userClaudeSettings,
        projectModelConfigStatus: bootstrapGate.result.modelAccess.viewState.projectModelConfig,
      };
    }

    return {
      modelAccessLoaded: false,
      overallStatus: modelAccessViewState.overallStatus,
      summary: modelAccessViewState.summary,
      runtimeInfo: modelAccessRuntimeInfo,
      userClaudeSettingsStatus: modelAccessViewState.userClaudeSettings,
      projectModelConfigStatus: modelAccessViewState.projectModelConfig,
    };
  }, [
    bootstrapGate,
    hasLoadedModelAccess,
    modelAccessRuntimeInfo,
    modelAccessViewState.overallStatus,
    modelAccessViewState.projectModelConfig,
    modelAccessViewState.summary,
    modelAccessViewState.userClaudeSettings,
  ]);
  useEffect(() => {
    activeProjectPathRef.current = activeProjectPath;
  }, [activeProjectPath]);
  useEffect(() => {
    effectivePageEditStateRef.current = effectivePageEditState;
  }, [effectivePageEditState]);
  useEffect(() => {
    pageEditTabIdRef.current = pageEditTabId;
  }, [pageEditTabId]);
  useEffect(() => {
    selectedTabIdsRef.current = selectedTabIds;
  }, [selectedTabIds]);
  useEffect(() => {
    selectedPrimaryTabIdRef.current = selectedPrimaryTabId;
  }, [selectedPrimaryTabId]);
  const refreshWindowTabs = useCallback(async () => {
    try {
      setWindowTabs(await getCurrentWindowTabs());
      setIsWindowTabsLoaded(true);
    } catch (error) {
      console.debug('[chat] failed to refresh current window tabs:', error);
    }
  }, []);

  const refreshModelAccess = useCallback(async (options?: { force?: boolean }) => {
    try {
      if (options?.force) {
        setHasLoadedModelAccess(false);
      }
      const snapshot = await resolveChatModelAccessSnapshot(agentClient, options);
      setModelAccessRuntimeInfo(snapshot.runtimeInfo);
      setModelAccessLocalConfig(snapshot.localConfig);
      setUserClaudeSettingsTestResult(snapshot.userClaudeSettingsTestResult);
      setProjectModelConfigTestResult(snapshot.projectModelConfigTestResult);
      setIsModelAccessProbePending(snapshot.isProbePending);
      setEmptyStateModelAccessStatus(snapshot.emptyStateStatus);
      setHasLoadedModelAccess(true);
    } catch (error) {
      console.debug('[chat] failed to resolve empty state model access status:', error);
      setEmptyStateModelAccessStatus('unknown');
    }
  }, [agentClient]);

  useEffect(() => {
    const previousStatus = lastBackgroundSyncStatusRef.current;
    const nextStatus = bootstrapGate.backgroundSync.status;
    lastBackgroundSyncStatusRef.current = nextStatus;

    if (previousStatus === nextStatus) {
      return;
    }

    if (nextStatus === 'failed') {
      toast.error(localizeUserFacingMessage(bootstrapGate.backgroundSync.detail));
    }
  }, [bootstrapGate.backgroundSync]);

  useEffect(() => {
    if (!bootstrapGate.result) {
      return;
    }

    const snapshot = createChatModelAccessSnapshotFromBootstrapResult(bootstrapGate.result);
    setModelAccessRuntimeInfo(snapshot.runtimeInfo);
    setModelAccessLocalConfig(snapshot.localConfig);
    setUserClaudeSettingsTestResult(snapshot.userClaudeSettingsTestResult);
    setProjectModelConfigTestResult(snapshot.projectModelConfigTestResult);
    setIsModelAccessProbePending(snapshot.isProbePending);
    setEmptyStateModelAccessStatus(snapshot.emptyStateStatus);
  }, [bootstrapGate.result]);

  useEffect(() => {
    return subscribeModelAccessChanged(() => {
      clearChatModelAccessSnapshotCache();
      void refreshModelAccess({ force: true });
    });
  }, [refreshModelAccess]);

  useEffect(() => {
    if (!hasLoadedModelAccess) {
      setEmptyStateModelAccessStatus('unknown');
      return;
    }

    const bothSourcesFailed =
      userClaudeSettingsTestResult != null &&
      projectModelConfigTestResult != null &&
      !hasSuccessfulModelConfigTest(userClaudeSettingsTestResult) &&
      !hasSuccessfulModelConfigTest(projectModelConfigTestResult);

    setEmptyStateModelAccessStatus(
      bothSourcesFailed
        ? 'requires_official_api_key'
        : modelAccessViewState.overallStatus === 'available' ||
            modelAccessViewState.overallStatus === 'partial'
          ? 'available'
          : modelAccessViewState.overallStatus === 'needs_config'
            ? 'needs_config'
          : 'unknown'
    );
  }, [
    hasLoadedModelAccess,
    modelAccessViewState.overallStatus,
    projectModelConfigTestResult,
    userClaudeSettingsTestResult,
  ]);
  const handleSaveOfficialApiKey = useCallback(async () => {
    const apiKey =
      officialApiKeyInputRef.current?.value?.trim() || officialApiKeyInput.trim();
    if (!apiKey) {
      setOfficialApiKeyError('请输入官方 API Key。');
      return;
    }

    setIsSavingOfficialApiKey(true);
    setOfficialApiKeyError(null);

    try {
      await agentClient.updateModelConfig(buildOfficialApiKeyPatch(modelAccessLocalConfig, apiKey));
      await agentClient.updateRuntimeCapabilities({
        selectedAuthSource: 'project_model_config',
      });
      clearChatModelAccessSnapshotCache();
      const nextGateResult = await bootstrapGate.retry();
      setOfficialApiKeyInput('');
      if (officialApiKeyInputRef.current) {
        officialApiKeyInputRef.current.value = '';
      }
      if (nextGateResult?.status === 'blocked') {
        setOfficialApiKeyError('官方 Key 已保存，但模型仍不可用，请检查 Key 是否有效。');
      }
      if (nextGateResult?.status === 'sync_failed') {
        setOfficialApiKeyError('官方 Key 已保存，但技能同步失败，请重新检查。');
      }
    } catch (error) {
      setOfficialApiKeyError(error instanceof Error ? error.message : '保存官方 API Key 失败，请稍后重试。');
    } finally {
      setIsSavingOfficialApiKey(false);
    }
  }, [
    agentClient,
    bootstrapGate,
    modelAccessLocalConfig,
    officialApiKeyInput,
  ]);
  const isModelInteractionDisabled =
    modelAccessViewState.overallStatus === 'needs_config' ||
    modelAccessViewState.overallStatus === 'unavailable';
  const isQuickPageEditDisabled =
    isWorkspaceSelectionRequired ||
    isResolvingPageEditTab ||
    pageEditStateQuery.isLoading ||
    isBootstrapGateBlocking;
  const shouldShowOfficialApiKeyForm =
    bootstrapGate.status === 'blocked' ||
    (bootstrapGate.status === 'ready' &&
      (emptyStateModelAccessStatus === 'needs_config' ||
        emptyStateModelAccessStatus === 'requires_official_api_key'));
  const handleToggleSelectedTab = useCallback(
    (tabId: number) => {
      const current = selectedTabIdsRef.current;
      const next = current.includes(tabId)
        ? current.filter((id) => id !== tabId)
        : [...current, tabId];
      const tabOrder = new Map(windowTabs.map((tab, index) => [tab.tabId, index]));
      const sortedNext = next.sort(
        (a, b) =>
          (tabOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (tabOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
      );
      setSelectedTabIds(sortedNext);
      setSelectedPrimaryTabId(
        resolveSessionPrimaryTabIdForScope({
          windowTabs,
          selectedTabIds: sortedNext,
          storedPrimaryTabId: selectedPrimaryTabIdRef.current,
        })
      );
    },
    [windowTabs]
  );
  const handleClearSelectedTabs = useCallback(() => {
    setSelectedTabIds([]);
    setSelectedPrimaryTabId(null);
  }, []);
  useEffect(() => {
    void refreshWindowTabs();

    const addListener = (
      event:
        | {
            addListener: (listener: (...args: unknown[]) => void) => void;
            removeListener: (listener: (...args: unknown[]) => void) => void;
          }
        | undefined,
      listener: (...args: unknown[]) => void
    ) => {
      event?.addListener(listener);
      return () => event?.removeListener(listener);
    };
    const handleTabsChanged = () => {
      void refreshWindowTabs();
    };

    const cleanup = [
      addListener(chrome.tabs?.onActivated, handleTabsChanged),
      addListener(chrome.tabs?.onCreated, handleTabsChanged),
      addListener(chrome.tabs?.onRemoved, handleTabsChanged),
      addListener(chrome.tabs?.onUpdated, handleTabsChanged),
    ];

    return () => {
      for (const dispose of cleanup) {
        dispose();
      }
    };
  }, [refreshWindowTabs]);
  useEffect(() => {
    const next = pruneSelectedTabIds(selectedTabIdsRef.current, windowTabs);
    if (!areTabIdListsEqual(selectedTabIdsRef.current, next)) {
      setSelectedTabIds(next);
    }
    setSelectedPrimaryTabId(
      resolveSessionPrimaryTabIdForScope({
        windowTabs,
        selectedTabIds: next,
        storedPrimaryTabId: selectedPrimaryTabIdRef.current,
      })
    );
  }, [windowTabs]);
  useEffect(() => {
    if (
      !shouldRestoreSessionTabSelection({
        scopeKey: tabSelectionScopeKey,
        resolvedScopeKey: resolvedTabSelectionScopeKey,
        isWindowTabsLoaded,
      })
    ) {
      return;
    }

    const previousScopeKey = resolvedTabSelectionScopeKey;
    let cancelled = false;

    const restoreSelection = async () => {
      let storedSelectedTabIds: number[] | null = null;
      let storedPrimaryTabId: number | null = null;

      if (stream.sessionId) {
        try {
          const storedSelection = await readAgentV2SessionSelectedTabs(stream.sessionId);
          storedSelectedTabIds = storedSelection?.selectedTabIds ?? null;
          storedPrimaryTabId = storedSelection?.primaryTabId ?? null;
        } catch (error) {
          console.debug('[chat] failed to read selected tabs for session:', error);
        }
      }

      const finalize = (nextSelectedTabIds: number[], nextPrimaryTabId: number | null) => {
        if (cancelled) {
          return;
        }
        setSelectedTabIds(nextSelectedTabIds);
        setSelectedPrimaryTabId(nextPrimaryTabId);
        setResolvedTabSelectionScopeKey(tabSelectionScopeKey);
      };

      const nextSelectedTabIds = resolveSessionTabSelectionForScope({
        sessionId: stream.sessionId,
        windowTabs,
        storedSelectedTabIds,
        previousScopeKey,
        currentSelectedTabIds: selectedTabIdsRef.current,
      });
      finalize(
        nextSelectedTabIds,
        resolveSessionPrimaryTabIdForScope({
          windowTabs,
          selectedTabIds: nextSelectedTabIds,
          storedPrimaryTabId,
        })
      );
    };

    void restoreSelection();
    return () => {
      cancelled = true;
    };
  }, [
    isWindowTabsLoaded,
    resolvedTabSelectionScopeKey,
    stream.sessionId,
    tabSelectionScopeKey,
    windowTabs,
  ]);
  useEffect(() => {
    if (
      !shouldPersistSessionTabSelection({
        sessionId: stream.sessionId,
        scopeKey: tabSelectionScopeKey,
        resolvedScopeKey: resolvedTabSelectionScopeKey,
      })
    ) {
      return;
    }

    const sessionId = stream.sessionId;
    if (!sessionId) {
      return;
    }
    const persistedSelectedTabIds = pruneSelectedTabIds(selectedTabIds, windowTabs);
    const primaryTabId = resolveSessionPrimaryTabIdForScope({
      windowTabs,
      selectedTabIds: persistedSelectedTabIds,
      storedPrimaryTabId: selectedPrimaryTabId,
    });
    const persistSelection = async () => {
      await writeAgentV2SessionSelectedTabs({
        sessionId,
        selectedTabIds: persistedSelectedTabIds,
        primaryTabId,
        source: DEFAULT_SELECTED_TAB_SOURCE,
        updatedAt: new Date().toISOString(),
      });
    };

    void persistSelection().catch((error) => {
      console.debug('[chat] failed to persist selected tabs for session:', error);
    });
  }, [
    resolvedTabSelectionScopeKey,
    selectedPrimaryTabId,
    selectedTabIds,
    stream.sessionId,
    tabSelectionScopeKey,
    windowTabs,
  ]);
  const updatePendingTakeoverConfirmation = useCallback(
    (next: WindowTakeoverConfirmationRequiredMessage['payload'] | null) => {
      logTakeoverUi('set-pending-confirmation', {
        next,
        previous: pendingTakeoverConfirmationRef.current,
      });
      pendingTakeoverConfirmationRef.current = next;
      setPendingTakeoverConfirmation(next);
    },
    [logTakeoverUi]
  );
  const updateIsResolvingTakeoverConfirmation = useCallback(
    (next: boolean) => {
      logTakeoverUi('set-resolving-confirmation', {
        next,
        previous: isResolvingTakeoverConfirmationRef.current,
      });
      isResolvingTakeoverConfirmationRef.current = next;
      setIsResolvingTakeoverConfirmation(next);
    },
    [logTakeoverUi]
  );
  useEffect(() => {
    logTakeoverUi('render-state', {
      pendingTakeoverConfirmation,
      isResolvingTakeoverConfirmation,
    });
  }, [isResolvingTakeoverConfirmation, logTakeoverUi, pendingTakeoverConfirmation]);
  useEffect(() => {
    chrome.windows
      .getCurrent({ populate: false })
      .then((window) => {
        setSidepanelWindowId(typeof window.id === 'number' ? window.id : null);
      })
      .catch((error) => {
        console.debug('[chat] failed to resolve sidepanel window id:', error);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void resolvePageEditTabId(getBrowserContext)
      .then((tabId) => {
        if (cancelled) {
          return;
        }
        setPageEditTabId(tabId);
        setPageEditStateOverride(undefined);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setQuickActionFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingPageEditTab(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    getWindowTakeoverState()
      .then((state) => {
        setTakeoverState(state);
        if (state?.runId) {
          takeoverRunIdRef.current = state.runId;
        }
      })
      .catch((error) => {
        console.debug('[takeover] failed to read initial takeover state:', error);
      });
  }, []);
  const scopedTakeoverState = useMemo(() => {
    if (!takeoverState) {
      return null;
    }
    if (sidepanelWindowId == null) {
      return null;
    }
    return takeoverState.windowId === sidepanelWindowId ? takeoverState : null;
  }, [sidepanelWindowId, takeoverState]);

  const handleForcedLeave = useCallback(
    async (input: {
      runId: string;
      sessionId: string;
      requestId: number;
      attemptedTabId: number;
      reason: 'tab_activated' | 'tab_navigated' | 'tab_removed';
    }) => {
      console.debug('[takeover] forced leave triggered', input);
      await stream.stop('window_takeover_user_left');
      const interruptedSessionId = stream.sessionId;
      if (interruptedSessionId && activeProjectPathRef.current) {
        await agentClient.markSessionInterrupted({
          sessionId: interruptedSessionId,
          projectPath: activeProjectPathRef.current,
          reason: 'window_takeover_user_left',
        });
      }
      await resolveWindowTakeoverLeaveDecision({
        decision: 'leave',
        attemptedTabId: input.attemptedTabId,
        requestId: input.requestId,
      });
    },
    [agentClient, stream]
  );

  const handleTakeoverStay = useCallback(async () => {
    const confirmation = pendingTakeoverConfirmationRef.current;
    logTakeoverUi('handle-stay:entered', {
      confirmation,
    });
    if (!confirmation || isResolvingTakeoverConfirmationRef.current) {
      logTakeoverUi('handle-stay:ignored', {
        confirmation,
      });
      return;
    }

    handledTakeoverConfirmationRequestIdsRef.current.add(confirmation.requestId);
    updatePendingTakeoverConfirmation(null);
    updateIsResolvingTakeoverConfirmation(true);
    try {
      await resolveWindowTakeoverLeaveDecision({
        decision: 'stay',
        attemptedTabId: confirmation.attemptedTabId,
        requestId: confirmation.requestId,
      });
      logTakeoverUi('handle-stay:resolved', {
        attemptedTabId: confirmation.attemptedTabId,
      });
    } catch (error) {
      console.debug('[takeover] failed to resume takeover run:', error);
      handledTakeoverConfirmationRequestIdsRef.current.delete(confirmation.requestId);
      updatePendingTakeoverConfirmation(confirmation);
    } finally {
      updateIsResolvingTakeoverConfirmation(false);
    }
  }, [logTakeoverUi, updateIsResolvingTakeoverConfirmation, updatePendingTakeoverConfirmation]);

  const handleTakeoverLeave = useCallback(async () => {
    const confirmation = pendingTakeoverConfirmationRef.current;
    logTakeoverUi('handle-leave:entered', {
      confirmation,
    });
    if (!confirmation || isResolvingTakeoverConfirmationRef.current) {
      logTakeoverUi('handle-leave:ignored', {
        confirmation,
      });
      return;
    }

    handledTakeoverConfirmationRequestIdsRef.current.add(confirmation.requestId);
    updatePendingTakeoverConfirmation(null);
    updateIsResolvingTakeoverConfirmation(true);
    try {
      await handleForcedLeave(confirmation);
      logTakeoverUi('handle-leave:resolved', {
        attemptedTabId: confirmation.attemptedTabId,
      });
    } catch (error) {
      console.debug('[takeover] failed to interrupt takeover run:', error);
      handledTakeoverConfirmationRequestIdsRef.current.delete(confirmation.requestId);
      updatePendingTakeoverConfirmation(confirmation);
    } finally {
      updateIsResolvingTakeoverConfirmation(false);
    }
  }, [handleForcedLeave, updateIsResolvingTakeoverConfirmation, updatePendingTakeoverConfirmation]);

  const activeInteractionCards = useMemo(() => {
    return stream.conversationItems
      .filter((item): item is { type: 'run'; card: RunCard } => item.type === 'run')
      .map((item) => item.card)
      .filter((card): card is ActiveInteractionCard =>
        Boolean(card.runId && card.activeInteraction)
      );
  }, [stream.conversationItems]);
  const questionInteractionCards = activeInteractionCards.filter(
    (card) => card.activeInteraction.kind === 'interactive_prompt'
  );
  const permissionInteractionCards = activeInteractionCards.filter(
    (card) => card.activeInteraction.kind === 'permission_request'
  );
  const planApprovalInteractionCards = activeInteractionCards.filter(
    (card) => card.activeInteraction.kind === 'plan_approval'
  );
  const isDecisionBlocked = activeInteractionCards.length > 0;
  const collapsedConversation = useMemo(
    () => sliceConversationRunItems(stream.conversationItems, DEFAULT_VISIBLE_CONVERSATION_ITEMS),
    [stream.conversationItems]
  );
  const visibleConversationItems = isFullConversationVisible
    ? stream.conversationItems
    : collapsedConversation.visibleItems;
  const conversationExportTitle = useMemo(
    () => deriveConversationExportTitle(currentSessionTitle, stream.conversationItems),
    [currentSessionTitle, stream.conversationItems]
  );
  const hiddenConversationItemCount = isFullConversationVisible
    ? 0
    : collapsedConversation.hiddenCount;
  const displayedConversationItems =
    selectionLockedConversationItems ?? visibleConversationItems;
  const displayedHiddenConversationItemCount =
    selectionLockedHiddenCount ?? hiddenConversationItemCount;
  const latestCaptureFeedback = useMemo(
    () => findLatestCaptureQuickActionFeedback(stream.conversationItems),
    [stream.conversationItems]
  );
  useEffect(() => {
    if (!latestCaptureFeedback) {
      return;
    }
    if (latestCaptureFeedback.itemId === lastCaptureFeedbackItemIdRef.current) {
      return;
    }
    lastCaptureFeedbackItemIdRef.current = latestCaptureFeedback.itemId;
    setDismissedCaptureFeedbackItemId((current) =>
      current === latestCaptureFeedback.itemId ? current : null
    );
  }, [latestCaptureFeedback]);
  const captureFeedbackBanner =
    latestCaptureFeedback && latestCaptureFeedback.itemId !== dismissedCaptureFeedbackItemId
      ? latestCaptureFeedback.feedback
      : null;
  const displayedQuickActionFeedback = captureFeedbackBanner ?? quickActionFeedback;
  const handleExportConversationMarkdown = useCallback(() => {
    if (stream.conversationItems.length === 0) {
      toast.error('当前会话暂无可导出的内容');
      return;
    }

    try {
      const exportedAt = new Date().toISOString();
      const markdown = buildConversationMarkdown({
        sessionId: stream.sessionId || conversationId,
        sessionTitle: conversationExportTitle,
        exportedAt,
        items: stream.conversationItems,
      });
      downloadTextFile(
        markdown,
        buildConversationMarkdownFileName({
          sessionTitle: conversationExportTitle,
          exportedAt,
        })
      );
      toast.success('会话 Markdown 已开始导出');
    } catch (error) {
      toast.error(localizeUserFacingError(error, '导出 Markdown 失败'));
    }
  }, [conversationExportTitle, conversationId, stream.conversationItems, stream.sessionId]);
  const handleCopyAssistantMarkdown = useCallback(async (card: RunCard) => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前环境不支持复制到剪贴板');
      return;
    }

    try {
      await navigator.clipboard.writeText(buildAssistantResponseMarkdown(card));
      toast.success('Markdown 已复制');
    } catch (error) {
      toast.error(localizeUserFacingError(error, '复制 Markdown 失败'));
    }
  }, []);
  const handleExportAssistantMarkdown = useCallback((card: RunCard) => {
    try {
      const timestamp =
        card.responseMessages[0]?.timestamp ||
        card.updatedAt ||
        card.startedAt ||
        new Date().toISOString();
      downloadTextFile(
        buildAssistantResponseMarkdown(card),
        buildAssistantResponseMarkdownFileName({ timestamp })
      );
      toast.success('回答 Markdown 已开始导出');
    } catch (error) {
      toast.error(localizeUserFacingError(error, '导出 Markdown 失败'));
    }
  }, []);
  const latestVisibleConversationItemKey = useMemo(() => {
    const latest = visibleConversationItems.at(-1);
    if (!latest) {
      return 'empty';
    }
    if (latest.type === 'user') {
      return `${latest.message.id}:${latest.message.timestamp}`;
    }
    return `${latest.card.id}:${latest.card.updatedAt || latest.card.startedAt || ''}:${
      latest.card.processItemCount
    }`;
  }, [visibleConversationItems]);
  const showFullConversation = useCallback(() => {
    setIsFullConversationVisible(true);
  }, []);
  const collapseConversation = useCallback(() => {
    setIsFullConversationVisible(false);
  }, []);
  const hideSelectionQuote = useCallback(() => {
    if (selectionQuoteTimerRef.current != null) {
      window.clearTimeout(selectionQuoteTimerRef.current);
      selectionQuoteTimerRef.current = null;
    }
    setSelectionQuote(null);
    setSelectionLockedConversationItems(null);
    setSelectionLockedHiddenCount(null);
  }, []);
  const updateSelectionQuote = useCallback(() => {
    const container = scrollRef.current;
    const selection = window.getSelection();
    if (!container || !selection) {
      hideSelectionQuote();
      return;
    }

    const selectedText = getActiveConversationSelection(container, selection);
    if (!selectedText) {
      hideSelectionQuote();
      return;
    }

    const range = selection.getRangeAt(0);
    const viewportWidth = window.innerWidth;
    const fallbackRect = {
      top: 48,
      left: 48,
      right: 48,
    };
    const rangeRect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : fallbackRect;
    const estimatedButtonWidth = 120;
    const overlayTop = rangeRect.top - 40;
    const overlayLeft = (rangeRect.left + rangeRect.right) / 2;
    const nextSelectionQuote = {
      text: selectedText,
      top: Math.max(overlayTop, 8),
      left: Math.min(
        Math.max(overlayLeft, 8),
        Math.max(viewportWidth - estimatedButtonWidth, 8)
      ),
    };

    if (selectionQuoteTimerRef.current != null) {
      window.clearTimeout(selectionQuoteTimerRef.current);
    }
    selectionQuoteTimerRef.current = window.setTimeout(() => {
      selectionQuoteTimerRef.current = null;
      const activeSelection = getActiveConversationSelection(scrollRef.current, window.getSelection());
      if (!activeSelection || activeSelection !== nextSelectionQuote.text) {
        return;
      }
      setSelectionLockedConversationItems((current) => current ?? visibleConversationItems);
      setSelectionLockedHiddenCount((current) => current ?? hiddenConversationItemCount);
      setSelectionQuote(nextSelectionQuote);
    }, 80);
  }, [hiddenConversationItemCount, hideSelectionQuote, visibleConversationItems]);
  const clearSelectionQuote = useCallback(() => {
    hideSelectionQuote();
    window.getSelection()?.removeAllRanges();
  }, [hideSelectionQuote]);
  const handleInputChange = useCallback((value: string) => {
    inputRef.current = value;
    setInput(value);
  }, []);
  const revokeAttachmentPreviewUrls = useCallback((removedAttachments: SessionAttachment[]) => {
    for (const attachment of removedAttachments) {
      const previewUrl = attachmentPreviewUrlsRef.current.get(attachment.id);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        attachmentPreviewUrlsRef.current.delete(attachment.id);
      }
    }
  }, []);
  const releaseRetainedPreviewUrls = useCallback(() => {
    releaseRetainedAttachmentPreviewUrls(retainedAttachmentPreviewUrlsRef.current);
  }, []);
  const deleteUploadedAttachments = useCallback(
    (removedAttachments: SessionAttachment[]) => {
      for (const attachment of removedAttachments) {
        const uploadSessionId = attachmentUploadSessionIdsRef.current.get(attachment.id);
        attachmentUploadSessionIdsRef.current.delete(attachment.id);
        if (!uploadSessionId) {
          continue;
        }
        void agentClient
          .deleteSessionFile({
            sessionId: uploadSessionId,
            sessionFileId: attachment.sessionFileId,
          })
          .catch((error) => {
            console.debug('[chat] failed to delete uploaded session attachment:', {
              attachment,
              error,
            });
          });
      }
    },
    [agentClient]
  );
  const discardComposerAttachments = useCallback(
    (pendingAttachments: SessionAttachment[]) => {
      revokeAttachmentPreviewUrls(pendingAttachments);
      deleteUploadedAttachments(findRemovedUploadedSessionAttachments(pendingAttachments, []));
    },
    [deleteUploadedAttachments, revokeAttachmentPreviewUrls]
  );
  useEffect(() => {
    return () => {
      releaseRetainedPreviewUrls();
    };
  }, [releaseRetainedPreviewUrls]);
  const handleAttachmentsChange = useCallback(
    (
      nextAttachments: SessionAttachment[] | ((current: SessionAttachment[]) => SessionAttachment[])
    ) => {
      const currentAttachments = attachmentsRef.current;
      const resolvedNext =
        typeof nextAttachments === 'function'
          ? nextAttachments(currentAttachments)
          : nextAttachments;
      const removedAttachments = currentAttachments.filter(
        (attachment) => !resolvedNext.some((nextAttachment) => nextAttachment.id === attachment.id)
      );
      revokeAttachmentPreviewUrls(removedAttachments);
      deleteUploadedAttachments(
        findRemovedUploadedSessionAttachments(currentAttachments, resolvedNext)
      );
      attachmentsRef.current = resolvedNext;
      setAttachments(resolvedNext);
    },
    [deleteUploadedAttachments, revokeAttachmentPreviewUrls]
  );
  const uploadComposerAttachments = useCallback(
    async (files: File[]) => {
      const uploadedAttachments: SessionAttachment[] = [];

      try {
        for (const [index, file] of files.entries()) {
          const uploadSessionId = stream.sessionId || conversationId;
          const uploadedAttachment = await agentClient.uploadSessionFile({
            sessionId: uploadSessionId,
            fileName: file.name || `attachment-${index + 1}`,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: await readFileAsBase64(file),
          });

          attachmentUploadSessionIdsRef.current.set(uploadedAttachment.id, uploadSessionId);
          const previewUrl =
            uploadedAttachment.kind === 'image' ? createAttachmentPreviewUrl(file) : undefined;
          if (previewUrl) {
            attachmentPreviewUrlsRef.current.set(uploadedAttachment.id, previewUrl);
          }

          uploadedAttachments.push(
            previewUrl ? { ...uploadedAttachment, previewUrl } : uploadedAttachment
          );
        }

        return uploadedAttachments;
      } catch (error) {
        revokeAttachmentPreviewUrls(uploadedAttachments);
        await Promise.allSettled(
          uploadedAttachments.map(async (attachment) => {
            const uploadSessionId = attachmentUploadSessionIdsRef.current.get(attachment.id);
            attachmentUploadSessionIdsRef.current.delete(attachment.id);
            if (!uploadSessionId) {
              return;
            }
            await agentClient.deleteSessionFile({
              sessionId: uploadSessionId,
              sessionFileId: attachment.sessionFileId,
            });
          })
        );
        throw error;
      }
    },
    [agentClient, conversationId, revokeAttachmentPreviewUrls, stream.sessionId]
  );
  const handleAppendSelectionQuote = useCallback(() => {
    if (!selectionQuote) {
      return;
    }

    const nextValue = appendChatSelectionQuote(inputRef.current, selectionQuote.text);
    inputRef.current = nextValue;
    setInput(nextValue);
    clearSelectionQuote();
  }, [clearSelectionQuote, selectionQuote]);
  const handleStopRun = useCallback(() => {
    return stream.stop('user_stop');
  }, [stream]);
  const updateScrollAffordance = useCallback(() => {
    const scrollElement = scrollRef.current;
    setHasContentBelow(scrollElement ? hasScrollableContentBelow(scrollElement) : false);
  }, []);
  const scrollToConversationBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) {
        return;
      }
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior,
      });
      requestAnimationFrame(updateScrollAffordance);
    },
    [updateScrollAffordance]
  );

  useEffect(() => {
    if (latestVisibleConversationItemKey === 'empty') {
      setHasContentBelow(false);
      return;
    }

    const hasActiveSelection = Boolean(
      getActiveConversationSelection(scrollRef.current, window.getSelection())
    );
    if (!shouldAutoScrollToLatest({ hasContentBelow, hasActiveSelection })) {
      updateScrollAffordance();
      return;
    }

    scrollToConversationBottom();
  }, [
    hasContentBelow,
    latestVisibleConversationItemKey,
    scrollToConversationBottom,
    updateScrollAffordance,
  ]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    return () => {
      if (selectionQuoteTimerRef.current != null) {
        window.clearTimeout(selectionQuoteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      discardComposerAttachments(attachmentsRef.current);
    };
  }, [discardComposerAttachments]);

  useEffect(() => {
    persistToolEvents(conversationId, stream.tools);
  }, [conversationId, stream.tools]);

  useEffect(() => {
    if (!stream.sessionId) {
      return;
    }
    void publishAgentV2CurrentSession({
      sessionId: stream.sessionId,
      projectPath: activeProjectPath,
      title: currentSessionTitle,
    }).catch((error) => {
      console.debug('[chat] failed to publish current Agent V2 session:', error);
    });
  }, [activeProjectPath, currentSessionTitle, stream.sessionId]);

  useEffect(() => {
    liveWritePreviewRef.current.clear();
    liveBackendPreviewDirectoryEntriesRef.current.clear();
    openedLiveWritePreviewIdsRef.current.clear();
    liveWritePreviewTabRef.current = null;
    liveWritePreviewOpenTaskRef.current = null;
    processedToolSignaturesRef.current.clear();
    hasHydratedProcessedToolsRef.current = false;
  }, [conversationId]);

  useEffect(() => {
    const nextTools = collectIncrementalToolDisplayRecords(
      stream.tools,
      processedToolSignaturesRef.current,
      hasHydratedProcessedToolsRef.current
    );
    hasHydratedProcessedToolsRef.current = true;

    for (const tool of nextTools) {
      const writePayload = writeToolPayload(tool);
      if (!writePayload) {
        continue;
      }
      const location = resolveWritePreviewLocation(
        activeProjectPath || backendWorkdir,
        writePayload.filePath
      );
      if (!location) {
        continue;
      }

      const previewId = `${tool.id}:${location.projectPath}:${location.filePath}`;
      const status =
        tool.status === 'error' ? 'failed' : tool.status === 'done' ? 'completed' : 'writing';
      if (
        !shouldPublishLiveWritePreviewUpdate({
          operation: writePayload.operation,
          content: writePayload.content,
          status,
        })
      ) {
        continue;
      }
      const publishKey = `${previewId}:${status}:${writePayload.content.length}`;
      if (liveWritePreviewRef.current.has(publishKey)) {
        continue;
      }
      liveWritePreviewRef.current.add(publishKey);

      const isHtmlPreview = isHtmlPreviewFilePath(location.filePath);
      const previewDirectoryKey = livePreviewDirectoryKey(location.projectPath, location.filePath);
      if (isHtmlPreview) {
        liveBackendPreviewDirectoryEntriesRef.current.set(previewDirectoryKey, location.filePath);
      }
      const backendLivePreviewEntryFilePath = isHtmlPreview
        ? location.filePath
        : liveBackendPreviewDirectoryEntriesRef.current.get(previewDirectoryKey);
      const previewUrl = isHtmlPreview
        ? buildHtmlBrowserPreviewUrl({
            ...location,
            backendBaseUrl: config.api.agentV2BaseUrl,
            mode: 'live-preview',
          })
        : buildSidepanelFilePreviewUrl({
            ...location,
            mode: 'live-write',
          });

      void publishLiveWritePreview({
        id: previewId,
        projectPath: location.projectPath,
        filePath: location.filePath,
        content: writePayload.content,
        operation: writePayload.operation,
        oldString: writePayload.oldString,
        newString: writePayload.newString,
        replaceAll: writePayload.replaceAll,
        status,
        updatedAt: new Date().toISOString(),
      });

      if (
        backendLivePreviewEntryFilePath &&
        isBackendLivePreviewFilePath(location.filePath) &&
        location.projectPath === (activeProjectPath || backendWorkdir)
      ) {
        const shouldPublishBackendLivePreview = shouldPublishBackendLivePreviewUpdate({
          filePath: location.filePath,
          status,
        });
        if (shouldPublishBackendLivePreview) {
          void publishBackendLivePreview({
            backendBaseUrl: config.api.agentV2BaseUrl,
            entryFilePath: backendLivePreviewEntryFilePath,
            projectPath: location.projectPath,
            filePath: location.filePath,
            writeId: previewId,
            content: writePayload.content,
            operation: writePayload.operation,
            oldString: writePayload.oldString,
            newString: writePayload.newString,
            replaceAll: writePayload.replaceAll,
          }).catch((error) => {
            console.debug('[chat] failed to publish backend live preview:', error);
          });
        }

        if (status === 'completed' || status === 'failed') {
          void completeBackendLivePreview({
            backendBaseUrl: config.api.agentV2BaseUrl,
            entryFilePath: backendLivePreviewEntryFilePath,
            projectPath: location.projectPath,
            filePath: location.filePath,
            writeId: previewId,
            failed: status === 'failed',
          }).catch((error) => {
            console.debug('[chat] failed to complete backend live preview:', error);
          });
        }
      }

      if (
        shouldAutoOpenLiveWritePreview(
          openedLiveWritePreviewIdsRef.current,
          previewId,
          status,
          location.filePath
        )
      ) {
        console.debug('[chat] opening live write preview:', previewUrl);
        const previousOpenTask = liveWritePreviewOpenTaskRef.current ?? Promise.resolve();
        const openTask = previousOpenTask
          .catch(() => undefined)
          .then(() => {
            if (isHtmlPreview) {
              return openHtmlBrowserPreview(previewUrl, {
                fallbackUrl: buildFileBrowserPreviewUrl(location),
              });
            }
            return openLiveWritePreviewTab({
              previewUrl,
              currentTabId: liveWritePreviewTabRef.current,
              setCurrentTabId: (tabId) => {
                liveWritePreviewTabRef.current = tabId;
              },
              takeoverState: scopedTakeoverState,
            });
          })
          .catch((error) => {
            liveWritePreviewTabRef.current = null;
            console.debug('[chat] failed to open live write preview:', error);
          });
        liveWritePreviewOpenTaskRef.current = openTask;
        void openTask.finally(() => {
          if (liveWritePreviewOpenTaskRef.current === openTask) {
            liveWritePreviewOpenTaskRef.current = null;
          }
        });
      }

      if (isHtmlPreview && status === 'completed') {
        void (liveWritePreviewOpenTaskRef.current ?? Promise.resolve())
          .catch(() => undefined)
          .then(() => reloadHtmlBrowserPreview(previewUrl));
      }
    }
  }, [activeProjectPath, backendWorkdir, stream.tools]);

  useEffect(() => {
    const handler = () => {
      void openSidepanelRoute('/settings?mode=mcp');
    };
    window.addEventListener('open-tool-selector', handler as EventListener);
    return () => window.removeEventListener('open-tool-selector', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!isConfigMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!configMenuRef.current?.contains(event.target as Node)) {
        setIsConfigMenuOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsConfigMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isConfigMenuOpen]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'ensure_companion_ready' }).catch((error) => {
      console.debug('[chat] ensure_companion_ready failed:', error);
    });
  }, []);

  useEffect(() => {
    agentClient
      .getCapabilities()
      .then((capabilities) => {
        if (capabilities.workdir) {
          setBackendWorkdir(capabilities.workdir);
        }
      })
      .catch((error) => {
        console.debug('[chat] failed to load Agent V2 capabilities:', error);
      });
  }, [agentClient]);

  useEffect(() => {
    if (!backendWorkdir || hasAttemptedDefaultWorkspaceBootstrap) {
      return;
    }

    let cancelled = false;
    const defaultWorkspacePath = resolveDefaultWorkspacePath(backendWorkdir);

    void readAgentV2ProjectSelection()
      .then(async (selection) => {
        if (cancelled || selection?.projectPath) {
          return;
        }

        const projects = await agentClient.listProjects();
        if (cancelled) {
          return;
        }

        const hasDefaultWorkspace = projects.some(
          (project) => project.projectPath === defaultWorkspacePath
        );
        if (!hasDefaultWorkspace) {
          return;
        }

        await publishAgentV2ProjectSelection({ projectPath: defaultWorkspacePath });
        activeProjectPathRef.current = defaultWorkspacePath;
        setActiveProjectPath(defaultWorkspacePath);
      })
      .catch((error) => {
        console.debug('[chat] failed to bootstrap default workspace selection:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setHasAttemptedDefaultWorkspaceBootstrap(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentClient, backendWorkdir, hasAttemptedDefaultWorkspaceBootstrap]);

  const handleLocalCommand = (command: CommandCatalogEntry) => {
    switch (command.name) {
      case '/clear':
        resetConversation({ preserveProjectPath: activeProjectPathRef.current });
        return;
      case '/new':
        void startNewSessionFromChat();
        return;
      case '/sessions':
        openAgentWorkspaceManager();
        return;
      case '/mcp':
        void openSidepanelRoute('/settings?mode=mcp');
        return;
      case '/help':
        setInput('/help ');
        return;
      default:
        setInput(`${command.name} `);
    }
  };

  const startNewSessionFromChat = async () => {
    const selectedProjectPath =
      activeProjectPath || (await readAgentV2ProjectSelection())?.projectPath;
    if (selectedProjectPath) {
      activeProjectPathRef.current = selectedProjectPath;
      resetConversation({ preserveProjectPath: selectedProjectPath });
      return;
    }

    await publishAgentV2WorkspaceIntent({ kind: 'new_session' });
    openAgentWorkspaceManager();
  };

  const promptWorkspaceSelectionForNewSession = async () => {
    setQuickActionFeedback({
      kind: 'error',
      message: '请先选择一个工作区，再开始新对话。',
    });
    await publishAgentV2WorkspaceIntent({ kind: 'new_session' });
    openAgentWorkspaceManager();
  };

  const send = async () => {
    const rawContent = input.trim();
    if (
      isModelInteractionDisabled ||
      isDecisionBlocked ||
      isRestoringSessionRun ||
      (!rawContent && attachments.length === 0) ||
      stream.status === 'connecting' ||
      stream.status === 'streaming'
    ) {
      return;
    }

    const content = rawContent
      ? await resolveCommandInput(rawContent, {
          projectPath: activeProjectPath,
          listCommands: agentClient.listCommands,
          executeCommand: agentClient.executeCommand,
          onLocalCommand: handleLocalCommand,
        })
      : attachments.every((attachment) => attachment.kind === 'image')
        ? '请分析这些图片。'
        : '请结合这些附件继续分析。';
    if (!content || typeof content !== 'string') {
      return;
    }

    const nextSessionTitle =
      currentSessionTitle || deriveSessionTitleFromMessage(rawContent || content);
    if (!currentSessionTitle && nextSessionTitle) {
      setCurrentSessionTitle(nextSessionTitle);
    }

    setInput('');
    const runAttachments = attachments;
    retainAttachmentPreviewUrls(
      runAttachments,
      attachmentPreviewUrlsRef.current,
      retainedAttachmentPreviewUrlsRef.current
    );
    for (const attachment of runAttachments) {
      attachmentUploadSessionIdsRef.current.delete(attachment.id);
    }
    attachmentsRef.current = [];
    setAttachments([]);
    const pageWorkbenchTabId =
      isPageEditActive(effectivePageEditState) && effectivePageEditState?.pageMode === 'live-page'
        ? (effectivePageEditState?.tabId ?? pageEditTabId)
        : null;
    const nextSelectedTabIds = includeTabInSessionSelection({
      windowTabs,
      selectedTabIds,
      tabId: pageWorkbenchTabId,
    });
    if (!areTabIdListsEqual(selectedTabIdsRef.current, nextSelectedTabIds)) {
      setSelectedTabIds(nextSelectedTabIds);
    }

    const effectivePrimaryTabId =
      typeof pageWorkbenchTabId === 'number' && nextSelectedTabIds.includes(pageWorkbenchTabId)
        ? pageWorkbenchTabId
        : resolveSessionPrimaryTabIdForScope({
            windowTabs,
            selectedTabIds: nextSelectedTabIds,
            storedPrimaryTabId: selectedPrimaryTabId,
          });
    if (selectedPrimaryTabIdRef.current !== effectivePrimaryTabId) {
      setSelectedPrimaryTabId(effectivePrimaryTabId);
    }

    const selectedTabsForContext = nextSelectedTabIds
      .map((selectedTabId) => windowTabs.find((tab) => tab.tabId === selectedTabId))
      .filter((tab): tab is SessionTabSummary => Boolean(tab));
    const capturedSelectedTabs = await Promise.all(
      selectedTabsForContext.map(async (tab): Promise<BrowserContextTabSnapshot> => {
        try {
          const result = await pageSelectionMutation.mutateAsync({
            tabId: tab.tabId,
            windowId: tab.windowId,
            includeFrames: true,
            frameStrategy: 'wps-priority',
            includeFrameAnalysis: true,
            maxChars: 12_000,
          });

          return {
            tabId: tab.tabId,
            windowId: tab.windowId,
            title: result.title || tab.title,
            url: result.url || tab.url,
            content: result.text,
          };
        } catch (error) {
          return {
            tabId: tab.tabId,
            windowId: tab.windowId,
            title: tab.title,
            url: tab.url,
            captureError: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    browserContextRef.current = buildSelectedTabsBrowserContext({
      tabs: capturedSelectedTabs,
      primaryTabId: effectivePrimaryTabId,
    });
    const selectedProjectPath =
      activeProjectPath || (await readAgentV2ProjectSelection())?.projectPath;
    if (!stream.sessionId && !selectedProjectPath) {
      await promptWorkspaceSelectionForNewSession();
      return;
    }
    if (selectedProjectPath && selectedProjectPath !== activeProjectPath) {
      activeProjectPathRef.current = selectedProjectPath;
      setActiveProjectPath(selectedProjectPath);
    }
    await stream.sendMessage(content, {
      browserContext: browserContextRef.current,
      projectPath: selectedProjectPath,
      permissionMode,
      effort: thinkingMode,
      attachments: runAttachments,
    });
  };

  const resetConversation = (options?: { preserveProjectPath?: string }) => {
    sessionRunRestoreRequestIdRef.current += 1;
    setIsRestoringSessionRun(false);
    clearSelectionQuote();
    discardComposerAttachments(attachmentsRef.current);
    releaseRetainedPreviewUrls();
    void stopWindowTakeover().catch(() => undefined);
    takeoverRunIdRef.current = null;
    handledTakeoverConfirmationRequestIdsRef.current.clear();
    setTakeoverState(null);
    stream.reset();
    setInput('');
    attachmentsRef.current = [];
    setAttachments([]);
    setCurrentSessionTitle(undefined);
    activeProjectPathRef.current = options?.preserveProjectPath;
    setActiveProjectPath(options?.preserveProjectPath);
    setIsFullConversationVisible(false);
    setConversationId(crypto.randomUUID());
  };

  useEffect(() => {
    if (!pendingContinuation) {
      return;
    }
    if (stream.sessionId || stream.activeRunId) {
      return;
    }

    const permissionMode = pendingContinuation.permissionMode;
    const prompt = pendingContinuation.prompt;
    setPendingContinuation(null);
    void stream.sendMessage(prompt, {
      browserContext: browserContextRef.current,
      projectPath: activeProjectPathRef.current || backendWorkdir || undefined,
      permissionMode,
      effort: thinkingMode,
      attachments: [],
    });
  }, [
    backendWorkdir,
    pendingContinuation,
    stream,
    thinkingMode,
  ]);

  const loadSession = useCallback(
    async (sessionId: string, projectPath?: string, sessionTitle?: string) => {
      const restoreRequestId = sessionRunRestoreRequestIdRef.current + 1;
      sessionRunRestoreRequestIdRef.current = restoreRequestId;
      setIsRestoringSessionRun(false);
      clearSelectionQuote();
      discardComposerAttachments(attachmentsRef.current);
      releaseRetainedPreviewUrls();
      attachmentsRef.current = [];
      setAttachments([]);
      const resolvedProjectPath = projectPath;
      const history = await sessions.loadHistory(sessionId, {
        projectPath: resolvedProjectPath,
      });
      if (!history) {
        return false;
      }
      if (sessionRunRestoreRequestIdRef.current !== restoreRequestId) {
        return false;
      }

      stream.loadHistory(history);
      setCurrentSessionTitle(sessionTitle);
      activeProjectPathRef.current = resolvedProjectPath;
      setActiveProjectPath(resolvedProjectPath);
      setIsFullConversationVisible(false);
      setConversationId(history.sessionId);
      setIsRestoringSessionRun(true);

      try {
        const runState = await agentClient.getSessionRunState(history.sessionId);
        if (sessionRunRestoreRequestIdRef.current !== restoreRequestId) {
          return false;
        }
        stream.restoreSessionRunState(runState);
        const hasActiveStream = Boolean(runState?.hasActiveStream);
        if (hasActiveStream) {
          void stream.resumeRun(runState);
        }
        if (!hasActiveStream) {
          await clearAgentV2ActiveRunSession().catch((error) => {
            console.debug('[chat] failed to clear stale active Agent V2 session:', error);
          });
        }
        return hasActiveStream;
      } catch (error) {
        console.debug('[chat] failed to restore session run state:', error);
        return false;
      } finally {
        if (sessionRunRestoreRequestIdRef.current === restoreRequestId) {
          setIsRestoringSessionRun(false);
        }
      }
    },
    [
      agentClient,
      attachmentsRef,
      clearSelectionQuote,
      discardComposerAttachments,
      sessions.loadHistory,
      stream.loadHistory,
      stream.restoreSessionRunState,
    ]
  );

  useEffect(() => {
    const context = browserContextRef.current;
    console.debug('[takeover] evaluate start conditions', {
      activeRunId: stream.activeRunId,
      sessionId: stream.sessionId,
      browserContext: context,
      takeoverRunId: takeoverRunIdRef.current,
      takeoverState: scopedTakeoverState,
    });
    if (!stream.activeRunId || !context?.tabId || !context.windowId) {
      return;
    }

    if (context.source !== 'active-tab') {
      console.debug('[takeover] skip start because browser context is not the active tab', {
        browserContext: context,
      });
      return;
    }

    const desiredSessionId = stream.sessionId || `pending:${stream.activeRunId}`;
    const shouldRefreshExistingTakeover =
      takeoverRunIdRef.current === stream.activeRunId &&
      scopedTakeoverState?.runId === stream.activeRunId &&
      scopedTakeoverState.sessionId !== desiredSessionId &&
      scopedTakeoverState.sessionId.startsWith('pending:') &&
      Boolean(stream.sessionId);

    if (takeoverRunIdRef.current === stream.activeRunId && !shouldRefreshExistingTakeover) {
      return;
    }

    takeoverRunIdRef.current = stream.activeRunId;
    console.debug('[takeover] starting window takeover', {
      runId: stream.activeRunId,
      sessionId: desiredSessionId,
      windowId: context.windowId,
      lockedTabId: context.tabId,
      lockedUrl: context.url,
    });
    void startWindowTakeover({
      sessionId: desiredSessionId,
      runId: stream.activeRunId,
      windowId: context.windowId,
      lockedTabId: context.tabId,
      lockedUrl: context.url,
    })
      .then((state) => {
        console.debug('[takeover] started window takeover', state);
        setTakeoverState(state);
      })
      .catch((error) => {
        console.debug('[takeover] failed to start window takeover:', error);
      });
  }, [scopedTakeoverState, stream.activeRunId, stream.sessionId]);

  useEffect(() => {
    if (stream.activeRunId || !takeoverRunIdRef.current) {
      return;
    }

    if (
      scopedTakeoverState?.status === 'active' ||
      scopedTakeoverState?.status === 'interrupting'
    ) {
      void stopWindowTakeover().catch((error) => {
        console.debug('[chat] failed to stop window takeover:', error);
      });
    }

    takeoverRunIdRef.current = null;
  }, [scopedTakeoverState?.status, stream.activeRunId]);

  useEffect(() => {
    const openSelectedProject = (selection: AgentV2ProjectSelection) => {
      if (!selection.projectPath) {
        return;
      }
      const currentProjectPath = activeProjectPathRef.current || backendWorkdir;
      const isSameProject = sameProjectPath(currentProjectPath, selection.projectPath);
      if (isSameProject && selection.kind !== 'new_session') {
        return;
      }
      clearSelectionQuote();
      discardComposerAttachments(attachmentsRef.current);
      releaseRetainedPreviewUrls();
      sessionRunRestoreRequestIdRef.current += 1;
      setIsRestoringSessionRun(false);
      stream.reset();
      setInput('');
      attachmentsRef.current = [];
      setAttachments([]);
      setQuickActionFeedback(null);
      setCurrentSessionTitle(undefined);
      sessions.clearSessions();
      activeProjectPathRef.current = selection.projectPath;
      setActiveProjectPath(selection.projectPath);
      setIsFullConversationVisible(false);
      setConversationId(crypto.randomUUID());
    };

    const handleMessage = (message: unknown) => {
      if (!isAgentV2ProjectSelectedMessage(message)) {
        return;
      }
      openSelectedProject(message.payload);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    readAgentV2ProjectSelection()
      .then((selection) => {
        if (selection) {
          openSelectedProject(selection);
        }
      })
      .catch((error) => {
        console.debug('[chat] failed to read selected Agent V2 project:', error);
      });

    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [
    attachmentsRef,
    backendWorkdir,
    clearSelectionQuote,
    discardComposerAttachments,
    sessions.clearSessions,
    stream.reset,
  ]);

  useEffect(() => {
    const openSelectedSession = (selection: AgentV2SessionSelection) => {
      const marker = `${selection.sessionId}:${selection.selectedAt}`;
      if (selectedSessionMarkerRef.current === marker) {
        return;
      }
      selectedSessionMarkerRef.current = marker;
      void loadSession(selection.sessionId, selection.projectPath, selection.title);
    };

    const handleMessage = (message: unknown) => {
      if (!isAgentV2SessionSelectedMessage(message)) {
        return;
      }
      openSelectedSession(message.payload);
    };

    const restoreSessionSelectionFallback = async () => {
      const selection = await readAgentV2SessionSelection();
      if (selection) {
        openSelectedSession(selection);
      }
    };

    const restoreInitialSession = async () => {
      const activeRunSession = await readAgentV2ActiveRunSession();
      if (!activeRunSession) {
        await restoreSessionSelectionFallback();
        return;
      }

      const restored = await loadSession(activeRunSession.sessionId, activeRunSession.projectPath);
      if (restored) {
        return;
      }

      await restoreSessionSelectionFallback();
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    restoreInitialSession().catch((error) => {
      console.debug('[chat] failed to restore initial Agent V2 session:', error);
    });

    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [loadSession]);

  useEffect(() => {
    const appendToInput = (text: string) => {
      setInput((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
    };

    const handleMessage = (message: unknown) => {
      if (!isAgentV2ComposerAppendMessage(message)) {
        return;
      }
      appendToInput(message.payload.text);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    readAgentV2ComposerAppend()
      .then((payload) => {
        if (payload) {
          appendToInput(payload.text);
        }
      })
      .catch((error) => {
        console.debug('[chat] failed to read pending composer append:', error);
      });

    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (!isAgentV2QuickActionFeedbackMessage(message)) {
        return;
      }

      setQuickActionFeedback({
        kind: message.payload.kind,
        message: message.payload.message,
        entryPath: message.payload.entryPath,
        suffixMessage: message.payload.suffixMessage,
      });
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    readAgentV2QuickActionFeedback()
      .then((payload) => {
        if (!payload) {
          return;
        }
        setQuickActionFeedback({
          kind: payload.kind,
          message: payload.message,
          entryPath: payload.entryPath,
          suffixMessage: payload.suffixMessage,
        });
      })
      .catch((error) => {
        console.debug('[chat] failed to read pending quick action feedback:', error);
      });

    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (isWindowTakeoverStateChangedMessage(message)) {
        if (sidepanelWindowId != null && message.payload.windowId !== sidepanelWindowId) {
          return;
        }
        console.debug('[takeover] state changed message', message.payload);
        setTakeoverState(message.payload);
        if (message.payload.status !== 'active') {
          takeoverRunIdRef.current = null;
          handledTakeoverConfirmationRequestIdsRef.current.clear();
          updatePendingTakeoverConfirmation(null);
          updateIsResolvingTakeoverConfirmation(false);
        }
        return;
      }

      if (!isWindowTakeoverConfirmationRequiredMessage(message)) {
        return;
      }

      if (sidepanelWindowId != null && message.payload.windowId !== sidepanelWindowId) {
        return;
      }

      logTakeoverUi('confirmation-required-message', {
        payload: message.payload,
        currentRunId: takeoverRunIdRef.current || stream.activeRunId,
      });

      if (message.payload.runId !== (takeoverRunIdRef.current || stream.activeRunId)) {
        console.debug('[takeover] ignoring confirmation for non-current run', {
          currentRunId: takeoverRunIdRef.current || stream.activeRunId,
          incomingRunId: message.payload.runId,
        });
        return;
      }

      if (handledTakeoverConfirmationRequestIdsRef.current.has(message.payload.requestId)) {
        console.debug('[takeover] ignoring already handled confirmation request', {
          payload: message.payload,
        });
        return;
      }

      if (pendingTakeoverConfirmationRef.current || isResolvingTakeoverConfirmationRef.current) {
        console.debug('[takeover] confirmation already visible or resolving, ignore duplicate', {
          payload: message.payload,
          pendingTakeoverConfirmation: pendingTakeoverConfirmationRef.current,
          isResolvingTakeoverConfirmation: isResolvingTakeoverConfirmationRef.current,
        });
        return;
      }

      if (message.payload.reason === 'tab_removed') {
        void handleForcedLeave(message.payload);
        return;
      }
      updatePendingTakeoverConfirmation(message.payload);
      updateIsResolvingTakeoverConfirmation(false);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [
    handleForcedLeave,
    logTakeoverUi,
    sidepanelWindowId,
    stream.activeRunId,
    updateIsResolvingTakeoverConfirmation,
    updatePendingTakeoverConfirmation,
  ]);

  const openAgentWorkspaceManager = () => {
    void openSidepanelRoute('/settings?mode=workspace');
  };

  const openModelManagement = () => {
    void openSidepanelRoute('/settings?mode=model');
  };

  const handleOpenQuickActionEntry = async (entryPath: string) => {
    if (!quickProjectPath) {
      setQuickActionFeedback({
        kind: 'error',
        message: '当前未找到工作区，无法定位采集目录。',
      });
      return;
    }

    try {
      const targetRoute = `/settings?mode=workspace&projectPath=${encodeURIComponent(
        quickProjectPath
      )}&entryPath=${encodeURIComponent(entryPath)}`;
      await openSidepanelRoute(targetRoute);
    } catch (error) {
      setQuickActionFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '定位采集目录失败',
      });
    }
  };

  const handleQuickCapturePage = async () => {
    setQuickActionFeedback({
      kind: 'pending',
      message: '正在采集整页并写入当前工作区...',
    });
    try {
      const result = await triggerWorkspacePageCapture(
        {
          mode: 'page',
          projectPath: quickProjectPath,
        },
        (payload) => pageCaptureMutation.mutateAsync(payload as never)
      );
      const warningSuffix =
        typeof result.warningCount === 'number' && result.warningCount > 0
          ? `，有 ${result.warningCount} 项资源未完全本地化`
          : '';
      setQuickActionFeedback({
        kind: 'success',
        message: '网页已保存到',
        entryPath: result.entryPath,
        suffixMessage: warningSuffix,
      });
    } catch (error) {
      setQuickActionFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '采集整页失败',
      });
    }
  };

  const runQuickPageEditTransition = useCallback(
    async (target: 'active' | 'inactive') => {
      quickPageEditExecutingTargetRef.current = target;
      quickPageEditQueuedTargetRef.current = null;
      setQuickActionFeedback(null);
      setIsQuickPageEditActionPending(true);

      let actualActiveAfterAttempt = isPageEditActive(effectivePageEditStateRef.current);

      try {
        if (target === 'inactive') {
          const currentState = effectivePageEditStateRef.current;
          const tabId = currentState?.tabId ?? pageEditTabIdRef.current;
          if (tabId == null) {
            setQuickActionFeedback({
              kind: 'error',
              message: '未找到当前页面',
            });
            return;
          }

          if (currentState) {
            setPageEditStateOverride({
              ...currentState,
              status: 'deactivating',
            });
          }

          await deactivatePageEditMutation.mutateAsync({ tabId });
          actualActiveAfterAttempt = false;
          setPageEditStateOverride(null);
          setQuickActionFeedback({
            kind: 'success',
            message: getPageEditSuccessMessage(null),
          });
        } else {
          const nextState = await activatePageEditMutation.mutateAsync();
          actualActiveAfterAttempt = true;
          setPageEditStateOverride(nextState as PageEditState);
          setQuickActionFeedback({
            kind: 'success',
            message: getPageEditActivationSuccessMessage(nextState as PageEditState),
          });
        }
      } catch (error) {
        if (target === 'inactive') {
          actualActiveAfterAttempt = true;
        } else {
          actualActiveAfterAttempt = false;
        }
        setQuickActionFeedback({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : target === 'inactive'
                ? '退出编辑失败'
                : '进入编辑失败',
        });
      } finally {
        quickPageEditExecutingTargetRef.current = null;
        setIsQuickPageEditActionPending(false);
        void pageEditStateQuery.refetch();
      }

      const queuedTarget = quickPageEditQueuedTargetRef.current;
      quickPageEditQueuedTargetRef.current = null;
      if (queuedTarget && (queuedTarget === 'active') !== actualActiveAfterAttempt) {
        void runQuickPageEditTransition(queuedTarget);
      }
    },
    [activatePageEditMutation, deactivatePageEditMutation, pageEditStateQuery]
  );

  const handleQuickTogglePageEdit = async () => {
    setQuickActionFeedback(null);
    const pendingTarget =
      quickPageEditQueuedTargetRef.current ?? quickPageEditExecutingTargetRef.current;
    const currentlyActive =
      pendingTarget != null
        ? pendingTarget === 'active'
        : isPageEditActive(effectivePageEditStateRef.current);
    const nextTarget = currentlyActive ? 'inactive' : 'active';

    if (quickPageEditExecutingTargetRef.current) {
      quickPageEditQueuedTargetRef.current = nextTarget;
      return;
    }

    void runQuickPageEditTransition(nextTarget);
  };

  return (
    <div className="relative flex h-full flex-col">
      <Dialog open={Boolean(pendingTakeoverConfirmation)}>
        <DialogContent
          showCloseButton={false}
          className="w-[min(92vw,460px)] gap-0 overflow-hidden p-0"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">确认离开当前页面</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              当前 AI
              正在接管这个浏览器窗口执行任务。若你离开当前页面，本次运行会被中断，并将该会话标记为已中断。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-700">
              选择“继续留在当前页”会恢复本次运行；选择“离开并中断”会立即停止当前对话任务。
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTakeoverStay()}
                disabled={isResolvingTakeoverConfirmation}
              >
                继续留在当前页
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleTakeoverLeave()}
                disabled={isResolvingTakeoverConfirmation}
              >
                离开并中断
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="bg-background/80 p-2">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1 ${
              isBootstrapGateBlocking ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-disabled={isBootstrapGateBlocking}
          >
            <Button
              type="button"
              variant="ghost"
              className={`relative h-auto min-w-0 w-1/2 shrink-0 justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 ${
                isWorkspaceSelectionRequired
                  ? 'bg-amber-50/90 text-amber-950 shadow-[0_0_0_1px_rgba(217,119,6,0.18)] hover:bg-amber-50'
                  : 'bg-muted/50 hover:bg-muted'
              } ${isBootstrapGateBlocking ? 'pointer-events-none cursor-default' : ''}`}
              onClick={() => {
                if (isBootstrapGateBlocking) {
                  return;
                }
                openAgentWorkspaceManager();
              }}
              title={
                currentChatContext.workspacePath
                  ? `${currentChatContext.sessionTitle} · ${currentChatContext.workspacePath}`
                  : `${currentChatContext.sessionTitle} · ${currentChatContext.workspaceName}`
              }
              aria-label="打开当前工作区"
              disabled={isBootstrapGateBlocking}
            >
              {isWorkspaceSelectionRequired ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-md bg-[conic-gradient(from_0deg,rgba(251,191,36,0.12)_0deg,rgba(245,158,11,0.88)_72deg,rgba(251,191,36,0.18)_144deg,rgba(245,158,11,0.88)_216deg,rgba(251,191,36,0.12)_360deg)] animate-[spin_3.2s_linear_infinite]"
                />
              ) : null}
              {isWorkspaceSelectionRequired ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-[1.5px] rounded-[5px] bg-amber-50/96"
                />
              ) : null}
              <div className="min-w-0 flex-1 text-left">
                <p
                  className="relative truncate text-xs font-medium leading-4 text-foreground"
                  title={currentChatContext.sessionTitle}
                >
                  {currentChatContext.sessionTitle}
                </p>
                <p
                  className={`relative truncate text-[10px] leading-4 ${
                    isWorkspaceSelectionRequired ? 'text-amber-700' : 'text-muted-foreground'
                  }`}
                  title={currentChatContext.workspacePath ?? undefined}
                >
                  {currentChatContext.workspaceName}
                </p>
              </div>
              <ChevronDownIcon
                className={`relative h-4 w-4 shrink-0 ${
                  isWorkspaceSelectionRequired ? 'text-amber-700' : 'text-muted-foreground'
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void startNewSessionFromChat()}
              title="新建会话"
              aria-label="新建会话"
              disabled={isWorkspaceSelectionRequired || isBootstrapGateBlocking}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void handleQuickCapturePage()}
              title="采集整页"
              aria-label="采集整页"
              disabled={
                isWorkspaceSelectionRequired ||
                isQuickCapturePending ||
                isModelInteractionDisabled ||
                isBootstrapGateBlocking
              }
            >
              <CameraIcon className="h-4 w-4" />
            </Button>

            <Button
              variant={isPageEditActive(effectivePageEditState) ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => void handleQuickTogglePageEdit()}
              title={quickPageEditLabel}
              aria-label={quickPageEditLabel}
              disabled={isQuickPageEditDisabled}
            >
              <PencilIcon className="h-4 w-4" />
            </Button>
          </div>

          <div
            className={`flex shrink-0 items-center gap-1 ${
              isBootstrapGateBlocking ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-disabled={isBootstrapGateBlocking}
          >
            <SystemUpdateEntry client={agentClient} />
            <div className="relative" ref={configMenuRef}>
              <Button
                variant={isConfigMenuOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                title="更多配置"
                aria-label="更多配置"
                aria-expanded={isConfigMenuOpen}
                onClick={() => setIsConfigMenuOpen((value) => !value)}
                disabled={isBootstrapGateBlocking}
              >
                <MoreVerticalIcon className="h-4 w-4" />
              </Button>

              {isConfigMenuOpen ? (
                <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      setIsConfigMenuOpen(false);
                      handleExportConversationMarkdown();
                    }}
                    disabled={stream.conversationItems.length === 0}
                  >
                    <FileCode2Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">导出 Markdown</span>
                  </button>
                  {SIDEPANEL_MENU_ITEMS.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
                  {SIDEPANEL_MENU_ITEMS.map((item) => {
                    const Icon = menuIcons[item.id] ?? SettingsIcon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setIsConfigMenuOpen(false);
                          void openSidepanelRoute(item.route);
                        }}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <QuickActionFeedbackBanner
        feedback={displayedQuickActionFeedback}
        onOpenEntry={(entryPath) => handleOpenQuickActionEntry(entryPath)}
        onClose={() => {
          if (latestCaptureFeedback && captureFeedbackBanner) {
            setDismissedCaptureFeedbackItemId(latestCaptureFeedback.itemId);
          }
          setQuickActionFeedback(null);
        }}
      />
      {bootstrapGate.status === 'ready' && bootstrapGate.backgroundSync.status !== 'completed' ? (
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                variant={bootstrapGate.backgroundSync.status === 'failed' ? 'destructive' : 'secondary'}
                size="mini"
                className="shrink-0"
              >
                {bootstrapGate.backgroundSync.status === 'failed' ? '同步失败' : '技能同步中'}
              </Badge>
              <span className="truncate">
                {bootstrapGate.backgroundSync.status === 'failed'
                  ? bootstrapGate.backgroundSync.detail
                  : '新技能会在同步完成后自动可用，无需重启侧边栏。'}
              </span>
            </div>
            {bootstrapGate.backgroundSync.status === 'failed' ? (
              <Button size="sm" variant="ghost" onClick={() => void bootstrapGate.retrySync()}>
                重新同步
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="claude-mvp-conversation h-full overflow-y-auto px-3 py-3"
          onScroll={updateScrollAffordance}
          onMouseUp={updateSelectionQuote}
          onKeyUp={updateSelectionQuote}
        >
          {stream.conversationItems.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-[90%] rounded-md border border-dashed bg-muted/20 px-4 py-5 text-center">
                  <ClaudeCodeEmptyStateIcon />
                  <div className="mt-4 text-base font-semibold">
                    {bootstrapGate.status !== 'ready'
                      ? bootstrapGate.title
                      : resolveEmptyStateHeading({
                          modelAccessLoaded: displayModelAccessSnapshot.modelAccessLoaded,
                          overallStatus: displayModelAccessSnapshot.overallStatus,
                        })}
                  </div>
                  {bootstrapGate.status !== 'ready' ? (
                    <>
                      <div className="mx-auto mt-3 max-w-[360px] text-xs leading-6 text-muted-foreground">
                        {bootstrapGate.description}
                      </div>
                      {'detail' in bootstrapGate && bootstrapGate.detail ? (
                        <div
                          className={`mx-auto mt-2 max-w-[360px] text-[11px] leading-5 ${
                            bootstrapGate.status === 'sync_failed'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {bootstrapGate.detail}
                        </div>
                      ) : null}
                      {bootstrapGate.status === 'sync_failed' ? (
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                          <Button size="sm" onClick={() => void bootstrapGate.retry()}>
                            重新检查
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {resolveEmptyStateSummary({
                        modelAccessLoaded: displayModelAccessSnapshot.modelAccessLoaded,
                        summary: displayModelAccessSnapshot.summary,
                        runtimeInfo: displayModelAccessSnapshot.runtimeInfo,
                        userClaudeSettingsStatus: displayModelAccessSnapshot.userClaudeSettingsStatus,
                        projectModelConfigStatus:
                          displayModelAccessSnapshot.projectModelConfigStatus,
                        overallStatus: displayModelAccessSnapshot.overallStatus,
                      })}
                    </div>
                  )}
                  {shouldShowOfficialApiKeyForm ? (
                    <ClaudeCodeModelAccessNotice
                      status={
                        emptyStateModelAccessStatus === 'unknown' ||
                        emptyStateModelAccessStatus === 'available'
                          ? 'needs_config'
                          : emptyStateModelAccessStatus
                      }
                      value={officialApiKeyInput}
                      inputRef={officialApiKeyInputRef}
                      isSubmitting={isSavingOfficialApiKey}
                      error={officialApiKeyError}
                      forceVisible={bootstrapGate.status === 'blocked'}
                      onConfig={
                        bootstrapGate.status === 'blocked'
                          ? openModelManagement
                          : undefined
                      }
                      onApiKeyChange={(value) => {
                        setOfficialApiKeyInput(value);
                        if (officialApiKeyError) {
                          setOfficialApiKeyError(null);
                        }
                      }}
                      onOpenPortal={() =>
                        window.open(OFFICIAL_API_KEY_PORTAL_URL, '_blank', 'noreferrer')
                      }
                      onSubmit={() => void handleSaveOfficialApiKey()}
                    />
                  ) : null}
              </div>
            </div>
          ) : (
            <ConversationTimeline
              items={displayedConversationItems}
              projectPath={activeProjectPath || backendWorkdir}
              hiddenCount={displayedHiddenConversationItemCount}
              isFullConversationVisible={isFullConversationVisible}
              onShowFullConversation={showFullConversation}
              onCollapseConversation={collapseConversation}
              onCopyAssistantMarkdown={handleCopyAssistantMarkdown}
              onExportAssistantMarkdown={handleExportAssistantMarkdown}
              onStopRun={handleStopRun}
            />
          )}
        </div>

        {hasContentBelow ? (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute bottom-3 left-1/2 z-20 h-9 w-9 -translate-x-1/2 rounded-full border bg-background/95 shadow-lg backdrop-blur"
            title="滚动到底部"
            aria-label="滚动到底部"
            onClick={() => scrollToConversationBottom()}
          >
            <ArrowDownIcon className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {selectionQuote && typeof document !== 'undefined'
        ? createPortal(
            <button
              type="button"
              className="fixed z-[80] rounded-full border bg-background px-3 py-1.5 text-xs shadow-lg hover:bg-accent"
              style={{
                top: selectionQuote.top,
                left: selectionQuote.left,
                transform: 'translate(-50%, -100%)',
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleAppendSelectionQuote}
            >
              添加到对话
            </button>,
            document.body
          )
        : null}

      <div data-chat-v2-composer-dock="true" className="relative z-30">
        {stream.error ? (
          <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{stream.error}</span>
            {shouldSuggestModelConfigFromError(stream.error) ? (
              <Button size="sm" variant="ghost" onClick={openModelManagement}>
                去配置模型
              </Button>
            ) : null}
          </div>
        ) : null}
        {isRestoringSessionRun ? (
          <div className="mx-3 mb-2 rounded-md border border-muted-foreground/20 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            正在恢复会话运行状态...
          </div>
        ) : null}
        {isDecisionBlocked ? (
          <div className="mx-3 mb-2 space-y-2">
            {questionInteractionCards.map((card) => (
              <AskUserQuestionPanel
                key={`${card.runId}-${card.activeInteraction.requestId}`}
                card={card}
                onResolveInteraction={stream.resolveInteraction}
              />
            ))}
            {permissionInteractionCards.map((card) => (
              <ToolApprovalCard
                key={`${card.runId}-${card.activeInteraction.requestId}`}
                card={card}
                onResolveInteraction={stream.resolveInteraction}
              />
            ))}
            {planApprovalInteractionCards.map((card) => (
              <PlanApprovalCard
                key={`${card.runId}-${card.activeInteraction.requestId}`}
                card={card}
                conversationItems={stream.conversationItems}
                onResolveInteraction={stream.resolveInteraction}
                onPermissionModeSelected={setPermissionMode}
                onContinueWithClearContext={async (next) => {
                  setPermissionMode(next.permissionMode);
                  await stream.stop('user_stop');
                  resetConversation({
                    preserveProjectPath: activeProjectPathRef.current || backendWorkdir,
                  });
                  setPendingContinuation(next);
                }}
              />
            ))}
          </div>
        ) : null}
        {isWorkspaceSelectionRequired ? (
          <div className="mx-3 mb-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            先选择工作区，Claude 才能开始读取文件和发送消息。
          </div>
        ) : null}
        <div
          className={isBootstrapGateBlocking ? 'pointer-events-none opacity-50' : ''}
          aria-disabled={isBootstrapGateBlocking}
        >
          <AgentComposer
            baseUrl={config.api.agentV2BaseUrl}
            endpoint={config.api.agentV2Endpoint}
            value={input}
            projectPath={activeProjectPath}
            sessionTabs={windowTabs}
            selectedTabIds={selectedTabIds}
            onToggleSelectedTab={handleToggleSelectedTab}
            onClearSelectedTabs={handleClearSelectedTabs}
            isWorkspaceSelectionRequired={isWorkspaceSelectionRequired}
            status={stream.status}
            contextPercent={stream.contextPercent}
            permissionMode={permissionMode}
            thinkingMode={thinkingMode}
            onPermissionModeChange={setPermissionMode}
            onThinkingModeChange={setThinkingMode}
            onChange={handleInputChange}
            attachments={attachments}
            onAttachmentsChange={handleAttachmentsChange}
            onUploadAttachment={uploadComposerAttachments}
            isDecisionBlocked={
              isDecisionBlocked ||
              isRestoringSessionRun ||
              isWorkspaceSelectionRequired ||
              isModelInteractionDisabled ||
              isBootstrapGateBlocking
            }
            takeoverState={scopedTakeoverState}
            onSend={() => void send()}
            onStop={stream.stop}
            onLocalCommand={handleLocalCommand}
          />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/chat/')({
  component: Chat,
});
