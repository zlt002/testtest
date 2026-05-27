// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function createWindowLike() {
  const win = {
    console,
  } as Record<string, unknown>;

  win.window = win;
  return win;
}

async function loadBrowserScript(relativePath: string, win: Record<string, unknown>) {
  const filePath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../public/webedit/tools',
    relativePath
  );
  const code = await readFile(filePath, 'utf8');
  vm.runInNewContext(code, win, { filename: filePath });
}

function createHelpers() {
  return {
    ok(operation: string, target: Record<string, unknown>, data: Record<string, unknown>) {
      return {
        ok: true,
        operation,
        target,
        data,
      };
    },
    fail(operation: string, target: Record<string, unknown>, code: string, message: string) {
      return {
        ok: false,
        operation,
        target,
        error: {
          code,
          message,
        },
      };
    },
    toToolResult(payload: Record<string, unknown>) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  };
}

describe('webedit search tools', () => {
  it('注册 webedit_find_text 并返回基础查找结构', async () => {
    const win = createWindowLike();
    await loadBrowserScript('search.js', win);

    const registeredTools: Array<{ name: string; handler: (args: any) => Promise<any> }> = [];
    const adapter = {
      async getEditorApplication() {
        return { name: 'mock-app' };
      },
      async findText(_app: unknown, query: string, options: Record<string, unknown>) {
        return [
          {
            cell: 'B11',
            row: 11,
            column: 2,
            text: query,
            searchRange: options.range || null,
          },
        ];
      },
    };

    (win.__webeditSearchTools as { registerSearchTools: Function }).registerSearchTools(
      (name: string, _description: string, _schema: unknown, handler: (args: any) => Promise<any>) => {
        registeredTools.push({ name, handler });
      },
      {
        adapter,
        helpers: createHelpers(),
        errorCodes: {},
      }
    );

    expect(registeredTools.map((tool) => tool.name)).toContain('webedit_find_text');

    const tool = registeredTools.find((item) => item.name === 'webedit_find_text');
    const result = await tool?.handler({ query: 'T-003', range: 'B8:J14', returnAll: true });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(payload.operation).toBe('webedit_find_text');
    expect(payload.data).toMatchObject({
      query: 'T-003',
      searchRange: 'B8:J14',
      matchCount: 1,
    });
    expect(payload.data.matches).toEqual([
      {
        cell: 'B11',
        row: 11,
        column: 2,
        text: 'T-003',
        searchRange: 'B8:J14',
      },
    ]);
  });
});
