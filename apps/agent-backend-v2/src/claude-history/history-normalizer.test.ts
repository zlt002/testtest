import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fromClaudeProjectKey, toClaudeProjectKey } from './claude-project-key.ts';
import { normalizeClaudeHistoryRecords } from './history-normalizer.ts';
import { readClaudeHistoryFile } from './official-history-reader.ts';
import { clearClaudeProjectListCache, listClaudeProjects } from './project-list-reader.ts';
import { listClaudeSessions } from './session-list-reader.ts';

test('normalizes user text and assistant text records', () => {
  const messages = normalizeClaudeHistoryRecords('session-1', [
    {
      uuid: 'user-1',
      timestamp: '2026-05-10T01:00:00.000Z',
      message: { role: 'user', content: '打开当前页面' },
    },
    {
      uuid: 'assistant-1',
      timestamp: '2026-05-10T01:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].text, '打开当前页面');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].text, '好的');
});

test('normalizes tool use and tool result with ids and error state', () => {
  const messages = normalizeClaudeHistoryRecords('session-1', [
    {
      uuid: 'assistant-1',
      timestamp: '2026-05-10T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu-1',
            name: 'read_current_page_content',
            input: { tabId: 123 },
          },
        ],
      },
    },
    {
      uuid: 'user-2',
      timestamp: '2026-05-10T01:00:02.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu-1',
            content: 'page text',
            is_error: false,
          },
        ],
      },
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].kind, 'tool_call');
  assert.equal(messages[0].toolId, 'toolu-1');
  assert.equal(messages[0].toolName, 'read_current_page_content');
  assert.deepEqual(messages[0].toolInput, { tabId: 123 });
  assert.equal(messages[1].kind, 'tool_result');
  assert.equal(messages[1].toolId, 'toolu-1');
  assert.equal(messages[1].toolName, 'read_current_page_content');
  assert.equal(messages[1].toolResult, 'page text');
  assert.equal(messages[1].isError, false);
});

test('normalizes thinking blocks from official history', () => {
  const messages = normalizeClaudeHistoryRecords('session-1', [
    {
      uuid: 'assistant-1',
      timestamp: '2026-05-10T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先分析问题' }],
      },
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'thinking');
  assert.equal(messages[0].text, '先分析问题');
});

test('normalizes Claude MCP and server tool use records as tool calls', () => {
  const messages = normalizeClaudeHistoryRecords('session-1', [
    {
      uuid: 'assistant-1',
      timestamp: '2026-05-10T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'mcp_tool_use',
            id: 'toolu-mcp',
            name: 'browser_extension_read_page',
            input: { tabId: 123 },
          },
          {
            type: 'server_tool_use',
            id: 'toolu-server',
            name: 'WebSearch',
            input: { query: 'WebMCP' },
          },
        ],
      },
    },
  ]);

  assert.deepEqual(
    messages.map((message) => ({
      kind: message.kind,
      toolId: 'toolId' in message ? message.toolId : undefined,
      toolName: 'toolName' in message ? message.toolName : undefined,
    })),
    [
      { kind: 'tool_call', toolId: 'toolu-mcp', toolName: 'browser_extension_read_page' },
      { kind: 'tool_call', toolId: 'toolu-server', toolName: 'WebSearch' },
    ]
  );
});

test('filters Claude Code internal continuation and task notification text', () => {
  const messages = normalizeClaudeHistoryRecords('session-1', [
    {
      uuid: 'internal-1',
      timestamp: '2026-05-10T01:00:00.000Z',
      message: { role: 'user', content: 'Continue from where you left off.' },
    },
    {
      uuid: 'internal-2',
      timestamp: '2026-05-10T01:00:01.000Z',
      message: { role: 'assistant', content: 'No response requested.' },
    },
    {
      uuid: 'internal-3',
      timestamp: '2026-05-10T01:00:02.000Z',
      message: {
        role: 'user',
        content:
          '<task-notification><task-id>abc</task-id><status>killed</status></task-notification>',
      },
    },
    {
      uuid: 'real-1',
      timestamp: '2026-05-10T01:00:03.000Z',
      message: { role: 'assistant', content: '正常回复' },
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, '正常回复');
});

test('readClaudeHistoryFile skips malformed JSONL lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-history-'));
  const filePath = join(dir, 'session-1.jsonl');
  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: '2026-05-10T01:00:00.000Z',
        message: { role: 'user', content: 'ok' },
      }),
      '{"bad":',
      JSON.stringify({
        timestamp: '2026-05-10T01:00:01.000Z',
        message: { role: 'assistant', content: 'done' },
      }),
    ].join('\n'),
    'utf8'
  );

  const records = await readClaudeHistoryFile(filePath);

  assert.equal(records.length, 2);
});

