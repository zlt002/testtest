import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agentBackendBat,
  applyWindowsLiteBetaManifest,
  buildArchiveInvocation,
  buildCommandInvocation,
  buildRuntimeCopyPlan,
  buildWindowsLiteBetaDisplayName,
  buildWindowsLiteBetaManifestVersion,
  buildWindowsManifest,
  guideHtml,
  guideStateJson,
  installHta,
  installPs1,
  installVbs,
  nativeHostBat,
  openBrowserPageVbs,
  releaseNotesHtml,
  resolveCommandForPlatform,
  startVbs,
  utf8BomBuffer,
} from './build-windows-lite.mjs';
import {
  ONLINE_UPDATE_EXTENSION_ID,
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY,
  chromeExtensionIdFromManifestKey,
} from './lite-extension-identity.mjs';

test('Windows Lite beta display name follows the expected branding format', () => {
  assert.equal(buildWindowsLiteBetaDisplayName(0), 'accr-ui【beta.1.1.0】');
  assert.equal(buildWindowsLiteBetaDisplayName(7), 'accr-ui【beta.1.1.7】');
});

test('Windows Lite beta manifest version stays Chrome-compatible', () => {
  assert.equal(buildWindowsLiteBetaManifestVersion(0), '1.1.0');
  assert.equal(buildWindowsLiteBetaManifestVersion(12), '1.1.12');
});

test('applyWindowsLiteBetaManifest rewrites only the packaged extension name and version', () => {
  const manifest = applyWindowsLiteBetaManifest(
    {
      manifest_version: 3,
      name: 'accr-ui',
      version: '0.0.4',
      key: 'abc',
    },
    5
  );

  assert.deepEqual(manifest, {
    manifest_version: 3,
    name: 'accr-ui【beta.1.1.5】',
    version: '1.1.5',
    key: 'abc',
  });
});

test('buildWindowsManifest binds the generated extension id', () => {
  const manifest = buildWindowsManifest('C:\\pkg\\run_native_host.bat', 'abc123');

  assert.deepEqual(manifest, {
    name: 'com.chromemcp.nativehost',
    description: 'accr-ui Windows Lite Native Host',
    path: 'C:\\pkg\\run_native_host.bat',
    type: 'stdio',
    allowed_origins: ['chrome-extension://abc123/'],
  });
});

test('Windows Lite online update extension identity stays fixed', () => {
  assert.equal(chromeExtensionIdFromManifestKey(ONLINE_UPDATE_EXTENSION_MANIFEST_KEY), ONLINE_UPDATE_EXTENSION_ID);
  assert.equal(ONLINE_UPDATE_EXTENSION_ID, 'cmgjacoohdgjedoekbdbhbelpmboankg');
});

test('startVbs checks that Node.js major version is 24 or higher', () => {
  const script = startVbs('abc123');

  assert.ok(script.includes('node --version'));
  assert.ok(script.includes('If Left(nodeVersion, 1) = "v"'));
  assert.ok(script.includes('Node.js 主版本过低'));
  assert.ok(script.includes('Node.js 24 或更高版本'));
  assert.ok(script.includes('guide-state.json'));
  assert.ok(script.includes('guide.html'));
  assert.ok(script.includes('chrome://extensions/'));
  assert.ok(script.includes('completed'));
  assert.ok(script.includes('installRoot = fso.GetParentFolderName(projectDir)'));
  assert.ok(script.includes('extensionPath = installRoot & "\\extension"'));
  assert.equal(script.includes('MsgBox "accr Windows Lite 已完成本机注册。'), false);
});

test('nativeHostBat rejects unsupported Node.js versions with a clear log message', () => {
  const script = nativeHostBat();

  assert.ok(script.includes('if not defined NODE_VERSION'));
  assert.ok(script.includes('if not defined NODE_MAJOR'));
  assert.ok(script.includes('--version 2^>nul'));
  assert.ok(script.includes('if defined NODE_VERSION if /i "!NODE_VERSION:~0,1!"=="v"'));
  assert.ok(script.includes('ERROR: Node.js 24+ is required'));
  assert.ok(script.includes('for %%I in ("%PACKAGE_DIR%\\..") do set "INSTALL_ROOT=%%~fI"'));
  assert.ok(script.includes('set "NODE_SCRIPT=%PACKAGE_DIR%\\native-server\\runtime.cjs"'));
  assert.ok(script.includes('set "CLAUDE_AGENT_V2_WORKDIR=%INSTALL_ROOT%\\workspace"'));
});

