import type { DisplayMessage } from '../domain/display-message.ts';
import type { AgentEvent } from '../domain/events.ts';

function sessionIdOf(event: AgentEvent): string {
  return event.sessionId || '';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
