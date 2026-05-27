export function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Extension context invalidated');
}

export function isDisconnectedPortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('disconnected port') ||
    message.includes('message port closed') ||
    message.includes('message channel is closed')
  );
}

export function consumeRuntimeLastError(runtime = chrome?.runtime): string | null {
  try {
    return runtime?.lastError?.message ?? null;
  } catch {
    return null;
  }
}

export function hasRuntimeContext(runtime = chrome?.runtime): boolean {
  try {
    return Boolean(runtime?.id);
  } catch {
    return false;
  }
}

export function safePostToBackground(port: chrome.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error) && !isDisconnectedPortError(error)) {
      console.warn('[MCP Proxy] Failed to post message to background:', error);
    }
    return false;
  }
}

export function safeAddPortMessageListener(
  port: chrome.runtime.Port,
  listener: Parameters<chrome.runtime.Port['onMessage']['addListener']>[0]
): boolean {
  try {
    port.onMessage.addListener(listener);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error) && !isDisconnectedPortError(error)) {
      console.warn('[MCP Proxy] Failed to add background port message listener:', error);
    }
    return false;
  }
}

export function safeAddPortDisconnectListener(
  port: chrome.runtime.Port,
  listener: Parameters<chrome.runtime.Port['onDisconnect']['addListener']>[0]
): boolean {
  try {
    port.onDisconnect.addListener(listener);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error) && !isDisconnectedPortError(error)) {
      console.warn('[MCP Proxy] Failed to add background port disconnect listener:', error);
    }
    return false;
  }
}

export function safeAddRuntimeMessageListener(
  listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0]
): boolean {
  try {
    chrome.runtime.onMessage.addListener(listener);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      console.warn('[MCP Proxy] Failed to add runtime message listener:', error);
    }
    return false;
  }
}

export function safeRuntimeSendMessage(message: unknown): boolean {
  try {
    chrome.runtime.sendMessage(message);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      console.warn('[MCP Proxy] Failed to send runtime message:', error);
    }
    return false;
  }
}
