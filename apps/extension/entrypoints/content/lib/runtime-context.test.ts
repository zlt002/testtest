// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  consumeRuntimeLastError,
  isDisconnectedPortError,
  isExtensionContextInvalidated,
  safeAddPortDisconnectListener,
  safeAddPortMessageListener,
} from './runtime-context';

describe('runtime-context helpers', () => {
  it('识别 extension context invalidated 错误', () => {
    expect(
      isExtensionContextInvalidated(
        new Error("Failed to read the 'onDisconnect' property from 'Object': Extension context invalidated.")
      )
    ).toBe(true);
    expect(isExtensionContextInvalidated(new Error('other error'))).toBe(false);
  });

  it('识别 port 断开错误', () => {
    expect(isDisconnectedPortError(new Error('The message port closed before a response was received.'))).toBe(true);
    expect(isDisconnectedPortError(new Error('disconnected port object'))).toBe(true);
    expect(
      isDisconnectedPortError(
        new Error(
          'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.'
        )
      )
    ).toBe(true);
    expect(isDisconnectedPortError(new Error('random error'))).toBe(false);
  });

  it('读取并返回 runtime.lastError 文案，避免未消费断开错误', () => {
    const runtime = {
      lastError: {
        message:
          'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
      },
    } as typeof chrome.runtime;

    expect(consumeRuntimeLastError(runtime)).toBe(
      'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.'
    );
  });

  it('在 port.onDisconnect 访问失效时安全返回 false，而不是抛错', () => {
    const port = {};
    Object.defineProperty(port, 'onDisconnect', {
      get() {
        throw new Error(
          "Failed to read the 'onDisconnect' property from 'Object': Extension context invalidated."
        );
      },
    });

    expect(() =>
      safeAddPortDisconnectListener(port as chrome.runtime.Port, () => undefined)
    ).not.toThrow();
    expect(
      safeAddPortDisconnectListener(port as chrome.runtime.Port, () => undefined)
    ).toBe(false);
  });

  it('正常注册 port.onMessage 监听器', () => {
    const addListener = vi.fn();
    const port = {
      onMessage: {
        addListener,
      },
    } as unknown as chrome.runtime.Port;

    const handler = vi.fn();
    expect(safeAddPortMessageListener(port, handler)).toBe(true);
    expect(addListener).toHaveBeenCalledWith(handler);
  });

  it('在 port.onMessage 访问失效时安全返回 false，而不是抛错', () => {
    const port = {};
    Object.defineProperty(port, 'onMessage', {
      get() {
        throw new Error(
          "Failed to read the 'onMessage' property from 'Object': Extension context invalidated."
        );
      },
    });

    expect(() =>
      safeAddPortMessageListener(port as chrome.runtime.Port, () => undefined)
    ).not.toThrow();
    expect(
      safeAddPortMessageListener(port as chrome.runtime.Port, () => undefined)
    ).toBe(false);
  });
});
