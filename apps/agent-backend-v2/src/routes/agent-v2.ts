import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentEvent } from '../agent/domain/events.ts';
import { readJsonBody, sendJson } from '../http/json.ts';
import { matchPath } from '../http/router.ts';
import { startSse, writeSseEvent } from '../http/sse.ts';

type RunRequestBody = {
  prompt?: unknown;
  projectPath?: unknown;
  browserContext?: unknown;
  permissionMode?: unknown;
  effort?: unknown;
  attachments?: unknown;
  images?: unknown;
};

type InteractionDecisionBody = {
  allow?: unknown;
  message?: unknown;
  updatedInput?: unknown;
  answers?: unknown;
};

type WorkspaceBody = {
  projectPath?: unknown;
  name?: unknown;
};

type WorkspaceFolderBody = {
  parentPath?: unknown;
  name?: unknown;
};

type SessionMetadataBody = {
  projectPath?: unknown;
  title?: unknown;
};

type SessionInterruptedBody = {
  projectPath?: unknown;
  reason?: unknown;
};

type RunInput = {
  prompt: string;
  projectPath?: string;
  browserContext?: Record<string, unknown>;
  permissionMode?: string;
  effort?: string;
  attachments?: SessionAttachment[];
};

type SessionAttachmentKind = 'image' | 'document' | 'text' | 'other';

type SessionAttachment = {
  id: string;
  sessionFileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: SessionAttachmentKind;
  storage: string;
  absolutePath?: string;
  data?: string;
  previewUrl?: string;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseAttachmentKind(value: unknown): SessionAttachmentKind | null {
  return value === 'image' || value === 'document' || value === 'text' || value === 'other'
    ? value
    : null;
}

function parseAttachments(value: unknown): SessionAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const kind = parseAttachmentKind(item.kind);
      const absolutePath =
        typeof item.absolutePath === 'string' && item.absolutePath.length > 0
          ? item.absolutePath
          : undefined;
      const data = typeof item.data === 'string' && item.data.length > 0 ? item.data : undefined;
      const previewUrl =
        typeof item.previewUrl === 'string' && item.previewUrl.length > 0
          ? item.previewUrl
          : undefined;
      if (
        typeof item.id !== 'string' ||
        !item.id ||
        typeof item.sessionFileId !== 'string' ||
        !item.sessionFileId ||
        typeof item.name !== 'string' ||
        !item.name ||
        typeof item.mimeType !== 'string' ||
        !item.mimeType ||
        typeof item.size !== 'number' ||
        !Number.isFinite(item.size) ||
        item.size < 0 ||
        !kind ||
        typeof item.storage !== 'string' ||
        !item.storage
      ) {
        return null;
      }
      return {
        id: item.id,
        sessionFileId: item.sessionFileId,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        kind,
        storage: item.storage,
        ...(absolutePath ? { absolutePath } : {}),
        ...(data ? { data } : {}),
        ...(previewUrl ? { previewUrl } : {}),
      };
    })
    .filter((item): item is SessionAttachment => Boolean(item));
}

function parseLegacyImages(value: unknown): SessionAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter(
      (item) =>
        typeof item.mimeType === 'string' &&
        item.mimeType.startsWith('image/') &&
        typeof item.data === 'string' &&
        item.data.length > 0
    )
    .map((item, index) => {
      const id = `legacy-image-${index + 1}`;
      return {
        id,
        sessionFileId: id,
        name: typeof item.name === 'string' && item.name ? item.name : `image-${index + 1}`,
        mimeType: item.mimeType as string,
        size: (item.data as string).length,
        kind: 'image' as const,
        storage: 'inline',
        data: item.data as string,
      };
    });
}

function parseRunInput(body: RunRequestBody): RunInput {
  const attachments = parseAttachments(body.attachments);
  return {
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
    browserContext: recordValue(body.browserContext),
    permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : undefined,
    effort: typeof body.effort === 'string' ? body.effort : undefined,
    attachments: attachments.length > 0 ? attachments : parseLegacyImages(body.images),
  };
}

