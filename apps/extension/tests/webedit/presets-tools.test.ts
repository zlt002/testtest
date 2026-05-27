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

describe('webedit preset tools', () => {
  it('registers webedit_apply_table_style', async () => {
    const win = createWebEditTestWindow();
    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/presets.js');

    const names: string[] = [];
    win.__webeditPresetTools.registerPresetTools({
      adapter: {},
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(name: string) {
        names.push(name);
      },
    });

    expect(names).toContain('webedit_apply_table_style');
  });

  it('executes steps for webedit_apply_table_style', async () => {
    const win = createWebEditTestWindow();
    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/presets.js');

    const tools = new Map<string, Function>();
    const calls: Array<{ type: string; value: unknown }> = [];
    win.__webeditPresetTools.registerPresetTools({
      adapter: {
        async getEditorApplication() {
          return { kind: 'app' };
        },
        async getRangeByAddress(_app: unknown, range: string) {
          return { address: range };
        },
        async summarizeRange(range: { address: string }) {
          return { address: range.address };
        },
        async setRangeFont(_range: unknown, args: Record<string, unknown>) {
          calls.push({ type: 'font', value: args });
          return true;
        },
        async setRangeFill(_range: unknown, color: string) {
          calls.push({ type: 'fill', value: color });
          return true;
        },
        async setRangeAlignment(_range: unknown, args: Record<string, unknown>) {
          calls.push({ type: 'alignment', value: args });
          return 'range-alignment-properties';
        },
        async setRangeBorder(_range: unknown, args: Record<string, unknown>) {
          calls.push({ type: 'border', value: args });
          return 'Range.Borders';
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(name: string, _description: string, _schema: unknown, handler: Function) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_apply_table_style')?.({ range: 'B8:J14' });

    expect(result.content[0].text).toContain('"ok": true');
    expect(result.content[0].text).toContain('"theme": "blue"');
    expect(result.content[0].text).toContain('"overallStatus": "success"');
    expect(result.content[0].text).toContain('"steps"');
    expect(result.content[0].text).toContain('"writeStrategy": "Range.Borders"');
    expect(calls.map((item) => item.type)).toEqual(['font', 'fill', 'alignment', 'border']);
    expect(calls.find((item) => item.type === 'border')?.value).toMatchObject({
      preset: 'outer',
      style: 'solid',
      color: '#D9D9D9',
    });
  });
});
