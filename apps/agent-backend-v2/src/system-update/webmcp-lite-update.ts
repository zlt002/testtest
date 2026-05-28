import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

export const WEBMCP_UPDATE_STATE_FILE = '.webmcp-update.json';
export const WEBMCP_UPDATE_SOURCE_CONFIG_FILE = '.webmcp-update-source.json';
export const DEFAULT_WEBMCP_WINDOWS_LITE_ZIP_URL =
  'https://git.midea.com/zhanglt21/claudecodeuibox/-/raw/main/accr-ui-windows-lite-x64.zip';
export const DEFAULT_WEBMCP_MAC_LITE_ZIP_URL =
  'https://git.midea.com/zhanglt21/claudecodeuibox/-/raw/main/accr-ui-mac-lite-arm64.zip';
export const DEFAULT_WEBMCP_LITE_PROJECT_URL =
  'https://git.midea.com/zhanglt21/claudecodeuibox/-/tree/main';
export const DEFAULT_LOCAL_TEST_WINDOWS_LITE_ZIP_URL =
  'http://127.0.0.1:8866/accr-ui-windows-lite-x64.zip';
export const DEFAULT_LOCAL_TEST_LITE_PROJECT_URL = 'http://127.0.0.1:8866/';

export type WebMcpLitePlatform = 'win32' | 'darwin';

export type FetchLike = (
  url: string,
  init?: Record<string, unknown>
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  buffer?: () => Promise<Buffer>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}>;

export type WebMcpLiteUpdateInfo = {
  updateAvailable: boolean;
  packageUrl: string;
  projectUrl: string;
  packageId: string | null;
  lastModified: string | null;
  currentPackageId?: string | null;
  distribution: string;
};

export type PreparedWebMcpLiteUpdate = {
  updateRoot: string;
  extractDir: string;
  updaterScriptPath: string;
};

type Distribution = {
  name: string;
  packageUrl: string;
  projectUrl: string;
  packageIdFallback: string;
  requiredPathSets: string[][];
};

type PrepareOptions = {
  appDir?: string;
  fetchImpl?: FetchLike;
  platform?: NodeJS.Platform | WebMcpLitePlatform;
  serverPid?: number;
};

type UpdateSourceConfig = {
  packageUrl?: unknown;
  projectUrl?: unknown;
  windowsLiteZipUrl?: unknown;
  macLiteZipUrl?: unknown;
};

function normalizePackageId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertSupportedPlatform(platform: NodeJS.Platform | WebMcpLitePlatform): WebMcpLitePlatform {
  if (platform === 'win32' || platform === 'darwin') {
    return platform;
  }
  throw new Error(`accr Lite 在线更新暂不支持 ${platform}。`);
}

async function readWebMcpLiteUpdateSourceConfig(appDir: string): Promise<UpdateSourceConfig | null> {
  try {
    const raw = await readFile(path.join(appDir, WEBMCP_UPDATE_SOURCE_CONFIG_FILE), 'utf8');
    const parsed = JSON.parse(raw) as UpdateSourceConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function resolvePackageUrlFromConfig(
  config: UpdateSourceConfig | null,
  platform: WebMcpLitePlatform
) {
  if (!config) {
    return null;
  }

  const platformSpecificValue =
    platform === 'win32' ? config.windowsLiteZipUrl : config.macLiteZipUrl;
  return normalizePackageId(platformSpecificValue) ?? normalizePackageId(config.packageUrl);
}

function resolveProjectUrlFromConfig(config: UpdateSourceConfig | null) {
  return config ? normalizePackageId(config.projectUrl) : null;
}

export async function getWebMcpLiteUpdateDistribution({
  appDir = defaultAppDir(),
  platform = process.platform,
}: {
  appDir?: string;
  platform?: NodeJS.Platform | WebMcpLitePlatform;
} = {}): Promise<Distribution> {
  const currentPlatform = assertSupportedPlatform(platform);
  const localConfig = await readWebMcpLiteUpdateSourceConfig(appDir);
  if (currentPlatform === 'win32') {
    return {
      name: 'windows-lite',
      packageUrl:
        resolvePackageUrlFromConfig(localConfig, currentPlatform) ??
        normalizePackageId(process.env.WEBMCP_WINDOWS_LITE_ZIP_URL) ??
        DEFAULT_WEBMCP_WINDOWS_LITE_ZIP_URL,
      projectUrl:
        resolveProjectUrlFromConfig(localConfig) ??
        normalizePackageId(process.env.WEBMCP_LITE_PROJECT_URL) ??
        DEFAULT_WEBMCP_LITE_PROJECT_URL,
      packageIdFallback: 'accr-ui-windows-lite-x64.zip',
      requiredPathSets: [
        ['install.hta', 'payload.zip'],
        ['install.ps1', 'install.vbs', 'payload.zip'],
      ],
    };
  }

  return {
    name: 'mac-lite',
    packageUrl:
      resolvePackageUrlFromConfig(localConfig, currentPlatform) ??
      normalizePackageId(process.env.WEBMCP_MAC_LITE_ZIP_URL) ??
      DEFAULT_WEBMCP_MAC_LITE_ZIP_URL,
    projectUrl:
      resolveProjectUrlFromConfig(localConfig) ??
      normalizePackageId(process.env.WEBMCP_LITE_PROJECT_URL) ??
      DEFAULT_WEBMCP_LITE_PROJECT_URL,
    packageIdFallback: 'accr-ui-mac-lite-arm64.zip',
    requiredPathSets: [[
      'extension/manifest.json',
      'native-server/runtime.cjs',
      'agent-backend-v2/server.cjs',
      'vendor/claude-agent-sdk/cli.js',
      'start.command',
      'stop.command',
      'run_native_host.command',
    ]],
  };
}

function defaultAppDir() {
  return process.env.WEBMCP_REPO_ROOT || process.cwd();
}

function toZipPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '');
}

