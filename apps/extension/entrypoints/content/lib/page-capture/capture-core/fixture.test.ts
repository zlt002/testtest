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
    expect(placeholderMatches).toHaveLength(1);
    expect(artifact.html).toContain('aria-label="img placeholder"');
    expect(artifact.html).not.toContain('aria-label="svg placeholder"');
    expect(artifact.html).toContain('<svg width="24" height="24" aria-label="Visible icon">');
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
    expect(artifact.styles[0]?.content).toContain('.fixture-visible{ color: rgb(1, 2, 3); }');
    expect(artifact.styles[0]?.content).toContain('.inline-visible {color: teal;}');
    expect(artifact.styles[0]?.content).not.toContain('/remote.png');
    expect(artifact.styles[0]?.content).not.toContain('/imported.png');
    expect(artifact.styles[0]?.content).not.toContain('/inline.png');
    expect(artifact.styles[0]?.content).not.toContain('/fixture.woff2');
    expect(artifact.assets).toEqual([]);
  });

  it('captures back-office table fixtures while flattening realistic Element UI fixed columns', async () => {
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
                <div class="el-table__header-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th class="el-table_2_column_5 is-hidden el-table__cell"></th>
                        <th class="el-table_2_column_6 is-hidden el-table__cell"></th>
                        <th class="el-table_2_column_7 is-hidden el-table__cell"></th>
                        <th class="el-table_2_column_8 el-table__cell">客户系</th>
                        <th class="el-table_2_column_91 is-hidden el-table__cell"></th>
                      </tr>
                    </thead>
                  </table>
                </div>
                <div class="el-table__body-wrapper is-scrolling-middle">
                  <table>
                    <tbody>
                      <tr>
                        <td class="el-table_2_column_5 is-hidden el-table__cell"></td>
                        <td class="el-table_2_column_6 is-hidden el-table__cell"></td>
                        <td class="el-table_2_column_7 is-hidden el-table__cell"></td>
                        <td class="el-table_2_column_8 el-table__cell">客户系</td>
                        <td class="el-table_2_column_91 is-hidden el-table__cell"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="el-table__fixed">
                  <div class="el-table__fixed-header-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th class="el-table_2_column_5 el-table__cell"><div class="cell" style="width: 50px;">选择</div></th>
                          <th class="el-table_2_column_6 el-table__cell"><div class="cell" style="width: 120px;">客户编码</div></th>
                          <th class="el-table_2_column_7 el-table__cell"><div class="cell" style="width: 180px;">客户名称</div></th>
                        </tr>
                      </thead>
                    </table>
                  </div>
                  <div class="el-table__fixed-body-wrapper">
                    <table>
                      <tbody>
                        <tr>
                          <td class="el-table_2_column_5 el-table__cell"><div class="cell" style="width: 50px;"><label>选择列副本</label></div></td>
                          <td class="el-table_2_column_6 el-table__cell"><div class="cell" style="width: 120px;">A2605260010</div></td>
                          <td class="el-table_2_column_7 el-table__cell"><div class="cell" style="width: 180px;">青岛盛和货运代理有限公司</div></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="el-table__fixed-right">
                  <div class="el-table__fixed-header-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th class="el-table_2_column_91 el-table__cell"><div class="cell" style="width: 90px;">操作</div></th>
                        </tr>
                      </thead>
                    </table>
                  </div>
                  <div class="el-table__fixed-body-wrapper">
                    <table>
                      <tbody>
                        <tr>
                          <td class="el-table_2_column_91 el-table__cell"><div class="cell" style="width: 90px;"><a>编辑</a></div></td>
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
    expect(artifact.html).toContain('position: sticky; left: 0px;');
    expect(artifact.html).toContain('position: sticky; right: 0px;');
  });

  it('injects a lightweight header scroll-sync runtime for captured split table wrappers', async () => {
    document.documentElement.innerHTML = `
      <head>
        <title>Scroll Sync Fixture</title>
      </head>
      <body>
        <div class="vxe-table vxe-table--render-default">
          <div class="vxe-table--render-wrapper">
            <div class="vxe-table--main-wrapper">
              <div class="vxe-table--header-wrapper body--wrapper">
                <div class="vxe-body--x-space" style="width: 14462px;"></div>
                <table class="vxe-table--header" style="width: 1832px; margin-left: 0px;">
                  <thead><tr><th colid="col_109">订单号</th></tr></thead>
                </table>
              </div>
              <div class="vxe-table--body-wrapper body--wrapper" style="min-height: 110px; height: 522px;">
                <div class="vxe-body--x-space" style="width: 14462px;"></div>
                <div class="vxe-body--y-space" style="height: 350px;"></div>
                <table class="vxe-table--body" style="width: 1832px; margin-left: 0px; margin-top: 0px;">
                  <tbody><tr><td colid="col_109">IN22605281348348284</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </body>
    `;

    const artifact = await capturePageDocument(document, {
      mode: 'page',
      baseUrl: 'https://el-uat.annto.com/v3/#/microOms/order-manage/order-center',
      capturedAt: '2026-05-28T06:40:00.000Z',
    });

    expect(artifact.html).toContain('data-webmcp-runtime="scroll-sync"');
    expect(artifact.html).toContain('vxe-table--body-wrapper.body--wrapper');
    expect(artifact.html).toContain('el-table__body-wrapper');
    expect(artifact.html).toContain('headerTable.style.marginLeft');
    expect(artifact.html).toContain("bodyWrapper.addEventListener('scroll'");
  });
});
