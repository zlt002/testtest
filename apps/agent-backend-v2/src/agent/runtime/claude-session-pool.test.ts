import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeSessionPool } from './claude-session-pool.ts';

test('abortRun interrupts active run once and is idempotent afterward', async () => {
  let interrupted = 0;
  const pool = createClaudeSessionPool({
    query() {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', is_error: false };
        },
        async interrupt() {
          interrupted += 1;
        },
      };
    },
  });

  pool.registerActiveRun('run-1', {
    interrupt: async () => {
      interrupted += 1;
    },
  });

  assert.deepEqual(await pool.abortRun('run-1'), { aborted: true });
  assert.deepEqual(await pool.abortRun('run-1'), { aborted: false, reason: 'not_active' });
  assert.equal(interrupted, 1);
});