export function isZipDirectoryPlaceholderPath(value: string) {
  return toZipPath(value).endsWith('/');
}

function hasUnsafePathSegment(value: string) {
  return toZipPath(value)
    .split('/')
    .some((segment) => segment === '..');
}

function assertSafeZipEntry(entry: JSZip.JSZipObject & { unsafeOriginalName?: string }) {
  const names = [entry.name, entry.unsafeOriginalName].filter(Boolean) as string[];
  for (const name of names) {
    if (hasUnsafePathSegment(name)) {
      throw new Error(`Unsafe zip entry path: ${name}`);
    }
  }
}

function getCommonRootPrefix(entries: string[]): string {
  const roots = new Set<string>();
  for (const entry of entries) {
    const [first, ...rest] = entry.split('/');
    if (!first || rest.length === 0) {
      return '';
    }
    roots.add(first);
  }
  return roots.size === 1 ? `${[...roots][0]}/` : '';
}

function normalizedArchiveEntries(zip: JSZip, requiredPathSets: string[][]) {
  const rawEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isZipDirectoryPlaceholderPath(entry.name)
  );
  for (const entry of rawEntries) {
    assertSafeZipEntry(entry);
  }

  const entries = rawEntries.map((entry) => toZipPath(entry.name));
  const commonRootPrefix = getCommonRootPrefix(entries);
  const requiredPaths = requiredPathSets.flat();
  const strippedEntries = entries.map((entry) =>
    commonRootPrefix && entry.startsWith(commonRootPrefix)
      ? entry.slice(commonRootPrefix.length)
      : entry
  );
  return requiredPaths.some((requiredPath) => strippedEntries.includes(requiredPath))
    ? strippedEntries
    : entries;
}

export async function validateWebMcpLiteZip(
  zipBuffer: Buffer,
  {
    appDir = defaultAppDir(),
    platform = process.platform,
  }: {
    appDir?: string;
    platform?: NodeJS.Platform | WebMcpLitePlatform;
  } = {}
) {
  const distribution = await getWebMcpLiteUpdateDistribution({ appDir, platform });
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = new Set(normalizedArchiveEntries(zip, distribution.requiredPathSets));
  const missingBySet = distribution.requiredPathSets.map((requiredPaths) =>
    requiredPaths.filter((requiredPath) => !entries.has(requiredPath))
  );
  const missingPaths = missingBySet.reduce((best, current) =>
    current.length < best.length ? current : best
  );
  return { valid: missingPaths.length === 0, missingPaths };
}

