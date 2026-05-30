import { spawn } from 'node:child_process';

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('Usage: node scripts/with-sdk-builtin.mjs <command> [...args]');
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    CLAUDE_CODE_USE_SDK_BUILTIN: 'true',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
