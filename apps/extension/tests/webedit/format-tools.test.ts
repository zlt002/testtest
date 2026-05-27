// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = '/Users/zhanglt21/Desktop/accrnew/WebMCP';

function createWebEditTestWindow() {
  const windowLike: Record<string, any> = {
    console,
    setTimeout,
    clearTimeout,
  };

  windowLike.window = windowLike;
  windowLike.global = windowLike;
  windowLike.location = {
    href: 'https://webedit.midea.com/sheet?id=test-doc',
  };
  windowLike.document = {
    title: 'test-doc',
    readyState: 'complete',
    activeElement: null,
    getElementById: () => null,
  };

  return windowLike;
}

async function loadWebEditScript(win: Record<string, any>, relativePath: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  const code = await readFile(absolutePath, 'utf8');
  const context = vm.createContext(win);
  vm.runInContext(code, context, { filename: absolutePath });
}

function parseToolResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('webedit format tools', () => {
  it('registers webedit_set_alignment and webedit_set_border', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/format.js');

    const registered: string[] = [];
    win.__webeditFormatTools.registerFormatTools(
      (name: string) => {
        registered.push(name);
      },
      {
        adapter: {},
        helpers: win.__webeditResultHelpers,
        errorCodes: {},
      },
    );

    expect(registered).toContain('webedit_set_alignment');
    expect(registered).toContain('webedit_set_border');
  });

  it('returns a structured success payload for webedit_set_alignment', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/format.js');

    const tools = new Map<string, Function>();
    win.__webeditFormatTools.registerFormatTools(
      (name: string, _description: string, _schema: unknown, handler: Function) => {
        tools.set(name, handler);
      },
      {
        adapter: {
          async getEditorApplication() {
            return {};
          },
          async getRangeByAddress() {
            return { tag: 'range' };
          },
          async summarizeRange() {
            return { address: 'B8:J14', text: 'before' };
          },
          async setRangeAlignment() {
            return 'range-alignment-properties';
          },
        },
        helpers: win.__webeditResultHelpers,
        errorCodes: {
          RANGE_NOT_FOUND: 'range_not_found',
          WRITE_NOT_SUPPORTED: 'write_not_supported',
        },
      },
    );

    const result = await tools.get('webedit_set_alignment')?.({
      range: 'B8:J14',
      horizontal: 'center',
      wrapText: true,
    });
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.operation).toBe('webedit_set_alignment');
    expect(payload.target).toEqual({ range: 'B8:J14' });
    expect(payload.data).toMatchObject({
      range: 'B8:J14',
      horizontal: 'center',
      wrapText: true,
      writeStrategy: 'range-alignment-properties',
    });
  });

  it('returns a structured success payload for webedit_set_border', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
    await loadWebEditScript(win, 'apps/extension/public/webedit/tools/format.js');

    const tools = new Map<string, Function>();
    win.__webeditFormatTools.registerFormatTools(
      (name: string, _description: string, _schema: unknown, handler: Function) => {
        tools.set(name, handler);
      },
      {
        adapter: {
          async getEditorApplication() {
            return {};
          },
          async getRangeByAddress() {
            return { tag: 'range' };
          },
          async summarizeRange() {
            return { address: 'B8:J14' };
          },
          async setRangeBorder() {
            return 'Range.Borders';
          },
        },
        helpers: win.__webeditResultHelpers,
        errorCodes: {
          RANGE_NOT_FOUND: 'range_not_found',
          WRITE_NOT_SUPPORTED: 'write_not_supported',
        },
      },
    );

    const result = await tools.get('webedit_set_border')?.({
      range: 'B8:J14',
      preset: 'all',
      color: '#d9d9d9',
      style: 'solid',
      weight: 'thin',
    });
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.operation).toBe('webedit_set_border');
    expect(payload.target).toEqual({ range: 'B8:J14' });
    expect(payload.data).toMatchObject({
      range: 'B8:J14',
      appliedPreset: 'all',
      writeStrategy: 'Range.Borders',
    });
    expect(payload.data.appliedEdges).toEqual({
      top: true,
      bottom: true,
      left: true,
      right: true,
      insideHorizontal: true,
      insideVertical: true,
    });
  });
});
