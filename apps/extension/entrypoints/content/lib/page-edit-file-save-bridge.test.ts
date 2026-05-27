// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createPageEditFileSaveBridge } from './page-edit-file-save-bridge';

describe('createPageEditFileSaveBridge', () => {
  it('forwards same-origin save messages to runtime', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'session-123',
          pageUrl: 'https://example.com/editor.html',
          html: '<!DOCTYPE html><html><body>ok</body></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_save_file',
      payload: {
        nonce: 'session-123',
        pageUrl: 'https://example.com/editor.html',
        html: '<!DOCTYPE html><html><body>ok</body></html>',
      },
    });
  });

  it('forwards file-page save messages when the browser reports a null origin', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'session-file',
          pageUrl: 'file:///Users/demo/index.html',
          html: '<!DOCTYPE html><html><body>ok</body></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_edit_save_file',
      payload: {
        nonce: 'session-file',
        pageUrl: 'file:///Users/demo/index.html',
        html: '<!DOCTYPE html><html><body>ok</body></html>',
      },
    });
  });

  it('ignores malformed save messages', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
      },
    } as MessageEvent);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
        payload: {
          pageUrl: 'file:///Users/demo/index.html',
          html: '<html></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores save messages when payload.nonce is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 123,
          pageUrl: 'file:///Users/demo/index.html',
          html: '<html></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores save messages when payload.pageUrl is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-2',
          pageUrl: 123,
          html: '<html></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores save messages when payload.html is invalid', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'null',
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-3',
          pageUrl: 'file:///Users/demo/index.html',
          html: 123,
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('ignores cross-origin save messages', () => {
    const sendRuntimeMessage = vi.fn();
    const pageWindow = {
      location: {
        origin: 'https://example.com',
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', pageWindow);
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: pageWindow,
      origin: 'https://evil.example',
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'session-evil',
          pageUrl: 'https://example.com/editor.html',
          html: '<!DOCTYPE html><html><body>ok</body></html>',
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
    const bridge = createPageEditFileSaveBridge(sendRuntimeMessage);

    bridge({
      source: {} as Window,
      origin: pageWindow.location.origin,
      data: {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'session-456',
          pageUrl: 'https://example.com/editor.html',
          html: '<!DOCTYPE html><html><body>ok</body></html>',
        },
      },
    } as MessageEvent);

    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });
});
