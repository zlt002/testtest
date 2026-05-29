import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { toClaudeProjectKey } from './claude-project-key.ts';
import { readClaudeHistoryFile } from './official-history-reader.ts';

export type SessionSubagentActivity = {
  id: string;
  timestamp: string;
  kind: 'message' | 'tool_started' | 'tool_completed' | 'status';
  title: string;
  detail: string;
};

export type SessionSubagentSnapshot = {
  agentId: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string | null;
  updatedAt: string | null;
  latestSummary?: string | null;
  latestToolName?: string | null;
  messageCount: number;
  toolCount: number;
  activities: SessionSubagentActivity[];
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function contentBlocks(message: Record<string, unknown>): unknown[] {
  const content = message.content;
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return [];
}

function summarizeText(value: string | null | undefined, limit = 120): string {
  const text = (value || '').trim().replace(/\s+/g, ' ');
  if (!text) {
    return '';
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function statusFromStopReason(
  stopReason: string | null
): SessionSubagentSnapshot['status'] | null {
  if (!stopReason || stopReason === 'max_tokens' || stopReason === 'tool_use') {
    return null;
  }
  if (stopReason === 'error') {
    return 'failed';
  }
  return 'completed';
}

function isInternalText(text: string): boolean {
  const normalized = text.trim();
  return (
    normalized === 'Continue from where you left off.' ||
    normalized === 'No response requested.' ||
    (normalized.startsWith('<task-notification>') && normalized.includes('</task-notification>'))
  );
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return objectValue(parsed);
  } catch {
    return null;
  }
}

export async function readSessionSubagentSnapshots(input: {
  projectPath: string;
  sessionId: string;
  claudeProjectsDir?: string;
}): Promise<SessionSubagentSnapshot[]> {
  const projectsDir = input.claudeProjectsDir || join(homedir(), '.claude', 'projects');
  const subagentsDir = join(
    projectsDir,
    toClaudeProjectKey(input.projectPath),
    input.sessionId,
    'subagents'
  );

  let entries: string[] = [];
  try {
    entries = await readdir(subagentsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const jsonlFiles = entries.filter((entry) => entry.endsWith('.jsonl')).sort();
  const snapshots = await Promise.all(
    jsonlFiles.map(async (entry) => {
      const filePath = join(subagentsDir, entry);
      const metaPath = join(subagentsDir, `${basename(entry, '.jsonl')}.meta.json`);
      const [records, meta] = await Promise.all([
        readClaudeHistoryFile(filePath),
        readJsonFile(metaPath),
      ]);
      const agentId = basename(entry, '.jsonl').replace(/^agent-/, '');
      const title =
        stringValue(meta?.description) || stringValue(meta?.agentType) || `子代理 ${agentId}`;
      let status: SessionSubagentSnapshot['status'] = 'running';
      let startedAt: string | null = null;
      let updatedAt: string | null = null;
      let latestSummary: string | null = null;
      let latestToolName: string | null = null;
      let messageCount = 0;
      let toolCount = 0;
      const activities: SessionSubagentActivity[] = [];
      const toolNamesById = new Map<string, string>();

      records.forEach((record, index) => {
        const timestamp = stringValue(record.timestamp) || null;
        if (timestamp && !startedAt) {
          startedAt = timestamp;
        }
        if (timestamp) {
          updatedAt = timestamp;
        }

        const message = objectValue(record.message);
        if (!message) {
          return;
        }

        const role = stringValue(message.role);
        const messageType = stringValue(message.type);
        if (role === 'assistant' && messageType === 'message') {
          const nextStatus = statusFromStopReason(stringValue(message.stop_reason));
          if (nextStatus) {
            status = nextStatus;
          }

          for (const [blockIndex, block] of contentBlocks(message).entries()) {
            const candidate = objectValue(block);
            if (!candidate) {
              continue;
            }
            if (candidate.type === 'text') {
              const text = summarizeText(stringValue(candidate.text));
              if (!text || isInternalText(text)) {
                continue;
              }
              messageCount += 1;
              latestSummary = text;
              activities.push({
                id: `${agentId}-message-${index}-${blockIndex}`,
                timestamp: timestamp || new Date(0).toISOString(),
                kind: 'message',
                title: '子代理消息',
                detail: text,
              });
              continue;
            }

            if (
              candidate.type === 'tool_use' ||
              candidate.type === 'server_tool_use' ||
              candidate.type === 'mcp_tool_use'
            ) {
              const toolName = stringValue(candidate.name) || 'unknown_tool';
              const toolId =
                stringValue(candidate.id) || `${agentId}-tool-${index}-${blockIndex}`;
              toolNamesById.set(toolId, toolName);
              toolCount += 1;
              latestToolName = toolName;
              activities.push({
                id: `${agentId}-tool-start-${index}-${blockIndex}`,
                timestamp: timestamp || new Date(0).toISOString(),
                kind: 'tool_started',
                title: `启动工具 · ${toolName}`,
                detail: summarizeText(JSON.stringify(candidate.input ?? {}), 90) || '工具开始执行',
              });
            }
          }
          return;
        }

        if (role === 'user') {
          for (const [blockIndex, block] of contentBlocks(message).entries()) {
            const candidate = objectValue(block);
            if (!candidate || candidate.type !== 'tool_result') {
              continue;
            }
            const toolId = stringValue(candidate.tool_use_id) || '';
            const toolName = toolNamesById.get(toolId) || 'unknown_tool';
            activities.push({
              id: `${agentId}-tool-result-${index}-${blockIndex}`,
              timestamp: timestamp || new Date(0).toISOString(),
              kind: 'tool_completed',
              title: `工具结果 · ${toolName}`,
              detail:
                summarizeText(
                  typeof candidate.content === 'string'
                    ? candidate.content
                    : JSON.stringify(candidate.content ?? {})
                ) || '工具执行完成',
            });
          }
        }
      });

      return {
        agentId,
        title,
        status,
        startedAt,
        updatedAt,
        latestSummary,
        latestToolName,
        messageCount,
        toolCount,
        activities: activities.slice(-6),
      } satisfies SessionSubagentSnapshot;
    })
  );

  return snapshots.sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    return leftTime - rightTime;
  });
}
