import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import {
  WEBMCP_UPDATE_SOURCE_CONFIG_FILE,
  WEBMCP_UPDATE_STATE_FILE,
  buildMacLiteUpdaterScript,
  buildWindowsLiteUpdaterScript,
  createWebMcpLiteUpdateService,
  fetchWebMcpLiteUpdateInfo,
  getWebMcpLiteUpdateDistribution,
  isZipDirectoryPlaceholderPath,
  prepareWebMcpLiteUpdate,
  validateWebMcpLiteZip,
} from './webmcp-lite-update.ts';

function createResponse({
  ok = true,
  status = 200,
  headers = {},
  buffer = null,
}: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  buffer?: Buffer | null;
} = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok,
    status,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async buffer() {
      return buffer ?? Buffer.alloc(0);
    },
    async arrayBuffer() {
      const data = buffer ?? Buffer.alloc(0);
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      return copy.buffer;
    },
  };
}

async function createLiteZip(
  platform: 'win32' | 'darwin',
  options: { root?: string; traversal?: boolean; directoryPlaceholder?: boolean } = {}
) {
  const zip = new JSZip();
  const root = options.root ? `${options.root.replace(/\/+$/, '')}/` : '';
  if (platform === 'win32') {
    const payload = new JSZip();
    payload.file(
      'extension/manifest.json',
      JSON.stringify({
        manifest_version: 3,
        name: 'accr-ui',
        version: '0.0.5',
        key: 'remote-key',
      })
    );
    payload.file('runtime/native-server/runtime.cjs', 'console.log("native");');
    payload.file('runtime/agent-backend-v2/server.cjs', 'console.log("agent");');
    payload.file('runtime/vendor/claude-agent-sdk/cli.js', 'console.log("cli");');
    payload.file('runtime/start.vbs', 'WScript.Quit 0');
    payload.file('runtime/stop.vbs', 'WScript.Quit 0');
    payload.file('runtime/run_native_host.bat', '@echo off');
    payload.file('runtime/run_agent_backend.bat', '@echo off');
    payload.file('runtime/guide.html', '<html></html>');
    payload.file('extension-id.txt', 'stable-extension-id');
    if (options.directoryPlaceholder) {
      payload.file('extension/page-edit/vendor/', '');
      payload.file('extension/page-edit/vendor/app/index.js', 'console.log("vendor");');
    }
    zip.file(`${root}install.hta`, '<html></html>');
    zip.file(`${root}payload.zip`, await payload.generateAsync({ type: 'nodebuffer' }));
  } else {
    zip.file(`${root}extension/manifest.json`, '{}');
    zip.file(`${root}native-server/runtime.cjs`, 'console.log("native");');
    zip.file(`${root}agent-backend-v2/server.cjs`, 'console.log("agent");');
    zip.file(`${root}vendor/claude-agent-sdk/cli.js`, 'console.log("cli");');
    zip.file(`${root}start.command`, '#!/bin/bash\n');
    zip.file(`${root}stop.command`, '#!/bin/bash\n');
    zip.file(`${root}run_native_host.command`, '#!/bin/bash\n');
  }
  if (options.traversal) {
    zip.file(`${root}../escaped.txt`, 'bad');
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('validateWebMcpLiteZip accepts a complete Windows package with a root folder', async () => {
  const result = await validateWebMcpLiteZip(
    await createLiteZip('win32', { root: 'accr-ui-windows-lite-x64' }),
    { platform: 'win32' }
  );
  assert.deepEqual(result, { valid: true, missingPaths: [] });
});

test('validateWebMcpLiteZip accepts the current Windows installer package layout', async () => {
  const zip = new JSZip();
  zip.file('install.ps1', '# install');
  zip.file('install.vbs', 'WScript.Quit 0');
  zip.file('payload.zip', Buffer.from('payload'));

  const result = await validateWebMcpLiteZip(await zip.generateAsync({ type: 'nodebuffer' }), {
    platform: 'win32',
  });

  assert.deepEqual(result, { valid: true, missingPaths: [] });
});

test('validateWebMcpLiteZip reports missing required Mac paths', async () => {
  const zip = new JSZip();
  zip.file('extension/manifest.json', '{}');
  const result = await validateWebMcpLiteZip(await zip.generateAsync({ type: 'nodebuffer' }), {
    platform: 'darwin',
  });
  assert.deepEqual(result.missingPaths, [
    'native-server/runtime.cjs',
    'agent-backend-v2/server.cjs',
    'vendor/claude-agent-sdk/cli.js',
    'start.command',
    'stop.command',
    'run_native_host.command',
  ]);
});

test('fetchWebMcpLiteUpdateInfo falls back from HEAD 405 to range GET', async () => {
  const methods: string[] = [];
  const result = await fetchWebMcpLiteUpdateInfo(
    async (_url, options = {}) => {
      methods.push((options as { method?: string }).method ?? 'GET');
      return methods.length === 1
        ? createResponse({ ok: false, status: 405 })
        : createResponse({
            headers: {
              etag: 'W/"etag-1"',
              'last-modified': 'Thu, 21 May 2026 00:00:00 GMT',
            },
          });
    },
    { platform: 'win32' }
  );
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.packageId, 'W/"etag-1"');
});

test('getWebMcpLiteUpdateDistribution prefers app-local update source config over env vars', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'webmcp-lite-source-config-'));
  await writeFile(
    join(appDir, WEBMCP_UPDATE_SOURCE_CONFIG_FILE),
    JSON.stringify(
      {
        windowsLiteZipUrl: 'http://127.0.0.1:8866/accr-ui-windows-lite-x64.zip',
        projectUrl: 'http://127.0.0.1:8866/',
      },
      null,
      2
    ),
    'utf8'
  );

  const previousZipUrl = process.env.WEBMCP_WINDOWS_LITE_ZIP_URL;
  const previousProjectUrl = process.env.WEBMCP_LITE_PROJECT_URL;
  process.env.WEBMCP_WINDOWS_LITE_ZIP_URL = 'https://example.com/should-not-win.zip';
  process.env.WEBMCP_LITE_PROJECT_URL = 'https://example.com/should-not-win/';

  try {
    const distribution = await getWebMcpLiteUpdateDistribution({ appDir, platform: 'win32' });
    assert.equal(distribution.packageUrl, 'http://127.0.0.1:8866/accr-ui-windows-lite-x64.zip');
    assert.equal(distribution.projectUrl, 'http://127.0.0.1:8866/');
  } finally {
    if (previousZipUrl === undefined) {
      delete process.env.WEBMCP_WINDOWS_LITE_ZIP_URL;
    } else {
      process.env.WEBMCP_WINDOWS_LITE_ZIP_URL = previousZipUrl;
    }

    if (previousProjectUrl === undefined) {
      delete process.env.WEBMCP_LITE_PROJECT_URL;
    } else {
      process.env.WEBMCP_LITE_PROJECT_URL = previousProjectUrl;
    }
  }
});

