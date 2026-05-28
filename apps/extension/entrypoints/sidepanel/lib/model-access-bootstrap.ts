import type { createAgentV2Client } from './agent-v2/client';
import type {
  AgentAuthSource,
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigResponse,
  AgentModelConfigRuntimeInfo,
  AgentUserClaudeSettingsSnapshot,
} from './agent-v2/types';
import {
  deriveModelAccessViewState,
  type ModelAccessViewState,
} from './model-access-state';

export const OFFICIAL_MODEL_GATEWAY_BASE_URL = 'https://anapi-uat.annto.com/api-sse-anthropic';
const OFFICIAL_MODEL_GATEWAY_V1_BASE_URL = `${OFFICIAL_MODEL_GATEWAY_BASE_URL}/v1`;

export type ModelAccessBootstrapClient = Pick<
  ReturnType<typeof createAgentV2Client>,
  'getModelConfig' | 'getRuntimeCapabilities' | 'testModelConfig'
>;

export type BootstrapModelAccessSnapshot = {
  selectedAuthSource: AgentAuthSource;
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  localConfig: AgentModelConfig;
  userClaudeSettings: AgentUserClaudeSettingsSnapshot | null;
  userClaudeSettingsText: string;
};

export type BootstrapModelAccessProbeResult = {
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
  viewState: ModelAccessViewState;
};

export type BootstrapModelAccessResult = BootstrapModelAccessSnapshot &
  BootstrapModelAccessProbeResult;

type ReadBootstrapModelAccessSnapshotOptions = {
  client: ModelAccessBootstrapClient;
  fallbackLocalConfig: AgentModelConfig;
  fallbackSelectedAuthSource?: AgentAuthSource;
  skipRuntimeCapabilities?: boolean;
  prepareLocalConfig?: (
    config: AgentModelConfig,
    payload: AgentModelConfigResponse
  ) => AgentModelConfig;
};

