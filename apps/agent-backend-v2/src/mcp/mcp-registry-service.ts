import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createBrowserExtensionMcpServer, type McpServerConfig } from './browser-extension-mcp.ts';
import { ensureDefaultUserMcpServer } from './default-user-mcp.ts';
import { type DiscoveredMcpTool, discoverMcpTools } from './mcp-tool-discovery.ts';
import {
  readMcpServerOverrides,
  resolveMcpProjectScope,
  writeMcpServerOverrides,
} from './mcp-server-overrides.ts';

export type McpRegistryServer = {
  name: string;
  builtIn: boolean;
  disabled: boolean;
  type: 'stdio' | 'http' | 'sse';
  source: 'built-in' | 'project' | 'user';
  config: McpServerConfig;
  enabledToolCount: number;
  totalToolCount: number;
  status: 'enabled' | 'disabled' | 'error';
};

export type McpRegistryTool = {
  name: string;
  fullName: string;
  description?: string;
  inputSchema?: unknown;
  enabled: boolean;
};

type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

type ClaudeConfigFile = Record<string, unknown> &
  McpConfigFile & {
    projects?: Record<
      string,
      {
        disabledMcpServers?: string[];
      }
    >;
  };

type McpWriteScope = 'project' | 'user';

type ToolPermissions = {
  allowedTools?: string[];
  disallowedTools?: string[];
};

type McpRegistryList = {
  servers: McpRegistryServer[];
  rawJson: string;
};

const RawMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

const MAX_REGISTRY_CACHE_ENTRIES = 25;

const BROWSER_EXTENSION_TOOLS: Array<Omit<McpRegistryTool, 'enabled'>> = [
  {
    name: 'read_current_page_content',
    fullName: 'mcp__browser_extension__read_current_page_content',
    description: '读取当前浏览器页面内容。',
    inputSchema: {
      type: 'object',
      properties: {
        includeFrames: {
          type: 'boolean',
          description: '是否包含 iframe 内容。',
        },
        frameStrategy: {
          type: 'string',
          description: 'iframe 读取策略，例如 "auto" 或 "wps-priority"。',
        },
        includeFrameAnalysis: {
          type: 'boolean',
          description: '是否包含 iframe 分析结果。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_locate_dom',
    fullName: 'mcp__browser_extension__snapshot_locate_dom',
    description:
      'Fast local snapshot helper. Locate the smallest DOM element in an HTML file by absolute filePath plus one-based line and column.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        line: { type: 'number', description: 'One-based line number.' },
        column: { type: 'number', description: 'One-based column number.' },
      },
      required: ['filePath', 'line', 'column'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_find_css',
    fullName: 'mcp__browser_extension__snapshot_find_css',
    description:
      'Fast local snapshot helper. Find CSS rules in linked stylesheets that match a located DOM selector.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'DOM selector returned by snapshot_locate_dom.' },
      },
      required: ['htmlPath', 'selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_html',
    fullName: 'mcp__browser_extension__snapshot_patch_html',
    description:
      'Fast local snapshot helper. Patch HTML by source range or selector-driven operations, including attributes, node removal, inner HTML replacement, and text replacement.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        operation: {
          type: 'object',
          description:
            'Patch operation. Use { type: "setAttributes", attributes: { class: "...", "data-x": "..." } }.',
        },
      },
      required: ['filePath', 'range', 'operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_node',
    fullName: 'mcp__browser_extension__snapshot_remove_node',
    description:
      'Fast local snapshot helper. Remove one HTML node by source range returned from snapshot_locate_dom.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
      },
      required: ['filePath', 'range'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_nodes_by_selector',
    fullName: 'mcp__browser_extension__snapshot_remove_nodes_by_selector',
    description:
      'Fast local snapshot helper. Remove all matching HTML nodes in one file write by selector, optionally scoped to a source range.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'Selector used to match nodes to remove.' },
        scopeRange: {
          type: 'object',
          description: 'Optional ancestor/source range to limit removals.',
        },
      },
      required: ['filePath', 'selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_similar_nodes',
    fullName: 'mcp__browser_extension__snapshot_remove_similar_nodes',
    description:
      'Fast local snapshot helper. Remove nodes similar to an anchor node, for example same selector or same tag/classes.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: {
          type: 'object',
          description: 'Anchor node source range from snapshot_locate_dom.',
        },
        matchMode: {
          type: 'string',
          description: 'Similarity mode: sameSelector, sameTagAndClasses, or sameStructure.',
        },
        scopeRange: {
          type: 'object',
          description: 'Optional ancestor/source range to limit removals.',
        },
      },
      required: ['filePath', 'range'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_replace_inner_html',
    fullName: 'mcp__browser_extension__snapshot_replace_inner_html',
    description:
      'Fast local snapshot helper. Keep the wrapper element and replace only its inner HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        html: { type: 'string', description: 'Replacement inner HTML.' },
      },
      required: ['filePath', 'range', 'html'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_replace_text',
    fullName: 'mcp__browser_extension__snapshot_replace_text',
    description:
      'Fast local snapshot helper. Replace the text content of a simple text-only HTML element.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        text: { type: 'string', description: 'Replacement text content.' },
      },
      required: ['filePath', 'range', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_css',
    fullName: 'mcp__browser_extension__snapshot_patch_css',
    description:
      'Fast local snapshot helper. Update or append CSS declarations for a selector in the snapshot stylesheet.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'CSS selector to update or append.' },
        declarations: {
          type: 'object',
          description: 'CSS declarations, for example { color: "#fff", background: "#111" }.',
          additionalProperties: true,
        },
      },
      required: ['htmlPath', 'selector', 'declarations'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_css_batch',
    fullName: 'mcp__browser_extension__snapshot_patch_css_batch',
    description:
      'Fast local snapshot helper. Update or append multiple CSS rules in one stylesheet write. Prefer this over repeated snapshot_patch_css calls.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        rules: {
          type: 'array',
          description: 'CSS rule patches to apply in order.',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to update or append.' },
              declarations: {
                type: 'object',
                description: 'CSS declarations for this selector.',
                additionalProperties: true,
              },
            },
            required: ['selector', 'declarations'],
            additionalProperties: false,
          },
        },
      },
      required: ['htmlPath', 'rules'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_website_tools',
    fullName: 'mcp__browser_extension__list_website_tools',
    description: '列出当前页面暴露的网站工具。',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: '可选，按域名关键词过滤，例如 "webedit"。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_extension_tools',
    fullName: 'mcp__browser_extension__list_extension_tools',
    description: '列出浏览器扩展提供的 MCP 工具。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'call_website_tool',
    fullName: 'mcp__browser_extension__call_website_tool',
    description: '调用当前页面暴露的网站工具。',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: '要调用的 website tool 全名。',
        },
        arguments: {
          type: 'object',
          description: '传给 website tool 的参数对象。',
          additionalProperties: true,
        },
      },
      required: ['toolName'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_extension_tool',
    fullName: 'mcp__browser_extension__call_extension_tool',
    description: '调用浏览器扩展提供的 MCP 工具。',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: '要调用的 extension tool 全名。',
        },
        arguments: {
          type: 'object',
          description: '传给 extension tool 的参数对象。',
          additionalProperties: true,
        },
      },
      required: ['toolName'],
      additionalProperties: false,
    },
  },
];

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        ),
      ]
    : [];
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readConfig(configPath: string): Promise<McpConfigFile> {
  return readJsonFile<McpConfigFile>(configPath, { mcpServers: {} });
}

