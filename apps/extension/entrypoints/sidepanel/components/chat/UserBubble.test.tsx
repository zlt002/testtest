import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserBubble } from './UserBubble';

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  disconnect() {}
}

describe('UserBubble', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('collapses long user messages and expands on demand', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(320);

    render(
      <UserBubble
        message={{
          id: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行`).join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    const content = screen.getByText(/第 1 行/);
    expect(content.style.maxHeight).toBe('12rem');

    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(content.style.maxHeight).toBe('');
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();

    scrollHeightSpy.mockRestore();
  });

  it('does not show expand controls for short user messages', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(80);

    render(
      <UserBubble
        message={{
          id: 'message-2',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: '短消息',
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.queryByRole('button', { name: '展开' })).toBeNull();

    scrollHeightSpy.mockRestore();
  });

  it('separates generated input context from the visible user request', () => {
    render(
      <UserBubble
        message={{
          id: 'message-3',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<browser_context>',
            'windowId: 737273780',
            'url: https://example.com/',
            '</browser_context>',
            '',
            '<language_instruction>',
            'Please answer in Chinese.',
            '</language_instruction>',
            '',
            '<用户原始请求>',
            '帮我看看这个按钮为什么点不了',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('帮我看看这个按钮为什么点不了')).toBeTruthy();
    expect(screen.getByRole('button', { name: /展开输入上下文/ })).toBeTruthy();
    expect(screen.queryByText(/windowId: 737273780/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开输入上下文/ }));

    expect(screen.getByText(/windowId: 737273780/)).toBeTruthy();
  });

  it('hides WebMCP browser tool instructions and strips original request tags', () => {
    render(
      <UserBubble
        message={{
          id: 'message-4',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<webmcp_browser_tool_instruction>',
            '当前请求来自浏览器 sidepanel，并带有当前 tab 上下文。',
            '</webmcp_browser_tool_instruction>',
            '',
            '<用户原始请求>',
            '分析',
            '</用户原始请求>',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('分析')).toBeTruthy();
    expect(screen.queryByText(/webmcp_browser_tool_instruction/)).toBeNull();
    expect(screen.queryByText('</用户原始请求>')).toBeNull();
    expect(screen.getByRole('button', { name: /展开输入上下文/ })).toBeTruthy();
  });
  it('treats project workspace instructions as generated input context', () => {
    render(
      <UserBubble
        message={{
          id: 'message-5',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<project_workspace>',
            '当前项目根目录：C:\\Users\\Administrator\\Desktop\\tst',
            '默认所有新建文件都应写入项目目录。',
            '</project_workspace>',
            '',
            '<user_original_request>',
            '继续',
            '</user_original_request>',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('继续')).toBeTruthy();
    expect(screen.getByRole('button', { name: /展开输入上下文/ })).toBeTruthy();
    expect(screen.queryByText(/当前项目根目录/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开输入上下文/ }));

    expect(screen.getByText(/当前项目根目录：C:\\Users\\Administrator\\Desktop\\tst/)).toBeTruthy();
  });

  it('treats attachment metadata as generated input context', () => {
    render(
      <UserBubble
        message={{
          id: 'message-6',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<attachments>',
            '- name=image.png | mimeType=image/png | kind=image',
            '</attachments>',
            '',
            '<user_original_request>',
            '请分析这张图片',
            '</user_original_request>',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('请分析这张图片')).toBeTruthy();
    expect(screen.getByRole('button', { name: /展开输入上下文/ })).toBeTruthy();
    expect(screen.queryByText(/name=image\.png/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开输入上下文/ }));

    expect(screen.getByText(/name=image\.png \| mimeType=image\/png \| kind=image/)).toBeTruthy();
  });

  it('shows explicit skill context as a simplified command name', () => {
    render(
      <UserBubble
        message={{
          id: 'message-7',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<webmcp_explicit_skill name="/ewankb-server-query">',
            '你必须优先遵循下面这个 skill，严格按其中要求执行：',
            '',
            '# /ewankb-server-query',
            '',
            '通过 ewankb-server 查询知识库。',
            '</webmcp_explicit_skill>',
            '',
            '<user_original_request>',
            '查询订单状态',
            '</user_original_request>',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('查询订单状态')).toBeTruthy();
    expect(screen.getByRole('button', { name: /展开输入上下文/ })).toBeTruthy();
    expect(screen.queryByText(/webmcp_explicit_skill/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /展开输入上下文/ }));

    expect(screen.getByText(/显式技能\s*\/ewankb-server-query/)).toBeTruthy();
    expect(screen.queryByText(/<webmcp_explicit_skill/)).toBeNull();
    expect(screen.queryByText(/通过 ewankb-server 查询知识库/)).toBeNull();
  });

  it('shows the explicit skill name when the input only contains auto context', () => {
    render(
      <UserBubble
        message={{
          id: 'message-8',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: [
            '<webmcp_explicit_skill name="/ewankb-server-query">',
            '你必须优先遵循下面这个 skill，严格按其中要求执行：',
            '# /ewankb-server-query',
            '</webmcp_explicit_skill>',
          ].join('\n'),
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('/ewankb-server-query')).toBeTruthy();
    expect(screen.queryByText('（输入内容仅包含自动上下文）')).toBeNull();
  });

  it('renders non-image attachments in the user bubble', () => {
    render(
      <UserBubble
        message={{
          id: 'message-9',
          sessionId: 'session-1',
          role: 'user',
          kind: 'text',
          text: '文档内容是啥呢',
          attachments: [
            {
              id: 'attachment-doc-1',
              name: '功能说明.docx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              size: 345678,
              kind: 'document',
            },
          ],
          timestamp: new Date(0).toISOString(),
        }}
      />
    );

    expect(screen.getByText('功能说明.docx')).toBeTruthy();
    expect(screen.getByText(/文档 · 337\.6 KB/)).toBeTruthy();
  });
});
