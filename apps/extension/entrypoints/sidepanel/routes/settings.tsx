import { json as jsonLanguage } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import CodeMirror from '@uiw/react-codemirror';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ManagementMode,
  ManagementWorkspace,
} from '@/entrypoints/sidepanel/components/settings/ManagementWorkspace';
import { Badge } from '@/entrypoints/sidepanel/components/ui/badge';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Input } from '@/entrypoints/sidepanel/components/ui/input';
import { Label } from '@/entrypoints/sidepanel/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/entrypoints/sidepanel/components/ui/select';
import { Textarea } from '@/entrypoints/sidepanel/components/ui/textarea';
import { createAgentV2Client } from '../lib/agent-v2/client';
import {
  OFFICIAL_MODEL_GATEWAY_BASE_URL,
  createDefaultUserClaudeSettingsJson,
  hasStoredProjectModelConfig,
  hydrateModelConfig,
  inferModelConfigMode,
  normalizeModelConfigForSubmit,
  normalizeUserClaudeSettingsJson,
  probeBootstrapModelAccess,
  readBootstrapModelAccessSnapshot,
  trimOptionalValue,
} from '../lib/model-access-bootstrap';
import { deriveModelAccessViewState, type ModelSourceProbeStatus } from '../lib/model-access-state';
import { publishModelAccessChanged, subscribeModelAccessChanged } from '../lib/model-access-events';
import { readAgentV2ProjectSelection } from '../lib/agent-v2/session-selection';
import { localizeUserFacingError } from '../lib/user-facing-error';
import type {
  AgentAuthSource,
  AgentDetectedModelConfig,
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigRuntimeInfo,
  AgentOfficialModelCatalogItem,
  AgentOfficialQuota,
  AgentUserClaudeSettingsSnapshot,
} from '../lib/agent-v2/types';
import { config } from '../lib/config';
import { defaultModelConfig, OPENAI_MODELS } from '../lib/modelConfig';
import { cn } from '../lib/utils';
import { AgentWorkspacesContent } from './agent-workspaces';
import { McpSettingsContent } from './mcp.index';
import { UserScriptsWorkspace } from './userscripts.workspace';

type SettingsMode = 'model' | 'mcp' | 'workspace' | 'userscripts' | ManagementMode;

type SettingsSearch = {
  mode: SettingsMode;
  projectPath?: string;
  entryPath?: string;
};

const settingsModeLabels: Record<SettingsMode, string> = {
  model: '模型设置',
  mcp: 'MCP 管理',
  workspace: '工作区管理',
  userscripts: '用户脚本',
  plugins: '插件管理',
  skills: '技能管理',
  commands: '命令管理',
  hooks: '钩子管理',
};

const primarySettingsModes: SettingsMode[] = ['workspace'];
const secondarySettingsModes: SettingsMode[] = [
  'model',
  'mcp',
  'skills',
  'plugins',
  'commands',
  'hooks',
  'userscripts',
];
const orderedSettingsModes: SettingsMode[] = [...primarySettingsModes, ...secondarySettingsModes];

const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro';
const COMPANY_GATEWAY_PRESET_CONFIG: AgentDetectedModelConfig = {
  configMode: 'official',
  modelProvider: 'anthropic',
  providerVariant: 'standard',
  anthropicBaseUrl: OFFICIAL_MODEL_GATEWAY_BASE_URL,
  anthropicModelName: '',
};

const QUICK_MODEL_PRESETS: Array<{
  id: string;
  label: string;
  config: AgentDetectedModelConfig;
}> = [
  {
    id: 'annto',
    label: '公司网关',
    config: COMPANY_GATEWAY_PRESET_CONFIG,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    config: {
      configMode: 'third_party',
      modelProvider: 'anthropic',
      providerVariant: 'standard',
      anthropicBaseUrl: DEEPSEEK_ANTHROPIC_BASE_URL,
      anthropicModelName: DEEPSEEK_DEFAULT_MODEL,
    },
  },
  {
    id: 'zhipu',
    label: '智谱',
    config: {
      configMode: 'third_party',
      modelProvider: 'openai',
      providerVariant: 'standard',
      openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      openaiModelName: 'glm-5.1',
    },
  },
  {
    id: 'minmax',
    label: 'MinMax',
    config: {
      configMode: 'third_party',
      modelProvider: 'openai',
      providerVariant: 'standard',
      openaiBaseUrl: 'https://api.minimax.io/v1',
      openaiModelName: 'MiniMax-M2.7',
    },
  },
];

function normalizeSettingsMode(value: unknown): SettingsMode {
  return value === 'mcp' ||
    value === 'workspace' ||
    value === 'userscripts' ||
    value === 'plugins' ||
    value === 'skills' ||
    value === 'commands' ||
    value === 'hooks'
    ? value
    : 'model';
}

export { trimOptionalValue } from '../lib/model-access-bootstrap';

function isOfficialGatewayBaseUrl(value: string | undefined): boolean {
  const normalizedValue = trimOptionalValue(value);
  return (
    normalizedValue === OFFICIAL_MODEL_GATEWAY_BASE_URL ||
    normalizedValue === `${OFFICIAL_MODEL_GATEWAY_BASE_URL}/v1`
  );
}