async function readUserConfig(configPath: string): Promise<ClaudeConfigFile> {
  const payload = await ensureDefaultUserMcpServer(configPath);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { mcpServers: {} };
  }
  const record = payload as Record<string, unknown>;
  const parsedServers = RawMcpConfigSchema.safeParse({ mcpServers: record.mcpServers });
  const projects =
    record.projects && typeof record.projects === 'object' && !Array.isArray(record.projects)
      ? (record.projects as ClaudeConfigFile['projects'])
      : undefined;
  return {
    ...record,
    mcpServers: parsedServers.success ? parsedServers.data.mcpServers : {},
    projects,
  };
}

async function writeConfig(configPath: string, config: McpConfigFile): Promise<void> {
  await writeJsonFile(configPath, { ...config, mcpServers: config.mcpServers || {} });
}

async function writeUserConfig(configPath: string, config: ClaudeConfigFile): Promise<void> {
  await writeJsonFile(configPath, { ...config, mcpServers: config.mcpServers || {} });
}

async function readPermissions(permissionsPath: string): Promise<Required<ToolPermissions>> {
  const payload = await readJsonFile<ToolPermissions>(permissionsPath, {});
  return {
    allowedTools: normalizeList(payload.allowedTools),
    disallowedTools: normalizeList(payload.disallowedTools),
  };
}

function inferServerType(config: McpServerConfig): 'stdio' | 'http' | 'sse' {
  const explicitType = typeof config.type === 'string' ? config.type : '';
  const transport = typeof config.transport === 'string' ? config.transport : '';
  if (explicitType === 'sse' || transport === 'sse') {
    return 'sse';
  }
  if (explicitType === 'http' || transport === 'http' || typeof config.url === 'string') {
    return 'http';
  }
  return 'stdio';
}

