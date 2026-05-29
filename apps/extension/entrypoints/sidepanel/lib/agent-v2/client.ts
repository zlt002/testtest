import type { DomAnalyzeRequest, DomAnalyzeResult } from '../dom-analysis/types';
import { localizeUserFacingMessage } from '../user-facing-error';
import type {
  AgentAuthSource,
  AgentBackendV2Capabilities,
  AgentEvent,
  AgentModelConfig,
  AgentModelConfigAuthTestResponse,
  AgentModelConfigResponse,
  AgentOfficialModelCatalogResponse,
  AgentOfficialQuotaResponse,
  AgentUserClaudeSettingsUpdateResponse,
  CapabilityDetailResponse,
  CapabilityFileDetailResponse,
  CapabilityFileUpdateResponse,
  CapabilityListResponse,
  CapabilityMutationResponse,
  ClaudeProjectSummary,
  ClaudeSessionSummary,
  CommandCatalog,
  CommandExecutionResult,
  ContinueRunInput,
  FileTreeEntry,
  HooksOverviewResponse,
  InteractionDecision,
  ManagedPlugin,
  ManagementCapabilityType,
  McpRegistryResponse,
  McpRegistryToolsResponse,
  McpToolPermissionResponse,
  InstallPluginInput,
  PluginListResponse,
  ProjectSessionRunsResponse,
  RuntimeCapabilities,
  RuntimeCapabilitiesResponse,
  SessionAttachment,
  SessionRunStateRecord,
  SessionHistoryResponse,
  SkillHealthCheckResult,
  StartRunInput,
  SystemUpdateInfo,
  SystemUpdateStartResponse,
  WorkspaceFolderBrowseResponse,
  WorkspaceFolderPickResponse,
} from './types';

export type AgentV2ClientOptions = {
  baseUrl: string;
  endpoint: string;
};

const MODEL_CONFIG_TEST_TIMEOUT_MS = 15000;

type RuntimeCapabilitiesUpdatePatch = Pick<RuntimeCapabilities, 'selectedAuthSource'>;

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeEndpoint(value: string) {
  return value.startsWith('/') ? value : `/${value}`;
}

function createApiUrl(options: AgentV2ClientOptions, path: string) {
  return `${trimTrailingSlash(options.baseUrl)}${normalizeEndpoint(options.endpoint)}${path}`;
}

