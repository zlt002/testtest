import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getDevelopmentManifestDirectories,
  getRegularBrowserTargets,
  installDevHostBundle,
} from './dev-registration';

describe('dev registration helpers', () => {
  it('installs a dev host bundle on macOS without requiring the Windows wrapper', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-host-dev-install-'));
    const sourceDistDir = path.join(root, 'source-dist');
    const targetRootDir = path.join(root, 'target-root');

    await fs.mkdir(path.join(sourceDistDir, 'mcp'), { recursive: true });
    await fs.writeFile(path.join(sourceDistDir, 'index.js'), 'console.log("index");\n');
    await fs.writeFile(path.join(sourceDistDir, 'cli.js'), 'console.log("cli");\n');
    await fs.writeFile(path.join(sourceDistDir, 'run_host.sh'), '#!/usr/bin/env bash\n');
    await fs.writeFile(path.join(sourceDistDir, 'mcp', 'stdio-config.json'), '{}\n');

    const hostPath = await installDevHostBundle({
      sourceDistDir,
      targetRootDir,
      nodeExecutablePath: '/opt/homebrew/bin/node',
      platform: 'darwin',
    });

    expect(hostPath).toBe(path.join(targetRootDir, 'dist', 'run_host.sh'));
    await expect(fs.readFile(path.join(targetRootDir, 'dist', 'node_path.txt'), 'utf8')).resolves.toBe(
      '/opt/homebrew/bin/node'
    );
    await expect(fs.readFile(path.join(targetRootDir, 'dist', 'run_host.sh'), 'utf8')).resolves.toContain(
      '#!/usr/bin/env bash'
    );
  });

  it('includes Chrome and Edge registry targets for regular Windows browsers', () => {
    expect(
      getRegularBrowserTargets({
        platform: 'win32',
        homeDir: 'C:\\Users\\alice',
        appData: 'C:\\Users\\alice\\AppData\\Roaming',
      })
    ).toEqual([
      {
        manifestPath:
          'C:\\Users\\alice\\AppData\\Roaming\\Google\\Chrome\\NativeMessagingHosts\\com.chromemcp.nativehost.json',
        registryKey: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.chromemcp.nativehost',
      },
      {
        manifestPath:
          'C:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Edge\\NativeMessagingHosts\\com.chromemcp.nativehost.json',
        registryKey: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.chromemcp.nativehost',
      },
    ]);
  });

  it('installs a dev host bundle on Windows by updating the target dist directory in place', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-host-dev-install-win-'));
    const sourceDistDir = path.join(root, 'source-dist');
    const targetRootDir = path.join(root, 'target-root');

    await fs.mkdir(path.join(sourceDistDir, 'mcp'), { recursive: true });
    await fs.writeFile(path.join(sourceDistDir, 'index.js'), 'console.log("bundled-index");\n');
    await fs.writeFile(path.join(sourceDistDir, 'cli.js'), 'console.log("bundled-cli");\n');
    await fs.writeFile(path.join(sourceDistDir, 'run_host.bat'), '@echo off\r\necho host\r\n');
    await fs.writeFile(path.join(sourceDistDir, 'mcp', 'stdio-config.json'), '{}\n');

    await fs.mkdir(path.join(targetRootDir, 'dist', 'logs'), { recursive: true });
    await fs.writeFile(path.join(targetRootDir, 'dist', 'logs', 'existing.log'), 'keep me\n');

    const hostPath = await installDevHostBundle({
      sourceDistDir,
      targetRootDir,
      nodeExecutablePath: 'C:\\node\\node.exe',
      platform: 'win32',
    });

    expect(hostPath).toBe(path.join(targetRootDir, 'dist', 'run_host.bat'));
    await expect(fs.readFile(path.join(targetRootDir, 'dist', 'node_path.txt'), 'utf8')).resolves.toBe(
      'C:\\node\\node.exe'
    );
    await expect(fs.readFile(path.join(targetRootDir, 'dist', 'index.js'), 'utf8')).resolves.toContain(
      'bundled-index'
    );
    await expect(
      fs.readFile(path.join(targetRootDir, 'dist', 'logs', 'existing.log'), 'utf8')
    ).resolves.toBe('keep me\n');
  });

  it('returns development manifest directories for macOS and Windows', () => {
    expect(
      getDevelopmentManifestDirectories({
        platform: 'darwin',
        homeDir: '/Users/alice',
        tempDir: '/tmp',
      })
    ).toContain('/Users/alice/Library/Application Support/Chrome for Testing/NativeMessagingHosts');

    expect(
      getDevelopmentManifestDirectories({
        platform: 'win32',
        homeDir: 'C:\\Users\\alice',
        localAppData: 'C:\\Users\\alice\\AppData\\Local',
      })
    ).toContain('C:\\Users\\alice\\AppData\\Local\\Temp\\wxt-chrome-data\\NativeMessagingHosts');
  });
});
