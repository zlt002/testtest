import { QueryClient } from '@tanstack/react-query';
import { createTRPCReact } from '@trpc/react-query';
import type { BGSWRouterType } from '@/entrypoints/background/src/routers';
import { createBaseLink } from '@/entrypoints/background/trpc-browser/link/internal/base';
import { autoConnect } from '@/entrypoints/background/trpc-browser/shared/chrome';
import type { TRPCChromeMessage } from '@/entrypoints/background/trpc-browser/types';

type TRPCReactInstance = ReturnType<typeof createTRPCReact<BGSWRouterType>>;
export const trpc: TRPCReactInstance = createTRPCReact<BGSWRouterType>();

let currentPort: chrome.runtime.Port | null = null;
const messageListeners = new Set<(message: TRPCChromeMessage) => void>();
const closeListeners = new Set<() => void>();
const pendingMessages: TRPCChromeMessage[] = [];

function isNoServiceWorkerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No SW');
}

function flushPendingMessages(port: chrome.runtime.Port) {
  if (pendingMessages.length === 0) {
    return;
  }

  const queuedMessages = pendingMessages.splice(0, pendingMessages.length);
  for (const message of queuedMessages) {
    port.postMessage(message);
  }
}

function attachPort(port: chrome.runtime.Port) {
  currentPort = port;

  for (const listener of messageListeners) {
    port.onMessage.addListener(listener);
  }

  for (const listener of closeListeners) {
    port.onDisconnect.addListener(listener);
  }

  flushPendingMessages(port);

  return () => {
    for (const listener of messageListeners) {
      port.onMessage.removeListener(listener);
    }

    for (const listener of closeListeners) {
      port.onDisconnect.removeListener(listener);
    }

    if (currentPort === port) {
      currentPort = null;
    }
  };
}

function startPortConnection() {
  void autoConnect(
    () => chrome.runtime.connect({ name: 'BGSW' }),
    (port) => attachPort(port)
  ).catch((error) => {
    if (!isNoServiceWorkerError(error)) {
      console.warn('[sidepanel] Failed to connect to background port:', error);
    }

    setTimeout(() => {
      startPortConnection();
    }, 1000);
  });
}

startPortConnection();

/**
 * React Query client instance for managing server state and caching
 * Handles data fetching, caching, and synchronization
 */
export const queryClient = new QueryClient();

/**
 * Configured tRPC client instance with Chrome message port transport
 * Uses chromeLink to enable communication through Chrome runtime messaging
 */
export const trpcClient = trpc.createClient({
  links: [
    createBaseLink({
      postMessage(message) {
        if (!currentPort) {
          pendingMessages.push(message);
          console.warn('[sidepanel] Background service worker unavailable, queueing message');
          return;
        }
        currentPort.postMessage(message);
      },
      addMessageListener(listener) {
        messageListeners.add(listener);
        if (currentPort) {
          currentPort.onMessage.addListener(listener);
        }
      },
      removeMessageListener(listener) {
        messageListeners.delete(listener);
        if (currentPort) {
          currentPort.onMessage.removeListener(listener);
        }
      },
      addCloseListener(listener) {
        closeListeners.add(listener);
        if (currentPort) {
          currentPort.onDisconnect.addListener(listener);
        }
      },
      removeCloseListener(listener) {
        closeListeners.delete(listener);
        if (currentPort) {
          currentPort.onDisconnect.removeListener(listener);
        }
      },
    }),
  ],
});
