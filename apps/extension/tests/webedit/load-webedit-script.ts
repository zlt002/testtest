import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

type WebEditTestGlobals = Record<string, unknown>;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../..');

export function createWebEditTestWindow(overrides: WebEditTestGlobals = {}) {
  const location = new URL('https://webedit.midea.com/test?editId=test-doc');

  const windowLike: WebEditTestGlobals = {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    clearTimeout,
    console,
    document: {
      activeElement: null,
      getElementById: () => null,
      readyState: 'complete',
      title: 'test-doc',
    },
    location: {
      href: location.href,
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
    },
    navigator: {
      userAgent: 'vitest',
    },
    setTimeout,
  };

  Object.assign(windowLike, overrides);

  windowLike.window = windowLike;
  windowLike.self = windowLike;
  windowLike.global = windowLike;
  windowLike.globalThis = windowLike;

  return windowLike as Window & typeof globalThis & Record<string, unknown>;
}

export async function loadWebEditScript(
  win: Record<string, unknown>,
  relativePath: string
) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const source = await readFile(absolutePath, 'utf8');
  const context = vm.createContext(win);

  vm.runInContext(source, context, {
    filename: absolutePath,
  });

  return win;
}
