import path from 'node:path';
import {
  collectSelfCheckManifestTargets,
  evaluateManifestCheck,
} from './native-host-self-check';

describe('native host self-check helpers', () => {
  it('reports missing allowed origins and path mismatches', () => {
    const result = evaluateManifestCheck({
      manifestPath: '/tmp/com.chromemcp.nativehost.json',
      manifest: {
        name: 'com.chromemcp.nativehost',
        path: '/tmp/old/run_host.sh',
        allowed_origins: ['chrome-extension://cmgjacoohdgjedoekbdbhbelpmboankg/'],
      },
      expectedHostName: 'com.chromemcp.nativehost',
      expectedOrigins: [
        'chrome-extension://cmgjacoohdgjedoekbdbhbelpmboankg/',
        'chrome-extension://ipccjlofbkbomhcgobojmmnfbbgidfif/',
      ],
      expectedHostPath: '/tmp/new/run_host.sh',
      hostPathExists: false,
      nodePathExists: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('缺少白名单: chrome-extension://ipccjlofbkbomhcgobojmmnfbbgidfif/');
    expect(result.issues).toContain('host 路径与预期不一致: /tmp/old/run_host.sh');
    expect(result.issues).toContain('host 可执行文件不存在');
    expect(result.issues).toContain('node_path.txt 不存在或指向无效 Node');
  });

  it('collects regular and development manifest targets without duplicates', () => {
    const targets = collectSelfCheckManifestTargets({
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
      appData: 'C:\\Users\\alice\\AppData\\Roaming',
      localAppData: 'C:\\Users\\alice\\AppData\\Local',
      tempDir: 'C:\\Temp',
    });

    expect(targets).toContain(
      'C:\\Users\\alice\\AppData\\Roaming\\Google\\Chrome\\NativeMessagingHosts\\com.chromemcp.nativehost.json'
    );
    expect(targets).toContain(
      'C:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Edge\\NativeMessagingHosts\\com.chromemcp.nativehost.json'
    );
    expect(targets).toContain(
      path.join(
        'C:\\Users\\alice\\AppData\\Local\\Temp',
        'wxt-chrome-data',
        'NativeMessagingHosts',
        'com.chromemcp.nativehost.json'
      )
    );
    expect(new Set(targets).size).toBe(targets.length);
  });
});
