import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { AccrSyncResult } from './accr-sync-service.ts';
import type { AccrSyncConfig } from './sync-config-store.ts';
import type { AccrSyncState } from './sync-state-store.ts';

export type RemoteSyncManifest = {
  version: string;
  archive?: {
    url?: string;
    checksum?: string;
  };
};

type ConfigStore = {
  load(): Promise<AccrSyncConfig>;
};

type StateStore = {
  load(): Promise<AccrSyncState>;
  save(state: AccrSyncState): Promise<void>;
};

type LocalSyncFiles = {
  apply(input: {
    extractedDir: string;
    targetDir: string;
    keepBackupCount: number;
  }): Promise<{ backupPath: string; removedSkills: string[] }>;
};

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function calculateChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return `sha256:${hash.digest('hex')}`;
}

async function fetchManifest(config: AccrSyncConfig): Promise<RemoteSyncManifest> {
  const response = await fetch(config.manifestUrl, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as RemoteSyncManifest;
}

async function downloadArchive(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`archive download failed: ${response.status} ${response.statusText}`);
  }

  const syncTempDir = join(tmpdir(), 'agent-backend-v2-accr-sync');
  await mkdir(syncTempDir, { recursive: true });
  const archivePath = join(syncTempDir, 'archive.tar.gz');
  const stream = createWriteStream(archivePath);
  const body = response.body;
  if (!body) {
    throw new Error('archive response body is empty');
  }

  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    await new Promise<void>((resolve, reject) => {
      stream.write(value, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return archivePath;
}

async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<void> {
  if (!expectedChecksum) {
    return;
  }
  const actualChecksum = await calculateChecksum(filePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
  }
}

async function extractArchive(archivePath: string): Promise<string> {
  const extractedDir = join(tmpdir(), 'agent-backend-v2-accr-sync', 'extracted');
  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(extractedDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractedDir]);
  return extractedDir;
}

function hasUpdate(localVersion: string, remoteVersion: string, force: boolean): boolean {
  return force || localVersion.startsWith('local-debug-') || remoteVersion > localVersion;
}

async function defaultIsLocalSkillsHealthy(targetDir: string): Promise<boolean> {
  try {
    const skillStats = await stat(join(targetDir, 'skills'));
    return skillStats.isDirectory();
  } catch {
    return false;
  }
}

export function createRemoteSyncManager(input: {
  configStore: ConfigStore;
  stateStore: StateStore;
  localSyncFiles: LocalSyncFiles;
  targetDir: string;
  nowIso?: () => string;
  fetchManifest?: (config: AccrSyncConfig) => Promise<RemoteSyncManifest>;
  downloadArchive?: (url: string) => Promise<string>;
  verifyChecksum?: (filePath: string, expectedChecksum: string) => Promise<void>;
  extractArchive?: (archivePath: string) => Promise<string>;
  isLocalSkillsHealthy?: (targetDir: string) => Promise<boolean>;
}) {
  const nowIso = input.nowIso ?? (() => new Date().toISOString());
  const loadManifest = input.fetchManifest ?? fetchManifest;
  const fetchArchive = input.downloadArchive ?? downloadArchive;
  const checkChecksum = input.verifyChecksum ?? verifyChecksum;
  const unpackArchive = input.extractArchive ?? extractArchive;
  const checkLocalSkillsHealthy = input.isLocalSkillsHealthy ?? defaultIsLocalSkillsHealthy;

  return {
    async syncRemote(inputValue: { force: boolean }): Promise<AccrSyncResult> {
      const config = await input.configStore.load();
      const localState = await input.stateStore.load();
      const manifest = await loadManifest(config);
      const remoteVersion = manifest.version;
      const localSkillsHealthy = await checkLocalSkillsHealthy(input.targetDir);
      const shouldForceResync = inputValue.force || !localSkillsHealthy;

      if (!hasUpdate(localState.version, remoteVersion, shouldForceResync)) {
        await input.stateStore.save({
          ...localState,
          lastCheckedAt: nowIso(),
        });
        return {
          ok: true,
          status: 'completed',
          mode: 'remote',
          stdout: '',
          stderr: 'already up to date',
        };
      }

      const archiveUrl = manifest.archive?.url ?? config.archiveUrl;
      if (!archiveUrl) {
        throw new Error('archive url is not configured');
      }

      const archivePath = await fetchArchive(archiveUrl);
      const checksum = manifest.archive?.checksum ?? config.checksum ?? '';
      await checkChecksum(archivePath, checksum);
      const extractedDir = await unpackArchive(archivePath);
      const applied = await input.localSyncFiles.apply({
        extractedDir,
        targetDir: input.targetDir,
        keepBackupCount: config.keepBackupCount,
      });

      await input.stateStore.save({
        ...localState,
        version: remoteVersion,
        lastSyncVersion: remoteVersion,
        lastCheckedAt: nowIso(),
        lastBackupPath: applied.backupPath,
      });

      return {
        ok: true,
        status: 'completed',
        mode: 'remote',
        stdout: '',
        stderr: '',
      };
    },
  };
}
