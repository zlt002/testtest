import assert from 'node:assert/strict';
import test from 'node:test';

import { Server } from './index';
import {
  isManagedNativeServerCommand,
  recoverNativeServerPortConflict,
} from './port-recovery';

test('isManagedNativeServerCommand 识别 macOS 安装目录下的 native-server index.js 进程', () => {
  assert.equal(
    isManagedNativeServerCommand(
      '/Users/demo/Library/Application Support/chromemcp/native-server/dist/index.js'
    ),
    true
  );
});

test('isManagedNativeServerCommand 不会把无关进程误判为本项目 native-server', () => {
  assert.equal(
    isManagedNativeServerCommand('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    false
  );
});

test('recoverNativeServerPortConflict 只会清理识别出的本项目旧进程', async () => {
  const terminated: number[] = [];

  const recovered = await recoverNativeServerPortConflict({
    port: 12306,
    currentPid: 999,
    listListeningPids: async () => [111, 222],
    readCommandLine: async (pid) =>
      pid === 111
        ? '/Users/demo/Library/Application Support/chromemcp/native-server/dist/index.js'
        : '/usr/bin/python3 -m http.server 12306',
    terminateProcess: async (pid) => {
      terminated.push(pid);
    },
    probeDiscovery: async () => ({
      ok: true,
      url: 'http://127.0.0.1:12306/discovery',
    }),
  });

  assert.equal(recovered, true);
  assert.deepEqual(terminated, [111]);
});

test('Server.start 遇到 EADDRINUSE 且已成功清理旧 native-server 后会重试启动', async () => {
  let recoverCalls = 0;
  const server = new Server({
    recoverPortConflict: async () => {
      recoverCalls += 1;
      return true;
    },
  });

  let listenCalls = 0;
  server.fastify.listen = (async () => {
    listenCalls += 1;
    if (listenCalls === 1) {
      throw Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
    }
  }) as typeof server.fastify.listen;
  (server as any).agentSupervisor = {
    ensureStarted: async () => undefined,
    stop: async () => undefined,
  };

  await server.start(12306, {} as any);

  assert.equal(recoverCalls, 1);
  assert.equal(listenCalls, 2);
  assert.equal(server.isRunning, true);
});
