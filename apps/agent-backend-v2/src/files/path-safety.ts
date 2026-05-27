import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { HttpError } from '../shared/errors.ts';

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeProjectPath(projectPath: string): string {
  if (process.platform !== 'win32') {
    return projectPath;
  }

  const legacyDrivePath = projectPath.match(/^\/([a-zA-Z])\/+(.+)$/);
  if (!legacyDrivePath) {
    return projectPath;
  }

  return `${legacyDrivePath[1]}:\\${legacyDrivePath[2].replace(/\//g, '\\')}`;
}

async function resolveProjectRoot(projectPath: string): Promise<string> {
  return realpath(normalizeProjectPath(projectPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new HttpError(404, 'Project directory does not exist', 'project_not_found');
    }
    throw error;
  });
}

export async function resolveSafeProjectPath(input: {
  projectPath: string;
  requestedPath?: string;
}): Promise<string> {
  const projectRoot = await resolveProjectRoot(input.projectPath);
  const candidate = resolve(projectRoot, input.requestedPath || '.');
  const resolved = await realpath(candidate).catch(() => candidate);

  if (!isInside(projectRoot, resolved)) {
    throw new HttpError(403, 'Requested path is outside the project path', 'path_outside_project');
  }

  return resolved;
}

export async function resolveSafeProjectWritePath(input: {
  projectPath: string;
  requestedPath: string;
}): Promise<string> {
  const projectRoot = await resolveProjectRoot(input.projectPath);
  const candidate = resolve(projectRoot, input.requestedPath);

  if (!isInside(projectRoot, candidate)) {
    throw new HttpError(403, 'Requested path is outside the project path', 'path_outside_project');
  }

  const parentPath = dirname(candidate);
  const relativeParent = relative(projectRoot, parentPath);
  const parentParts = relativeParent ? relativeParent.split(sep).filter(Boolean) : [];
  let current = projectRoot;
  for (const part of parentParts) {
    current = resolve(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!info) {
      break;
    }
    const resolved = await realpath(current);
    if (info.isSymbolicLink() || !isInside(projectRoot, resolved)) {
      throw new HttpError(
        403,
        'Requested path is outside the project path',
        'path_outside_project'
      );
    }
  }

  await mkdir(parentPath, { recursive: true });
  const parent = await realpath(parentPath);
  if (!isInside(projectRoot, parent)) {
    throw new HttpError(403, 'Requested path is outside the project path', 'path_outside_project');
  }

  const targetInfo = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (targetInfo?.isSymbolicLink()) {
    throw new HttpError(403, 'Requested path is outside the project path', 'path_outside_project');
  }

  return candidate;
}
