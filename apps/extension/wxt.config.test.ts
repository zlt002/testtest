// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { sidepanelRouterOptions } from './wxt.config';

describe('wxt sidepanel router config', () => {
  it('ignores route-adjacent support and test files during route generation', () => {
    expect(sidepanelRouterOptions.routeFileIgnorePattern).toBe(
      '(?:file-preview\\..+|\\.(?:test|spec|shared|workspace))\\.[^.]+$'
    );
  });

  it('ignores file-preview route support modules during route generation', () => {
    const matcher = new RegExp(sidepanelRouterOptions.routeFileIgnorePattern);

    expect(matcher.test('file-preview.annotation-position.ts')).toBe(true);
    expect(matcher.test('file-preview.mode.ts')).toBe(true);
    expect(matcher.test('file-preview.tsx')).toBe(false);
  });
});
