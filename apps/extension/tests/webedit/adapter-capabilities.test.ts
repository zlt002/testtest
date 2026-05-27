// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createWebEditTestWindow, loadWebEditScript } from './load-webedit-script';

describe('webedit runtime adapter capabilities', () => {
  it('exposes alignment, border, insert rows and sort helpers', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    expect(typeof win.__webeditRuntimeAdapter.setRangeAlignment).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.setRangeBorder).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.insertRows).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.sortRange).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.insertDocumentHtml).toBe('function');
  });

  it('writes alignment properties onto a range stub', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    const range: Record<string, any> = {};
    const strategy = await win.__webeditRuntimeAdapter.setRangeAlignment(range, {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
      shrinkToFit: false,
      indent: 2,
      textRotation: 45,
    });

    expect(strategy).toBe('range-alignment-properties');
    expect(range.HorizontalAlignment).toBe('center');
    expect(range.VerticalAlignment).toBe('middle');
    expect(range.WrapText).toBe(true);
    expect(range.ShrinkToFit).toBe(false);
    expect(range.IndentLevel).toBe(2);
    expect(range.Orientation).toBe(45);
  });

  it('writes border properties onto a borders stub', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    const edges = new Map<number, Record<string, any>>();
    const borders = {
      Item(index: number) {
        if (!edges.has(index)) {
          edges.set(index, {});
        }
        return edges.get(index);
      },
    };
    const range = { Borders: borders };

    const strategy = await win.__webeditRuntimeAdapter.setRangeBorder(range, {
      preset: 'outer',
      color: '#d9d9d9',
      style: 'solid',
      weight: 'thin',
    });

    expect(strategy).toBe('Range.Borders');
    expect(edges.get(7)).toMatchObject({ Color: '#d9d9d9', LineStyle: 'solid', Weight: 'thin' });
    expect(edges.get(8)).toMatchObject({ Color: '#d9d9d9', LineStyle: 'solid', Weight: 'thin' });
    expect(edges.get(9)).toMatchObject({ Color: '#d9d9d9', LineStyle: 'solid', Weight: 'thin' });
    expect(edges.get(10)).toMatchObject({ Color: '#d9d9d9', LineStyle: 'solid', Weight: 'thin' });
  });

  it('uses SetBorder fallback for preset-only calls', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    const calls: Array<unknown[]> = [];
    const range = {
      SetBorder(...args: unknown[]) {
        calls.push(args);
        return { ok: true };
      },
    };

    const strategy = await win.__webeditRuntimeAdapter.setRangeBorder(range, {
      preset: 'all',
    });

    expect(strategy).toBe('Range.SetBorder');
    expect(calls).toEqual([['outside', 'solid', '#D9D9D9'], ['inside', 'solid', '#D9D9D9']]);
  });

  it('inserts rows through EntireRow.Insert fallback', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    const calls: string[] = [];
    const insertTarget = {
      Insert() {
        calls.push('insert');
      },
    };
    const range = {
      EntireRow: {
        Offset(rowOffset: number, columnOffset: number) {
          calls.push(`offset:${rowOffset},${columnOffset}`);
          return insertTarget;
        },
        Insert() {
          calls.push('row-insert');
        },
      },
    };

    const result = await win.__webeditRuntimeAdapter.insertRows(range, 2, 'after', {
      copyFormatFrom: 'above',
    });

    expect(result).toEqual({
      writeStrategy: 'EntireRow.Insert',
      count: 2,
      position: 'after',
      copyFormatFrom: 'above',
    });
    expect(calls).toEqual(['offset:1,0', 'insert', 'insert']);
  });

  it('sorts through range.Sort when a sort descriptor exists', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    const calls: Array<unknown[]> = [];
    const range = {
      Sort(...args: unknown[]) {
        calls.push(args);
      },
    };
    const sorts = [{ key: 'B2:B10', order: 'asc' }];

    const result = await win.__webeditRuntimeAdapter.sortRange(range, {
      header: true,
      sorts,
    });

    expect(result).toEqual({
      writeStrategy: 'Range.Sort',
      header: true,
      sorts,
    });
    expect(calls).toHaveLength(1);
  });

  it('detects document mode from officeType and APP.ActiveDocument', async () => {
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            Text: '正文内容',
          },
        },
      },
      officeType: 'document',
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.detectRuntimeMode()).resolves.toBe('document');
  });

  it('falls back to Model.updateWithBeautify when Designer.beautify throws', async () => {
    const beautifyCalls: Array<Record<string, unknown>> = [];
    const fallbackCalls: Array<unknown[]> = [];
    const win = createWebEditTestWindow({
      Model: {
        updateWithBeautify(...args: unknown[]) {
          fallbackCalls.push(args);
        },
      },
      Designer: {
        beautify(args: Record<string, unknown>) {
          beautifyCalls.push(args);
          throw new Error('designer failed');
        },
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.beautifyFlow({ theme: 'default' })).resolves.toEqual({
      supported: true,
      strategy: 'Model.updateWithBeautify',
    });
    expect(beautifyCalls).toEqual([{ theme: 'default' }]);
    expect(fallbackCalls).toEqual([[[], null, 'default']]);
  });

  it('reads document body text and selection text from APP.ActiveDocument APIs', async () => {
    const selection = {
      Text: '当前选区',
    };
    const app = {
      ActiveDocument: {
        Content: {
          Text: '整篇正文',
        },
      },
      Selection: selection,
    };
    const win = createWebEditTestWindow({
      APP: app,
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.getDocumentApplication()).resolves.toBe(app);
    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe('整篇正文');
    await expect(win.__webeditRuntimeAdapter.getDocumentSelection()).resolves.toMatchObject({
      text: '当前选区',
      type: 'Range',
      isCollapsed: false,
      rangeCount: 1,
    });
  });

  it('detects visible comment capability and reads visible comment entries from office iframe DOM', async () => {
    const modalNode = {
      textContent: 'E 是一款面向企业用户的浏... 张龙腾今天 19:24这是评论内容test',
      querySelector(selector: string) {
        const map: Record<string, { textContent: string } | null> = {
          '.anchor-preview': { textContent: 'E 是一款面向企业用户的浏...' },
        };
        return map[selector] || null;
      },
    };
    const commentNodes = [
      {
        className: 'comment-item comment-item-267587853 can-edit',
        textContent: '张龙腾今天 19:24这是评论内容test',
        getAttribute(name: string) {
          if (name === 'data-comment-id') {
            return '267587853';
          }
          return null;
        },
        querySelector(selector: string) {
          const map: Record<string, { textContent: string } | null> = {
            '.comment-info': { textContent: '张龙腾今天 19:24' },
            '.content.comment-text, .comment-text, .content': { textContent: '这是评论内容test' },
          };
          return map[selector] || null;
        },
        closest() {
          return modalNode;
        },
      },
    ];
    const officeIframe = {
      id: 'office-iframe',
      contentDocument: {
        querySelectorAll(selector: string) {
          if (selector === '.comment-item') {
            return commentNodes;
          }
          if (selector === '.comment-modal') {
            return [{}, {}];
          }
          return [];
        },
      },
    };
    const app = {
      ActiveDocument: {
        Content: {
          Text: '整篇正文',
        },
        GetComments() {},
        HasComments() {},
      },
      Selection: {
        Text: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
      },
    };
    const win = createWebEditTestWindow({
      APP: app,
      document: {
        activeElement: null,
        getElementById(id: string) {
          return id === 'office-iframe' ? officeIframe : null;
        },
        readyState: 'complete',
        title: 'test-doc',
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.inspectDocumentCommentRuntime()).resolves.toMatchObject({
      hasApplication: true,
      hasOfficeIframe: true,
      hasCommentApi: true,
      activeDocumentCommentKeys: expect.arrayContaining(['GetComments', 'HasComments']),
      commentDomHints: expect.arrayContaining([{ selector: '.comment-item', count: 1 }]),
    });
    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: true,
      canReadComments: true,
      canInsertText: false,
      canReplaceSelection: false,
    });
    await expect(win.__webeditRuntimeAdapter.readVisibleDocumentComments()).resolves.toEqual([
      {
        id: '267587853',
        author: '张龙腾',
        time: '今天 19:24',
        content: '这是评论内容test',
        anchorPreview: 'E 是一款面向企业用户的浏...',
        anchorText: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
        rawText: '张龙腾今天 19:24这是评论内容test',
        source: 'office-iframe-dom',
      },
    ]);
  });

  it('collects lazy-loaded comments by scrolling the office iframe document', async () => {
    const scrollContainer = {
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 300,
      scrollTo(_x: number, y: number) {
        this.scrollTop = y;
      },
    };
    const createCommentNode = (
      id: string,
      author: string,
      time: string,
      content: string,
      anchorPreview: string
    ) => ({
      className: `comment-item comment-item-${id} can-edit`,
      textContent: `${author} ${time} ${content}`,
      getAttribute(name: string) {
        if (name === 'data-comment-id') {
          return id;
        }
        return null;
      },
      querySelector(selector: string) {
        const map: Record<string, { textContent: string } | null> = {
          '.comment-item-name, .name, .author, .comment-author': { textContent: author },
          '.comment-item-time, .time, .comment-time': { textContent: time },
          '.content.comment-text, .comment-text, .content': { textContent: content },
        };
        return map[selector] || null;
      },
      closest() {
        return {
          textContent: `${anchorPreview} ${author} ${time} ${content}`,
          querySelector(selector: string) {
            const map: Record<string, { textContent: string } | null> = {
              '.anchor-preview': { textContent: anchorPreview },
            };
            return map[selector] || null;
          },
        };
      },
    });
    const officeDocument = {
      scrollingElement: scrollContainer,
      documentElement: null,
      body: null,
      querySelectorAll(selector: string) {
        if (selector === '.comment-item') {
          if (scrollContainer.scrollTop < 300) {
            return [createCommentNode('267587853', '张龙腾', '今天 19:24', '这是评论内容test', 'E 是一款面向企业用户的浏...')];
          }
          if (scrollContainer.scrollTop < 600) {
            return [createCommentNode('267587854', '张龙腾', '今天 19:31', '哈很懂很垂了复赞', 'accr-ui 是一款面向企业用户的浏览器智能办公扩展...')];
          }
          return [createCommentNode('267587855', '张龙腾', '今天 19:40', '再补一条评论', '通过 AI Agent 驱动的自然语言交互...')];
        }
        if (selector === '*') {
          return [scrollContainer];
        }
        return [];
      },
    };
    const officeIframe = {
      id: 'office-iframe',
      contentDocument: officeDocument,
    };
    const app = {
      ActiveDocument: {
        Content: {
          Text: '整篇正文',
        },
        GetComments() {},
        HasComments() {},
      },
      Selection: {
        Text: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
      },
    };
    const win = createWebEditTestWindow({
      APP: app,
      document: {
        activeElement: null,
        getElementById(id: string) {
          return id === 'office-iframe' ? officeIframe : null;
        },
        querySelectorAll() {
          return [officeIframe];
        },
        readyState: 'complete',
        title: 'test-doc',
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(
      win.__webeditRuntimeAdapter.collectDocumentComments({
        maxSteps: 10,
        settleMs: 0,
      })
    ).resolves.toEqual({
      comments: [
        {
          id: '267587853',
          author: '张龙腾',
          time: '今天 19:24',
          content: '这是评论内容test',
          anchorPreview: 'E 是一款面向企业用户的浏...',
          anchorText: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
          rawText: '张龙腾 今天 19:24 这是评论内容test',
          source: 'office-iframe-dom',
        },
        {
          id: '267587854',
          author: '张龙腾',
          time: '今天 19:31',
          content: '哈很懂很垂了复赞',
          anchorPreview: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展...',
          anchorText: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
          rawText: '张龙腾 今天 19:31 哈很懂很垂了复赞',
          source: 'office-iframe-dom',
        },
        {
          id: '267587855',
          author: '张龙腾',
          time: '今天 19:40',
          content: '再补一条评论',
          anchorPreview: '通过 AI Agent 驱动的自然语言交互...',
          anchorText: 'accr-ui 是一款面向企业用户的浏览器智能办公扩展，深度集成 WPS 在线文档与表格编辑能力。',
          rawText: '张龙腾 今天 19:40 再补一条评论',
          source: 'office-iframe-dom',
        },
      ],
      scan: {
        attempted: true,
        scannedContainers: 1,
        steps: 4,
      },
    });
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('inspects document formatting targets from selection and paragraph runtime objects', async () => {
    const selectionFont = {
      Bold: false,
      Italic: false,
      setBold() {},
      setItalic() {},
      setSize() {},
    };
    const paragraphFormat = {
      Alignment: 'left',
      setAlignment() {},
      setFirstLineIndent() {},
      LineSpacing: 1.5,
    };
    const style = {
      Name: '正文',
    };
    const styles = {
      Item() {},
    };
    const webOfficeSdk = {
      execCommand() {},
      getEditor() {},
      toolbarState: {},
    };
    const selection = {
      Text: '当前选区',
      Font: selectionFont,
      ParagraphFormat: paragraphFormat,
      Style: style,
    };
    const app = {
      ActiveDocument: {
        Content: {
          Text: '整篇正文',
        },
        Styles: styles,
      },
      Selection: selection,
    };
    const win = createWebEditTestWindow({
      APP: app,
      WebOfficeSDK: webOfficeSdk,
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.inspectDocumentFormatRuntime()).resolves.toMatchObject({
      hasApplication: true,
      runtimeSource: 'window',
      runtimeGlobalsPresent: ['APP', 'WebOfficeSDK'],
      windowCommandHints: expect.arrayContaining(['WebOfficeSDK']),
      sdkObjects: [
        expect.objectContaining({
          name: 'WebOfficeSDK',
          ownKeys: expect.arrayContaining(['toolbarState']),
          methods: expect.arrayContaining(['execCommand', 'getEditor']),
        }),
      ],
      selectionCommandHints: [],
      selectionRangeCommandHints: [],
      activeDocumentCommandHints: [],
      fontTarget: {
        source: 'Selection.Font',
        canSetBold: true,
        canSetItalic: true,
        canSetSize: true,
      },
      paragraphFormatTarget: {
        source: 'Selection.ParagraphFormat',
        canSetAlignment: true,
        canSetFirstLineIndent: true,
        canSetLineSpacing: true,
      },
      styleTarget: {
        source: 'Selection.Style',
      },
      stylesCollectionTarget: {
        source: 'ActiveDocument.Styles',
      },
    });
  });

  it('reads spreadsheet context from callable proxy-style APP properties', async () => {
    const selectionRange = {
      getRow() {
        return 1;
      },
      getColumn() {
        return 1;
      },
      getText() {
        return 'A1';
      },
      getAddress() {
        return 'A1';
      },
      getValue2() {
        return '测试值';
      },
      getRows() {
        return {
          getCount() {
            return 1;
          },
        };
      },
      getColumns() {
        return {
          getCount() {
            return 1;
          },
        };
      },
    };
    const activeSheet = {
      Name: 'Sheet1',
      Index: 1,
      UsedRange() {
        return selectionRange;
      },
      Range(address: string) {
        return address === 'A1' ? selectionRange : null;
      },
    };
    const app = {
      ActiveWorkbook() {
        return {
          Name: 'Book1',
        };
      },
      Workbook() {
        return {
          Name: 'Book1',
        };
      },
      ActiveSheet() {
        return activeSheet;
      },
      Selection() {
        return selectionRange;
      },
      ActiveCell() {
        return selectionRange;
      },
    };
    const win = createWebEditTestWindow({
      APP: app,
      __WPSENV__: {
        officeType: 'spreadsheet',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.detectRuntimeMode()).resolves.toBe('spreadsheet');
    await expect(win.__webeditRuntimeAdapter.getWorkbookInfo(app)).resolves.toEqual({
      workbookName: 'Book1',
      activeSheetName: 'Sheet1',
      activeSheetIndex: 1,
    });
    await expect(win.__webeditRuntimeAdapter.summarizeRange(await win.__webeditRuntimeAdapter.getSelectionRange(app))).resolves.toEqual({
      address: 'A1',
      text: 'A1',
      formula: null,
      value2: '测试值',
      row: 1,
      column: 1,
      rowsCount: 1,
      columnsCount: 1,
    });
    await expect(win.__webeditRuntimeAdapter.getUsedRange(app)).resolves.toBe(selectionRange);
    await expect(win.__webeditRuntimeAdapter.getRangeByAddress(app, 'A1')).resolves.toBe(
      selectionRange
    );
  });

  it('does not treat scalar setters as reliable matrix write APIs', async () => {
    const win = createWebEditTestWindow();
    const setValue2Calls: unknown[] = [];
    const range = {
      setValue2(value: unknown) {
        setValue2Calls.push(value);
      },
    };

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(
      win.__webeditRuntimeAdapter.writeRangeMatrix(range, [
        ['A1', 'B1'],
        ['A2', 'B2'],
      ])
    ).resolves.toBeNull();
    expect(setValue2Calls).toEqual([]);
  });

  it('uses dedicated matrix setters for range matrix writes', async () => {
    const win = createWebEditTestWindow();
    const setValuesCalls: unknown[] = [];
    const range = {
      setValues(value: unknown) {
        setValuesCalls.push(value);
      },
    };
    const values = [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ];

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.writeRangeMatrix(range, values)).resolves.toEqual({
      writeStrategy: 'setValues',
      values: values,
    });
    expect(setValuesCalls).toEqual([values]);
  });

  it('lists document capabilities and reports write unsupported without a real write API', async () => {
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            Text: '整篇正文',
          },
        },
        Selection: {
          Text: '当前选区',
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: true,
      canReadComments: false,
      canInsertText: false,
      canReplaceSelection: false,
    });
    await expect(
      win.__webeditRuntimeAdapter.insertDocumentText('补充内容')
    ).resolves.toEqual({
      supported: false,
      reason: 'document-write-api-not-detected',
    });
    await expect(
      win.__webeditRuntimeAdapter.replaceDocumentSelection('替换内容')
    ).resolves.toEqual({
      supported: false,
      reason: 'document-write-api-not-detected',
    });
  });

  it('falls back to Selection.Range.TypeText for document writes', async () => {
    let textContent = '整篇正文';
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            get Text() {
              return textContent;
            },
          },
        },
        Selection: {
          Text: '',
          Range: {
            TypeText(text: string) {
              textContent += text;
            },
          },
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: true,
      canReadComments: false,
      canInsertText: true,
      canReplaceSelection: true,
    });
    await expect(win.__webeditRuntimeAdapter.insertDocumentText('补充内容')).resolves.toEqual({
      supported: true,
      writeStrategy: 'Selection.Range.TypeText',
    });
    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe(
      '整篇正文补充内容'
    );
  });

  it('reports caret selection metadata when Selection.Range exists', async () => {
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            Text: '整篇正文',
          },
        },
        Selection: {
          Text: '',
          Range: {},
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.getDocumentSelection()).resolves.toMatchObject({
      text: '',
      type: 'Caret',
      isCollapsed: true,
      rangeCount: 1,
      hasRange: true,
    });
  });

  it('inspects document runtime methods and write target separately for insert/replace', async () => {
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            Text: '整篇正文',
            InsertAfter() {},
          },
          Save() {},
        },
        Selection: {
          Text: '',
          Range: {
            InsertAfter() {},
          },
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: true,
      canReadComments: false,
      canInsertText: true,
      canReplaceSelection: false,
    });

    await expect(win.__webeditRuntimeAdapter.inspectDocumentRuntime()).resolves.toMatchObject({
      hasApplication: true,
      writeTarget: {
        strategy: 'Selection.Range.InsertAfter',
        method: 'InsertAfter',
        supportsInsert: true,
        supportsReplace: false,
      },
      selectionRangeMethods: expect.arrayContaining(['InsertAfter']),
      activeDocumentMethods: expect.arrayContaining(['Save']),
      documentContentMethods: expect.arrayContaining(['InsertAfter']),
    });
  });

  it('prefers Selection.Range.PasteHtml over Selection.InsertAfter when both are available', async () => {
    const pastedHtml: string[] = [];
    const insertedText: string[] = [];
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content: {
            Text: '整篇正文',
          },
        },
        Selection: {
          Text: '',
          InsertAfter(text: string) {
            insertedText.push(text);
          },
          Range: {
            PasteHtml(html: string) {
              pastedHtml.push(html);
            },
          },
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.inspectDocumentRuntime()).resolves.toMatchObject({
      writeTarget: {
        strategy: 'Selection.Range.PasteHtml',
        method: 'PasteHtml',
        valueKind: 'html',
        supportsInsert: true,
        supportsReplace: true,
      },
    });

    await expect(win.__webeditRuntimeAdapter.insertDocumentText('第三次光标写入验证')).resolves.toEqual({
      supported: true,
      writeStrategy: 'Selection.Range.PasteHtml',
    });
    expect(pastedHtml).toEqual(['第三次光标写入验证']);
    expect(insertedText).toEqual([]);

    await expect(win.__webeditRuntimeAdapter.insertDocumentHtml('<p>富文本写入</p>')).resolves.toEqual({
      supported: true,
      writeStrategy: 'Selection.Range.PasteHtml',
    });
    expect(pastedHtml).toEqual(['第三次光标写入验证', '<p>富文本写入</p>']);
  });

  it('reads document text from ActiveDocument.Content() and writes through ActiveDocument.Range.PasteHtml', async () => {
    let documentText = '第一段';
    const pastedHtml: string[] = [];
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content() {
            return {
              get Text() {
                return documentText;
              },
            };
          },
          Range() {
            return {
              PasteHtml(html: string) {
                pastedHtml.push(html);
                documentText += '\n第二段';
              },
            };
          },
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe('第一段');
    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: false,
      canReadComments: false,
      canInsertText: true,
      canReplaceSelection: true,
    });
    await expect(
      win.__webeditRuntimeAdapter.insertDocumentText('第二段')
    ).resolves.toEqual({
      supported: true,
      writeStrategy: 'ActiveDocument.Range.PasteHtml',
    });
    expect(pastedHtml).toEqual(['第二段']);
    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe('第一段\n第二段');
  });

  it('falls back to ActiveDocument.Content.PasteHtml when Selection() throws', async () => {
    let documentText = '原文';
    const pastedHtml: string[] = [];
    const win = createWebEditTestWindow({
      APP: {
        ActiveDocument: {
          Content() {
            return {
              get Text() {
                return documentText;
              },
              PasteHtml(html: string) {
                pastedHtml.push(html);
                documentText = '更新后';
              },
            };
          },
          Selection() {
            throw new TypeError('s is not a function');
          },
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.listDocumentCapabilities()).resolves.toEqual({
      mode: 'document',
      hasApplication: true,
      canReadBodyText: true,
      canReadSelection: false,
      canReadComments: false,
      canInsertText: true,
      canReplaceSelection: true,
    });

    await expect(win.__webeditRuntimeAdapter.inspectDocumentRuntime()).resolves.toMatchObject({
      hasApplication: true,
      writeTarget: {
        strategy: 'ActiveDocument.Content.PasteHtml',
        method: 'PasteHtml',
        valueKind: 'html',
        supportsInsert: true,
        supportsReplace: true,
      },
      activeDocumentMethods: expect.arrayContaining(['Content', 'Selection']),
      documentContentMethods: expect.arrayContaining(['PasteHtml']),
    });

    await expect(
      win.__webeditRuntimeAdapter.replaceDocumentSelection('替换文本')
    ).resolves.toEqual({
      supported: true,
      writeStrategy: 'ActiveDocument.Content.PasteHtml',
    });
    expect(pastedHtml).toEqual(['替换文本']);
    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe('更新后');
  });

  it('supports thenable function proxies used by WPSOpenApi.Application members', async () => {
    let documentText = '代理正文';
    const pastedHtml: string[] = [];
    const createThenableProxy = <T extends object>(value: T) => {
      const proxy = function proxyFn() {};
      (proxy as typeof proxy & { then: (resolve: (value: T) => unknown) => unknown }).then = (
        resolve: (value: T) => unknown
      ) => resolve(value);
      Object.assign(proxy, value);
      return proxy;
    };
    const content = {
      get Text() {
        return documentText;
      },
      PasteHtml(html: string) {
        pastedHtml.push(html);
        documentText = `${documentText}|已写入`;
      },
    };
    const range = {
      PasteHtml(html: string) {
        pastedHtml.push(`range:${html}`);
      },
    };
    const activeDocument = {
      Content: createThenableProxy(content),
      Range: createThenableProxy(range),
      Selection: createThenableProxy({
        get Text() {
          return '';
        },
      }),
    };
    const win = createWebEditTestWindow({
      WPSOpenApi: {
        Application: {
          ActiveDocument: createThenableProxy(activeDocument),
        },
      },
      __WPSENV__: {
        officeType: 'document',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.readDocumentText()).resolves.toBe('代理正文');
    await expect(win.__webeditRuntimeAdapter.inspectDocumentRuntime()).resolves.toMatchObject({
      hasApplication: true,
      writeTarget: {
        strategy: 'ActiveDocument.Range.PasteHtml',
        method: 'PasteHtml',
        valueKind: 'html',
      },
      documentContentMethods: expect.arrayContaining(['PasteHtml']),
    });
    await expect(win.__webeditRuntimeAdapter.insertDocumentText('代理写入')).resolves.toEqual({
      supported: true,
      writeStrategy: 'ActiveDocument.Range.PasteHtml',
    });
    expect(pastedHtml).toEqual(['range:代理写入']);
  });

  it('detects flow mode from flow iframe runtime and reads definition', async () => {
    const beautifyCalls: unknown[] = [];
    const addMultiCalls: unknown[] = [];
    const removeCalls: unknown[] = [];
    let generatedIdCounter = 0;
    const flowElements = {
      node_1: {
        id: 'node_1',
        name: 'roundRectangle',
        props: { x: 80, y: 80, w: 160, h: 60 },
        textBlock: [{ text: '开始' }],
        anchors: [{ x: 1, y: 0.5, angle: 0 }],
      },
      linker_1: {
        id: 'linker_1',
        name: 'linker',
        from: { id: 'node_1', x: 240, y: 110, angle: 0 },
        to: { id: 'node_2', x: 320, y: 110, angle: 3.1415926 },
      },
    };
    const flowWindow = {
      location: {
        href: 'https://webedit.midea.com/c/backendservice/flow/pom/index.html?chartId=abc',
      },
      Model: {
        define: {
          elements: flowElements,
        },
        addMulti(elements: unknown[]) {
          addMultiCalls.push(elements);
        },
        remove(elements: unknown[]) {
          removeCalls.push(elements);
        },
      },
      Designer: {
        beautify(input: unknown) {
          beautifyCalls.push(input);
        },
      },
      Utils: {
        newId() {
          return `generated_${generatedIdCounter++}`;
        },
      },
      Schema: {},
      MessageSource: {},
      Beautify: {},
      smartAiHelpCon: {
        powerSearch() {},
      },
      editorGlobalConfig: {
        showSmartGraph: true,
      },
    };
    const thirdIframe = {
      id: 'third-iframe',
      contentWindow: flowWindow,
    };
    const win = createWebEditTestWindow({
      document: {
        activeElement: null,
        getElementById(id: string) {
          return id === 'third-iframe' ? thirdIframe : null;
        },
        querySelectorAll(selector: string) {
          return selector === 'iframe' ? [thirdIframe] : [];
        },
        readyState: 'complete',
        title: 'flow-doc',
      },
      location: {
        href: 'https://webedit.midea.com/moewebv7/document-cloud?editId=flow-doc',
        origin: 'https://webedit.midea.com',
        pathname: '/moewebv7/document-cloud',
        search: '?editId=flow-doc',
      },
    });

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    await expect(win.__webeditRuntimeAdapter.detectRuntimeMode()).resolves.toBe('flow');
    expect(win.__webeditRuntimeAdapter.getFlowEditorWindow()).toBe(flowWindow);
    await expect(win.__webeditRuntimeAdapter.listFlowCapabilities()).resolves.toMatchObject({
      mode: 'flow',
      hasModel: true,
      hasDesigner: true,
      canReadDefinition: true,
      canApplyDefinition: true,
      canBeautify: true,
      hasSmartAiEntry: true,
      currentDefinition: {
        nodesCount: 1,
        edgesCount: 1,
      },
    });
    expect(win.__webeditRuntimeAdapter.readFlowDefinition()).toMatchObject({
      nodes: [expect.objectContaining({ id: 'node_1', name: 'roundRectangle' })],
      edges: [expect.objectContaining({ id: 'linker_1', name: 'linker' })],
    });
    await expect(win.__webeditRuntimeAdapter.inspectFlowRuntime()).resolves.toMatchObject({
      flowGlobalsPresent: expect.arrayContaining(['Model', 'Designer', 'smartAiHelpCon']),
      editorGlobalConfig: {
        showSmartGraph: true,
      },
    });

    await expect(win.__webeditRuntimeAdapter.beautifyFlow({ theme: 'default' })).resolves.toEqual({
      supported: true,
      strategy: 'Designer.beautify',
    });
    expect(beautifyCalls).toEqual([{ theme: 'default' }]);

    await expect(
      win.__webeditRuntimeAdapter.addFlowElements({
        nodes: [{ id: 'node_2', text: '结束', x: 320, y: 80 }],
        edges: [{ fromId: 'node_1', toId: 'node_2', text: '下一步' }],
      })
    ).resolves.toMatchObject({
      supported: true,
      writeStrategy: 'Model.addMulti',
      nodesCount: 1,
      edgesCount: 1,
    });
    expect(addMultiCalls).toHaveLength(1);
    expect(addMultiCalls[0]?.[1]).toMatchObject({
      name: 'linker',
      from: { id: 'node_1' },
      to: { id: 'generated_0' },
      text: '下一步',
    });
    await expect(
      win.__webeditRuntimeAdapter.addFlowElements({
        nodes: [
          { id: 'node_3', text: '审批开始', x: 520, y: 80 },
          { id: 'node_4', text: '审批结束', x: 760, y: 80 },
        ],
        edges: [{ from: 'node_3', to: 'node_4', text: '完成' }],
      })
    ).resolves.toMatchObject({
      supported: true,
      writeStrategy: 'Model.addMulti',
      nodesCount: 2,
      edgesCount: 1,
    });
    expect(addMultiCalls[1]?.[2]).toMatchObject({
      name: 'linker',
      from: { id: 'generated_2' },
      to: { id: 'generated_3' },
      text: '完成',
    });
    expect(removeCalls).toEqual([]);
  });
});
