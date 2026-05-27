import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  FileCode2,
  GitBranch,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { UnifiedEmptyState } from '@/entrypoints/sidepanel/components/UnifiedEmptyState';
import { Badge } from '@/entrypoints/sidepanel/components/ui/badge';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/entrypoints/sidepanel/components/ui/dialog';
import { Input } from '@/entrypoints/sidepanel/components/ui/input';
import { Label } from '@/entrypoints/sidepanel/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/entrypoints/sidepanel/components/ui/select';
import { Switch } from '@/entrypoints/sidepanel/components/ui/switch';
import { Textarea } from '@/entrypoints/sidepanel/components/ui/textarea';
import { createAgentV2Client } from '@/entrypoints/sidepanel/lib/agent-v2/client';
import {
  publishCapabilityCatalogChanged,
  subscribeCapabilityCatalogChanged,
} from '@/entrypoints/sidepanel/lib/capability-catalog-events';
import type {
  CapabilityFileNode,
  HookSourceOverview,
  InstallPluginInput,
  ManagedPlugin,
  ManagementCapability,
  ManagementCapabilityType,
} from '@/entrypoints/sidepanel/lib/agent-v2/types';
import { config } from '@/entrypoints/sidepanel/lib/config';

export type ManagementMode = 'plugins' | 'skills' | 'commands' | 'hooks';

type ManagementWorkspaceProps = {
  projectPath?: string;
  mode?: ManagementMode;
  onModeChange?: (mode: ManagementMode) => void;
  hideModeSelect?: boolean;
};

type ManagementPaneUiState = {
  selectedId: string | null;
  searchQuery: string;
  sourceFilter?: 'all' | 'plugin' | 'builtin' | 'user';
};

type CapabilityContextMenuState = {
  item: ManagementCapability;
  x: number;
  y: number;
};

type ImportedSkillBundleFile = {
  path: string;
  contentBase64: string;
};

type DroppedSkillDirectory = {
  sourceDir?: string;
  label: string;
  kind: 'file' | 'directory';
  files?: ImportedSkillBundleFile[];
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void
  ) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: 'default' | 'destructive';
  confirmDisabled?: boolean;
  secondaryLabel?: string;
  secondaryVariant?: 'default' | 'outline' | 'destructive';
  onSecondary?: () => Promise<void> | void;
  onConfirm: () => Promise<void> | void;
};

const modeLabels: Record<ManagementMode, string> = {
  plugins: '插件管理',
  skills: '技能管理',
  commands: '命令管理',
  hooks: '钩子管理',
};

function defaultManagementPaneUiState(): ManagementPaneUiState {
  return {
    selectedId: null,
    searchQuery: '',
    sourceFilter: 'all',
  };
}

function sourceLabel(source?: { kind?: string }) {
  if (source?.kind === 'project') return 'project';
  if (source?.kind === 'plugin') return 'plugin';
  if (source?.kind === 'builtin') return 'builtin';
  if (source?.kind === 'cli') return 'Claude CLI';
  if (source?.kind === 'github') return 'GitHub';
  if (source?.kind === 'lite' || source?.kind === 'dev-local') return '\u5f00\u53d1\u5b89\u88c5';
  if (source?.kind === 'local') return 'local';
  return 'user';
}

function capabilitySourceOrder(sourceKind?: string) {
  if (sourceKind === 'plugin') return 0;
  if (sourceKind === 'project') return 1;
  if (sourceKind === 'user') return 2;
  return 3;
}

function capabilityDisplayPriority(sourceKind?: string) {
  if (sourceKind === 'builtin') return 0;
  if (sourceKind === 'plugin') return 1;
  if (sourceKind === 'project') return 2;
  if (sourceKind === 'user') return 3;
  return 4;
}

type DisplayCapability = ManagementCapability & {
  shadowedSources?: string[];
  shadowedItems?: ManagementCapability[];
};

function matchesCapabilitySourceFilter(
  item: ManagementCapability,
  filter: 'all' | 'plugin' | 'builtin' | 'user'
) {
  if (filter === 'all') {
    return true;
  }
  const sourceKind = item.source?.kind;
  if (filter === 'builtin') {
    return sourceKind === 'builtin';
  }
  if (filter === 'plugin') {
    return sourceKind === 'plugin';
  }
  return sourceKind === 'user' || sourceKind === 'project';
}

function Message({ error, message }: { error?: string | null; message?: string | null }) {
  if (!error && !message) return null;
  return (
    <div
      className={
        error
          ? 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
          : 'rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700'
      }
    >
      {error || message}
    </div>
  );
}

function fileExtension(path: string) {
  const trimmed = path.trim().toLowerCase();
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const filename = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex + 1) : '';
}

function matchesDisplayCapabilitySourceFilter(
  item: DisplayCapability,
  filter: 'all' | 'plugin' | 'builtin' | 'user'
) {
  if (matchesCapabilitySourceFilter(item, filter)) {
    return true;
  }
  return (item.shadowedItems || []).some((shadowedItem) =>
    matchesCapabilitySourceFilter(shadowedItem, filter)
  );
}

function isMarkdownFilePath(path: string) {
  const ext = fileExtension(path);
  return ext === 'md' || ext === 'markdown';
}

function isNonTextFileError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return (
    message.includes('not text') ||
    message.includes('text-editable') ||
    message.includes('binary') ||
    message.includes('not editable as text') ||
    message.includes('不可文本') ||
    message.includes('二进制')
  );
}

function isStaleCapabilityError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return (
    message.includes('no longer exists') ||
    message.includes('capabilitymissing') ||
    message.includes('404')
  );
}

function formatSkillHealthMessage(input: {
  healthy: boolean;
  checkedPath: string;
  issues: string[];
  recommendedAction: 'none' | 'remote_resync';
}) {
  if (input.healthy) {
    return `${input.checkedPath} 自检正常。`;
  }
  const issues = input.issues.length > 0 ? input.issues.join('；') : '存在异常';
  const action =
    input.recommendedAction === 'remote_resync' ? '建议重新执行远端同步。' : '请检查本地目录配置。';
  return `${input.checkedPath} 自检异常：${issues}。${action}`;
}

function isAbsoluteFilesystemPath(path: string) {
  return /^(\/|[A-Za-z]:[\\/])/.test(path);
}

function toParentDirectoryPath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) {
    return normalized;
  }
  if (lastSlash === 2 && /^[A-Za-z]:$/.test(normalized.slice(0, 2))) {
    return `${normalized.slice(0, 2)}/`;
  }
  return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash);
}

