import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccrSyncService } from './accr-sync-service.ts';

test('remote mode delegates to built-in remote sync manager', async () => {
  const calls: boolean[] = [];
  const service = createAccrSyncService({
    remoteSync: {
      async syncRemote(input) {
        calls.push(input.force);
        return { ok: true, status: 'completed', mode: 'remote', stdout: '', stderr: '' };
      },
    },
    localDebugSync: {
      async syncLocalDebug() {
        calls.push('local');
        return { ok: true, status: 'completed', mode: 'local-debug', stdout: '', stderr: '' };
      },
    },
  });

  const result = await service.run({ mode: 'remote', force: true });

  assert.deepEqual(result, {
    ok: true,
    status: 'completed',
    mode: 'remote',
    stdout: '',
    stderr: '',
  });
  assert.deepEqual(calls, [true]);
});

test('local-debug mode delegates to built-in local debug sync service', async () => {
  const calls: string[] = [];
  const service = createAccrSyncService({
    remoteSync: {
      async syncRemote() {
        calls.push('remote');
        return { ok: true, status: 'completed', mode: 'remote', stdout: '', stderr: '' };
      },
    },
    localDebugSync: {
      async syncLocalDebug() {
        calls.push('local');
        return { ok: true, status: 'completed', mode: 'local-debug', stdout: 'done', stderr: '' };
      },
    },
  });

  const result = await service.run({ mode: 'local-debug' });

  assert.deepEqual(result, {
    ok: true,
    status: 'completed',
    mode: 'local-debug',
    stdout: 'done',
    stderr: '',
  });
  assert.deepEqual(calls, ['local']);
});

test('checkHealth delegates to built-in sync health service', async () => {
  const service = createAccrSyncService({
    remoteSync: {
      async syncRemote() {
        throw new Error('should not call remote sync');
      },
    },
    localDebugSync: {
      async syncLocalDebug() {
        throw new Error('should not call local debug sync');
      },
    },
    healthCheck: {
      async check() {
        return {
          ok: true,
          healthy: false,
          checkedPath: '/Users/demo/.claude/skills',
          issues: ['未找到技能目录'],
          recommendedAction: 'remote_resync',
          syncStateVersion: '2026.05.27',
        };
      },
    },
  });

  const result = await service.checkHealth();

  assert.deepEqual(result, {
    ok: true,
    healthy: false,
    checkedPath: '/Users/demo/.claude/skills',
    issues: ['未找到技能目录'],
    recommendedAction: 'remote_resync',
    syncStateVersion: '2026.05.27',
  });
});
