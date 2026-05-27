// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createPageEditSelectionBridge } from './page-edit-selection-bridge';

describe('createPageEditSelectionBridge', () => {
  it('forwards same-origin page-edit append messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'session-123',
          source: 'live-page',
          text: '定位信息：\n选择器: #card',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_selection_append',
      payload: {
        nonce: 'session-123',
        source: 'live-page',
        text: '定位信息：\n选择器: #card',
      },
    });
  });

  it('ignores malformed or cross-origin messages', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'https://evil.example',
      data: { type: 'page_edit_selection_append' },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('forwards file-page append messages when the browser reports a null origin', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'session-file',
          source: 'file',
          text: '定位信息：\n文件路径: /Users/demo/index.html',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_selection_append',
      payload: {
        nonce: 'session-file',
        source: 'file',
        text: '定位信息：\n文件路径: /Users/demo/index.html',
      },
    });
  });

  it('forwards same-origin selection capture messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);
    const target = {
      url: 'https://example.com',
      selector: '#card',
      xpath: '//*[@id="card"]',
      tagName: 'section',
    };

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_capture',
        payload: {
          nonce: 'session-capture',
          target,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_selection_capture',
      payload: {
        nonce: 'session-capture',
        target,
      },
    });
  });

  it('forwards same-origin page capture messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_capture_page',
        payload: {
          nonce: 'session-page-capture',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_capture_page',
      payload: {
        nonce: 'session-page-capture',
      },
    });
  });

  it('forwards same-origin selection annotate messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);
    const target = {
      url: 'https://example.com',
      selector: '#card',
      xpath: '//*[@id="card"]',
      tagName: 'section',
    };

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'session-annotate',
          target,
          content: '重点区域',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_selection_annotate',
      payload: {
        nonce: 'session-annotate',
        target,
        content: '重点区域',
      },
    });
  });

  it('forwards same-origin selection analyze messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);
    const target = {
      url: 'https://example.com',
      selector: '#card',
      xpath: '//*[@id="card"]',
      tagName: 'section',
    };

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 'session-analyze',
          target,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_selection_analyze',
      payload: {
        nonce: 'session-analyze',
        target,
      },
    });
  });

  it('ignores same-origin selection annotate messages when content is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'session-annotate',
          target: { url: 'https://example.com' },
          content: 123,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores same-origin selection analyze messages when payload is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 42,
          target: null,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores messages from a different source window', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: {} as Window,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'session-456',
          source: 'live-page',
          text: '定位信息：\n选择器: #card',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores same-origin messages when payload.source is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          source: 'selection',
          nonce: 'session-789',
          text: '定位信息：\n选择器: #card',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores same-origin messages when payload.text is not a string', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'session-987',
          source: 'file',
          text: 123,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores same-origin messages when payload.nonce is missing', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          source: 'file',
          text: '定位信息：\n文件路径: /Users/demo/index.html',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores same-origin messages when payload.nonce is not a string', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditSelectionBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 42,
          source: 'file',
          text: '定位信息：\n文件路径: /Users/demo/index.html',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });
});
