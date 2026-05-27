function normalizeWindowsDrivePath(value: string) {
  const legacyDrivePath = value.match(/^\/([a-zA-Z])\/+(.+)$/);
  if (!legacyDrivePath) {
    return value;
  }
  return `${legacyDrivePath[1].toUpperCase()}:/${legacyDrivePath[2]}`;
}

function isAbsoluteFilePath(path: string) {
  return (
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    /^\/[A-Za-z]\/+/.test(path)
  );
}

function normalizeAbsoluteFilePath(projectPath: string, filePath: string) {
  const normalizedFilePath = normalizeWindowsDrivePath(filePath).replace(/\\/g, '/');
  if (isAbsoluteFilePath(filePath)) {
    return normalizedFilePath;
  }
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '');
  const relativeFilePath = normalizedFilePath.replace(/^[\\/]+/, '');
  return `${normalizedProjectPath}/${relativeFilePath}`;
}

function normalizeAbsoluteFileUrl(input: { projectPath: string; filePath: string }) {
  const absolutePath = normalizeAbsoluteFilePath(input.projectPath, input.filePath).replace(
    /\\/g,
    '/'
  );

  if (/^[A-Za-z]:\//.test(absolutePath)) {
    return new URL(`file:///${absolutePath}`).toString();
  }

  return new URL(`file://${absolutePath}`).toString();
}

export function buildFileBrowserPreviewUrl(input: { projectPath: string; filePath: string }) {
  return normalizeAbsoluteFileUrl(input);
}

export function buildSidepanelFilePreviewUrl(input: {
  extensionOrigin?: string;
  projectPath: string;
  filePath: string;
  mode?: 'default' | 'live-write';
}) {
  const extensionOrigin = input.extensionOrigin ?? chrome.runtime.getURL('');
  const liveWriteQuery = input.mode === 'live-write' ? '&liveWrite=1' : '';
  return `${new URL('/sidepanel.html', extensionOrigin).toString()}?route=/file-preview&projectPath=${encodeURIComponent(input.projectPath)}&filePath=${encodeURIComponent(input.filePath)}${liveWriteQuery}`;
}

type BrowserPreviewTab = {
  id?: number;
  url?: string;
};

type HtmlBrowserPreviewDeps = {
  fallbackUrl?: string;
  tabsCreate?: (createProperties: { url: string; active: boolean }) => Promise<BrowserPreviewTab>;
  tabsGet?: (tabId: number) => Promise<BrowserPreviewTab>;
  tabsQuery?: (queryInfo: Record<string, unknown>) => Promise<BrowserPreviewTab[]>;
  tabsReload?: (tabId: number, reloadProperties?: { bypassCache?: boolean }) => Promise<void>;
  tabsUpdate?: (
    tabId: number,
    updateProperties: { active?: boolean; url?: string }
  ) => Promise<BrowserPreviewTab>;
  open?: typeof window.open;
};

const openedPreviewTabIds = new Map<string, number>();
const openedPreviewTabResolvedUrls = new Map<string, string>();

function browserTabsApi() {
  return typeof chrome === 'undefined' ? undefined : chrome.tabs;
}

function rememberPreviewTab(
  url: string,
  tab: BrowserPreviewTab | null | undefined,
  resolvedUrl = url
) {
  if (typeof tab?.id === 'number') {
    openedPreviewTabIds.set(url, tab.id);
    openedPreviewTabResolvedUrls.set(url, resolvedUrl);
  }
}