async function writeRunStream(res: ServerResponse, stream: AsyncIterable<AgentEvent>) {
  startSse(res);
  try {
    for await (const event of stream) {
      writeSseEvent(res, event);
    }
  } finally {
    res.end();
  }
}

export function createAgentV2Route(agentService: {
  listProjects?(input?: { forceRefresh?: boolean }): Promise<unknown>;
  listProjectSessions?(input: { projectPath?: string }): Promise<unknown>;
  listProjectSessionRuns?(input: { projectPath: string }): Promise<unknown>;
  listSessions?(): Promise<unknown>;
  getSessionRunState?(input: { sessionId: string }): Promise<unknown>;
  getSessionHistory(input: { sessionId: string; projectPath?: string }): Promise<unknown>;
  getSessionSubagents?(input: { sessionId: string; projectPath?: string }): Promise<unknown>;
  abortRun(input: { runId: string }): Promise<unknown>;
  resolveInteraction?(input: {
    runId: string;
    requestId: string;
    decision: {
      allow?: boolean;
      message?: string;
      updatedInput?: unknown;
      answers?: Record<string, unknown>;
    };
  }): Promise<unknown> | unknown;
  startSessionRun?(input: RunInput): Promise<AsyncIterable<AgentEvent>>;
  continueSessionRun?(input: RunInput & { sessionId: string }): Promise<AsyncIterable<AgentEvent>>;
  addWorkspace?(input: { projectPath: string; name?: string }): Promise<unknown>;
  renameWorkspace?(input: { projectPath: string; name: string }): Promise<unknown>;
  deleteWorkspace?(input: { projectPath: string; deleteDirectory?: boolean }): Promise<unknown>;
  openWorkspace?(input: { projectPath: string }): Promise<unknown>;
  pickFolder?(): Promise<unknown>;
  browseFolders?(input: { path?: string }): Promise<unknown>;
  createFolder?(input: { parentPath: string; name: string }): Promise<unknown>;
  renameSession?(input: {
    projectPath: string;
    sessionId: string;
    title: string;
  }): Promise<unknown>;
  deleteSession?(input: { projectPath: string; sessionId: string }): Promise<unknown>;
  markSessionInterrupted?(input: {
    projectPath: string;
    sessionId: string;
    reason: string;
  }): Promise<unknown>;
}) {
  return async function handleAgentV2(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL | string
  ) {
    const requestUrl = typeof url === 'string' ? new URL(url, 'http://127.0.0.1') : url;
    const pathname = requestUrl.pathname;
    if (req.method === 'GET') {
      if (pathname === '/api/agent-v2/projects') {
        const forceRefresh =
          requestUrl.searchParams.get('forceRefresh') === 'true' ||
          requestUrl.searchParams.get('refresh') === '1';
        sendJson(
          res,
          200,
          agentService.listProjects
            ? await agentService.listProjects(forceRefresh ? { forceRefresh: true } : undefined)
            : []
        );
        return true;
      }

      if (pathname === '/api/agent-v2/sessions') {
        const startedAt = performance.now();
        const projectPath = requestUrl.searchParams.get('projectPath') || undefined;
        if (agentService.listProjectSessions) {
          sendJson(res, 200, await agentService.listProjectSessions({ projectPath }));
        } else {
          sendJson(res, 200, agentService.listSessions ? await agentService.listSessions() : []);
        }
        const totalMs = performance.now() - startedAt;
        if (totalMs >= 150) {
          console.info(
            `[perf][route.agent.sessions] total=${totalMs.toFixed(1)}ms project=${projectPath || '(default)'}`
          );
        }
        return true;
      }

      if (pathname === '/api/agent-v2/session-runs') {
        const projectPath = requestUrl.searchParams.get('projectPath');
        if (!projectPath || !projectPath.trim()) {
          sendJson(res, 400, {
            error: 'projectPath is required',
            code: 'missing_project_path',
          });
          return true;
        }
        sendJson(
          res,
          200,
          agentService.listProjectSessionRuns
            ? await agentService.listProjectSessionRuns({
                projectPath,
              })
            : {
                projectPath,
                sessions: [],
              }
        );
        return true;
      }

      if (pathname === '/api/agent-v2/workspaces/browse') {
        if (!agentService.browseFolders) {
          throw new Error('Workspace browser service is not configured');
        }
        sendJson(
          res,
          200,
          await agentService.browseFolders({
            path: requestUrl.searchParams.get('path') || undefined,
          })
        );
        return true;
      }

      const params = matchPath('/api/agent-v2/sessions/:sessionId/history', pathname);
      if (params) {
        sendJson(
          res,
          200,
          await agentService.getSessionHistory({
            sessionId: params.sessionId,
            projectPath: requestUrl.searchParams.get('projectPath') || undefined,
          })
        );
        return true;
      }

      const subagentParams = matchPath('/api/agent-v2/sessions/:sessionId/subagents', pathname);
      if (subagentParams) {
        sendJson(
          res,
          200,
          agentService.getSessionSubagents
            ? await agentService.getSessionSubagents({
                sessionId: subagentParams.sessionId,
                projectPath: requestUrl.searchParams.get('projectPath') || undefined,
              })
            : { sessionId: subagentParams.sessionId, subagents: [] }
        );
        return true;
      }

      const sessionRunParams = matchPath('/api/agent-v2/session-runs/:sessionId', pathname);
      if (sessionRunParams) {
        sendJson(
          res,
          200,
          agentService.getSessionRunState
            ? await agentService.getSessionRunState({ sessionId: sessionRunParams.sessionId })
            : null
        );
        return true;
      }
    }

    if (req.method === 'POST') {
      if (pathname === '/api/agent-v2/workspaces') {
        if (!agentService.addWorkspace) {
          throw new Error('Workspace service is not configured');
        }
        const body = await readJsonBody<WorkspaceBody>(req);
        sendJson(
          res,
          200,
          await agentService.addWorkspace({
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
            name: typeof body.name === 'string' ? body.name : undefined,
          })
        );
        return true;
      }

      if (pathname === '/api/agent-v2/workspaces/open') {
        if (!agentService.openWorkspace) {
          throw new Error('Workspace service is not configured');
        }
        const body = await readJsonBody<WorkspaceBody>(req);
        sendJson(
          res,
          200,
          await agentService.openWorkspace({
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
          })
        );
        return true;
      }

      if (pathname === '/api/agent-v2/workspaces/pick-folder') {
        if (!agentService.pickFolder) {
          throw new Error('Workspace service is not configured');
        }
        sendJson(res, 200, await agentService.pickFolder());
        return true;
      }

      if (pathname === '/api/agent-v2/workspaces/folders') {
        if (!agentService.createFolder) {
          throw new Error('Workspace service is not configured');
        }
        const body = await readJsonBody<WorkspaceFolderBody>(req);
        sendJson(
          res,
          200,
          await agentService.createFolder({
            parentPath: typeof body.parentPath === 'string' ? body.parentPath : '',
            name: typeof body.name === 'string' ? body.name : '',
          })
        );
        return true;
      }

      const abortParams = matchPath('/api/agent-v2/runs/:runId/abort', pathname);
      if (abortParams) {
        sendJson(res, 200, await agentService.abortRun({ runId: abortParams.runId }));
        return true;
      }

      const interactionParams = matchPath(
        '/api/agent-v2/runs/:runId/interactions/:requestId',
        pathname
      );
      if (interactionParams) {
        if (!agentService.resolveInteraction) {
          throw new Error('Agent interaction service is not configured');
        }
        const body = await readJsonBody<InteractionDecisionBody>(req);
        const answers =
          body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
            ? (body.answers as Record<string, unknown>)
            : undefined;
        sendJson(
          res,
          200,
          await agentService.resolveInteraction({
            runId: interactionParams.runId,
            requestId: interactionParams.requestId,
            decision: {
              allow: typeof body.allow === 'boolean' ? body.allow : undefined,
              message: typeof body.message === 'string' ? body.message : undefined,
              updatedInput: body.updatedInput,
              answers,
            },
          })
        );
        return true;
      }

      if (pathname === '/api/agent-v2/sessions') {
        if (!agentService.startSessionRun) {
          throw new Error('Agent run service is not configured');
        }
        const input = parseRunInput(await readJsonBody<RunRequestBody>(req));
        const stream = await agentService.startSessionRun(input);
        await writeRunStream(res, stream);
        return true;
      }

      const runParams = matchPath('/api/agent-v2/sessions/:sessionId/runs', pathname);
      if (runParams) {
        if (!agentService.continueSessionRun) {
          throw new Error('Agent run service is not configured');
        }
        const input = parseRunInput(await readJsonBody<RunRequestBody>(req));
        const stream = await agentService.continueSessionRun({
          ...input,
          sessionId: runParams.sessionId,
        });
        await writeRunStream(res, stream);
        return true;
      }

      const interruptedParams = matchPath(
        '/api/agent-v2/sessions/:sessionId/interrupted',
        pathname
      );
      if (interruptedParams) {
        if (!agentService.markSessionInterrupted) {
          throw new Error('Session metadata service is not configured');
        }
        const body = await readJsonBody<SessionInterruptedBody>(req);
        sendJson(
          res,
          200,
          await agentService.markSessionInterrupted({
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
            sessionId: interruptedParams.sessionId,
            reason:
              typeof body.reason === 'string' && body.reason.trim()
                ? body.reason
                : 'window_takeover_user_left',
          })
        );
        return true;
      }
    }

    if (req.method === 'PATCH' && pathname === '/api/agent-v2/workspaces') {
      if (!agentService.renameWorkspace) {
        throw new Error('Workspace service is not configured');
      }
      const body = await readJsonBody<WorkspaceBody>(req);
      sendJson(
        res,
        200,
        await agentService.renameWorkspace({
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
          name: typeof body.name === 'string' ? body.name : '',
        })
      );
      return true;
    }

    if (req.method === 'PATCH') {
      const params = matchPath('/api/agent-v2/sessions/:sessionId', pathname);
      if (params) {
        if (!agentService.renameSession) {
          throw new Error('Session metadata service is not configured');
        }
        const body = await readJsonBody<SessionMetadataBody>(req);
        sendJson(
          res,
          200,
          await agentService.renameSession({
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : '',
            sessionId: params.sessionId,
            title: typeof body.title === 'string' ? body.title : '',
          })
        );
        return true;
      }
    }

    if (req.method === 'DELETE' && pathname === '/api/agent-v2/workspaces') {
      if (!agentService.deleteWorkspace) {
        throw new Error('Workspace service is not configured');
      }
      sendJson(
        res,
        200,
        await agentService.deleteWorkspace({
          projectPath: requestUrl.searchParams.get('projectPath') || '',
          deleteDirectory: requestUrl.searchParams.get('deleteDirectory') === 'true',
        })
      );
      return true;
    }

    if (req.method === 'DELETE') {
      const params = matchPath('/api/agent-v2/sessions/:sessionId', pathname);
      if (params) {
        if (!agentService.deleteSession) {
          throw new Error('Session metadata service is not configured');
        }
        sendJson(
          res,
          200,
          await agentService.deleteSession({
            projectPath: requestUrl.searchParams.get('projectPath') || '',
            sessionId: params.sessionId,
          })
        );
        return true;
      }
    }

    return false;
  };
}
