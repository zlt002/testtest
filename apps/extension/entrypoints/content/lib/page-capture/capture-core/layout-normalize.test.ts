import { describe, expect, it } from 'vitest';

async function loadNormalizeCapturedLayout() {
  return import('./layout-normalize');
}

function createCapturedDocument(parts: { head?: string; body: string }): Document {
  const capturedDoc = document.implementation.createHTMLDocument('captured layout');
  capturedDoc.head.innerHTML = parts.head ?? '';
  capturedDoc.body.innerHTML = parts.body;
  return capturedDoc;
}

describe('normalizeCapturedLayout', () => {
  it('removes duplicated Element UI fixed column layers while preserving the main table content', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
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
                  <tr><td>固定列副本</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="el-table__fixed-right">
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr><td>操作列副本</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    expect(capturedDoc.body.textContent).toContain('青岛盛和货运代理有限公司');
    expect(capturedDoc.body.textContent).toContain('编辑');
    expect(capturedDoc.querySelector('.el-table__fixed')).toBeNull();
    expect(capturedDoc.querySelector('.el-table__fixed-right')).toBeNull();
    expect(capturedDoc.body.textContent).not.toContain('固定列副本');
    expect(capturedDoc.body.textContent).not.toContain('操作列副本');
  });

  it('drops known floating overlay containers and explicit ignore markers from the captured DOM', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <main>
          <section class="workspace-body">客户管理列表</section>
        </main>
        <div class="feedback_tabs_main">我要建议</div>
        <div id="INTELLIGENCE">帮助中心</div>
        <div data-html2canvas-ignore="true">截图工具浮层</div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    expect(capturedDoc.body.textContent).toContain('客户管理列表');
    expect(capturedDoc.querySelector('.feedback_tabs_main')).toBeNull();
    expect(capturedDoc.querySelector('#INTELLIGENCE')).toBeNull();
    expect(capturedDoc.querySelector('[data-html2canvas-ignore="true"]')).toBeNull();
  });

  it('freezes horizontal scroll state into the normalized snapshot markup', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div
          class="table-scroll"
          data-capture-scroll-left="420"
          style="overflow:auto; width: 320px;"
        >
          <div class="table-content" style="width: 1280px;">
            <span>左侧冻结前内容</span>
            <span>当前视口中部列</span>
            <span>右侧隐藏列</span>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const scrollContainer = capturedDoc.querySelector('.table-scroll') as HTMLElement | null;
    const content = capturedDoc.querySelector('.table-content') as HTMLElement | null;

    expect(scrollContainer).not.toBeNull();
    expect(content).not.toBeNull();
    expect(scrollContainer?.getAttribute('data-capture-scroll-left')).toBeNull();
    expect(capturedDoc.body.textContent).toContain('当前视口中部列');
    expect(capturedDoc.body.textContent).not.toContain('data-capture-scroll-left');
  });

  it('freezes the actual wide content layer when a scroll container has multiple direct children', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div
          class="table-scroll"
          data-capture-scroll-left="420"
          style="overflow:auto; width: 320px;"
        >
          <div class="table-toolbar" style="width: 120px;">工具条</div>
          <div class="table-content" style="width: 1280px; margin-left: 16px;">
            <span>左侧冻结前内容</span>
            <span>当前视口中部列</span>
            <span>右侧隐藏列</span>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const scrollContainer = capturedDoc.querySelector('.table-scroll') as HTMLElement | null;
    const toolbar = capturedDoc.querySelector('.table-toolbar') as HTMLElement | null;
    const content = capturedDoc.querySelector('.table-content') as HTMLElement | null;

    expect(scrollContainer?.getAttribute('data-capture-scroll-left')).toBeNull();
    expect(toolbar?.style.marginLeft).toBe('');
    expect(content?.style.marginLeft).toBe('calc(-404px)');
    expect(capturedDoc.body.textContent).toContain('当前视口中部列');
  });
});
