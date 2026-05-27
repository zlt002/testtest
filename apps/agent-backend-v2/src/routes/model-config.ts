import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import type {
  ModelConfig,
  ModelConfigAuthTestResult,
  ModelConfigRuntimeInfo,
  OfficialModelCatalogItem,
  OfficialQuota,
  UserClaudeSettingsSnapshot,
} from '../model-config/model-config-service.ts';

export function createModelConfigRoute(modelConfigService: {
  getConfig(): Promise<ModelConfig>;
  getDetectedCliConfig?(): Promise<ModelConfig | null>;
  getUserClaudeSettings?(): Promise<UserClaudeSettingsSnapshot>;
  updateUserClaudeSettings?(rawJson: string): Promise<UserClaudeSettingsSnapshot>;
  updateConfig(patch: Partial<ModelConfig>): Promise<ModelConfig>;
  getRuntimeInfo(): Promise<ModelConfigRuntimeInfo>;
  testConfig(
    patch: Partial<ModelConfig>,
    runtimeCapabilitiesOverride?: {
      selectedAuthSource?: 'user_claude_settings' | 'project_model_config';
    }
  ): Promise<ModelConfigAuthTestResult>;
  listOfficialModels(input: { apiKey: string }): Promise<OfficialModelCatalogItem[]>;
  getOfficialQuota(input: { apiKey: string }): Promise<OfficialQuota>;
}) {
  return async function handleModelConfig(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/agent-v2/model-config/official/models' && req.method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const models = await modelConfigService.listOfficialModels({
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
      });
      sendJson(res, 200, {
        success: true,
        models,
      });
      return true;
    }

    if (url.pathname === '/api/agent-v2/model-config/official/quota' && req.method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const quota = await modelConfigService.getOfficialQuota({
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
      });
      sendJson(res, 200, {
        success: true,
        quota,
      });
      return true;
    }

    if (url.pathname === '/api/agent-v2/model-config/test' && req.method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const result = await modelConfigService.testConfig(
        {
          configMode:
            body.configMode === 'official' || body.configMode === 'third_party'
              ? body.configMode
              : undefined,
          modelProvider:
            body.modelProvider === 'openai' || body.modelProvider === 'anthropic'
              ? body.modelProvider
              : undefined,
          providerVariant: body.providerVariant === 'standard' ? body.providerVariant : undefined,
          openaiModelName:
            typeof body.openaiModelName === 'string' ? body.openaiModelName : undefined,
          openaiApiKey: typeof body.openaiApiKey === 'string' ? body.openaiApiKey : undefined,
          openaiBaseUrl: typeof body.openaiBaseUrl === 'string' ? body.openaiBaseUrl : undefined,
          anthropicModelName:
            typeof body.anthropicModelName === 'string' ? body.anthropicModelName : undefined,
          anthropicApiKey:
            typeof body.anthropicApiKey === 'string' ? body.anthropicApiKey : undefined,
          anthropicBaseUrl:
            typeof body.anthropicBaseUrl === 'string' ? body.anthropicBaseUrl : undefined,
        },
        {
          selectedAuthSource:
            body.targetAuthSource === 'user_claude_settings' ||
            body.targetAuthSource === 'project_model_config'
              ? body.targetAuthSource
              : undefined,
        }
      );
      sendJson(res, 200, {
        success: true,
        result,
      });
      return true;
    }

    if (url.pathname === '/api/agent-v2/model-config/user-claude-settings' && req.method === 'PUT') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const userClaudeSettings = await modelConfigService.updateUserClaudeSettings?.(
        typeof body.rawJson === 'string' ? body.rawJson : ''
      );
      sendJson(res, 200, {
        success: true,
        userClaudeSettings: userClaudeSettings ?? {
          path: '',
          exists: false,
          rawJson: null,
        },
      });
      return true;
    }

    if (url.pathname !== '/api/agent-v2/model-config') {
      return false;
    }

    if (req.method === 'GET') {
      const [config, runtime, detectedCliConfig, userClaudeSettings] = await Promise.all([
        modelConfigService.getConfig(),
        modelConfigService.getRuntimeInfo(),
        modelConfigService.getDetectedCliConfig?.() ?? Promise.resolve(null),
        modelConfigService.getUserClaudeSettings?.() ??
          Promise.resolve({
            path: '',
            exists: false,
            rawJson: null,
          }),
      ]);
      sendJson(res, 200, {
        success: true,
        config,
        runtime,
        detectedCliConfig,
        userClaudeSettings,
      });
      return true;
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const config = await modelConfigService.updateConfig({
        configMode:
          body.configMode === 'official' || body.configMode === 'third_party'
            ? body.configMode
            : undefined,
        modelProvider:
          body.modelProvider === 'openai' || body.modelProvider === 'anthropic'
            ? body.modelProvider
            : undefined,
        providerVariant: body.providerVariant === 'standard' ? body.providerVariant : undefined,
        openaiModelName:
          typeof body.openaiModelName === 'string' ? body.openaiModelName : undefined,
        openaiApiKey: typeof body.openaiApiKey === 'string' ? body.openaiApiKey : undefined,
        openaiBaseUrl: typeof body.openaiBaseUrl === 'string' ? body.openaiBaseUrl : undefined,
        anthropicModelName:
          typeof body.anthropicModelName === 'string' ? body.anthropicModelName : undefined,
        anthropicApiKey:
          typeof body.anthropicApiKey === 'string' ? body.anthropicApiKey : undefined,
        anthropicBaseUrl:
          typeof body.anthropicBaseUrl === 'string' ? body.anthropicBaseUrl : undefined,
      });
      sendJson(res, 200, {
        success: true,
        config,
        runtime: await modelConfigService.getRuntimeInfo(),
      });
      return true;
    }

    return false;
  };
}
