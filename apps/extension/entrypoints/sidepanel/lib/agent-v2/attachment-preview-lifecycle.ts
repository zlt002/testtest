import type { SessionAttachment } from './types';

export function retainAttachmentPreviewUrls(
  attachments: SessionAttachment[],
  previewUrlsByAttachmentId: Map<string, string>,
  retainedPreviewUrls: Set<string>
) {
  for (const attachment of attachments) {
    const previewUrl = previewUrlsByAttachmentId.get(attachment.id);
    if (!previewUrl) {
      continue;
    }
    previewUrlsByAttachmentId.delete(attachment.id);
    retainedPreviewUrls.add(previewUrl);
  }
}

export function releaseRetainedAttachmentPreviewUrls(retainedPreviewUrls: Set<string>) {
  for (const previewUrl of retainedPreviewUrls) {
    URL.revokeObjectURL(previewUrl);
  }
  retainedPreviewUrls.clear();
}
