import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRunStateStore } from './session-run-state.ts';

function createClock(startAt = '2026-05-19T00:00:00.000Z') {
  let currentMs = Date.parse(startAt);

  return {
    now() {
      return new Date(currentMs).toISOString();
    },
    advance(ms: number) {
      currentMs += ms;
      return new Date(currentMs).toISOString();
    },
  };
}

test('upsert creates per-session run state and lists project sessions by recent activity', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 1,
    latestPreviewText: 'A 正在执行',
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-b',
    projectPath: '/repo/a',
    runId: 'run-b',
    status: 'connecting',
    latestSequence: 0,
    latestPreviewText: 'B 正在连接',
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-c',
    projectPath: '/repo/other',
    runId: 'run-c',
    status: 'streaming',
    latestSequence: 5,
    latestPreviewText: 'C 正在执行',
  });

  const sessionA = store.get('session-a');
  assert.ok(sessionA);
  assert.equal(sessionA.status, 'streaming');
  assert.equal(sessionA.hasActiveStream, true);
  assert.equal(sessionA.startedAt, '2026-05-19T00:00:00.000Z');
  assert.equal(sessionA.lastEventAt, '2026-05-19T00:00:00.000Z');

  assert.deepEqual(
    store.listByProject('/repo/a').map((item) => item.sessionId),
    ['session-b', 'session-a']
  );
});

test('upsert does not let older sequence or older event time overwrite newer state', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'connecting',
    latestSequence: 1,
    latestPreviewText: '开始连接',
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 3,
    latestPreviewText: '最新内容',
  });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'failed',
    latestSequence: 2,
    lastEventAt: '2026-05-18T23:59:59.000Z',
    latestPreviewText: '旧内容',
    lastError: 'stale error',
  });

  const state = store.get('session-a');
  assert.ok(state);
  assert.equal(state.status, 'streaming');
  assert.equal(state.latestSequence, 3);
  assert.equal(state.lastEventAt, '2026-05-19T00:00:01.000Z');
  assert.equal(state.latestPreviewText, '最新内容');
  assert.equal(state.lastError, undefined);
});

test('upsert keeps existing projectPath for stale events in the same run', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 3,
    latestPreviewText: '最新事件',
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/rewritten-by-stale-event',
    runId: 'run-a',
    status: 'connecting',
    latestSequence: 2,
    latestPreviewText: '旧事件',
  });

  const state = store.get('session-a');
  assert.ok(state);
  assert.equal(state.projectPath, '/repo/a');
});

test('upsert keeps existing lastEventAt for stale sequence even if stale event timestamp is later', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 3,
    lastEventAt: '2026-05-19T00:00:05.000Z',
    latestPreviewText: '最新事件',
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'connecting',
    latestSequence: 2,
    lastEventAt: '2026-05-19T00:01:00.000Z',
    latestPreviewText: '旧事件但时间更晚',
  });

  const state = store.get('session-a');
  assert.ok(state);
  assert.equal(state.lastEventAt, '2026-05-19T00:00:05.000Z');
});

test('markFinished updates terminal status and closes active stream', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 7,
    latestPreviewText: '处理中',
  });

  clock.advance(2_000);
  const finished = store.markFinished('session-a', 'failed', {
    runId: 'run-a',
    lastError: 'network error',
    latestPreviewText: '执行失败',
  });

  assert.ok(finished);
  assert.equal(finished.status, 'failed');
  assert.equal(finished.hasActiveStream, false);
  assert.equal(finished.lastEventAt, '2026-05-19T00:00:02.000Z');
  assert.equal(finished.lastError, 'network error');
  assert.equal(finished.latestPreviewText, '执行失败');
});

test('markFinished ignores terminal events from an older run id', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-a',
    status: 'streaming',
    latestSequence: 3,
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-a',
    projectPath: '/repo/a',
    runId: 'run-b',
    status: 'streaming',
    latestSequence: 1,
    latestPreviewText: '新 run 仍在执行',
  });

  const finished = store.markFinished('session-a', 'completed', {
    runId: 'run-a',
    latestPreviewText: '旧 run 结束',
  });

  assert.equal(finished?.runId, 'run-b');
  assert.equal(finished?.status, 'streaming');
  assert.equal(finished?.hasActiveStream, true);
  assert.equal(finished?.latestPreviewText, '新 run 仍在执行');
});

test('listByProject keeps case-sensitive project buckets while normalizing separators', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({ now: clock.now });

  store.upsert({
    sessionId: 'session-upper',
    projectPath: 'C:\\Repo\\Project',
    runId: 'run-upper',
    status: 'streaming',
    latestSequence: 1,
  });

  clock.advance(1_000);
  store.upsert({
    sessionId: 'session-lower',
    projectPath: 'C:\\repo\\project',
    runId: 'run-lower',
    status: 'streaming',
    latestSequence: 1,
  });

  assert.deepEqual(
    store.listByProject('C:/Repo/Project').map((item) => item.sessionId),
    ['session-upper']
  );
  assert.deepEqual(
    store.listByProject('C:/repo/project').map((item) => item.sessionId),
    ['session-lower']
  );
});

test('pruneExpired removes only finished states that exceed ttl', () => {
  const clock = createClock();
  const store = createSessionRunStateStore({
    now: clock.now,
    retentionMs: 60_000,
  });

  store.upsert({
    sessionId: 'active-session',
    projectPath: '/repo/a',
    runId: 'run-active',
    status: 'streaming',
    latestSequence: 10,
  });

  clock.advance(5_000);
  store.upsert({
    sessionId: 'finished-session',
    projectPath: '/repo/a',
    runId: 'run-finished',
    status: 'streaming',
    latestSequence: 1,
  });
  store.markFinished('finished-session', 'completed');

  clock.advance(30_000);
  store.upsert({
    sessionId: 'recent-finished-session',
    projectPath: '/repo/a',
    runId: 'run-recent-finished',
    status: 'streaming',
    latestSequence: 2,
  });
  store.markFinished('recent-finished-session', 'aborted');

  clock.advance(31_000);
  store.pruneExpired();

  assert.equal(store.get('active-session')?.status, 'streaming');
  assert.equal(store.get('finished-session'), null);
  assert.equal(store.get('recent-finished-session')?.status, 'aborted');
});
