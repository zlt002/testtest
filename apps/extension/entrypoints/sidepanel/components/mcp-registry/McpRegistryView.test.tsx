// @vitest-environment node

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMcpRegistry = vi.fn(async () => ({ servers: [], rawJson: '{ "mcpServers": {} }' }));
const listMcpServerTools = vi.fn(async () => ({ server: null, tools: [] }));
const upsertMcpServer = vi.fn(async () => ({ servers: [], rawJson: '{ "mcpServers": {} }' }));
const deleteMcpServer = vi.fn(async () => ({ servers: [], rawJson: '{ "mcpServers": {} }' }));
const setMcpServerEnabled = vi.fn(async () => ({ servers: [], rawJson: '{ "mcpServers": {} }' }));
const runtimeListeners = new Set<(message: unknown) => void>();

vi.mock('@/entrypoints/sidepanel/lib/config', () => ({
  config: {
    api: {
      agentV2BaseUrl: 'http://localhost:3000',
      agentV2Endpoint: '/api',
    },
  },
}));

vi.mock('@/entrypoints/sidepanel/lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    listMcpRegistry,
    listMcpServerTools,
    upsertMcpServer,
    writeMcpRawConfig: vi.fn(),
    setMcpServerEnabled,
    deleteMcpServer,
    setMcpToolEnabled: vi.fn(),
  }),
}));

vi.mock('@/entrypoints/sidepanel/lib/agent-v2/session-selection', () => ({
  AGENT_V2_PROJECT_SELECTED_MESSAGE: 'agent_v2_project_selected',
  isAgentV2ProjectSelectedMessage: (message: unknown) =>
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'agent_v2_project_selected' &&
    typeof (message as { payload?: { projectPath?: unknown } }).payload?.projectPath === 'string',
  readAgentV2ProjectSelection: vi.fn(async () => null),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  buildConfigEditorJsonText,
  buildServerConfig,
  McpRegistryView,
  parseConfigObjectToDraft,
} from './McpRegistryView';

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com',
  });

  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
  vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
});

beforeEach(() => {
  listMcpRegistry.mockClear();
  listMcpServerTools.mockClear();
  upsertMcpServer.mockClear();
  deleteMcpServer.mockClear();
  setMcpServerEnabled.mockClear();
  runtimeListeners.clear();
  listMcpRegistry.mockResolvedValue({ servers: [], rawJson: '{ "mcpServers": {} }' });
  listMcpServerTools.mockResolvedValue({ server: null, tools: [] });
  upsertMcpServer.mockResolvedValue({ servers: [], rawJson: '{ "mcpServers": {} }' });
  deleteMcpServer.mockResolvedValue({ servers: [], rawJson: '{ "mcpServers": {} }' });
  setMcpServerEnabled.mockResolvedValue({ servers: [], rawJson: '{ "mcpServers": {} }' });
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners.add(listener);
        }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners.delete(listener);
        }),
      },
    },
  });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  );
});

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

