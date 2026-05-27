import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';

type BackupDirFn = (
  targetDir: string,
  backupRootDir: string,
  keepBackupCount: number
) => Promise<string>;

type FileExistsFn = (path: string) => Promise<boolean>;
type CopyDirFn = (from: string, to: string) => Promise<void>;
type ReadFileFn = typeof readFile;
type RemoveDirFn = (path: string) => Promise<void>;
type ExecFileAsyncFn = (command: string, args: string[]) => Promise<void>;

export type LocalSyncApplyResult = {
  backupPath: string;
  removedSkills: string[];
};

function backupFilename(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '_').slice(0, 19);
  return `claude-backup-${timestamp}.tar.gz`;
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function defaultBackupDir(
  targetDir: string,
  backupRootDir: string,
  keepBackupCount: number,
  now: Date,
  runExecFile: ExecFileAsyncFn
): Promise<string> {
  await mkdir(backupRootDir, { recursive: true });
  const backupPath = join(backupRootDir, backupFilename(now));
  await runExecFile('tar', [
    '--exclude=.claude/.oauth_refresh.lock',
    '-czf',
    backupPath,
    '-C',
    dirname(targetDir),
    basename(targetDir),
  ]);

  const files = await readdir(backupRootDir);
  const backups = await Promise.all(
    files
      .filter((file) => file.startsWith('claude-backup-') && file.endsWith('.tar.gz'))
      .map(async (file) => ({
        file,
        path: join(backupRootDir, file),
        mtimeMs: (await stat(join(backupRootDir, file))).mtimeMs,
      }))
  );
  backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await Promise.all(backups.slice(keepBackupCount).map((item) => rm(item.path, { force: true })));

  return backupPath;
}

function parseRemoveSkills(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let inRemoveSkills = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (!inRemoveSkills) {
      if (trimmed === 'remove_skills:' || trimmed.startsWith('remove_skills:')) {
        inRemoveSkills = true;
      }
      continue;
    }

    if (!rawLine.startsWith(' ') && !rawLine.startsWith('\t') && !trimmed.startsWith('-')) {
      break;
    }

    if (trimmed.startsWith('-')) {
      const skillName = trimmed.slice(1).trim();
      if (skillName) {
        result.push(skillName);
      }
    }
  }

  return result;
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryContents(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    await cp(join(from, entry.name), join(to, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

export function createLocalSyncFiles(input?: {
  homeDir?: string;
  now?: () => Date;
  backupDir?: BackupDirFn;
  copyDir?: CopyDirFn;
  readFile?: ReadFileFn;
  removeDir?: RemoveDirFn;
  fileExists?: FileExistsFn;
  execFileAsync?: ExecFileAsyncFn;
}) {
  const homeDir = input?.homeDir ?? homedir();
  const now = input?.now ?? (() => new Date());
  const runExecFile = input?.execFileAsync ?? execFileAsync;
  const backupRootDir = join(homeDir, '.annto-claude-code', 'backups');
  const backupDir =
    input?.backupDir ??
    ((targetDir: string, backupDirPath: string, keepBackupCount: number) =>
      defaultBackupDir(targetDir, backupDirPath, keepBackupCount, now(), runExecFile));
  const copyDir = input?.copyDir ?? copyDirectoryContents;
  const fileExists = input?.fileExists ?? defaultFileExists;
  const removeDir = input?.removeDir ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const readText = input?.readFile ?? readFile;

  return {
    async apply(inputValue: {
      extractedDir: string;
      targetDir: string;
      keepBackupCount: number;
    }): Promise<LocalSyncApplyResult> {
      const backupPath = (await fileExists(inputValue.targetDir))
        ? await backupDir(inputValue.targetDir, backupRootDir, inputValue.keepBackupCount)
        : '';
      const sourceDir = (await fileExists(join(inputValue.extractedDir, '.claude')))
        ? join(inputValue.extractedDir, '.claude')
        : inputValue.extractedDir;
      await copyDir(sourceDir, inputValue.targetDir);

      const blacklistPath = join(sourceDir, '.skillBlackList.yaml');
      const removedSkills: string[] = [];

      if (await fileExists(blacklistPath)) {
        const content = await readText(blacklistPath, 'utf8');
        for (const skillName of parseRemoveSkills(content)) {
          const skillPath = join(inputValue.targetDir, 'skills', skillName);
          if (await fileExists(skillPath)) {
            await removeDir(skillPath);
            removedSkills.push(skillName);
          }
        }
      }

      return {
        backupPath,
        removedSkills,
      };
    },
  };
}

export { parseRemoveSkills };
