import type { DisplayMessage } from '../agent/domain/display-message.ts';
import type { ClaudeHistoryRecord } from './official-history-reader.ts';

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

function textFromContent(message: Record<string, unknown>): string {
  return contentBlocks(message)
    .map((block) => {
      const candidate = objectValue(block);
      return candidate?.type === 'text' ? stringValue(candidate.text) || '' : '';
    })
    .join('');
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

function isToolUseBlock(type: unknown): boolean {
  return type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use';
}

export function normalizeClaudeHistoryRecords(
  sessionId: string,
  records: ClaudeHistoryRecord[]
): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  const toolNamesById = new Map<string, string | null>();

  records.forEach((record, index) => {
    const message = objectValue(record.message);
    if (!message) {
      return;
    }

    const role = stringValue(message.role);
    const timestamp = stringValue(record.timestamp) || new Date(0).toISOString();
    const baseId = stringValue(record.uuid) || stringValue(record.id) || `${sessionId}-${index}`;

    for (const [blockIndex, block] of contentBlocks(message).entries()) {
      const candidate = objectValue(block);
      if (!candidate) {
        continue;
      }

      if (candidate.type === 'text') {
        const text = stringValue(candidate.text) || textFromContent(message);
        if (!text || isClaudeInternalText(text)) {
          continue;
        }
        messages.push({
          id: `${baseId}-${blockIndex}`,
          sessionId,
          role: role === 'assistant' ? 'assistant' : 'user',
          kind: 'text',
          text,
          timestamp,
          sequence: index,
        });
        continue;
      }

      if (candidate.type === 'thinking') {
        const text =
          stringValue(candidate.thinking) ||
          stringValue(candidate.text) ||
          stringValue(candidate.content);
        if (!text) {
          continue;
        }
        messages.push({
          id: `${baseId}-${blockIndex}`,
          sessionId,
          role: 'assistant',
          kind: 'thinking',
          text,
          timestamp,
          sequence: index,
        });
        continue;
      }

      if (isToolUseBlock(candidate.type)) {
        const toolId = stringValue(candidate.id) || `${baseId}-tool-${blockIndex}`;
        const toolName = stringValue(candidate.name);
        toolNamesById.set(toolId, toolName);
        messages.push({
          id: `${toolId}-call`,
          sessionId,
          role: 'assistant',
          kind: 'tool_call',
          toolId,
          toolName,
          toolInput: candidate.input,
          timestamp,
          sequence: index,
        });
        continue;
      }

      if (candidate.type === 'tool_result') {
        const toolId = stringValue(candidate.tool_use_id) || `${baseId}-tool-${blockIndex}`;
        messages.push({
          id: `${toolId}-result`,
          sessionId,
          role: 'tool',
          kind: 'tool_result',
          toolId,
          toolName:
            stringValue(candidate.tool_name) ||
            stringValue(candidate.toolName) ||
            toolNamesById.get(toolId),
          toolResult: candidate.content,
          isError: candidate.is_error === true,
          timestamp,
          sequence: index,
        });
      }
    }
  });

  return messages;
}
