import type { ConversationRunItem, RunCard } from './agent-v2/run-cards';

type ConversationMarkdownParams = {
  sessionId: string;
  sessionTitle?: string | null;
  exportedAt?: string;
  items: ConversationRunItem[];
};

type FileNameParams = {
  sessionTitle?: string | null;
  exportedAt?: string;
};

type AssistantFileNameParams = {
  timestamp?: string | null;
};

type MarkdownEntry = {
  role: '用户' | '助手';
  timestamp: string;
  text: string;
};

function formatDateParts(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return {
      full: '未知时间',
      compact: 'unknown-time',
    };
  }

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '00';
  const year = valueOf('year');
  const month = valueOf('month');
  const day = valueOf('day');
  const hour = valueOf('hour');
  const minute = valueOf('minute');
  const second = valueOf('second');

  return {
    full: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    compact: `${year}-${month}-${day}-${hour}${minute}${second}`,
  };
}

export function formatMarkdownTimestamp(value?: string | null): string {
  return formatDateParts(value).full;
}

function sanitizeMarkdownText(value: string | null | undefined): string {
  const text = (value || '').replace(/\r\n/g, '\n').trim();
  return text || '（无内容）';
}

function assistantResponseFromCard(card: RunCard): { timestamp: string; body: string } {
  if (card.responseMessages.length > 0) {
    return {
      timestamp: card.responseMessages[0]?.timestamp || card.updatedAt || card.startedAt || '',
      body: sanitizeMarkdownText(card.responseMessages.map((message) => message.body).join('\n\n')),
    };
  }

  return {
    timestamp: card.updatedAt || card.startedAt || '',
    body: sanitizeMarkdownText(card.finalResponse || card.headline),
  };
}

function buildEntries(items: ConversationRunItem[]): MarkdownEntry[] {
  const entries: MarkdownEntry[] = [];

  for (const item of items) {
    if (item.type === 'user') {
      entries.push({
        role: '用户',
        timestamp: item.message.timestamp,
        text: sanitizeMarkdownText(item.message.text),
      });
      continue;
    }

    const response = assistantResponseFromCard(item.card);
    entries.push({
      role: '助手',
      timestamp: response.timestamp,
      text: response.body,
    });
  }

  return entries;
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildConversationMarkdown(params: ConversationMarkdownParams): string {
  const title = params.sessionTitle?.trim() || '未命名会话';
  const lines = [
    '# 会话记录',
    '',
    `> 会话标题：${title}`,
    `> 会话 ID：${params.sessionId}`,
    `> 导出时间：${formatMarkdownTimestamp(params.exportedAt)}`,
    '',
  ];

  for (const entry of buildEntries(params.items)) {
    lines.push(`## ${entry.role} · ${formatMarkdownTimestamp(entry.timestamp)}`);
    lines.push('');
    lines.push(entry.text);
    lines.push('');
  }

  return lines.join('\n').trim();
}

export function buildAssistantResponseMarkdown(card: RunCard): string {
  const response = assistantResponseFromCard(card);
  return [`## 助手 · ${formatMarkdownTimestamp(response.timestamp)}`, '', response.body].join('\n');
}

export function buildConversationMarkdownFileName(params: FileNameParams): string {
  const title = sanitizeFileNameSegment(params.sessionTitle?.trim() || '未命名会话');
  return `会话记录-${title || '未命名会话'}-${formatDateParts(params.exportedAt).compact}.md`;
}

export function buildAssistantResponseMarkdownFileName(params: AssistantFileNameParams): string {
  return `助手回答-${formatDateParts(params.timestamp).compact}.md`;
}
