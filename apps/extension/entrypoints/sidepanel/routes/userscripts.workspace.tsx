import { zodResolver } from '@hookform/resolvers/zod';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
  AlertCircle,
  Code2,
  FileCode,
  Globe,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import {
  type Control,
  type Resolver,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import { toast } from 'sonner';
import { UnifiedEmptyState } from '@/entrypoints/sidepanel/components/UnifiedEmptyState';
import { Alert, AlertDescription, AlertTitle } from '@/entrypoints/sidepanel/components/ui/alert';
import { Badge } from '@/entrypoints/sidepanel/components/ui/badge';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Card, CardContent } from '@/entrypoints/sidepanel/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/entrypoints/sidepanel/components/ui/form';
import { Input } from '@/entrypoints/sidepanel/components/ui/input';
import { ScrollArea } from '@/entrypoints/sidepanel/components/ui/scroll-area';
import { Skeleton } from '@/entrypoints/sidepanel/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/entrypoints/sidepanel/components/ui/tooltip';
import {
  buildRegisterPayload,
  buildUpdatePayload,
  createEmptyUserScriptFormValues,
  extractStoredUserScriptCode,
  getArrayFieldErrorMessage,
  getArrayFieldItemErrorMessage,
  mapScriptToFormValues,
  readStoredUserScriptCode,
  userScriptFormSchema,
  type UserScriptFormValues,
} from './userscripts.shared';
import { trpc } from '../lib/trpc_client';

type UserScriptListItem = {
  id: string;
  matches?: string[];
  excludeMatches?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  world?: 'MAIN' | 'USER_SCRIPT';
};

type UserScriptDetail = UserScriptListItem & {
  savedCode?: string | { content?: string } | null;
  worldId?: string;
};

type WorkspaceMode = 'view' | 'edit' | 'create';

type UserScriptsWorkspaceProps = {
  routeMode?: WorkspaceMode;
  routeScriptId?: string;
};

type PendingTransition =
  | { type: 'select-script'; scriptId: string | null }
  | { type: 'edit-script'; scriptId: string }
  | { type: 'create-script' };

type TransitionOrigin = 'manual' | 'auto-filter';

type PendingDelete = {
  scriptId: string;
  willDiscardUnsavedChanges: boolean;
};

type PendingSave = {
  mode: Extract<WorkspaceMode, 'create' | 'edit'>;
  scriptId: string;
  values: UserScriptFormValues;
  savedCode: string;
};

type PendingDeleteRequest = {
  scriptId: string;
  nextSelectedScriptId: string | null;
};

const userScriptFormResolver: Resolver<UserScriptFormValues> = async (
  values,
  context,
  options
) =>
  (zodResolver(userScriptFormSchema as never) as unknown as Resolver<UserScriptFormValues>)(
    values,
    context,
    options
  );

function normalizeFormValues(values: UserScriptFormValues): UserScriptFormValues {
  return {
    id: values.id ?? '',
    matches: values.matches ?? [''],
    excludeMatches: values.excludeMatches ?? [],
    runAt: values.runAt,
    allFrames: values.allFrames,
    world: values.world,
    worldId: values.worldId ?? '',
  };
}

function areFormValuesEqual(left: UserScriptFormValues, right: UserScriptFormValues) {
  return JSON.stringify(normalizeFormValues(left)) === JSON.stringify(normalizeFormValues(right));
}

