// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { shouldSyncFile } from '../../scripts/sync-visbug-assets.mjs';

describe('sync-visbug-assets', () => {
  it('不会再同步教程 GIF 目录', () => {
    expect(shouldSyncFile('/app/tuts/position.gif')).toBe(false);
    expect(shouldSyncFile('/app/tuts/font.gif')).toBe(false);
  });

  it('保留 page-edit 运行所需的核心脚本资源', () => {
    expect(shouldSyncFile('/app/components/vis-bug/vis-bug.element.js')).toBe(true);
    expect(shouldSyncFile('/app/features/selectable.js')).toBe(true);
  });
});
