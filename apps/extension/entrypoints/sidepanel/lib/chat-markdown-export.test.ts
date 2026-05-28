// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { ConversationRunItem, RunCard } from './agent-v2/run-cards';
import type { DisplayMessage } from './agent-v2/types';
import {
  buildAssistantResponseMarkdown,
  buildAssistantResponseMarkdownFileName,
  buildConversationMarkdown,
  buildConversationMarkdownFileName,
} from './chat-markdown-export';

function message(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: overrides.id || 'message-1',
    sessionId: overrides.sessionId || 'session-1',
    role: overrides.role || 'assistant',
    kind: overrides.kind || 'text',
    text: overrides.text || '',
    timestamp: overrides.timestamp || '2026-05-28T04:00:00.000Z',
    ...overrides,
  };
}

function runCard(overrides: Partial<RunCard> = {}): RunCard {
  return {
    id: overrides.id || 'run-1',
    sessionId: overrides.sessionId || 'session-1',
    runId: overrides.runId || 'run-1',
    anchorMessageId: overrides.anchorMessageId || null,
    cardStatus: overrides.cardStatus || 'completed',
    headline: overrides.headline || '已完成',
    finalResponse: overrides.finalResponse || '',
    responseMessages: overrides.responseMessages || [],
    processItems: overrides.processItems || [],
    processItemCount: overrides.processItemCount || 0,
    previewItems: overrides.previewItems || [],
    todos: overrides.todos || [],
    files: overrides.files || [],
    activeInteraction: overrides.activeInteraction || null,
    startedAt: overrides.startedAt || '2026-05-28T04:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-05-28T04:00:10.000Z',
    source: overrides.source || 'sdk-live',
  };
}

describe('chat markdown export', () => {
  it('exports a conversation markdown document with timestamps', () => {
    const items: ConversationRunItem[] = [
      {
        type: 'user',
        message: message({
          id: 'user-1',
          role: 'user',
          text: '帮我分析这个页面',
          timestamp: '2026-05-28T04:00:00.000Z',
        }),
      },
      {
        type: 'run',
        card: runCard({
          id: 'run-1',
          responseMessages: [
            {
              id: 'assistant-1',
              timestamp: '2026-05-28T04:00:08.000Z',
              body: '这是第一段回答',
            },
            {
              id: 'assistant-2',
              timestamp: '2026-05-28T04:00:09.000Z',
              body: '这是第二段回答',
            },
          ],
        }),
      },
    ];

    const markdown = buildConversationMarkdown({
      sessionId: 'session-1',
      sessionTitle: '客户管理列表',
      exportedAt: '2026-05-28T04:30:00.000Z',
      items,
    });

    expect(markdown).toContain('# 会话记录');
    expect(markdown).toContain('> 会话标题：客户管理列表');
    expect(markdown).toContain('> 会话 ID：session-1');
    expect(markdown).toContain('> 导出时间：2026-05-28 12:30:00');
    expect(markdown).toContain('## 用户 · 2026-05-28 12:00:00');
    expect(markdown).toContain('帮我分析这个页面');
    expect(markdown).toContain('## 助手 · 2026-05-28 12:00:08');
    expect(markdown).toContain('这是第一段回答\n\n这是第二段回答');
  });

  it('filters non-conversation process messages and falls back to final response', () => {
    const items: ConversationRunItem[] = [
      {
        type: 'run',
        card: runCard({
          id: 'run-fallback',
          finalResponse: '最终答复',
          updatedAt: '2026-05-28T05:00:00.000Z',
        }),
      },
    ];

    const markdown = buildConversationMarkdown({
      sessionId: 'session-1',
      sessionTitle: '测试会话',
      exportedAt: '2026-05-28T05:10:00.000Z',
      items,
    });

    expect(markdown).toContain('## 助手 · 2026-05-28 13:00:00');
    expect(markdown).toContain('最终答复');
    expect(markdown).not.toContain('工具调用');
    expect(markdown).not.toContain('思考');
  });

  it('builds single assistant response markdown and file name', () => {
    const card = runCard({
      id: 'run-2',
      responseMessages: [
        {
          id: 'assistant-3',
          timestamp: '2026-05-28T06:00:08.000Z',
          body: '单条回答内容',
        },
      ],
    });

    expect(buildAssistantResponseMarkdown(card)).toBe(
      '## 助手 · 2026-05-28 14:00:08\n\n单条回答内容'
    );
    expect(
      buildAssistantResponseMarkdownFileName({
        timestamp: '2026-05-28T06:00:08.000Z',
      })
    ).toBe('助手回答-2026-05-28-140008.md');
  });

  it('sanitizes invalid characters in conversation file names', () => {
    expect(
      buildConversationMarkdownFileName({
        sessionTitle: '客户/管理:列表?',
        exportedAt: '2026-05-28T04:30:00.000Z',
      })
    ).toBe('会话记录-客户-管理-列表-2026-05-28-123000.md');
  });
});
