// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { projectConversationRunItems, sliceConversationRunItems } from './run-cards';
import type { DisplayMessage } from './types';

const timestamp = '2026-05-11T00:00:00.000Z';

function message(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: overrides.id || crypto.randomUUID(),
    sessionId: overrides.sessionId || 'session-1',
    runId: overrides.runId,
    role: overrides.role || 'assistant',
    kind: overrides.kind || 'text',
    timestamp: overrides.timestamp || timestamp,
    ...overrides,
  };
}

describe('projectConversationRunItems', () => {
  it('collects file references from tool input on live run cards', () => {
    const items = projectConversationRunItems([
      message({
        id: 'user-1',
        role: 'user',
        kind: 'text',
        text: '写一个 PRD',
      }),
      message({
        id: 'tool-1',
        runId: 'run-1',
        role: 'assistant',
        kind: 'tool_call',
        toolName: 'Write',
        toolInput: {
          file_path: '/Users/me/project/pmd-workspace/spec/prd.md',
          content: '不要把正文内容当成文件路径',
        },
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.files).toEqual([
      {
        filePath: '/Users/me/project/pmd-workspace/spec/prd.md',
        label: 'prd.md',
        source: 'tool',
      },
    ]);
  });

  it('collects file references from historical assistant text', () => {
    const items = projectConversationRunItems([
      message({
        id: 'user-1',
        role: 'user',
        kind: 'text',
        text: '刚刚改了哪些文件',
      }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        kind: 'text',
        text: '已更新 pmd-workspace/spec/req_001/prototype.html 和 file:///Users/me/project/docs/readme.md。',
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.files).toEqual([
      {
        filePath: 'pmd-workspace/spec/req_001/prototype.html',
        label: 'prototype.html',
        source: 'assistant',
      },
      {
        filePath: '/Users/me/project/docs/readme.md',
        label: 'readme.md',
        source: 'assistant',
      },
    ]);
  });

  it('limits collapsed process previews to the latest two items', () => {
    const items = projectConversationRunItems([
      message({
        id: 'status-1',
        runId: 'run-1',
        kind: 'run_status',
        status: 'session_bound',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'status-2',
        runId: 'run-1',
        kind: 'run_status',
        status: 'session_bound',
        timestamp: '2026-05-11T00:00:01.000Z',
      }),
      message({
        id: 'thinking-1',
        runId: 'run-1',
        kind: 'thinking',
        text: '正在分析',
        timestamp: '2026-05-11T00:00:02.000Z',
      }),
      message({
        id: 'tool-1',
        runId: 'run-1',
        kind: 'tool_call',
        toolName: 'Read',
        timestamp: '2026-05-11T00:00:03.000Z',
      }),
      message({
        id: 'status-3',
        runId: 'run-1',
        kind: 'run_status',
        status: 'session_bound',
        timestamp: '2026-05-11T00:00:04.000Z',
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.processItemCount).toBe(2);
    expect(run.card.processItems.map((item) => item.id)).toEqual(['thinking-1', 'tool-1']);
    expect(run.card.previewItems.map((item) => item.id)).toEqual(['thinking-1', 'tool-1']);
  });

  it('hides internal session bound statuses from process rows', () => {
    const items = projectConversationRunItems([
      message({
        id: 'status-1',
        runId: 'run-1',
        kind: 'run_status',
        status: 'session_bound',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'tool-1',
        runId: 'run-1',
        kind: 'tool_call',
        toolName: 'Read',
        timestamp: '2026-05-11T00:00:01.000Z',
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.processItemCount).toBe(1);
    expect(run.card.processItems.map((item) => item.id)).toEqual(['tool-1']);
  });

  it('preserves the full process list when a run has many process events', () => {
    const processMessages = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `tool-${index}`,
        runId: 'run-1',
        kind: index % 2 === 0 ? 'tool_call' : 'tool_result',
        toolName: 'LargeTool',
        toolInput: { payload: 'x'.repeat(20_000) },
        toolResult: { payload: 'y'.repeat(20_000) },
        timestamp: `2026-05-11T00:00:${String(index).padStart(2, '0')}.000Z`,
      })
    );

    const items = projectConversationRunItems(processMessages);
    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.processItemCount).toBe(60);
    expect(run.card.processItems).toHaveLength(60);
    expect(run.card.processItems.at(0)?.id).toBe('tool-0');
    expect(run.card.processItems.at(-1)?.id).toBe('tool-59');
    expect(run.card.processItems.every((item) => item.payload)).toBe(true);
    expect(run.card.previewItems).toHaveLength(2);
  });

  it('filters capture feedback process items from collapsed previews', () => {
    const items = projectConversationRunItems([
      message({
        id: 'tool-call-1',
        runId: 'run-1',
        kind: 'tool_call',
        toolName: 'capture_page',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'tool-result-1',
        runId: 'run-1',
        kind: 'tool_result',
        toolName: 'capture_page',
        toolResult: '网页已保存到 captures/mock.html',
        timestamp: '2026-05-11T00:00:01.000Z',
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.processItems.map((item) => item.id)).toEqual(['tool-call-1', 'tool-result-1']);
    expect(run.card.previewItems.map((item) => item.id)).toEqual(['tool-call-1']);
  });

  it('preserves full detail payload while truncating merged thinking summary', () => {
    const items = projectConversationRunItems(
      Array.from({ length: 8 }, (_, index) =>
        message({
          id: `thinking-${index}`,
          runId: 'run-1',
          kind: 'thinking',
          text: '思考内容'.repeat(200),
          timestamp: `2026-05-11T00:00:0${index}.000Z`,
        })
      )
    );
    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    const thinking = run.card.processItems.find((item) => item.kind === 'thinking');
    expect(thinking?.body.length).toBeLessThanOrEqual(700);
    expect(typeof thinking?.payload).toBe('string');
    expect((thinking?.payload as string).length).toBeGreaterThan(thinking?.body.length || 0);
  });

  it('hides internal DSML tool-call artifacts from thinking process rows', () => {
    const items = projectConversationRunItems([
      message({
        id: 'thinking-dsml',
        runId: 'run-1',
        kind: 'thinking',
        text:
          '我现在用富文本写入约500字的格式丰富内容。<|DSML|tool_calls><|DSML|invoke name="mcp__browser_extension__call_website_tool"><|DSML|parameter name="arguments" string="false">{"html":"<h1>标题</h1>"}',
      }),
    ]);
    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    const thinking = run.card.processItems.find((item) => item.kind === 'thinking');
    expect(thinking?.body).toBe('我现在用富文本写入约500字的格式丰富内容。');
    expect(thinking?.payload).toBe('我现在用富文本写入约500字的格式丰富内容。');
  });

  it('falls back to placeholder when thinking content is only internal protocol text', () => {
    const items = projectConversationRunItems([
      message({
        id: 'thinking-only-dsml',
        runId: 'run-1',
        kind: 'thinking',
        text:
          '<|DSML|tool_calls><|DSML|invoke name="mcp__browser_extension__call_website_tool"><|DSML|parameter name="arguments" string="false">{"html":"<h1>标题</h1>"}',
      }),
    ]);
    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    const thinking = run.card.processItems.find((item) => item.kind === 'thinking');
    expect(thinking?.body).toBe('内部工具调用过程已隐藏');
    expect(thinking?.payload).toBe('内部工具调用过程已隐藏');
  });

  it('stores full tool input and result for process detail rendering', () => {
    const items = projectConversationRunItems([
      message({
        id: 'tool-call-1',
        runId: 'run-1',
        kind: 'tool_call',
        toolName: 'mcp__browser__click',
        toolInput: {
          selector: '#submit',
          metadata: { source: 'detail-test', retries: 2 },
        },
      }),
      message({
        id: 'tool-result-1',
        runId: 'run-1',
        kind: 'tool_result',
        toolName: 'mcp__browser__click',
        toolResult: {
          ok: true,
          detail: {
            clicked: '#submit',
            pageUrl: 'https://example.com',
          },
        },
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.processItems[0]?.payload).toEqual({
      selector: '#submit',
      metadata: { source: 'detail-test', retries: 2 },
    });
    expect(run.card.processItems[1]?.payload).toEqual({
      ok: true,
      detail: {
        clicked: '#submit',
        pageUrl: 'https://example.com',
      },
    });
  });

  it('clears permission cards when the matching interaction is resolved', () => {
    const items = projectConversationRunItems([
      message({
        id: 'interaction-1',
        runId: 'run-1',
        role: 'system',
        kind: 'interaction',
        requestId: 'toolu-bash-1',
        interactionKind: 'permission_request',
        toolName: 'Bash',
        text: 'Claude 请求使用 Bash',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'interaction-resolved-1',
        runId: 'run-1',
        role: 'system',
        kind: 'run_status',
        status: 'interaction_resolved',
        timestamp: '2026-05-11T00:00:01.000Z',
        raw: {
          requestId: 'toolu-bash-1',
          outcome: 'allowed',
        },
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.activeInteraction).toBeNull();
    expect(run.card.cardStatus).toBe('running');
  });

  it('clears stale permission cards once the same tool request already has a result', () => {
    const items = projectConversationRunItems([
      message({
        id: 'interaction-1',
        runId: 'run-1',
        role: 'system',
        kind: 'interaction',
        requestId: 'toolu-bash-2',
        interactionKind: 'permission_request',
        toolName: 'Bash',
        text: 'Claude 请求使用 Bash',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'tool-result-1',
        runId: 'run-1',
        role: 'tool',
        kind: 'tool_result',
        toolId: 'toolu-bash-2',
        toolName: 'Bash',
        toolResult: '/tmp/project',
        timestamp: '2026-05-11T00:00:01.000Z',
      }),
    ]);

    const run = items.find((item) => item.type === 'run');

    expect(run?.type).toBe('run');
    if (run?.type !== 'run') return;
    expect(run.card.activeInteraction).toBeNull();
    expect(run.card.cardStatus).toBe('running');
  });

  it('anchors a live run to the user message with the same runId when backend timestamps are earlier', () => {
    const items = projectConversationRunItems([
      message({
        id: 'previous-user',
        role: 'user',
        kind: 'text',
        text: '上一轮',
        timestamp: '2026-05-11T00:00:00.000Z',
      }),
      message({
        id: 'run-1-started',
        runId: 'run-1',
        role: 'system',
        kind: 'run_status',
        status: 'started',
        timestamp: '2026-05-11T00:00:10.000Z',
      }),
      message({
        id: 'current-user',
        runId: 'run-1',
        role: 'user',
        kind: 'text',
        text: '那更新文档啊',
        timestamp: '2026-05-11T00:00:10.100Z',
      }),
      message({
        id: 'assistant-1',
        runId: 'run-1',
        role: 'assistant',
        kind: 'text',
        text: '好的，开始更新。',
        timestamp: '2026-05-11T00:00:11.000Z',
      }),
    ]);

    expect(items.map((item) => (item.type === 'user' ? item.message.id : item.card.id))).toEqual([
      'previous-user',
      'current-user',
      'run-1',
    ]);
  });
});

describe('sliceConversationRunItems', () => {
  it('keeps all items when the timeline is within the limit', () => {
    const items = [
      { type: 'user' as const, message: message({ id: 'user-1', role: 'user' }) },
      {
        type: 'run' as const,
        card: {
          id: 'run-1',
          sessionId: 'session-1',
          anchorMessageId: 'user-1',
          cardStatus: 'completed' as const,
          headline: '完成',
          finalResponse: '完成',
          responseMessages: [],
          processItems: [],
          processItemCount: 0,
          previewItems: [],
          todos: [],
          files: [],
          activeInteraction: null,
          startedAt: timestamp,
          updatedAt: timestamp,
          source: 'official-history' as const,
        },
      },
    ];

    expect(sliceConversationRunItems(items, 3)).toEqual({
      visibleItems: items,
      hiddenCount: 0,
    });
  });

  it('returns the latest items and reports how many are hidden', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      type: 'user' as const,
      message: message({
        id: `user-${index + 1}`,
        role: 'user',
        timestamp: `2026-05-11T00:00:0${index}.000Z`,
      }),
    }));

    expect(sliceConversationRunItems(items, 2)).toEqual({
      visibleItems: items.slice(3),
      hiddenCount: 3,
    });
  });
});
