import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import {
  createAgentV2Client,
  findRemovedUploadedSessionAttachments,
  normalizeRunAttachmentsForRequest,
} from '../../extension/entrypoints/sidepanel/lib/agent-v2/client.ts';
import { createAgentService } from './agent/application/agent-service.ts';
import { createAgentEvent } from './agent/domain/events.ts';
import { createApp } from './app.ts';
import { createFileService } from './files/file-service.ts';
import { HttpError } from './shared/errors.ts';
import type { SessionFileMetadata } from './session-files/session-file-service.ts';

async function listen(app: ReturnType<typeof createApp>) {
  const server = createServer(app.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    server,
    url: `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`,
  };
}

function createMockSessionFileMetadata(input?: Partial<SessionFileMetadata>): SessionFileMetadata {
  return {
    id: 'file-1',
    sessionFileId: 'file-1',
    name: 'diagram.png',
    mimeType: 'image/png',
    size: 5,
    kind: 'image',
    storage: 'session-temp',
    absolutePath: '/tmp/session-1/file-1.png',
    ...input,
  };
}

test('history route returns display messages', async () => {
  const requestedInputs: Array<{ sessionId: string; projectPath?: string }> = [];
  const app = createApp({
    agentService: {
      async listSessions() {
        return [{ sessionId: 'session-1' }];
      },
      async getSessionHistory(input: { sessionId: string; projectPath?: string }) {
        requestedInputs.push(input);
        const { sessionId } = input;
        return { sessionId, messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/sessions/session-1/history`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sessionId: 'session-1', messages: [] });
    const projectResponse = await fetch(
      `${url}/api/agent-v2/sessions/session-1/history?projectPath=${encodeURIComponent('/tmp/project-a')}`
    );
    assert.equal(projectResponse.status, 200);
    assert.deepEqual(requestedInputs, [
      { sessionId: 'session-1', projectPath: undefined },
      { sessionId: 'session-1', projectPath: '/tmp/project-a' },
    ]);
  } finally {
    server.close();
  }
});

test('sessions route returns Claude session summaries', async () => {
  const requestedProjectPaths: Array<string | undefined> = [];
  const app = createApp({
    agentService: {
      async listProjectSessions(input?: { projectPath?: string }) {
        requestedProjectPaths.push(input?.projectPath);
        return [{ sessionId: 'session-1', messageCount: 2 }];
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/sessions`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ sessionId: 'session-1', messageCount: 2 }]);
    const projectResponse = await fetch(
      `${url}/api/agent-v2/sessions?projectPath=${encodeURIComponent('/tmp/project-a')}`
    );
    assert.equal(projectResponse.status, 200);
    assert.deepEqual(requestedProjectPaths, [undefined, '/tmp/project-a']);
  } finally {
    server.close();
  }
});

test('accr sync route is registered in createApp', async () => {
  const runCalls: Array<{ mode: 'remote' | 'local-debug' }> = [];
  const cacheInvalidations: string[] = [];
  let commandInvalidationCount = 0;
  const app = createApp({
    agentService: {
      async listProjectSessions() {
        return [];
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    commandsService: {
      async listCommands() {
        return { localUi: [], project: [], user: [], plugin: [], skills: [], count: 0 };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'ok' };
      },
      invalidateCache() {
        commandInvalidationCount += 1;
      },
    },
    accrSyncService: {
      async run(input: { mode: 'remote' | 'local-debug' }) {
        runCalls.push(input);
        return {
          ok: true,
          status: 'completed' as const,
          mode: input.mode,
          stdout: '',
          stderr: '',
        };
      },
    },
    capabilityCatalogService: {
      clearCapabilityCatalogCache(input?: { type?: string }) {
        cacheInvalidations.push(input?.type ?? 'all');
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/accr-sync/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'remote', force: true, trigger: 'extension-action-click' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: 'completed',
      mode: 'remote',
      stdout: '',
      stderr: '',
    });
    assert.deepEqual(runCalls, [{ mode: 'remote', force: true }]);
    assert.deepEqual(cacheInvalidations, ['skill']);
    assert.equal(commandInvalidationCount, 1);
  } finally {
    server.close();
  }
});

test('streaming session errors do not crash the server after SSE has started', async () => {
  const app = createApp({
    agentService: {
      async startSessionRun() {
        return Object.assign(
          (async function* () {
            yield createAgentEvent({
              runId: 'run-1',
              sessionId: null,
              sequence: 1,
              type: 'run.started',
              payload: {},
            });
            throw new Error('No tab with id: 0.');
          })(),
          { runId: 'run-1', sessionId: null }
        );
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const streamResponse = await fetch(`${url}/api/agent-v2/sessions`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hello' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const streamBody = await streamResponse.text();
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get('content-type') || '', /text\/event-stream/);
    assert.match(streamBody, /"type":"run.started"/);

    const followUpResponse = await fetch(
      `${url}/api/files/tree?projectPath=${encodeURIComponent('/tmp/project-a')}`
    );
    assert.equal(followUpResponse.status, 200);
    assert.deepEqual(await followUpResponse.json(), { entries: [] });
  } finally {
    server.close();
  }
});

test('interaction resolve route forwards nextPermissionMode to agent service', async () => {
  const decisions: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async resolveInteraction(input: {
        runId: string;
        requestId: string;
        decision: Record<string, unknown>;
      }) {
        decisions.push({
          runId: input.runId,
          requestId: input.requestId,
          decision: input.decision,
        });
        return { resolved: true as const };
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/runs/run-1/interactions/request-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allow: true,
        nextPermissionMode: 'acceptEdits',
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { resolved: true });
    assert.deepEqual(decisions, [
      {
        runId: 'run-1',
        requestId: 'request-1',
        decision: {
          allow: true,
          message: undefined,
          updatedInput: undefined,
          answers: undefined,
          nextPermissionMode: 'acceptEdits',
          clearContext: undefined,
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('interaction resolve route forwards clearContext to agent service', async () => {
  const decisions: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async resolveInteraction(input: {
        runId: string;
        requestId: string;
        decision: Record<string, unknown>;
      }) {
        decisions.push({
          runId: input.runId,
          requestId: input.requestId,
          decision: input.decision,
        });
        return { resolved: true as const };
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/runs/run-1/interactions/request-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allow: true,
        nextPermissionMode: 'acceptEdits',
        clearContext: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { resolved: true });
    assert.deepEqual(decisions, [
      {
        runId: 'run-1',
        requestId: 'request-1',
        decision: {
          allow: true,
          message: undefined,
          updatedInput: undefined,
          answers: undefined,
          nextPermissionMode: 'acceptEdits',
          clearContext: true,
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('session run route forwards attachments metadata to agent service', async () => {
  const runInputs: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async startSessionRun(input: Record<string, unknown>) {
        runInputs.push(input);
        return Object.assign((async function* () {})(), {
          runId: 'run-1',
          sessionId: null,
        });
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请分析这些附件',
        attachments: [
          {
            id: 'file-image-1',
            sessionFileId: 'file-image-1',
            name: 'diagram.png',
            mimeType: 'image/png',
            size: 5,
            kind: 'image',
            storage: 'session-temp',
            data: 'aGVsbG8=',
          },
          {
            id: 'file-doc-1',
            sessionFileId: 'file-doc-1',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            size: 42,
            kind: 'document',
            storage: 'session-temp',
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(runInputs.length, 1);
    assert.deepEqual(runInputs[0]?.attachments, [
      {
        id: 'file-image-1',
        sessionFileId: 'file-image-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
        storage: 'session-temp',
        data: 'aGVsbG8=',
      },
      {
        id: 'file-doc-1',
        sessionFileId: 'file-doc-1',
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        size: 42,
        kind: 'document',
        storage: 'session-temp',
      },
    ]);
  } finally {
    server.close();
  }
});

test('session run route keeps legacy images payload compatible by normalizing to attachments', async () => {
  const runInputs: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async startSessionRun(input: Record<string, unknown>) {
        runInputs.push(input);
        return Object.assign((async function* () {})(), {
          runId: 'run-1',
          sessionId: null,
        });
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'describe image',
        images: [{ name: 'legacy.png', mimeType: 'image/png', data: 'abc123' }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(runInputs.length, 1);
    assert.deepEqual(runInputs[0]?.attachments, [
      {
        id: 'legacy-image-1',
        sessionFileId: 'legacy-image-1',
        name: 'legacy.png',
        mimeType: 'image/png',
        size: 6,
        kind: 'image',
        storage: 'inline',
        data: 'abc123',
      },
    ]);
  } finally {
    server.close();
  }
});

test('continue session run route forwards attachments metadata and absolutePath to agent service', async () => {
  const runInputs: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async continueSessionRun(input: Record<string, unknown>) {
        runInputs.push(input);
        return Object.assign((async function* () {})(), {
          runId: 'run-1',
          sessionId: 'session-1',
        });
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/sessions/session-1/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '继续分析附件',
        attachments: [
          {
            id: 'file-doc-1',
            sessionFileId: 'file-doc-1',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            size: 42,
            kind: 'document',
            storage: 'session-temp',
            absolutePath: '/tmp/session-1/spec.pdf',
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(runInputs.length, 1);
    assert.deepEqual(runInputs[0]?.attachments, [
      {
        id: 'file-doc-1',
        sessionFileId: 'file-doc-1',
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        size: 42,
        kind: 'document',
        storage: 'session-temp',
        absolutePath: '/tmp/session-1/spec.pdf',
      },
    ]);
  } finally {
    server.close();
  }
});

test('projects route returns Claude project summaries', async () => {
  const app = createApp({
    agentService: {
      async listProjects() {
        return [{ projectPath: '/tmp/project-a', name: 'project-a', sessionCount: 3 }];
      },
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/projects`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      { projectPath: '/tmp/project-a', name: 'project-a', sessionCount: 3 },
    ]);
  } finally {
    server.close();
  }
});

test('agent service sends image blocks and attachment metadata into runtime prompt', async () => {
  const queryInputs: Array<{ prompt: unknown }> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '请处理附件',
    attachments: [
      {
        id: 'image-1',
        sessionFileId: 'image-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
        storage: 'session-temp',
        data: 'abc123',
      },
      {
        id: 'doc-1',
        sessionFileId: 'doc-1',
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        size: 42,
        kind: 'document',
        storage: 'session-temp',
      },
    ],
  });
  for await (const _event of stream) {
    // Drain stream.
  }

  const prompt = queryInputs[0]?.prompt;
  assert.equal(typeof prompt, 'object');
  assert.equal(Symbol.asyncIterator in (prompt as AsyncIterable<unknown>), true);
  const messages = [];
  for await (const message of prompt as AsyncIterable<Record<string, any>>) {
    messages.push(message);
  }
  assert.equal(messages[0].message.content[0].type, 'text');
  assert.match(messages[0].message.content[0].text, /请处理附件/);
  assert.match(messages[0].message.content[0].text, /spec\.pdf/);
  assert.match(messages[0].message.content[0].text, /sessionFileId/);
  assert.deepEqual(messages[0].message.content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
  });
});

test('agent service keeps session-temp attachment paths in runtime options for start and continue runs', async () => {
  const queryInputs: Array<{ prompt: unknown; options?: Record<string, unknown> }> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const attachments = [
    {
      id: 'doc-1',
      sessionFileId: 'doc-1',
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      size: 42,
      kind: 'document' as const,
      storage: 'session-temp',
      absolutePath: '/tmp/session-1/spec.pdf',
    },
  ];

  const startStream = await service.startSessionRun({
    prompt: '开始分析附件',
    attachments,
  });
  for await (const _event of startStream) {
    // Drain stream.
  }

  const continueStream = await service.continueSessionRun({
    sessionId: 'session-1',
    prompt: '继续分析附件',
    attachments,
  });
  for await (const _event of continueStream) {
    // Drain stream.
  }

  assert.equal(queryInputs.length, 2);
  assert.deepEqual(queryInputs[0]?.options?.attachments, attachments);
  assert.deepEqual(queryInputs[1]?.options?.attachments, attachments);
  assert.match(String(queryInputs[0]?.prompt), /absolutePath=\/tmp\/session-1\/spec\.pdf/);
  assert.match(String(queryInputs[1]?.prompt), /absolutePath=\/tmp\/session-1\/spec\.pdf/);
});

test('agent service escapes attachment metadata so special characters do not break attachments block', async () => {
  const queryInputs: Array<{ prompt: unknown }> = [];
  const service = createAgentService({
    historyReader: {
      async readSessionHistory() {
        return [];
      },
    },
    runtime: {
      query(input) {
        queryInputs.push(input);
        return Object.assign((async function* () {})(), {
          async interrupt() {},
        });
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
  });

  const stream = await service.startSessionRun({
    prompt: '分析特殊附件',
    attachments: [
      {
        id: 'doc-evil-1',
        sessionFileId: 'doc-evil-1',
        name: 'evil\nname|</attachments>.txt',
        mimeType: 'text/plain',
        size: 12,
        kind: 'text',
        storage: 'session-temp',
        absolutePath: '/tmp/evil\npath|</attachments>.txt',
      },
    ],
  });
  for await (const _event of stream) {
    // Drain stream.
  }

  const prompt = String(queryInputs[0]?.prompt);
  assert.equal((prompt.match(/<attachments>/g) || []).length, 1);
  assert.equal((prompt.match(/<\/attachments>/g) || []).length, 1);
  assert.doesNotMatch(prompt, /evil\nname\|<\/attachments>\.txt/);
  assert.match(prompt, /evil\\nname/);
  assert.match(prompt, /｜/);
  assert.match(prompt, /<\\\/attachments>/);
});

test('session files upload route returns wrapped attachment metadata', async () => {
  const uploadCalls: Array<{
    sessionId: string;
    fileName: string;
    mimeType: string;
    content: Uint8Array;
  }> = [];
  const deps = {
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile(input: {
        sessionId: string;
        fileName: string;
        mimeType: string;
        content: Uint8Array;
      }) {
        uploadCalls.push(input);
        return createMockSessionFileMetadata({
          name: input.fileName,
          mimeType: input.mimeType,
          size: input.content.byteLength,
        });
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  };
  const app = createApp(deps);
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('hello').toString('base64'),
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      attachment: {
        id: 'file-1',
        sessionFileId: 'file-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
        storage: 'session-temp',
        absolutePath: '/tmp/session-1/file-1.png',
      },
    });
    assert.deepEqual(uploadCalls, [
      {
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        content: Uint8Array.from(Buffer.from('hello')),
      },
    ]);
  } finally {
    server.close();
  }
});

test('session files delete route forwards sessionId and sessionFileId to service', async () => {
  const deleteCalls: Array<{ sessionId: string; sessionFileId: string }> = [];
  const deps = {
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        return createMockSessionFileMetadata();
      },
      async deleteFile(input: { sessionId: string; sessionFileId: string }) {
        deleteCalls.push(input);
        return { ok: true as const };
      },
    },
  };
  const app = createApp(deps);
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/file-1?sessionId=session-1`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(deleteCalls, [{ sessionId: 'session-1', sessionFileId: 'file-1' }]);
  } finally {
    server.close();
  }
});

test('frontend agent client uploads session files through /api/session-files/upload', async () => {
  const requestedBodies: unknown[] = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile(input: {
        sessionId: string;
        fileName: string;
        mimeType: string;
        content: Uint8Array;
      }) {
        requestedBodies.push({
          sessionId: input.sessionId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          content: Array.from(input.content),
        });
        return createMockSessionFileMetadata({
          name: input.fileName,
          mimeType: input.mimeType,
          size: input.content.byteLength,
        });
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const client = createAgentV2Client({
      baseUrl: url,
      endpoint: '/api/agent-v2',
    });

    const attachment = await client.uploadSessionFile({
      sessionId: 'session-temp-1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('hello').toString('base64'),
    });

    assert.deepEqual(attachment, {
      id: 'file-1',
      sessionFileId: 'file-1',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 5,
      kind: 'image',
      storage: 'session-temp',
      absolutePath: '/tmp/session-1/file-1.png',
    });
    assert.deepEqual(requestedBodies, [
      {
        sessionId: 'session-temp-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        content: Array.from(Buffer.from('hello')),
      },
    ]);
  } finally {
    server.close();
  }
});

test('frontend agent client deletes session files through /api/session-files/:sessionFileId', async () => {
  const deleteCalls: Array<{ sessionId: string; sessionFileId: string }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        return createMockSessionFileMetadata();
      },
      async deleteFile(input: { sessionId: string; sessionFileId: string }) {
        deleteCalls.push(input);
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const client = createAgentV2Client({
      baseUrl: url,
      endpoint: '/api/agent-v2',
    });

    await client.deleteSessionFile({
      sessionId: 'session-temp-1',
      sessionFileId: 'file-1',
    });

    assert.deepEqual(deleteCalls, [
      {
        sessionId: 'session-temp-1',
        sessionFileId: 'file-1',
      },
    ]);
  } finally {
    server.close();
  }
});

test('frontend attachment request normalization strips local preview-only fields', () => {
  const attachments = normalizeRunAttachmentsForRequest({
    attachments: [
      {
        id: 'file-1',
        sessionFileId: 'file-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
        storage: 'session-temp',
        absolutePath: '/tmp/session-temp-1/file-1.png',
        previewUrl: 'blob:preview-1',
      },
    ],
  });

  assert.deepEqual(attachments, [
    {
      id: 'file-1',
      sessionFileId: 'file-1',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 5,
      kind: 'image',
      storage: 'session-temp',
      absolutePath: '/tmp/session-temp-1/file-1.png',
      previewUrl: 'blob:preview-1',
    },
  ]);
});

test('frontend helper only marks removed uploaded session-temp attachments for deletion', () => {
  const removed = findRemovedUploadedSessionAttachments(
    [
      {
        id: 'file-1',
        sessionFileId: 'file-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
        storage: 'session-temp',
        absolutePath: '/tmp/session-temp-1/file-1.png',
      },
      {
        id: 'inline-1',
        sessionFileId: 'inline-1',
        name: 'clipboard.png',
        mimeType: 'image/png',
        size: 3,
        kind: 'image',
        storage: 'inline',
        data: 'ZmFrZQ==',
      },
    ],
    [
      {
        id: 'inline-1',
        sessionFileId: 'inline-1',
        name: 'clipboard.png',
        mimeType: 'image/png',
        size: 3,
        kind: 'image',
        storage: 'inline',
        data: 'ZmFrZQ==',
      },
    ]
  );

  assert.deepEqual(removed, [
    {
      id: 'file-1',
      sessionFileId: 'file-1',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 5,
      kind: 'image',
      storage: 'session-temp',
      absolutePath: '/tmp/session-temp-1/file-1.png',
    },
  ]);
});

test('session files upload route returns 404 without session file service wiring', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('hello').toString('base64'),
      }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  } finally {
    server.close();
  }
});

test('session files delete route returns 404 without session file service wiring', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/file-1?sessionId=session-1`, {
      method: 'DELETE',
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  } finally {
    server.close();
  }
});

test('session files upload route returns controlled 400 on invalid JSON', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        return createMockSessionFileMetadata();
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"sessionId":',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid session file upload request body',
      code: 'invalid_session_file_upload_request',
    });
  } finally {
    server.close();
  }
});

test('session files upload route returns controlled 4xx on invalid base64', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        return createMockSessionFileMetadata();
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: '%%%not-base64%%%',
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Session file upload dataBase64 is invalid',
      code: 'session_file_upload_data_base64_invalid',
    });
  } finally {
    server.close();
  }
});

test('session files upload route returns controlled 4xx on missing fields or wrong types', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        return createMockSessionFileMetadata();
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    for (const body of [
      {
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('hi').toString('base64'),
      },
      {
        sessionId: 123,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('hi').toString('base64'),
      },
      {
        sessionId: 'session-1',
        fileName: ['diagram.png'],
        mimeType: 'image/png',
        dataBase64: Buffer.from('hi').toString('base64'),
      },
      {
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: {},
        dataBase64: Buffer.from('hi').toString('base64'),
      },
      { sessionId: 'session-1', fileName: 'diagram.png', mimeType: 'image/png', dataBase64: 123 },
    ]) {
      const response = await fetch(`${url}/api/session-files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Invalid session file upload request body',
        code: 'invalid_session_file_upload_request',
      });
    }
  } finally {
    server.close();
  }
});

test('session files upload route forwards HttpError from service', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    sessionFileService: {
      async saveUploadedFile() {
        throw new HttpError(
          415,
          'Unsupported file type: diagram.png (image/png)',
          'session_file_type_unsupported'
        );
      },
      async deleteFile() {
        return { ok: true as const };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/session-files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('hello').toString('base64'),
      }),
    });

    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      error: 'Unsupported file type: diagram.png (image/png)',
      code: 'session_file_type_unsupported',
    });
  } finally {
    server.close();
  }
});

test('runtime capabilities route is not exposed without service wiring', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/runtime-capabilities`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  } finally {
    server.close();
  }
});

test('page code analysis resolve route returns page graph context', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
        pathname: '/index.html',
        hashRoute: '/distribute/receipt-mngt/list',
        pageTextSummary: ['回单管理', '监控'],
        apiCandidates: ['/api-tms/receipt/queryList'],
        pageCodebaseMappingConfig: {
          rules: [
            {
              id: 'otp-receipt',
              businessId: 'otp',
              pageLabel: '回单管理',
              triggerSkill: '/ewankb-server-query',
              ewankbKb: 'otp',
              ewankbMode: 'graph',
              enabled: true,
              hostIncludes: ['an-uat.annto.com'],
              hashRouteIncludes: ['/distribute/receipt-mngt'],
              pageTextIncludes: ['回单管理', '监控'],
              apiPrefixes: ['/api-tms/receipt/'],
              frontendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-otp-pc',
                'Users-zhanglt21-Desktop-codebase-otp-pc2',
              ],
              backendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-t-tms',
                'Users-zhanglt21-Desktop-codebase-logistics-otp',
              ],
              sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      matched: true,
      matchedRuleId: 'otp-receipt',
      businessId: 'otp',
      pageLabel: '回单管理',
      triggerSkill: '/ewankb-server-query',
      ewankbKb: 'otp',
      ewankbMode: 'graph',
      url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
      pathname: '/index.html',
      hashRoute: '/distribute/receipt-mngt/list',
      pageTextSummary: ['回单管理', '监控'],
      apiCandidates: ['/api-tms/receipt/queryList'],
      resourceHints: [],
      frontendGraphProjects: [
        'Users-zhanglt21-Desktop-codebase-otp-pc',
        'Users-zhanglt21-Desktop-codebase-otp-pc2',
      ],
      backendGraphProjects: [
        'Users-zhanglt21-Desktop-codebase-t-tms',
        'Users-zhanglt21-Desktop-codebase-logistics-otp',
      ],
      sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
    });
  } finally {
    server.close();
  }
});

test('page code analysis resolve route returns unmatched page graph context when no rule hits', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/#/unknown/page',
        pathname: '/unknown',
        hashRoute: '/unknown/page',
        pageTextSummary: ['首页', '概览'],
        apiCandidates: ['/api/health'],
        resourceHints: ['logo.png'],
        pageCodebaseMappingConfig: {
          rules: [
            {
              id: 'otp-receipt',
              businessId: 'otp',
              pageLabel: '回单管理',
              triggerSkill: '/ewankb-server-query',
              ewankbKb: 'otp',
              ewankbMode: 'graph',
              enabled: true,
              hostIncludes: ['an-uat.annto.com'],
              hashRouteIncludes: ['/distribute/receipt-mngt'],
              pageTextIncludes: ['回单管理', '监控'],
              apiPrefixes: ['/api-tms/receipt/'],
              frontendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-otp-pc',
                'Users-zhanglt21-Desktop-codebase-otp-pc2',
              ],
              backendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-t-tms',
                'Users-zhanglt21-Desktop-codebase-logistics-otp',
              ],
              sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      matched: false,
      matchedRuleId: null,
      businessId: null,
      pageLabel: null,
      triggerSkill: null,
      ewankbKb: null,
      ewankbMode: null,
      url: 'https://example.com/#/unknown/page',
      pathname: '/unknown',
      hashRoute: '/unknown/page',
      pageTextSummary: ['首页', '概览'],
      apiCandidates: ['/api/health'],
      resourceHints: ['logo.png'],
      frontendGraphProjects: [],
      backendGraphProjects: [],
      sharedGraphProjects: [],
    });
  } finally {
    server.close();
  }
});

test('page code analysis dom attribution route returns attribution result', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-attribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          targetElement: {
            selector: '[data-testid="target"]',
            xpath: '//*[@data-testid="target"]',
            tagName: 'BUTTON',
            text: '订单详情',
            outerHTMLSnippet: '<button>订单详情</button>',
            classList: ['primary-action'],
            dataAttributes: {},
          },
          pageContext: {
            url: 'https://example.com/orders/detail?id=1',
            pathname: '/orders/detail',
            hashRoute: '/orders/detail',
            title: '订单详情',
            pageTextSummary: ['订单详情', '订单', '详情'],
            apiCandidates: ['/api/orders/detail?id=1'],
            resourceHints: ['orders.chunk.js'],
          },
          networkEvidence: [
            {
              requestId: 'req-1',
              url: 'https://api.example.com/api/orders/detail?id=1',
              method: 'GET',
              status: 200,
              resourceType: 'xhr',
              startedAt: 1,
              finishedAt: 2,
              initiatorHint: 'orders-detail-page',
              responsePreview: '订单详情 Alice',
            },
          ],
          interactionEvidence: [],
          runtimeEvidence: {
            scriptUrls: ['https://cdn.example.com/orders.chunk.js'],
            chunkHints: ['orders.chunk.js'],
            sourceMapHints: [],
          },
          captureSessionMeta: {
            sessionId: 'session-1',
            tabId: 1,
            capturedAt: 100,
            mode: 'interactive',
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      bestApi: '/api/orders/detail',
      candidateApis: [
        {
          api: '/api/orders/detail',
          score: 20,
          evidence: [
            'api-candidate',
            'network-request',
            'response-preview',
            'element-text',
            'page-summary',
          ],
        },
      ],
      confidence: 'high',
      needsMoreEvidence: false,
      recommendedAction: 'inspect-best-api',
    });
  } finally {
    server.close();
  }
});

test('page code analysis dom attribution route returns controlled 400 on invalid page evidence', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-attribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          pageContext: {
            url: 'https://example.com/orders/detail?id=1',
          },
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid DOM attribution request body',
      code: 'invalid_dom_attribution_request',
    });
  } finally {
    server.close();
  }
});

test('page code analysis dom locate route returns code location result', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          targetElement: {
            selector: '[data-testid="target"]',
            xpath: '//*[@data-testid="target"]',
            tagName: 'BUTTON',
            text: '回单管理',
            outerHTMLSnippet: '<button>回单管理</button>',
            classList: ['primary-action'],
            dataAttributes: {},
          },
          pageContext: {
            url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
            pathname: '/index.html',
            hashRoute: '/distribute/receipt-mngt/list',
            title: '回单管理',
            pageTextSummary: ['回单管理', '监控'],
            apiCandidates: ['/api-tms/receipt/queryList'],
            resourceHints: ['receipt-list.chunk.js'],
          },
          networkEvidence: [],
          interactionEvidence: [],
          runtimeEvidence: {
            scriptUrls: ['https://cdn.example.com/receipt-list.chunk.js'],
            chunkHints: ['receipt-list.chunk.js'],
            sourceMapHints: [],
          },
          captureSessionMeta: {
            sessionId: 'session-1',
            tabId: 1,
            capturedAt: 100,
            mode: 'interactive',
          },
        },
        attribution: {
          bestApi: '/api-tms/receipt/queryList',
          candidateApis: [
            {
              api: '/api-tms/receipt/queryList',
              score: 20,
              evidence: ['api-candidate', 'network-request'],
            },
          ],
          confidence: 'high',
          needsMoreEvidence: false,
          recommendedAction: 'inspect-best-api',
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      routeContext: {
        matched: true,
        matchedRuleId: 'otp-receipt',
        businessId: 'otp',
        pageLabel: '回单管理',
        triggerSkill: '/ewankb-server-query',
        ewankbKb: 'otp',
        ewankbMode: 'graph',
        url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
        pathname: '/index.html',
        hashRoute: '/distribute/receipt-mngt/list',
        pageTextSummary: ['回单管理', '监控'],
        apiCandidates: ['/api-tms/receipt/queryList'],
        resourceHints: ['receipt-list.chunk.js'],
        frontendGraphProjects: [
          'Users-zhanglt21-Desktop-codebase-otp-pc',
          'Users-zhanglt21-Desktop-codebase-otp-pc2',
        ],
        backendGraphProjects: [
          'Users-zhanglt21-Desktop-codebase-t-tms',
          'Users-zhanglt21-Desktop-codebase-logistics-otp',
        ],
        sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
      },
      frontend: {
        graphProjects: [
          'Users-zhanglt21-Desktop-codebase-otp-pc',
          'Users-zhanglt21-Desktop-codebase-otp-pc2',
        ],
        searchTerms: [
          '/distribute/receipt-mngt/list',
          '/index.html',
          '回单管理',
          '监控',
          'receipt-list.chunk.js',
          '/api-tms/receipt/queryList',
        ],
      },
      backend: {
        graphProjects: [
          'Users-zhanglt21-Desktop-codebase-t-tms',
          'Users-zhanglt21-Desktop-codebase-logistics-otp',
        ],
        searchTerms: [
          '/api-tms/receipt/queryList',
          '/distribute/receipt-mngt/list',
          '/index.html',
          '回单管理',
          '监控',
        ],
      },
      shared: {
        graphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
        searchTerms: ['receipt-list.chunk.js', '/api-tms/receipt/queryList', '回单管理', '监控'],
      },
      attribution: {
        bestApi: '/api-tms/receipt/queryList',
        candidateApis: [
          {
            api: '/api-tms/receipt/queryList',
            score: 20,
            evidence: ['api-candidate', 'network-request'],
          },
        ],
        confidence: 'high',
        needsMoreEvidence: false,
        recommendedAction: 'inspect-best-api',
      },
    });
  } finally {
    server.close();
  }
});

test('page code analysis resolve route returns controlled 400 on invalid mapping config', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
        pageCodebaseMappingConfig: {
          rules: [
            {
              id: 'otp-receipt',
              enabled: true,
              hostIncludes: [123],
              frontendGraphProjects: ['Users-zhanglt21-Desktop-codebase-otp-pc'],
              backendGraphProjects: ['Users-zhanglt21-Desktop-codebase-t-tms'],
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid page code analysis mapping config',
      code: 'invalid_page_code_analysis_mapping_config',
    });
  } finally {
    server.close();
  }
});

test('page code analysis dom analyze route returns unified analysis result', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          targetElement: {
            selector: '[data-testid="target"]',
            xpath: '//*[@data-testid="target"]',
            tagName: 'BUTTON',
            text: '搜索',
            outerHTMLSnippet: '<button>搜索</button>',
            classList: ['primary-action'],
            dataAttributes: {},
          },
          pageContext: {
            url: 'https://gls-uat.annto.com/#/entrustedOrderModule/expressInquiry',
            pathname: '/index.html',
            hashRoute: '/entrustedOrderModule/expressInquiry',
            title: '快递询价',
            pageTextSummary: [
              '快递询价',
              '搜索',
              '供应商简称',
              '价目表名称',
              '起始国/地区',
              '目的地',
              '服务类型',
            ],
            apiCandidates: ['/api-miloms/guarantee/expressCostPrice/summarySearch'],
            resourceHints: ['express-inquiry.chunk.js'],
          },
          networkEvidence: [
            {
              requestId: 'req-1',
              url: 'https://api.example.com/api-miloms/guarantee/expressCostPrice/summarySearch?page=1',
              method: 'GET',
              status: 200,
              resourceType: 'xhr',
              startedAt: 1,
              finishedAt: 2,
              initiatorHint: 'express-inquiry-page',
              responsePreview: '快递询价 列表查询',
            },
          ],
          interactionEvidence: [],
          runtimeEvidence: {
            scriptUrls: ['https://cdn.example.com/express-inquiry.chunk.js'],
            chunkHints: ['express-inquiry.chunk.js'],
            sourceMapHints: [],
          },
          captureSessionMeta: {
            sessionId: 'session-1',
            tabId: 1,
            capturedAt: 100,
            mode: 'interactive',
          },
        },
        pageCodebaseMappingConfig: {
          rules: [
            {
              id: 'gls-express-inquiry',
              businessId: 'gls',
              pageLabel: '快递询价',
              triggerSkill: '/ewankb-server-query',
              ewankbKb: 'gls',
              ewankbMode: 'graph',
              enabled: true,
              hostIncludes: ['gls-uat.annto.com'],
              hashRouteIncludes: ['/entrustedOrderModule/expressInquiry'],
              pageTextIncludes: ['快递询价', '供应商简称'],
              apiPrefixes: ['/api-miloms/guarantee/expressCostPrice/'],
              frontendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-otp-pc',
                'Users-zhanglt21-Desktop-codebase-otp-pc2',
              ],
              backendGraphProjects: [
                'Users-zhanglt21-Desktop-codebase-t-tms',
                'Users-zhanglt21-Desktop-codebase-logistics-otp',
              ],
              sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      page: {
        title: string;
        url: string;
        pathname: string;
        hashRoute: string;
      };
      targetElement: {
        tagName: string;
        text: string;
        selector: string;
        xpath: string;
      };
      attribution: {
        bestApi: string | null;
      };
      evidence: {
        kbCandidate: string | null;
        featureNameCandidates: string[];
        actionTerms: string[];
        apiTerms: string[];
        fieldTerms: string[];
      };
      analysisCard: {
        pageName: string | null;
        route: string | null;
        targetAction: string | null;
        actionType: string | null;
        tableHeaders: string[];
        recommendedApi: string | null;
        confidence: 'low' | 'medium' | 'high';
      };
      suggestedCommand: string | null;
      chatSummary: {
        markdown: string;
      };
    };
    assert.deepEqual(result.page, {
      title: '快递询价',
      url: 'https://gls-uat.annto.com/#/entrustedOrderModule/expressInquiry',
      pathname: '/index.html',
      hashRoute: '/entrustedOrderModule/expressInquiry',
    });
    assert.deepEqual(result.targetElement, {
      tagName: 'BUTTON',
      text: '搜索',
      selector: '[data-testid="target"]',
      xpath: '//*[@data-testid="target"]',
    });
    assert.equal(result.attribution.bestApi, '/api-miloms/guarantee/expressCostPrice/summarySearch');
    assert.deepEqual(result.evidence, {
      kbCandidate: 'gls',
      featureNameCandidates: [
        '快递询价',
        '搜索',
        '供应商简称',
        '价目表名称',
        '起始国/地区',
        '目的地',
        '服务类型',
      ],
      actionTerms: ['搜索', '列表查询'],
      apiTerms: ['expressCostPrice', 'summarySearch'],
      fieldTerms: ['供应商简称', '目的地', '服务类型'],
    });
    assert.deepEqual(result.analysisCard, {
      pageName: '快递询价',
      route: '#/entrustedOrderModule/expressInquiry',
      targetAction: '点击「搜索」',
      actionType: '列表查询',
      tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
      recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
      confidence: 'medium',
    });
    assert.equal(
      result.suggestedCommand,
      '/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'
    );
    assert.match(result.chatSummary.markdown, /^# 页面元素接口联分析/m);
    assert.match(result.chatSummary.markdown, /快递询价/);
    assert.match(result.chatSummary.markdown, /\/api-miloms\/guarantee\/expressCostPrice\/summarySearch/);
    assert.match(result.chatSummary.markdown, /express-inquiry\.chunk\.js/);
    assert.match(result.chatSummary.markdown, /代码来源判断与知识库查询已改由独立 skill 处理/);
    assert.doesNotMatch(result.chatSummary.markdown, /建议知识库|建议查询模式|匹配规则/);
    assert.doesNotMatch(result.chatSummary.markdown, /ewankb-server-query graph gls/);
  } finally {
    server.close();
  }
});

test('page code analysis dom analyze route returns controlled 400 on invalid page evidence', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          pageContext: {
            url: 'https://example.com/orders/detail?id=1',
          },
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid DOM analyze request body',
      code: 'invalid_dom_analyze_request',
    });
  } finally {
    server.close();
  }
});

test('page code analysis dom analyze route returns low-confidence structure without kb candidate', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          targetElement: {
            selector: '[data-testid="target"]',
            xpath: '//*[@data-testid="target"]',
            tagName: 'DIV',
            text: null,
            outerHTMLSnippet: '<div></div>',
            classList: [],
            dataAttributes: {},
          },
          pageContext: {
            url: 'https://example.com/#/unknown',
            pathname: '/index.html',
            hashRoute: '/unknown',
            title: '',
            pageTextSummary: [],
            apiCandidates: [],
            resourceHints: [],
          },
          networkEvidence: [],
          interactionEvidence: [],
          runtimeEvidence: {
            scriptUrls: [],
            chunkHints: [],
            sourceMapHints: [],
          },
          captureSessionMeta: {
            sessionId: 'session-2',
            tabId: 2,
            capturedAt: 100,
            mode: 'interactive',
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      evidence: {
        kbCandidate: string | null;
        featureNameCandidates: string[];
        actionTerms: string[];
        apiTerms: string[];
        fieldTerms: string[];
      };
      analysisCard: {
        confidence: 'low' | 'medium' | 'high';
        targetAction: string | null;
      };
      suggestedCommand: string | null;
    };

    assert.deepEqual(result.evidence, {
      kbCandidate: null,
      featureNameCandidates: [],
      actionTerms: [],
      apiTerms: [],
      fieldTerms: [],
    });
    assert.deepEqual(result.analysisCard, {
      pageName: null,
      route: '#/unknown',
      targetAction: null,
      actionType: null,
      tableHeaders: [],
      recommendedApi: null,
      confidence: 'low',
    });
    assert.equal(result.suggestedCommand, null);
  } finally {
    server.close();
  }
});

test('page code analysis dom analyze route builds suggested command from ewankb kb mode', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageEvidence: {
          targetElement: {
            selector: '[data-testid="target"]',
            xpath: '//*[@data-testid="target"]',
            tagName: 'BUTTON',
            text: '搜索',
            outerHTMLSnippet: '<button>搜索</button>',
            classList: ['primary-action'],
            dataAttributes: {},
          },
          pageContext: {
            url: 'https://gls-uat.annto.com/#/entrustedOrderModule/expressInquiry',
            pathname: '/index.html',
            hashRoute: '/entrustedOrderModule/expressInquiry',
            title: '快递询价',
            pageTextSummary: ['快递询价', '搜索', '供应商简称', '目的地'],
            apiCandidates: ['/api-miloms/guarantee/expressCostPrice/summarySearch'],
            resourceHints: [],
          },
          networkEvidence: [],
          interactionEvidence: [],
          runtimeEvidence: {
            scriptUrls: [],
            chunkHints: [],
            sourceMapHints: [],
          },
          captureSessionMeta: {
            sessionId: 'session-3',
            tabId: 3,
            capturedAt: 100,
            mode: 'interactive',
          },
        },
        pageCodebaseMappingConfig: {
          rules: [
            {
              id: 'gls-express-inquiry-kb',
              businessId: 'gls',
              pageLabel: '快递询价',
              triggerSkill: '/ewankb-server-query',
              ewankbKb: 'gls',
              ewankbMode: 'kb',
              enabled: true,
              hostIncludes: ['gls-uat.annto.com'],
              hashRouteIncludes: ['/entrustedOrderModule/expressInquiry'],
              pageTextIncludes: ['快递询价'],
              apiPrefixes: ['/api-miloms/guarantee/expressCostPrice/'],
              frontendGraphProjects: ['Users-zhanglt21-Desktop-codebase-otp-pc'],
              backendGraphProjects: ['Users-zhanglt21-Desktop-codebase-t-tms'],
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      suggestedCommand: string | null;
    };

    assert.equal(
      result.suggestedCommand,
      '/ewankb-server-query kb gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地"'
    );
  } finally {
    server.close();
  }
});

test('workspace management routes delegate to workspace service', async () => {
  const calls: Array<{
    action: string;
    projectPath?: string;
    name?: string;
    deleteDirectory?: boolean;
  }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
      async addWorkspace(input: { projectPath: string; name?: string }) {
        calls.push({ action: 'add', ...input });
        return { ok: true };
      },
      async renameWorkspace(input: { projectPath: string; name: string }) {
        calls.push({ action: 'rename', ...input });
        return { ok: true };
      },
      async deleteWorkspace(input: { projectPath: string; deleteDirectory?: boolean }) {
        calls.push({ action: 'delete', ...input });
        return { ok: true };
      },
      async openWorkspace(input: { projectPath: string }) {
        calls.push({ action: 'open', ...input });
        return { ok: true };
      },
      async pickFolder() {
        calls.push({ action: 'pick-folder', projectPath: 'C:\\picked-workspace' });
        return { projectPath: 'C:\\picked-workspace' };
      },
      async browseFolders(input: { path?: string }) {
        calls.push({ action: 'browse', projectPath: input.path });
        return { path: input.path || '~', folders: [] };
      },
      async createFolder(input: { parentPath: string; name: string }) {
        calls.push({ action: 'create-folder', projectPath: `${input.parentPath}/${input.name}` });
        return { ok: true };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/workspaces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: 'C:\\demo', name: 'Demo' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/workspaces`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: 'C:\\demo', name: 'Renamed' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(
          `${url}/api/agent-v2/workspaces?projectPath=${encodeURIComponent('C:\\demo')}&deleteDirectory=true`,
          { method: 'DELETE' }
        )
      ).status,
      200
    );
    assert.equal(
      (await fetch(`${url}/api/agent-v2/workspaces/browse?path=${encodeURIComponent('C:\\demo')}`))
        .status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/workspaces/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath: 'C:\\demo', name: 'child' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/workspaces/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: 'C:\\demo' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/workspaces/pick-folder`, {
          method: 'POST',
        })
      ).status,
      200
    );
    assert.deepEqual(calls, [
      { action: 'add', projectPath: 'C:\\demo', name: 'Demo' },
      { action: 'rename', projectPath: 'C:\\demo', name: 'Renamed' },
      { action: 'delete', projectPath: 'C:\\demo', deleteDirectory: true },
      { action: 'browse', projectPath: 'C:\\demo' },
      { action: 'create-folder', projectPath: 'C:\\demo/child' },
      { action: 'open', projectPath: 'C:\\demo' },
      { action: 'pick-folder', projectPath: 'C:\\picked-workspace' },
    ]);
  } finally {
    server.close();
  }
});

test('session metadata routes delegate to session service', async () => {
  const calls: Array<{
    action: string;
    projectPath: string;
    sessionId: string;
    title?: string;
    reason?: string;
  }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
      async renameSession(input: { projectPath: string; sessionId: string; title: string }) {
        calls.push({ action: 'rename', ...input });
        return { ok: true };
      },
      async deleteSession(input: { projectPath: string; sessionId: string }) {
        calls.push({ action: 'delete', ...input });
        return { ok: true };
      },
      async markSessionInterrupted(input: {
        projectPath: string;
        sessionId: string;
        reason: string;
      }) {
        calls.push({ action: 'interrupt', ...input });
        return { ok: true };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/sessions/session-1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: 'C:\\demo', title: 'Planning' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(
          `${url}/api/agent-v2/sessions/session-1?projectPath=${encodeURIComponent('C:\\demo')}`,
          { method: 'DELETE' }
        )
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/agent-v2/sessions/session-1/interrupted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: 'C:\\demo',
            reason: 'window_takeover_user_left',
          }),
        })
      ).status,
      200
    );
    assert.deepEqual(calls, [
      { action: 'rename', projectPath: 'C:\\demo', sessionId: 'session-1', title: 'Planning' },
      { action: 'delete', projectPath: 'C:\\demo', sessionId: 'session-1' },
      {
        action: 'interrupt',
        projectPath: 'C:\\demo',
        sessionId: 'session-1',
        reason: 'window_takeover_user_left',
      },
    ]);
  } finally {
    server.close();
  }
});

test('file entry routes delegate to file service', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree(input: {
        projectPath: string;
        dirPath?: string;
        maxDepth?: number;
        includeMetadata?: boolean;
      }) {
        calls.push({ action: 'tree', ...input });
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
      async createEntry(input: {
        projectPath: string;
        parentPath?: string;
        type: 'file' | 'directory';
        name: string;
      }) {
        calls.push({ action: 'create', ...input });
        return { ok: true };
      },
      async renameEntry(input: { projectPath: string; entryPath: string; newName: string }) {
        calls.push({ action: 'rename', ...input });
        return { ok: true };
      },
      async deleteEntry(input: { projectPath: string; entryPath: string }) {
        calls.push({ action: 'delete', ...input });
        return { ok: true };
      },
      async openEntry(input: { projectPath: string; entryPath?: string }) {
        calls.push({ action: 'open', ...input });
        return { ok: true };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    assert.equal(
      (
        await fetch(
          `${url}/api/files/tree?projectPath=${encodeURIComponent('C:\\demo')}&maxDepth=4`
        )
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/files/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: 'C:\\demo',
            parentPath: 'src',
            type: 'directory',
            name: 'components',
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/files/entries`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: 'C:\\demo',
            entryPath: 'src/old.ts',
            newName: 'new.ts',
          }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(
          `${url}/api/files/entries?projectPath=${encodeURIComponent('C:\\demo')}&entryPath=${encodeURIComponent('src/new.ts')}`,
          { method: 'DELETE' }
        )
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${url}/api/files/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: 'C:\\demo', entryPath: 'src' }),
        })
      ).status,
      200
    );
    assert.deepEqual(calls, [
      {
        action: 'tree',
        projectPath: 'C:\\demo',
        dirPath: undefined,
        maxDepth: 4,
        includeMetadata: true,
      },
      {
        action: 'create',
        projectPath: 'C:\\demo',
        parentPath: 'src',
        type: 'directory',
        name: 'components',
      },
      { action: 'rename', projectPath: 'C:\\demo', entryPath: 'src/old.ts', newName: 'new.ts' },
      { action: 'delete', projectPath: 'C:\\demo', entryPath: 'src/new.ts' },
      { action: 'open', projectPath: 'C:\\demo', entryPath: 'src' },
    ]);
  } finally {
    server.close();
  }
});

