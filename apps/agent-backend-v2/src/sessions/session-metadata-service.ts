import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ClaudeSessionSummary } from '../claude-history/session-list-reader.ts';
import { summarizePromptForDisplay } from '../../../../shared/utils/src/prompt-metadata.ts';
import { HttpError } from '../shared/errors.ts';

export type SessionMetadata = {
  projectPath: string;
  sessionId: string;
  title?: string;
  hidden?: boolean;
  interrupted?: boolean;
  interruptedAt?: string;
  interruptedReason?: string;
  updatedAt: string;
};

type SessionMetadataConfig = {
  sessions: SessionMetadata[];
};

export type SessionSummaryWithMetadata = ClaudeSessionSummary & {
  title?: string;
  interrupted?: boolean;
  interruptedAt?: string;
  interruptedReason?: string;
};

function defaultConfigPath() {
  return join(homedir(), '.webmcp', 'sessions.json');
}

function normalizeProjectPath(projectPath: string) {
  return resolve(projectPath);
}

function metadataKey(projectPath: string, sessionId: string) {
  return `${normalizeProjectPath(projectPath).toLowerCase()}\0${sessionId}`;
}

function sanitizeSessionTitle(title?: string) {
  const normalized = title ? summarizePromptForDisplay(title).replace(/\s+/g, ' ').trim() : '';
  return normalized || undefined;
}

export function createSessionMetadataService(options: { configPath?: string } = {}) {
  const configPath = options.configPath || defaultConfigPath();

  async function readConfig(): Promise<SessionMetadataConfig> {
    const text = await readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!text) {
      return { sessions: [] };
    }
    const parsed = JSON.parse(text) as Partial<SessionMetadataConfig>;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  }

  async function writeConfig(config: SessionMetadataConfig) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  async function upsertMetadata(input: {
    projectPath: string;
    sessionId: string;
    update: (metadata: SessionMetadata) => SessionMetadata;
  }) {
    const projectPath = normalizeProjectPath(input.projectPath);
    const sessionId = input.sessionId.trim();
    if (!sessionId) {
      throw new HttpError(400, 'Session id is required', 'session_id_required');
    }
    const config = await readConfig();
    const key = metadataKey(projectPath, sessionId);
    const now = new Date().toISOString();
    const existingIndex = config.sessions.findIndex(
      (session) => metadataKey(session.projectPath, session.sessionId) === key
    );
    const existing =
      existingIndex >= 0
        ? config.sessions[existingIndex]
        : {
            projectPath,
            sessionId,
            updatedAt: now,
          };
    const updated = input.update({ ...existing, projectPath, sessionId, updatedAt: now });
    if (existingIndex >= 0) {
      config.sessions[existingIndex] = updated;
    } else {
      config.sessions.push(updated);
    }
    await writeConfig(config);
    return { ok: true as const };
  }

  return {
    async applyMetadata(
      sessions: ClaudeSessionSummary[]
    ): Promise<SessionSummaryWithMetadata[]> {
      const config = await readConfig();
      const metadataByKey = new Map(
        config.sessions.map((session) => [
          metadataKey(session.projectPath, session.sessionId),
          session,
        ])
      );
      const visibleSessions: SessionSummaryWithMetadata[] = [];
      for (const session of sessions) {
        const metadata = metadataByKey.get(metadataKey(session.projectPath, session.sessionId));
        if (metadata?.hidden) {
          continue;
        }
        const sessionTitle = sanitizeSessionTitle(session.title);
        const metadataTitle = sanitizeSessionTitle(metadata?.title);
        visibleSessions.push({
          ...session,
          ...(sessionTitle ? { title: sessionTitle } : {}),
          ...(metadataTitle ? { title: metadataTitle } : {}),
          ...(metadata?.interrupted !== undefined ? { interrupted: metadata.interrupted } : {}),
          ...(metadata?.interruptedAt ? { interruptedAt: metadata.interruptedAt } : {}),
          ...(metadata?.interruptedReason
            ? { interruptedReason: metadata.interruptedReason }
            : {}),
        });
      }
      return visibleSessions;
    },

    async renameSession(input: { projectPath: string; sessionId: string; title: string }) {
      const title = sanitizeSessionTitle(input.title);
      if (!title) {
        throw new HttpError(400, 'Session title is required', 'session_title_required');
      }
      return upsertMetadata({
        projectPath: input.projectPath,
        sessionId: input.sessionId,
        update: (metadata) => ({
          ...metadata,
          title,
          hidden: false,
        }),
      });
    },

    async deleteSession(input: { projectPath: string; sessionId: string }) {
      return upsertMetadata({
        projectPath: input.projectPath,
        sessionId: input.sessionId,
        update: (metadata) => ({
          ...metadata,
          hidden: true,
        }),
      });
    },

    async markSessionInterrupted(input: {
      projectPath: string;
      sessionId: string;
      reason: string;
    }) {
      const reason = input.reason.trim();
      if (!reason) {
        throw new HttpError(400, 'Interrupted reason is required', 'session_interrupted_reason_required');
      }
      return upsertMetadata({
        projectPath: input.projectPath,
        sessionId: input.sessionId,
        update: (metadata) => ({
          ...metadata,
          hidden: false,
          interrupted: true,
          interruptedAt: new Date().toISOString(),
          interruptedReason: reason,
        }),
      });
    },
  };
}
