import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AccrSyncState = {
  version: string;
  lastSyncVersion: string;
  lastCheckedAt: string;
  lastBackupPath: string;
};

type FileSystem = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
};

function defaultState(): AccrSyncState {
  return {
    version: '',
    lastSyncVersion: '',
    lastCheckedAt: '',
    lastBackupPath: '',
  };
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export function createSyncStateStore(input?: {
  homeDir?: string;
  mkdir?: FileSystem['mkdir'];
  readFile?: FileSystem['readFile'];
  writeFile?: FileSystem['writeFile'];
}) {
  const fs = {
    mkdir: input?.mkdir ?? mkdir,
    readFile: input?.readFile ?? readFile,
    writeFile: input?.writeFile ?? writeFile,
  };
  const homeDir = input?.homeDir ?? homedir();
  const statePath = join(homeDir, '.annto-claude-code', 'sync-manifest.json');

  return {
    statePath,
    async load(): Promise<AccrSyncState> {
      try {
        const raw = await fs.readFile(statePath, 'utf8');
        return {
          ...defaultState(),
          ...(JSON.parse(raw) as Partial<AccrSyncState>),
        };
      } catch (error) {
        if (isEnoent(error)) {
          return defaultState();
        }
        throw error;
      }
    },
    async save(state: AccrSyncState): Promise<void> {
      await fs.mkdir(dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    },
  };
}