function toRegistryServer(input: {
  name: string;
  config: McpServerConfig;
  builtIn: boolean;
  source: 'built-in' | 'project' | 'user';
  permissions: Required<ToolPermissions>;
}): McpRegistryServer {
  const disabled = input.config.disabled === true;
  const tools = getKnownTools(input.name, input.permissions);
  return {
    name: input.name,
    builtIn: input.builtIn,
    disabled,
    type: inferServerType(input.config),
    source: input.source,
    config: input.config,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    totalToolCount: tools.length,
    status: disabled ? 'disabled' : 'enabled',
  };
}

function getKnownTools(name: string, permissions: Required<ToolPermissions>): McpRegistryTool[] {
  const sourceTools = name === 'browser_extension' ? BROWSER_EXTENSION_TOOLS : [];
  return sourceTools.map((tool) => ({
    ...tool,
    enabled: !permissions.disallowedTools.includes(tool.fullName),
  }));
}

function toRegistryTools(
  serverName: string,
  tools: Array<Omit<McpRegistryTool, 'enabled' | 'fullName'> & { fullName?: string }>,
  permissions: Required<ToolPermissions>
): McpRegistryTool[] {
  return tools.map((tool) => ({
    ...tool,
    fullName: tool.fullName || `mcp__${serverName}__${tool.name}`,
    enabled: !permissions.disallowedTools.includes(
      tool.fullName || `mcp__${serverName}__${tool.name}`
    ),
  }));
}

