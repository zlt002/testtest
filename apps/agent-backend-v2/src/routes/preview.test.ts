import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../app.ts';

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

test('GET /api/preview/file redirects HTML entry to preview asset URL', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><body><h1>Hello</h1></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );

    assert.equal(response.status, 302);
    assert.match(
      response.headers.get('location') || '',
      /\/api\/preview\/assets\/.+\/pages\/demo\/index\.html$/
    );
  } finally {
    server.close();
  }
});

test('GET /api/preview/file encodes non-ascii asset paths in redirect location', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'captures', '20260524T054202Z-百度一下,你就知道'), {
    recursive: true,
  });
  await writeFile(
    join(projectRoot, 'captures', '20260524T054202Z-百度一下,你就知道', 'index.html'),
    '<!doctype html><html><body><h1>Hello</h1></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('captures/20260524T054202Z-百度一下,你就知道/index.html')}`,
      { redirect: 'manual' }
    );

    assert.equal(response.status, 302);
    assert.match(
      response.headers.get('location') || '',
      /\/api\/preview\/assets\/[^/]+\/captures\/20260524T054202Z-%E7%99%BE%E5%BA%A6%E4%B8%80%E4%B8%8B%2C%E4%BD%A0%E5%B0%B1%E7%9F%A5%E9%81%93\/index\.html$/
    );
  } finally {
    server.close();
  }
});

test('GET /api/preview/assets/:previewId/* returns injected HTML', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><body><h1>Hello</h1></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    const response = await fetch(`${url}${location}`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(text, /<h1>Hello<\/h1>/);
    assert.match(text, /EventSource\('/);
  } finally {
    server.close();
  }
});

test('GET /api/preview/resolve returns preview source file location', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'captures', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'captures', 'demo', 'index.html'),
    '<!doctype html><html><body><h1>Hello</h1></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('captures/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    const match = location.match(/^\/api\/preview\/assets\/([^/]+)\/(.+)$/);
    assert.ok(match);
    const [, previewId, filePath] = match;

    const response = await fetch(
      `${url}/api/preview/resolve?previewId=${encodeURIComponent(previewId)}&filePath=${encodeURIComponent(decodeURIComponent(filePath))}`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      projectPath: projectRoot,
      filePath: 'captures/demo/index.html',
    });
  } finally {
    server.close();
  }
});

test('GET /api/preview/assets/:previewId/* returns placeholder html when entry file is not on disk yet', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const response = await fetch(`${url}${location}`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(text, /AI .*HTML/);
    assert.match(text, /EventSource\('/);
  } finally {
    server.close();
  }
});

test('GET preview asset returns css with content type', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>Hello</body></html>',
    'utf8'
  );
  await writeFile(join(projectRoot, 'pages', 'demo', 'style.css'), 'body{color:red;}', 'utf8');

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    const cssUrl = `${url}${location.replace(/index\.html$/, 'style.css')}`;
    const response = await fetch(cssUrl);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/css/);
    assert.equal(await response.text(), 'body{color:red;}');
  } finally {
    server.close();
  }
});

test('GET preview image asset includes CORP header for extension embedding', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'assets'), { recursive: true });
  await writeFile(
    join(projectRoot, 'assets', 'diagram.png'),
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('assets/diagram.png')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    const response = await fetch(`${url}${location}`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/png/);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  } finally {
    server.close();
  }
});

test('GET /api/preview/events/:previewId streams reload event after file change', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  const htmlPath = join(projectRoot, 'pages', 'demo', 'index.html');
  await writeFile(htmlPath, '<!doctype html><html><body>Hello</body></html>', 'utf8');

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    const match = location.match(/\/api\/preview\/assets\/([^/]+)\//);
    assert.ok(match);
    const previewId = match[1];

    const response = await fetch(`${url}/api/preview/events/${previewId}`);
    const reader = response.body?.getReader();
    assert.ok(reader);

    await writeFile(htmlPath, '<!doctype html><html><body>Hello again</body></html>', 'utf8');

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    assert.match(text, /"type":"reload"/);
    reader.cancel().catch(() => {});
  } finally {
    server.close();
  }
});

