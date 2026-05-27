import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { HttpError } from '../shared/errors.ts';
import { resolveSafeProjectPath, resolveSafeProjectWritePath } from './path-safety.ts';

export type TreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string | null;
  children?: TreeEntry[];
};

const IGNORED_TREE_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  '.turbo',
  '.output',
  '.wxt',
  'node_modules',
  'dist',
  'build',
]);
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const FILE_TREE_STAT_CONCURRENCY = 16;
const FILE_TREE_PERF_LOG_THRESHOLD_MS = 250;

type FileTreePerfStats = {
  readdirMs: number;
  statMs: number;
  processingMs: number;
  directoriesVisited: number;
  entriesVisited: number;
};

function logFileTreePerf(input: {
  projectPath: string;
  dirPath?: string;
  entryCount: number;
  readdirMs: number;
  processingMs: number;
  totalMs: number;
}) {
  if (input.totalMs < FILE_TREE_PERF_LOG_THRESHOLD_MS) {
    return;
  }
  console.info(
    `[perf][files.tree] total=${input.totalMs.toFixed(1)}ms readdir=${input.readdirMs.toFixed(1)}ms processing=${input.processingMs.toFixed(1)}ms entries=${input.entryCount} project=${input.projectPath} dir=${input.dirPath || '.'}`
  );
}

function validateEntryName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Filename cannot be empty', 'file_name_empty');
  }
  if (INVALID_FILENAME_CHARS.test(trimmed)) {
    throw new HttpError(400, 'Filename contains invalid characters', 'file_name_invalid');
  }
  if (RESERVED_NAMES.test(trimmed)) {
    throw new HttpError(400, 'Filename is a reserved name', 'file_name_reserved');
  }
  if (/^\.+$/.test(trimmed)) {
    throw new HttpError(400, 'Filename cannot be only dots', 'file_name_dots');
  }
  return trimmed;
}