function isDeepSeekAnthropicBaseUrl(value: string | undefined): boolean {
  return trimOptionalValue(value) === DEEPSEEK_ANTHROPIC_BASE_URL;
}

function buildDefaultModelConfig(): AgentModelConfig {
  const baseConfig = hydrateModelConfig({
    modelProvider: defaultModelConfig.modelProvider,
    openaiModelName: defaultModelConfig.openaiModelName,
    openaiApiKey: defaultModelConfig.openaiApiKey,
    openaiBaseUrl: defaultModelConfig.openaiBaseUrl,
    anthropicModelName: defaultModelConfig.anthropicModelName,
    anthropicApiKey: defaultModelConfig.anthropicApiKey,
    anthropicBaseUrl: defaultModelConfig.anthropicBaseUrl,
    providerVariant: defaultModelConfig.providerVariant,
  });
  return applyDetectedConfigToLocalConfig(baseConfig, COMPANY_GATEWAY_PRESET_CONFIG);
}

function applyDetectedConfigToLocalConfig(
  current: AgentModelConfig,
  detectedConfig: AgentDetectedModelConfig
): AgentModelConfig {
  const nextConfig: AgentModelConfig = {
    ...current,
    ...detectedConfig,
    configMode: inferModelConfigMode(detectedConfig),
    modelProvider: detectedConfig.modelProvider,
    providerVariant: detectedConfig.providerVariant ?? current.providerVariant ?? 'standard',
  };

  if (detectedConfig.modelProvider === 'openai') {
    nextConfig.openaiModelName = detectedConfig.openaiModelName ?? current.openaiModelName;
    nextConfig.openaiBaseUrl = detectedConfig.openaiBaseUrl ?? current.openaiBaseUrl;
    nextConfig.openaiApiKey = detectedConfig.openaiApiKey ?? current.openaiApiKey;
  } else {
    nextConfig.anthropicModelName = detectedConfig.anthropicModelName ?? current.anthropicModelName;
    nextConfig.anthropicBaseUrl = detectedConfig.anthropicBaseUrl ?? current.anthropicBaseUrl;
    nextConfig.anthropicApiKey = detectedConfig.anthropicApiKey ?? current.anthropicApiKey;
  }

  return hydrateModelConfig(nextConfig);
}

function canUseCodeMirrorEditor() {
  return (
    typeof window !== 'undefined' &&
    typeof window.MutationObserver !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  );
}

function resolveSelectedSourceAvailability(input: {
  selectedAuthSource: AgentAuthSource | null;
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
}): boolean {
  const runtimeMatchesSelectedSource =
    input.runtimeInfo?.selectedAuthSource === input.selectedAuthSource;

  if (input.selectedAuthSource === 'user_claude_settings') {
    return input.userClaudeSettingsTestResult?.ok ?? (runtimeMatchesSelectedSource
      ? (input.runtimeInfo?.available ?? false)
      : false);
  }

  if (input.selectedAuthSource === 'project_model_config') {
    return input.projectModelConfigTestResult?.ok ?? (runtimeMatchesSelectedSource
      ? (input.runtimeInfo?.available ?? false)
      : false);
  }

  return input.runtimeInfo?.available ?? false;
}

function formatProbeStatusLabel(status: ModelSourceProbeStatus): string {
  switch (status) {
    case 'success':
      return '测试成功';
    case 'failed':
      return '测试失败';
    case 'probing':
      return '检测中';
    case 'needs_config':
      return '待配置';
    case 'unavailable':
      return '未检测到';
    default:
      return '检测中';
  }
}

