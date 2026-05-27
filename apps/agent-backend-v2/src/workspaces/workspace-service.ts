import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { HttpError } from '../shared/errors.ts';
import { toClaudeProjectKey } from '../claude-history/claude-project-key.ts';
import type { ClaudeProjectSummary } from '../claude-history/project-list-reader.ts';
import { createSystemFolderPicker } from './system-folder-picker.ts';

export type ManualWorkspace = {
  projectPath: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceConfig = {
  workspaces: ManualWorkspace[];
  hiddenProjectPaths: string[];
};

export type FolderSuggestion = {
  name: string;
  path: string;
};

export type PickWorkspaceFolderResult = {
  projectPath: string | null;
};

const INVALID_FOLDER_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const WORKSPACE_LIST_CACHE_TTL_MS = Number.POSITIVE_INFINITY;

function parentDirectory(projectPath: string) {
  const parentPath = dirname(projectPath);
  return parentPath === projectPath ? null : parentPath;
}

function defaultConfigPath() {
  return join(homedir(), '.webmcp', 'workspaces.json');
}

function workspaceName(projectPath: string, name?: string) {
  const trimmed = name?.trim();
  if (trimmed) {
    return trimmed;
  }
  return (
    projectPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || projectPath
  );
}

function expandUserPath(projectPath?: string) {
  const trimmed = projectPath?.trim();
  if (!trimmed || trimmed === '~') {
    return homedir();
  }
  if (trimmed === '~/' || trimmed === '~\\') {
    return homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

async function assertDirectory(projectPath: string) {
  const info = await stat(projectPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new HttpError(404, 'Workspace directory does not exist', 'workspace_not_found');
    }
    throw error;
  });
  if (!info.isDirectory()) {
    throw new HttpError(400, 'Workspace path must be a directory', 'workspace_not_directory');
  }
}

function validateFolderName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Folder name is required', 'folder_name_required');
  }
  if (trimmed === '.' || trimmed === '..' || INVALID_FOLDER_NAME_CHARS.test(trimmed)) {
    throw new HttpError(400, 'Folder name is invalid', 'folder_name_invalid');
  }
  return trimmed;
}

