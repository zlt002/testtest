// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  buildFileBrowserPreviewUrl,
  buildHtmlBrowserPreviewUrl,
  buildSidepanelFilePreviewUrl,
  openHtmlBrowserPreview,
  reloadHtmlBrowserPreview,
} from './file-preview-browser';

describe('buildHtmlBrowserPreviewUrl', () => {
  it('builds a backend preview URL for live-preview mode when backend base url is available', () => {
    expect(
      buildHtmlBrowserPreviewUrl({
        mode: 'live-preview',
        backendBaseUrl: 'http://127.0.0.1:12306',
        projectPath: '/Users/me/project',
        filePath: 'captures/demo/index.html',
      })
    ).toBe(
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=captures%2Fdemo%2Findex.html'
    );
  });

  it('falls back to file url when backend base url is unavailable', () => {
    expect(
      buildHtmlBrowserPreviewUrl({
        projectPath: '/Users/me/project',
        filePath: 'captures/demo/index.html',
      })
    ).toBe('file:///Users/me/project/captures/demo/index.html');
  });

  it('prefers file url for normal workspace previews even when backend base url exists', () => {
    expect(
      buildHtmlBrowserPreviewUrl({
        backendBaseUrl: 'http://127.0.0.1:12306',
        projectPath: '/Users/me/project',
        filePath: 'captures/demo/index.html',
      })
    ).toBe('file:///Users/me/project/captures/demo/index.html');
  });
});

describe('buildFileBrowserPreviewUrl', () => {
  it('keeps an absolute file path and encodes non-ascii characters', () => {
    const filePath = '/Users/me/鍩庨厤绯荤粺/index.html';
    expect(
      buildFileBrowserPreviewUrl({
        projectPath: '/unused',
        filePath,
      })
    ).toBe(new URL(`file://${filePath}`).toString());
  });
});

describe('buildSidepanelFilePreviewUrl', () => {
  it('builds a normal workspace file preview url without live write mode', () => {
    expect(
      buildSidepanelFilePreviewUrl({
        extensionOrigin: 'extension://test',
        projectPath: '/Users/me/project',
        filePath: 'notes.md',
      })
    ).toBe(
      'extension://test/sidepanel.html?route=/file-preview&projectPath=%2FUsers%2Fme%2Fproject&filePath=notes.md'
    );
  });

  it('builds a live write file preview url when requested', () => {
    expect(
      buildSidepanelFilePreviewUrl({
        extensionOrigin: 'extension://test',
        projectPath: '/Users/me/project',
        filePath: 'notes.md',
        mode: 'live-write',
      })
    ).toBe(
      'extension://test/sidepanel.html?route=/file-preview&projectPath=%2FUsers%2Fme%2Fproject&filePath=notes.md&liveWrite=1'
    );
  });
});

it('normalizes git bash windows drive paths into file urls', () => {
  expect(
    buildFileBrowserPreviewUrl({
      projectPath: 'C:/Users/Administrator/Desktop/tst',
      filePath: '/c/Users/Administrator/Desktop/tst/index.html',
    })
  ).toBe('file:///C:/Users/Administrator/Desktop/tst/index.html');
});

