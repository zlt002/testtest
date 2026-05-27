import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALLOWED_ORIGINS, HOST_NAME } from './constant';
import {
  getDevelopmentManifestDirectories,
  getDevHostInstallDir,
  getRegularBrowserTargets,
} from './dev-registration';

interface CollectTargetsOptions {
  platform: NodeJS.Platform;
  homeDir: string;
  appData?: string;
  localAppData?: string;
  tempDir?: string;
}

interface EvaluateManifestCheckInput {
  manifestPath: string;
  manifest: {
    name?: string;
    path?: string;
    allowed_origins?: string[];
  };
  expectedHostName: string;
  expectedOrigins: string[];
  expectedHostPath: string;
  hostPathExists: boolean;
  nodePathExists: boolean;
}

export interface ManifestCheckResult {
  manifestPath: string;
  ok: boolean;
  issues: string[];
}

export interface SelfCheckResult {
  ok: boolean;
  checked: ManifestCheckResult[];
  missingManifests: string[];
  expectedHostPath: string;
  expectedOrigins: string[];
}

export function collectSelfCheckManifestTargets({
  platform,
  homeDir,
  appData,
  localAppData,
  tempDir,
}: CollectTargetsOptions): string[] {
  const regularTargets = getRegularBrowserTargets({ platform, homeDir, appData }).map(
    (target) => target.manifestPath
  );
  const devTargets = getDevelopmentManifestDirectories({
    platform,
    homeDir,
    localAppData,
    tempDir,
  }).map((dir) => path.join(dir, `${HOST_NAME}.json`));

  return Array.from(new Set([...regularTargets, ...devTargets]));
}

export function evaluateManifestCheck(input: EvaluateManifestCheckInput): ManifestCheckResult {
  const issues: string[] = [];

  if (input.manifest.name !== input.expectedHostName) {
    issues.push(`host 名称不匹配: ${String(input.manifest.name || '')}`);
  }

  const actualOrigins = Array.isArray(input.manifest.allowed_origins)
    ? input.manifest.allowed_origins
    : [];
  for (const expectedOrigin of input.expectedOrigins) {
    if (!actualOrigins.includes(expectedOrigin)) {
      issues.push(`缺少白名单: ${expectedOrigin}`);
    }
  }

  if (input.manifest.path !== input.expectedHostPath) {
    issues.push(`host 路径与预期不一致: ${String(input.manifest.path || '')}`);
  }

  if (!input.hostPathExists) {
    issues.push('host 可执行文件不存在');
  }

  if (!input.nodePathExists) {
    issues.push('node_path.txt 不存在或指向无效 Node');
  }

  return {
    manifestPath: input.manifestPath,
    ok: issues.length === 0,
    issues,
  };
}

function readJsonFile(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveExpectedHostPath(platform: NodeJS.Platform): string {
  const installDir = getDevHostInstallDir({
    platform,
    homeDir: os.homedir(),
    localAppData: process.env.LOCALAPPDATA,
  });

  return path.join(installDir, 'dist', platform === 'win32' ? 'run_host.bat' : 'run_host.sh');
}

function resolveNodePathFile(expectedHostPath: string): string {
  return path.join(path.dirname(expectedHostPath), 'node_path.txt');
}

export function runNativeHostSelfCheck(): SelfCheckResult {
  const expectedHostPath = resolveExpectedHostPath(process.platform);
  const nodePathFile = resolveNodePathFile(expectedHostPath);
  const expectedOrigins = ALLOWED_ORIGINS;
  const targets = collectSelfCheckManifestTargets({
    platform: process.platform,
    homeDir: os.homedir(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    tempDir: os.tmpdir(),
  });

  const checked: ManifestCheckResult[] = [];
  const missingManifests: string[] = [];

  for (const manifestPath of targets) {
    if (!fs.existsSync(manifestPath)) {
      missingManifests.push(manifestPath);
      continue;
    }

    try {
      const manifest = readJsonFile(manifestPath);
      const nodePathValue = fs.existsSync(nodePathFile)
        ? fs.readFileSync(nodePathFile, 'utf8').trim()
        : '';
      checked.push(
        evaluateManifestCheck({
          manifestPath,
          manifest,
          expectedHostName: HOST_NAME,
          expectedOrigins,
          expectedHostPath,
          hostPathExists: fs.existsSync(expectedHostPath),
          nodePathExists: Boolean(nodePathValue) && fs.existsSync(nodePathValue),
        })
      );
    } catch (error) {
      checked.push({
        manifestPath,
        ok: false,
        issues: [`manifest 无法解析: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  return {
    ok: checked.every((item) => item.ok) && missingManifests.length < targets.length,
    checked,
    missingManifests,
    expectedHostPath,
    expectedOrigins,
  };
}
