import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  listCapabilities,
  type CapabilityItem,
  type CapabilitySourceKind,
} from '../management/capability-catalog-service.ts';

type PluginCommandSource = {
  id?: string;
  path: string;
  enabled?: boolean;
  sourceKind?: string;
};

export type CommandCatalogEntry = {
  name: string;
  description: string;
  namespace: 'local-ui' | 'project' | 'user' | 'plugin' | 'skill';
  path?: string;
  metadata: {
    type: 'local-ui' | 'custom' | 'skill';
    group: 'local-ui' | 'project' | 'user' | 'plugin' | 'skills';
  };
};

export type CommandCatalog = {
  localUi: CommandCatalogEntry[];
  project: CommandCatalogEntry[];
  user: CommandCatalogEntry[];
  plugin: CommandCatalogEntry[];
  skills: CommandCatalogEntry[];
  count: number;
};

export type ExecuteCommandResult =
  | {
      type: 'local-ui';
      command: string;
      action: string;
      message: string;
    }
  | {
      type: 'custom';
      command: string;
      content: string;
      metadata: Record<string, unknown>;
      hasFileIncludes: boolean;
      hasBashCommands: boolean;
    };

const LOCAL_UI_COMMANDS: CommandCatalogEntry[] = [
  localUi('/clear', '清空当前聊天视图并开始新会话'),
  localUi('/new', '开始一个新的本地会话'),
  localUi('/sessions', '打开历史会话列表'),
  localUi('/mcp', '打开 MCP 工具和连接设置'),
  localUi('/help', '显示可用命令说明'),
];

const MAX_COMMAND_CACHE_ENTRIES = 50;
const MAX_SCAN_DEPTH = 8;
const SKIPPED_SCAN_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.pnpm',
  '.svn',
  '.venv',
  '.yarn',
  '__pycache__',
  'node_modules',
  'venv',
]);

function localUi(name: string, description: string): CommandCatalogEntry {
  return {
    name,
    description,
    namespace: 'local-ui',
    metadata: { type: 'local-ui', group: 'local-ui' },
  };
}

function stripFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith('---\n')) {
    return { metadata: {}, body: content };
  }

  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    return { metadata: {}, body: content };
  }

  const rawFrontmatter = content.slice(4, end);
  const metadata: Record<string, unknown> = {};
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      metadata[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }

  return { metadata, body: content.slice(end + 4).replace(/^\r?\n/, '') };
}

function firstDescriptionLine(body: string): string {
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find(Boolean) || ''
  );
}

function commandNameFromPath(baseDir: string, filePath: string): string {
  return `/${relative(baseDir, filePath).replace(/\\/g, '/').replace(/\.md$/, '')}`;
}