test('nativeHostBat points Windows auto-recovery at the bundled agent bat launcher', () => {
  const script = nativeHostBat();

  assert.ok(script.includes('set "WEBMCP_AGENT_V2_WINDOWS_START_SCRIPT=%PACKAGE_DIR%\\run_agent_backend.bat"'));
});

test('resolveCommandForPlatform uses pnpm.cmd on Windows', () => {
  assert.equal(resolveCommandForPlatform('pnpm', { platform: 'win32' }), 'pnpm.cmd');
});

test('resolveCommandForPlatform keeps pnpm unchanged outside Windows', () => {
  assert.equal(resolveCommandForPlatform('pnpm', { platform: 'darwin' }), 'pnpm');
  assert.equal(resolveCommandForPlatform('pnpm', { platform: 'linux' }), 'pnpm');
});

test('buildCommandInvocation runs pnpm through cmd.exe on Windows', () => {
  assert.deepEqual(
    buildCommandInvocation('pnpm', ['build:extension'], { platform: 'win32' }),
    {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd build:extension'],
    }
  );
});

test('buildCommandInvocation keeps direct execution outside Windows', () => {
  assert.deepEqual(
    buildCommandInvocation('pnpm', ['build:extension'], { platform: 'linux' }),
    {
      command: 'pnpm',
      args: ['build:extension'],
    }
  );
});

test('buildArchiveInvocation uses PowerShell Compress-Archive on Windows', () => {
  assert.deepEqual(
    buildArchiveInvocation({
      zipPath: 'C:\\pkg\\release\\accr-ui-windows-lite-x64.zip',
      packageName: 'accr-ui-windows-lite-x64',
      platform: 'win32',
    }),
    {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "Compress-Archive -Path 'accr-ui-windows-lite-x64' -DestinationPath 'C:\\pkg\\release\\accr-ui-windows-lite-x64.zip' -Force",
      ],
    }
  );
});

test('buildArchiveInvocation keeps zip command outside Windows', () => {
  assert.deepEqual(
    buildArchiveInvocation({
      zipPath: '/tmp/accr-ui-windows-lite-x64.zip',
      packageName: 'accr-ui-windows-lite-x64',
      platform: 'linux',
    }),
    {
      command: 'zip',
      args: ['-qr', '/tmp/accr-ui-windows-lite-x64.zip', 'accr-ui-windows-lite-x64'],
    }
  );
});

test('buildRuntimeCopyPlan includes builtin skills and builtin plugins in the packaged runtime', () => {
  const plan = buildRuntimeCopyPlan({
    rootDir: '/repo',
    tempDir: '/repo/.tmp/windows-lite',
    payloadDir: '/repo/.tmp/windows-lite/payload',
    runtimeDir: '/repo/.tmp/windows-lite/payload/runtime',
  });

  assert.deepEqual(plan, [
    {
      from: '/repo/.tmp/windows-lite/native-server/index.cjs',
      to: '/repo/.tmp/windows-lite/payload/runtime/native-server/runtime.cjs',
    },
    {
      from: '/repo/.tmp/windows-lite/agent-backend-v2',
      to: '/repo/.tmp/windows-lite/payload/runtime/agent-backend-v2',
    },
    {
      from: '/repo/apps/agent-backend-v2/builtin-skills',
      to: '/repo/.tmp/windows-lite/payload/builtin-skills',
    },
    {
      from: '/repo/apps/agent-backend-v2/builtin-plugins',
      to: '/repo/.tmp/windows-lite/payload/builtin-plugins',
    },
    {
      from: '/repo/apps/agent-backend-v2/node_modules/@anthropic-ai/claude-agent-sdk',
      to: '/repo/.tmp/windows-lite/payload/runtime/vendor/claude-agent-sdk',
    },
  ]);
});

