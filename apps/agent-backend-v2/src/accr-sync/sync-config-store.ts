import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_ARCHIVE_URL =
  'https://anapi-uat.annto.com/accr-nodejs-backend/api/sync/archive';
export const DEFAULT_MANIFEST_URL =
  'https://anapi-uat.annto.com/accr-nodejs-backend/api/sync/manifest';
export const DEFAULT_DOWNLOAD_TIMEOUT = 30000;
export const DEFAULT_KEEP_BACKUP_COUNT = 5;

export type AccrSyncConfig = {
  archiveUrl: string;
  manifestUrl: string;
  checksum?: string;
  autoSync: boolean;
  keepBackupCount: number;
  downloadTimeout: number;
};

type FileSystem = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
};

function defaultConfig(): AccrSyncConfig {
  return {
    archiveUrl: DEFAULT_ARCHIVE_URL,
    manifestUrl: DEFAULT_MANIFEST_URL,
    autoSync: true,
    keepBackupCount: DEFAULT_KEEP_BACKUP_COUNT,
    downloadTimeout: DEFAULT_DOWNLOAD_TIMEOUT,
  };
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export function createSyncConfigStore(input?: {
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
  const configPath = join(homeDir, '.annto-claude-code', 'config.json');

  return {
    configPath,
    async load(): Promise<AccrSyncConfig> {
      try {
        const raw = await fs.readFile(configPath, 'utf8');
        return {
          ...defaultConfig(),
          ...(JSON.parse(raw) as Partial<AccrSyncConfig>),
        };
      } catch (error) {
        if (isEnoent(error)) {
          return defaultConfig();
        }
        throw error;
      }
    },
    async save(config: AccrSyncConfig): Promise<void> {
      await fs.mkdir(dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    },
  };
}
