// content-scripts/content.ts

import { IframeParentTransport, TabClientTransport } from '@mcp-b/transports';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { defineContentScript } from '#imports';
import {
  getIframeTargetOrigin,
  isWebEditIframeCandidate,
  shouldConnectToWebEditIframeTarget,
  shouldDelayWebEditIframeHandshake,
} from './lib/iframe-origin';
import {
  consumeRuntimeLastError,
  hasRuntimeContext,
  isDisconnectedPortError,
  isExtensionContextInvalidated,
  safeAddPortDisconnectListener,
  safeAddPortMessageListener,
  safeAddRuntimeMessageListener,
  safePostToBackground,
  safeRuntimeSendMessage,
} from './lib/runtime-context';
import { createPageEditFileSaveBridge } from './lib/page-edit-file-save-bridge';
import { createPageEditSelectionBridge } from './lib/page-edit-selection-bridge';
import { createPageWorkbenchStateBridge } from './lib/page-workbench-state-bridge';
import { matchWebEditIframeReadyEvent } from './lib/webedit-iframe-binding';
import {
  createWebEditIframeCandidateRegistry,
  rankWebEditIframeCandidate,
  transitionWebEditIframeCandidate,
  type WebEditIframeCandidate,
} from './lib/webedit-iframe-candidates';
import { handlePageCaptureRequest } from './lib/page-capture/controller';
import { isPageCaptureRequest } from './lib/page-capture/types';
import {
  getWindowPostMessageTargetOrigin,
  isCurrentPageMessageEventOrigin,
} from './lib/window-message-origin';

// Types

interface ToolExecutionMessage {
  type: 'execute-tool';
  toolName: string;
  requestId: string;
  args?: Record<string, unknown>;
}

interface ToolResultMessage {
  type: 'tool-result';
  requestId: string;
  data: {
    success: boolean;
    payload: unknown;
  };
}

interface WebEditDebugStateRequest {
  type: 'webedit-debug-state';
}

interface WebEditDebugStateResponse {
  type: 'webedit-debug-state-result';
  success: boolean;
  payload?: unknown;
  error?: string;
}

interface WindowTakeoverContentStateMessage {
  type: 'agent_v2_window_takeover_content_state';
  payload: {
    active: boolean;
    runId: string;
  };
}

interface IframeClientEntry {
  client: Client;
  transport: IframeParentTransport;
  iframe: HTMLIFrameElement;
  isConnected: boolean;
  targetOrigin: string;
  candidateKey?: string;
}

function isWebEditDebugStateRequest(message: unknown): message is WebEditDebugStateRequest {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { type?: unknown }).type === 'webedit-debug-state'
  );
}

function isWindowTakeoverContentStateMessage(
  message: unknown
): message is WindowTakeoverContentStateMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { type?: unknown }).type === 'agent_v2_window_takeover_content_state' &&
    typeof (message as { payload?: { active?: unknown; runId?: unknown } }).payload?.active ===
      'boolean' &&
    typeof (message as { payload?: { active?: unknown; runId?: unknown } }).payload?.runId ===
      'string'
  );
}

function waitForMcpServerReady(timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(ready);
    };

    const onMessage = (event: MessageEvent) => {
      if (!isCurrentPageMessageEventOrigin(window.location, event.origin)) return;
      if (event.data?.channel !== 'mcp-default' || event.data?.type !== 'mcp') return;
      if (event.data?.direction !== 'server-to-client') return;
      if (event.data?.payload === 'mcp-server-ready') {
        finish(true);
      }
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        channel: 'mcp-default',
        type: 'mcp',
        direction: 'client-to-server',
        payload: 'mcp-check-ready',
      },
      getWindowPostMessageTargetOrigin(window.location)
    );
    setTimeout(() => finish(false), timeoutMs);
  });
}

// let cachedToolHashes: Map<string, string> = new Map();

async function checkForToolUpdates(
  client: Client,
  port: chrome.runtime.Port,
  updateToolsOrSendType:
    | ((tools: Array<{ name?: string }>, sendType: 'register-tools' | 'tools-updated') => void)
    | 'register-tools'
    | 'tools-updated',
  sendType: 'register-tools' | 'tools-updated' = 'tools-updated'
): Promise<void> {
  const updateTools = typeof updateToolsOrSendType === 'function' ? updateToolsOrSendType : null;
  const resolvedSendType =
    typeof updateToolsOrSendType === 'string' ? updateToolsOrSendType : sendType;

  try {
    const pageTools = await client.listTools();
    const newTools = pageTools.tools;

    for (const tool of newTools) {
      if (!tool.name) {
        console.error('Tool without name');
      }
    }
    console.log('newTools', newTools);

    if (updateTools) {
      updateTools(newTools, resolvedSendType);
    } else {
      safePostToBackground(port, {
        type: resolvedSendType,
        tools: newTools,
      });
    }
    console.log(`[MCP Proxy] Sent ${resolvedSendType} with ${newTools.length} tools to hub.`);
    console.log('newTools', newTools);
  } catch (error) {
    console.error('[MCP Proxy] Failed to check for tool updates:', error);

    // If we can't get tools (server might be disconnected), send empty tools list
    // but only if we previously had tools cached
    console.log('[MCP Proxy] Server appears disconnected, sending empty tools list');
    if (updateTools) {
      updateTools([], 'tools-updated');
    } else {
      safePostToBackground(port, {
        type: 'tools-updated',
        tools: [],
      });
    }
  }
}