test('file tree route reports missing project roots as not found', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: createFileService(),
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const missingProjectPath = join(process.cwd(), '.missing-project-root');
    const response = await fetch(
      `${url}/api/files/tree?projectPath=${encodeURIComponent(missingProjectPath)}`
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'Project directory does not exist',
      code: 'project_not_found',
    });
  } finally {
    server.close();
  }
});

test('/api/chat is not implemented', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/chat`, { method: 'POST' });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('capabilities route returns provider information', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    capabilitiesService: {
      getCapabilities() {
        return {
          agent: 'local_claude_sdk',
          browserTools: 'local_mcp_http',
          history: 'claude_local',
          files: 'local_filesystem',
          mcpConfig: true,
        };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/capabilities`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      agent: 'local_claude_sdk',
      browserTools: 'local_mcp_http',
      history: 'claude_local',
      files: 'local_filesystem',
      mcpConfig: true,
    });
  } finally {
    server.close();
  }
});

test('capability management route delegates catalog operations', async () => {
  const calls: Array<{ action: string; input: unknown }> = [];
  let commandCatalogInvalidations = 0;
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    capabilityCatalogService: {
      async listCapabilities(input: unknown) {
        calls.push({ action: 'list', input });
        return [{ id: 'cap-1', name: 'review', type: 'command' }];
      },
      async readCapability(input: unknown) {
        calls.push({ action: 'read', input });
        return { capability: { id: 'cap-1', name: 'review' }, content: 'Review diff\n' };
      },
      async createCapability(input: unknown) {
        calls.push({ action: 'create', input });
        return { id: 'cap-2', name: 'ship' };
      },
      async updateCapability(input: unknown) {
        calls.push({ action: 'update', input });
        return { id: 'cap-1', name: 'review' };
      },
      async deleteCapability(input: unknown) {
        calls.push({ action: 'delete', input });
        return { deleted: true };
      },
      async importSkillDirectory(input: unknown) {
        calls.push({ action: 'import-skill-directory', input });
        return { id: 'cap-3', name: 'dragged-skill' };
      },
      async importSkillBundle(input: unknown) {
        calls.push({ action: 'import-skill-bundle', input });
        return { id: 'cap-4', name: 'dragged-skill-bundle' };
      },
      async setCapabilityEnabled(input: unknown) {
        calls.push({ action: 'set-enabled', input });
        return { id: 'cap-1', name: 'review', enabled: false };
      },
    },
    commandsService: {
      async listCommands() {
        return { localUi: [], project: [], user: [], plugin: [], skills: [], count: 0 };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'Clear' };
      },
      invalidateCache() {
        commandCatalogInvalidations += 1;
      },
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [
          {
            id: 'superpowers@claude-plugins-official',
            enabled: true,
            path: '/plugins/enabled-one',
          },
          { id: 'repowise@repowise', enabled: false, path: '/plugins/disabled-one' },
          { id: 'empty@plugin', enabled: true, path: '' },
        ];
      },
      async importPluginDirectory() {
        return {};
      },
      async setManagedPluginEnabled() {
        return {};
      },
      async removeManagedPlugin() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const listResponse = await fetch(
      `${url}/api/agent-v2/capabilities?type=command&projectPath=${encodeURIComponent('/tmp/project')}`
    );
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), {
      success: true,
      capabilities: [{ id: 'cap-1', name: 'review', type: 'command' }],
    });

    const detailResponse = await fetch(
      `${url}/api/agent-v2/capabilities/cap-1?projectPath=${encodeURIComponent('/tmp/project')}`
    );
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(await detailResponse.json(), {
      success: true,
      capability: { id: 'cap-1', name: 'review' },
      content: 'Review diff\n',
    });

    const createResponse = await fetch(`${url}/api/agent-v2/capabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'command',
        scope: 'project',
        projectPath: '/tmp/project',
        name: 'ship',
        content: 'Ship it',
      }),
    });
    assert.equal(createResponse.status, 200);

    const updateResponse = await fetch(`${url}/api/agent-v2/capabilities/cap-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: '/tmp/project', content: 'Updated' }),
    });
    assert.equal(updateResponse.status, 200);

    const toggleResponse = await fetch(`${url}/api/agent-v2/capabilities/cap-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: '/tmp/project', enabled: false }),
    });
    assert.equal(toggleResponse.status, 200);

    const importResponse = await fetch(`${url}/api/agent-v2/capabilities/import-skill-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        sourceDir: '/tmp/dragged-skill',
      }),
    });
    assert.equal(importResponse.status, 200);

    const deleteResponse = await fetch(
      `${url}/api/agent-v2/capabilities/cap-1?projectPath=${encodeURIComponent('/tmp/project')}`,
      { method: 'DELETE' }
    );
    assert.equal(deleteResponse.status, 200);

    assert.deepEqual(calls, [
      {
        action: 'list',
        input: {
          type: 'command',
          projectPath: '/tmp/project',
          pluginPaths: ['/plugins/enabled-one', '/plugins/disabled-one'],
          pluginSources: [
            {
              id: 'superpowers@claude-plugins-official',
              path: '/plugins/enabled-one',
              enabled: true,
              sourceKind: undefined,
            },
            {
              id: 'repowise@repowise',
              path: '/plugins/disabled-one',
              enabled: false,
              sourceKind: undefined,
            },
          ],
        },
      },
      {
        action: 'read',
        input: {
          id: 'cap-1',
          projectPath: '/tmp/project',
          pluginPaths: ['/plugins/enabled-one', '/plugins/disabled-one'],
          pluginSources: [
            {
              id: 'superpowers@claude-plugins-official',
              path: '/plugins/enabled-one',
              enabled: true,
              sourceKind: undefined,
            },
            {
              id: 'repowise@repowise',
              path: '/plugins/disabled-one',
              enabled: false,
              sourceKind: undefined,
            },
          ],
        },
      },
      {
        action: 'create',
        input: {
          type: 'command',
          scope: 'project',
          projectPath: '/tmp/project',
          name: 'ship',
          content: 'Ship it',
        },
      },
      { action: 'update', input: { id: 'cap-1', projectPath: '/tmp/project', content: 'Updated' } },
      {
        action: 'set-enabled',
        input: { id: 'cap-1', projectPath: '/tmp/project', enabled: false },
      },
      {
        action: 'import-skill-directory',
        input: { scope: 'user', projectPath: undefined, sourceDir: '/tmp/dragged-skill' },
      },
      { action: 'delete', input: { id: 'cap-1', projectPath: '/tmp/project' } },
    ]);
    assert.equal(commandCatalogInvalidations, 5);
  } finally {
    server.close();
  }
});

