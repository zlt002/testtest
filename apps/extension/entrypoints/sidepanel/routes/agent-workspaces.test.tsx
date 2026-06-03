// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let AgentWorkspacesContent: typeof import('./agent-workspaces')['AgentWorkspacesContent'];
let AgentWorkspacesPage: typeof import('./agent-workspaces')['AgentWorkspacesPage'];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function findListFilesCalls(
  predicate: (input: {
    projectPath: string;
    dirPath?: string;
    maxDepth?: number;
    includeMetadata?: boolean;
  }) => boolean,
  startIndex = 0
) {
  return mockListFiles.mock.calls
    .slice(startIndex)
    .map(([input]) => input)
    .filter(
      (
        input
      ): input is {
        projectPath: string;
        dirPath?: string;
        maxDepth?: number;
        includeMetadata?: boolean;
      } => Boolean(input) && predicate(input)
    );
}

const mockOpenFileEntry = vi.fn(async () => undefined);
const mockBuildHtmlBrowserPreviewUrl = vi.fn(
  ({ projectPath, filePath }: { projectPath: string; filePath: string }) =>
    `file://${projectPath}/${filePath}`
);
const mockBuildFileBrowserPreviewUrl = vi.fn(
  ({ projectPath, filePath }: { projectPath: string; filePath: string }) =>
    `http://localhost:3000/api/file-browser-preview?projectPath=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(filePath)}`
);
const mockOpenHtmlBrowserPreview = vi.fn(async () => undefined);
const mockPublishProjectSelection = vi.fn(async () => undefined);
const mockPublishSessionSelection = vi.fn(async () => undefined);
const mockRuntimeSendMessage = vi.fn(async () => undefined);
const mockReadProjectSelection = vi.fn(async () => null);
const mockReadCurrentSession = vi.fn(async () => null);
const mockReadWorkspaceIntent = vi.fn(async () => null);
const mockBrowseWorkspaceFolders = vi.fn(async () => ({
  path: '/Users/zhanglt21',
  parentPath: '/Users',
  folders: [],
}));
const mockPickWorkspaceFolder = vi.fn(async () => ({ projectPath: null }));
const mockCreateWorkspaceFolder = vi.fn(async () => undefined);
const mockAddWorkspace = vi.fn(async () => undefined);
const mockDeleteWorkspace = vi.fn(async () => undefined);
const mockRenameWorkspace = vi.fn(async () => undefined);
const mockOpenWorkspace = vi.fn(async () => undefined);
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockListFiles = vi.fn(async () => [
  {
    path: 'README.md',
    name: 'README.md',
    type: 'file',
    size: 128,
    modifiedAt: '2026-05-12T06:00:00.000Z',
  },
]);
const mockRefreshProjects = vi.fn(async () => undefined);
const mockClearSessions = vi.fn();
const mockRefreshSessions = vi.fn(async () => undefined);
const mockDeleteSession = vi.fn(async () => undefined);
const mockSessionRunsByProject = new Map<
  string,
  Array<{
    sessionId: string;
    projectPath: string;
    runId: string;
    status: 'connecting' | 'streaming' | 'completed' | 'failed' | 'aborted';
    startedAt: string;
    lastEventAt: string;
    latestSequence: number;
    hasActiveStream: boolean;
    latestPreviewText?: string;
    lastError?: string;
  }>
>();
const storageChangeListeners = new Set<
  (changes: Record<string, chrome.storage.StorageChange>) => void
>();
const defaultProjects = [
  {
    projectKey: 'accr-ui',
    name: 'accr-ui',
    projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
    sessionCount: 1,
  },
  {
    projectKey: 'ccu',
    name: 'ccu',
    projectPath: '/Users/zhanglt21/Desktop/ccu',
    sessionCount: 2,
  },
];
const mockProjects = [...defaultProjects];
const projectSessions = new Map<string, Array<Record<string, unknown>>>([
  [
    '/Users/zhanglt21/Desktop/accrnew/accr-ui',
    [
      {
        sessionId: '993b4517',
        title: '993b4517',
        updatedAt: '2026-05-12T06:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 12,
      },
    ],
  ],
  [
    '/Users/zhanglt21/Desktop/ccu',
    [
      {
        sessionId: 'ccu-session',
        title: 'ccu-session',
        updatedAt: '2026-05-12T07:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/ccu',
        messageCount: 3,
      },
    ],
  ],
]);

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  redirect: vi.fn(),
}));

vi.mock('../lib/config', () => ({
  config: {
    api: {
      agentV2BaseUrl: 'http://localhost:3000',
      agentV2Endpoint: '/api',
    },
  },
}));

vi.mock('../lib/file-preview-browser', () => ({
  buildHtmlBrowserPreviewUrl: mockBuildHtmlBrowserPreviewUrl,
  buildFileBrowserPreviewUrl: mockBuildFileBrowserPreviewUrl,
  openHtmlBrowserPreview: mockOpenHtmlBrowserPreview,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock('../lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    listFiles: mockListFiles,
    addWorkspace: mockAddWorkspace,
    renameWorkspace: mockRenameWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
    openWorkspace: mockOpenWorkspace,
    browseWorkspaceFolders: mockBrowseWorkspaceFolders,
    pickWorkspaceFolder: mockPickWorkspaceFolder,
    createWorkspaceFolder: mockCreateWorkspaceFolder,
    createFileEntry: vi.fn(),
    renameFileEntry: vi.fn(),
    deleteFileEntry: vi.fn(),
    readFile: vi.fn(),
    openFileEntry: mockOpenFileEntry,
    renameSession: vi.fn(),
    deleteSession: mockDeleteSession,
  }),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  AGENT_V2_CURRENT_SESSION_STORAGE_KEY: 'agent-v2-current-session',
  AGENT_V2_SESSION_SELECTION_STORAGE_KEY: 'agent-v2-selection',
  clearAgentV2WorkspaceIntent: vi.fn(async () => undefined),
  publishAgentV2ProjectSelection: mockPublishProjectSelection,
  publishAgentV2SessionSelection: mockPublishSessionSelection,
  readAgentV2CurrentSession: mockReadCurrentSession,
  readAgentV2ProjectSelection: mockReadProjectSelection,
  readAgentV2WorkspaceIntent: mockReadWorkspaceIntent,
}));