test('getWebMcpLiteUpdateDistribution uses accr-ui package defaults for Windows', async () => {
  const previousZipUrl = process.env.WEBMCP_WINDOWS_LITE_ZIP_URL;
  const previousProjectUrl = process.env.WEBMCP_LITE_PROJECT_URL;
  delete process.env.WEBMCP_WINDOWS_LITE_ZIP_URL;
  delete process.env.WEBMCP_LITE_PROJECT_URL;

  try {
    const distribution = await getWebMcpLiteUpdateDistribution({ appDir: await mkdtemp(join(tmpdir(), 'accr-ui-default-win-')), platform: 'win32' });
  assert.equal(
      distribution.packageUrl,
      'https://git.midea.com/zhanglt21/claudecodeuibox/-/raw/main/accr-ui-windows-lite-x64.zip'
    );
    assert.equal(distribution.packageIdFallback, 'accr-ui-windows-lite-x64.zip');
  } finally {
    if (previousZipUrl === undefined) {
      delete process.env.WEBMCP_WINDOWS_LITE_ZIP_URL;
    } else {
      process.env.WEBMCP_WINDOWS_LITE_ZIP_URL = previousZipUrl;
    }

    if (previousProjectUrl === undefined) {
      delete process.env.WEBMCP_LITE_PROJECT_URL;
    } else {
      process.env.WEBMCP_LITE_PROJECT_URL = previousProjectUrl;
    }
  }
});

test('getWebMcpLiteUpdateDistribution uses accr-ui package defaults for mac', async () => {
  const previousZipUrl = process.env.WEBMCP_MAC_LITE_ZIP_URL;
  const previousProjectUrl = process.env.WEBMCP_LITE_PROJECT_URL;
  delete process.env.WEBMCP_MAC_LITE_ZIP_URL;
  delete process.env.WEBMCP_LITE_PROJECT_URL;

  try {
    const distribution = await getWebMcpLiteUpdateDistribution({ appDir: await mkdtemp(join(tmpdir(), 'accr-ui-default-mac-')), platform: 'darwin' });
  assert.equal(
      distribution.packageUrl,
      'https://git.midea.com/zhanglt21/claudecodeuibox/-/raw/main/accr-ui-mac-lite-arm64.zip'
    );
    assert.equal(distribution.packageIdFallback, 'accr-ui-mac-lite-arm64.zip');
  } finally {
    if (previousZipUrl === undefined) {
      delete process.env.WEBMCP_MAC_LITE_ZIP_URL;
    } else {
      process.env.WEBMCP_MAC_LITE_ZIP_URL = previousZipUrl;
    }

    if (previousProjectUrl === undefined) {
      delete process.env.WEBMCP_LITE_PROJECT_URL;
    } else {
      process.env.WEBMCP_LITE_PROJECT_URL = previousProjectUrl;
    }
  }
});

