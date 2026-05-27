import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../shared/errors.ts';
import { createSystemFolderPicker, execPickerCommand } from './system-folder-picker.ts';

test('macOS 使用 osascript 打开系统文件夹选择器', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const picker = createSystemFolderPicker({
    platform: 'darwin',
    execFile(command, args) {
      calls.push({ command, args });
      return Promise.resolve('/Users/demo/workspace\n');
    },
    isCommandAvailable: async () => false,
  });

  const selectedPath = await picker.pickFolder();

  assert.equal(selectedPath, '/Users/demo/workspace');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, '/usr/bin/osascript');
  assert.equal(calls[0]?.args[0], '-e');
  assert.match(calls[0]?.args[1] || '', /choose folder/);
});

test('Linux 优先使用 zenity 打开系统文件夹选择器', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const picker = createSystemFolderPicker({
    platform: 'linux',
    execFile(command, args) {
      calls.push({ command, args });
      return Promise.resolve('/home/demo/workspace\n');
    },
    isCommandAvailable: async (command) => command === 'zenity',
  });

  const selectedPath = await picker.pickFolder();

  assert.equal(selectedPath, '/home/demo/workspace');
  assert.deepEqual(calls, [
    {
      command: 'zenity',
      args: ['--file-selection', '--directory', '--title=选择本地工作区'],
    },
  ]);
});

test('Linux 在没有 zenity 时回退到 kdialog', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const picker = createSystemFolderPicker({
    platform: 'linux',
    execFile(command, args) {
      calls.push({ command, args });
      return Promise.resolve('/home/demo/workspace\n');
    },
    isCommandAvailable: async (command) => command === 'kdialog',
  });

  const selectedPath = await picker.pickFolder();

  assert.equal(selectedPath, '/home/demo/workspace');
  assert.deepEqual(calls, [
    {
      command: 'kdialog',
      args: ['--getexistingdirectory', '--title', '选择本地工作区'],
    },
  ]);
});

test('Linux 在没有系统弹框命令时返回 unsupported', async () => {
  const picker = createSystemFolderPicker({
    platform: 'linux',
    execFile() {
      return Promise.resolve('');
    },
    isCommandAvailable: async () => false,
  });

  await assert.rejects(
    () => picker.pickFolder(),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 501);
      assert.equal(error.code, 'workspace_picker_unsupported');
      return true;
    }
  );
});

test('系统弹框取消选择时返回 null', async () => {
  const picker = createSystemFolderPicker({
    platform: 'darwin',
    execFile() {
      return Promise.resolve('');
    },
    isCommandAvailable: async () => false,
  });

  assert.equal(await picker.pickFolder(), null);
});

test('外部 picker 命令成功时忽略 stderr 警告输出', async () => {
  const stdout = await execPickerCommand('node', [
    '-e',
    "process.stderr.write('libpng warning: iCCP: known incorrect sRGB profile\\n'); process.stdout.write('/Users/demo/workspace\\n')",
  ]);

  assert.equal(stdout, '/Users/demo/workspace\n');
});

test('macOS 用户取消 osascript 选择时返回 null', async () => {
  const picker = createSystemFolderPicker({
    platform: 'darwin',
    execFile() {
      return Promise.reject(
        new Error('Command failed: /usr/bin/osascript -e ... execution error: 用户已取消。 (-128)')
      );
    },
    isCommandAvailable: async () => false,
  });

  assert.equal(await picker.pickFolder(), null);
});
