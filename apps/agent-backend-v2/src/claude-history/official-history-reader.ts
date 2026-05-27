import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { toClaudeProjectKey } from './claude-project-key.ts';

export type ClaudeHistoryRecord = Record<string, unknown>;

export type ClaudeHistoryFileInfo = {
  filePath: string;
  mtimeMs: number;
  updatedAt: string;
};

export async function readClaudeHistoryFile(filePath: string): Promise<ClaudeHistoryRecord[]> {
  const records: ClaudeHistoryRecord[] = [];
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed) as ClaudeHistoryRecord);
    } catch {
      // Claude may be writing a JSONL file while we read it. Keep the rest of
      // the session usable instead of failing the whole history request.
    }
  }

  return records;
}

export async function listClaudeProjectHistoryFiles(options: {
  projectPath: string;
  claudeProjectsDir?: string;
}): Promise<string[]> {
  return (await listClaudeProjectHistoryFileInfos(options)).map((file) => file.filePath);
}

export async function listClaudeProjectHistoryFileInfos(options: {
  projectPath: string;
  claudeProjectsDir?: string;
}): Promise<ClaudeHistoryFileInfo[]> {
  const projectsDir = options.claudeProjectsDir || join(homedir(), '.claude', 'projects');
  const projectDir = join(projectsDir, toClaudeProjectKey(options.projectPath));

  try {
    const entries = await readdir(projectDir);
    const files = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.jsonl'))
        .map(async (entry) => {
          const filePath = join(projectDir, entry);
          const info = await stat(filePath);
          return info.isFile()
            ? {
                filePath,
                mtimeMs: info.mtimeMs,
                updatedAt: info.mtime.toISOString(),
              }
            : null;
        })
    );
    return files
      .filter((file): file is ClaudeHistoryFileInfo => Boolean(file))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