function mergeTools(tools: McpRegistryTool[]): McpRegistryTool[] {
  const byFullName = new Map<string, McpRegistryTool>();
  for (const tool of tools) {
    byFullName.set(tool.fullName, tool);
  }
  return [...byFullName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseToolServerName(fullName: string): string | null {
  const match = fullName.match(/^mcp__([^_].*?)__(.+)$/);
  return match ? match[1] : null;
}

export function createMcpRegistryService(options: {
  configPath: string;
  userConfigPath?: string;
  projectPath?: string;
  permissionsPath: string;
  browserExtensionMcpUrl: string;
  enableBrowserExtensionMcp: boolean;
  discoverTools?: (name: string, config: McpServerConfig) => Promise<DiscoveredMcpTool[]>;
}) {
  const toolCache = new Map<string, McpRegistryTool[]>();
  const registryCache = new Map<string, McpRegistryList>();
  const pendingRegistryReads = new Map<string, Promise<McpRegistryList>>();
  const discover = options.discoverTools || discoverMcpTools;
  const userConfigPath = options.userConfigPath || join(homedir(), '.claude.json');

  function cloneRegistryServer(server: McpRegistryServer): McpRegistryServer {
    return {
      ...server,
      config: JSON.parse(JSON.stringify(server.config)) as McpServerConfig,
    };
  }

  function cloneRegistry(registry: McpRegistryList): McpRegistryList {
    return {
      rawJson: registry.rawJson,
      servers: registry.servers.map(cloneRegistryServer),
    };
  }

  function registryCacheKey(scope: ReturnType<typeof resolveMcpProjectScope>) {
    return JSON.stringify({
      projectPath: scope.projectPath,
      configPath: scope.configPath,
      permissionsPath: scope.permissionsPath,
      overridesPath: scope.overridesPath,
      userConfigPath,
    });
  }

  function rememberRegistry(cacheKey: string, registry: McpRegistryList) {
    if (!registryCache.has(cacheKey) && registryCache.size >= MAX_REGISTRY_CACHE_ENTRIES) {
      const oldestKey = registryCache.keys().next().value;
      if (oldestKey) {
        registryCache.delete(oldestKey);
      }
    }
    registryCache.set(cacheKey, cloneRegistry(registry));
  }

  function invalidateRegistryCache() {
    registryCache.clear();
    pendingRegistryReads.clear();
  }

  async function listServers(input?: {
    forceRefresh?: boolean;
    projectPath?: string;
  }): Promise<{ servers: McpRegistryServer[]; rawJson: string }> {
    const scope = resolveMcpProjectScope(options, input?.projectPath);
    const cacheKey = registryCacheKey(scope);
    if (input?.forceRefresh) {
      registryCache.delete(cacheKey);
      pendingRegistryReads.delete(cacheKey);
    } else {
      const cached = registryCache.get(cacheKey);
      if (cached) {
        return cloneRegistry(cached);
      }
      const pending = pendingRegistryReads.get(cacheKey);
      if (pending) {
        return cloneRegistry(await pending);
      }
    }

    const pending = readRegistry(scope);
    pendingRegistryReads.set(cacheKey, pending);
    try {
      const registry = await pending;
      rememberRegistry(cacheKey, registry);
      return cloneRegistry(registry);
    } finally {
      pendingRegistryReads.delete(cacheKey);
    }
  }

  async function readRegistry(
    scope: ReturnType<typeof resolveMcpProjectScope>
  ): Promise<McpRegistryList> {
    const [config, userConfig, permissions, overrides] = await Promise.all([
      readConfig(scope.configPath),
      readUserConfig(userConfigPath),
      readPermissions(scope.permissionsPath),
      readMcpServerOverrides(scope.overridesPath),
    ]);
    const projectServers = config.mcpServers || {};
    const userServers = userConfig.mcpServers || {};
    const disabledServers = new Set([
      ...normalizeList(userConfig.projects?.[scope.projectPath]?.disabledMcpServers),
      ...overrides.disabledServers,
    ]);
    const servers: McpRegistryServer[] = [];

    for (const [name, serverConfig] of Object.entries(userServers)) {
      if (projectServers[name]) continue;
      servers.push(
        toRegistryServer({
          name,
          config: {
            ...serverConfig,
            disabled: serverConfig.disabled === true || disabledServers.has(name),
          },
          builtIn: false,
          source: 'user',
          permissions,
        })
      );
      const cachedTools = toolCache.get(name);
      if (cachedTools) {
        servers[servers.length - 1] = {
          ...servers[servers.length - 1],
          enabledToolCount: cachedTools.filter((tool) => tool.enabled).length,
          totalToolCount: cachedTools.length,
        };
      }
    }

    if (options.enableBrowserExtensionMcp && !projectServers.browser_extension) {
      servers.push(
        toRegistryServer({
          name: 'browser_extension',
          config: {
            ...createBrowserExtensionMcpServer(options.browserExtensionMcpUrl),
            disabled: disabledServers.has('browser_extension'),
          },
          builtIn: true,
          source: 'built-in',
          permissions,
        })
      );
      const cachedTools = toolCache.get('browser_extension');
      if (cachedTools) {
        servers[servers.length - 1] = {
          ...servers[servers.length - 1],
          enabledToolCount: cachedTools.filter((tool) => tool.enabled).length,
          totalToolCount: cachedTools.length,
        };
      }
    }

    for (const [name, serverConfig] of Object.entries(projectServers)) {
      servers.push(
        toRegistryServer({
          name,
          config: serverConfig,
          builtIn: name === 'browser_extension',
          source: 'project',
          permissions,
        })
      );
      const cachedTools = toolCache.get(name);
      if (cachedTools) {
        servers[servers.length - 1] = {
          ...servers[servers.length - 1],
          enabledToolCount: cachedTools.filter((tool) => tool.enabled).length,
          totalToolCount: cachedTools.length,
        };
      }
    }

    const rawJson = `${JSON.stringify({ ...config, mcpServers: projectServers }, null, 2)}\n`;
    return { servers, rawJson };
  }

  return {
    listServers,

    async upsertServer(
      name: string,
      server: McpServerConfig,
      input?: { projectPath?: string; scope?: McpWriteScope }
    ): Promise<{ rawJson: string; servers: McpRegistryServer[] }> {
      const serverName = z
        .string()
        .min(1)
        .regex(/^[a-zA-Z0-9_.-]+$/)
        .parse(name);
      const serverConfig = z.record(z.string(), z.unknown()).parse(server) as McpServerConfig;
      if (input?.scope === 'user') {
        const userConfig = await readUserConfig(userConfigPath);
        await writeUserConfig(userConfigPath, {
          ...userConfig,
          mcpServers: {
            ...(userConfig.mcpServers || {}),
            [serverName]: serverConfig,
          },
        });
        invalidateRegistryCache();
        return listServers({ ...input, forceRefresh: true });
      }

      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const config = await readConfig(scope.configPath);
      await writeConfig(scope.configPath, {
        ...config,
        mcpServers: {
          ...(config.mcpServers || {}),
          [serverName]: serverConfig,
        },
      });
      invalidateRegistryCache();
      return listServers({ ...input, forceRefresh: true });
    },

    async readRawConfig(): Promise<{ rawJson: string }> {
      return { rawJson: (await listServers()).rawJson };
    },

    async writeRawConfig(
      rawJson: string,
      input?: { projectPath?: string }
    ): Promise<{ rawJson: string; servers: McpRegistryServer[] }> {
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const parsed = RawMcpConfigSchema.parse(JSON.parse(rawJson));
      await writeConfig(scope.configPath, parsed);
      invalidateRegistryCache();
      return listServers({ ...input, forceRefresh: true });
    },

    async setServerEnabled(
      name: string,
      enabled: boolean,
      input?: { projectPath?: string }
    ): Promise<{ servers: McpRegistryServer[] }> {
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const [config, userConfig, overrides] = await Promise.all([
        readConfig(scope.configPath),
        readUserConfig(userConfigPath),
        readMcpServerOverrides(scope.overridesPath),
      ]);
      const projectServer = config.mcpServers?.[name];
      if (projectServer) {
        await writeConfig(scope.configPath, {
          ...config,
          mcpServers: {
            ...(config.mcpServers || {}),
            [name]: { ...projectServer, disabled: !enabled },
          },
        });
        invalidateRegistryCache();
        return { servers: (await listServers({ ...input, forceRefresh: true })).servers };
      }

      const isBuiltIn = name === 'browser_extension' && options.enableBrowserExtensionMcp;
      const isUserServer = Boolean(userConfig.mcpServers?.[name]);
      if (!isBuiltIn && !isUserServer) {
        throw new Error(`MCP server not found: ${name}`);
      }
      const nextDisabledServers = new Set(overrides.disabledServers);
      if (enabled) {
        nextDisabledServers.delete(name);
      } else {
        nextDisabledServers.add(name);
      }
      await writeMcpServerOverrides(scope.overridesPath, {
        disabledServers: [...nextDisabledServers].sort(),
      });
      invalidateRegistryCache();
      return { servers: (await listServers({ ...input, forceRefresh: true })).servers };
    },

    async deleteServer(
      name: string,
      input?: { projectPath?: string; scope?: McpWriteScope }
    ): Promise<{ servers: McpRegistryServer[] }> {
      if (name === 'browser_extension') {
        throw new Error('Built-in browser_extension MCP server cannot be deleted.');
      }
      if (input?.scope === 'user') {
        const userConfig = await readUserConfig(userConfigPath);
        const nextServers = { ...(userConfig.mcpServers || {}) };
        delete nextServers[name];
        toolCache.delete(name);
        await writeUserConfig(userConfigPath, { ...userConfig, mcpServers: nextServers });
        invalidateRegistryCache();
        return { servers: (await listServers({ ...input, forceRefresh: true })).servers };
      }
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const config = await readConfig(scope.configPath);
      const nextServers = { ...(config.mcpServers || {}) };
      delete nextServers[name];
      toolCache.delete(name);
      await writeConfig(scope.configPath, { ...config, mcpServers: nextServers });
      invalidateRegistryCache();
      return { servers: (await listServers({ ...input, forceRefresh: true })).servers };
    },

    async listServerTools(
      name: string,
      input?: { projectPath?: string }
    ): Promise<{ server: McpRegistryServer; tools: McpRegistryTool[] }> {
      const registry = await listServers(input);
      const server = registry.servers.find((candidate) => candidate.name === name);
      if (!server) {
        throw new Error(`MCP server not found: ${name}`);
      }
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const permissions = await readPermissions(scope.permissionsPath);
      const knownTools = getKnownTools(name, permissions);
      const discoveredTools = server.disabled
        ? []
        : await discover(name, server.config).catch(() => []);
      const tools = mergeTools([
        ...knownTools,
        ...toRegistryTools(name, discoveredTools, permissions),
      ]);
      toolCache.set(name, tools);
      invalidateRegistryCache();
      return {
        server: {
          ...server,
          enabledToolCount: tools.filter((tool) => tool.enabled).length,
          totalToolCount: tools.length,
        },
        tools,
      };
    },

    async setToolEnabled(
      fullName: string,
      enabled: boolean,
      input?: { projectPath?: string }
    ): Promise<Required<ToolPermissions>> {
      if (!parseToolServerName(fullName)) {
        throw new Error(`Invalid MCP tool name: ${fullName}`);
      }
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      const permissions = await readPermissions(scope.permissionsPath);
      const allowed = new Set(permissions.allowedTools);
      const disallowed = new Set(permissions.disallowedTools);
      if (enabled) {
        allowed.add(fullName);
        disallowed.delete(fullName);
      } else {
        allowed.delete(fullName);
        disallowed.add(fullName);
      }
      const next = {
        allowedTools: [...allowed].sort(),
        disallowedTools: [...disallowed].sort(),
      };
      await writeJsonFile(scope.permissionsPath, next);
      invalidateRegistryCache();
      return next;
    },

    async getToolPermissions(input?: { projectPath?: string }): Promise<Required<ToolPermissions>> {
      const scope = resolveMcpProjectScope(options, input?.projectPath);
      return readPermissions(scope.permissionsPath);
    },
  };
}
