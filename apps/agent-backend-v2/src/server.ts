import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createAgentService } from './agent/application/agent-service.ts';
import { createSessionRunStateStore } from './agent/application/session-run-state.ts';
import { createClaudeSessionPool } from './agent/runtime/claude-session-pool.ts';
import { createAccrSyncService } from './accr-sync/accr-sync-service.ts';
import { createLocalSyncFiles } from './accr-sync/local-sync-files.ts';
import { createRemoteSyncManager } from './accr-sync/remote-sync-manager.ts';
import { createSyncConfigStore } from './accr-sync/sync-config-store.ts';
import { createSyncStateStore } from './accr-sync/sync-state-store.ts';
import { createApp } from './app.ts';
import { createCapabilitiesService } from './capabilities/capabilities.ts';
import { normalizeClaudeHistoryRecords } from './claude-history/history-normalizer.ts';
import {
  listClaudeProjectHistoryFiles,
  readClaudeHistoryFile,
} from './claude-history/official-history-reader.ts';
import { listClaudeProjects } from './claude-history/project-list-reader.ts';
import { listClaudeSessions } from './claude-history/session-list-reader.ts';
import { loadEnv } from './config/env.ts';
import { createFileService } from './files/file-service.ts';
import { createCommandsService } from './commands/commands-service.ts';
import * as pluginManagementService from './management/plugin-management-service.ts';
import * as defaultCapabilityCatalogService from './management/capability-catalog-service.ts';
import { createMcpConfigService } from './mcp/mcp-config-service.ts';
import { createMcpRegistryService } from './mcp/mcp-registry-service.ts';
import { createModelConfigService } from './model-config/model-config-service.ts';
import { createRuntimeCapabilitiesService } from './runtime-capabilities/runtime-capabilities-service.ts';
import { createServerAgentV2Service } from './server-agent-v2-service.ts';
import { createSessionFileService } from './session-files/session-file-service.ts';
import { createSessionMetadataService } from './sessions/session-metadata-service.ts';
import { buildGlobalSkillSources } from './skills/global-skill-sources.ts';
import {
  createWorkspaceService,
  resolveDefaultWorkspacePath,
} from './workspaces/workspace-service.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../.dev.vars'), override: true });

const env = loadEnv();
const defaultWorkspacePath = resolveDefaultWorkspacePath(env.workdir);
const globalSkillSources = buildGlobalSkillSources(env.globalSkillRoots);

async function mergeBuiltinSkillSources(
  sources: Array<{ rootDir: string; scanDir: string; prefix?: string }> = []
) {
  const merged = [
    ...(await defaultCapabilityCatalogService.listBuiltinCapabilitySources()),
    ...sources,
    ...globalSkillSources.map((source) => ({
      rootDir: source.rootDir,
      scanDir: source.rootDir,
    })),
  ];

  return merged.filter((source, index, collection) => {
    const key = `${resolve(source.rootDir)}::${resolve(source.scanDir)}::${source.prefix || ''}`;
    return (
      collection.findIndex(
        (item) =>
          `${resolve(item.rootDir)}::${resolve(item.scanDir)}::${item.prefix || ''}` === key
      ) === index
    );
  });
}

