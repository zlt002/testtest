import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionAttachment } from '../../lib/agent-v2/types';
import { formatPickedElementContext } from '../../lib/page-picker';
import { AgentComposer } from './AgentComposer';

const mutateAsync = vi.fn();
const pageCaptureMutateAsync = vi.fn();
let pagePickerIsPending = false;
const triggerWorkspacePageCapture = vi.fn();
const listCommandsMock = vi.fn();

vi.mock('../../lib/agent-v2/client', () => ({
  createAgentV2Client: () => ({
    listCommands: listCommandsMock,
    listFiles: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../../lib/trpc_client', () => ({
  trpc: {
    pagePicker: {
      pickElement: {
        useMutation: () => ({
          mutateAsync,
          isPending: pagePickerIsPending,
        }),
      },
    },
    pageCapture: {
      capture: {
        useMutation: () => ({
          mutateAsync: pageCaptureMutateAsync,
        }),
      },
    },
  },
}));

vi.mock('../../lib/page-capture', () => ({
  triggerWorkspacePageCapture,
}));

const defaultProps = {
  baseUrl: 'http://localhost:3000',
  endpoint: '/api/agent-v2',
  projectPath: '/tmp/project',
  status: 'idle' as const,
  contextPercent: 0,
  permissionMode: 'default' as const,
  thinkingMode: 'medium' as const,
  onPermissionModeChange: vi.fn(),
  onThinkingModeChange: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  onLocalCommand: vi.fn(),
  attachments: [],
  onAttachmentsChange: vi.fn(),
};

function resolveAttachmentAction(
  action: SessionAttachment[] | ((current: SessionAttachment[]) => SessionAttachment[]),
  current: SessionAttachment[]
) {
  return typeof action === 'function' ? action(current) : action;
}

function renderComposer(initialValue = '', initialAttachments: SessionAttachment[] = []) {
  let value = initialValue;
  let attachments = initialAttachments;
  const onAttachmentsChange = vi.fn(
    (
      nextAttachments: SessionAttachment[] | ((current: SessionAttachment[]) => SessionAttachment[])
    ) => {
      attachments = resolveAttachmentAction(nextAttachments, attachments);
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value={value}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          onChange={onChange}
        />
      );
    }
  );
  const onChange = vi.fn((nextValue: string) => {
    value = nextValue;
    result.rerender(
      <AgentComposer
        {...defaultProps}
        value={value}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
        onChange={onChange}
      />
    );
  });
  const result = render(
    <AgentComposer
      {...defaultProps}
      value={value}
      attachments={attachments}
      onAttachmentsChange={onAttachmentsChange}
      onChange={onChange}
    />
  );
  return { ...result, onAttachmentsChange, onChange };
}

function createAttachment(
  overrides: Partial<SessionAttachment> & Pick<SessionAttachment, 'id' | 'name'>
) {
  return {
    sessionFileId: overrides.id,
    mimeType: 'text/plain',
    size: 12,
    kind: 'text' as const,
    storage: 'session-temp',
    ...overrides,
  } satisfies SessionAttachment;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderUploadComposer(
  onUploadAttachment: (files: File[]) => Promise<SessionAttachment[]>,
  initialAttachments: SessionAttachment[] = []
) {
  let attachments = initialAttachments;
  const onAttachmentsChange = vi.fn(
    (
      nextAttachments: SessionAttachment[] | ((current: SessionAttachment[]) => SessionAttachment[])
    ) => {
      attachments = resolveAttachmentAction(nextAttachments, attachments);
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value=""
          onChange={vi.fn()}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          onUploadAttachment={onUploadAttachment}
        />
      );
    }
  );
  const result = render(
    <AgentComposer
      {...defaultProps}
      value=""
      onChange={vi.fn()}
      attachments={attachments}
      onAttachmentsChange={onAttachmentsChange}
      onUploadAttachment={onUploadAttachment}
    />
  );

  return { ...result, onAttachmentsChange };
}

describe('AgentComposer', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    pageCaptureMutateAsync.mockReset();
    triggerWorkspacePageCapture.mockReset();
    listCommandsMock.mockReset();
    listCommandsMock.mockResolvedValue({
      skills: [
        {
          name: '/fast-nexus-cypher',
          description: 'Use when you need to query the graph',
          namespace: 'skill',
          metadata: { type: 'skill' },
        },
      ],
      project: [],
      user: [],
      plugin: [],
      localUi: [],
    });
  });

  it('starts page capture from composer toolbar and shows saved path', async () => {
    const user = userEvent.setup();
    triggerWorkspacePageCapture.mockResolvedValueOnce({
      entryPath: 'captures/2026-05-12-example',
    });

    renderComposer();
    await user.click(screen.getByRole('button', { name: '閲囬泦鏁撮〉' }));

    expect(screen.getByText('姝ｅ湪閲囬泦鏁撮〉骞跺啓鍏ュ綋鍓嶅伐浣滃尯...')).toBeTruthy();
    expect(await screen.findByText('缃戦〉宸蹭繚瀛樺埌')).toBeTruthy();
    expect(screen.getByText('captures/2026-05-12-example')).toBeTruthy();
    expect(triggerWorkspacePageCapture).toHaveBeenCalledWith({
      mode: 'page',
      projectPath: '/tmp/project',
    });
  });

  it('capture 鎴愬姛鎻愮ず涓殑璺緞淇濇寔鍗曡鎴柇灞曠ず', async () => {
    const user = userEvent.setup();
    triggerWorkspacePageCapture.mockResolvedValueOnce({
      entryPath: 'captures/2026-05-12-example',
    });

    renderComposer();
    await user.click(screen.getByRole('button', { name: '閲囬泦鏁撮〉' }));

    const pathText = await screen.findByText('captures/2026-05-12-example');
    expect(pathText.className).toContain('truncate');
    expect(pathText.className).toContain('whitespace-nowrap');
    expect(pathText.className).toContain('min-w-0');
  });

  it('renders the DOM analysis toolbar above the composer input', async () => {
    renderComposer();

    expect(await screen.findByRole('button', { name: '寮€濮?DOM 鍒嗘瀽' })).toBeTruthy();
  });

  it('does not render a top divider on the composer dock surface', () => {
    const { container } = renderComposer();

    expect(container.firstElementChild?.className).not.toContain('border-t');
  });

  it('shows a clear message when capture starts without a workspace', async () => {
    const user = userEvent.setup();
    triggerWorkspacePageCapture.mockRejectedValueOnce(new Error('请先选择当前工作区后再采集网页'));
    mutateAsync.mockResolvedValueOnce({
      url: 'https://example.com',
      selector: '#hero',
      xpath: '//*[@id="hero"]',
      tagName: 'section',
      id: 'hero',
      classList: ['hero'],
      dataAttributes: { role: 'banner' },
      text: 'Hero',
      rect: { x: 10, y: 20, width: 300, height: 40 },
      outerHTMLSnippet: '<section id="hero">Hero</section>',
      ancestors: [],
      siblings: { previous: null, next: null },
    });

    render(<AgentComposer {...defaultProps} projectPath={undefined} value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));
    await user.click(await screen.findByRole('button', { name: '閲囬泦鍒板伐浣滃尯' }));

    expect(await screen.findByText('请先选择当前工作区后再采集网页')).toBeTruthy();
  });

  it('shows an action area instead of inserting picked content immediately', async () => {
    const pickedElement = {
      url: 'https://example.com',
      selector: '#hero',
      xpath: '//*[@id="hero"]',
      tagName: 'section',
      id: 'hero',
      classList: ['hero'],
      dataAttributes: { role: 'banner' },
      text: 'Hero',
      rect: { x: 10, y: 20, width: 300, height: 40 },
      outerHTMLSnippet: '<section id="hero">Hero</section>',
      ancestors: [],
      siblings: { previous: null, next: null },
    };
    mutateAsync.mockResolvedValueOnce(pickedElement);

    renderComposer('璇峰府鎴戞敼杩欎釜鍖哄煙');
    fireEvent.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));

    expect(await screen.findByText('宸查€夋嫨鍏冪礌')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送到输入框' })).toBeTruthy();
    expect(screen.getByRole('textbox')).toHaveValue('璇峰府鎴戞敼杩欎釜鍖哄煙');
  });

  it('shows an error when page picking fails', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('当前页面不支持拾取'));

    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));

    expect(await screen.findByText('当前页面不支持拾取')).toBeTruthy();
  });

  it('does not show the read current selection toolbar button', () => {
    renderComposer('请继续分析');

    expect(screen.queryByRole('button', { name: '璇诲彇褰撳墠閫夊尯' })).toBeNull();
    expect(screen.queryByRole('button', { name: '璇诲彇閫夊尯' })).toBeNull();
  });

  it('disables the picker button while a pick request is pending', () => {
    pagePickerIsPending = true;

    renderComposer();

    expect(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' })).toBeDisabled();
    pagePickerIsPending = false;
  });

  it('shows takeover notice in the top notice slot and hides bypass-permission notice', () => {
    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        permissionMode="bypassPermissions"
        takeoverState={{ status: 'active', scope: 'window', windowId: 1 }}
      />
    );

    expect(
      screen.getByText('当前会话正在托管这个浏览器窗口，手动离开目标页会中断本次运行。')
    ).toBeTruthy();
    expect(screen.queryByText('允许所有操作会跳过工具确认，仅建议在可信项目中使用。')).toBeNull();
  });

  it('renders bypass-permissions mode as a high-risk warning button', () => {
    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        permissionMode="bypassPermissions"
      />
    );

    const button = screen
      .getAllByRole('button')
      .find((candidate) => candidate.className.includes('bg-amber-100'));
    expect(button).toBeTruthy();
    expect(button?.className).toContain('bg-amber-100');
    expect(button?.className).toContain('border-amber-500');

    const icon = button?.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.className.baseVal ?? icon?.getAttribute('class')).toContain('text-amber-700');
  });

  it('uses subdued thinking colors by default and only highlights max strongly', () => {
    const { rerender } = render(
      <AgentComposer {...defaultProps} value="" onChange={vi.fn()} thinkingMode="low" />
    );

    const lowButton = screen.getByRole('button', { name: /Low/ });
    const lowIcon = lowButton.querySelector('svg');
    expect(lowIcon).not.toBeNull();
    expect(lowIcon?.className.baseVal ?? lowIcon?.getAttribute('class')).toContain('text-slate-400');

    rerender(
      <AgentComposer {...defaultProps} value="" onChange={vi.fn()} thinkingMode="max" />
    );

    const maxButton = screen.getByRole('button', { name: /Max/ });
    const maxIcon = maxButton.querySelector('svg');
    expect(maxIcon).not.toBeNull();
    expect(maxIcon?.className.baseVal ?? maxIcon?.getAttribute('class')).toContain('text-amber-600');
  });

  it('appends the picked block only after explicitly clicking send to input', async () => {
    let resolvePick: ((value: unknown) => void) | undefined;
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePick = resolve;
        })
    );

    renderComposer('鍒濆鍐呭');
    fireEvent.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '初始内容，后来又补了一句' },
    });

    const pickedElement = {
      url: 'https://example.com',
      selector: '#target',
      xpath: '//*[@id="target"]',
      tagName: 'div',
      id: 'target',
      classList: ['picked'],
      dataAttributes: {},
      text: 'Target',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      outerHTMLSnippet: '<div id="target">Target</div>',
      ancestors: [],
      siblings: { previous: null, next: null },
    };

    resolvePick?.(pickedElement);

    await screen.findByRole('button', { name: '发送到输入框' });
    fireEvent.click(screen.getByRole('button', { name: '发送到输入框' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue(
        `鍒濆鍐呭锛屽悗鏉ュ張琛ヤ簡涓€鍙n\n${formatPickedElementContext(pickedElement)}`
      );
    });
  });

  it('sends picked element to workspace capture explicitly', async () => {
    const user = userEvent.setup();
    const pickedElement = {
      url: 'https://example.com',
      selector: '#target',
      xpath: '//*[@id="target"]',
      tagName: 'div',
      id: 'target',
      classList: ['picked'],
      dataAttributes: {},
      text: 'Target',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      outerHTMLSnippet: '<div id="target">Target</div>',
      ancestors: [],
      siblings: { previous: null, next: null },
    };
    mutateAsync.mockResolvedValueOnce(pickedElement);
    triggerWorkspacePageCapture.mockResolvedValueOnce({
      entryPath: 'captures/2026-05-12-target',
    });

    renderComposer();
    await user.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));
    await user.click(await screen.findByRole('button', { name: '閲囬泦鍒板伐浣滃尯' }));

    expect(triggerWorkspacePageCapture).toHaveBeenCalledWith(
      {
        mode: 'element',
        projectPath: '/tmp/project',
        target: pickedElement,
      },
      expect.any(Function)
    );
    expect(await screen.findByText('缃戦〉宸蹭繚瀛樺埌')).toBeTruthy();
    expect(screen.getByText('captures/2026-05-12-target')).toBeTruthy();
  });

  it('cancels the pending picked element actions', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValueOnce({
      url: 'https://example.com',
      selector: '#hero',
      xpath: '//*[@id="hero"]',
      tagName: 'section',
      id: 'hero',
      classList: ['hero'],
      dataAttributes: { role: 'banner' },
      text: 'Hero',
      rect: { x: 10, y: 20, width: 300, height: 40 },
      outerHTMLSnippet: '<section id="hero">Hero</section>',
      ancestors: [],
      siblings: { previous: null, next: null },
    });

    renderComposer();
    await user.click(screen.getByRole('button', { name: '閫夋嫨鍏冪礌' }));
    await user.click(await screen.findByRole('button', { name: '鍙栨秷' }));

    await waitFor(() => {
      expect(screen.queryByText('宸查€夋嫨鍏冪礌')).toBeNull();
    });
  });

  it('hides command menu when clicking outside the composer', async () => {
    renderComposer();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } });
    expect(await screen.findByText('Slash 鍛戒护')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('Slash 鍛戒护')).toBeNull();
    });
  });

  it('hides command menu opened from command button when clicking outside', async () => {
    renderComposer();

    fireEvent.click(screen.getByTitle('鏄剧ず鍛戒护'));
    expect(await screen.findByText('Slash 鍛戒护')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('Slash 鍛戒护')).toBeNull();
    });
  });

  it('does not send while an IME composition is active', () => {
    const onSend = vi.fn();
    render(<AgentComposer {...defaultProps} value="ai" onChange={vi.fn()} onSend={onSend} />);

    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      code: 'Enter',
      nativeEvent: { isComposing: true },
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('fills the latest sent input back into the textarea with ArrowUp', () => {
    let value = '';
    const onSend = vi.fn();
    const onAttachmentsChange = vi.fn();
    const onChange = vi.fn((nextValue: string) => {
      value = nextValue;
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value={value}
          attachments={[]}
          onAttachmentsChange={onAttachmentsChange}
          onChange={onChange}
          onSend={handleSend}
        />
      );
    });
    const handleSend = () => {
      onSend(value);
      value = '';
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value={value}
          attachments={[]}
          onAttachmentsChange={onAttachmentsChange}
          onChange={onChange}
          onSend={handleSend}
        />
      );
    };
    const result = render(
      <AgentComposer
        {...defaultProps}
        value={value}
        attachments={[]}
        onAttachmentsChange={onAttachmentsChange}
        onChange={onChange}
        onSend={handleSend}
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '第一条历史输入' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('第一条历史输入');
    expect((textarea as HTMLTextAreaElement).value).toBe('');

    fireEvent.keyDown(textarea, { key: 'ArrowUp', code: 'ArrowUp' });

    expect((textarea as HTMLTextAreaElement).value).toBe('第一条历史输入');
  });

  it('restores the current draft after navigating back down from history', () => {
    let value = '';
    const onAttachmentsChange = vi.fn();
    const onChange = vi.fn((nextValue: string) => {
      value = nextValue;
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value={value}
          attachments={[]}
          onAttachmentsChange={onAttachmentsChange}
          onChange={onChange}
          onSend={handleSend}
        />
      );
    });
    const handleSend = () => {
      value = '';
      result.rerender(
        <AgentComposer
          {...defaultProps}
          value={value}
          attachments={[]}
          onAttachmentsChange={onAttachmentsChange}
          onChange={onChange}
          onSend={handleSend}
        />
      );
    };
    const result = render(
      <AgentComposer
        {...defaultProps}
        value={value}
        attachments={[]}
        onAttachmentsChange={onAttachmentsChange}
        onChange={onChange}
        onSend={handleSend}
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '第一条历史输入' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    fireEvent.change(textarea, { target: { value: '当前草稿' } });

    fireEvent.keyDown(textarea, { key: 'ArrowUp', code: 'ArrowUp' });
    expect((textarea as HTMLTextAreaElement).value).toBe('第一条历史输入');

    fireEvent.keyDown(textarea, { key: 'ArrowDown', code: 'ArrowDown' });
    expect((textarea as HTMLTextAreaElement).value).toBe('当前草稿');
  });

  it('renders mixed attachments and enables send without text', () => {
    const attachments: SessionAttachment[] = [
      {
        id: 'image-1',
        sessionFileId: 'image-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 128,
        kind: 'image',
        storage: 'inline',
        data: 'ZmFrZS1pbWFnZQ==',
      },
      {
        id: 'doc-1',
        sessionFileId: 'doc-1',
        name: 'spec.md',
        mimeType: 'text/markdown',
        size: 42,
        kind: 'text',
        storage: 'session-temp',
      },
    ];

    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        attachments={attachments}
        onAttachmentsChange={vi.fn()}
      />
    );

    expect(screen.getByAltText('diagram.png')).toBeTruthy();
    expect(screen.getByText('spec.md')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
  });

  it('removes a document attachment from the unified attachment strip', async () => {
    const user = userEvent.setup();
    const attachments: SessionAttachment[] = [
      {
        id: 'image-1',
        sessionFileId: 'image-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 128,
        kind: 'image',
        storage: 'inline',
        data: 'ZmFrZS1pbWFnZQ==',
      },
      {
        id: 'doc-1',
        sessionFileId: 'doc-1',
        name: 'spec.md',
        mimeType: 'text/markdown',
        size: 42,
        kind: 'text',
        storage: 'session-temp',
      },
    ];

    renderComposer('', attachments);
    await user.click(screen.getByRole('button', { name: '绉婚櫎闄勪欢锛歴pec.md' }));

    await waitFor(() => {
      expect(screen.queryByText('spec.md')).toBeNull();
    });
    expect(screen.getByAltText('diagram.png')).toBeTruthy();
  });

  it('uploads local files through onUploadAttachment and shows returned attachments', async () => {
    const user = userEvent.setup();
    const uploadedAttachments: SessionAttachment[] = [
      createAttachment({ id: 'doc-2', name: 'notes.txt' }),
    ];
    const onUploadAttachment = vi.fn().mockResolvedValue(uploadedAttachments);
    const result = renderUploadComposer(onUploadAttachment);

    const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' });

    await user.upload(input, file);

    await waitFor(() => {
      expect(onUploadAttachment).toHaveBeenCalledWith([file]);
    });
    expect(result.onAttachmentsChange).toHaveBeenCalled();
    expect(await screen.findByText('notes.txt')).toBeTruthy();
  });

  it('uploads dropped files through onUploadAttachment and shows returned attachments', async () => {
    const uploadedAttachments: SessionAttachment[] = [
      createAttachment({ id: 'doc-drop-1', name: 'dropped.docx' }),
    ];
    const onUploadAttachment = vi.fn().mockResolvedValue(uploadedAttachments);
    const result = renderUploadComposer(onUploadAttachment);
    const textarea = result.container.querySelector('textarea') as HTMLTextAreaElement;
    const file = new File(['hello world'], 'dropped.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fireEvent.dragOver(textarea, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
      },
    });
    fireEvent.drop(textarea, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
      },
    });

    await waitFor(() => {
      expect(onUploadAttachment).toHaveBeenCalledWith([file]);
    });
    expect(result.onAttachmentsChange).toHaveBeenCalled();
    expect(await screen.findByText('dropped.docx')).toBeTruthy();
  });

  it('merges attachments from overlapping uploads without dropping earlier results', async () => {
    const user = userEvent.setup();
    const firstUpload = createDeferred<SessionAttachment[]>();
    const secondUpload = createDeferred<SessionAttachment[]>();
    const onUploadAttachment = vi
      .fn()
      .mockImplementationOnce(() => firstUpload.promise)
      .mockImplementationOnce(() => secondUpload.promise);
    const result = renderUploadComposer(onUploadAttachment);

    const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;
    const firstFile = new File(['first'], 'first.txt', { type: 'text/plain' });
    const secondFile = new File(['second'], 'second.txt', { type: 'text/plain' });

    await user.upload(input, firstFile);
    await user.upload(input, secondFile);

    secondUpload.resolve([createAttachment({ id: 'doc-2', name: 'second.txt' })]);
    expect(await screen.findByText('second.txt')).toBeTruthy();

    firstUpload.resolve([createAttachment({ id: 'doc-1', name: 'first.txt' })]);

    expect(await screen.findByText('first.txt')).toBeTruthy();
    expect(screen.getByText('second.txt')).toBeTruthy();
  });

  it('shows limit feedback and preserves existing attachments when new uploads exceed the cap', async () => {
    const user = userEvent.setup();
    const initialAttachments = Array.from({ length: 7 }, (_, index) =>
      createAttachment({ id: `old-${index + 1}`, name: `old-${index + 1}.txt` })
    );
    const onUploadAttachment = vi
      .fn()
      .mockResolvedValue([
        createAttachment({ id: 'new-1', name: 'new-1.txt' }),
        createAttachment({ id: 'new-2', name: 'new-2.txt' }),
      ]);

    const result = renderUploadComposer(onUploadAttachment, initialAttachments);
    const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, [
      new File(['1'], 'new-1.txt', { type: 'text/plain' }),
      new File(['2'], 'new-2.txt', { type: 'text/plain' }),
    ]);

    expect(await screen.findByText(/最多保留 8 个附件/)).toBeTruthy();
    expect(screen.getByText('old-1.txt')).toBeTruthy();
    expect(screen.getByText('new-1.txt')).toBeTruthy();
    expect(screen.queryByText('new-2.txt')).toBeNull();
  });

  it('renders image previews from previewUrl when inline data is absent', () => {
    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        attachments={[
          {
            id: 'image-preview',
            sessionFileId: 'image-preview',
            name: 'preview.png',
            mimeType: 'image/png',
            size: 128,
            kind: 'image',
            storage: 'session-temp',
            previewUrl: 'https://example.com/preview.png',
          },
        ]}
        onAttachmentsChange={vi.fn()}
      />
    );

    const image = screen.getByAltText('preview.png') as HTMLImageElement;
    expect(image.src).toContain('https://example.com/preview.png');
  });

  it('uses the local file input ref when opening the attachment picker', async () => {
    const user = userEvent.setup();
    const clickSpies = [vi.fn(), vi.fn()];

    const first = render(
      <AgentComposer {...defaultProps} value="" onChange={vi.fn()} attachments={[]} />
    );
    const second = render(
      <AgentComposer {...defaultProps} value="" onChange={vi.fn()} attachments={[]} />
    );
    const inputs = [
      first.container.querySelector('input[type="file"]') as HTMLInputElement,
      second.container.querySelector('input[type="file"]') as HTMLInputElement,
    ];
    inputs[0].click = clickSpies[0];
    inputs[1].click = clickSpies[1];

    const buttons = screen.getAllByRole('button', { name: '娣诲姞闄勪欢' });
    await user.click(buttons[1]);

    expect(clickSpies[0]).not.toHaveBeenCalled();
    expect(clickSpies[1]).toHaveBeenCalledTimes(1);
  });

  it('keeps slash commands matched when the context continues on the next lines', async () => {
    renderComposer('/\nquery\nthe graph');

    expect(await screen.findByText('/fast-nexus-cypher')).toBeTruthy();
  });

  it('replaces only the standalone slash line when selecting a command', async () => {
    const user = userEvent.setup();

    renderComposer('/\nquery\nthe graph');
    await user.click(screen.getByRole('button', { name: '鏄剧ず鍛戒护' }));
    await user.click(await screen.findByText('/fast-nexus-cypher'));

    expect(screen.getByRole('textbox')).toHaveValue('/fast-nexus-cypher \nquery\nthe graph');
  });

  it('shows plugin commands loaded from the command catalog in the slash menu', async () => {
    const user = userEvent.setup();
    listCommandsMock.mockResolvedValueOnce({
      skills: [],
      project: [],
      user: [],
      plugin: [
        {
          name: '/demo-plugin:release/publish',
          description: 'Publish the current release',
          namespace: 'plugin',
          metadata: { type: 'custom', group: 'plugin' },
        },
      ],
      localUi: [],
    });

    renderComposer('/');
    await user.click(screen.getByRole('button', { name: '鏄剧ず鍛戒护' }));

    expect(await screen.findByText('/demo-plugin:release/publish')).toBeTruthy();
    expect(screen.getByText('Plugin')).toBeTruthy();
  });

  it('shows the command button badge as the total available slash command count', async () => {
    listCommandsMock.mockResolvedValueOnce({
      skills: [
        {
          name: '/fast-nexus-cypher',
          description: 'Use when you need to query the graph',
          namespace: 'skill',
          metadata: { type: 'skill' },
        },
      ],
      project: [
        {
          name: '/project-review',
          description: 'Review current project',
          namespace: 'project',
          metadata: { type: 'custom', group: 'project' },
        },
      ],
      user: [],
      plugin: [
        {
          name: '/demo-plugin:release/publish',
          description: 'Publish the current release',
          namespace: 'plugin',
          metadata: { type: 'custom', group: 'plugin' },
        },
      ],
      localUi: [
        {
          name: '/clear',
          description: 'Clear the current chat',
          namespace: 'local-ui',
          metadata: { type: 'local-ui', group: 'local-ui' },
        },
      ],
    });

    renderComposer('');

    const button = await screen.findByTitle('显示命令');
    expect(within(button).getByText('4')).toBeTruthy();
  });

  it('hides bypass notice and disables composer tools before a workspace is selected', () => {
    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        permissionMode="bypassPermissions"
        projectPath={undefined}
        isWorkspaceSelectionRequired={true}
      />
    );

    expect(screen.queryByText('允许所有操作会跳过工具确认，仅建议在可信项目中使用。')).toBeNull();
    expect(
      screen.getByPlaceholderText('请先选择工作区，然后就可以开始提问、附加文件和调用工具。')
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '閫夋嫨鏂囦欢' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '娣诲姞闄勪欢' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '鏄剧ず鍛戒护' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '鎬濊€冪瓑绾э細Medium' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '权限等级：默认' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });
  it('renders the session tab trigger in the bottom toolbar and forwards toggles', async () => {
    const user = userEvent.setup();
    const onToggleSelectedTab = vi.fn();

    render(
      <AgentComposer
        {...defaultProps}
        value=""
        onChange={vi.fn()}
        sessionTabs={[
          { tabId: 11, title: 'Baidu', url: 'https://www.baidu.com', active: true },
          { tabId: 12, title: 'GitHub', url: 'https://github.com', active: false },
        ]}
        selectedTabIds={[11]}
        onToggleSelectedTab={onToggleSelectedTab}
      />
    );

    expect(screen.getByTestId('session-tab-strip-trigger')).toBeTruthy();
    expect(screen.getByLabelText('已选标签页 Baidu，共 1 个')).toBeTruthy();

    await user.hover(screen.getByTestId('session-tab-strip-trigger'));
    await user.click(await screen.findByText('GitHub'));

    expect(onToggleSelectedTab).toHaveBeenCalledWith(12);
  });
});
