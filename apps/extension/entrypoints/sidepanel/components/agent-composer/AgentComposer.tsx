import {
  AtSignIcon,
  BrainIcon,
  CommandIcon,
  EraserIcon,
  FileTextIcon,
  PaperclipIcon,
  SendHorizonalIcon,
  ShieldCheckIcon,
  SquareIcon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react';
import {
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Textarea } from '@/entrypoints/sidepanel/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/entrypoints/sidepanel/components/ui/tooltip';
import { createAgentV2Client } from '../../lib/agent-v2/client';
import type {
  CommandCatalogEntry,
  FileTreeEntry,
  PermissionMode,
  SessionAttachment,
  ThinkingMode,
} from '../../lib/agent-v2/types';
import { subscribeCapabilityCatalogChanged } from '../../lib/capability-catalog-events';
import type { SessionTabSummary } from '../../lib/session-tab-selection';
import type { WindowTakeoverState } from '../../lib/window-takeover';
import { SessionTabStrip } from './SessionTabStrip';

type AgentComposerProps = {
  baseUrl: string;
  endpoint: string;
  value: string;
  projectPath?: string;
  isWorkspaceSelectionRequired?: boolean;
  status: 'idle' | 'connecting' | 'streaming' | 'error';
  contextPercent: number;
  permissionMode: PermissionMode;
  thinkingMode: ThinkingMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onThinkingModeChange: (mode: ThinkingMode) => void;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: (reason?: 'user_stop' | 'window_takeover_user_left') => void | Promise<void>;
  onLocalCommand: (command: CommandCatalogEntry) => void;
  attachments: SessionAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<SessionAttachment[]>>;
  onUploadAttachment?: (files: File[]) => Promise<SessionAttachment[]>;
  sessionTabs?: SessionTabSummary[];
  selectedTabIds?: number[];
  onToggleSelectedTab?: (tabId: number) => void;
  onClearSelectedTabs?: () => void;
  isDecisionBlocked?: boolean;
  takeoverState?: WindowTakeoverState | null;
};

type SelectionFeedback = {
  kind: 'success' | 'warning' | 'error';
  message: string;
} | null;

type ParsedCaptureFeedback = {
  prefix: string;
  entryPath: string;
  suffix: string;
};

const PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: '默认',
  plan: '计划',
  acceptEdits: '允许编辑',
  bypassPermissions: '允许所有',
};