test('isZipDirectoryPlaceholderPath detects trailing slash directory placeholders', () => {
  assert.equal(isZipDirectoryPlaceholderPath('extension/page-edit/vendor/'), true);
  assert.equal(isZipDirectoryPlaceholderPath('extension/page-edit/vendor/app/index.js'), false);
});

test('prepareWebMcpLiteUpdate preserves manifest key, extension id, and update state', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'webmcp-lite-current-'));
  await writeFile(join(appDir, 'extension-id.txt'), 'stable-extension-id\n', 'utf8');
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(join(appDir, 'extension'), { recursive: true })
  );
  await writeFile(
    join(appDir, 'extension', 'manifest.json'),
    JSON.stringify({ key: 'stable-key' }),
    'utf8'
  );
  const zipBuffer = await createLiteZip('win32');
  const prepared = await prepareWebMcpLiteUpdate({
    appDir,
    platform: 'win32',
    serverPid: 1234,
    fetchImpl: async (_url, options = {}) => {
      if ((options as { method?: string }).method === 'HEAD') {
        return createResponse({ headers: { etag: 'W/"etag-2"' } });
      }
      return createResponse({ buffer: zipBuffer });
    },
  });
  const manifest = JSON.parse(
    await readFile(join(prepared.extractDir, 'extension', 'manifest.json'), 'utf8')
  );
  const extensionId = await readFile(join(prepared.extractDir, 'extension-id.txt'), 'utf8');
  const state = JSON.parse(await readFile(join(prepared.extractDir, WEBMCP_UPDATE_STATE_FILE), 'utf8'));
  assert.equal(manifest.key, 'stable-key');
  assert.equal(extensionId, 'stable-extension-id\n');
  assert.equal(state.packageId, 'W/"etag-2"');
});

test('prepareWebMcpLiteUpdate tolerates Windows directory placeholder zip entries', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'webmcp-lite-placeholder-'));
  const zipBuffer = await createLiteZip('win32', { directoryPlaceholder: true });
  const prepared = await prepareWebMcpLiteUpdate({
    appDir,
    platform: 'win32',
    serverPid: 1234,
    fetchImpl: async (_url, options = {}) => {
      if ((options as { method?: string }).method === 'HEAD') {
        return createResponse({ headers: { etag: 'W/"etag-dir"' } });
      }
      return createResponse({ buffer: zipBuffer });
    },
  });

  const vendorIndex = await readFile(
    join(prepared.extractDir, 'extension', 'page-edit', 'vendor', 'app', 'index.js'),
    'utf8'
  );
  assert.equal(vendorIndex, 'console.log("vendor");');
});

test('validateWebMcpLiteZip rejects path traversal entries', async () => {
  await assert.rejects(
    validateWebMcpLiteZip(await createLiteZip('darwin', { traversal: true }), {
      platform: 'darwin',
    }),
    /unsafe zip entry/i
  );
});

test('updater scripts protect user data and restart the lite package', () => {
  const win = buildWindowsLiteUpdaterScript({
    appDir: 'C:\\WebMCP',
    extractDir: 'C:\\Temp\\pkg',
    serverPid: 1234,
  });
  assert.match(win, /12306,8792/);
  assert.match(win, /\/XD workspace logs \.webmcp/);
  assert.match(win, /\/XF \.mcp\.json \.webmcp-update\.json guide-state\.json/);
  assert.match(
    win,
    /echo \{"completed": true\}>"C:\\WebMCP\\guide-state\.json"/
  );
  assert.match(win, /start "" "C:\\WebMCP\\runtime\\start\.vbs"/);
  assert.match(win, /if exist "C:\\WebMCP\\runtime\\release-notes\.html" start "" "C:\\WebMCP\\runtime\\release-notes\.html"/);

  const mac = buildMacLiteUpdaterScript({
    appDir: '/Users/demo/WebMCP',
    extractDir: '/tmp/pkg',
    serverPid: 1234,
  });
  assert.match(mac, /--exclude 'workspace\/'/);
  assert.match(mac, /--exclude '\.webmcp\/'/);
  assert.match(mac, /chmod \+x/);
  assert.match(mac, /start\.command/);
});

test('createWebMcpLiteUpdateService suppresses matching packageId', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'webmcp-lite-status-'));
  await writeFile(
    join(appDir, WEBMCP_UPDATE_STATE_FILE),
    JSON.stringify({ packageId: 'W/"same"' }),
    'utf8'
  );
  const service = createWebMcpLiteUpdateService({
    appDir,
    platform: 'darwin',
    fetchImpl: async () => createResponse({ headers: { etag: 'W/"same"' } }),
  });
  const status = await service.getUpdateStatus();
  assert.equal(status.updateAvailable, false);
  assert.equal(status.currentPackageId, 'W/"same"');
});
