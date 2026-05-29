import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { UnifiedEmptyState } from '@/entrypoints/sidepanel/components/UnifiedEmptyState';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Checkbox } from '@/entrypoints/sidepanel/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/entrypoints/sidepanel/components/ui/dialog';
import { Label } from '@/entrypoints/sidepanel/components/ui/label';
import { createAgentV2Client } from '../lib/agent-v2/client';
import { localizeUserFacingError } from '../lib/user-facing-error';
import {
  AGENT_V2_CURRENT_SESSION_STORAGE_KEY,
  AGENT_V2_SESSION_SELECTION_STORAGE_KEY,
  clearAgentV2WorkspaceIntent,
  publishAgentV2ProjectSelection,
  publishAgentV2SessionSelection,
  type AgentV2SessionSelection,
  readAgentV2CurrentSession,
  readAgentV2ProjectSelection,
  readAgentV2WorkspaceIntent,
} from '../lib/agent-v2/session-selection';
import type {
  ClaudeProjectSummary,
  ClaudeSessionSummary,
  FileTreeEntry,
  FolderSuggestion,
  SessionRunStateRecord,
} from '../lib/agent-v2/types';
import { useAgentV2SessionRuns } from '../lib/agent-v2/useAgentV2SessionRuns';
import { useAgentV2Sessions } from '../lib/agent-v2/useAgentV2Sessions';
import { config } from '../lib/config';
import {
  buildFileBrowserPreviewUrl,
  buildHtmlBrowserPreviewUrl,
  buildSidepanelFilePreviewUrl,
  openHtmlBrowserPreview,
} from '../lib/file-preview-browser';
import { summarizePromptForDisplay } from '../../../../../shared/utils/src/prompt-metadata.ts';

function formatTime(value: string | null) {
  if (!value) {
    return '未知时间';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type FileSortKey = 'name' | 'modifiedAt' | 'size';
type FileSortConfig = {
  key: FileSortKey;
  direction: 'asc' | 'desc';
};
type FileContextMenuState = {
  file: FileTreeEntry | null;
  x: number;
  y: number;
};
type FileContextMenuPosition = {
  left: number;
  top: number;
};
type CreatingEntryState = {
  parentPath: string;
  type: 'file' | 'directory';
  name: string;
} | null;

type PendingWorkspaceIntent = {
  kind: 'new_session';
  requestedAt: string;
} | null;

type PendingWorkspaceDelete = {
  project: ClaudeProjectSummary;
  deleteDirectory: boolean;
};

type WorkspaceDetailPane = 'sessions' | 'files';
type DirectoryCacheMode = 'lightweight' | 'metadata';

type CachedDirectoryEntries = {
  entries: FileTreeEntry[];
  cachedAt: number;
};

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const DIRECTORY_CACHE_TTL_MS = 10_000;
const FILE_ROW_HEIGHT_PX = 28;
const FILE_LIST_OVERSCAN = 10;

function validateFileName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return '名称不能为空';
  }
  if (INVALID_FILENAME_CHARS.test(trimmed)) {
    return '名称包含非法字符';
  }
  if (RESERVED_NAMES.test(trimmed)) {
    return '这是 Windows 保留名称';
  }
  if (/^\.+$/.test(trimmed)) {
    return '名称不能只包含点号';
  }
  return null;
}

function getFileParentPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function normalizeTargetDirectoryPath(path?: string) {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  const lastSegment = trimmed.split('/').filter(Boolean).at(-1) || '';
  return /\.[^./]+$/.test(lastSegment) ? getFileParentPath(trimmed) || null : trimmed;
}

function formatFileSize(bytes?: number) {
  if (bytes === undefined || bytes === null) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return '-';
  }
  const diffMs = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))} 分前`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} 小时前`;
  }
  return `${Math.floor(diffMs / day)} 天前`;
}

function isHtmlFile(file: FileTreeEntry) {
  return file.type === 'file' && /\.html?$/i.test(file.name);
}

function sanitizeSessionTitle(title?: string) {
  const normalized = title ? summarizePromptForDisplay(title).replace(/\s+/g, ' ').trim() : '';
  return normalized || undefined;
}

function clampFileContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number
): FileContextMenuPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const padding = 8;
  return {
    left: Math.min(Math.max(x, padding), Math.max(padding, viewportWidth - width - padding)),
    top: Math.min(Math.max(y, padding), Math.max(padding, viewportHeight - height - padding)),
  };
}

function getFileBreadcrumbs(activeDirPath: string | null) {
  const breadcrumbs: Array<{ label: string; path: string | null }> = [
    { label: '文件', path: null },
  ];
  if (!activeDirPath) {
    return breadcrumbs;
  }
  let currentPath = '';
  for (const segment of activeDirPath.split('/').filter(Boolean)) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    breadcrumbs.push({ label: segment, path: currentPath });
  }
  return breadcrumbs;
}

function sortFiles(files: FileTreeEntry[], sort: FileSortConfig): FileTreeEntry[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    let result = 0;
    if (sort.key === 'modifiedAt') {
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : -1;
      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : -1;
      result = aTime - bTime;
    } else if (sort.key === 'size') {
      result = (a.size ?? -1) - (b.size ?? -1);
    } else {
      result = a.name.localeCompare(b.name);
    }
    if (result === 0) {
      result = a.name.localeCompare(b.name);
    }
    return sort.direction === 'asc' ? result : -result;
  });
}

function filterFiles(files: FileTreeEntry[], query: string): FileTreeEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return files;
  }
  return files.filter(
    (file) => file.name.toLowerCase().includes(trimmed) || file.path.toLowerCase().includes(trimmed)
  );
}

function sortRequiresMetadata(key: FileSortKey) {
  return key === 'modifiedAt' || key === 'size';
}

function isHiddenFileEntry(file: FileTreeEntry) {
  return file.name.startsWith('.');
}

function formatWorkspaceBrowseError(error: unknown) {
  const message = localizeUserFacingError(error, '加载本地文件夹失败，请稍后重试。');
  if (!message) {
    return '加载本地文件夹失败，请稍后重试。';
  }
  if (message.includes('Workspace directory does not exist')) {
    return '当前路径不存在，请重新选择本地文件夹。';
  }
  if (message.includes('Workspace path must be a directory')) {
    return '当前路径不是文件夹，请重新选择本地文件夹。';
  }
  if (message.includes('Failed to browse workspace folders')) {
    return '加载本地文件夹失败，请稍后重试。';
  }
  if (message.includes('Folder already exists')) {
    return '文件夹已存在，请换一个名称。';
  }
  if (message.includes('Folder name is invalid') || message.includes('Folder name is required')) {
    return '文件夹名称不合法，请重新输入。';
  }
  if (message.includes('Failed to create workspace folder')) {
    return '新建文件夹失败，请稍后重试。';
  }
  return message;
}

function shouldFallbackToFolderBrowser(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('System folder picker is not supported on this platform');
}

function isAbsoluteFilesystemPath(path: string) {
  return /^(\/|[A-Za-z]:[\\/])/.test(path);
}

function sameProjectPath(left: string, right: string) {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase();
}

function isActiveSessionRun(record: SessionRunStateRecord) {
  return record.status === 'connecting' || record.status === 'streaming';
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

async function extractDroppedWorkspacePath(dataTransfer: DataTransfer): Promise<{
  projectPath?: string;
  label: string;
  kind: 'file' | 'directory';
} | null> {
  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== 'file') {
      continue;
    }
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      return {
        label: entry.name || '未命名文件夹',
        kind: 'directory',
      };
    }
    const file = item.getAsFile() as (File & { path?: string }) | null;
    if (file?.path && isAbsoluteFilesystemPath(file.path)) {
      return {
        projectPath: toParentDirectoryPath(file.path),
        label: file.name || '未命名文件',
        kind: 'file',
      };
    }
    if (entry?.isFile || file) {
      return {
        label: entry?.name || file?.name || '未命名文件',
        kind: 'file',
      };
    }
  }

  const firstFile = dataTransfer.files[0] as (File & { path?: string }) | undefined;
  if (!firstFile) {
    return null;
  }

  return {
    projectPath:
      firstFile.path && isAbsoluteFilesystemPath(firstFile.path)
        ? toParentDirectoryPath(firstFile.path)
        : undefined,
    label: firstFile.name || '未命名文件',
    kind: 'file',
  };
}

