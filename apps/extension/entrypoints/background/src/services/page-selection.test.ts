// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readCurrentPageSelection } from './page-selection';

vi.mock('./read-current-page-content', () => ({
  readCurrentPageContent: vi.fn(),
}));

vi.mock('./mcpHub', () => ({
  getMcpHubInstance: vi.fn(),
}));

const readCurrentPageContentMock = vi.fn();
const executeWebsiteToolOnActiveTab = vi.fn();
const getMcpHubInstanceMock = vi.fn();

beforeEach(async () => {
  readCurrentPageContentMock.mockReset();
  executeWebsiteToolOnActiveTab.mockReset();
  getMcpHubInstanceMock.mockReset();

  const readCurrentPageContentModule = await import('./read-current-page-content');
  vi.mocked(readCurrentPageContentModule.readCurrentPageContent).mockImplementation(
    readCurrentPageContentMock
  );

  const mcpHubModule = await import('./mcpHub');
  vi.mocked(mcpHubModule.getMcpHubInstance).mockImplementation(getMcpHubInstanceMock);
});

describe('readCurrentPageSelection', () => {
  it('传入 lockedTabId 时优先从锁定 tab 读取 website 选区', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '锁定表格',
      url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=locked',
      text: '锁定表格内容',
      selection: {
        address: 'A1',
        text: '旧选区',
        rowsCount: 1,
        columnsCount: 1,
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            data: {
              selection: {
                address: 'C3:D4',
                text: '锁定选区',
                rowsCount: 2,
                columnsCount: 2,
              },
            },
          }),
        },
      ],
    });

    const result = await (readCurrentPageSelection as any)({ lockedTabId: 31415 });

    expect(executeWebsiteToolOnActiveTab).toHaveBeenCalledWith(
      'webedit_get_document_selection',
      {},
      31415
    );
    expect(result.selectionSource).toBe('website-tool');
    expect(result.selection.address).toBe('C3:D4');
  });

  it('website tool 可用时即使深读卡住也应快速返回选区', async () => {
    vi.useFakeTimers();
    readCurrentPageContentMock.mockImplementation(
      () => new Promise(() => undefined) as ReturnType<typeof readCurrentPageContentMock>
    );
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            data: {
              selection: {
                address: 'A1:D4',
                text: '表格内容',
                rowsCount: 4,
                columnsCount: 4,
              },
              activeCell: {
                address: 'D5',
                text: '',
                rowsCount: 1,
                columnsCount: 1,
              },
            },
          }),
        },
      ],
    });
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=abc',
            title: '未命名文档',
          },
        ]),
      },
    });

    const resultPromise = readCurrentPageSelection();
    await vi.advanceTimersByTimeAsync(1_600);
    const result = await resultPromise;

    expect(result.selectionSource).toBe('website-tool');
    expect(result.selection.address).toBe('A1:D4');
    expect(result.activeCell?.address).toBe('D5');
    expect(result.url).toContain('webedit.midea.com');
    expect(result.title).toBe('未命名文档');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('文档模式下优先使用 document website tool 选区', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '需求说明',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      text: '第一段 第二段',
      selection: {
        mode: 'document',
        text: '第二段',
        isCollapsed: false,
        rangeCount: 1,
        source: 'deep-read',
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              data: {
                mode: 'document',
                selection: {
                  mode: 'document',
                  text: '第二段',
                  isCollapsed: false,
                  rangeCount: 1,
                  source: 'Selection.Text',
                },
                domSelection: {
                  text: '第二段',
                  rangeCount: 1,
                  isCollapsed: false,
                },
              },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'fallback not needed' }],
      });

    const result = await readCurrentPageSelection();

    expect(executeWebsiteToolOnActiveTab).toHaveBeenCalledWith('webedit_get_document_selection', {});
    expect(result.selectionSource).toBe('website-tool');
    expect(result.selection.mode).toBe('document');
    expect(result.selection.text).toBe('第二段');
    expect(result.selection.isCollapsed).toBe(false);
    expect(result.comparison?.matches).toBe(true);
  });

  it('优先使用 website tool 的选区，并输出不一致告警', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '任务表示例',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      text: '任务表示例',
      selection: {
        address: 'B2',
        text: '开始日期',
        rowsCount: 1,
        columnsCount: 1,
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            data: {
              selection: {
                address: 'B2:D4',
                text: '开始日期 截止日期 状态',
                rowsCount: 3,
                columnsCount: 3,
              },
              activeCell: {
                address: 'D4',
                text: '完成',
                rowsCount: 1,
                columnsCount: 1,
              },
              domSelection: {
                text: '开始日期 截止日期 状态',
                rangeCount: 1,
              },
            },
          }),
        },
      ],
    });

    const result = await readCurrentPageSelection();

    expect(result.selectionSource).toBe('website-tool');
    expect(result.selection.address).toBe('B2:D4');
    expect(result.activeCell?.address).toBe('D4');
    expect(result.deepReadSelection?.address).toBe('B2');
    expect(result.websiteSelection?.address).toBe('B2:D4');
    expect(result.comparison?.matches).toBe(false);
    expect(result.comparison?.warnings).toContain(
      '选区地址不一致：深读=B2，website tool=B2:D4'
    );
    expect(result.comparison?.warnings).toContain(
      '深读识别为单格，但 website tool 返回了多格选区'
    );
  });

  it('在 website tool 不可用时回退到深读选区', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '任务表示例',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      text: '任务表示例',
      selection: {
        address: 'C5',
        text: '完成',
        rowsCount: 1,
        columnsCount: 1,
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'tool unavailable' }],
    });

    const result = await readCurrentPageSelection();

    expect(result.selectionSource).toBe('deep-read');
    expect(result.selection.address).toBe('C5');
    expect(result.websiteSelection).toBeUndefined();
    expect(result.comparison).toBeUndefined();
  });

  it('文档光标场景在没有文本时也保留稳定选区', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '需求说明',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      text: '第一段 第二段',
      selection: {
        mode: 'document',
        text: null,
        isCollapsed: true,
        rangeCount: 1,
        source: 'Selection',
        domSelection: {
          text: '',
          rangeCount: 1,
          isCollapsed: true,
        },
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'tool unavailable' }],
    });

    const result = await readCurrentPageSelection();

    expect(result.selectionSource).toBe('deep-read');
    expect(result.selection.mode).toBe('document');
    expect(result.selection.isCollapsed).toBe(true);
    expect(result.selection.rangeCount).toBe(1);
  });

  it('website tool 顶层误报 Caret 但 domSelection 有文本时提升为真实文档选区', async () => {
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: '需求说明',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      text: '第一段 第二段',
      selection: {
        mode: 'document',
        text: '已选中的正文',
        isCollapsed: false,
        rangeCount: 1,
        source: 'dom-selection',
      },
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });
    executeWebsiteToolOnActiveTab
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              data: {
                mode: 'document',
                selection: {
                  mode: 'document',
                  text: null,
                  isCollapsed: true,
                  rangeCount: 1,
                  source: 'Selection.Text',
                },
                domSelection: {
                  text: '已选中的正文',
                  rangeCount: 1,
                  isCollapsed: false,
                },
              },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        isError: true,
        content: [{ type: 'text', text: 'fallback not needed' }],
      });

    const result = await readCurrentPageSelection();

    expect(result.selectionSource).toBe('website-tool');
    expect(result.selection.mode).toBe('document');
    expect(result.selection.text).toBe('已选中的正文');
    expect(result.selection.isCollapsed).toBe(false);
    expect(result.selection.rangeCount).toBe(1);
    expect(result.selection.source).toBe('dom-selection');
  });
});
