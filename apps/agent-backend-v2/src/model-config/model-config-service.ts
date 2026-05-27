import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { z } from 'zod';
import { buildClaudeRequestOptions } from '../agent/runtime/claude-request-builder.ts';
import type { RuntimeCapabilities } from '../runtime-capabilities/runtime-capabilities-service.ts';

export const ModelConfigSchema = z.object({
  configMode: z.enum(['official', 'third_party']).default('third_party'),
  modelProvider: z.enum(['openai', 'anthropic']).default('openai'),
  providerVariant: z.enum(['standard']).optional(),
  openaiModelName: z.string().trim().optional(),
  openaiApiKey: z.string().trim().optional(),
  openaiBaseUrl: z.string().trim().optional(),
  anthropicModelName: z.string().trim().optional(),
  anthropicApiKey: z.string().trim().optional(),
  anthropicBaseUrl: z.string().trim().optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export type ExplicitAuthSource = 'user_claude_settings' | 'project_model_config';

export type ModelConfigRuntimeInfo = {
  authSource: 'user_claude_settings' | 'project_model_config' | 'process_env';
  selectedAuthSource: ExplicitAuthSource;
  available: boolean;
  claudeCliAvailable: boolean;
  hasProjectModelConfig: boolean;
  reason: string;
  isUnexpectedProcessEnvFallback?: boolean;
};

export type ModelConfigAuthTestResult = {
  ok: boolean;
  message: string;
  runtimeAuthSummary: string;
  runtime: ModelConfigRuntimeInfo;
};

export type DetectedCliModelConfig = ModelConfig;
export type UserClaudeSettingsSnapshot = {
  path: string;
  exists: boolean;
  rawJson: string | null;
};

export const MISSING_CLAUDE_CODE_AUTH_GUIDANCE =
  '当前未检测到本地 Claude Code，请联系管理员申请官方模型 Key，并在侧边栏“模型设置”中填写后重试。';

export type OfficialModelCatalogItem = {
  id: string;
  object?: string;
  ownedBy?: string;
};

export type OfficialQuota = {
  usagePercent: number | null;
  nextResetTime: string | null;
  resetCycle: string;
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  configMode: 'third_party',
  modelProvider: 'openai',
  providerVariant: 'standard',
};

export const OFFICIAL_MODEL_GATEWAY_ROOT_URL = 'https://anapi-uat.annto.com/api-sse-anthropic';
export const OFFICIAL_MODEL_GATEWAY_BASE_URL = `${OFFICIAL_MODEL_GATEWAY_ROOT_URL}/v1`;
const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 15000;

const OfficialModelCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      object: z.string().optional(),
      owned_by: z.string().optional(),
    })
  ),
});

const OfficialQuotaSchema = z.object({
  usagePercent: z.number().nullable(),
  nextResetTime: z.string().nullable(),
  resetCycle: z.string(),
});

const ClaudeSettingsSchema = z.object({
  env: z
    .object({
      OPENAI_API_KEY: z.string().trim().optional(),
      OPENAI_BASE_URL: z.string().trim().optional(),
      OPENAI_MODEL: z.string().trim().optional(),
      ANTHROPIC_API_KEY: z.string().trim().optional(),
      ANTHROPIC_AUTH_TOKEN: z.string().trim().optional(),
      ANTHROPIC_BASE_URL: z.string().trim().optional(),
      ANTHROPIC_MODEL: z.string().trim().optional(),
    })
    .partial()
    .optional(),
});

function resolveModelName(modelConfig: ModelConfig): string | null {
  return modelConfig.modelProvider === 'openai'
    ? modelConfig.openaiModelName || null
    : modelConfig.anthropicModelName || null;
}