function isUnder(baseDir: string, candidate: string): boolean {
  const relativePath = relative(resolve(baseDir), resolve(candidate));
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function buildSkillPrompt(commandName: string, body: string, args: string[]) {
  const skillBody = body.trim();
  const request = args.join(' ').trim();
  const sections = [
    `<webmcp_explicit_skill name="${commandName}">`,
    '你必须优先遵循下面这个 skill，严格按其中要求执行：',
    '',
    skillBody,
    '</webmcp_explicit_skill>',
  ];
  if (request) {
    sections.push('', `请使用上面的 skill 完成以下请求：\n${request}`);
  }
  return sections.join('\n').trim();
}

async function safeReadDir(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipScanDirectory(entry: { name: string; isSymbolicLink(): boolean }) {
  return entry.isSymbolicLink() || SKIPPED_SCAN_DIRECTORIES.has(entry.name.toLowerCase());
}

function normalizePluginSources(input: {
  pluginSources?: PluginCommandSource[];
  pluginPaths?: string[];
}): PluginCommandSource[] {
  return (
    input.pluginSources ??
    (input.pluginPaths || []).map((pluginPath) => ({ path: pluginPath, enabled: true }))
  );
}

function cloneCommandEntry(entry: CommandCatalogEntry): CommandCatalogEntry {
  return {
    ...entry,
    metadata: { ...entry.metadata },
  };
}

function cloneCommandCatalog(catalog: CommandCatalog): CommandCatalog {
  return {
    localUi: catalog.localUi.map(cloneCommandEntry),
    project: catalog.project.map(cloneCommandEntry),
    user: catalog.user.map(cloneCommandEntry),
    plugin: catalog.plugin.map(cloneCommandEntry),
    skills: catalog.skills.map(cloneCommandEntry),
    count: catalog.count,
  };
}

async function scanMarkdownCommands(input: {
  baseDir: string;
  namespace: 'project' | 'user' | 'plugin';
  prefix?: string;
}): Promise<CommandCatalogEntry[]> {
  const result: CommandCatalogEntry[] = [];

  async function visit(dirPath: string, depth: number) {
    if (depth > MAX_SCAN_DEPTH) {
      return;
    }
    const entries = await safeReadDir(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipScanDirectory(entry)) {
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      const { metadata, body } = stripFrontmatter(await readFile(fullPath, 'utf8'));
      result.push({
        name: `/${input.prefix ? `${input.prefix}:` : ''}${commandNameFromPath(input.baseDir, fullPath).slice(1)}`,
        description:
          typeof metadata.description === 'string'
            ? metadata.description
            : firstDescriptionLine(body),
        namespace: input.namespace,
        path: fullPath,
        metadata: { type: 'custom', group: input.namespace },
      });
    }
  }

  await visit(input.baseDir, 0);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanSkillCommands(skillRoots: string[]): Promise<CommandCatalogEntry[]> {
  const result = new Map<string, CommandCatalogEntry>();

  async function visit(dirPath: string, depth: number) {
    if (depth > MAX_SCAN_DEPTH) {
      return;
    }
    const entries = await safeReadDir(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipScanDirectory(entry)) {
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || entry.name !== 'SKILL.md') {
        continue;
      }

      const { metadata, body } = stripFrontmatter(await readFile(fullPath, 'utf8'));
      const name = `/${basename(dirname(fullPath))}`;
      if (!result.has(name)) {
        result.set(name, {
          name,
          description:
            typeof metadata.description === 'string'
              ? metadata.description
              : firstDescriptionLine(body),
          namespace: 'skill',
          path: fullPath,
          metadata: { type: 'skill', group: 'skills' },
        });
      }
    }
  }

  for (const root of skillRoots) {
    await visit(root, 0);
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function skillCommandPriority(sourceKind: CapabilitySourceKind) {
  if (sourceKind === 'builtin') return 0;
  if (sourceKind === 'user') return 1;
  if (sourceKind === 'project') return 2;
  return 3;
}

function commandEntryFromSkillCapability(capability: CapabilityItem): CommandCatalogEntry {
  return {
    name: `/${capability.name}`,
    description: capability.description,
    namespace: 'skill',
    path: capability.path,
    metadata: { type: 'skill', group: 'skills' },
  };
}

async function listSkillCommandsFromCapabilities(input: {
  homeDir: string;
  projectPath?: string;
  pluginSources: PluginCommandSource[];
  builtinSkillSources?: Array<{ rootDir: string; prefix?: string }>;
  forceRefresh?: boolean;
}) {
  const capabilities = await listCapabilities({
    type: 'skill',
    homeDir: input.homeDir,
    projectPath: input.projectPath,
    pluginSources: input.pluginSources,
    builtinSources: input.builtinSkillSources?.map((source) => ({
      rootDir: source.rootDir,
      scanDir: source.rootDir,
      prefix: source.prefix,
    })),
    forceRefresh: input.forceRefresh,
  });
  const result = new Map<string, CommandCatalogEntry>();
  for (const capability of capabilities
    .filter((item) => item.enabled !== false)
    .sort((a, b) => skillCommandPriority(a.source.kind) - skillCommandPriority(b.source.kind))) {
    const entry = commandEntryFromSkillCapability(capability);
    if (!result.has(entry.name)) {
      result.set(entry.name, entry);
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createCommandsService(
  input: {
    homeDir?: string;
    skillRoots?: string[];
    builtinSkillSources?: Array<{ rootDir: string; prefix?: string }>;
  } = {}
) {
  const home = input.homeDir || homedir();
  const commandCatalogCache = new Map<string, CommandCatalog>();
  const pendingCommandCatalogReads = new Map<string, Promise<CommandCatalog>>();

  function cacheKeyForCommands(inputOptions: {
    projectPath?: string;
    pluginSources: PluginCommandSource[];
  }) {
    return JSON.stringify({
      home: resolve(home),
      projectPath: inputOptions.projectPath ? resolve(inputOptions.projectPath) : '',
      skillRoots: input.skillRoots?.map((root) => resolve(root)) || null,
      builtinSkillSources: input.builtinSkillSources
        ? input.builtinSkillSources.map((source) => ({
            rootDir: resolve(source.rootDir),
            prefix: source.prefix || '',
          }))
        : null,
      pluginSources: inputOptions.pluginSources.map((plugin) => ({
        id: plugin.id || '',
        path: resolve(plugin.path),
        enabled: plugin.enabled !== false,
        sourceKind: plugin.sourceKind || '',
      })),
    });
  }

  function rememberCommandCatalog(cacheKey: string, catalog: CommandCatalog) {
    if (
      !commandCatalogCache.has(cacheKey) &&
      commandCatalogCache.size >= MAX_COMMAND_CACHE_ENTRIES
    ) {
      const oldestKey = commandCatalogCache.keys().next().value;
      if (oldestKey) {
        commandCatalogCache.delete(oldestKey);
      }
    }
    commandCatalogCache.set(cacheKey, cloneCommandCatalog(catalog));
  }

  async function scanCommandCatalog(options: {
    projectPath?: string;
    pluginSources: PluginCommandSource[];
    forceRefresh?: boolean;
  }): Promise<CommandCatalog> {
    const pluginSources = options.pluginSources;
    const projectCommands = options.projectPath
      ? await scanMarkdownCommands({
          baseDir: join(options.projectPath, '.claude', 'commands'),
          namespace: 'project',
        })
      : [];
    const userCommands = await scanMarkdownCommands({
      baseDir: join(home, '.claude', 'commands'),
      namespace: 'user',
    });
    const pluginCommands = (
      await Promise.all(
        pluginSources.map(async (plugin) => {
          if (plugin.enabled === false) {
            return [];
          }
          const prefix =
            typeof plugin.id === 'string' && plugin.id.trim()
              ? plugin.id.split('@')[0]?.trim() || undefined
              : undefined;
          return scanMarkdownCommands({
            baseDir: join(plugin.path, 'commands'),
            namespace: 'plugin',
            prefix,
          });
        })
      )
    ).flat();
    const skills = input.skillRoots
      ? await scanSkillCommands(input.skillRoots)
      : await listSkillCommandsFromCapabilities({
          homeDir: home,
          projectPath: options.projectPath,
          pluginSources,
          builtinSkillSources: input.builtinSkillSources,
          forceRefresh: options.forceRefresh,
        });

    return {
      localUi: LOCAL_UI_COMMANDS,
      project: projectCommands,
      user: userCommands,
      plugin: pluginCommands,
      skills,
      count:
        LOCAL_UI_COMMANDS.length +
        projectCommands.length +
        userCommands.length +
        pluginCommands.length +
        skills.length,
    };
  }

  return {
    async listCommands(
      options: {
        projectPath?: string;
        pluginPaths?: string[];
        pluginSources?: PluginCommandSource[];
        forceRefresh?: boolean;
      } = {}
    ): Promise<CommandCatalog> {
      const pluginSources = normalizePluginSources(options);
      const cacheKey = cacheKeyForCommands({
        projectPath: options.projectPath,
        pluginSources,
      });

      if (options.forceRefresh) {
        commandCatalogCache.delete(cacheKey);
        pendingCommandCatalogReads.delete(cacheKey);
      } else {
        const cached = commandCatalogCache.get(cacheKey);
        if (cached) {
          return cloneCommandCatalog(cached);
        }
        const pending = pendingCommandCatalogReads.get(cacheKey);
        if (pending) {
          return cloneCommandCatalog(await pending);
        }
      }

      const pending = scanCommandCatalog({
        projectPath: options.projectPath,
        pluginSources,
        forceRefresh: options.forceRefresh,
      });
      pendingCommandCatalogReads.set(cacheKey, pending);
      try {
        const catalog = await pending;
        rememberCommandCatalog(cacheKey, catalog);
        return cloneCommandCatalog(catalog);
      } finally {
        pendingCommandCatalogReads.delete(cacheKey);
      }
    },

    invalidateCache() {
      commandCatalogCache.clear();
      pendingCommandCatalogReads.clear();
    },

    async executeCommand(input: {
      commandName: string;
      commandPath?: string;
      args?: string[];
      context?: { projectPath?: string };
    }): Promise<ExecuteCommandResult> {
      const localCommand = LOCAL_UI_COMMANDS.find((command) => command.name === input.commandName);
      if (localCommand) {
        return {
          type: 'local-ui',
          command: localCommand.name,
          action: localCommand.name.slice(1),
          message: localCommand.description,
        };
      }

      if (!input.commandPath) {
        throw new Error('Command path is required for custom commands');
      }

      const userBase = join(home, '.claude', 'commands');
      const projectBase = input.context?.projectPath
        ? join(input.context.projectPath, '.claude', 'commands')
        : null;
      const userSkillBase = join(home, '.claude', 'skills');
      const projectSkillBase = input.context?.projectPath
        ? join(input.context.projectPath, '.claude', 'skills')
        : null;
      const builtinSkillBases =
        input.builtinSkillSources?.map((source) => resolve(source.rootDir)) || [];
      const isSkillPath =
        basename(input.commandPath) === 'SKILL.md' &&
        (isUnder(userSkillBase, input.commandPath) ||
          (projectSkillBase && isUnder(projectSkillBase, input.commandPath)) ||
          builtinSkillBases.some((baseDir) => isUnder(baseDir, input.commandPath)));
      if (
        !isSkillPath &&
        !(
          isUnder(userBase, input.commandPath) ||
          (projectBase && isUnder(projectBase, input.commandPath))
        )
      ) {
        throw new Error('Command must be in .claude/commands directory');
      }

      const { metadata, body } = stripFrontmatter(await readFile(input.commandPath, 'utf8'));
      const args = input.args || [];
      if (isSkillPath) {
        const content = buildSkillPrompt(input.commandName, body, args);
        return {
          type: 'custom',
          command: input.commandName,
          content,
          metadata: { ...metadata, type: 'skill' },
          hasFileIncludes: content.includes('@'),
          hasBashCommands: content.includes('!'),
        };
      }
      let content = body.replace(/\$ARGUMENTS/g, args.join(' '));
      args.forEach((arg, index) => {
        content = content.replace(new RegExp(`\\$${index + 1}\\b`, 'g'), arg);
      });

      return {
        type: 'custom',
        command: input.commandName,
        content,
        metadata,
        hasFileIncludes: content.includes('@'),
        hasBashCommands: content.includes('!'),
      };
    },
  };
}