export function ModelSettings({
  localConfig,
  setLocalConfig,
  runtimeInfo,
  selectedAuthSource,
  userClaudeSettings,
  userClaudeSettingsText,
  onChangeUserClaudeSettingsText,
  officialModels,
  officialModelsPending,
  officialModelsError,
  officialQuota,
  officialQuotaPending,
  officialQuotaError,
  onRefreshOfficialData,
  onSelectAuthSource,
  onSaveUserClaudeSettings,
  onSaveProjectConfig,
  onTestUserClaudeSettings,
  onTestProjectModelConfig,
  userClaudeSettingsTestResult,
  userClaudeSettingsSavePending,
  userClaudeSettingsTestPending,
  projectModelConfigTestResult,
  projectModelConfigTestPending,
  userClaudeSettingsProbeStatus = userClaudeSettingsTestResult
    ? userClaudeSettingsTestResult.ok
      ? 'success'
      : 'failed'
    : runtimeInfo?.claudeCliAvailable
      ? 'probing'
      : 'unavailable',
  projectModelConfigProbeStatus = projectModelConfigTestResult
    ? projectModelConfigTestResult.ok
      ? 'success'
      : 'failed'
    : hasStoredProjectModelConfig(localConfig)
      ? 'probing'
      : 'needs_config',
}: {
  localConfig: AgentModelConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<AgentModelConfig | null>>;
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  selectedAuthSource: AgentAuthSource | null;
  userClaudeSettings: AgentUserClaudeSettingsSnapshot | null;
  userClaudeSettingsText: string;
  onChangeUserClaudeSettingsText: (value: string) => void;
  officialModels: AgentOfficialModelCatalogItem[];
  officialModelsPending: boolean;
  officialModelsError: string | null;
  officialQuota: AgentOfficialQuota | null;
  officialQuotaPending: boolean;
  officialQuotaError: string | null;
  onRefreshOfficialData: () => void;
  onSelectAuthSource: (value: AgentAuthSource) => void;
  onSaveUserClaudeSettings: () => void;
  onSaveProjectConfig: () => void;
  onTestUserClaudeSettings: () => void;
  onTestProjectModelConfig: () => void;
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  userClaudeSettingsSavePending: boolean;
  userClaudeSettingsTestPending: boolean;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestPending: boolean;
  userClaudeSettingsProbeStatus?: ModelSourceProbeStatus;
  projectModelConfigProbeStatus?: ModelSourceProbeStatus;
}) {
  const [showOpenai, setShowOpenai] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const configMode = inferModelConfigMode(localConfig);
  const officialApiKey = trimOptionalValue(localConfig.anthropicApiKey);
  const isDeepSeekAnthropicConfig =
    localConfig.modelProvider === 'anthropic' &&
    isDeepSeekAnthropicBaseUrl(localConfig.anthropicBaseUrl);
  const selectedSourceAvailable = resolveSelectedSourceAvailability({
    selectedAuthSource,
    runtimeInfo,
    userClaudeSettingsTestResult,
    projectModelConfigTestResult,
  });
  const selectedSourceLabel =
    runtimeInfo?.selectedAuthSource === 'project_model_config'
      ? '项目模型配置'
      : '用户级 Claude settings';
  const showUnexpectedProcessEnvFallback = Boolean(
    runtimeInfo?.authSource === 'process_env' || runtimeInfo?.isUnexpectedProcessEnvFallback
  );
  const userClaudeSettingsJsonError =
    selectedAuthSource === 'user_claude_settings'
      ? (() => {
          try {
            JSON.parse(userClaudeSettingsText);
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : 'JSON 解析失败';
          }
        })()
      : null;

  return (
    <div className="w-full">
      <div className="space-y-4">
        <div className="rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-base font-semibold">统一模型配置</div>
            <Badge variant={selectedSourceAvailable ? 'default' : 'outline'}>
              当前生效：{selectedSourceLabel}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={selectedAuthSource === 'project_model_config' ? 'default' : 'outline'}
              aria-label="选择 项目模型配置"
              onClick={() => onSelectAuthSource('project_model_config')}
            >
              项目模型配置
            </Button>
            <Button
              type="button"
              variant={selectedAuthSource === 'user_claude_settings' ? 'default' : 'outline'}
              aria-label="选择 用户级 Claude settings"
              onClick={() => onSelectAuthSource('user_claude_settings')}
            >
              用户级 Claude settings
            </Button>
          </div>

          {selectedAuthSource === 'user_claude_settings' ? (
            <div className="mt-4 rounded-md bg-muted/30 p-3 text-sm">
              <div>
                CLI 状态：
                <span className="ml-1 text-muted-foreground">
                  {runtimeInfo?.claudeCliAvailable ? '已检测到' : '未检测到'}
                </span>
              </div>
              <div className="mt-1">
                当前结果：
                <span className="ml-1 text-muted-foreground">
                  {formatProbeStatusLabel(userClaudeSettingsProbeStatus)}
                </span>
              </div>
            </div>
          ) : null}

          {selectedAuthSource === 'project_model_config' ? (
            <div className="mt-4 rounded-md bg-muted/30 p-3 text-sm">
              <div>
                配置状态：
                <span className="ml-1 text-muted-foreground">
                  {hasStoredProjectModelConfig(localConfig) ? '已配置' : '未配置'}
                </span>
              </div>
              <div className="mt-1">
                当前结果：
                <span className="ml-1 text-muted-foreground">
                  {formatProbeStatusLabel(projectModelConfigProbeStatus)}
                </span>
              </div>
            </div>
          ) : null}

          {!selectedSourceAvailable ? (
            <div className="mt-3 text-xs text-amber-700">
              当前选中的来源不可用。请修复此来源，或切换到另一种来源后重新测试。
            </div>
          ) : null}
          {showUnexpectedProcessEnvFallback ? (
            <div className="mt-3 text-xs text-destructive">
              检测到未受支持的内部环境来源，请重新选择“用户级 Claude
              settings”或“项目模型配置”并重新测试。
            </div>
          ) : null}
        </div>

        <div className="rounded-md border p-4">
          {selectedAuthSource === 'user_claude_settings' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>settings.json</Label>
                  <span className="text-xs text-muted-foreground">
                    {userClaudeSettings?.path || '~/.claude/settings.json'}
                  </span>
                </div>
                <div className="overflow-hidden rounded-md border bg-[#1f2430] [&_.cm-editor]:h-full [&_.cm-gutters]:border-r-[#2f3542] [&_.cm-scroller]:font-mono">
                  {canUseCodeMirrorEditor() ? (
                    <CodeMirror
                      value={userClaudeSettingsText}
                      onChange={onChangeUserClaudeSettingsText}
                      extensions={[jsonLanguage(), EditorView.lineWrapping]}
                      theme={oneDark}
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
                      }}
                    />
                  ) : (
                    <Textarea
                      value={userClaudeSettingsText}
                      onChange={(event) => onChangeUserClaudeSettingsText(event.target.value)}
                      className="min-h-[24rem] rounded-none border-0 bg-[#1f2430] font-mono text-sm text-white focus-visible:ring-0"
                    />
                  )}
                </div>
                {!userClaudeSettings?.exists ? (
                  <div className="text-xs text-muted-foreground">
                    当前未找到 `settings.json`，保存后会自动创建该文件。
                  </div>
                ) : null}
                {userClaudeSettingsJsonError ? (
                  <div className="text-xs text-destructive">{userClaudeSettingsJsonError}</div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={onSaveUserClaudeSettings}
                  disabled={Boolean(userClaudeSettingsJsonError) || userClaudeSettingsSavePending}
                >
                  {userClaudeSettingsSavePending ? '保存中...' : '保存用户级 Claude settings'}
                </Button>
                <Button
                  variant="outline"
                  onClick={onTestUserClaudeSettings}
                  disabled={Boolean(userClaudeSettingsJsonError) || userClaudeSettingsTestPending}
                >
                  {userClaudeSettingsTestPending ? '测试中...' : '测试用户级 Claude settings'}
                </Button>
              </div>

              {userClaudeSettingsTestResult ? (
                <div
                  className={cn(
                    'mt-4 rounded-md border p-3 text-sm',
                    userClaudeSettingsTestResult.ok
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'bg-muted/30'
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-medium">用户级 Claude settings 测试结果</span>
                    <Badge variant={userClaudeSettingsTestResult.ok ? 'default' : 'outline'}>
                      {userClaudeSettingsTestResult.ok ? '成功' : '失败'}
                    </Badge>
                  </div>
                  <div className="whitespace-pre-wrap text-sm">
                    {userClaudeSettingsTestResult.message}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>快速填充</Label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_MODEL_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="outline"
                      aria-label={`快速填充 ${preset.label}`}
                      onClick={() =>
                        setLocalConfig((current) =>
                          current
                            ? applyDetectedConfigToLocalConfig(current, preset.config)
                            : current
                        )
                      }
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {configMode === 'official' ? (
                <>
                  <div className="mt-4 space-y-2">
                    <Label>官方网关</Label>
                    <Input value={OFFICIAL_MODEL_GATEWAY_BASE_URL} readOnly />
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label>官方 API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showAnthropic ? 'text' : 'password'}
                        value={localConfig.anthropicApiKey ?? ''}
                        onChange={(event) =>
                          setLocalConfig((current) =>
                            current
                              ? { ...current, anthropicApiKey: event.target.value || undefined }
                              : current
                          )
                        }
                        placeholder="sk-..."
                      />
                      <Button variant="ghost" onClick={() => setShowAnthropic((value) => !value)}>
                        {showAnthropic ? '隐藏' : '显示'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={onRefreshOfficialData}
                        disabled={!officialApiKey || officialModelsPending || officialQuotaPending}
                      >
                        刷新
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>官方模型</Label>
                      {officialModelsPending ? (
                        <span className="text-xs text-muted-foreground">加载中...</span>
                      ) : null}
                    </div>
                    <Select
                      value={localConfig.anthropicModelName ?? ''}
                      onValueChange={(anthropicModelName) =>
                        setLocalConfig((current) =>
                          current ? { ...current, anthropicModelName } : current
                        )
                      }
                      disabled={!officialApiKey || officialModels.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={officialApiKey ? '请选择官方模型' : '请先输入官方 Key'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {officialModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {officialModelsError ? (
                      <div className="text-xs text-destructive">{officialModelsError}</div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-medium">额度信息</span>
                      {officialQuotaPending ? (
                        <span className="text-xs text-muted-foreground">更新中...</span>
                      ) : null}
                    </div>
                    {officialQuotaError ? (
                      <div className="text-xs text-destructive">{officialQuotaError}</div>
                    ) : officialQuota ? (
                      <>
                        <div className="text-muted-foreground">
                          {officialQuota.usagePercent === null
                            ? '当前 Key 为不限额'
                            : `已使用 ${officialQuota.usagePercent.toFixed(1)}%`}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          重置周期：{officialQuota.resetCycle}
                          {officialQuota.nextResetTime
                            ? `，下次重置：${new Date(officialQuota.nextResetTime).toLocaleString('zh-CN')}`
                            : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        输入官方 Key 后自动加载额度信息。
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-4">
                  <div className="mb-4 space-y-2">
                    <Label>模型提供商</Label>
                    <Select
                      value={localConfig.modelProvider}
                      onValueChange={(modelProvider: 'openai' | 'anthropic') =>
                        setLocalConfig((current) =>
                          current ? { ...current, modelProvider } : current
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI 兼容</SelectItem>
                        <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {localConfig.modelProvider === 'openai' ? (
                    <>
                      <div className="mb-4 space-y-2">
                        <Label>OpenAI 模型</Label>
                        <Input
                          list="openai-model-suggestions"
                          value={localConfig.openaiModelName ?? ''}
                          onChange={(event) =>
                            setLocalConfig((current) =>
                              current
                                ? { ...current, openaiModelName: event.target.value || undefined }
                                : current
                            )
                          }
                          placeholder="可直接输入任意模型名"
                        />
                        <datalist id="openai-model-suggestions">
                          {OPENAI_MODELS.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </div>

                      <div className="mb-4 space-y-2">
                        <Label>OpenAI URL</Label>
                        <Input
                          type="url"
                          value={localConfig.openaiBaseUrl ?? ''}
                          onChange={(event) =>
                            setLocalConfig((current) =>
                              current
                                ? { ...current, openaiBaseUrl: event.target.value || undefined }
                                : current
                            )
                          }
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>

                      <div className="mb-4 space-y-2">
                        <Label>OpenAI API Key</Label>
                        <div className="flex gap-2">
                          <Input
                            type={showOpenai ? 'text' : 'password'}
                            value={localConfig.openaiApiKey ?? ''}
                            onChange={(event) =>
                              setLocalConfig((current) =>
                                current
                                  ? { ...current, openaiApiKey: event.target.value || undefined }
                                  : current
                              )
                            }
                            placeholder="sk-..."
                          />
                          <Button variant="ghost" onClick={() => setShowOpenai((value) => !value)}>
                            {showOpenai ? '隐藏' : '显示'}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-4 space-y-2">
                        <Label>Anthropic URL</Label>
                        <Input
                          type="url"
                          value={localConfig.anthropicBaseUrl ?? ''}
                          onChange={(event) =>
                            setLocalConfig((current) =>
                              current
                                ? { ...current, anthropicBaseUrl: event.target.value || undefined }
                                : current
                            )
                          }
                          placeholder={
                            isDeepSeekAnthropicConfig
                              ? DEEPSEEK_ANTHROPIC_BASE_URL
                              : 'https://api.anthropic.com/v1'
                          }
                        />
                      </div>

                      <div className="mb-4 space-y-2">
                        <Label>Anthropic 模型</Label>
                        <Input
                          value={localConfig.anthropicModelName ?? ''}
                          onChange={(event) =>
                            setLocalConfig((current) =>
                              current
                                ? {
                                    ...current,
                                    anthropicModelName: trimOptionalValue(event.target.value),
                                  }
                                : current
                            )
                          }
                          placeholder={
                            isDeepSeekAnthropicConfig ? DEEPSEEK_DEFAULT_MODEL : '可直接输入任意模型名'
                          }
                        />
                      </div>

                      <div className="mb-4 space-y-2">
                        <Label>Anthropic API Key</Label>
                        <div className="flex gap-2">
                          <Input
                            type={showAnthropic ? 'text' : 'password'}
                            value={localConfig.anthropicApiKey ?? ''}
                            onChange={(event) =>
                              setLocalConfig((current) =>
                                current
                                  ? { ...current, anthropicApiKey: event.target.value || undefined }
                                  : current
                              )
                            }
                            placeholder={isDeepSeekAnthropicConfig ? 'sk-...' : 'sk-ant-...'}
                          />
                          <Button
                            variant="ghost"
                            onClick={() => setShowAnthropic((value) => !value)}
                          >
                            {showAnthropic ? '隐藏' : '显示'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={onSaveProjectConfig}>保存项目模型配置</Button>
                <Button
                  variant="outline"
                  onClick={onTestProjectModelConfig}
                  disabled={projectModelConfigTestPending}
                >
                  {projectModelConfigTestPending ? '测试中...' : '测试项目模型配置'}
                </Button>
              </div>

              {projectModelConfigTestResult ? (
                <div
                  className={cn(
                    'mt-4 rounded-md border p-3 text-sm',
                    projectModelConfigTestResult.ok
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'bg-muted/30'
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-medium">项目模型配置测试结果</span>
                    <Badge variant={projectModelConfigTestResult.ok ? 'default' : 'outline'}>
                      {projectModelConfigTestResult.ok ? '成功' : '失败'}
                    </Badge>
                  </div>
                  <div className="whitespace-pre-wrap text-sm">
                    {projectModelConfigTestResult.message}
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {projectModelConfigTestResult.runtimeAuthSummary}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const SettingsPanel = () => {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [settingsMode, setSettingsMode] = useState<SettingsMode>(() =>
    normalizeSettingsMode(search.mode)
  );
  const [localConfig, setLocalConfig] = useState<AgentModelConfig | null>(null);
  const [userClaudeSettings, setUserClaudeSettings] =
    useState<AgentUserClaudeSettingsSnapshot | null>(null);
  const [userClaudeSettingsText, setUserClaudeSettingsText] = useState(
    createDefaultUserClaudeSettingsJson
  );
  const [runtimeInfo, setRuntimeInfo] = useState<AgentModelConfigRuntimeInfo | null>(null);
  const [selectedAuthSource, setSelectedAuthSource] =
    useState<AgentAuthSource>('project_model_config');
  const [userClaudeSettingsTestResult, setUserClaudeSettingsTestResult] =
    useState<AgentModelConfigAuthTestResult | null>(null);
  const [projectModelConfigTestResult, setProjectModelConfigTestResult] =
    useState<AgentModelConfigAuthTestResult | null>(null);
  const [userClaudeSettingsSavePending, setUserClaudeSettingsSavePending] = useState(false);
  const [userClaudeSettingsTestPending, setUserClaudeSettingsTestPending] = useState(false);
  const [projectModelConfigTestPending, setProjectModelConfigTestPending] = useState(false);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [officialModels, setOfficialModels] = useState<AgentOfficialModelCatalogItem[]>([]);
  const [officialModelsPending, setOfficialModelsPending] = useState(false);
  const [officialModelsError, setOfficialModelsError] = useState<string | null>(null);
  const [officialQuota, setOfficialQuota] = useState<AgentOfficialQuota | null>(null);
  const [officialQuotaPending, setOfficialQuotaPending] = useState(false);
  const [officialQuotaError, setOfficialQuotaError] = useState<string | null>(null);
  const hasAutoTestedOnInitialLoadRef = useRef(false);
  const hasUserInteractedWithAuthSourceRef = useRef(false);
  const skipNextModelAccessRefreshRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isAutoProbePending, setIsAutoProbePending] = useState(false);
  const client = useMemo(
    () =>
      createAgentV2Client({
        baseUrl: config.api.agentV2BaseUrl,
        endpoint: config.api.agentV2Endpoint,
      }),
    []
  );

  useEffect(() => {
    setSettingsMode(normalizeSettingsMode(search.mode));
  }, [search.mode]);

  const handleSettingsModeChange = useCallback(
    (mode: SettingsMode) => {
      setSettingsMode(mode);
      void navigate({
        to: '/settings',
        search: {
          mode,
          projectPath: search.projectPath,
          entryPath: search.entryPath,
        } as never,
        replace: true,
      });
    },
    [navigate, search.entryPath, search.projectPath]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshSettingsModelAccess = useCallback(() => {
    void client
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (!isMountedRef.current) {
          return;
        }
        if (!hasUserInteractedWithAuthSourceRef.current) {
          setSelectedAuthSource(capabilities.selectedAuthSource);
        }
      })
      .catch(() => {
        if (!isMountedRef.current) {
          return;
        }
        if (!hasUserInteractedWithAuthSourceRef.current) {
          setSelectedAuthSource('project_model_config');
        }
      });

    void readBootstrapModelAccessSnapshot({
      client,
      fallbackLocalConfig: buildDefaultModelConfig(),
      skipRuntimeCapabilities: true,
      prepareLocalConfig: (hydratedProjectConfig) =>
        hasStoredProjectModelConfig(hydratedProjectConfig)
          ? hydratedProjectConfig
          : applyDetectedConfigToLocalConfig(hydratedProjectConfig, COMPANY_GATEWAY_PRESET_CONFIG),
    })
      .then((snapshot) => {
        if (!isMountedRef.current) {
          return;
        }

        setUserClaudeSettings(snapshot.userClaudeSettings);
        setUserClaudeSettingsText(snapshot.userClaudeSettingsText);
        setLocalConfig(snapshot.localConfig);
        setRuntimeInfo(snapshot.runtimeInfo);
      })
      .catch(() => {
        if (!isMountedRef.current) {
          return;
        }

        setLocalConfig(buildDefaultModelConfig());
        setUserClaudeSettings(null);
        setUserClaudeSettingsText(createDefaultUserClaudeSettingsJson());
        setRuntimeInfo(null);
      });
  }, [client]);

  useEffect(() => {
    void readAgentV2ProjectSelection()
      .then((selection) => setProjectPath(selection?.projectPath))
      .catch(() => setProjectPath(undefined));
  }, []);

  useEffect(() => {
    void refreshSettingsModelAccess();
  }, [refreshSettingsModelAccess]);

  useEffect(() => {
    return subscribeModelAccessChanged(() => {
      if (skipNextModelAccessRefreshRef.current) {
        skipNextModelAccessRefreshRef.current = false;
        return;
      }
      void refreshSettingsModelAccess();
    });
  }, [refreshSettingsModelAccess]);

  useEffect(() => {
    if (
      hasAutoTestedOnInitialLoadRef.current ||
      !localConfig ||
      !runtimeInfo ||
      userClaudeSettingsTestResult ||
      projectModelConfigTestResult
    ) {
      return;
    }

    hasAutoTestedOnInitialLoadRef.current = true;
    setIsAutoProbePending(true);

    void probeBootstrapModelAccess({
      client,
      localConfig,
      runtimeInfo,
    })
      .then((result) => {
        if (!isMountedRef.current) {
          return;
        }

        setUserClaudeSettingsTestResult(result.userClaudeSettingsTestResult);
        setProjectModelConfigTestResult(result.projectModelConfigTestResult);
      })
      .finally(() => {
        if (!isMountedRef.current) {
          return;
        }
        setIsAutoProbePending(false);
      });
  }, [
    client,
    localConfig,
    projectModelConfigTestResult,
    runtimeInfo,
    userClaudeSettingsTestResult,
  ]);
  const modelAccessViewState = useMemo(
    () =>
      deriveModelAccessViewState({
        runtimeInfo,
        localConfig,
        userClaudeSettingsTestResult,
        projectModelConfigTestResult,
        isProbing:
          isAutoProbePending || userClaudeSettingsTestPending || projectModelConfigTestPending,
      }),
    [
      isAutoProbePending,
      localConfig,
      projectModelConfigTestPending,
      projectModelConfigTestResult,
      runtimeInfo,
      userClaudeSettingsTestPending,
      userClaudeSettingsTestResult,
    ]
  );

  const refreshOfficialData = useCallback(
    (apiKey: string) => {
      const normalizedApiKey = trimOptionalValue(apiKey);
      if (!normalizedApiKey) {
        setOfficialModels([]);
        setOfficialModelsError(null);
        setOfficialQuota(null);
        setOfficialQuotaError(null);
        return;
      }

      setOfficialModelsPending(true);
      setOfficialQuotaPending(true);
      setOfficialModelsError(null);
      setOfficialQuotaError(null);

      void client
        .listOfficialModelCatalog(normalizedApiKey)
        .then((models) => {
          const sortedModels = [...models].sort((left, right) =>
            left.id.localeCompare(right.id, 'zh-CN')
          );
          setOfficialModels(sortedModels);
          setLocalConfig((current) => {
            if (!current || inferModelConfigMode(current) !== 'official') {
              return current;
            }
            const currentModelName = trimOptionalValue(current.anthropicModelName);
            if (currentModelName && sortedModels.some((model) => model.id === currentModelName)) {
              return current;
            }
            const fallbackModelName = sortedModels.at(-1)?.id;
            return fallbackModelName
              ? { ...current, anthropicModelName: fallbackModelName }
              : current;
          });
        })
        .catch((error) => {
          setOfficialModels([]);
          setOfficialModelsError(error instanceof Error ? error.message : '拉取官方模型列表失败');
        })
        .finally(() => {
          setOfficialModelsPending(false);
        });

      void client
        .getOfficialQuota(normalizedApiKey)
        .then((quota) => {
          setOfficialQuota(quota);
        })
        .catch((error) => {
          setOfficialQuota(null);
          setOfficialQuotaError(error instanceof Error ? error.message : '拉取官方额度失败');
        })
        .finally(() => {
          setOfficialQuotaPending(false);
        });
    },
    [client]
  );

  useEffect(() => {
    if (!localConfig || inferModelConfigMode(localConfig) !== 'official') {
      return;
    }
    const apiKey = trimOptionalValue(localConfig.anthropicApiKey);
    if (!apiKey) {
      setOfficialModels([]);
      setOfficialModelsError(null);
      setOfficialQuota(null);
      setOfficialQuotaError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      refreshOfficialData(apiKey);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [localConfig, refreshOfficialData]);

  function saveModelConfig() {
    if (!localConfig) {
      return;
    }
    hasUserInteractedWithAuthSourceRef.current = true;
    const normalizedConfig = normalizeModelConfigForSubmit(localConfig);
    void client
      .updateModelConfig(normalizedConfig)
      .then(async (payload) => {
        await client.updateRuntimeCapabilities({
          selectedAuthSource: payload.runtime.selectedAuthSource,
        });
        setUserClaudeSettingsTestResult(null);
        setProjectModelConfigTestResult(null);
        setLocalConfig(hydrateModelConfig(payload.config));
        setSelectedAuthSource('project_model_config');
        setRuntimeInfo(payload.runtime);
        skipNextModelAccessRefreshRef.current = true;
        publishModelAccessChanged();
        toast.success('项目模型配置已保存');
      })
      .catch((error) => {
        toast.error(localizeUserFacingError(error, '保存项目模型配置失败'));
      });
  }
  function selectAuthSource(nextSource: AgentAuthSource) {
    hasUserInteractedWithAuthSourceRef.current = true;
    setSelectedAuthSource(nextSource);
    if (selectedAuthSource === nextSource) {
      return;
    }
    void client
      .updateRuntimeCapabilities({
        selectedAuthSource: nextSource,
      })
      .then(async (capabilities) => {
        setSelectedAuthSource(capabilities.selectedAuthSource);
        const payload = await client.getModelConfig();
        setRuntimeInfo(payload.runtime);
        toast.success(
          nextSource === 'user_claude_settings'
            ? '已切换到用户级 Claude settings'
            : '已切换到项目模型配置'
        );
      })
      .catch((error) => {
        setSelectedAuthSource(runtimeInfo?.selectedAuthSource ?? selectedAuthSource);
        toast.error(localizeUserFacingError(error, '切换当前生效来源失败'));
      });
  }

  function testUserClaudeSettings() {
    if (!localConfig || userClaudeSettingsTestPending) {
      return;
    }
    setUserClaudeSettingsTestPending(true);
    void client
      .testModelConfig(normalizeModelConfigForSubmit(localConfig), {
        targetAuthSource: 'user_claude_settings',
      })
      .then((payload) => {
        setUserClaudeSettingsTestResult(payload.result);
        toast[payload.result.ok ? 'success' : 'error'](
          payload.result.ok ? '用户级 Claude settings 测试成功' : '用户级 Claude settings 测试失败'
        );
      })
      .catch((error) => {
        toast.error(localizeUserFacingError(error, '用户级 Claude settings 测试失败'));
      })
      .finally(() => {
        setUserClaudeSettingsTestPending(false);
      });
  }

  function saveUserClaudeSettings() {
    if (userClaudeSettingsSavePending) {
      return;
    }
    try {
      JSON.parse(userClaudeSettingsText);
    } catch (error) {
      toast.error(localizeUserFacingError(error, '用户级 Claude settings JSON 解析失败'));
      return;
    }
    hasUserInteractedWithAuthSourceRef.current = true;
    setUserClaudeSettingsSavePending(true);
    void client
      .updateUserClaudeSettings(userClaudeSettingsText)
      .then(async (snapshot) => {
        setUserClaudeSettings(snapshot);
        setUserClaudeSettingsText(normalizeUserClaudeSettingsJson(snapshot));
        const payload = await client.getModelConfig();
        await client.updateRuntimeCapabilities({
          selectedAuthSource: payload.runtime.selectedAuthSource,
        });
        setUserClaudeSettingsTestResult(null);
        setProjectModelConfigTestResult(null);
        setSelectedAuthSource('user_claude_settings');
        setRuntimeInfo(payload.runtime);
        skipNextModelAccessRefreshRef.current = true;
        publishModelAccessChanged();
        toast.success('用户级 Claude settings 已保存');
      })
      .catch((error) => {
        toast.error(localizeUserFacingError(error, '保存用户级 Claude settings 失败'));
      })
      .finally(() => {
        setUserClaudeSettingsSavePending(false);
      });
  }

  function testProjectModelConfig() {
    if (!localConfig || projectModelConfigTestPending) {
      return;
    }
    setProjectModelConfigTestPending(true);
    void client
      .testModelConfig(normalizeModelConfigForSubmit(localConfig), {
        targetAuthSource: 'project_model_config',
      })
      .then((payload) => {
        setProjectModelConfigTestResult(payload.result);
        toast[payload.result.ok ? 'success' : 'error'](
          payload.result.ok ? '项目模型配置测试成功' : '项目模型配置测试失败'
        );
      })
      .catch((error) => {
        toast.error(localizeUserFacingError(error, '项目模型配置测试失败'));
      })
      .finally(() => {
        setProjectModelConfigTestPending(false);
      });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 items-center justify-between gap-3 border-b bg-background/80 px-3">
        <div className="flex shrink-0 gap-2">
          {primarySettingsModes.map((mode) => (
            <Button
              key={mode}
              variant={settingsMode === mode ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-3 text-sm font-semibold"
              onClick={() => handleSettingsModeChange(mode)}
            >
              {settingsModeLabels[mode]}
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 justify-end gap-2 overflow-x-auto">
          {secondarySettingsModes.map((mode) => (
            <Button
              key={mode}
              variant={settingsMode === mode ? 'default' : 'outline'}
              size="sm"
              className="h-7 shrink-0 px-3 text-sm font-semibold"
              onClick={() => handleSettingsModeChange(mode)}
            >
              {settingsModeLabels[mode]}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="sm:hidden w-[132px] shrink-0">
          <Select
            value={settingsMode}
            onValueChange={(value) => handleSettingsModeChange(value as SettingsMode)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orderedSettingsModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {settingsModeLabels[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {settingsMode === 'model' ? (
          localConfig ? (
            <ModelSettings
              localConfig={localConfig}
              setLocalConfig={setLocalConfig}
              runtimeInfo={runtimeInfo}
              selectedAuthSource={selectedAuthSource}
              userClaudeSettings={userClaudeSettings}
              userClaudeSettingsText={userClaudeSettingsText}
              onChangeUserClaudeSettingsText={setUserClaudeSettingsText}
              officialModels={officialModels}
              officialModelsPending={officialModelsPending}
              officialModelsError={officialModelsError}
              officialQuota={officialQuota}
              officialQuotaPending={officialQuotaPending}
              officialQuotaError={officialQuotaError}
              onRefreshOfficialData={() => refreshOfficialData(localConfig.anthropicApiKey ?? '')}
              onSelectAuthSource={selectAuthSource}
              onSaveUserClaudeSettings={saveUserClaudeSettings}
              onSaveProjectConfig={saveModelConfig}
              onTestUserClaudeSettings={testUserClaudeSettings}
              onTestProjectModelConfig={testProjectModelConfig}
              userClaudeSettingsTestResult={userClaudeSettingsTestResult}
              userClaudeSettingsSavePending={userClaudeSettingsSavePending}
              userClaudeSettingsTestPending={userClaudeSettingsTestPending}
              projectModelConfigTestResult={projectModelConfigTestResult}
              projectModelConfigTestPending={projectModelConfigTestPending}
              userClaudeSettingsProbeStatus={modelAccessViewState.userClaudeSettings}
              projectModelConfigProbeStatus={modelAccessViewState.projectModelConfig}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">正在加载设置...</div>
          )
        ) : settingsMode === 'mcp' ? (
          <McpSettingsContent />
        ) : settingsMode === 'workspace' ? (
          <AgentWorkspacesContent
            embedded
            targetProjectPath={search.projectPath}
            targetEntryPath={search.entryPath}
          />
        ) : settingsMode === 'userscripts' ? (
          <UserScriptsWorkspace />
        ) : (
          <ManagementWorkspace
            mode={settingsMode}
            onModeChange={setSettingsMode}
            projectPath={projectPath}
            hideModeSelect
          />
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    mode: normalizeSettingsMode(search.mode),
    projectPath: trimOptionalValue(
      typeof search.projectPath === 'string' ? search.projectPath : undefined
    ),
    entryPath: trimOptionalValue(
      typeof search.entryPath === 'string' ? search.entryPath : undefined
    ),
  }),
  component: SettingsPanel,
});

export const Settings = SettingsPanel;
