import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { toClaudeProjectKey } from './claude-project-key.ts';
import { listClaudeSessions } from './session-list-reader.ts';

test('listClaudeSessions strips project workspace metadata from session titles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-list-reader-'));
  const projectPath = 'C:\\Users\\Administrator\\Desktop\\tst';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  const historyFile = join(projectDir, 'session-1.jsonl');

  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      historyFile,
      `${JSON.stringify({
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '<project_workspace>',
                '当前项目根目录：C:\\Users\\Administrator\\Desktop\\tst',
                '</project_workspace>',
                '',
                '<user_original_request>',
                '帮我创建一个 html 页面',
                '</user_original_request>',
              ].join('\n'),
            },
          ],
        },
      })}\n`,
      'utf8'
    );

    const sessions = await listClaudeSessions({
      projectPath,
      claudeProjectsDir: root,
    });

    assert.equal(sessions[0]?.title, '帮我创建一个 html 页面');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listClaudeSessions strips attachment metadata from session titles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-list-reader-'));
  const projectPath = 'C:\\Users\\Administrator\\Desktop\\tst';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  const historyFile = join(projectDir, 'session-2.jsonl');

  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      historyFile,
      `${JSON.stringify({
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '<attachments>',
                '- name=image.png | mimeType=image/png | kind=image',
                '</attachments>',
                '',
                '<user_original_request>',
                '请分析这张图片',
                '</user_original_request>',
              ].join('\n'),
            },
          ],
        },
      })}\n`,
      'utf8'
    );

    const sessions = await listClaudeSessions({
      projectPath,
      claudeProjectsDir: root,
    });

    const session = sessions.find((item) => item.sessionId === 'session-2');
    assert.equal(session?.title, '请分析这张图片');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listClaudeSessions strips explicit skill wrappers from session titles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-list-reader-'));
  const projectPath = 'C:\\Users\\Administrator\\Desktop\\tst';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  const historyFile = join(projectDir, 'session-3.jsonl');

  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      historyFile,
      `${JSON.stringify({
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '<webmcp_explicit_skill name="/ewankb-server-query">',
                '你必须优先遵循下面这个 skill，严格按其中要求执行：',
                '# /ewankb-server-query',
                '</webmcp_explicit_skill>',
                '',
                '<user_original_request>',
                '查询订单状态',
                '</user_original_request>',
              ].join('\n'),
            },
          ],
        },
      })}\n`,
      'utf8'
    );

    const sessions = await listClaudeSessions({
      projectPath,
      claudeProjectsDir: root,
    });

    const session = sessions.find((item) => item.sessionId === 'session-3');
    assert.equal(session?.title, '查询订单状态');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listClaudeSessions falls back to explicit skill name when no user request text exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-list-reader-'));
  const projectPath = 'C:\\Users\\Administrator\\Desktop\\tst';
  const projectDir = join(root, toClaudeProjectKey(projectPath));
  const historyFile = join(projectDir, 'session-4.jsonl');

  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      historyFile,
      `${JSON.stringify({
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '<webmcp_explicit_skill name="/ewankb-server-query">',
                '你必须优先遵循下面这个 skill，严格按其中要求执行：',
                '# /ewankb-server-query',
                '</webmcp_explicit_skill>',
              ].join('\n'),
            },
          ],
        },
      })}\n`,
      'utf8'
    );

    const sessions = await listClaudeSessions({
      projectPath,
      claudeProjectsDir: root,
    });

    const session = sessions.find((item) => item.sessionId === 'session-4');
    assert.equal(session?.title, '/ewankb-server-query');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