test('listClaudeSessions keeps valid sessions when another file has malformed JSONL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, 'valid.jsonl'),
    `${JSON.stringify({ timestamp: '2026-05-10T01:00:00.000Z' })}\n`,
    'utf8'
  );
  await writeFile(join(projectDir, 'bad.jsonl'), '{"bad":\n', 'utf8');

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.deepEqual(sessions.map((session) => session.sessionId).sort(), ['bad', 'valid']);
});

test('listClaudeSessions uses file metadata without parsing full JSONL contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'metadata-only.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2000-01-01T00:00:00.000Z',
      message: { role: 'user', content: 'old timestamp' },
    }),
    'utf8'
  );
  const mtime = new Date('2026-05-10T08:00:00.000Z');
  await utimes(filePath, mtime, mtime);

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'metadata-only');
  assert.equal(sessions[0].messageCount, null);
  assert.equal(sessions[0].updatedAt, mtime.toISOString());
});

test('listClaudeSessions derives title from the first real user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'titled.jsonl');
  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: '2026-05-10T01:00:00.000Z',
        message: { role: 'user', content: 'Continue from where you left off.' },
      }),
      JSON.stringify({
        timestamp: '2026-05-10T01:00:01.000Z',
        message: { role: 'assistant', content: 'Working on it' },
      }),
      JSON.stringify({
        timestamp: '2026-05-10T01:00:02.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Build a readable session title from this request' }],
        },
      }),
    ].join('\n'),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, 'Build a readable session title from this request');
});

test('listClaudeSessions ignores browser context when deriving a title', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'context-title.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2026-05-10T01:00:00.000Z',
      message: {
        role: 'user',
        content:
          '<browser_context> windowId: 737273780 tabId: 737270850\n\nFix the session card overflow',
      },
    }),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, 'Fix the session card overflow');
});

test('listClaudeSessions ignores browser context blocks before the user request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'context-blocks-title.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2026-05-10T01:00:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<browser_context> windowId: 737273780 tabId: 737270850 url: https://www.baidu.com/',
          },
          { type: 'text', text: '分析下当前网页内容' },
        ],
      },
    }),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, '分析下当前网页内容');
});

test('listClaudeSessions ignores browser context marker variants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'context-variant-title.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2026-05-10T01:00:00.000Z',
      message: {
        role: 'user',
        content: ':browser_context> windowId: 737273780 tabId: 737270850\n\n111',
      },
    }),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, '111');
});

test('listClaudeSessions ignores instruction tags when deriving a title', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'instruction-title.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2026-05-10T01:00:00.000Z',
      message: {
        role: 'user',
        content:
          '<language_instruction>\nRespond in Chinese.\n</language_instruction>\n\nPlease make the theme dark',
      },
    }),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, 'Please make the theme dark');
});

test('listClaudeSessions derives title from the original user request tag only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, 'raw-user-request-title.jsonl');
  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: '2026-05-10T01:00:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '<browser_context>',
              'windowId: 737273154',
              '</browser_context>',
              '',
              '<language_instruction>',
              '请始终使用中文进行对话。',
              '</language_instruction>',
              '',
              '<用户原始请求>',
              '<interaction_policy>',
              '当前目标属于当前浏览器里的真实网页。',
              '</interaction_policy>',
              '',
              '<webmcp_browser_tool_instruction>',
              '当前请求来自浏览器 sidepanel。',
              '</webmcp_browser_tool_instruction>',
              '',
              '111111111',
              '</用户原始请求>',
            ].join('\n'),
          },
        ],
      },
    }),
    'utf8'
  );

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions[0].title, '111111111');
});

test('listClaudeSessions defaults to the 50 most recently modified sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-projects-'));
  const projectPath = '/tmp/demo-project';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectDir, { recursive: true });

  for (let index = 0; index < 55; index += 1) {
    const filePath = join(projectDir, `session-${String(index).padStart(2, '0')}.jsonl`);
    await writeFile(filePath, '{"message":{"role":"user","content":"ok"}}\n', 'utf8');
    const mtime = new Date(Date.UTC(2026, 4, 10, 8, index, 0));
    await utimes(filePath, mtime, mtime);
  }

  const sessions = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

  assert.equal(sessions.length, 50);
  assert.equal(sessions[0].sessionId, 'session-54');
  assert.equal(sessions.at(-1)?.sessionId, 'session-05');
});

