import type { AgentEvent, DisplayMessage, ToolDisplayRecord } from './types';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function sessionIdOf(event: AgentEvent): string {
  return event.sessionId || '';
}

function compactPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, ' ').slice(0, 180);
  }

  try {
    return JSON.stringify(value).replace(/\s+/g, ' ').slice(0, 180);
  } catch {
    return String(value).slice(0, 180);
  }
}

export function projectAgentEventsToMessages(events: AgentEvent[]): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  const assistantById = new Map<string, DisplayMessage>();
  const toolCallById = new Map<string, DisplayMessage>();

  for (const event of events) {
    if (event.type === 'run.started') {
      messages.push({
        id: `${event.runId}-started`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'system',
        kind: 'run_status',
        status: 'started',
        timestamp: event.timestamp,
        sequence: event.sequence,
      });
      continue;
    }

    if (event.type === 'session.bound') {
      messages.push({
        id: `${event.runId}-session-bound`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'system',
        kind: 'run_status',
        status: 'session_bound',
        timestamp: event.timestamp,
        sequence: event.sequence,
        raw: event.payload,
      });
      continue;
    }

    if (event.type === 'assistant.message.started') {
      const messageId = stringValue(event.payload.messageId) || `${event.runId}-assistant`;
      const message: DisplayMessage = {
        id: messageId,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'assistant',
        kind: 'text',
        text: '',
        timestamp: event.timestamp,
        sequence: event.sequence,
      };
      assistantById.set(messageId, message);
      messages.push(message);
      continue;
    }

    if (event.type === 'assistant.message.delta') {
      const messageId = stringValue(event.payload.messageId) || `${event.runId}-assistant`;
      let message = assistantById.get(messageId);
      if (!message) {
        message = {
          id: messageId,
          sessionId: sessionIdOf(event),
          runId: event.runId,
          role: 'assistant',
          kind: 'text',
          text: '',
          timestamp: event.timestamp,
          sequence: event.sequence,
        };
        assistantById.set(messageId, message);
        messages.push(message);
      }
      message.text = `${message.text || ''}${stringValue(event.payload.text) || ''}`;
      continue;
    }

    if (event.type === 'tool.call.started') {
      const toolId = stringValue(event.payload.toolId) || `${event.runId}-tool-${event.sequence}`;
      const message: DisplayMessage = {
        id: `${toolId}-call`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'assistant',
        kind: 'tool_call',
        toolId,
        toolName: stringValue(event.payload.toolName),
        toolInput: event.payload.input,
        timestamp: event.timestamp,
        sequence: event.sequence,
      };
      toolCallById.set(toolId, message);
      messages.push(message);
      continue;
    }

    if (event.type === 'process.thinking.delta') {
      const thinkingId = stringValue(event.payload.thinkingId) || `${event.runId}-thinking`;
      messages.push({
        id: `${thinkingId}-${event.sequence}`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'assistant',
        kind: 'thinking',
        text: stringValue(event.payload.text),
        timestamp: event.timestamp,
        sequence: event.sequence,
      });
      continue;
    }

    if (event.type === 'interaction.required') {
      const requestId = stringValue(event.payload.requestId) || event.eventId;
      const kind =
        event.payload.kind === 'interactive_prompt'
          ? 'interactive_prompt'
          : event.payload.kind === 'plan_approval'
            ? 'plan_approval'
            : 'permission_request';
      messages.push({
        id: `${requestId}-interaction`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'system',
        kind: 'interaction',
        requestId,
        interactionKind: kind,
        runPhase:
          event.payload.runPhase === 'planning' ||
          event.payload.runPhase === 'awaiting_plan_approval' ||
          event.payload.runPhase === 'executing' ||
          event.payload.runPhase === 'completed' ||
          event.payload.runPhase === 'aborted'
            ? event.payload.runPhase
            : null,
        toolName: stringValue(event.payload.toolName),
        toolInput: event.payload.input,
        text: stringValue(event.payload.message),
        timestamp: event.timestamp,
        sequence: event.sequence,
        raw: event.payload,
      });
      continue;
    }

    if (event.type === 'interaction.resolved') {
      messages.push({
        id: `${event.eventId}-interaction-resolved`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'system',
        kind: 'run_status',
        status: 'interaction_resolved',
        text: stringValue(event.payload.outcome),
        timestamp: event.timestamp,
        sequence: event.sequence,
        raw: event.payload,
      });
      continue;
    }

    if (event.type === 'tool.call.delta') {
      const toolId = stringValue(event.payload.toolId) || `${event.runId}-tool-${event.sequence}`;
      const toolCall = toolCallById.get(toolId);
      if (toolCall && Object.hasOwn(event.payload, 'input')) {
        toolCall.toolInput = event.payload.input;
      }
      const partialJson = stringValue(event.payload.partialJson);
      if (toolCall && partialJson) {
        toolCall.raw = { partialJson };
        try {
          toolCall.toolInput = JSON.parse(partialJson);
        } catch {
          // Keep the partial JSON in raw so UI can project in-progress Write calls.
        }
      }
      continue;
    }

    if (event.type === 'tool.call.completed' || event.type === 'tool.call.failed') {
      const toolId = stringValue(event.payload.toolId) || `${event.runId}-tool-${event.sequence}`;
      if (
        event.type === 'tool.call.completed' &&
        Object.hasOwn(event.payload, 'input') &&
        !Object.hasOwn(event.payload, 'result')
      ) {
        const toolCall = toolCallById.get(toolId);
        if (toolCall) {
          toolCall.toolInput = event.payload.input;
        }
        continue;
      }

      messages.push({
        id: `${toolId}-result`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'tool',
        kind: 'tool_result',
        toolId,
        toolName: stringValue(event.payload.toolName),
        toolResult: event.payload.result ?? event.payload.error,
        isError: event.type === 'tool.call.failed',
        timestamp: event.timestamp,
        sequence: event.sequence,
      });
      continue;
    }

    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.aborted'
    ) {
      messages.push({
        id: `${event.runId}-${event.type}`,
        sessionId: sessionIdOf(event),
        runId: event.runId,
        role: 'system',
        kind: event.type === 'run.failed' ? 'error' : 'run_status',
        text: stringValue(event.payload.error),
        status: event.type.replace('run.', ''),
        timestamp: event.timestamp,
        sequence: event.sequence,
      });
    }
  }

  return messages;
}

