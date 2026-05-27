import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { HttpError } from '../shared/errors.ts';

type SessionFileKind = 'image' | 'document' | 'text' | 'other';

type SupportedType = {
  kind: SessionFileKind;
  mimeTypes: readonly string[];
};

const SUPPORTED_TYPES = new Map<string, SupportedType>([
  ['.png', { kind: 'image', mimeTypes: ['image/png'] }],
  ['.jpg', { kind: 'image', mimeTypes: ['image/jpeg'] }],
  ['.jpeg', { kind: 'image', mimeTypes: ['image/jpeg'] }],
  ['.gif', { kind: 'image', mimeTypes: ['image/gif'] }],
  ['.webp', { kind: 'image', mimeTypes: ['image/webp'] }],
  ['.pdf', { kind: 'document', mimeTypes: ['application/pdf'] }],
  ['.doc', { kind: 'document', mimeTypes: ['application/msword'] }],
  [
    '.docx',
    {
      kind: 'document',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    },
  ],
  ['.xls', { kind: 'document', mimeTypes: ['application/vnd.ms-excel'] }],
  [
    '.xlsx',
    {
      kind: 'document',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    },
  ],
  ['.ppt', { kind: 'document', mimeTypes: ['application/vnd.ms-powerpoint'] }],
  [
    '.pptx',
    {
      kind: 'document',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    },
  ],
  ['.txt', { kind: 'text', mimeTypes: ['text/plain'] }],
  ['.md', { kind: 'text', mimeTypes: ['text/markdown', 'text/plain'] }],
  ['.csv', { kind: 'text', mimeTypes: ['text/csv'] }],
  ['.json', { kind: 'text', mimeTypes: ['application/json', 'text/json'] }],
]);

export type SessionFileMetadata = {
  id: string;
  sessionFileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: SessionFileKind;
  storage: 'session-temp';
  absolutePath: string;
};

function validatePathSegment(value: string, fieldName: string) {
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new HttpError(
      400,
      `${fieldName} contains invalid path characters`,
      fieldName === 'sessionId' ? 'session_file_session_id_invalid' : 'session_file_id_invalid'
    );
  }
  return value;
}

function resolveSupportedType(fileName: string, mimeType: string): { ext: string; kind: SessionFileKind } {
  const ext = extname(fileName).toLowerCase();
  const supportedType = SUPPORTED_TYPES.get(ext);
  if (!supportedType || !supportedType.mimeTypes.includes(mimeType)) {
    throw new HttpError(
      415,
      `Unsupported file type: ${fileName} (${mimeType})`,
      'session_file_type_unsupported'
    );
  }
  return { ext, kind: supportedType.kind };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveRootDir(rootDir: string): Promise<string> {
  return realpath(rootDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new HttpError(404, 'Session file root directory does not exist', 'session_file_root_not_found');
    }
    throw error;
  });
}

async function resolveSafeSessionDir(input: {
  rootDir: string;
  sessionId: string;
  createIfMissing: boolean;
}): Promise<{ rootDir: string; sessionDir: string }> {
  const rootDir = await resolveRootDir(input.rootDir);
  const sessionDir = resolve(rootDir, input.sessionId);
  if (!isInside(rootDir, sessionDir)) {
    throw new HttpError(403, 'Session directory is outside the root directory', 'session_file_path_outside_root');
  }

  let info = await lstat(sessionDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });

  if (!info && input.createIfMissing) {
    await mkdir(sessionDir, { recursive: false });
    info = await lstat(sessionDir);
  }

  if (!info) {
    throw new HttpError(404, 'Session directory does not exist', 'session_file_session_not_found');
  }
  if (info.isSymbolicLink()) {
    throw new HttpError(403, 'Session directory is outside the root directory', 'session_file_path_outside_root');
  }
  if (!info.isDirectory()) {
    throw new HttpError(409, 'Session storage path is not a directory', 'session_file_session_dir_invalid');
  }

  const resolvedSessionDir = await realpath(sessionDir);
  if (!isInside(rootDir, resolvedSessionDir)) {
    throw new HttpError(403, 'Session directory is outside the root directory', 'session_file_path_outside_root');
  }

  return { rootDir, sessionDir };
}

export function createSessionFileService(input: { rootDir: string }) {
  return {
    async saveUploadedFile(file: {
      sessionId: string;
      fileName: string;
      mimeType: string;
      content: Uint8Array;
    }): Promise<SessionFileMetadata> {
      const sessionId = validatePathSegment(file.sessionId, 'sessionId');
      const name = basename(file.fileName);
      const { ext, kind } = resolveSupportedType(name, file.mimeType);
      const id = randomUUID();
      const { rootDir, sessionDir } = await resolveSafeSessionDir({
        rootDir: input.rootDir,
        sessionId,
        createIfMissing: true,
      });
      const absolutePath = join(sessionDir, `${id}${ext}`);
      if (!isInside(rootDir, absolutePath)) {
        throw new HttpError(403, 'Session file path is outside the root directory', 'session_file_path_outside_root');
      }

      await writeFile(absolutePath, file.content);

      return {
        id,
        sessionFileId: id,
        name,
        mimeType: file.mimeType,
        size: file.content.byteLength,
        kind,
        storage: 'session-temp',
        absolutePath,
      };
    },

    async deleteFile(file: { sessionId: string; sessionFileId: string }): Promise<{ ok: true }> {
      const sessionId = validatePathSegment(file.sessionId, 'sessionId');
      const sessionFileId = validatePathSegment(file.sessionFileId, 'sessionFileId');
      const { rootDir, sessionDir } = await resolveSafeSessionDir({
        rootDir: input.rootDir,
        sessionId,
        createIfMissing: false,
      });
      const entries = await readdir(sessionDir);
      const matchedNames = entries.filter((entry) => entry.startsWith(`${sessionFileId}.`));
      if (matchedNames.length === 0) {
        throw new HttpError(404, `Session file not found: ${sessionFileId}`, 'session_file_not_found');
      }
      if (matchedNames.length > 1) {
        throw new HttpError(
          409,
          `Session file delete is ambiguous: ${sessionFileId}`,
          'session_file_delete_ambiguous'
        );
      }
      const absolutePath = join(sessionDir, matchedNames[0]);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new HttpError(403, 'Session file path is outside the root directory', 'session_file_path_outside_root');
      }
      const resolvedPath = await realpath(absolutePath);
      if (!isInside(rootDir, resolvedPath)) {
        throw new HttpError(403, 'Session file path is outside the root directory', 'session_file_path_outside_root');
      }

      await rm(absolutePath, { force: false, recursive: false });
      return { ok: true };
    },
  };
}