function resolveProjectSdkEnv(modelConfig: ModelConfig): Record<string, string | undefined> {
  if (modelConfig.modelProvider === 'openai') {
    return {
      OPENAI_API_KEY: modelConfig.openaiApiKey,
      OPENAI_BASE_URL: modelConfig.openaiBaseUrl,
    };
  }

  return {
    ANTHROPIC_API_KEY: modelConfig.anthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: modelConfig.anthropicApiKey,
    ANTHROPIC_BASE_URL: modelConfig.anthropicBaseUrl,
  };
}

function maskBaseUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

async function withTimeout<T>(
  factory: () => Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      factory(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function formatRuntimeAuthSummary(input: {
  authSource?: string | null;
  settingSources: Array<'user' | 'project' | 'local'>;
  provider: 'openai' | 'anthropic';
  model?: string | null;
  sdkEnv?: Record<string, string | undefined>;
  claudeCliAvailable?: boolean;
  pathToClaudeCodeExecutable?: string | null;
}) {
  const baseUrl =
    input.provider === 'openai'
      ? maskBaseUrl(input.sdkEnv?.OPENAI_BASE_URL)
      : maskBaseUrl(input.sdkEnv?.ANTHROPIC_BASE_URL);
  const hasApiKey =
    input.provider === 'openai'
      ? Boolean(input.sdkEnv?.OPENAI_API_KEY?.trim())
      : Boolean(
          input.sdkEnv?.ANTHROPIC_AUTH_TOKEN?.trim() || input.sdkEnv?.ANTHROPIC_API_KEY?.trim()
        );

  return [
    '认证摘要',
    `source=${input.authSource || 'unknown'}`,
    `provider=${input.provider}`,
    `model=${input.model || 'unset'}`,
    `baseUrl=${baseUrl || 'unset'}`,
    `apiKey=${hasApiKey ? 'present' : 'missing'}`,
    `settingSources=${input.settingSources.join(',')}`,
    `claudeCli=${input.claudeCliAvailable ? 'available' : 'missing'}`,
    `cliPath=${input.pathToClaudeCodeExecutable || 'unset'}`,
  ].join(' | ');
}

async function readConfig(configPath: string): Promise<ModelConfig> {
  try {
    const payload = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    return ModelConfigSchema.parse(payload);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_MODEL_CONFIG };
    }
    throw error;
  }
}

