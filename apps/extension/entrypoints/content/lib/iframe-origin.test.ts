// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  getIframeTargetOrigin,
  shouldConnectToWebEditIframeTarget,
  shouldDelayWebEditIframeHandshake,
} from './iframe-origin';

describe('iframe-origin helpers', () => {
  it('解析 iframe src 的 origin', () => {
    expect(
      getIframeTargetOrigin('https://webedit.midea.com/moewebv7/document-cloud?editId=1')
    ).toBe('https://webedit.midea.com');
    expect(getIframeTargetOrigin('javascript:void(0)')).toBeNull();
  });

  it('当 srcOrigin 与 runtimeOrigin 不一致时延迟握手', () => {
    expect(
      shouldDelayWebEditIframeHandshake({
        srcOrigin: 'https://webedit.midea.com',
        runtimeOrigin: 'https://doc.midea.com',
      })
    ).toBe(true);
  });

  it('当 runtimeOrigin 可读且与目标 origin 不一致时，禁止 fallback 直连', () => {
    expect(
      shouldConnectToWebEditIframeTarget({
        targetOrigin: 'https://webedit.midea.com',
        runtimeOrigin: 'https://doc.midea.com',
      })
    ).toBe(false);
    expect(
      shouldConnectToWebEditIframeTarget({
        targetOrigin: 'https://webedit.midea.com',
        runtimeOrigin: 'https://webedit.midea.com',
      })
    ).toBe(true);
    expect(
      shouldConnectToWebEditIframeTarget({
        targetOrigin: 'https://webedit.midea.com',
        runtimeOrigin: null,
      })
    ).toBe(true);
  });
});
