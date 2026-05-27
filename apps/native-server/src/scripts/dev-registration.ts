import fs from 'node:fs/promises';
import path from 'node:path';
import { ALLOWED_ORIGINS, DESCRIPTION, HOST_NAME } from './constant';

type SupportedPlatform = NodeJS.Platform;

interface BrowserTargetOptions {
  platform: SupportedPlatform;
  homeDir: string;
  appData?: string;
  localAppData?: string;
  tempDir?: string;
}

interface InstallDevHostBundleOptions {
  sourceDistDir: string;
  targetRootDir: string;
  nodeExecutablePath: string;
  platform: SupportedPlatform;
}

export interface ManifestTarget {
  manifestPath: string;
  registryKey?: string;
}

function pathFor(platform: SupportedPlatform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function createNativeHostManifest(hostPath: string) {
  return {
    name: HOST_NAME,
    description: DESCRIPTION,
    path: hostPath,
    type: 'stdio',
    allowed_origins: ALLOWED_ORIGINS,
  };
}

export function getDevHostInstallDir({
  platform,
  homeDir,
  localAppData,
}: Pick<BrowserTargetOptions, 'platform' | 'homeDir' | 'localAppData'>): string {
  const platformPath = pathFor(platform);

  if (platform === 'darwin') {
    return platformPath.join(
      homeDir,
      'Library',
      'Application Support',
      'chromemcp',
      'native-server'
    );
  }

  if (platform === 'win32') {
    return platformPath.join(
      localAppData || platformPath.join(homeDir, 'AppData', 'Local'),
      'chromemcp',
      'native-server'
    );
  }

  return platformPath.join(homeDir, '.local', 'share', 'chromemcp', 'native-server');
}

export function getRegularBrowserTargets({
  platform,
  homeDir,
  appData,
}: Pick<BrowserTargetOptions, 'platform' | 'homeDir' | 'appData'>): ManifestTarget[] {
  const platformPath = pathFor(platform);

  if (platform === 'darwin') {
    return [
      {
        manifestPath: platformPath.join(
          homeDir,
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`
        ),
      },
    ];
  }

  if (platform === 'win32') {
    const roaming = appData || platformPath.join(homeDir, 'AppData', 'Roaming');
    return [
      {
        manifestPath: platformPath.join(
          roaming,
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`
        ),
        registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        manifestPath: platformPath.join(
          roaming,
          'Microsoft',
          'Edge',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`
        ),
        registryKey: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      },
    ];
  }

  return [
    {
      manifestPath: platformPath.join(
        homeDir,
        '.config',
        'google-chrome',
        'NativeMessagingHosts',
        `${HOST_NAME}.json`
      ),
    },
  ];
}

export function getDevelopmentManifestDirectories({
  platform,
  homeDir,
  localAppData,
  tempDir,
}: Pick<BrowserTargetOptions, 'platform' | 'homeDir' | 'localAppData' | 'tempDir'>): string[] {
  const platformPath = pathFor(platform);
  const resolvedTempDir = tempDir || platformPath.join(homeDir, 'tmp');

  if (platform === 'darwin') {
    return [
      path.resolve(__dirname, '../../../extension/.wxt/chrome-data/NativeMessagingHosts'),
      platformPath.join(resolvedTempDir, 'wxt-chrome-data', 'NativeMessagingHosts'),
      platformPath.join(
        homeDir,
        'Library',
        'Application Support',
        'Chrome for Testing',
        'NativeMessagingHosts'
      ),
      platformPath.join(homeDir, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
      platformPath.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
      platformPath.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge Beta', 'NativeMessagingHosts'),
      platformPath.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge Dev', 'NativeMessagingHosts'),
      platformPath.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge Canary', 'NativeMessagingHosts'),
    ];
  }

  if (platform === 'win32') {
    const local = localAppData || platformPath.join(homeDir, 'AppData', 'Local');
    const roaming = platformPath.join(homeDir, 'AppData', 'Roaming');
    return [
      path.resolve(__dirname, '../../../extension/.wxt/chrome-data/NativeMessagingHosts'),
      platformPath.join(local, 'Temp', 'wxt-chrome-data', 'NativeMessagingHosts'),
      platformPath.join(roaming, 'Chrome for Testing', 'NativeMessagingHosts'),
      platformPath.join(roaming, 'Chromium', 'NativeMessagingHosts'),
    ];
  }

  return [
    path.resolve(__dirname, '../../../extension/.wxt/chrome-data/NativeMessagingHosts'),
    platformPath.join(resolvedTempDir, 'wxt-chrome-data', 'NativeMessagingHosts'),
    platformPath.join(homeDir, '.config', 'chrome-for-testing', 'NativeMessagingHosts'),
    platformPath.join(homeDir, '.config', 'chromium', 'NativeMessagingHosts'),
  ];
}

export async function installDevHostBundle({
  sourceDistDir,
  targetRootDir,
  nodeExecutablePath,
  platform,
}: InstallDevHostBundleOptions): Promise<string> {
  const wrapperName = platform === 'win32' ? 'run_host.bat' : 'run_host.sh';
  const wrapperPath = path.join(sourceDistDir, wrapperName);

  await fs.access(wrapperPath);

  const stagingRootDir = `${targetRootDir}_tmp`;
  const stagingDistDir = path.join(stagingRootDir, 'dist');
  const targetDistDir = path.join(targetRootDir, 'dist');
  await fs.rm(stagingRootDir, { recursive: true, force: true });
  await fs.mkdir(stagingRootDir, { recursive: true });
  await fs.cp(sourceDistDir, stagingDistDir, { recursive: true, force: true });
  await fs.writeFile(path.join(stagingDistDir, 'node_path.txt'), nodeExecutablePath);

  if (platform !== 'win32') {
    for (const executable of ['run_host.sh', 'index.js', 'cli.js']) {
      try {
        await fs.chmod(path.join(stagingDistDir, executable), 0o755);
      } catch {
        // Keep installation resilient when optional files are absent.
      }
    }

    await fs.rm(targetRootDir, { recursive: true, force: true });
    await fs.rename(stagingRootDir, targetRootDir);
    return path.join(targetRootDir, 'dist', wrapperName);
  }

  await fs.mkdir(targetDistDir, { recursive: true });
  await fs.cp(stagingDistDir, targetDistDir, { recursive: true, force: true });
  await fs.rm(stagingRootDir, { recursive: true, force: true });
  return path.join(targetDistDir, wrapperName);
}