test('POST /api/preview/live serves live html content before disk write', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><body>Hello</body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<!doctype html><html><body>Hello live</body></html>',
        operation: 'write',
        writeId: 'write-1',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /Hello live/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live keeps the existing html preview when edit payload cannot be applied', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><body><main>Hello disk</main></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<section>partial replacement only</section>',
        operation: 'edit',
        oldString: '<main>missing target</main>',
        newString: '<section>partial replacement only</section>',
        writeId: 'write-edit-miss',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /Hello disk/);
    assert.doesNotMatch(text, /partial replacement only/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live applies edit payloads against the current html preview', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><body><main>Hello disk</main></body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<main>Hello live</main>',
        operation: 'edit',
        oldString: '<main>Hello disk</main>',
        newString: '<main>Hello live</main>',
        writeId: 'write-edit-hit',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /Hello live/);
    assert.doesNotMatch(text, /Hello disk/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live serves brand-new html content before file exists on disk', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<!doctype html><html><body>Hello brand new</body></html>',
        operation: 'write',
        writeId: 'write-new-html',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';
    assert.equal(redirect.status, 302);

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /Hello brand new/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live keeps brand-new html previews in placeholder mode until body content arrives', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const earlyLiveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<!doctype html><html><head><style>body{background:#000;}</style></head>',
        operation: 'write',
        writeId: 'write-placeholder',
      }),
    });
    assert.equal(earlyLiveResponse.status, 200);

    const earlyResponse = await fetch(`${url}${location}`);
    const earlyText = await earlyResponse.text();
    assert.match(earlyText, /AI 正在生成 HTML 预览/);
    assert.doesNotMatch(earlyText, /body\{background:#000;\}/);

    const lateLiveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<!doctype html><html><head><style>body{background:#000;}</style></head><body><main>Ready</main></body></html>',
        operation: 'write',
        writeId: 'write-placeholder',
      }),
    });
    assert.equal(lateLiveResponse.status, 200);

    const lateResponse = await fetch(`${url}${location}`);
    const lateText = await lateResponse.text();
    assert.match(lateText, /<main>Ready<\/main>/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live keeps placeholder when html stream temporarily looks like raw script text', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content:
          "(function(){function connect(){const source=new EventSource('/api/preview/events/demo');source.onerror=function(){source.close();setTimeout(connect,1000);};}connect();})();",
        operation: 'write',
        writeId: 'write-script-like-fragment',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /^<!doctype html>/i);
    assert.match(text, /AI 正在生成 HTML 预览/);
    assert.doesNotMatch(text, /^\(function\(\)\{function connect\(\)/);
  } finally {
    server.close();
  }
});

test('POST /api/preview/live serves live css content before disk write', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>Hello</body></html>',
    'utf8'
  );
  await writeFile(join(projectRoot, 'pages', 'demo', 'style.css'), 'body{color:red;}', 'utf8');

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/style.css',
        content: 'body{color:blue;}',
        operation: 'write',
        writeId: 'write-2',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const cssUrl = `${url}${location.replace(/index\.html$/, 'style.css')}`;
    const response = await fetch(cssUrl);
    assert.equal(await response.text(), 'body{color:blue;}');
  } finally {
    server.close();
  }
});

test('POST /api/preview/live serves brand-new css content before file exists on disk', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  await writeFile(
    join(projectRoot, 'pages', 'demo', 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>Hello</body></html>',
    'utf8'
  );

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    const liveResponse = await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/style.css',
        content: 'body{color:green;}',
        operation: 'write',
        writeId: 'write-new-css',
      }),
    });
    assert.equal(liveResponse.status, 200);

    const cssUrl = `${url}${location.replace(/index\.html$/, 'style.css')}`;
    const response = await fetch(cssUrl);
    assert.equal(await response.text(), 'body{color:green;}');
  } finally {
    server.close();
  }
});

test('POST /api/preview/live/complete clears live content and falls back to disk', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  await mkdir(join(projectRoot, 'pages', 'demo'), { recursive: true });
  const htmlPath = join(projectRoot, 'pages', 'demo', 'index.html');
  await writeFile(htmlPath, '<!doctype html><html><body>Hello</body></html>', 'utf8');

  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const redirect = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('pages/demo/index.html')}`,
      { redirect: 'manual' }
    );
    const location = redirect.headers.get('location') || '';

    await fetch(`${url}/api/preview/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        content: '<!doctype html><html><body>Hello live</body></html>',
        operation: 'write',
        writeId: 'write-3',
      }),
    });

    await writeFile(htmlPath, '<!doctype html><html><body>Hello disk</body></html>', 'utf8');
    await fetch(`${url}/api/preview/live/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        entryFilePath: 'pages/demo/index.html',
        filePath: 'pages/demo/index.html',
        writeId: 'write-3',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 450));

    const response = await fetch(`${url}${location}`);
    const text = await response.text();
    assert.match(text, /Hello disk/);
  } finally {
    server.close();
  }
});

test('GET /api/preview/file rejects path traversal input', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'preview-route-'));
  const app = createApp(baseDeps() as Parameters<typeof createApp>[0]);
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/preview/file?projectPath=${encodeURIComponent(projectRoot)}&filePath=${encodeURIComponent('../secret.txt')}`
    );
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});
