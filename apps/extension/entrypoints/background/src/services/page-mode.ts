export type PageMode = 'live-page' | 'local-snapshot' | 'unsupported';

export type PageModeCapabilities = {
  canAnnotate: boolean;
  canCapture: boolean;
  canSend: boolean;
  canEdit: boolean;
  canSave: boolean;
};

const PAGE_MODE_CAPABILITIES: Record<PageMode, PageModeCapabilities> = {
  'live-page': {
    canAnnotate: true,
    canCapture: true,
    canSend: true,
    canEdit: false,
    canSave: false,
  },
  'local-snapshot': {
    canAnnotate: true,
    canCapture: true,
    canSend: true,
    canEdit: true,
    canSave: true,
  },
  unsupported: {
    canAnnotate: false,
    canCapture: false,
    canSend: false,
    canEdit: false,
    canSave: false,
  },
};

function isBackendPreviewAssetUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return /^https?:$/i.test(parsedUrl.protocol) && parsedUrl.pathname.startsWith('/api/preview/assets/');
  } catch {
    return false;
  }
}

export function getPageModeForUrl(url: string | undefined): PageMode {
  if (!url) {
    return 'unsupported';
  }

  if (/^file:/i.test(url)) {
    return 'local-snapshot';
  }

  if (isBackendPreviewAssetUrl(url)) {
    return 'local-snapshot';
  }

  if (/^https?:/i.test(url)) {
    return 'live-page';
  }

  return 'unsupported';
}

export function getPageModeCapabilities(mode: PageMode): PageModeCapabilities {
  return PAGE_MODE_CAPABILITIES[mode];
}
