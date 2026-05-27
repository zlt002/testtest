// @vitest-environment node

import { JSDOM } from 'jsdom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagementWorkspace } from './ManagementWorkspace';

const listCapabilitiesMock = vi.fn();
const readCapabilityMock = vi.fn();
const readCapabilityFileMock = vi.fn();
const createCapabilityMock = vi.fn();
const updateCapabilityMock = vi.fn();
const updateCapabilityFileMock = vi.fn();
const deleteCapabilityMock = vi.fn();
const setCapabilityEnabledMock = vi.fn();
const importSkillDirectoryMock = vi.fn();
const importSkillBundleMock = vi.fn();
const listPluginsMock = vi.fn();
const installPluginMock = vi.fn();
const importPluginDirectoryMock = vi.fn();
const setPluginEnabledMock = vi.fn();
const deletePluginMock = vi.fn();
const listHooksOverviewMock = vi.fn();

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    editable = true,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    editable?: boolean;
  }) => (
    <textarea
      aria-label="code-editor"
      value={value || ''}
      readOnly={!editable}
      onInput={(event) => onChange?.((event.target as HTMLTextAreaElement).value)}
    />
  ),
}));

vi.mock('@/entrypoints/sidepanel/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/entrypoints/sidepanel/components/ui/select', async () => {
  const runtimeReact = await import('react');
  const SelectContext = runtimeReact.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children?: ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder || ''}</span>,
    SelectContent: ({ children }: { children?: ReactNode }) => {
      const { value, onValueChange } = runtimeReact.useContext(SelectContext);
      return (
        <select
          aria-label="mock-select"
          value={value || ''}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

vi.mock('@/entrypoints/sidepanel/lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    listCapabilities: listCapabilitiesMock,
    readCapability: readCapabilityMock,
    readCapabilityFile: readCapabilityFileMock,
    createCapability: createCapabilityMock,
    updateCapability: updateCapabilityMock,
    updateCapabilityFile: updateCapabilityFileMock,
    deleteCapability: deleteCapabilityMock,
    setCapabilityEnabled: setCapabilityEnabledMock,
    importSkillDirectory: importSkillDirectoryMock,
    importSkillBundle: importSkillBundleMock,
    listPlugins: listPluginsMock,
    installPlugin: installPluginMock,
    importPluginDirectory: importPluginDirectoryMock,
    setPluginEnabled: setPluginEnabledMock,
    deletePlugin: deletePluginMock,
    listHooksOverview: listHooksOverviewMock,
  }),
}));

