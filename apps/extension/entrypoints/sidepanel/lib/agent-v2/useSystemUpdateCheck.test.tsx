// @vitest-environment node

import { renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystemUpdateCheck } from './useSystemUpdateCheck';

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1',
  });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MutationObserver = dom.window.MutationObserver;
});

afterEach(() => {
  vi.useRealTimers();
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

describe('useSystemUpdateCheck', () => {
  it('loads update info once on mount', async () => {
    const client = {
      getSystemUpdateInfo: vi.fn(async () => ({
        updateAvailable: true,
        packageId: 'W/"etag"',
        packageUrl: 'https://example.com/webmcp.zip',
      })),
    };
    const view = renderHook(() => useSystemUpdateCheck(client));
    await waitFor(() => expect(view.result.current.updateAvailable).toBe(true));
    expect(client.getSystemUpdateInfo).toHaveBeenCalledTimes(1);
    expect(view.result.current.info?.packageId).toBe('W/"etag"');
  });

  it('suppresses request failures as no update', async () => {
    const client = {
      getSystemUpdateInfo: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const view = renderHook(() => useSystemUpdateCheck(client));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.updateAvailable).toBe(false);
    expect(view.result.current.error).toBeNull();
  });
});
