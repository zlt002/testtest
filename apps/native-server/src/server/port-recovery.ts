import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function isManagedNativeServerCommand(commandLine: string): boolean {
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('/chromemcp/native-server/') &&
    (normalized.includes('/dist/index.js') ||
      normalized.includes('/dist/run_host.sh') ||
      normalized.includes('/dist/run_host.bat'))
  );
}

type ProbeDiscoveryResult = {
  ok: boolean;
  url: string;
};

type RecoverNativeServerPortConflictOptions = {
  port: number;
  currentPid?: number;
  listListeningPids?: (port: number) => Promise<number[]>;
  readCommandLine?: (pid: number) => Promise<string>;
  terminateProcess?: (pid: number) => Promise<void>;
  probeDiscovery?: (port: number) => Promise<ProbeDiscoveryResult | null>;
};

async function defaultProbeDiscovery(port: number): Promise<ProbeDiscoveryResult | null> {
  const url = `http://127.0.0.1:${port}/discovery`;
  try {
    const response = await fetch(url);
    return {
      ok: response.ok,
      url,
    };
  } catch {
    return null;
  }
}

async function defaultListListeningPids(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const script = [
      'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue',
      `| Where-Object { $_.LocalPort -eq ${port} }`,
      '| Select-Object -ExpandProperty OwningProcess',
    ].join(' ');

    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    return stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    return stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return [];
    }
    throw error;
  }
}

async function defaultReadCommandLine(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    const script = [
      'Get-CimInstance Win32_Process',
      `| Where-Object { $_.ProcessId -eq ${pid} }`,
      '| Select-Object -ExpandProperty CommandLine',
    ].join(' ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    return stdout.trim();
  }

  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
  return stdout.trim();
}

async function defaultTerminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') {
      throw error;
    }
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') {
      throw error;
    }
  }
}

export async function recoverNativeServerPortConflict({
  port,
  currentPid = process.pid,
  listListeningPids = defaultListListeningPids,
  readCommandLine = defaultReadCommandLine,
  terminateProcess = defaultTerminateProcess,
  probeDiscovery = defaultProbeDiscovery,
}: RecoverNativeServerPortConflictOptions): Promise<boolean> {
  const discovery = await probeDiscovery(port);
  if (discovery?.ok) {
    console.warn(`[native] Existing discovery endpoint responded on ${discovery.url}; checking whether the owner is a stale managed native-server process.`);
  }

  const pids = [...new Set(await listListeningPids(port))].filter((pid) => pid !== currentPid);
  const managedPids: number[] = [];

  for (const pid of pids) {
    try {
      const commandLine = await readCommandLine(pid);
      if (isManagedNativeServerCommand(commandLine)) {
        managedPids.push(pid);
      }
    } catch (error) {
      console.warn(`[native] Failed to inspect pid ${pid} for port recovery:`, error);
    }
  }

  if (managedPids.length === 0) {
    return false;
  }

  for (const pid of managedPids) {
    await terminateProcess(pid);
  }

  return true;
}
