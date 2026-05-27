import { execFile } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readJsonObjectFile, updateJsonObjectFile } from './json-file-store.ts';
import {
  __setLitePluginRegistryTestHooks,
  listLitePlugins,
  removeLitePlugin,
  setLitePluginEnabled,
  upsertLitePlugin,
  type ManagedPlugin,
  type LitePluginInstallRecord,
} from './lite-plugin-registry.ts';

type SourceKind = 'lite' | 'cli' | 'github';
type InstallSource =
  | {
      kind: 'dev-local';
      directory: string;
    }
  | {
      kind: 'github';
      repoUrl: string;
    };
type ShellExecutor = (input: {
  command: string;
  args: string[];
  cwd?: string;
}) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;
type InstalledPlugin = ManagedPlugin;
const MAX_PLUGIN_CACHE_ENTRIES = 20;

const managedPluginCache = new Map<string, ManagedPlugin[]>();
const pendingManagedPluginReads = new Map<string, Promise<ManagedPlugin[]>>();

function httpError(message: string, statusCode = 500) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
}

function trim(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function runShellCommand({ command, args, cwd }: { command: string; args: string[]; cwd?: string }) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise({
          exitCode: 0,
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        });
      }
    );
  });
}

function assertSourceKind(value: unknown): SourceKind {
  if (value === 'lite' || value === 'cli' || value === 'github') {
    return value;
  }
  throw httpError('Plugin sourceKind must be one of: lite, github, cli.', 400);
}

function settingsPath(homeDir: string) {
  return join(homeDir, '.claude', 'settings.json');
}

function installedPluginsPath(homeDir: string) {
  return join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
}

function cloneManagedPlugin(plugin: ManagedPlugin): ManagedPlugin {
  return {
    ...plugin,
    source: { ...plugin.source },
  };
}

function cloneManagedPlugins(plugins: ManagedPlugin[]) {
  return plugins.map(cloneManagedPlugin);
}

export { __setLitePluginRegistryTestHooks };

async function removeInstallDirectory(installDir: string) {
  await rm(installDir, { recursive: true, force: true });
}

function managedPluginsRoot(homeDir: string) {
  return resolve(homeDir, '.webmcp', 'plugins');
}

async function removeManagedInstallDirectory({
  homeDir,
  installDir,
}: {
  homeDir: string;
  installDir: string;
}) {
  const rootDir = managedPluginsRoot(homeDir);
  const resolvedInstallDir = resolve(installDir);
  const relativePath = relative(rootDir, resolvedInstallDir);
  if (
    !relativePath ||
    relativePath === '.' ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    throw httpError(
      `Refusing to delete GitHub plugin directory outside the managed plugin directory: ${resolvedInstallDir}`,
      400
    );
  }
  const stats = await stat(resolvedInstallDir).catch(() => null);
  if (!stats) {
    return;
  }
  if (!stats.isDirectory()) {
    throw httpError(`Managed GitHub plugin path is not a directory: ${resolvedInstallDir}`, 400);
  }
  await removeInstallDirectory(resolvedInstallDir);
}

async function restoreLitePluginInstall({
  homeDir,
  plugin,
}: {
  homeDir: string;
  plugin: LitePluginInstallRecord | null;
}) {
  if (!plugin) {
    return;
  }
  await upsertLitePlugin({ homeDir, plugin });
}

function parseGitHubRepoUrl(repoUrl: string) {
  const value = trim(repoUrl);
  if (!value) {
    throw httpError('GitHub repository URL is required.', 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw httpError('Only github.com repository URLs are supported.', 400);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    throw httpError('Only github.com repository URLs are supported.', 400);
  }

  const [owner, repo, ...rest] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !repo || rest.length > 0) {
    throw httpError('Only github.com repository URLs are supported.', 400);
  }

  const subdir = trim(parsed.hash.slice(1));
  return {
    owner,
    repo: repo.replace(/\.git$/i, ''),
    subdir: subdir || '',
    cloneUrl: `${parsed.origin}/${owner}/${repo}`,
  };
}