test('agentBackendBat uses a stable timestamp command with fallback log name', () => {
  const script = agentBackendBat();

  assert.ok(script.includes('set "TIMESTAMP=unknown"'));
  assert.ok(script.includes(`Get-Date -Format 'yyyyMMdd_HHmmss'`));
  assert.ok(script.includes('agent_backend_windows_%TIMESTAMP%.log'));
  assert.ok(script.includes('for %%I in ("%PACKAGE_DIR%\\..") do set "INSTALL_ROOT=%%~fI"'));
  assert.ok(script.includes('set "WORKSPACE_DIR=%INSTALL_ROOT%\\workspace"'));
});

test('agentBackendBat does not inject optional lite feed env vars when absent', () => {
  const script = agentBackendBat();

  assert.equal(script.includes('WEBMCP_WINDOWS_LITE_ZIP_URL'), false);
  assert.equal(script.includes('WEBMCP_LITE_PROJECT_URL'), false);
});

test('agentBackendBat injects optional lite feed env vars when provided', () => {
  const script = agentBackendBat({
    windowsLiteZipUrl: 'https://example.com/accr-ui-windows-lite-x64.zip',
    liteProjectUrl: 'https://example.com/projects/accr-lite',
  });

  assert.ok(
    script.includes('set "WEBMCP_WINDOWS_LITE_ZIP_URL=https://example.com/accr-ui-windows-lite-x64.zip"')
  );
  assert.ok(
    script.includes('set "WEBMCP_LITE_PROJECT_URL=https://example.com/projects/accr-lite"')
  );
});

test('agentBackendBat rejects unsafe characters in lite feed env vars', () => {
  assert.throws(
    () =>
      agentBackendBat({
        windowsLiteZipUrl: 'https://example.com/accr"!lite.zip',
      }),
    /WEBMCP_WINDOWS_LITE_ZIP_URL/
  );

  assert.throws(
    () =>
      agentBackendBat({
        liteProjectUrl: 'https://example.com/project!stable',
      }),
    /WEBMCP_LITE_PROJECT_URL/
  );
});

test('guideStateJson initializes onboarding as incomplete', () => {
  assert.equal(guideStateJson(), '{\n  "completed": false\n}\n');
});

test('guideHtml explains extension loading and completion flow in Chinese', () => {
  const html = guideHtml({ platform: 'Windows', startScriptName: 'install.hta' });

  assert.ok(html.includes('accr-ui 浏览器引导'));
  assert.ok(html.includes('开发人员模式/开发者模式'));
  assert.ok(html.includes('加载已解压的扩展程序'));
  assert.ok(html.includes('extension'));
  assert.ok(html.includes('复制地址'));
  assert.ok(html.includes('复制目录'));
  assert.ok(html.includes('Chrome 或 Edge'));
  assert.ok(html.includes('复制后直接按这 3 步操作即可'));
  assert.equal(html.includes('我已完成安装'), false);
  assert.equal(html.includes('复制扩展页地址'), false);
  assert.equal(html.includes('安装步骤'), false);
  assert.equal(html.includes('请在扩展管理页里加载下方显示的'), false);
});

test('releaseNotesHtml renders the current packaged version and markdown bullets', () => {
  const html = releaseNotesHtml({
    currentVersion: 'accr-ui【beta.1.0.8】',
    markdown: `# Windows Lite 更新说明

## 本次更新

- 修复在线升级后自动重载过早的问题
- 支持通过安装目录配置远程更新源
`,
  });

  assert.ok(html.includes('accr-ui【beta.1.0.8】'));
  assert.ok(html.includes('Windows Lite 更新说明'));
  assert.ok(html.includes('本次更新'));
  assert.ok(html.includes('修复在线升级后自动重载过早的问题'));
  assert.ok(html.includes('支持通过安装目录配置远程更新源'));
});

