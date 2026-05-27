// @vitest-environment node

import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MockScript = {
  id: string;
  matches: string[];
  runAt: 'document_start' | 'document_end' | 'document_idle';
  allFrames: boolean;
  world: 'MAIN' | 'USER_SCRIPT';
};

type MockScriptDetail = MockScript & {
  savedCode: string;
};

type RegisterPayload = {
  id: string;
  matches: string[];
  js: Array<{ code: string }>;
  excludeMatches?: string[];
  allFrames: boolean;
  runAt: 'document_start' | 'document_end' | 'document_idle';
  world: 'MAIN' | 'USER_SCRIPT';
  worldId?: string;
};

type UpdatePayload = {
  id: string;
  updates: Omit<RegisterPayload, 'id'>;
};

type MutationOptions = {
  onSuccess?: () => void | Promise<void>;
  onError?: (error: Error) => void;
};

const trpcState = vi.hoisted(() => ({
  scripts: [] as MockScript[],
  scriptDetails: {} as Record<string, MockScriptDetail>,
  storage: {} as Record<string, string | { content?: string } | null | undefined>,
  scriptsQueryIsLoading: false,
  scriptsQueryIsError: false,
  scriptsQueryError: null as Error | null,
  refetch: vi.fn(),
  registerMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  registerOptions: null as MutationOptions | null,
  updateOptions: null as MutationOptions | null,
  deleteOptions: null as MutationOptions | null,
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  useNavigate: () => trpcState.navigate,
}));

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    editable,
  }: {
    value?: string;
    editable?: boolean;
  }) => (
    <div data-testid="code-editor" data-editable={String(Boolean(editable))}>
      {value}
    </div>
  ),
}));

