import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePageDocument } from './index';

describe('capture-core fixture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures a WebScrapBook-style folder page fixture without external assets', async () => {
    document.documentElement.innerHTML = `
      <head>
        <title>Fixture Page</title>
        <link rel="stylesheet" href="/app.css">
        <style>
          .inline-visible { color: teal; }
          .inline-image { background: url("/inline.png"); }
          .css-hidden-panel { visibility: hidden; }
        </style>
      </head>
      <body>
        <section hidden>hidden text</section>
        <section aria-hidden="true">aria hidden text</section>
        <section class="css-hidden-panel">css hidden text</section>
        <svg width="0" height="0" style="position:absolute">
          <symbol id="sprite"><path d="M0 0h1v1H0z"></path></symbol>
        </svg>
        <main>
          <h1 class="fixture-visible inline-visible">Visible capture text</h1>
          <img src="/hero.png" width="320" height="180" alt="Hero">
          <svg width="24" height="24" aria-label="Visible icon">
            <path d="M0 0h24v24H0z"></path>
          </svg>
        </main>
      </body>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return {
          ok: true,
          text: async () => {
            if (url.endsWith('/app.css')) {
              return [
                '@import url("/imported.css");',
                '.fixture-bg { background-image: url("/remote.png"); }',
                '@font-face { font-family: Fixture; src: url("/fixture.woff2"); }',
              ].join('\n');
            }

            return [
              '.fixture-visible { color: rgb(1, 2, 3); }',
              '.imported-bg { background: url("/imported.png"); }',
            ].join('\n');
          },
        };
      })
    );

    const artifact = await capturePageDocument(document, {
      mode: 'page',
      baseUrl: 'https://example.com/articles/fixture.html',
      capturedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(artifact.html).toContain('<link rel="stylesheet" href="style.css">');
    const placeholderMatches = artifact.html.match(/data-webmcp-placeholder="resource"/g) || [];
    expect(placeholderMatches).toHaveLength(2);
    expect(artifact.html).toContain('aria-label="img placeholder"');
    expect(artifact.html).toContain('aria-label="svg placeholder"');
    expect(artifact.html).toContain('Visible capture text');
    expect(artifact.html).not.toContain('hidden text');
    expect(artifact.html).not.toContain('aria hidden text');
    expect(artifact.html).not.toContain('css hidden text');
    expect(artifact.html).not.toContain('<symbol');
    expect(artifact.html).not.toContain('/app.css');
    expect(artifact.html).not.toContain('<style>');
    expect(artifact.html).not.toContain('.inline-visible');

    expect(artifact.styles).toHaveLength(1);
    expect(artifact.styles[0]).toMatchObject({ path: 'style.css' });
    expect(artifact.styles[0]?.content).toContain('.fixture-visible { color: rgb(1, 2, 3); }');
    expect(artifact.styles[0]?.content).toContain('.inline-visible { color: teal; }');
    expect(artifact.styles[0]?.content).not.toContain('/remote.png');
    expect(artifact.styles[0]?.content).not.toContain('/imported.png');
    expect(artifact.styles[0]?.content).not.toContain('/inline.png');
    expect(artifact.styles[0]?.content).not.toContain('/fixture.woff2');
    expect(artifact.assets).toEqual([]);
  });
});
