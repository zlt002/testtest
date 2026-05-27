import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fromClaudeProjectKey } from './claude-project-key.ts';

export type ClaudeProjectSummary = {
  projectKey: string;
  projectPath: string;
  name: string;
  sessionCount: number;
  updatedAt: string | null;
};

const DEFAULT_PROJECT_LIST_CACHE_TTL_MS = Number.POSITIVE_INFINITY;
const MAX_PROJECT_LIST_CACHE_ENTRIES = 20;

type ProjectListCacheEntry = {
  cachedAt: number;
  projects: ClaudeProjectSummary[];
};

const projectListCache = new Map<string, ProjectListCacheEntry>();
const pendingProjectListReads = new Map<string, Promise<ClaudeProjectSummary[]>>();

function cloneProjects(projects: ClaudeProjectSummary[]) {
  return projects.map((project) => ({ ...project }));
}

function rememberProjects(cacheKey: string, projects: ClaudeProjectSummary[]) {
  if (!projectListCache.has(cacheKey) && projectListCache.size >= MAX_PROJECT_LIST_CACHE_ENTRIES) {
    const oldestKey = projectListCache.keys().next().value;
    if (oldestKey) {
      projectListCache.delete(oldestKey);
    }
  }
  projectListCache.set(cacheKey, {
    cachedAt: Date.now(),
    projects: cloneProjects(projects),
  });
}

export function clearClaudeProjectListCache() {
  projectListCache.clear();
  pendingProjectListReads.clear();
}

export async function listClaudeProjects(
  options: {
    claudeProjectsDir?: string;
    limit?: number;
    forceRefresh?: boolean;
    cacheTtlMs?: number;
  } = {}
): Promise<ClaudeProjectSummary[]> {
  const projectsDir = options.claudeProjectsDir || join(homedir(), '.claude', 'projects');
  const limit = options.limit ?? 100;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_PROJECT_LIST_CACHE_TTL_MS;
  const cacheKey = JSON.stringify({ projectsDir, limit });

  if (options.forceRefresh) {
    projectListCache.delete(cacheKey);
    pendingProjectListReads.delete(cacheKey);
  } else {
    const cached = projectListCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
      return cloneProjects(cached.projects);
    }
    const pending = pendingProjectListReads.get(cacheKey);
    if (pending) {
      return cloneProjects(await pending);
    }
  }

  const pending = readClaudeProjects({ projectsDir, limit });
  pendingProjectListReads.set(cacheKey, pending);
  try {
    const projects = await pending;
    rememberProjects(cacheKey, projects);
    return cloneProjects(projects);
  } finally {
    pendingProjectListReads.delete(cacheKey);
  }
}

async function readClaudeProjects({
  projectsDir,
  limit,
}: {
  projectsDir: string;
  limit: number;
}): Promise<ClaudeProjectSummary[]> {
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const projectPath = fromClaudeProjectKey(entry.name);
          const projectDir = join(projectsDir, entry.name);
          const projectPathInfo = await stat(projectPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
              return null;
            }
            throw error;
          });
          if (!projectPathInfo?.isDirectory()) {
            return null;
          }

          const files = await readdir(projectDir).catch(() => []);
          const jsonlFiles = files.filter((file) => file.endsWith('.jsonl'));
          const stats = await Promise.all(
            jsonlFiles.map(async (file) => {
              const info = await stat(join(projectDir, file));
              return info.isFile() ? info.mtimeMs : 0;
            })
          );
          const latestMtime = Math.max(0, ...stats);

          return {
            projectKey: entry.name,
            projectPath,
            name: basename(projectPath) || projectPath,
            sessionCount: jsonlFiles.length,
            updatedAt: latestMtime > 0 ? new Date(latestMtime).toISOString() : null,
          };
        })
    );

    return projects
      .filter((project): project is ClaudeProjectSummary => Boolean(project))
      .filter((project) => project.sessionCount > 0)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
