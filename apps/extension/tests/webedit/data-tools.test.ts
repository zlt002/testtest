// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

function createWebEditTestWindow() {
  const windowLike: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
  };

  windowLike.window = windowLike;
  windowLike.global = windowLike;
  windowLike.document = {
    title: 'test-doc',
    readyState: 'complete',
    activeElement: null,
    getElementById: () => null,
  };
  windowLike.location = {
    href: 'https://webedit.midea.com/test',
    origin: 'https://webedit.midea.com',
    pathname: '/test',
    search: '',
  };

  return windowLike as Record<string, any>;
}

async function loadWebEditScript(win: Record<string, any>, relativePath: string) {
  const absolutePath = path.join('/Users/zhanglt21/Desktop/accrnew/WebMCP', relativePath);
  const code = await readFile(absolutePath, 'utf8');
  const context = vm.createContext(win);
  vm.runInContext(code, context, { filename: absolutePath });
}

describe('webedit data tools', () => {
  it('registers webedit_sort_range', async () => {
    const win = createWebEditTestWindow();
    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/data.js');

    const names: string[] = [];
    win.__webeditDataTools.registerDataTools({
      adapter: {},
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(name: string) {
        names.push(name);
      },
    });

    expect(names).toContain('webedit_sort_range');
  });

  it('returns a minimal success payload for webedit_sort_range', async () => {
    const win = createWebEditTestWindow();
    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/data.js');

    const tools = new Map<string, Function>();
    const range = { address: 'A2:C10' };
    win.__webeditDataTools.registerDataTools({
      adapter: {
        async getEditorApplication() {
          return { kind: 'app' };
        },
        async getRangeByAddress() {
          return range;
        },
        async summarizeRange(target: unknown) {
          return {
            address: (target as { address?: string }).address || 'A2:C10',
          };
        },
        async sortRange(_target: unknown, args: { sorts: Array<{ key: string; order: string }> }) {
          return {
            writeStrategy: 'Sort.Apply',
            header: true,
            sortsCount: args.sorts.length,
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {
        RANGE_NOT_FOUND: 'RANGE_NOT_FOUND',
        WRITE_NOT_SUPPORTED: 'WRITE_NOT_SUPPORTED',
      },
      registerTool(name: string, _description: string, _schema: unknown, handler: Function) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_sort_range')?.({
      range: 'A2:C10',
      sorts: [{ key: 'B', order: 'asc' }],
    });

    expect(result.content[0].text).toContain('"ok": true');
    expect(result.content[0].text).toContain('"range": "A2:C10"');
    expect(result.content[0].text).toContain('"writeStrategy": "Sort.Apply"');
    expect(result.content[0].text).toContain('"header": true');
  });
});