test('capability management file routes delegate child skill file operations', async () => {
  const calls: Array<{ action: string; input: unknown }> = [];
  let detailReadCalls = 0;
  const capabilityCatalogService = {
    async listCapabilities() {
      return [];
    },
    async readCapability() {
      detailReadCalls += 1;
      return { capability: { id: 'cap-1', name: 'demo-skill' }, content: '# Demo Skill\n' };
    },
    async createCapability() {
      return { id: 'cap-2', name: 'ship' };
    },
    async updateCapability() {
      return { id: 'cap-1', name: 'demo-skill' };
    },
    async deleteCapability() {
      return { deleted: true };
    },
    async importSkillDirectory() {
      return { id: 'cap-3', name: 'dragged-skill' };
    },
    async importSkillBundle() {
      return { id: 'cap-4', name: 'dragged-skill-bundle' };
    },
    async setCapabilityEnabled() {
      return { id: 'cap-1', name: 'demo-skill', enabled: false };
    },
    async readCapabilityFile(input: unknown) {
      calls.push({ action: 'read-file', input });
      return {
        capability: { id: 'cap-1', type: 'skill', name: 'demo-skill' },
        path: 'scripts/helper.py',
        content: 'print("demo")\n',
        encoding: 'utf8',
      };
    },
    async updateCapabilityFile(input: unknown) {
      calls.push({ action: 'update-file', input });
      return {
        capability: { id: 'cap-1', type: 'skill', name: 'demo-skill' },
        path: 'scripts/helper.py',
      };
    },
  } as NonNullable<Parameters<typeof createApp>[0]['capabilityCatalogService']> & {
    readCapabilityFile(input: unknown): Promise<unknown>;
    updateCapabilityFile(input: unknown): Promise<unknown>;
  };
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    capabilityCatalogService,
    pluginManagementService: {
      async listManagedPlugins() {
        return [];
      },
      async importPluginDirectory() {
        return {};
      },
      async listPluginMarketplace() {
        return [];
      },
      async setManagedPluginEnabled() {
        return {};
      },
      async removeManagedPlugin() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const readResponse = await fetch(
      `${url}/api/agent-v2/capabilities/cap-1/files/scripts%2Fhelper.py?projectPath=${encodeURIComponent('/tmp/project')}`
    );
    assert.equal(readResponse.status, 200);
    assert.deepEqual(await readResponse.json(), {
      success: true,
      capability: { id: 'cap-1', type: 'skill', name: 'demo-skill' },
      path: 'scripts/helper.py',
      content: 'print("demo")\n',
      encoding: 'utf8',
    });

    const updateResponse = await fetch(
      `${url}/api/agent-v2/capabilities/cap-1/files/scripts%2Fhelper.py`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: '/tmp/project',
          content: 'print("changed")',
        }),
      }
    );
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(await updateResponse.json(), {
      success: true,
      capability: { id: 'cap-1', type: 'skill', name: 'demo-skill' },
      path: 'scripts/helper.py',
    });

    assert.deepEqual(calls, [
      {
        action: 'read-file',
        input: {
          id: 'cap-1',
          path: 'scripts/helper.py',
          projectPath: '/tmp/project',
          pluginPaths: [],
          pluginSources: [],
        },
      },
      {
        action: 'update-file',
        input: {
          id: 'cap-1',
          path: 'scripts/helper.py',
          projectPath: '/tmp/project',
          content: 'print("changed")',
        },
      },
    ]);
    assert.equal(detailReadCalls, 0);
  } finally {
    server.close();
  }
});

