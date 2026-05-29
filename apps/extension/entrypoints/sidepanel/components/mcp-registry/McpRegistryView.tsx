import { ArrowLeft, Check, RefreshCw, Search, Settings, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import { Toggle } from '@/entrypoints/sidepanel/components/ui/toggle';
import { createAgentV2Client } from '@/entrypoints/sidepanel/lib/agent-v2/client';
import {
  isAgentV2ProjectSelectedMessage,
  readAgentV2ProjectSelection,
} from '@/entrypoints/sidepanel/lib/agent-v2/session-selection';
import type {
  McpRegistryResponse,
  McpRegistryServer,
  McpRegistryTool,
  McpRegistryToolsResponse,
  McpServerScope,
} from '@/entrypoints/sidepanel/lib/agent-v2/types';
import { config } from '@/entrypoints/sidepanel/lib/config';
import { localizeUserFacingError } from '@/entrypoints/sidepanel/lib/user-facing-error';
import { cn } from '@/entrypoints/sidepanel/lib/utils';

type ViewMode =
  | { type: 'registry' }
  | { type: 'detail'; serverName: string }
  | { type: 'raw' }
  | { type: 'create'; scope: McpServerScope }
  | { type: 'edit'; server: McpRegistryServer };
type SourceFilter = 'all' | 'user' | 'project' | 'extension';
const SOURCE_FILTER_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'user', label: '全局' },
  { value: 'project', label: '项目' },
  { value: 'extension', label: '扩展' },
];
type DraftTransport = 'stdio' | 'http' | 'sse';
type EditorView = 'form' | 'json';
type McpServerDraft = {
  name: string;
  type: DraftTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
  headersText: string;
};
type ExtraConfigFields = Record<string, unknown>;
const MCP_SERVER_NAME_PLACEHOLDER = 'your-server-name';

function createClient() {
  return createAgentV2Client({
    baseUrl: config.api.agentV2BaseUrl,
    endpoint: config.api.agentV2Endpoint,
  });
}

function initials(name: string) {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
    .padEnd(2, name[1]?.toUpperCase() || name[0]?.toUpperCase() || 'M');
}

function serverSubtitle(server: McpRegistryServer) {
  if (server.disabled) return '已停用';
  if (server.status === 'error') return '异常';
  return '已启用';
}

function serverSourceLabel(server: McpRegistryServer) {
  if (server.source === 'user') return 'Claude CLI 全局';
  if (server.builtIn) return 'accr-ui 内置';
  if (server.source === 'project') return '项目 .mcp.json';
  return server.source;
}

function serverEndpoint(server: McpRegistryServer) {
  if (typeof server.config.url === 'string') {
    return server.config.url;
  }
  if (typeof server.config.command === 'string') {
    const args = Array.isArray(server.config.args) ? server.config.args.join(' ') : '';
    return `${server.config.command}${args ? ` ${args}` : ''}`;
  }
  return '未配置连接信息';
}

function scopeHelpText(scope: McpServerScope) {
  return scope === 'user' ? '写入 Claude CLI 全局配置 ~/.claude.json' : '写入当前项目 .mcp.json';
}

function createEmptyDraft(): McpServerDraft {
  return {
    name: '',
    type: 'stdio',
    command: '',
    argsText: '',
    url: '',
    envText: '',
    headersText: '',
  };
}

export function createDraftFromServer(server: McpRegistryServer): McpServerDraft {
  const inferredType: DraftTransport =
    server.type === 'sse' ? 'sse' : server.type === 'http' ? 'http' : 'stdio';
  return {
    name: server.name,
    type: inferredType,
    command: typeof server.config.command === 'string' ? server.config.command : '',
    argsText: Array.isArray(server.config.args)
      ? server.config.args.filter((item): item is string => typeof item === 'string').join(' ')
      : '',
    url: typeof server.config.url === 'string' ? server.config.url : '',
    envText: server.config.env ? JSON.stringify(server.config.env, null, 2) : '',
    headersText: server.config.headers ? JSON.stringify(server.config.headers, null, 2) : '',
  };
}

export function extractExtraConfigFields(config: Record<string, unknown>): ExtraConfigFields {
  const extra = { ...config };
  delete extra.command;
  delete extra.args;
  delete extra.url;
  delete extra.env;
  delete extra.headers;
  delete extra.type;
  delete extra.transport;
  return extra;
}

