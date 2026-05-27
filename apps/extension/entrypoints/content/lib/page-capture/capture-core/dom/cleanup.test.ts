import { describe, expect, it, vi } from 'vitest';
import { cleanupCapturedDocument } from './cleanup';
import { SOURCE_INDEX_ATTRIBUTE } from './clone';

describe('capture-core cleanup', () => {
  it('removes executable, policy, preload, hidden, aria-hidden, and zero-size svg nodes', () => {
    document.documentElement.innerHTML = `
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
        <link rel="preload" href="/font.woff2">
        <link rel="prefetch" href="/next.html">
        <link rel="modulepreload" href="/js/main.js">
        <link rel="modulepreload" as="script" href="/js/chunk.js">
        <link rel="dns-prefetch" href="//cdn.example.com">
        <link rel="preconnect" href="https://api.example.com">
        <link rel="prerender" href="/future.html">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <script src="/app.js"></script>
        <noscript>fallback</noscript>
        <section hidden>hidden attr</section>
        <section aria-hidden="true">aria hidden</section>
        <section style="display: none">display hidden</section>
        <svg width="0.0" height="0.0"><symbol id="decimal-zero"></symbol></svg>
        <svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><symbol id="x"></symbol></svg>
        <main>visible</main>
      </body>
    `;

    cleanupCapturedDocument(document);

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('noscript')).toBeNull();
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
    expect(document.querySelector('link[rel="preload"]')).toBeNull();
    expect(document.querySelector('link[rel="prefetch"]')).toBeNull();
    expect(document.querySelector('link[rel="modulepreload"]')).toBeNull();
    expect(document.querySelector('link[rel="dns-prefetch"]')).toBeNull();
    expect(document.querySelector('link[rel="preconnect"]')).toBeNull();
    expect(document.querySelector('link[rel="prerender"]')).toBeNull();
    expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    expect(document.body.textContent).toContain('visible');
    expect(document.body.textContent).not.toContain('hidden attr');
    expect(document.body.textContent).not.toContain('aria hidden');
    expect(document.body.textContent).not.toContain('display hidden');
    expect(document.querySelector('symbol')).toBeNull();
  });

  it('preserves hidden micro-app-head containers so runtime styles remain collectable', () => {
    document.documentElement.innerHTML = `
      <html>
        <head>
          <style>micro-app-head { display: none; }</style>
        </head>
        <body>
          <micro-app>
            <micro-app-head>
              <style data-origin-href="https://example.com/sieve.css">
                micro-app[name=otp-tms] #mPanel4 .all-tables { min-height: 100px; }
              </style>
            </micro-app-head>
            <micro-app-body><div>content</div></micro-app-body>
          </micro-app>
        </body>
      </html>
    `;

    const capturedDoc = document.implementation.createHTMLDocument(document.title);
    capturedDoc.documentElement.innerHTML = document.documentElement.innerHTML;

    cleanupCapturedDocument(capturedDoc, document);

    expect(capturedDoc.querySelector('micro-app-head')).not.toBeNull();
    expect(
      capturedDoc.querySelector('micro-app-head style[data-origin-href=\"https://example.com/sieve.css\"]')
    ).not.toBeNull();
  });

  it('preserves hidden micro-app-head stylesheet descendants during cleanup', () => {
    document.documentElement.innerHTML = `
      <html>
        <head>
          <style>micro-app-head { display: none; }</style>
        </head>
        <body>
          <micro-app>
            <micro-app-head>
              <style data-origin-href="https://example.com/inline.css">.keep-style { color: red; }</style>
              <link rel="stylesheet" href="https://example.com/external.css">
            </micro-app-head>
          </micro-app>
        </body>
      </html>
    `;

    const capturedDoc = document.implementation.createHTMLDocument(document.title);
    capturedDoc.documentElement.innerHTML = document.documentElement.innerHTML;

    cleanupCapturedDocument(capturedDoc, document);

    expect(
      capturedDoc.querySelector('micro-app-head style[data-origin-href=\"https://example.com/inline.css\"]')
    ).not.toBeNull();
    expect(
      capturedDoc.querySelector('micro-app-head link[href=\"https://example.com/external.css\"]')
    ).not.toBeNull();
  });

  it('preserves runtime style elements rendered inside visible result containers', () => {
    document.documentElement.innerHTML = `
      <body>
        <div class="MjjYud">
          <style>
            .N54PNb { display: flex; }
            .LC20lb { font-size: 22px; }
          </style>
          <div class="N54PNb"><h3 class="LC20lb">runtime result</h3></div>
        </div>
      </body>
    `;

    const capturedDoc = document.implementation.createHTMLDocument(document.title);
    capturedDoc.body.innerHTML = document.body.innerHTML;
    for (const [index, element] of Array.from(capturedDoc.body.querySelectorAll('*')).entries()) {
      element.setAttribute(SOURCE_INDEX_ATTRIBUTE, String(index));
    }

    cleanupCapturedDocument(capturedDoc, document);

    expect(capturedDoc.querySelector('style')).not.toBeNull();
    expect(capturedDoc.querySelector('.N54PNb')).not.toBeNull();
    expect(capturedDoc.querySelector('.LC20lb')?.textContent).toBe('runtime result');
  });

  it('uses original computed styles to remove CSS-hidden captured nodes', () => {
    document.documentElement.innerHTML = `
      <head>
        <style>
          .css-display-hidden { display: none; }
          .css-visibility-hidden { visibility: hidden; }
        </style>
      </head>
      <body>
        <section class="css-display-hidden">computed display hidden</section>
        <section class="css-visibility-hidden">computed visibility hidden</section>
        <section style="visibility: hidden">inline visibility hidden</section>
        <svg class="css-display-hidden" width="24" height="24"><path d="M0 0h24v24H0z"></path></svg>
        <main>visible computed</main>
      </body>
    `;

    const capturedDoc = document.implementation.createHTMLDocument(document.title);
    capturedDoc.head.innerHTML = document.head.innerHTML;
    capturedDoc.body.innerHTML = document.body.innerHTML;
    for (const [index, element] of Array.from(capturedDoc.body.querySelectorAll('*')).entries()) {
      element.setAttribute(SOURCE_INDEX_ATTRIBUTE, String(index));
    }

    cleanupCapturedDocument(capturedDoc, document);

    expect(capturedDoc.body.textContent).toContain('visible computed');
    expect(capturedDoc.body.textContent).not.toContain('computed display hidden');
    expect(capturedDoc.body.textContent).not.toContain('computed visibility hidden');
    expect(capturedDoc.body.textContent).not.toContain('inline visibility hidden');
    expect(capturedDoc.querySelector('svg')).toBeNull();
  });

  it('reveals rendered nodes that were saved with animation opacity zero', () => {
    document.documentElement.innerHTML = `
      <body>
        <section id="visible-animation" style="opacity: 0"><p>animated visible content</p></section>
        <section id="display-hidden" style="display: none; opacity: 0">hidden content</section>
      </body>
    `;

    const visible = document.getElementById('visible-animation') as HTMLElement;
    const hidden = document.getElementById('display-hidden') as HTMLElement;
    vi.spyOn(visible, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 80,
      top: 0,
      right: 300,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 80,
      top: 0,
      right: 300,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });

    const capturedDoc = document.implementation.createHTMLDocument(document.title);
    capturedDoc.body.innerHTML = document.body.innerHTML;
    for (const [index, element] of Array.from(capturedDoc.body.querySelectorAll('*')).entries()) {
      element.setAttribute(SOURCE_INDEX_ATTRIBUTE, String(index));
    }

    cleanupCapturedDocument(capturedDoc, document);

    expect(capturedDoc.getElementById('visible-animation')?.getAttribute('style')).toBe(
      'opacity: 1;'
    );
    expect(capturedDoc.getElementById('display-hidden')).toBeNull();
  });

  it('reveals opacity-zero content when source mapping is missing', () => {
    document.documentElement.innerHTML = `
      <body>
        <section id="animated-no-source" style="opacity: 0"><p>late animation content</p></section>
        <section id="hidden-no-source" style="display: none; opacity: 0">hidden content</section>
      </body>
    `;

    cleanupCapturedDocument(document, document);

    expect(document.getElementById('animated-no-source')?.getAttribute('style')).toBe(
      'opacity: 1;'
    );
    expect(document.getElementById('hidden-no-source')).toBeNull();
  });

  it('marks micro-app bodies with the runtime layout class', () => {
    document.body.innerHTML = `
      <micro-app-body>
        <div class="mPane3-back-up">micro content</div>
      </micro-app-body>
    `;

    cleanupCapturedDocument(document);

    expect(document.querySelector('micro-app-body')?.classList.contains('is-in-micro-el')).toBe(
      true
    );
  });
});