test('installHta checks Node.js 24+, Git, directory selection, and uninstall flow', () => {
  const script = installHta('abc123');

  assert.ok(script.includes('Node.js 24+'));
  assert.ok(script.includes('Git'));
  assert.ok(script.includes('BrowseForFolder'));
  assert.ok(script.includes('卸载当前安装'));
  assert.ok(script.includes('payload.zip'));
  assert.ok(script.includes('Shell.Application'));
  assert.ok(script.includes('accr-ui 安装器'));
  assert.ok(script.includes('com.chromemcp.nativehost'));
  assert.ok(script.includes('Chrome 或 Edge'));
  assert.ok(script.includes('extension'));
  assert.ok(script.includes('runtime'));
  assert.ok(script.includes('UiOnInstallStarted();'));
  assert.ok(script.includes('pollInstallProgress();'));
  assert.ok(script.includes('window.setInterval("pollInstallProgress()", 260);'));
  assert.equal(script.includes('window.UiOnInstallStarted'), false);
  assert.equal(script.includes('window.FinishInstallAfterExtraction'), false);
});

test('installVbs launches install.ps1 without a visible console window', () => {
  const script = installVbs();

  assert.ok(script.includes('CreateObject("WScript.Shell")'));
  assert.ok(script.includes('WScript.ScriptFullName'));
  assert.ok(script.includes('install.ps1'));
  assert.ok(script.includes('WindowsPowerShell\\v1.0\\powershell.exe'));
  assert.ok(script.includes('-ExecutionPolicy Bypass -STA -File'));
  assert.ok(script.includes('exitCode = shell.Run(command, 1, True)'));
  assert.ok(script.includes('install-launch.log'));
  assert.ok(script.includes('AppendLog("launcher start")'));
  assert.ok(script.includes('AppendLog("exitCode=" & exitCode)'));
  assert.ok(script.includes('MsgBox'));
});

test('installPs1 builds a WinForms installer with folder picker and progress updates', () => {
  const script = installPs1('abc123');

  assert.ok(script.includes('GetConsoleWindow'));
  assert.ok(script.includes('ShowWindow($consoleHandle, 0)'));
  assert.ok(script.includes('Add-Type -AssemblyName System.Windows.Forms'));
  assert.ok(script.includes('FolderBrowserDialog'));
  assert.ok(script.includes('Start-Process -FilePath powershell.exe'));
  assert.ok(script.includes('Write-InstallProgress'));
  assert.ok(script.includes('Write-InstallerLog'));
  assert.ok(script.includes("Join-Path $scriptDir 'install-gui.log'"));
  assert.ok(script.includes('Expand-Archive -LiteralPath $ZipPath -DestinationPath $fullDestPath -Force'));
  assert.ok(script.includes('NativeMessagingHosts'));
  assert.ok(script.includes('chrome-extension://abc123/'));
  assert.ok(script.includes('$progressTimer = New-Object System.Windows.Forms.Timer'));
  assert.ok(script.includes('$installButton.Add_Click'));
  assert.ok(script.includes('function Resolve-DefaultInstallDir'));
  assert.ok(script.includes("[System.IO.DriveInfo]::GetDrives()"));
  assert.ok(script.includes("Join-Path $drive.RootDirectory.FullName 'accrui'"));
  assert.ok(script.includes('[System.IO.Directory]::Exists($fullDestPath)'));
  assert.ok(script.includes('[System.IO.Directory]::GetFileSystemEntries($fullDestPath).Length -gt 0'));
  assert.ok(script.includes("throw '请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。'"));
  assert.ok(script.includes('install.ps1'));
});

test('installPs1 emits the polished Chinese installer UI copy and completion state', () => {
  const script = installPs1('abc123');

  assert.ok(script.includes("$form.Text = 'accr-ui 安装程序'"));
  assert.ok(script.includes("$titleLabel.Text = '安装 accr-ui'"));
  assert.ok(script.includes("$subtitleLabel.Text = '请先检查环境依赖，再选择安装位置并开始安装。'"));
  assert.ok(script.includes('$summaryBadge = New-Object System.Windows.Forms.Label'));
  assert.ok(script.includes("$summaryBadge.Text = '等待检查'"));
  assert.ok(script.includes("$pathLabel.Text = '安装位置'"));
  assert.ok(script.includes("$chooseButton.Text = '浏览'"));
  assert.ok(script.includes("$recheckButton.Text = '重新检查'"));
  assert.ok(script.includes("$progressValueLabel.Text = '安装进度 0%'"));
  assert.ok(script.includes("$statusLabel.Text = '等待开始安装。'"));
  assert.ok(script.includes("$installButton.Text = '安装'"));
  assert.ok(script.includes("$installButton.Text = '完成并查看引导'"));
  assert.ok(script.includes("$Badge.Text = if ($Ok) { '已满足' } else { '未满足' }"));
  assert.ok(script.includes('已检测到 Node.js v$versionOutput，满足安装要求。'));
  assert.ok(script.includes("已选择安装位置。"));
  assert.ok(script.includes("请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。"));
  assert.ok(script.includes("正在准备安装环境..."));
  assert.ok(script.includes("安装完成，浏览器引导页已自动打开。"));
});