function parseArgsText(value: string): string[] | undefined {
  const args = value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return args.length > 0 ? args : undefined;
}

function parseOptionalJson(value: string, label: string): Record<string, unknown> | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

export function buildServerConfig(
  draft: McpServerDraft,
  extraConfigFields: ExtraConfigFields = {}
): Record<string, unknown> {
  const env = parseOptionalJson(draft.envText, '环境变量');
  const base = { ...extraConfigFields };
  delete base.command;
  delete base.args;
  delete base.url;
  delete base.headers;
  delete base.env;
  delete base.type;
  delete base.transport;

  if (draft.type === 'http' || draft.type === 'sse') {
    const headers = parseOptionalJson(draft.headersText, '请求头');
    return {
      ...base,
      type: draft.type,
      ...(draft.type === 'sse' ? { transport: 'sse' } : {}),
      url: draft.url.trim(),
      ...(headers ? { headers } : {}),
      ...(env ? { env } : {}),
    };
  }
  return {
    ...base,
    command: draft.command.trim(),
    ...(parseArgsText(draft.argsText) ? { args: parseArgsText(draft.argsText) } : {}),
    ...(env ? { env } : {}),
  };
}

function parseServerConfigRecord(record: Record<string, unknown>): {
  draft: McpServerDraft;
  extraConfigFields: ExtraConfigFields;
  config: Record<string, unknown>;
} {
  const inferredType: DraftTransport =
    record.type === 'sse' || record.transport === 'sse'
      ? 'sse'
      : typeof record.url === 'string' || record.type === 'http' || record.transport === 'http'
        ? 'http'
        : 'stdio';
  return {
    draft: {
      name: '',
      type: inferredType,
      command: typeof record.command === 'string' ? record.command : '',
      argsText: Array.isArray(record.args)
        ? record.args.filter((item): item is string => typeof item === 'string').join(' ')
        : '',
      url: typeof record.url === 'string' ? record.url : '',
      envText: record.env ? JSON.stringify(record.env, null, 2) : '',
      headersText: record.headers ? JSON.stringify(record.headers, null, 2) : '',
    },
    extraConfigFields: extractExtraConfigFields(record),
    config: record,
  };
}

export function parseConfigObjectToDraft(config: unknown): {
  draft: McpServerDraft;
  extraConfigFields: ExtraConfigFields;
  config: Record<string, unknown>;
} {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('JSON 视图必须是一个对象');
  }
  const record = config as Record<string, unknown>;
  const normalizedName = (value: string) =>
    value.trim() === MCP_SERVER_NAME_PLACEHOLDER ? '' : value.trim();

  if (
    record.mcpServers &&
    typeof record.mcpServers === 'object' &&
    !Array.isArray(record.mcpServers)
  ) {
    const entries = Object.entries(record.mcpServers as Record<string, unknown>).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        typeof entry[0] === 'string' &&
        !!entry[1] &&
        typeof entry[1] === 'object' &&
        !Array.isArray(entry[1])
    );
    if (entries.length === 0) {
      throw new Error('mcpServers 里至少要有一个服务');
    }
    const [serverName, serverConfig] = entries[0];
    const parsed = parseServerConfigRecord(serverConfig);
    return {
      ...parsed,
      draft: {
        ...parsed.draft,
        name: normalizedName(serverName),
      },
    };
  }

  if (
    typeof record.name === 'string' &&
    record.config &&
    typeof record.config === 'object' &&
    !Array.isArray(record.config)
  ) {
    const parsed = parseServerConfigRecord(record.config as Record<string, unknown>);
    return {
      ...parsed,
      draft: {
        ...parsed.draft,
        name: normalizedName(record.name),
      },
    };
  }

  return parseServerConfigRecord(record);
}

export function buildConfigEditorJsonText(
  draft: McpServerDraft,
  extraConfigFields: ExtraConfigFields = {}
): string {
  const serverName = draft.name.trim() || MCP_SERVER_NAME_PLACEHOLDER;
  return `${JSON.stringify(
    {
      mcpServers: {
        [serverName]: buildServerConfig(draft, extraConfigFields),
      },
    },
    null,
    2
  )}\n`;
}

