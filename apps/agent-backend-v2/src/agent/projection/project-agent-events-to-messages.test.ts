import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEvent } from '../domain/events.ts';
import { projectAgentEventsToMessages } from './project-agent-events-to-messages.ts';

function event(
  sequence: number,
  type: AgentEvent['type'],
  payload: AgentEvent['payload']
): AgentEvent {
  return {
    eventId: `event-${sequence}`,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    type,
    timestamp: `2026-05-10T00:00:0${sequence}.000Z`,
    payload,
  };
}

test('projects assistant deltas into one assistant text message', () => {
  const messages = projectAgentEventsToMessages([
    event(1, 'run.started', {}),
    event(2, 'assistant.message.started', { messageId: 'assistant-1' }),
    event(3, 'assistant.message.delta', { messageId: 'assistant-1', text: '你好' }),
    event(4, 'assistant.message.delta', { messageId: 'assistant-1', text: '，世界' }),
    event(5, 'assistant.message.completed', { messageId: 'assistant-1' }),
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].kind, 'run_status');
  assert.equal(messages[0].status, 'started');
  assert.equal(messages[1].id, 'assistant-1');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].kind, 'text');
  assert.equal(messages[1].text, '你好，世界');
});

test('projects tool call lifecycle into tool call and tool result messages', () => {
  const messages = projectAgentEventsToMessages([
    event(1, 'tool.call.started', {
      toolId: 'toolu-1',
      toolName: 'read_current_page_content',
      input: { tabId: 123 },
    }),
    event(2, 'tool.call.completed', {
      toolId: 'toolu-1',
      toolName: 'read_current_page_content',
      result: 'page text',
    }),
  ]);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    id: 'toolu-1-call',
    sessionId: 'session-1',
    runId: 'run-1',
    role: 'assistant',
    kind: 'tool_call',
    toolId: 'toolu-1',
    toolName: 'read_current_page_content',
    toolInput: { tabId: 123 },
    timestamp: '2026-05-10T00:00:01.000Z',
    sequence: 1,
  });
  assert.equal(messages[1].kind, 'tool_result');
  assert.equal(messages[1].toolResult, 'page text');
  assert.equal(messages[1].isError, false);
});

test('projects tool input completion by updating the existing tool call', () => {
  const messages = projectAgentEventsToMessages([
    event(1, 'tool.call.started', {
      toolId: 'toolu-1',
      toolName: 'read_current_page_content',
    }),
    event(2, 'tool.call.completed', {
      toolId: 'toolu-1',
      toolName: 'read_current_page_content',
      input: { tabId: 123 },
    }),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_call');
  assert.deepEqual(messages[0].toolInput, { tabId: 123 });
});
