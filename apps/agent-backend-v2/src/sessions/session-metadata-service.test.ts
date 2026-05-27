import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSessionMetadataService } from './session-metadata-service.ts';

test('session metadata service renames and hides sessions per project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-sessions-'));
  const configPath = join(root, '.webmcp', 'sessions.json');
  const service = createSessionMetadataService({ configPath });
  const projectPath = join(root, 'project');
  const sessions = [
    {
      sessionId: 'session-1',
      projectPath,
      filePath: join(root, 'session-1.jsonl'),
      messageCount: null,
      updatedAt: '2026-05-11T01:00:00.000Z',
    },
    {
      sessionId: 'session-2',
      projectPath,
      filePath: join(root, 'session-2.jsonl'),
      messageCount: null,
      updatedAt: '2026-05-11T02:00:00.000Z',
    },
  ];

  await service.renameSession({ projectPath, sessionId: 'session-1', title: 'Planning' });
  await service.deleteSession({ projectPath, sessionId: 'session-2' });

  assert.deepEqual(await service.applyMetadata(sessions), [
    {
      ...sessions[0],
      title: 'Planning',
    },
  ]);
  assert.match(await readFile(configPath, 'utf8'), /Planning/);

  await rm(root, { recursive: true, force: true });
});

test('session metadata service stores interrupted state per project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-sessions-'));
  const configPath = join(root, '.webmcp', 'sessions.json');
  const service = createSessionMetadataService({ configPath });
  const projectPath = join(root, 'project');
  const sessions = [
    {
      sessionId: 'session-1',
      projectPath,
      filePath: join(root, 'session-1.jsonl'),
      messageCount: 4,
      updatedAt: '2026-05-14T10:00:00.000Z',
    },
  ];

  await service.markSessionInterrupted({
    projectPath,
    sessionId: 'session-1',
    reason: 'window_takeover_user_left',
  });

  const [session] = await service.applyMetadata(sessions);
  assert.equal(session?.interrupted, true);
  assert.equal(session?.interruptedReason, 'window_takeover_user_left');
  assert.match(session?.interruptedAt || '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(await readFile(configPath, 'utf8'), /window_takeover_user_left/);

  await rm(root, { recursive: true, force: true });
});

test('session metadata service sanitizes generated prompt metadata in returned and renamed titles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-sessions-'));
  const configPath = join(root, '.webmcp', 'sessions.json');
  const service = createSessionMetadataService({ configPath });
  const projectPath = join(root, 'project');
  const sessions = [
    {
      sessionId: 'session-1',
      projectPath,
      filePath: join(root, 'session-1.jsonl'),
      messageCount: null,
      updatedAt: '2026-05-11T01:00:00.000Z',
      title: [
        '<attachments>',
        '- name=image.png | mimeType=image/png | kind=image',
        '</attachments>',
        '',
        '<user_original_request>',
        '请分析这张图片',
        '</user_original_request>',
      ].join('\n'),
    },
  ];

  await service.renameSession({
    projectPath,
    sessionId: 'session-1',
    title: [
      '<project_workspace>',
      `当前项目根目录：${projectPath}`,
      '</project_workspace>',
      '',
      '真正标题',
    ].join('\n'),
  });

  assert.deepEqual(await service.applyMetadata(sessions), [
    {
      ...sessions[0],
      title: '真正标题',
    },
  ]);
  assert.doesNotMatch(await readFile(configPath, 'utf8'), /project_workspace|attachments/);

  await rm(root, { recursive: true, force: true });
});
