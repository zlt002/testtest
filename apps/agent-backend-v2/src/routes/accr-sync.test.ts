import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAccrSyncRoute } from './accr-sync.ts';

async function unreachableHealthCheck() {
  throw new Error('should not call checkHealth');
}

async function postJson(
  handle: ReturnType<typeof createAccrSyncRoute>,
  body: Record<string, unknown>
) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const handled = await handle(req, res, url);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const url = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`;

  try {
    return await fetch(`${url}/api/accr-sync/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

async function requestRoute(input: {
  handle: ReturnType<typeof createAccrSyncRoute>;
  method: string;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const handled = await input.handle(req, res, url);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const url = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`;

  try {
    return await fetch(`${url}/api/accr-sync/run`, {
      method: input.method,
      headers:
        input.rawBody !== undefined || input.body !== undefined
          ? { 'Content-Type': input.contentType ?? 'application/json' }
          : undefined,
      body:
        input.rawBody !== undefined
          ? input.rawBody
          : input.body !== undefined
            ? JSON.stringify(input.body)
            : undefined,
    });
  } finally {
    server.close();
  }
}

test('POST /api/accr-sync/run 调用 service 并返回 JSON', async () => {
  const calls: Array<{ mode: 'remote' | 'local-debug' }> = [];
  const handle = createAccrSyncRoute({
    async run(input) {
      calls.push(input);
      return {
        ok: true,
        status: 'completed',
        mode: 'local-debug' as const,
        stdout: '',
        stderr: '',
      };
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await postJson(handle, { mode: 'local-debug' });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: 'completed',
    mode: 'local-debug',
    stdout: '',
    stderr: '',
  });
  assert.deepEqual(calls, [{ mode: 'local-debug', force: false }]);
});

test('POST /api/accr-sync/run 在 mode 为 remote 时调用 remote 同步，并透传 force', async () => {
  const calls: Array<{ mode: 'remote' | 'local-debug'; force?: boolean }> = [];
  const invalidations: string[] = [];
  let commandInvalidationCount = 0;
  const handle = createAccrSyncRoute({
    async run(input) {
      calls.push(input);
      return {
        ok: true,
        status: 'completed',
        mode: input.mode,
        stdout: '',
        stderr: '',
      };
    },
    checkHealth: unreachableHealthCheck,
  }, {
    invalidateCapabilityCatalog(input) {
      invalidations.push(input.type);
    },
    invalidateCommandCatalog() {
      commandInvalidationCount += 1;
    },
  });

  const response = await postJson(handle, {
    mode: 'remote',
    force: true,
    trigger: 'extension-action-click',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: 'completed',
    mode: 'remote',
    stdout: '',
    stderr: '',
  });
  assert.deepEqual(calls, [{ mode: 'remote', force: true }]);
  assert.deepEqual(invalidations, ['skill']);
  assert.equal(commandInvalidationCount, 1);
});

test('POST /api/accr-sync/run 在 local-debug 成功时不会清理技能缓存', async () => {
  const invalidations: string[] = [];
  let commandInvalidationCount = 0;
  const handle = createAccrSyncRoute({
    async run(input) {
      return {
        ok: true,
        status: 'completed',
        mode: input.mode,
        stdout: '',
        stderr: '',
      };
    },
    checkHealth: unreachableHealthCheck,
  }, {
    invalidateCapabilityCatalog(input) {
      invalidations.push(input.type);
    },
    invalidateCommandCatalog() {
      commandInvalidationCount += 1;
    },
  });

  const response = await postJson(handle, {
    mode: 'local-debug',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: 'completed',
    mode: 'local-debug',
    stdout: '',
    stderr: '',
  });
  assert.deepEqual(invalidations, []);
  assert.equal(commandInvalidationCount, 0);
});

test('POST /api/accr-sync/run 在空对象时返回 400 和稳定错误结构', async () => {
  const calls: Array<{ mode: 'remote' | 'local-debug' }> = [];
  const handle = createAccrSyncRoute({
    async run(input) {
      calls.push(input);
      return {
        ok: true,
        status: 'completed',
        mode: input.mode,
        stdout: '',
        stderr: '',
      };
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: {},
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
  assert.deepEqual(calls, []);
});

test('POST /api/accr-sync/run 在仅有 trigger 时返回 400 和稳定错误结构', async () => {
  const calls: Array<{ mode: 'remote' | 'local-debug' }> = [];
  const handle = createAccrSyncRoute({
    async run(input) {
      calls.push(input);
      return {
        ok: true,
        status: 'completed',
        mode: input.mode,
        stdout: '',
        stderr: '',
      };
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: { trigger: 'extension-action-click' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
  assert.deepEqual(calls, []);
});

test('同一路径非 POST 请求返回 405 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'GET',
  });

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Method not allowed',
  });
});

test('非法 mode 请求体返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: { mode: 'invalid-mode' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid mode',
  });
});

test('非法 JSON 返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    rawBody: '{',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid JSON body',
  });
});

test('null body 返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: null,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
});

test('数组 body 返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: ['local-debug'],
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
});

test('字符串 body 返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: 'local-debug',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
});

test('缺少 mode 且非约定 trigger 的对象返回 400 和稳定错误结构', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not be called');
    },
    checkHealth: unreachableHealthCheck,
  });

  const response = await requestRoute({
    handle,
    method: 'POST',
    body: { source: 'manual' },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Invalid request body',
  });
});

test('GET /api/accr-sync/health 返回本地技能目录自检结果', async () => {
  const handle = createAccrSyncRoute({
    async run() {
      throw new Error('should not call run');
    },
    async checkHealth() {
      return {
        ok: true,
        healthy: false,
        checkedPath: '/Users/demo/.claude/skills',
        issues: ['未找到技能目录'],
        recommendedAction: 'remote_resync' as const,
        syncStateVersion: '2026.05.27',
      };
    },
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const handled = await handle(req, res, url);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const url = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`;

  try {
    const response = await fetch(`${url}/api/accr-sync/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      healthy: false,
      checkedPath: '/Users/demo/.claude/skills',
      issues: ['未找到技能目录'],
      recommendedAction: 'remote_resync',
      syncStateVersion: '2026.05.27',
    });
  } finally {
    server.close();
  }
});
