import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../app.ts';
import { createSystemUpdateRoute } from './system-update.ts';

async function listen(app: ReturnType<typeof createApp>) {
  const server = createServer(app.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    server,
    url: `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`,
  };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    agentService: {
      async listSessions() {
        return [];
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    ...overrides,
  };
}

test('GET /api/system/update-info returns update status', async () => {
  const app = createApp(
    baseDeps({
      systemUpdateService: {
        async getUpdateStatus() {
          return {
            updateAvailable: true,
            packageUrl: 'https://example.com/webmcp.zip',
            projectUrl: 'https://example.com/project',
            packageId: 'W/"etag"',
            lastModified: null,
            currentPackageId: null,
            distribution: 'windows-lite',
          };
        },
        async prepareUpdate() {
          throw new Error('not used');
        },
        launchUpdater() {},
      },
    }) as Parameters<typeof createApp>[0]
  );
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/system/update-info`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      updateAvailable: true,
      packageUrl: 'https://example.com/webmcp.zip',
      projectUrl: 'https://example.com/project',
      packageId: 'W/"etag"',
      lastModified: null,
      currentPackageId: null,
      distribution: 'windows-lite',
    });
  } finally {
    server.close();
  }
});

test('POST /api/system/update prepares update and launches updater after response', async () => {
  const calls: string[] = [];
  const app = createApp(
    baseDeps({
      systemUpdateService: {
        async getUpdateStatus() {
          throw new Error('not used');
        },
        async prepareUpdate() {
          calls.push('prepare');
          return {
            updateRoot: '/tmp/update',
            extractDir: '/tmp/update/package',
            updaterScriptPath: '/tmp/update/apply-update.sh',
          };
        },
        launchUpdater(path: string) {
          calls.push(`launch:${path}`);
        },
      },
    }) as Parameters<typeof createApp>[0]
  );
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/system/update`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { success: boolean };
    assert.equal(payload.success, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, ['prepare', 'launch:/tmp/update/apply-update.sh']);
  } finally {
    server.close();
  }
});

test('POST /api/system/update waits for response finish before launching updater', async () => {
  const calls: string[] = [];
  const route = createSystemUpdateRoute({
    async getUpdateStatus() {
      throw new Error('not used');
    },
    async prepareUpdate() {
      calls.push('prepare');
      return {
        updateRoot: '/tmp/update',
        extractDir: '/tmp/update/package',
        updaterScriptPath: '/tmp/update/apply-update.cmd',
      };
    },
    launchUpdater(path: string) {
      calls.push(`launch:${path}`);
    },
  });

  class FakeResponse extends EventEmitter {
    headersSent = false;
    writableEnded = false;
    destroyed = false;
    statusCode = 200;
    headers: Record<string, string> = {};
    body = '';

    setHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status;
      this.headersSent = true;
      Object.assign(this.headers, headers);
      return this;
    }

    end(chunk?: string) {
      if (chunk) {
        this.body += chunk;
      }
      this.writableEnded = true;
      setTimeout(() => this.emit('finish'), 30);
      return this;
    }
  }

  const req = { method: 'POST' } as Parameters<typeof route>[0];
  const res = new FakeResponse() as unknown as Parameters<typeof route>[1];
  const url = new URL('http://127.0.0.1/api/system/update');

  await route(req, res, url);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(calls, ['prepare']);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls, ['prepare', 'launch:/tmp/update/apply-update.cmd']);
});

test('GET /api/system/update-info suppresses service errors', async () => {
  const app = createApp(
    baseDeps({
      systemUpdateService: {
        async getUpdateStatus() {
          throw new Error('network failed');
        },
        async prepareUpdate() {
          throw new Error('not used');
        },
        launchUpdater() {},
      },
    }) as Parameters<typeof createApp>[0]
  );
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/system/update-info`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { updateAvailable: false, error: 'network failed' });
  } finally {
    server.close();
  }
});