async function writeConfig(configPath: string, config: ModelConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function hasProjectModelConfig(config: ModelConfig): boolean {
  if (config.modelProvider === 'openai') {
    return Boolean(config.openaiApiKey?.trim());
  }
  return Boolean(config.anthropicApiKey?.trim());
}

function toOptionalTrimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferDetectedCliConfigMode(config: ModelConfig): 'official' | 'third_party' {
  const anthropicBaseUrl = toOptionalTrimmedValue(config.anthropicBaseUrl);
  return config.modelProvider === 'anthropic' &&
    (anthropicBaseUrl === OFFICIAL_MODEL_GATEWAY_ROOT_URL ||
      anthropicBaseUrl === OFFICIAL_MODEL_GATEWAY_BASE_URL)
    ? 'official'
    : 'third_party';
}

function resolveDetectedCliConfig(
  payload: z.infer<typeof ClaudeSettingsSchema>
): DetectedCliModelConfig | null {
  const env = payload.env;
  if (!env) {
    return null;
  }

  const openaiApiKey = toOptionalTrimmedValue(env.OPENAI_API_KEY);
  const openaiBaseUrl = toOptionalTrimmedValue(env.OPENAI_BASE_URL);
  const openaiModelName = toOptionalTrimmedValue(env.OPENAI_MODEL);
  if (openaiApiKey || openaiBaseUrl || openaiModelName) {
    return {
      configMode: 'third_party',
      modelProvider: 'openai',
      providerVariant: 'standard',
      openaiApiKey,
      openaiBaseUrl,
      openaiModelName,
    };
  }

  const anthropicApiKey =
    toOptionalTrimmedValue(env.ANTHROPIC_AUTH_TOKEN) ??
    toOptionalTrimmedValue(env.ANTHROPIC_API_KEY);
  const anthropicBaseUrl = toOptionalTrimmedValue(env.ANTHROPIC_BASE_URL);
  const anthropicModelName = toOptionalTrimmedValue(env.ANTHROPIC_MODEL);
  if (anthropicApiKey || anthropicBaseUrl || anthropicModelName) {
    const config = {
      modelProvider: 'anthropic',
      providerVariant: 'standard',
      anthropicApiKey,
      anthropicBaseUrl,
      anthropicModelName,
    } satisfies Partial<DetectedCliModelConfig> & { modelProvider: 'anthropic' };
    return {
      ...config,
      configMode: inferDetectedCliConfigMode(config),
    };
  }

  return null;
}

async function readDetectedCliConfig(
  userClaudeSettingsPath: string
): Promise<DetectedCliModelConfig | null> {
  try {
    const payload = ClaudeSettingsSchema.parse(
      JSON.parse(await readFile(userClaudeSettingsPath, 'utf8')) as unknown
    );
    return resolveDetectedCliConfig(payload);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

function toDetectedCliSdkEnv(config: DetectedCliModelConfig): Record<string, string | undefined> {
  if (config.modelProvider === 'openai') {
    return {
      OPENAI_API_KEY: config.openaiApiKey,
      OPENAI_BASE_URL: config.openaiBaseUrl,
    };
  }

  return {
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: config.anthropicApiKey,
    ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
  };
}

function resolveDetectedCliModelName(config: DetectedCliModelConfig): string | null {
  return config.modelProvider === 'openai'
    ? config.openaiModelName || null
    : config.anthropicModelName || null;
}

async function validateUserClaudeSettingsForAuthProbe(input: {
  userClaudeSettingsPath: string;
}): Promise<
  | {
      ok: true;
      detectedConfig: DetectedCliModelConfig;
    }
  | {
      ok: false;
      message: string;
    }
> {
  const snapshot = await readUserClaudeSettingsSnapshot(input.userClaudeSettingsPath);
  if (!snapshot.exists || !snapshot.rawJson) {
    return {
      ok: false,
      message: `未找到用户级 Claude settings 文件：${input.userClaudeSettingsPath}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.rawJson);
  } catch (error) {
    return {
      ok: false,
      message: `用户级 Claude settings 不是合法 JSON：${error instanceof Error ? error.message : input.userClaudeSettingsPath}`,
    };
  }

  const payload = ClaudeSettingsSchema.safeParse(parsed);
  if (!payload.success) {
    return {
      ok: false,
      message: `用户级 Claude settings 结构无效：${payload.error.issues[0]?.message || input.userClaudeSettingsPath}`,
    };
  }

  const detectedConfig = resolveDetectedCliConfig(payload.data);
  if (!detectedConfig) {
    return {
      ok: false,
      message: `未在 ${input.userClaudeSettingsPath} 中检测到可用于 Claude Code CLI 的有效认证配置。`,
    };
  }

  return {
    ok: true,
    detectedConfig,
  };
}

async function readUserClaudeSettingsSnapshot(
  userClaudeSettingsPath: string
): Promise<UserClaudeSettingsSnapshot> {
  try {
    return {
      path: userClaudeSettingsPath,
      exists: true,
      rawJson: await readFile(userClaudeSettingsPath, 'utf8'),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: userClaudeSettingsPath,
        exists: false,
        rawJson: null,
      };
    }
    throw error;
  }
}

async function writeUserClaudeSettingsSnapshot(
  userClaudeSettingsPath: string,
  rawJson: string
): Promise<UserClaudeSettingsSnapshot> {
  JSON.parse(rawJson);
  await mkdir(dirname(userClaudeSettingsPath), { recursive: true });
  await writeFile(userClaudeSettingsPath, rawJson, 'utf8');
  return {
    path: userClaudeSettingsPath,
    exists: true,
    rawJson,
  };
}

export function resolveModelConfigRuntimeInfo(input: {
  env: AgentBackendV2Env;
  runtimeCapabilities?: RuntimeCapabilities;
  modelConfig: ModelConfig;
  preferAvailableSource?: boolean;
}): ModelConfigRuntimeInfo {
  const claudeCliAvailable = Boolean(input.env.claudeCodeExecutablePath);
  const projectConfigAvailable = hasProjectModelConfig(input.modelConfig);
  const requestedAuthSource =
    input.runtimeCapabilities?.selectedAuthSource ?? 'user_claude_settings';
  const selectedAuthSource =
    input.preferAvailableSource === false
      ? requestedAuthSource
      : projectConfigAvailable
        ? 'project_model_config'
        : claudeCliAvailable
          ? 'user_claude_settings'
          : 'project_model_config';

  if (selectedAuthSource === 'user_claude_settings') {
    return {
      authSource: 'user_claude_settings',
      selectedAuthSource,
      available: claudeCliAvailable,
      claudeCliAvailable,
      hasProjectModelConfig: projectConfigAvailable,
      reason: claudeCliAvailable
        ? '当前项目已选择用户级 Claude settings，并检测到本机 Claude CLI 可用。'
        : '当前项目已选择用户级 Claude settings，但未检测到可用的本机 Claude CLI。',
    };
  }

  return {
    authSource: 'project_model_config',
    selectedAuthSource,
    available: projectConfigAvailable,
    claudeCliAvailable,
    hasProjectModelConfig: projectConfigAvailable,
    reason: projectConfigAvailable
      ? '当前项目已选择项目模型配置，并检测到有效的项目模型认证信息。'
      : '当前项目已选择项目模型配置，但尚未填写有效的项目模型认证信息。',
  };
}

export function resolveModelConfigAuthGuidance(input: {
  runtime: ModelConfigRuntimeInfo;
  modelConfig: ModelConfig;
}): string | undefined {
  if (
    input.runtime.selectedAuthSource === 'user_claude_settings' &&
    !input.runtime.available &&
    !input.runtime.claudeCliAvailable &&
    input.modelConfig.configMode === 'official'
  ) {
    return MISSING_CLAUDE_CODE_AUTH_GUIDANCE;
  }

  return undefined;
}

export function createModelConfigService(options: {
  configPath: string;
  env: AgentBackendV2Env;
  userClaudeSettingsPath?: string;
  authProbeTimeoutMs?: number;
  runtimeCapabilitiesProvider?: {
    getCapabilities(): Promise<RuntimeCapabilities>;
  };
  authProbe?: {
    query(input: { prompt: string; options?: Record<string, unknown> }): AsyncIterable<
      Record<string, unknown>
    > & {
      interrupt?: () => Promise<void>;
    };
  };
  officialGatewayClient?: {
    listModels(input: { apiKey: string }): Promise<OfficialModelCatalogItem[]>;
    getQuota(input: { apiKey: string }): Promise<OfficialQuota>;
  };
}) {
  const authProbeTimeoutMs = options.authProbeTimeoutMs ?? DEFAULT_AUTH_PROBE_TIMEOUT_MS;
  const userClaudeSettingsPath =
    options.userClaudeSettingsPath || `${homedir()}/.claude/settings.json`;
  const officialGatewayClient = options.officialGatewayClient ?? {
    async listModels(input: { apiKey: string }): Promise<OfficialModelCatalogItem[]> {
      const response = await fetch(`${OFFICIAL_MODEL_GATEWAY_BASE_URL}/models`, {
        headers: {
          'x-api-key': input.apiKey,
        },
      });
      if (!response.ok) {
        throw new Error(`拉取官方模型列表失败: ${response.status}`);
      }
      const payload = OfficialModelCatalogSchema.parse(await response.json());
      return payload.data.map((item) => ({
        id: item.id,
        object: item.object,
        ownedBy: item.owned_by,
      }));
    },
    async getQuota(input: { apiKey: string }): Promise<OfficialQuota> {
      const response = await fetch(`${OFFICIAL_MODEL_GATEWAY_BASE_URL}/key/quota`, {
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
        },
      });
      if (!response.ok) {
        throw new Error(`拉取官方额度信息失败: ${response.status}`);
      }
      return OfficialQuotaSchema.parse(await response.json());
    },
  };

  return {
    async getConfig(): Promise<ModelConfig> {
      return readConfig(options.configPath);
    },

    async updateConfig(patch: Partial<ModelConfig>): Promise<ModelConfig> {
      const current = await readConfig(options.configPath);
      const next = ModelConfigSchema.parse({
        ...current,
        ...patch,
      });
      await writeConfig(options.configPath, next);
      return next;
    },

    async getRuntimeInfo(): Promise<ModelConfigRuntimeInfo> {
      const [modelConfig, runtimeCapabilities] = await Promise.all([
        readConfig(options.configPath),
        options.runtimeCapabilitiesProvider?.getCapabilities(),
      ]);
      return resolveModelConfigRuntimeInfo({
        env: options.env,
        runtimeCapabilities,
        modelConfig,
      });
    },

    async getDetectedCliConfig(): Promise<DetectedCliModelConfig | null> {
      return readDetectedCliConfig(userClaudeSettingsPath);
    },

    async getUserClaudeSettings(): Promise<UserClaudeSettingsSnapshot> {
      return readUserClaudeSettingsSnapshot(userClaudeSettingsPath);
    },

    async updateUserClaudeSettings(rawJson: string): Promise<UserClaudeSettingsSnapshot> {
      return writeUserClaudeSettingsSnapshot(userClaudeSettingsPath, rawJson);
    },

    async testConfig(
      patch: Partial<ModelConfig>,
      runtimeCapabilitiesOverride?: Partial<RuntimeCapabilities>
    ): Promise<ModelConfigAuthTestResult> {
      const [current, runtimeCapabilities] = await Promise.all([
        readConfig(options.configPath),
        options.runtimeCapabilitiesProvider?.getCapabilities(),
      ]);
      const effectiveRuntimeCapabilities = {
        ...(runtimeCapabilities || {}),
        ...(runtimeCapabilitiesOverride || {}),
      };
      const merged = ModelConfigSchema.parse({
        ...current,
        ...patch,
      });
      const runtime = resolveModelConfigRuntimeInfo({
        env: options.env,
        runtimeCapabilities: effectiveRuntimeCapabilities.selectedAuthSource
          ? { selectedAuthSource: effectiveRuntimeCapabilities.selectedAuthSource }
          : undefined,
        modelConfig: merged,
        preferAvailableSource: runtimeCapabilitiesOverride?.selectedAuthSource ? false : undefined,
      });
      const settingSources: Array<'user' | 'project' | 'local'> =
        runtime.selectedAuthSource === 'user_claude_settings'
          ? ['user', 'local']
          : ['project', 'local'];
      let summaryProvider: 'openai' | 'anthropic' = merged.modelProvider;
      let requestModel =
        runtime.authSource === 'project_model_config'
          ? resolveModelName(merged)
          : options.env.model || resolveModelName(merged);
      let summarySdkEnv =
        runtime.authSource === 'project_model_config' ? resolveProjectSdkEnv(merged) : undefined;
      const sdkEnv =
        runtime.authSource === 'project_model_config' ? resolveProjectSdkEnv(merged) : undefined;
      const runtimeAuthSummary = formatRuntimeAuthSummary({
        authSource: runtime.authSource,
        settingSources,
        provider: summaryProvider,
        model: requestModel,
        sdkEnv: summarySdkEnv,
        claudeCliAvailable: runtime.claudeCliAvailable,
        pathToClaudeCodeExecutable: options.env.claudeCodeExecutablePath,
      });

      if (!runtime.available) {
        return {
          ok: false,
          message: `${runtime.reason}\n${runtimeAuthSummary}`,
          runtimeAuthSummary,
          runtime,
        };
      }

      if (runtime.authSource === 'user_claude_settings') {
        const validation = await validateUserClaudeSettingsForAuthProbe({
          userClaudeSettingsPath,
        });
        if (!validation.ok) {
          return {
            ok: false,
            message: `${validation.message}\n${runtimeAuthSummary}`,
            runtimeAuthSummary,
            runtime,
          };
        }
        summaryProvider = validation.detectedConfig.modelProvider;
        requestModel =
          resolveDetectedCliModelName(validation.detectedConfig) || options.env.model || null;
        summarySdkEnv = toDetectedCliSdkEnv(validation.detectedConfig);
      }

      const finalRuntimeAuthSummary = formatRuntimeAuthSummary({
        authSource: runtime.authSource,
        settingSources,
        provider: summaryProvider,
        model: requestModel,
        sdkEnv: summarySdkEnv,
        claudeCliAvailable: runtime.claudeCliAvailable,
        pathToClaudeCodeExecutable: options.env.claudeCodeExecutablePath,
      });

      if (!options.authProbe) {
        return {
          ok: false,
          message: `当前后端未配置认证探测器，无法执行测试。\n${finalRuntimeAuthSummary}`,
          runtimeAuthSummary: finalRuntimeAuthSummary,
          runtime,
        };
      }

      const run = options.authProbe.query({
        prompt: 'Reply with exactly OK.',
        options: {
          ...buildClaudeRequestOptions({
            env: options.env,
            projectPath: options.env.workdir,
            model: requestModel,
            allowedTools: [],
            useDefaultAllowedTools: false,
            permissionMode: 'bypassPermissions',
            settingSources,
            sdkEnv,
          }),
          maxTurns: 1,
          tools: [],
        },
      });

      try {
        const iterator = run[Symbol.asyncIterator]();
        while (true) {
          const next = await withTimeout(
            () => iterator.next(),
            authProbeTimeoutMs,
            `认证测试超时（${authProbeTimeoutMs}ms），请检查 Claude CLI、网络或模型网关。`
          );

          if (next.done) {
            break;
          }

          const item = next.value;
          if (item.type !== 'result') {
            continue;
          }

          const ok = item.subtype === 'success' || item.is_error === false;
          return {
            ok,
            message: ok
              ? `认证成功，Claude SDK 已接受当前配置。\n${finalRuntimeAuthSummary}`
              : `${typeof item.error === 'string' ? item.error : '认证失败'}\n${finalRuntimeAuthSummary}`,
            runtimeAuthSummary: finalRuntimeAuthSummary,
            runtime,
          };
        }

        return {
          ok: false,
          message: `认证探测未返回最终结果，请检查上游网关或 CLI 输出。\n${finalRuntimeAuthSummary}`,
          runtimeAuthSummary: finalRuntimeAuthSummary,
          runtime,
        };
      } catch (error) {
        return {
          ok: false,
          message: `${error instanceof Error ? error.message : '认证探测执行失败'}\n${finalRuntimeAuthSummary}`,
          runtimeAuthSummary: finalRuntimeAuthSummary,
          runtime,
        };
      } finally {
        if (typeof run.interrupt === 'function') {
          await run.interrupt().catch(() => {});
        }
      }
    },

    async listOfficialModels(input: { apiKey: string }): Promise<OfficialModelCatalogItem[]> {
      const apiKey = input.apiKey.trim();
      if (!apiKey) {
        return [];
      }
      return officialGatewayClient.listModels({ apiKey });
    },

    async getOfficialQuota(input: { apiKey: string }): Promise<OfficialQuota> {
      const apiKey = input.apiKey.trim();
      if (!apiKey) {
        return {
          usagePercent: null,
          nextResetTime: null,
          resetCycle: 'unlimited',
        };
      }
      return officialGatewayClient.getQuota({ apiKey });
    },
  };
}
