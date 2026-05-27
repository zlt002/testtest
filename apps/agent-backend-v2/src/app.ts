import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCapabilitiesService } from './capabilities/capabilities.ts';
import { createCommandsService } from './commands/commands-service.ts';
import { sendError, sendJson, setCorsHeaders } from './http/json.ts';
import * as defaultCapabilityCatalogService from './management/capability-catalog-service.ts';
import * as defaultHooksOverviewService from './management/hooks-overview-service.ts';
import * as defaultPluginManagementService from './management/plugin-management-service.ts';
import type {
  ModelConfig,
  ModelConfigAuthTestResult,
  ModelConfigRuntimeInfo,
  OfficialModelCatalogItem,
  OfficialQuota,
} from './model-config/model-config-service.ts';
import { createAgentV2Route } from './routes/agent-v2.ts';
import { createAccrSyncRoute } from './routes/accr-sync.ts';
import { createCapabilitiesRoute } from './routes/capabilities.ts';
import { createCommandsRoute } from './routes/commands.ts';
import { createFilesRoute } from './routes/files.ts';
import { createHooksRoute } from './routes/hooks.ts';
import { createMcpRoute } from './routes/mcp.ts';
import { createMcpRegistryRoute } from './routes/mcp-registry.ts';
import { createModelConfigRoute } from './routes/model-config.ts';
import { createPageCodeAnalysisRoute } from './routes/page-code-analysis.ts';
import { createPluginsRoute } from './routes/plugins.ts';
import { createPreviewRoute } from './routes/preview.ts';
import { createRuntimeCapabilitiesRoute } from './routes/runtime-capabilities.ts';
import { createSessionFilesRoute } from './routes/session-files.ts';
import { createSnapshotEditRoute } from './routes/snapshot-edit.ts';
import { createSystemUpdateRoute } from './routes/system-update.ts';
import type { RuntimeCapabilities } from './runtime-capabilities/runtime-capabilities-service.ts';
import type { createSessionFileService } from './session-files/session-file-service.ts';
import { createSnapshotEditService } from './snapshot-edit/snapshot-edit-service.ts';
import { createWebMcpLiteUpdateService } from './system-update/webmcp-lite-update.ts';

