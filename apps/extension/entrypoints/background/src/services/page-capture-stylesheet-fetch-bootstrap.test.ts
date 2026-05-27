// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const initPageCaptureStylesheetFetchListener = vi.fn();

vi.mock('./page-capture-stylesheet-fetch', () => ({
  initPageCaptureStylesheetFetchListener,
}));

describe('page capture stylesheet fetch bootstrap', () => {
  it('registers the stylesheet fetch listener at import time', async () => {
    await import('./page-capture-stylesheet-fetch-bootstrap');

    expect(initPageCaptureStylesheetFetchListener).toHaveBeenCalledTimes(1);
  });
});