function ReadOnlyCodeEditor({ value }: { value: string }) {
  return (
    <div className="min-h-[24rem] overflow-hidden rounded-md border bg-[#1f2430] [&_.cm-editor]:h-full [&_.cm-gutters]:border-r-[#2f3542] [&_.cm-scroller]:font-mono">
      <CodeMirror
        value={value}
        onChange={() => undefined}
        extensions={[javascript({ jsx: true }), EditorView.lineWrapping]}
        theme={oneDark}
        editable={false}
        height="100%"
        style={{
          minHeight: '24rem',
          width: '100%',
          fontSize: '13px',
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: true,
          closeBrackets: false,
          autocompletion: false,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}

function formatRunAt(value?: UserScriptListItem['runAt']) {
  if (!value) return '未设置';
  return value.replace('document_', '');
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getUserScriptsLoadErrorDetails(error: unknown) {
  const message = getErrorMessage(error, '未知错误');
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes('userscripts api is not available')) {
    return {
      summary: '当前浏览器没有向这个扩展开放用户脚本能力，所以暂时无法读取脚本列表。',
      steps: [
        '请打开：扩展程序 -> 本扩展的详情页。',
        '如果你使用较新的 Chrome，请开启“Allow User Scripts”。',
        '如果你使用较老版本的 Chrome，请开启“开发者模式（Developer mode）”。',
        '开启后返回这里，点击“重试”重新加载。',
      ],
    };
  }

  return {
    summary: message,
    steps: [],
  };
}

function getModeLabel(mode: WorkspaceMode) {
  if (mode === 'create') return '创建态';
  if (mode === 'edit') return '编辑态';
  return '查看态';
}

function getModeTitle(mode: WorkspaceMode) {
  if (mode === 'create') return '新建脚本';
  if (mode === 'edit') return '编辑脚本';
  return '脚本详情';
}

function getModeDescription(mode: WorkspaceMode) {
  if (mode === 'create') {
    return '工作台内直接填写基础信息，并在保存时注册新脚本。';
  }
  if (mode === 'edit') {
    return '支持直接更新当前脚本配置，并保留未保存更改保护。';
  }
  return '统一查看脚本信息和源码预览，支持从这里直接切换到编辑态。';
}

function getEditorPlaceholder(mode: WorkspaceMode) {
  if (mode === 'create') {
    return '// 保存时会读取同 ID 已保存到编辑器存储中的源码\n';
  }
  if (mode === 'edit') {
    return '// 当前脚本暂无保存的源码\n';
  }
  return '// 暂无脚本源码';
}

function getUserscriptStorageKey(scriptId: string) {
  return `webmcp:userscripts:${scriptId}`;
}

function getNextScriptIdAfterDelete(scripts: UserScriptListItem[], deletedScriptId: string) {
  const index = scripts.findIndex((script) => script.id === deletedScriptId);
  const remainingScripts = scripts.filter((script) => script.id !== deletedScriptId);

  if (remainingScripts.length === 0) {
    return null;
  }

  if (index < 0) {
    return remainingScripts[0]?.id ?? null;
  }

  return remainingScripts[Math.min(index, remainingScripts.length - 1)]?.id ?? null;
}

function createDraftScriptId() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  const randomSuffix = Math.random().toString(36).slice(2, 6);

  return `userscript-${year}${month}${day}-${hour}${minute}${second}-${randomSuffix}`;
}

function getSuggestedMatchPattern(url?: string) {
  if (!url) {
    return '<all_urls>';
  }

  try {
    const { hostname, protocol } = new URL(url);
    const isWeb = protocol === 'http:' || protocol === 'https:';
    return isWeb ? `*://${hostname}/*` : '<all_urls>';
  } catch {
    return '<all_urls>';
  }
}

function createDraftUserScriptFormValues() {
  return createEmptyUserScriptFormValues(createDraftScriptId());
}

function createOptimisticScriptDetail(
  values: UserScriptFormValues,
  savedCode: string
): UserScriptDetail {
  const matches = values.matches.map((value) => value.trim()).filter((value) => value.length > 0);
  const excludeMatches = (values.excludeMatches ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    id: values.id.trim(),
    matches,
    excludeMatches: excludeMatches.length > 0 ? excludeMatches : undefined,
    runAt: values.runAt,
    allFrames: values.allFrames,
    world: values.world,
    worldId: values.worldId?.trim() || undefined,
    savedCode,
  };
}

function PatternFields({
  control,
  label,
  name,
  fields,
  append,
  remove,
  errors,
}: {
  control: Control<UserScriptFormValues>;
  label: string;
  name: 'matches' | 'excludeMatches';
  fields: Array<{ id: string }>;
  append: (value: string) => void;
  remove: (index: number) => void;
  errors: unknown;
}) {
  const rootError = getArrayFieldErrorMessage(errors);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">
            {name === 'matches' ? '至少保留一条匹配规则。' : '可选，按需添加排除规则。'}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append('')}
        >
          <Plus className="mr-1 h-4 w-4" />
          添加
        </Button>
      </div>

      {fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <FormField
            control={control}
            name={`${name}.${index}` as const}
            render={({ field: inputField }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">{`${label} ${index + 1}`}</FormLabel>
                <FormControl>
                  <Input
                    {...inputField}
                    value={inputField.value ?? ''}
                    placeholder={name === 'matches' ? 'https://example.com/*' : 'https://example.com/admin/*'}
                  />
                </FormControl>
                <FormMessage>{getArrayFieldItemErrorMessage(errors, index)}</FormMessage>
              </FormItem>
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`删除${label}${index + 1}`}
            disabled={name === 'matches' && fields.length === 1}
            onClick={() => remove(index)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {rootError ? <div className="text-sm text-destructive">{rootError}</div> : null}
    </div>
  );
}

export function UserScriptsWorkspace({
  routeMode,
  routeScriptId,
}: UserScriptsWorkspaceProps = {}) {
  const editFormId = React.useId();
  const initialMode: WorkspaceMode =
    routeMode === 'create' ? 'create' : routeMode === 'edit' ? 'edit' : 'view';
  const initialFormValues =
    routeMode === 'create' ? createDraftUserScriptFormValues() : createEmptyUserScriptFormValues();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedScriptId, setSelectedScriptId] = React.useState<string | null>(routeScriptId ?? null);
  const [mode, setMode] = React.useState<WorkspaceMode>(initialMode);
  const [pendingTransition, setPendingTransition] = React.useState<PendingTransition | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);
  const [optimisticSelectedScript, setOptimisticSelectedScript] =
    React.useState<UserScriptDetail | null>(null);
  const [pendingTransitionOrigin, setPendingTransitionOrigin] =
    React.useState<TransitionOrigin | null>(null);
  const [suppressAutoFilterTransition, setSuppressAutoFilterTransition] = React.useState(false);
  const handleSearchQueryChange = React.useCallback((value: string) => {
    setSuppressAutoFilterTransition(false);
    setSearchQuery(value);
  }, []);

  const form = useForm<UserScriptFormValues>({
    resolver: userScriptFormResolver,
    defaultValues: initialFormValues,
    mode: 'onSubmit',
  });
  const [formBaseline, setFormBaseline] = React.useState<UserScriptFormValues>(initialFormValues);
  const [formSnapshot, setFormSnapshot] = React.useState<UserScriptFormValues>(initialFormValues);
  const formBaselineRef = React.useRef<UserScriptFormValues>(initialFormValues);
  const lastHydratedTargetRef = React.useRef<string | null>(null);
  const lastHydratedSourceRef = React.useRef<UserScriptDetail | UserScriptListItem | null>(null);
  const pendingSaveRef = React.useRef<PendingSave | null>(null);
  const pendingDeleteRef = React.useRef<PendingDeleteRequest | null>(null);
  const resetWorkspaceForm = React.useCallback(
    (values: UserScriptFormValues) => {
      const normalized = normalizeFormValues(values);
      formBaselineRef.current = normalized;
      setFormBaseline(normalized);
      setFormSnapshot(normalized);
      form.reset(normalized);
    },
    [form]
  );

  React.useEffect(() => {
    const subscription = form.watch((values) => {
      setFormSnapshot(normalizeFormValues(values as UserScriptFormValues));
    });

    return () => subscription.unsubscribe();
  }, [form]);

  const matchFieldArray = useFieldArray({
    control: form.control as never,
    name: 'matches' as never,
  });
  const matchFields = matchFieldArray.fields as Array<{ id: string }>;
  const appendMatch = matchFieldArray.append as (value: string) => void;
  const removeMatch = matchFieldArray.remove as (index: number) => void;

  const excludeFieldArray = useFieldArray({
    control: form.control as never,
    name: 'excludeMatches' as never,
  });
  const excludeFields = excludeFieldArray.fields as Array<{ id: string }>;
  const appendExclude = excludeFieldArray.append as (value: string) => void;
  const removeExclude = excludeFieldArray.remove as (index: number) => void;

  const {
    data: scripts = [],
    refetch,
    isLoading,
    isError,
    error,
  } = trpc.userScripts.getAllScripts.useQuery();

  const filteredScripts = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return scripts as UserScriptListItem[];
    }
    return (scripts as UserScriptListItem[]).filter((script) => {
      if (script.id.toLowerCase().includes(query)) {
        return true;
      }
      return script.matches?.some((pattern) => pattern.toLowerCase().includes(query)) ?? false;
    });
  }, [scripts, searchQuery]);

  const selectedScriptSummary = React.useMemo(
    () => (scripts as UserScriptListItem[]).find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId]
  );

  const {
    data: selectedScript,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
    refetch: refetchSelectedScript,
  } = trpc.userScripts.getScript.useQuery(
    { id: selectedScriptId ?? '' },
    { enabled: Boolean(selectedScriptId) }
  );

  const effectiveSelectedScript = React.useMemo(() => {
    if (optimisticSelectedScript && optimisticSelectedScript.id === selectedScriptId) {
      return optimisticSelectedScript;
    }

    return (selectedScript as UserScriptDetail | null | undefined) ?? null;
  }, [optimisticSelectedScript, selectedScript, selectedScriptId]);

  const effectiveSelectedScriptSummary = React.useMemo(() => {
    if (optimisticSelectedScript && optimisticSelectedScript.id === selectedScriptId) {
      return optimisticSelectedScript;
    }

    return selectedScriptSummary;
  }, [optimisticSelectedScript, selectedScriptId, selectedScriptSummary]);

  const finalizeWorkspaceRefresh = React.useCallback(
    async (refreshDetail: boolean) => {
      const tasks: Array<Promise<unknown>> = [Promise.resolve(refetch())];
      if (refreshDetail) {
        tasks.push(Promise.resolve(refetchSelectedScript()));
      }
      await Promise.allSettled(tasks);
    },
    [refetch, refetchSelectedScript]
  );

  const settleAfterSave = React.useCallback(
    async (refreshDetail: boolean) => {
      const pendingSave = pendingSaveRef.current;
      pendingSaveRef.current = null;

      if (!pendingSave) {
        await finalizeWorkspaceRefresh(refreshDetail);
        return;
      }

      const normalizedValues = normalizeFormValues({
        ...pendingSave.values,
        id: pendingSave.scriptId,
      });
      const optimisticScript = createOptimisticScriptDetail(
        normalizedValues,
        pendingSave.savedCode
      );

      lastHydratedTargetRef.current = `view:${pendingSave.scriptId}`;
      lastHydratedSourceRef.current = optimisticScript;
      setOptimisticSelectedScript(optimisticScript);
      resetWorkspaceForm(normalizedValues);
      setSelectedScriptId(pendingSave.scriptId);
      setMode('view');
      setPendingTransition(null);
      setPendingTransitionOrigin(null);
      setSuppressAutoFilterTransition(false);

      await finalizeWorkspaceRefresh(refreshDetail);
    },
    [finalizeWorkspaceRefresh, resetWorkspaceForm]
  );

  const settleAfterDelete = React.useCallback(async () => {
    const pendingDeleteRequest = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    setPendingDelete(null);

    if (pendingDeleteRequest && selectedScriptId === pendingDeleteRequest.scriptId) {
      lastHydratedTargetRef.current = `view:${pendingDeleteRequest.nextSelectedScriptId ?? ''}`;
      lastHydratedSourceRef.current = null;
      setOptimisticSelectedScript(null);
      setSelectedScriptId(pendingDeleteRequest.nextSelectedScriptId);
      if (mode !== 'create') {
        setMode('view');
      }
      setPendingTransition(null);
      setPendingTransitionOrigin(null);
      setSuppressAutoFilterTransition(false);
    }

    await finalizeWorkspaceRefresh(false);
  }, [finalizeWorkspaceRefresh, mode, selectedScriptId]);

  const registerScript = trpc.userScripts.registerScript.useMutation({
    onSuccess: async () => {
      toast.success('脚本已保存');
      await settleAfterSave(false);
    },
    onError: (mutationError) => {
      pendingSaveRef.current = null;
      toast.error('创建脚本失败', {
        description: getErrorMessage(mutationError, '未知错误'),
      });
    },
  });

  const updateScript = trpc.userScripts.updateScript.useMutation({
    onSuccess: async () => {
      toast.success('脚本已更新');
      await settleAfterSave(true);
    },
    onError: (mutationError) => {
      pendingSaveRef.current = null;
      toast.error('更新脚本失败', {
        description: getErrorMessage(mutationError, '未知错误'),
      });
    },
  });

  const deleteScript = trpc.userScripts.deleteScript.useMutation({
    onSuccess: async () => {
      toast.success('脚本已删除');
      await settleAfterDelete();
    },
    onError: (mutationError) => {
      pendingDeleteRef.current = null;
      toast.error('删除脚本失败', {
        description: getErrorMessage(mutationError, '未知错误'),
      });
    },
  });

  const codeContent = React.useMemo(() => {
    if (mode === 'create') {
      return getEditorPlaceholder(mode);
    }

    return (
      extractStoredUserScriptCode(effectiveSelectedScript?.savedCode) ?? getEditorPlaceholder(mode)
    );
  }, [effectiveSelectedScript, mode]);

  const currentFormValues = formSnapshot;
  const hasUnsavedChanges =
    (mode === 'edit' || mode === 'create') && !areFormValuesEqual(currentFormValues, formBaseline);
  const computeHasUnsavedChanges = React.useCallback(() => {
    if (mode !== 'edit' && mode !== 'create') {
      return false;
    }

    return !areFormValuesEqual(
      normalizeFormValues(form.getValues()),
      normalizeFormValues(formBaselineRef.current)
    );
  }, [form, mode]);

  const handleSaveScript = React.useCallback(
    async (values: UserScriptFormValues) => {
      const liveValues = normalizeFormValues(form.getValues());
      const effectiveValues: UserScriptFormValues = {
        ...values,
        ...liveValues,
      };
      const scriptId = effectiveValues.id.trim();
      const storageKey = getUserscriptStorageKey(scriptId);
      let codeFromStorage: string | undefined;

      try {
        codeFromStorage = await readStoredUserScriptCode(storageKey);
      } catch {
        codeFromStorage = undefined;
      }

      if ((!codeFromStorage || codeFromStorage.trim().length === 0) && mode === 'edit') {
        codeFromStorage = extractStoredUserScriptCode(
          (selectedScript as UserScriptDetail | null | undefined)?.savedCode
        );
      }

      if (!codeFromStorage || codeFromStorage.trim().length === 0) {
        toast.error('未找到可保存的脚本源码', {
          description:
            mode === 'create'
              ? '请先在编辑器中保存同 ID 的源码，再回到工作台完成创建。'
              : '请先在编辑器中保存源码后再更新脚本。',
        });
        return;
      }

      pendingSaveRef.current = {
        mode: mode === 'create' ? 'create' : 'edit',
        scriptId,
        values: normalizeFormValues({
          ...effectiveValues,
          id: scriptId,
        }),
        savedCode: codeFromStorage,
      };

      if (mode === 'create') {
        registerScript.mutate(buildRegisterPayload(effectiveValues, codeFromStorage));
        return;
      }

      updateScript.mutate(buildUpdatePayload(effectiveValues, codeFromStorage));
    },
    [form, mode, registerScript, selectedScript, updateScript]
  );

  const requestDeleteScript = React.useCallback((scriptId: string) => {
    setPendingDelete({
      scriptId,
      willDiscardUnsavedChanges: scriptId === selectedScriptId && computeHasUnsavedChanges(),
    });
  }, [computeHasUnsavedChanges, selectedScriptId]);

  const confirmDeleteScript = React.useCallback(() => {
    if (!pendingDelete) {
      return;
    }

    pendingDeleteRef.current = {
      scriptId: pendingDelete.scriptId,
      nextSelectedScriptId: getNextScriptIdAfterDelete(
        filteredScripts,
        pendingDelete.scriptId
      ),
    };
    deleteScript.mutate({ id: pendingDelete.scriptId });
  }, [deleteScript, filteredScripts, pendingDelete]);

  const isSavingScript = registerScript.isPending || updateScript.isPending;

  React.useEffect(() => {
    const targetKey = mode === 'create' ? 'create' : `${mode}:${selectedScriptId ?? ''}`;
    const isSameTarget = lastHydratedTargetRef.current === targetKey;
    const sourceData =
      (effectiveSelectedScript ?? effectiveSelectedScriptSummary) as
        | UserScriptDetail
        | UserScriptListItem
        | null;
    const isSameSource = lastHydratedSourceRef.current === sourceData;

    if (mode === 'create') {
      if (isSameTarget) {
        return;
      }

      resetWorkspaceForm(createDraftUserScriptFormValues());
      lastHydratedTargetRef.current = targetKey;
      lastHydratedSourceRef.current = null;
      return;
    }

    if (!effectiveSelectedScriptSummary) {
      if (isSameTarget) {
        return;
      }

      resetWorkspaceForm(createEmptyUserScriptFormValues());
      lastHydratedTargetRef.current = targetKey;
      lastHydratedSourceRef.current = null;
      return;
    }

    if (isSameTarget && (hasUnsavedChanges || isSameSource)) {
      return;
    }

    resetWorkspaceForm(
      mapScriptToFormValues(effectiveSelectedScript ?? effectiveSelectedScriptSummary)
    );
    lastHydratedTargetRef.current = targetKey;
    lastHydratedSourceRef.current = sourceData;
  }, [
    effectiveSelectedScript,
    effectiveSelectedScriptSummary,
    hasUnsavedChanges,
    mode,
    resetWorkspaceForm,
    selectedScriptId,
  ]);

  React.useEffect(() => {
    if (!optimisticSelectedScript || optimisticSelectedScript.id !== selectedScriptId) {
      return;
    }

    const latestScript = selectedScript as UserScriptDetail | null | undefined;
    if (!latestScript) {
      return;
    }

    const hasMatchedFormValues = areFormValuesEqual(
      mapScriptToFormValues(latestScript),
      mapScriptToFormValues(optimisticSelectedScript)
    );
    const hasMatchedCode =
      extractStoredUserScriptCode(latestScript.savedCode) ===
      extractStoredUserScriptCode(optimisticSelectedScript.savedCode);

    if (hasMatchedFormValues && hasMatchedCode) {
      setOptimisticSelectedScript(null);
    }
  }, [optimisticSelectedScript, selectedScript, selectedScriptId]);

  React.useEffect(() => {
    if (mode !== 'edit' || !hasUnsavedChanges) {
      setSuppressAutoFilterTransition(false);
    }
  }, [hasUnsavedChanges, mode]);

  React.useEffect(() => {
    if (routeMode === 'create') {
      lastHydratedTargetRef.current = 'create';
      lastHydratedSourceRef.current = null;
      setOptimisticSelectedScript(null);
      resetWorkspaceForm(createDraftUserScriptFormValues());
      setMode('create');
      return;
    }

    if (!routeScriptId) {
      return;
    }

    lastHydratedTargetRef.current = null;
    lastHydratedSourceRef.current = null;
    setOptimisticSelectedScript(null);
    setSelectedScriptId(routeScriptId);
    setMode(routeMode === 'edit' ? 'edit' : 'view');
  }, [resetWorkspaceForm, routeMode, routeScriptId]);

  React.useEffect(() => {
    if (mode !== 'create') {
      return;
    }

    const currentMatches = form.getValues('matches') ?? [];
    if (currentMatches.some((value) => value.trim().length > 0)) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!active) {
          return;
        }

        form.setValue('matches', [getSuggestedMatchPattern(tabs?.[0]?.url)], {
          shouldDirty: false,
          shouldValidate: true,
        });
      } catch {
        if (!active) {
          return;
        }

        form.setValue('matches', ['<all_urls>'], {
          shouldDirty: false,
          shouldValidate: true,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [form, mode]);

  const applyTransition = React.useCallback(
    (transition: PendingTransition) => {
      setSuppressAutoFilterTransition(false);

      if (transition.type === 'create-script') {
        lastHydratedTargetRef.current = 'create';
        setOptimisticSelectedScript(null);
        resetWorkspaceForm(createDraftUserScriptFormValues());
        setMode('create');
        return;
      }

      if (transition.type === 'edit-script') {
        if (transition.scriptId !== optimisticSelectedScript?.id) {
          setOptimisticSelectedScript(null);
        }
        setSelectedScriptId(transition.scriptId);
        setMode('edit');
        return;
      }

      if (transition.scriptId !== optimisticSelectedScript?.id) {
        setOptimisticSelectedScript(null);
      }
      setSelectedScriptId(transition.scriptId);
      setMode('view');
    },
    [optimisticSelectedScript?.id, resetWorkspaceForm]
  );

  const requestTransition = React.useCallback(
    (transition: PendingTransition, origin: TransitionOrigin = 'manual') => {
      const hasLiveUnsavedChanges = computeHasUnsavedChanges();
      if (
        transition.type === 'select-script' &&
        transition.scriptId === selectedScriptId &&
        mode === 'view'
      ) {
        return;
      }

      if (
        transition.type === 'edit-script' &&
        transition.scriptId === selectedScriptId &&
        mode === 'edit'
      ) {
        return;
      }

      if (transition.type === 'create-script' && mode === 'create' && !hasLiveUnsavedChanges) {
        return;
      }

      if (hasLiveUnsavedChanges) {
        setPendingTransitionOrigin(origin);
        setPendingTransition((current) => {
          const isSameTransition =
            current?.type === transition.type &&
            (transition.type === 'create-script' ||
              ('scriptId' in current &&
                'scriptId' in transition &&
                current.scriptId === transition.scriptId));

          if (isSameTransition) {
            return current;
          }
          return transition;
        });
        return;
      }

      setPendingTransition(null);
      setPendingTransitionOrigin(null);
      applyTransition(transition);
    },
    [applyTransition, computeHasUnsavedChanges, mode, selectedScriptId]
  );

  React.useEffect(() => {
    const hasLiveUnsavedChanges = computeHasUnsavedChanges();

    if (pendingTransition || suppressAutoFilterTransition || mode === 'create') {
      return;
    }

    if (optimisticSelectedScript && optimisticSelectedScript.id === selectedScriptId) {
      return;
    }

    const selectedVisible =
      selectedScriptId !== null && filteredScripts.some((script) => script.id === selectedScriptId);
    if (selectedVisible) {
      return;
    }

    const nextScriptId = filteredScripts[0]?.id ?? null;
    if (selectedScriptId === nextScriptId) {
      return;
    }

    if (mode === 'view') {
      requestTransition({ type: 'select-script', scriptId: nextScriptId }, 'auto-filter');
      return;
    }

    if (mode === 'edit') {
      if (hasLiveUnsavedChanges) {
        requestTransition({ type: 'select-script', scriptId: nextScriptId }, 'auto-filter');
        return;
      }

      if (nextScriptId) {
        applyTransition({ type: 'edit-script', scriptId: nextScriptId });
        return;
      }

      applyTransition({ type: 'select-script', scriptId: null });
    }
  }, [
    applyTransition,
    computeHasUnsavedChanges,
    filteredScripts,
    mode,
    pendingTransition,
    requestTransition,
    selectedScriptId,
    suppressAutoFilterTransition,
    optimisticSelectedScript,
  ]);

  const detailTitleId = React.useId();

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[320px_1fr] gap-0 overflow-hidden">
      <section className="flex min-h-0 flex-col border-r pr-4">
        <div className="shrink-0">
          <div className="mb-3 flex h-10 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
              <FileCode className="h-4 w-4 text-amber-600" />
              脚本列表
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{filteredScripts.length}</Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="新建脚本"
                    onClick={() => requestTransition({ type: 'create-script' })}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新建脚本</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="sticky top-0 z-10 mb-2 bg-background pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => handleSearchQueryChange(event.target.value)}
                onInput={(event) =>
                  handleSearchQueryChange((event.target as HTMLInputElement).value)
                }
                placeholder="搜索脚本 ID 或匹配规则"
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-2.75rem)]">
            {isError ? (
              <Alert variant="destructive" className="mr-1">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>脚本列表加载失败</AlertTitle>
                <AlertDescription className="mt-2 space-y-3">
                  <div className="space-y-1 text-sm">
                    <p>{getUserScriptsLoadErrorDetails(error).summary}</p>
                    {getUserScriptsLoadErrorDetails(error).steps.map((step) => (
                      <p key={step}>{step}</p>
                    ))}
                  </div>
                  <span className="">{getErrorMessage(error, '未知错误')}</span>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    重试
                  </Button>
                </AlertDescription>
              </Alert>
            ) : isLoading ? (
              <div className="mr-1 space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="rounded-md border px-3 py-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-full" />
                    <Skeleton className="mt-1 h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : filteredScripts.length === 0 ? (
              <UnifiedEmptyState
                className="mr-1 rounded-md border border-dashed"
                minHeightClassName="min-h-[16rem]"
                title={searchQuery ? '没有匹配的脚本' : '还没有用户脚本'}
                description={
                  searchQuery ? '换个关键字试试。' : '点击上方新建后，这里会集中展示你的用户脚本。'
                }
              />
            ) : (
              <div className="mr-1 space-y-2">
                {filteredScripts.map((script) => {
                  const isSelected = script.id === selectedScriptId && mode !== 'create';
                  return (
                    <div
                      key={script.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`userscript-list-item-${script.id}`}
                      className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'border-primary/50 bg-primary/8'
                          : 'bg-background hover:bg-muted/40'
                      }`}
                      onClick={() =>
                        requestTransition({ type: 'select-script', scriptId: script.id })
                      }
                      onKeyDown={(event) => {
                        if (event.currentTarget !== event.target) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          requestTransition({ type: 'select-script', scriptId: script.id });
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="truncate text-sm font-medium">{script.id}</div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {script.matches?.join(', ') || '未配置匹配规则'}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {formatRunAt(script.runAt)}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {script.world ?? 'USER_SCRIPT'}
                            </Badge>
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`编辑 ${script.id}`}
                                onClick={() =>
                                  requestTransition({ type: 'edit-script', scriptId: script.id })
                                }
                              >
                                <PencilLine className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>编辑</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`删除 ${script.id}`}
                                onClick={() => requestDeleteScript(script.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col pl-4">
        <div className="shrink-0">
          <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div id={detailTitleId} className="text-sm font-semibold">
                  {getModeTitle(mode)}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {getModeLabel(mode)}
                </Badge>
                {mode !== 'create' && effectiveSelectedScriptSummary ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {effectiveSelectedScriptSummary.id}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {getModeDescription(mode)}
              </div>
            </div>
            {mode === 'view' && effectiveSelectedScriptSummary ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="删除当前脚本"
                  onClick={() => requestDeleteScript(effectiveSelectedScriptSummary.id)}
                >
                  <Trash2 className="mr-1 h-4 w-4 text-destructive" />
                  删除
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    requestTransition({
                      type: 'edit-script',
                      scriptId: effectiveSelectedScriptSummary.id,
                    })
                  }
                >
                  <PencilLine className="mr-1 h-4 w-4" />
                  编辑
                </Button>
              </div>
            ) : null}
            {(mode === 'create' || mode === 'edit') ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
                {hasUnsavedChanges ? (
                  <Badge variant="outline" className="text-[10px]">
                    有未保存更改
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    未修改
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    requestTransition({
                      type: 'select-script',
                      scriptId: selectedScriptId,
                    })
                  }
                >
                  取消
                </Button>
                <Button type="submit" size="sm" form={editFormId} disabled={isSavingScript}>
                  保存脚本
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-3">
            {pendingDelete ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {pendingDelete.willDiscardUnsavedChanges
                    ? '确认删除并放弃当前未保存更改？'
                    : pendingDelete.scriptId === selectedScriptId
                      ? '确认删除当前脚本？'
                      : '确认删除脚本？'}
                </AlertTitle>
                <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-muted-foreground">
                    {pendingDelete.willDiscardUnsavedChanges
                      ? `删除后会直接放弃当前表单里的未保存更改，并刷新列表与右侧详情。当前目标：${pendingDelete.scriptId}`
                      : `删除后会刷新列表与右侧详情，且无法恢复。当前目标：${pendingDelete.scriptId}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingDelete(null)}
                    >
                      取消
                    </Button>
                    <Button size="sm" onClick={confirmDeleteScript}>
                      {pendingDelete.willDiscardUnsavedChanges ? '确认删除并放弃更改' : '确认删除'}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {pendingTransition ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>放弃未保存更改？</AlertTitle>
                <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-muted-foreground">
                    当前有未保存更改。你可以继续编辑，或明确放弃本次修改后再切换。
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (pendingTransitionOrigin === 'auto-filter') {
                          setSuppressAutoFilterTransition(true);
                        }
                        setPendingTransitionOrigin(null);
                        setPendingTransition(null);
                      }}
                    >
                      继续编辑
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPendingTransitionOrigin(null);
                        applyTransition(pendingTransition);
                        setPendingTransition(null);
                      }}
                    >
                      放弃更改
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {mode === 'view' && !effectiveSelectedScriptSummary ? (
              <UnifiedEmptyState
                minHeightClassName="min-h-[24rem]"
                title="请选择用户脚本"
                description="从左侧选择一个脚本后，这里会显示详情和源码预览。"
              />
            ) : mode === 'view' ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <Card className="border-dashed">
                    <CardContent className="flex items-center gap-3 p-3">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">匹配规则</div>
                        <div className="truncate text-sm font-medium">
                          {effectiveSelectedScriptSummary!.matches?.length ?? 0} 条
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-dashed">
                    <CardContent className="flex items-center gap-3 p-3">
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">执行时机</div>
                        <div className="truncate text-sm font-medium">
                          {formatRunAt(effectiveSelectedScriptSummary!.runAt)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-dashed">
                    <CardContent className="flex items-center gap-3 p-3">
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">执行世界</div>
                        <div className="truncate text-sm font-medium">
                          {effectiveSelectedScriptSummary!.world ?? 'USER_SCRIPT'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">匹配规则</div>
                  <div className="flex flex-wrap gap-2">
                    {effectiveSelectedScriptSummary!.matches?.map((pattern) => (
                      <Badge key={pattern} variant="outline" className="max-w-full truncate">
                        {pattern}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 min-h-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">源码预览</div>
                    <Badge variant="secondary" className="text-[10px]">
                      只读
                    </Badge>
                  </div>
                  {isDetailLoading ? (
                    <Skeleton className="h-[24rem] w-full rounded-md" />
                  ) : isDetailError ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>脚本详情加载失败</AlertTitle>
                      <AlertDescription>
                        {getErrorMessage(detailError, '请稍后重试或重新选择脚本。')}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <ReadOnlyCodeEditor value={codeContent} />
                  )}
                </div>
              </>
            ) : (
              <Form {...form}>
                <form
                  id={editFormId}
                  className="flex min-h-0 flex-1 flex-col gap-3"
                  onSubmit={form.handleSubmit(handleSaveScript)}
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>脚本 ID</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ''}
                                disabled={mode === 'edit'}
                                placeholder="my-userscript"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <PatternFields
                        control={form.control}
                        label="匹配规则"
                        name="matches"
                        fields={matchFields}
                        append={appendMatch}
                        remove={removeMatch}
                        errors={form.formState.errors.matches}
                      />

                      <PatternFields
                        control={form.control}
                        label="排除规则"
                        name="excludeMatches"
                        fields={excludeFields}
                        append={appendExclude}
                        remove={removeExclude}
                        errors={form.formState.errors.excludeMatches}
                      />

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">源码预览</div>
                          <Badge variant="secondary" className="text-[10px]">
                            只读
                          </Badge>
                        </div>
                        {mode === 'edit' && isDetailLoading ? (
                          <Skeleton className="h-[20rem] w-full rounded-md" />
                        ) : (
                          <ReadOnlyCodeEditor value={codeContent} />
                        )}
                        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          保存时会读取同 ID 在编辑器存储中的源码；编辑态若未找到新源码，会沿用当前已保存源码。
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 xl:sticky xl:top-0">
                      <Card className="border-dashed">
                        <CardContent className="space-y-3 p-3">
                          <FormField
                            control={form.control}
                            name="runAt"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>执行时机</FormLabel>
                                <FormControl>
                                  <select
                                    className="border-input dark:bg-input/30 flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                                    value={field.value}
                                    onChange={(event) => field.onChange(event.target.value)}
                                  >
                                    <option value="document_start">document_start</option>
                                    <option value="document_end">document_end</option>
                                    <option value="document_idle">document_idle</option>
                                  </select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="world"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>执行世界</FormLabel>
                                <FormControl>
                                  <select
                                    className="border-input dark:bg-input/30 flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                                    value={field.value}
                                    onChange={(event) => field.onChange(event.target.value)}
                                  >
                                    <option value="MAIN">MAIN</option>
                                    <option value="USER_SCRIPT">USER_SCRIPT</option>
                                  </select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="worldId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>World ID</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={field.value ?? ''}
                                    placeholder="可选"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="allFrames"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                                <div className="space-y-1">
                                  <FormLabel>全部 frame 生效</FormLabel>
                                  <div className="text-xs text-muted-foreground">
                                    打开后会对匹配页面中的所有 frame 生效。
                                  </div>
                                </div>
                                <FormControl>
                                  <input
                                    type="checkbox"
                                    aria-label="全部 frame 生效"
                                    checked={field.value}
                                    onChange={(event) => field.onChange(event.target.checked)}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </form>
              </Form>
            )}
        </div>
      </section>
    </div>
  );
}
