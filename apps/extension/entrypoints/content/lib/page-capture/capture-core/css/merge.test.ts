import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectStyleSources } from './collect';
import { mergeStyleSources } from './merge';
import { rewriteCssResourceUrls } from './rewrite';

function ensurePerformanceGetEntriesByType(target: Performance): void {
  if (typeof target.getEntriesByType === 'function') {
    return;
  }

  Object.defineProperty(target, 'getEntriesByType', {
    configurable: true,
    writable: true,
    value: () => [],
  });
}

describe('capture-core css merge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('collects and merges linked stylesheets while preserving inline styles in place', async () => {
    document.documentElement.innerHTML = `
      <head>
        <link rel="stylesheet" href="/a.css">
        <style>
          @font-face { font-family: InlineFixture; src: url(data:font/woff2;base64,abc); }
          .inline { color: blue; background: url("/bg.png"); }
        </style>
        <link rel="stylesheet" href="/print.css" media="print">
      </head>
      <body><main class="inline imported a print">ok</main></body>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () => {
          if (url.endsWith('/a.css')) {
            return '@import "/imported.css"; .a{font-family:x;src:url("/font.woff2")}';
          }
          if (url.endsWith('/imported.css')) {
            return '.imported{background:url("/imported.png")}';
          }
          return '.print{color:black}';
        },
      }))
    );

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { preserveInlineStyleElements: true }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/a.css');
    expect(css).toContain('.a{font-family:x;src:none}');
    expect(css).toMatch(/\.imported\{background:\s*none\}/);
    expect(css).toContain('@media print');
    expect(css).not.toContain('.inline { color: blue;');
    expect(css).not.toContain('/bg.png');
    expect(css).not.toContain('/font.woff2');
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(document.querySelector('style')?.textContent).toMatch(
      /\.inline\s*\{\s*color:\s*blue;/
    );
    expect(document.querySelector('style')?.textContent).not.toContain('@font-face');
    expect(warnings).toEqual([]);
  });

  it('skips browser extension stylesheets from links and performance fallback sources', async () => {
    document.documentElement.innerHTML = `
      <head>
        <link rel="stylesheet" href="chrome-extension://example/blueprint.css">
        <link rel="stylesheet" href="/app.css">
      </head>
      <body><main class="app">ok</main></body>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url.endsWith('/app.css') ? '.app { color: red; }' : '.extension { color: blue; }',
      }))
    );

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'chrome-extension://example/blueprint.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('.app { color: red; }');
    expect(css).not.toContain('chrome-extension://example/blueprint.css');
    expect(css).not.toContain('.extension { color: blue; }');
    expect(document.querySelector('link[href^="chrome-extension://"]')).toBeNull();
  });

  it('deduplicates micro-app scoped styles when only the wrapper prefix differs', async () => {
    document.documentElement.innerHTML = `
      <head>
        <style>.tk-row{display:flex}.tk-col{display:block}</style>
        <style>micro-app[name=otp-tms] .tk-row{display:flex}micro-app[name=otp-tms] .tk-col{display:block}</style>
      </head>
      <body><micro-app-body><div class="tk-row tk-col">ok</div></micro-app-body></body>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { preserveInlineStyleElements: false, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(sources).toHaveLength(1);
    expect(css.match(/\.tk-row\s*\{\s*display:\s*flex;?\s*\}/g)).toHaveLength(1);
    expect(css).not.toContain('micro-app[name=otp-tms]');
  });

  it('records warnings when linked stylesheets cannot be fetched', async () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/missing.css">';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    );

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings
    );

    expect(sources).toEqual([]);
    expect(warnings[0]).toMatchObject({
      code: 'stylesheet_fetch_failed',
      sourceUrl: 'https://example.com/missing.css',
    });
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it('expands imported stylesheets with media and skips alternate stylesheets', async () => {
    document.head.innerHTML = `
      <link rel="alternate stylesheet" href="/theme.css">
      <link rel="stylesheet" href="/app.css">
    `;
    document.body.innerHTML = '<main class="app print">ok</main>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () => {
          if (url.endsWith('/app.css')) {
            return '@import url("/print.css") print; .app { color: red; }';
          }
          return '.print { color: black; }';
        },
      }))
    );

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('@media print');
    expect(css).toMatch(/\.print\s*\{\s*color:\s*black;?\s*\}/);
    expect(css).toMatch(/\.app\s*\{\s*color:\s*red;?\s*\}/);
    expect(css).not.toContain('/theme.css');
    expect(document.querySelector('link[rel="alternate stylesheet"]')).toBeNull();
  });

  it('drops flat CSS rules that do not match the captured document', async () => {
    document.documentElement.innerHTML = `
      <head>
        <style>
          .keep { color: green; }
          .feedback_tabs { position: fixed; }
          .voice-dialog--content { display: block; }
          .keep:hover::before { content: ""; }
        </style>
      </head>
      <body><main class="keep">ok</main></body>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('.keep');
    expect(css).toContain('color: green');
    expect(css).not.toContain('feedback_tabs');
    expect(css).not.toContain('voice-dialog--content');
  });

  it('keeps theme variable rules when document attributes match', async () => {
    document.documentElement.setAttribute('data-vxe-ui-theme', 'light');
    document.documentElement.innerHTML = `
      <head>
        <style>
          [data-vxe-ui-theme=light] {
            --vxe-ui-table-border-color: #e8eaec;
            --vxe-ui-table-header-background-color: #f8f8f9;
          }
          [data-vxe-ui-theme=dark] {
            --vxe-ui-table-border-color: #37373a;
          }
          .vxe-table--border-line {
            border: 1px solid var(--vxe-ui-table-border-color);
          }
        </style>
      </head>
      <body><div class="vxe-table--border-line"></div></body>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('--vxe-ui-table-border-color: #e8eaec');
    expect(css).toContain('--vxe-ui-table-header-background-color: #f8f8f9');
    expect(css).toContain('border: 1px solid var(--vxe-ui-table-border-color)');
    expect(css).not.toContain('#37373a');
  });

  it('keeps micro-app layout rules after runtime class normalization', async () => {
    document.documentElement.innerHTML = `
      <head>
        <style>
          .is-in-micro-el .mPane3-back-up .md-table {
            min-height: calc(100vh - 240px) !important;
          }
          .unused-micro-layout .md-table {
            min-height: 1px;
          }
        </style>
      </head>
      <body>
        <micro-app-body class="is-in-micro-el">
          <div class="mPane3-back-up"><div class="md-table"></div></div>
        </micro-app-body>
      </body>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('.is-in-micro-el .mPane3-back-up .md-table');
    expect(css).toContain('calc(100vh - 240px)');
    expect(css).not.toContain('unused-micro-layout');
  });

  it('does not emit source comments for empty style chunks', () => {
    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const css = mergeStyleSources(
      [
        { sourceUrl: 'inline-style', content: '   ' },
        { sourceUrl: 'inline-style', content: '\n\n' },
        { sourceUrl: 'inline-style', content: '.keep { color: green; }' },
      ],
      warnings
    );

    expect(css.match(/source: inline-style/g)).toHaveLength(1);
    expect(css).toContain('.keep { color: green; }');
  });

  it('falls back to document.styleSheets entries that do not expose a DOM owner node', async () => {
    document.documentElement.innerHTML = `
      <head></head>
      <body><div class="all-tables">ok</div></body>
    `;

    const runtimeSheet = {
      href: 'https://example.com/runtime.css',
      media: { mediaText: '' },
      ownerNode: null,
      cssRules: [
        {
          type: 1,
          selectorText: '.all-tables',
          cssText: '.all-tables { border: 1px solid red; }',
        },
      ],
    } as unknown as CSSStyleSheet;

    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [runtimeSheet],
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { preserveInlineStyleElements: true }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/runtime.css');
    expect(css).toContain('.all-tables { border: 1px solid red; }');
    expect(warnings).toEqual([]);
  });

  it('uses data-origin-href for runtime style elements collected from detached roots', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <micro-app-head>
        <style data-origin-href="https://example.com/micro.css">
          .all-tables { border-color: #ddd; }
        </style>
      </micro-app-head>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/micro.css');
    expect(css).toContain('.all-tables { border-color: #ddd; }');
  });

  it('falls back to performance resource entries for stylesheets outside reachable DOM containers', async () => {
    document.body.innerHTML = '<div class="all-tables">ok</div>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url.endsWith('/hidden-runtime.css')
            ? '.all-tables { border-collapse: separate; }'
            : '',
      }))
    );

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'https://example.com/hidden-runtime.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/hidden-runtime.css');
    expect(css).toContain('.all-tables { border-collapse: separate; }');
    expect(warnings).toEqual([]);
  });

  it('does not treat javascript performance resources as stylesheets', async () => {
    document.body.innerHTML = '<div class="all-tables">ok</div>';
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.endsWith('/hidden-runtime.css')
          ? '.all-tables { border-collapse: separate; }'
          : 'window.__xjs = true;',
    }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'https://example.com/hidden-runtime.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
        {
          name: 'https://example.com/xjs/_/js/k=xjs.s.zh.example.cb',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/hidden-runtime.css');
    expect(css).toContain('.all-tables { border-collapse: separate; }');
    expect(css).not.toContain('https://example.com/xjs/_/js/');
    expect(css).not.toContain('window.__xjs = true;');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hidden-runtime.css');
    expect(fetchMock).not.toHaveBeenCalledWith('https://example.com/xjs/_/js/k=xjs.s.zh.example.cb');
  });

  it('does not collect cross-origin performance stylesheets that only match generic host classes', async () => {
    document.body.innerHTML = '<section class="md-container app-container">ok</section>';
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.endsWith('/chunk.app.css') ? '.app-container { padding: 20px; }' : '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'https://xiaoanuat.annto.com/csp/static/css/chunk.app.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://el-uat.annto.com/#/microOtp/order-manage/order-change'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: true }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).not.toContain('https://xiaoanuat.annto.com/csp/static/css/chunk.app.css');
    expect(css).not.toContain('.app-container { padding: 20px; }');
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://xiaoanuat.annto.com/csp/static/css/chunk.app.css'
    );
  });

  it('collects performance stylesheet entries from same-origin iframe documents', async () => {
    document.body.innerHTML = '<iframe id="frame"></iframe><div class="all-tables">ok</div>';
    const frame = document.getElementById('frame') as HTMLIFrameElement;
    const frameDoc = frame.contentDocument as Document;
    frameDoc.open();
    frameDoc.write('<!doctype html><html><head></head><body><div>frame</div></body></html>');
    frameDoc.close();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url.endsWith('/iframe-runtime.css')
            ? '.all-tables { margin-top: 12px; }'
            : '',
      }))
    );

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [];
    });

    ensurePerformanceGetEntriesByType(frame.contentWindow!.performance);
    vi.spyOn(frame.contentWindow!.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'https://example.com/iframe-runtime.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).toContain('source: https://example.com/iframe-runtime.css');
    expect(css).toContain('.all-tables { margin-top: 12px; }');
    expect(warnings).toEqual([]);
  });

  it('skips detached shadow-root styles owned by hidden hosts', async () => {
    document.body.innerHTML = '<div class="all-tables">ok</div><div id="host" style="display:none"></div>';
    const host = document.getElementById('host') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style data-origin-href="https://example.com/hidden-shadow.css">
        .all-tables { margin-top: 88px; }
      </style>
    `;

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).not.toContain('source: https://example.com/hidden-shadow.css');
    expect(css).not.toContain('.all-tables { margin-top: 88px; }');
  });

  it('skips performance stylesheet entries from hidden same-origin iframes', async () => {
    document.body.innerHTML =
      '<iframe id="hidden-frame" style="display:none"></iframe><div class="all-tables">ok</div>';
    const frame = document.getElementById('hidden-frame') as HTMLIFrameElement;
    const frameDoc = frame.contentDocument as Document;
    frameDoc.open();
    frameDoc.write('<!doctype html><html><head></head><body><div>frame</div></body></html>');
    frameDoc.close();

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.endsWith('/hidden-iframe.css') ? '.all-tables { margin-top: 24px; }' : '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [];
    });

    ensurePerformanceGetEntriesByType(frame.contentWindow!.performance);
    vi.spyOn(frame.contentWindow!.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type !== 'resource') {
        return [];
      }

      return [
        {
          name: 'https://example.com/hidden-iframe.css',
          initiatorType: 'link',
        } as PerformanceResourceTiming,
      ];
    });

    const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];
    const sources = await collectStyleSources(
      document,
      new URL('https://example.com/page'),
      warnings,
      { originalDoc: document, preserveInlineStyleElements: true, pruneUnused: false }
    );
    const css = mergeStyleSources(sources, warnings);

    expect(css).not.toContain('source: https://example.com/hidden-iframe.css');
    expect(css).not.toContain('.all-tables { margin-top: 24px; }');
    expect(fetchMock).not.toHaveBeenCalledWith('https://example.com/hidden-iframe.css');
  });

  it('rewrites data, fragment, external font, and background resource URLs', () => {
    const css = rewriteCssResourceUrls(`
      @font-face { src: url("/font.woff2"); }
      @font-face { src: url( "data:font/woff2;base64,abc" ); }
      .icon { background-image: url("#symbol"); }
      .data { background: url( 'data:image/png;base64,abc' ); }
      .hero { background: url("/hero.png"); }
    `);

    expect(css).toContain('src:none');
    expect(css).toContain('background: none');
    expect(css).not.toContain('/font.woff2');
    expect(css).not.toContain('/hero.png');
  });
});
