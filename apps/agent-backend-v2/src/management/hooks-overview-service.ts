import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type HookSourceOverview = {
  id: 'user' | 'project' | 'local';
  kind: 'user' | 'project' | 'local';
  label: string;
  path: string;
  writable: boolean;
  hasFile: boolean;
  hookEventCount: number;
  rawJson: string;
};

type HooksOverview = {
  sources: HookSourceOverview[];
};

const MAX_HOOKS_CACHE_ENTRIES = 50;
const hooksOverviewCache = new Map<string, HooksOverview>();
const pendingHooksOverviewReads = new Map<string, Promise<HooksOverview>>();

function parseJsonObject(rawJson: string) {
  try {
    const value = JSON.parse(rawJson);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function readSettingsSource(input: {
  id: HookSourceOverview['id'];
  label: string;
  path: string;
}): Promise<HookSourceOverview> {
  let rawJson = '';
  let hasFile = false;
  try {
    rawJson = await readFile(input.path, 'utf8');
    hasFile = true;
  } catch {
    rawJson = '{}';
  }
  const payload = parseJsonObject(rawJson);
  const hooks = payload.hooks;
  const hookEventCount =
    hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? Object.keys(hooks).length : 0;
  return {
    id: input.id,
    kind: input.id,
    label: input.label,
    path: input.path,
    writable: true,
    hasFile,
    hookEventCount,
    rawJson,
  };
}

function cloneHooksOverview(overview: HooksOverview): HooksOverview {
  return {
    sources: overview.sources.map((source) => ({ ...source })),
  };
}

function rememberHooksOverview(cacheKey: string, overview: HooksOverview) {
  if (!hooksOverviewCache.has(cacheKey) && hooksOverviewCache.size >= MAX_HOOKS_CACHE_ENTRIES) {
    const oldestKey = hooksOverviewCache.keys().next().value;
    if (oldestKey) {
      hooksOverviewCache.delete(oldestKey);
    }
  }
  hooksOverviewCache.set(cacheKey, cloneHooksOverview(overview));
}

export function clearHooksOverviewCache() {
  hooksOverviewCache.clear();
  pendingHooksOverviewReads.clear();
}

async function readHooksOverview({
  homeDir,
  projectPath,
}: {
  homeDir: string;
  projectPath?: string;
}): Promise<HooksOverview> {
  const resolvedHome = resolve(homeDir);
  const resolvedProject = projectPath ? resolve(projectPath) : process.cwd();
  const sources = await Promise.all([
    readSettingsSource({
      id: 'user',
      label: 'User settings',
      path: join(resolvedHome, '.claude', 'settings.json'),
    }),
    readSettingsSource({
      id: 'project',
      label: 'Project settings',
      path: join(resolvedProject, '.claude', 'settings.json'),
    }),
    readSettingsSource({
      id: 'local',
      label: 'Local project settings',
      path: join(resolvedProject, '.claude', 'settings.local.json'),
    }),
  ]);

  return { sources };
}

export async function getHooksOverview({
  homeDir = homedir(),
  projectPath,
  forceRefresh = false,
}: {
  homeDir?: string;
  projectPath?: string;
  forceRefresh?: boolean;
} = {}) {
  const resolvedHome = resolve(homeDir);
  const resolvedProject = projectPath ? resolve(projectPath) : process.cwd();
  const cacheKey = JSON.stringify({
    homeDir: resolvedHome,
    projectPath: resolvedProject,
  });

  if (forceRefresh) {
    hooksOverviewCache.delete(cacheKey);
    pendingHooksOverviewReads.delete(cacheKey);
  } else {
    const cached = hooksOverviewCache.get(cacheKey);
    if (cached) {
      return cloneHooksOverview(cached);
    }
    const pending = pendingHooksOverviewReads.get(cacheKey);
    if (pending) {
      return cloneHooksOverview(await pending);
    }
  }

  const pending = readHooksOverview({ homeDir: resolvedHome, projectPath: resolvedProject });
  pendingHooksOverviewReads.set(cacheKey, pending);
  try {
    const overview = await pending;
    rememberHooksOverview(cacheKey, overview);
    return cloneHooksOverview(overview);
  } finally {
    pendingHooksOverviewReads.delete(cacheKey);
  }
}