function normalizeComparablePreviewPath(value: string) {
  return normalizeWindowsDrivePath(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function isBackendPreviewAssetUrl(requestedUrl: string, candidateUrl: string) {
  try {
    const requested = new URL(requestedUrl);
    const candidate = new URL(candidateUrl);
    const requestedFilePath = requested.searchParams.get('filePath');
    const candidateMatch = candidate.pathname.match(/^\/api\/preview\/assets\/[^/]+\/(.+)$/);
    const candidateFilePath = candidateMatch?.[1] ? decodeURIComponent(candidateMatch[1]) : null;
    return (
      requested.origin === candidate.origin &&
      requested.pathname === '/api/preview/file' &&
      candidate.pathname.startsWith('/api/preview/assets/') &&
      typeof requestedFilePath === 'string' &&
      typeof candidateFilePath === 'string' &&
      normalizeComparablePreviewPath(requestedFilePath) ===
        normalizeComparablePreviewPath(candidateFilePath)
    );
  } catch {
    return false;
  }
}

async function findRememberedPreviewTab(url: string, deps: HtmlBrowserPreviewDeps) {
  const tabId = openedPreviewTabIds.get(url);
  const resolvedUrl = openedPreviewTabResolvedUrls.get(url) ?? url;
  const tabsGet = deps.tabsGet ?? browserTabsApi()?.get;
  if (typeof tabId !== 'number' || !tabsGet) {
    return null;
  }

  try {
    const tab = await tabsGet(tabId);
    if (tab?.url === resolvedUrl || isBackendPreviewAssetUrl(url, tab?.url ?? '')) {
      if (tab?.url && tab.url !== resolvedUrl) {
        openedPreviewTabResolvedUrls.set(url, tab.url);
      }
      return { id: tabId, tab };
    }
  } catch {
    // Closed tabs are expected; forget them and fall back to a URL scan.
  }

  openedPreviewTabIds.delete(url);
  openedPreviewTabResolvedUrls.delete(url);
  return null;
}

async function findExistingPreviewTab(url: string, deps: HtmlBrowserPreviewDeps) {
  const resolvedUrl = openedPreviewTabResolvedUrls.get(url) ?? url;
  const tabsQuery = deps.tabsQuery ?? browserTabsApi()?.query;
  if (!tabsQuery) {
    return null;
  }

  const tabs = await tabsQuery({}).catch(() => []);
  const tab = tabs.find(
    (candidate) =>
      typeof candidate.id === 'number' &&
      (candidate.url === resolvedUrl || isBackendPreviewAssetUrl(url, candidate.url ?? ''))
  );
  if (!tab || typeof tab.id !== 'number') {
    return null;
  }
  openedPreviewTabIds.set(url, tab.id);
  openedPreviewTabResolvedUrls.set(url, tab.url ?? resolvedUrl);
  return { id: tab.id, tab };
}

async function findPreviewTab(url: string, deps: HtmlBrowserPreviewDeps) {
  return (await findRememberedPreviewTab(url, deps)) ?? findExistingPreviewTab(url, deps);
}

export function buildHtmlBrowserPreviewUrl(input: {
  backendBaseUrl?: string | null;
  projectPath: string;
  filePath: string;
  mode?: 'file' | 'live-preview';
}): string {
  const mode = input.mode ?? 'file';
  const backendBaseUrl = input.backendBaseUrl?.trim();
  if (mode === 'live-preview' && backendBaseUrl) {
    const url = new URL('/api/preview/file', backendBaseUrl);
    url.searchParams.set('projectPath', input.projectPath);
    url.searchParams.set('filePath', input.filePath);
    return url.toString();
  }
  return buildFileBrowserPreviewUrl(input);
}

export async function openHtmlBrowserPreview(
  url: string,
  deps: HtmlBrowserPreviewDeps = {}
): Promise<void> {
  const existingTab = await findPreviewTab(url, deps);
  const tabsUpdate = deps.tabsUpdate ?? browserTabsApi()?.update;
  if (existingTab && tabsUpdate) {
    const nextUpdate =
      existingTab.tab.url === url
        ? { active: true }
        : {
            active: true,
            // Force a fresh /api/preview/file navigation when the tab is sitting on
            // a redirected asset URL so the backend can recreate in-memory preview state.
            url,
          };
    await tabsUpdate(existingTab.id, nextUpdate);
    return;
  }

  const tabsCreate = deps.tabsCreate ?? browserTabsApi()?.create;

  try {
    if (!tabsCreate) {
      throw new Error('chrome tabs API is unavailable');
    }
    const tab = await tabsCreate({ url, active: true });
    rememberPreviewTab(url, tab, url);
  } catch {
    const open = deps.open ?? (typeof window === 'undefined' ? undefined : window.open);
    open?.(url, '_blank', 'noopener,noreferrer');
  }
}

export async function reloadHtmlBrowserPreview(
  url: string,
  deps: HtmlBrowserPreviewDeps = {}
): Promise<boolean> {
  const existingTab = await findPreviewTab(url, deps);
  if (!existingTab) {
    return false;
  }

  const tabsReload = deps.tabsReload ?? browserTabsApi()?.reload;
  if (!tabsReload) {
    return false;
  }

  try {
    await tabsReload(existingTab.id, { bypassCache: true });
    return true;
  } catch {
    openedPreviewTabIds.delete(url);
    openedPreviewTabResolvedUrls.delete(url);
    return false;
  }
}
