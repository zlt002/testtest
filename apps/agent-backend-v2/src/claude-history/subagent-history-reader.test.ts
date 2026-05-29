import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { toClaudeProjectKey } from './claude-project-key.ts';
import { readSessionSubagentSnapshots } from './subagent-history-reader.ts';

test('readSessionSubagentSnapshots keeps subagent running while latest stop_reason is tool_use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subagent-history-reader-'));
  const projectPath = '/tmp/project-subagent-status';
  const sessionId = 'session-1';
  const subagentsDir = join(
    root,
    toClaudeProjectKey(projectPath),
    sessionId,
    'subagents'
  );

  try {
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      join(subagentsDir, 'agent-demo.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-05-29T10:00:00.000Z',
          message: {
            role: 'assistant',
            type: 'message',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu-1',
                name: 'WebSearch',
                input: { query: 'Claude Code benchmark' },
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-29T10:00:03.000Z',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu-1',
                content: 'ok',
              },
            ],
          },
        }),
      ].join('\n') + '\n',
      'utf8'
    );
    await writeFile(
      join(subagentsDir, 'agent-demo.meta.json'),
      JSON.stringify({
        description: '搜索 Claude Code 具体指标',
      }),
      'utf8'
    );

    const snapshots = await readSessionSubagentSnapshots({
      projectPath,
      sessionId,
      claudeProjectsDir: root,
    });

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.status, 'running');
    assert.equal(snapshots[0]?.toolCount, 1);
    assert.equal(snapshots[0]?.latestToolName, 'WebSearch');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