export async function fetchWebMcpLiteUpdateInfo(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  {
    appDir = defaultAppDir(),
    platform = process.platform,
  }: {
    appDir?: string;
    platform?: NodeJS.Platform | WebMcpLitePlatform;
  } = {}
): Promise<WebMcpLiteUpdateInfo> {
  const distribution = await getWebMcpLiteUpdateDistribution({ appDir, platform });
  let response = await fetchImpl(distribution.packageUrl, { method: 'HEAD' });
  if (response.status === 405) {
    response = await fetchImpl(distribution.packageUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
  }

  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) {
      return {
        updateAvailable: false,
        packageUrl: distribution.packageUrl,
        projectUrl: distribution.projectUrl,
        packageId: null,
        lastModified: null,
        distribution: distribution.name,
      };
    }
    throw new Error(`accr Lite 更新包不可访问: ${response.status}`);
  }

  const lastModified = response.headers.get('last-modified');
  return {
    updateAvailable: true,
    packageUrl: distribution.packageUrl,
    projectUrl: distribution.projectUrl,
    packageId: response.headers.get('etag') || lastModified || distribution.packageIdFallback,
    lastModified,
    distribution: distribution.name,
  };
}

async function responseToBuffer(response: Awaited<ReturnType<FetchLike>>) {
  if (typeof response.buffer === 'function') {
    return response.buffer();
  }
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('读取 accr Lite 更新包响应内容失败。');
}

function looksLikeHtmlDocument(buffer: Buffer) {
  const prefix = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return (
    prefix.startsWith('<!doctype html') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<?xml') ||
    prefix.includes('<head') ||
    prefix.includes('<body')
  );
}

function assertDownloadedPackageLooksLikeZip({
  packageUrl,
  response,
  zipBuffer,
}: {
  packageUrl: string;
  response: Awaited<ReturnType<FetchLike>>;
  zipBuffer: Buffer;
}) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isLikelyHtml =
    contentType.includes('text/html') ||
    contentType.includes('text/plain') ||
    packageUrl.includes('/-/blob/') ||
    looksLikeHtmlDocument(zipBuffer);

  if (isLikelyHtml) {
    throw new Error(
      '更新地址返回的不是 zip 文件，请将 windowsLiteZipUrl 改为可直接下载的 raw/download 链接。'
    );
  }
}

async function extractWebMcpLiteZip(zipBuffer: Buffer, extractDir: string) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const rawEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isZipDirectoryPlaceholderPath(entry.name)
  );
  for (const entry of rawEntries) {
    assertSafeZipEntry(entry);
  }
  const entries = rawEntries.map((entry) => toZipPath(entry.name));
  const commonRootPrefix = getCommonRootPrefix(entries);
  const strippedEntries = entries.map((entry) =>
    commonRootPrefix && entry.startsWith(commonRootPrefix)
      ? entry.slice(commonRootPrefix.length)
      : entry
  );
  const shouldStripCommonRoot = strippedEntries.includes('extension/manifest.json');
  const payloadEntry = rawEntries.find((entry, index) => {
    const stripped = strippedEntries[index];
    return stripped === 'payload.zip' || toZipPath(entry.name) === 'payload.zip';
  });

  if (payloadEntry) {
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    const payloadBuffer = await payloadEntry.async('nodebuffer');
    return extractWebMcpLiteZip(payloadBuffer, extractDir);
  }

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  for (const entry of rawEntries) {
    let relativePath = toZipPath(entry.name);
    if (shouldStripCommonRoot && commonRootPrefix && relativePath.startsWith(commonRootPrefix)) {
      relativePath = relativePath.slice(commonRootPrefix.length);
    }
    if (!relativePath) {
      continue;
    }

    const targetPath = path.resolve(extractDir, relativePath);
    const normalizedExtractDir = path.resolve(extractDir);
    if (!targetPath.startsWith(`${normalizedExtractDir}${path.sep}`)) {
      throw new Error(`Unsafe zip entry target: ${relativePath}`);
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await entry.async('nodebuffer'));
  }
}

async function readInstalledPackageId(appDir: string) {
  try {
    const state = JSON.parse(await readFile(path.join(appDir, WEBMCP_UPDATE_STATE_FILE), 'utf8'));
    return normalizePackageId(state?.packageId);
  } catch {
    return null;
  }
}

