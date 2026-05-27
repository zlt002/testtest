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

  it('captures back-office table fixtures without preserving duplicate fixed columns or floating overlays', async () => {
    document.documentElement.innerHTML = `
      <head>
        <title>CRM Customer Manage</title>
        <style>
          .workspace-shell { display: flex; }
          .table-scroll { overflow: auto; width: 960px; }
          .el-table__body-wrapper { overflow: auto; }
        </style>
      </head>
      <body>
        <main class="workspace-shell">
          <section class="business-pane">
            <div class="table-scroll">
              <div class="el-table el-table--scrollable-x">
                <div class="el-table__body-wrapper is-scrolling-middle">
                  <table>
                    <tbody>
                      <tr>
                        <td>客户编码</td>
                        <td>A2605260010</td>
                        <td>青岛盛和货运代理有限公司</td>
                        <td><a>编辑</a></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="el-table__fixed">
                  <div class="el-table__fixed-body-wrapper">
                    <table>
                      <tbody>
                        <tr>
                          <td><label>选择列副本</label></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="el-table__fixed-right">
                  <div class="el-table__fixed-body-wrapper">
                    <table>
                      <tbody>
                        <tr>
                          <td><a>编辑</a></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
        <div class="feedback_tabs_main">我要建议</div>
        <div id="INTELLIGENCE">帮助中心</div>
        <div data-html2canvas-ignore="true">截图工具浮层</div>
      </body>
    `;

    const artifact = await capturePageDocument(document, {
      mode: 'page',
      baseUrl: 'https://crm-uat.annto.com/index.html#/mod/mdm/customer-manage',
      capturedAt: '2026-05-27T12:28:06.000Z',
    });

    expect(artifact.html).toContain('青岛盛和货运代理有限公司');
    expect(artifact.html).toContain('A2605260010');
    expect(artifact.html).not.toContain('feedback_tabs_main');
    expect(artifact.html).not.toContain('INTELLIGENCE');
    expect(artifact.html).not.toContain('截图工具浮层');
    expect(artifact.html).not.toContain('el-table__fixed');
    expect(artifact.html).not.toContain('el-table__fixed-right');
  });
});