describe('McpRegistryView', () => {
  it('shows unified empty state when no mcp servers match filters', async () => {
    const view = render(<McpRegistryView showHeading={false} />);

    expect(await view.findByText('没有找到 MCP 服务')).toBeTruthy();
    expect(view.getByText('请调整搜索词或筛选条件，然后再试一次。')).toBeTruthy();

    const emptyIcon = document.querySelector(
      'img[src="/icon/claude-ai-icon.svg"]'
    ) as HTMLImageElement | null;
    expect(emptyIcon).toBeTruthy();
    expect(emptyIcon?.className).toContain('opacity-50');
    expect(emptyIcon?.className).toContain('grayscale');
  });

  it('reloads registry when selected project changes', async () => {
    render(<McpRegistryView showHeading={false} />);

    await waitFor(() => {
      expect(listMcpRegistry).toHaveBeenCalledWith({ projectPath: undefined });
    });

    await act(async () => {
      for (const listener of runtimeListeners) {
        listener({
          type: 'agent_v2_project_selected',
          payload: {
            projectPath: '/tmp/project-b',
            selectedAt: '2026-05-17T12:00:00.000Z',
          },
        });
      }
    });

    await waitFor(() => {
      expect(listMcpRegistry).toHaveBeenLastCalledWith({ projectPath: '/tmp/project-b' });
    });
  });

  it('shows source filter select and project config action in the top toolbar', async () => {
    const view = render(<McpRegistryView showHeading={false} />);

    expect(await view.findByRole('button', { name: '新增 MCP' })).toBeTruthy();
    expect(view.getByRole('combobox', { name: '来源筛选' })).toBeTruthy();
    expect(view.getByRole('button', { name: '查看项目 MCP 配置' })).toBeTruthy();
  });

  it('shows bulk toggle actions and enables visible servers', async () => {
    const servers = [
      {
        name: 'alpha',
        builtIn: false,
        disabled: true,
        type: 'stdio',
        source: 'user',
        config: { command: 'node', args: ['alpha.js'] },
        enabledToolCount: 0,
        totalToolCount: 0,
        status: 'disabled',
      },
      {
        name: 'beta',
        builtIn: false,
        disabled: true,
        type: 'http',
        source: 'project',
        config: { url: 'https://example.com/beta' },
        enabledToolCount: 0,
        totalToolCount: 0,
        status: 'disabled',
      },
    ];
    listMcpRegistry.mockResolvedValue({
      servers,
      rawJson: '{ "mcpServers": {} }',
    });

    const view = render(<McpRegistryView showHeading={false} />);

    expect(await view.findByRole('button', { name: '\u5168\u90e8\u5f00\u542f' })).toBeTruthy();
    expect(view.getByRole('button', { name: '\u5168\u90e8\u5173\u95ed' })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '\u5168\u90e8\u5f00\u542f' }));

    await waitFor(() => {
      expect(setMcpServerEnabled).toHaveBeenCalledTimes(2);
      expect(setMcpServerEnabled).toHaveBeenCalledWith('alpha', true, {
        projectPath: undefined,
      });
      expect(setMcpServerEnabled).toHaveBeenCalledWith('beta', true, {
        projectPath: undefined,
      });
    });
  });

  it('shows unified create action and submits user scope payload', async () => {
    upsertMcpServer.mockResolvedValueOnce({
      servers: [
        {
          name: 'gitnexus',
          builtIn: false,
          disabled: false,
          type: 'stdio',
          source: 'user',
          config: { command: 'node', args: ['gitnexus.js'] },
          enabledToolCount: 0,
          totalToolCount: 0,
          status: 'enabled',
        },
      ],
      rawJson: '{ "mcpServers": {} }',
    });

    const view = render(<McpRegistryView showHeading={false} />);

    expect(await view.findByRole('button', { name: '新增 MCP' })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '新增 MCP' }));
    await waitFor(() => {
      expect(view.getByLabelText('服务名')).toBeTruthy();
    });
    fireEvent.change(view.getByLabelText('服务名'), { target: { value: 'gitnexus' } });
    fireEvent.change(view.getByLabelText('命令'), { target: { value: 'node' } });
    fireEvent.change(view.getByLabelText('参数'), { target: { value: 'gitnexus.js' } });
    await waitFor(() => {
      expect((view.getByLabelText('服务名') as HTMLInputElement).value).toBe('gitnexus');
      expect((view.getByLabelText('命令') as HTMLInputElement).value).toBe('node');
      expect((view.getByLabelText('参数') as HTMLInputElement).value).toBe('gitnexus.js');
    });
    fireEvent.click(view.getByRole('button', { name: '保存 MCP 服务' }));

    await waitFor(() => {
      expect(upsertMcpServer).toHaveBeenCalledWith({
        name: 'gitnexus',
        scope: 'user',
        projectPath: undefined,
        config: { command: 'node', args: ['gitnexus.js'] },
      });
    });
  });

  it('allows choosing scope when creating a mcp', async () => {
    const view = render(<McpRegistryView showHeading={false} />);

    fireEvent.click(await view.findByRole('button', { name: '新增 MCP' }));
    await waitFor(() => {
      expect(view.getByLabelText('写入范围')).toBeTruthy();
      expect(view.getByRole('button', { name: '表单' })).toBeTruthy();
      expect(view.getByRole('button', { name: 'JSON' })).toBeTruthy();
    });
  });

  it('submits project scope payload when create scope is switched to project', async () => {
    const view = render(<McpRegistryView showHeading={false} />);

    fireEvent.click(await view.findByRole('button', { name: '新增 MCP' }));
    await waitFor(() => {
      expect(view.getByLabelText('写入范围')).toBeTruthy();
    });

    fireEvent.click(view.getByRole('button', { name: '项目' }));

    fireEvent.change(view.getByLabelText('服务名'), { target: { value: 'repowise' } });
    fireEvent.change(view.getByLabelText('命令'), { target: { value: 'node' } });
    fireEvent.change(view.getByLabelText('参数'), { target: { value: 'repowise.js' } });
    fireEvent.click(view.getByRole('button', { name: '保存 MCP 服务' }));

    await waitFor(() => {
      expect(upsertMcpServer).toHaveBeenCalledWith({
        name: 'repowise',
        scope: 'project',
        projectPath: undefined,
        config: { command: 'node', args: ['repowise.js'] },
      });
    });
  });

  it('builds json config from form draft and keeps advanced fields', () => {
    expect(
      buildServerConfig(
        {
          name: 'gitnexus',
          type: 'stdio',
          command: 'node',
          argsText: 'gitnexus.js --stdio',
          url: '',
          envText: '{\n  "DEBUG": "1"\n}',
          headersText: '',
        },
        { timeout: 30_000 }
      )
    ).toEqual({
      command: 'node',
      args: ['gitnexus.js', '--stdio'],
      env: { DEBUG: '1' },
      timeout: 30_000,
    });
  });

  it('builds full mcpServers json text for editor', () => {
    expect(
      buildConfigEditorJsonText({
        name: 'repowise',
        type: 'stdio',
        command: 'repowise',
        argsText: 'mcp /Users/zhanglt21/Documents/BMS --transport stdio',
        url: '',
        envText: '',
        headersText: '',
      })
    ).toContain('"mcpServers"');
  });

  it('parses json config back into draft fields and preserves extra fields', () => {
    expect(
      parseConfigObjectToDraft({
        command: 'uvx',
        args: ['gitnexus'],
        env: { DEBUG: '1' },
        timeout: 30_000,
      })
    ).toEqual({
      draft: {
        name: '',
        type: 'stdio',
        command: 'uvx',
        argsText: 'gitnexus',
        url: '',
        envText: '{\n  "DEBUG": "1"\n}',
        headersText: '',
      },
      extraConfigFields: {
        timeout: 30_000,
      },
      config: {
        command: 'uvx',
        args: ['gitnexus'],
        env: { DEBUG: '1' },
        timeout: 30_000,
      },
    });
  });

  it('parses full mcpServers json and extracts server name plus config', () => {
    expect(
      parseConfigObjectToDraft({
        mcpServers: {
          repowise: {
            command: 'repowise',
            args: ['mcp', '/Users/zhanglt21/Documents/BMS', '--transport', 'stdio'],
            description: 'repowise: codebase intelligence',
          },
        },
      })
    ).toEqual({
      draft: {
        name: 'repowise',
        type: 'stdio',
        command: 'repowise',
        argsText: 'mcp /Users/zhanglt21/Documents/BMS --transport stdio',
        url: '',
        envText: '',
        headersText: '',
      },
      extraConfigFields: {
        description: 'repowise: codebase intelligence',
      },
      config: {
        command: 'repowise',
        args: ['mcp', '/Users/zhanglt21/Documents/BMS', '--transport', 'stdio'],
        description: 'repowise: codebase intelligence',
      },
    });
  });

  it('rejects non-object json config in parser', () => {
    expect(() => parseConfigObjectToDraft([])).toThrow('JSON 视图必须是一个对象');
  });

  it('shows edit and delete actions for user scoped mcp server detail', async () => {
    listMcpRegistry.mockResolvedValueOnce({
      servers: [
        {
          name: 'gitnexus',
          builtIn: false,
          disabled: false,
          type: 'stdio',
          source: 'user',
          config: { command: 'node', args: ['gitnexus.js'] },
          enabledToolCount: 0,
          totalToolCount: 0,
          status: 'enabled',
        },
      ],
      rawJson: '{ "mcpServers": {} }',
    });
    listMcpServerTools.mockResolvedValue({
      server: {
        name: 'gitnexus',
        builtIn: false,
        disabled: false,
        type: 'stdio',
        source: 'user',
        config: { command: 'node', args: ['gitnexus.js'] },
        enabledToolCount: 0,
        totalToolCount: 0,
        status: 'enabled',
      },
      tools: [],
    });

    const view = render(<McpRegistryView showHeading={false} />);

    fireEvent.click(await view.findByRole('button', { name: /gitnexus/i }));
    await waitFor(() => {
      expect(listMcpServerTools).toHaveBeenCalledWith('gitnexus', { projectPath: undefined });
    });

    expect(await view.findByTitle('编辑 MCP 服务')).toBeTruthy();
    expect(view.getByTitle('删除 MCP 服务')).toBeTruthy();
  });
});