export function trimOptionalValue(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isOfficialGatewayBaseUrl(value: string | undefined): boolean {
  const normalizedValue = trimOptionalValue(value);
  return (
    normalizedValue === OFFICIAL_MODEL_GATEWAY_BASE_URL ||
    normalizedValue === OFFICIAL_MODEL_GATEWAY_V1_BASE_URL
  );
}

export function inferModelConfigMode(
  config: Partial<AgentModelConfig> | null | undefined
): 'official' | 'third_party' {
  if (config?.configMode === 'official' || config?.configMode === 'third_party') {
    return config.configMode;
  }
  return config?.modelProvider === 'anthropic' && isOfficialGatewayBaseUrl(config.anthropicBaseUrl)
    ? 'official'
    : 'third_party';
}

export function hydrateModelConfig(config: AgentModelConfig): AgentModelConfig {
  return {
    ...config,
    configMode: inferModelConfigMode(config),
  };
}

export function hasStoredProjectModelConfig(
  config: AgentModelConfig | null | undefined
): boolean {
  if (!config) {
    return false;
  }
  return config.modelProvider === 'openai'
    ? Boolean(trimOptionalValue(config.openaiApiKey))
    : Boolean(trimOptionalValue(config.anthropicApiKey));
}

export function createDefaultUserClaudeSettingsJson() {
  return `${JSON.stringify({ env: {} }, null, 2)}\n`;
}

export function normalizeUserClaudeSettingsJson(
  snapshot: AgentUserClaudeSettingsSnapshot | null | undefined
) {
  return snapshot?.rawJson ?? createDefaultUserClaudeSettingsJson();
}

function hasStoredUserClaudeSettingsConfig(
  snapshot: AgentUserClaudeSettingsSnapshot | null | undefined
): boolean {
  if (!snapshot?.exists || !snapshot.rawJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(snapshot.rawJson) as {
      env?: Record<string, unknown>;
    };
    const env = parsed.env ?? {};
    const valueCandidates = [
      env.OPENAI_API_KEY,
      env.ANTHROPIC_API_KEY,
      env.ANTHROPIC_AUTH_TOKEN,
    ];
    return valueCandidates.some((value) => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return false;
  }
}

function deriveBootstrapStaticViewState(input: {
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  localConfig: AgentModelConfig;
  userClaudeSettings: AgentUserClaudeSettingsSnapshot | null;
}): ModelAccessViewState {
  const userClaudeSettings =
    !input.runtimeInfo?.claudeCliAvailable
      ? 'unavailable'
      : hasStoredUserClaudeSettingsConfig(input.userClaudeSettings)
        ? 'success'
        : 'needs_config';
  const projectModelConfig = hasStoredProjectModelConfig(input.localConfig)
    ? 'success'
    : 'needs_config';
  const hasSuccess =
    userClaudeSettings === 'success' || projectModelConfig === 'success';

  return {
    phase: 'static',
    overallStatus: hasSuccess ? 'available' : 'needs_config',
    summary: hasSuccess ? '已检测到模型配置，可直接开始对话。' : '当前需先补齐模型配置。',
    userClaudeSettings,
    projectModelConfig,
  };
}

export function normalizeModelConfigForSubmit(localConfig: AgentModelConfig): AgentModelConfig {
  const normalizedConfig: AgentModelConfig = {
    ...localConfig,
    configMode: inferModelConfigMode(localConfig),
    providerVariant: localConfig.providerVariant ?? 'standard',
    openaiModelName: trimOptionalValue(localConfig.openaiModelName),
    anthropicModelName: trimOptionalValue(localConfig.anthropicModelName),
    openaiBaseUrl: trimOptionalValue(localConfig.openaiBaseUrl),
    anthropicBaseUrl: trimOptionalValue(localConfig.anthropicBaseUrl),
    openaiApiKey: trimOptionalValue(localConfig.openaiApiKey),
    anthropicApiKey: trimOptionalValue(localConfig.anthropicApiKey),
  };

  if (normalizedConfig.configMode === 'official') {
    return {
      ...normalizedConfig,
      modelProvider: 'anthropic',
      anthropicBaseUrl: OFFICIAL_MODEL_GATEWAY_BASE_URL,
    };
  }

  return {
    ...normalizedConfig,
    configMode: 'third_party',
  };
}

export function buildUnavailableAuthTestResult(input: {
  targetAuthSource: AgentAuthSource;
  runtime: AgentModelConfigRuntimeInfo;
  message: string;
}): AgentModelConfigAuthTestResult {
  const { targetAuthSource, runtime, message } = input;
  return {
    ok: false,
    message,
    runtimeAuthSummary: `认证摘要 | source=${targetAuthSource} | available=false`,
    runtime: {
      ...runtime,
      authSource: targetAuthSource,
      selectedAuthSource: runtime.selectedAuthSource,
      available: false,
    },
  };
}

export async function readBootstrapModelAccessSnapshot(
  options: ReadBootstrapModelAccessSnapshotOptions
): Promise<BootstrapModelAccessSnapshot> {
  const {
    client,
    fallbackLocalConfig,
    fallbackSelectedAuthSource = 'project_model_config',
    skipRuntimeCapabilities = false,
    prepareLocalConfig,
  } = options;

  const selectedAuthSource = skipRuntimeCapabilities
    ? fallbackSelectedAuthSource
    : await client
        .getRuntimeCapabilities()
        .then((capabilities) => capabilities.selectedAuthSource)
        .catch(() => fallbackSelectedAuthSource);

  const modelConfigResult = await Promise.allSettled([client.getModelConfig()]).then(
    ([result]) => result
  );

  if (modelConfigResult.status !== 'fulfilled') {
    return {
      selectedAuthSource,
      runtimeInfo: null,
      localConfig: fallbackLocalConfig,
      userClaudeSettings: null,
      userClaudeSettingsText: createDefaultUserClaudeSettingsJson(),
    };
  }

  const payload = modelConfigResult.value;
  const hydratedProjectConfig = hydrateModelConfig(payload.config);

  return {
    selectedAuthSource,
    runtimeInfo: payload.runtime,
    localConfig: prepareLocalConfig
      ? prepareLocalConfig(hydratedProjectConfig, payload)
      : hydratedProjectConfig,
    userClaudeSettings: payload.userClaudeSettings,
    userClaudeSettingsText: normalizeUserClaudeSettingsJson(payload.userClaudeSettings),
  };
}

export async function probeBootstrapModelAccess(input: {
  client: ModelAccessBootstrapClient;
  localConfig: AgentModelConfig;
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
}): Promise<BootstrapModelAccessProbeResult> {
  const { client, localConfig, runtimeInfo } = input;

  if (!runtimeInfo) {
    return {
      userClaudeSettingsTestResult: null,
      projectModelConfigTestResult: null,
      viewState: deriveModelAccessViewState({
        runtimeInfo: null,
        localConfig,
        userClaudeSettingsTestResult: null,
        projectModelConfigTestResult: null,
        isProbing: false,
      }),
    };
  }

  const normalizedConfig = normalizeModelConfigForSubmit(localConfig);
  const shouldTestUserClaudeSettings = runtimeInfo.claudeCliAvailable;
  const shouldTestProjectModelConfig = hasStoredProjectModelConfig(localConfig);
  const userClaudeSettingsTask = shouldTestUserClaudeSettings
    ? client
        .testModelConfig(normalizedConfig, {
          targetAuthSource: 'user_claude_settings',
        })
        .then((payload) => payload.result)
        .catch((error) =>
          buildUnavailableAuthTestResult({
            targetAuthSource: 'user_claude_settings',
            runtime: runtimeInfo,
            message:
              error instanceof Error ? error.message : '用户级 Claude settings 自动测试失败',
          })
        )
    : Promise.resolve(
        buildUnavailableAuthTestResult({
          targetAuthSource: 'user_claude_settings',
          runtime: runtimeInfo,
          message: '未检测到本地 Claude Code CLI，无法使用用户级 Claude settings。',
        })
      );

  const projectModelConfigTask = shouldTestProjectModelConfig
    ? client
        .testModelConfig(normalizedConfig, {
          targetAuthSource: 'project_model_config',
        })
        .then((payload) => payload.result)
        .catch((error) =>
          buildUnavailableAuthTestResult({
            targetAuthSource: 'project_model_config',
            runtime: runtimeInfo,
            message: error instanceof Error ? error.message : '项目模型配置自动测试失败',
          })
        )
    : Promise.resolve(
        buildUnavailableAuthTestResult({
          targetAuthSource: 'project_model_config',
          runtime: runtimeInfo,
          message: '项目模型配置尚未填写 API Key，当前无法测试。',
        })
      );

  const [userClaudeSettingsTestResult, projectModelConfigTestResult] = await Promise.all([
    userClaudeSettingsTask,
    projectModelConfigTask,
  ]);

  return {
    userClaudeSettingsTestResult,
    projectModelConfigTestResult,
    viewState: deriveModelAccessViewState({
      runtimeInfo,
      localConfig,
      userClaudeSettingsTestResult,
      projectModelConfigTestResult,
      isProbing: false,
    }),
  };
}

export async function loadBootstrapModelAccess(
  options: ReadBootstrapModelAccessSnapshotOptions
): Promise<BootstrapModelAccessResult> {
  const snapshot = await readBootstrapModelAccessSnapshot(options);

  return {
    ...snapshot,
    userClaudeSettingsTestResult: null,
    projectModelConfigTestResult: null,
    viewState: deriveBootstrapStaticViewState({
      runtimeInfo: snapshot.runtimeInfo,
      localConfig: snapshot.localConfig,
      userClaudeSettings: snapshot.userClaudeSettings,
    }),
  };
}