async function installGitHubPlugin({
  homeDir,
  repoUrl,
  scope,
  shell,
}: {
  homeDir: string;
  repoUrl: string;
  scope: 'user';
  shell: ShellExecutor;
}): Promise<InstalledPlugin> {
  const { owner, repo, subdir, cloneUrl } = parseGitHubRepoUrl(repoUrl);
  const installDir = join(homeDir, '.webmcp', 'plugins', `${owner}__${repo}`);
  const installRoot = subdir ? join(installDir, subdir) : installDir;
  const existing = await stat(installDir).catch(() => null);
  if (existing) {
    throw httpError(`Plugin repository already exists at ${installDir}.`, 400);
  }

  try {
    await shell({
      command: 'git',
      args: ['clone', cloneUrl, installDir],
    }).catch((error) => {
      throw httpError(
        error instanceof Error && error.message
          ? `Failed to clone plugin repository. ${error.message}`
          : 'Failed to clone plugin repository.',
        400
      );
    });

    const manifest = await readPluginManifest(installRoot).catch((error) => {
      throw httpError(
        error instanceof Error && /ENOENT/i.test(String((error as { code?: string }).code || error.message))
          ? subdir
            ? `Plugin subdirectory does not exist: ${subdir}.`
            : 'Plugin manifest not found in repository.'
          : error instanceof Error && error.message
            ? error.message
            : 'Plugin manifest not found in repository.',
        400
      );
    });

    const plugin = await upsertLitePlugin({
      homeDir,
      plugin: {
        ...manifest,
        path: installRoot,
        enabled: true,
        type: 'local',
        local: true,
        scope,
        installSource: {
          kind: 'github',
          repoUrl,
          directory: installDir,
        },
      },
    });
    clearManagedPluginCache({ homeDir });
    return plugin;
  } catch (error) {
    await removeInstallDirectory(installDir).catch(() => null);
    throw error;
  }
}

function rememberManagedPlugins(cacheKey: string, plugins: ManagedPlugin[]) {
  if (!managedPluginCache.has(cacheKey) && managedPluginCache.size >= MAX_PLUGIN_CACHE_ENTRIES) {
    const oldestKey = managedPluginCache.keys().next().value;
    if (oldestKey) {
      managedPluginCache.delete(oldestKey);
    }
  }
  managedPluginCache.set(cacheKey, cloneManagedPlugins(plugins));
}

export function clearManagedPluginCache({ homeDir }: { homeDir?: string } = {}) {
  if (!homeDir) {
    managedPluginCache.clear();
    pendingManagedPluginReads.clear();
    return;
  }
  const cacheKey = resolve(homeDir);
  managedPluginCache.delete(cacheKey);
  pendingManagedPluginReads.delete(cacheKey);
}

function normalizeEnabledPlugins(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim())
      .map(([key, enabled]) => [key.trim(), Boolean(enabled)])
  );
}

function normalizeInstalledPlugins(value: unknown) {
  const plugins = (value as { plugins?: unknown } | null)?.plugins;
  return plugins && typeof plugins === 'object' && !Array.isArray(plugins)
    ? (plugins as Record<string, unknown>)
    : {};
}

function pickInstallRecord(records: unknown) {
  if (!Array.isArray(records)) {
    return null;
  }
  return (
    records.find((record) => record?.scope === 'user' && trim(record.installPath)) ||
    records.find((record) => trim(record?.installPath)) ||
    null
  );
}

async function readPluginManifest(pluginPath: string) {
  const payload = JSON.parse(
    await readFile(join(pluginPath, '.claude-plugin', 'plugin.json'), 'utf8')
  ) as Record<string, unknown>;
  const id = trim(payload.id) || trim(payload.name);
  if (!id) {
    throw httpError('Plugin manifest must provide a usable string id or name.', 400);
  }
  return {
    id,
    name: trim(payload.name) || id,
    version: trim(payload.version) || 'local',
  };
}

export async function importPluginDirectory({
  homeDir = homedir(),
  pluginPath,
}: {
  homeDir?: string;
  pluginPath: string;
}) {
  return installPlugin({
    homeDir,
    source: { kind: 'dev-local', directory: pluginPath },
    scope: 'user',
  });
}

export async function installPlugin({
  homeDir = homedir(),
  source,
  scope = 'user',
  shell = runShellCommand,
}: {
  homeDir?: string;
  source: InstallSource;
  scope?: 'user';
  shell?: ShellExecutor;
}): Promise<InstalledPlugin> {
  const kind = source.kind;
  if (kind === 'github') {
    return installGitHubPlugin({
      homeDir,
      repoUrl: source.repoUrl,
      scope,
      shell,
    });
  }
  if (kind !== 'dev-local') {
    throw httpError(`Unsupported plugin install source: ${kind}`, 400);
  }
  const pluginPath = source.directory;
  if (!isAbsolute(pluginPath)) {
    throw httpError('Plugin directory path must be an absolute path.', 400);
  }
  const resolved = resolve(pluginPath);
  const stats = await stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) {
    throw httpError(`Plugin directory does not exist: ${resolved}`, 400);
  }
  const manifest = await readPluginManifest(resolved);
  const plugin = await upsertLitePlugin({
    homeDir,
    plugin: {
      ...manifest,
      path: resolved,
      enabled: true,
      type: 'local',
      local: true,
      scope,
      installSource: {
        kind: 'dev-local',
        directory: resolved,
      },
    },
  });
  clearManagedPluginCache({ homeDir });
  return plugin;
}

