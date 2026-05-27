// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  completeBackendLivePreview,
  isBackendLivePreviewFilePath,
  livePreviewDirectoryKey,
  type LiveWritePreviewPayload,
  liveWritePreviewPayloadVersion,
  publishBackendLivePreview,
  shouldPublishBackendLivePreviewUpdate,
  shouldPublishLiveWritePreviewUpdate,
} from './live-write-preview';

function payload(overrides: Partial<LiveWritePreviewPayload> = {}): LiveWritePreviewPayload {
  return {
    id: 'tool-1:/tmp/app:a.ts',
    projectPath: '/tmp/app',
    filePath: 'a.ts',
    content: 'hello',
    status: 'writing',
    updatedAt: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('liveWritePreviewPayloadVersion', () => {
  it('returns the same version for duplicate delivery of the same payload', () => {
    expect(liveWritePreviewPayloadVersion(payload())).toBe(liveWritePreviewPayloadVersion(payload()));
  });

  it('changes when streamed content advances', () => {
    expect(liveWritePreviewPayloadVersion(payload({ content: 'hello' }))).not.toBe(
      liveWritePreviewPayloadVersion(payload({ content: 'hello world' }))
    );
  });
});

describe('backend live preview helpers', () => {
  it('matches html css and js assets for backend live preview', () => {
    expect(isBackendLivePreviewFilePath('pages/demo/index.html')).toBe(true);
    expect(isBackendLivePreviewFilePath('pages/demo/style.css')).toBe(true);
    expect(isBackendLivePreviewFilePath('pages/demo/main.js')).toBe(true);
    expect(isBackendLivePreviewFilePath('pages/demo/logo.png')).toBe(false);
  });

  it('normalizes directory grouping keys', () => {
    expect(livePreviewDirectoryKey('/tmp/app', 'pages\\demo\\style.css')).toBe(
      '/tmp/app:pages/demo'
    );
  });

  it('publishes html updates while a write is still streaming', () => {
    expect(
      shouldPublishBackendLivePreviewUpdate({
        filePath: 'pages/demo/index.html',
        status: 'writing',
      })
    ).toBe(true);
  });

  it('does not publish failed writes into backend live preview', () => {
    expect(
      shouldPublishBackendLivePreviewUpdate({
        filePath: 'pages/demo/index.html',
        status: 'failed',
      })
    ).toBe(false);
  });

  it('posts backend live preview updates', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await publishBackendLivePreview(
      {
        backendBaseUrl: 'http://127.0.0.1:12306',
        entryFilePath: 'pages/demo/index.html',
        projectPath: '/tmp/app',
        filePath: 'pages/demo/style.css',
        writeId: 'write-1',
        content: 'body{color:red;}',
      },
      { fetch }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:12306/api/preview/live');
  });

  it('posts backend live preview completion', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await completeBackendLivePreview(
      {
        backendBaseUrl: 'http://127.0.0.1:12306',
        entryFilePath: 'pages/demo/index.html',
        projectPath: '/tmp/app',
        filePath: 'pages/demo/style.css',
        writeId: 'write-1',
      },
      { fetch }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:12306/api/preview/live/complete');
  });
});

describe('live write preview publishing helpers', () => {
  it('publishes edit previews even when the replacement text is empty', () => {
    expect(
      shouldPublishLiveWritePreviewUpdate({
        operation: 'edit',
        content: '',
        status: 'writing',
      })
    ).toBe(true);
  });

  it('skips empty in-progress write previews but publishes the completed empty file', () => {
    expect(
      shouldPublishLiveWritePreviewUpdate({
        operation: 'write',
        content: '',
        status: 'writing',
      })
    ).toBe(false);
    expect(
      shouldPublishLiveWritePreviewUpdate({
        operation: 'write',
        content: '',
        status: 'completed',
      })
    ).toBe(true);
  });
});