test('capability management file routes decode encoded capability ids and file paths', async () => {
  const calls: Array<{ action: string; input: unknown }> = [];
  const encodedId = 'skill/id with spaces';
  const encodedPath = 'guides/你好 guide.md';
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    capabilityCatalogService: {
      async listCapabilities() {
        return [];
      },
      async readCapability() {
        return { capability: { id: 'unused', name: 'unused' }, content: '' };
      },
      async createCapability() {
        return { id: 'unused' };
      },
      async updateCapability() {
        return { id: 'unused' };
      },
      async deleteCapability() {
        return { deleted: true };
      },
      async importSkillDirectory() {
        return { id: 'unused' };
      },
      async importSkillBundle() {
        return { id: 'unused' };
      },
      async setCapabilityEnabled() {
        return { id: 'unused', enabled: true };
      },
      async readCapabilityFile(input: unknown) {
        calls.push({ action: 'read-file', input });
        return {
          capability: { id: encodedId, type: 'skill', name: 'demo-skill' },
          path: encodedPath,
          content: '# encoded\n',
          encoding: 'utf8',
        };
      },
      async updateCapabilityFile(input: unknown) {
        calls.push({ action: 'update-file', input });
        return {
          capability: { id: encodedId, type: 'skill', name: 'demo-skill' },
          path: encodedPath,
        };
      },
    } as NonNullable<Parameters<typeof createApp>[0]['capabilityCatalogService']> & {
      readCapabilityFile(input: unknown): Promise<unknown>;
      updateCapabilityFile(input: unknown): Promise<unknown>;
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [];
      },
      async importPluginDirectory() {
        return {};
      },
      async listPluginMarketplace() {
        return [];
      },
      async setManagedPluginEnabled() {
        return {};
      },
      async removeManagedPlugin() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/agent-v2/capabilities/${encodeURIComponent(encodedId)}/files/${encodeURIComponent(encodedPath)}`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      capability: { id: encodedId, type: 'skill', name: 'demo-skill' },
      path: encodedPath,
      content: '# encoded\n',
      encoding: 'utf8',
    });
    assert.deepEqual(calls, [
      {
        action: 'read-file',
        input: {
          id: encodedId,
          path: encodedPath,
          projectPath: undefined,
          pluginPaths: [],
          pluginSources: [],
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('capability management file routes return 4xx for invalid url encoding', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    capabilityCatalogService: {
      async listCapabilities() {
        return [];
      },
      async readCapability() {
        return { capability: { id: 'unused', name: 'unused' }, content: '' };
      },
      async createCapability() {
        return { id: 'unused' };
      },
      async updateCapability() {
        return { id: 'unused' };
      },
      async deleteCapability() {
        return { deleted: true };
      },
      async importSkillDirectory() {
        return { id: 'unused' };
      },
      async importSkillBundle() {
        return { id: 'unused' };
      },
      async setCapabilityEnabled() {
        return { id: 'unused', enabled: true };
      },
      async readCapabilityFile() {
        throw new Error('should not reach readCapabilityFile');
      },
      async updateCapabilityFile() {
        throw new Error('should not reach updateCapabilityFile');
      },
    } as NonNullable<Parameters<typeof createApp>[0]['capabilityCatalogService']> & {
      readCapabilityFile(input: unknown): Promise<unknown>;
      updateCapabilityFile(input: unknown): Promise<unknown>;
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [];
      },
      async importPluginDirectory() {
        return {};
      },
      async listPluginMarketplace() {
        return [];
      },
      async setManagedPluginEnabled() {
        return {};
      },
      async removeManagedPlugin() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/capabilities/cap-1/files/bad%ZZpath`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Capability route contains invalid URL encoding.',
      code: 'invalid_capability_route_encoding',
    });
  } finally {
    server.close();
  }
});

