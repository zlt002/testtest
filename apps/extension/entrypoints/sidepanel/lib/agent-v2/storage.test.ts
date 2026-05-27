// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { persistToolEvents, readToolEvents } from './storage';
import type { ToolDisplayRecord } from './types';

function tool(overrides: Partial<ToolDisplayRecord> = {}): ToolDisplayRecord {
  return {
    id: overrides.id || crypto.randomUUID(),
    toolName: overrides.toolName || 'Write',
    status: overrides.status || 'done',
    preview: overrides.preview || '工具已完成',
    input: overrides.input,
    result: overrides.result,
  };
}

describe('tool event storage', () => {
  it('trims oversized tool payloads before persisting', () => {
    const store = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => {
      if (value.length > 50_000) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      store.set(key, value);
    });

    persistToolEvents(
      'conversation-large',
      [
        tool({
          id: 'large-write',
          input: { filePath: '/tmp/huge.md', content: 'x'.repeat(200_000) },
          result: { content: 'y'.repeat(200_000) },
        }),
      ],
      {
        storage: {
          getItem: (key) => store.get(key) ?? null,
          setItem,
          removeItem: (key) => {
            store.delete(key);
          },
        },
      }
    );

    const payload = readToolEvents('conversation-large', {
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem,
        removeItem: (key) => {
          store.delete(key);
        },
      },
    });

    expect(payload?.tools).toHaveLength(1);
    expect(JSON.stringify(payload).length).toBeLessThan(50_000);
    expect(JSON.stringify(payload?.tools[0].input)).toContain('truncated');
    expect(JSON.stringify(payload?.tools[0].result)).toContain('truncated');
  });

  it('does not throw if storage quota is still exceeded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: vi.fn(),
    };

    expect(() =>
      persistToolEvents('conversation-full', [tool({ result: 'x'.repeat(10_000) })], { storage })
    ).not.toThrow();
    expect(storage.removeItem).toHaveBeenCalled();
    warn.mockRestore();
  });
});
