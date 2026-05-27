type LiveWritePreviewTabUpdate = {
  active: true;
  url?: string;
};

type LiveWritePreviewStatus = 'writing' | 'completed' | 'failed';

const LIVE_WRITE_SIDEPANEL_PREVIEW_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const LIVE_WRITE_FILE_PREVIEW_EXTENSIONS = new Set(['.html', '.htm']);

function hasSupportedExtension(filePath: string, extensions: Set<string>) {
  return Array.from(extensions).some((extension) => filePath.endsWith(extension));
}

export function createLiveWritePreviewTabUpdate(
  currentUrl: string | undefined,
  previewUrl: string
): LiveWritePreviewTabUpdate {
  if (currentUrl === previewUrl) {
    return { active: true };
  }

  return { active: true, url: previewUrl };
}

export function shouldAutoOpenLiveWritePreview(
  openedPreviewIds: Set<string>,
  previewId: string,
  status: LiveWritePreviewStatus,
  filePath: string
) {
  const normalizedFilePath = filePath.trim().toLowerCase();
  const canAutoOpen =
    (status === 'writing' &&
      (hasSupportedExtension(normalizedFilePath, LIVE_WRITE_SIDEPANEL_PREVIEW_EXTENSIONS) ||
        hasSupportedExtension(normalizedFilePath, LIVE_WRITE_FILE_PREVIEW_EXTENSIONS))) ||
    (status === 'completed' &&
      hasSupportedExtension(normalizedFilePath, LIVE_WRITE_FILE_PREVIEW_EXTENSIONS));

  if (!canAutoOpen || openedPreviewIds.has(previewId)) {
    return false;
  }
  openedPreviewIds.add(previewId);
  return true;
}