// Tool execution
async function executeToolRequest(
  client: Client,
  message: ToolExecutionMessage
): Promise<ToolResultMessage> {
  console.log(`[MCP Proxy] Relaying call for '${message.toolName}' to the page's MCP server.`);

  console.log('[MCP Proxy] Tool call details:', {
    toolName: message.toolName,
    args: message.args,
    hasClient: !!client,
  });

  try {
    // Ensure args is at least an empty object
    const args = message.args || {};
    // Execute the tool
    const result = await client.callTool({
      name: message.toolName,
      arguments: args,
    });

    console.log('[MCP Proxy] Tool call succeeded:', message.toolName);

    return {
      type: 'tool-result',
      requestId: message.requestId,
      data: { success: true, payload: result },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MCP Proxy] Tool call failed:', error);

    // Check if this is a "Method not found" error
    if (errorMessage.includes('Method not found')) {
      const tools = await client.listTools();
      console.error('[MCP Proxy] Available tools:', tools);
    }

    return {
      type: 'tool-result',
      requestId: message.requestId,
      data: { success: false, payload: errorMessage },
    };
  }
}

// Export the content script
export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    console.log('[MCP Proxy] Initializing MCP proxy...');
    // Note: WebMCP polyfill is now injected by the background script using chrome.scripting API
    if (!hasRuntimeContext()) {
      console.debug(
        '[MCP Proxy] Extension context is not available; skipping content script startup'
      );
      return;
    }

    const pageEditSelectionBridge = createPageEditSelectionBridge(safeRuntimeSendMessage);
    window.addEventListener('message', pageEditSelectionBridge);
    const pageEditFileSaveBridge = createPageEditFileSaveBridge(safeRuntimeSendMessage);
    window.addEventListener('message', pageEditFileSaveBridge);
    const pageWorkbenchStateBridge = createPageWorkbenchStateBridge(safeRuntimeSendMessage);
    void pageWorkbenchStateBridge.syncFromDocumentConfig();
    const pageWorkbenchStateObserver = new MutationObserver(() => {
      void pageWorkbenchStateBridge.syncFromDocumentConfig();
    });
    pageWorkbenchStateObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-webmcp-page-edit-config'],
    });

    let mainClient: Client | null = null;
    let mainTransport: TabClientTransport | null = null;
    let isMainConnected = false;
    let isBackgroundPortConnected = true;
    const iframeClients = new Map<number, IframeClientEntry>();
    const iframeClientIdsByElement = new WeakMap<HTMLIFrameElement, number>();
    const iframeCandidateRegistry = createWebEditIframeCandidateRegistry();
    const iframeCandidateKeysByElement = new WeakMap<HTMLIFrameElement, string>();
    const iframeElementsByCandidateKey = new Map<string, HTMLIFrameElement>();
    const pendingIframeConnections = new WeakSet<HTMLIFrameElement>();
    const toolClientMap = new Map<string, Client>();
    const iframeToolsByClientId = new Map<number, Array<{ name?: string }>>();
    let latestMainTools: Array<{ name?: string }> = [];
    let activeIframeCandidateKey: string | null = null;
    let windowTakeoverRunId: string | null = null;
    let mutationObserver: MutationObserver | null = null;
    let iframeScanInterval: ReturnType<typeof setInterval> | null = null;

    function buildWebEditDebugState() {
      const candidates = iframeCandidateRegistry.list();
      const candidateElements = candidates.map((candidate) => {
        const iframe = iframeElementsByCandidateKey.get(candidate.key);
        return {
          key: candidate.key,
          id: candidate.id ?? null,
          state: candidate.state,
          priority: candidate.priority,
          failureCount: candidate.failureCount,
          retryAt: candidate.retryAt ?? null,
          reason: candidate.reason ?? null,
          matchedBy: candidate.matchedBy ?? null,
          srcOrigin: candidate.srcOrigin ?? null,
          runtimeOrigin: candidate.runtimeOrigin ?? null,
          eventOrigin: candidate.eventOrigin ?? null,
          iframeConnected: iframe?.isConnected ?? false,
          iframeSrc: iframe?.src || iframe?.getAttribute('src') || '',
          trackedIframeId: iframe ? (iframeClientIdsByElement.get(iframe) ?? null) : null,
        };
      });

      const iframeClientStates = Array.from(iframeClients.entries()).map(([iframeId, entry]) => ({
        iframeId,
        isConnected: entry.isConnected,
        targetOrigin: entry.targetOrigin,
        candidateKey: entry.candidateKey ?? null,
        iframeIdAttr: entry.iframe.id || null,
        iframeSrc: entry.iframe.src || entry.iframe.getAttribute('src') || '',
        toolCount: iframeToolsByClientId.get(iframeId)?.length ?? 0,
        toolNames: (iframeToolsByClientId.get(iframeId) || [])
          .map((tool) => tool.name)
          .filter(Boolean),
      }));

      return {
        page: {
          title: document.title,
          url: location.href,
          readyState: document.readyState,
        },
        mainClient: {
          connected: isMainConnected,
          toolCount: latestMainTools.length,
          toolNames: latestMainTools.map((tool) => tool.name).filter(Boolean),
        },
        webedit: {
          activeIframeCandidateKey,
          candidateCount: candidateElements.length,
          candidates: candidateElements,
          iframeClientCount: iframeClientStates.length,
          iframeClients: iframeClientStates,
          mergedToolCount: Array.from(toolClientMap.keys()).length,
          mergedToolNames: Array.from(toolClientMap.keys()).sort(),
          pendingIframeCount: candidates.filter((candidate) => candidate.state === 'connecting')
            .length,
        },
      };
    }

    // Connect to background
    let backgroundPort: chrome.runtime.Port;
    try {
      backgroundPort = chrome.runtime.connect({
        name: 'mcp-content-script-proxy',
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        console.debug('[MCP Proxy] Extension context invalidated; content script will exit');
        return;
      }
      throw error;
    }

    if (
      !safeAddRuntimeMessageListener((message, _sender, sendResponse) => {
        if (isWindowTakeoverContentStateMessage(message)) {
          windowTakeoverRunId = message.payload.active ? message.payload.runId : null;
          sendResponse({ ok: true });
          return undefined;
        }

        if (isWebEditDebugStateRequest(message)) {
          const response: WebEditDebugStateResponse = {
            type: 'webedit-debug-state-result',
            success: true,
            payload: buildWebEditDebugState(),
          };
          sendResponse(response);
          return undefined;
        }

        if (!isPageCaptureRequest(message)) {
          return undefined;
        }

        handlePageCaptureRequest(message)
          .then((result) => {
            sendResponse(result);
          })
          .catch((error) => {
            sendResponse({
              type: 'page-capture-result',
              requestId: message.requestId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });

        return true;
      })
    ) {
      console.debug(
        '[MCP Proxy] Failed to bind runtime message listener; content script will exit'
      );
      return;
    }

    document.addEventListener(
      'click',
      (event) => {
        if (!windowTakeoverRunId) {
          return;
        }
        if (!event.isTrusted || event.defaultPrevented || event.button !== 0) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) {
          return;
        }
        if (anchor.target && anchor.target !== '_self') {
          return;
        }
        if (anchor.hasAttribute('download')) {
          return;
        }

        let destinationUrl: URL;
        try {
          destinationUrl = new URL(anchor.href, window.location.href);
        } catch {
          return;
        }

        if (!/^https?:$/i.test(destinationUrl.protocol)) {
          return;
        }
        if (destinationUrl.href === window.location.href) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        safeRuntimeSendMessage({
          type: 'agent_v2_window_takeover_navigation_attempt',
          payload: {
            url: destinationUrl.href,
            runId: windowTakeoverRunId,
          },
        });
      },
      true
    );

    // Helper: route a tool name to the correct Client (main or iframe)
    function getClientForTool(toolName: string): Client | null {
      const routed = toolClientMap.get(toolName);
      if (routed) return routed;
      // Fall back to main client if no specific mapping
      if (mainClient && isMainConnected) return mainClient;
      return null;
    }

    const teardownBackgroundConnection = () => {
      isBackgroundPortConnected = false;
      if (mainTransport) {
        void mainTransport.close().catch(() => undefined);
      }
      for (const [, entry] of iframeClients) {
        try {
          void entry.transport.close().catch(() => undefined);
        } catch {
          // ignore
        }
      }
      iframeClients.clear();
      toolClientMap.clear();
      mutationObserver?.disconnect();
      if (iframeScanInterval) {
        clearInterval(iframeScanInterval);
        iframeScanInterval = null;
      }
    };

    if (
      !safeAddPortDisconnectListener(backgroundPort, () => {
        const lastErrorMessage = consumeRuntimeLastError();
        if (lastErrorMessage && !isDisconnectedPortError(new Error(lastErrorMessage))) {
          console.warn('[MCP Proxy] Background port disconnected:', lastErrorMessage);
        }
        teardownBackgroundConnection();
      })
    ) {
      console.debug(
        '[MCP Proxy] Failed to bind background port disconnect listener; content script will exit'
      );
      return;
    }

    // Setup message handler for tool execution - ONLY ONCE
    if (
      !safeAddPortMessageListener(backgroundPort, async (message) => {
        if (message.type === 'execute-tool' && message.toolName && message.requestId) {
          const targetClient = getClientForTool(message.toolName);
          if (!targetClient) {
            console.error('[MCP Proxy] No page client available for tool:', message.toolName);
            safePostToBackground(backgroundPort, {
              type: 'tool-result',
              requestId: message.requestId,
              data: {
                success: false,
                payload: `No client available for tool: ${message.toolName}`,
              },
            });
            return;
          }

          const result = await executeToolRequest(targetClient, message);
          safePostToBackground(backgroundPort, result);
        } else if (message.type === 'request-tools-refresh') {
          if (mainClient && isMainConnected) {
            await checkForToolUpdates(mainClient, backgroundPort, updateMainTools);
          }
          for (const [, entry] of iframeClients) {
            if (entry.isConnected) {
              try {
                const updatedTools = await entry.client.listTools();
                const iframeId = (entry.client as { _iframeId?: number })._iframeId;
                if (iframeId) {
                  registerIframeTools(iframeId, entry.client, updatedTools.tools, 'tools-updated');
                }
              } catch (error) {
                console.debug('[MCP Proxy] Failed to refresh iframe tool list:', error);
                const iframeId = (entry.client as { _iframeId?: number })._iframeId;
                if (iframeId) {
                  removeIframeToolMappings(iframeId);
                  iframeToolsByClientId.delete(iframeId);
                  publishMergedTools('tools-updated');
                }
              }
            }
          }
        }
      })
    ) {
      console.debug(
        '[MCP Proxy] Failed to bind background port message listener; content script will exit'
      );
      return;
    }

    // Incrementing ID for iframe client tracking
    let nextIframeClientId = 1;
    let nextIframeCandidateId = 1;

    function removeIframeToolMappings(iframeId: number): void {
      for (const [toolName, client] of toolClientMap) {
        if ((client as { _iframeId?: number })._iframeId === iframeId) {
          toolClientMap.delete(toolName);
        }
      }
    }

    function publishMergedTools(sendType: 'register-tools' | 'tools-updated'): void {
      const mergedTools = new Map<string, { name?: string }>();

      for (const tool of latestMainTools) {
        if (tool.name) {
          mergedTools.set(tool.name, tool);
        }
      }

      for (const tools of iframeToolsByClientId.values()) {
        for (const tool of tools) {
          if (tool.name) {
            mergedTools.set(tool.name, tool);
          }
        }
      }

      safePostToBackground(backgroundPort, {
        type: sendType,
        tools: Array.from(mergedTools.values()),
      });
    }

    function updateMainTools(
      tools: Array<{ name?: string }>,
      sendType: 'register-tools' | 'tools-updated'
    ): void {
      latestMainTools = tools;
      publishMergedTools(sendType);
    }

    function getCandidateCooldownMs(candidate: WebEditIframeCandidate): number {
      return 5000 * 2 ** Math.min(candidate.failureCount, 3);
    }

    function getTrackedIframeId(iframe: HTMLIFrameElement): number | null {
      const trackedId = iframeClientIdsByElement.get(iframe);
      if (!trackedId) {
        return null;
      }

      const entry = iframeClients.get(trackedId);
      if (!entry || !entry.isConnected) {
        iframeClientIdsByElement.delete(iframe);
        return null;
      }

      return trackedId;
    }

    function registerIframeTools(
      iframeId: number,
      iframeClient: Client,
      tools: Array<{ name?: string }>,
      sendType: 'register-tools' | 'tools-updated'
    ): void {
      removeIframeToolMappings(iframeId);

      for (const tool of tools) {
        if (tool.name) {
          toolClientMap.set(tool.name, iframeClient);
        }
      }

      iframeToolsByClientId.set(iframeId, tools);
      publishMergedTools(sendType);
    }

    function getIframeCandidateKey(iframe: HTMLIFrameElement): string {
      const existing = iframeCandidateKeysByElement.get(iframe);
      if (existing) {
        return existing;
      }

      const key = `webedit-iframe-${nextIframeCandidateId++}`;
      iframeCandidateKeysByElement.set(iframe, key);
      return key;
    }

    function getIframeRuntimeSnapshot(
      iframe: HTMLIFrameElement,
      iframeWindow: Window
    ): {
      src: string;
      srcOrigin: string | null;
      runtimeOrigin: string | null;
    } {
      const srcCandidate = iframe.src || iframe.getAttribute('src') || '';
      const srcOrigin = getIframeTargetOrigin(srcCandidate);
      let runtimeOrigin: string | null = null;

      try {
        const runtimeOriginCandidate = iframeWindow.location.origin;
        if (runtimeOriginCandidate && runtimeOriginCandidate !== 'null') {
          runtimeOrigin = runtimeOriginCandidate;
        }
      } catch {
        // Cross-origin iframe without a readable runtime origin.
      }

      return {
        src: srcCandidate,
        srcOrigin,
        runtimeOrigin,
      };
    }

    function pruneDetachedIframeCandidates(): void {
      for (const [candidateKey, iframe] of iframeElementsByCandidateKey) {
        if (iframe.isConnected) {
          continue;
        }

        iframeElementsByCandidateKey.delete(candidateKey);
        iframeCandidateRegistry.delete(candidateKey);
        if (activeIframeCandidateKey === candidateKey) {
          activeIframeCandidateKey = null;
        }
      }
    }

    function registerWebEditIframeCandidate(
      iframe: HTMLIFrameElement
    ): WebEditIframeCandidate | null {
      const iframeWindow = iframe.contentWindow;
      if (!iframeWindow) {
        return null;
      }

      const snapshot = getIframeRuntimeSnapshot(iframe, iframeWindow);
      if (!isWebEditIframeCandidate({ id: iframe.id, src: snapshot.src })) {
        return null;
      }

      const candidateKey = getIframeCandidateKey(iframe);
      const existing = iframeCandidateRegistry.get(candidateKey);
      const shouldDelay = shouldDelayWebEditIframeHandshake({
        srcOrigin: snapshot.srcOrigin,
        runtimeOrigin: snapshot.runtimeOrigin,
      });
      const now = Date.now();
      let state: WebEditIframeCandidate['state'];

      if (
        existing?.state === 'connected' ||
        existing?.state === 'connecting' ||
        existing?.state === 'ready_confirmed' ||
        existing?.state === 'rejected'
      ) {
        state = existing.state;
      } else if (existing?.state === 'cooldown' && existing.retryAt && existing.retryAt > now) {
        state = 'cooldown';
      } else if (shouldDelay) {
        state = 'waiting_ready';
      } else {
        state = 'eligible';
      }

      const candidate: WebEditIframeCandidate = {
        key: candidateKey,
        state,
        priority: rankWebEditIframeCandidate({
          id: iframe.id,
          srcOrigin: snapshot.srcOrigin,
        }),
        failureCount: existing?.failureCount ?? 0,
        retryAt: existing?.retryAt,
        reason: shouldDelay ? 'origin_mismatch' : existing?.reason,
        matchedBy:
          existing?.matchedBy ?? (iframe.id === 'office-iframe' ? 'office-iframe' : 'src-origin'),
        id: iframe.id,
        srcOrigin: snapshot.srcOrigin,
        runtimeOrigin: snapshot.runtimeOrigin,
      };

      iframeElementsByCandidateKey.set(candidateKey, iframe);
      return iframeCandidateRegistry.upsert(candidate);
    }

    function discoverWebEditIframeCandidates(): WebEditIframeCandidate[] {
      pruneDetachedIframeCandidates();
      const iframes = document.querySelectorAll('iframe');
      const discovered: WebEditIframeCandidate[] = [];

      for (const iframe of iframes) {
        try {
          const candidate = registerWebEditIframeCandidate(iframe);
          if (candidate) {
            discovered.push(candidate);
          }
        } catch {
          // Ignore individual iframe registration errors.
        }
      }

      return discovered;
    }

    async function connectIframeMcpServer(
      candidateKey: string,
      targetOrigin: string
    ): Promise<void> {
      const iframe = iframeElementsByCandidateKey.get(candidateKey);
      const candidate = iframeCandidateRegistry.get(candidateKey);
      if (!iframe || !candidate) {
        return;
      }
      if (!iframe.contentWindow) {
        iframeCandidateRegistry.upsert(
          transitionWebEditIframeCandidate(candidate, {
            type: 'fail',
            reason: 'content_window_unavailable',
            now: Date.now(),
            cooldownMs: getCandidateCooldownMs(candidate),
          })
        );
        return;
      }

      const currentSnapshot = getIframeRuntimeSnapshot(iframe, iframe.contentWindow);
      const canConnectToCurrentRuntime = shouldConnectToWebEditIframeTarget({
        targetOrigin,
        runtimeOrigin: currentSnapshot.runtimeOrigin,
      });
      if (!canConnectToCurrentRuntime) {
        iframeCandidateRegistry.upsert(
          transitionWebEditIframeCandidate(
            {
              ...candidate,
              runtimeOrigin: currentSnapshot.runtimeOrigin,
            },
            {
              type: 'promote',
              state: 'waiting_ready',
              reason: 'origin_mismatch',
              matchedBy: candidate.matchedBy,
            }
          )
        );
        return;
      }

      if (activeIframeCandidateKey && activeIframeCandidateKey !== candidateKey) {
        return;
      }

      if (pendingIframeConnections.has(iframe)) {
        return;
      }

      if (getTrackedIframeId(iframe)) {
        return;
      }

      pendingIframeConnections.add(iframe);
      iframeCandidateRegistry.upsert(
        transitionWebEditIframeCandidate(candidate, {
          type: 'promote',
          state: 'connecting',
          matchedBy: candidate.matchedBy,
        })
      );

      const iframeClient = new Client({
        name: 'ExtensionIframeProxyClient',
        version: '1.0.0',
      });

      const iframeId = nextIframeClientId++;
      (iframeClient as { _iframeId?: number })._iframeId = iframeId;

      const iframeTransport = new IframeParentTransport({
        iframe,
        targetOrigin,
        channelId: 'mcp-iframe',
      });

      iframeTransport.onclose = () => {
        console.log(`[MCP Proxy] Iframe transport closed (id=${iframeId}), clearing tools`);
        iframeClients.delete(iframeId);
        iframeToolsByClientId.delete(iframeId);
        if (iframeClientIdsByElement.get(iframe) === iframeId) {
          iframeClientIdsByElement.delete(iframe);
        }
        removeIframeToolMappings(iframeId);
        if (activeIframeCandidateKey === candidateKey) {
          activeIframeCandidateKey = null;
        }
        const disconnectedCandidate = iframeCandidateRegistry.get(candidateKey);
        if (disconnectedCandidate) {
          if (
            disconnectedCandidate.state !== 'cooldown' &&
            disconnectedCandidate.state !== 'rejected'
          ) {
            iframeCandidateRegistry.upsert(
              transitionWebEditIframeCandidate(disconnectedCandidate, {
                type: 'promote',
                state: 'eligible',
                reason: 'transport_closed',
                matchedBy: disconnectedCandidate.matchedBy,
              })
            );
          }
        }
        if (isBackgroundPortConnected) {
          publishMergedTools('tools-updated');
        }
      };

      try {
        await iframeClient.connect(iframeTransport);
        const entry: IframeClientEntry = {
          client: iframeClient,
          transport: iframeTransport,
          iframe,
          isConnected: true,
          targetOrigin,
          candidateKey,
        };
        iframeClients.set(iframeId, entry);
        iframeClientIdsByElement.set(iframe, iframeId);
        activeIframeCandidateKey = candidateKey;
        const connectedCandidate = iframeCandidateRegistry.get(candidateKey);
        if (connectedCandidate) {
          iframeCandidateRegistry.upsert(
            transitionWebEditIframeCandidate(connectedCandidate, {
              type: 'promote',
              state: 'connected',
              matchedBy: connectedCandidate.matchedBy,
            })
          );
        }

        const capabilities = await iframeClient.getServerCapabilities();
        const tools = await iframeClient.listTools();
        console.log(
          `[MCP Proxy] Iframe MCP server (id=${iframeId}, origin=${targetOrigin}) has ${tools.tools.length} tools:`,
          tools.tools.map((tool: { name?: string }) => tool.name)
        );

        registerIframeTools(iframeId, iframeClient, tools.tools, 'register-tools');

        if (capabilities?.tools?.listChanged) {
          iframeClient.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            console.log(
              `[MCP Proxy] Received tool list change notification from iframe MCP server (id=${iframeId})`
            );
            const updatedTools = await iframeClient.listTools();
            registerIframeTools(iframeId, iframeClient, updatedTools.tools, 'tools-updated');
          });
        }

        console.log(
          `[MCP Proxy] Registered ${tools.tools.length} iframe tools with background (id=${iframeId})`
        );
      } catch (error) {
        console.debug(
          `[MCP Proxy] Failed to connect to iframe MCP server (id=${iframeId}, origin=${targetOrigin}):`,
          error
        );
        const failedCandidate = iframeCandidateRegistry.get(candidateKey);
        if (failedCandidate) {
          iframeCandidateRegistry.upsert(
            transitionWebEditIframeCandidate(failedCandidate, {
              type: 'fail',
              reason: 'transport_connect_failed',
              now: Date.now(),
              cooldownMs: getCandidateCooldownMs(failedCandidate),
            })
          );
        }
        await iframeTransport.close().catch(() => undefined);
      } finally {
        pendingIframeConnections.delete(iframe);
      }
    }

    function getReadyMatchedIframeCandidate(event: MessageEvent): {
      candidate: WebEditIframeCandidate;
      targetOrigin: string;
    } | null {
      const candidates = iframeCandidateRegistry.list();
      let sourceOnlyCandidate: WebEditIframeCandidate | null = null;

      for (const candidate of candidates) {
        const iframe = iframeElementsByCandidateKey.get(candidate.key);
        if (!iframe?.contentWindow) {
          continue;
        }

        const readyMatch = matchWebEditIframeReadyEvent(event, {
          sourceWindow: iframe.contentWindow,
          origin: candidate.runtimeOrigin ?? candidate.srcOrigin ?? null,
          id: candidate.id,
          srcOrigin: candidate.srcOrigin ?? null,
        });

        if (readyMatch.matched) {
          return {
            candidate,
            targetOrigin: event.origin,
          };
        }

        if (readyMatch.matchedBy === 'source-only' && !sourceOnlyCandidate) {
          sourceOnlyCandidate = candidate;
        }
      }

      if (sourceOnlyCandidate) {
        iframeCandidateRegistry.upsert(
          transitionWebEditIframeCandidate(sourceOnlyCandidate, {
            type: 'promote',
            state: 'waiting_ready',
            reason: 'origin_mismatch',
            matchedBy: sourceOnlyCandidate.matchedBy,
          })
        );
      }

      return null;
    }

    async function attemptFallbackIframeConnection(reason: string): Promise<void> {
      if (activeIframeCandidateKey) {
        return;
      }

      const candidates = iframeCandidateRegistry
        .list()
        .filter((candidate) => candidate.priority >= 80);
      const primary = iframeCandidateRegistry.selectPrimary();
      if (!primary || !primary.srcOrigin) {
        return;
      }

      if (primary.state === 'waiting_ready') {
        return;
      }

      if (candidates.length !== 1) {
        return;
      }

      iframeCandidateRegistry.upsert(
        transitionWebEditIframeCandidate(primary, {
          type: 'promote',
          state: primary.state === 'connected' ? 'connected' : 'eligible',
          reason: 'ready_not_received',
          matchedBy: primary.matchedBy,
        })
      );
      console.log(
        `[MCP Proxy] Attempting fallback iframe MCP connection (${reason}) for ${primary.key}`
      );
      await connectIframeMcpServer(primary.key, primary.srcOrigin);
    }

    // Function to attempt connection to MCP server
    async function attemptConnection(): Promise<void> {
      if (isMainConnected) {
        console.log('[MCP Proxy] Already connected, skipping connection attempt');
        return;
      }

      const hasPageServer = await waitForMcpServerReady();
      if (!hasPageServer) {
        console.log('[MCP Proxy] No page MCP server detected, skipping page-tool connection');
        updateMainTools([], 'tools-updated');
        return;
      }

      // Create new client and transport for each connection attempt
      mainClient = new Client({
        name: 'ExtensionProxyClient',
        version: '1.0.0',
      });

      mainTransport = new TabClientTransport({
        targetOrigin: getWindowPostMessageTargetOrigin(window.location),
      });

      // Handle transport closure (including server-stopped events)
      mainTransport.onclose = () => {
        console.log('[MCP Proxy] Transport closed, clearing tools');
        latestMainTools = [];
        if (isBackgroundPortConnected) {
          publishMergedTools('tools-updated');
        }
        // cachedToolHashes.clear();
        isMainConnected = false;
        mainClient = null;
        mainTransport = null;
      };

      try {
        await mainClient.connect(mainTransport);
        isMainConnected = true;

        console.log('[MCP Proxy] Client connected to transport');

        // Get server capabilities to verify connection
        const capabilities = await mainClient.getServerCapabilities();
        console.log('[MCP Proxy] Server capabilities:', capabilities);

        const tools = await mainClient.listTools();
        console.log('first tools', tools);
        console.log('[MCP Proxy] Tools:', tools);

        // backgroundPort.postMessage({
        //   type: 'register-tools',
        //   tools: tools.tools,
        // });

        // Register tools with background (initial check and send)
        await checkForToolUpdates(mainClient, backgroundPort, updateMainTools, 'register-tools');

        // Listen for tool list change notifications from the server
        if (capabilities?.tools?.listChanged) {
          console.log('[MCP Proxy] Server supports tool list change notifications');

          // Set up notification handler for tool list changes
          mainClient.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            console.log('[MCP Proxy] Received tool list change notification from server');
            if (mainClient) {
              await checkForToolUpdates(mainClient, backgroundPort, updateMainTools);
            }
          });
        } else {
          console.log('[MCP Proxy] Server does not support tool list change notifications');

          // Fallback: periodically check for tool updates every 30 seconds
          // setInterval(async () => {
          //   if (mainClient && isMainConnected) {
          //     await checkForToolUpdates(mainClient!, backgroundPort);
          //   }
          // }, 30000);
        }

        console.log('[MCP Proxy] Successfully connected to page server');
      } catch (error) {
        console.debug('[MCP Proxy] Page MCP server connection failed:', error);
        await mainTransport?.close().catch(() => undefined);
        isMainConnected = false;
        mainClient = null;
        mainTransport = null;
      }
    }

    async function rescanAndReconnect(
      reason: string,
      options?: {
        attemptMain?: boolean;
        allowIframeFallback?: boolean;
      }
    ): Promise<void> {
      console.log(`[MCP Proxy] Rescanning MCP servers due to ${reason}`);

      if (options?.attemptMain !== false) {
        await attemptConnection();
      }

      discoverWebEditIframeCandidates();

      if (options?.allowIframeFallback !== false) {
        await attemptFallbackIframeConnection(reason);
      }
    }

    // Listen for MCP server ready events, including servers that start after page load.
    window.addEventListener('message', (event) => {
      if (
        isCurrentPageMessageEventOrigin(window.location, event.origin) &&
        event.data?.channel === 'mcp-default' &&
        event.data?.type === 'mcp' &&
        event.data?.direction === 'server-to-client' &&
        event.data?.payload === 'mcp-server-ready'
      ) {
        console.log('[MCP Proxy] Detected page MCP server ready, rescanning page and iframes');
        rescanAndReconnect('page mcp-server-ready').catch((error) => {
          console.debug('[MCP Proxy] Failed to reconnect after page server ready:', error);
        });
      }

      // Also listen for iframe MCP server ready events on mcp-iframe channel
      if (
        event.data?.channel === 'mcp-iframe' &&
        event.data?.type === 'mcp' &&
        event.data?.direction === 'server-to-client' &&
        event.data?.payload === 'mcp-server-ready'
      ) {
        discoverWebEditIframeCandidates();
        const readyMatch = getReadyMatchedIframeCandidate(event);
        if (!readyMatch) {
          console.debug(
            `[MCP Proxy] Ignoring iframe ready event without exact source+origin match (origin=${event.origin})`
          );
          return;
        }

        iframeCandidateRegistry.upsert(
          transitionWebEditIframeCandidate(readyMatch.candidate, {
            type: 'promote',
            state: 'ready_confirmed',
            matchedBy: 'ready-event',
            reason: 'mcp-server-ready',
          })
        );

        connectIframeMcpServer(readyMatch.candidate.key, readyMatch.targetOrigin).catch((error) => {
          console.debug('[MCP Proxy] Failed to connect after iframe server ready:', error);
        });
      }
    });

    // Initial connection attempt
    try {
      await attemptConnection();
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) {
        throw error;
      }
      console.debug(
        '[MCP Proxy] Extension context invalidated during startup; content script will exit'
      );
      return;
    }

    discoverWebEditIframeCandidates();
    attemptFallbackIframeConnection('initial scan').catch((error) => {
      console.debug('[MCP Proxy] Failed to connect fallback iframe candidate:', error);
    });

    // Watch for dynamically added iframes (e.g., WPS editor loads in a late-added iframe)
    mutationObserver = new MutationObserver((mutations) => {
      let hasNewIframe = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'IFRAME') {
            hasNewIframe = true;
            break;
          }
          // Also check descendants of added subtrees
          if (node instanceof HTMLElement && node.querySelectorAll) {
            const nested = node.querySelectorAll('iframe');
            if (nested.length > 0) {
              hasNewIframe = true;
              break;
            }
          }
        }
        if (hasNewIframe) break;
      }
      if (hasNewIframe) {
        console.log('[MCP Proxy] MutationObserver detected new iframe, refreshing candidates...');
        discoverWebEditIframeCandidates();
      }
    });
    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    console.log('[MCP Proxy] MutationObserver installed for dynamic iframe detection');

    // Periodic iframe re-scan as a fallback (every 5 seconds)
    iframeScanInterval = setInterval(() => {
      discoverWebEditIframeCandidates();
      attemptFallbackIframeConnection('periodic fallback').catch(() => {
        // silent
      });
    }, 5000);
  },
});