test('commands route lists catalog entries', async () => {
  const requestedInputs: Array<{
    projectPath?: string;
    pluginPaths?: string[];
    pluginSources?: Array<{ id?: string; path: string }>;
  }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    commandsService: {
      async listCommands(input: {
        projectPath?: string;
        pluginPaths?: string[];
        pluginSources?: Array<{ id?: string; path: string }>;
      }) {
        requestedInputs.push(input);
        return {
          localUi: [{ name: '/clear', description: 'Clear', namespace: 'local-ui' }],
          project: [],
          user: [],
          skills: [],
          count: 1,
        };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'Clear' };
      },
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [
          {
            id: 'superpowers@claude-plugins-official',
            enabled: true,
            path: '/plugins/enabled-one',
          },
          { id: 'repowise@repowise', enabled: false, path: '/plugins/disabled-one' },
          { id: 'empty@plugin', enabled: true, path: '' },
        ];
      },
      async importPluginDirectory() {
        return {};
      },
      async setManagedPluginEnabled() {
        return {};
      },
      async removeManagedPlugin() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/commands/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: '/tmp/project-a' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      localUi: [{ name: '/clear', description: 'Clear', namespace: 'local-ui' }],
      project: [],
      user: [],
      skills: [],
      count: 1,
    });
    assert.deepEqual(requestedInputs, [
      {
        projectPath: '/tmp/project-a',
        pluginPaths: ['/plugins/enabled-one'],
        pluginSources: [
          {
            id: 'superpowers@claude-plugins-official',
            path: '/plugins/enabled-one',
            enabled: true,
            sourceKind: undefined,
          },
        ],
      },
    ]);
  } finally {
    server.close();
  }
});