export function createWorkspaceService(
  options: {
    configPath?: string;
    pickFolder?: () => Promise<string | null>;
    defaultWorkspacePath?: string;
  } = {}
) {
  const configPath = options.configPath || defaultConfigPath();
  const pickFolderWithSystemDialog = options.pickFolder || createSystemFolderPicker().pickFolder;
  const defaultWorkspacePath = options.defaultWorkspacePath
    ? resolve(options.defaultWorkspacePath)
    : null;
  let workspaceListCache: { cachedAt: number; workspaces: ManualWorkspace[] } | null = null;

  function cloneWorkspaces(workspaces: ManualWorkspace[]) {
    return workspaces.map((workspace) => ({ ...workspace }));
  }

  function invalidateWorkspaceListCache() {
    workspaceListCache = null;
  }

  async function readConfig(): Promise<WorkspaceConfig> {
    const text = await readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!text) {
      return { workspaces: [], hiddenProjectPaths: [] };
    }
    const parsed = JSON.parse(text) as Partial<WorkspaceConfig>;
    return {
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      hiddenProjectPaths: Array.isArray(parsed.hiddenProjectPaths)
        ? parsed.hiddenProjectPaths.filter((value): value is string => typeof value === 'string')
        : [],
    };
  }

  async function writeConfig(config: WorkspaceConfig) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  async function ensureDefaultWorkspace(config: WorkspaceConfig): Promise<WorkspaceConfig> {
    if (!defaultWorkspacePath) {
      return config;
    }

    const hiddenProjectPaths = new Set(
      config.hiddenProjectPaths.map((projectPath) => resolve(projectPath))
    );
    if (hiddenProjectPaths.has(defaultWorkspacePath)) {
      return config;
    }

    const existingWorkspace = config.workspaces.find(
      (workspace) => resolve(workspace.projectPath) === defaultWorkspacePath
    );
    if (existingWorkspace) {
      return config;
    }

    const info = await stat(defaultWorkspacePath).catch(() => null);
    if (!info?.isDirectory()) {
      return config;
    }

    const now = new Date().toISOString();
    const nextConfig: WorkspaceConfig = {
      ...config,
      workspaces: [
        {
          projectPath: defaultWorkspacePath,
          name: workspaceName(defaultWorkspacePath),
          createdAt: now,
          updatedAt: now,
        },
        ...config.workspaces,
      ],
    };
    await writeConfig(nextConfig);
    return nextConfig;
  }

  async function listWorkspaces(
    input: { forceRefresh?: boolean } = {}
  ): Promise<ManualWorkspace[]> {
    if (
      !input.forceRefresh &&
      workspaceListCache &&
      Date.now() - workspaceListCache.cachedAt < WORKSPACE_LIST_CACHE_TTL_MS
    ) {
      return cloneWorkspaces(workspaceListCache.workspaces);
    }
    const config = await ensureDefaultWorkspace(await readConfig());
    const existing = await Promise.all(
      config.workspaces.map(async (workspace) => {
        const ok = await stat(workspace.projectPath)
          .then((info) => info.isDirectory())
          .catch(() => false);
        return ok ? workspace : null;
      })
    );
    const workspaces = existing.filter((workspace): workspace is ManualWorkspace =>
      Boolean(workspace)
    );
    workspaceListCache = {
      cachedAt: Date.now(),
      workspaces: cloneWorkspaces(workspaces),
    };
    return cloneWorkspaces(workspaces);
  }

  return {
    async listProjects(input: { forceRefresh?: boolean } = {}): Promise<ClaudeProjectSummary[]> {
      const workspaces = await listWorkspaces(input);
      return workspaces.map((workspace) => ({
        projectKey: `manual-${toClaudeProjectKey(workspace.projectPath)}`,
        projectPath: workspace.projectPath,
        name: workspace.name,
        sessionCount: 0,
        updatedAt: workspace.updatedAt,
      }));
    },

    async addWorkspace(input: { projectPath: string; name?: string }) {
      const projectPath = resolve(input.projectPath);
      await assertDirectory(projectPath);
      const config = await readConfig();
      const now = new Date().toISOString();
      const existing = config.workspaces.find((workspace) => workspace.projectPath === projectPath);
      if (existing) {
        existing.name = workspaceName(projectPath, input.name || existing.name);
        existing.updatedAt = now;
      } else {
        config.workspaces.push({
          projectPath,
          name: workspaceName(projectPath, input.name),
          createdAt: now,
          updatedAt: now,
        });
      }
      config.hiddenProjectPaths = config.hiddenProjectPaths.filter(
        (value) => value !== projectPath
      );
      await writeConfig(config);
      invalidateWorkspaceListCache();
      return { ok: true as const };
    },

    async renameWorkspace(input: { projectPath: string; name: string }) {
      const projectPath = resolve(input.projectPath);
      const name = input.name.trim();
      if (!name) {
        throw new HttpError(400, 'Workspace name is required', 'workspace_name_required');
      }
      const config = await readConfig();
      const existing = config.workspaces.find((workspace) => workspace.projectPath === projectPath);
      if (!existing) {
        throw new HttpError(404, 'Workspace is not managed manually', 'workspace_not_managed');
      }
      existing.name = name;
      existing.updatedAt = new Date().toISOString();
      await writeConfig(config);
      invalidateWorkspaceListCache();
      return { ok: true as const };
    },

    async deleteWorkspace(input: { projectPath: string; deleteDirectory?: boolean }) {
      const projectPath = resolve(input.projectPath);
      const config = await readConfig();
      const next = config.workspaces.filter((workspace) => workspace.projectPath !== projectPath);
      const hiddenProjectPaths = Array.from(new Set([...config.hiddenProjectPaths, projectPath]));
      await writeConfig({ workspaces: next, hiddenProjectPaths });
      invalidateWorkspaceListCache();
      if (input.deleteDirectory) {
        await rm(projectPath, { recursive: true, force: true });
      }
      return { ok: true as const };
    },

    async listHiddenProjectPaths(): Promise<string[]> {
      const config = await readConfig();
      return config.hiddenProjectPaths;
    },

    async openWorkspace(input: { projectPath: string }) {
      const projectPath = resolve(input.projectPath);
      await assertDirectory(projectPath);
      const command =
        process.platform === 'win32'
          ? 'explorer.exe'
          : process.platform === 'darwin'
            ? 'open'
            : 'xdg-open';
      const child = spawn(command, [projectPath], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true as const };
    },

    async pickFolder(): Promise<PickWorkspaceFolderResult> {
      const selectedPath = await pickFolderWithSystemDialog();
      if (!selectedPath) {
        return { projectPath: null };
      }
      const projectPath = resolve(selectedPath);
      await assertDirectory(projectPath);
      return { projectPath };
    },

    async browseFolders(input: { path?: string } = {}) {
      const projectPath = expandUserPath(input.path);
      await assertDirectory(projectPath);
      const entries = await readdir(projectPath, { withFileTypes: true });
      const folders = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: join(projectPath, entry.name),
        }))
        .sort((firstFolder, secondFolder) => firstFolder.name.localeCompare(secondFolder.name));
      return {
        path: projectPath,
        parentPath: parentDirectory(projectPath),
        folders,
      };
    },

    async createFolder(input: { parentPath: string; name: string }) {
      const parentPath = expandUserPath(input.parentPath);
      await assertDirectory(parentPath);
      const name = validateFolderName(input.name);
      const targetPath = join(parentPath, name);
      await mkdir(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') {
          throw new HttpError(409, 'Folder already exists', 'folder_exists');
        }
        throw error;
      });
      return { ok: true as const, path: targetPath };
    },
  };
}
