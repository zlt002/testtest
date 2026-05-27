(async () => {
  if (globalThis.__WEBMCP_PAGE_EDIT_INJECT_PROMISE__) {
    await globalThis.__WEBMCP_PAGE_EDIT_INJECT_PROMISE__;
    return;
  }

  globalThis.__WEBMCP_PAGE_EDIT_INJECT_PROMISE__ = (async () => {
  const ROOT_SELECTOR = 'vis-bug[data-webmcp-page-edit-root="true"]';
  const STYLE_SELECTOR = 'link[data-webmcp-page-edit-style="true"]';
  const CONFIG_ATTRIBUTE = 'data-webmcp-page-edit-config';

  if (!document.head || !document.body) {
    throw new Error('Page Edit Mode requires document head and body');
  }

  const rawConfig = document.documentElement.getAttribute(CONFIG_ATTRIBUTE);
  if (!rawConfig) {
    throw new Error('Page Edit Mode config is missing');
  }

  const config = JSON.parse(rawConfig);
  if (!config?.styleUrl || !config?.moduleUrl || !config?.tutsBaseUrl) {
    throw new Error('Page Edit Mode config is incomplete');
  }

  if (!document.querySelector(STYLE_SELECTOR)) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = config.styleUrl;
    style.setAttribute('data-webmcp-page-edit-style', 'true');
    document.head.appendChild(style);
  }

  const existing = document.querySelector(ROOT_SELECTOR);
  if (existing instanceof HTMLElement) {
    existing.hidden = false;
    existing.style.removeProperty('display');
    return;
  }

  await import(config.moduleUrl);

  const visbug = document.createElement('vis-bug');
  visbug.setAttribute('data-webmcp-page-edit-root', 'true');
  visbug.setAttribute('tutsBaseURL', config.tutsBaseUrl);
  document.body.prepend(visbug);
  })();

  try {
    await globalThis.__WEBMCP_PAGE_EDIT_INJECT_PROMISE__;
  } finally {
    globalThis.__WEBMCP_PAGE_EDIT_INJECT_PROMISE__ = null;
  }
})().catch((error) => {
  console.error('[page-edit] inject failed');
  console.error(error);
});
