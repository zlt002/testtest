import { execFile as nodeExecFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { HttpError } from '../shared/errors.ts';

type ExecFile = (
  command: string,
  args: string[],
  options?: {
    encoding?: BufferEncoding;
    windowsHide?: boolean;
    maxBuffer?: number;
  }
) => Promise<string>;

type IsCommandAvailable = (command: string) => Promise<boolean>;

function unsupportedPicker(): never {
  throw new HttpError(
    501,
    'System folder picker is not supported on this platform',
    'workspace_picker_unsupported'
  );
}

async function defaultExecFile(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    windowsHide?: boolean;
    maxBuffer?: number;
  } = {}
): Promise<string> {
  return await execPickerCommand(command, args, options);
}

export async function execPickerCommand(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    windowsHide?: boolean;
    maxBuffer?: number;
  } = {}
): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    nodeExecFile(
      command,
      args,
      {
        encoding: options.encoding ?? 'utf8',
        windowsHide: options.windowsHide ?? true,
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(String(stdout || ''));
      }
    );
  });
}

async function defaultIsCommandAvailable(command: string) {
  const pathValue = process.env.PATH || '';
  const directories = pathValue.split(':').filter(Boolean);
  for (const directory of directories) {
    try {
      await access(`${directory}/${command}`);
      return true;
    } catch {}
  }
  return false;
}

function normalizePickedPath(stdout: string): string | null {
  const selectedPath = stdout.trim();
  return selectedPath || null;
}

function isMacPickerCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('(-128)') ||
    message.includes('用户已取消') ||
    message.includes('User canceled')
  );
}

async function pickWindowsFolder(execFile: ExecFile): Promise<string | null> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1, 1)',
    '$owner.ShowInTaskbar = $false',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
    '$owner.Opacity = 0',
    '$owner.TopMost = $true',
    '$owner.Show()',
    '$owner.Activate()',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择本地工作区'",
    '$dialog.ShowNewFolderButton = $true',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  [Console]::Write($dialog.SelectedPath)',
    '}',
  ].join('; ');
  return normalizePickedPath(
    await execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
  );
}

async function pickMacFolder(execFile: ExecFile): Promise<string | null> {
  const script = [
    'set chosenFolder to choose folder with prompt "选择本地工作区"',
    'POSIX path of chosenFolder',
  ].join('\n');
  try {
    return normalizePickedPath(await execFile('/usr/bin/osascript', ['-e', script]));
  } catch (error) {
    if (isMacPickerCancelled(error)) {
      return null;
    }
    throw error;
  }
}

async function pickLinuxFolder(
  execFile: ExecFile,
  isCommandAvailable: IsCommandAvailable
): Promise<string | null> {
  if (await isCommandAvailable('zenity')) {
    return normalizePickedPath(
      await execFile('zenity', ['--file-selection', '--directory', '--title=选择本地工作区'])
    );
  }
  if (await isCommandAvailable('kdialog')) {
    return normalizePickedPath(
      await execFile('kdialog', ['--getexistingdirectory', '--title', '选择本地工作区'])
    );
  }
  unsupportedPicker();
}

export function createSystemFolderPicker(
  input: {
    platform?: NodeJS.Platform;
    execFile?: ExecFile;
    isCommandAvailable?: IsCommandAvailable;
  } = {}
) {
  const platform = input.platform ?? process.platform;
  const execFile = input.execFile ?? defaultExecFile;
  const isCommandAvailable = input.isCommandAvailable ?? defaultIsCommandAvailable;

  return {
    async pickFolder(): Promise<string | null> {
      if (platform === 'win32') {
        return await pickWindowsFolder(execFile);
      }
      if (platform === 'darwin') {
        return await pickMacFolder(execFile);
      }
      if (platform === 'linux') {
        return await pickLinuxFolder(execFile, isCommandAvailable);
      }
      unsupportedPicker();
    },
  };
}
