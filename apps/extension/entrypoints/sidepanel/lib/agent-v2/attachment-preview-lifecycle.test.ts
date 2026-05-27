// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { SessionAttachment } from './types';
import {
  releaseRetainedAttachmentPreviewUrls,
  retainAttachmentPreviewUrls,
} from './attachment-preview-lifecycle';

function imageAttachment(overrides: Partial<SessionAttachment> = {}): SessionAttachment {
  return {
    id: overrides.id || 'attachment-1',
    sessionFileId: overrides.sessionFileId || 'session-file-1',
    name: overrides.name || 'screenshot.png',
    mimeType: overrides.mimeType || 'image/png',
    size: overrides.size || 1234,
    kind: overrides.kind || 'image',
    storage: overrides.storage || 'uploaded',
    ...overrides,
  };
}

describe('attachment preview lifecycle', () => {
  it('retains sent attachment preview URLs instead of revoking them immediately', () => {
    const previewUrlsByAttachmentId = new Map<string, string>([
      ['attachment-1', 'blob:https://example.com/screenshot-1'],
      ['attachment-2', 'blob:https://example.com/screenshot-2'],
    ]);
    const retainedPreviewUrls = new Set<string>();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    retainAttachmentPreviewUrls(
      [
        imageAttachment({ id: 'attachment-1' }),
        imageAttachment({ id: 'attachment-2' }),
      ],
      previewUrlsByAttachmentId,
      retainedPreviewUrls
    );

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(previewUrlsByAttachmentId.size).toBe(0);
    expect([...retainedPreviewUrls]).toEqual([
      'blob:https://example.com/screenshot-1',
      'blob:https://example.com/screenshot-2',
    ]);
  });

  it('releases retained preview URLs during cleanup', () => {
    const retainedPreviewUrls = new Set<string>([
      'blob:https://example.com/screenshot-1',
      'blob:https://example.com/screenshot-2',
    ]);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });

    releaseRetainedAttachmentPreviewUrls(retainedPreviewUrls);

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      1,
      'blob:https://example.com/screenshot-1'
    );
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      'blob:https://example.com/screenshot-2'
    );
    expect(retainedPreviewUrls.size).toBe(0);
  });
});