export function createApp(deps: {
  agentService: Parameters<typeof createAgentV2Route>[0];
  accrSyncService?: Parameters<typeof createAccrSyncRoute>[0];
  fileService: Parameters<typeof createFilesRoute>[0];
  mcpService: Parameters<typeof createMcpRoute>[0];
  pageCodeAnalysisProjectNameByRepo?: Record<string, string>;
  pageCodeAnalysisAttributionService?: NonNullable<
    Parameters<typeof createPageCodeAnalysisRoute>[0]
  >['attributionService'];
  mcpRegistryService?: Parameters<typeof createMcpRegistryRoute>[0];
  capabilitiesService?: Parameters<typeof createCapabilitiesRoute>[0];
  capabilityCatalogService?: Parameters<typeof createCapabilitiesRoute>[1];
  commandsService?: Parameters<typeof createCommandsRoute>[0];
  pluginManagementService?: Parameters<typeof createPluginsRoute>[0];
  hooksOverviewService?: Parameters<typeof createHooksRoute>[0];
  runtimeCapabilitiesService?: {
    getCapabilities(): Promise<RuntimeCapabilities>;
    updateCapabilities(patch: Partial<RuntimeCapabilities>): Promise<RuntimeCapabilities>;
  };
  modelConfigService?: {
    getConfig(): Promise<ModelConfig>;
    updateConfig(patch: Partial<ModelConfig>): Promise<ModelConfig>;
    getRuntimeInfo(): Promise<ModelConfigRuntimeInfo>;
    testConfig(patch: Partial<ModelConfig>): Promise<ModelConfigAuthTestResult>;
    listOfficialModels(input: { apiKey: string }): Promise<OfficialModelCatalogItem[]>;
    getOfficialQuota(input: { apiKey: string }): Promise<OfficialQuota>;
  };
  sessionFileService?: ReturnType<typeof createSessionFileService>;
  snapshotEditService?: Parameters<typeof createSnapshotEditRoute>[0];
  systemUpdateService?: Parameters<typeof createSystemUpdateRoute>[0];
}) {
  const handleAgentV2 = createAgentV2Route(deps.agentService);
  const handleFiles = createFilesRoute(deps.fileService);
  const handleMcp = createMcpRoute(deps.mcpService);
  const handleMcpRegistry = deps.mcpRegistryService
    ? createMcpRegistryRoute(deps.mcpRegistryService)
    : null;
  const pluginManagementService = deps.pluginManagementService ?? defaultPluginManagementService;
  const commandsService = deps.commandsService ?? createCommandsService();
  const capabilityCatalogService = deps.capabilityCatalogService ?? defaultCapabilityCatalogService;
  const invalidateCommandCatalog = () => {
    (commandsService as { invalidateCache?: () => void }).invalidateCache?.();
  };
  const invalidateCapabilityCatalog = (input?: { type?: 'skill' | 'command' }) => {
    (
      capabilityCatalogService as {
        clearCapabilityCatalogCache?: (input?: { type?: 'skill' | 'command' }) => void;
      }
    ).clearCapabilityCatalogCache?.(input);
  };
  const handleAccrSync = deps.accrSyncService
    ? createAccrSyncRoute(deps.accrSyncService, {
        invalidateCapabilityCatalog: (input) => {
          if (input.type === 'skill') {
            invalidateCapabilityCatalog({ type: 'skill' });
          }
        },
        invalidateCommandCatalog,
      })
    : null;
  const handleCommands = createCommandsRoute(commandsService, pluginManagementService);
  const handlePlugins = createPluginsRoute(pluginManagementService, {
    invalidateCapabilityCatalog,
    invalidateCommandCatalog,
  });
  const handleHooks = createHooksRoute(deps.hooksOverviewService ?? defaultHooksOverviewService);
  const handleCapabilities = createCapabilitiesRoute(
    deps.capabilitiesService ?? createCapabilitiesService(),
    capabilityCatalogService,
    pluginManagementService,
    { invalidateCommandCatalog }
  );
  const handleRuntimeCapabilities = deps.runtimeCapabilitiesService
    ? createRuntimeCapabilitiesRoute(deps.runtimeCapabilitiesService)
    : null;
  const handleModelConfig = deps.modelConfigService
    ? createModelConfigRoute(deps.modelConfigService)
    : null;
  const handleSessionFiles = deps.sessionFileService
    ? createSessionFilesRoute(deps.sessionFileService)
    : null;
  const handlePageCodeAnalysis = createPageCodeAnalysisRoute({
    projectNameByRepo: deps.pageCodeAnalysisProjectNameByRepo,
    attributionService: deps.pageCodeAnalysisAttributionService,
  });
  const handleSnapshotEdit = createSnapshotEditRoute(
    deps.snapshotEditService ?? createSnapshotEditService()
  );
  const handlePreview = createPreviewRoute();
  const handleSystemUpdate = createSystemUpdateRoute(
    deps.systemUpdateService ?? createWebMcpLiteUpdateService()
  );

  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      try {
        if (!req.url) {
          sendJson(res, 404, { error: 'Not found' });
          return;
        }

        if (req.method === 'OPTIONS') {
          setCorsHeaders(res);
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, 'http://127.0.0.1');
        if (await handleAgentV2(req, res, url)) {
          return;
        }
        if (handleAccrSync && (await handleAccrSync(req, res, url))) {
          return;
        }
        if (await handleFiles(req, res, url)) {
          return;
        }
        if (await handleMcp(req, res, url)) {
          return;
        }
        if (handleMcpRegistry && (await handleMcpRegistry(req, res, url))) {
          return;
        }
        if (await handleCommands(req, res, url.pathname)) {
          return;
        }
        if (await handlePlugins(req, res, url)) {
          return;
        }
        if (await handleHooks(req, res, url)) {
          return;
        }
        if (await handleCapabilities(req, res, url)) {
          return;
        }
        if (handleRuntimeCapabilities && (await handleRuntimeCapabilities(req, res, url))) {
          return;
        }
        if (handleModelConfig && (await handleModelConfig(req, res, url))) {
          return;
        }
        if (handleSessionFiles && (await handleSessionFiles(req, res, url))) {
          return;
        }
        if (await handlePageCodeAnalysis(req, res, url.pathname)) {
          return;
        }
        if (await handleSnapshotEdit(req, res, url)) {
          return;
        }
        if (await handlePreview(req, res, url)) {
          return;
        }
        if (await handleSystemUpdate(req, res, url)) {
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        if (!sendError(res, error)) {
          console.error(
            '[agent-backend-v2] request handling failed after response started:',
            error
          );
        }
      }
    },
  };
}
