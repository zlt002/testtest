// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeBroadcastChannel {
  static listeners = new Map<string, Set<(event: MessageEvent<unknown>) => void>>();

  name: string;

  constructor(name: string) {
    this.name = name;
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    const bucket = FakeBroadcastChannel.listeners.get(this.name) ?? new Set();
    bucket.add(listener);
    FakeBroadcastChannel.listeners.set(this.name, bucket);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    FakeBroadcastChannel.listeners.get(this.name)?.delete(listener);
  }

  postMessage(data: unknown) {
    for (const listener of FakeBroadcastChannel.listeners.get(this.name) ?? []) {
      listener({ data } as MessageEvent<unknown>);
    }
  }

  close() {}

  static reset() {
    FakeBroadcastChannel.listeners.clear();
  }
}

describe('model-access-events', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeBroadcastChannel.reset();
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://example.com',
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes once to the current context even when BroadcastChannel echoes locally', async () => {
    const { publishModelAccessChanged, subscribeModelAccessChanged } = await import(
      './model-access-events'
    );
    const listener = vi.fn();
    const unsubscribe = subscribeModelAccessChanged(listener);

    publishModelAccessChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