const runtime = createClaudeSessionPool();
const runStateStore = createSessionRunStateStore();
const capabilitiesService = createCapabilitiesService({
  browserTools: env.enableBrowserExtensionMcp ? 'local_mcp_http' : 'disabled',
  workdir: env.workdir,
});
const fileService = createFileService();
mkdirSync(defaultWorkspacePath, { recursive: true });
const workspaceService = createWorkspaceService({
  configPath: resolve(env.workdir, '.webmcp', 'workspaces.json'),
  defaultWorkspacePath,
});
const sessionMetadataService = createSessionMetadataService({
  configPath: resolve(env.workdir, '.webmcp', 'sessions.json'),
});
const runtimeCapabilitiesService = createRuntimeCapabilitiesService({
  configPath: resolve(env.workdir, '.webmcp', 'runtime-capabilities.json'),
});
const sessionFilesRootDir = resolve(env.workdir, '.webmcp', 'session-files');
mkdirSync(sessionFilesRootDir, { recursive: true });
const sessionFileService = createSessionFileService({
  rootDir: sessionFilesRootDir,
});
const syncConfigStore = createSyncConfigStore();
const syncStateStore = createSyncStateStore();
const localSyncFiles = createLocalSyncFiles();
const claudeTargetDir = resolve(homedir(), '.claude');
const remoteSyncManager = createRemoteSyncManager({
  configStore: syncConfigStore,
  stateStore: syncStateStore,
  localSyncFiles,
  targetDir: claudeTargetDir,
});
const modelConfigService = createModelConfigService({
  configPath: resolve(env.workdir, '.webmcp', 'model-config.json'),
  env,
  runtimeCapabilitiesProvider: runtimeCapabilitiesService,
  authProbe: runtime,
});
const mcpService = createMcpConfigService({
  configPath: resolve(env.workdir, '.mcp.json'),
  browserExtensionMcpUrl: env.browserExtensionMcpUrl,
  enableBrowserExtensionMcp: env.enableBrowserExtensionMcp,
});
const mcpRegistryService = createMcpRegistryService({
  configPath: resolve(env.workdir, '.mcp.json'),
  projectPath: env.workdir,
  permissionsPath: resolve(env.workdir, '.webmcp', 'mcp-tool-permissions.json'),
  browserExtensionMcpUrl: env.browserExtensionMcpUrl,
  enableBrowserExtensionMcp: env.enableBrowserExtensionMcp,
});
const agentService = createAgentService({
  env,
  runtime,
  mcpServersProvider: mcpService,
  runtimeCapabilitiesProvider: runtimeCapabilitiesService,
  toolPermissionsProvider: mcpRegistryService,
  managedPluginProvider: {
    listManagedPlugins: pluginManagementService.listManagedPlugins,
  },
  modelConfigProvider: modelConfigService,
  runStateStore,
  historyReader: {
    async listProjects(input?: { forceRefresh?: boolean }) {
      const [historyProjects, manualProjects, hiddenProjectPaths] = await Promise.all([
        listClaudeProjects({ forceRefresh: input?.forceRefresh }),
        workspaceService.listProjects({ forceRefresh: input?.forceRefresh }),
        workspaceService.listHiddenProjectPaths(),
      ]);
      const hidden = new Set(hiddenProjectPaths.map((projectPath) => projectPath.toLowerCase()));
      const seen = new Set<string>();
      return [...manualProjects, ...historyProjects].filter((project) => {
        const key = project.projectPath.toLowerCase();
        if (hidden.has(key)) {
          return false;
        }
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },

    async listSessions(input) {
      return sessionMetadataService.applyMetadata(
        await listClaudeSessions({ projectPath: input?.projectPath || env.workdir })
      );
    },

    async readSessionHistory(sessionId, input) {
      const files = await listClaudeProjectHistoryFiles({
        projectPath: input?.projectPath || env.workdir,
      });
      const filePath = files.find((file) => basename(file, '.jsonl') === sessionId);
      if (!filePath) {
        return [];
      }
      return normalizeClaudeHistoryRecords(sessionId, await readClaudeHistoryFile(filePath));
    },
  },
});

const capabilityCatalogService = {
  ...defaultCapabilityCatalogService,
  async listCapabilities(
    input: Parameters<typeof defaultCapabilityCatalogService.listCapabilities>[0]
  ) {
    return defaultCapabilityCatalogService.listCapabilities({
      ...input,
      builtinSources: await mergeBuiltinSkillSources(input?.builtinSources || []),
    });
  },
  async readCapability(input: Parameters<typeof defaultCapabilityCatalogService.readCapability>[0]) {
    return defaultCapabilityCatalogService.readCapability({
      ...input,
      builtinSources: await mergeBuiltinSkillSources(input?.builtinSources || []),
    });
  },
  async readCapabilityFile(
    input: Parameters<typeof defaultCapabilityCatalogService.readCapabilityFile>[0]
  ) {
    return defaultCapabilityCatalogService.readCapabilityFile({
      ...input,
      builtinSources: await mergeBuiltinSkillSources(input?.builtinSources || []),
    });
  },
  async updateCapabilityFile(
    input: Parameters<typeof defaultCapabilityCatalogService.updateCapabilityFile>[0]
  ) {
    return defaultCapabilityCatalogService.updateCapabilityFile({
      ...input,
      builtinSources: await mergeBuiltinSkillSources(input?.builtinSources || []),
    });
  },
};

const app = createApp({
  agentService: createServerAgentV2Service({
    agentService,
    workspaceService,
    sessionMetadataService,
  }),
  accrSyncService: createAccrSyncService({
    remoteSync: remoteSyncManager,
    localDebugSync: {
      async syncLocalDebug() {
        const config = await syncConfigStore.load();
        const state = await syncStateStore.load();
        const applied = await localSyncFiles.apply({
          extractedDir: env.workdir,
          targetDir: claudeTargetDir,
          keepBackupCount: config.keepBackupCount,
        });
        const version = `local-debug-${new Date().toISOString()}`;
        await syncStateStore.save({
          ...state,
          version,
          lastSyncVersion: version,
          lastCheckedAt: new Date().toISOString(),
          lastBackupPath: applied.backupPath,
        });
        return {
          ok: true,
          status: 'completed' as const,
          mode: 'local-debug' as const,
          stdout: '',
          stderr: '',
        };
      },
    },
    healthCheck: {
      async check() {
        const checkedPath = resolve(claudeTargetDir, 'skills');
        const issues: string[] = [];
        let healthy = true;

        try {
          const stats = await stat(checkedPath);
          if (!stats.isDirectory()) {
            healthy = false;
            issues.push('技能目录存在，但不是文件夹');
          }
        } catch {
          healthy = false;
          issues.push('未找到技能目录');
        }

        const syncState = await syncStateStore.load().catch(() => null);
        return {
          ok: true as const,
          healthy,
          checkedPath,
          issues,
          recommendedAction: healthy ? ('none' as const) : ('remote_resync' as const),
          syncStateVersion: syncState?.version || undefined,
        };
      },
    },
  }),
  fileService,
  mcpService,
  mcpRegistryService,
  capabilitiesService,
  capabilityCatalogService,
  commandsService: createCommandsService({
    builtinSkillSources: globalSkillSources.map((source) => ({
      rootDir: source.rootDir,
    })),
  }),
  runtimeCapabilitiesService,
  modelConfigService,
  sessionFileService,
});
const server = createServer(app.handle);

server.listen(env.port, env.host, () => {
  console.log(`[agent-backend-v2] listening on http://${env.host}:${env.port}`);
});