async function readManagedPlugins(resolvedHome: string) {
  const [litePlugins, settings, installedPayload] = await Promise.all([
    listLitePlugins({ homeDir: resolvedHome }),
    readJsonObjectFile(settingsPath(resolvedHome)),
    readJsonObjectFile(installedPluginsPath(resolvedHome)),
  ]);
  const enabledPlugins = normalizeEnabledPlugins(settings.enabledPlugins);
  const installedPlugins = normalizeInstalledPlugins(installedPayload);
  const cliPlugins = Object.keys({ ...installedPlugins, ...enabledPlugins }).map((id) => {
    const record = pickInstallRecord(installedPlugins[id]) as Record<string, unknown> | null;
    const pluginPath = trim(record?.installPath);
    return {
      id,
      name: trim(record?.name) || id,
      version: trim(record?.version) || 'local',
      ...(pluginPath ? { path: pluginPath } : { path: '' }),
      enabled: Boolean(enabledPlugins[id]),
      type: 'local' as const,
      local: true as const,
      sdkResolved: Boolean(enabledPlugins[id] && pluginPath),
      source: {
        kind: 'cli' as const,
        path: settingsPath(resolvedHome),
        writable: true,
        removable: false,
      },
    };
  });

  return [...litePlugins, ...cliPlugins] as ManagedPlugin[];
}

export async function listManagedPlugins({
  homeDir = homedir(),
  forceRefresh = false,
}: {
  homeDir?: string;
  forceRefresh?: boolean;
} = {}) {
  const resolvedHome = resolve(homeDir);
  const cacheKey = resolvedHome;

  if (forceRefresh) {
    managedPluginCache.delete(cacheKey);
    pendingManagedPluginReads.delete(cacheKey);
  } else {
    const cached = managedPluginCache.get(cacheKey);
    if (cached) {
      return cloneManagedPlugins(cached);
    }
    const pending = pendingManagedPluginReads.get(cacheKey);
    if (pending) {
      return cloneManagedPlugins(await pending);
    }
  }

  const pending = readManagedPlugins(resolvedHome);
  pendingManagedPluginReads.set(cacheKey, pending);
  try {
    const plugins = await pending;
    rememberManagedPlugins(cacheKey, plugins);
    return cloneManagedPlugins(plugins);
  } finally {
    pendingManagedPluginReads.delete(cacheKey);
  }
}

export async function setManagedPluginEnabled({
  homeDir = homedir(),
  id,
  sourceKind = 'lite',
  enabled,
}: {
  homeDir?: string;
  id: string;
  sourceKind?: SourceKind;
  enabled: boolean;
}) {
  const kind = assertSourceKind(sourceKind);
  if (!trim(id)) {
    throw httpError('Plugin id is required.', 400);
  }
  if (kind !== 'cli') {
    const plugin = await setLitePluginEnabled({ homeDir, id, enabled });
    clearManagedPluginCache({ homeDir });
    return plugin;
  }

  await updateJsonObjectFile(settingsPath(homeDir), (current) => ({
    ...current,
    enabledPlugins: {
      ...normalizeEnabledPlugins(current.enabledPlugins),
      [id]: Boolean(enabled),
    },
  }));
  clearManagedPluginCache({ homeDir });
  return {
    id,
    enabled: Boolean(enabled),
    source: { kind: 'cli' as const, path: settingsPath(homeDir), writable: true, removable: false },
  };
}

export async function removeManagedPlugin({
  homeDir = homedir(),
  id,
  sourceKind = 'lite',
}: {
  homeDir?: string;
  id: string;
  sourceKind?: SourceKind;
}) {
  const kind = assertSourceKind(sourceKind);
  if (!trim(id)) {
    throw httpError('Plugin id is required.', 400);
  }
  if (kind === 'cli') {
    await setManagedPluginEnabled({ homeDir, id, sourceKind: 'cli', enabled: false });
    return { removed: false, disabled: true };
  }
  const removed = await removeLitePlugin({ homeDir, id });
  try {
    if (removed.plugin?.installSource.kind === 'github') {
      const installDir = removed.plugin.installSource.directory;
      if (!trim(installDir)) {
        throw httpError(`Managed GitHub plugin is missing an install directory: ${id}`, 400);
      }
      await removeManagedInstallDirectory({ homeDir, installDir });
    }
  } catch (error) {
    try {
      await restoreLitePluginInstall({ homeDir, plugin: removed.plugin });
    } catch (restoreError) {
      throw httpError(
        `Plugin removal failed and registry rollback also failed. deleteError=${errorMessage(error)}; rollbackError=${errorMessage(restoreError)}`,
        500
      );
    }
    throw error;
  }
  clearManagedPluginCache({ homeDir });
  return removed;
}
