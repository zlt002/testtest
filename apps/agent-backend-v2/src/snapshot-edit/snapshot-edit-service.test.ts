import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSnapshotEditService, lineColumnToOffset } from './snapshot-edit-service.ts';

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-snapshot-edit-'));
  const htmlPath = join(root, 'index.html');
  const cssPath = join(root, 'style.css');

  await writeFile(
    htmlPath,
    [
      '<!doctype html>',
      '<html>',
      '<head>',
      '  <link rel="stylesheet" href="style.css">',
      '</head>',
      '<body>',
      '  <main>',
      '    <section id="hero" class="panel primary">',
      '      <h1>Title</h1>',
      '    </section>',
      '    <div id="cards">',
      '      <article class="card promo"><span>Alpha</span></article>',
      '      <article class="card promo"><span>Beta</span></article>',
      '      <article class="card regular"><span>Gamma</span></article>',
      '    </div>',
      '    <button id="submit-button">Submit</button>',
      '    <div id="content-shell"><strong>Keep</strong><em>Old</em></div>',
      '  </main>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    cssPath,
    [
      '.panel {',
      '  color: #222;',
      '  margin-top: 8px;',
      '}',
      '',
      '#hero.primary {',
      '  border: 1px solid #ddd;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

  return { root, htmlPath, cssPath };
}

test('lineColumnToOffset resolves one-based line and column positions', () => {
  const text = 'abc\n中文\nlast';

  assert.equal(lineColumnToOffset(text, 1, 1), 0);
  assert.equal(lineColumnToOffset(text, 1, 3), 2);
  assert.equal(lineColumnToOffset(text, 2, 1), 4);
  assert.equal(lineColumnToOffset(text, 3, 2), 8);
});

test('locateDom returns the smallest element containing a line and column', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();

  const result = await service.locateDom({
    filePath: htmlPath,
    line: 8,
    column: 12,
  });

  assert.equal(result.tagName, 'section');
  assert.equal(result.id, 'hero');
  assert.deepEqual(result.classList, ['panel', 'primary']);
  assert.equal(result.selector, 'section#hero.panel.primary');
  assert.equal(result.range.startLine, 8);
  assert.equal(result.range.endLine, 10);
  assert.equal(result.ancestors?.[0]?.selector, 'main');
  assert.match(result.outerHTMLSnippet, /<section id="hero"/);
});

test('findCss returns matching rules from linked stylesheets', async () => {
  const { htmlPath, cssPath } = await createFixture();
  const service = createSnapshotEditService();

  const result = await service.findCss({
    htmlPath,
    selector: 'section#hero.panel.primary',
  });

  assert.deepEqual(
    result.rules.map((rule) => ({
      filePath: rule.filePath,
      selector: rule.selector,
      line: rule.range.startLine,
    })),
    [
      { filePath: cssPath, selector: '.panel', line: 1 },
      { filePath: cssPath, selector: '#hero.primary', line: 6 },
    ]
  );
});

test('patchCss updates an existing declaration in place', async () => {
  const { htmlPath, cssPath } = await createFixture();
  const service = createSnapshotEditService();

  const result = await service.patchCss({
    htmlPath,
    selector: '.panel',
    declarations: {
      color: 'red',
      'margin-top': '16px',
    },
  });

  assert.equal(result.updatedRules.length, 1);
  assert.equal(result.createdRule, false);

  const updatedCss = await readFile(cssPath, 'utf8');
  assert.match(updatedCss, /\.panel \{\n {2}color: red;\n {2}margin-top: 16px;\n\}/);
});

test('patchCssBatch applies multiple CSS rules in one operation', async () => {
  const { htmlPath, cssPath } = await createFixture();
  const service = createSnapshotEditService();

  const result = await service.patchCssBatch({
    htmlPath,
    rules: [
      {
        selector: '.panel',
        declarations: {
          color: 'white',
          background: '#111',
        },
      },
      {
        selector: '.panel a',
        declarations: {
          color: '#8ab4ff',
        },
      },
    ],
  });

  assert.equal(result.updatedRules.length, 1);
  assert.equal(result.createdRules.length, 1);

  const updatedCss = await readFile(cssPath, 'utf8');
  assert.match(
    updatedCss,
    /\.panel \{\n {2}color: white;\n {2}margin-top: 8px;\n {2}background: #111;\n\}/
  );
  assert.match(updatedCss, /\.panel a \{\n {2}color: #8ab4ff;\n\}/);
});

test('patchCssBatch updates an existing grouped selector instead of duplicating it', async () => {
  const { htmlPath, cssPath } = await createFixture();
  const service = createSnapshotEditService();

  await service.patchCssBatch({
    htmlPath,
    rules: [
      {
        selector: '#card-1, #card-2',
        declarations: {
          color: '#ddd',
        },
      },
    ],
  });
  await service.patchCssBatch({
    htmlPath,
    rules: [
      {
        selector: '#card-1, #card-2',
        declarations: {
          background: '#111',
        },
      },
    ],
  });

  const updatedCss = await readFile(cssPath, 'utf8');
  assert.equal((updatedCss.match(/#card-1, #card-2/g) || []).length, 1);
  assert.match(updatedCss, /#card-1, #card-2 \{\n {2}color: #ddd;\n {2}background: #111;\n\}/);
});

test('patchHtml can update attributes without rewriting the full file', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();
  const located = await service.locateDom({
    filePath: htmlPath,
    line: 8,
    column: 12,
  });

  const result = await service.patchHtml({
    filePath: htmlPath,
    range: located.range,
    operation: {
      type: 'setAttributes',
      attributes: {
        'data-state': 'selected',
        class: 'panel primary highlighted',
      },
    },
  });

  assert.equal(result.changed, true);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.match(
    updatedHtml,
    /<section id="hero" class="panel primary highlighted" data-state="selected">/
  );
  assert.match(updatedHtml, /<h1>Title<\/h1>/);
});

test('removeNode deletes the full node range', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();
  const located = await service.locateDom({
    filePath: htmlPath,
    line: 16,
    column: 12,
  });

  const result = await service.patchHtml({
    filePath: htmlPath,
    range: located.range,
    operation: {
      type: 'removeNode',
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.removedCount, 1);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(updatedHtml, /<button id="submit-button">Submit<\/button>/);
});

test('removeNodesBySelector deletes all matching nodes in one write', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();

  const result = await service.patchHtml({
    filePath: htmlPath,
    operation: {
      type: 'removeNodesBySelector',
      selector: 'article.card.promo',
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.removedCount, 2);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.equal((updatedHtml.match(/article class="card promo"/g) || []).length, 0);
  assert.match(updatedHtml, /<article class="card regular"><span>Gamma<\/span><\/article>/);
});

test('removeSimilarNodes deletes nodes similar to the anchor node', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();
  const located = await service.locateDom({
    filePath: htmlPath,
    line: 12,
    column: 20,
  });

  const result = await service.patchHtml({
    filePath: htmlPath,
    range: located.range,
    operation: {
      type: 'removeSimilarNodes',
      matchMode: 'sameTagAndClasses',
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.removedCount, 2);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.equal((updatedHtml.match(/article class="card promo"/g) || []).length, 0);
  assert.match(updatedHtml, /<article class="card regular"><span>Gamma<\/span><\/article>/);
});

test('replaceInnerHtml keeps the wrapper element and replaces its children', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();
  const located = await service.locateDom({
    filePath: htmlPath,
    line: 17,
    column: 15,
  });

  const result = await service.patchHtml({
    filePath: htmlPath,
    range: located.range,
    operation: {
      type: 'replaceInnerHtml',
      html: '<p>Fresh</p><p>Content</p>',
    },
  });

  assert.equal(result.changed, true);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.match(updatedHtml, /<div id="content-shell"><p>Fresh<\/p><p>Content<\/p><\/div>/);
  assert.doesNotMatch(updatedHtml, /<strong>Keep<\/strong><em>Old<\/em>/);
});

test('replaceText updates a simple text-only node without changing the tag', async () => {
  const { htmlPath } = await createFixture();
  const service = createSnapshotEditService();
  const located = await service.locateDom({
    filePath: htmlPath,
    line: 16,
    column: 15,
  });

  const result = await service.patchHtml({
    filePath: htmlPath,
    range: located.range,
    operation: {
      type: 'replaceText',
      text: 'Confirm',
    },
  });

  assert.equal(result.changed, true);
  const updatedHtml = await readFile(htmlPath, 'utf8');
  assert.match(updatedHtml, /<button id="submit-button">Confirm<\/button>/);
});
