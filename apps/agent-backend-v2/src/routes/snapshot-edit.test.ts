import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSnapshotEditService } from '../snapshot-edit/snapshot-edit-service.ts';
import { createSnapshotEditRoute } from './snapshot-edit.ts';

async function listen(route: ReturnType<typeof createSnapshotEditRoute>) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!(await route(req, res, url))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    server,
    url: `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-snapshot-edit-route-'));
  const htmlPath = join(root, 'index.html');
  const cssPath = join(root, 'style.css');
  await writeFile(
    htmlPath,
    '<html><head><link rel="stylesheet" href="style.css"></head><body>\n<div id="target" class="box">hello</div>\n</body></html>\n',
    'utf8'
  );
  await writeFile(cssPath, '.box {\n  color: #222;\n}\n', 'utf8');
  return { htmlPath, cssPath };
}

test('snapshot edit route locates DOM nodes from file line and column', async () => {
  const { htmlPath } = await createFixture();
  const route = createSnapshotEditRoute(createSnapshotEditService());
  const { server, url } = await listen(route);
  try {
    const response = await fetch(`${url}/api/agent-v2/snapshot-edit/locate-dom`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: htmlPath, line: 2, column: 3 }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      selector?: string;
      id?: string;
      ancestors?: Array<{ selector?: string }>;
    };
    assert.equal(body.selector, 'div#target.box');
    assert.equal(body.id, 'target');
    assert.ok(body.ancestors?.some((ancestor) => ancestor.selector === 'body'));
  } finally {
    server.close();
  }
});

test('snapshot edit route applies CSS batch patches', async () => {
  const { htmlPath, cssPath } = await createFixture();
  const route = createSnapshotEditRoute(createSnapshotEditService());
  const { server, url } = await listen(route);
  try {
    const response = await fetch(`${url}/api/agent-v2/snapshot-edit/patch-css-batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        htmlPath,
        rules: [
          { selector: '.box', declarations: { color: 'white' } },
          { selector: '.box strong', declarations: { color: '#ffd166' } },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { updatedRules?: unknown[]; createdRules?: unknown[] };
    assert.equal(body.updatedRules?.length, 1);
    assert.equal(body.createdRules?.length, 1);
    const css = await readFile(cssPath, 'utf8');
    assert.match(css, /\.box \{\n {2}color: white;\n\}/);
    assert.match(css, /\.box strong \{\n {2}color: #ffd166;\n\}/);
  } finally {
    server.close();
  }
});

test('snapshot edit route removes matching nodes by selector', async () => {
  const { htmlPath } = await createFixture();
  const route = createSnapshotEditRoute(createSnapshotEditService());
  const { server, url } = await listen(route);
  try {
    const response = await fetch(`${url}/api/agent-v2/snapshot-edit/remove-nodes-by-selector`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: htmlPath,
        selector: 'div.box',
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { removedCount?: number; changed?: boolean };
    assert.equal(body.changed, true);
    assert.equal(body.removedCount, 1);
    const html = await readFile(htmlPath, 'utf8');
    assert.doesNotMatch(html, /<div id="target" class="box">hello<\/div>/);
  } finally {
    server.close();
  }
});