vi.mock('../lib/agent-v2/useAgentV2Sessions', async () => {
  const react = await import('react');

  return {
    useAgentV2Sessions: () => {
      const [sessions, setSessions] = react.useState<Array<Record<string, unknown>>>(
        (projectSessions.get('/Users/zhanglt21/Desktop/accrnew/accr-ui') as Array<
          Record<string, unknown>
        >) || []
      );

      return {
        projects: mockProjects,
        sessions,
        status: 'idle' as const,
        error: null,
        refresh: mockRefreshSessions.mockImplementation(
          async (input?: { projectPath?: string }) => {
            const nextSessions =
              (projectSessions.get(
                input?.projectPath || '/Users/zhanglt21/Desktop/accrnew/accr-ui'
              ) as Array<Record<string, unknown>>) || [];
            setSessions(nextSessions);
          }
        ),
        refreshProjects: mockRefreshProjects,
        clearSessions: mockClearSessions.mockImplementation(() => {
          setSessions([]);
        }),
        loadHistory: vi.fn(async () => null),
      };
    },
  };
  it.skip('supports clicking the file breadcrumb root to navigate back to the project root', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: '鏂囦欢' }));

    await screen.findByText('README.md');
    expect(mockListFiles).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        dirPath: undefined,
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });

  it.skip('supports the toolbar back button to navigate to the parent directory', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/notes.txt',
          name: 'notes.txt',
          type: 'file',
          size: 32,
          modifiedAt: '2026-05-12T07:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: '返回上一级目录' }));

    await screen.findByText('notes.txt');
    expect(mockListFiles).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        dirPath: 'captures',
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });
});
it.skip('supports clicking the file breadcrumb root to navigate back to the project root', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: '鏂囦欢' }));

    await screen.findByText('README.md');
    expect(mockListFiles).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        dirPath: undefined,
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });

it.skip('supports the toolbar back button to navigate to the parent directory', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/notes.txt',
          name: 'notes.txt',
          type: 'file',
          size: 32,
          modifiedAt: '2026-05-12T07:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: '返回上一级目录' }));

    await screen.findByText('notes.txt');
    expect(mockListFiles).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        dirPath: 'captures',
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });
vi.mock('../lib/agent-v2/useAgentV2SessionRuns', () => ({
  useAgentV2SessionRuns: (input: { projectPath?: string | null }) => {
    const normalizedProjectPath = input.projectPath?.trim() || '';
    return {
      data: normalizedProjectPath
        ? {
            projectPath: normalizedProjectPath,
            sessions: mockSessionRunsByProject.get(normalizedProjectPath) || [],
          }
        : undefined,
      isLoading: false,
      error: null,
    };
  },
}));

