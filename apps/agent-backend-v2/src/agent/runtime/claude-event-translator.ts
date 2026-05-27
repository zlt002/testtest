import { type AgentEvent, createAgentEvent } from '../domain/events.ts';

type BlockState =
  | { kind: 'text'; messageId: string }
  | { kind: 'thinking'; thinkingId: string }
  | { kind: 'tool'; toolId: string; toolName: string; partialJson: string };

function parseJsonObject(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: input };
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const content = message.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((block) => objectValue(block))
    .filter((block): block is Record<string, unknown> => Boolean(block));
}

function toolResultText(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }

  const text = content
    .map((entry) => objectValue(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => entry.type === 'text')
    .map((entry) => (typeof entry.text === 'string' ? entry.text : ''))
    .join('');

  return text || content;
}

export function createClaudeEventTranslator(base: {
  runId: string;
  sessionId: string | null;
  initialSequence?: number;
  onDiagnostic?: (payload: Record<string, unknown>) => void;
}) {
  let sequence = base.initialSequence ?? 0;
  let currentSessionId = base.sessionId;
  const blocks = new Map<number, BlockState>();
  let hasAssistantText = false;

  function next(type: AgentEvent['type'], payload: Record<string, unknown> = {}): AgentEvent {
    sequence += 1;
    return createAgentEvent({
      runId: base.runId,
      sessionId: currentSessionId,
      sequence,
      type,
      payload,
    });
  }

  function emitDiagnostic(payload: Record<string, unknown>) {
    base.onDiagnostic?.({
      runId: base.runId,
      sessionId: currentSessionId,
      ...payload,
    });
  }

  return function translate(message: Record<string, unknown>): AgentEvent[] {
    const messageSessionId = typeof message.session_id === 'string' ? message.session_id : null;
    const sessionBoundEvents: AgentEvent[] = [];
    if (messageSessionId && messageSessionId !== currentSessionId) {
      currentSessionId = messageSessionId;
      sessionBoundEvents.push(next('session.bound', { sessionId: messageSessionId }));
    }

    if (message.type === 'result') {
      const resultEvents: AgentEvent[] = [];
      const finalText = typeof message.result === 'string' ? message.result.trim() : '';
      if (
        !hasAssistantText &&
        finalText &&
        (message.subtype === 'success' || message.is_error === false)
      ) {
        const messageId = `${base.runId}-assistant-result`;
        resultEvents.push(next('assistant.message.started', { messageId }));
        resultEvents.push(next('assistant.message.delta', { messageId, text: finalText }));
        resultEvents.push(next('assistant.message.completed', { messageId }));
        hasAssistantText = true;
      }

      resultEvents.push(
        next(
          message.subtype === 'success' || message.is_error === false
            ? 'run.completed'
            : 'run.failed',
          {
            usage: message.usage,
            error: message.is_error ? message.error : undefined,
          }
        )
      );

      return [...sessionBoundEvents, ...resultEvents];
    }

    if (message.type === 'user') {
      const sdkMessage = objectValue(message.message);
      const events = sdkMessage
        ? contentBlocks(sdkMessage)
            .filter((block) => block.type === 'tool_result')
            .map((block) =>
              next('tool.call.completed', {
                toolId:
                  typeof block.tool_use_id === 'string'
                    ? block.tool_use_id
                    : `${base.runId}-tool-result-${sequence + 1}`,
                result: toolResultText(block.content),
                isError: block.is_error === true,
              })
            )
        : [];

      return events.length > 0
        ? [...sessionBoundEvents, ...events]
        : [...sessionBoundEvents, next('sdk.event.unsupported', { rawType: message.type })];
    }

    if (message.type !== 'stream_event') {
      return [...sessionBoundEvents, next('sdk.event.unsupported', { rawType: message.type })];
    }

    const event = message.event as Record<string, unknown>;
    if (event.type === 'content_block_start') {
      const index = Number(event.index);
      const block = event.content_block as Record<string, unknown>;
      if (block.type === 'text') {
        const messageId = `${base.runId}-assistant-${index}`;
        blocks.set(index, { kind: 'text', messageId });
        return [...sessionBoundEvents, next('assistant.message.started', { messageId })];
      }
      if (block.type === 'thinking') {
        blocks.set(index, { kind: 'thinking', thinkingId: `${base.runId}-thinking-${index}` });
        return sessionBoundEvents;
      }
      if (
        block.type === 'tool_use' ||
        block.type === 'server_tool_use' ||
        block.type === 'mcp_tool_use'
      ) {
        const toolId = String(block.id || `${base.runId}-tool-${index}`);
        const toolName = String(block.name || 'unknown_tool');
        blocks.set(index, { kind: 'tool', toolId, toolName, partialJson: '' });
        emitDiagnostic({
          phase: 'tool-started',
          toolId,
          toolName,
          partialJsonLength: 0,
          hasContentField: false,
        });
        return [...sessionBoundEvents, next('tool.call.started', { toolId, toolName })];
      }
    }

    if (event.type === 'content_block_delta') {
      const index = Number(event.index);
      const state = blocks.get(index);
      const delta = event.delta as Record<string, unknown>;
      if (state?.kind === 'text' && delta.type === 'text_delta') {
        hasAssistantText = true;
        return [
          ...sessionBoundEvents,
          next('assistant.message.delta', { messageId: state.messageId, text: delta.text }),
        ];
      }
      if (state?.kind === 'thinking' && delta.type === 'thinking_delta') {
        return [
          ...sessionBoundEvents,
          next('process.thinking.delta', {
            thinkingId: state.thinkingId,
            text: typeof delta.thinking === 'string' ? delta.thinking : delta.text,
          }),
        ];
      }
      if (state?.kind === 'tool' && delta.type === 'input_json_delta') {
        state.partialJson += String(delta.partial_json || '');
        emitDiagnostic({
          phase: 'tool-delta',
          toolId: state.toolId,
          toolName: state.toolName,
          partialJsonLength: state.partialJson.length,
          hasContentField: /"content"\s*:/.test(state.partialJson),
          hasFilePathField: /"(file_path|filePath|path)"\s*:/.test(state.partialJson),
        });
        return [
          ...sessionBoundEvents,
          next('tool.call.delta', {
            toolId: state.toolId,
            toolName: state.toolName,
            partialJson: state.partialJson,
          }),
        ];
      }
    }

    if (event.type === 'content_block_stop') {
      const index = Number(event.index);
      const state = blocks.get(index);
      if (state?.kind === 'text') {
        return [
          ...sessionBoundEvents,
          next('assistant.message.completed', { messageId: state.messageId }),
        ];
      }
      if (state?.kind === 'tool') {
        const parsedInput = parseJsonObject(state.partialJson);
        emitDiagnostic({
          phase: 'tool-completed',
          toolId: state.toolId,
          toolName: state.toolName,
          partialJsonLength: state.partialJson.length,
          hasContentField: /"content"\s*:/.test(state.partialJson),
          parsedContentLength:
            typeof parsedInput.content === 'string' ? parsedInput.content.length : null,
        });
        return [
          ...sessionBoundEvents,
          next('tool.call.completed', {
            toolId: state.toolId,
            toolName: state.toolName,
            input: parsedInput,
          }),
        ];
      }
    }

    return sessionBoundEvents;
  };
}
