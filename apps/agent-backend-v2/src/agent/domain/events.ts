import { createId } from '../../shared/ids.ts';

export const AGENT_EVENT_TYPES = [
  'run.started',
  'assistant.message.started',
  'assistant.message.delta',
  'assistant.message.completed',
  'tool.call.started',
  'tool.call.delta',
  'tool.call.completed',
  'tool.call.failed',
  'process.thinking.delta',
  'interaction.required',
  'interaction.resolved',
  'usage.updated',
  'session.bound',
  'run.completed',
  'run.failed',
  'run.aborted',
  'sdk.event.unsupported',
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEvent = {
  eventId: string;
  runId: string;
  sessionId: string | null;
  sequence: number;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
};

export function createAgentEvent(input: {
  runId: string;
  sessionId?: string | null;
  sequence: number;
  type: AgentEventType;
  payload?: Record<string, unknown>;
  timestamp?: string;
}): AgentEvent {
  return {
    eventId: createId('evt'),
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    sequence: input.sequence,
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload ?? {},
  };
}
