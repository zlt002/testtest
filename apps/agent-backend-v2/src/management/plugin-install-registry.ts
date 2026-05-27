import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonObjectFile, updateJsonObjectFile } from './json-file-store.ts';

export type ManagedInstallSource = {
  kind: 'dev-local';
  directory: string;
};

export type ManagedInstallRecord = {
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

export function getPluginInstallRegistryPath(homeDir = homedir()) {
  return join(homeDir, '.webmcp', 'lite-plugin-registry.json');
}

function trim(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLegacyPlugin(value: unknown): ManagedInstallRecord | null {
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

function normalizeInstall(value: unknown): ManagedInstallRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const install = value as Record<string, unknown>;
  const path = trim(install.path);
  const id = trim(install.id) || trim(install.name) || path;
  const source =
    install.installSource && typeof install.installSource === 'object'
      ? (install.installSource as Record<string, unknown>)
      : null;
  if (!id || !path || !source || trim(source.kind) !== 'dev-local') {
    return null;
  }
  return {
    id,
    name: trim(install.name) || id,
    version: trim(install.version) || 'local',
    path,
    enabled: install.enabled !== false,
    type: 'local',
    local: true,
    scope: 'user',
    installSource: {
      kind: 'dev-local',
      directory: trim(source.directory) || path,
    },
  };
}

function normalizeInstallsFromPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const payload = value as { installs?: unknown; plugins?: unknown };
  if (Array.isArray(payload.installs)) {
    return payload.installs.map(normalizeInstall).filter(Boolean) as ManagedInstallRecord[];
  }
  if (Array.isArray(payload.plugins)) {
    return payload.plugins.map(normalizeLegacyPlugin).filter(Boolean) as ManagedInstallRecord[];
  }
  return [];
}

export async function listPluginInstalls({ homeDir = homedir() }: { homeDir?: string } = {}) {
  const payload = await readJsonObjectFile(getPluginInstallRegistryPath(homeDir));
  return normalizeInstallsFromPayload(payload);
}

export async function upsertPluginInstall({
  homeDir = homedir(),
  install,
}: {
  homeDir?: string;
  install: ManagedInstallRecord;
}) {
  let updated: ManagedInstallRecord | null = null;
  await updateJsonObjectFile(getPluginInstallRegistryPath(homeDir), (current) => {
    const installs = normalizeInstallsFromPayload(current);
    const index = installs.findIndex((entry) => entry.id === install.id);
    updated = install;
    if (index === -1) {
      return { installs: [...installs, install] };
    }
    installs[index] = { ...installs[index], ...install };
    updated = installs[index];
    return { installs };
  });
  if (!updated) {
    throw new Error('Plugin install update failed.');
  }
  return updated;
}

export async function setPluginInstallEnabled({
  homeDir = homedir(),
  id,
  enabled,
}: {
  homeDir?: string;
  id: string;
  enabled: boolean;
}) {
  let updated: ManagedInstallRecord | null = null;
  await updateJsonObjectFile(getPluginInstallRegistryPath(homeDir), (current) => {
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
  return updated;
}

export async function removePluginInstall({
  homeDir = homedir(),
  id,
}: {
  homeDir?: string;
  id: string;
}) {
  await updateJsonObjectFile(getPluginInstallRegistryPath(homeDir), (current) => ({
    installs: normalizeInstallsFromPayload(current).filter((install) => install.id !== id),
  }));
  return { removed: true, disabled: false };
}
