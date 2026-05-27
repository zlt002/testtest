// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createWebEditTestWindow, loadWebEditScript } from './load-webedit-script';

type ToolHandler = (args?: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function parseToolResult(result: Awaited<ReturnType<ToolHandler>>) {
  return JSON.parse(result.content[0].text);
}

async function loadDocumentToolWindow(overrides: Record<string, unknown> = {}) {
  const win = createWebEditTestWindow(overrides);
  await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
  await loadWebEditScript(win, 'apps/extension/public/webedit/tools/document.js');
  return win;
}

describe('webedit document tools', () => {
  it('注册 document tools', async () => {
    const win = await loadDocumentToolWindow();
    const names: string[] = [];

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {},
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(name: string) {
        names.push(name);
      },
    });

    expect(names).toEqual(
      expect.arrayContaining([
        'webedit_get_document_context',
        'webedit_get_document_selection',
        'webedit_read_document_text',
        'webedit_debug_document_api',
        'webedit_get_visible_comments',
        'webedit_collect_document_comments',
        'webedit_insert_text_at_cursor',
        'webedit_replace_selection_text',
        'webedit_replace_selection_rich_text',
      ])
    );
  });

  it('在 document runtime 下返回结构化上下文和正文', async () => {
    const win = await loadDocumentToolWindow({
      document: {
        activeElement: null,
        body: {
          innerText: '第一段\n第二段',
          textContent: '第一段\n第二段',
        },
        getElementById: () => null,
        querySelector: () => null,
        readyState: 'complete',
        title: '文档标题',
      },
      getSelection() {
        return {
          type: 'Range',
          isCollapsed: false,
          rangeCount: 1,
          toString() {
            return '已选中文本';
          },
        };
      },
      location: {
        href: 'https://webedit.midea.com/moewebv7/document-cloud?editId=doc-1',
        origin: 'https://webedit.midea.com',
        pathname: '/moewebv7/document-cloud',
        search: '?editId=doc-1',
      },
    });

    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        detectDocumentIdentity() {
          return {
            href: 'https://webedit.midea.com/moewebv7/document-cloud?editId=doc-1',
            title: '文档标题',
            pathname: '/moewebv7/document-cloud',
            editId: 'doc-1',
          };
        },
        getRuntimeFlags() {
          return { hasAPP: false };
        },
        isRuntimeReady() {
          return true;
        },
        summarizeDomSelection() {
          return {
            text: '已选中文本',
            isCollapsed: false,
            rangeCount: 1,
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const contextPayload = parseToolResult(
      await tools.get('webedit_get_document_context')?.({})
    );
    expect(contextPayload.ok).toBe(true);
    expect(contextPayload.data).toMatchObject({
      mode: 'document',
      runtimeReady: true,
      document: {
        title: '文档标题',
        editId: 'doc-1',
      },
      capabilities: {
        canReadText: true,
        canReadSelection: true,
        canReadComments: false,
        canInsertText: false,
        canReplaceSelection: false,
      },
    });

    const textPayload = parseToolResult(
      await tools.get('webedit_read_document_text')?.({})
    );
    expect(textPayload.ok).toBe(true);
    expect(textPayload.data.documentText).toMatchObject({
      text: '第一段\n第二段',
      source: 'document-body',
    });
  });

  it('返回文档 API 探测结果', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        getRuntimeFlags() {
          return { hasAPP: true };
        },
        detectDocumentIdentity() {
          return {
            href: 'https://webedit.midea.com/weboffice/office/w/123?editId=doc-2',
            title: '文档标题',
            pathname: '/weboffice/office/w/123',
            editId: 'doc-2',
          };
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canReadComments: true,
            canInsertText: false,
            canReplaceSelection: false,
          };
        },
        async inspectDocumentRuntime() {
          return {
            hasApplication: true,
            writeTarget: null,
            selectionMethods: ['TypeText'],
            selectionRangeMethods: ['InsertAfter'],
          };
        },
        async inspectDocumentFormatRuntime() {
          return {
            fontTarget: {
              source: 'Selection.Font',
              canSetBold: true,
              canSetItalic: true,
            },
            paragraphFormatTarget: {
              source: 'Selection.ParagraphFormat',
              canSetAlignment: true,
            },
          };
        },
        async inspectDocumentCommentRuntime() {
          return {
            hasCommentApi: true,
            commentDomHints: [{ selector: '.comment-item', count: 1 }],
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_debug_document_api')?.({});
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      mode: 'document',
      document: {
        title: '文档标题',
        editId: 'doc-2',
      },
      runtimeFlags: {
        hasAPP: true,
      },
      capabilities: {
        canReadComments: true,
        canInsertText: false,
        canReplaceSelection: false,
      },
      apiProbe: {
        hasApplication: true,
        writeTarget: null,
        selectionMethods: ['TypeText'],
        selectionRangeMethods: ['InsertAfter'],
      },
      formatApiProbe: {
        fontTarget: {
          source: 'Selection.Font',
          canSetBold: true,
          canSetItalic: true,
        },
        paragraphFormatTarget: {
          source: 'Selection.ParagraphFormat',
          canSetAlignment: true,
        },
      },
      commentApiProbe: {
        hasCommentApi: true,
        commentDomHints: [{ selector: '.comment-item', count: 1 }],
      },
    });
  });

  it('返回当前页面已展示的评论列表', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canReadComments: true,
            canInsertText: false,
            canReplaceSelection: false,
          };
        },
        async readVisibleDocumentComments() {
          return [
            {
              id: 'comment-1',
              author: '张龙腾',
              time: '今天 19:24',
              content: '这是评论内容test',
              rawText: '张龙腾 今天 19:24 这是评论内容test',
              source: 'office-iframe-dom',
            },
          ];
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_get_visible_comments')?.({});
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      mode: 'document',
      count: 1,
      comments: [
        {
          id: 'comment-1',
          author: '张龙腾',
          time: '今天 19:24',
          content: '这是评论内容test',
          source: 'office-iframe-dom',
        },
      ],
    });
  });

  it('通过自动滚动采集评论列表', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canReadComments: true,
            canInsertText: false,
            canReplaceSelection: false,
          };
        },
        async collectDocumentComments() {
          return {
            comments: [
              {
                id: 'comment-1',
                author: '张龙腾',
                time: '今天 19:24',
                content: '这是评论内容test',
                source: 'office-iframe-dom',
              },
              {
                id: 'comment-2',
                author: '张龙腾',
                time: '今天 19:31',
                content: '哈很懂很垂了复赞',
                source: 'office-iframe-dom',
              },
            ],
            scan: {
              attempted: true,
              scannedContainers: 1,
              steps: 3,
            },
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_collect_document_comments')?.({
      maxSteps: 10,
      settleMs: 20,
    });
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      mode: 'document',
      count: 2,
      scan: {
        attempted: true,
        scannedContainers: 1,
        steps: 3,
      },
      comments: [
        {
          id: 'comment-1',
          content: '这是评论内容test',
        },
        {
          id: 'comment-2',
          content: '哈很懂很垂了复赞',
        },
      ],
    });
  });

  it('空文本光标场景会合并 DOM 选区状态', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async getDocumentSelection() {
          return {
            text: '',
            source: 'Selection.Text',
          };
        },
        summarizeDomSelection() {
          return {
            text: '',
            isCollapsed: true,
            rangeCount: 1,
            type: 'Caret',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_get_document_selection')?.({});
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.data.selection).toMatchObject({
      text: '',
      source: 'Selection.Text',
      isCollapsed: true,
      rangeCount: 1,
      type: 'Caret',
    });
  });

  it('runtime 误报 Caret 但 DOM 有文本选区时优先返回 DOM 选区状态', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async getDocumentSelection() {
          return {
            text: '',
            source: 'Selection.Text',
            isCollapsed: true,
            rangeCount: 1,
            type: 'Caret',
          };
        },
        summarizeDomSelection() {
          return {
            text: '已选中的正文',
            isCollapsed: false,
            rangeCount: 1,
            type: 'Range',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_get_document_selection')?.({});
    const payload = parseToolResult(result);

    expect(payload.ok).toBe(true);
    expect(payload.data.selection).toMatchObject({
      text: '已选中的正文',
      source: 'dom-selection',
      isCollapsed: false,
      rangeCount: 1,
      type: 'Range',
    });
  });

  it('在非 document runtime 下返回清晰失败', async () => {
    const win = await loadDocumentToolWindow({
      location: {
        href: 'https://webedit.midea.com/moewebv7/spreadsheet?sheet=1',
        origin: 'https://webedit.midea.com',
        pathname: '/moewebv7/spreadsheet',
        search: '?sheet=1',
      },
    });
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'spreadsheet';
        },
        detectDocumentIdentity() {
          return {
            href: 'https://webedit.midea.com/moewebv7/spreadsheet?sheet=1',
            pathname: '/moewebv7/spreadsheet',
            title: 'sheet',
          };
        },
        isRuntimeReady() {
          return true;
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_get_document_context')?.({});
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_mode_not_detected');
  });

  it('在缺少真实写能力时返回 write not supported', async () => {
    const win = await loadDocumentToolWindow({
      location: {
        href: 'https://webedit.midea.com/moewebv7/document-cloud?editId=doc-2',
        origin: 'https://webedit.midea.com',
        pathname: '/moewebv7/document-cloud',
        search: '?editId=doc-2',
      },
    });
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        detectDocumentIdentity() {
          return {
            href: 'https://webedit.midea.com/moewebv7/document-cloud?editId=doc-2',
            pathname: '/moewebv7/document-cloud',
            title: 'doc-2',
            editId: 'doc-2',
          };
        },
        isRuntimeReady() {
          return true;
        },
        summarizeDomSelection() {
          return {
            text: '旧文本',
            isCollapsed: false,
            rangeCount: 1,
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_insert_text_at_cursor')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_write_not_supported');
  });

  it('replace rich text 在 html 写入能力可用时返回成功', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '旧文本';
    let documentText = '前缀旧文本后缀';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: false,
            rangeCount: 1,
            type: 'Range',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceDocumentSelectionHtml() {
          selectionText = '';
          documentText = '前缀新文本后缀';
          return {
            supported: true,
            writeStrategy: 'Selection.Range.PasteHtml',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_rich_text')?.({
      html: '<p><span style=\"font-weight:bold\">新文本</span></p>',
    });
    const payload = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.data.writeMethod).toBe('replaceDocumentSelectionHtml');
    expect(payload.data.writeResult).toMatchObject({
      supported: true,
      writeStrategy: 'Selection.Range.PasteHtml',
    });
    expect(payload.data.plainText).toBe('新文本');
    expect(payload.data.operation).toBe('replace-selection');
    expect(payload.data.afterDocumentText).toMatchObject({
      text: '前缀新文本后缀',
    });
  });

  it('replace rich text 在只有光标时改走 insertDocumentHtml', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '';
    let documentText = '原文';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: true,
            rangeCount: 1,
            type: 'Caret',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async insertDocumentHtml() {
          selectionText = '新文本';
          documentText = '原文新文本';
          return {
            supported: true,
            writeStrategy: 'Selection.Range.PasteHtml',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_rich_text')?.({
      html: '<p><span style=\"font-weight:bold\">新文本</span></p>',
    });
    const payload = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.data.writeMethod).toBe('insertDocumentHtml');
    expect(payload.data.operation).toBe('insert-at-cursor');
    expect(payload.data.afterDocumentText).toMatchObject({
      text: '原文新文本',
    });
  });

  it('replace rich text 在选区丢失时允许文档级兜底写入', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let documentText = '旧正文';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: '',
            isCollapsed: true,
            rangeCount: 0,
            type: 'None',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceDocumentSelectionHtml() {
          documentText = '旧正文新文本';
          return {
            supported: true,
            writeStrategy: 'ActiveDocument.Content.PasteHtml',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_rich_text')?.({
      html: '<p><span style=\"font-weight:bold\">新文本</span></p>',
    });
    const payload = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.data.writeMethod).toBe('replaceDocumentSelectionHtml');
    expect(payload.data.operation).toBe('document-fallback');
    expect(payload.data.afterDocumentText).toMatchObject({
      text: '旧正文新文本',
    });
  });

  it('replace rich text 在 html 为空时返回 invalid argument', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: '旧文本',
            isCollapsed: false,
            rangeCount: 1,
            type: 'Range',
          };
        },
        async readDocumentText() {
          return '旧文本';
        },
        async replaceDocumentSelectionHtml() {
          return {
            supported: true,
            writeStrategy: 'Selection.Range.PasteHtml',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_rich_text')?.({
      html: '   ',
    });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('invalid_argument');
    expect(payload.error.message).toContain('html is required');
  });

  it('在 adapter 暴露 insertDocumentText 时允许通过写能力探测', async () => {
    const win = await loadDocumentToolWindow({
      location: {
        href: 'https://webedit.midea.com/weboffice/office/w/123?editId=doc-3',
        origin: 'https://webedit.midea.com',
        pathname: '/weboffice/office/w/123',
        search: '?editId=doc-3',
      },
    });
    const tools = new Map<string, ToolHandler>();
    let selectionText = '旧文本';
    let documentText = '旧文本';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: false,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: false,
            rangeCount: 1,
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async insertDocumentText(text: string) {
          selectionText = text;
          documentText = `旧文本 ${text}`;
          return {
            supported: true,
            writeStrategy: 'Selection.TypeText',
            text,
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_insert_text_at_cursor')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.data.writeMethod).toBe('insertDocumentText');
    expect(payload.data.writeResult).toMatchObject({
      supported: true,
      writeStrategy: 'Selection.TypeText',
      text: '新文本',
    });
    expect(payload.data.afterDocumentText).toMatchObject({
      text: '旧文本 新文本',
    });
  });

  it('写后状态未变化时返回 verify failed', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: false,
          };
        },
        async getDocumentSelection() {
          return {
            text: '旧文本',
            isCollapsed: false,
            rangeCount: 1,
          };
        },
        async readDocumentText() {
          return '旧文本';
        },
        async insertDocumentText() {
          return {
            supported: true,
            writeStrategy: 'Selection.TypeText',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_insert_text_at_cursor')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_write_verify_failed');
  });

  it('replace 仅追加新文本而未真正替换选区时返回 verify failed', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '旧文本';
    let documentText = '前缀旧文本后缀';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: false,
            rangeCount: 1,
            type: selectionText ? 'Range' : 'Caret',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceDocumentSelection(text: string) {
          selectionText = '';
          documentText = `${documentText}${text}`;
          return {
            supported: true,
            writeStrategy: 'Selection.Range.PasteHtml',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_text')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_write_verify_failed');
  });

  it('replace 仅追加新文本且保留旧选中文本时返回 verify failed', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '旧文本';
    let documentText = '前缀 旧文本 后缀';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: false,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: false,
            rangeCount: 1,
            type: 'Range',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceSelectionText(text: string) {
          selectionText = text;
          documentText = `前缀 旧文本 后缀 ${text}`;
          return {
            supported: true,
            writeStrategy: 'Selection.TypeText',
            text,
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_text')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_write_verify_failed');
  });

  it('replace_selection_text 在传入空字符串时允许删除选区内容', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '';
    let documentText = '前缀旧文本后缀';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: false,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: true,
            rangeCount: 1,
            type: 'Caret',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceSelectionText(text: string) {
          selectionText = text;
          documentText = '前缀后缀';
          return {
            supported: true,
            writeStrategy: 'Selection.TypeText',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_text')?.({ text: '' });
    const payload = parseToolResult(result);

    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.data.writeMethod).toBe('replaceSelectionText');
    expect(payload.data.afterDocumentText).toMatchObject({
      text: '前缀后缀',
    });
  });

  it('replace_selection_text 在空字符串删除未生效时返回 verify failed', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();
    let selectionText = '';
    let documentText = '前缀旧文本后缀';

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: false,
            canReplaceSelection: true,
          };
        },
        async getDocumentSelection() {
          return {
            text: selectionText,
            isCollapsed: true,
            rangeCount: 1,
            type: 'Caret',
          };
        },
        async readDocumentText() {
          return documentText;
        },
        async replaceSelectionText(text: string) {
          selectionText = text;
          return {
            supported: true,
            writeStrategy: 'Selection.TypeText',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_replace_selection_text')?.({ text: '' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_write_verify_failed');
  });

  it('adapter 写入抛错时返回结构化失败而不是未捕获异常', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: false,
          };
        },
        async getDocumentSelection() {
          return {
            text: '',
            type: 'Caret',
            isCollapsed: true,
            rangeCount: 1,
          };
        },
        async readDocumentText() {
          return '旧文本';
        },
        async insertDocumentText() {
          throw new Error('write exploded');
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_insert_text_at_cursor')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('tool_execution_failed');
    expect(payload.error.message).toContain('write exploded');
    expect(payload.meta).toMatchObject({
      capability: 'canInsertText',
      writeMethod: 'insertDocumentText',
      mode: 'document',
    });
  });

  it('在没有可靠光标时拒绝执行 insert_text_at_cursor', async () => {
    const win = await loadDocumentToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditDocumentTools as {
        registerDocumentTools: (deps: Record<string, unknown>) => void;
      }
    ).registerDocumentTools({
      adapter: {
        async detectRuntimeMode() {
          return 'document';
        },
        isRuntimeReady() {
          return true;
        },
        async listDocumentCapabilities() {
          return {
            canReadText: true,
            canReadSelection: true,
            canInsertText: true,
            canReplaceSelection: false,
          };
        },
        async getDocumentSelection() {
          return {
            text: '',
            type: 'None',
            isCollapsed: true,
            rangeCount: 0,
          };
        },
        async readDocumentText() {
          return '旧文本';
        },
        async insertDocumentText() {
          return {
            supported: true,
            writeStrategy: 'Selection.InsertAfter',
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const result = await tools.get('webedit_insert_text_at_cursor')?.({ text: '新文本' });
    const payload = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('document_selection_unavailable');
    expect(payload.error.message).toContain('cursor');
  });
});