describe('AgentWorkspacesPage', () => {
  beforeEach(() => {
    vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
    vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    vi.clearAllMocks();
    mockProjects.splice(
      0,
      mockProjects.length,
      ...defaultProjects.map((project) => ({ ...project }))
    );
    mockSessionRunsByProject.clear();
    mockReadProjectSelection.mockResolvedValue({
      projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      selectedAt: '2026-05-19T12:00:00.000Z',
    });
    mockReadCurrentSession.mockResolvedValue(null);
    mockReadWorkspaceIntent.mockResolvedValue(null);
    mockBrowseWorkspaceFolders.mockResolvedValue({
      path: '/Users/zhanglt21',
      parentPath: '/Users',
      folders: [],
    });
    mockPickWorkspaceFolder.mockResolvedValue({ projectPath: null });
    mockCreateWorkspaceFolder.mockResolvedValue(undefined);
    mockAddWorkspace.mockResolvedValue(undefined);
    mockDeleteWorkspace.mockResolvedValue(undefined);
    mockRenameWorkspace.mockResolvedValue(undefined);
    mockOpenWorkspace.mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockRefreshProjects.mockResolvedValue(undefined);
    mockDeleteSession.mockReset();
    mockDeleteSession.mockResolvedValue(undefined);
    mockClearSessions.mockReset();
    mockClearSessions.mockImplementation(() => undefined);
    mockRefreshSessions.mockReset();
    mockRefreshSessions.mockImplementation(async (input?: { projectPath?: string }) => {
      const nextSessions =
        (projectSessions.get(
          input?.projectPath || '/Users/zhanglt21/Desktop/accrnew/accr-ui'
        ) as Array<Record<string, unknown>>) || [];
      return nextSessions;
    });
    projectSessions.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: '993b4517',
        title: '993b4517',
        updatedAt: '2026-05-12T06:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 12,
      },
    ]);
    projectSessions.set('/Users/zhanglt21/Desktop/ccu', [
      {
        sessionId: 'ccu-session',
        title: 'ccu-session',
        updatedAt: '2026-05-12T07:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/ccu',
        messageCount: 3,
      },
    ]);
    mockListFiles.mockResolvedValue([
      {
        path: 'README.md',
        name: 'README.md',
        type: 'file',
        size: 128,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      },
    ]);
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: vi.fn((value: string) => value),
        sendMessage: mockRuntimeSendMessage,
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          remove: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: vi.fn(
            (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => {
              storageChangeListeners.add(listener);
            }
          ),
          removeListener: vi.fn(
            (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => {
              storageChangeListeners.delete(listener);
            }
          ),
        },
      },
      tabs: {
        create: vi.fn(async () => undefined),
      },
    });
    storageChangeListeners.clear();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
  });

  beforeEach(async () => {
    const mod = await import('./agent-workspaces');
    AgentWorkspacesContent = mod.AgentWorkspacesContent;
    AgentWorkspacesPage = mod.AgentWorkspacesPage;
  });

  it('重复点击当前工作区时不会清空会话和文件', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');
    await screen.findByText('README.md');

    fireEvent.click(screen.getByRole('button', { name: /accr-ui/ }));

    await waitFor(() => {
      expect(screen.getByText('993b4517')).toBeTruthy();
      expect(screen.getByText('README.md')).toBeTruthy();
    });
  });

  it('切换工作区加载期间保留当前会话和文件，避免整列清空闪烁', async () => {
    const nextFiles =
      createDeferred<
        Array<{
          path: string;
          name: string;
          type: 'file';
          size: number;
          modifiedAt: string;
        }>
      >();
    const nextSessions = createDeferred<void>();
    mockListFiles.mockImplementation(async ({ projectPath }: { projectPath: string }) => {
      if (projectPath === '/Users/zhanglt21/Desktop/ccu') {
        return nextFiles.promise;
      }
      return [
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ];
    });
    mockRefreshSessions.mockImplementation(async (input?: { projectPath?: string }) => {
      if (input?.projectPath === '/Users/zhanglt21/Desktop/ccu') {
        await nextSessions.promise;
        return;
      }
    });

    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');

    fireEvent.click(screen.getByRole('button', { name: /ccu/ }));

    expect(screen.getByText('README.md')).toBeTruthy();

    nextSessions.resolve();
    nextFiles.resolve([
      {
        path: 'CCU.md',
        name: 'CCU.md',
        type: 'file',
        size: 64,
        modifiedAt: '2026-05-12T08:00:00.000Z',
      },
    ]);

    await screen.findByText('ccu-session');
    await screen.findByText('CCU.md');
  });

  it('点击 html 文件时直接打开 file 预览，不再打开 sidepanel 文件预览页', async () => {
    mockListFiles.mockResolvedValue([
      {
        path: 'index.html',
        name: 'index.html',
        type: 'file',
        size: 256,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      },
    ]);

    render(<AgentWorkspacesPage />);

    const file = await screen.findByText('index.html');
    fireEvent.click(file);

    await waitFor(() => {
      expect(mockBuildHtmlBrowserPreviewUrl).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        filePath: 'index.html',
        mode: 'file',
      });
      expect(mockOpenHtmlBrowserPreview).toHaveBeenCalledWith(
        'file:///Users/zhanglt21/Desktop/accrnew/accr-ui/index.html',
        {
          fallbackUrl:
            'http://localhost:3000/api/file-browser-preview?projectPath=%2FUsers%2Fzhanglt21%2FDesktop%2Faccrnew%2Faccr-ui&filePath=index.html',
        }
      );
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });
  });

  it('从列表移除工作区时使用统一确认弹框，默认不删除系统文件夹', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');

    fireEvent.click(screen.getAllByTitle('更多操作')[0]);
    fireEvent.click(await screen.findByRole('button', { name: '从列表移除' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('移除工作区')).toBeTruthy();
    const deleteDirectoryCheckbox = screen.getByRole('checkbox', { name: '同时删除系统文件夹' });
    expect(deleteDirectoryCheckbox.getAttribute('data-state')).toBe('unchecked');

    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));

    await waitFor(() => {
      expect(mockDeleteWorkspace).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        deleteDirectory: false,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('工作区已从列表移除');
    });
  });

  it('勾选后从列表移除工作区时会同时删除系统文件夹', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');

    fireEvent.click(screen.getAllByTitle('更多操作')[0]);
    fireEvent.click(await screen.findByRole('button', { name: '从列表移除' }));

    const deleteDirectoryCheckbox = await screen.findByRole('checkbox', {
      name: '同时删除系统文件夹',
    });
    fireEvent.click(deleteDirectoryCheckbox);
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));

    await waitFor(() => {
      expect(mockDeleteWorkspace).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        deleteDirectory: true,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('工作区及系统文件夹已删除');
    });
  });

  it('顶层隐藏项过多时默认折叠隐藏项，并允许手动展开', async () => {
    mockListFiles.mockResolvedValue([
      ...Array.from({ length: 130 }, (_, index) => ({
        path: `.hidden-${index}`,
        name: `.hidden-${index}`,
        type: 'directory' as const,
        size: 0,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      })),
      {
        path: 'Desktop',
        name: 'Desktop',
        type: 'directory' as const,
        size: 0,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      },
      {
        path: 'README.md',
        name: 'README.md',
        type: 'file' as const,
        size: 128,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      },
    ]);

    render(<AgentWorkspacesPage />);

    await screen.findByText('Desktop');
    await screen.findByText('README.md');
    expect(screen.queryByText('.hidden-0')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示隐藏项' }));

    await screen.findByText('.hidden-0');
  });

  it('大量文件时只渲染可视区域附近的文件行', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if ((this as HTMLElement).className.includes('overflow-y-auto')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          width: 320,
          height: 280,
          right: 320,
          bottom: 280,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).className.includes('overflow-y-auto')) {
          return 280;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      },
    });

    mockListFiles.mockResolvedValue(
      Array.from({ length: 300 }, (_, index) => ({
        path: `file-${index}.txt`,
        name: `file-${index}.txt`,
        type: 'file' as const,
        size: 128,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      }))
    );

    try {
      render(<AgentWorkspacesPage />);

      await screen.findByText('file-0.txt');
      expect(screen.queryByText('file-299.txt')).toBeNull();
      expect(document.querySelectorAll('div.select-none').length).toBeLessThan(80);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      } else {
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      }
    }
  });

  it('点击会话卡片时会请求激活侧边栏', async () => {
    render(<AgentWorkspacesPage />);

    const sessionCard = await screen.findByText('993b4517');
    fireEvent.click(sessionCard);

    await waitFor(() => {
      expect(mockPublishSessionSelection).toHaveBeenCalledWith({
        sessionId: '993b4517',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        title: '993b4517',
      });
      expect(mockRuntimeSendMessage).toHaveBeenCalledWith({ action: 'open-sidepanel' });
    });
  });

  it('没有工作区时显示默认空态图标和引导文案', async () => {
    mockProjects.splice(0, mockProjects.length);

    render(<AgentWorkspacesPage />);

    expect(await screen.findByText('还没有工作区')).toBeTruthy();
    expect(screen.getByText('点击上方 + 选择本地文件夹，先创建一个工作区。')).toBeTruthy();

    const emptyIcons = document.querySelectorAll('img[src="/icon/claude-ai-icon.svg"]');
    expect(emptyIcons.length).toBeGreaterThan(0);
    expect(Array.from(emptyIcons).some((icon) => icon.className.includes('opacity-50'))).toBe(true);
  });

  it('未选工作区时，中间和右侧显示缺省空态', async () => {
    mockProjects.splice(0, mockProjects.length);

    render(<AgentWorkspacesPage />);

    const emptyTitles = await screen.findAllByText(/请选择工作区/);
    expect(emptyTitles.length).toBeGreaterThanOrEqual(2);
  });

  it('存在工作区但没有全局选中时，会默认高亮第一个工作区并预加载内容', async () => {
    mockReadProjectSelection.mockResolvedValueOnce(null);

    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');
    expect(document.body.textContent).toContain('993b4517');

    const projectButton = screen.getByRole('button', { name: /accr-ui/ });
    expect(projectButton.className).toContain('border-primary/50');
    expect(projectButton.className).toContain('bg-primary/8');
  });

  it('工作区没有会话和文件时显示对应空态', async () => {
    projectSessions.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', []);
    mockListFiles.mockResolvedValueOnce([]);

    render(<AgentWorkspacesPage />);

    expect(await screen.findByText('还没有会话')).toBeTruthy();
    expect(screen.getByText('点击右上角 + 创建一个新会话，聊天记录会显示在这里。')).toBeTruthy();
    expect(screen.getByText('当前没有文件')).toBeTruthy();
    expect(screen.getByText('这个目录下暂时没有可展示的文件或文件夹。')).toBeTruthy();
  });

  it('文件区默认只显示搜索图标，点击后才展开搜索框', async () => {
    render(<AgentWorkspacesPage />);

    expect(screen.queryByPlaceholderText('搜索文件和文件夹...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '搜索文件和文件夹' }));

    const searchInput = await screen.findByPlaceholderText('搜索文件和文件夹...');
    const refreshButton = screen.getAllByRole('button', { name: '刷新' }).at(-1);

    expect(searchInput.closest('.border-b')?.contains(refreshButton as HTMLElement)).toBe(true);
  });

  it('文件区搜索展开后点击空白区域会自动收起', async () => {
    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '搜索文件和文件夹' }));
    await screen.findByPlaceholderText('搜索文件和文件夹...');

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('搜索文件和文件夹...')).toBeNull();
    });
  });

  it('html 文件右键菜单显示打开源代码，资源管理器打开文件时改为打开所在目录', async () => {
    mockListFiles.mockResolvedValue([
      {
        path: 'pages/index.html',
        name: 'index.html',
        type: 'file',
        size: 256,
        modifiedAt: '2026-05-12T06:00:00.000Z',
      },
    ]);

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '切换到文件管理' }));

    const file = await screen.findByText('index.html');
    fireEvent.contextMenu(file.closest('[data-file-path]') as HTMLElement, {
      clientX: 80,
      clientY: 80,
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('打开源代码');
    });
    const sourceCodeButton = screen.getByRole('button', { name: '打开源代码' });
    expect(sourceCodeButton).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '资源管理器打开' }));

    await waitFor(() => {
      expect(mockOpenFileEntry).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        entryPath: 'pages',
      });
    });
  });

  it('文件右键菜单在靠近底部时会自动上移，避免被视口裁切', async () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320,
    });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if ((this as HTMLElement).className.includes('min-w-40')) {
        const top = Number.parseFloat((this as HTMLElement).style.top || '0');
        const left = Number.parseFloat((this as HTMLElement).style.left || '0');
        return {
          x: left,
          y: top,
          top,
          left,
          width: 160,
          height: 220,
          right: left + 160,
          bottom: top + 220,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      render(<AgentWorkspacesPage />);

      const file = await screen.findByText('README.md');
      fireEvent.contextMenu(file, { clientX: 120, clientY: 190 });

      const menus = document.querySelectorAll('div.min-w-40');
      const menu = menus[menus.length - 1] as HTMLElement | undefined;
      const newFileButton = within(menu as HTMLElement).getByRole('button', { name: '新建文件' });

      expect(menu).toBeTruthy();
      await waitFor(() => {
        expect(menu?.style.top).toBe('8px');
      });
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      });
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('等待从聊天页创建新会话时，不会自动选中第一个工作区', async () => {
    mockReadWorkspaceIntent.mockResolvedValue({
      kind: 'new_session',
      requestedAt: '2026-05-17T01:00:00.000Z',
    });
    mockReadProjectSelection.mockResolvedValueOnce(null);

    render(<AgentWorkspacesPage />);

    await screen.findByText(
      '当前聊天页正在等待一个工作区来创建新会话。请选择一个已有工作区，或先新增工作区。'
    );

  });

  it('当前会话变更后会刷新会话列表，并显示新建会话标题', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    projectSessions.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: 'new-session',
        title: '排查新会话标题同步',
        updatedAt: '2026-05-19T12:00:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 1,
      },
      {
        sessionId: '993b4517',
        title: '993b4517',
        updatedAt: '2026-05-12T06:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 12,
      },
    ]);

    for (const listener of storageChangeListeners) {
      listener({
        'agent-v2-current-session': {
          oldValue: null,
          newValue: {
            sessionId: 'new-session',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: '排查新会话标题同步',
            selectedAt: '2026-05-19T12:00:00.000Z',
          },
        },
      });
    }

    await waitFor(() => {
      expect(mockRefreshSessions).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      });
      expect(screen.getByText('排查新会话标题同步')).toBeTruthy();
    });
  });

  it('已有当前会话收到新消息后，会立刻更新列表标题并刷新会话列表', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    projectSessions.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: '993b4517',
        title: '发送后应立即更新',
        updatedAt: '2026-05-19T12:20:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 13,
      },
    ]);

    for (const listener of storageChangeListeners) {
      listener({
        'agent-v2-current-session': {
          oldValue: {
            sessionId: '993b4517',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: '993b4517',
            selectedAt: '2026-05-12T06:13:00.000Z',
          },
          newValue: {
            sessionId: '993b4517',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: '发送后应立即更新',
            selectedAt: '2026-05-19T12:20:00.000Z',
          },
        },
      });
    }

    await waitFor(() => {
      expect(mockRefreshSessions).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      });
      expect(screen.getByText('发送后应立即更新')).toBeTruthy();
    });
  });

  it('初始化读取到已存在的当前会话时，不重复刷新会话列表', async () => {
    mockReadCurrentSession.mockResolvedValue({
      sessionId: '993b4517',
      projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      title: '993b4517',
      selectedAt: '2026-05-12T06:13:00.000Z',
    });

    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    await waitFor(() => {
      expect(mockRefreshSessions).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        signal: expect.any(AbortSignal),
      });
    });

    expect(mockRefreshSessions).toHaveBeenCalledTimes(1);
  });

  it('后端列表暂时还没有新会话时，左侧先显示当前会话兜底项', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    for (const listener of storageChangeListeners) {
      listener({
        'agent-v2-current-session': {
          oldValue: null,
          newValue: {
            sessionId: 'pending-session',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: '正在生成的新会话',
            selectedAt: '2026-05-19T12:10:00.000Z',
          },
        },
      });
    }

    await waitFor(() => {
      expect(mockRefreshSessions).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      });
      expect(screen.getByText('正在生成的新会话')).toBeTruthy();
    });
  });

  it('当前会话只有显式 skill 时，左侧兜底标题显示命令名而不是 sessionId', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    for (const listener of storageChangeListeners) {
      listener({
        'agent-v2-current-session': {
          oldValue: null,
          newValue: {
            sessionId: 'pending-skill-session',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: [
              '<webmcp_explicit_skill name="/ewankb-server-query">',
              '你必须优先遵循下面这个 skill，严格按其中要求执行：',
              '# /ewankb-server-query',
              '</webmcp_explicit_skill>',
            ].join('\n'),
            selectedAt: '2026-05-19T12:10:00.000Z',
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByText('/ewankb-server-query')).toBeTruthy();
    });
  });

  it('删除当前会话时会把右侧聊天重置到新会话', async () => {
    mockReadCurrentSession.mockResolvedValue({
      sessionId: '993b4517',
      projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
      title: '993b4517',
      selectedAt: '2026-05-19T12:00:00.000Z',
    });

    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    const sessionCard = screen.getByRole('button', { name: /993b4517/ });
    const sessionSection = sessionCard.closest('section');
    fireEvent.click(within(sessionSection as HTMLElement).getAllByTitle('更多操作')[0]);
    fireEvent.click(await within(sessionSection as HTMLElement).findByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        sessionId: '993b4517',
      });
      expect(mockPublishProjectSelection).toHaveBeenCalledWith({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        kind: 'new_session',
      });
    });
  });

  it('存在 active run 时，只高亮对应工作区卡和会话卡', async () => {
    mockSessionRunsByProject.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: '993b4517',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        runId: 'run-1',
        status: 'streaming',
        startedAt: '2026-05-19T12:00:00.000Z',
        lastEventAt: '2026-05-19T12:01:00.000Z',
        latestSequence: 8,
        hasActiveStream: true,
      },
    ]);

    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    expect(screen.getByLabelText('工作区运行中: accr-ui')).toBeTruthy();
    expect(screen.queryByLabelText('工作区运行中: ccu')).toBeNull();
    expect(screen.getByLabelText('会话运行中: 993b4517')).toBeTruthy();
    expect(screen.queryByLabelText('会话运行中: ccu-session')).toBeNull();
  });

  it('没有 active run 时不显示运行中图标', async () => {
    mockSessionRunsByProject.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: '993b4517',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-05-19T12:00:00.000Z',
        lastEventAt: '2026-05-19T12:01:00.000Z',
        latestSequence: 8,
        hasActiveStream: false,
      },
    ]);

    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    expect(screen.queryByLabelText('工作区运行中: accr-ui')).toBeNull();
    expect(screen.queryByLabelText('会话运行中: 993b4517')).toBeNull();
  });

  it('当前会话兜底项与运行中图标可以同时显示', async () => {
    mockSessionRunsByProject.set('/Users/zhanglt21/Desktop/accrnew/accr-ui', [
      {
        sessionId: 'pending-session',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        runId: 'run-pending',
        status: 'connecting',
        startedAt: '2026-05-19T12:10:00.000Z',
        lastEventAt: '2026-05-19T12:11:00.000Z',
        latestSequence: 2,
        hasActiveStream: true,
      },
    ]);

    render(<AgentWorkspacesPage />);

    await screen.findByText('993b4517');

    for (const listener of storageChangeListeners) {
      listener({
        'agent-v2-current-session': {
          oldValue: null,
          newValue: {
            sessionId: 'pending-session',
            projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
            title: '正在生成的新会话',
            selectedAt: '2026-05-19T12:10:00.000Z',
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByText('正在生成的新会话')).toBeTruthy();
      expect(screen.getByLabelText('工作区运行中: accr-ui')).toBeTruthy();
      expect(screen.getByLabelText('会话运行中: 正在生成的新会话')).toBeTruthy();
    });
  });

  it('目录浏览失败时显示中文错误信息', async () => {
    mockPickWorkspaceFolder.mockRejectedValueOnce(
      new Error('System folder picker is not supported on this platform')
    );
    mockBrowseWorkspaceFolders.mockRejectedValueOnce(
      new Error('Workspace directory does not exist')
    );

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '新增工作区' }));

    await screen.findByText('当前路径不存在，请重新选择本地文件夹。');
  });

  it('工作区目录选择弹窗支持按名称过滤', async () => {
    mockPickWorkspaceFolder.mockRejectedValueOnce(
      new Error('System folder picker is not supported on this platform')
    );
    mockBrowseWorkspaceFolders.mockResolvedValueOnce({
      path: '/Users/zhanglt21',
      parentPath: '/Users',
      folders: [
        { name: 'Desktop', path: '/Users/zhanglt21/Desktop' },
        { name: 'Documents', path: '/Users/zhanglt21/Documents' },
      ],
    });

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '新增工作区' }));

    await screen.findByText('Desktop');
    fireEvent.change(screen.getByPlaceholderText('过滤文件夹'), {
      target: { value: 'desk' },
    });

    expect(screen.getByText('Desktop')).toBeTruthy();
    expect(screen.queryByText('Documents')).toBeNull();
  });

  it('工作区目录选择弹窗支持新建文件夹', async () => {
    mockPickWorkspaceFolder.mockRejectedValueOnce(
      new Error('System folder picker is not supported on this platform')
    );
    mockBrowseWorkspaceFolders
      .mockResolvedValueOnce({
        path: '/Users/zhanglt21',
        parentPath: '/Users',
        folders: [{ name: 'Desktop', path: '/Users/zhanglt21/Desktop' }],
      })
      .mockResolvedValueOnce({
        path: '/Users/zhanglt21',
        parentPath: '/Users',
        folders: [
          { name: 'Desktop', path: '/Users/zhanglt21/Desktop' },
          { name: 'workspace-a', path: '/Users/zhanglt21/workspace-a' },
        ],
      });

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '新增工作区' }));
    await screen.findByText('Desktop');

    fireEvent.change(screen.getByPlaceholderText('输入新文件夹名称'), {
      target: { value: 'workspace-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建文件夹' }));

    await waitFor(() => {
      expect(mockCreateWorkspaceFolder).toHaveBeenCalledWith({
        parentPath: '/Users/zhanglt21',
        name: 'workspace-a',
      });
    });
    await screen.findByText('workspace-a');
  });

  it('详细视图点击文件夹会展开子项，再次点击会收起它们', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'src',
          name: 'src',
          type: 'directory',
          size: 0,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'src',
          name: 'src',
          type: 'directory',
          size: 0,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'src/index.ts',
          name: 'index.ts',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'src/index.ts',
          name: 'index.ts',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ]);

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '切换到文件管理' }));

    const folder = await screen.findByText('src');
    fireEvent.click(folder);

    await screen.findByText('index.ts');
    expect(document.body.textContent).not.toContain('README.md');

    fireEvent.click(screen.getByText('文件'));

    await waitFor(() => {
      expect(screen.queryByText('index.ts')).toBeNull();
    });
    expect(document.body.textContent).toContain('README.md');
  });

  it('嵌入设置页时把刷新按钮放到工作区列标题里', async () => {
    render(<AgentWorkspacesContent embedded />);

    const workspaceTitle = await screen.findByText('工作区');
    const workspaceColumn = workspaceTitle.closest('aside');

    expect(workspaceColumn).toBeTruthy();
    expect(
      within(workspaceColumn as HTMLElement).getByRole('button', { name: '刷新工作区列表' })
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '工作区管理' })).toBeNull();
  });

  it('点击文件夹时直接进入目录，不再请求展开子节点', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: '.agent-browser',
          name: '.agent-browser',
          type: 'directory',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser',
          name: '.agent-browser',
          type: 'directory',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser/config.json',
          name: 'config.json',
          type: 'file',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser/config.json',
          name: 'config.json',
          type: 'file',
        },
      ]);

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '切换到文件管理' }));

    const folder = await screen.findByText('.agent-browser');
    fireEvent.click(folder);

    await screen.findByText('config.json');
    expect(document.body.textContent).toContain('config.json');
  });

  it('默认使用轻量文件列表请求，不拉取大小和修改时间元数据', async () => {
    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');

    expect(mockListFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });

  it('短时间内返回同一路径时直接复用缓存，避免重复请求', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: '.agent-browser',
          name: '.agent-browser',
          type: 'directory',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser',
          name: '.agent-browser',
          type: 'directory',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser/config.json',
          name: 'config.json',
          type: 'file',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '.agent-browser/config.json',
          name: 'config.json',
          type: 'file',
        },
      ]);

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '切换到文件管理' }));

    const folder = await screen.findByText('.agent-browser');
    fireEvent.click(folder);

    await screen.findByText('config.json');
    const callsAfterOpen = mockListFiles.mock.calls.length;

    fireEvent.click(screen.getByText('文件'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('.agent-browser');
    });
    expect(mockListFiles.mock.calls.length).toBeLessThanOrEqual(callsAfterOpen + 1);

    fireEvent.click(screen.getByText('.agent-browser'));
    await screen.findByText('config.json');

    await waitFor(() => {
      expect(mockListFiles.mock.calls.length).toBeLessThanOrEqual(callsAfterOpen + 1);
    });
  });

  it('带定位参数进入时自动打开对应工作区目录', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    expect(mockListFiles).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        dirPath: 'captures/example',
        maxDepth: 0,
        includeMetadata: false,
      })
    );
  });

  it('文件区面包屑支持点击切换到中间层级目录', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          size: 128,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'captures/notes.txt',
          name: 'notes.txt',
          type: 'file',
          size: 32,
          modifiedAt: '2026-05-12T07:00:00.000Z',
        },
      ]);

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: 'captures' }));

    await screen.findByText('notes.txt');
    expect(
      findListFilesCalls(
        (input) =>
          input.projectPath === '/Users/zhanglt21/Desktop/accrnew/accr-ui' &&
          input.dirPath === 'captures' &&
          input.maxDepth === 0 &&
          input.includeMetadata === false
      ).length
    ).toBeGreaterThan(0);
  });

  it('带目标目录进入后，手动切换左侧工作区不会被路由目标强制切回', async () => {
    mockListFiles.mockImplementation(async ({ projectPath }: { projectPath: string }) => {
      if (projectPath === '/Users/zhanglt21/Desktop/ccu') {
        return [
          {
            path: 'CCU.md',
            name: 'CCU.md',
            type: 'file',
            size: 64,
            modifiedAt: '2026-05-12T08:00:00.000Z',
          },
        ];
      }
      return [
        {
          path: 'captures/example/index.html',
          name: 'index.html',
          type: 'file',
          size: 64,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
      ];
    });

    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    await screen.findByText('index.html');

    fireEvent.click(screen.getByRole('button', { name: /ccu/ }));

    await screen.findByText('ccu-session');
    await screen.findByText('CCU.md');
  });

  it('点击新增后优先使用系统文件夹选择框并自动加入工作区', async () => {
    mockPickWorkspaceFolder.mockResolvedValue({
      projectPath: 'C:\\Users\\Administrator\\Desktop\\picked-workspace',
    });

    render(<AgentWorkspacesPage />);

    fireEvent.click(screen.getByRole('button', { name: '新增工作区' }));

    await waitFor(() => {
      expect(mockPickWorkspaceFolder).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockAddWorkspace).toHaveBeenCalledWith({
        projectPath: 'C:\\Users\\Administrator\\Desktop\\picked-workspace',
      });
    });
    expect(mockBrowseWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('无工作区且等待创建新会话时只显示提示，不会自动弹出选择器', async () => {
    const originalProjects = [...mockProjects];
    mockProjects.splice(0, mockProjects.length);
    mockReadWorkspaceIntent.mockResolvedValue({
      kind: 'new_session',
      requestedAt: '2026-05-17T01:00:00.000Z',
    });
    mockPickWorkspaceFolder.mockResolvedValue({
      projectPath: 'C:\\Users\\Administrator\\Desktop\\picked-workspace',
    });

    try {
      render(<AgentWorkspacesPage />);

      await screen.findByText(
        '当前聊天页正在等待一个工作区来创建新会话。请选择一个已有工作区，或先新增工作区。'
      );

      await waitFor(() => {
        expect(mockPickWorkspaceFolder).not.toHaveBeenCalled();
        expect(mockAddWorkspace).not.toHaveBeenCalled();
        expect(mockBrowseWorkspaceFolders).not.toHaveBeenCalled();
      });
    } finally {
      mockProjects.splice(0, mockProjects.length, ...originalProjects);
    }
  });

  it('切换工作区后的首屏文件树请求仍使用轻量模式', async () => {
    mockListFiles.mockImplementation(async ({ projectPath }: { projectPath: string }) => {
      if (projectPath === '/Users/zhanglt21/Desktop/ccu') {
        return [
          {
            path: 'docs',
            name: 'docs',
            type: 'directory',
          },
        ];
      }
      return [
        {
          path: 'README.md',
          name: 'README.md',
          type: 'file',
        },
      ];
    });

    render(<AgentWorkspacesPage />);

    await screen.findByText('README.md');
    const callsBeforeSwitch = mockListFiles.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /^ccu\b/i }));

    await screen.findByText('docs');
    expect(
      mockListFiles.mock.calls
        .slice(callsBeforeSwitch)
        .map(([input]) => input)
        .some(
          (input) =>
            input?.projectPath === '/Users/zhanglt21/Desktop/ccu' &&
            input.dirPath === undefined &&
            input.maxDepth === 0 &&
            input.includeMetadata === false
        )
    ).toBe(true);
  });

  it('当排序依赖 metadata 字段时会升级请求 includeMetadata', async () => {
    mockListFiles
      .mockResolvedValueOnce([
        {
          path: 'a.txt',
          name: 'a.txt',
          type: 'file',
        },
        {
          path: 'b.txt',
          name: 'b.txt',
          type: 'file',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: 'a.txt',
          name: 'a.txt',
          type: 'file',
          size: 10,
          modifiedAt: '2026-05-12T06:00:00.000Z',
        },
        {
          path: 'b.txt',
          name: 'b.txt',
          type: 'file',
          size: 20,
          modifiedAt: '2026-05-13T06:00:00.000Z',
        },
      ]);

    render(<AgentWorkspacesPage />);

    await screen.findByText('a.txt');
    await waitFor(() => {
      expect(
        findListFilesCalls(
          (input) =>
            input.projectPath === '/Users/zhanglt21/Desktop/accrnew/accr-ui' &&
            input.dirPath === undefined &&
            input.maxDepth === 0 &&
            input.includeMetadata === true
        )
      ).not.toHaveLength(0);
    });

    fireEvent.click(
      within(screen.getByTestId('workspace-layout')).getByRole('button', { name: '修改' })
    );

    await waitFor(() => {
      const fileRow = document.querySelector('[data-file-path="a.txt"]');
      expect(fileRow).toBeTruthy();
      expect(
        within(fileRow as HTMLElement).getByTestId('file-modified-cell').textContent
      ).not.toBe('-');
    });
  });

  it('metadata 升级未返回前保留轻量文件行与占位，返回后再补全真实字段', async () => {
    const metadataUpgrade = createDeferred<
      Array<{
        path: string;
        name: string;
        type: 'file';
        size: number;
        modifiedAt: string;
      }>
    >();
    mockListFiles.mockImplementation(
      async ({
        includeMetadata,
      }: {
        projectPath: string;
        dirPath?: string;
        maxDepth?: number;
        includeMetadata?: boolean;
      }) => {
        if (includeMetadata) {
          return metadataUpgrade.promise;
        }
        return [
          {
            path: 'a.txt',
            name: 'a.txt',
            type: 'file',
          },
        ];
      }
    );

    render(<AgentWorkspacesPage />);

    await screen.findByText('a.txt');
    const callsBeforeSort = mockListFiles.mock.calls.length;

    fireEvent.click(
      within(screen.getByTestId('workspace-layout')).getByRole('button', { name: '大小' })
    );

    await waitFor(() => {
      expect(
        findListFilesCalls(
          (input) =>
            input.projectPath === '/Users/zhanglt21/Desktop/accrnew/accr-ui' &&
            input.dirPath === undefined &&
            input.maxDepth === 0 &&
            input.includeMetadata === true,
          callsBeforeSort
        )
      ).not.toHaveLength(0);
    });

    const fileRowBeforeUpgrade = document.querySelector('[data-file-path="a.txt"]');
    expect(fileRowBeforeUpgrade).toBeTruthy();
    expect(
      within(fileRowBeforeUpgrade as HTMLElement).getByTestId('file-size-cell').textContent
    ).toBe('-');
    expect(
      within(fileRowBeforeUpgrade as HTMLElement).getByTestId('file-modified-cell').textContent
    ).toBe('-');

    metadataUpgrade.resolve([
      {
        path: 'a.txt',
        name: 'a.txt',
        type: 'file',
        size: 10,
        modifiedAt: '2026-05-13T06:00:00.000Z',
      },
    ]);

    await screen.findByText('10 B');
    const fileRowAfterUpgrade = document.querySelector('[data-file-path="a.txt"]');
    expect(fileRowAfterUpgrade).toBeTruthy();
    expect(
      within(fileRowAfterUpgrade as HTMLElement).getByTestId('file-size-cell').textContent
    ).toBe('10 B');
    expect(
      within(fileRowAfterUpgrade as HTMLElement).getByTestId('file-modified-cell').textContent
    ).not.toBe('-');
  });

  it('默认按名称排序时也会在后台补齐 metadata 字段', async () => {
    const metadataUpgrade = createDeferred<
      Array<{
        path: string;
        name: string;
        type: 'file';
        size: number;
        modifiedAt: string;
      }>
    >();
    mockListFiles.mockImplementation(
      async ({
        includeMetadata,
      }: {
        projectPath: string;
        dirPath?: string;
        maxDepth?: number;
        includeMetadata?: boolean;
      }) => {
        if (includeMetadata) {
          return metadataUpgrade.promise;
        }
        return [
          {
            path: 'a.txt',
            name: 'a.txt',
            type: 'file',
          },
        ];
      }
    );

    render(<AgentWorkspacesPage />);

    await screen.findByText('a.txt');
    await waitFor(() => {
      expect(
        findListFilesCalls(
          (input) =>
            input.projectPath === '/Users/zhanglt21/Desktop/accrnew/accr-ui' &&
            input.dirPath === undefined &&
            input.maxDepth === 0 &&
            input.includeMetadata === true,
          1
        )
      ).not.toHaveLength(0);
    });

    const fileRowBeforeUpgrade = document.querySelector('[data-file-path="a.txt"]');
    expect(fileRowBeforeUpgrade).toBeTruthy();
    expect(
      within(fileRowBeforeUpgrade as HTMLElement).getByTestId('file-size-cell').textContent
    ).toBe('-');

    metadataUpgrade.resolve([
      {
        path: 'a.txt',
        name: 'a.txt',
        type: 'file',
        size: 10,
        modifiedAt: '2026-05-13T06:00:00.000Z',
      },
    ]);

    await waitFor(() => {
      const fileRow = document.querySelector('[data-file-path="a.txt"]');
      expect(fileRow).toBeTruthy();
      expect(
        within(fileRow as HTMLElement).getByTestId('file-size-cell').textContent
      ).toBe('10 B');
    });
  });
});