const THINKING_MODES: ThinkingMode[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const THINKING_LABELS: Record<ThinkingMode, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

const THINKING_MODE_ICON_CLASSES: Record<ThinkingMode, string> = {
  low: 'text-slate-400 dark:text-slate-500',
  medium: 'text-slate-500 dark:text-slate-400',
  high: 'text-sky-600 dark:text-sky-400',
  xhigh: 'text-indigo-600 dark:text-indigo-400',
  max: 'text-amber-600 dark:text-amber-400',
};

const PERMISSION_MODE_ICON_CLASSES: Record<PermissionMode, string> = {
  default: 'text-slate-600',
  plan: 'text-violet-600',
  acceptEdits: 'text-blue-600',
  bypassPermissions: 'text-amber-700 dark:text-amber-300',
};

const PERMISSION_MODE_BUTTON_CLASSES: Record<PermissionMode, string> = {
  default: '',
  plan: '',
  acceptEdits: '',
  bypassPermissions:
    'border-amber-500 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-amber-400 dark:bg-amber-500/20 dark:text-amber-50 dark:hover:bg-amber-500/30',
};

const FALLBACK_COMMANDS: CommandCatalogEntry[] = [
  {
    name: '/clear',
    description: '清空当前聊天视图并开始新会话',
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  },
  {
    name: '/new',
    description: '开始一个新的本地会话',
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  },
  {
    name: '/sessions',
    description: '打开历史会话列表',
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  },
  {
    name: '/mcp',
    description: '打开 MCP 工具和连接设置',
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  },
  {
    name: '/help',
    description: '显示可用命令说明',
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  },
];

const ATTACHMENT_ACCEPT =
  'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json';
const MAX_ATTACHMENTS = 8;
const MAX_INPUT_HISTORY = 50;

function flattenCatalog(groups: {
  localUi?: CommandCatalogEntry[];
  project?: CommandCatalogEntry[];
  user?: CommandCatalogEntry[];
  plugin?: CommandCatalogEntry[];
  skills?: CommandCatalogEntry[];
}): CommandCatalogEntry[] {
  return [
    ...(groups.skills || []),
    ...(groups.plugin || []),
    ...(groups.project || []),
    ...(groups.user || []),
    ...(groups.localUi || []),
  ];
}

function commandGroupLabel(command: CommandCatalogEntry) {
  if (command.metadata?.type === 'skill' || command.namespace === 'skill') {
    return 'Skill';
  }
  if (command.namespace === 'project') {
    return 'Project';
  }
  if (command.namespace === 'user') {
    return 'User';
  }
  if (command.namespace === 'plugin') {
    return 'Plugin';
  }
  return '本地';
}

function isSkillCommand(command: CommandCatalogEntry) {
  return command.metadata?.type === 'skill' || command.namespace === 'skill';
}

function isPluginStyleSkillName(name: string) {
  return name.includes(':');
}

function compareCommandEntries(a: CommandCatalogEntry, b: CommandCatalogEntry) {
  const aIsSkill = a.metadata?.type === 'skill' || a.namespace === 'skill';
  const bIsSkill = b.metadata?.type === 'skill' || b.namespace === 'skill';
  if (aIsSkill && bIsSkill) {
    const aIsPluginSkill = isPluginStyleSkillName(a.name);
    const bIsPluginSkill = isPluginStyleSkillName(b.name);
    if (aIsPluginSkill !== bIsPluginSkill) {
      return aIsPluginSkill ? -1 : 1;
    }
  }
  return a.name.localeCompare(b.name);
}

function parseCaptureFeedbackMessage(message: string): ParsedCaptureFeedback | null {
  const trimmedMessage = message.trim();
  const match = /^网页已保存到\s+(\S+)(.*)$/u.exec(trimmedMessage);
  if (!match) {
    return null;
  }

  return {
    prefix: '网页已保存到',
    entryPath: match[1],
    suffix: match[2] || '',
  };
}

type SlashTriggerContext = {
  start: number;
  end: number;
  query: string;
};

const COMMAND_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'is',
  'of',
  'or',
  'the',
  'this',
  'that',
  'to',
  'use',
  'when',
  'you',
]);

function normalizeCommandQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractCommandKeywords(query: string) {
  const matches = normalizeCommandQuery(query).match(/[a-z0-9:_-]+|[\u4e00-\u9fff]{2,}/gi) || [];
  return [
    ...new Set(matches.filter((token) => token.length > 1 && !COMMAND_QUERY_STOP_WORDS.has(token))),
  ];
}

function scoreCommandEntry(command: CommandCatalogEntry, query: string) {
  const normalizedQuery = normalizeCommandQuery(query);
  if (!normalizedQuery) {
    return 0;
  }

  const name = command.name.toLowerCase();
  const description = (command.description || '').toLowerCase();
  const haystack = `${name} ${description}`.trim();
  let score = 0;

  if (haystack.includes(normalizedQuery)) {
    score += 100;
  }

  for (const keyword of extractCommandKeywords(normalizedQuery)) {
    if (name.includes(keyword)) {
      score += 25;
    } else if (description.includes(keyword)) {
      score += 12;
    }
  }

  return score;
}

function getActiveSlashTrigger(input: string, cursor: number): SlashTriggerContext | null {
  const safeCursor = Math.max(0, Math.min(cursor, input.length));
  const prefix = input.slice(0, safeCursor);

  const inlineMatch = /(?:^|\s)(\/[^\s]*)$/.exec(prefix);
  const inlineStart = inlineMatch ? prefix.length - inlineMatch[1].length : -1;

  let standaloneStart = -1;
  let standaloneEnd = -1;
  const standalonePattern = /(?:^|\n)([ \t]*\/[ \t]*)(?=\n|$)/g;
  let match: RegExpExecArray | null = standalonePattern.exec(prefix);
  while (match) {
    standaloneStart = match.index + match[0].length - match[1].length;
    standaloneEnd = standaloneStart + match[1].length;
    match = standalonePattern.exec(prefix);
  }

  if (inlineStart > standaloneStart && inlineMatch) {
    return {
      start: inlineStart,
      end: safeCursor,
      query: inlineMatch[1].slice(1),
    };
  }

  if (standaloneStart >= 0) {
    return {
      start: standaloneStart,
      end: standaloneEnd,
      query: input.slice(standaloneEnd, safeCursor),
    };
  }

  return null;
}

