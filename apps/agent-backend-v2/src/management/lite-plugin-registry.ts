import { homedir } from 'node:os';
import { readJsonObjectFile, updateJsonObjectFile } from './json-file-store.ts';
import { getPluginInstallRegistryPath } from './plugin-install-registry.ts';

type ManagedInstallSource =
  | {
      kind: 'dev-local';
      directory: string;
    }
  | {
      kind: 'github';
      repoUrl: string;
      directory: string;
    };

export type LitePluginInstallRecord = {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  type: 'local';
  local: true;
  scope: 'user';
  installSource: ManagedInstallSource;
};

type LitePluginRegistryTestHooks = {
  onBeforeRemovePersist?: (input: { homeDir: string; id: string }) => void | Promise<void>;
  onBeforeUpsertPersist?: (input: { homeDir: string; id: string }) => void | Promise<void>;
};

export type ManagedPlugin = {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  type: 'local';
  local: true;
  sdkResolved?: boolean;
  source: {
    kind: 'lite' | 'cli' | 'github';
    path: string;
    writable: boolean;
    removable: boolean;
    repoUrl?: string;
    directory?: string;
  };
};

export function getLiteRegistryPath(homeDir = homedir()) {
  return getPluginInstallRegistryPath(homeDir);
}

let litePluginRegistryTestHooks: LitePluginRegistryTestHooks | null = null;

export function __setLitePluginRegistryTestHooks(hooks: LitePluginRegistryTestHooks | null) {
  litePluginRegistryTestHooks = hooks;
}

function trim(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLegacyPlugin(value: unknown): LitePluginInstallRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const plugin = value as Record<string, unknown>;
  const path = trim(plugin.path);
  const id = trim(plugin.id) || trim(plugin.name) || path;
  if (!id || !path) {
    return null;
  }
  return {
    id,
    name: trim(plugin.name) || id,
    version: trim(plugin.version) || 'local',
    path,
    enabled: plugin.enabled !== false,
    type: 'local',
    local: true,
    scope: 'user',
    installSource: {
      kind: 'dev-local',
      directory: path,
    },
  };
}

function normalizeInstallSource(value: unknown, fallbackPath: string): ManagedInstallSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      kind: 'dev-local',
      directory: fallbackPath,
    };
  }
  const source = value as Record<string, unknown>;
  const kind = trim(source.kind);
  if (kind === 'github') {
    const repoUrl = trim(source.repoUrl);
    const directory = trim(source.directory) || fallbackPath;
    if (!repoUrl || !directory) {
      return null;
    }
    return {
      kind: 'github',
      repoUrl,
      directory,
    };
  }
  if (kind && kind !== 'dev-local') {
    return null;
  }
  return {
    kind: 'dev-local',
    directory: trim(source.directory) || fallbackPath,
  };
}

function normalizePlugin(value: unknown): LitePluginInstallRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const plugin = value as Record<string, unknown>;
  const path = trim(plugin.path);
  const id = trim(plugin.id) || trim(plugin.name) || path;
  if (!id || !path) {
    return null;
  }
  const installSource = normalizeInstallSource(plugin.installSource, path);
  if (!installSource) {
    return null;
  }
  return {
    id,
    name: trim(plugin.name) || id,
    version: trim(plugin.version) || 'local',
    path,
    enabled: plugin.enabled !== false,
    type: 'local',
    local: true,
    scope: 'user',
    installSource,
  };
}

function normalizeInstallsFromPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const payload = value as { installs?: unknown; plugins?: unknown };
  if (Array.isArray(payload.installs)) {
    return payload.installs.map(normalizePlugin).filter(Boolean) as LitePluginInstallRecord[];
  }
  if (Array.isArray(payload.plugins)) {
    return payload.plugins.map(normalizeLegacyPlugin).filter(Boolean) as LitePluginInstallRecord[];
  }
  return [];
}

function toManagedPlugin(homeDir: string, plugin: LitePluginInstallRecord): ManagedPlugin {
  const registryPath = getLiteRegistryPath(homeDir);
  if (plugin.installSource.kind === 'github') {
    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      path: plugin.path,
      enabled: plugin.enabled,
      type: plugin.type,
      local: plugin.local,
      source: {
        kind: 'github',
        path: registryPath,
        writable: true,
        removable: true,
        repoUrl: plugin.installSource.repoUrl,
        directory: plugin.installSource.directory,
      },
    };
  }
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    path: plugin.path,
    enabled: plugin.enabled,
    type: plugin.type,
    local: plugin.local,
    source: {
      kind: 'lite',
      path: registryPath,
      writable: true,
      removable: true,
    },
  };
}

export async function listLitePlugins({ homeDir = homedir() }: { homeDir?: string } = {}) {
  const payload = await readJsonObjectFile(getLiteRegistryPath(homeDir));
  const plugins = normalizeInstallsFromPayload(payload);
  return plugins.map((plugin) => toManagedPlugin(homeDir, plugin));
}

export async function upsertLitePlugin({
  homeDir = homedir(),
  plugin,
}: {
  homeDir?: string;
  plugin: unknown;
}) {
  const normalized = normalizePlugin(plugin);
  if (!normalized) {
    const error = new Error('Plugin path is required.') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  await litePluginRegistryTestHooks?.onBeforeUpsertPersist?.({ homeDir, id: normalized.id });
  let updated: LitePluginInstallRecord | null = null;
  await updateJsonObjectFile(getLiteRegistryPath(homeDir), (current) => {
    const installs = normalizeInstallsFromPayload(current);
    const index = installs.findIndex((entry) => entry.id === normalized.id);
    updated = normalized;
    if (index === -1) {
      return { installs: [...installs, normalized] };
    }
    installs[index] = { ...installs[index], ...normalized };
    updated = installs[index];
    return { installs };
  });
  if (!updated) {
    throw new Error('Plugin install update failed.');
  }
  return toManagedPlugin(homeDir, updated);
}

export async function setLitePluginEnabled({
  homeDir = homedir(),
  id,
  enabled,
}: {
  homeDir?: string;
  id: string;
  enabled: boolean;
}) {
  let updated: LitePluginInstallRecord | null = null;
  await updateJsonObjectFile(getLiteRegistryPath(homeDir), (current) => {
    const installs = normalizeInstallsFromPayload(current).map((install) => {
      if (install.id !== id) {
        return install;
      }
      updated = { ...install, enabled: Boolean(enabled) };
      return updated;
    });
    return { installs };
  });
  if (!updated) {
    const error = new Error(`Plugin not found: ${id}`) as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return toManagedPlugin(homeDir, updated);
}

export async function removeLitePlugin({ homeDir = homedir(), id }: { homeDir?: string; id: string }) {
  let removedPlugin: LitePluginInstallRecord | null = null;
  await litePluginRegistryTestHooks?.onBeforeRemovePersist?.({ homeDir, id });
  await updateJsonObjectFile(getLiteRegistryPath(homeDir), (current) => {
    const installs = normalizeInstallsFromPayload(current).filter((install) => {
      if (install.id !== id) {
        return true;
      }
      removedPlugin = install;
      return false;
    });
    return { installs };
  });
  return { removed: true, disabled: false, plugin: removedPlugin };
}
