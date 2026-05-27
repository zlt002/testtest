import type {
  AgentModelConfig,
  AgentModelConfigAuthTestResult,
  AgentModelConfigRuntimeInfo,
} from './agent-v2/types';

export type ModelAccessPhase = 'static' | 'probing' | 'resolved';

export type ModelSourceProbeStatus =
  | 'unavailable'
  | 'needs_config'
  | 'probing'
  | 'success'
  | 'failed';

export type ModelAccessOverallStatus =
  | 'available'
  | 'partial'
  | 'needs_config'
  | 'unavailable'
  | 'probing';

export type ModelAccessViewState = {
  phase: ModelAccessPhase;
  overallStatus: ModelAccessOverallStatus;
  summary: string;
  userClaudeSettings: ModelSourceProbeStatus;
  projectModelConfig: ModelSourceProbeStatus;
};

function hasProjectApiKey(localConfig: AgentModelConfig | null): boolean {
  if (!localConfig) {
    return false;
  }

  return localConfig.modelProvider === 'openai'
    ? Boolean(localConfig.openaiApiKey?.trim())
    : Boolean(localConfig.anthropicApiKey?.trim());
}

function toStaticSourceStatus(input: {
  source: 'user_claude_settings' | 'project_model_config';
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  localConfig: AgentModelConfig | null;
  isProbing: boolean;
}): ModelSourceProbeStatus {
  const { source, runtimeInfo, localConfig, isProbing } = input;

  if (source === 'user_claude_settings') {
    if (!runtimeInfo?.claudeCliAvailable) {
      return 'unavailable';
    }
    return isProbing ? 'probing' : 'probing';
  }

  if (!hasProjectApiKey(localConfig)) {
    return 'needs_config';
  }
  return isProbing ? 'probing' : 'probing';
}

function toSourceStatus(input: {
  source: 'user_claude_settings' | 'project_model_config';
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  localConfig: AgentModelConfig | null;
  result: AgentModelConfigAuthTestResult | null;
  isProbing: boolean;
}): ModelSourceProbeStatus {
  const { result } = input;
  if (result) {
    return result.ok ? 'success' : 'failed';
  }

  return toStaticSourceStatus({
    source: input.source,
    runtimeInfo: input.runtimeInfo,
    localConfig: input.localConfig,
    isProbing: input.isProbing,
  });
}

export function deriveModelAccessViewState(input: {
  runtimeInfo: AgentModelConfigRuntimeInfo | null;
  localConfig: AgentModelConfig | null;
  userClaudeSettingsTestResult: AgentModelConfigAuthTestResult | null;
  projectModelConfigTestResult: AgentModelConfigAuthTestResult | null;
  isProbing: boolean;
}): ModelAccessViewState {
  const userClaudeSettings = toSourceStatus({
    source: 'user_claude_settings',
    runtimeInfo: input.runtimeInfo,
    localConfig: input.localConfig,
    result: input.userClaudeSettingsTestResult,
    isProbing: input.isProbing,
  });
  const projectModelConfig = toSourceStatus({
    source: 'project_model_config',
    runtimeInfo: input.runtimeInfo,
    localConfig: input.localConfig,
    result: input.projectModelConfigTestResult,
    isProbing: input.isProbing,
  });

  const statuses = [userClaudeSettings, projectModelConfig];
  const hasSuccess = statuses.includes('success');
  const hasFailure = statuses.includes('failed');
  const hasPending = statuses.includes('probing');
  const hasConfigGap = statuses.includes('needs_config') || statuses.includes('unavailable');
  const hasResolvedResult = Boolean(
    input.userClaudeSettingsTestResult || input.projectModelConfigTestResult
  );
  const phase: ModelAccessPhase = input.isProbing
    ? 'probing'
    : hasResolvedResult
      ? 'resolved'
      : 'static';

  if (hasPending) {
    const isAwaitingFirstSuccessfulProbe = !hasResolvedResult && !hasSuccess;
    return {
      phase,
      overallStatus: hasSuccess ? 'partial' : 'probing',
      summary: hasSuccess
        ? '当前已有可用模型来源，正在补充检测其余来源。'
        : isAwaitingFirstSuccessfulProbe
          ? '正在检查 Claude CLI、项目模型配置和真实联通性，请稍候。'
          : hasConfigGap
            ? '当前需先补齐模型配置。'
            : '正在检查 Claude CLI、项目模型配置和真实联通性，请稍候。',
      userClaudeSettings,
      projectModelConfig,
    };
  }

  return {
    phase,
    overallStatus: hasSuccess && hasFailure
      ? 'partial'
      : hasSuccess
        ? 'available'
        : hasConfigGap
          ? 'needs_config'
          : 'unavailable',
    summary: hasSuccess && hasFailure
      ? '当前部分模型来源可用。'
      : hasSuccess
        ? '当前模型可用。'
        : hasConfigGap
          ? '当前需先补齐模型配置。'
          : '当前模型暂不可用。',
    userClaudeSettings,
    projectModelConfig,
  };
}
