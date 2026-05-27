import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeEventTranslator } from './claude-event-translator.ts';

test('translates text stream events into assistant message events', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = [
    translate({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    }),
    translate({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
    }),
    translate({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    }),
  ].flat();

  assert.deepEqual(
    events.map((event) => event.type),
    ['assistant.message.started', 'assistant.message.delta', 'assistant.message.completed']
  );
  assert.equal(events[1].payload.text, '你好');
});

test('translates tool stream events into tool call events', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = [
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu-1', name: 'read_current_page_content' },
      },
    }),
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"tabId":123}' },
      },
    }),
    translate({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    }),
  ].flat();

  assert.equal(events[0].type, 'tool.call.started');
  assert.equal(events[0].payload.toolName, 'read_current_page_content');
  assert.equal(events[1].type, 'tool.call.delta');
  assert.equal(events[2].type, 'tool.call.completed');
  assert.deepEqual(events[2].payload.input, { tabId: 123 });
});

test('emits tool stream diagnostics for partial json and completion', () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const translate = createClaudeEventTranslator({
    runId: 'run-1',
    sessionId: 'session-1',
    onDiagnostic(payload) {
      diagnostics.push(payload);
    },
  });

  [
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu-1', name: 'write' },
      },
    }),
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"file_path":"docs/PRD.md","content":"# P',
        },
      },
    }),
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'RD"}' },
      },
    }),
    translate({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    }),
  ].flat();

  assert.equal(diagnostics.length, 4);
  assert.deepEqual(
    diagnostics.map((entry) => entry.phase),
    ['tool-started', 'tool-delta', 'tool-delta', 'tool-completed']
  );
  assert.equal(diagnostics[1].toolName, 'write');
  assert.equal(diagnostics[1].hasContentField, true);
  assert.equal(diagnostics[2].partialJsonLength, 45);
  assert.equal(diagnostics[3].parsedContentLength, 5);
});

test('translates thinking stream events into thinking deltas', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = [
    translate({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    }),
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '先看上下文' },
      },
    }),
  ].flat();

  assert.deepEqual(
    events.map((event) => event.type),
    ['process.thinking.delta']
  );
  assert.equal(events[0].payload.text, '先看上下文');
});

test('translates user tool_result messages into tool result events', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = translate({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu-1',
          content: 'page title: WebMCP',
          is_error: false,
        },
      ],
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool.call.completed');
  assert.equal(events[0].payload.toolId, 'toolu-1');
  assert.equal(events[0].payload.result, 'page title: WebMCP');
  assert.equal(events[0].payload.isError, false);
});

test('binds SDK session_id into subsequent events', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: null });

  const events = translate({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'sdk-session-1',
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ['session.bound', 'run.completed']
  );
  assert.equal(events[0].sessionId, 'sdk-session-1');
  assert.equal(events[0].payload.sessionId, 'sdk-session-1');
  assert.equal(events[1].sessionId, 'sdk-session-1');
});

test('falls back to final result text when SDK did not stream assistant deltas', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = translate({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '最终结论：写入成功。',
    usage: {},
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'assistant.message.started',
      'assistant.message.delta',
      'assistant.message.completed',
      'run.completed',
    ]
  );
  assert.equal(events[1].payload.text, '最终结论：写入成功。');
});

test('does not duplicate final result text when assistant deltas already streamed', () => {
  const translate = createClaudeEventTranslator({ runId: 'run-1', sessionId: 'session-1' });

  const events = [
    translate({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    }),
    translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '已经有流式输出' },
      },
    }),
    translate({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '已经有流式输出',
      usage: {},
    }),
  ].flat();

  assert.deepEqual(
    events.map((event) => event.type),
    ['assistant.message.started', 'assistant.message.delta', 'run.completed']
  );
});