describe('openHtmlBrowserPreview', () => {
  it('opens the preview in a browser tab', async () => {
    const tabsCreate = vi.fn().mockResolvedValue({});

    await openHtmlBrowserPreview('file:///Users/me/project/index.html', { tabsCreate });

    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'file:///Users/me/project/index.html',
      active: true,
    });
  });

  it('falls back to window.open when chrome tabs are unavailable', async () => {
    const tabsCreate = vi.fn().mockRejectedValue(new Error('tabs unavailable'));
    const open = vi.fn();

    await openHtmlBrowserPreview('file:///Users/me/project/index.html', { tabsCreate, open });

    expect(open).toHaveBeenCalledWith(
      'file:///Users/me/project/index.html',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens backend preview urls directly without preflight fallback to file', async () => {
    const requestedUrl =
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=index.html';
    const tabsCreate = vi.fn().mockResolvedValue({ id: 7, url: requestedUrl });

    await openHtmlBrowserPreview(requestedUrl, {
      fallbackUrl: 'file:///Users/me/project/index.html',
      tabsCreate,
    });

    expect(tabsCreate).toHaveBeenCalledWith({
      url: requestedUrl,
      active: true,
    });
  });

  it('reuses an already opened browser preview tab', async () => {
    const url = 'file:///Users/me/project/reuse.html';
    const tabsCreate = vi.fn().mockResolvedValue({ id: 42, url });
    const tabsGet = vi.fn().mockResolvedValue({ id: 42, url });
    const tabsUpdate = vi.fn().mockResolvedValue({ id: 42, url });

    await openHtmlBrowserPreview(url, { tabsCreate, tabsGet, tabsUpdate });
    await openHtmlBrowserPreview(url, { tabsCreate, tabsGet, tabsUpdate });

    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate).toHaveBeenCalledWith(42, { active: true });
  });

  it('does not reuse a different backend asset tab that happens to share the same file name', async () => {
    const firstUrl =
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=root-home.html';
    const secondUrl =
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=captures%2F20260524%2Findex.html';
    const firstAssetUrl = 'http://127.0.0.1:12306/api/preview/assets/aaa/root-home.html';
    const secondAssetUrl =
      'http://127.0.0.1:12306/api/preview/assets/bbb/captures/20260524/index.html';
    const tabsCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: 41, url: firstUrl })
      .mockResolvedValueOnce({ id: 42, url: secondUrl });
    const tabsQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 41, url: firstAssetUrl }]);
    const tabsGet = vi
      .fn()
      .mockResolvedValueOnce({ id: 41, url: firstAssetUrl })
      .mockResolvedValueOnce({ id: 42, url: secondAssetUrl });
    const tabsUpdate = vi.fn().mockResolvedValue({ id: 41, url: firstAssetUrl });

    await openHtmlBrowserPreview(firstUrl, { tabsCreate, tabsGet, tabsUpdate, tabsQuery });
    await openHtmlBrowserPreview(secondUrl, { tabsCreate, tabsGet, tabsUpdate, tabsQuery });

    expect(tabsCreate).toHaveBeenCalledTimes(2);
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).toHaveBeenLastCalledWith({
      url: secondUrl,
      active: true,
    });
  });

  it('reuses a backend preview tab after the browser lands on the redirected asset url', async () => {
    const requestedUrl =
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=pages%2Fdemo%2Findex.html';
    const assetUrl =
      'http://127.0.0.1:12306/api/preview/assets/preview-reuse/pages/demo/index.html';
    const tabsCreate = vi.fn().mockResolvedValue({ id: 42, url: requestedUrl });
    const tabsGet = vi.fn().mockResolvedValue({ id: 42, url: assetUrl });
    const tabsUpdate = vi.fn().mockResolvedValue({ id: 42, url: assetUrl });

    await openHtmlBrowserPreview(requestedUrl, { tabsCreate, tabsGet, tabsUpdate });
    await openHtmlBrowserPreview(requestedUrl, { tabsCreate, tabsGet, tabsUpdate });

    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate).toHaveBeenCalledWith(42, {
      active: true,
      url: requestedUrl,
    });
  });

});

describe('reloadHtmlBrowserPreview', () => {
  it('reloads a remembered browser preview tab', async () => {
    const url = 'file:///Users/me/project/reload.html';
    const tabsCreate = vi.fn().mockResolvedValue({ id: 51, url });
    const tabsGet = vi.fn().mockResolvedValue({ id: 51, url });
    const tabsReload = vi.fn().mockResolvedValue(undefined);

    await openHtmlBrowserPreview(url, { tabsCreate, tabsGet });

    await expect(reloadHtmlBrowserPreview(url, { tabsGet, tabsReload })).resolves.toBe(true);
    expect(tabsReload).toHaveBeenCalledWith(51, { bypassCache: true });
  });

  it('does not open a new tab when there is nothing to reload', async () => {
    const tabsQuery = vi.fn().mockResolvedValue([]);
    const tabsReload = vi.fn().mockResolvedValue(undefined);

    await expect(
      reloadHtmlBrowserPreview('file:///Users/me/project/missing.html', {
        tabsQuery,
        tabsReload,
      })
    ).resolves.toBe(false);
    expect(tabsReload).not.toHaveBeenCalled();
  });

  it('reloads a backend preview tab after it has redirected to the asset url', async () => {
    const requestedUrl =
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=pages%2Freload%2Findex.html';
    const assetUrl =
      'http://127.0.0.1:12306/api/preview/assets/preview-reload/pages/reload/index.html';
    const tabsCreate = vi.fn().mockResolvedValue({ id: 51, url: requestedUrl });
    const tabsGet = vi.fn().mockResolvedValue({ id: 51, url: assetUrl });
    const tabsReload = vi.fn().mockResolvedValue(undefined);

    await openHtmlBrowserPreview(requestedUrl, { tabsCreate, tabsGet });

    await expect(reloadHtmlBrowserPreview(requestedUrl, { tabsGet, tabsReload })).resolves.toBe(
      true
    );
    expect(tabsReload).toHaveBeenCalledWith(51, { bypassCache: true });
  });
});
