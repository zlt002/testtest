import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerAgentV2Service } from './server-agent-v2-service.ts';

test('createServerAgentV2Service wires workspace browsing, picking, and folder creation into agent service', async () => {
  const calls: Array<{ type: string; value?: string }> = [];
  const service = createServerAgentV2Service({
    agentService: {
      async getSessionHistory() {
        return { messages: [] };
      },
      async abortRun() {
        return { aborted: false as const, reason: 'not_active' as const };
      },
    },
    workspaceService: {
      async addWorkspace() {
        return { ok: true as const };
      },
      async renameWorkspace() {
        return { ok: true as const };
      },
      async deleteWorkspace() {
        return { ok: true as const };
      },
      async openWorkspace() {
        return { ok: true as const };
      },
      async browseFolders(input: { path?: string }) {
        calls.push({ type: 'browse', value: input.path });
        return {
          path: input.path || '~',
          parentPath: null,
          folders: [],
        };
      },
      async pickFolder() {
        calls.push({ type: 'pick-folder' });
        return { projectPath: 'C:\\demo' };
      },
      async createFolder(input: { parentPath: string; name: string }) {
        calls.push({ type: 'create-folder', value: `${input.parentPath}/${input.name}` });
        return { ok: true as const };
      },
    },
    sessionMetadataService: {
      async renameSession() {
        return { ok: true as const };
      },
      async deleteSession() {
        return { ok: true as const };
      },
      async markSessionInterrupted() {
        return { ok: true as const };
      },
    },
  });

  const result = await service.browseFolders?.({ path: '~' });
  const pickedFolder = await service.pickFolder?.();
  const createResult = await service.createFolder?.({ parentPath: '~', name: 'demo' });

  assert.deepEqual(calls, [
    { type: 'browse', value: '~' },
    { type: 'pick-folder' },
    { type: 'create-folder', value: '~/demo' },
  ]);
  assert.deepEqual(result, {
    path: '~',
    parentPath: null,
    folders: [],
  });
  assert.deepEqual(pickedFolder, { projectPath: 'C:\\demo' });
  assert.deepEqual(createResult, { ok: true });
});
