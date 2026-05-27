// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createActionClickSyncService,
  type ActionClickSyncClient,
} from './action-click-sync';

describe('createActionClickSyncService', () => {
  const post = vi.fn<ActionClickSyncClient['post']>();

  beforeEach(() => {
    post.mockReset();
    vi.useRealTimers();
  });

  it('returns success when backend sync succeeds', async () => {
    post.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: 'completed', mode: 'local-debug' }),
    });

    const service = createActionClickSyncService({ post, timeoutMs: 1000 });

    await expect(service.syncOnActionClick()).resolves.toEqual({
      ok: true,
      status: 'completed',
      mode: 'local-debug',
    });
  });

  it('returns failed when backend responds with non-ok payload', async () => {
    post.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'boom' }),
    });

    const service = createActionClickSyncService({ post, timeoutMs: 1000 });

    await expect(service.syncOnActionClick()).resolves.toMatchObject({
      ok: false,
      status: 'failed',
      error: 'boom',
    });
  });

  it('returns timeout when backend call exceeds timeout', async () => {
    post.mockImplementation(() => new Promise(() => {}));

    const service = createActionClickSyncService({ post, timeoutMs: 1 });

    await expect(service.syncOnActionClick()).resolves.toMatchObject({
      ok: false,
      status: 'timeout',
    });
  });

  it('returns unavailable when backend call throws a non-timeout error', async () => {
    post.mockRejectedValue(new Error('network down'));

    const service = createActionClickSyncService({ post, timeoutMs: 1000 });

    await expect(service.syncOnActionClick()).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      error: 'network down',
    });
  });

  it('deduplicates concurrent clicks with a single inflight request', async () => {
    let resolvePost!: (value: Awaited<ReturnType<ActionClickSyncClient['post']>>) => void;

    post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const service = createActionClickSyncService({ post, timeoutMs: 1000 });
    const first = service.syncOnActionClick();
    const second = service.syncOnActionClick();

    resolvePost({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: 'completed', mode: 'local-debug' }),
    });

    await expect(first).resolves.toMatchObject({ ok: true, status: 'completed' });
    await expect(second).resolves.toMatchObject({ ok: true, status: 'completed' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not abort json consumption after a successful response arrives', async () => {
    vi.useFakeTimers();

    post.mockImplementation(async ({ signal }) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (signal.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }

            resolve({ ok: true, status: 'completed', mode: 'local-debug' });
          }, 5);
        }),
    }));

    const service = createActionClickSyncService({ post, timeoutMs: 1000 });
    const resultPromise = service.syncOnActionClick();

    await vi.advanceTimersByTimeAsync(5);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      status: 'completed',
      mode: 'local-debug',
    });
  });

  it('times out when json never resolves and releases inflight for retries', async () => {
    vi.useFakeTimers();

    post
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status: 'completed', mode: 'remote' }),
      });

    const service = createActionClickSyncService({ post, timeoutMs: 10 });
    const firstAttempt = service.syncOnActionClick();

    await vi.advanceTimersByTimeAsync(10);

    await expect(firstAttempt).resolves.toMatchObject({
      ok: false,
      status: 'timeout',
      error: 'sync timed out after 10ms',
    });

    await expect(service.syncOnActionClick()).resolves.toEqual({
      ok: true,
      status: 'completed',
      mode: 'remote',
    });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