function McpCard({
  server,
  onOpen,
  onEdit,
  onDelete,
}: {
  server: McpRegistryServer;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border bg-background p-4 text-left transition hover:bg-muted/40"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{server.name}</span>
          <Badge variant="outline">{server.type}</Badge>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-normal">
            {serverSourceLabel(server)}
          </Badge>
          <span
            className={`size-1.5 rounded-full ${
              server.status === 'error'
                ? 'bg-red-500'
                : server.disabled
                  ? 'bg-muted-foreground'
                  : 'bg-emerald-500'
            }`}
          />
          {serverSubtitle(server)}
          <span>{server.totalToolCount} 个工具</span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        {server.source === 'user' && onEdit ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            title="编辑 MCP 服务"
          >
            <Settings className="size-4" />
          </Button>
        ) : null}
        {server.source === 'user' && onDelete ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="删除 MCP 服务"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{server.disabled ? '关闭' : '开启'}</span>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors',
            server.disabled ? 'bg-muted' : 'bg-primary/15'
          )}
        >
          <span
            className={cn(
              'size-4 rounded-full transition-transform',
              server.disabled ? 'translate-x-0 bg-muted-foreground' : 'translate-x-4 bg-primary'
            )}
          />
        </span>
      </span>
    </div>
  );
}

