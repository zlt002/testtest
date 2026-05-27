import type { ToolDisplayRecord } from './types';

const TOOL_EVENTS_STORAGE_PREFIX = 'webmcp-agent-v2-tool-events:';
const MAX_PERSISTED_TOOLS = 80;
const MAX_FIELD_CHARS = 8_000;
const MAX_PAYLOAD_CHARS = 450_000;

type ToolEventStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StorageOptions = {
  storage?: ToolEventStorage;
};

export type ToolEventsPayload = {
  conversationId: string;
  updatedAt: number;
  tools: ToolDisplayRecord[];
};

function storageKey(conversationId: string) {
  return `${TOOL_EVENTS_STORAGE_PREFIX}${conversationId}`;
}

function activeStorage(storage?: ToolEventStorage): ToolEventStorage | null {
  if (storage) {
    return storage;
  }
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function truncateString(value: string, maxChars = MAX_FIELD_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function compactValue(value: unknown, maxChars = MAX_FIELD_CHARS): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value, maxChars);
  }

  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) {
      return value;
    }
    return {
      truncated: true,
      originalChars: json.length,
      preview: truncateString(json, maxChars),
    };
  } catch {
    return truncateString(String(value), maxChars);
  }
}

function compactToolRecord(tool: ToolDisplayRecord): ToolDisplayRecord {
  return {
    ...tool,
    input: compactValue(tool.input),
    result: compactValue(tool.result),
    partialInputJson: tool.partialInputJson
      ? truncateString(tool.partialInputJson, MAX_FIELD_CHARS)
      : tool.partialInputJson,
    preview: truncateString(tool.preview, 500),
  };
}

function buildPayload(conversationId: string, tools: ToolDisplayRecord[]): ToolEventsPayload {
  return {
    conversationId,
    updatedAt: Date.now(),
    tools: tools.slice(-MAX_PERSISTED_TOOLS).map(compactToolRecord),
  };
}

function serializePayload(payload: ToolEventsPayload): string {
  let nextPayload = payload;
  let serialized = JSON.stringify(nextPayload);

  while (serialized.length > MAX_PAYLOAD_CHARS && nextPayload.tools.length > 10) {
    nextPayload = {
      ...nextPayload,
      tools: nextPayload.tools.slice(Math.floor(nextPayload.tools.length / 2)),
    };
    serialized = JSON.stringify(nextPayload);
  }

  return serialized;
}

export function readToolEvents(
  conversationId: string,
  options: StorageOptions = {}
): ToolEventsPayload | null {
  if (!conversationId) {
    return null;
  }

  const storage = activeStorage(options.storage);
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(storageKey(conversationId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ToolEventsPayload;
    return Array.isArray(parsed.tools) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistToolEvents(
  conversationId: string,
  tools: ToolDisplayRecord[],
  options: StorageOptions = {}
): void {
  if (!conversationId) {
    return;
  }

  const storage = activeStorage(options.storage);
  if (!storage) {
    return;
  }

  const key = storageKey(conversationId);

  try {
    storage.setItem(key, serializePayload(buildPayload(conversationId, tools)));
  } catch (error) {
    console.warn('[agent-v2] failed to persist tool events:', error);
    try {
      storage.removeItem(key);
    } catch {
      // Ignore cleanup failures. Tool event persistence is best-effort.
    }
  }
}
