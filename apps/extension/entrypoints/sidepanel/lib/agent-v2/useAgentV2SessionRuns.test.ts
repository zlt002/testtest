// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentV2Client } from './client';
import { createAgentV2SessionRunsQueryOptions } from './useAgentV2SessionRuns';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent v2 session runs client', () => {
  it('requests project session runs with encoded projectPath', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          projectPath: '/tmp/project a',
          sessions: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createAgentV2Client({
      baseUrl: 'http://127.0.0.1:8792',
      endpoint: '/api/agent-v2',
    });

    await expect(client.listProjectSessionRuns('/tmp/project a')).resolves.toEqual({
      projectPath: '/tmp/project a',
      sessions: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8792/api/agent-v2/session-runs?projectPath=%2Ftmp%2Fproject%20a',
      { signal: undefined }
    );
  });

  it('requests single session run state by sessionId', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sessionId: 'session-1',
          projectPath: '/tmp/project-a',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-05-19T00:00:00.000Z',
          lastEventAt: '2026-05-19T00:00:02.000Z',
          latestSequence: 4,
          latestPreviewText: '执行完成',
          hasActiveStream: false,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createAgentV2Client({
      baseUrl: 'http://127.0.0.1:8792',
      endpoint: '/api/agent-v2',
    });

    await expect(client.getSessionRunState('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      projectPath: '/tmp/project-a',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-05-19T00:00:00.000Z',
      lastEventAt: '2026-05-19T00:00:02.000Z',
      latestSequence: 4,
      latestPreviewText: '执行完成',
      hasActiveStream: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8792/api/agent-v2/session-runs/session-1'
    );
  });
});

describe('agent v2 session runs query options', () => {
  it('disables fetching when projectPath is missing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const options = createAgentV2SessionRunsQueryOptions({
      baseUrl: 'http://127.0.0.1:8792',
      endpoint: '/api/agent-v2',
      projectPath: '',
    });

    expect(options.queryKey).toEqual(['agent-v2', 'session-runs', '']);
    expect(options.enabled).toBe(false);
    expect(options.refetchInterval).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the client query when projectPath is provided and forwards the query signal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          projectPath: '/tmp/project-a',
          sessions: [
            {
              sessionId: 'session-1',
              projectPath: '/tmp/project-a',
              runId: 'run-1',
              status: 'streaming',
              startedAt: '2026-05-19T00:00:00.000Z',
              lastEventAt: '2026-05-19T00:00:01.000Z',
              latestSequence: 3,
              latestPreviewText: '正在执行',
              hasActiveStream: true,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const options = createAgentV2SessionRunsQueryOptions({
      baseUrl: 'http://127.0.0.1:8792',
      endpoint: '/api/agent-v2',
      projectPath: '/tmp/project-a',
    });
    const controller = new AbortController();

    expect(options.enabled).toBe(true);
    expect(options.refetchInterval).toBe(1500);
    await expect(options.queryFn({ signal: controller.signal })).resolves.toEqual({
      projectPath: '/tmp/project-a',
      sessions: [
        {
          sessionId: 'session-1',
          projectPath: '/tmp/project-a',
          runId: 'run-1',
          status: 'streaming',
          startedAt: '2026-05-19T00:00:00.000Z',
          lastEventAt: '2026-05-19T00:00:01.000Z',
          latestSequence: 3,
          latestPreviewText: '正在执行',
          hasActiveStream: true,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8792/api/agent-v2/session-runs?projectPath=%2Ftmp%2Fproject-a',
      { signal: controller.signal }
    );
  });
});

describe('system update client', () => {
  it('requests system update info outside the agent-v2 endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ updateAvailable: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createAgentV2Client({
      baseUrl: 'http://127.0.0.1:8792/',
      endpoint: '/api/agent-v2',
    });
    await expect(client.getSystemUpdateInfo()).resolves.toEqual({ updateAvailable: false });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8792/api/system/update-info');
  });

  it('posts to the system update endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, message: 'restarting' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createAgentV2Client({
      baseUrl: 'http://127.0.0.1:8792',
      endpoint: '/api/agent-v2',
    });
    await expect(client.startSystemUpdate()).resolves.toEqual({
      success: true,
      message: 'restarting',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8792/api/system/update', {
      method: 'POST',
    });
  });
});
