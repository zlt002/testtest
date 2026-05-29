// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildPendingLiveWriteNotice } from './file-preview';
import type { LiveWritePreviewPayload } from '../lib/agent-v2/live-write-preview';

function payload(status: LiveWritePreviewPayload['status']): LiveWritePreviewPayload {
  return {
    id: 'write-1',
    projectPath: '/tmp/project',
    filePath: 'docs/report.md',
    content: '# Draft',
    status,
    updatedAt: '2026-05-29T14:35:00.000Z',
  };
}

describe('buildPendingLiveWriteNotice', () => {
  it('shows an approval-oriented notice while live write is still writing', () => {
    expect(buildPendingLiveWriteNotice(payload('writing'))).toBe(
      '文件正在等待写入审批，批准后会自动生成并刷新预览。'
    );
  });

  it('shows a syncing notice after live write completed but disk content is not readable yet', () => {
    expect(buildPendingLiveWriteNotice(payload('completed'))).toBe(
      'AI 已生成预览内容，正在等待磁盘文件同步完成，预览会自动刷新。'
    );
  });

  it('does not show a notice for failed live writes', () => {
    expect(buildPendingLiveWriteNotice(payload('failed'))).toBeNull();
  });
});
