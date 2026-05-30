// Service to inject accr polyfill into tabs early using chrome.scripting API

type PolyfillTarget = 'main-frame' | 'matched-frame';
type ScriptTarget = 'matched-frame' | 'all-frames';

const WEBEDIT_SCRIPT_FILES = [
  'webedit/runtime-adapter.js',
  'webedit/result-helpers.js',
  'webedit/tools/context.js',
  'webedit/tools/probe.js',
  'webedit/tools/document.js',
  'webedit/tools/flow.js',
  'webedit/tools/cells.js',
  'webedit/tools/formula.js',
  'webedit/tools/format.js',
  'webedit/tools/structure.js',
  'webedit/tools/search.js',
  'webedit/tools/data.js',
  'webedit/tools/presets.js',
  'webedit-mcp-server.js',
];

export interface InjectionPlan {
  polyfillTarget: PolyfillTarget;
  scripts: string[];
  scriptTarget: ScriptTarget;
}

function isBrowserInternalUrl(url: string) {
  return url.startsWith('chrome://') || url.startsWith('edge://');
}

export function resolveInjectionPlan(url: string): InjectionPlan | null {
  if (isBrowserInternalUrl(url)) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (
      hostname === 'doc.midea.com' &&
      parsedUrl.pathname.startsWith('/teamKnowledge/detail/docOnline/')
    ) {
      return {
        polyfillTarget: 'main-frame',
        scripts: [],
        scriptTarget: 'matched-frame',
      };
    }

    if (
      hostname === 'webedit.midea.com' &&
      (
        parsedUrl.pathname.startsWith('/moewebv7/document-cloud') ||
        parsedUrl.pathname.startsWith('/c/backendservice/flow/pom/') ||
        parsedUrl.pathname.startsWith('/weboffice/office/w/') ||
        parsedUrl.pathname.startsWith('/weboffice/office/s/')
      )
    ) {
      return {
        polyfillTarget: 'matched-frame',
        scripts: WEBEDIT_SCRIPT_FILES,
        scriptTarget: 'matched-frame',
      };
    }
  } catch {
    // Ignore malformed URLs instead of injecting into unknown pages.
  }

  return null;
}

function createInjectionTarget(
  tabId: number,
  targetMode: 'main-frame' | 'matched-frame' | 'all-frames',
  frameIds?: number[]
): chrome.scripting.InjectionTarget {
  if (targetMode === 'all-frames') {
    return { tabId, allFrames: true };
  }

  if (targetMode === 'main-frame') {
    return { tabId, allFrames: false };
  }

  if (frameIds && frameIds.length > 0) {
    return { tabId, frameIds };
  }

  return { tabId, allFrames: false };
}

// Function to inject the polyfill into a tab
async function injectWebMCPPolyfill(
  tabId: number,
  targetMode: 'main-frame' | 'matched-frame',
  frameIds?: number[]
) {
  try {
    await chrome.scripting.executeScript({
      target: createInjectionTarget(tabId, targetMode, frameIds),
      world: 'MAIN', // Run in the main world, not isolated
      injectImmediately: true, // Inject as early as possible
      files: ['polyfill.js'], // File from public directory
    });
  } catch (error) {
    // This may fail for certain tabs (chrome:// pages, etc), which is expected
    console.debug(`[accr Injector] Could not inject into tab ${tabId}:`, error);
  }
}

async function injectScriptFiles(
  tabId: number,
  files: string[],
  targetMode: 'matched-frame' | 'all-frames',
  frameIds?: number[]
) {
  if (files.length === 0) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: createInjectionTarget(tabId, targetMode, frameIds),
      world: 'MAIN', // Must run in MAIN world to access window.APP
      injectImmediately: true,
      files,
    });
    const scope =
      targetMode === 'all-frames'
        ? 'all frames'
        : frameIds && frameIds.length > 0
          ? `frame(s) ${frameIds.join(',')}`
          : 'main frame';
    console.log(
      `[accr Injector] Injected ${files.join(', ')} into tab ${tabId} (${scope})`
    );
  } catch (error) {
    console.debug(`[accr Injector] Could not inject scripts into tab ${tabId}:`, error);
  }
}

async function executeInjectionPlan(tabId: number, url: string, frameIds?: number[]) {
  const plan = resolveInjectionPlan(url);
  if (!plan) {
    return;
  }

  await injectWebMCPPolyfill(tabId, plan.polyfillTarget, frameIds);
  await injectScriptFiles(tabId, plan.scripts, plan.scriptTarget, frameIds);
}

async function injectIntoExistingFrames(tabId: number) {
  let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = [];

  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (error) {
    console.debug(`[accr Injector] Could not enumerate frames for tab ${tabId}:`, error);
    return;
  }

  for (const frame of frames ?? []) {
    if (!frame.url) {
      continue;
    }

    const frameIds = typeof frame.frameId === 'number' && frame.frameId !== 0 ? [frame.frameId] : undefined;
    await executeInjectionPlan(tabId, frame.url, frameIds);
  }
}

// Initialize the accr injector
export function initWebMCPInjector() {
  // Inject into all existing tabs on startup
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        void executeInjectionPlan(tab.id, tab.url);
        void injectIntoExistingFrames(tab.id);
      }
    }
  });

  // Listen for new tabs being created
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id && tab.url) {
      console.log('injecting into tab', tab.id);
      void executeInjectionPlan(tab.id, tab.url);
    }
  });

  // Listen for tab updates (navigation)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Inject when a page starts loading
    if (changeInfo.status === 'loading' && tab.url) {
      void executeInjectionPlan(tabId, tab.url);
    }

    if (changeInfo.status === 'complete') {
      void injectIntoExistingFrames(tabId);
    }
  });

  // 监听所有 frame 的导航事件，确保动态创建的 iframe 也能注入
  chrome.webNavigation.onCommitted.addListener((details) => {
    const frameIds = details.frameId === 0 ? undefined : [details.frameId];
    void executeInjectionPlan(details.tabId, details.url, frameIds);
  });

  console.log('[accr Injector] Initialized accr polyfill injector');
}
