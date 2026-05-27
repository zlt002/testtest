import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSyncStateStore } from './sync-state-store.ts';

test('load returns stable empty state when manifest file is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-accr-state-'));
  try {
    const store = createSyncStateStore({ homeDir: dir });

    assert.deepEqual(await store.load(), {
      version: '',
      lastSyncVersion: '',
      lastCheckedAt: '',
      lastBackupPath: '',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('save persists state into ~/.annto-claude-code/sync-manifest.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-accr-state-save-'));
  try {
    const store = createSyncStateStore({ homeDir: dir });
    const next = {
      version: '2026.05.26',
      lastSyncVersion: '2026.05.26',
      lastCheckedAt: '2026-05-26T10:00:00.000Z',
      lastBackupPath: '/tmp/backups/claude-backup.tar.gz',
    };

    await store.save(next);

    assert.deepEqual(JSON.parse(await readFile(store.statePath, 'utf8')), next);
    assert.deepEqual(await store.load(), next);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