export function projectToolDisplayRecords(messages: DisplayMessage[]): ToolDisplayRecord[] {
  const records = new Map<string, ToolDisplayRecord>();

  for (const message of messages) {
    if (message.kind !== 'tool_call' && message.kind !== 'tool_result') {
      continue;
    }

    const key = message.toolId || message.id;
    const existing = records.get(key);
    const base: ToolDisplayRecord =
      existing ||
      ({
        id: key,
        runId: message.runId,
        sessionId: message.sessionId,
        toolId: message.toolId,
        toolName: message.toolName,
        status: 'pending',
        preview: '等待工具参数',
      } satisfies ToolDisplayRecord);

    if (message.kind === 'tool_call') {
      base.input = message.toolInput;
      base.partialInputJson =
        message.raw &&
        typeof message.raw === 'object' &&
        typeof (message.raw as Record<string, unknown>).partialJson === 'string'
          ? ((message.raw as Record<string, unknown>).partialJson as string)
          : base.partialInputJson;
      base.status =
        existing?.status === 'done' || existing?.status === 'error' ? existing.status : 'running';
      base.startedAt = base.startedAt || message.timestamp;
      base.preview =
        compactPreview(message.toolInput) ||
        (base.partialInputJson
          ? `正在接收工具参数 ${base.partialInputJson.length} 字符`
          : '等待工具参数');
    }

    if (message.kind === 'tool_result') {
      base.result = message.toolResult;
      base.isError = message.isError;
      base.status = message.isError ? 'error' : 'done';
      base.completedAt = message.timestamp;
      base.preview =
        compactPreview(base.input) || compactPreview(message.toolResult) || '工具已完成';
    }

    records.set(key, base);
  }

  return [...records.values()];
}