function replaceTriggerText(input: string, triggerIndex: number, replacement: string) {
  return `${input.slice(0, triggerIndex)}${replacement}${input.slice(triggerIndex).replace(/^[/@]\S*/, '')}`;
}

function replaceSlashTriggerText(input: string, trigger: SlashTriggerContext, replacement: string) {
  const trailingContent = input.slice(trigger.end);
  return `${input.slice(0, trigger.start)}${replacement}${trailingContent}`;
}

function isImeComposingEvent(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
  const nativeEvent = event.nativeEvent as KeyboardEvent & {
    isComposing?: boolean;
    keyCode?: number;
  };
  return nativeEvent.isComposing === true || nativeEvent.keyCode === 229;
}

function isImageFile(file: File) {
  return file.type.startsWith('image/');
}

function hasDraggedFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function getDraggedFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.files || []);
}

function isImageAttachment(attachment: SessionAttachment) {
  return (
    attachment.kind === 'image' &&
    attachment.mimeType.startsWith('image/') &&
    ((typeof attachment.previewUrl === 'string' && attachment.previewUrl.length > 0) ||
      (typeof attachment.data === 'string' && attachment.data.length > 0))
  );
}

function getImageAttachmentSrc(attachment: SessionAttachment) {
  if (typeof attachment.previewUrl === 'string' && attachment.previewUrl.length > 0) {
    return attachment.previewUrl;
  }
  if (typeof attachment.data === 'string' && attachment.data.length > 0) {
    return `data:${attachment.mimeType};base64,${attachment.data}`;
  }
  return '';
}

function formatAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentKindLabel(attachment: SessionAttachment) {
  if (attachment.kind === 'text') {
    return '文本';
  }
  if (attachment.kind === 'document') {
    return '文档';
  }
  if (attachment.kind === 'image') {
    return '图片';
  }
  return '附件';
}

async function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64Marker = ';base64,';
      const markerIndex = dataUrl.indexOf(base64Marker);
      resolve(markerIndex >= 0 ? dataUrl.slice(markerIndex + base64Marker.length) : dataUrl);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

async function buildInlineImageAttachments(files: File[]) {
  const imageFiles = files.filter(isImageFile);
  return Promise.all(
    imageFiles.map(async (file) => {
      const id = crypto.randomUUID();
      return {
        id,
        sessionFileId: id,
        name: file.name || 'pasted-image',
        mimeType: file.type || 'image/*',
        size: file.size,
        kind: 'image' as const,
        storage: 'inline',
        data: await readFileAsBase64(file),
      };
    })
  );
}

