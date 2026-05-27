import './src/services/page-capture-stylesheet-fetch-bootstrap';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BGSWRouter } from './src/routers';
import { initCompanionStatusBadge } from './src/services/CompanionStatusBadge';
import McpHub from './src/services/mcpHub';
import {
  connectNativeHost,
  ensureCompanionReady,
  initNativeHostListener,
} from './src/services/NativeHostManager';
import {
  createPageEditCommandListener,
  initPageEditListeners,
  pageEditService,
} from './src/services/page-edit';
import { initExternalExtensionPortListener } from './src/services/ports/ExternalExtensionPortManager';
import { initUiClientPortListener } from './src/services/ports/UiClientPortManager';
import { initSidepanelHandlers } from './src/services/sidepanel';
import { initWebMCPInjector } from './src/services/WebMCPInjector';
import { initWindowTakeoverListeners } from './src/services/window-takeover';
import { createChromeHandler } from './trpc-browser/adapter';

function isUserScriptsAvailable() {
  try {
    // Throws if API permission or toggle is not enabled.
    chrome.userScripts.getScripts();
    return true;
  } catch {
    console.log('User scripts are not available');
    return false;
  }
}

function configureUserScriptWorldMaxAccess() {
  if (!isUserScriptsAvailable()) return;

  const permissiveCsp = [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: filesystem: http: https:",
    "object-src 'self' blob: data:",
    'connect-src * data: blob:',
    'img-src * data: blob:',
    "style-src * 'unsafe-inline' blob: data:",
    'font-src * data: blob:',
    'frame-src * data: blob:',
  ].join('; ');

  // Configure default USER_SCRIPT world
  try {
    chrome.userScripts.configureWorld({
      messaging: true,
      csp: permissiveCsp,
    });
  } catch (error) {
    console.warn('Failed to configure default USER_SCRIPT world:', error);
  }

  // Also configure a named world with the same permissive settings for callers that use worldId
  try {
    chrome.userScripts.configureWorld({
      messaging: true,
      csp: permissiveCsp,
      // Use a stable non-reserved world ID for maximum-access world
      worldId: 'max',
    });
  } catch (error) {
    console.warn('Failed to configure USER_SCRIPT world "max":', error);
  }

  try {
    chrome.userScripts.getWorldConfigurations((worlds) => {
      console.log('Configured user script worlds:', worlds);
    });
  } catch (error) {
    console.warn('Failed to get user script world configurations:', error);
  }
}

export default defineBackground({
  persistent: true,

  type: 'module',
  main() {
    console.log('[native] Background build marker: native-debug-20260510-1352');
    configureUserScriptWorldMaxAccess();
    initWebMCPInjector();
    console.log('[accr Injector] Background startup completed with injector enabled');
    const sharedServer = new McpServer({ name: 'Extension-Hub', version: '1.0.0' });
    new McpHub(sharedServer);

    // Connect sidepanel UI clients to the shared server
    initUiClientPortListener(sharedServer);

    // Accept external extension connections. Each external extension gets its own server instance.
    initExternalExtensionPortListener((extensionId) => {
      const server = new McpServer({ name: extensionId, version: '1.0.0' });
      new McpHub(server);
      return server;
    });

    // Native host and sidepanel behavior
    initNativeHostListener();
    initCompanionStatusBadge();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'ensure_native_host' && message?.type !== 'ensure_companion_ready') {
        return false;
      }

      const task =
        message.type === 'ensure_companion_ready' ? ensureCompanionReady() : connectNativeHost();

      task
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return true;
    });
    initSidepanelHandlers();
    initPageEditListeners();
    const onPageEditCommand = createPageEditCommandListener(pageEditService);
    chrome.commands?.onCommand?.addListener((command) => {
      void onPageEditCommand(command);
    });
    chrome.action?.onClicked?.addListener(async () => {
      const ensureTask = ensureCompanionReady().catch((error) => {
        console.warn('[native] Failed to ensure companion readiness on action click:', error);
      });
      void pageEditService.toggleForActiveTab();
      await ensureTask;
    });
    initWindowTakeoverListeners();

    // Re-apply world configuration after install/update since user scripts are cleared on update.
    configureUserScriptWorldMaxAccess();
    createChromeHandler({
      router: BGSWRouter,
      chrome: chrome,
    });
  },
});
