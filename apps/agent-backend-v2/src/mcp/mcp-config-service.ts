import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createBrowserExtensionMcpServer, type McpServerConfig } from './browser-extension-mcp.ts';
import { ensureDefaultUserMcpServer } from './default-user-mcp.ts';
import { readMcpServerOverrides, resolveMcpProjectScope } from './mcp-server-overrides.ts';

const ServerNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const ServerConfigSchema = z.record(z.string(), z.unknown());

type McpConfigFile = Record<string, unknown> & {
  mcpServers?: Record<string, McpServerConfig>;
};

type McpWriteScope = 'project' | 'user';

const RawMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

async function readConfig(configPath: string): Promise<McpConfigFile> {
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as McpConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { mcpServers: {} };
    }
    throw error;
  }
}

async function readUserConfig(configPath: string): Promise<McpConfigFile> {
  try {
    const payload = await ensureDefaultUserMcpServer(configPath);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { mcpServers: {} };
    }
    const parsed = RawMcpConfigSchema.safeParse(payload);
    if (!parsed.success) {
      return payload as McpConfigFile;
    }
    return {
      ...(payload as Record<string, unknown>),
      mcpServers: parsed.data.mcpServers,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { mcpServers: {} };
    }
    throw error;
  }
}

async function writeConfig(configPath: string, config: McpConfigFile): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function writeUserConfig(configPath: string, config: McpConfigFile): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function createMcpConfigService(options: {
  configPath: string;
  browserExtensionMcpUrl: string;
  enableBrowserExtensionMcp: boolean;
  userConfigPath?: string;
}) {
  function applyDisabledOverrides(
    servers: Record<string, McpServerConfig>,
    disabledServers: string[]
  ): Record<string, McpServerConfig> {
    const disabled = new Set(disabledServers);
    return Object.fromEntries(
      (Object.entries(servers) as Array<[string, McpServerConfig]>)
        .map(([name, server]) => [
          name,
          disabled.has(name) ? { ...server, disabled: true } : server,
        ])
        .filter(([, server]) => server.disabled !== true)
    );
  }

  function resolveWriteScope(input?: { scope?: McpWriteScope }) {
    return input?.scope === 'user' ? 'user' : 'project';
  }

  return {
    async listServers(input?: { projectPath?: string }): Promise<Record<string, McpServerConfig>> {
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const [config, userConfig, overrides] = await Promise.all([
        readConfig(scope.configPath),
        readUserConfig(options.userConfigPath || `${homedir()}/.claude.json`),
        readMcpServerOverrides(scope.overridesPath),
      ]);
      return applyDisabledOverrides(
        {
          ...(options.enableBrowserExtensionMcp
            ? {
                browser_extension: createBrowserExtensionMcpServer(options.browserExtensionMcpUrl),
              }
            : {}),
          ...(userConfig.mcpServers || {}),
          ...(config.mcpServers || {}),
        },
        overrides.disabledServers
      );
    },

    async upsertServer(
      name: string,
      server: McpServerConfig,
      input?: { projectPath?: string; scope?: McpWriteScope }
    ): Promise<Record<string, McpServerConfig>> {
      const serverName = ServerNameSchema.parse(name);
      const serverConfig = ServerConfigSchema.parse(server);
      if (resolveWriteScope(input) === 'user') {
        const userConfigPath = options.userConfigPath || `${homedir()}/.claude.json`;
        const userConfig = await readUserConfig(userConfigPath);
        const next = {
          ...userConfig,
          mcpServers: {
            ...(userConfig.mcpServers || {}),
            [serverName]: serverConfig,
          },
        };
        await writeUserConfig(userConfigPath, next);
        return next.mcpServers || {};
      }
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const config = await readConfig(scope.configPath);
      const next = {
        ...config,
        mcpServers: {
          ...(config.mcpServers || {}),
          [serverName]: serverConfig,
        },
      };
      await writeConfig(scope.configPath, next);
      return next.mcpServers || {};
    },

    async deleteServer(
      name: string,
      input?: { projectPath?: string; scope?: McpWriteScope }
    ): Promise<Record<string, McpServerConfig>> {
      const serverName = ServerNameSchema.parse(name);
      if (resolveWriteScope(input) === 'user') {
        const userConfigPath = options.userConfigPath || `${homedir()}/.claude.json`;
        const userConfig = await readUserConfig(userConfigPath);
        const nextServers = { ...(userConfig.mcpServers || {}) };
        delete nextServers[serverName];
        await writeUserConfig(userConfigPath, { ...userConfig, mcpServers: nextServers });
        return nextServers;
      }
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const config = await readConfig(scope.configPath);
      const nextServers = { ...(config.mcpServers || {}) };
      delete nextServers[serverName];
      const next = { ...config, mcpServers: nextServers };
      await writeConfig(scope.configPath, next);
      return nextServers;
    },
  };
}