test('listClaudeSessions reuses cached titles when file mtime is unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentbackendv2sessionscache'));
  const projectPath = join(root, 'workspace');
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  await mkdir(projectPath, { recursive: true });
  await mkdir(projectDir, { recursive: true });

  const filePath = join(projectDir, 'session-1.jsonl');
  const initialTime = new Date('2026-05-10T01:00:00.000Z');
  await writeFile(
    filePath,
    `${JSON.stringify({
      message: { role: 'user', content: [{ type: 'text', text: '初始标题' }] },
    })}\n`,
    'utf8'
  );
  await utimes(filePath, initialTime, initialTime);

  try {
    const firstRead = await listClaudeSessions({ projectPath, claudeProjectsDir: root });
    await writeFile(
      filePath,
      `${JSON.stringify({
        message: { role: 'user', content: [{ type: 'text', text: '新的标题' }] },
      })}\n`,
      'utf8'
    );
    await utimes(filePath, initialTime, initialTime);

    const secondRead = await listClaudeSessions({ projectPath, claudeProjectsDir: root });

    assert.equal(firstRead[0]?.title, '初始标题');
    assert.equal(secondRead[0]?.title, '初始标题');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fromClaudeProjectKey restores Windows drive paths on Windows', () => {
  if (process.platform !== 'win32') {
    return;
  }

  assert.equal(
    fromClaudeProjectKey('C--Users-Administrator-Desktop-mpcb'),
    'C:\\Users\\Administrator\\Desktop\\mpcb'
  );
});

test('listClaudeProjects skips projects whose working directory no longer exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentbackendv2projects'));
  const existingProjectPath = join(root, `existingproject${Date.now()}`);
  const missingProjectPath = join(root, `missingproject${Date.now()}`);

  const existingProjectDir = join(root, toClaudeProjectKey(existingProjectPath));
  const missingProjectDir = join(root, toClaudeProjectKey(missingProjectPath));
  await mkdir(existingProjectPath, { recursive: true });
  await mkdir(existingProjectDir, { recursive: true });
  await mkdir(missingProjectDir, { recursive: true });
  await writeFile(join(existingProjectDir, 'existing.jsonl'), '{}\n', 'utf8');
  await writeFile(join(missingProjectDir, 'missing.jsonl'), '{}\n', 'utf8');

  try {
    const projects = await listClaudeProjects({ claudeProjectsDir: root });

    assert.deepEqual(
      projects.map((project) => project.projectPath),
      [existingProjectPath]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listClaudeProjects reuses cached project metadata until forced refresh', async () => {
  clearClaudeProjectListCache();
  const root = await mkdtemp(join(tmpdir(), 'agentbackendv2projectcache'));
  const firstProjectPath = join(root, `firstproject${Date.now()}`);
  const secondProjectPath = join(root, `secondproject${Date.now()}`);

  const firstProjectDir = join(root, toClaudeProjectKey(firstProjectPath));
  const secondProjectDir = join(root, toClaudeProjectKey(secondProjectPath));
  await mkdir(firstProjectPath, { recursive: true });
  await mkdir(firstProjectDir, { recursive: true });
  await writeFile(join(firstProjectDir, 'first.jsonl'), '{}\n', 'utf8');

  try {
    const first = await listClaudeProjects({ claudeProjectsDir: root });
    assert.deepEqual(
      first.map((project) => project.projectPath),
      [firstProjectPath]
    );

    await mkdir(secondProjectPath, { recursive: true });
    await mkdir(secondProjectDir, { recursive: true });
    await writeFile(join(secondProjectDir, 'second.jsonl'), '{}\n', 'utf8');

    const cached = await listClaudeProjects({ claudeProjectsDir: root });
    assert.deepEqual(
      cached.map((project) => project.projectPath),
      [firstProjectPath]
    );

    const refreshed = await listClaudeProjects({ claudeProjectsDir: root, forceRefresh: true });
    assert.deepEqual(
      refreshed.map((project) => project.projectPath).sort(),
      [firstProjectPath, secondProjectPath].sort()
    );
  } finally {
    clearClaudeProjectListCache();
    await rm(root, { recursive: true, force: true });
  }
});
