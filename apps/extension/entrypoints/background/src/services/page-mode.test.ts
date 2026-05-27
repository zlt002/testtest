// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { getPageModeCapabilities, getPageModeForUrl } from './page-mode';

describe('page mode', () => {
  it('maps http urls to live-page capabilities', () => {
    const mode = getPageModeForUrl('http://example.com');

    expect(mode).toBe('live-page');
    expect(getPageModeCapabilities(mode)).toEqual({
      canAnnotate: true,
      canCapture: true,
      canSend: true,
      canEdit: false,
      canSave: false,
    });
  });

  it('maps file urls to local-snapshot capabilities', () => {
    const mode = getPageModeForUrl('file:///tmp/example.html');

    expect(mode).toBe('local-snapshot');
    expect(getPageModeCapabilities(mode)).toEqual({
      canAnnotate: true,
      canCapture: true,
      canSend: true,
      canEdit: true,
      canSave: true,
    });
  });

  it('maps backend preview asset urls to local-snapshot capabilities', () => {
    const mode = getPageModeForUrl('http://127.0.0.1:8792/api/preview/assets/demo-capture/index.html');

    expect(mode).toBe('local-snapshot');
    expect(getPageModeCapabilities(mode)).toEqual({
      canAnnotate: true,
      canCapture: true,
      canSend: true,
      canEdit: true,
      canSave: true,
    });
  });

  it('maps cross-origin backend preview asset urls to local-snapshot capabilities', () => {
    const mode = getPageModeForUrl('https://example.com/api/preview/assets/demo-capture/index.html');

    expect(mode).toBe('local-snapshot');
    expect(getPageModeCapabilities(mode)).toEqual({
      canAnnotate: true,
      canCapture: true,
      canSend: true,
      canEdit: true,
      canSave: true,
    });
  });

  it('maps browser internal urls to unsupported capabilities', () => {
    const mode = getPageModeForUrl('chrome://extensions');

    expect(mode).toBe('unsupported');
    expect(getPageModeCapabilities(mode)).toEqual({
      canAnnotate: false,
      canCapture: false,
      canSend: false,
      canEdit: false,
      canSave: false,
    });
  });
});