test('plugin management routes delegate dev-local install, compatibility import, toggle, and delete operations', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  let commandCatalogInvalidations = 0;
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    pluginManagementService: {
      async listManagedPlugins() {
        calls.push({ action: 'list' });
        return [{ id: 'demo@local', enabled: true }];
      },
      async installPlugin(input: unknown) {
        calls.push({ action: 'install', input });
        return { id: 'demo@local', enabled: true };
      },
      async importPluginDirectory(input: unknown) {
        calls.push({ action: 'import', input });
        return { id: 'demo@local', enabled: true };
      },
      async setManagedPluginEnabled(input: unknown) {
        calls.push({ action: 'toggle', input });
        return { id: 'demo@local', enabled: false };
      },
      async removeManagedPlugin(input: unknown) {
        calls.push({ action: 'remove', input });
        return { removed: true };
      },
    },
    commandsService: {
      async listCommands() {
        return { localUi: [], project: [], user: [], plugin: [], skills: [], count: 0 };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'Clear' };
      },
      invalidateCache() {
        commandCatalogInvalidations += 1;
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const listResponse = await fetch(`${url}/api/agent-v2/plugins`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), {
      success: true,
      plugins: [{ id: 'demo@local', enabled: true }],
    });

    const installResponse = await fetch(`${url}/api/agent-v2/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { kind: 'dev-local', directory: 'C:\\plugins\\demo' },
        scope: 'user',
      }),
    });
    assert.equal(installResponse.status, 200);

    const importResponse = await fetch(`${url}/api/agent-v2/plugins/import-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\plugins\\demo' }),
    });
    assert.equal(importResponse.status, 200);

    const toggleResponse = await fetch(`${url}/api/agent-v2/plugins/demo%40local`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, sourceKind: 'lite' }),
    });
    assert.equal(toggleResponse.status, 200);

    const deleteResponse = await fetch(`${url}/api/agent-v2/plugins/demo%40local?sourceKind=lite`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 200);

    assert.deepEqual(calls, [
      { action: 'list' },
      {
        action: 'install',
        input: {
          source: { kind: 'dev-local', directory: 'C:\\plugins\\demo' },
          scope: 'user',
        },
      },
      { action: 'import', input: { pluginPath: 'C:\\plugins\\demo' } },
      { action: 'toggle', input: { id: 'demo@local', enabled: false, sourceKind: 'lite' } },
      { action: 'remove', input: { id: 'demo@local', sourceKind: 'lite' } },
    ]);
    assert.equal(commandCatalogInvalidations, 4);
  } finally {
    server.close();
  }
});