function createAbsoluteUrl(options: AgentV2ClientOptions, path: string) {
  return `${trimTrailingSlash(options.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function serializeSessionAttachment(attachment: SessionAttachment): SessionAttachment {
  return {
    id: attachment.id,
    sessionFileId: attachment.sessionFileId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    storage: attachment.storage,
    ...(attachment.absolutePath ? { absolutePath: attachment.absolutePath } : {}),
    ...(attachment.data ? { data: attachment.data } : {}),
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
}

export function normalizeRunAttachmentsForRequest(input?: {
  attachments?: SessionAttachment[];
  images?: StartRunInput['images'];
}): SessionAttachment[] | undefined {
  if (input?.attachments?.length) {
    return input.attachments.map(serializeSessionAttachment);
  }

  if (!input?.images?.length) {
    return undefined;
  }

  return input.images.map((image, index) => {
    const id = `legacy-image-${index + 1}`;
    const data = image.data || '';
    return {
      id,
      sessionFileId: id,
      name: image.name || `image-${index + 1}`,
      mimeType: image.mimeType,
      size: data.length,
      kind: 'image' as const,
      storage: 'inline',
      data,
    };
  });
}

export function findRemovedUploadedSessionAttachments(
  previousAttachments: SessionAttachment[],
  nextAttachments: SessionAttachment[]
): SessionAttachment[] {
  const nextAttachmentIds = new Set(nextAttachments.map((attachment) => attachment.id));
  return previousAttachments.filter(
    (attachment) => attachment.storage === 'session-temp' && !nextAttachmentIds.has(attachment.id)
  );
}

async function buildRequestError(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return new Error(localizeUserFacingMessage(payload.error));
    }
  }

  const text = await response.text().catch(() => '');
  const detail = text.trim();
  return new Error(localizeUserFacingMessage(detail || `${fallback}: ${response.status}`));
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(input, {
      ...init,
      signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'TimeoutError' ||
        error.message === timeoutMessage)
    ) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readAgentEventStream(
  response: Response,
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      localizeUserFacingMessage(text || `Agent V2 request failed with ${response.status}`)
    );
  }

  if (!response.body) {
    throw new Error(localizeUserFacingMessage('Agent V2 response did not include an SSE body'));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const data = chunk
        .split(/\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (!data) {
        continue;
      }

      onEvent(JSON.parse(data) as AgentEvent);
    }
  }

  const trailingData = buffer
    .split(/\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (trailingData) {
    onEvent(JSON.parse(trailingData) as AgentEvent);
  }
}

export function createAgentV2Client(options: AgentV2ClientOptions) {
  return {
    async getCapabilities(): Promise<AgentBackendV2Capabilities> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/capabilities`);
      if (!response.ok) {
        throw new Error(`Failed to load Agent V2 capabilities: ${response.status}`);
      }
      return response.json();
    },

    async getSystemUpdateInfo(): Promise<SystemUpdateInfo> {
      const response = await fetch(createAbsoluteUrl(options, '/api/system/update-info'));
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to load system update info');
      }
      return (await response.json()) as SystemUpdateInfo;
    },

    async startSystemUpdate(): Promise<SystemUpdateStartResponse> {
      const response = await fetch(createAbsoluteUrl(options, '/api/system/update'), {
        method: 'POST',
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to start system update');
      }
      return (await response.json()) as SystemUpdateStartResponse;
    },

    async listSessions(): Promise<ClaudeSessionSummary[]> {
      const response = await fetch(createApiUrl(options, '/sessions'));
      if (!response.ok) {
        throw new Error(`Failed to load Agent V2 sessions: ${response.status}`);
      }
      return response.json();
    },

    async listProjectSessions(input?: {
      projectPath?: string;
      signal?: AbortSignal;
    }): Promise<ClaudeSessionSummary[]> {
      const query = input?.projectPath
        ? `?projectPath=${encodeURIComponent(input.projectPath)}`
        : '';
      const response = await fetch(createApiUrl(options, `/sessions${query}`), {
        signal: input?.signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to load Agent V2 sessions: ${response.status}`);
      }
      return response.json();
    },

    async listProjects(input?: { forceRefresh?: boolean }): Promise<ClaudeProjectSummary[]> {
      const params = new URLSearchParams();
      if (input?.forceRefresh) {
        params.set('refresh', '1');
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(createApiUrl(options, `/projects${query}`));
      if (!response.ok) {
        throw new Error(`Failed to load Agent V2 projects: ${response.status}`);
      }
      return response.json();
    },

    async listProjectSessionRuns(
      projectPath: string,
      input?: { signal?: AbortSignal }
    ): Promise<ProjectSessionRunsResponse> {
      const response = await fetch(
        createApiUrl(options, `/session-runs?projectPath=${encodeURIComponent(projectPath)}`),
        {
          signal: input?.signal,
        }
      );
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to load Agent V2 session runs');
      }
      return response.json();
    },

    async getSessionRunState(sessionId: string): Promise<SessionRunStateRecord | null> {
      const response = await fetch(
        createApiUrl(options, `/session-runs/${encodeURIComponent(sessionId)}`)
      );
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to load Agent V2 session run state');
      }
      return response.json();
    },

    async addWorkspace(input: { projectPath: string; name?: string }): Promise<void> {
      const response = await fetch(createApiUrl(options, '/workspaces'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to add workspace: ${response.status}`);
      }
    },

    async renameWorkspace(input: { projectPath: string; name: string }): Promise<void> {
      const response = await fetch(createApiUrl(options, '/workspaces'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to rename workspace: ${response.status}`);
      }
    },

    async deleteWorkspace(input: {
      projectPath: string;
      deleteDirectory?: boolean;
    }): Promise<void> {
      const params = new URLSearchParams({ projectPath: input.projectPath });
      if (input.deleteDirectory) {
        params.set('deleteDirectory', 'true');
      }
      const response = await fetch(createApiUrl(options, `/workspaces?${params}`), {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete workspace: ${response.status}`);
      }
    },

    async openWorkspace(projectPath: string): Promise<void> {
      const response = await fetch(createApiUrl(options, '/workspaces/open'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      if (!response.ok) {
        throw new Error(`Failed to open workspace: ${response.status}`);
      }
    },

    async pickWorkspaceFolder(): Promise<WorkspaceFolderPickResponse> {
      const response = await fetch(createApiUrl(options, '/workspaces/pick-folder'), {
        method: 'POST',
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to pick workspace folder');
      }
      return response.json();
    },

    async browseWorkspaceFolders(path?: string): Promise<WorkspaceFolderBrowseResponse> {
      const query = path ? `?path=${encodeURIComponent(path)}` : '';
      const response = await fetch(createApiUrl(options, `/workspaces/browse${query}`));
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to browse workspace folders');
      }
      return response.json();
    },

    async createWorkspaceFolder(input: { parentPath: string; name: string }): Promise<void> {
      const response = await fetch(createApiUrl(options, '/workspaces/folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to create workspace folder');
      }
    },

    async renameSession(input: {
      projectPath: string;
      sessionId: string;
      title: string;
    }): Promise<void> {
      const response = await fetch(
        createApiUrl(options, `/sessions/${encodeURIComponent(input.sessionId)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: input.projectPath, title: input.title }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to rename session: ${response.status}`);
      }
    },

    async deleteSession(input: { projectPath: string; sessionId: string }): Promise<void> {
      const params = new URLSearchParams({ projectPath: input.projectPath });
      const response = await fetch(
        createApiUrl(options, `/sessions/${encodeURIComponent(input.sessionId)}?${params}`),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(`Failed to delete session: ${response.status}`);
      }
    },

    async markSessionInterrupted(input: {
      projectPath: string;
      sessionId: string;
      reason?: string;
    }): Promise<void> {
      const response = await fetch(
        createApiUrl(options, `/sessions/${encodeURIComponent(input.sessionId)}/interrupted`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: input.projectPath,
            reason: input.reason,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to mark session interrupted: ${response.status}`);
      }
    },

    async getSessionHistory(
      sessionId: string,
      input?: { projectPath?: string }
    ): Promise<SessionHistoryResponse> {
      const query = input?.projectPath
        ? `?projectPath=${encodeURIComponent(input.projectPath)}`
        : '';
      const response = await fetch(
        createApiUrl(options, `/sessions/${encodeURIComponent(sessionId)}/history${query}`)
      );
      if (!response.ok) {
        throw new Error(`Failed to load Agent V2 session history: ${response.status}`);
      }
      return response.json();
    },

    async startRun(input: StartRunInput, onEvent: (event: AgentEvent) => void): Promise<void> {
      const attachments = normalizeRunAttachmentsForRequest(input);
      const response = await fetch(createApiUrl(options, '/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input.prompt,
          projectPath: input.projectPath,
          browserContext: input.browserContext,
          permissionMode: input.permissionMode,
          effort: input.effort,
          attachments,
        }),
        signal: input.signal,
      });

      await readAgentEventStream(response, onEvent);
    },

    async continueRun(
      input: ContinueRunInput,
      onEvent: (event: AgentEvent) => void
    ): Promise<void> {
      const attachments = normalizeRunAttachmentsForRequest(input);
      const response = await fetch(createApiUrl(options, `/sessions/${input.sessionId}/runs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input.prompt,
          projectPath: input.projectPath,
          browserContext: input.browserContext,
          permissionMode: input.permissionMode,
          effort: input.effort,
          attachments,
        }),
        signal: input.signal,
      });

      await readAgentEventStream(response, onEvent);
    },

    async uploadSessionFile(input: {
      sessionId: string;
      fileName: string;
      mimeType: string;
      dataBase64: string;
    }): Promise<SessionAttachment> {
      const response = await fetch(createAbsoluteUrl(options, '/api/session-files/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to upload session file');
      }
      const payload = (await response.json()) as { attachment: SessionAttachment };
      return payload.attachment;
    },

    async deleteSessionFile(input: { sessionId: string; sessionFileId: string }): Promise<void> {
      const params = new URLSearchParams({ sessionId: input.sessionId });
      const response = await fetch(
        createAbsoluteUrl(
          options,
          `/api/session-files/${encodeURIComponent(input.sessionFileId)}?${params.toString()}`
        ),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to delete session file');
      }
    },

    async abortRun(runId: string): Promise<void> {
      const response = await fetch(
        createApiUrl(options, `/runs/${encodeURIComponent(runId)}/abort`),
        {
          method: 'POST',
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to abort Agent V2 run: ${response.status}`);
      }
    },

    async resolveInteraction(input: {
      runId: string;
      requestId: string;
      decision: InteractionDecision;
    }): Promise<void> {
      const response = await fetch(
        createApiUrl(
          options,
          `/runs/${encodeURIComponent(input.runId)}/interactions/${encodeURIComponent(input.requestId)}`
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input.decision),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to resolve Agent V2 interaction: ${response.status}`);
      }
    },

    async listFiles(input: {
      projectPath: string;
      dirPath?: string;
      maxDepth?: number;
      includeMetadata?: boolean;
      signal?: AbortSignal;
    }): Promise<FileTreeEntry[]> {
      const params = new URLSearchParams({ projectPath: input.projectPath });
      if (input.dirPath) {
        params.set('dirPath', input.dirPath);
      }
      if (input.maxDepth !== undefined) {
        params.set('maxDepth', String(input.maxDepth));
      }
      if (input.includeMetadata !== undefined) {
        params.set('includeMetadata', String(input.includeMetadata));
      }
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/files/tree?${params}`,
        { signal: input.signal }
      );
      if (!response.ok) {
        throw new Error(`Failed to load files: ${response.status}`);
      }
      const payload = (await response.json()) as { entries?: FileTreeEntry[] };
      return payload.entries || [];
    },

    async createFileEntry(input: {
      projectPath: string;
      parentPath?: string;
      type: 'file' | 'directory';
      name: string;
    }): Promise<void> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/files/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create file entry: ${response.status}`);
      }
    },

    async renameFileEntry(input: {
      projectPath: string;
      entryPath: string;
      newName: string;
    }): Promise<void> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/files/entries`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to rename file entry: ${response.status}`);
      }
    },

    async deleteFileEntry(input: { projectPath: string; entryPath: string }): Promise<void> {
      const params = new URLSearchParams({
        projectPath: input.projectPath,
        entryPath: input.entryPath,
      });
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/files/entries?${params}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(`Failed to delete file entry: ${response.status}`);
      }
    },

    async openFileEntry(input: { projectPath: string; entryPath?: string }): Promise<void> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to open file entry: ${response.status}`);
      }
    },

    async readFile(input: { projectPath: string; filePath: string }): Promise<string> {
      const params = new URLSearchParams({
        projectPath: input.projectPath,
        filePath: input.filePath,
      });
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/files/content?${params}`
      );
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.status}`);
      }
      const payload = (await response.json()) as { content?: string };
      return payload.content || '';
    },

    async writeFile(input: {
      projectPath: string;
      filePath: string;
      content: string;
    }): Promise<void> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/files/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.status}`);
      }
    },

    async writeBinaryFile(input: {
      projectPath: string;
      filePath: string;
      dataBase64: string;
    }): Promise<void> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/files/binary-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to write binary file: ${response.status}`);
      }
    },

    async listCommands(input?: {
      projectPath?: string;
      forceRefresh?: boolean;
    }): Promise<CommandCatalog> {
      const response = await fetch(createApiUrl(options, '/commands/list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: input?.projectPath,
          ...(input?.forceRefresh ? { forceRefresh: true } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to load commands: ${response.status}`);
      }
      return response.json();
    },

    async executeCommand(input: {
      commandName: string;
      commandPath?: string;
      args?: string[];
      context?: { projectPath?: string };
    }): Promise<CommandExecutionResult> {
      const response = await fetch(createApiUrl(options, '/commands/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to execute command: ${response.status}`);
      }
      return response.json();
    },

    async analyzeDom(input: DomAnalyzeRequest): Promise<DomAnalyzeResult> {
      const response = await fetch(createApiUrl(options, '/page-code-analysis/dom-analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to analyze DOM');
      }
      return response.json();
    },

    async listCapabilities(input: {
      type: ManagementCapabilityType;
      projectPath?: string;
      forceRefresh?: boolean;
    }): Promise<CapabilityListResponse> {
      const params = new URLSearchParams({ type: input.type });
      if (input.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      if (input.forceRefresh) {
        params.set('refresh', '1');
      }
      const response = await fetch(createApiUrl(options, `/capabilities?${params}`));
      if (!response.ok) {
        throw new Error(`Failed to load capabilities: ${response.status}`);
      }
      return response.json();
    },

    async checkSkillHealth(): Promise<SkillHealthCheckResult> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/accr-sync/health`);
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to check skill health');
      }
      return response.json();
    },

    async readCapability(input: {
      id: string;
      projectPath?: string;
    }): Promise<CapabilityDetailResponse> {
      const params = new URLSearchParams();
      if (input.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        createApiUrl(options, `/capabilities/${encodeURIComponent(input.id)}${query}`)
      );
      if (!response.ok) {
        throw new Error(`Failed to read capability: ${response.status}`);
      }
      return response.json();
    },

    async readCapabilityFile(input: {
      id: string;
      projectPath?: string;
      path: string;
    }): Promise<CapabilityFileDetailResponse> {
      const params = new URLSearchParams();
      if (input.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        createApiUrl(
          options,
          `/capabilities/${encodeURIComponent(input.id)}/files/${encodeURIComponent(input.path)}${query}`
        )
      );
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to read capability file');
      }
      return response.json();
    },

    async createCapability(input: {
      type: ManagementCapabilityType;
      scope: 'user' | 'project';
      projectPath?: string;
      name: string;
      content: string;
    }): Promise<CapabilityDetailResponse['capability']> {
      const response = await fetch(createApiUrl(options, '/capabilities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create capability: ${response.status}`);
      }
      const payload = (await response.json()) as {
        capability: CapabilityDetailResponse['capability'];
      };
      return payload.capability;
    },

    async importSkillDirectory(input: {
      scope: 'user' | 'project';
      projectPath?: string;
      sourceDir: string;
    }): Promise<CapabilityDetailResponse['capability']> {
      const response = await fetch(createApiUrl(options, '/capabilities/import-skill-directory'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to import skill directory');
      }
      const payload = (await response.json()) as CapabilityMutationResponse;
      return payload.capability;
    },

    async importSkillBundle(input: {
      scope: 'user' | 'project';
      projectPath?: string;
      name: string;
      files: Array<{ path: string; contentBase64: string }>;
    }): Promise<CapabilityDetailResponse['capability']> {
      const response = await fetch(createApiUrl(options, '/capabilities/import-skill-directory'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to import skill bundle');
      }
      const payload = (await response.json()) as CapabilityMutationResponse;
      return payload.capability;
    },

    async updateCapability(input: {
      id: string;
      projectPath?: string;
      content: string;
    }): Promise<CapabilityDetailResponse['capability']> {
      const response = await fetch(
        createApiUrl(options, `/capabilities/${encodeURIComponent(input.id)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to update capability: ${response.status}`);
      }
      const payload = (await response.json()) as {
        capability: CapabilityDetailResponse['capability'];
      };
      return payload.capability;
    },

    async updateCapabilityFile(input: {
      id: string;
      projectPath?: string;
      path: string;
      content: string;
    }): Promise<CapabilityFileUpdateResponse> {
      const response = await fetch(
        createApiUrl(options, `/capabilities/${encodeURIComponent(input.id)}/files/${encodeURIComponent(input.path)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: input.projectPath,
            content: input.content,
          }),
        }
      );
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to update capability file');
      }
      return response.json();
    },

    async setCapabilityEnabled(input: {
      id: string;
      projectPath?: string;
      enabled: boolean;
    }): Promise<CapabilityDetailResponse['capability']> {
      const response = await fetch(
        createApiUrl(options, `/capabilities/${encodeURIComponent(input.id)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: input.projectPath,
            enabled: input.enabled,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to update capability enabled state: ${response.status}`);
      }
      const payload = (await response.json()) as {
        capability: CapabilityDetailResponse['capability'];
      };
      return payload.capability;
    },

    async deleteCapability(input: { id: string; projectPath?: string }): Promise<void> {
      const params = new URLSearchParams();
      if (input.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        createApiUrl(options, `/capabilities/${encodeURIComponent(input.id)}${query}`),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(`Failed to delete capability: ${response.status}`);
      }
    },

    async listPlugins(input?: { forceRefresh?: boolean }): Promise<PluginListResponse> {
      const params = new URLSearchParams();
      if (input?.forceRefresh) {
        params.set('refresh', '1');
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(createApiUrl(options, `/plugins${query}`));
      if (!response.ok) {
        throw new Error(`Failed to load plugins: ${response.status}`);
      }
      return response.json();
    },

    async installPlugin(input: InstallPluginInput): Promise<ManagedPlugin> {
      const response = await fetch(createApiUrl(options, '/plugins/install'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to install plugin: ${response.status}`);
      }
      const payload = (await response.json()) as { plugin: ManagedPlugin };
      return payload.plugin;
    },

    async importPluginDirectory(pluginPath: string): Promise<ManagedPlugin> {
      const response = await fetch(createApiUrl(options, '/plugins/import-directory'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pluginPath }),
      });
      if (!response.ok) {
        throw new Error(`Failed to import plugin: ${response.status}`);
      }
      const payload = (await response.json()) as { plugin: ManagedPlugin };
      return payload.plugin;
    },

    async setPluginEnabled(input: {
      id: string;
      enabled: boolean;
      sourceKind?: string;
    }): Promise<ManagedPlugin> {
      const response = await fetch(
        createApiUrl(options, `/plugins/${encodeURIComponent(input.id)}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: input.enabled, sourceKind: input.sourceKind }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to update plugin: ${response.status}`);
      }
      const payload = (await response.json()) as { plugin: ManagedPlugin };
      return payload.plugin;
    },

    async deletePlugin(input: { id: string; sourceKind?: string }): Promise<void> {
      const params = input.sourceKind ? `?sourceKind=${encodeURIComponent(input.sourceKind)}` : '';
      const response = await fetch(
        createApiUrl(options, `/plugins/${encodeURIComponent(input.id)}${params}`),
        {
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to remove plugin: ${response.status}`);
      }
    },

    async getHooksOverview(input?: {
      projectPath?: string;
      forceRefresh?: boolean;
    }): Promise<HooksOverviewResponse> {
      const params = new URLSearchParams();
      if (input?.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      if (input?.forceRefresh) {
        params.set('refresh', '1');
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(createApiUrl(options, `/hooks/overview${query}`));
      if (!response.ok) {
        throw new Error(`Failed to load hooks overview: ${response.status}`);
      }
      return response.json();
    },

    async getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
      const response = await fetch(createApiUrl(options, '/runtime-capabilities'));
      if (!response.ok) {
        throw new Error(`Failed to load runtime capabilities: ${response.status}`);
      }
      const payload = (await response.json()) as RuntimeCapabilitiesResponse;
      return payload.capabilities;
    },

    async getModelConfig(): Promise<AgentModelConfigResponse> {
      const response = await fetch(createApiUrl(options, '/model-config'));
      if (!response.ok) {
        throw new Error(`Failed to load model config: ${response.status}`);
      }
      return response.json();
    },

    async updateUserClaudeSettings(rawJson: string) {
      const response = await fetch(createApiUrl(options, '/model-config/user-claude-settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawJson }),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to save user Claude settings');
      }
      const payload = (await response.json()) as AgentUserClaudeSettingsUpdateResponse;
      return payload.userClaudeSettings;
    },

    async updateModelConfig(patch: Partial<AgentModelConfig>): Promise<AgentModelConfigResponse> {
      const response = await fetch(createApiUrl(options, '/model-config'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        throw new Error(`Failed to update model config: ${response.status}`);
      }
      return response.json();
    },

    async testModelConfig(
      patch: Partial<AgentModelConfig>,
      input: { targetAuthSource: AgentAuthSource }
    ): Promise<AgentModelConfigAuthTestResponse> {
      const response = await fetchWithTimeout(
        createApiUrl(options, '/model-config/test'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...patch,
            targetAuthSource: input.targetAuthSource,
          }),
        },
        MODEL_CONFIG_TEST_TIMEOUT_MS,
        '模型认证测试超时，请检查本地 Agent 后端、Claude CLI 或模型网关。'
      );
      if (!response.ok) {
        throw new Error(`Failed to test model config: ${response.status}`);
      }
      return response.json();
    },

    async listOfficialModelCatalog(apiKey: string) {
      const response = await fetch(createApiUrl(options, '/model-config/official/models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to load official model catalog');
      }
      const payload = (await response.json()) as AgentOfficialModelCatalogResponse;
      return payload.models;
    },

    async getOfficialQuota(apiKey: string) {
      const response = await fetch(createApiUrl(options, '/model-config/official/quota'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        throw await buildRequestError(response, 'Failed to load official quota');
      }
      const payload = (await response.json()) as AgentOfficialQuotaResponse;
      return payload.quota;
    },

    async updateRuntimeCapabilities(
      patch: RuntimeCapabilitiesUpdatePatch
    ): Promise<RuntimeCapabilities> {
      const response = await fetch(createApiUrl(options, '/runtime-capabilities'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        throw new Error(`Failed to update runtime capabilities: ${response.status}`);
      }
      const payload = (await response.json()) as RuntimeCapabilitiesResponse;
      return payload.capabilities;
    },

    async listMcpRegistry(input?: {
      projectPath?: string;
      forceRefresh?: boolean;
    }): Promise<McpRegistryResponse> {
      const params = new URLSearchParams();
      if (input?.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      if (input?.forceRefresh) {
        params.set('refresh', '1');
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry${query}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load MCP registry: ${response.status}`);
      }
      return response.json();
    },

    async readMcpRawConfig(input?: { projectPath?: string }): Promise<{ rawJson: string }> {
      const params = new URLSearchParams();
      if (input?.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/raw${query}`
      );
      if (!response.ok) {
        throw new Error(`Failed to read MCP config: ${response.status}`);
      }
      return response.json();
    },

    async writeMcpRawConfig(
      rawJson: string,
      input?: { projectPath?: string }
    ): Promise<McpRegistryResponse> {
      const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/raw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawJson, projectPath: input?.projectPath }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save MCP config: ${response.status}`);
      }
      return response.json();
    },

    async upsertMcpServer(input: {
      name: string;
      config: Record<string, unknown>;
      scope?: 'project' | 'user';
      projectPath?: string;
    }): Promise<McpRegistryResponse> {
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/servers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            config: input.config,
            scope: input.scope,
            projectPath: input.projectPath,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to save MCP server: ${response.status}`);
      }
      return response.json();
    },

    async setMcpServerEnabled(
      name: string,
      enabled: boolean,
      input?: { projectPath?: string }
    ): Promise<McpRegistryResponse> {
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/servers/${encodeURIComponent(name)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, projectPath: input?.projectPath }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to update MCP server: ${response.status}`);
      }
      return response.json();
    },

    async deleteMcpServer(
      name: string,
      input?: { projectPath?: string; scope?: 'project' | 'user' }
    ): Promise<McpRegistryResponse> {
      const params = new URLSearchParams();
      if (input?.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      if (input?.scope) {
        params.set('scope', input.scope);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}${normalizeEndpoint(`/api/mcp/registry/servers/${encodeURIComponent(name)}`)}${query}`,
        {
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to delete MCP server: ${response.status}`);
      }
      return response.json();
    },

    async listMcpServerTools(
      name: string,
      input?: { projectPath?: string }
    ): Promise<McpRegistryToolsResponse> {
      const params = new URLSearchParams();
      if (input?.projectPath) {
        params.set('projectPath', input.projectPath);
      }
      const query = params.toString() ? `?${params}` : '';
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/servers/${encodeURIComponent(name)}/tools${query}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load MCP tools: ${response.status}`);
      }
      return response.json();
    },

    async setMcpToolEnabled(
      fullName: string,
      enabled: boolean,
      input?: { projectPath?: string }
    ): Promise<McpToolPermissionResponse> {
      const response = await fetch(
        `${trimTrailingSlash(options.baseUrl)}/api/mcp/registry/tools/${encodeURIComponent(fullName)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, projectPath: input?.projectPath }),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to update MCP tool permission: ${response.status}`);
      }
      return response.json();
    },
  };
}