vi.mock('@/entrypoints/sidepanel/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('../lib/trpc_client', () => ({
  trpc: {
    userScripts: {
      getAllScripts: {
        useQuery: () => ({
          data: trpcState.scripts,
          isLoading: trpcState.scriptsQueryIsLoading,
          isError: trpcState.scriptsQueryIsError,
          error: trpcState.scriptsQueryError,
          refetch: trpcState.refetch,
        }),
      },
      getScript: {
        useQuery: ({ id }: { id: string }, options?: { enabled?: boolean }) => ({
          data: options?.enabled === false ? null : (trpcState.scriptDetails[id] ?? null),
          isLoading: false,
          isError: false,
          error: null,
          refetch: trpcState.refetch,
        }),
      },
      registerScript: {
        useMutation: (options?: MutationOptions) => {
          trpcState.registerOptions = options ?? null;
          return {
            mutate: trpcState.registerMutate,
            isPending: false,
          };
        },
      },
      updateScript: {
        useMutation: (options?: MutationOptions) => {
          trpcState.updateOptions = options ?? null;
          return {
            mutate: trpcState.updateMutate,
            isPending: false,
          };
        },
      },
      deleteScript: {
        useMutation: (options?: MutationOptions) => {
          trpcState.deleteOptions = options ?? null;
          return {
            mutate: trpcState.deleteMutate,
            isPending: false,
          };
        },
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/entrypoints/sidepanel/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function toMockScript(payload: RegisterPayload): MockScript {
  return {
    id: payload.id,
    matches: payload.matches,
    runAt: payload.runAt,
    allFrames: payload.allFrames,
    world: payload.world,
  };
}

function toMockScriptDetail(payload: RegisterPayload): MockScriptDetail {
  return {
    ...toMockScript(payload),
    savedCode: payload.js[0]?.code ?? '',
  };
}

function setupMutationDefaults() {
  trpcState.registerMutate.mockImplementation((payload: RegisterPayload) => {
    trpcState.scripts = [...trpcState.scripts, toMockScript(payload)];
    trpcState.scriptDetails[payload.id] = toMockScriptDetail(payload);
    void trpcState.registerOptions?.onSuccess?.();
  });

  trpcState.updateMutate.mockImplementation((payload: UpdatePayload) => {
    const nextPayload: RegisterPayload = {
      id: payload.id,
      ...payload.updates,
    };

    trpcState.scripts = trpcState.scripts.map((script) =>
      script.id === payload.id ? toMockScript(nextPayload) : script
    );
    trpcState.scriptDetails[payload.id] = toMockScriptDetail(nextPayload);
    void trpcState.updateOptions?.onSuccess?.();
  });

  trpcState.deleteMutate.mockImplementation(({ id }: { id: string }) => {
    trpcState.scripts = trpcState.scripts.filter((script) => script.id !== id);
    delete trpcState.scriptDetails[id];
    void trpcState.deleteOptions?.onSuccess?.();
  });
}

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
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
  it('用户脚本能力未开启时，会显示中文原因和设置指引', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    trpcState.scriptsQueryIsError = true;
    trpcState.scriptsQueryError = new Error(
      'userScripts API is not available. Please enable "Allow User Scripts" in extension details, or turn on Developer mode in older Chrome versions.'
    );

    const view = render(<UserScriptsWorkspace />);

    await waitFor(() => {
      expect(view.getByText('脚本列表加载失败')).toBeTruthy();
      expect(
        view.getByText('当前浏览器没有向这个扩展开放用户脚本能力，所以暂时无法读取脚本列表。')
      ).toBeTruthy();
      expect(view.getByText('请打开：扩展程序 -> 本扩展的详情页。')).toBeTruthy();
      expect(
        view.getByText('如果你使用较新的 Chrome，请开启“Allow User Scripts”。')
      ).toBeTruthy();
      expect(
        view.getByText('如果你使用较老版本的 Chrome，请开启“开发者模式（Developer mode）”。')
      ).toBeTruthy();
    });
  });
beforeEach(() => {
  trpcState.scripts = [
    {
      id: 'demo-script',
      matches: ['https://example.com/*'],
      runAt: 'document_start',
      allFrames: false,
      world: 'USER_SCRIPT',
    },
    {
      id: 'helper-script',
      matches: ['https://another.example/*'],
      runAt: 'document_idle',
      allFrames: true,
      world: 'MAIN',
    },
  ];
  trpcState.scriptDetails = {
    'demo-script': {
      id: 'demo-script',
      matches: ['https://example.com/*'],
      runAt: 'document_start',
      allFrames: false,
      world: 'USER_SCRIPT',
      savedCode: 'console.log("hello from userscript");',
    },
    'helper-script': {
      id: 'helper-script',
      matches: ['https://another.example/*'],
      runAt: 'document_idle',
      allFrames: true,
      world: 'MAIN',
      savedCode: 'console.log("helper script active");',
    },
  };
  trpcState.storage = {
    'webmcp:userscripts:demo-script': 'console.log("hello from userscript");',
    'webmcp:userscripts:helper-script': 'console.log("helper script active");',
    'webmcp:userscripts:new-script': 'console.log("new script ready");',
  };
  trpcState.scriptsQueryIsLoading = false;
  trpcState.scriptsQueryIsError = false;
  trpcState.scriptsQueryError = null;
  trpcState.refetch.mockReset();
  trpcState.registerMutate.mockReset();
  trpcState.updateMutate.mockReset();
  trpcState.deleteMutate.mockReset();
  trpcState.registerOptions = null;
  trpcState.updateOptions = null;
  trpcState.deleteOptions = null;
  trpcState.navigate.mockReset();
  setupMutationDefaults();

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
      lastError: undefined,
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn().mockResolvedValue([{ url: 'https://example.com/current-page' }]),
    },
    storage: {
      local: {
        get: vi.fn((key: string, callback?: (items: Record<string, unknown>) => void) => {
          const items = { [key]: trpcState.storage[key] };
          callback?.(items);
          return Promise.resolve(items);
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('UserScriptsWorkspace', () => {
  it('同时渲染列表栏和详情栏，并展示搜索输入框', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    expect(view.getByText('脚本列表')).toBeTruthy();
    expect(view.getByText('脚本详情')).toBeTruthy();
    expect(view.getByPlaceholderText('搜索脚本 ID 或匹配规则')).toBeTruthy();
  });

  it('展示默认选中脚本的代码内容', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    await waitFor(() => {
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("hello from userscript");'
      );
    });
  });

  it('点击新建后进入 create 模式并展示空白表单', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));

    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
      expect(view.getByText('创建态')).toBeTruthy();
      expect((view.getByLabelText('脚本 ID') as HTMLInputElement).value).not.toBe('');
      expect((view.getByLabelText('匹配规则 1') as HTMLInputElement).value).toBe(
        '*://example.com/*'
      );
    });
  });

  it('可以从路由参数恢复 create 模式', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace routeMode="create" />);

    await waitFor(() => {
      expect(view.getByText('创建态')).toBeTruthy();
      expect((view.getByLabelText('匹配规则 1') as HTMLInputElement).value).toBe(
        '*://example.com/*'
      );
    });
  });

  it('可以从路由参数恢复 edit 模式和目标脚本', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(
      <UserScriptsWorkspace routeMode="edit" routeScriptId="helper-script" />
    );

    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
      expect(view.getByDisplayValue('helper-script')).toBeTruthy();
    });
  });

  it('查看态可以切换到编辑态', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);

    await waitFor(() => {
      expect(view.getByText('编辑脚本')).toBeTruthy();
      expect(view.getByText('编辑态')).toBeTruthy();
      expect(view.getByDisplayValue('demo-script')).toBeTruthy();
    });
  });

  it('create 保存触发 register mutation，成功后切到稳定查看态', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));

    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
    });

    const scriptIdInput = view.getByLabelText('脚本 ID') as HTMLInputElement;
    const matchInput = view.getByLabelText('匹配规则 1') as HTMLInputElement;
    const generatedScriptId = scriptIdInput.value;
    trpcState.storage[`webmcp:userscripts:${generatedScriptId}`] = 'console.log("new script ready");';

    await waitFor(() => {
      expect(generatedScriptId).not.toBe('');
      expect(matchInput.value).toBe('*://example.com/*');
    });
    fireEvent.click(view.getByRole('button', { name: '保存脚本' }));

    await waitFor(() => {
      expect(trpcState.registerMutate).toHaveBeenCalledWith({
        id: generatedScriptId,
        matches: ['*://example.com/*'],
        js: [{ code: 'console.log("new script ready");' }],
        excludeMatches: undefined,
        allFrames: false,
        runAt: 'document_start',
        world: 'MAIN',
        worldId: undefined,
      });
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getAllByText(generatedScriptId).length).toBeGreaterThan(0);
      expect(view.getByTestId('code-editor').textContent).toContain('console.log("new script ready");');
    });
  });

  it('create 保存成功后即使列表查询未刷新，右栏也保留新脚本查看态', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    trpcState.registerMutate.mockImplementation((_payload: RegisterPayload) => {
      void trpcState.registerOptions?.onSuccess?.();
    });

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));

    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
    });

    const scriptIdInput = view.getByLabelText('脚本 ID') as HTMLInputElement;
    const matchInput = view.getByLabelText('匹配规则 1') as HTMLInputElement;
    const generatedScriptId = scriptIdInput.value;
    trpcState.storage[`webmcp:userscripts:${generatedScriptId}`] =
      'console.log("optimistic new script");';

    fireEvent.change(matchInput, {
      target: { value: '*://example.com/*' },
    });
    await waitFor(() => {
      expect((view.getByLabelText('匹配规则 1') as HTMLInputElement).value).toBe(
        '*://example.com/*'
      );
    });
    fireEvent.click(view.getByRole('button', { name: '保存脚本' }));

    await waitFor(() => {
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.queryByText('请选择用户脚本')).toBeNull();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("optimistic new script");'
      );
    });
  });

  it('edit 保存触发 update mutation，成功后回到查看态', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);

    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });
    fireEvent.click(view.getByRole('button', { name: '保存脚本' }));

    await waitFor(() => {
      expect(trpcState.updateMutate).toHaveBeenCalledWith({
        id: 'demo-script',
        updates: {
          matches: ['https://example.com/*'],
          js: [{ code: 'console.log("hello from userscript");' }],
          excludeMatches: undefined,
          allFrames: false,
          runAt: 'document_end',
          world: 'USER_SCRIPT',
          worldId: undefined,
        },
      });
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getAllByText('end').length).toBeGreaterThan(0);
    });
  });

  it('edit 保存成功后即使详情查询未刷新，再次进入编辑也保留最新表单', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    trpcState.updateMutate.mockImplementation((_payload: UpdatePayload) => {
      void trpcState.updateOptions?.onSuccess?.();
    });

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);

    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });
    fireEvent.click(view.getByRole('button', { name: '保存脚本' }));

    await waitFor(() => {
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getAllByText('end').length).toBeGreaterThan(0);
    });

    fireEvent.click(view.getByRole('button', { name: '编辑' }));

    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
      expect((view.getByLabelText('执行时机') as HTMLSelectElement).value).toBe('document_end');
    });
  });

  it('删除触发 delete mutation，成功后列表和右栏同步刷新', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '删除 demo-script' }));

    await waitFor(() => {
      expect(view.getByText('确认删除当前脚本？')).toBeTruthy();
    });

    fireEvent.click(view.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(trpcState.deleteMutate).toHaveBeenCalledWith({ id: 'demo-script' });
      expect(view.queryByText('确认删除当前脚本？')).toBeNull();
      expect(view.queryByTestId('userscript-list-item-demo-script')).toBeNull();
      expect(view.getByTestId('userscript-list-item-helper-script')).toBeTruthy();
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });

  it('编辑当前脚本后删除会明确提示放弃未保存更改', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);

    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });

    fireEvent.click(view.getByRole('button', { name: '删除 demo-script' }));

    await waitFor(() => {
      expect(view.getByText('确认删除并放弃当前未保存更改？')).toBeTruthy();
      expect(view.getByRole('button', { name: '确认删除并放弃更改' })).toBeTruthy();
    });

    fireEvent.click(view.getByRole('button', { name: '确认删除并放弃更改' }));

    await waitFor(() => {
      expect(trpcState.deleteMutate).toHaveBeenCalledWith({ id: 'demo-script' });
      expect(view.queryByText('确认删除并放弃当前未保存更改？')).toBeNull();
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });

  it('create 态有脏数据时切换脚本会弹出放弃更改确认', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));

    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });

    fireEvent.click(view.getByTestId('userscript-list-item-helper-script'));

    await waitFor(() => {
      expect(view.getByText('放弃未保存更改？')).toBeTruthy();
      expect(view.getByRole('button', { name: '放弃更改' })).toBeTruthy();
      expect(view.getByRole('button', { name: '继续编辑' })).toBeTruthy();
    });
  });

  it('未保存确认里点击继续编辑会保留原表单', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));
    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });

    fireEvent.click(view.getByTestId('userscript-list-item-helper-script'));

    await waitFor(() => {
      expect(view.getByText('放弃未保存更改？')).toBeTruthy();
    });

    fireEvent.click(view.getByRole('button', { name: '继续编辑' }));

    await waitFor(() => {
      expect(view.queryByText('放弃未保存更改？')).toBeNull();
      expect((view.getByLabelText('执行时机') as HTMLSelectElement).value).toBe('document_end');
      expect(view.getByText('创建态')).toBeTruthy();
    });
  });

  it('未保存确认里点击放弃更改后会真正完成目标切换', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getByRole('button', { name: '新建脚本' }));
    await waitFor(() => {
      expect(view.getByLabelText('脚本 ID')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });

    fireEvent.click(view.getByTestId('userscript-list-item-helper-script'));

    await waitFor(() => {
      expect(view.getByText('放弃未保存更改？')).toBeTruthy();
    });

    fireEvent.click(view.getByRole('button', { name: '放弃更改' }));

    await waitFor(() => {
      expect(view.queryByText('放弃未保存更改？')).toBeNull();
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });

  it('搜索导致当前脚本被过滤掉时会先确认，不会静默覆盖脏表单', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);
    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
    });

    fireEvent.change(view.getByLabelText('执行时机'), {
      target: { value: 'document_end' },
    });

    const searchInput = view.getByPlaceholderText(
      '搜索脚本 ID 或匹配规则'
    ) as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'helper' } });

    await waitFor(() => {
      expect(searchInput.value).toBe('helper');
      expect(view.getByText('放弃未保存更改？')).toBeTruthy();
      expect(view.getByText('编辑态')).toBeTruthy();
      expect(view.getByDisplayValue('demo-script')).toBeTruthy();
      expect((view.getByLabelText('执行时机') as HTMLSelectElement).value).toBe('document_end');
      expect(view.queryAllByTestId(/^userscript-list-item-/)).toHaveLength(1);
      expect(view.getByTestId('userscript-list-item-helper-script')).toBeTruthy();
    });
  });

  it('clean edit 在搜索过滤后会直接切到新的可见脚本', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);
    await waitFor(() => {
      expect(view.getByText('编辑态')).toBeTruthy();
      expect(view.getByDisplayValue('demo-script')).toBeTruthy();
    });

    const searchInput = view.getByPlaceholderText(
      '搜索脚本 ID 或匹配规则'
    ) as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: 'helper' } });

    await waitFor(() => {
      expect(searchInput.value).toBe('helper');
      expect(view.queryByText('放弃未保存更改？')).toBeNull();
      expect(view.getByText('编辑态')).toBeTruthy();
      expect(view.getByDisplayValue('helper-script')).toBeTruthy();
      expect((view.getByLabelText('执行时机') as HTMLSelectElement).value).toBe('document_idle');
      expect(view.queryAllByTestId(/^userscript-list-item-/)).toHaveLength(1);
      expect(view.getByTestId('userscript-list-item-helper-script')).toBeTruthy();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });

  it('改回原值后不再视为脏数据', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);

    fireEvent.click(view.getAllByRole('button', { name: '编辑' })[0]);
    await waitFor(() => {
      expect(view.getByDisplayValue('document_start')).toBeTruthy();
    });

    const runAtSelect = view.getByLabelText('执行时机') as HTMLSelectElement;
    fireEvent.change(runAtSelect, { target: { value: 'document_end' } });
    fireEvent.change(runAtSelect, { target: { value: 'document_start' } });

    fireEvent.click(view.getByTestId('userscript-list-item-helper-script'));

    await waitFor(() => {
      expect(view.queryByText('放弃未保存更改？')).toBeNull();
      expect(view.getByText('查看态')).toBeTruthy();
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });

  it('搜索后会过滤列表、自动选中新脚本并刷新右侧详情', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);
    const searchInput = view.getByPlaceholderText(
      '搜索脚本 ID 或匹配规则'
    ) as HTMLInputElement;

    fireEvent.input(searchInput, {
      target: { value: 'helper' },
    });

    await waitFor(() => {
      expect(searchInput.value).toBe('helper');
      expect(view.getByTestId('userscript-list-item-helper-script')).toBeTruthy();
      expect(view.queryAllByTestId(/^userscript-list-item-/)).toHaveLength(1);
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
      expect(view.getByText('执行世界')).toBeTruthy();
    });
  });

  it('列表项内按钮触发 Enter 时不会误选中父级脚本', async () => {
    const { UserScriptsWorkspace } = await import('./userscripts.workspace');

    const view = render(<UserScriptsWorkspace />);
    fireEvent.click(view.getByTestId('userscript-list-item-helper-script'));

    await waitFor(() => {
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });

    const demoListItem = view.getByTestId('userscript-list-item-demo-script');
    const editButton = within(demoListItem).getByRole('button', {
      name: '编辑 demo-script',
    });

    fireEvent.keyDown(editButton, { key: 'Enter' });

    await waitFor(() => {
      expect(view.getByTestId('code-editor').textContent).toContain(
        'console.log("helper script active");'
      );
    });
  });
});
