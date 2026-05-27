import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeCaptureArtifact } from './serialize';

describe('serialize capture artifact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes page mode with WebScrapBook capture-core output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('main{color:red;background:url("/hero.png")}')
    );
    document.documentElement.innerHTML =
      '<head><title>示例</title><link rel="stylesheet" href="/styles/app.css"><style>.inline{background-image:url("https://cdn.example.com/bg.png")}</style></head><body><main><img src="/hero.png" width="320" height="180"><p>正文</p><p hidden>隐藏</p></main></body>';

    const artifact = await serializeCaptureArtifact(document, {
      mode: 'page',
      baseUrl: 'https://example.com/post',
      capturedAt: '2026-05-12T00:00:00.000Z',
      elementSelectionSummary: undefined,
    });

    expect(artifact.mode).toBe('page');
    expect(artifact.styles).toHaveLength(1);
    expect(artifact.styles[0]?.path).toBe('style.css');
    expect(artifact.styles[0]?.content).toContain('main{color:red;background:none}');
    expect(artifact.styles[0]?.content).not.toContain('.inline{background-image:none}');
    expect(artifact.styles[0]?.content).not.toContain('/hero.png');
    expect(artifact.styles[0]?.content).not.toContain('cdn.example.com/bg.png');
    expect(artifact.assets).toEqual([]);
    expect(artifact.html).toContain('<main>');
    expect(artifact.html).toContain('<link rel="stylesheet" href="style.css">');
    expect(artifact.html).toContain(
      '<style>.inline{background-image:url(&quot;https://cdn.example.com/bg.png&quot;)}</style>'
    );
    expect(artifact.html).toContain('data-webmcp-placeholder="resource"');
    expect(artifact.html).not.toContain('<img');
    expect(artifact.html).not.toContain('隐藏');
    expect(artifact.metadata.originalUrl).toBe('https://example.com/post');
    expect(artifact.metadata.capturePresetVersion).toBe('webscrapbook-folder-v1');
  });

  it('serializes only the target element subtree in element mode', async () => {
    document.documentElement.innerHTML =
      '<head><title>示例</title><style>#target{color:red}.outside{color:blue}</style></head><body><main><article id="target"><p>正文</p><img src="/element.png"><p>忽略</p></article><p class="outside">外部忽略</p></main></body>';

    const artifact = await serializeCaptureArtifact(document, {
      mode: 'element',
      baseUrl: 'https://example.com/post',
      capturedAt: '2026-05-12T00:00:00.000Z',
      targetElement: document.getElementById('target') as Element,
      elementSelectionSummary: '正文',
    });

    expect(artifact.mode).toBe('element');
    expect(artifact.html).toContain('正文');
    expect(artifact.html).toContain('忽略');
    expect(artifact.html).not.toContain('外部忽略');
    expect(artifact.html).toContain('<link rel="stylesheet" href="style.css">');
    expect(artifact.html).toContain('data-webmcp-placeholder="resource"');
    expect(artifact.html).not.toContain('<img');
    expect(artifact.styles).toHaveLength(1);
    expect(artifact.styles[0]?.path).toBe('style.css');
    expect(artifact.styles[0]?.content).toContain('#target');
    expect(artifact.styles[0]?.content).not.toContain('.outside');
    expect(artifact.assets).toEqual([]);
    expect(artifact.metadata.elementSelectionSummary).toBe('正文');
    expect(artifact.metadata.capturePresetVersion).toBe('webscrapbook-folder-v1');
  });

  it('only injects minimal computed layout styles for structural containers', async () => {
    document.documentElement.innerHTML = `
      <head>
        <title>示例</title>
        <style>
          .runtime-card {
            display: flex;
            gap: 12px;
            margin: 8px 4px;
            padding: 10px;
            font-size: 18px;
            line-height: 24px;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <main><section class="runtime-card">card</section></main>
      </body>
    `;

    const artifact = await serializeCaptureArtifact(document, {
      mode: 'page',
      baseUrl: 'https://example.com/post',
      capturedAt: '2026-05-12T00:00:00.000Z',
      elementSelectionSummary: undefined,
    });

    expect(artifact.html).toContain(
      '<section class="runtime-card" style="display: flex; gap: 12px;">card</section>'
    );
    expect(artifact.html).not.toContain('font-size: 18px;');
    expect(artifact.html).not.toContain('line-height: 24px;');
    expect(artifact.html).not.toContain('overflow: hidden;');
    expect(artifact.styles[0]?.content).toContain('.runtime-card {');
  });

  it('prunes unused selectors from linked stylesheet content in page mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`
        .used-pane { color: red; }
        .unused-pane { color: blue; }
        .toolbar .used-button { display: inline-flex; }
        .toolbar .unused-button { display: none; }
        @media screen {
          .used-pane .nested { padding: 4px; }
          .unused-pane .nested { padding: 8px; }
        }
      `)
    );

    document.documentElement.innerHTML = `
      <head>
        <title>示例</title>
        <link rel="stylesheet" href="/styles/app.css">
      </head>
      <body>
        <main class="used-pane">
          <div class="toolbar"><button class="used-button">按钮</button></div>
          <div class="nested">正文</div>
        </main>
      </body>
    `;

    const artifact = await serializeCaptureArtifact(document, {
      mode: 'page',
      baseUrl: 'https://example.com/post',
      capturedAt: '2026-05-12T00:00:00.000Z',
      elementSelectionSummary: undefined,
    });

    expect(artifact.styles[0]?.content).toContain('.used-pane { color: red; }');
    expect(artifact.styles[0]?.content).toContain('.toolbar .used-button { display: inline-flex; }');
    expect(artifact.styles[0]?.content).toContain('.used-pane .nested { padding: 4px; }');
    expect(artifact.styles[0]?.content).not.toContain('.unused-pane { color: blue; }');
    expect(artifact.styles[0]?.content).not.toContain('.toolbar .unused-button { display: none; }');
    expect(artifact.styles[0]?.content).not.toContain('.unused-pane .nested { padding: 8px; }');
  });
});