async function preserveExtensionIdentity(appDir: string, extractDir: string) {
  const currentManifestPath = path.join(appDir, 'extension', 'manifest.json');
  const nextManifestPath = path.join(extractDir, 'extension', 'manifest.json');
  try {
    const currentManifest = JSON.parse(await readFile(currentManifestPath, 'utf8'));
    const manifestKey = normalizePackageId(currentManifest?.key);
    if (manifestKey) {
      const nextManifest = JSON.parse(await readFile(nextManifestPath, 'utf8'));
      nextManifest.key = manifestKey;
      await writeFile(nextManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    }
  } catch {
    // Identity preservation is best effort; missing local files should not block first install.
  }

  const manifestKeyPath = path.join(appDir, 'extension', 'manifest.json.key');
  if (existsSync(manifestKeyPath)) {
    await copyFile(manifestKeyPath, path.join(extractDir, 'extension', 'manifest.json.key'));
  }

  const extensionIdPath = path.join(appDir, 'extension-id.txt');
  if (existsSync(extensionIdPath)) {
    await copyFile(extensionIdPath, path.join(extractDir, 'extension-id.txt'));
  }
}

async function writeUpdateState({
  extractDir,
  platform,
  updateInfo,
}: {
  extractDir: string;
  platform: WebMcpLitePlatform;
  updateInfo: WebMcpLiteUpdateInfo;
}) {
  await writeFile(
    path.join(extractDir, WEBMCP_UPDATE_STATE_FILE),
    `${JSON.stringify(
      {
        packageId: updateInfo.packageId,
        lastModified: updateInfo.lastModified,
        packageUrl: updateInfo.packageUrl,
        projectUrl: updateInfo.projectUrl,
        distribution: updateInfo.distribution,
        platform,
        preparedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildWindowsLiteUpdaterScript({
  appDir,
  extractDir,
  serverPid,
}: {
  appDir: string;
  extractDir: string;
  serverPid: number;
}) {
  return [
    '@echo off',
    'setlocal',
    'chcp 65001 >nul',
    'echo [INFO] Stopping accr Lite services...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = 12306,8792; foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } }"',
    `taskkill /PID ${serverPid} /F >nul 2>nul`,
    'timeout /t 2 /nobreak >nul',
    'echo [INFO] Copying accr Lite update files...',
    `robocopy "${extractDir}" "${appDir}" /E /NFL /NDL /NJH /NJS /NP /XD workspace logs .webmcp /XF .mcp.json .webmcp-update.json guide-state.json >nul`,
    'set "ROBOCOPY_EXIT=%ERRORLEVEL%"',
    'if %ROBOCOPY_EXIT% GEQ 8 (',
    '  echo [ERROR] Failed to copy update files. Robocopy exit code: %ROBOCOPY_EXIT%',
    '  pause',
    '  exit /b %ROBOCOPY_EXIT%',
    ')',
    `copy /Y "${extractDir}\\${WEBMCP_UPDATE_STATE_FILE}" "${appDir}\\${WEBMCP_UPDATE_STATE_FILE}" >nul`,
    `echo {"completed": true}>"${appDir}\\guide-state.json"`,
    'echo [INFO] Restarting accr Lite...',
    `start "" "${appDir}\\runtime\\start.vbs"`,
    `if exist "${appDir}\\runtime\\release-notes.html" start "" "${appDir}\\runtime\\release-notes.html"`,
    'endlocal',
    'exit /b 0',
    '',
  ].join('\r\n');
}

export function buildMacLiteUpdaterScript({
  appDir,
  extractDir,
  serverPid,
}: {
  appDir: string;
  extractDir: string;
  serverPid: number;
}) {
  const quotedAppDir = shellSingleQuote(appDir);
  const quotedExtractDir = shellSingleQuote(`${extractDir}/`);
  const quotedStateSource = shellSingleQuote(path.posix.join(extractDir, WEBMCP_UPDATE_STATE_FILE));
  const quotedStateTarget = shellSingleQuote(path.posix.join(appDir, WEBMCP_UPDATE_STATE_FILE));
  const quotedStartCommand = shellSingleQuote(path.posix.join(appDir, 'start.command'));
  const quotedStopCommand = shellSingleQuote(path.posix.join(appDir, 'stop.command'));
  const quotedNativeHostCommand = shellSingleQuote(path.posix.join(appDir, 'run_native_host.command'));

  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'echo "[INFO] Stopping accr Lite services..."',
    'for port in 12306 8792; do',
    '  PIDS="$(lsof -ti tcp:"$port" || true)"',
    '  if [ -n "$PIDS" ]; then kill $PIDS || true; fi',
    'done',
    `kill ${serverPid} >/dev/null 2>&1 || true`,
    'sleep 2',
    'echo "[INFO] Copying accr Lite update files..."',
    `rsync -a --delete --exclude 'workspace/' --exclude 'logs/' --exclude '.webmcp/' --exclude '.mcp.json' --exclude '${WEBMCP_UPDATE_STATE_FILE}' ${quotedExtractDir} ${quotedAppDir}/`,
    `cp ${quotedStateSource} ${quotedStateTarget}`,
    `chmod +x ${quotedStartCommand} ${quotedStopCommand} ${quotedNativeHostCommand}`,
    'echo "[INFO] Restarting accr Lite..."',
    `nohup /bin/bash ${quotedStartCommand} >/dev/null 2>&1 &`,
    '',
  ].join('\n');
}

export async function prepareWebMcpLiteUpdate({
  appDir = defaultAppDir(),
  fetchImpl = fetch as unknown as FetchLike,
  platform = process.platform,
  serverPid = process.pid,
}: PrepareOptions = {}): Promise<PreparedWebMcpLiteUpdate> {
  const currentPlatform = assertSupportedPlatform(platform);
  const distribution = await getWebMcpLiteUpdateDistribution({ appDir, platform: currentPlatform });
  const updateInfo = await fetchWebMcpLiteUpdateInfo(fetchImpl, {
    appDir,
    platform: currentPlatform,
  });
  if (!updateInfo.updateAvailable) {
    throw new Error('当前没有可用的 accr Lite 更新包。');
  }

  const currentPackageId = await readInstalledPackageId(appDir);
  const remotePackageId = normalizePackageId(updateInfo.packageId);
  if (currentPackageId && remotePackageId && currentPackageId === remotePackageId) {
    throw new Error('当前已安装最新的 accr Lite 更新包。');
  }

  const response = await fetchImpl(distribution.packageUrl);
  if (!response.ok) {
    throw new Error(`下载 accr Lite 更新包失败: ${response.status}`);
  }

  const zipBuffer = await responseToBuffer(response);
  assertDownloadedPackageLooksLikeZip({
    packageUrl: distribution.packageUrl,
    response,
    zipBuffer,
  });
  const validation = await validateWebMcpLiteZip(zipBuffer, { appDir, platform: currentPlatform });
  if (!validation.valid) {
    throw new Error(`accr Lite 更新包无效，缺少: ${validation.missingPaths.join(', ')}`);
  }

  const updateRoot = await mkdtemp(path.join(tmpdir(), 'webmcp-lite-update-'));
  const extractDir = path.join(updateRoot, 'package');
  const updaterScriptPath = path.join(
    updateRoot,
    currentPlatform === 'win32' ? 'apply-update.cmd' : 'apply-update.sh'
  );

  await extractWebMcpLiteZip(zipBuffer, extractDir);
  await preserveExtensionIdentity(appDir, extractDir);
  await writeUpdateState({ extractDir, platform: currentPlatform, updateInfo });
  await writeFile(
    updaterScriptPath,
    currentPlatform === 'win32'
      ? buildWindowsLiteUpdaterScript({ appDir, extractDir, serverPid })
      : buildMacLiteUpdaterScript({ appDir, extractDir, serverPid }),
    'utf8'
  );
  if (currentPlatform === 'darwin') {
    await chmod(updaterScriptPath, 0o755);
  }

  return {
    updateRoot,
    extractDir,
    updaterScriptPath,
  };
}

export function launchWebMcpLiteUpdater(
  updaterScriptPath: string,
  { platform = process.platform }: { platform?: NodeJS.Platform | WebMcpLitePlatform } = {}
) {
  const currentPlatform = assertSupportedPlatform(platform);
  const child =
    currentPlatform === 'win32'
      ? spawn('cmd.exe', ['/c', updaterScriptPath], { detached: true, stdio: 'ignore' })
      : spawn('/bin/bash', [updaterScriptPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

export function createWebMcpLiteUpdateService({
  appDir = defaultAppDir(),
  fetchImpl = fetch as unknown as FetchLike,
  platform = process.platform,
  serverPid = process.pid,
}: PrepareOptions = {}) {
  const currentPlatform = assertSupportedPlatform(platform);
  return {
    async getUpdateStatus() {
      const updateInfo = await fetchWebMcpLiteUpdateInfo(fetchImpl, {
        appDir,
        platform: currentPlatform,
      });
      const currentPackageId = await readInstalledPackageId(appDir);
      const remotePackageId = normalizePackageId(updateInfo.packageId);
      return {
        ...updateInfo,
        updateAvailable:
          updateInfo.updateAvailable &&
          !(currentPackageId && remotePackageId && currentPackageId === remotePackageId),
        currentPackageId,
      };
    },
    prepareUpdate() {
      return prepareWebMcpLiteUpdate({ appDir, fetchImpl, platform: currentPlatform, serverPid });
    },
    launchUpdater(updaterScriptPath: string) {
      launchWebMcpLiteUpdater(updaterScriptPath, { platform: currentPlatform });
    },
  };
}