function ToolRow({
  tool,
  onToggle,
}: {
  tool: McpRegistryTool;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start gap-3">
        <Switch
          checked={tool.enabled}
          onCheckedChange={onToggle}
          aria-label={`切换 ${tool.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold">{tool.name}</div>
          {tool.description && (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.description}</p>
          )}
          <div className="mt-2 truncate font-mono text-xs text-muted-foreground">
            {tool.fullName}
          </div>
        </div>
      </div>
    </div>
  );
}

export function McpRegistryView({
  showHeading = true,
  contentInset = true,
}: {
  showHeading?: boolean;
  contentInset?: boolean;
}) {
  const client = useMemo(createClient, []);
  const [mode, setMode] = useState<ViewMode>({ type: 'registry' });
  const [registry, setRegistry] = useState<McpRegistryResponse>({ servers: [], rawJson: '' });
  const [toolsState, setToolsState] = useState<McpRegistryToolsResponse | null>(null);
  const [rawDraft, setRawDraft] = useState('');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [draft, setDraft] = useState<McpServerDraft>(() => createEmptyDraft());
  const [editorView, setEditorView] = useState<EditorView>('form');
  const [configDraftText, setConfigDraftText] = useState('{}');
  const [configDraftError, setConfigDraftError] = useState<string | null>(null);
  const [extraConfigFields, setExtraConfigFields] = useState<ExtraConfigFields>({});
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    void readAgentV2ProjectSelection()
      .then((selection) => setProjectPath(selection?.projectPath))
      .catch(() => setProjectPath(undefined));
  }, []);

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (!isAgentV2ProjectSelectedMessage(message)) {
        return;
      }
      setProjectPath(message.payload.projectPath);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const loadRegistry = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const next = await client.listMcpRegistry({
          projectPath,
          forceRefresh: options?.forceRefresh,
        });
        setRegistry(next);
        setRawDraft(next.rawJson);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '读取 MCP Registry 失败');
      } finally {
        setLoading(false);
      }
    },
    [client, projectPath]
  );

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const loadTools = useCallback(
    async (serverName: string) => {
      setLoading(true);
      setError(null);
      try {
        setToolsState(await client.listMcpServerTools(serverName, { projectPath }));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '读取 MCP 工具失败');
      } finally {
        setLoading(false);
      }
    },
    [client, projectPath]
  );

  useEffect(() => {
    if (mode.type === 'detail') {
      void loadTools(mode.serverName);
    }
  }, [loadTools, mode]);

  const filteredServers = registry.servers.filter((server) =>
    server.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const visibleServers = filteredServers.filter((server) => {
    if (sourceFilter === 'all') return true;
    if (sourceFilter === 'extension') return server.source === 'built-in';
    return server.source === sourceFilter;
  });
  const countsBySource = {
    user: filteredServers.filter((server) => server.source === 'user').length,
    project: filteredServers.filter((server) => server.source === 'project').length,
    extension: filteredServers.filter((server) => server.source === 'built-in').length,
  } as const;
  const canBulkEnable = visibleServers.some((server) => server.disabled);
  const canBulkDisable = visibleServers.some((server) => !server.disabled);
  const sourceFilterLabel =
    SOURCE_FILTER_OPTIONS.find((option) => option.value === sourceFilter)?.label ?? '全部';

  const saveRaw = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await client.writeMcpRawConfig(rawDraft, { projectPath });
      setRegistry(next);
      setRawDraft(next.rawJson);
      setMode({ type: 'registry' });
      toast.success('MCP 配置已保存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 MCP 配置失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreateForm = (scope: McpServerScope) => {
    const nextDraft = createEmptyDraft();
    setDraft(nextDraft);
    setExtraConfigFields({});
    setConfigDraftText(buildConfigEditorJsonText(nextDraft, {}));
    setConfigDraftError(null);
    setEditorView('form');
    setError(null);
    setMode({ type: 'create', scope });
  };

  const setCreateScope = (scope: McpServerScope) => {
    setMode((current) => (current.type === 'create' ? { ...current, scope } : current));
  };

  const openEditForm = (server: McpRegistryServer) => {
    const nextDraft = createDraftFromServer(server);
    const nextExtra = extractExtraConfigFields(server.config);
    setDraft(nextDraft);
    setExtraConfigFields(nextExtra);
    setConfigDraftText(buildConfigEditorJsonText(nextDraft, nextExtra));
    setConfigDraftError(null);
    setEditorView('form');
    setError(null);
    setMode({ type: 'edit', server });
  };

  const updateDraft = (updater: (current: McpServerDraft) => McpServerDraft) => {
    setDraft((current) => {
      const nextDraft = updater(current);
      try {
        setConfigDraftText(buildConfigEditorJsonText(nextDraft, extraConfigFields));
        setConfigDraftError(null);
      } catch (draftError) {
        setConfigDraftError(draftError instanceof Error ? draftError.message : '配置转换失败');
      }
      return nextDraft;
    });
  };

  const handleEditorViewChange = (nextView: EditorView) => {
    if (nextView === 'form' && configDraftError) {
      return;
    }
    if (nextView === 'json') {
      try {
        setConfigDraftText(buildConfigEditorJsonText(draft, extraConfigFields));
        setConfigDraftError(null);
      } catch (draftError) {
        setConfigDraftError(draftError instanceof Error ? draftError.message : '配置转换失败');
      }
    }
    setEditorView(nextView);
  };

  const handleConfigDraftTextChange = (value: string) => {
    setConfigDraftText(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      const parsedState = parseConfigObjectToDraft(parsed);
      setDraft((current) => ({
        ...parsedState.draft,
        name: parsedState.draft.name || current.name,
      }));
      setExtraConfigFields(parsedState.extraConfigFields);
      setConfigDraftError(null);
    } catch (draftError) {
      setConfigDraftError(draftError instanceof Error ? draftError.message : 'JSON 解析失败');
    }
  };

  const saveServer = async () => {
    if (mode.type !== 'create' && mode.type !== 'edit') {
      return;
    }
    const activeMode = mode;
    setLoading(true);
    setError(null);
    try {
      const scope: McpServerScope =
        activeMode.type === 'create'
          ? activeMode.scope
          : activeMode.server.source === 'user'
            ? 'user'
            : 'project';
      const formData = formRef.current ? new window.FormData(formRef.current) : null;
      const formNameValues = formData?.getAll('name') ?? [];
      const formName =
        typeof formNameValues.at(-1) === 'string' ? String(formNameValues.at(-1) || '') : '';
      const nextDraft: McpServerDraft =
        editorView === 'form' && formData
          ? {
              name: formName.trim(),
              type: ((formData.get('type') as DraftTransport | null) || 'stdio') as DraftTransport,
              command: String(formData.get('command') || ''),
              argsText: String(formData.get('argsText') || ''),
              url: String(formData.get('url') || ''),
              envText: String(formData.get('envText') || ''),
              headersText: String(formData.get('headersText') || ''),
            }
          : { ...draft, name: draft.name.trim() };
      if (editorView === 'json' && configDraftError) {
        throw new Error(configDraftError);
      }
      const parsedJsonState =
        editorView === 'json'
          ? parseConfigObjectToDraft(JSON.parse(configDraftText) as unknown)
          : null;
      const resolvedDraft =
        parsedJsonState && editorView === 'json'
          ? {
              ...nextDraft,
              ...parsedJsonState.draft,
              name: parsedJsonState.draft.name.trim() || nextDraft.name,
            }
          : nextDraft;
      const config =
        parsedJsonState && editorView === 'json'
          ? parsedJsonState.config
          : buildServerConfig(resolvedDraft, extraConfigFields);
      const next = await client.upsertMcpServer({
        name: resolvedDraft.name,
        config,
        scope,
        projectPath,
      });
      setRegistry(next);
      setRawDraft(next.rawJson);
      setMode({ type: 'registry' });
      setToolsState(null);
      if (
        scope === 'user' &&
        next.servers.some(
          (server) => server.name === resolvedDraft.name && server.source === 'project'
        )
      ) {
        toast.info('已写入全局配置，但当前项目存在同名项目 MCP，列表会优先显示项目项。');
      } else {
        toast.success('MCP 服务已保存');
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 MCP 服务失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleServer = async (server: McpRegistryServer, enabled: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const next = await client.setMcpServerEnabled(server.name, enabled, { projectPath });
      setRegistry(next);
      if (mode.type === 'detail') {
        await loadTools(mode.serverName);
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新 MCP 服务失败');
    } finally {
      setLoading(false);
    }
  };

  const bulkToggleServers = async (enabled: boolean) => {
    const targets = visibleServers.filter((server) => server.disabled === enabled);
    if (targets.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      for (const server of targets) {
        await client.setMcpServerEnabled(server.name, enabled, { projectPath });
      }
      const next = await client.listMcpRegistry({ projectPath });
      setRegistry(next);
      if (mode.type === 'detail') {
        await loadTools(mode.serverName);
      }
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : enabled
            ? '批量开启 MCP 服务失败'
            : '批量关闭 MCP 服务失败'
      );
    } finally {
      setLoading(false);
    }
  };

  const deleteServer = async (server: McpRegistryServer) => {
    if (server.builtIn) return;
    const scope: McpServerScope = server.source === 'user' ? 'user' : 'project';
    const confirmed = window.confirm(
      server.source === 'user'
        ? `删除全局 MCP 服务 "${server.name}"？这个操作会直接改写 ~/.claude.json。`
        : `删除 MCP 服务 "${server.name}"？这个操作会从 .mcp.json 移除它。`
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    try {
      const next = await client.deleteMcpServer(server.name, { projectPath, scope });
      setRegistry(next);
      setRawDraft(next.rawJson);
      setToolsState(null);
      setMode({ type: 'registry' });
      toast.success('MCP 服务已删除');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 MCP 服务失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleTool = async (tool: McpRegistryTool, enabled: boolean) => {
    if (!toolsState) return;
    setToolsState({
      ...toolsState,
      tools: toolsState.tools.map((item) =>
        item.fullName === tool.fullName ? { ...item, enabled } : item
      ),
    });
    try {
      await client.setMcpToolEnabled(tool.fullName, enabled, { projectPath });
      await loadRegistry();
    } catch (toggleError) {
      toast.error(localizeUserFacingError(toggleError, '更新工具权限失败'));
      await loadTools(toolsState.server.name);
    }
  };

  if (mode.type === 'raw') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setMode({ type: 'registry' })}>
            <ArrowLeft className="size-4" />
            返回
          </Button>
          <Button size="sm" onClick={saveRaw} disabled={loading}>
            <Check className="size-4" />
            保存 JSON
          </Button>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <Textarea
          className="min-h-[32rem] flex-1 resize-none font-mono text-sm"
          value={rawDraft}
          onChange={(event) => setRawDraft(event.target.value)}
          spellCheck={false}
        />
      </div>
    );
  }

  if (mode.type === 'create' || mode.type === 'edit') {
    const isEdit = mode.type === 'edit';
    const scope: McpServerScope =
      mode.type === 'create' ? mode.scope : mode.server.source === 'user' ? 'user' : 'project';
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setMode({ type: 'registry' })}>
            <ArrowLeft className="size-4" />
            返回
          </Button>
          <Button
            size="sm"
            onClick={saveServer}
            disabled={loading || (editorView === 'json' && Boolean(configDraftError))}
          >
            <Check className="size-4" />
            保存 MCP 服务
          </Button>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <form ref={formRef} className="grid gap-4 rounded-lg border bg-background p-4">
          <input type="hidden" name="name" value={draft.name} />
          <input type="hidden" name="type" value={draft.type} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{scopeHelpText(scope)}</div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background/60 p-0.5">
              <Toggle
                pressed={editorView === 'form'}
                onPressedChange={() => handleEditorViewChange('form')}
                variant="default"
                size="sm"
                className="px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                表单
              </Toggle>
              <Toggle
                pressed={editorView === 'json'}
                onPressedChange={() => handleEditorViewChange('json')}
                variant="default"
                size="sm"
                className="px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                JSON
              </Toggle>
            </div>
          </div>
          {editorView === 'form' ? (
            <>
              {mode.type === 'create' ? (
                <div className="grid gap-2">
                  <Label htmlFor="mcp-scope">写入范围</Label>
                  <fieldset
                    id="mcp-scope"
                    aria-label="写入范围"
                    className="inline-flex flex-wrap items-center gap-1.5 rounded-md border bg-background/60 p-0.5"
                  >
                    <Toggle
                      pressed={scope === 'user'}
                      onPressedChange={() => setCreateScope('user')}
                      variant="default"
                      size="sm"
                      className="px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      全局
                    </Toggle>
                    <Toggle
                      pressed={scope === 'project'}
                      onPressedChange={() => setCreateScope('project')}
                      variant="default"
                      size="sm"
                      className="px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      项目
                    </Toggle>
                  </fieldset>
                  <div className="text-xs text-muted-foreground">{scopeHelpText(scope)}</div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="mcp-name">服务名</Label>
                <Input
                  id="mcp-name"
                  aria-label="服务名"
                  name="name"
                  value={draft.name}
                  disabled={isEdit}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcp-type">类型</Label>
                <Select
                  value={draft.type}
                  onValueChange={(value) =>
                    updateDraft((current) => ({ ...current, type: value as DraftTransport }))
                  }
                >
                  <SelectTrigger id="mcp-type" aria-label="类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="http">http</SelectItem>
                    <SelectItem value="sse">sse</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.type === 'http' || draft.type === 'sse' ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-url">URL</Label>
                    <Input
                      id="mcp-url"
                      aria-label="URL"
                      name="url"
                      value={draft.url}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, url: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-headers">请求头</Label>
                    <Textarea
                      id="mcp-headers"
                      aria-label="请求头"
                      name="headersText"
                      value={draft.headersText}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, headersText: event.target.value }))
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-command">命令</Label>
                    <Input
                      id="mcp-command"
                      aria-label="命令"
                      name="command"
                      value={draft.command}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, command: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="mcp-args">参数</Label>
                    <Input
                      id="mcp-args"
                      aria-label="参数"
                      name="argsText"
                      value={draft.argsText}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, argsText: event.target.value }))
                      }
                    />
                  </div>
                </>
              )}
              <div className="grid gap-2">
                <Label htmlFor="mcp-env">环境变量</Label>
                <Textarea
                  id="mcp-env"
                  aria-label="环境变量"
                  name="envText"
                  value={draft.envText}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, envText: event.target.value }))
                  }
                />
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="mcp-config-json">JSON 配置</Label>
              <Textarea
                id="mcp-config-json"
                aria-label="JSON 配置"
                className="min-h-[24rem] resize-none font-mono text-sm"
                value={configDraftText}
                onChange={(event) => handleConfigDraftTextChange(event.target.value)}
                spellCheck={false}
              />
              {configDraftError ? (
                <div className="text-sm text-red-600">{configDraftError}</div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  支持直接粘贴完整 mcpServers JSON，保存时会自动提取当前 MCP 服务并原样写入其配置。
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 shrink-0  backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <div className="w-[96px] shrink-0">
            <Select
              value={sourceFilter}
              onValueChange={(value) => setSourceFilter(value as SourceFilter)}
            >
              <SelectTrigger aria-label="来源筛选" className="h-9 w-full shrink-0 text-xs">
                <SelectValue>{sourceFilterLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SOURCE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 w-full pl-9 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 MCP 服务..."
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-9 shrink-0 px-3"
            onClick={() => openCreateForm('user')}
          >
            新增 MCP
          </Button>
        </div>

        <div className="my-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
            <span className="truncate text-xs text-muted-foreground">
              {countsBySource.user} 全局 • {countsBySource.project} 项目 • {countsBySource.extension}{' '}
              扩展
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3"
                aria-label="全部开启"
                onClick={() => void bulkToggleServers(true)}
                disabled={loading || !canBulkEnable}
              >
                全部开启
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3"
                aria-label="全部关闭"
                onClick={() => void bulkToggleServers(false)}
                disabled={loading || !canBulkDisable}
              >
                全部关闭
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => void loadRegistry({ forceRefresh: true })}
              disabled={loading}
            >
              刷新
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setMode({ type: 'raw' })}
            >
              查看项目 MCP 配置
            </Button>
          </div>
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', contentInset ? 'p-4 pb-8' : 'pb-8')}>
        <div className="space-y-5">
          {showHeading ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">MCP Server 列表</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  共 {registry.servers.length} 个，当前筛选后 {visibleServers.length} 个
                </div>
              </div>
            </div>
          ) : null}
          {error && mode.type !== 'detail' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && visibleServers.length === 0 ? (
            <UnifiedEmptyState
              title="没有找到 MCP 服务"
              description="请调整搜索词或筛选条件，然后再试一次。"
            />
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              {visibleServers.map((server) => (
                <McpCard
                  key={`${server.source}:${server.name}`}
                  server={server}
                  onOpen={() => setMode({ type: 'detail', serverName: server.name })}
                  onEdit={server.source === 'user' ? () => openEditForm(server) : undefined}
                  onDelete={server.source === 'user' ? () => void deleteServer(server) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={mode.type === 'detail'}
        onOpenChange={(open) => !open && setMode({ type: 'registry' })}
      >
        <DialogContent className="max-h-[88vh] w-[min(92vw,1040px)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 pr-12">
            <DialogTitle className="text-base">
              {mode.type === 'detail' ? mode.serverName : 'MCP 服务详情'}
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6">
              查看这个 MCP 服务的基础配置、来源和工具详情。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {mode.type === 'detail' && toolsState ? (
              (() => {
                const { server, tools } = toolsState;
                return (
                  <div className="space-y-5">
                    <section className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="flex size-11 items-center justify-center rounded-md border bg-background font-mono text-sm font-semibold">
                            {initials(server.name)}
                          </span>
                          <div>
                            <h2 className="text-2xl font-semibold">{server.name}</h2>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <Badge variant="outline">{server.type}</Badge>
                              <Badge variant="secondary">{serverSourceLabel(server)}</Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                          <span className="text-sm text-muted-foreground">
                            {server.disabled ? '已停用' : '已启用'}
                          </span>
                          <Switch
                            checked={!server.disabled}
                            onCheckedChange={(enabled) => void toggleServer(server, enabled)}
                            aria-label="切换 MCP 服务"
                          />
                          {!server.builtIn && server.source === 'project' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              onClick={() => void deleteServer(server)}
                              title="删除 MCP 服务"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                          {server.source === 'user' && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                onClick={() => openEditForm(server)}
                                title="编辑 MCP 服务"
                              >
                                <Settings className="size-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                onClick={() => void deleteServer(server)}
                                title="删除 MCP 服务"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            onClick={() => void loadTools(server.name)}
                            title="刷新工具"
                          >
                            <RefreshCw className="size-4" />
                          </Button>
                          {server.source === 'project' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              onClick={() => setMode({ type: 'raw' })}
                              title="编辑项目 MCP JSON"
                            >
                              <Settings className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                          连接
                        </div>
                        <div className="break-all font-mono">{serverEndpoint(server)}</div>
                      </div>
                      {server.source === 'user' && (
                        <div className="rounded-lg border bg-muted/35 p-3 text-sm text-muted-foreground">
                          这个服务来自 Claude CLI 全局配置。你可以在这里直接编辑或删除，
                          这些操作会改写
                          <span className="font-mono"> ~/.claude.json</span>；
                          启停仍然只影响当前项目的 override 状态。
                        </div>
                      )}
                    </section>

                    {error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                      </div>
                    )}

                    <section className="rounded-lg bg-muted/45 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Switch
                          checked={tools.length > 0 && tools.every((tool) => tool.enabled)}
                          onCheckedChange={(enabled) => {
                            tools.forEach((tool) => void toggleTool(tool, enabled));
                          }}
                          aria-label="切换全部工具"
                        />
                        <span className="font-medium">MCP 入口工具 ({tools.length})</span>
                      </div>
                      <div className="space-y-3">
                        {tools.length > 0 ? (
                          tools.map((tool) => (
                            <ToolRow
                              key={tool.fullName}
                              tool={tool}
                              onToggle={(enabled) => void toggleTool(tool, enabled)}
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                            暂未发现工具。请确认 MCP 服务已启动，或点击刷新重试。
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                );
              })()
            ) : (
              <div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">
                正在加载 MCP 服务详情...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
