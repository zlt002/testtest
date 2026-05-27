import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentWorkspacesContent } from './agent-workspaces';

const longSessionTitle =
  '<browser_context> windowId: 737273780 tabId: 737270850 url: https://example.com/some/very/long/path';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
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
  buildHtmlBrowserPreviewUrl: vi.fn(),
  openHtmlBrowserPreview: vi.fn(),
}));

vi.mock('../lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    listFiles: vi.fn(async () => []),
    addWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    browseWorkspaceFolders: vi.fn(async () => ({
      path: '/Users/zhanglt21',
      parentPath: '/Users',
      folders: [],
    })),
    createFileEntry: vi.fn(),
    renameFileEntry: vi.fn(),
    deleteFileEntry: vi.fn(),
    readFile: vi.fn(),
    openFileEntry: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
  }),
}));

vi.mock('../lib/agent-v2/session-selection', () => ({
  AGENT_V2_SESSION_SELECTION_STORAGE_KEY: 'agent-v2-selection',
  clearAgentV2WorkspaceIntent: vi.fn(async () => undefined),
  publishAgentV2ProjectSelection: vi.fn(async () => undefined),
  publishAgentV2SessionSelection: vi.fn(async () => undefined),
  readAgentV2ProjectSelection: vi.fn(async () => null),
  readAgentV2WorkspaceIntent: vi.fn(async () => null),
}));

vi.mock('../lib/agent-v2/useAgentV2Sessions', () => ({
  useAgentV2Sessions: () => ({
    projects: [
      {
        projectKey: 'accr-ui',
        name: 'accr-ui',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        sessionCount: 1,
      },
    ],
    sessions: [
      {
        sessionId: '993b4517',
        title: longSessionTitle,
        updatedAt: '2026-05-12T06:13:00.000Z',
        projectPath: '/Users/zhanglt21/Desktop/accrnew/accr-ui',
        messageCount: 12,
      },
    ],
    status: 'idle',
    error: null,
    refresh: vi.fn(async () => undefined),
    refreshProjects: vi.fn(async () => undefined),
    clearSessions: vi.fn(),
    loadHistory: vi.fn(async () => null),
  }),
}));

describe('AgentWorkspacesContent layout', () => {
  it('keeps long generated session titles inside the session card', async () => {
    render(<AgentWorkspacesContent embedded />);

    const title = await screen.findByText(longSessionTitle);
    const button = title.closest('button');

    expect(button).toBeTruthy();
    expect(button).toHaveClass('min-w-0');
    expect(button).toHaveClass('overflow-hidden');
    expect(title).toHaveClass('truncate');
  });

  it('renders responsive session and file tabs for narrow layouts', async () => {
    const { container } = render(<AgentWorkspacesContent embedded />);

    expect(await screen.findByRole('button', { name: '切换到会话记录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '切换到文件管理' })).toBeTruthy();

    const layout = container.querySelector('[data-testid="workspace-layout"]');
    expect(layout).toBeTruthy();
    expect(layout).toHaveClass('grid-cols-[260px_minmax(0,1fr)]');
    expect(layout).toHaveClass('xl:grid-cols-[260px_280px_minmax(0,1fr)]');
  });

  it('prefers the file management tab when opened with a target entry path', async () => {
    render(
      <AgentWorkspacesContent
        embedded
        targetProjectPath="/Users/zhanglt21/Desktop/accrnew/accr-ui"
        targetEntryPath="captures/example"
      />
    );

    expect(await screen.findByRole('button', { name: '切换到文件管理' })).toHaveClass(
      'bg-primary'
    );
    expect(screen.getByRole('button', { name: '切换到会话记录' })).toHaveClass('border');
  });
});
