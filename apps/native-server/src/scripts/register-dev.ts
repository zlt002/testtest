import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { DEV_EXTENSION_ID, HOST_NAME } from './constant';
import {
  createNativeHostManifest,
  getDevelopmentManifestDirectories,
  getDevHostInstallDir,
  getRegularBrowserTargets,
  installDevHostBundle,
  type ManifestTarget,
} from './dev-registration';
import { colorText, mkdir, writeFile } from './utils';

const DIST_DIR = path.resolve(__dirname, '..');

export async function prepareDevNativeHost(): Promise<string> {
  const installDir = getDevHostInstallDir({
    platform: process.platform,
    homeDir: os.homedir(),
    localAppData: process.env.LOCALAPPDATA,
  });

  return installDevHostBundle({
    sourceDistDir: DIST_DIR,
    targetRootDir: installDir,
    nodeExecutablePath: process.execPath,
    platform: process.platform,
  });
}

export function createDevManifestContent(hostPath: string): any {
  return createNativeHostManifest(hostPath);
}

export function getChromeForTestingDataPaths(): string[] {
  return getDevelopmentManifestDirectories({
    platform: process.platform,
    homeDir: os.homedir(),
    localAppData: process.env.LOCALAPPDATA,
    tempDir: os.tmpdir(),
  });
}

function registerWindowsRegistryKey(registryKey: string, manifestPath: string): void {
  const escapedPath = manifestPath.replace(/\\/g, '\\\\');
  const regCommand = `reg add "${registryKey}" /ve /t REG_SZ /d "${escapedPath}" /f`;
  execSync(regCommand, { stdio: 'pipe' });
}

async function writeManifest(manifestPath: string, manifest: any): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function registerManifestTargets(targets: ManifestTarget[], manifest: any): Promise<boolean> {
  let success = false;

  for (const target of targets) {
    try {
      await writeManifest(target.manifestPath, manifest);
      if (target.registryKey && process.platform === 'win32') {
        registerWindowsRegistryKey(target.registryKey, target.manifestPath);
      }
      console.log(colorText(`✓ Registered manifest at: ${target.manifestPath}`, 'green'));
      success = true;
    } catch (error) {
      console.log(
        colorText(
          `⚠️ Failed to register at ${target.manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
          'yellow'
        )
      );
    }
  }

  return success;
}

export async function registerForChromeForTesting(manifest: any): Promise<boolean> {
  const targets = getChromeForTestingDataPaths().map((manifestDir) => ({
    manifestPath: path.join(manifestDir, `${HOST_NAME}.json`),
  }));

  return registerManifestTargets(targets, manifest);
}

export async function registerForRegularChrome(manifest: any): Promise<boolean> {
  const targets = getRegularBrowserTargets({
    platform: process.platform,
    homeDir: os.homedir(),
    appData: process.env.APPDATA,
  });

  return registerManifestTargets(targets, manifest);
}

async function main() {
  console.log(colorText('🚀 Registering native messaging host for development...', 'blue'));
  const hostPath = await prepareDevNativeHost();
  const manifest = createDevManifestContent(hostPath);
  console.log(colorText(`   Native host executable: ${hostPath}`, 'blue'));

  const regularSuccess = await registerForRegularChrome(manifest);
  const chromeForTestingSuccess = await registerForChromeForTesting(manifest);

  if (regularSuccess || chromeForTestingSuccess) {
    console.log(colorText('✅ Development registration complete!', 'green'));
    console.log(colorText(`   Using dev extension ID: ${DEV_EXTENSION_ID}`, 'blue'));
  } else {
    console.error(colorText('❌ Failed to register for any Chrome version', 'red'));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
