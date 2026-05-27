import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildMacManifestDirs,
  buildNativeHostManifest,
  guideHtml,
  guideStateJson,
  startCommand,
} from './build-mac-lite.mjs';
import {
  ONLINE_UPDATE_EXTENSION_ID,
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY,
  chromeExtensionIdFromManifestKey,
} from './lite-extension-identity.mjs';

test('buildMacManifestDirs includes Microsoft Edge, Google Chrome, Chrome for Testing, and Chromium', () => {
  const dirs = buildMacManifestDirs('/Users/tester');

  assert.deepEqual(dirs, [
    path.join(
      '/Users/tester',
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts'
    ),
    path.join(
      '/Users/tester',
      'Library',
      'Application Support',
      'Microsoft Edge',
      'NativeMessagingHosts'
    ),
    path.join(
      '/Users/tester',
      'Library',
      'Application Support',
      'Google',
      'Chrome for Testing',
      'NativeMessagingHosts'
    ),
    path.join('/Users/tester', 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
  ]);
});

test('buildNativeHostManifest binds the generated extension id', () => {
  const manifest = buildNativeHostManifest('/tmp/run_native_host.command', 'abc123');

  assert.deepEqual(manifest, {
    name: 'com.chromemcp.nativehost',
    description: 'accr Mac Lite Native Host',
    path: '/tmp/run_native_host.command',
    type: 'stdio',
    allowed_origins: ['chrome-extension://abc123/'],
  });
});

test('Mac Lite online update extension identity stays fixed', () => {
  assert.equal(chromeExtensionIdFromManifestKey(ONLINE_UPDATE_EXTENSION_MANIFEST_KEY), ONLINE_UPDATE_EXTENSION_ID);
  assert.equal(ONLINE_UPDATE_EXTENSION_ID, 'cmgjacoohdgjedoekbdbhbelpmboankg');
});

test('startCommand registers the native host for Chrome and Edge browser profiles on mac', () => {
  const script = startCommand('abc123');

  assert.match(script, /Microsoft Edge\/NativeMessagingHosts/);
  assert.match(script, /Google\/Chrome\/NativeMessagingHosts/);
  assert.match(script, /Google\/Chrome for Testing\/NativeMessagingHosts/);
  assert.match(script, /Chromium\/NativeMessagingHosts/);
  assert.match(script, /for MANIFEST_DIR in "\$\{MANIFEST_DIRS\[@\]\}"; do/);
});

test('startCommand replaces stale manifests without requiring manual cleanup', () => {
  const script = startCommand('abc123');

  assert.match(script, /if \[ -f "\$MANIFEST_PATH" \]; then/);
  assert.match(script, /Removing existing native host manifest:/);
  assert.match(script, /rm -f "\$MANIFEST_PATH"/);
});

test('startCommand only opens onboarding when guide state is incomplete', () => {
  const script = startCommand('abc123');

  assert.match(script, /guide-state\.json/);
  assert.match(script, /guide\.html/);
  assert.match(script, /chrome:\/\/extensions\//);
  assert.match(script, /edge:\/\/extensions\//);
  assert.match(script, /browser_has_extension/);
  assert.match(script, /open_browser_extensions_page/);
  assert.match(script, /append_open_browser_app "Microsoft Edge"/);
  assert.match(script, /append_open_browser_app "Google Chrome"/);
  assert.match(script, /"completed": true/);
  assert.doesNotMatch(script, /下一步：/);
  assert.match(script, /if is_guide_completed; then[\s\S]*write_guide_state false/);
});

test('startCommand exports custom local update feed when provided', () => {
  const script = startCommand('abc123', {
    updatePackageUrl: 'http://127.0.0.1:8866/dev/accr-ui-mac-lite-arm64.zip',
    updateProjectUrl: 'http://127.0.0.1:8866/dev/',
  });

  assert.match(
    script,
    /export WEBMCP_MAC_LITE_ZIP_URL="http:\/\/127\.0\.0\.1:8866\/dev\/accr-ui-mac-lite-arm64\.zip"/
  );
  assert.match(script, /export WEBMCP_LITE_PROJECT_URL="http:\/\/127\.0\.0\.1:8866\/dev\/"/);
});

test('guideStateJson initializes onboarding as incomplete on mac too', () => {
  assert.equal(guideStateJson(), '{\n  "completed": false\n}\n');
});

test('guideHtml renders shared onboarding instructions for mac', () => {
  const html = guideHtml({ platform: 'macOS', startScriptName: 'start.command' });

  assert.ok(html.includes('欢迎使用 accr Lite'));
  assert.ok(html.includes('Chrome 或 Edge'));
  assert.ok(html.includes('开发者模式'));
  assert.ok(html.includes('加载已解压的扩展程序'));
  assert.ok(html.includes('extension'));
  assert.ok(html.includes('我已完成安装'));
  assert.ok(html.includes('start.command'));
});
