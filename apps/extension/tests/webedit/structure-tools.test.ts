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

async function loadStructureScript(win: Record<string, unknown>) {
  const filePath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../public/webedit/tools/structure.js'
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

describe('webedit structure tools', () => {
  it('注册 webedit_insert_rows 并返回基础结构结果', async () => {
    const win = createWindowLike();
    await loadStructureScript(win);

    const range = { address: '9:9' };
    const registeredTools: Array<{ name: string; handler: (args: any) => Promise<any> }> = [];
    const adapter = {
      async getEditorApplication() {
        return { name: 'mock-app' };
      },
      async getRangeByAddress() {
        return range;
      },
      async summarizeRange(target: { address: string }) {
        return { address: target.address };
      },
      async insertRows(_range: unknown, count: number, position: string, options: Record<string, unknown>) {
        return {
          writeStrategy: 'stub-insert-rows',
          count,
          position,
          copyFormatFrom: options.copyFormatFrom || 'none',
        };
      },
    };

    (win.__webeditStructureTools as { registerStructureTools: Function }).registerStructureTools(
      (name: string, _description: string, _schema: unknown, handler: (args: any) => Promise<any>) => {
        registeredTools.push({ name, handler });
      },
      {
        adapter,
        helpers: createHelpers(),
        errorCodes: {
          RANGE_NOT_FOUND: 'range_not_found',
          WRITE_NOT_SUPPORTED: 'write_not_supported',
        },
      }
    );

    expect(registeredTools.map((tool) => tool.name)).toContain('webedit_insert_rows');

    const tool = registeredTools.find((item) => item.name === 'webedit_insert_rows');
    const result = await tool?.handler({
      range: '9:9',
      count: 2,
      position: 'after',
      copyFormatFrom: 'above',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(payload.operation).toBe('webedit_insert_rows');
    expect(payload.data).toMatchObject({
      range: '9:9',
      count: 2,
      position: 'after',
      copyFormatFrom: 'above',
      writeStrategy: 'stub-insert-rows',
    });
    expect(payload.data.before).toEqual({ address: '9:9' });
    expect(payload.data.after).toEqual({ address: '9:9' });
  });
});
