import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteSyncManager } from './remote-sync-manager.ts';

test('syncRemote downloads archive, applies files, and updates local state', async () => {
  const events: string[] = [];
  const manager = createRemoteSyncManager({
    configStore: {
      async load() {
        return {
          archiveUrl: 'https://fallback.example.com/archive.tar.gz',
          manifestUrl: 'https://example.com/manifest.json',
          checksum: 'abc123',
          autoSync: true,
          keepBackupCount: 5,
          downloadTimeout: 30000,
        };
      },
    },
    stateStore: {
      async load() {
        return {
          version: '1.0.0',
          lastSyncVersion: '',
          lastCheckedAt: '',
          lastBackupPath: '',
        };
      },
      async save(state) {
        events.push(`save-state:${state.version}`);
      },
    },
    localSyncFiles: {
      async apply() {
        events.push('apply-files');
        return { backupPath: '/tmp/backups/claude-backup.tar.gz', removedSkills: [] };
      },
    },
    targetDir: '/home/user/.claude',
    nowIso: () => '2026-05-26T10:00:00.000Z',
    fetchManifest: async () => ({
      version: '2.0.0',
      archive: { url: 'https://example.com/archive.tar.gz', checksum: 'abc123' },
    }),
    downloadArchive: async () => '/tmp/archive.tar.gz',
    verifyChecksum: async () => {
      events.push('verify');
    },
    extractArchive: async () => '/tmp/extracted',
  });

  const result = await manager.syncRemote({ force: false });

  assert.deepEqual(result, {
    ok: true,
    status: 'completed',
    mode: 'remote',
    stdout: '',
    stderr: '',
  });
  assert.deepEqual(events, ['verify', 'apply-files', 'save-state:2.0.0']);
});

test('syncRemote skips download when remote version is already current', async () => {
  const events: string[] = [];
  const manager = createRemoteSyncManager({
    configStore: {
      async load() {
        return {
          archiveUrl: 'https://fallback.example.com/archive.tar.gz',
          manifestUrl: 'https://example.com/manifest.json',
          autoSync: true,
          keepBackupCount: 5,
          downloadTimeout: 30000,
        };
      },
    },
    stateStore: {
      async load() {
        return {
          version: '2.0.0',
          lastSyncVersion: '2.0.0',
          lastCheckedAt: '',
          lastBackupPath: '',
        };
      },
      async save(state) {
        events.push(`save-state:${state.lastCheckedAt}`);
      },
    },
    localSyncFiles: {
      async apply() {
        throw new Error('should not apply files');
      },
    },
    targetDir: '/home/user/.claude',
    nowIso: () => '2026-05-26T10:00:00.000Z',
    fetchManifest: async () => ({
      version: '2.0.0',
      archive: { url: 'https://example.com/archive.tar.gz' },
    }),
    downloadArchive: async () => {
      throw new Error('should not download archive');
    },
  });

  const result = await manager.syncRemote({ force: false });

  assert.deepEqual(result, {
    ok: true,
    status: 'completed',
    mode: 'remote',
    stdout: '',
    stderr: 'already up to date',
  });
  assert.deepEqual(events, ['save-state:2026-05-26T10:00:00.000Z']);
});
