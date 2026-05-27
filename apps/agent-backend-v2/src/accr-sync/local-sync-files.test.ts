import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSyncFiles, parseRemoveSkills } from './local-sync-files.ts';

test('parseRemoveSkills reads remove_skills list from blacklist yaml', () => {
  assert.deepEqual(
    parseRemoveSkills(
      ['remove_skills:', '  - legacy-skill', '  - old-helper', '', 'other_key: value'].join('\n')
    ),
    ['legacy-skill', 'old-helper']
  );
});

test('apply backs up target, copies files, and removes blacklisted skills', async () => {
  const calls: string[] = [];
  const sync = createLocalSyncFiles({
    backupDir: async () => '/tmp/backups/claude-backup.tar.gz',
    copyDir: async () => {
      calls.push('copy');
    },
    readFile: async (path) =>
      path.endsWith('.skillBlackList.yaml') ? 'remove_skills:\n  - legacy-skill\n' : '',
    removeDir: async (path) => {
      calls.push(`remove:${path}`);
    },
    fileExists: async (path) =>
      path === '/home/user/.claude' ||
      path.endsWith('.skillBlackList.yaml') ||
      path.endsWith('/skills/legacy-skill'),
  });

  const result = await sync.apply({
    extractedDir: '/tmp/extracted',
    targetDir: '/home/user/.claude',
    keepBackupCount: 5,
  });

  assert.equal(result.backupPath, '/tmp/backups/claude-backup.tar.gz');
  assert.deepEqual(result.removedSkills, ['legacy-skill']);
  assert.deepEqual(calls, ['copy', 'remove:/home/user/.claude/skills/legacy-skill']);
});

test('apply skips blacklist removal when no blacklist file exists', async () => {
  const calls: string[] = [];
  const sync = createLocalSyncFiles({
    backupDir: async () => '/tmp/backups/claude-backup.tar.gz',
    copyDir: async () => {
      calls.push('copy');
    },
    removeDir: async (path) => {
      calls.push(`remove:${path}`);
    },
    fileExists: async (path) => path === '/home/user/.claude',
  });

  const result = await sync.apply({
    extractedDir: '/tmp/extracted',
    targetDir: '/home/user/.claude',
    keepBackupCount: 5,
  });

  assert.equal(result.backupPath, '/tmp/backups/claude-backup.tar.gz');
  assert.deepEqual(result.removedSkills, []);
  assert.deepEqual(calls, ['copy']);
});

test('apply strips top-level .claude directory before copying into target', async () => {
  const copyCalls: Array<{ from: string; to: string }> = [];
  const sync = createLocalSyncFiles({
    backupDir: async () => '/tmp/backups/claude-backup.tar.gz',
    copyDir: async (from, to) => {
      copyCalls.push({ from, to });
    },
    fileExists: async (path) => path.endsWith('/.claude'),
  });

  await sync.apply({
    extractedDir: '/tmp/extracted',
    targetDir: '/home/user/.claude',
    keepBackupCount: 5,
  });

  assert.deepEqual(copyCalls, [
    {
      from: '/tmp/extracted/.claude',
      to: '/home/user/.claude',
    },
  ]);
});

test('default backup excludes transient oauth refresh lock file from tar archive', async () => {
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const sync = createLocalSyncFiles({
    homeDir: '/tmp/demo-home',
    now: () => new Date('2026-05-26T13:38:35.000Z'),
    execFileAsync: async (command, args) => {
      execCalls.push({ command, args });
    },
    copyDir: async () => {},
    fileExists: async (path) => path === '/tmp/demo-home/.claude',
  });

  await sync.apply({
    extractedDir: '/tmp/extracted',
    targetDir: '/tmp/demo-home/.claude',
    keepBackupCount: 5,
  });

  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0]?.command, 'tar');
  assert.deepEqual(execCalls[0]?.args, [
    '--exclude=.claude/.oauth_refresh.lock',
    '-czf',
    '/tmp/demo-home/.annto-claude-code/backups/claude-backup-2026-05-26T13_38_35.tar.gz',
    '-C',
    '/tmp/demo-home',
    '.claude',
  ]);
});

test('apply skips backup when target dir does not exist yet', async () => {
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const copyCalls: Array<{ from: string; to: string }> = [];
  const sync = createLocalSyncFiles({
    homeDir: '/tmp/demo-home',
    now: () => new Date('2026-05-26T13:38:35.000Z'),
    execFileAsync: async (command, args) => {
      execCalls.push({ command, args });
    },
    copyDir: async (from, to) => {
      copyCalls.push({ from, to });
    },
    fileExists: async (path) => path === '/tmp/extracted/.claude',
  });

  const result = await sync.apply({
    extractedDir: '/tmp/extracted',
    targetDir: '/tmp/demo-home/.claude',
    keepBackupCount: 5,
  });

  assert.equal(result.backupPath, '');
  assert.deepEqual(result.removedSkills, []);
  assert.deepEqual(execCalls, []);
  assert.deepEqual(copyCalls, [
    {
      from: '/tmp/extracted/.claude',
      to: '/tmp/demo-home/.claude',
    },
  ]);
});