function FolderBrowserModal({
  open,
  loading,
  currentPath,
  parentPath,
  folders,
  error,
  hint,
  onClose,
  onNavigate,
  onSelect,
  onCreateFolder,
}: {
  open: boolean;
  loading: boolean;
  currentPath: string;
  parentPath: string | null;
  folders: FolderSuggestion[];
  error: string | null;
  hint: string | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  onCreateFolder: (name: string) => Promise<void>;
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    if (!open) {
      setFilterQuery('');
      setNewFolderName('');
      return;
    }
    setFilterQuery('');
  }, [currentPath, open]);

  const visibleFolders = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return folders;
    }
    return folders.filter(
      (folder) =>
        folder.name.toLowerCase().includes(query) || folder.path.toLowerCase().includes(query)
    );
  }, [filterQuery, folders]);

  if (!open) {
    return null;
  }

  const submitCreateFolder = () => {
    if (!newFolderName.trim()) {
      return;
    }
    void onCreateFolder(newFolderName.trim()).then(() => {
      setNewFolderName('');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">选择本地工作区路径</div>
            <div className="mt-1 text-xs text-muted-foreground">
              选择一个本地文件夹作为工作区，不再手动输入路径。
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        {hint ? (
          <div className="border-b bg-amber-50 px-4 py-3 text-xs text-amber-800">{hint}</div>
        ) : null}

        <div className="border-b px-4 py-3">
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-foreground">
            {currentPath}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!parentPath || loading}
              onClick={() => parentPath && onNavigate(parentPath)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
              <span>上一级</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => onNavigate(currentPath)}
            >
              <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </Button>
            <input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="过滤文件夹"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="输入新文件夹名称"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitCreateFolder();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !newFolderName.trim()}
              onClick={submitCreateFolder}
            >
              <FolderPlusIcon className="h-4 w-4" />
              <span>创建文件夹</span>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">正在加载目录...</div>
          ) : folders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              当前目录下没有子文件夹
            </div>
          ) : visibleFolders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">没有匹配的文件夹</div>
          ) : (
            <div className="space-y-2">
              {visibleFolders.map((folder) => (
                <div
                  key={folder.path}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onNavigate(folder.path)}
                  >
                    <FolderOpenIcon className="h-4 w-4 shrink-0 text-blue-500" />
                    <span className="truncate text-sm">{folder.name}</span>
                  </button>
                  <Button type="button" size="sm" onClick={() => onSelect(folder.path)}>
                    选择
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectButton({
  project,
  active,
  running,
  onClick,
  onOpen,
  onRename,
  onDelete,
}: {
  project: ClaudeProjectSummary;
  active: boolean;
  running: boolean;
  onClick: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className={`w-full rounded-md border px-3 py-2 pr-9 text-left text-xs ${
          active ? 'border-primary/50 bg-primary/8' : 'bg-background hover:bg-muted/40'
        }`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-medium">
            {running ? (
              <span role="img" aria-label={`工作区运行中: ${project.name}`} className="shrink-0">
                <RefreshCwIcon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              </span>
            ) : null}
            <FolderIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{project.name}</span>
          </div>
          <span className="shrink-0 text-muted-foreground">{project.sessionCount}</span>
        </div>
        <div className="mt-1 truncate text-muted-foreground">{project.projectPath}</div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1 h-7 w-7 p-0"
        title="更多操作"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </Button>
      {menuOpen ? (
        <div className="absolute right-1 top-9 z-20 w-36 rounded-md border bg-background p-1 text-xs shadow-md">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => {
              setMenuOpen(false);
              onOpen();
            }}
          >
            <FolderOpenIcon className="h-3.5 w-3.5" />
            打开文件夹
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => {
              setMenuOpen(false);
              onRename();
            }}
          >
            <PencilIcon className="h-3.5 w-3.5" />
            重命名
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            从列表移除
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SessionButton({
  session,
  active,
  running,
  onClick,
  onRename,
  onDelete,
}: {
  session: ClaudeSessionSummary;
  active: boolean;
  running: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = session.title || session.sessionId.slice(0, 8);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        className={`min-w-0 w-full overflow-hidden rounded-md border px-3 py-2 pr-9 text-left text-xs ${
          active ? 'border-primary/50 bg-primary/8' : 'bg-background hover:bg-muted/40'
        }`}
        onClick={onClick}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 font-medium">
            {running ? (
              <span role="img" aria-label={`会话运行中: ${label}`} className="shrink-0">
                <RefreshCwIcon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              </span>
            ) : null}
            <MessageSquareIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="block min-w-0 truncate">{label}</span>
          </div>
          <span className="shrink-0 text-muted-foreground">
            {session.messageCount === null ? '-' : `${session.messageCount} 条`}
          </span>
        </div>
        <div className="mt-1 truncate text-muted-foreground">{formatTime(session.updatedAt)}</div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1 h-7 w-7 p-0"
        title="更多操作"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </Button>
      {menuOpen ? (
        <div className="absolute right-1 top-9 z-20 w-32 rounded-md border bg-background p-1 text-xs shadow-md">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => {
              setMenuOpen(false);
              onRename();
            }}
          >
            <PencilIcon className="h-3.5 w-3.5" />
            重命名
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FileTreeToolbar({
  activeDirPath,
  searchQuery,
  hiddenEntriesCount,
  hiddenEntriesCollapsed,
  loading,
  onNavigateToPath,
  onSearchQueryChange,
  onToggleHiddenEntries,
  onNewFile,
  onNewFolder,
  onRefresh,
}: {
  activeDirPath: string | null;
  searchQuery: string;
  hiddenEntriesCount: number;
  hiddenEntriesCollapsed: boolean;
  loading: boolean;
  onNavigateToPath: (path: string | null) => void;
  onSearchQueryChange: (query: string) => void;
  onToggleHiddenEntries: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
}) {
  const breadcrumbs = getFileBreadcrumbs(activeDirPath);
  const parentDirPath = activeDirPath ? getFileParentPath(activeDirPath) || null : null;
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(searchQuery));
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchQuery) {
      setIsSearchOpen(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsSearchOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isSearchOpen]);

  return (
    <div ref={toolbarRef} className="border-b pb-2">
      <div className="flex min-h-8 items-center gap-3">
        <div className="relative h-8 min-w-0 flex-1">
          <div
            className={`flex h-8 min-w-0 items-center gap-1 overflow-hidden text-sm font-semibold ${
              isSearchOpen ? 'opacity-0 pointer-events-none' : ''
            }`}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              title="返回上一级目录"
              aria-label="返回上一级目录"
              disabled={!activeDirPath}
              onClick={() => onNavigateToPath(parentDirPath)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            {breadcrumbs.map((breadcrumb, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <div
                  key={breadcrumb.path ?? '__root__'}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 ? <span className="shrink-0 text-muted-foreground">/</span> : null}
                  {isCurrent ? (
                    <span
                      className="max-w-32 truncate rounded-sm text-left text-foreground"
                      aria-current="page"
                      title={breadcrumb.label}
                    >
                      {breadcrumb.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="max-w-32 truncate rounded-sm text-left text-muted-foreground hover:text-foreground"
                      title={`跳转到 ${breadcrumb.label}`}
                      onClick={() => onNavigateToPath(breadcrumb.path)}
                    >
                      {breadcrumb.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {isSearchOpen ? (
            <div className="absolute inset-0 z-10 flex items-center">
              <SearchIcon className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none focus:border-primary/50"
                value={searchQuery}
                placeholder="搜索文件和文件夹..."
                onChange={(event) => onSearchQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    onSearchQueryChange('');
                    setIsSearchOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onSearchQueryChange('');
                  setIsSearchOpen(false);
                }}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="搜索文件和文件夹"
            aria-label="搜索文件和文件夹"
            onClick={() => setIsSearchOpen(true)}
          >
            <SearchIcon className="h-3.5 w-3.5" />
          </Button>
          {hiddenEntriesCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={
                hiddenEntriesCollapsed
                  ? `显示隐藏项（当前隐藏 ${hiddenEntriesCount} 项）`
                  : `隐藏隐藏项（当前目录包含 ${hiddenEntriesCount} 项）`
              }
              aria-label={hiddenEntriesCollapsed ? '显示隐藏项' : '隐藏隐藏项'}
              onClick={onToggleHiddenEntries}
            >
              {hiddenEntriesCollapsed ? (
                <EyeIcon className="h-4 w-4" />
              ) : (
                <EyeOffIcon className="h-4 w-4" />
              )}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="新建文件"
            onClick={onNewFile}
          >
            <FileTextIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="新建文件夹"
            onClick={onNewFolder}
          >
            <FolderPlusIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="刷新"
            onClick={onRefresh}
          >
            <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileTreeColumns({
  sort,
  onSortChange,
}: {
  sort: FileSortConfig;
  onSortChange: (key: FileSortKey) => void;
}) {
  const columns: Array<{ key: FileSortKey; label: string; className: string }> = [
    { key: 'name', label: '名称', className: 'min-w-0' },
    { key: 'size', label: '大小', className: 'w-24 justify-end text-right' },
    { key: 'modifiedAt', label: '修改', className: 'w-24 justify-end text-right' },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2 border-b px-1 py-1.5 text-xs font-medium text-muted-foreground">
      {columns.map((column) => (
        <button
          key={column.key}
          type="button"
          className={`${column.className} flex items-center gap-1 text-left hover:text-foreground`}
          onClick={() => onSortChange(column.key)}
        >
          <span className="truncate">{column.label}</span>
          <ArrowUpDownIcon
            className={`h-3 w-3 ${sort.key === column.key ? 'text-foreground' : ''}`}
          />
        </button>
      ))}
    </div>
  );
}

const FileRow = memo(function FileRow({
  file,
  renamingPath,
  renameValue,
  onRenameValueChange,
  onConfirmRename,
  onCancelRename,
  onOpen,
  onContextMenu,
}: {
  file: FileTreeEntry;
  renamingPath: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onOpen: (file: FileTreeEntry) => void;
  onContextMenu: (file: FileTreeEntry, event: React.MouseEvent) => void;
}) {
  const isDirectory = file.type === 'directory';
  const isRenaming = renamingPath === file.path;

  return (
    <div className="select-none [content-visibility:auto] [contain-intrinsic-size:28px]">
      <div
        data-file-path={file.path}
        className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2 rounded-sm py-1 pr-2 text-xs hover:bg-muted/50"
        onClick={() => onOpen(file)}
        onContextMenu={(event) => onContextMenu(file, event)}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {isDirectory ? (
            <FolderIcon className="h-4 w-4 shrink-0 text-blue-500" />
          ) : (
            <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {isRenaming ? (
            <input
              className="h-6 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none"
              value={renameValue}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onConfirmRename();
                }
                if (event.key === 'Escape') {
                  onCancelRename();
                }
              }}
              onBlur={onConfirmRename}
            />
          ) : (
            <span className={`truncate ${isDirectory ? 'font-medium' : ''}`}>{file.name}</span>
          )}
        </div>
        <div
          data-testid="file-size-cell"
          className="truncate text-right tabular-nums text-muted-foreground"
        >
          {file.type === 'file' ? formatFileSize(file.size) : '-'}
        </div>
        <div
          data-testid="file-modified-cell"
          className="truncate text-right tabular-nums text-muted-foreground"
        >
          {formatRelativeTime(file.modifiedAt) || '-'}
        </div>
      </div>
    </div>
  );
});

function FileContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onDownload,
  onOpenSourceCode,
  onOpenInExplorer,
}: {
  state: FileContextMenuState | null;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (file: FileTreeEntry) => void;
  onDelete: (file: FileTreeEntry) => void;
  onCopyPath: (file: FileTreeEntry) => void;
  onDownload: (file: FileTreeEntry) => void;
  onOpenSourceCode: (file: FileTreeEntry) => void;
  onOpenInExplorer: (file: FileTreeEntry) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<FileContextMenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!state || !menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const nextPosition = clampFileContextMenuPosition(state.x, state.y, rect.width, rect.height);
    setPosition((current) =>
      current && current.left === nextPosition.left && current.top === nextPosition.top
        ? current
        : nextPosition
    );
  }, [state]);

  useEffect(() => {
    if (!state) {
      setPosition(null);
    }
  }, [state]);

  if (!state) {
    return null;
  }
  const file = state.file;
  const parentPath =
    file?.type === 'directory' ? file.path : file ? getFileParentPath(file.path) : '';
  const actions = [
    { label: '新建文件', icon: FileTextIcon, onClick: () => onNewFile(parentPath) },
    { label: '新建文件夹', icon: FolderPlusIcon, onClick: () => onNewFolder(parentPath) },
    ...(file
      ? [
          { label: '重命名', icon: PencilIcon, onClick: () => onRename(file) },
          { label: '删除', icon: Trash2Icon, danger: true, onClick: () => onDelete(file) },
          { label: '复制路径', icon: CopyIcon, onClick: () => onCopyPath(file) },
          { label: '下载', icon: DownloadIcon, onClick: () => onDownload(file) },
          ...(isHtmlFile(file)
            ? [
                {
                  label: '打开源代码',
                  icon: FileTextIcon,
                  onClick: () => onOpenSourceCode(file),
                },
              ]
            : []),
          {
            label: '资源管理器打开',
            icon: ExternalLinkIcon,
            onClick: () => onOpenInExplorer(file),
          },
        ]
      : []),
  ];

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div
        ref={menuRef}
        className="fixed z-50 min-w-40 rounded-md border bg-background p-1 text-xs shadow-lg"
        style={{ left: position?.left ?? state.x, top: position?.top ?? state.y }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
              action.danger ? 'text-destructive hover:bg-destructive/10' : ''
            }`}
            onClick={() => {
              onClose();
              action.onClick();
            }}
          >
            <action.icon className="h-3.5 w-3.5" />
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function AgentWorkspacesContent({
  embedded = false,
  targetProjectPath,
  targetEntryPath,
}: {
  embedded?: boolean;
  targetProjectPath?: string;
  targetEntryPath?: string;
}) {
  const clientOptions = useMemo(
    () => ({
      baseUrl: config.api.agentV2BaseUrl,
      endpoint: config.api.agentV2Endpoint,
    }),
    []
  );
  const agentClient = useMemo(() => createAgentV2Client(clientOptions), [clientOptions]);
  const sessions = useAgentV2Sessions({
    baseUrl: config.api.agentV2BaseUrl,
    endpoint: config.api.agentV2Endpoint,
  });
  const [activeProject, setActiveProject] = useState<ClaudeProjectSummary | null>(null);
  const activeProjectSessionRuns = useAgentV2SessionRuns({
    ...clientOptions,
    projectPath: activeProject?.projectPath,
  });
  const [files, setFiles] = useState<FileTreeEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentSessionSelection, setCurrentSessionSelection] =
    useState<AgentV2SessionSelection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [preferredProjectPath, setPreferredProjectPath] = useState<string | null>(null);
  const [activeDirPath, setActiveDirPath] = useState<string | null>(null);
  const [activeDetailPane, setActiveDetailPane] = useState<WorkspaceDetailPane>(
    targetEntryPath ? 'files' : 'sessions'
  );
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [fileSort, setFileSort] = useState<FileSortConfig>({ key: 'name', direction: 'asc' });
  const [renamingFile, setRenamingFile] = useState<FileTreeEntry | null>(null);
  const [renameFileValue, setRenameFileValue] = useState('');
  const [creatingEntry, setCreatingEntry] = useState<CreatingEntryState>(null);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [pendingWorkspaceIntent, setPendingWorkspaceIntent] =
    useState<PendingWorkspaceIntent>(null);
  const [pendingWorkspaceDelete, setPendingWorkspaceDelete] =
    useState<PendingWorkspaceDelete | null>(null);
  const [isFolderBrowserOpen, setIsFolderBrowserOpen] = useState(false);
  const [folderBrowsePath, setFolderBrowsePath] = useState('~');
  const [folderBrowseParentPath, setFolderBrowseParentPath] = useState<string | null>(null);
  const [folderSuggestions, setFolderSuggestions] = useState<FolderSuggestion[]>([]);
  const [folderBrowseLoading, setFolderBrowseLoading] = useState(false);
  const [folderBrowseError, setFolderBrowseError] = useState<string | null>(null);
  const [folderBrowserHint, setFolderBrowserHint] = useState<string | null>(null);
  const [isProjectDropActive, setIsProjectDropActive] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [fileListViewportHeight, setFileListViewportHeight] = useState(0);
  const [fileListScrollTop, setFileListScrollTop] = useState(0);
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const fileListViewportRef = useRef<HTMLDivElement | null>(null);
  const fileLoadRequestIdRef = useRef(0);
  const metadataRequestIdRef = useRef(0);
  const directoryCacheRef = useRef<Map<string, CachedDirectoryEntries>>(new Map());
  const currentDirectoryDataRef = useRef<{
    projectPath: string;
    dirPath: string | null;
    mode: DirectoryCacheMode;
  } | null>(null);
  const lastAutoLocatedTargetRef = useRef<string | null>(null);
  const dismissedRouteTargetKeyRef = useRef<string | null>(null);
  const routeTargetKey = targetProjectPath ? `${targetProjectPath}::${targetEntryPath || ''}` : null;

  const buildDirectoryCacheKey = useCallback((
    projectPath: string,
    dirPath: string | null,
    mode: DirectoryCacheMode
  ) => {
    return `${projectPath}::${dirPath || '.'}::${mode}`;
  }, []);

  const applyDirectoryEntries = useCallback(
    ({
      entries,
      projectPath,
      dirPath,
      mode,
      resetSearchQuery = true,
    }: {
      entries: FileTreeEntry[];
      projectPath: string;
      dirPath: string | null;
      mode: DirectoryCacheMode;
      resetSearchQuery?: boolean;
    }) => {
      currentDirectoryDataRef.current = { projectPath, dirPath, mode };
      setFiles(entries);
      setActiveDirPath(dirPath);
      if (resetSearchQuery) {
        setFileSearchQuery('');
      }
    },
    []
  );

  const invalidateProjectDirectoryCache = useCallback((projectPath: string) => {
    const prefix = `${projectPath}::`;
    for (const key of directoryCacheRef.current.keys()) {
      if (key.startsWith(prefix)) {
        directoryCacheRef.current.delete(key);
      }
    }
  }, []);

  const shouldIncludeMetadataForCurrentDirectory = useCallback(
    (projectPath: string, dirPath: string | null) => {
      const currentDirectory = currentDirectoryDataRef.current;
      if (
        currentDirectory?.projectPath === projectPath &&
        currentDirectory.dirPath === dirPath &&
        currentDirectory.mode === 'metadata'
      ) {
        return true;
      }
      return sortRequiresMetadata(fileSort.key);
    },
    [fileSort.key]
  );

  useEffect(() => {
    void sessions.refreshProjects();
  }, [sessions.refreshProjects]);

  useEffect(() => {
    readAgentV2ProjectSelection()
      .then((selection) => {
        if (selection?.projectPath) {
          setPreferredProjectPath(selection.projectPath);
        }
      })
      .catch((error) => {
        console.debug('[agent-workspaces] failed to read selected project:', error);
      });
  }, []);

  useEffect(() => {
    readAgentV2WorkspaceIntent()
      .then((intent) => {
        setPendingWorkspaceIntent(intent);
      })
      .catch((error) => {
        console.debug('[agent-workspaces] failed to read workspace intent:', error);
      });
  }, []);

  useEffect(() => {
    if (activeProject || sessions.projects.length === 0) {
      return;
    }
    const preferredProject = preferredProjectPath
      ? sessions.projects.find((project) => project.projectPath === preferredProjectPath)
      : null;
    if (preferredProject) {
      setActiveProject(preferredProject);
      return;
    }
    if (!pendingWorkspaceIntent) {
      setActiveProject(sessions.projects[0]);
    }
  }, [activeProject, pendingWorkspaceIntent, preferredProjectPath, sessions.projects]);

  useEffect(() => {
    if (dismissedRouteTargetKeyRef.current && dismissedRouteTargetKeyRef.current !== routeTargetKey) {
      dismissedRouteTargetKeyRef.current = null;
    }
  }, [routeTargetKey]);

  useEffect(() => {
    lastAutoLocatedTargetRef.current = null;
  }, [routeTargetKey]);

  useEffect(() => {
    if (!targetProjectPath || sessions.projects.length === 0) {
      return;
    }
    if (dismissedRouteTargetKeyRef.current === routeTargetKey) {
      return;
    }
    if (activeProject?.projectPath === targetProjectPath) {
      return;
    }
    const targetProject = sessions.projects.find(
      (project) => project.projectPath === targetProjectPath
    );
    if (!targetProject) {
      return;
    }
    setPreferredProjectPath(targetProject.projectPath);
    setActiveProject(targetProject);
  }, [activeProject?.projectPath, routeTargetKey, sessions.projects, targetProjectPath]);

  const loadFiles = useCallback(
    async (
      dirPath: string | null = null,
      options: {
        project?: ClaudeProjectSummary | null;
        signal?: AbortSignal;
        force?: boolean;
        includeMetadata?: boolean;
      } = {}
    ) => {
      const project = options.project ?? activeProject;
      const requestId = ++fileLoadRequestIdRef.current;
      if (!project) {
        currentDirectoryDataRef.current = null;
        setFiles([]);
        setIsFileLoading(false);
        return;
      }
      const mode = options.includeMetadata ? 'metadata' : 'lightweight';
      const cacheKey = buildDirectoryCacheKey(project.projectPath, dirPath, mode);
      const cached = directoryCacheRef.current.get(cacheKey);
      if (!options.force && cached && Date.now() - cached.cachedAt < DIRECTORY_CACHE_TTL_MS) {
        applyDirectoryEntries({
          entries: cached.entries,
          projectPath: project.projectPath,
          dirPath,
          mode,
        });
        setFileError(null);
        setIsFileLoading(false);
        return;
      }
      setFileError(null);
      setIsFileLoading(true);
      try {
        const entries = await agentClient.listFiles({
          projectPath: project.projectPath,
          dirPath: dirPath || undefined,
          maxDepth: 0,
          includeMetadata: options.includeMetadata ?? false,
          signal: options.signal,
        });
        if (fileLoadRequestIdRef.current !== requestId) {
          return;
        }
        directoryCacheRef.current.set(cacheKey, { entries, cachedAt: Date.now() });
        applyDirectoryEntries({
          entries,
          projectPath: project.projectPath,
          dirPath,
          mode,
        });
      } catch (error) {
        if (options.signal?.aborted || fileLoadRequestIdRef.current !== requestId) {
          return;
        }
        setFileError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!options.signal?.aborted && fileLoadRequestIdRef.current === requestId) {
          setIsFileLoading(false);
        }
      }
    },
    [activeProject, agentClient, applyDirectoryEntries, buildDirectoryCacheKey]
  );

  const ensureDirectoryMetadata = useCallback(
    async (
      dirPath: string | null = null,
      options: {
        project?: ClaudeProjectSummary | null;
        signal?: AbortSignal;
        force?: boolean;
        includeMetadata?: boolean;
      } = {}
    ) => {
      const project = options.project ?? activeProject;
      if (!project) {
        return;
      }
      const cacheKey = buildDirectoryCacheKey(project.projectPath, dirPath, 'metadata');
      const cached = directoryCacheRef.current.get(cacheKey);
      if (!options.force && cached && Date.now() - cached.cachedAt < DIRECTORY_CACHE_TTL_MS) {
        const currentDirectory = currentDirectoryDataRef.current;
        if (
          currentDirectory?.projectPath === project.projectPath &&
          currentDirectory.dirPath === dirPath &&
          currentDirectory.mode !== 'metadata'
        ) {
          applyDirectoryEntries({
            entries: cached.entries,
            projectPath: project.projectPath,
            dirPath,
            mode: 'metadata',
            resetSearchQuery: false,
          });
        }
        return;
      }
      const requestId = ++metadataRequestIdRef.current;
      try {
        const entries = await agentClient.listFiles({
          projectPath: project.projectPath,
          dirPath: dirPath || undefined,
          maxDepth: 0,
          includeMetadata: true,
          signal: options.signal,
        });
        directoryCacheRef.current.set(cacheKey, { entries, cachedAt: Date.now() });
        if (options.signal?.aborted || metadataRequestIdRef.current !== requestId) {
          return;
        }
        const currentDirectory = currentDirectoryDataRef.current;
        if (
          currentDirectory?.projectPath === project.projectPath &&
          currentDirectory.dirPath === dirPath
        ) {
          applyDirectoryEntries({
            entries,
            projectPath: project.projectPath,
            dirPath,
            mode: 'metadata',
            resetSearchQuery: false,
          });
        }
      } catch (error) {
        if (options.signal?.aborted || metadataRequestIdRef.current !== requestId) {
          return;
        }
        console.debug('[agent-workspaces] failed to upgrade directory metadata:', error);
      }
    },
    [activeProject, agentClient, applyDirectoryEntries, buildDirectoryCacheKey, fileSort.key]
  );

  const reloadCurrentDirectory = useCallback(
    async (
      options: {
        project?: ClaudeProjectSummary | null;
        signal?: AbortSignal;
        force?: boolean;
      } = {}
    ) => {
      const project = options.project ?? activeProject;
      if (!project) {
        return;
      }
      await loadFiles(activeDirPath, {
        ...options,
        project,
        includeMetadata: shouldIncludeMetadataForCurrentDirectory(project.projectPath, activeDirPath),
      });
    },
    [activeDirPath, activeProject, loadFiles, shouldIncludeMetadataForCurrentDirectory]
  );

  const browseWorkspaceFolders = useCallback(
    async (path = '~') => {
      setFolderBrowseLoading(true);
      setFolderBrowseError(null);
      try {
        const result = await agentClient.browseWorkspaceFolders(path);
        setFolderBrowsePath(result.path);
        setFolderBrowseParentPath(result.parentPath);
        setFolderSuggestions(result.folders);
      } catch (error) {
        setFolderBrowseError(formatWorkspaceBrowseError(error));
      } finally {
        setFolderBrowseLoading(false);
      }
    },
    [agentClient]
  );

  const openFolderBrowser = useCallback(
    (input?: { path?: string; hint?: string | null }) => {
      setFolderBrowserHint(input?.hint || null);
      setIsFolderBrowserOpen(true);
      void browseWorkspaceFolders(input?.path || folderBrowsePath || '~');
    },
    [browseWorkspaceFolders, folderBrowsePath]
  );

  const closeFolderBrowser = useCallback(() => {
    setIsFolderBrowserOpen(false);
    setFolderBrowserHint(null);
    setFolderBrowseError(null);
  }, []);

  const createFolderInBrowser = useCallback(
    async (name: string) => {
      setFolderBrowseError(null);
      setFolderBrowseLoading(true);
      try {
        await agentClient.createWorkspaceFolder({
          parentPath: folderBrowsePath,
          name,
        });
        await browseWorkspaceFolders(folderBrowsePath);
      } catch (error) {
        setFolderBrowseError(formatWorkspaceBrowseError(error));
      } finally {
        setFolderBrowseLoading(false);
      }
    },
    [agentClient, browseWorkspaceFolders, folderBrowsePath]
  );

  async function attemptWorkspaceFolderPick() {
    setWorkspaceError(null);
    try {
      const result = await agentClient.pickWorkspaceFolder();
      if (result.projectPath) {
        await addWorkspaceFromPath(result.projectPath);
      }
    } catch (error) {
      if (shouldFallbackToFolderBrowser(error)) {
        openFolderBrowser();
        return;
      }
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  const startNewSessionForProject = useCallback(async (projectPath: string) => {
    setActiveSessionId(null);
    await chrome.storage.local.remove(AGENT_V2_SESSION_SELECTION_STORAGE_KEY);
    await publishAgentV2ProjectSelection({ projectPath, kind: 'new_session' });
    await clearAgentV2WorkspaceIntent();
    setPendingWorkspaceIntent(null);
  }, []);

  const selectProject = useCallback(
    (project: ClaudeProjectSummary) => {
      if (
        routeTargetKey &&
        targetProjectPath &&
        !sameProjectPath(project.projectPath, targetProjectPath)
      ) {
        dismissedRouteTargetKeyRef.current = routeTargetKey;
      }
      const isSameProject = project.projectPath === activeProject?.projectPath;
      setPreferredProjectPath(project.projectPath);
      void publishAgentV2ProjectSelection({ projectPath: project.projectPath });

      if (isSameProject) {
        void sessions.refresh({ projectPath: project.projectPath });
        void reloadCurrentDirectory({ project });
        if (pendingWorkspaceIntent?.kind === 'new_session') {
          void startNewSessionForProject(project.projectPath);
        }
        return;
      }

      setActiveProject(project);
      setActiveSessionId(null);
      if (pendingWorkspaceIntent?.kind === 'new_session') {
        void startNewSessionForProject(project.projectPath);
      }
    },
    [
      activeDirPath,
      activeProject?.projectPath,
      pendingWorkspaceIntent?.kind,
      reloadCurrentDirectory,
      routeTargetKey,
      sessions.refresh,
      startNewSessionForProject,
      targetProjectPath,
    ]
  );

  useEffect(() => {
    if (activeProject) {
      const controller = new AbortController();
      const initialTargetDirPath =
        targetProjectPath && activeProject.projectPath === targetProjectPath
          ? normalizeTargetDirectoryPath(targetEntryPath)
          : null;
      setActiveSessionId(null);
      void sessions.refresh({
        projectPath: activeProject.projectPath,
        signal: controller.signal,
      });
      void loadFiles(initialTargetDirPath, {
        project: activeProject,
        signal: controller.signal,
      });
      return () => controller.abort();
    }
  }, [activeProject, loadFiles, sessions.refresh, targetEntryPath, targetProjectPath]);

  useEffect(() => {
    if (!activeProject || !targetProjectPath || activeProject.projectPath !== targetProjectPath) {
      return;
    }
    const targetDirPath = normalizeTargetDirectoryPath(targetEntryPath);
    if (!targetDirPath) {
      return;
    }
    setActiveDetailPane('files');
    const targetKey = `${targetProjectPath}::${targetDirPath}`;
    if (lastAutoLocatedTargetRef.current === targetKey) {
      return;
    }
    lastAutoLocatedTargetRef.current = targetKey;
    void loadFiles(targetDirPath, { project: activeProject });
  }, [activeProject, loadFiles, routeTargetKey, targetEntryPath, targetProjectPath]);

  const applyCurrentSessionSelection = useCallback(
    (selection: AgentV2SessionSelection | null) => {
      if (!activeProject) {
        return;
      }
      if (
        selection?.projectPath &&
        !sameProjectPath(selection.projectPath, activeProject.projectPath)
      ) {
        return;
      }
      setActiveSessionId(selection?.sessionId || null);
    },
    [activeProject]
  );

  const syncCurrentSessionSelection = useCallback(
    async (selection: AgentV2SessionSelection | null) => {
      setCurrentSessionSelection(selection);
      if (!activeProject) {
        return;
      }
      if (
        selection?.projectPath &&
        !sameProjectPath(selection.projectPath, activeProject.projectPath)
      ) {
        return;
      }
      applyCurrentSessionSelection(selection);
      if (!selection?.sessionId) {
        return;
      }
      if (sessions.sessions.some((session) => session.sessionId === selection.sessionId)) {
        return;
      }
      await sessions.refresh({ projectPath: activeProject.projectPath });
    },
    [activeProject, applyCurrentSessionSelection, sessions.refresh, sessions.sessions]
  );

  const displayedSessions = useMemo(() => {
    if (!activeProject || !currentSessionSelection?.sessionId) {
      return sessions.sessions;
    }
    const selectionProjectPath = currentSessionSelection.projectPath || activeProject.projectPath;
    if (!sameProjectPath(selectionProjectPath, activeProject.projectPath)) {
      return sessions.sessions;
    }
    if (
      sessions.sessions.some((session) => session.sessionId === currentSessionSelection.sessionId)
    ) {
      return sessions.sessions;
    }
    const optimisticSession: ClaudeSessionSummary = {
      sessionId: currentSessionSelection.sessionId,
      projectPath: activeProject.projectPath,
      filePath: '',
      messageCount: null,
      updatedAt: currentSessionSelection.selectedAt,
      title: sanitizeSessionTitle(currentSessionSelection.title),
    };
    return [optimisticSession, ...sessions.sessions];
  }, [activeProject, currentSessionSelection, sessions.sessions]);

  const activeRunningSessionIds = useMemo(() => {
    return new Set(
      (activeProjectSessionRuns.data?.sessions || [])
        .filter(isActiveSessionRun)
        .map((session) => session.sessionId)
    );
  }, [activeProjectSessionRuns.data?.sessions]);
  const activeProjectRunning = activeRunningSessionIds.size > 0;

  useEffect(() => {
    if (!activeProject) {
      return;
    }
    readAgentV2CurrentSession()
      .then(syncCurrentSessionSelection)
      .catch((error) => {
        console.debug('[agent-workspaces] failed to read current Agent V2 session:', error);
      });
  }, [activeProject, syncCurrentSessionSelection]);

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      const change = changes[AGENT_V2_CURRENT_SESSION_STORAGE_KEY];
      if (!change) {
        return;
      }
      const nextSelection =
        typeof change.newValue === 'object' && change.newValue !== null
          ? (change.newValue as AgentV2SessionSelection)
          : null;
      void syncCurrentSessionSelection(nextSelection);
    };

    chrome.storage.onChanged?.addListener(handleStorageChange);
    return () => chrome.storage.onChanged?.removeListener(handleStorageChange);
  }, [syncCurrentSessionSelection]);

  const refreshWorkspaceData = useCallback(
    async (projectPath?: string) => {
      await sessions.refreshProjects({ forceRefresh: true });
      if (projectPath) {
        await sessions.refresh({ projectPath });
      }
    },
    [sessions.refresh, sessions.refreshProjects]
  );

  const addWorkspaceFromPath = useCallback(
    async (projectPath: string) => {
      const normalizedProjectPath = projectPath.trim();
      if (!normalizedProjectPath) {
        return;
      }
      setWorkspaceError(null);
      try {
        await agentClient.addWorkspace({ projectPath: normalizedProjectPath });
        closeFolderBrowser();
        setActiveProject(null);
        setPreferredProjectPath(normalizedProjectPath);
        await refreshWorkspaceData(normalizedProjectPath);
        if (pendingWorkspaceIntent?.kind === 'new_session') {
          await startNewSessionForProject(normalizedProjectPath);
        } else {
          await publishAgentV2ProjectSelection({ projectPath: normalizedProjectPath });
        }
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      agentClient,
      closeFolderBrowser,
      pendingWorkspaceIntent?.kind,
      refreshWorkspaceData,
      startNewSessionForProject,
    ]
  );

  const addWorkspace = async () => {
    await attemptWorkspaceFolderPick();
  };

  const selectFolderAsWorkspace = async (projectPath: string) => {
    setWorkspaceError(null);
    await addWorkspaceFromPath(projectPath);
  };

  const renameWorkspace = async (project: ClaudeProjectSummary) => {
    const name = window.prompt('新的工作区名称', project.name);
    if (!name?.trim()) {
      return;
    }
    setWorkspaceError(null);
    try {
      await agentClient.renameWorkspace({ projectPath: project.projectPath, name: name.trim() });
      await refreshWorkspaceData(project.projectPath);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteWorkspace = (project: ClaudeProjectSummary) => {
    setPendingWorkspaceDelete({ project, deleteDirectory: false });
  };

  const confirmDeleteWorkspace = useCallback(async () => {
    const pendingDelete = pendingWorkspaceDelete;
    if (!pendingDelete) {
      return;
    }
    setWorkspaceError(null);
    setIsDeletingWorkspace(true);
    try {
      await agentClient.deleteWorkspace({
        projectPath: pendingDelete.project.projectPath,
        deleteDirectory: pendingDelete.deleteDirectory,
      });
      if (activeProject?.projectPath === pendingDelete.project.projectPath) {
        setActiveProject(null);
      }
      setPendingWorkspaceDelete(null);
      await sessions.refreshProjects({ forceRefresh: true });
      toast.success(
        pendingDelete.deleteDirectory ? '工作区及系统文件夹已删除' : '工作区已从列表移除'
      );
    } catch (error) {
      const localizedError = localizeUserFacingError(error, '移除工作区失败');
      setWorkspaceError(localizedError);
      toast.error(localizedError);
    } finally {
      setIsDeletingWorkspace(false);
    }
  }, [activeProject?.projectPath, agentClient, pendingWorkspaceDelete, sessions]);

  const openWorkspace = async (project: ClaudeProjectSummary) => {
    setWorkspaceError(null);
    try {
      await agentClient.openWorkspace(project.projectPath);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const startCreateEntry = (parentPath: string, type: 'file' | 'directory') => {
    setActiveDetailPane('files');
    setCreatingEntry({
      parentPath,
      type,
      name: type === 'file' ? 'untitled.txt' : 'new-folder',
    });
  };

  const confirmCreateEntry = async () => {
    if (!activeProject || !creatingEntry) {
      return;
    }
    const error = validateFileName(creatingEntry.name);
    if (error) {
      setFileError(error);
      return;
    }
    setFileError(null);
    try {
      await agentClient.createFileEntry({
        projectPath: activeProject.projectPath,
        parentPath: creatingEntry.parentPath || activeDirPath || '',
        type: creatingEntry.type,
        name: creatingEntry.name.trim(),
      });
      setCreatingEntry(null);
      invalidateProjectDirectoryCache(activeProject.projectPath);
      await reloadCurrentDirectory({ force: true });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const startRenameFile = (file: FileTreeEntry) => {
    setRenamingFile(file);
    setRenameFileValue(file.name);
  };

  const confirmRenameFile = async () => {
    if (!activeProject || !renamingFile) {
      return;
    }
    const nextName = renameFileValue.trim();
    if (nextName === renamingFile.name) {
      setRenamingFile(null);
      return;
    }
    const error = validateFileName(nextName);
    if (error) {
      setFileError(error);
      return;
    }
    setFileError(null);
    try {
      await agentClient.renameFileEntry({
        projectPath: activeProject.projectPath,
        entryPath: renamingFile.path,
        newName: nextName,
      });
      setRenamingFile(null);
      invalidateProjectDirectoryCache(activeProject.projectPath);
      await reloadCurrentDirectory({ force: true });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteFile = async (file: FileTreeEntry) => {
    if (!activeProject) {
      return;
    }
    if (!window.confirm(`删除“${file.name}”？这个操作会删除磁盘上的文件或文件夹。`)) {
      return;
    }
    setFileError(null);
    try {
      await agentClient.deleteFileEntry({
        projectPath: activeProject.projectPath,
        entryPath: file.path,
      });
      invalidateProjectDirectoryCache(activeProject.projectPath);
      await reloadCurrentDirectory({ force: true });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const copyFilePath = async (file: FileTreeEntry) => {
    await navigator.clipboard.writeText(file.path).catch(() => null);
  };

  const downloadFile = async (file: FileTreeEntry) => {
    if (!activeProject || file.type !== 'file') {
      return;
    }
    try {
      const content = await agentClient.readFile({
        projectPath: activeProject.projectPath,
        filePath: file.path,
      });
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const openFileInExplorer = async (file: FileTreeEntry) => {
    if (!activeProject) {
      return;
    }
    try {
      await agentClient.openFileEntry({
        projectPath: activeProject.projectPath,
        entryPath: file.type === 'directory' ? file.path : getFileParentPath(file.path),
      });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const openSourceCode = async (file: FileTreeEntry) => {
    if (!activeProject || file.type !== 'file') {
      return;
    }

    const url = buildSidepanelFilePreviewUrl({
      projectPath: activeProject.projectPath,
      filePath: file.path,
    });
    chrome.tabs.create({ url, active: true }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  };

  const renameSession = async (session: ClaudeSessionSummary) => {
    const projectPath = session.projectPath || activeProject?.projectPath;
    if (!projectPath) {
      return;
    }
    const title = window.prompt('新的会话名称', session.title || session.sessionId.slice(0, 8));
    if (!title?.trim()) {
      return;
    }
    setWorkspaceError(null);
    try {
      await agentClient.renameSession({
        projectPath,
        sessionId: session.sessionId,
        title: title.trim(),
      });
      await sessions.refresh({ projectPath });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteSession = async (session: ClaudeSessionSummary) => {
    const projectPath = session.projectPath || activeProject?.projectPath;
    if (!projectPath) {
      return;
    }
    const label = session.title || session.sessionId.slice(0, 8);
    if (!window.confirm(`删除会话“${label}”？这里只会从列表隐藏，不会删除原始历史文件。`)) {
      return;
    }
    setWorkspaceError(null);
    try {
      const currentSessionSelection = await readAgentV2CurrentSession().catch(() => null);
      const isCurrentSession =
        activeSessionId === session.sessionId ||
        currentSessionSelection?.sessionId === session.sessionId;
      await agentClient.deleteSession({ projectPath, sessionId: session.sessionId });
      if (isCurrentSession) {
        setActiveSessionId(null);
        await chrome.storage.local.remove(AGENT_V2_SESSION_SELECTION_STORAGE_KEY);
        await publishAgentV2ProjectSelection({ projectPath, kind: 'new_session' });
      }
      await sessions.refresh({ projectPath });
      await sessions.refreshProjects({ forceRefresh: true });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const openEntry = async (file: FileTreeEntry) => {
    if (!activeProject) {
      return;
    }
    setActiveDetailPane('files');
    if (file.type === 'directory') {
      await loadFiles(file.path);
      return;
    }

    if (isHtmlFile(file)) {
      const url = buildHtmlBrowserPreviewUrl({
        projectPath: activeProject.projectPath,
        filePath: file.path,
        mode: 'file',
      });
      await openHtmlBrowserPreview(url, {
        fallbackUrl: buildFileBrowserPreviewUrl({
          projectPath: activeProject.projectPath,
          filePath: file.path,
        }),
      });
      return;
    }

    await openSourceCode(file);
  };

  const openSession = async (session: ClaudeSessionSummary) => {
    setActiveDetailPane('sessions');
    setActiveSessionId(session.sessionId);
    await publishAgentV2SessionSelection({
      sessionId: session.sessionId,
      projectPath: session.projectPath || activeProject?.projectPath,
      title: session.title,
    });
    await chrome.runtime.sendMessage({ action: 'open-sidepanel' }).catch((error) => {
      console.debug('[agent-workspaces] failed to open sidepanel after session click:', error);
    });
    await clearAgentV2WorkspaceIntent();
    setPendingWorkspaceIntent(null);
  };

  const startNewSession = async () => {
    if (!activeProject) {
      return;
    }
    await startNewSessionForProject(activeProject.projectPath);
  };

  const handleProjectDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    setIsProjectDropActive(true);
  }, []);

  const handleProjectDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsProjectDropActive(true);
  }, []);

  const handleProjectDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (projectListRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    setIsProjectDropActive(false);
  }, []);

  const handleProjectDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsProjectDropActive(false);
      const droppedItem = await extractDroppedWorkspacePath(event.dataTransfer);
      if (!droppedItem) {
        setWorkspaceError('未识别到可用的本地文件或文件夹，请改用“新增”选择路径。');
        return;
      }
      if (droppedItem.projectPath) {
        await addWorkspaceFromPath(droppedItem.projectPath);
        return;
      }
      openFolderBrowser({
        hint: `检测到拖入的${droppedItem.kind === 'directory' ? '文件夹' : '文件'}“${droppedItem.label}”，请在弹窗里选择它对应的真实本地目录。`,
      });
    },
    [addWorkspaceFromPath, openFolderBrowser]
  );

  const refresh = async () => {
    await sessions.refreshProjects({ forceRefresh: true });
    if (activeProject) {
      await sessions.refresh({ projectPath: activeProject.projectPath });
      invalidateProjectDirectoryCache(activeProject.projectPath);
      await reloadCurrentDirectory({ force: true });
    }
  };

  const hiddenEntriesCount = useMemo(
    () => files.filter((file) => isHiddenFileEntry(file)).length,
    [files]
  );

  const shouldAutoCollapseHiddenEntries = useMemo(() => {
    if (activeDirPath) {
      return false;
    }
    if (hiddenEntriesCount === 0) {
      return false;
    }
    return files.length >= 120 && hiddenEntriesCount > files.length / 2;
  }, [activeDirPath, files.length, hiddenEntriesCount]);

  const hiddenEntriesCollapsed = shouldAutoCollapseHiddenEntries && !showHiddenEntries;

  useEffect(() => {
    if (activeSessionId && !targetEntryPath) {
      setActiveDetailPane('sessions');
    }
  }, [activeSessionId, targetEntryPath]);

  const displayedFiles = useMemo(() => {
    const visibleFiles = hiddenEntriesCollapsed
      ? files.filter((file) => !isHiddenFileEntry(file))
      : files;
    return sortFiles(filterFiles(visibleFiles, fileSearchQuery), fileSort);
  }, [fileSearchQuery, fileSort, files, hiddenEntriesCollapsed]);

  useEffect(() => {
    if (!activeProject) {
      return;
    }
    const currentDirectory = currentDirectoryDataRef.current;
    if (
      !currentDirectory ||
      currentDirectory.projectPath !== activeProject.projectPath ||
      currentDirectory.dirPath !== activeDirPath ||
      currentDirectory.mode === 'metadata'
    ) {
      return;
    }
    const controller = new AbortController();
    void ensureDirectoryMetadata(activeDirPath, {
      project: activeProject,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [activeDirPath, activeProject, ensureDirectoryMetadata, files]);

  useEffect(() => {
    setShowHiddenEntries(false);
  }, [activeProject?.projectPath, activeDirPath]);

  useLayoutEffect(() => {
    const viewport = fileListViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportHeight = () => {
      setFileListViewportHeight(viewport.clientHeight);
    };

    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = fileListViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = 0;
    setFileListScrollTop(0);
  }, [activeProject?.projectPath, activeDirPath, fileSearchQuery, hiddenEntriesCollapsed]);

  const { virtualizedFiles, virtualTopSpacerHeight, virtualBottomSpacerHeight } = useMemo(() => {
    if (displayedFiles.length === 0) {
      return {
        virtualizedFiles: displayedFiles,
        virtualTopSpacerHeight: 0,
        virtualBottomSpacerHeight: 0,
      };
    }

    const viewportHeight = Math.max(fileListViewportHeight, FILE_ROW_HEIGHT_PX * 8);
    const startIndex = Math.max(
      0,
      Math.floor(fileListScrollTop / FILE_ROW_HEIGHT_PX) - FILE_LIST_OVERSCAN
    );
    const visibleCount = Math.ceil(viewportHeight / FILE_ROW_HEIGHT_PX) + FILE_LIST_OVERSCAN * 2;
    const endIndex = Math.min(displayedFiles.length, startIndex + visibleCount);

    return {
      virtualizedFiles: displayedFiles.slice(startIndex, endIndex),
      virtualTopSpacerHeight: startIndex * FILE_ROW_HEIGHT_PX,
      virtualBottomSpacerHeight: Math.max(
        0,
        (displayedFiles.length - endIndex) * FILE_ROW_HEIGHT_PX
      ),
    };
  }, [displayedFiles, fileListScrollTop, fileListViewportHeight]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {embedded ? null : (
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold">工作区管理</h1>
              <div className="mt-1 text-xs text-muted-foreground">
                管理 Claude 本地项目、会话和文件
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCwIcon
                  className={`h-4 w-4 ${sessions.status === 'loading' ? 'animate-spin' : ''}`}
                />
                <span>刷新</span>
              </Button>
            </div>
          </div>
          {pendingWorkspaceIntent?.kind === 'new_session' ? (
            <div className="mt-3 rounded-md border border-blue-300/60 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              当前聊天页正在等待一个工作区来创建新会话。请选择一个已有工作区，或先新增工作区。
            </div>
          ) : null}
        </div>
      )}

      {sessions.error || workspaceError ? (
        <div
          className={`${embedded ? 'mb-4' : 'mx-4 mt-3'} rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive`}
        >
          {sessions.error || workspaceError}
        </div>
      ) : null}

      {embedded && pendingWorkspaceIntent?.kind === 'new_session' ? (
        <div className="mb-4 rounded-md border border-blue-300/60 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          当前聊天页正在等待一个工作区来创建新会话。请选择一个已有工作区，或先新增工作区。
        </div>
      ) : null}

      <div
        data-testid="workspace-layout"
        className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden xl:grid-cols-[260px_280px_minmax(0,1fr)] xl:grid-rows-1"
      >
        <aside
          ref={projectListRef}
          onDragEnter={handleProjectDragEnter}
          onDragOver={handleProjectDragOver}
          onDragLeave={handleProjectDragLeave}
          onDrop={(event) => void handleProjectDrop(event)}
          className={`row-span-2 flex min-h-0 flex-col overflow-hidden border-r pr-4 xl:row-span-1 ${
            isProjectDropActive ? 'bg-blue-50/70 ring-2 ring-inset ring-blue-300' : ''
          }`}
        >
          <div className="mb-3 flex h-10 items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-semibold">工作区</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void addWorkspace()}>
                <PlusIcon className="h-4 w-4" />
              </Button>
              {embedded ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="刷新工作区列表"
                  aria-label="刷新工作区列表"
                  onClick={() => void refresh()}
                >
                  <RefreshCwIcon
                    className={`h-4 w-4 ${sessions.status === 'loading' ? 'animate-spin' : ''}`}
                  />
                </Button>
              ) : null}
            </div>
          </div>
          {isProjectDropActive ? (
            <div className="mb-3 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-4 text-center text-xs text-blue-700">
              松开鼠标，在这里用本地文件或文件夹快速创建工作区
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto pb-1">
            {sessions.projects.length > 0 ? (
              <div className="space-y-2">
                {sessions.projects.map((project) => (
                  <ProjectButton
                    key={project.projectKey}
                    project={project}
                    active={project.projectPath === activeProject?.projectPath}
                    running={
                      project.projectPath === activeProject?.projectPath && activeProjectRunning
                    }
                    onClick={() => selectProject(project)}
                    onOpen={() => void openWorkspace(project)}
                    onRename={() => void renameWorkspace(project)}
                    onDelete={() => void deleteWorkspace(project)}
                  />
                ))}
              </div>
            ) : (
              <UnifiedEmptyState
                title="还没有工作区"
                description="点击上方 + 选择本地文件夹，先创建一个工作区。"
                minHeightClassName="min-h-full"
              />
            )}
          </div>
        </aside>

        <div className="col-start-2 row-start-1 flex items-center justify-between border-b px-4 py-2 xl:hidden">
          <div className="text-sm font-semibold text-foreground">详细内容</div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={activeDetailPane === 'sessions' ? 'default' : 'outline'}
              aria-label="切换到会话记录"
              onClick={() => setActiveDetailPane('sessions')}
            >
              会话记录
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeDetailPane === 'files' ? 'default' : 'outline'}
              aria-label="切换到文件管理"
              onClick={() => setActiveDetailPane('files')}
            >
              文件管理
            </Button>
          </div>
        </div>

        <section
          className={`${activeDetailPane === 'sessions' ? 'flex' : 'hidden'} col-start-2 row-start-2 min-h-0 min-w-0 flex-col overflow-hidden px-4 xl:col-start-2 xl:row-start-1 xl:flex xl:border-r`}
        >
          <div className="mb-3">
            <div className="flex h-10 items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm font-semibold">
                {activeProject?.name || '请选择工作区'}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!activeProject}
                onClick={() => void startNewSession()}
              >
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-1">
            {displayedSessions.length > 0 ? (
              <div className="grid min-w-0 gap-2">
                {displayedSessions.map((session) => (
                  <SessionButton
                    key={session.sessionId}
                    session={session}
                    active={session.sessionId === activeSessionId}
                    running={activeRunningSessionIds.has(session.sessionId)}
                    onClick={() => void openSession(session)}
                    onRename={() => void renameSession(session)}
                    onDelete={() => void deleteSession(session)}
                  />
                ))}
              </div>
            ) : (
              <UnifiedEmptyState
                title={activeProject ? '还没有会话' : '请选择工作区'}
                description={
                  activeProject
                    ? '点击右上角 + 创建一个新会话，聊天记录会显示在这里。'
                    : '先从左侧选择一个工作区，这里就会显示对应会话。'
                }
                minHeightClassName="min-h-full"
              />
            )}
          </div>
        </section>

        <main
          className={`${activeDetailPane === 'files' ? 'block' : 'hidden'} col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden px-4 xl:col-start-3 xl:row-start-1 xl:block xl:pl-4 xl:pr-0`}
        >
          <section
            className="flex h-full min-h-0 flex-col overflow-hidden"
            onContextMenu={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                setFileContextMenu({ file: null, x: event.clientX, y: event.clientY });
              }
            }}
          >
            <FileTreeToolbar
              activeDirPath={activeDirPath}
              searchQuery={fileSearchQuery}
              hiddenEntriesCount={hiddenEntriesCount}
              hiddenEntriesCollapsed={hiddenEntriesCollapsed}
              loading={sessions.status === 'loading' || isFileLoading}
              onNavigateToPath={(path) => {
                void loadFiles(path);
              }}
              onSearchQueryChange={setFileSearchQuery}
              onToggleHiddenEntries={() => setShowHiddenEntries((current) => !current)}
              onNewFile={() => startCreateEntry(activeDirPath || '', 'file')}
              onNewFolder={() => startCreateEntry(activeDirPath || '', 'directory')}
              onRefresh={() => {
                if (!activeProject) {
                  return;
                }
                invalidateProjectDirectoryCache(activeProject.projectPath);
                void reloadCurrentDirectory({ force: true });
              }}
            />

            {fileError ? (
              <div className="my-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {fileError}
              </div>
            ) : null}

            {displayedFiles.length > 0 ? (
              <FileTreeColumns
                sort={fileSort}
                onSortChange={(nextKey) =>
                  setFileSort((current) => ({
                    key: nextKey,
                    direction:
                      current.key === nextKey
                        ? current.direction === 'asc'
                          ? 'desc'
                          : 'asc'
                        : 'asc',
                  }))
                }
              />
            ) : null}

            <div
              ref={fileListViewportRef}
              className="mt-1 min-h-0 flex-1 overflow-y-auto"
              onScroll={(event) => {
                setFileListScrollTop(event.currentTarget.scrollTop);
              }}
            >
              <div className="space-y-0.5" style={{ paddingTop: virtualTopSpacerHeight }}>
                {creatingEntry ? (
                  <div className="flex items-center gap-1.5 py-1 pr-2 text-xs">
                    {creatingEntry.type === 'directory' ? (
                      <FolderIcon className="h-4 w-4 text-blue-500" />
                    ) : (
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                    <input
                      className="h-6 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none"
                      value={creatingEntry.name}
                      autoFocus
                      onChange={(event) =>
                        setCreatingEntry({ ...creatingEntry, name: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void confirmCreateEntry();
                        }
                        if (event.key === 'Escape') {
                          setCreatingEntry(null);
                        }
                      }}
                      onBlur={() => void confirmCreateEntry()}
                    />
                  </div>
                ) : null}

                {virtualizedFiles.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    renamingPath={renamingFile?.path || null}
                    renameValue={renameFileValue}
                    onRenameValueChange={setRenameFileValue}
                    onConfirmRename={() => void confirmRenameFile()}
                    onCancelRename={() => setRenamingFile(null)}
                    onOpen={(entry) => void openEntry(entry)}
                    onContextMenu={(entry, event) => {
                      event.preventDefault();
                      setFileContextMenu({ file: entry, x: event.clientX, y: event.clientY });
                    }}
                  />
                ))}
                {virtualBottomSpacerHeight > 0 ? (
                  <div style={{ height: virtualBottomSpacerHeight }} />
                ) : null}
                {displayedFiles.length === 0 && !creatingEntry ? (
                  <UnifiedEmptyState
                    title={activeProject ? '当前没有文件' : '请选择工作区'}
                    description={
                      activeProject
                        ? '这个目录下暂时没有可展示的文件或文件夹。'
                        : '先从左侧选择一个工作区，右侧才会显示文件内容。'
                    }
                    minHeightClassName="min-h-full"
                  />
                ) : null}
              </div>
            </div>
          </section>
          <FileContextMenu
            state={fileContextMenu}
            onClose={() => setFileContextMenu(null)}
            onNewFile={(parentPath) => startCreateEntry(parentPath, 'file')}
            onNewFolder={(parentPath) => startCreateEntry(parentPath, 'directory')}
            onRename={startRenameFile}
            onDelete={(file) => void deleteFile(file)}
            onCopyPath={(file) => void copyFilePath(file)}
            onDownload={(file) => void downloadFile(file)}
            onOpenSourceCode={(file) => void openSourceCode(file)}
            onOpenInExplorer={(file) => void openFileInExplorer(file)}
          />
        </main>
      </div>

      <FolderBrowserModal
        open={isFolderBrowserOpen}
        loading={folderBrowseLoading}
        currentPath={folderBrowsePath}
        parentPath={folderBrowseParentPath}
        folders={folderSuggestions}
        error={folderBrowseError}
        hint={folderBrowserHint}
        onClose={closeFolderBrowser}
        onNavigate={(path) => void browseWorkspaceFolders(path)}
        onSelect={(path) => void selectFolderAsWorkspace(path)}
        onCreateFolder={createFolderInBrowser}
      />
      <Dialog
        open={Boolean(pendingWorkspaceDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeletingWorkspace) {
            setPendingWorkspaceDelete(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[min(92vw,520px)] gap-0 overflow-hidden p-0"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">移除工作区</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              {pendingWorkspaceDelete
                ? `从列表移除“${pendingWorkspaceDelete.project.name}”。默认不会删除磁盘目录。`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <Checkbox
                id="delete-workspace-directory"
                checked={pendingWorkspaceDelete?.deleteDirectory === true}
                onCheckedChange={(checked) => {
                  setPendingWorkspaceDelete((current) =>
                    current
                      ? {
                          ...current,
                          deleteDirectory: checked === true,
                        }
                      : current
                  );
                }}
                disabled={isDeletingWorkspace}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="delete-workspace-directory" className="text-sm font-medium">
                  同时删除系统文件夹
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  勾选后会一并删除系统中的工作区目录及其内容，此操作不可撤销。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingWorkspaceDelete(null)}
                disabled={isDeletingWorkspace}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void confirmDeleteWorkspace()}
                disabled={isDeletingWorkspace}
              >
                确认移除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AgentWorkspacesPage() {
  return <AgentWorkspacesContent />;
}

export const Route = createFileRoute('/agent-workspaces')({
  beforeLoad: () => {
    throw redirect({
      to: '/settings',
      search: { mode: 'workspace' },
    });
  },
  component: AgentWorkspacesPage,
});