vi.mock('@/entrypoints/sidepanel/lib/config', () => ({
  config: {
    api: {
      agentV2BaseUrl: 'http://localhost:3000',
      agentV2Endpoint: '/api',
    },
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject } satisfies Deferred<T>;
}

const skillCapability = {
  id: 'skill-1',
  type: 'skill',
  name: 'demo-skill',
  enabled: true,
  editable: true,
  path: '/home/.claude/skills/demo-skill/SKILL.md',
  source: { kind: 'user', path: '/home/.claude/skills/demo-skill/SKILL.md' },
};

const secondSkillCapability = {
  id: 'skill-2',
  type: 'skill',
  name: 'other-skill',
  enabled: true,
  editable: true,
  path: '/home/.claude/skills/other-skill/SKILL.md',
  source: { kind: 'user', path: '/home/.claude/skills/other-skill/SKILL.md' },
};

function skillFiles() {
  return [
    { path: 'SKILL.md', name: 'SKILL.md', kind: 'file' },
    {
      path: 'docs',
      name: 'docs',
      kind: 'directory',
      children: [{ path: 'docs/guide.md', name: 'guide.md', kind: 'file' }],
    },
    {
      path: 'scripts',
      name: 'scripts',
      kind: 'directory',
      children: [{ path: 'scripts/helper.py', name: 'helper.py', kind: 'file' }],
    },
    {
      path: 'assets',
      name: 'assets',
      kind: 'directory',
      children: [{ path: 'assets/logo.png', name: 'logo.png', kind: 'file' }],
    },
  ];
}

function queueSkillDetail(item = skillCapability, content = '# Demo Skill\n') {
  readCapabilityMock.mockResolvedValueOnce({
    success: true,
    capability: item,
    content,
    selectedFilePath: 'SKILL.md',
    files: skillFiles(),
  });
}

async function openSkillDetails() {
  const view = render(<ManagementWorkspace mode="skills" hideModeSelect={true} />);
  fireEvent.click(await view.findByText('demo-skill'));
  await view.findByRole('button', { name: 'SKILL.md' });
  return view;
}

async function openHelperFile(
  view: ReturnType<typeof render>,
  options?: { content?: string; preMocked?: boolean }
) {
  if (!options?.preMocked) {
    readCapabilityFileMock.mockResolvedValueOnce({
      success: true,
      capability: skillCapability,
      path: 'scripts/helper.py',
      content: options?.content || 'print("demo")\n',
      encoding: 'utf8',
    });
  }
  fireEvent.click(view.getByText('helper.py'));
  await waitFor(() => {
    expect(readCapabilityFileMock).toHaveBeenCalledWith({
      id: 'skill-1',
      projectPath: undefined,
      path: 'scripts/helper.py',
    });
  });
  expect(await view.findByText('scripts/helper.py')).toBeTruthy();
}

async function openGuideFile(
  view: ReturnType<typeof render>,
  options?: { content?: string; preMocked?: boolean }
) {
  if (!options?.preMocked) {
    readCapabilityFileMock.mockResolvedValueOnce({
      success: true,
      capability: skillCapability,
      path: 'docs/guide.md',
      content: options?.content || '# Guide\n\nBase content\n',
      encoding: 'utf8',
    });
  }
  fireEvent.click(view.getByText('guide.md'));
  await waitFor(() => {
    expect(readCapabilityFileMock).toHaveBeenCalledWith({
      id: 'skill-1',
      projectPath: undefined,
      path: 'docs/guide.md',
    });
  });
  expect(await view.findByText('docs/guide.md')).toBeTruthy();
}

describe('ManagementWorkspace', () => {
  beforeAll(() => {
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
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    listCapabilitiesMock.mockReset();
    readCapabilityMock.mockReset();
    readCapabilityFileMock.mockReset();
    createCapabilityMock.mockReset();
    updateCapabilityMock.mockReset();
    updateCapabilityFileMock.mockReset();
    deleteCapabilityMock.mockReset();
    setCapabilityEnabledMock.mockReset();
    importSkillDirectoryMock.mockReset();
    importSkillBundleMock.mockReset();
    listPluginsMock.mockReset();
    installPluginMock.mockReset();
    importPluginDirectoryMock.mockReset();
    setPluginEnabledMock.mockReset();
    deletePluginMock.mockReset();
    listHooksOverviewMock.mockReset();

    listCapabilitiesMock.mockResolvedValue({
      capabilities: [skillCapability],
    });
    listPluginsMock.mockResolvedValue({
      plugins: [],
    });
  });

  it('shows enabled and total counts for command management', async () => {
    listCapabilitiesMock.mockResolvedValueOnce({
      capabilities: [
        {
          id: 'plugin-enabled',
          type: 'command',
          name: 'demo-plugin:enabled-command',
          enabled: true,
          editable: false,
          source: { kind: 'plugin', path: '/plugins/demo', pluginId: 'demo-plugin@local' },
        },
        {
          id: 'plugin-disabled',
          type: 'command',
          name: 'demo-plugin:disabled-command',
          enabled: false,
          editable: false,
          source: { kind: 'plugin', path: '/plugins/demo', pluginId: 'demo-plugin@local' },
        },
        {
          id: 'user-command',
          type: 'command',
          name: 'user-command',
          enabled: true,
          editable: true,
          source: { kind: 'user', path: '/user/.claude/commands/user-command.md' },
        },
      ],
    });

    const view = render(<ManagementWorkspace mode="commands" hideModeSelect={true} />);

    await waitFor(() => {
      expect(listCapabilitiesMock).toHaveBeenCalledWith({
        type: 'command',
        projectPath: undefined,
      });
    });

    expect(await view.findByText('2/3')).toBeTruthy();
  });

  it('defaults to plugin management when mode is uncontrolled', async () => {
    render(<ManagementWorkspace hideModeSelect={true} />);

    await waitFor(() => {
      expect(listPluginsMock).toHaveBeenCalled();
    });
  });

  it('installs a dev-local plugin through the new install api', async () => {
    listPluginsMock
      .mockResolvedValueOnce({ plugins: [] })
      .mockResolvedValueOnce({
        plugins: [
          {
            id: 'demo@local',
            name: 'Demo Plugin',
            enabled: true,
            path: 'C:\\temp\\demo-plugin',
            source: {
              kind: 'lite',
              path: 'C:\\Users\\Administrator\\.webmcp\\lite-plugin-registry.json',
              writable: true,
              removable: true,
            },
          },
        ],
      });
    installPluginMock.mockResolvedValueOnce({
      id: 'demo@local',
      name: 'Demo Plugin',
      enabled: true,
      path: 'C:\\temp\\demo-plugin',
      source: {
        kind: 'lite',
        path: 'C:\\Users\\Administrator\\.webmcp\\lite-plugin-registry.json',
        writable: true,
        removable: true,
      },
    });

    const view = render(<ManagementWorkspace hideModeSelect={true} />);
    await view.findByText('暂无插件');
    const openInstallDialogButton = view
      .getAllByRole('button')
      .find((element) => Boolean(element.querySelector('svg')) && !element.textContent?.trim());
    expect(openInstallDialogButton).toBeTruthy();
    fireEvent.click(openInstallDialogButton as HTMLButtonElement);
    expect(await view.findByText('安装插件')).toBeTruthy();
    const input = await view.findByPlaceholderText('本地插件目录绝对路径');
    fireEvent.change(input, { target: { value: 'C:\\temp\\demo-plugin' } });
    fireEvent.input(input, { target: { value: 'C:\\temp\\demo-plugin' } });
    const installButton = view.getByRole('button', { name: '安装' });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('C:\\temp\\demo-plugin');
      expect(installButton.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(installPluginMock).toHaveBeenCalledWith({
        source: { kind: 'dev-local', directory: 'C:\\temp\\demo-plugin' },
        scope: 'user',
      });
    });
    expect(await view.findByText('已安装开发插件')).toBeTruthy();
  });
  it('installs a github plugin through the new install api', async () => {
    listPluginsMock
      .mockResolvedValueOnce({ plugins: [] })
      .mockResolvedValueOnce({
        plugins: [
          {
            id: 'demo-github',
            name: 'Demo GitHub Plugin',
            enabled: true,
            source: {
              kind: 'github',
              repoUrl: 'https://github.com/example/demo-plugin#packages/plugin',
              writable: true,
              removable: true,
            },
          },
        ],
      });
    installPluginMock.mockResolvedValueOnce({
      id: 'demo-github',
      name: 'Demo GitHub Plugin',
      enabled: true,
      source: {
        kind: 'github',
        repoUrl: 'https://github.com/example/demo-plugin#packages/plugin',
        writable: true,
        removable: true,
      },
    });

    const view = render(<ManagementWorkspace hideModeSelect={true} />);
    await view.findByText('暂无插件');
    const openInstallDialogButton = view
      .getAllByRole('button')
      .find((element) => Boolean(element.querySelector('svg')) && !element.textContent?.trim());
    expect(openInstallDialogButton).toBeTruthy();
    fireEvent.click(openInstallDialogButton as HTMLButtonElement);
    expect(await view.findByText('安装插件')).toBeTruthy();

    const sourceModeSelect = (await view.findAllByLabelText('mock-select')).find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === 'github')
    ) as HTMLSelectElement | undefined;

    expect(sourceModeSelect).toBeTruthy();
    fireEvent.change(sourceModeSelect as HTMLSelectElement, { target: { value: 'github' } });

    const input = await view.findByPlaceholderText(
      'https://github.com/owner/repo#subdir'
    );
    fireEvent.change(input, {
      target: { value: 'https://github.com/example/demo-plugin#packages/plugin' },
    });
    fireEvent.input(input, {
      target: { value: 'https://github.com/example/demo-plugin#packages/plugin' },
    });

    expect(await view.findByText('支持输入完整 GitHub 仓库地址，可附带 #subdir。')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '安装' }));

    await waitFor(() => {
      expect(installPluginMock).toHaveBeenCalledWith({
        source: {
          kind: 'github',
          repoUrl: 'https://github.com/example/demo-plugin#packages/plugin',
        },
        scope: 'user',
      });
    });
    expect(await view.findByText('已安装 GitHub 插件')).toBeTruthy();
  });

  it('shows a GitHub badge for github plugins', async () => {
    listPluginsMock.mockResolvedValueOnce({
      plugins: [
        {
          id: 'demo-github',
          name: 'Demo GitHub Plugin',
          enabled: true,
          source: {
            kind: 'github',
            repoUrl: 'https://github.com/example/demo-plugin#packages/plugin',
            writable: true,
            removable: true,
          },
        },
      ],
    });

    const view = render(<ManagementWorkspace hideModeSelect={true} />);

    expect(await view.findByText('Demo GitHub Plugin')).toBeTruthy();
    expect(await view.findByText('GitHub')).toBeTruthy();
  });

  it('shows the skill file tree after selecting a skill', async () => {
    queueSkillDetail();

    const view = await openSkillDetails();

    expect(view.getByRole('button', { name: 'SKILL.md' })).toBeTruthy();
    expect(view.getByText('guide.md')).toBeTruthy();
    expect(view.getByText('helper.py')).toBeTruthy();
    expect(view.getByText('logo.png')).toBeTruthy();
  });

  it('calls readCapabilityFile when selecting another skill file', async () => {
    queueSkillDetail();

    const view = await openSkillDetails();
    await openHelperFile(view);

    await waitFor(() => {
      expect((view.getByLabelText('code-editor') as HTMLTextAreaElement).value).toBe(
        'print("demo")\n'
      );
    });
  });

  it('saves a skill child file via updateCapabilityFile', async () => {
    queueSkillDetail();
    updateCapabilityFileMock.mockResolvedValueOnce({
      success: true,
      path: 'scripts/helper.py',
    });

    const view = await openSkillDetails();
    await openHelperFile(view);

    const editor = (await view.findByLabelText('code-editor')) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'print("changed")' } });
    await waitFor(() => {
      expect(editor.value).toBe('print("changed")');
    });
    fireEvent.click(view.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(updateCapabilityFileMock).toHaveBeenCalledWith({
        id: 'skill-1',
        projectPath: undefined,
        path: 'scripts/helper.py',
        content: 'print("changed")',
      });
    });
  });

  it('uses save-and-continue to save dirty skill child content before switching', async () => {
    queueSkillDetail();
    updateCapabilityFileMock.mockResolvedValueOnce({
      success: true,
      path: 'scripts/helper.py',
    });
    readCapabilityFileMock
      .mockResolvedValueOnce({
        success: true,
        capability: skillCapability,
        path: 'scripts/helper.py',
        content: 'print("demo")\n',
        encoding: 'utf8',
      })
      .mockRejectedValueOnce(new Error('File is not text-editable'))
      .mockResolvedValueOnce({
        success: true,
        capability: skillCapability,
        path: 'docs/guide.md',
        content: '# Guide\n\nSaved\n',
        encoding: 'utf8',
      });

    const view = await openSkillDetails();
    await openHelperFile(view, { preMocked: true });

    const editor = (await view.findByLabelText('code-editor')) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'print("saved")' } });
    fireEvent.click(view.getByText('logo.png'));
    expect(await view.findByRole('dialog')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '保存并继续' }));

    await waitFor(() => {
      expect(updateCapabilityFileMock).toHaveBeenCalledWith({
        id: 'skill-1',
        projectPath: undefined,
        path: 'scripts/helper.py',
        content: 'print("saved")',
      });
    });
    await waitFor(() => {
      expect(view.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(updateCapabilityFileMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(view.getByText('guide.md'));
    expect(view.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(readCapabilityFileMock).toHaveBeenCalledTimes(2);
    });
  });

  it('uses cancel in the unsaved dialog to keep the current dirty file selected', async () => {
    queueSkillDetail();

    const view = await openSkillDetails();
    await openHelperFile(view);

    const editor = (await view.findByLabelText('code-editor')) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'print("demo")\n# dirty' } });
    fireEvent.click(view.getByRole('button', { name: 'SKILL.md' }));
    expect(await view.findByRole('dialog')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '取消' }));

    expect(view.queryByRole('dialog')).toBeNull();
    expect(view.getByText('scripts/helper.py')).toBeTruthy();
    expect((view.getByLabelText('code-editor') as HTMLTextAreaElement).value).toBe(
      'print("demo")\n# dirty'
    );
  });

  it('does not keep dirty state when switching to a non-text file after discarding changes', async () => {
    queueSkillDetail();
    readCapabilityFileMock
      .mockResolvedValueOnce({
        success: true,
        capability: skillCapability,
        path: 'scripts/helper.py',
        content: 'print("demo")\n',
        encoding: 'utf8',
      })
      .mockRejectedValueOnce(new Error('File is not text-editable'))
      .mockResolvedValueOnce({
        success: true,
        capability: skillCapability,
        path: 'scripts/helper.py',
        content: 'print("clean")\n',
        encoding: 'utf8',
      });

    const view = await openSkillDetails();
    await openHelperFile(view, { preMocked: true });

    const editor = (await view.findByLabelText('code-editor')) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'print("demo")\n# dirty' } });
    fireEvent.click(view.getByText('logo.png'));
    expect(await view.findByRole('dialog')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: '不保存' }));

    expect(await view.findByText('assets/logo.png')).toBeTruthy();
    expect(
      await view.findByText('This file is not available for text preview or editing.')
    ).toBeTruthy();
    expect(view.queryByLabelText('code-editor')).toBeNull();

    fireEvent.click(view.getByText('helper.py'));

    await waitFor(() => {
      expect(readCapabilityFileMock).toHaveBeenCalledTimes(3);
    });
    expect(view.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect((view.getByLabelText('code-editor') as HTMLTextAreaElement).value).toBe(
        'print("clean")\n'
      );
    });
  });

  it('restores markdown child file content when canceling edit mode', async () => {
    queueSkillDetail();

    const view = await openSkillDetails();
    await openGuideFile(view);

    fireEvent.click(view.getByRole('button', { name: '编辑' }));
    const editor = (await view.findByLabelText('code-editor')) as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: '# Guide\n\nChanged\n' } });
    await waitFor(() => {
      expect(editor.value).toBe('# Guide\n\nChanged\n');
    });

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    fireEvent.click(await view.findByRole('button', { name: '编辑' }));

    await waitFor(() => {
      expect((view.getByLabelText('code-editor') as HTMLTextAreaElement).value).toBe(
        '# Guide\n\nBase content\n'
      );
    });
  });

  it('shows a placeholder when a skill file is not text-editable', async () => {
    queueSkillDetail();
    readCapabilityFileMock.mockRejectedValueOnce(new Error('File is not text-editable'));

    const view = await openSkillDetails();
    fireEvent.click(view.getByText('logo.png'));

    await waitFor(() => {
      expect(readCapabilityFileMock).toHaveBeenCalledWith({
        id: 'skill-1',
        projectPath: undefined,
        path: 'assets/logo.png',
      });
    });

    expect(await view.findByText('assets/logo.png')).toBeTruthy();
    expect(
      await view.findByText('This file is not available for text preview or editing.')
    ).toBeTruthy();
    expect(view.queryByLabelText('code-editor')).toBeNull();
  });

  it('ignores stale skill detail responses when switching skills quickly', async () => {
    listCapabilitiesMock.mockResolvedValueOnce({
      capabilities: [skillCapability, secondSkillCapability],
    });

    const firstDetail = createDeferred<{
      success: boolean;
      capability: typeof skillCapability;
      content: string;
      selectedFilePath: string;
      files: ReturnType<typeof skillFiles>;
    }>();
    const secondDetail = createDeferred<{
      success: boolean;
      capability: typeof secondSkillCapability;
      content: string;
      selectedFilePath: string;
      files: ReturnType<typeof skillFiles>;
    }>();

    readCapabilityMock.mockImplementation(({ id }: { id: string }) => {
      if (id === 'skill-1') {
        return firstDetail.promise;
      }
      return secondDetail.promise;
    });

    const view = render(<ManagementWorkspace mode="skills" hideModeSelect={true} />);
    fireEvent.click(await view.findByRole('button', { name: /demo-skill/i }));
    fireEvent.click(await view.findByRole('button', { name: /other-skill/i }));

    secondDetail.resolve({
      success: true,
      capability: secondSkillCapability,
      content: '# Other Skill\n',
      selectedFilePath: 'SKILL.md',
      files: skillFiles(),
    });

    await waitFor(() => {
      expect(view.queryAllByText('other-skill')).toHaveLength(2);
      expect(view.queryAllByText('/home/.claude/skills/other-skill/SKILL.md')).toHaveLength(2);
    });

    firstDetail.resolve({
      success: true,
      capability: skillCapability,
      content: '# Demo Skill\n',
      selectedFilePath: 'SKILL.md',
      files: skillFiles(),
    });

    await waitFor(() => {
      expect(readCapabilityMock).toHaveBeenCalledTimes(2);
      expect(view.queryAllByText('demo-skill')).toHaveLength(1);
      expect(view.getByRole('button', { name: 'SKILL.md' })).toBeTruthy();
    });
  });

  it('ignores stale skill file responses when switching child files quickly', async () => {
    queueSkillDetail();

    const helperDetail = createDeferred<{
      success: boolean;
      capability: typeof skillCapability;
      path: string;
      content: string;
      encoding: string;
    }>();
    const guideDetail = createDeferred<{
      success: boolean;
      capability: typeof skillCapability;
      path: string;
      content: string;
      encoding: string;
    }>();

    readCapabilityFileMock.mockImplementation(({ path }: { path: string }) => {
      if (path === 'scripts/helper.py') {
        return helperDetail.promise;
      }
      return guideDetail.promise;
    });

    const view = await openSkillDetails();
    fireEvent.click(view.getByText('helper.py'));
    fireEvent.click(view.getByText('guide.md'));

    guideDetail.resolve({
      success: true,
      capability: skillCapability,
      path: 'docs/guide.md',
      content: '# Guide\n\nLatest\n',
      encoding: 'utf8',
    });

    await waitFor(() => {
      expect(view.getByText('docs/guide.md')).toBeTruthy();
    });
    expect(await view.findByText('Latest')).toBeTruthy();

    helperDetail.resolve({
      success: true,
      capability: skillCapability,
      path: 'scripts/helper.py',
      content: 'print("stale")\n',
      encoding: 'utf8',
    });

    await waitFor(() => {
      expect(view.getByText('docs/guide.md')).toBeTruthy();
    });
    expect(view.getByText('Latest')).toBeTruthy();
  });

  it('provides an entry to open a shadowed editable skill with the same name', async () => {
    const builtinSkillCapability = {
      id: 'builtin-shadow-source',
      type: 'skill',
      name: 'shared-skill',
      enabled: true,
      editable: false,
      path: '/builtin/shared-skill/SKILL.md',
      source: { kind: 'builtin', path: '/builtin/shared-skill/SKILL.md' },
    };
    const userSkillCapability = {
      id: 'user-shadow-target',
      type: 'skill',
      name: 'shared-skill',
      enabled: true,
      editable: true,
      path: '/user/shared-skill/SKILL.md',
      source: { kind: 'user', path: '/user/shared-skill/SKILL.md' },
    };

    listCapabilitiesMock.mockResolvedValueOnce({
      capabilities: [builtinSkillCapability, userSkillCapability],
    });
    readCapabilityMock.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        success: true,
        capability: id === userSkillCapability.id ? userSkillCapability : builtinSkillCapability,
        content: '# Shared Skill\n',
        selectedFilePath: 'SKILL.md',
        files: skillFiles(),
      })
    );

    const view = render(<ManagementWorkspace mode="skills" hideModeSelect={true} />);

    await view.findByText('shared-skill');
    fireEvent.click(
      await view.findByRole('button', {
        name: /open user shared-skill/i,
      })
    );

    await waitFor(() => {
      expect(readCapabilityMock).toHaveBeenCalledWith({
        id: userSkillCapability.id,
        projectPath: undefined,
      });
    });
    expect(await view.findByText('/user/shared-skill/SKILL.md')).toBeTruthy();
  });

  it('restores sourceFilter after switching modes and reloading the pane', async () => {
    listCapabilitiesMock.mockImplementation(
      ({ type }: { type: 'skill' | 'command' }) =>
        Promise.resolve({
          capabilities:
            type === 'skill'
              ? [
                  {
                    id: 'builtin-only-skill',
                    type: 'skill',
                    name: 'builtin-visible',
                    enabled: true,
                    editable: false,
                    source: { kind: 'builtin', path: '/builtin/visible/SKILL.md' },
                  },
                  {
                    id: 'user-only-skill',
                    type: 'skill',
                    name: 'user-hidden-when-builtin-filtered',
                    enabled: true,
                    editable: true,
                    source: { kind: 'user', path: '/user/hidden/SKILL.md' },
                  },
                ]
              : [
                  {
                    id: 'command-1',
                    type: 'command',
                    name: 'demo-command',
                    enabled: true,
                    editable: true,
                    source: { kind: 'user', path: '/user/commands/demo.md' },
                  },
                ],
        })
    );

    const view = render(
      <ManagementWorkspace mode="skills" hideModeSelect={true} projectPath="C:/workspace-a" />
    );

    const sourceFilterSelect = (await view.findAllByLabelText('mock-select')).find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === 'builtin')
    ) as HTMLSelectElement | undefined;

    expect(sourceFilterSelect).toBeTruthy();
    fireEvent.change(sourceFilterSelect as HTMLSelectElement, { target: { value: 'builtin' } });

    await waitFor(() => {
      expect(view.queryByText('user-hidden-when-builtin-filtered')).toBeNull();
    });

    view.rerender(
      <ManagementWorkspace mode="commands" hideModeSelect={true} projectPath="C:/workspace-b" />
    );
    view.rerender(
      <ManagementWorkspace mode="skills" hideModeSelect={true} projectPath="C:/workspace-b" />
    );

    await waitFor(() => {
      expect(view.queryByText('user-hidden-when-builtin-filtered')).toBeNull();
    });
  });
});
