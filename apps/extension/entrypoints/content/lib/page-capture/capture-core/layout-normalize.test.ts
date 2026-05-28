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
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
              <thead>
                <tr>
                  <th class="el-table_2_column_6 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_7 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_8 el-table__cell">客户系</th>
                  <th class="el-table_2_column_91 is-hidden el-table__cell"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper is-scrolling-middle">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_6 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_7 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_8 el-table__cell">其他</td>
                  <td class="el-table_2_column_91 is-hidden el-table__cell"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="el-table__fixed">
            <div class="el-table__fixed-header-wrapper">
              <table>
                <thead>
                  <tr><th class="el-table_2_column_6 el-table__cell">客户编码</th><th class="el-table_2_column_7 el-table__cell">客户名称</th></tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr><td class="el-table_2_column_6 el-table__cell">A2605260010</td><td class="el-table_2_column_7 el-table__cell">青岛盛和货运代理有限公司</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="el-table__fixed-right">
            <div class="el-table__fixed-header-wrapper">
              <table>
                <thead>
                  <tr><th class="el-table_2_column_91 el-table__cell">操作</th></tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr><td class="el-table_2_column_91 el-table__cell"><a>编辑</a></td></tr>
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
  });

  it('flattens fixed columns back into the main table before removing duplicated fixed layers', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
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
          <div class="el-table__body-wrapper is-scrolling-left">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_5 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_6 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_7 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_8 el-table__cell">其他</td>
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
                    <th class="el-table_2_column_5 el-table__cell">选择</th>
                    <th class="el-table_2_column_6 el-table__cell">客户编码</th>
                    <th class="el-table_2_column_7 el-table__cell">客户名称</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_5 el-table__cell"><label>勾选</label></td>
                    <td class="el-table_2_column_6 el-table__cell">A2605260010</td>
                    <td class="el-table_2_column_7 el-table__cell">青岛盛和货运代理有限公司</td>
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
                    <th class="el-table_2_column_91 el-table__cell">操作</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_91 el-table__cell"><a>编辑</a></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const mainCells = Array.from(capturedDoc.querySelectorAll('.el-table__body .el-table__cell'));
    const cellTexts = mainCells.map((cell) => cell.textContent?.trim() || '');
    const mainHeaders = Array.from(capturedDoc.querySelectorAll('.el-table__header .el-table__cell'));
    const headerTexts = mainHeaders.map((cell) => cell.textContent?.trim() || '');
    const leftBodyCells = mainCells.slice(0, 3) as HTMLElement[];
    const leftHeaderCells = mainHeaders.slice(0, 3) as HTMLElement[];
    const rightBodyCell = mainCells[4] as HTMLElement;
    const rightHeaderCell = mainHeaders[4] as HTMLElement;

    expect(capturedDoc.querySelector('.el-table__fixed')).toBeNull();
    expect(capturedDoc.querySelector('.el-table__fixed-right')).toBeNull();
    expect(cellTexts).toEqual(['勾选', 'A2605260010', '青岛盛和货运代理有限公司', '其他', '编辑']);
    expect(headerTexts).toEqual(['选择', '客户编码', '客户名称', '客户系', '操作']);
    expect(mainCells.every((cell) => !cell.classList.contains('is-hidden'))).toBe(true);
    expect(mainHeaders.every((cell) => !cell.classList.contains('is-hidden'))).toBe(true);
    expect(leftBodyCells.map((cell) => [cell.style.position, cell.style.left])).toEqual([
      ['sticky', '0px'],
      ['sticky', '0px'],
      ['sticky', '0px'],
    ]);
    expect(leftHeaderCells.map((cell) => [cell.style.position, cell.style.left])).toEqual([
      ['sticky', '0px'],
      ['sticky', '0px'],
      ['sticky', '0px'],
    ]);
    expect(rightBodyCell.style.position).toBe('sticky');
    expect(rightBodyCell.style.right).toBe('0px');
    expect(leftBodyCells.every((cell) => cell.style.backgroundColor === 'rgb(255, 255, 255)' || cell.style.backgroundColor === '#fff')).toBe(true);
    expect(rightBodyCell.style.backgroundColor === 'rgb(255, 255, 255)' || rightBodyCell.style.backgroundColor === '#fff').toBe(true);
    expect(rightHeaderCell.style.position).toBe('sticky');
    expect(rightHeaderCell.style.right).toBe('0px');
    expect(rightHeaderCell.style.backgroundColor === 'rgb(255, 255, 255)' || rightHeaderCell.style.backgroundColor === '#fff').toBe(true);
  });

  it('applies cumulative sticky offsets for multi-column fixed sides', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
              <thead>
                <tr>
                  <th class="el-table_2_column_6 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_7 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_8 el-table__cell">中间列</th>
                  <th class="el-table_2_column_90 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_91 is-hidden el-table__cell"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper is-scrolling-middle">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_6 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_7 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_8 el-table__cell">中间内容</td>
                  <td class="el-table_2_column_90 is-hidden el-table__cell"></td>
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
                    <th class="el-table_2_column_6 el-table__cell"><div class="cell" style="width: 50px;">左一</div></th>
                    <th class="el-table_2_column_7 el-table__cell"><div class="cell" style="width: 80px;">左二</div></th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_6 el-table__cell"><div class="cell" style="width: 50px;">L1</div></td>
                    <td class="el-table_2_column_7 el-table__cell"><div class="cell" style="width: 80px;">L2</div></td>
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
                    <th class="el-table_2_column_90 el-table__cell"><div class="cell" style="width: 60px;">右二</div></th>
                    <th class="el-table_2_column_91 el-table__cell"><div class="cell" style="width: 90px;">右一</div></th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_90 el-table__cell"><div class="cell" style="width: 60px;">R2</div></td>
                    <td class="el-table_2_column_91 el-table__cell"><div class="cell" style="width: 90px;">R1</div></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const leftFirst = capturedDoc.querySelector('.el-table__body .el-table_2_column_6') as HTMLElement;
    const leftSecond = capturedDoc.querySelector('.el-table__body .el-table_2_column_7') as HTMLElement;
    const rightSecond = capturedDoc.querySelector('.el-table__body .el-table_2_column_90') as HTMLElement;
    const rightFirst = capturedDoc.querySelector('.el-table__body .el-table_2_column_91') as HTMLElement;

    expect(leftFirst.style.left).toBe('0px');
    expect(leftSecond.style.left).toBe('50px');
    expect(rightSecond.style.right).toBe('90px');
    expect(rightFirst.style.right).toBe('0px');
  });

  it('does not remove a fixed layer when only the header copied successfully', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
              <thead>
                <tr>
                  <th class="el-table_2_column_6 is-hidden el-table__cell"></th>
                  <th class="el-table_2_column_7 is-hidden el-table__cell"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper is-scrolling-left">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_6 is-hidden el-table__cell"></td>
                  <td class="el-table_2_column_7 is-hidden el-table__cell"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="el-table__fixed">
            <div class="el-table__fixed-header-wrapper">
              <table>
                <thead>
                  <tr>
                    <th class="el-table_2_column_6 el-table__cell">客户编码</th>
                    <th class="el-table_2_column_7 el-table__cell">客户名称</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_6 el-table__cell"></td>
                    <td class="el-table_2_column_7 el-table__cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    expect(capturedDoc.querySelector('.el-table__fixed')).not.toBeNull();
    expect(capturedDoc.querySelector('.el-table__body .el-table_2_column_6')?.classList.contains('is-hidden')).toBe(
      true
    );
    expect(capturedDoc.body.textContent).toContain('客户编码');
  });

  it('does not let empty fixed cells overwrite visible main-table content', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
              <thead>
                <tr>
                  <th class="el-table_2_column_6 el-table__cell">客户编码</th>
                  <th class="el-table_2_column_7 el-table__cell">客户名称</th>
                  <th class="el-table_2_column_8 el-table__cell">客户系</th>
                  <th class="el-table_2_column_91 is-hidden el-table__cell"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper is-scrolling-left">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_6 el-table__cell">A2605260010</td>
                  <td class="el-table_2_column_7 el-table__cell">青岛盛和货运代理有限公司</td>
                  <td class="el-table_2_column_8 el-table__cell">国内注册（法人/个体户）</td>
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
                    <th class="el-table_2_column_6 el-table__cell">客户编码</th>
                    <th class="el-table_2_column_7 el-table__cell">客户名称</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_6 el-table__cell"></td>
                    <td class="el-table_2_column_7 el-table__cell"></td>
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
                    <th class="el-table_2_column_91 el-table__cell">操作</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_91 el-table__cell"><a>编辑</a></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const mainCells = Array.from(capturedDoc.querySelectorAll('.el-table__body .el-table__cell')).map((cell) =>
      cell.textContent?.trim() || ''
    );

    expect(mainCells).toEqual(['A2605260010', '青岛盛和货运代理有限公司', '国内注册（法人/个体户）', '编辑']);
    expect(capturedDoc.querySelector('.el-table__fixed')).not.toBeNull();
    expect(capturedDoc.querySelector('.el-table__fixed-right')).toBeNull();
  });

  it('reuses visible duplicate cells as sticky targets when the main table already contains the fixed content', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="el-table el-table--scrollable-x el-table--border">
          <div class="el-table__header-wrapper">
            <table class="el-table__header">
              <thead>
                <tr>
                  <th class="el-table_2_column_6 el-table__cell">客户编码</th>
                  <th class="el-table_2_column_91 el-table__cell">操作</th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper is-scrolling-middle">
            <table class="el-table__body">
              <tbody>
                <tr>
                  <td class="el-table_2_column_6 el-table__cell">A2605260010</td>
                  <td class="el-table_2_column_91 el-table__cell"><a>编辑</a></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="el-table__fixed-right">
            <div class="el-table__fixed-header-wrapper">
              <table>
                <thead>
                  <tr>
                    <th class="el-table_2_column_91 el-table__cell">操作</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="el-table__fixed-body-wrapper">
              <table>
                <tbody>
                  <tr>
                    <td class="el-table_2_column_91 el-table__cell"><a>编辑</a></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const actionHeader = capturedDoc.querySelector('.el-table__header .el-table_2_column_91') as HTMLElement;
    const actionCell = capturedDoc.querySelector('.el-table__body .el-table_2_column_91') as HTMLElement;

    expect(capturedDoc.querySelector('.el-table__fixed-right')).toBeNull();
    expect(actionHeader.style.position).toBe('sticky');
    expect(actionHeader.style.right).toBe('0px');
    expect(actionCell.style.position).toBe('sticky');
    expect(actionCell.style.right).toBe('0px');
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

  it('does not fall back to freezing the toolbar when the wide content layer has no inline width', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div
          class="table-scroll"
          data-capture-scroll-left="280"
          style="overflow:auto; width: 320px;"
        >
          <div class="table-toolbar">工具条</div>
          <div
            class="table-content"
            data-capture-content-root="true"
            style="margin-left: 8px;"
          >
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
    expect(content?.style.marginLeft).toBe('calc(-272px)');
    expect(capturedDoc.body.textContent).toContain('当前视口中部列');
  });

  it('freezes Element UI header and body tables together for horizontally scrolled tables', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div
          class="el-table"
          data-capture-scroll-left="420"
          style="overflow:auto; width: 320px;"
        >
          <div class="el-table__header-wrapper" style="overflow: hidden;">
            <table class="el-table__header" style="width: 1280px;">
              <thead>
                <tr><th>表头A</th><th>表头B</th><th>表头C</th></tr>
              </thead>
            </table>
          </div>
          <div class="el-table__body-wrapper" style="overflow: auto hidden;">
            <table class="el-table__body" style="width: 1280px;">
              <tbody>
                <tr><td>内容A</td><td>内容B</td><td>内容C</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const table = capturedDoc.querySelector('.el-table') as HTMLElement | null;
    const headerTable = capturedDoc.querySelector('.el-table__header') as HTMLElement | null;
    const bodyTable = capturedDoc.querySelector('.el-table__body') as HTMLElement | null;

    expect(table?.getAttribute('data-capture-scroll-left')).toBeNull();
    expect(table?.style.overflowX).toBe('hidden');
    expect(headerTable?.style.marginLeft).toBe('-420px');
    expect(bodyTable?.style.marginLeft).toBe('-420px');
  });

  it('freezes VXE header and body tables together for the captured horizontal scroll position', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="vxe-table--render-wrapper">
          <div class="vxe-table--main-wrapper">
            <div class="vxe-table--header-wrapper body--wrapper" style="overflow: hidden;">
              <div class="vxe-body--x-space" style="width: 14681px;"></div>
              <table class="vxe-table--header" style="width: 1487px; margin-left: 0px;">
                <thead><tr><th>订单号</th><th>客户订单号</th></tr></thead>
              </table>
            </div>
            <div
              class="vxe-table--body-wrapper body--wrapper"
              data-capture-scroll-left="420"
              style="min-height: 110px; height: 694px; overflow: auto;"
            >
              <div class="vxe-body--x-space" style="width: 14681px;"></div>
              <div class="vxe-body--y-space" style="height: 350px;"></div>
              <table class="vxe-table--body" style="width: 1487px; margin-left: 0px; margin-top: 0px;">
                <tbody><tr><td>IN12605281343488274</td><td>TCL2600528001</td></tr></tbody>
              </table>
            </div>
          </div>
          <div class="vxe-table--fixed-right-wrapper">
            <div class="vxe-table--body-wrapper fixed-right--wrapper">
              <table class="vxe-table--body" style="width: 170px;"><tbody><tr><td>修改 复制</td></tr></tbody></table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const bodyWrapper = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper') as HTMLElement | null;
    const headerTable = capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper .vxe-table--header') as HTMLElement | null;
    const bodyTable = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper .vxe-table--body') as HTMLElement | null;
    const fixedRightTable = capturedDoc.querySelector('.vxe-table--body-wrapper.fixed-right--wrapper .vxe-table--body') as HTMLElement | null;

    expect(bodyWrapper?.getAttribute('data-capture-scroll-left')).toBeNull();
    expect(bodyWrapper?.style.overflowX).toBe('hidden');
    expect(headerTable?.style.marginLeft).toBe('calc(-420px)');
    expect(bodyTable?.style.marginLeft).toBe('calc(-420px)');
    expect(fixedRightTable?.style.marginLeft).toBe('');
  });

  it('preserves VXE fixed-left and fixed-right wrappers to match the live layout model', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="vxe-table--render-wrapper">
          <div class="vxe-table--main-wrapper">
            <div class="vxe-table--header-wrapper body--wrapper" style="overflow: hidden;">
              <table class="vxe-table--header" style="width: 3640px;">
                <colgroup>
                  <col name="col_60" style="width: 120px;">
                  <col name="col_61" style="width: 140px;">
                </colgroup>
                <thead>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_58" colid="col_58"></th>
                    <th class="vxe-header--column col_95" colid="col_95"></th>
                  </tr>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_60" colid="col_60">费用申请单号</th>
                    <th class="vxe-header--column col_61" colid="col_61">物流单号</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="vxe-table--body-wrapper body--wrapper" style="overflow: auto;">
              <table class="vxe-table--body" style="width: 3640px;">
                <colgroup>
                  <col name="col_60" style="width: 120px;">
                  <col name="col_61" style="width: 140px;">
                </colgroup>
                <tbody>
                  <tr class="vxe-body--row">
                    <td class="vxe-body--column col_60" colid="col_60">CR202511100004</td>
                    <td class="vxe-body--column col_61" colid="col_61">GLS2504982L1</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="vxe-table--fixed-left-wrapper">
            <div class="vxe-table--header-wrapper fixed-left--wrapper" style="position: absolute; inset: 0px -3590px 0px 0px; overflow: hidden;">
              <table class="vxe-table--header" style="width: 3640px;">
                <colgroup>
                  <col name="col_59" style="width: 50px;">
                </colgroup>
                <thead>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_58" colid="col_58"></th>
                  </tr>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_59 col--fixed" colid="col_59">
                      <div class="vxe-cell" style="width: 48px;"><label>勾选</label></div>
                    </th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="vxe-table--body-wrapper fixed-left--wrapper" style="position: absolute; inset: 81px -40px 0px 0px; overflow: hidden auto;">
              <table class="vxe-table--body" style="width: 3640px;">
                <colgroup>
                  <col name="col_59" style="width: 50px;">
                </colgroup>
                <tbody>
                  <tr class="vxe-body--row">
                    <td class="vxe-body--column col_59 col--fixed" colid="col_59"><div class="vxe-cell"><label>勾选</label></div></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="vxe-table--fixed-right-wrapper">
            <div class="vxe-table--header-wrapper fixed-right--wrapper" style="position: absolute; inset: 0px 0px 0px -3460px; overflow: hidden auto;">
              <table class="vxe-table--header" style="width: 3640px;">
                <colgroup>
                  <col name="col_96" style="width: 180px;">
                </colgroup>
                <thead>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_95" colid="col_95"></th>
                  </tr>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_96 col--fixed" colid="col_96">
                      <div class="vxe-cell" style="width: 178px;">操作</div>
                    </th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="vxe-table--body-wrapper fixed-right--wrapper" style="position: absolute; inset: 81px 0px 0px -3460px; overflow: hidden auto;">
              <table class="vxe-table--body" style="width: 3640px;">
                <colgroup>
                  <col name="col_96" style="width: 180px;">
                </colgroup>
                <tbody>
                  <tr class="vxe-body--row">
                    <td class="vxe-body--column col_96 col--fixed" colid="col_96">
                      <div class="vxe-cell"><button>复制新增</button><button>详情</button></div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const mainHeaderRows = Array.from(capturedDoc.querySelectorAll('.vxe-table--header-wrapper.body--wrapper tr'));
    const mainBodyRow = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper tr') as HTMLElement;
    const secondHeaderRowCells = Array.from(mainHeaderRows[1]?.children || []).map((cell) =>
      (cell.textContent || '').trim()
    );
    const bodyTexts = Array.from(mainBodyRow.children).map((cell) => (cell.textContent || '').trim());
    const leftHeader = capturedDoc.querySelector('.vxe-table--header-wrapper.fixed-left--wrapper th[colid="col_59"]') as HTMLElement | null;
    const rightHeader = capturedDoc.querySelector('.vxe-table--header-wrapper.fixed-right--wrapper th[colid="col_96"]') as HTMLElement | null;
    const leftCell = capturedDoc.querySelector('.vxe-table--body-wrapper.fixed-left--wrapper td[colid="col_59"]') as HTMLElement | null;
    const rightCell = capturedDoc.querySelector('.vxe-table--body-wrapper.fixed-right--wrapper td[colid="col_96"]') as HTMLElement | null;
    const mainHeaderTable = capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper table') as HTMLElement | null;
    const mainBodyTable = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper table') as HTMLElement | null;

    expect(capturedDoc.querySelector('.vxe-table--fixed-left-wrapper')).not.toBeNull();
    expect(capturedDoc.querySelector('.vxe-table--fixed-right-wrapper')).not.toBeNull();
    expect(secondHeaderRowCells).toEqual(['费用申请单号', '物流单号']);
    expect(bodyTexts).toEqual(['CR202511100004', 'GLS2504982L1']);
    expect(leftHeader?.textContent?.trim()).toBe('勾选');
    expect(rightHeader?.textContent?.trim()).toBe('操作');
    expect(leftCell?.textContent?.trim()).toBe('勾选');
    expect(rightCell?.textContent?.trim()).toBe('复制新增详情');
    expect(capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper colgroup col[name="col_59"]')).toBeNull();
    expect(capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper colgroup col[name="col_96"]')).toBeNull();
    expect(mainHeaderTable?.style.width).toBe('3640px');
    expect(mainBodyTable?.style.width).toBe('3640px');
  });

  it('preserves VXE nested fixed wrappers so the captured page keeps the original fixed-column layout', async () => {
    const capturedDoc = createCapturedDocument({
      body: `
        <div class="vxe-table--render-wrapper">
          <div class="vxe-table--main-wrapper">
            <div class="vxe-table--header-wrapper body--wrapper" style="overflow: hidden;">
              <div class="vxe-body--x-space" style="width: 14681px;"></div>
              <table class="vxe-table--header" style="width: 1387px; margin-left: 0px;">
                <colgroup>
                  <col name="col_2" style="width: 42px;">
                  <col name="col_109" style="width: 285px;">
                  <col name="col_110" style="width: 200px;">
                  <col name="col_3" style="width: 170px;">
                </colgroup>
                <thead>
                  <tr class="vxe-header--row">
                    <th class="vxe-header--column col_109" colid="col_109">订单号</th>
                    <th class="vxe-header--column col_110" colid="col_110">客户订单号</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div class="vxe-table--body-wrapper body--wrapper" style="min-height: 110px; height: 694px; overflow: auto;">
              <div class="vxe-body--x-space" style="width: 14681px;"></div>
              <div class="vxe-body--y-space" style="height: 350px;"></div>
              <table class="vxe-table--body" style="width: 1387px; margin-left: 0px; margin-top: 0px;">
                <colgroup>
                  <col name="col_2" style="width: 42px;">
                  <col name="col_109" style="width: 285px;">
                  <col name="col_110" style="width: 200px;">
                  <col name="col_3" style="width: 170px;">
                </colgroup>
                <tbody>
                  <tr class="vxe-body--row" rowid="row_211">
                    <td class="vxe-body--column col_109" colid="col_109"><div class="vxe-cell" style="width: 283px;">IN12605281145158169</div></td>
                    <td class="vxe-body--column col_110" colid="col_110"><div class="vxe-cell" style="width: 198px;">CN010300049337505</div></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="vxe-table--fixed-wrapper">
            <div class="vxe-table--fixed-left-wrapper">
              <div class="vxe-table--header-wrapper fixed-left--wrapper" style="position: absolute; inset: 0px 0px 683px;">
                <table class="vxe-table--header" style="width: 42px;">
                  <colgroup>
                    <col name="col_2" style="width: 42px;">
                  </colgroup>
                  <thead>
                    <tr class="vxe-header--row">
                      <th class="vxe-header--column col_2 col--fixed" colid="col_2">
                        <div class="vxe-cell" style="width: 40px;">勾选</div>
                      </th>
                    </tr>
                  </thead>
                </table>
              </div>
              <div class="vxe-table--body-wrapper fixed-left--wrapper" style="height: 683px; inset: 34px -40px 0px 0px; position: absolute; overflow: hidden auto;">
                <div class="vxe-body--y-space" style="height: 350px;"></div>
                <table class="vxe-table--body" style="margin-top: 0px; width: 42px;">
                  <colgroup>
                    <col name="col_2" style="width: 42px;">
                  </colgroup>
                  <tbody>
                    <tr class="vxe-body--row" rowid="row_211">
                      <td class="vxe-body--column col_2 col--fixed" colid="col_2"><div class="vxe-cell" style="width: 40px;">勾选</div></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="vxe-table--fixed-right-wrapper scrolling--middle" style="height: 717px; width: 170px; position: absolute; inset: 0px 0px 11px 1190px; overflow: hidden;">
              <div class="vxe-table--header-wrapper fixed-right--wrapper" style="position: absolute; inset: 0px 0px 683px; overflow: hidden auto;">
                <table class="vxe-table--header" style="width: 170px;">
                  <colgroup>
                    <col name="col_3" style="width: 170px;">
                  </colgroup>
                  <thead>
                    <tr class="vxe-header--row">
                      <th class="vxe-header--column col_3 col--fixed" colid="col_3">
                        <div class="vxe-cell" style="width: 168px;">操作</div>
                      </th>
                    </tr>
                  </thead>
                </table>
              </div>
              <div class="vxe-table--body-wrapper fixed-right--wrapper" style="height: 683px; inset: 34px 0px 0px; position: absolute; overflow: hidden auto;">
                <div class="vxe-body--y-space" style="height: 350px;"></div>
                <table class="vxe-table--body" style="margin-top: 0px; width: 170px;">
                  <colgroup>
                    <col name="col_3" style="width: 170px;">
                  </colgroup>
                  <tbody>
                    <tr class="vxe-body--row" rowid="row_211">
                      <td class="vxe-body--column col_3 col--fixed" colid="col_3">
                        <div class="vxe-cell" style="width: 168px;">复制</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `,
    });

    const { normalizeCapturedLayout } = await loadNormalizeCapturedLayout();
    normalizeCapturedLayout(capturedDoc);

    const mainHeaderRow = capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper tr');
    const mainBodyRow = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper tr');
    const headerTexts = Array.from(mainHeaderRow?.children || []).map((cell) => (cell.textContent || '').trim());
    const bodyTexts = Array.from(mainBodyRow?.children || []).map((cell) => (cell.textContent || '').trim());
    const leftCell = capturedDoc.querySelector('.vxe-table--body-wrapper.fixed-left--wrapper td[colid="col_2"]') as HTMLElement | null;
    const rightCell = capturedDoc.querySelector('.vxe-table--body-wrapper.fixed-right--wrapper td[colid="col_3"]') as HTMLElement | null;
    const mainHeaderTable = capturedDoc.querySelector('.vxe-table--header-wrapper.body--wrapper table') as HTMLElement | null;
    const mainBodyTable = capturedDoc.querySelector('.vxe-table--body-wrapper.body--wrapper table') as HTMLElement | null;

    expect(capturedDoc.querySelector('.vxe-table--fixed-wrapper')).not.toBeNull();
    expect(headerTexts).toEqual(['订单号', '客户订单号']);
    expect(bodyTexts).toEqual(['IN12605281145158169', 'CN010300049337505']);
    expect(mainHeaderTable?.style.width).toBe('1387px');
    expect(mainBodyTable?.style.width).toBe('1387px');
    expect(leftCell?.textContent?.trim()).toBe('勾选');
    expect(rightCell?.textContent?.trim()).toBe('复制');
  });
});
