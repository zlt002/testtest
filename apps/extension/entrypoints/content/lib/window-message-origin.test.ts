// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  getWindowPostMessageTargetOrigin,
  isCurrentPageMessageEventOrigin,
} from './window-message-origin';

describe('window-message-origin helpers', () => {
  it('对普通 http 页面保留精确 targetOrigin', () => {
    expect(
      getWindowPostMessageTargetOrigin({
        origin: 'https://example.com',
        protocol: 'https:',
      } as Location)
    ).toBe('https://example.com');
  });

  it('对 file 页面降级为通配 targetOrigin', () => {
    expect(
      getWindowPostMessageTargetOrigin({
        origin: 'null',
        protocol: 'file:',
      } as Location)
    ).toBe('*');
    expect(
      getWindowPostMessageTargetOrigin({
        origin: 'file://',
        protocol: 'file:',
      } as Location)
    ).toBe('*');
  });

  it('在普通页面只接受同源消息', () => {
    const locationLike = {
      origin: 'https://example.com',
      protocol: 'https:',
    } as Location;

    expect(isCurrentPageMessageEventOrigin(locationLike, 'https://example.com')).toBe(true);
    expect(isCurrentPageMessageEventOrigin(locationLike, 'https://evil.example')).toBe(false);
  });

  it('在 file 页面接受浏览器返回的本地文件 origin 形式', () => {
    const locationLike = {
      origin: 'null',
      protocol: 'file:',
    } as Location;

    expect(isCurrentPageMessageEventOrigin(locationLike, 'null')).toBe(true);
    expect(isCurrentPageMessageEventOrigin(locationLike, 'file://')).toBe(true);
    expect(isCurrentPageMessageEventOrigin(locationLike, '')).toBe(true);
    expect(isCurrentPageMessageEventOrigin(locationLike, 'https://example.com')).toBe(false);
  });
});
