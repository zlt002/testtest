// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createPageEditFileSaveClient,
  fileUrlToLocalPath,
  parsePreviewAssetUrl,
  savePageEditHtmlToFile,
} from './page-edit-file-save';

describe('fileUrlToLocalPath', () => {
  it('normalizes macOS file urls into local paths', () => {
    expect(fileUrlToLocalPath('file:///Users/demo/index.html')).toBe('/Users/demo/index.html');
  });

  it('normalizes windows file urls into local paths', () => {
    expect(fileUrlToLocalPath('file:///C:/demo/index.html')).toBe('C:/demo/index.html');
  });
});

describe('parsePreviewAssetUrl', () => {
  it('parses backend preview asset urls into preview id and workspace file path', () => {
    expect(
      parsePreviewAssetUrl(
        'http://127.0.0.1:8792/api/preview/assets/demo-preview/captures/demo/index.html'
      )
    ).toEqual({
      previewId: 'demo-preview',
      filePath: 'captures/demo/index.html',
    });
  });

  it('returns null for non-preview urls', () => {
    expect(parsePreviewAssetUrl('https://example.com/index.html')).toBeNull();
  });
});

describe('savePageEditHtmlToFile', () => {
  it('writes html content through the agent file client', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await savePageEditHtmlToFile(
      { writeFile },
      {
        projectPath: '/Users/demo',
        pageUrl: 'file:///Users/demo/index.html',
        html: '<!DOCTYPE html><html><body>ok</body></html>',
      }
    );

    expect(writeFile).toHaveBeenCalledWith({
      projectPath: '/Users/demo',
      filePath: '/Users/demo/index.html',
      content: '<!DOCTYPE html><html><body>ok</body></html>',
    });
  });

  it('resolves preview asset urls back to workspace files before writing', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const resolvePreviewAsset = vi.fn().mockResolvedValue({
      projectPath: '/Users/demo/project',
      filePath: 'captures/demo/index.html',
    });

    await savePageEditHtmlToFile(
      { writeFile, resolvePreviewAsset },
      {
        pageUrl: 'http://127.0.0.1:8792/api/preview/assets/demo-preview/captures/demo/index.html',
        html: '<!DOCTYPE html><html><body>preview</body></html>',
      }
    );

    expect(resolvePreviewAsset).toHaveBeenCalledWith({
      previewId: 'demo-preview',
      filePath: 'captures/demo/index.html',
    });
    expect(writeFile).toHaveBeenCalledWith({
      projectPath: '/Users/demo/project',
      filePath: 'captures/demo/index.html',
      content: '<!DOCTYPE html><html><body>preview</body></html>',
    });
  });
});

describe('createPageEditFileSaveClient', () => {
  it('posts file writes to the agent backend files api', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const client = createPageEditFileSaveClient('http://127.0.0.1:3456');
    await client.writeFile({
      projectPath: '/Users/demo',
      filePath: '/Users/demo/index.html',
      content: '<html></html>',
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3456/api/files/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: '/Users/demo',
        filePath: '/Users/demo/index.html',
        content: '<html></html>',
      }),
    });
  });

  it('resolves preview asset metadata through the preview api', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projectPath: '/Users/demo/project',
        filePath: 'captures/demo/index.html',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createPageEditFileSaveClient('http://127.0.0.1:3456');
    await expect(
      client.resolvePreviewAsset?.({
        previewId: 'demo-preview',
        filePath: 'captures/demo/index.html',
      })
    ).resolves.toEqual({
      projectPath: '/Users/demo/project',
      filePath: 'captures/demo/index.html',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/preview/resolve?previewId=demo-preview&filePath=captures%2Fdemo%2Findex.html'
    );
  });
});
