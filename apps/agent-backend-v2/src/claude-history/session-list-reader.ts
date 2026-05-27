import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { summarizePromptForDisplay } from '../../../../shared/utils/src/prompt-metadata.ts';
import { listClaudeProjectHistoryFileInfos } from './official-history-reader.ts';

export type ClaudeSessionSummary = {
  sessionId: string;
  projectPath: string;
  filePath: string;
  messageCount: number | null;
  updatedAt: string | null;
  title?: string;
};

type CachedSessionTitle = {
  mtimeMs: number;
  title?: string;
};

const sessionTitleCache = new Map<string, CachedSessionTitle>();
const SESSION_LIST_PERF_LOG_THRESHOLD_MS = 150;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const candidate = objectValue(block);
      return candidate?.type === 'text' ? stringValue(candidate.text) || '' : '';
    })
    .join('\n');
}

function isClaudeInternalText(text: string): boolean {
  const normalized = text.trim();
  return (
    normalized === 'Continue from where you left off.' ||
    normalized === 'No response requested.' ||
    (normalized.startsWith('<task-notification>') &&
      normalized.includes('</task-notification>'))
  );
}

function normalizeSessionTitle(text: string) {
  const title = summarizePromptForDisplay(text).replace(/\s+/g, ' ').trim();
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

async function readSessionTitle(filePath: string): Promise<string | undefined> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const record = JSON.parse(trimmed) as Record<string, unknown>;
        const message = objectValue(record.message);
        if (!message || message.role !== 'user') {
          continue;
        }
        const text = normalizeSessionTitle(textFromContent(message.content));
        if (!text || isClaudeInternalText(text)) {
          continue;
        }
        lines.close();
        input.destroy();
        return text;
      } catch {
        // Claude may be writing a JSONL file while we read it. Ignore malformed
        // lines and keep looking for a usable first user message.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }

  return undefined;
}

export async function listClaudeSessions(options: {
  projectPath: string;
  claudeProjectsDir?: string;
  limit?: number;
}): Promise<ClaudeSessionSummary[]> {
  const startedAt = performance.now();
  const limit = options.limit ?? 50;
  const fileScanStartedAt = performance.now();
  const files = await listClaudeProjectHistoryFileInfos(options);
  const fileScanMs = performance.now() - fileScanStartedAt;
  const titleReadStartedAt = performance.now();
  const sessions = await Promise.all(
    files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map(async (file) => {
        const cachedTitle = sessionTitleCache.get(file.filePath);
        const title =
          cachedTitle && cachedTitle.mtimeMs === file.mtimeMs
            ? cachedTitle.title
            : await readSessionTitle(file.filePath);
        if (!cachedTitle || cachedTitle.mtimeMs !== file.mtimeMs) {
          sessionTitleCache.set(file.filePath, { mtimeMs: file.mtimeMs, title });
        }
        return {
          sessionId: basename(file.filePath, '.jsonl'),
          projectPath: options.projectPath,
          filePath: file.filePath,
          messageCount: null,
          updatedAt: file.updatedAt,
          ...(title ? { title } : {}),
        };
      })
  );
  const titleReadMs = performance.now() - titleReadStartedAt;
  const totalMs = performance.now() - startedAt;
  if (totalMs >= SESSION_LIST_PERF_LOG_THRESHOLD_MS) {
    console.info(
      `[perf][agent.sessions] total=${totalMs.toFixed(1)}ms scan=${fileScanMs.toFixed(1)}ms titles=${titleReadMs.toFixed(1)}ms files=${files.length} returned=${sessions.length} project=${options.projectPath}`
    );
  }
  return sessions;
}