function toRelativePath(projectRoot: string, absolutePath: string) {
  return relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createFileService() {
  async function readTreeEntries(input: {
    projectRoot: string;
    dir: string;
    depth: number;
    maxDepth: number;
    includeMetadata: boolean;
    perfStats?: FileTreePerfStats;
  }): Promise<TreeEntry[]> {
    if (input.perfStats) {
      input.perfStats.directoriesVisited += 1;
    }
    const readdirStartedAt = performance.now();
    const entries = await readdir(input.dir, { withFileTypes: true });
    if (input.perfStats) {
      input.perfStats.readdirMs += performance.now() - readdirStartedAt;
      input.perfStats.entriesVisited += entries.length;
    }
    const mapStartedAt = performance.now();
    const treeEntries = await mapWithConcurrency(
      entries
        .filter((entry) => !IGNORED_TREE_NAMES.has(entry.name)),
      FILE_TREE_STAT_CONCURRENCY,
      async (entry): Promise<TreeEntry | null> => {
          const absolutePath = join(input.dir, entry.name);
          const isDirectory = entry.isDirectory();
          const statStartedAt = performance.now();
          const info = input.includeMetadata ? await stat(absolutePath).catch(() => null) : null;
          if (input.includeMetadata && input.perfStats) {
            input.perfStats.statMs += performance.now() - statStartedAt;
          }
          if (input.includeMetadata && !info) {
            return null;
          }
          const treeEntry: TreeEntry = {
            name: entry.name,
            path: toRelativePath(input.projectRoot, absolutePath),
            type: isDirectory ? 'directory' : 'file',
            size: info?.size,
            modifiedAt: info?.mtime.toISOString(),
          };
          if (isDirectory && input.depth < input.maxDepth) {
            treeEntry.children = await readTreeEntries({
              projectRoot: input.projectRoot,
              dir: absolutePath,
              depth: input.depth + 1,
              maxDepth: input.maxDepth,
              includeMetadata: input.includeMetadata,
              perfStats: input.perfStats,
            }).catch(() => []);
          }
          return treeEntry;
        }
    );
    if (input.perfStats) {
      input.perfStats.processingMs += performance.now() - mapStartedAt;
    }

    return treeEntries
      .filter((entry): entry is TreeEntry => Boolean(entry))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  return {
    async listTree(input: {
      projectPath: string;
      dirPath?: string;
      maxDepth?: number;
      includeMetadata?: boolean;
    }): Promise<{ entries: TreeEntry[] }> {
      const startedAt = performance.now();
      const perfStats: FileTreePerfStats = {
        readdirMs: 0,
        statMs: 0,
        processingMs: 0,
        directoriesVisited: 0,
        entriesVisited: 0,
      };
      const projectRoot = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: '.',
      });
      const root = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: input.dirPath || '.',
      });

      const entries = await readTreeEntries({
        projectRoot,
        dir: root,
        depth: 0,
        maxDepth: input.maxDepth ?? 0,
        includeMetadata: input.includeMetadata ?? true,
        perfStats,
      });
      const totalMs = performance.now() - startedAt;
      logFileTreePerf({
        projectPath: input.projectPath,
        dirPath: input.dirPath,
        entryCount: entries.length,
        readdirMs: perfStats.readdirMs,
        processingMs: perfStats.processingMs,
        totalMs,
      });
      if (totalMs >= FILE_TREE_PERF_LOG_THRESHOLD_MS) {
        console.info(
          `[perf][files.tree.details] directories=${perfStats.directoriesVisited} rawEntries=${perfStats.entriesVisited} stat=${perfStats.statMs.toFixed(1)}ms`
        );
      }

      return {
        entries,
      };
    },

    async readTextFile(input: {
      projectPath: string;
      filePath: string;
    }): Promise<{ content: string }> {
      const filePath = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: input.filePath,
      });
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new Error('Requested path is not a file');
      }

      return { content: await readFile(filePath, 'utf8') };
    },

    async writeTextFile(input: {
      projectPath: string;
      filePath: string;
      content: string;
    }): Promise<{ ok: true }> {
      const filePath = await resolveSafeProjectWritePath({
        projectPath: input.projectPath,
        requestedPath: input.filePath,
      });
      const handle = await open(
        filePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o666
      );
      try {
        await handle.writeFile(input.content, 'utf8');
      } finally {
        await handle.close();
      }

      return { ok: true };
    },

    async writeBinaryFile(input: {
      projectPath: string;
      filePath: string;
      dataBase64: string;
    }): Promise<{ ok: true }> {
      const filePath = await resolveSafeProjectWritePath({
        projectPath: input.projectPath,
        requestedPath: input.filePath,
      });
      await mkdir(dirname(filePath), { recursive: true });
      const handle = await open(
        filePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o666
      );
      try {
        await handle.writeFile(Buffer.from(input.dataBase64, 'base64'));
      } finally {
        await handle.close();
      }

      return { ok: true };
    },

    async createEntry(input: {
      projectPath: string;
      parentPath?: string;
      type: 'file' | 'directory';
      name: string;
    }): Promise<{ ok: true; path: string }> {
      const name = validateEntryName(input.name);
      const targetPath = await resolveSafeProjectWritePath({
        projectPath: input.projectPath,
        requestedPath: join(input.parentPath || '', name),
      });
      await stat(targetPath)
        .then(() => {
          throw new HttpError(409, 'A file or directory with this name already exists', 'file_exists');
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return null;
          }
          throw error;
        });

      if (input.type === 'directory') {
        await mkdir(targetPath);
      } else if (input.type === 'file') {
        await writeFile(targetPath, '', { flag: 'wx' });
      } else {
        throw new HttpError(400, 'Entry type must be file or directory', 'file_type_invalid');
      }

      const projectRoot = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: '.',
      });
      return { ok: true, path: toRelativePath(projectRoot, targetPath) };
    },

    async renameEntry(input: {
      projectPath: string;
      entryPath: string;
      newName: string;
    }): Promise<{ ok: true; path: string }> {
      const newName = validateEntryName(input.newName);
      const oldPath = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: input.entryPath,
      });
      const projectRoot = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: '.',
      });
      if (oldPath === projectRoot) {
        throw new HttpError(403, 'Cannot rename project root directory', 'file_root_forbidden');
      }
      const newPath = await resolveSafeProjectWritePath({
        projectPath: input.projectPath,
        requestedPath: toRelativePath(projectRoot, resolve(dirname(oldPath), newName)),
      });
      await stat(newPath)
        .then(() => {
          throw new HttpError(409, 'A file or directory with this name already exists', 'file_exists');
        })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return null;
          }
          throw error;
        });
      await rename(oldPath, newPath);
      return { ok: true, path: toRelativePath(projectRoot, newPath) };
    },

    async deleteEntry(input: {
      projectPath: string;
      entryPath: string;
    }): Promise<{ ok: true }> {
      const targetPath = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: input.entryPath,
      });
      const projectRoot = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: '.',
      });
      if (targetPath === projectRoot) {
        throw new HttpError(403, 'Cannot delete project root directory', 'file_root_forbidden');
      }
      await rm(targetPath, { recursive: true, force: false });
      return { ok: true };
    },

    async openEntry(input: {
      projectPath: string;
      entryPath?: string;
    }): Promise<{ ok: true }> {
      const targetPath = await resolveSafeProjectPath({
        projectPath: input.projectPath,
        requestedPath: input.entryPath || '.',
      });
      const command =
        process.platform === 'win32'
          ? 'explorer.exe'
          : process.platform === 'darwin'
            ? 'open'
            : 'xdg-open';
      const child = spawn(command, [targetPath], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    },
  };
}
