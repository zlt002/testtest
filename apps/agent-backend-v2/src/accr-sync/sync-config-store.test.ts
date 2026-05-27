import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSyncConfigStore,
  DEFAULT_ARCHIVE_URL,
  DEFAULT_DOWNLOAD_TIMEOUT,
  DEFAULT_KEEP_BACKUP_COUNT,
  DEFAULT_MANIFEST_URL,
} from './sync-config-store.ts';

test('load returns ACCR-compatible defaults when config file is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-accr-config-'));
  try {
    const store = createSyncConfigStore({ homeDir: dir });

    assert.deepEqual(await store.load(), {
      archiveUrl: DEFAULT_ARCHIVE_URL,
      manifestUrl: DEFAULT_MANIFEST_URL,
      autoSync: true,
      keepBackupCount: DEFAULT_KEEP_BACKUP_COUNT,
      downloadTimeout: DEFAULT_DOWNLOAD_TIMEOUT,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('save persists config into ~/.annto-claude-code/config.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-accr-config-save-'));
  try {
    const store = createSyncConfigStore({ homeDir: dir });
    const next = {
      archiveUrl: 'https://example.com/archive.tar.gz',
      manifestUrl: 'https://example.com/manifest.json',
      checksum: 'abc123',
      autoSync: false,
      keepBackupCount: 9,
      downloadTimeout: 45000,
    };

    await store.save(next);

    assert.deepEqual(JSON.parse(await readFile(store.configPath, 'utf8')), next);
    assert.deepEqual(await store.load(), next);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
