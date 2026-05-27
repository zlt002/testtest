export type FilePreviewKind = 'html' | 'markdown' | 'text';
export type FilePreviewViewMode = 'preview' | 'source';

export function filePreviewSupportsRenderedPreview(kind: FilePreviewKind): boolean {
  return kind === 'markdown';
}

export function filePreviewDefaultViewMode(kind: FilePreviewKind): FilePreviewViewMode {
  if (kind === 'markdown') {
    return 'preview';
  }
  return 'source';
}
