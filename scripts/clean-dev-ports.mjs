import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PORTS = [8792, 12306, 3000, 3001];
const ports = process.argv
  .slice(2)
  .flatMap((value) => value.split(','))
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);

const targetPorts = ports.length > 0 ? ports : DEFAULT_PORTS;

async function findNativeHostPids() {
  if (process.platform !== 'win32') {
    return [];
  }

  const nativeDistPath = new URL('../apps/native-server/dist/', import.meta.url)
    .pathname.replace(/^\/([A-Za-z]:)/, '$1')
    .replace(/\//g, '\\');
  const escapedNativeDistPath = nativeDistPath.replace(/'/g, "''");
  const script = [
    'Get-CimInstance Win32_Process',
    `| Where-Object { $_.CommandLine -like '*${escapedNativeDistPath}*' }`,
    '| Select-Object -ExpandProperty ProcessId',
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    script,
  ]);

  return stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
}

async function findPids(port) {
  if (process.platform === 'win32') {
    const script = [
      'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue',
      `| Where-Object { $_.LocalPort -eq ${port} }`,
      '| Select-Object -ExpandProperty OwningProcess',
    ].join(' ');

    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      script,
    ]);

    return stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`]);
    return stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return [];
    }
    throw error;
  }
}

async function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

for (const port of targetPorts) {
  const pids = [...new Set(await findPids(port))];
  if (pids.length === 0) {
    console.log(`[dev-ports] ${port}: free`);
    continue;
  }

  console.log(`[dev-ports] ${port}: stopping ${pids.join(', ')}`);
  await killPids(pids, 'SIGTERM');
  await wait(500);

  const remaining = [...new Set(await findPids(port))].filter((pid) => pids.includes(pid));
  if (remaining.length > 0) {
    console.log(`[dev-ports] ${port}: force stopping ${remaining.join(', ')}`);
    await killPids(remaining, 'SIGKILL');
  }
}

const nativeHostPids = [...new Set(await findNativeHostPids())];
if (nativeHostPids.length === 0) {
  console.log('[dev-ports] native host: free');
} else {
  console.log(`[dev-ports] native host: stopping ${nativeHostPids.join(', ')}`);
  await killPids(nativeHostPids, 'SIGTERM');
  await wait(500);

  const remaining = [...new Set(await findNativeHostPids())].filter((pid) =>
    nativeHostPids.includes(pid)
  );
  if (remaining.length > 0) {
    console.log(`[dev-ports] native host: force stopping ${remaining.join(', ')}`);
    await killPids(remaining, 'SIGKILL');
  }
}
