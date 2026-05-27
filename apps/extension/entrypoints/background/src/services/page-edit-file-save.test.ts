// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createPageEditFileSaveClient,
  fileUrlToLocalPath,
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
});