test('plugin management routes pass github install payload through unchanged', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [];
      },
      async installPlugin(input: unknown) {
        calls.push({ action: 'install', input });
        return { id: 'demo@github', enabled: true };
      },
      async importPluginDirectory() {
        return { id: 'demo@github', enabled: true };
      },
      async setManagedPluginEnabled() {
        return { id: 'demo@github', enabled: true };
      },
      async removeManagedPlugin() {
        return { removed: true };
      },
    },
    commandsService: {
      async listCommands() {
        return { localUi: [], project: [], user: [], plugin: [], skills: [], count: 0 };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'Clear' };
      },
      invalidateCache() {},
    },
  });
  const { server, url } = await listen(app);
  try {
    const installResponse = await fetch(`${url}/api/agent-v2/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: {
          kind: 'github',
          repoUrl: 'https://github.com/example/demo-plugin#plugins/demo',
        },
        scope: 'user',
      }),
    });
    assert.equal(installResponse.status, 200);
    assert.deepEqual(calls, [
      {
        action: 'install',
        input: {
          source: {
            kind: 'github',
            repoUrl: 'https://github.com/example/demo-plugin#plugins/demo',
          },
          scope: 'user',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('plugin management routes reject unsupported install source kinds', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    pluginManagementService: {
      async listManagedPlugins() {
        return [];
      },
      async installPlugin(input: unknown) {
        calls.push({ action: 'install', input });
        return { id: 'demo@invalid', enabled: true };
      },
      async importPluginDirectory() {
        return { id: 'demo@invalid', enabled: true };
      },
      async setManagedPluginEnabled() {
        return { id: 'demo@invalid', enabled: true };
      },
      async removeManagedPlugin() {
        return { removed: true };
      },
    },
    commandsService: {
      async listCommands() {
        return { localUi: [], project: [], user: [], plugin: [], skills: [], count: 0 };
      },
      async executeCommand() {
        return { type: 'local-ui', command: '/clear', action: 'clear', message: 'Clear' };
      },
      invalidateCache() {},
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { kind: 'bitbucket', repoUrl: 'https://bitbucket.org/example/demo-plugin' },
        scope: 'user',
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Unsupported plugin install source.kind: bitbucket.',
      code: 'invalid_plugin_install_source',
    });
    assert.deepEqual(calls, []);
  } finally {
    server.close();
  }
});

test('runtime capabilities routes trim responses and filter patch payload', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    runtimeCapabilitiesService: {
      async getCapabilities() {
        calls.push({ action: 'get' });
        return {
          selectedAuthSource: 'project_model_config',
          allowExternalBrowserAutomation: false,
          allowedPluginIds: ['legacy-plugin-from-service'],
          allowedToolPrefixes: ['legacy_tool_prefix_from_service'],
        } as unknown as Awaited<
          ReturnType<
            NonNullable<
              Parameters<typeof createApp>[0]['runtimeCapabilitiesService']
            >['getCapabilities']
          >
        >;
      },
      async updateCapabilities(input: unknown) {
        calls.push({ action: 'patch', input });
        return {
          selectedAuthSource: 'user_claude_settings',
          allowExternalBrowserAutomation: true,
          allowedPluginIds: ['legacy-plugin-from-service'],
          allowedToolPrefixes: ['legacy_tool_prefix_from_service'],
        } as unknown as Awaited<
          ReturnType<
            NonNullable<
              Parameters<typeof createApp>[0]['runtimeCapabilitiesService']
            >['updateCapabilities']
          >
        >;
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const listResponse = await fetch(`${url}/api/agent-v2/runtime-capabilities`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), {
      success: true,
      capabilities: {
        selectedAuthSource: 'project_model_config',
      },
    });

    const patchResponse = await fetch(`${url}/api/agent-v2/runtime-capabilities`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedAuthSource: 'user_claude_settings',
        allowExternalBrowserAutomation: true,
        allowedPluginIds: ['playwright@claude-plugins-official'],
        allowedToolPrefixes: ['mcp__plugin_playwright_playwright__'],
      }),
    });
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(await patchResponse.json(), {
      success: true,
      capabilities: {
        selectedAuthSource: 'user_claude_settings',
      },
    });

    assert.deepEqual(calls, [
      { action: 'get' },
      {
        action: 'patch',
        input: {
          selectedAuthSource: 'user_claude_settings',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('model config routes expose config and runtime source', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    modelConfigService: {
      async getConfig() {
        calls.push({ action: 'get' });
        return {
          configMode: 'official' as const,
          modelProvider: 'anthropic' as const,
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-ant-demo',
          anthropicBaseUrl: 'https://example.com/v1',
        };
      },
      async updateConfig(input: unknown) {
        calls.push({ action: 'patch', input });
        return {
          configMode: 'official' as const,
          modelProvider: 'anthropic' as const,
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-ant-next',
          anthropicBaseUrl: 'https://example.com/v1',
        };
      },
      async getRuntimeInfo() {
        return {
          authSource: 'project_model_config' as const,
          claudeCliAvailable: false,
          userClaudeSettingsEnabled: false,
          hasProjectModelConfig: true,
          reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
        };
      },
      async testConfig() {
        return {
          ok: true,
          message: '认证成功',
          runtimeAuthSummary: '认证摘要',
          runtime: {
            authSource: 'project_model_config' as const,
            claudeCliAvailable: false,
            userClaudeSettingsEnabled: false,
            hasProjectModelConfig: true,
            reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
          },
        };
      },
      async listOfficialModels() {
        return [];
      },
      async getOfficialQuota() {
        return {
          usagePercent: null,
          nextResetTime: null,
          resetCycle: 'unlimited',
        };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const getResponse = await fetch(`${url}/api/agent-v2/model-config`);
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      success: true,
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'qwen3.6-plus',
        anthropicApiKey: 'sk-ant-demo',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      runtime: {
        authSource: 'project_model_config',
        claudeCliAvailable: false,
        userClaudeSettingsEnabled: false,
        hasProjectModelConfig: true,
        reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
      },
      detectedCliConfig: null,
      userClaudeSettings: {
        path: '',
        exists: false,
        rawJson: null,
      },
    });

    const patchResponse = await fetch(`${url}/api/agent-v2/model-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'qwen3.6-plus',
        anthropicApiKey: 'sk-ant-next',
        anthropicBaseUrl: 'https://example.com/v1',
      }),
    });
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(await patchResponse.json(), {
      success: true,
      config: {
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'qwen3.6-plus',
        anthropicApiKey: 'sk-ant-next',
        anthropicBaseUrl: 'https://example.com/v1',
      },
      runtime: {
        authSource: 'project_model_config',
        claudeCliAvailable: false,
        userClaudeSettingsEnabled: false,
        hasProjectModelConfig: true,
        reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
      },
    });

    assert.deepEqual(calls, [
      { action: 'get' },
      {
        action: 'patch',
        input: {
          configMode: 'official',
          modelProvider: 'anthropic',
          providerVariant: undefined,
          openaiModelName: undefined,
          openaiApiKey: undefined,
          openaiBaseUrl: undefined,
          anthropicModelName: 'qwen3.6-plus',
          anthropicApiKey: 'sk-ant-next',
          anthropicBaseUrl: 'https://example.com/v1',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('model config auth test route returns structured diagnostics', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    modelConfigService: {
      async getConfig() {
        return { configMode: 'third_party' as const, modelProvider: 'anthropic' as const };
      },
      async updateConfig() {
        return { configMode: 'third_party' as const, modelProvider: 'anthropic' as const };
      },
      async getRuntimeInfo() {
        return {
          authSource: 'project_model_config' as const,
          claudeCliAvailable: false,
          userClaudeSettingsEnabled: false,
          hasProjectModelConfig: true,
          reason: 'test',
        };
      },
      async testConfig(input: unknown) {
        calls.push({ action: 'test', input });
        return {
          ok: false,
          message:
            'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
          runtimeAuthSummary:
            '认证摘要 | source=project_model_config | provider=anthropic | model=glm-5.1 | baseUrl=https://example.com/v1 | apiKey=present | settingSources=project,local | claudeCli=missing | cliPath=unset',
          runtime: {
            authSource: 'project_model_config' as const,
            claudeCliAvailable: false,
            userClaudeSettingsEnabled: false,
            hasProjectModelConfig: true,
            reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
          },
        };
      },
      async listOfficialModels() {
        return [];
      },
      async getOfficialQuota() {
        return {
          usagePercent: null,
          nextResetTime: null,
          resetCycle: 'unlimited',
        };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/model-config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configMode: 'official',
        modelProvider: 'anthropic',
        anthropicModelName: 'glm-5.1',
        anthropicApiKey: 'sk-ant-next',
        anthropicBaseUrl: 'https://example.com/v1',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      result: {
        ok: false,
        message:
          'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
        runtimeAuthSummary:
          '认证摘要 | source=project_model_config | provider=anthropic | model=glm-5.1 | baseUrl=https://example.com/v1 | apiKey=present | settingSources=project,local | claudeCli=missing | cliPath=unset',
        runtime: {
          authSource: 'project_model_config',
          claudeCliAvailable: false,
          userClaudeSettingsEnabled: false,
          hasProjectModelConfig: true,
          reason: '当前未使用用户级 Claude settings，已使用项目模型配置作为运行时认证来源。',
        },
      },
    });

    assert.deepEqual(calls, [
      {
        action: 'test',
        input: {
          configMode: 'official',
          modelProvider: 'anthropic',
          providerVariant: undefined,
          openaiModelName: undefined,
          openaiApiKey: undefined,
          openaiBaseUrl: undefined,
          anthropicModelName: 'glm-5.1',
          anthropicApiKey: 'sk-ant-next',
          anthropicBaseUrl: 'https://example.com/v1',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('official model config routes expose model catalog and quota', async () => {
  const calls: Array<{ action: string; input?: unknown }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    modelConfigService: {
      async getConfig() {
        return { configMode: 'third_party' as const, modelProvider: 'anthropic' as const };
      },
      async updateConfig() {
        return { configMode: 'third_party' as const, modelProvider: 'anthropic' as const };
      },
      async getRuntimeInfo() {
        return {
          authSource: 'project_model_config' as const,
          claudeCliAvailable: false,
          userClaudeSettingsEnabled: false,
          hasProjectModelConfig: true,
          reason: 'test',
        };
      },
      async testConfig() {
        return {
          ok: true,
          message: 'ok',
          runtimeAuthSummary: 'summary',
          runtime: {
            authSource: 'project_model_config' as const,
            claudeCliAvailable: false,
            userClaudeSettingsEnabled: false,
            hasProjectModelConfig: true,
            reason: 'test',
          },
        };
      },
      async listOfficialModels(input: unknown) {
        calls.push({ action: 'models', input });
        return [{ id: 'claude-sonnet-4-6', ownedBy: 'openai' }];
      },
      async getOfficialQuota(input: unknown) {
        calls.push({ action: 'quota', input });
        return {
          usagePercent: 15.6,
          nextResetTime: '2026-05-21T00:00:00+00:00',
          resetCycle: 'daily',
        };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const modelsResponse = await fetch(`${url}/api/agent-v2/model-config/official/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-official' }),
    });
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual(await modelsResponse.json(), {
      success: true,
      models: [{ id: 'claude-sonnet-4-6', ownedBy: 'openai' }],
    });

    const quotaResponse = await fetch(`${url}/api/agent-v2/model-config/official/quota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-official' }),
    });
    assert.equal(quotaResponse.status, 200);
    assert.deepEqual(await quotaResponse.json(), {
      success: true,
      quota: {
        usagePercent: 15.6,
        nextResetTime: '2026-05-21T00:00:00+00:00',
        resetCycle: 'daily',
      },
    });

    assert.deepEqual(calls, [
      { action: 'models', input: { apiKey: 'sk-official' } },
      { action: 'quota', input: { apiKey: 'sk-official' } },
    ]);
  } finally {
    server.close();
  }
});

test('hooks route returns source overview', async () => {
  const calls: Array<unknown> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    hooksOverviewService: {
      async getHooksOverview(input: unknown) {
        calls.push(input);
        return { sources: [{ id: 'user', label: 'User settings' }] };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/agent-v2/hooks/overview?projectPath=${encodeURIComponent('/tmp/project')}`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sources: [{ id: 'user', label: 'User settings' }],
    });
    assert.deepEqual(calls, [{ projectPath: '/tmp/project' }]);
  } finally {
    server.close();
  }
});

test('mcp registry route lists servers and tools', async () => {
  const registryCalls: Array<{ projectPath?: string }> = [];
  const upsertCalls: Array<{
    name: string;
    config: unknown;
    projectPath?: string;
    scope?: string;
  }> = [];
  const deleteCalls: Array<{ name: string; projectPath?: string; scope?: string }> = [];
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
    mcpRegistryService: {
      async listServers(input) {
        registryCalls.push({ projectPath: input?.projectPath });
        return {
          servers: [
            {
              name: 'browser_extension',
              builtIn: true,
              disabled: false,
              type: 'http',
              source: 'built-in',
              config: { type: 'http', url: 'http://127.0.0.1:12306/mcp' },
              enabledToolCount: 1,
              totalToolCount: 1,
              status: 'enabled',
            },
          ],
          rawJson: '{ "mcpServers": {} }',
        };
      },
      async readRawConfig() {
        return { rawJson: '{ "mcpServers": {} }' };
      },
      async writeRawConfig() {
        return { servers: [], rawJson: '{ "mcpServers": {} }' };
      },
      async upsertServer(name, config, input) {
        upsertCalls.push({
          name,
          config,
          projectPath: input?.projectPath,
          scope: input?.scope,
        });
        return { servers: [], rawJson: '{ "mcpServers": {} }' };
      },
      async setServerEnabled() {
        return { servers: [] };
      },
      async deleteServer(name, input) {
        deleteCalls.push({
          name,
          projectPath: input?.projectPath,
          scope: input?.scope,
        });
        return { servers: [] };
      },
      async listServerTools() {
        return {
          server: {
            name: 'browser_extension',
            builtIn: true,
            disabled: false,
            type: 'http',
            source: 'built-in',
            config: { type: 'http', url: 'http://127.0.0.1:12306/mcp' },
            enabledToolCount: 1,
            totalToolCount: 1,
            status: 'enabled',
          },
          tools: [
            {
              name: 'read_current_page_content',
              fullName: 'mcp__browser_extension__read_current_page_content',
              enabled: true,
            },
          ],
        };
      },
      async setToolEnabled() {
        return {
          allowedTools: ['mcp__browser_extension__read_current_page_content'],
          disallowedTools: [],
        };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(
      `${url}/api/mcp/registry?projectPath=${encodeURIComponent('/tmp/project-a')}`
    );
    assert.equal(response.status, 200);
    const registryBody = (await response.json()) as { servers: Array<{ name: string }> };
    assert.equal(registryBody.servers[0].name, 'browser_extension');
    assert.deepEqual(registryCalls, [{ projectPath: '/tmp/project-a' }]);

    const toolsResponse = await fetch(`${url}/api/mcp/registry/servers/browser_extension/tools`);
    assert.equal(toolsResponse.status, 200);
    const toolsBody = (await toolsResponse.json()) as {
      tools: Array<{ fullName: string }>;
    };
    assert.equal(toolsBody.tools[0].fullName, 'mcp__browser_extension__read_current_page_content');

    const upsertResponse = await fetch(`${url}/api/mcp/registry/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'gitnexus',
        scope: 'user',
        projectPath: '/tmp/project-a',
        config: { command: 'node', args: ['gitnexus.js'] },
      }),
    });
    assert.equal(upsertResponse.status, 200);
    assert.deepEqual(upsertCalls, [
      {
        name: 'gitnexus',
        projectPath: '/tmp/project-a',
        scope: 'user',
        config: { command: 'node', args: ['gitnexus.js'] },
      },
    ]);

    const deleteResponse = await fetch(`${url}/api/mcp/registry/servers/context7?scope=user`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(deleteCalls, [
      {
        name: 'context7',
        projectPath: undefined,
        scope: 'user',
      },
    ]);
  } finally {
    server.close();
  }
});

test('DOM 文档路由返回 markdown 文本', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentType: 'analysis-report',
        page: {
          title: '回单管理',
          url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
          hashRoute: '/distribute/receipt-mngt/list',
          targetElement: '回单管理',
        },
        attribution: {
          bestApi: '/api-tms/receipt/queryList',
          candidateApis: [
            {
              api: '/api-tms/receipt/queryList',
              score: 20,
              evidence: ['api-candidate', 'network-request'],
            },
          ],
          confidence: 'high',
          needsMoreEvidence: false,
          recommendedAction: 'inspect-best-api',
        },
        location: {
          matchedRuleId: 'otp-receipt',
          frontend: {
            graphProjects: ['Users-zhanglt21-Desktop-codebase-otp-pc'],
            searchTerms: ['/distribute/receipt-mngt/list', '回单管理'],
          },
          backend: {
            graphProjects: ['Users-zhanglt21-Desktop-codebase-t-tms'],
            searchTerms: ['/api-tms/receipt/queryList'],
          },
          shared: {
            graphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
            searchTerms: ['receipt-list.chunk.js'],
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/markdown/);
    assert.match(await response.text(), /# 页面 DOM 分析报告/);
  } finally {
    server.close();
  }
});

test('DOM 文档路由在坏请求时返回稳定错误', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentType: 'unknown-document',
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid DOM document request body',
      code: 'invalid_dom_document_request',
    });
  } finally {
    server.close();
  }
});

test('DOM 文档路由对非法 JSON 返回稳定错误', async () => {
  const app = createApp({
    agentService: {
      async getSessionHistory() {
        return { sessionId: 'x', messages: [] };
      },
      async abortRun() {
        return { aborted: false, reason: 'not_active' as const };
      },
    },
    fileService: {
      async listTree() {
        return { entries: [] };
      },
      async readTextFile() {
        return { content: '' };
      },
      async writeTextFile() {
        return { ok: true as const };
      },
    },
    mcpService: {
      async listServers() {
        return {};
      },
      async upsertServer() {
        return {};
      },
      async deleteServer() {
        return {};
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/api/agent-v2/page-code-analysis/dom-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"documentType":"analysis-report",',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid DOM document request body',
      code: 'invalid_dom_document_request',
    });
  } finally {
    server.close();
  }
});