export function AgentComposer({
  baseUrl,
  endpoint,
  value,
  projectPath,
  isWorkspaceSelectionRequired = false,
  status,
  contextPercent,
  permissionMode,
  thinkingMode,
  onPermissionModeChange,
  onThinkingModeChange,
  onChange,
  onSend,
  onStop,
  onLocalCommand,
  attachments,
  onAttachmentsChange,
  onUploadAttachment,
  sessionTabs = [],
  selectedTabIds = [],
  onToggleSelectedTab,
  onClearSelectedTabs,
  isDecisionBlocked = false,
  takeoverState,
}: AgentComposerProps) {
  const client = useMemo(() => createAgentV2Client({ baseUrl, endpoint }), [baseUrl, endpoint]);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const latestValueRef = useRef(value);
  const latestAttachmentsRef = useRef(attachments);
  const pendingAttachmentCountRef = useRef(attachments.length);
  const draftBeforeHistoryRef = useRef('');
  const isApplyingHistoryRef = useRef(false);
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const [commands, setCommands] = useState<CommandCatalogEntry[]>(FALLBACK_COMMANDS);
  const [files, setFiles] = useState<FileTreeEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCommandsOpen, setIsCommandsOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isThinkingTooltipOpen, setIsThinkingTooltipOpen] = useState(false);
  const [isPermissionTooltipOpen, setIsPermissionTooltipOpen] = useState(false);
  const [selectionFeedback, setSelectionFeedback] = useState<SelectionFeedback>(null);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const slashTrigger = getActiveSlashTrigger(value, cursorPosition);
  const slashIndex = slashTrigger?.start ?? value.lastIndexOf('/');
  const atIndex = value.lastIndexOf('@');
  const slashQuery = slashTrigger ? normalizeCommandQuery(slashTrigger.query) : '';
  const atQuery =
    atIndex >= 0
      ? value
          .slice(atIndex + 1)
          .trim()
          .toLowerCase()
      : '';

  const filteredCommands = useMemo(() => {
    const withScore = commands.map((command) => ({
      command,
      score: scoreCommandEntry(command, slashQuery),
    }));
    const matched = withScore.filter(({ score }) => !slashQuery || score > 0);
    return matched
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return compareCommandEntries(a.command, b.command);
      })
      .map(({ command }) => command);
  }, [commands, slashQuery]);

  const filteredSkillCommands = useMemo(
    () => filteredCommands.filter((command) => isSkillCommand(command)),
    [filteredCommands]
  );

  const totalAvailableCommands = commands.length;
  const commandBadgeCount = totalAvailableCommands;

  const filteredFiles = useMemo(() => {
    const matched = files.filter((file) => {
      if (file.type !== 'file') {
        return false;
      }
      if (!atQuery) {
        return true;
      }
      return file.path.toLowerCase().includes(atQuery) || file.name.toLowerCase().includes(atQuery);
    });
    return matched.slice(0, 50);
  }, [atQuery, files]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    latestAttachmentsRef.current = attachments;
    pendingAttachmentCountRef.current = attachments.length;
  }, [attachments]);

  useEffect(() => {
    setCursorPosition((current) => Math.min(current, value.length));
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    const loadCommands = (forceRefresh = false) => {
      void client
        .listCommands({ projectPath, forceRefresh })
        .then((catalog) => {
          if (!cancelled) {
            setCommands(flattenCatalog(catalog));
          }
        })
        .catch((error) => console.debug('[composer] Failed to load commands:', error));
    };

    loadCommands();
    const unsubscribe = subscribeCapabilityCatalogChanged(({ type }) => {
      if (type === 'skill' || type === 'command') {
        loadCommands(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, projectPath]);

  useEffect(() => {
    if (!projectPath) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    client
      .listFiles({ projectPath })
      .then((entries) => {
        if (!cancelled) {
          setFiles(entries);
        }
      })
      .catch((error) => console.debug('[composer] Failed to load files:', error));
    return () => {
      cancelled = true;
    };
  }, [client, projectPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlighted item whenever the active menu or query changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [isCommandsOpen, isFilesOpen, slashQuery, atQuery]);

  useEffect(() => {
    if (!(isCommandsOpen || isFilesOpen)) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && composerRef.current?.contains(target)) {
        return;
      }
      setIsCommandsOpen(false);
      setIsFilesOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isCommandsOpen, isFilesOpen]);

  const cyclePermissionMode = () => {
    const index = PERMISSION_MODES.indexOf(permissionMode);
    onPermissionModeChange(PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length]);
  };

  const cycleThinkingMode = () => {
    const index = THINKING_MODES.indexOf(thinkingMode);
    onThinkingModeChange(THINKING_MODES[(index + 1) % THINKING_MODES.length]);
  };

  const applyHistoryValue = (nextValue: string) => {
    isApplyingHistoryRef.current = true;
    onChange(nextValue);
    setCursorPosition(nextValue.length);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextValue.length, nextValue.length);
    });
  };

  const rememberSentInput = () => {
    const submittedValue = latestValueRef.current;
    if (!submittedValue.trim()) {
      return;
    }
    setInputHistory((current) => {
      if (current[current.length - 1] === submittedValue) {
        return current;
      }
      return [...current.slice(-(MAX_INPUT_HISTORY - 1)), submittedValue];
    });
    setHistoryIndex(null);
    draftBeforeHistoryRef.current = '';
  };

  const navigateInputHistory = (direction: 'older' | 'newer') => {
    if (inputHistory.length === 0) {
      return false;
    }

    if (direction === 'older') {
      if (historyIndex === null) {
        draftBeforeHistoryRef.current = latestValueRef.current;
        const latestHistoryIndex = inputHistory.length - 1;
        setHistoryIndex(latestHistoryIndex);
        applyHistoryValue(inputHistory[latestHistoryIndex]);
        return true;
      }

      const nextIndex = Math.max(0, historyIndex - 1);
      if (nextIndex === historyIndex) {
        return true;
      }
      setHistoryIndex(nextIndex);
      applyHistoryValue(inputHistory[nextIndex]);
      return true;
    }

    if (historyIndex === null) {
      return false;
    }

    if (historyIndex >= inputHistory.length - 1) {
      setHistoryIndex(null);
      applyHistoryValue(draftBeforeHistoryRef.current);
      draftBeforeHistoryRef.current = '';
      return true;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    applyHistoryValue(inputHistory[nextIndex]);
    return true;
  };

  const PermissionModeIcon =
    permissionMode === 'bypassPermissions' ? TriangleAlertIcon : ShieldCheckIcon;

  const selectCommand = (command: CommandCatalogEntry) => {
    if (command.metadata?.type === 'local-ui') {
      onLocalCommand(command);
      setIsCommandsOpen(false);
      return;
    }
    if (slashTrigger) {
      onChange(replaceSlashTriggerText(value, slashTrigger, `${command.name} `));
    } else {
      onChange(replaceTriggerText(value, slashIndex, `${command.name} `));
    }
    setIsCommandsOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const selectFile = (file: FileTreeEntry) => {
    onChange(replaceTriggerText(value, atIndex, `@${file.path} `));
    setIsFilesOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addAttachmentFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }
    try {
      const currentAttachments = latestAttachmentsRef.current;
      const effectiveCurrentCount = Math.max(
        currentAttachments.length,
        pendingAttachmentCountRef.current
      );
      const availableSlots = Math.max(0, MAX_ATTACHMENTS - effectiveCurrentCount);
      const filesToProcess = files.slice(0, availableSlots);
      const droppedCount = files.length - filesToProcess.length;

      if (filesToProcess.length === 0) {
        setSelectionFeedback({
          kind: 'warning',
          message: `最多保留 ${MAX_ATTACHMENTS} 个附件，当前附件已满；本次选择的 ${files.length} 个附件未添加。`,
        });
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }

      const acceptedAttachments = onUploadAttachment
        ? await onUploadAttachment(filesToProcess)
        : await buildInlineImageAttachments(filesToProcess);
      if (!acceptedAttachments.length) {
        return;
      }
      pendingAttachmentCountRef.current = effectiveCurrentCount + acceptedAttachments.length;

      if (acceptedAttachments.length > 0) {
        onAttachmentsChange((current) => [...current, ...acceptedAttachments]);
      }

      if (droppedCount > 0) {
        setSelectionFeedback({
          kind: 'warning',
          message:
            acceptedAttachments.length > 0
              ? `最多保留 ${MAX_ATTACHMENTS} 个附件。已保留原有 ${effectiveCurrentCount} 个，并新增 ${acceptedAttachments.length} 个；其余 ${droppedCount} 个未添加。`
              : `最多保留 ${MAX_ATTACHMENTS} 个附件，当前附件已满；本次选择的 ${droppedCount} 个附件未添加。`,
        });
      } else {
        setSelectionFeedback(null);
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      setSelectionFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '添加附件失败',
      });
    }
  };

  const hasText = value.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const isBusy = status === 'connecting' || status === 'streaming';
  const isInputDisabled = isDecisionBlocked;
  const areWorkspaceToolsDisabled = isWorkspaceSelectionRequired || isDecisionBlocked;
  const activeList = isCommandsOpen ? filteredCommands : isFilesOpen ? filteredFiles : [];
  const handleDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingFiles(true);
  };
  const handleDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDraggingFiles(false);
  };
  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    setIsDraggingFiles(false);
    const files = getDraggedFiles(event);
    if (files.length > 0 && (onUploadAttachment || files.some(isImageFile))) {
      void addAttachmentFiles(files);
    }
  };
  const composerNotice =
    takeoverState?.status === 'active' ? (
      <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1.5 text-[11px] text-amber-700">
        <ZapIcon className="h-3.5 w-3.5" />
        会话正在托管这个浏览器窗口，离开会中断本次运行。
      </div>
    ) : null;
  const parsedCaptureFeedback = selectionFeedback
    ? parseCaptureFeedbackMessage(selectionFeedback.message)
    : null;

  return (
    <div className="toolbar-surface-plain">
      <div className="space-y-2 p-2">
        {composerNotice}
        {selectionFeedback ? (
          <div
            className={`rounded-md px-2 py-1.5 text-[11px] ${
              selectionFeedback.kind === 'error'
                ? 'border border-destructive/30 bg-destructive/5 text-destructive'
                : selectionFeedback.kind === 'warning'
                  ? 'border border-amber-200 bg-amber-50 text-amber-800'
                  : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {parsedCaptureFeedback ? (
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                <span className="shrink-0">{parsedCaptureFeedback.prefix}</span>
                <span
                  className="min-w-0 flex-1 truncate whitespace-nowrap underline underline-offset-2"
                  title={parsedCaptureFeedback.entryPath}
                >
                  {parsedCaptureFeedback.entryPath}
                </span>
                {parsedCaptureFeedback.suffix ? (
                  <span className="shrink-0">{parsedCaptureFeedback.suffix}</span>
                ) : null}
              </div>
            ) : (
              selectionFeedback.message
            )}
          </div>
        ) : null}

        <div
          ref={composerRef}
          className={`relative rounded-lg border bg-card/80 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15 ${
            isDraggingFiles ? 'border-primary/60 ring-2 ring-primary/20' : ''
          }`}
        >
          {isCommandsOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[300px] overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg">
              <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
                Slash 命令
              </div>
              <div className="px-2 pb-2 text-[11px] leading-5 text-muted-foreground">
                当前可用 Skill {filteredSkillCommands.length} 个，共加载 Slash 命令{' '}
                {filteredCommands.length} 个；其中还包含 `/clear`、`/new` 等本地命令。
              </div>
              {filteredCommands.length ? (
                filteredCommands.map((command, index) => (
                  <button
                    key={`${command.name}-${command.path || command.namespace || ''}`}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
                      index === selectedIndex ? 'bg-muted' : 'hover:bg-muted/60'
                    }`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCommand(command)}
                  >
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {commandGroupLabel(command)}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-semibold">{command.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {command.description}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  暂无匹配命令
                </div>
              )}
            </div>
          ) : null}

          {isFilesOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[260px] overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg">
              <div className="px-2 pb-2 text-xs font-semibold text-muted-foreground">选择文件</div>
              {filteredFiles.length ? (
                filteredFiles.map((file, index) => (
                  <button
                    key={file.path}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
                      index === selectedIndex ? 'bg-muted' : 'hover:bg-muted/60'
                    }`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectFile(file)}
                  >
                    <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {projectPath ? '暂无匹配文件' : '加载历史会话后可选择项目文件'}
                </div>
              )}
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            value={value}
            disabled={isInputDisabled}
            onChange={(event) => {
              const nextValue = event.target.value;
              const nextCursor = event.target.selectionStart ?? nextValue.length;
              onChange(nextValue);
              if (isApplyingHistoryRef.current) {
                isApplyingHistoryRef.current = false;
              } else if (historyIndex !== null) {
                setHistoryIndex(null);
                draftBeforeHistoryRef.current = '';
              }
              setCursorPosition(nextCursor);
              setIsCommandsOpen(Boolean(getActiveSlashTrigger(nextValue, nextCursor)));
              setIsFilesOpen(/(?:^|\s)@[^\s]*$/.test(nextValue));
            }}
            onClick={(event) => {
              const cursor = event.currentTarget.selectionStart ?? value.length;
              setCursorPosition(cursor);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (files.length > 0 && (onUploadAttachment || files.some(isImageFile))) {
                event.preventDefault();
                void addAttachmentFiles(files);
              }
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={
              isWorkspaceSelectionRequired
                ? '请先选择工作区，然后就可以开始提问、附加文件和调用工具。'
                : isDecisionBlocked
                  ? 'Claude 正在等待你处理上方请求'
                  : '输入 / 调用命令，@ 选择文件，或向 Claude 提问，Enter 发送 · Shift+Enter 换行 · Tab 切换模式'
            }
            className="min-h-[104px] text-xs max-h-[50vh] resize-none overflow-y-auto border-0 bg-transparent px-3 py-3  shadow-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-0"
            onKeyDown={(event) => {
              if (isInputDisabled) {
                event.preventDefault();
                return;
              }
              if (isImeComposingEvent(event)) {
                return;
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                cyclePermissionMode();
                return;
              }
              if ((isCommandsOpen || isFilesOpen) && activeList.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedIndex((index) => (index + 1) % activeList.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedIndex((index) => (index - 1 + activeList.length) % activeList.length);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (isCommandsOpen) {
                    selectCommand(filteredCommands[selectedIndex]);
                  } else if (isFilesOpen) {
                    selectFile(filteredFiles[selectedIndex]);
                  }
                  return;
                }
              }
              const selectionStart = event.currentTarget.selectionStart ?? value.length;
              const selectionEnd = event.currentTarget.selectionEnd ?? value.length;
              const isCollapsedSelection = selectionStart === selectionEnd;
              const isSingleLineInput = !value.includes('\n');
              if (event.key === 'ArrowUp') {
                const shouldNavigateHistory =
                  historyIndex !== null ||
                  isSingleLineInput ||
                  (isCollapsedSelection && selectionStart === 0);
                if (shouldNavigateHistory && navigateInputHistory('older')) {
                  event.preventDefault();
                  return;
                }
              }
              if (event.key === 'ArrowDown') {
                const shouldNavigateHistory =
                  historyIndex !== null ||
                  isSingleLineInput ||
                  (isCollapsedSelection && selectionStart === value.length);
                if (shouldNavigateHistory && navigateInputHistory('newer')) {
                  event.preventDefault();
                  return;
                }
              }
              if (event.key === 'Escape') {
                setIsCommandsOpen(false);
                setIsFilesOpen(false);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!isBusy && value.trim()) {
                  rememberSentInput();
                }
                onSend();
              }
            }}
            onSelect={(event) => {
              const cursor = event.currentTarget.selectionStart ?? value.length;
              setCursorPosition(cursor);
            }}
          />

          {isDraggingFiles ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-background/80 text-sm font-medium text-foreground">
              松开以上传附件
            </div>
          ) : null}

          {hasAttachments ? (
            <div className="flex gap-2 overflow-x-auto border-t bg-muted/10 px-3 py-2">
              {attachments.map((attachment) =>
                isImageAttachment(attachment) ? (
                  <div
                    key={attachment.id}
                    className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={getImageAttachmentSrc(attachment)}
                      alt={attachment.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-[10px] shadow"
                      title={`移除附件：${attachment.name}`}
                      aria-label={`移除附件：${attachment.name}`}
                      onClick={() =>
                        onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))
                      }
                    >
                      x
                    </button>
                  </div>
                ) : (
                  <div
                    key={attachment.id}
                    className="flex min-w-[180px] max-w-[220px] shrink-0 items-start gap-2 rounded-md border bg-background px-2.5 py-2"
                  >
                    <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                      <FileTextIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {attachment.name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {getAttachmentKindLabel(attachment)} ·{' '}
                        {formatAttachmentSize(attachment.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground transition hover:text-foreground"
                      title={`移除附件：${attachment.name}`}
                      aria-label={`移除附件：${attachment.name}`}
                      onClick={() =>
                        onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))
                      }
                    >
                      x
                    </button>
                  </div>
                )
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6.5 w-6.5 rounded-full"
                title="选择文件"
                disabled={areWorkspaceToolsDisabled}
                onClick={() => {
                  onChange(`${value}${value.endsWith(' ') || !value ? '' : ' '}@`);
                  setIsFilesOpen(true);
                  setIsCommandsOpen(false);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                <AtSignIcon className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6.5 w-6.5 rounded-full"
                title="添加附件"
                aria-label="添加附件"
                disabled={areWorkspaceToolsDisabled}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <PaperclipIcon className="h-3 w-3" />
              </Button>
              <input
                ref={attachmentInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                disabled={areWorkspaceToolsDisabled}
                className="hidden"
                onChange={(event) => {
                  void addAttachmentFiles(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative h-6.5 w-6.5 rounded-full"
                title="显示命令"
                aria-label="显示命令"
                disabled={areWorkspaceToolsDisabled}
                onClick={() => {
                  setIsCommandsOpen((open) => !open);
                  setIsFilesOpen(false);
                }}
              >
                <CommandIcon className="h-3 w-3" />
                {commandBadgeCount ? (
                  <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
                    {commandBadgeCount > 99 ? '99+' : commandBadgeCount}
                  </span>
                ) : null}
              </Button>
              <Tooltip open={isThinkingTooltipOpen}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-6.5 w-6.5 rounded-full"
                    aria-label={`思考等级：${THINKING_LABELS[thinkingMode]}`}
                    disabled={areWorkspaceToolsDisabled}
                    onBlur={() => setIsThinkingTooltipOpen(false)}
                    onClick={() => {
                      cycleThinkingMode();
                      setIsThinkingTooltipOpen(true);
                    }}
                    onFocus={() => setIsThinkingTooltipOpen(true)}
                    onMouseEnter={() => setIsThinkingTooltipOpen(true)}
                    onMouseLeave={() => setIsThinkingTooltipOpen(false)}
                  >
                    <BrainIcon
                      className={`h-3 w-3 ${THINKING_MODE_ICON_CLASSES[thinkingMode]}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>思考等级：{THINKING_LABELS[thinkingMode]}</TooltipContent>
              </Tooltip>
              {sessionTabs.length > 0 ? (
                <SessionTabStrip
                  tabs={sessionTabs}
                  selectedTabIds={selectedTabIds}
                  onToggleTab={(tabId) => onToggleSelectedTab?.(tabId)}
                  onClearSelection={onClearSelectedTabs}
                  menuAnchorRef={composerRef}
                  disabled={areWorkspaceToolsDisabled}
                />
              ) : null}
              <Tooltip open={isPermissionTooltipOpen}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={`h-6.5 w-6.5 rounded-full ${PERMISSION_MODE_BUTTON_CLASSES[permissionMode]}`}
                    aria-label={`权限等级：${PERMISSION_LABELS[permissionMode]}`}
                    disabled={areWorkspaceToolsDisabled}
                    onBlur={() => setIsPermissionTooltipOpen(false)}
                    onClick={() => {
                      cyclePermissionMode();
                      setIsPermissionTooltipOpen(true);
                    }}
                    onFocus={() => setIsPermissionTooltipOpen(true)}
                    onMouseEnter={() => setIsPermissionTooltipOpen(true)}
                    onMouseLeave={() => setIsPermissionTooltipOpen(false)}
                  >
                    <PermissionModeIcon
                      className={`h-3 w-3 ${PERMISSION_MODE_ICON_CLASSES[permissionMode]}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>权限等级：{PERMISSION_LABELS[permissionMode]}</TooltipContent>
              </Tooltip>
              {hasText || hasAttachments ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6.5 w-6.5 rounded-full"
                  title="清空输入"
                  disabled={areWorkspaceToolsDisabled}
                  onClick={() => {
                    onChange('');
                    onAttachmentsChange([]);
                  }}
                >
                  <EraserIcon className="h-3 w-3" />
                </Button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {contextPercent.toFixed(1)}%
              </span>
              {isBusy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5"
                  onClick={() => void onStop('user_stop')}
                >
                  <SquareIcon className="h-3 w-3" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className="h-7 w-7"
                  disabled={areWorkspaceToolsDisabled || (!hasText && !hasAttachments)}
                  onClick={onSend}
                  title="发送"
                  aria-label="发送"
                >
                  <SendHorizonalIcon className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
