// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initPageCaptureStylesheetFetchListener } from './page-capture-stylesheet-fetch';

const addListener = vi.fn();
const addConnectListener = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  addListener.mockReset();
  addConnectListener.mockReset();
  fetchMock.mockReset();
  vi.useRealTimers();

  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener,
      },
      onConnect: {
        addListener: addConnectListener,
      },
    },
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('page capture stylesheet fetch listener', () => {
  it('fetches cross-origin stylesheets without credentials and returns content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '.foo { color: red; }',
    });
    initPageCaptureStylesheetFetchListener();

    const listener = addListener.mock.calls[0]?.[0];
    expect(typeof listener).toBe('function');

    const sendResponse = vi.fn();
    const keepAlive = listener(
      {
        type: 'page-capture-fetch-stylesheet',
        sourceUrl: 'https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/index_5e7caf44.css',
      },
      {},
      sendResponse
    );

    expect(keepAlive).toBe(true);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/index_5e7caf44.css',
        expect.objectContaining({
          credentials: 'omit',
        })
      );
      expect(sendResponse).toHaveBeenCalledWith({
        type: 'page-capture-fetch-stylesheet-result',
        success: true,
        content: '.foo { color: red; }',
      });
    });
  });

  it('returns the source url in fetch errors', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    initPageCaptureStylesheetFetchListener();

    const listener = addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: 'page-capture-fetch-stylesheet',
        sourceUrl: 'https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/tokens_edf7c94f.css',
      },
      {},
      sendResponse
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        type: 'page-capture-fetch-stylesheet-result',
        success: false,
        error:
          'Failed to fetch stylesheet https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/tokens_edf7c94f.css: Failed to fetch',
      });
    });
  });

  it('returns an error when stylesheet fetch times out', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => {}));
    initPageCaptureStylesheetFetchListener();

    const listener = addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: 'page-capture-fetch-stylesheet',
        sourceUrl: 'https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/index_5e7caf44.css',
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendResponse).toHaveBeenCalledWith({
      type: 'page-capture-fetch-stylesheet-result',
      success: false,
      error:
        'Failed to fetch stylesheet https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/index_5e7caf44.css: timeout after 10000ms',
    });
  });

  it('fetches stylesheets through the dedicated port channel', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '.bar { margin: 16px; }',
    });
    initPageCaptureStylesheetFetchListener();

    const connectListener = addConnectListener.mock.calls[0]?.[0];
    expect(typeof connectListener).toBe('function');

    const onPortMessage = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const onDisconnect = {
      addListener: vi.fn(),
    };
    const port = {
      name: 'page-capture-stylesheet-fetch',
      onMessage: onPortMessage,
      onDisconnect,
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };

    connectListener(port);
    const portMessageListener = onPortMessage.addListener.mock.calls[0]?.[0];
    expect(typeof portMessageListener).toBe('function');

    portMessageListener({
      type: 'page-capture-fetch-stylesheet',
      sourceUrl: 'https://pss.bdstatic.com/r/www/cache/static/@baidu/cosmic/index_5e7caf44.css',
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'page-capture-fetch-stylesheet-result',
        success: true,
        content: '.bar { margin: 16px; }',
      });
      expect(port.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