test('installPs1 avoids PowerShell New-Object coordinate expressions that crash on arithmetic arguments', () => {
  const script = installPs1('abc123');

  assert.equal(
    script.includes('New-Object System.Drawing.Point($uiStyle.ContentLeft + 2, 74)'),
    false
  );
  assert.ok(script.includes('New-Object System.Drawing.Point -ArgumentList ($uiStyle.ContentLeft + 2), 74'));
});

test('installPs1 writes the temporary worker script with a BOM so Windows PowerShell can parse Chinese text', () => {
  const script = installPs1('abc123');

  assert.ok(
    script.includes(
      "[System.IO.File]::WriteAllText($workerPath, (Build-InstallWorkerScript), [System.Text.UTF8Encoding]::new($true))"
    )
  );
});

test('installPs1 embeds C-drive validation helper inside the worker script', () => {
  const script = installPs1('abc123');

  assert.ok(script.includes('function Build-InstallWorkerScript'));
  assert.ok(script.includes("function Test-IsDisallowedInstallPath {"));
  assert.ok(script.includes("function Test-PathContainsNonAscii {"));
  assert.ok(script.includes('$pathRoot = [System.IO.Path]::GetPathRoot($fullPath)'));
  assert.ok(script.includes("ToUpperInvariant() -eq 'C:'"));
  assert.ok(script.includes("[System.Text.RegularExpressions.Regex]::IsMatch($PathValue, '[^\\u0000-\\u007F]')"));
});

test('installPs1 refreshes PATH and falls back to common install locations when rechecking dependencies', () => {
  const script = installPs1('abc123');

  assert.ok(script.includes('function Get-CombinedPathEntries'));
  assert.ok(script.includes("[System.Environment]::GetEnvironmentVariable('Path', 'User')"));
  assert.ok(script.includes("[System.Environment]::GetEnvironmentVariable('Path', 'Machine')"));
  assert.ok(script.includes('function Find-CommandCandidate'));
  assert.ok(script.includes('where.exe $CommandName 2>$null'));
  assert.ok(script.includes('%ProgramFiles%\\nodejs\\node.exe'));
  assert.ok(script.includes('%ProgramFiles%\\Git\\cmd\\git.exe'));
  assert.ok(script.includes('Refresh-ProcessPathCache'));
});

test('utf8BomBuffer prefixes content with a UTF-8 BOM for Windows PowerShell compatibility', () => {
  const buffer = utf8BomBuffer('安装 accr-ui');

  assert.equal(buffer[0], 0xef);
  assert.equal(buffer[1], 0xbb);
  assert.equal(buffer[2], 0xbf);
  assert.equal(buffer.subarray(3).toString('utf8'), '安装 accr-ui');
});

test('guideHtml keeps browser and extension paths copyable without relying on local hta helpers', () => {
  const html = guideHtml({ platform: 'Windows', startScriptName: 'install.vbs' });

  assert.ok(html.includes('async function copyText(value)'));
  assert.ok(html.includes("document.getElementById('copy-browser-url-button').addEventListener"));
  assert.ok(html.includes("document.getElementById('copy-extension-path-button').addEventListener"));
  assert.equal(html.includes('open-edge-extensions.hta'), false);
});

test('openBrowserPageVbs launches the requested browser page through WScript.Shell', () => {
  const script = openBrowserPageVbs({ targetUrl: 'edge://extensions/' });

  assert.ok(script.includes('CreateObject("WScript.Shell")'));
  assert.ok(script.includes('edge://extensions/'));
  assert.ok(script.includes('shell.Run'));
});