function toTopLevelDirectoryPath(filePath: string, relativePath: string) {
  const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segments = normalizedRelative.split('/').filter(Boolean);
  if (segments.length < 2) {
    return toParentDirectoryPath(filePath);
  }

  let currentPath = toParentDirectoryPath(filePath);
  for (let index = 0; index < segments.length - 2; index += 1) {
    currentPath = toParentDirectoryPath(currentPath);
  }
  return currentPath;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const marker = ';base64,';
      const markerIndex = result.indexOf(marker);
      if (markerIndex >= 0) {
        resolve(result.slice(markerIndex + marker.length));
        return;
      }
      reject(new Error(`无法读取文件 ${file.name} 的内容`));
    };
    reader.onerror = () => reject(reader.error || new Error(`读取文件 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

async function readFileEntry(entry: FileSystemFileEntryLike) {
  const file = await new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
  return file;
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReaderLike) {
  const entries: FileSystemEntryLike[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) {
      return entries;
    }
    entries.push(...batch);
  }
}

async function readDroppedDirectoryEntries(
  entry: FileSystemDirectoryEntryLike,
  prefix = ''
): Promise<ImportedSkillBundleFile[]> {
  const reader = entry.createReader();
  const entries = await readAllDirectoryEntries(reader);
  const files: ImportedSkillBundleFile[] = [];
  for (const child of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const nextPath = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.isDirectory) {
      files.push(
        ...(await readDroppedDirectoryEntries(child as FileSystemDirectoryEntryLike, nextPath))
      );
      continue;
    }
    if (!child.isFile) {
      continue;
    }
    const file = await readFileEntry(child as FileSystemFileEntryLike);
    files.push({
      path: nextPath,
      contentBase64: await fileToBase64(file),
    });
  }
  return files;
}

async function extractDroppedSkillDirectory(
  dataTransfer: DataTransfer
): Promise<DroppedSkillDirectory | null> {
  const filesWithRelativePath = Array.from(dataTransfer.files || []).filter((file) => {
    const dropFile = file as File & { webkitRelativePath?: string; relativePath?: string };
    return Boolean(
      (typeof dropFile.webkitRelativePath === 'string' && dropFile.webkitRelativePath.trim()) ||
        (typeof dropFile.relativePath === 'string' && dropFile.relativePath.trim())
    );
  }) as Array<File & { path?: string; webkitRelativePath?: string; relativePath?: string }>;

  if (filesWithRelativePath.length) {
    const firstRelativePath = (
      filesWithRelativePath[0].webkitRelativePath ||
      filesWithRelativePath[0].relativePath ||
      ''
    )
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    const folderName = firstRelativePath.split('/')[0] || '未命名技能目录';
    const importedFiles = await Promise.all(
      filesWithRelativePath.map(async (file) => {
        const relativePath = (file.webkitRelativePath || file.relativePath || file.name)
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
        const segments = relativePath.split('/').filter(Boolean);
        return {
          path: segments.slice(1).join('/'),
          contentBase64: await fileToBase64(file),
        };
      })
    );
    return {
      sourceDir:
        filesWithRelativePath[0].path && isAbsoluteFilesystemPath(filesWithRelativePath[0].path)
          ? toTopLevelDirectoryPath(filesWithRelativePath[0].path as string, firstRelativePath)
          : undefined,
      label: folderName,
      kind: 'directory',
      files: importedFiles.filter((file) => file.path),
    };
  }

  for (const file of Array.from(dataTransfer.files || [])) {
    const dropFile = file as File & {
      path?: string;
      webkitRelativePath?: string;
      relativePath?: string;
    };
    const relativePath =
      typeof dropFile.webkitRelativePath === 'string' && dropFile.webkitRelativePath.trim()
        ? dropFile.webkitRelativePath
        : typeof dropFile.relativePath === 'string' && dropFile.relativePath.trim()
          ? dropFile.relativePath
          : '';
    if (dropFile.path && isAbsoluteFilesystemPath(dropFile.path) && relativePath) {
      const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const [folderName] = normalizedRelative.split('/');
      return {
        sourceDir: toTopLevelDirectoryPath(dropFile.path, normalizedRelative),
        label: folderName || '未命名技能目录',
        kind: 'directory',
      };
    }
  }

  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== 'file') {
      continue;
    }
    const entry = item.webkitGetAsEntry?.() as FileSystemEntryLike | null | undefined;
    if (entry?.isDirectory) {
      const directoryEntry = entry as FileSystemDirectoryEntryLike;
      return {
        label: entry.name || '未命名技能目录',
        kind: 'directory',
        files: await readDroppedDirectoryEntries(directoryEntry),
      };
    }
    const file = item.getAsFile() as (File & { path?: string }) | null;
    if (file?.path && isAbsoluteFilesystemPath(file.path)) {
      return {
        sourceDir: toParentDirectoryPath(file.path),
        label: file.name || '未命名文件',
        kind: 'file',
      };
    }
  }

  const firstFile = dataTransfer.files[0] as
    | (File & { path?: string; webkitRelativePath?: string; relativePath?: string })
    | undefined;
  if (!firstFile) {
    return null;
  }

  return {
    sourceDir:
      firstFile.path && isAbsoluteFilesystemPath(firstFile.path)
        ? toParentDirectoryPath(firstFile.path)
        : undefined,
    label: firstFile.name || '未命名文件',
    kind: 'file',
  };
}

function codeMirrorExtensions(path: string) {
  const ext = fileExtension(path);
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: ext === 'tsx', typescript: true })];
    case 'json':
      return [json()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

function CapabilityCodeEditor({
  filePath,
  value,
  onChange,
  readOnly = false,
}: {
  filePath: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const extensions = useMemo(() => codeMirrorExtensions(filePath), [filePath]);

  return (
    <div className="min-h-[24rem] overflow-hidden rounded-md border bg-[#1f2430] [&_.cm-editor]:h-full [&_.cm-gutters]:border-r-[#2f3542] [&_.cm-scroller]:font-mono">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[...extensions, EditorView.lineWrapping]}
        theme={oneDark}
        editable={!readOnly}
        height="100%"
        style={{
          minHeight: '24rem',
          width: '100%',
          fontSize: '14px',
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}

function CapabilityMarkdownPreview({ content }: { content: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm], []);

  return (
    <div className="min-h-[24rem] w-full min-w-0 overflow-auto rounded-md border bg-background px-5 py-4">
      <div className="min-w-0 break-words [overflow-wrap:anywhere] text-sm leading-7 text-foreground [&_code]:break-all [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-border [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:mb-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:mb-4 [&_table]:w-full [&_table]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc">
        <ReactMarkdown remarkPlugins={remarkPlugins}>{content || '暂无内容'}</ReactMarkdown>
      </div>
    </div>
  );
}

function CapabilityFileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: CapabilityFileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) =>
        node.kind === 'directory' ? (
          <div key={node.path} className="space-y-1">
            <div className="rounded px-2 py-1 text-xs font-medium text-muted-foreground">
              {node.name}
            </div>
            {node.children?.length && (
              <div className="ml-3 border-l pl-2">
                <CapabilityFileTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            className={`w-full rounded px-2 py-1 text-left text-xs transition-colors ${
              selectedPath === node.path ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
            }`}
            onClick={() => onSelect(node.path)}
          >
            {node.name}
          </button>
        )
      )}
    </div>
  );
}

function useManagementClient() {
  return useMemo(
    () =>
      createAgentV2Client({
        baseUrl: config.api.agentV2BaseUrl,
        endpoint: config.api.agentV2Endpoint,
      }),
    []
  );
}

function CapabilityPanel({
  type,
  projectPath,
  uiState,
  onUiStateChange,
}: {
  type: ManagementCapabilityType;
  projectPath?: string;
  uiState: ManagementPaneUiState;
  onUiStateChange: (next: ManagementPaneUiState) => void;
}) {
  const client = useManagementClient();
  const [items, setItems] = useState<ManagementCapability[]>([]);
  const [selected, setSelected] = useState<ManagementCapability | null>(null);
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const usesMarkdownPresentation = type === 'skill' || type === 'command';
  const [isEditing, setIsEditing] = useState(!usesMarkdownPresentation);
  const [isDragActive, setIsDragActive] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'plugin' | 'builtin' | 'user'>(
    uiState.sourceFilter || 'all'
  );
  const [searchQuery, setSearchQuery] = useState(uiState.searchQuery);
  const [contextMenu, setContextMenu] = useState<CapabilityContextMenuState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [fileTree, setFileTree] = useState<CapabilityFileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFileContent, setCurrentFileContent] = useState('');
  const [currentFileBaseline, setCurrentFileBaseline] = useState('');
  const [unsupportedFileMessage, setUnsupportedFileMessage] = useState<string | null>(null);
  const [formBaseline, setFormBaseline] = useState({
    scope: 'user' as 'user' | 'project',
    name: '',
    content: '',
  });
  const dragDepthRef = useRef(0);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const pendingScrollItemIdRef = useRef<string | null>(null);
  const selectedFilePathRef = useRef<string | null>(null);
  const currentFileContentRef = useRef('');
  const currentFileBaselineRef = useRef('');
  const capabilityRequestIdRef = useRef(0);
  const skillFileRequestIdRef = useRef(0);
  const pendingCapabilityIdRef = useRef<string | null>(null);
  const pendingSkillFilePathRef = useRef<string | null>(null);
  const catalogEventOriginIdRef = useRef(
    `capability-panel-${type}-${Math.random().toString(36).slice(2)}`
  );
  const noun = type === 'skill' ? '技能' : '命令';
  const allowSkillDirectoryDrop = type === 'skill';
  const editorPath =
    selected?.path || `${name || `untitled-${type}`}.${usesMarkdownPresentation ? 'md' : 'txt'}`;
  const isSkillSelection = selected?.type === 'skill' && Boolean(selectedFilePath);
  const isUnsupportedSkillFile = Boolean(selected?.type === 'skill' && unsupportedFileMessage);
  const selectedSkillFileIsMarkdown = Boolean(
    !isUnsupportedSkillFile && selectedFilePath && isMarkdownFilePath(selectedFilePath)
  );
  const supportsPreviewToggle =
    usesMarkdownPresentation && (type !== 'skill' || selectedSkillFileIsMarkdown);
  const activeEditorPath = isSkillSelection && selectedFilePath ? selectedFilePath : editorPath;
  const activeContent = isSkillSelection ? currentFileContent : content;
  const updateSelectedFilePath = useCallback((path: string | null) => {
    selectedFilePathRef.current = path;
    setSelectedFilePath(path);
  }, []);
  const updateCurrentFileContent = useCallback((value: string) => {
    currentFileContentRef.current = value;
    setCurrentFileContent(value);
  }, []);
  const updateCurrentFileBaseline = useCallback((value: string) => {
    currentFileBaselineRef.current = value;
    setCurrentFileBaseline(value);
  }, []);
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const sourceDelta =
          capabilitySourceOrder(a.source?.kind) - capabilitySourceOrder(b.source?.kind);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        return a.name.localeCompare(b.name);
      }),
    [items]
  );
  const displayItems = useMemo<DisplayCapability[]>(() => {
    if (type !== 'skill') {
      return sortedItems;
    }
    const grouped = new Map<string, ManagementCapability[]>();
    for (const item of sortedItems) {
      const current = grouped.get(item.name) || [];
      current.push(item);
      grouped.set(item.name, current);
    }
    return [...grouped.entries()].map(([, group]) => {
      const preferred = [...group].sort((a, b) => {
        const priorityDelta =
          capabilityDisplayPriority(a.source?.kind) - capabilityDisplayPriority(b.source?.kind);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return capabilitySourceOrder(a.source?.kind) - capabilitySourceOrder(b.source?.kind);
      })[0];
      const shadowedSources = group
        .filter((item) => item.id !== preferred.id)
        .map((item) => sourceLabel(item.source));
      const shadowedItems = group.filter((item) => item.id !== preferred.id);
      return shadowedSources.length > 0 ? { ...preferred, shadowedSources, shadowedItems } : preferred;
    });
  }, [sortedItems, type]);
  const filteredItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    return displayItems.filter((item) => {
      if (!matchesDisplayCapabilitySourceFilter(item, sourceFilter)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const searchableValues = [item, ...(item.shadowedItems || [])].flatMap((candidate) => [
        candidate.name,
        candidate.description,
        candidate.path,
        sourceLabel(candidate.source),
      ]);
      return [...searchableValues, ...(item.shadowedSources || [])]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [displayItems, searchQuery, sourceFilter]);
  const enabledItemCount = useMemo(
    () => displayItems.filter((item) => item.enabled !== false).length,
    [displayItems]
  );
  const listCountBadge =
    (type === 'skill' || type === 'command') && enabledItemCount !== displayItems.length
      ? `${enabledItemCount}/${displayItems.length}`
      : `${displayItems.length}`;

  const loadItems = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await client.listCapabilities({
          type,
          projectPath,
          forceRefresh: options?.forceRefresh,
        });
        setItems(payload.capabilities || []);
      } catch (loadError) {
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : `读取${noun}失败`);
      } finally {
        setLoading(false);
      }
    },
    [client, noun, projectPath, type]
  );

  const recoverFromStaleCapability = useCallback(async () => {
    await loadItems({ forceRefresh: true });
    setSelected(null);
    setName('');
    setContent('');
    setFileTree([]);
    updateSelectedFilePath(null);
    updateCurrentFileContent('');
    updateCurrentFileBaseline('');
    setUnsupportedFileMessage(null);
    setFormBaseline({ scope: 'user', name: '', content: '' });
    setMessage(`${noun}已失效，列表已刷新。`);
  }, [
    loadItems,
    noun,
    updateCurrentFileBaseline,
    updateCurrentFileContent,
    updateSelectedFilePath,
  ]);

  const publishPanelCatalogChanged = useCallback((changedType: 'skill' | 'command') => {
    publishCapabilityCatalogChanged({
      type: changedType,
      originId: catalogEventOriginIdRef.current,
    });
  }, []);

  const runSkillHealthCheck = useCallback(async () => {
    if (type !== 'skill') {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await client.checkSkillHealth();
      setMessage(
        formatSkillHealthMessage({
          healthy: result.healthy,
          checkedPath: result.checkedPath,
          issues: result.issues,
          recommendedAction: result.recommendedAction,
        })
      );
      if (!result.healthy) {
        await loadItems({ forceRefresh: true });
      }
    } catch (healthError) {
      setError(healthError instanceof Error ? healthError.message : '技能自检失败');
    } finally {
      setLoading(false);
    }
  }, [client, loadItems, type]);

  const hasForceRefreshedInitialSkillLoadRef = useRef(false);

  useEffect(() => {
    const shouldForceRefreshSkills =
      type === 'skill' && !hasForceRefreshedInitialSkillLoadRef.current;
    if (shouldForceRefreshSkills) {
      hasForceRefreshedInitialSkillLoadRef.current = true;
    }
    void loadItems(shouldForceRefreshSkills ? { forceRefresh: true } : undefined);
    setSelected(null);
    setName('');
    setContent('');
    setFileTree([]);
    updateSelectedFilePath(null);
    updateCurrentFileContent('');
    updateCurrentFileBaseline('');
    setUnsupportedFileMessage(null);
    setSearchQuery(uiState.searchQuery);
    setSourceFilter(uiState.sourceFilter || 'all');
    setFormBaseline({ scope: 'user', name: '', content: '' });
    setIsEditing(!usesMarkdownPresentation);
  }, [
    loadItems,
    uiState.searchQuery,
    uiState.sourceFilter,
    updateCurrentFileBaseline,
    updateCurrentFileContent,
    updateSelectedFilePath,
    usesMarkdownPresentation,
  ]);

  useEffect(() => {
    return subscribeCapabilityCatalogChanged((event) => {
      if (event.type === type && event.originId !== catalogEventOriginIdRef.current) {
        void loadItems({ forceRefresh: true });
      }
    });
  }, [loadItems, type]);

  useEffect(() => {
    onUiStateChange({
      selectedId: selected?.id || null,
      searchQuery,
      sourceFilter,
    });
  }, [onUiStateChange, searchQuery, selected, sourceFilter]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const pendingId = pendingScrollItemIdRef.current;
    if (!pendingId) {
      return;
    }
    const element = itemRefs.current.get(pendingId);
    if (!element) {
      return;
    }
    pendingScrollItemIdRef.current = null;
    element.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [filteredItems, selected]);

  const hasUnsavedChanges = useMemo(() => {
    if (selected?.type === 'skill' && selectedFilePath) {
      return currentFileContent !== currentFileBaseline;
    }
    return (
      scope !== formBaseline.scope ||
      name !== formBaseline.name ||
      content !== formBaseline.content
    );
  }, [
    content,
    currentFileBaseline,
    currentFileContent,
    formBaseline.content,
    formBaseline.name,
    formBaseline.scope,
    name,
    scope,
    selected?.type,
    selectedFilePath,
  ]);
  const canSaveCurrent = useMemo(() => {
    if (selected?.type === 'skill' && selectedFilePath) {
      if (isUnsupportedSkillFile) {
        return false;
      }
      return Boolean(currentFileContent.trim() && selected.editable);
    }
    return Boolean(name.trim() && content.trim() && !(selected && !selected.editable));
  }, [content, currentFileContent, isUnsupportedSkillFile, name, selected, selectedFilePath]);

  const startNew = useCallback(() => {
    capabilityRequestIdRef.current += 1;
    skillFileRequestIdRef.current += 1;
    setSelected(null);
    setScope('user');
    setName('');
    setContent('');
    setFileTree([]);
    updateSelectedFilePath(null);
    updateCurrentFileContent('');
    updateCurrentFileBaseline('');
    setUnsupportedFileMessage(null);
    setFormBaseline({ scope: 'user', name: '', content: '' });
    setError(null);
    setMessage(null);
    setIsEditing(true);
    onUiStateChange({
      selectedId: null,
      searchQuery,
      sourceFilter,
    });
  }, [
    onUiStateChange,
    searchQuery,
    sourceFilter,
    updateCurrentFileBaseline,
    updateCurrentFileContent,
    updateSelectedFilePath,
  ]);

  const selectItem = useCallback(
    async (item: ManagementCapability) => {
      const requestId = capabilityRequestIdRef.current + 1;
      capabilityRequestIdRef.current = requestId;
      skillFileRequestIdRef.current += 1;
      pendingCapabilityIdRef.current = item.id;
      pendingSkillFilePathRef.current = null;
      setSelected(item);
      setName(item.name);
      setScope(item.source?.kind === 'project' ? 'project' : 'user');
      setContent('');
      setFileTree([]);
      updateSelectedFilePath(null);
      updateCurrentFileContent('');
      updateCurrentFileBaseline('');
      setUnsupportedFileMessage(null);
      setFormBaseline({
        scope: item.source?.kind === 'project' ? 'project' : 'user',
        name: item.name,
        content: '',
      });
      setError(null);
      setMessage(null);
      try {
        const detail = await client.readCapability({ id: item.id, projectPath });
        if (
          capabilityRequestIdRef.current !== requestId ||
          pendingCapabilityIdRef.current !== item.id
        ) {
          return;
        }
        pendingCapabilityIdRef.current = detail.capability.id;
        setSelected(detail.capability);
        setContent(detail.content || '');
        setFileTree(detail.files || []);
        setUnsupportedFileMessage(null);
        updateSelectedFilePath(
          detail.selectedFilePath || (item.type === 'skill' ? 'SKILL.md' : null)
        );
        updateCurrentFileContent(detail.content || '');
        updateCurrentFileBaseline(detail.content || '');
        setFormBaseline({
          scope: detail.capability.source?.kind === 'project' ? 'project' : 'user',
          name: detail.capability.name,
          content: detail.content || '',
        });
        setIsEditing(false);
      } catch (detailError) {
        if (
          capabilityRequestIdRef.current !== requestId ||
          pendingCapabilityIdRef.current !== item.id
        ) {
          return;
        }
        pendingCapabilityIdRef.current = null;
        if (isStaleCapabilityError(detailError)) {
          await recoverFromStaleCapability();
          return;
        }
        setContent('');
        setFileTree([]);
        updateSelectedFilePath(null);
        updateCurrentFileContent('');
        updateCurrentFileBaseline('');
        setUnsupportedFileMessage(null);
        setError(detailError instanceof Error ? detailError.message : `读取${noun}内容失败`);
      }
    },
    [client, noun, projectPath, updateCurrentFileBaseline, updateCurrentFileContent, updateSelectedFilePath]
  );

  const selectSkillFile = useCallback(
    async (path: string) => {
      if (!selected || selected.type !== 'skill' || !path || path === selectedFilePath) {
        return;
      }
      const requestId = skillFileRequestIdRef.current + 1;
      skillFileRequestIdRef.current = requestId;
      pendingSkillFilePathRef.current = path;
      setError(null);
      setMessage(null);
      try {
        const detail = await client.readCapabilityFile({
          id: selected.id,
          projectPath,
          path,
        });
        if (
          skillFileRequestIdRef.current !== requestId ||
          pendingSkillFilePathRef.current !== path
        ) {
          return;
        }
        pendingSkillFilePathRef.current = detail.path;
        setUnsupportedFileMessage(null);
        updateSelectedFilePath(detail.path);
        updateCurrentFileContent(detail.content || '');
        updateCurrentFileBaseline(detail.content || '');
        setIsEditing(!isMarkdownFilePath(detail.path));
      } catch (readError) {
        if (
          skillFileRequestIdRef.current !== requestId ||
          pendingSkillFilePathRef.current !== path
        ) {
          return;
        }
        if (isNonTextFileError(readError)) {
          pendingSkillFilePathRef.current = path;
          updateSelectedFilePath(path);
          updateCurrentFileContent('');
          updateCurrentFileBaseline('');
          setUnsupportedFileMessage('This file is not available for text preview or editing.');
          setIsEditing(false);
          return;
        }
        pendingSkillFilePathRef.current = null;
        if (isStaleCapabilityError(readError)) {
          await recoverFromStaleCapability();
          return;
        }
        setError(readError instanceof Error ? readError.message : '读取文件失败');
      }
    },
    [
      client,
      recoverFromStaleCapability,
      projectPath,
      selected,
      selectedFilePath,
      updateCurrentFileBaseline,
      updateCurrentFileContent,
      updateSelectedFilePath,
    ]
  );

  const save = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (selected?.editable && selected?.type === 'skill' && selectedFilePath) {
        if (selectedFilePath === 'SKILL.md') {
          const updated = await client.updateCapability({
            id: selected.id,
            projectPath,
            content: currentFileContent,
          });
          setSelected(updated);
          setContent(currentFileContent);
          setFormBaseline({
            scope: updated.source?.kind === 'project' ? 'project' : 'user',
            name: updated.name,
            content: currentFileContent,
          });
        } else {
          await client.updateCapabilityFile({
            id: selected.id,
            projectPath,
            path: selectedFilePath,
            content: currentFileContent,
          });
        }
        updateCurrentFileBaseline(currentFileContent);
        setMessage(`${noun}已保存`);
      } else if (selected?.editable) {
        const updated = await client.updateCapability({
          id: selected.id,
          projectPath,
          content,
        });
        setSelected(updated);
        setMessage(`${noun}已保存`);
        setFormBaseline({
          scope: updated.source?.kind === 'project' ? 'project' : 'user',
          name: updated.name,
          content,
        });
      } else {
        const created = await client.createCapability({
          type,
          scope,
          projectPath,
          name,
          content,
        });
        setSelected(created);
        setName(created.name);
        setMessage(`${noun}已创建`);
        setFormBaseline({
          scope,
          name: created.name,
          content,
        });
      }
      await loadItems({ forceRefresh: true });
      if (type === 'skill' || type === 'command') {
        publishPanelCatalogChanged(type);
      }
      if (supportsPreviewToggle) {
        setIsEditing(false);
      }
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `保存${noun}失败`);
      return false;
    } finally {
      setLoading(false);
    }
  }, [
    client,
    content,
    loadItems,
    name,
    noun,
    projectPath,
    publishPanelCatalogChanged,
    scope,
    selectedFilePath,
    selected,
    currentFileContent,
    supportsPreviewToggle,
    type,
    updateCurrentFileBaseline,
  ]);

  const guardUnsavedChanges = useCallback(
    async (nextAction: () => Promise<void> | void) => {
      const hasLatestUnsavedChanges =
        selected?.type === 'skill' && selectedFilePathRef.current
          ? currentFileContentRef.current !== currentFileBaselineRef.current
          : hasUnsavedChanges;
      if (!hasLatestUnsavedChanges) {
        await nextAction();
        return;
      }
      setConfirmDialog({
        title: '未保存更改',
        description: `当前${noun}内容还没有保存。要先保存再继续切换吗？`,
        confirmLabel: '保存并继续',
        confirmDisabled: !canSaveCurrent,
        secondaryLabel: '不保存',
        secondaryVariant: 'destructive',
        onSecondary: nextAction,
        onConfirm: async () => {
          const saved = await save();
          if (saved) {
            await nextAction();
          }
        },
      });
    },
    [canSaveCurrent, hasUnsavedChanges, noun, save, selected?.type]
  );

  const handleStartNew = useCallback(() => {
    void guardUnsavedChanges(() => {
      startNew();
    });
  }, [guardUnsavedChanges, startNew]);

  const handleSelectItem = useCallback(
    (item: ManagementCapability) => {
      void guardUnsavedChanges(async () => {
        await selectItem(item);
      });
    },
    [guardUnsavedChanges, selectItem]
  );

  const handleSelectSkillFile = useCallback(
    (path: string) => {
      void guardUnsavedChanges(async () => {
        await selectSkillFile(path);
      });
    },
    [guardUnsavedChanges, selectSkillFile]
  );

  useEffect(() => {
    if (
      !uiState.selectedId ||
      selected ||
      loading ||
      hasUnsavedChanges
    ) {
      return;
    }
    const matched = items.find((item) => item.id === uiState.selectedId);
    if (!matched) {
      return;
    }
    void selectItem(matched);
  }, [hasUnsavedChanges, items, loading, selectItem, selected, uiState.selectedId]);

  const removeItem = useCallback(
    async (item: ManagementCapability) => {
      if (!item.editable) {
        setError(
          item.source?.kind === 'plugin'
            ? '插件技能不支持直接卸载。'
            : `当前${noun}来源只读，无法卸载。`
        );
        return;
      }
      setConfirmDialog({
        title: `删除${noun}`,
        description: `确定要删除${noun}“${item.name}”吗？此操作不可撤销。`,
        confirmLabel: '确认删除',
        confirmVariant: 'destructive',
        onConfirm: async () => {
          setLoading(true);
          setError(null);
          setMessage(null);
          try {
            await client.deleteCapability({ id: item.id, projectPath });
            setMessage(`${noun}已删除`);
            setContextMenu(null);
            if (selected?.id === item.id) {
              startNew();
            }
            await loadItems({ forceRefresh: true });
            if (type === 'skill' || type === 'command') {
              publishPanelCatalogChanged(type);
            }
          } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : `删除${noun}失败`);
          } finally {
            setLoading(false);
          }
        },
      });
    },
    [client, loadItems, noun, projectPath, publishPanelCatalogChanged, selected, startNew, type]
  );

  const remove = useCallback(async () => {
    if (!selected) return;
    await removeItem(selected);
  }, [removeItem, selected]);

  const cancelEditing = useCallback(async () => {
    if (selected?.type === 'skill' && selectedFilePath) {
      updateCurrentFileContent(currentFileBaselineRef.current);
      setUnsupportedFileMessage(null);
      setIsEditing(false);
      return;
    }
    if (selected) {
      await selectItem(selected);
      return;
    }
    startNew();
  }, [selected, selectedFilePath, startNew, updateCurrentFileContent]);

  const toggleCapabilityEnabled = useCallback(
    async (item: ManagementCapability, enabled: boolean) => {
      setError(null);
      setMessage(null);
      if (type !== 'skill') {
        return;
      }

      if (item.source?.kind === 'plugin') {
        const pluginId = item.source?.pluginId;
        const pluginSourceKind = item.source?.pluginSourceKind;
        if (!pluginId) {
          setError('当前插件技能缺少插件标识，无法同步开关。');
          return;
        }
        const runPluginSkillToggle = async () => {
          setLoading(true);
          try {
            const updatedPlugin = await client.setPluginEnabled({
              id: pluginId,
              enabled,
              sourceKind: pluginSourceKind,
            });
            await loadItems({ forceRefresh: true });
            if (selected?.id === item.id) {
              const refreshed = items.find(
                (candidate) =>
                  candidate.source?.pluginId === updatedPlugin.id && candidate.name === item.name
              );
              if (refreshed) {
                await selectItem(refreshed);
              }
            }
            setMessage(
              enabled ? '插件已启用，关联技能已同步启用' : '插件已停用，关联技能已同步停用'
            );
            publishPanelCatalogChanged('skill');
            publishPanelCatalogChanged('command');
          } catch (toggleError) {
            setError(toggleError instanceof Error ? toggleError.message : '更新插件技能状态失败');
          } finally {
            setLoading(false);
          }
        };
        if (enabled === false) {
          setConfirmDialog({
            title: '禁用插件技能',
            description: `技能“${item.name}”来自插件“${pluginId}”。插件技能不能单独禁用，继续后会禁用整个插件。`,
            confirmLabel: '继续禁用插件',
            confirmVariant: 'destructive',
            onConfirm: runPluginSkillToggle,
          });
        } else {
          await runPluginSkillToggle();
        }
        return;
      }

      setLoading(true);
      try {
        const updated = await client.setCapabilityEnabled({
          id: item.id,
          projectPath,
          enabled,
        });
        await loadItems({ forceRefresh: true });
        setSelected((current) =>
          current?.id === item.id ? { ...current, enabled: updated.enabled } : current
        );
        setMessage(enabled ? `${noun}已启用` : `${noun}已禁用`);
        publishPanelCatalogChanged(type);
      } catch (toggleError) {
        setError(toggleError instanceof Error ? toggleError.message : `更新${noun}状态失败`);
      } finally {
        setLoading(false);
      }
    },
    [
      client,
      items,
      loadItems,
      noun,
      projectPath,
      publishPanelCatalogChanged,
      selectItem,
      selected,
      type,
    ]
  );

  const handleConfirmDialog = useCallback(async () => {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    if (!action) {
      return;
    }
    await action();
  }, [confirmDialog]);

  const editItem = useCallback(
    async (item: ManagementCapability) => {
      setContextMenu(null);
      if (!item.editable) {
        setError(
          item.source?.kind === 'plugin'
            ? '插件技能当前不支持直接编辑。'
            : `当前${noun}来源只读，无法编辑。`
        );
        return;
      }
      await selectItem(item);
      setIsEditing(true);
    },
    [noun, selectItem]
  );

  const toggleItemEnabled = useCallback(
    async (item: ManagementCapability) => {
      setContextMenu(null);
      await toggleCapabilityEnabled(item, item.enabled === false);
    },
    [toggleCapabilityEnabled]
  );

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, item: ManagementCapability) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        item,
        x: event.clientX,
        y: event.clientY,
      });
    },
    []
  );

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, []);

  const handleSkillDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!allowSkillDirectoryDrop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [allowSkillDirectoryDrop]
  );

  const handleSkillDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!allowSkillDirectoryDrop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setIsDragActive(true);
    },
    [allowSkillDirectoryDrop]
  );

  const handleSkillDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!allowSkillDirectoryDrop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    },
    [allowSkillDirectoryDrop]
  );

  const handleSkillDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      if (!allowSkillDirectoryDrop) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      resetDragState();
      setError(null);
      setMessage(null);

      const dropped = await extractDroppedSkillDirectory(event.dataTransfer);
      if (!dropped) {
        setError('没有识别到可导入的技能目录，请重新拖入。');
        return;
      }
      if (dropped.kind !== 'directory') {
        setError('只支持拖入包含 SKILL.md 的技能文件夹。');
        return;
      }

      setLoading(true);
      try {
        const imported = dropped.files?.length
          ? await client.importSkillBundle({
              scope,
              projectPath,
              name: dropped.label,
              files: dropped.files,
            })
          : dropped.sourceDir
            ? await client.importSkillDirectory({
                scope,
                projectPath,
                sourceDir: dropped.sourceDir,
              })
            : (() => {
                throw new Error(
                  '当前拖拽内容既没有暴露目录结构，也没有暴露可读本地路径，请改用系统文件管理器里的真实技能文件夹重试。'
                );
              })();
        await loadItems({ forceRefresh: true });
        pendingScrollItemIdRef.current = imported.id;
        await selectItem(imported);
        setScope(imported.source?.kind === 'project' ? 'project' : 'user');
        setMessage(`技能已导入：${imported.name}`);
        publishPanelCatalogChanged('skill');
      } catch (importError) {
        setError(importError instanceof Error ? importError.message : '导入技能失败');
      } finally {
        setLoading(false);
      }
    },
    [
      allowSkillDirectoryDrop,
      client,
      loadItems,
      projectPath,
      publishPanelCatalogChanged,
      resetDragState,
      scope,
      selectItem,
    ]
  );

  const showPreview = Boolean(supportsPreviewToggle && selected && !isEditing);
  const showSkillFileWorkspace = type === 'skill' && selected && fileTree.length > 0;

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[320px_1fr] gap-0 overflow-hidden">
      <section className="flex min-h-0 flex-col border-r pr-4">
        <div className="shrink-0">
          <div className="mb-3 flex h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
              <FileCode2 className="h-4 w-4 text-amber-600" />
              {noun}列表
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{listCountBadge}</Badge>
              {type === 'skill' ? (
                <Button size="sm" variant="outline" onClick={() => void runSkillHealthCheck()}>
                  <RefreshCw className="h-4 w-4" />
                  技能自检
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={handleStartNew}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div
          className={`min-h-0 flex-1 overflow-y-auto rounded-md transition-colors ${
            allowSkillDirectoryDrop
              ? isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-border/80'
              : 'border-transparent p-0'
          }`}
          onDragEnter={handleSkillDragEnter}
          onDragOver={handleSkillDragOver}
          onDragLeave={handleSkillDragLeave}
          onDrop={(event) => {
            void handleSkillDrop(event);
          }}
        >
          <div className="sticky top-0 z-10 mb-2 space-y-2 bg-background pb-2">
            <div className="flex items-center gap-2">
              <Select
                value={sourceFilter}
                onValueChange={(value) =>
                  setSourceFilter(value as 'all' | 'plugin' | 'builtin' | 'user')
                }
              >
                <SelectTrigger className="h-9 w-[88px] shrink-0 text-xs">
                  <SelectValue placeholder="来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="plugin">插件</SelectItem>
                  <SelectItem value="builtin">内置</SelectItem>
                  <SelectItem value="user">用户</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={`搜索${noun}名称、描述或路径`}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
            {type === 'skill' ? (
              <div className="px-1 text-[11px] leading-5 text-muted-foreground">
                拖动本地 skill 文件夹到这里即可完成安装。
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <div
                role="button"
                tabIndex={0}
                key={item.id}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(item.id, element);
                    return;
                  }
                  itemRefs.current.delete(item.id);
                }}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  selected?.id === item.id ||
                  item.shadowedItems?.some((shadowedItem) => shadowedItem.id === selected?.id)
                    ? 'border-primary/50 bg-primary/8'
                    : 'bg-background hover:bg-muted/40'
                }`}
                onClick={() => {
                  handleSelectItem(item);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelectItem(item);
                  }
                }}
                onContextMenu={(event) => openContextMenu(event, item)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline">{sourceLabel(item.source)}</Badge>
                      {!item.editable && <Badge variant="secondary">只读</Badge>}
                      {item.enabled === false && <Badge variant="secondary">已禁用</Badge>}
                      {item.shadowedSources?.length ? (
                        <Badge variant="secondary">
                          内置优先，已覆盖 {item.shadowedSources.join(' / ')}
                        </Badge>
                      ) : null}
                    </div>
                    {item.description && (
                      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                    {item.path && (
                      <div className="mt-1 truncate text-muted-foreground">{item.path}</div>
                    )}
                    {item.shadowedItems?.length ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {item.shadowedItems.map((shadowedItem) => {
                          const shadowedSource = sourceLabel(shadowedItem.source);
                          return (
                            <Button
                              key={shadowedItem.id}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              aria-label={`Open ${shadowedSource} ${shadowedItem.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleSelectItem(shadowedItem);
                              }}
                            >
                              {shadowedSource}
                            </Button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {type === 'skill' ? (
                    <Switch
                      checked={item.enabled !== false}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={(checked) => {
                        void toggleCapabilityEnabled(item, checked);
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ))}
            {!loading && filteredItems.length === 0 ? (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {items.length === 0 ? `暂无${noun}` : `没有匹配的${noun}`}
              </div>
            ) : null}
          </div>
        </div>
        {type === 'skill' && contextMenu ? (
          <div
            className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`flex w-full items-center rounded-sm px-3 py-2 text-left text-xs hover:bg-muted ${
                contextMenu.item.editable ? '' : 'cursor-not-allowed text-muted-foreground'
              }`}
              disabled={!contextMenu.item.editable}
              onClick={() => {
                void editItem(contextMenu.item);
              }}
            >
              编辑
            </button>
            <button
              type="button"
              className="flex w-full items-center rounded-sm px-3 py-2 text-left text-xs hover:bg-muted"
              onClick={() => {
                void toggleItemEnabled(contextMenu.item);
              }}
            >
              {contextMenu.item.enabled === false ? '启用' : '禁用'}
            </button>
            <button
              type="button"
              className={`flex w-full items-center rounded-sm px-3 py-2 text-left text-xs ${
                contextMenu.item.source?.kind === 'plugin'
                  ? 'cursor-not-allowed text-muted-foreground'
                  : 'text-destructive hover:bg-destructive/10'
              }`}
              disabled={contextMenu.item.source?.kind === 'plugin'}
              onClick={() => {
                void removeItem(contextMenu.item);
              }}
            >
              卸载
            </button>
          </div>
        ) : null}
      </section>

      <section className="flex min-h-0 min-w-0 flex-col pl-4">
        <div className="shrink-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {selected ? selected.name : `新建${noun}`}
              </div>
              {selected?.path && (
                <div className="truncate text-xs text-muted-foreground">{selected.path}</div>
              )}
              {showSkillFileWorkspace && selectedFilePath ? (
                <div className="truncate text-xs text-muted-foreground">{selectedFilePath}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
              {supportsPreviewToggle && selected?.editable && !isEditing ? (
                <Button variant="outline" onClick={() => setIsEditing(true)} disabled={loading}>
                  <Pencil className="h-4 w-4" />
                  编辑
                </Button>
              ) : !selected || selected.editable ? (
                <>
                  <Button
                    onClick={() => void save()}
                    disabled={loading || !canSaveCurrent || Boolean(selected && !selected.editable)}
                  >
                    <Save className="h-4 w-4" />
                    {selected?.editable ? '保存修改' : '保存'}
                  </Button>
                  {supportsPreviewToggle && (
                    <Button
                      variant="outline"
                      onClick={() => void cancelEditing()}
                      disabled={loading}
                    >
                      取消
                    </Button>
                  )}
                </>
              ) : null}
              {selected?.editable && (
                <Button variant="outline" onClick={() => void remove()} disabled={loading}>
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pt-4">
          <div className="min-w-0 space-y-4">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            {message ? (
              <div className="rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {message}
              </div>
            ) : null}

            {showSkillFileWorkspace ? (
              <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="rounded-md border p-2">
                  <CapabilityFileTree
                    nodes={fileTree}
                    selectedPath={selectedFilePath}
                    onSelect={handleSelectSkillFile}
                  />
                </div>
                <div className="min-w-0 space-y-4">
                  {isUnsupportedSkillFile ? (
                    <div className="min-h-[24rem] rounded-md border border-dashed bg-muted/30 px-5 py-4 text-sm text-muted-foreground">
                      {unsupportedFileMessage}
                    </div>
                  ) : showPreview ? (
                    <CapabilityMarkdownPreview content={activeContent} />
                  ) : (
                    <CapabilityCodeEditor
                      filePath={activeEditorPath}
                      value={activeContent}
                      readOnly={Boolean(selected && !selected.editable)}
                      onChange={updateCurrentFileContent}
                    />
                  )}
                </div>
              </div>
            ) : !showPreview ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-2 sm:shrink-0">
                  <Select
                    value={scope}
                    onValueChange={(value) => setScope(value as 'user' | 'project')}
                    disabled={Boolean(selected)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">用户</SelectItem>
                      <SelectItem value="project" disabled={!projectPath}>
                        项目
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:min-w-0 sm:flex-1">
                  <Input
                    value={name}
                    disabled={Boolean(selected)}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {!showSkillFileWorkspace && showPreview ? (
              <CapabilityMarkdownPreview content={content} />
            ) : !showSkillFileWorkspace && usesMarkdownPresentation ? (
              <CapabilityCodeEditor
                filePath={editorPath}
                value={content}
                readOnly={Boolean(selected && !selected.editable)}
                onChange={setContent}
              />
            ) : !showSkillFileWorkspace ? (
              <Textarea
                className="min-h-[24rem] font-mono text-sm"
                value={content}
                disabled={Boolean(selected && !selected.editable)}
                placeholder={`输入 ${noun} Markdown 内容`}
                onChange={(event) => setContent(event.target.value)}
              />
            ) : null}
            {selected && !selected.editable && <Badge variant="secondary">当前来源只读</Badge>}
          </div>
        </div>
      </section>
      <Dialog
        open={Boolean(confirmDialog)}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[min(92vw,520px)] gap-0 overflow-hidden p-0"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">{confirmDialog?.title}</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              {confirmDialog?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 px-6 py-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDialog(null)}
              disabled={loading}
            >
              取消
            </Button>
            {confirmDialog?.secondaryLabel ? (
              <Button
                type="button"
                variant={confirmDialog.secondaryVariant || 'outline'}
                onClick={() => {
                  const action = confirmDialog.onSecondary;
                  setConfirmDialog(null);
                  void action?.();
                }}
                disabled={loading}
              >
                {confirmDialog.secondaryLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={confirmDialog?.confirmVariant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => void handleConfirmDialog()}
              disabled={loading || confirmDialog?.confirmDisabled}
            >
              {confirmDialog?.confirmLabel || '确定'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PluginPanel({
  uiState,
  onUiStateChange,
}: {
  uiState: ManagementPaneUiState;
  onUiStateChange: (next: ManagementPaneUiState) => void;
}) {
  type PluginInstallSourceMode = 'local' | 'github';

  const client = useManagementClient();
  const [items, setItems] = useState<ManagedPlugin[]>([]);
  const [selected, setSelected] = useState<ManagedPlugin | null>(null);
  const [installSourceMode, setInstallSourceMode] = useState<PluginInstallSourceMode>('local');
  const [installValue, setInstallValue] = useState('');
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [searchQuery, setSearchQuery] = useState(uiState.searchQuery);
  const installInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((plugin) =>
      [plugin.id, plugin.name, plugin.path, sourceLabel(plugin.source)]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(keyword))
    );
  }, [items, searchQuery]);

  const loadPlugins = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await client.listPlugins({ forceRefresh: options?.forceRefresh });
        const nextItems = payload.plugins || [];
        setItems(nextItems);
        setSelected((current) => {
          const targetId = current?.id || uiState.selectedId;
          return targetId ? nextItems.find((plugin) => plugin.id === targetId) || null : null;
        });
      } catch (loadError) {
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : '读取插件失败');
      } finally {
        setLoading(false);
      }
    },
    [client, uiState.selectedId]
  );

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  useEffect(() => {
    onUiStateChange({
      selectedId: selected?.id || null,
      searchQuery,
    });
  }, [onUiStateChange, searchQuery, selected]);

  const installPluginFromSource = useCallback(async () => {
    const trimmedValue = installValue.trim() || installInputRef.current?.value.trim() || '';
    if (!trimmedValue) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const installInput: InstallPluginInput =
        installSourceMode === 'github'
          ? {
              source: { kind: 'github', repoUrl: trimmedValue },
              scope: 'user',
            }
          : {
              source: { kind: 'dev-local', directory: trimmedValue },
              scope: 'user',
            };
      const plugin = await client.installPlugin(installInput);
      setInstallValue('');
      setInstallDialogOpen(false);
      setSelected(plugin);
      setMessage(
        installSourceMode === 'github'
          ? '\u5df2\u5b89\u88c5 GitHub \u63d2\u4ef6'
          : '\u5df2\u5b89\u88c5\u5f00\u53d1\u63d2\u4ef6'
      );
      await loadPlugins();
      publishCapabilityCatalogChanged({ type: 'skill' });
      publishCapabilityCatalogChanged({ type: 'command' });
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : '\u5b89\u88c5\u63d2\u4ef6\u5931\u8d25');
    } finally {
      setLoading(false);
    }
  }, [client, installSourceMode, installValue, loadPlugins]);

  const installSourceDescription =
    installSourceMode === 'github'
      ? '支持输入完整 GitHub 仓库地址，可附带 #subdir。'
      : '当前支持从本地目录进行开发安装';

  const openInstallDialog = useCallback(() => {
    setError(null);
    setMessage(null);
    setInstallDialogOpen(true);
  }, []);

  const togglePlugin = useCallback(
    async (plugin: ManagedPlugin, enabled: boolean) => {
      setError(null);
      setMessage(null);
      try {
        const updated = await client.setPluginEnabled({
          id: plugin.id,
          enabled,
          sourceKind: plugin.source?.kind,
        });
        setSelected(updated);
        setMessage(enabled ? '插件已启用' : '插件已停用');
        await loadPlugins();
        publishCapabilityCatalogChanged({ type: 'skill' });
        publishCapabilityCatalogChanged({ type: 'command' });
      } catch (toggleError) {
        setError(toggleError instanceof Error ? toggleError.message : '更新插件失败');
      }
    },
    [client, loadPlugins]
  );

  const removePlugin = useCallback(
    async (plugin: ManagedPlugin) => {
      setError(null);
      setMessage(null);
      setConfirmDialog({
        title: '移除插件',
        description: `确定要移除插件“${plugin.id}”吗？此操作不可撤销。`,
        confirmLabel: '确认移除',
        confirmVariant: 'destructive',
        onConfirm: async () => {
          try {
            await client.deletePlugin({ id: plugin.id, sourceKind: plugin.source?.kind });
            setSelected(null);
            setMessage('插件已移除');
            await loadPlugins();
            publishCapabilityCatalogChanged({ type: 'skill' });
            publishCapabilityCatalogChanged({ type: 'command' });
          } catch (removeError) {
            setError(removeError instanceof Error ? removeError.message : '移除插件失败');
          }
        },
      });
    },
    [client, loadPlugins]
  );

  const handleConfirmDialog = useCallback(async () => {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    if (!action) {
      return;
    }
    await action();
  }, [confirmDialog]);

  const selectedPayload = selected ? JSON.stringify(selected, null, 2) : '';

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[320px_1fr] gap-0 overflow-hidden">
      <section className="flex min-h-0 flex-col border-r pr-4">
        <div className="shrink-0">
          <div className="mb-3 flex h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
              <Package className="h-4 w-4 text-sky-600" />
              插件列表
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openInstallDialog}>
                <Plus className="h-4 w-4" />
              </Button>
              <Badge variant="secondary">{items.length}</Badge>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索插件名称、来源或路径"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            {filteredItems.map((plugin) => (
              <div
                role="button"
                tabIndex={0}
                key={`${plugin.source?.kind || 'lite'}:${plugin.id}`}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  selected?.id === plugin.id
                    ? 'border-primary/50 bg-primary/8'
                    : 'bg-background hover:bg-muted/40'
                }`}
                onClick={() => setSelected(plugin)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(plugin);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{plugin.name || plugin.id}</span>
                      <Badge variant="outline">{sourceLabel(plugin.source)}</Badge>
                      <Badge variant={plugin.enabled === false ? 'secondary' : 'outline'}>
                        {plugin.enabled === false ? '停用' : '启用'}
                      </Badge>
                    </div>
                    {plugin.path && (
                      <div className="mt-1 truncate text-muted-foreground">{plugin.path}</div>
                    )}
                  </div>
                  <Switch
                    checked={plugin.enabled !== false}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) => void togglePlugin(plugin, checked)}
                  />
                </div>
              </div>
            ))}
            {!loading && filteredItems.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {items.length === 0 ? '暂无插件' : '没有匹配的插件'}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col pl-4">
        <div className="shrink-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {selected?.name || selected?.id || '选择插件'}
              </div>
              {selected?.path ? (
                <div className="truncate text-xs text-muted-foreground">{selected.path}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadPlugins({ forceRefresh: true })}
                disabled={loading}
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
              {selected ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void togglePlugin(selected, selected.enabled === false)}
                    disabled={loading}
                  >
                    {selected.enabled === false ? '启用插件' : '停用插件'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void removePlugin(selected)}
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4" />
                    移除
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pt-4">
          <div className="min-w-0 space-y-4">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            {message ? (
              <div className="rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {message}
              </div>
            ) : null}

            {selected ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">来源</div>
                    <div className="mt-1 font-medium">{sourceLabel(selected.source)}</div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">状态</div>
                    <div className="mt-1 font-medium">
                      {selected.enabled === false ? '停用' : '启用'}
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">插件 ID</div>
                    <div className="mt-1 break-all font-medium">{selected.id}</div>
                  </div>
                </div>
                <CapabilityCodeEditor
                  filePath={selected.path || `${selected.id}.json`}
                  value={selectedPayload}
                  readOnly
                  onChange={() => {}}
                />
              </>
            ) : (
              <UnifiedEmptyState
                title="选择一个插件开始查看"
                description="左侧保留列表和开关，这里会展示插件详情与配置内容。"
                minHeightClassName="min-h-[24rem]"
              />
            )}
          </div>
        </div>
      </section>
      <Dialog
        open={Boolean(confirmDialog)}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[min(92vw,520px)] gap-0 overflow-hidden p-0"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">{confirmDialog?.title}</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              {confirmDialog?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 px-6 py-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDialog(null)}
              disabled={loading}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={confirmDialog?.confirmVariant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => void handleConfirmDialog()}
              disabled={loading}
            >
              {confirmDialog?.confirmLabel || '确定'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="w-[min(92vw,720px)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">安装插件</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              {installSourceDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>安装来源</Label>
              <Select
                value={installSourceMode}
                onValueChange={(value) => setInstallSourceMode(value as PluginInstallSourceMode)}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{'\u672c\u5730\u76ee\u5f55'}</SelectItem>
                  <SelectItem value="github">{'GitHub \u4ed3\u5e93'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{installSourceMode === 'github' ? '仓库地址' : '插件目录'}</Label>
              <Input
                ref={installInputRef}
                value={installValue}
                placeholder={
                  installSourceMode === 'github'
                    ? 'https://github.com/owner/repo#subdir'
                    : '本地插件目录绝对路径'
                }
                onChange={(event) => setInstallValue(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-6 py-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setInstallDialogOpen(false)}
                disabled={loading}
              >
                取消
              </Button>
              <Button type="button" disabled={loading} onClick={() => void installPluginFromSource()}>
                <Plus className="h-4 w-4" />
                安装
              </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HooksPanel({
  projectPath,
  uiState,
  onUiStateChange,
}: {
  projectPath?: string;
  uiState: ManagementPaneUiState;
  onUiStateChange: (next: ManagementPaneUiState) => void;
}) {
  const client = useManagementClient();
  const [sources, setSources] = useState<HookSourceOverview[]>([]);
  const [selected, setSelected] = useState<HookSourceOverview | null>(null);
  const [searchQuery, setSearchQuery] = useState(uiState.searchQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredSources = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return sources;
    }
    return sources.filter((source) =>
      [source.id, source.label, source.kind, source.path]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(keyword))
    );
  }, [searchQuery, sources]);

  const loadHooks = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await client.getHooksOverview({
          projectPath,
          forceRefresh: options?.forceRefresh,
        });
        const nextSources = payload.sources || [];
        setSources(nextSources);
        setSelected((current) => {
          const targetId = current?.id || uiState.selectedId;
          return targetId ? nextSources.find((source) => source.id === targetId) || null : null;
        });
      } catch (loadError) {
        setSources([]);
        setError(loadError instanceof Error ? loadError.message : '读取 Hooks 失败');
      } finally {
        setLoading(false);
      }
    },
    [client, projectPath, uiState.selectedId]
  );

  useEffect(() => {
    void loadHooks();
  }, [loadHooks]);

  useEffect(() => {
    onUiStateChange({
      selectedId: selected?.id || null,
      searchQuery,
    });
  }, [onUiStateChange, searchQuery, selected]);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[320px_1fr] gap-0 overflow-hidden">
      <section className="flex min-h-0 flex-col border-r pr-4">
        <div className="shrink-0">
          <div className="mb-3 flex h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
              <GitBranch className="h-4 w-4 text-rose-600" />
              Hooks 入口
            </div>
            <Badge variant="secondary">{sources.length}</Badge>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索 Hooks 名称、类型或路径"
              className="h-9 pl-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            {filteredSources.map((source) => (
              <button
                type="button"
                key={source.id}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  selected?.id === source.id
                    ? 'border-primary/50 bg-primary/8'
                    : 'bg-background hover:bg-muted/40'
                }`}
                onClick={() => setSelected(source)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{source.label || source.id}</span>
                    <Badge variant="outline">{source.kind || source.id}</Badge>
                    <Badge variant={source.writable ? 'outline' : 'secondary'}>
                      {source.writable ? '可写' : '只读'}
                    </Badge>
                    <Badge variant="secondary">{source.hookEventCount || 0}</Badge>
                  </div>
                  {source.path && (
                    <div className="mt-1 truncate text-muted-foreground">{source.path}</div>
                  )}
                </div>
              </button>
            ))}
            {!loading && filteredSources.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-muted-foreground">
                {sources.length === 0 ? '暂无 Hooks 来源' : '没有匹配的 Hooks 来源'}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col pl-4">
        <div className="shrink-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {selected?.label || '选择 Hooks 来源'}
              </div>
              {selected?.path ? (
                <div className="truncate text-xs text-muted-foreground">{selected.path}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadHooks({ forceRefresh: true })}
                disabled={loading}
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pt-4">
          <div className="min-w-0 space-y-4">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            {selected ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">类型</div>
                    <div className="mt-1 font-medium">{selected.kind || 'unknown'}</div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">写入能力</div>
                    <div className="mt-1 font-medium">{selected.writable ? '可写' : '只读'}</div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">事件数</div>
                    <div className="mt-1 font-medium">{selected.hookEventCount || 0}</div>
                  </div>
                </div>
                <CapabilityCodeEditor
                  filePath={selected.path || `${selected.id}.json`}
                  value={selected.rawJson || ''}
                  readOnly
                  onChange={() => {}}
                />
              </>
            ) : (
              <UnifiedEmptyState
                title="选择一个 Hooks 来源开始查看"
                description="左侧选中来源后，这里会显示对应的 settings JSON。"
                minHeightClassName="min-h-[24rem]"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function ManagementWorkspace({
  projectPath,
  mode: controlledMode,
  onModeChange,
  hideModeSelect = false,
}: ManagementWorkspaceProps) {
  const [uncontrolledMode, setUncontrolledMode] = useState<ManagementMode>('plugins');
  const [paneUiStateByMode, setPaneUiStateByMode] = useState<
    Record<ManagementMode, ManagementPaneUiState>
  >({
    plugins: defaultManagementPaneUiState(),
    skills: defaultManagementPaneUiState(),
    commands: defaultManagementPaneUiState(),
    hooks: defaultManagementPaneUiState(),
  });
  const mode = controlledMode || uncontrolledMode;
  const setMode = onModeChange || setUncontrolledMode;
  const [activatedModes, setActivatedModes] = useState<Record<ManagementMode, boolean>>(() => ({
    plugins: mode === 'plugins',
    skills: mode === 'skills',
    commands: mode === 'commands',
    hooks: mode === 'hooks',
  }));
  const updatePaneUiState = useCallback(
    (targetMode: ManagementMode, next: ManagementPaneUiState) => {
      setPaneUiStateByMode((current) => {
        const previous = current[targetMode];
        if (
          previous.selectedId === next.selectedId &&
          previous.searchQuery === next.searchQuery &&
          previous.sourceFilter === next.sourceFilter
        ) {
          return current;
        }
        return {
          ...current,
          [targetMode]: next,
        };
      });
    },
    []
  );

  useEffect(() => {
    setActivatedModes((current) => {
      if (current[mode]) {
        return current;
      }
      return { ...current, [mode]: true };
    });
  }, [mode]);

  const panelClassName = useCallback(
    (targetMode: ManagementMode) => (mode === targetMode ? 'contents' : 'hidden'),
    [mode]
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {!hideModeSelect && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
            <div>
              <div className="text-base font-semibold">管理中心</div>
              <div className="text-sm text-muted-foreground">
                选择一个管理对象，左侧处理列表和开关，右侧查看详情。
              </div>
            </div>
            <Select value={mode} onValueChange={(value) => setMode(value as ManagementMode)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plugins">插件管理</SelectItem>
                <SelectItem value="skills">技能管理</SelectItem>
                <SelectItem value="commands">命令管理</SelectItem>
                <SelectItem value="hooks">钩子管理</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm font-medium">{modeLabels[mode]}</div>
        </>
      )}
      {activatedModes.plugins && (
        <div className={panelClassName('plugins')}>
          <PluginPanel
            uiState={paneUiStateByMode.plugins}
            onUiStateChange={(next) => updatePaneUiState('plugins', next)}
          />
        </div>
      )}
      {activatedModes.skills && (
        <div className={panelClassName('skills')}>
          <CapabilityPanel
            type="skill"
            projectPath={projectPath}
            uiState={paneUiStateByMode.skills}
            onUiStateChange={(next) => updatePaneUiState('skills', next)}
          />
        </div>
      )}
      {activatedModes.commands && (
        <div className={panelClassName('commands')}>
          <CapabilityPanel
            type="command"
            projectPath={projectPath}
            uiState={paneUiStateByMode.commands}
            onUiStateChange={(next) => updatePaneUiState('commands', next)}
          />
        </div>
      )}
      {activatedModes.hooks && (
        <div className={panelClassName('hooks')}>
          <HooksPanel
            projectPath={projectPath}
            uiState={paneUiStateByMode.hooks}
            onUiStateChange={(next) => updatePaneUiState('hooks', next)}
          />
        </div>
      )}
    </div>
  );
}
