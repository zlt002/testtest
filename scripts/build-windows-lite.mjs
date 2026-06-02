import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ONLINE_UPDATE_EXTENSION_ID,
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY,
} from './lite-extension-identity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const tempDir = path.join(rootDir, '.tmp', 'windows-lite');
const packageName = 'accr-ui-windows-lite-x64';
const packageDir = path.join(releaseDir, packageName);
const zipPath = path.join(releaseDir, `${packageName}.zip`);
const windowsLiteBetaStatePath = path.join(releaseDir, 'windows-lite-beta-version.json');
const windowsLiteReleaseNotesPath = path.join(rootDir, 'docs', 'windows-lite-release-notes.md');
const NATIVE_HOST_NAME = 'com.chromemcp.nativehost';
const WINDOWS_LITE_BETA_MAJOR = 1;
const WINDOWS_LITE_BETA_MINOR = 1;

export function resolveCommandForPlatform(command, { platform = process.platform } = {}) {
  if (platform === 'win32' && command === 'pnpm') {
    return 'pnpm.cmd';
  }
  return command;
}

export function buildCommandInvocation(command, args, { platform = process.platform } = {}) {
  const resolvedCommand = resolveCommandForPlatform(command, { platform });
  if (platform === 'win32' && resolvedCommand.endsWith('.cmd')) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `${resolvedCommand} ${args.join(' ')}`],
    };
  }
  return {
    command: resolvedCommand,
    args,
  };
}

function quotePowerShellSingle(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function resetDirectory(targetPath) {
  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    if (!['EBUSY', 'EPERM'].includes(error?.code ?? '') || !existsSync(targetPath)) {
      throw error;
    }

    // Windows 有时会锁住目录本身，但允许我们清空目录内容后继续复用这个空目录。
    const entries = await readdir(targetPath);
    await Promise.all(entries.map((entry) => rm(path.join(targetPath, entry), { recursive: true, force: true })));
  }

  await mkdir(targetPath, { recursive: true });
}

export function buildArchiveInvocation({
  zipPath,
  packageName,
  platform = process.platform,
}) {
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Compress-Archive -Path ${quotePowerShellSingle(packageName)} -DestinationPath ${quotePowerShellSingle(zipPath)} -Force`,
      ],
    };
  }

  return {
    command: 'zip',
    args: ['-qr', zipPath, packageName],
  };
}

function run(command, args, options = {}) {
  const invocation = buildCommandInvocation(command, args);
  console.log(`$ ${invocation.command} ${invocation.args.join(' ')}`);
  execFileSync(invocation.command, invocation.args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });
}

async function copyDereferenced(from, to) {
  await cp(from, to, {
    recursive: true,
    dereference: true,
    force: true,
    preserveTimestamps: false,
  });
}

async function writeUtf16LeFile(filePath, content) {
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(content, 'utf16le');
  await writeFile(filePath, Buffer.concat([bom, body]));
}

export function utf8BomBuffer(content) {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from(content, 'utf8');
  return Buffer.concat([bom, body]);
}

async function writeUtf8BomFile(filePath, content) {
  await writeFile(filePath, utf8BomBuffer(content));
}

export function buildRuntimeCopyPlan({ rootDir, tempDir, payloadDir, runtimeDir }) {
  return [
    {
      from: path.join(tempDir, 'native-server', 'index.cjs'),
      to: path.join(runtimeDir, 'native-server', 'runtime.cjs'),
    },
    {
      from: path.join(tempDir, 'agent-backend-v2'),
      to: path.join(runtimeDir, 'agent-backend-v2'),
    },
    {
      from: path.join(rootDir, 'apps', 'agent-backend-v2', 'builtin-skills'),
      to: path.join(payloadDir, 'builtin-skills'),
    },
    {
      from: path.join(rootDir, 'apps', 'agent-backend-v2', 'builtin-plugins'),
      to: path.join(payloadDir, 'builtin-plugins'),
    },
    {
      from: path.join(
        rootDir,
        'apps',
        'agent-backend-v2',
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk'
      ),
      to: path.join(runtimeDir, 'vendor', 'claude-agent-sdk'),
    },
  ];
}

function buildPayloadArchiveInvocation({ outputPath, platform = process.platform }) {
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Compress-Archive -Path * -DestinationPath ${quotePowerShellSingle(outputPath)} -Force`,
      ],
    };
  }
  return {
    command: 'zip',
    args: ['-qr', outputPath, '.'],
  };
}

export function guideStateJson() {
  return '{\n  "completed": false\n}\n';
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function markdownToHtmlSections(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let bulletItems = [];
  let paragraphLines = [];

  const flushBullets = () => {
    if (bulletItems.length === 0) {
      return;
    }
    sections.push(
      `<ul class="notes-list">${bulletItems
        .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
        .join('')}</ul>`
    );
    bulletItems = [];
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    sections.push(
      `<p class="notes-paragraph">${renderInlineMarkdown(paragraphLines.join(' '))}</p>`
    );
    paragraphLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      flushParagraph();
      continue;
    }

    if (line.startsWith('## ')) {
      flushBullets();
      flushParagraph();
      sections.push(`<h2 class="notes-section-title">${renderInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith('# ')) {
      flushBullets();
      flushParagraph();
      sections.push(`<h1 class="notes-title">${renderInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      bulletItems.push(line.slice(2).trim());
      continue;
    }

    flushBullets();
    paragraphLines.push(line);
  }

  flushBullets();
  flushParagraph();
  return sections.join('\n');
}

export function releaseNotesHtml({ currentVersion, markdown }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>accr-ui 更新说明</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef4fb;
      --panel: #ffffff;
      --text: #17345c;
      --muted: #6e84a3;
      --accent: #2f7df6;
      --accent-soft: #e8f1ff;
      --border: #d7e4f3;
      --success-bg: #edf9f0;
      --success-border: #c3e7ce;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      background: linear-gradient(180deg, #f3f8fe 0%, var(--bg) 100%);
      color: var(--text);
    }
    .shell {
      width: min(860px, calc(100vw - 40px));
      margin: 36px auto;
      padding: 32px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(19, 52, 92, 0.08);
    }
    .eyebrow {
      display: inline-block;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .version-box {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 18px;
      background: var(--success-bg);
      border: 1px solid var(--success-border);
    }
    .version-label {
      font-size: 13px;
      color: var(--muted);
    }
    .version-value {
      margin-top: 8px;
      font-size: 28px;
      font-weight: 800;
      word-break: break-word;
    }
    .notes {
      margin-top: 28px;
    }
    .notes-title {
      margin: 0 0 16px;
      font-size: 34px;
      line-height: 1.2;
    }
    .notes-section-title {
      margin: 26px 0 10px;
      font-size: 22px;
      line-height: 1.3;
    }
    .notes-paragraph {
      margin: 0 0 14px;
      color: var(--text);
      font-size: 16px;
      line-height: 1.75;
    }
    .notes-list {
      margin: 0 0 18px 0;
      padding-left: 22px;
      color: var(--text);
    }
    .notes-list li {
      margin: 8px 0;
      font-size: 16px;
      line-height: 1.7;
    }
    code {
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef3fb;
      color: #2358a5;
      font-family: Consolas, monospace;
      font-size: 0.95em;
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">更新已完成</div>
    <div class="version-box">
      <div class="version-label">当前版本</div>
      <div class="version-value">${escapeHtml(currentVersion)}</div>
    </div>
    <section class="notes">
${markdownToHtmlSections(markdown)}
    </section>
  </main>
</body>
</html>
`;
}

export function buildWindowsLiteBetaDisplayName(buildNumber) {
  return `accr-ui【beta.${WINDOWS_LITE_BETA_MAJOR}.${WINDOWS_LITE_BETA_MINOR}.${buildNumber}】`;
}

export function buildWindowsLiteBetaManifestVersion(buildNumber) {
  return `${WINDOWS_LITE_BETA_MAJOR}.${WINDOWS_LITE_BETA_MINOR}.${buildNumber}`;
}

export function applyWindowsLiteBetaManifest(manifest, buildNumber) {
  return {
    ...manifest,
    name: buildWindowsLiteBetaDisplayName(buildNumber),
    version: buildWindowsLiteBetaManifestVersion(buildNumber),
  };
}

async function readWindowsLiteBetaState(statePath = windowsLiteBetaStatePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function getNextWindowsLiteBetaBuildNumber(state) {
  const lastBuildNumber = Number.isInteger(state?.lastBuildNumber) ? state.lastBuildNumber : -1;
  return lastBuildNumber + 1;
}

async function writeWindowsLiteBetaState(buildNumber, statePath = windowsLiteBetaStatePath) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        lastBuildNumber: buildNumber,
        displayVersion: `beta.${WINDOWS_LITE_BETA_MAJOR}.${WINDOWS_LITE_BETA_MINOR}.${buildNumber}`,
        extensionName: buildWindowsLiteBetaDisplayName(buildNumber),
        manifestVersion: buildWindowsLiteBetaManifestVersion(buildNumber),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

export function installHta(extensionId) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>accr-ui 安装器</title>
  <hta:application
    applicationname="ACCRUIInstaller"
    border="thin"
    caption="yes"
    contextmenu="no"
    maximizebutton="no"
    minimizebutton="yes"
    navigable="no"
    scroll="no"
    selection="no"
    singleinstance="yes"
    sysmenu="yes"
    windowstate="normal"
  />
  <style>
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      color: #17345c;
      background: #eef4fb;
    }
    table { border-collapse: collapse; border-spacing: 0; }
    .shell {
      position: relative;
      width: 620px;
      margin: 18px auto 0 auto;
      background: #ffffff;
      border: 1px solid #cdddf0;
    }
    .panel {
      position: relative;
      padding: 24px 24px 18px 24px;
      background: #ffffff;
      border: 1px solid #f6fbff;
      overflow: hidden;
    }
    .brand-row {
      margin-bottom: 18px;
    }
    .brand-box {
      width: 124px;
      height: 36px;
      line-height: 36px;
      text-align: center;
      background: #2f7df6;
      color: #ffffff;
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 1px;
      border: 2px solid #7ab1ff;
      border-radius: 18px;
    }
    .brand-title {
      margin-top: 16px;
      font-size: 30px;
      line-height: 34px;
      font-weight: bold;
      color: #17345c;
    }
    .brand-subtitle {
      margin-top: 8px;
      color: #6e84a3;
      font-size: 14px;
      line-height: 20px;
    }
    .environment { margin-bottom: 14px; }
    .check-row {
      width: 100%;
      margin-bottom: 12px;
      border: 1px solid #d9e6f5;
      background: #ffffff;
      border-radius: 12px;
    }
    .check-row td {
      padding: 14px 16px;
      vertical-align: middle;
    }
    .name {
      font-size: 21px;
      font-weight: bold;
      letter-spacing: -0.02em;
      color: #17345c;
    }
    .desc {
      font-size: 14px;
      color: #6e84a3;
      font-weight: bold;
      line-height: 18px;
    }
    .status {
      display: inline-block;
      min-width: 74px;
      height: 38px;
      line-height: 38px;
      padding: 0 14px;
      text-align: center;
      color: #125b32;
      background: #e8f8ee;
      border: 1px solid #bfe6cc;
      font-size: 14px;
      font-weight: bold;
      border-radius: 999px;
    }
    .status.fail {
      color: #a63a32;
      background: #fff1f1;
      border-color: #efc3bf;
    }
    .actions { margin-bottom: 14px; }
    .ghost-btn,
    .primary-btn,
    .pick-btn {
      height: 52px;
      border: 1px solid #bfd4f0;
      font-family: inherit;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 12px;
    }
    .ghost-btn, .pick-btn {
      background: #ffffff;
      color: #1f62d8;
    }
    .primary-btn {
      width: 100%;
      border-color: #2f7df6;
      color: #ffffff;
      background: #2f7df6;
    }
    .directory-wrap {
      position: relative;
      min-height: 72px;
      margin-bottom: 18px;
      border: 1px solid #d9e6f5;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
    }
    .directory {
      width: 100%;
      height: 72px;
    }
    .directory td {
      padding: 10px 12px;
      vertical-align: middle;
    }
    .path-input {
      width: 100%;
      height: 48px;
      line-height: 48px;
      border: 1px solid #d6e4f3;
      background: #ffffff;
      color: #325477;
      padding: 0 14px;
      font-size: 16px;
      font-weight: bold;
      box-sizing: border-box;
      border-radius: 10px;
    }
    .pick-btn {
      height: 48px;
      padding: 0 22px;
      background: #f3f8ff;
      white-space: nowrap;
    }
    .progress-box {
      position: absolute;
      left: 20px;
      right: 20px;
      top: 24px;
      display: none;
    }
    .progress-track {
      position: relative;
      width: 100%;
      height: 16px;
      overflow: hidden;
      border: 1px solid #d5e3f6;
      background: #edf4fd;
      border-radius: 999px;
    }
    .progress-bar {
      width: 0%;
      height: 16px;
      background: #2f7df6;
      border-radius: 999px;
    }
    .directory-wrap.installing .directory,
    .directory-wrap.done .directory { display: none; }
    .directory-wrap.installing .progress-box,
    .directory-wrap.done .progress-box { display: block; }
    .progress-meta {
      margin-top: -4px;
      margin-bottom: 8px;
      color: #6e84a3;
      font-size: 13px;
      line-height: 18px;
    }
    .status-line {
      min-height: 28px;
      margin-bottom: 14px;
      color: #6e84a3;
      font-size: 13px;
      line-height: 20px;
    }
    .micro-links {
      color: #6e84a3;
      font-size: 12px;
      line-height: 20px;
      margin-top: 10px;
    }
    .micro-links a {
      color: #2f7df6;
      text-decoration: none;
      margin-right: 12px;
      cursor: pointer;
    }
    .compact-meta {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #e9f0f7;
      display: none;
    }
    button.disabled {
      color: #9aa8ba;
      background: #f2f5f8;
      border-color: #d8e1ea;
      cursor: default;
      box-shadow: none;
    }
    .overlay {
      display: none;
      position: absolute;
      left: 0;
      top: 0;
      width: 620px;
      height: 100%;
      background: #e7eef7;
    }
    .overlay-box {
      width: 564px;
      height: 480px;
      margin: 54px auto 0 auto;
      background: #ffffff;
      border: 1px solid #d5e1ee;
      padding: 16px;
      box-sizing: border-box;
    }
    .overlay-head {
      height: 34px;
      line-height: 34px;
      margin-bottom: 10px;
      font-size: 16px;
      font-weight: bold;
      color: #203a59;
    }
    .overlay-head .close-btn { float: right; }
    .log {
      width: 100%;
      height: 400px;
      border: 1px solid #1d3551;
      background: #102235;
      color: #deecfb;
      padding: 10px;
      overflow: auto;
      font-family: Consolas, monospace;
      font-size: 12px;
      line-height: 18px;
      box-sizing: border-box;
      white-space: pre-wrap;
    }
  </style>
  <script language="VBScript">
    Dim gSelectedDir, gInstalledDir, gNodeReady, gGitReady
    Dim gInstallRegistryBase, gInstallDirKey, gInstalledAtKey, gHostRegistryKey, gEdgeHostRegistryKey
    Dim gHostName, gExtensionId, gInstallProgressPath, gInstallRunning
    gSelectedDir = ""
    gInstalledDir = ""
    gNodeReady = False
    gGitReady = False
    gInstallProgressPath = ""
    gInstallRunning = False
    gInstallRegistryBase = "HKCU\\Software\\accr-ui\\Lite\\"
    gInstallDirKey = gInstallRegistryBase & "InstallDir"
    gInstalledAtKey = gInstallRegistryBase & "InstalledAt"
    gHostRegistryKey = "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}\\"
    gEdgeHostRegistryKey = "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}\\"
    gHostName = "${NATIVE_HOST_NAME}"
    gExtensionId = "${extensionId}"

    Function ReadRegistryValue(path)
      On Error Resume Next
      Dim shell, value
      Set shell = CreateObject("WScript.Shell")
      value = shell.RegRead(path)
      If Err.Number <> 0 Then
        ReadRegistryValue = ""
        Err.Clear
      Else
        ReadRegistryValue = CStr(value)
      End If
      On Error GoTo 0
    End Function

    Function TrimOutput(value)
      Dim text
      text = Replace(CStr(value), vbCrLf, vbLf)
      text = Replace(text, vbCr, vbLf)
      Do While Right(text, 1) = vbLf
        text = Left(text, Len(text) - 1)
      Loop
      TrimOutput = Trim(text)
    End Function

    Function RunCommand(command)
      On Error Resume Next
      Dim shell, fso, tempDir, tempName, tempPath, stdoutText, exitCode, tempFile
      Set shell = CreateObject("WScript.Shell")
      Set fso = CreateObject("Scripting.FileSystemObject")
      tempDir = fso.GetSpecialFolder(2)
      tempName = fso.GetTempName()
      tempPath = fso.BuildPath(tempDir, tempName)
      exitCode = shell.Run("cmd.exe /c (" & command & ") > """ & tempPath & """ 2>&1", 0, True)
      stdoutText = ""
      If fso.FileExists(tempPath) Then
        Set tempFile = fso.OpenTextFile(tempPath, 1)
        stdoutText = tempFile.ReadAll()
        tempFile.Close
        fso.DeleteFile tempPath, True
      End If
      RunCommand = exitCode & "|" & TrimOutput(stdoutText)
      On Error GoTo 0
    End Function

    Function ParseExitCode(result)
      Dim parts
      parts = Split(result, "|", 2)
      ParseExitCode = CInt(parts(0))
    End Function

    Function ParseStdout(result)
      Dim parts
      parts = Split(result, "|", 2)
      If UBound(parts) >= 1 Then
        ParseStdout = parts(1)
      Else
        ParseStdout = ""
      End If
    End Function

    Function DetectNodeVersion()
      Dim result, stdoutText
      result = RunCommand("node --version 2>nul")
      stdoutText = ParseStdout(result)
      If ParseExitCode(result) <> 0 Or Len(stdoutText) = 0 Then
        DetectNodeVersion = ""
        Exit Function
      End If
      If Left(stdoutText, 1) = "v" Or Left(stdoutText, 1) = "V" Then
        stdoutText = Mid(stdoutText, 2)
      End If
      DetectNodeVersion = stdoutText
    End Function

    Function IsNodeVersionSupported(nodeVersion)
      On Error Resume Next
      Dim versionParts, majorVersion
      If Len(nodeVersion) = 0 Then
        IsNodeVersionSupported = False
        Exit Function
      End If
      versionParts = Split(nodeVersion, ".")
      majorVersion = CInt(versionParts(0))
      If Err.Number <> 0 Then
        Err.Clear
        IsNodeVersionSupported = False
      Else
        IsNodeVersionSupported = (majorVersion >= 24)
      End If
      On Error GoTo 0
    End Function

    Function DecodeFileUrlToWindowsPath(url)
      Dim value
      value = Replace(url, "file:///", "")
      value = Replace(value, "/", "\\")
      value = Replace(value, "%20", " ")
      If Left(value, 1) = "\\" And Mid(value, 3, 1) = ":" Then
        value = Mid(value, 2)
      End If
      DecodeFileUrlToWindowsPath = value
    End Function

    Function InstallerFilePath()
      InstallerFilePath = DecodeFileUrlToWindowsPath(document.location.href)
    End Function

    Function InstallerSourceDir()
      Dim fso
      Set fso = CreateObject("Scripting.FileSystemObject")
      InstallerSourceDir = fso.GetParentFolderName(InstallerFilePath())
    End Function

    Function PayloadZipPath()
      PayloadZipPath = InstallerSourceDir() & "\\payload.zip"
    End Function

    Function EnsureTrailingWebMcpDir(baseDir)
      Dim normalized
      normalized = baseDir
      If Right(normalized, 1) = "\\" Then
        normalized = Left(normalized, Len(normalized) - 1)
      End If
      If LCase(Right(normalized, 6)) <> "webmcp" Then
        normalized = normalized & "\\accr-ui"
      End If
      EnsureTrailingWebMcpDir = normalized
    End Function

    Sub EnsureFolderRecursive(path)
      Dim shell
      Set shell = CreateObject("WScript.Shell")
      shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""New-Item -ItemType Directory -Force -Path '" & Replace(path, "'", "''") & "' | Out-Null""", 0, True
    End Sub

    Sub AppendLog(message)
      window.UiAppendLog message
    End Sub

    Sub SetStatus(message)
      window.UiSetStatusText message
    End Sub

    Sub SetProgress(value)
      window.UiSetProgressValue CInt(value)
    End Sub

    Sub SetSelectedDir(path)
      gSelectedDir = path
      window.UiUpdateSelectedDir path
    End Sub

    Function ProgressFilePath()
      Dim fso
      Set fso = CreateObject("Scripting.FileSystemObject")
      If Len(gInstallProgressPath) = 0 Then
        gInstallProgressPath = fso.BuildPath(fso.GetSpecialFolder(2), "accr_ui_install_progress.txt")
      End If
      ProgressFilePath = gInstallProgressPath
    End Function

    Sub WriteProgressState(percentValue, stateCode, detailText)
      Dim fso, progressFile, line
      Set fso = CreateObject("Scripting.FileSystemObject")
      line = CStr(percentValue) & "|" & CStr(stateCode) & "|" & Replace(CStr(detailText), vbCrLf, " ")
      Set progressFile = fso.CreateTextFile(ProgressFilePath(), True)
      progressFile.Write line
      progressFile.Close
    End Sub

    Function GetInstallProgressPath()
      GetInstallProgressPath = ProgressFilePath()
    End Function

    Function BuildExtractPayloadPs1()
      BuildExtractPayloadPs1 = _
        "param([string]$ZipPath,[string]$DestPath,[string]$ProgressPath)" & vbCrLf & _
        "$ErrorActionPreference = 'Stop'" & vbCrLf & _
        "Add-Type -AssemblyName System.IO.Compression.FileSystem" & vbCrLf & _
        "function Write-State([int]$Percent,[string]$Code,[string]$Message='') {" & vbCrLf & _
        "  [System.IO.File]::WriteAllText($ProgressPath, ($Percent.ToString() + '|' + $Code + '|' + $Message), [System.Text.Encoding]::Unicode)" & vbCrLf & _
        "}" & vbCrLf & _
        "try {" & vbCrLf & _
        "  Write-State 6 'preparing'" & vbCrLf & _
        "  if (Test-Path -LiteralPath $DestPath) { Remove-Item -LiteralPath $DestPath -Recurse -Force }" & vbCrLf & _
        "  New-Item -ItemType Directory -Path $DestPath -Force | Out-Null" & vbCrLf & _
        "  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)" & vbCrLf & _
        "  $entries = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })" & vbCrLf & _
        "  $total = if ($entries.Count -gt 0) { $entries.Count } else { 1 }" & vbCrLf & _
        "  $index = 0" & vbCrLf & _
        "  foreach ($entry in $archive.Entries) {" & vbCrLf & _
        "    $relativePath = ($entry.FullName -replace '/', [System.IO.Path]::DirectorySeparatorChar)" & vbCrLf & _
        "    $targetPath = Join-Path $DestPath $relativePath" & vbCrLf & _
        "    if ([string]::IsNullOrEmpty($entry.Name)) {" & vbCrLf & _
        "      New-Item -ItemType Directory -Path $targetPath -Force | Out-Null" & vbCrLf & _
        "      continue" & vbCrLf & _
        "    }" & vbCrLf & _
        "    $parent = Split-Path -Parent $targetPath" & vbCrLf & _
        "    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }" & vbCrLf & _
        "    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)" & vbCrLf & _
        "    $index = $index + 1" & vbCrLf & _
        "    $percent = 8 + [int](($index * 72) / $total)" & vbCrLf & _
        "    Write-State $percent 'extracting'" & vbCrLf & _
        "  }" & vbCrLf & _
        "  $archive.Dispose()" & vbCrLf & _
        "  New-Item -ItemType Directory -Path (Join-Path $DestPath 'logs') -Force | Out-Null" & vbCrLf & _
        "  New-Item -ItemType Directory -Path (Join-Path $DestPath 'workspace') -Force | Out-Null" & vbCrLf & _
        "  if (-not (Test-Path -LiteralPath (Join-Path $DestPath 'extension\\manifest.json'))) { throw '安装内容异常：缺少 extension\\manifest.json' }" & vbCrLf & _
        "  if (-not (Test-Path -LiteralPath (Join-Path $DestPath 'runtime\\run_agent_backend.bat'))) { throw '安装内容异常：缺少 runtime\\run_agent_backend.bat' }" & vbCrLf & _
        "  if (-not (Test-Path -LiteralPath (Join-Path $DestPath 'runtime\\run_native_host.bat'))) { throw '安装内容异常：缺少 runtime\\run_native_host.bat' }" & vbCrLf & _
        "  Write-State 82 'done'" & vbCrLf & _
        "} catch {" & vbCrLf & _
        "  Write-State 0 'error' $_.Exception.Message" & vbCrLf & _
        "  exit 1" & vbCrLf & _
        "}"
    End Function

    Sub RunEnvironmentChecks()
      On Error Resume Next
      Dim nodeFound, nodeVersion, gitWhereResult, gitVersionResult, gitVersionText
      Dim nodeMessage, gitMessage
      AppendLog "开始环境检查: Node.js 24+ / Git"
      SetStatus "正在检查本地环境..."
      gNodeReady = False
      gGitReady = False

      nodeFound = (ParseExitCode(RunCommand("where node >nul 2>nul")) = 0)
      nodeVersion = DetectNodeVersion()
      If nodeFound And IsNodeVersionSupported(nodeVersion) Then
        gNodeReady = True
        nodeMessage = "已安装 Node.js v" & nodeVersion & "，满足 24+ 要求。"
      ElseIf nodeFound And Len(nodeVersion) > 0 Then
        nodeMessage = "检测到 Node.js v" & nodeVersion & "，但版本低于 24。"
      Else
        nodeMessage = "未检测到 Node.js，请先安装 Node.js 24+。"
      End If

      gitWhereResult = RunCommand("where git >nul 2>nul")
      gitVersionResult = RunCommand("git --version 2>nul")
      gitVersionText = ParseStdout(gitVersionResult)
      If ParseExitCode(gitWhereResult) = 0 And ParseExitCode(gitVersionResult) = 0 And Len(gitVersionText) > 0 Then
        gGitReady = True
        gitMessage = "已安装 " & gitVersionText & "。"
      Else
        gitMessage = "未检测到 Git，请先安装 Git。"
      End If

      window.UiUpdateRequirementItem "node", gNodeReady, nodeMessage
      window.UiUpdateRequirementItem "git", gGitReady, gitMessage
      window.UiUpdateRequirementSummary gNodeReady, gGitReady
      AppendLog nodeMessage
      AppendLog gitMessage
      If gNodeReady And gGitReady Then
        SetStatus "环境检查通过，可以继续安装。"
      Else
        SetStatus "环境检查未通过，请先安装缺失依赖后再继续。"
      End If
      On Error GoTo 0
    End Sub

    Sub ChooseInstallDir()
      On Error Resume Next
      Dim shellApp, folder, chosenPath
      Set shellApp = CreateObject("Shell.Application")
      Set folder = shellApp.BrowseForFolder(0, "选择 accr-ui 的安装目录", 0, 0)
      If folder Is Nothing Then
        SetStatus "你取消了目录选择。"
        Exit Sub
      End If
      chosenPath = EnsureTrailingWebMcpDir(folder.Self.Path)
      Call SetSelectedDir(chosenPath)
      AppendLog "已选择安装目录: " & chosenPath
      SetStatus "安装目录已选择，可以继续安装。"
      On Error GoTo 0
    End Sub

    Sub RegisterNativeHost(installDir)
      Dim shell, fso, manifestDir, manifestPath, hostPath, manifestFile, manifestJson, escapedHostPath, regCommand, edgeRegCommand
      Set shell = CreateObject("WScript.Shell")
      Set fso = CreateObject("Scripting.FileSystemObject")
      manifestDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\\Google\\Chrome\\NativeMessagingHosts"
      manifestPath = manifestDir & "\\" & gHostName & ".json"
      hostPath = installDir & "\\runtime\\run_native_host.bat"
      If Not fso.FolderExists(manifestDir) Then
        shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""New-Item -ItemType Directory -Force -Path '" & Replace(manifestDir, "'", "''") & "' | Out-Null""", 0, True
      End If
      escapedHostPath = Replace(hostPath, "\\", "\\\\")
      manifestJson = "{" & vbCrLf & _
        "  ""name"": """ & gHostName & """," & vbCrLf & _
        "  ""description"": ""accr-ui Windows Lite Native Host""," & vbCrLf & _
        "  ""path"": """ & escapedHostPath & """," & vbCrLf & _
        "  ""type"": ""stdio""," & vbCrLf & _
        "  ""allowed_origins"": [""chrome-extension://${extensionId}/""]" & vbCrLf & _
        "}"
      Set manifestFile = fso.CreateTextFile(manifestPath, True)
      manifestFile.Write manifestJson
      manifestFile.Close
      regCommand = "reg add """ & gHostRegistryKey & """ /ve /t REG_SZ /d """ & manifestPath & """ /f"
      edgeRegCommand = "reg add """ & gEdgeHostRegistryKey & """ /ve /t REG_SZ /d """ & manifestPath & """ /f"
      If shell.Run(regCommand, 0, True) <> 0 Then
        Err.Raise vbObjectError + 100, "RegisterNativeHost", "无法写入 Chrome Native Messaging 注册表。"
      End If
      If shell.Run(edgeRegCommand, 0, True) <> 0 Then
        Err.Raise vbObjectError + 101, "RegisterNativeHost", "无法写入 Edge Native Messaging 注册表。"
      End If
    End Sub

    Sub StartBundledAgent(installDir)
      Dim shell
      Set shell = CreateObject("WScript.Shell")
      shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""$ports = 12306,8792; foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } }""", 0, True
      shell.Run "cmd.exe /c """ & installDir & "\\runtime\\run_agent_backend.bat""", 0, False
    End Sub

    Sub ExtractPayloadZip(installDir)
      Dim shellApp, sourceNs, targetNs, fso, waitCount
      Set shellApp = CreateObject("Shell.Application")
      Set fso = CreateObject("Scripting.FileSystemObject")
      EnsureFolderRecursive installDir
      Set sourceNs = shellApp.NameSpace(PayloadZipPath())
      Set targetNs = shellApp.NameSpace(installDir)
      If sourceNs Is Nothing Then
        Err.Raise vbObjectError + 120, "ExtractPayloadZip", "无法打开 payload.zip。"
      End If
      If targetNs Is Nothing Then
        Err.Raise vbObjectError + 121, "ExtractPayloadZip", "无法创建安装目录。"
      End If
      targetNs.CopyHere sourceNs.Items, 16 + 4 + 1024
      For waitCount = 1 To 300
        If fso.FolderExists(installDir & "\\extension") And fso.FolderExists(installDir & "\\runtime") Then
          Exit Sub
        End If
        WScript.Sleep 100
      Next
      Err.Raise vbObjectError + 122, "ExtractPayloadZip", "payload.zip 解压超时。"
    End Sub

    Sub StartInstallAsync()
      On Error Resume Next
      Dim sourceDir, shell, fso, overwrite, tempPs1Path, ps1File, runCommand
      sourceDir = InstallerSourceDir()
      Set shell = CreateObject("WScript.Shell")
      Set fso = CreateObject("Scripting.FileSystemObject")

      If Not gNodeReady Or Not gGitReady Then
        SetStatus "环境检查未通过，不能继续安装。"
        Exit Sub
      End If
      If Len(gSelectedDir) = 0 Then
        SetStatus "请先选择安装目录。"
        Exit Sub
      End If

      If fso.FolderExists(gSelectedDir) Then
        overwrite = MsgBox("安装目录已存在，是否覆盖安装？" & vbCrLf & gSelectedDir, 4 + 32, "accr-ui 安装器")
        If overwrite <> 6 Then
          SetStatus "你取消了覆盖安装。"
          Exit Sub
        End If
      End If

      gInstallRunning = True
      tempPs1Path = fso.BuildPath(fso.GetSpecialFolder(2), "accr_ui_extract_payload.ps1")
      Set ps1File = fso.CreateTextFile(tempPs1Path, True)
      ps1File.Write BuildExtractPayloadPs1()
      ps1File.Close

      WriteProgressState 6, "preparing", ""
      SetProgress 6
      SetStatus "正在准备安装..."
      AppendLog "源目录: " & sourceDir
      AppendLog "目标目录: " & gSelectedDir
      AppendLog "payload: " & PayloadZipPath()

      runCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & tempPs1Path & _
        """ -ZipPath """ & PayloadZipPath() & """ -DestPath """ & gSelectedDir & _
        """ -ProgressPath """ & ProgressFilePath() & """"
      shell.Run runCommand, 0, False
      On Error GoTo 0
    End Sub

    Sub FinishInstallAfterExtraction()
      On Error Resume Next
      Dim shell, fso
      Set shell = CreateObject("WScript.Shell")
      Set fso = CreateObject("Scripting.FileSystemObject")
      If Not gInstallRunning Then
        Exit Sub
      End If
      gInstallRunning = False

      WriteProgressState 86, "configuring", ""
      SetProgress 86
      SetStatus "正在完成安装配置..."
      If Not fso.FileExists(gSelectedDir & "\\extension\\manifest.json") Then
        SetStatus "安装内容异常，缺少扩展文件。"
        AppendLog "安装异常: 缺少 " & gSelectedDir & "\\extension\\manifest.json"
        WriteProgressState 0, "error", "安装内容异常，缺少 extension\\manifest.json"
        Exit Sub
      End If
      If Not fso.FileExists(gSelectedDir & "\\runtime\\run_agent_backend.bat") Then
        SetStatus "安装内容异常，缺少运行脚本。"
        AppendLog "安装异常: 缺少 " & gSelectedDir & "\\runtime\\run_agent_backend.bat"
        WriteProgressState 0, "error", "安装内容异常，缺少 runtime\\run_agent_backend.bat"
        Exit Sub
      End If
      If Not fso.FileExists(gSelectedDir & "\\runtime\\run_native_host.bat") Then
        SetStatus "安装内容异常，缺少 Native Host 启动脚本。"
        AppendLog "安装异常: 缺少 " & gSelectedDir & "\\runtime\\run_native_host.bat"
        WriteProgressState 0, "error", "安装内容异常，缺少 runtime\\run_native_host.bat"
        Exit Sub
      End If
      Call RegisterNativeHost(gSelectedDir)
      If Err.Number <> 0 Then
        SetStatus "注册 Native Messaging 失败。"
        AppendLog "注册失败: " & Err.Description
        WriteProgressState 0, "error", Err.Description
        Err.Clear
        Exit Sub
      End If

      shell.RegWrite gInstallDirKey, gSelectedDir, "REG_SZ"
      shell.RegWrite gInstalledAtKey, CStr(Now), "REG_SZ"

      SetStatus "正在启动本地服务..."
      Call StartBundledAgent(gSelectedDir)
      If Err.Number <> 0 Then
        SetStatus "启动本地服务失败。"
        AppendLog "启动失败: " & Err.Description
        WriteProgressState 0, "error", Err.Description
        Err.Clear
        Exit Sub
      End If

      SetProgress 100
      SetStatus "安装完成。接下来会打开浏览器引导页，请按提示完成 Chrome 或 Edge 扩展加载。"
      WriteProgressState 100, "complete", ""
      AppendLog "安装完成。"
      shell.Run Chr(34) & gSelectedDir & "\\runtime\\guide.html" & Chr(34), 1, False
      On Error GoTo 0
    End Sub

    Sub UninstallPackage()
      On Error Resume Next
      Dim shell, fso, installDir, manifestPath
      Set shell = CreateObject("WScript.Shell")
      Set fso = CreateObject("Scripting.FileSystemObject")
      installDir = ReadRegistryValue(gInstallDirKey)
      If Len(installDir) = 0 Then
        SetStatus "没有检测到已安装的 accr-ui。"
        Exit Sub
      End If

      shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""$ports = 12306,8792; foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } }""", 0, True
      manifestPath = shell.ExpandEnvironmentStrings("%APPDATA%") & "\\Google\\Chrome\\NativeMessagingHosts\\" & gHostName & ".json"
      If fso.FileExists(manifestPath) Then
        fso.DeleteFile manifestPath, True
      End If
      shell.RegDelete gHostRegistryKey
      shell.RegDelete gEdgeHostRegistryKey
      shell.RegDelete gInstalledAtKey
      shell.RegDelete gInstallDirKey
      shell.RegDelete gInstallRegistryBase
      Err.Clear

      If fso.FolderExists(installDir) Then
        fso.DeleteFolder installDir, True
      End If

      SetProgress 100
      SetStatus "卸载完成。已删除安装目录和当前用户的 Native Messaging 注册。"
      AppendLog "卸载完成: " & installDir
      On Error GoTo 0
    End Sub
  </script>
  <script language="javascript">
    var installPollTimer = null;
    var installFinalizeStarted = false;

    function setText(id, value) { document.getElementById(id).innerText = value || ""; }
    function setInput(id, value) { document.getElementById(id).value = value || ""; }
    function UiSetStatusText(text) { setText("statusText", text); }
    function UiSetProgressValue(value) {
      document.getElementById("progressBar").style.width = value + "%";
      setText("progressValue", value + "%");
      var wrap = document.getElementById("directoryWrap");
      if (value > 0 && value < 100 && wrap) wrap.className = "directory-wrap installing";
      if (value >= 100 && wrap) wrap.className = "directory-wrap done";
    }
    function UiAppendLog(message) {
      var target = document.getElementById("logText");
      var line = "[" + new Date().toLocaleTimeString() + "] " + message;
      target.innerText = target.innerText ? target.innerText + "\\n" + line : line;
      target.scrollTop = target.scrollHeight;
    }
    function UiUpdateSelectedDir(path) { setInput("selectedDir", path); }
    function updateRequirementVisual(prefix, ok, text) {
      var badge = document.getElementById(prefix + "Badge");
      var detail = document.getElementById(prefix + "Detail");
      badge.innerText = ok ? "通过" : "未通过";
      badge.className = ok ? "status" : "status fail";
      detail.innerText = text || "";
    }
    function UiUpdateRequirementItem(prefix, ok, text) { updateRequirementVisual(prefix, !!ok, text); }
    function UiUpdateRequirementSummary(nodeOk, gitOk) {
      var installBtn = document.getElementById("installButton");
      var chooseBtn = document.getElementById("chooseBtn");
      var recheckBtn = document.getElementById("recheckBtn");
      var summary = document.getElementById("requirementSummary");
      var ready = !!nodeOk && !!gitOk;
      if (!installPollTimer) {
        installBtn.disabled = !ready;
        installBtn.className = ready ? "primary-btn" : "primary-btn disabled";
        if (chooseBtn) chooseBtn.disabled = false;
        if (recheckBtn) recheckBtn.disabled = false;
      }
      summary.innerText = ready ? "环境检查通过，可以继续安装。" : "环境检查未通过，请先安装缺失依赖。";
    }
    function readLocalTextFile(path) {
      try {
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        if (!fso.FileExists(path)) return "";
        var stream = fso.OpenTextFile(path, 1);
        var text = stream.ReadAll();
        stream.Close();
        return text;
      } catch (error) {
        return "";
      }
    }
    function syncInstallButtonState(disabled) {
      var installBtn = document.getElementById("installButton");
      var chooseBtn = document.getElementById("chooseBtn");
      var recheckBtn = document.getElementById("recheckBtn");
      installBtn.disabled = !!disabled;
      installBtn.className = disabled ? "primary-btn disabled" : "primary-btn";
      if (chooseBtn) chooseBtn.disabled = !!disabled;
      if (recheckBtn) recheckBtn.disabled = !!disabled;
    }
    function beginInstall() {
      if (installPollTimer) return;
      installFinalizeStarted = false;
      syncInstallButtonState(true);
      UiOnInstallStarted();
      window.StartInstallAsync();
    }
    function UiOnInstallStarted() {
      var wrap = document.getElementById("directoryWrap");
      if (wrap) wrap.className = "directory-wrap installing";
      installFinalizeStarted = false;
      if (installPollTimer) window.clearInterval(installPollTimer);
      pollInstallProgress();
      installPollTimer = window.setInterval("pollInstallProgress()", 260);
    }
    function pollInstallProgress() {
      var progressPath = "";
      try { progressPath = window.GetInstallProgressPath(); } catch (error) {}
      if (!progressPath) return;
      var raw = readLocalTextFile(progressPath);
      if (!raw) return;
      var parts = raw.split("|");
      var percent = parseInt(parts[0], 10);
      var state = parts.length > 1 ? parts[1] : "";
      var detail = parts.length > 2 ? parts.slice(2).join("|") : "";
      if (!isNaN(percent)) UiSetProgressValue(percent);
      if (state === "preparing") UiSetStatusText("正在准备安装...");
      if (state === "extracting") UiSetStatusText("正在解压安装内容...");
      if (state === "done") {
        UiSetStatusText("解压完成，正在继续安装...");
        if (!installFinalizeStarted) {
          installFinalizeStarted = true;
          FinishInstallAfterExtraction();
        }
        return;
      }
      if (state === "configuring") UiSetStatusText("正在完成安装配置...");
      if (state === "complete") {
        installFinalizeStarted = false;
        window.clearInterval(installPollTimer);
        installPollTimer = null;
        var doneWrap = document.getElementById("directoryWrap");
        if (doneWrap) doneWrap.className = "directory-wrap done";
        syncInstallButtonState(false);
        return;
      }
      if (state === "error") {
        installFinalizeStarted = false;
        window.clearInterval(installPollTimer);
        installPollTimer = null;
        var idleWrap = document.getElementById("directoryWrap");
        if (idleWrap) idleWrap.className = "directory-wrap";
        UiSetProgressValue(0);
        UiSetStatusText(detail || "安装失败，请查看详细日志。");
        syncInstallButtonState(false);
      }
    }
    function copySelectedDir() {
      var input = document.getElementById("selectedDir");
      if (!input.value) { UiSetStatusText("请先选择安装目录。"); return; }
      input.focus();
      input.select();
      try { document.execCommand("copy"); UiSetStatusText("安装目录路径已复制。"); }
      catch (error) { UiSetStatusText("复制失败，请手动复制路径。"); }
    }
    function openExternal(url) {
      try { new ActiveXObject("WScript.Shell").Run(url, 1, false); }
      catch (error) { UiSetStatusText("打开链接失败，请手动访问: " + url); }
    }
    function initPage() {
      var shell = new ActiveXObject("WScript.Shell");
      var defaultDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\\\\accr-ui");
      try {
        window.resizeTo(690, 720);
        window.moveTo(
          Math.max(0, (screen.availWidth - 690) / 2),
          Math.max(0, (screen.availHeight - 720) / 2)
        );
      } catch (error) {}
      window.SetSelectedDir(defaultDir);
      UiSetStatusText("先完成环境检查，再选择安装目录并开始安装。");
      UiSetProgressValue(0);
      syncInstallButtonState(true);
      window.RunEnvironmentChecks();
    }
    function toggleLog(show) {
      document.getElementById("logMask").style.display = show ? "block" : "none";
    }
  </script>
</head>
<body onload="initPage()">
  <div class="shell">
    <div class="panel">
      <div class="brand-row">
        <div class="brand-box">accr-ui</div>
        <div class="brand-title">安装 accr-ui</div>
        <div class="brand-subtitle">检查环境，选择目录，然后开始安装。</div>
      </div>

      <div class="environment" id="environment">
        <table class="check-row">
          <tr>
            <td width="220"><div class="name">Node.js 24+</div></td>
            <td><div class="desc" id="nodeDetail">正在检查...</div></td>
            <td width="90" align="right"><div class="status" id="nodeBadge">检查中</div></td>
          </tr>
        </table>
        <table class="check-row">
          <tr>
            <td width="220"><div class="name">Git</div></td>
            <td><div class="desc" id="gitDetail">正在检查...</div></td>
            <td width="90" align="right"><div class="status" id="gitBadge">检查中</div></td>
          </tr>
        </table>
      </div>

      <div class="actions">
        <button class="ghost-btn" id="recheckBtn" onclick="RunEnvironmentChecks()">重新检查</button>
      </div>

      <div class="directory-wrap" id="directoryWrap">
        <table class="directory" id="directoryRow">
          <tr>
            <td>
              <input id="selectedDir" class="path-input" type="text" value="" readonly />
            </td>
            <td width="154" align="right">
              <button class="pick-btn" id="chooseBtn" onclick="ChooseInstallDir()">选择目录</button>
            </td>
          </tr>
        </table>
        <div class="progress-box">
          <div class="progress-track">
            <div class="progress-bar" id="progressBar"></div>
          </div>
        </div>
      </div>

      <div class="progress-meta">进度 <span id="progressValue">0%</span></div>
      <div class="status-line" id="statusText"></div>

      <button class="primary-btn" id="installButton" onclick="beginInstall()" disabled>开始安装</button>

      <div class="compact-meta">
        <div class="micro-links"><span id="requirementSummary">正在检查...</span></div>
        <div class="micro-links">
          <a onclick="copySelectedDir()">复制路径</a>
          <a onclick="toggleLog(true)">查看日志</a>
          <a onclick="UninstallPackage()">卸载当前安装</a>
        </div>
      </div>
    </div>
    <div class="overlay" id="logMask">
      <div class="overlay-box">
        <div class="overlay-head">
          详细日志
          <button class="close-btn" onclick="toggleLog(false)">关闭</button>
        </div>
        <div class="log" id="logText"></div>
      </div>
    </div>
  </div>
</body>
</html>
`;
}

export function installPs1(extensionId) {
  return `# install.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowControl {
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$consoleHandle = [WindowControl]::GetConsoleWindow()
if ($consoleHandle -ne [IntPtr]::Zero) {
  [WindowControl]::ShowWindow($consoleHandle, 0) | Out-Null
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadZipPath = Join-Path $scriptDir 'payload.zip'
$progressPath = Join-Path $env:TEMP 'accr_ui_install_progress.txt'
$workerPath = Join-Path $env:TEMP 'accr_ui_install_worker.ps1'
$logPath = Join-Path $scriptDir 'install-gui.log'
$installRegistryPath = 'HKCU:\\Software\\accr-ui\\Lite'
$installDirProperty = 'InstallDir'
$installedAtProperty = 'InstalledAt'
$chromeHostRegistryPath = 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}'
$edgeHostRegistryPath = 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}'
$manifestDir = Join-Path $env:APPDATA 'Google\\Chrome\\NativeMessagingHosts'
$defaultInstallDir = ''
$extensionId = '${extensionId}'

$uiStyle = @{
  FormBackColor = [System.Drawing.Color]::FromArgb(239, 243, 249)
  CardBackColor = [System.Drawing.Color]::White
  MutedTextColor = [System.Drawing.Color]::FromArgb(96, 112, 135)
  HeadingColor = [System.Drawing.Color]::FromArgb(20, 32, 51)
  SummaryBackColor = [System.Drawing.Color]::FromArgb(247, 249, 252)
  ContentLeft = 36
  ContentWidth = 704
  ButtonHeight = 38
}

function Write-InstallerLog {
  param([string]$Message)

  try {
    $timestamp = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -LiteralPath $logPath -Value ($timestamp + ' ' + $Message) -Encoding UTF8
  } catch {
  }
}

Write-InstallerLog 'bootstrap start'
Write-InstallerLog ('scriptDir=' + $scriptDir)
Write-InstallerLog ('payloadZipPath=' + $payloadZipPath)

function Write-InstallProgress {
  param(
    [int]$Percent,
    [string]$State,
    [string]$Detail = ''
  )

  $line = '{0}|{1}|{2}' -f $Percent, $State, ($Detail -replace "[\\r\\n]+", ' ')
  [System.IO.File]::WriteAllText($progressPath, $line, [System.Text.UTF8Encoding]::new($false))
}

function Get-InstalledDir {
  try {
    return (Get-ItemProperty -LiteralPath $installRegistryPath -Name $installDirProperty -ErrorAction Stop).$installDirProperty
  } catch {
    return ''
  }
}

function Test-PathContainsNonAscii {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $false
  }

  return [System.Text.RegularExpressions.Regex]::IsMatch($PathValue, '[^\\u0000-\\u007F]')
}

function Test-IsDisallowedInstallPath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $false
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($PathValue)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    return $pathRoot.TrimEnd('\\').ToUpperInvariant() -eq 'C:' -or (Test-PathContainsNonAscii $fullPath)
  } catch {
    return $false
  }
}

function Resolve-DefaultInstallDir {
  try {
    $drives = [System.IO.DriveInfo]::GetDrives() |
      Where-Object { $_.DriveType -eq [System.IO.DriveType]::Fixed -and $_.IsReady } |
      Sort-Object @{ Expression = {
        if ($_.Name.ToUpperInvariant() -eq 'D:\\') { 0 }
        elseif ($_.Name.ToUpperInvariant() -eq 'C:\\') { 2 }
        else { 1 }
      } }, Name

    foreach ($drive in $drives) {
      $driveRoot = $drive.RootDirectory.FullName
      if ($driveRoot.TrimEnd('\\').ToUpperInvariant() -eq 'C:') {
        continue
      }

      $candidateDir = Join-Path $drive.RootDirectory.FullName 'accrui'
      if (-not (Test-PathContainsNonAscii $candidateDir)) {
        return $candidateDir
      }
    }
  } catch {
  }

  return ''
}

$defaultInstallDir = Resolve-DefaultInstallDir

function Get-CombinedPathEntries {
  $pathValues = @(
    $env:Path
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
    [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  )
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $entries = New-Object 'System.Collections.Generic.List[string]'

  foreach ($pathValue in $pathValues) {
    if ([string]::IsNullOrWhiteSpace($pathValue)) {
      continue
    }

    foreach ($entry in ($pathValue -split ';')) {
      $trimmed = $entry.Trim()
      if ([string]::IsNullOrWhiteSpace($trimmed)) {
        continue
      }
      if ($seen.Add($trimmed)) {
        [void]$entries.Add($trimmed)
      }
    }
  }

  return $entries
}

function Refresh-ProcessPathCache {
  $combinedEntries = Get-CombinedPathEntries
  if ($combinedEntries.Count -gt 0) {
    $env:Path = ($combinedEntries -join ';')
  }
}

function Find-CommandCandidate {
  param(
    [string]$CommandName,
    [string[]]$FallbackPaths
  )

  Refresh-ProcessPathCache

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
    return $command.Source
  }

  try {
    $whereResults = @(where.exe $CommandName 2>$null)
    foreach ($candidate in $whereResults) {
      $trimmedCandidate = $candidate.Trim()
      if (-not [string]::IsNullOrWhiteSpace($trimmedCandidate) -and (Test-Path -LiteralPath $trimmedCandidate -PathType Leaf)) {
        return $trimmedCandidate
      }
    }
  } catch {
  }

  foreach ($fallbackPath in $FallbackPaths) {
    if ([string]::IsNullOrWhiteSpace($fallbackPath)) {
      continue
    }
    $expandedPath = [System.Environment]::ExpandEnvironmentVariables($fallbackPath)
    if (Test-Path -LiteralPath $expandedPath -PathType Leaf) {
      return $expandedPath
    }
  }

  return $null
}

function Resolve-NodeCommand {
  return Find-CommandCandidate -CommandName 'node' -FallbackPaths @(
    '%ProgramFiles%\\nodejs\\node.exe',
    '%ProgramFiles(x86)%\\nodejs\\node.exe',
    '%LOCALAPPDATA%\\Programs\\nodejs\\node.exe',
    '%LOCALAPPDATA%\\Volta\\bin\\node.exe',
    '%APPDATA%\\nvm\\node.exe'
  )
}

function Resolve-GitCommand {
  return Find-CommandCandidate -CommandName 'git' -FallbackPaths @(
    '%ProgramFiles%\\Git\\cmd\\git.exe',
    '%ProgramFiles%\\Git\\bin\\git.exe',
    '%ProgramFiles(x86)%\\Git\\cmd\\git.exe',
    '%ProgramFiles(x86)%\\Git\\bin\\git.exe',
    '%LOCALAPPDATA%\\Programs\\Git\\cmd\\git.exe',
    '%LOCALAPPDATA%\\Programs\\Git\\bin\\git.exe'
  )
}

function Test-NodeRequirement {
  $resolvedNode = Resolve-NodeCommand
  if (-not $resolvedNode) {
    return @{ Ok = $false; Text = '未检测到 Node.js，请先安装 Node.js 24 及以上版本。' }
  }

  try {
    Write-InstallerLog ('resolved node=' + $resolvedNode)
    $versionOutput = (& $resolvedNode --version 2>$null).Trim()
    if ($versionOutput.StartsWith('v') -or $versionOutput.StartsWith('V')) {
      $versionOutput = $versionOutput.Substring(1)
    }
    $version = [version]$versionOutput
    if ($version.Major -lt 24) {
      return @{ Ok = $false; Text = "已安装 Node.js v$versionOutput，但版本低于 24。" }
    }
    return @{ Ok = $true; Text = "已检测到 Node.js v$versionOutput，满足安装要求。" }
  } catch {
    return @{ Ok = $false; Text = '无法读取 Node.js 版本信息。' }
  }
}

function Test-GitRequirement {
  $resolvedGit = Resolve-GitCommand
  if (-not $resolvedGit) {
    return @{ Ok = $false; Text = '未检测到 Git，请先安装 Git。' }
  }

  try {
    Write-InstallerLog ('resolved git=' + $resolvedGit)
    $versionOutput = (& $resolvedGit --version 2>$null).Trim()
    return @{ Ok = $true; Text = "已检测到 $versionOutput，可以继续安装。" }
  } catch {
    return @{ Ok = $false; Text = '无法读取 Git 版本信息。' }
  }
}

function Set-RequirementState {
  param(
    [System.Windows.Forms.Label]$Badge,
    [System.Windows.Forms.Label]$Detail,
    [bool]$Ok,
    [string]$Text
  )

  $Badge.Text = if ($Ok) { '已满足' } else { '未满足' }
  $Badge.BackColor = if ($Ok) { [System.Drawing.Color]::FromArgb(232, 248, 238) } else { [System.Drawing.Color]::FromArgb(255, 241, 241) }
  $Badge.ForeColor = if ($Ok) { [System.Drawing.Color]::FromArgb(18, 91, 50) } else { [System.Drawing.Color]::FromArgb(166, 58, 50) }
  $Detail.Text = $Text
}

function Set-UiProgress {
  param([int]$Percent)

  $value = [Math]::Max(0, [Math]::Min(100, $Percent))
  $progressBar.Value = $value
  $progressValueLabel.Text = "安装进度 $value%"
}

function Set-UiStatus {
  param([string]$Text)
  $statusLabel.Text = $Text
}

function Set-InstallerBusy {
  param([bool]$Busy)
  $chooseButton.Enabled = -not $Busy
  $recheckButton.Enabled = -not $Busy
  $pathTextBox.Enabled = -not $Busy
  if ($Busy) {
    $installButton.Enabled = $false
    $installButton.Text = '正在安装...'
  } elseif ($script:installFinished) {
    $installButton.Enabled = $true
    $installButton.Text = '完成并查看引导'
  } else {
    $installButton.Enabled = (-not $Busy) -and $script:requirementsReady
    $installButton.Text = '安装'
  }
}

function Refresh-Requirements {
  Write-InstallerLog 'refresh requirements'
  $nodeState = Test-NodeRequirement
  $gitState = Test-GitRequirement
  Set-RequirementState -Badge $nodeBadge -Detail $nodeDetail -Ok $nodeState.Ok -Text $nodeState.Text
  Set-RequirementState -Badge $gitBadge -Detail $gitDetail -Ok $gitState.Ok -Text $gitState.Text
  $script:requirementsReady = $nodeState.Ok -and $gitState.Ok
  $summaryBadge.Text = if ($script:requirementsReady) {
    "准备就绪\`r\`n2 项依赖通过"
  } else {
    "需要处理\`r\`n请先补齐依赖"
  }
  if (-not $script:isInstalling) {
    Set-InstallerBusy $false
  }
}

function Build-InstallWorkerScript {
  return @'
param(
  [string]$ZipPath,
  [string]$DestPath,
  [string]$ProgressPath
)

$ErrorActionPreference = 'Stop'

function Write-InstallProgress {
  param(
    [int]$Percent,
    [string]$State,
    [string]$Detail = ''
  )

  $line = '{0}|{1}|{2}' -f $Percent, $State, ($Detail -replace "[\\r\\n]+", ' ')
  [System.IO.File]::WriteAllText($ProgressPath, $line, [System.Text.UTF8Encoding]::new($false))
}

function Test-PathContainsNonAscii {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $false
  }

  return [System.Text.RegularExpressions.Regex]::IsMatch($PathValue, '[^\\u0000-\\u007F]')
}

function Test-IsDisallowedInstallPath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $false
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($PathValue)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    return $pathRoot.TrimEnd('\\').ToUpperInvariant() -eq 'C:' -or (Test-PathContainsNonAscii $fullPath)
  } catch {
    return $false
  }
}

function Stop-BundledPorts {
  foreach ($port in 12306, 8792) {
    try {
      $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    } catch {
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw '缺少 payload.zip 安装包。'
  }

  $fullDestPath = [System.IO.Path]::GetFullPath($DestPath)
  $destRoot = [System.IO.Path]::GetPathRoot($fullDestPath)
  if (Test-IsDisallowedInstallPath $fullDestPath) {
    throw '请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。'
  }
  if ($fullDestPath.TrimEnd('\\') -eq $destRoot.TrimEnd('\\')) {
    throw '安装位置不能是磁盘根目录。'
  }

  Write-InstallProgress 6 'preparing' ''
  if (Test-Path -LiteralPath $fullDestPath) {
    Remove-Item -LiteralPath $fullDestPath -Recurse -Force
  }

  New-Item -ItemType Directory -Path $fullDestPath -Force | Out-Null

  Write-InstallProgress 24 'extracting' ''
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $fullDestPath -Force

  $extensionManifestPath = Join-Path $fullDestPath 'extension\\manifest.json'
  $agentRunnerPath = Join-Path $fullDestPath 'runtime\\run_agent_backend.bat'
  $nativeHostRunnerPath = Join-Path $fullDestPath 'runtime\\run_native_host.bat'
  if (-not (Test-Path -LiteralPath $extensionManifestPath -PathType Leaf)) {
    throw '安装包不完整：缺少 extension\\manifest.json。'
  }
  if (-not (Test-Path -LiteralPath $agentRunnerPath -PathType Leaf)) {
    throw '安装包不完整：缺少 runtime\\run_agent_backend.bat。'
  }
  if (-not (Test-Path -LiteralPath $nativeHostRunnerPath -PathType Leaf)) {
    throw '安装包不完整：缺少 runtime\\run_native_host.bat。'
  }

  Write-InstallProgress 86 'configuring' ''

  $manifestDir = Join-Path $env:APPDATA 'Google\\Chrome\\NativeMessagingHosts'
  $manifestPath = Join-Path $manifestDir '${NATIVE_HOST_NAME}.json'
  New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null

  $manifest = @{
    name = '${NATIVE_HOST_NAME}'
    description = 'accr-ui Windows Lite Native Host'
    path = $nativeHostRunnerPath
    type = 'stdio'
    allowed_origins = @('chrome-extension://${extensionId}/')
  } | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

  New-Item -Path 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}' -Force | Out-Null
  Set-Item -LiteralPath 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}' -Value $manifestPath
  New-Item -Path 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}' -Force | Out-Null
  Set-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}' -Value $manifestPath

  New-Item -Path 'HKCU:\\Software\\accr-ui\\Lite' -Force | Out-Null
  Set-ItemProperty -LiteralPath 'HKCU:\\Software\\accr-ui\\Lite' -Name 'InstallDir' -Value $fullDestPath
  Set-ItemProperty -LiteralPath 'HKCU:\\Software\\accr-ui\\Lite' -Name 'InstalledAt' -Value ([DateTime]::Now.ToString('s'))

  Write-InstallProgress 93 'starting' ''
  Stop-BundledPorts
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"' + $agentRunnerPath + '"') -WindowStyle Hidden

  $guidePath = Join-Path $fullDestPath 'runtime\\guide.html'
  if (Test-Path -LiteralPath $guidePath -PathType Leaf) {
    Start-Process -FilePath $guidePath
  }

  Write-InstallProgress 100 'complete' ''
} catch {
  Write-InstallProgress 0 'error' $_.Exception.Message
  exit 1
}
'@
}

$script:requirementsReady = $false
$script:isInstalling = $false
$script:installFinished = $false

$form = New-Object System.Windows.Forms.Form
$form.Text = 'accr-ui 安装程序'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(776, 620)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.BackColor = $uiStyle.FormBackColor

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = '安装 accr-ui'
$titleLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 26, [System.Drawing.FontStyle]::Bold)
$titleLabel.AutoSize = $true
$titleLabel.ForeColor = $uiStyle.HeadingColor
$titleLabel.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, 26
$form.Controls.Add($titleLabel)

$subtitleLabel = New-Object System.Windows.Forms.Label
$subtitleLabel.Text = '请先检查环境依赖，再选择安装位置并开始安装。'
$subtitleLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10.5)
$subtitleLabel.AutoSize = $true
$subtitleLabel.MaximumSize = New-Object System.Drawing.Size(520, 0)
$subtitleLabel.ForeColor = $uiStyle.MutedTextColor
$subtitleLabel.Location = New-Object System.Drawing.Point -ArgumentList ($uiStyle.ContentLeft + 2), 74
$form.Controls.Add($subtitleLabel)

$summaryBadge = New-Object System.Windows.Forms.Label
$summaryBadge.Size = New-Object System.Drawing.Size(148, 54)
$summaryBadge.Location = New-Object System.Drawing.Point(592, 30)
$summaryBadge.TextAlign = 'MiddleCenter'
$summaryBadge.BorderStyle = 'FixedSingle'
$summaryBadge.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$summaryBadge.BackColor = $uiStyle.SummaryBackColor
$summaryBadge.ForeColor = $uiStyle.MutedTextColor
$summaryBadge.Text = '等待检查'
$form.Controls.Add($summaryBadge)

function New-RequirementRow {
  param(
    [string]$Title,
    [int]$Top
  )

  $panel = New-Object System.Windows.Forms.Panel
  $panel.Size = New-Object System.Drawing.Size($uiStyle.ContentWidth, 92)
  $panel.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, $Top
  $panel.BackColor = $uiStyle.CardBackColor
  $panel.BorderStyle = 'FixedSingle'

  $nameLabel = New-Object System.Windows.Forms.Label
  $nameLabel.Text = $Title
  $nameLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 15, [System.Drawing.FontStyle]::Bold)
  $nameLabel.AutoSize = $true
  $nameLabel.ForeColor = $uiStyle.HeadingColor
  $nameLabel.Location = New-Object System.Drawing.Point(20, 18)
  $panel.Controls.Add($nameLabel)

  $detailLabel = New-Object System.Windows.Forms.Label
  $detailLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5)
  $detailLabel.AutoSize = $false
  $detailLabel.Size = New-Object System.Drawing.Size(430, 40)
  $detailLabel.Location = New-Object System.Drawing.Point(20, 46)
  $detailLabel.ForeColor = $uiStyle.MutedTextColor
  $panel.Controls.Add($detailLabel)

  $badgeLabel = New-Object System.Windows.Forms.Label
  $badgeLabel.TextAlign = 'MiddleCenter'
  $badgeLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
  $badgeLabel.Size = New-Object System.Drawing.Size(96, 32)
  $badgeLabel.Location = New-Object System.Drawing.Point(584, 28)
  $badgeLabel.BorderStyle = 'FixedSingle'
  $panel.Controls.Add($badgeLabel)

  $form.Controls.Add($panel)

  return @{
    Detail = $detailLabel
    Badge = $badgeLabel
  }
}

$nodeRow = New-RequirementRow -Title 'Node.js 24+' -Top 122
$gitRow = New-RequirementRow -Title 'Git' -Top 226
$nodeDetail = $nodeRow.Detail
$nodeBadge = $nodeRow.Badge
$gitDetail = $gitRow.Detail
$gitBadge = $gitRow.Badge

$pathLabel = New-Object System.Windows.Forms.Label
$pathLabel.Text = '安装位置'
$pathLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
$pathLabel.ForeColor = $uiStyle.HeadingColor
$pathLabel.AutoSize = $true
$pathLabel.Location = New-Object System.Drawing.Point -ArgumentList ($uiStyle.ContentLeft + 2), 338
$form.Controls.Add($pathLabel)

$pathTextBox = New-Object System.Windows.Forms.TextBox
$pathTextBox.Size = New-Object System.Drawing.Size(560, 34)
$pathTextBox.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, 364
$pathTextBox.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$pathTextBox.Text = (Get-InstalledDir)
if ([string]::IsNullOrWhiteSpace($pathTextBox.Text)) {
  $pathTextBox.Text = $defaultInstallDir
}
$form.Controls.Add($pathTextBox)

$chooseButton = New-Object System.Windows.Forms.Button
$chooseButton.Text = '浏览'
$chooseButton.Size = New-Object System.Drawing.Size(128, $uiStyle.ButtonHeight)
$chooseButton.Location = New-Object System.Drawing.Point(612, 362)
$chooseButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.Controls.Add($chooseButton)

$recheckButton = New-Object System.Windows.Forms.Button
$recheckButton.Text = '重新检查'
$recheckButton.Size = New-Object System.Drawing.Size(128, $uiStyle.ButtonHeight)
$recheckButton.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, 414
$recheckButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.Controls.Add($recheckButton)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, 470
$progressBar.Size = New-Object System.Drawing.Size($uiStyle.ContentWidth, 20)
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value = 0
$form.Controls.Add($progressBar)

$progressValueLabel = New-Object System.Windows.Forms.Label
$progressValueLabel.Text = '安装进度 0%'
$progressValueLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
$progressValueLabel.AutoSize = $true
$progressValueLabel.Location = New-Object System.Drawing.Point -ArgumentList ($uiStyle.ContentLeft + 2), 498
$form.Controls.Add($progressValueLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = '等待开始安装。'
$statusLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$statusLabel.AutoSize = $false
$statusLabel.Size = New-Object System.Drawing.Size($uiStyle.ContentWidth, 38)
$statusLabel.ForeColor = $uiStyle.MutedTextColor
$statusLabel.Location = New-Object System.Drawing.Point -ArgumentList ($uiStyle.ContentLeft + 2), 524
$form.Controls.Add($statusLabel)

$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = '安装'
$installButton.Size = New-Object System.Drawing.Size($uiStyle.ContentWidth, 44)
$installButton.Location = New-Object System.Drawing.Point -ArgumentList $uiStyle.ContentLeft, 566
$installButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12, [System.Drawing.FontStyle]::Bold)
$installButton.Enabled = $false
$form.Controls.Add($installButton)

$progressTimer = New-Object System.Windows.Forms.Timer
$progressTimer.Interval = 350

$chooseButton.Add_Click({
  Write-InstallerLog 'browse button clicked'
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = '请选择 accr-ui 的安装位置'
  $dialog.ShowNewFolderButton = $true
  if (Test-Path -LiteralPath $pathTextBox.Text) {
    $dialog.SelectedPath = $pathTextBox.Text
  } elseif (-not [string]::IsNullOrWhiteSpace($defaultInstallDir)) {
    $dialog.SelectedPath = [System.IO.Path]::GetDirectoryName($defaultInstallDir)
  }

  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    if (Test-IsDisallowedInstallPath $dialog.SelectedPath) {
      [System.Windows.Forms.MessageBox]::Show('请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。', 'accr-ui 安装程序', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      Set-UiStatus '请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。'
      return
    }

    $pathTextBox.Text = $dialog.SelectedPath
    Set-UiStatus '已选择安装位置。'
  }
})

$recheckButton.Add_Click({
  Write-InstallerLog 'recheck button clicked'
  Refresh-Requirements
  if ($script:requirementsReady) {
    Set-UiStatus '环境检查通过。'
  } else {
    Set-UiStatus '环境检查未通过。'
  }
})

$progressTimer.Add_Tick({
  if (-not (Test-Path -LiteralPath $progressPath -PathType Leaf)) {
    return
  }

  try {
    $raw = [System.IO.File]::ReadAllText($progressPath, [System.Text.Encoding]::UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return
    }

    $parts = $raw.Split('|')
    $percent = 0
    [void][int]::TryParse($parts[0], [ref]$percent)
    $state = if ($parts.Length -gt 1) { $parts[1] } else { '' }
    $detail = if ($parts.Length -gt 2) { ($parts[2..($parts.Length - 1)] -join '|') } else { '' }

    Set-UiProgress $percent
    switch ($state) {
      'preparing' { Set-UiStatus '正在准备安装环境...' }
      'extracting' { Set-UiStatus '正在解压安装包...' }
      'configuring' { Set-UiStatus '正在配置本地运行环境...' }
      'starting' { Set-UiStatus '正在启动本地服务...' }
      'complete' {
        Write-InstallerLog 'install complete'
        $progressTimer.Stop()
        $script:isInstalling = $false
        $script:installFinished = $true
        Set-InstallerBusy $false
        Set-UiStatus '安装完成，浏览器引导页已自动打开。'
        [System.Windows.Forms.MessageBox]::Show('安装完成，请继续按照浏览器引导页进行后续操作。', 'accr-ui 安装程序', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
      }
      'error' {
        Write-InstallerLog ('install error: ' + $detail)
        $progressTimer.Stop()
        $script:isInstalling = $false
        $script:installFinished = $false
        Set-InstallerBusy $false
        Set-UiProgress 0
        Set-UiStatus ($(if ($detail) { $detail } else { '安装失败，请重试。' }))
        [System.Windows.Forms.MessageBox]::Show($(if ($detail) { $detail } else { '安装失败，请重试。' }), 'accr-ui 安装失败', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
      }
      default {
        if ($detail) {
          Set-UiStatus $detail
        }
      }
    }
  } catch {
  }
})

$installButton.Add_Click({
  Write-InstallerLog 'install button clicked'
  if ($script:installFinished) {
    $form.Close()
    return
  }
  if (-not $script:requirementsReady) {
    Set-UiStatus '环境检查未通过。'
    return
  }

  $selectedDir = $pathTextBox.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($selectedDir)) {
    Set-UiStatus '请先选择安装位置。'
    return
  }

  $fullDestPath = [System.IO.Path]::GetFullPath($selectedDir)
  $destRoot = [System.IO.Path]::GetPathRoot($fullDestPath)
  if (Test-IsDisallowedInstallPath $fullDestPath) {
    Set-UiStatus '请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。'
    [System.Windows.Forms.MessageBox]::Show('请不要选择 C 盘，也不要选择包含中文的安装路径，请安装到其他磁盘的英文目录。', 'accr-ui 安装程序', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    return
  }
  if ($fullDestPath.TrimEnd('\\') -eq $destRoot.TrimEnd('\\')) {
    Set-UiStatus '安装位置不能是磁盘根目录。'
    return
  }

  if ([System.IO.Directory]::Exists($fullDestPath) -and [System.IO.Directory]::GetFileSystemEntries($fullDestPath).Length -gt 0) {
    $confirmMessage = "安装位置已存在内容，是否覆盖？" + [Environment]::NewLine + $fullDestPath
    $confirm = [System.Windows.Forms.MessageBox]::Show($confirmMessage, 'accr-ui 安装程序', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
      Set-UiStatus '已取消覆盖安装。'
      return
    }
  }

  [System.IO.File]::WriteAllText($workerPath, (Build-InstallWorkerScript), [System.Text.UTF8Encoding]::new($true))
  Write-InstallProgress 6 'preparing' ''
  Set-UiProgress 6
  Set-UiStatus '正在准备安装环境...'
  Write-InstallerLog ('launch worker for ' + $fullDestPath)
  $script:isInstalling = $true
  $script:installFinished = $false
  Set-InstallerBusy $true

  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    ('"' + $workerPath + '"')
    '-ZipPath'
    ('"' + $payloadZipPath + '"')
    '-DestPath'
    ('"' + $fullDestPath + '"')
    '-ProgressPath'
    ('"' + $progressPath + '"')
  )

  Start-Process -FilePath powershell.exe -ArgumentList $argumentList -WindowStyle Hidden
  $progressTimer.Start()
})

$form.Add_Shown({
  Write-InstallerLog 'form shown'
  Refresh-Requirements
  if ($script:requirementsReady) {
    Set-UiStatus '环境检查通过。'
  } else {
    Set-UiStatus '请先安装 Node.js 24 及以上版本和 Git。'
  }
})

Write-InstallerLog 'show dialog'
[void]$form.ShowDialog()
Write-InstallerLog 'dialog closed'
`;
}

export function installVbs() {
  return `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1Path = fso.BuildPath(scriptDir, "install.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
logPath = fso.BuildPath(scriptDir, "install-launch.log")

Sub AppendLog(message)
  On Error Resume Next
  Dim stream, line
  line = Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & " " & _
    Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2) & " " & message
  Set stream = fso.OpenTextFile(logPath, 8, True)
  stream.WriteLine line
  stream.Close
  On Error GoTo 0
End Sub

Call AppendLog("launcher start")
Call AppendLog("scriptDir=" & scriptDir)
Call AppendLog("ps1Path=" & ps1Path)
Call AppendLog("powershellPath=" & powershellPath)

If Not fso.FileExists(ps1Path) Then
  Call AppendLog("missing install.ps1")
  MsgBox "accr-ui installer file is missing." & vbCrLf & vbCrLf & ps1Path, 16, "accr-ui"
  WScript.Quit 1
End If

If Not fso.FileExists(powershellPath) Then
  Call AppendLog("missing powershell.exe")
  MsgBox "Windows PowerShell was not found." & vbCrLf & vbCrLf & powershellPath, 16, "accr-ui"
  WScript.Quit 1
End If

command = Chr(34) & powershellPath & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -STA -File " & Chr(34) & ps1Path & Chr(34)
Call AppendLog("command=" & command)
exitCode = shell.Run(command, 1, True)
Call AppendLog("exitCode=" & exitCode)
If exitCode <> 0 Then
  MsgBox "accr-ui installer failed to start." & vbCrLf & vbCrLf & "Check log: " & logPath, 16, "accr-ui"
End If
`;
}

export function guideHtml({ platform, startScriptName }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>accr-ui 浏览器引导</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --text: #162033;
      --muted: #5b6880;
      --accent: #2563eb;
      --border: #d8e0ef;
      --ok: #0f766e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 40px 20px 72px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }
    .panel { padding: 28px; margin-bottom: 16px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .sub { color: var(--muted); line-height: 1.6; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin: 20px 0 0;
    }
    .step {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      background: #fbfcff;
      min-height: 180px;
    }
    .step strong {
      display: inline-flex;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: #e0eaff;
      color: var(--accent);
      margin-bottom: 12px;
    }
    .step h3 { font-size: 16px; margin-bottom: 8px; }
    .step p, li { color: var(--muted); line-height: 1.65; }
    .step .path-line {
      margin-top: 12px;
      font-size: 12px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      background: #eff4ff;
      border: 1px solid #d7e4ff;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .callout, .warning {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 8px;
      line-height: 1.6;
    }
    .callout {
      border: 1px solid #c7eed8;
      background: #f0fdf4;
      color: var(--ok);
    }
    .warning {
      border: 1px solid #fed7aa;
      background: #fff7ed;
      color: #9a3412;
    }
    button {
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      padding: 12px 16px;
      font-size: 14px;
      cursor: pointer;
    }
    button.secondary {
      background: #e8eefc;
      color: #1d4ed8;
    }
    .hidden { display: none; }
    .path-line {
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: 8px;
      background: #f8fbff;
      border: 1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      word-break: break-all;
    }
    .step-action {
      margin-top: 12px;
    }
    #done-note[hidden] { display: none; }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>accr-ui 浏览器引导</h1>
      <p class="sub">当前安装器只支持 <code>Chrome</code> 或 <code>Edge</code>。按下面 3 步操作就可以。</p>
      <div id="unsupported" class="warning hidden">当前打开此页面的不是 Chrome 或 Edge。请改用 Chrome 或 Edge 打开这个页面继续安装和使用。</div>
      <div class="grid">
        <article class="step">
          <strong>1</strong>
          <h3>打开扩展管理页</h3>
          <p>打开浏览器扩展管理页。</p>
          <div id="browser-url" class="path-line"></div>
          <button id="copy-browser-url-button" class="secondary step-action" type="button">复制地址</button>
        </article>
        <article class="step">
          <strong>2</strong>
          <h3>开启开发者模式</h3>
          <p>开启“开发人员模式/开发者模式”。</p>
        </article>
        <article class="step">
          <strong>3</strong>
          <h3>加载刚安装的目录</h3>
          <p>点击“加载已解压的扩展程序”，选择这个目录。</p>
          <div id="extension-path" class="path-line"></div>
          <button id="copy-extension-path-button" class="secondary step-action" type="button">复制目录</button>
        </article>
      </div>
    </section>
    <p id="done-note" class="callout hidden">复制后直接按这 3 步操作即可。</p>
  </main>
  <script>
    const ua = navigator.userAgent || '';
    const isEdge = /Edg\\//.test(ua);
    const isChrome = /Chrome\\//.test(ua) && !isEdge && !/OPR\\//.test(ua);
    const supported = isEdge || isChrome;
    const browserName = isEdge ? 'Edge' : isChrome ? 'Chrome' : '其他浏览器';
    const browserUrl = isEdge ? 'edge://extensions/' : 'chrome://extensions/';
    const extensionPathEl = document.getElementById('extension-path');
    const browserUrlEl = document.getElementById('browser-url');
    const doneNote = document.getElementById('done-note');
    const unsupportedEl = document.getElementById('unsupported');
    const rawPath = decodeURIComponent(location.pathname || '').replace(/^\\//, '').replace(/\\//g, '\\\\');
    const runtimeDir = rawPath.replace(/\\\\guide\\.html$/i, '');
    const installRoot = runtimeDir.replace(/\\\\runtime$/i, '');
    const extensionPath = installRoot ? installRoot + '\\\\extension' : '请在安装目录中找到 extension 文件夹';
    extensionPathEl.textContent = extensionPath;
    browserUrlEl.textContent = browserUrl;

    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        const input = document.createElement('textarea');
        input.value = value;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        return true;
      }
    }

    if (supported) {
    } else {
      unsupportedEl.classList.remove('hidden');
      doneNote.hidden = false;
      doneNote.textContent = '请改用 Chrome 或 Edge 打开；地址可复制后手动打开。';
    }

    document.getElementById('copy-browser-url-button').addEventListener('click', async () => {
      await copyText(browserUrl);
      doneNote.hidden = false;
      doneNote.textContent = '扩展管理页地址已复制，请粘贴到浏览器地址栏打开。';
    });

    document.getElementById('copy-extension-path-button').addEventListener('click', async () => {
      await copyText(extensionPath);
      doneNote.hidden = false;
      doneNote.textContent = '扩展目录已复制，请在浏览器里选择这个 extension 目录。';
    });
  </script>
</body>
</html>
`;
}

export function openBrowserPageHta({ title, targetUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <hta:application
    applicationname="ACCRUIOpenBrowserPage"
    border="thin"
    caption="yes"
    contextmenu="no"
    maximizebutton="no"
    minimizebutton="no"
    navigable="no"
    scroll="no"
    selection="no"
    showintaskbar="no"
    singleinstance="no"
    sysmenu="yes"
    windowstate="normal"
  />
  <script language="VBScript">
    On Error Resume Next
    Dim shell
    Set shell = CreateObject("WScript.Shell")
    shell.Run "${targetUrl}", 1, False
    If Err.Number <> 0 Then
      MsgBox "无法自动打开扩展管理页，请手动在地址栏输入：" & vbCrLf & "${targetUrl}", 48, "accr-ui"
      Err.Clear
    End If
    window.close
  </script>
</head>
<body></body>
</html>
`;
}

export function openBrowserPageVbs({ targetUrl }) {
  return `Set shell = CreateObject("WScript.Shell")
shell.Run "${targetUrl}", 1, False
`;
}

export function buildWindowsManifest(hostPath, extensionId) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'accr-ui Windows Lite Native Host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export function startVbs(extensionId) {
  return `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
installRoot = fso.GetParentFolderName(projectDir)
hostName = "${NATIVE_HOST_NAME}"
extensionId = "${extensionId}"
nativePort = "12306"
agentPort = "8792"
logDir = installRoot & "\\logs"
guideStatePath = installRoot & "\\guide-state.json"
guidePath = projectDir & "\\guide.html"
extensionPath = installRoot & "\\extension"
manifestDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\\Google\\Chrome\\NativeMessagingHosts"
manifestPath = manifestDir & "\\" & hostName & ".json"
hostPath = projectDir & "\\run_native_host.bat"
agentRunnerPath = projectDir & "\\run_agent_backend.bat"
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")

Function ReadTextFile(filePath)
  Dim stream
  ReadTextFile = ""
  If Not fso.FileExists(filePath) Then Exit Function
  Set stream = fso.OpenTextFile(filePath, 1, False)
  On Error Resume Next
  ReadTextFile = stream.ReadAll()
  stream.Close
  On Error GoTo 0
End Function

Sub WriteGuideState(isCompleted)
  Dim stateFile
  Set stateFile = fso.CreateTextFile(guideStatePath, True)
  If isCompleted Then
    stateFile.Write "{""completed"": true}"
  Else
    stateFile.Write "{""completed"": false}"
  End If
  stateFile.Close
End Sub

Function IsGuideCompleted()
  Dim stateText
  stateText = ReadTextFile(guideStatePath)
  If InStr(1, stateText, """completed"": true", 1) > 0 Then
    IsGuideCompleted = True
  Else
    IsGuideCompleted = False
  End If
End Function

Function IsExtensionInstalled()
  Dim roots, root, escapedPath, rootFolder, subFolder, prefPath, prefText
  IsExtensionInstalled = False
  roots = Array( _
    localAppData & "\\Google\\Chrome\\User Data", _
    localAppData & "\\Google\\Chrome for Testing\\User Data", _
    localAppData & "\\Chromium\\User Data" _
  )
  escapedPath = Replace(extensionPath, "\\", "\\\\")

  For Each root In roots
    If fso.FolderExists(root) Then
      Set rootFolder = fso.GetFolder(root)
      For Each subFolder In rootFolder.SubFolders
        prefPath = subFolder.Path & "\\Preferences"
        If fso.FileExists(prefPath) Then
          prefText = ReadTextFile(prefPath)
          If InStr(1, prefText, extensionId, 1) > 0 And InStr(1, prefText, escapedPath, 1) > 0 Then
            IsExtensionInstalled = True
            Exit Function
          End If
        End If
      Next
    End If
  Next
End Function

If Not fso.FileExists(installRoot & "\\extension\\manifest.json") Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "缺少 extension\\manifest.json，请使用完整发布包。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If Not fso.FileExists(hostPath) Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "缺少 run_native_host.bat，请使用完整发布包。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If Not fso.FileExists(agentRunnerPath) Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "缺少 run_agent_backend.bat，请使用完整发布包。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If shell.Run("cmd.exe /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "没有在 PATH 中找到 Node.js。请先安装 Node.js 24 或更高版本。", _
         16, "accr-ui"
  WScript.Quit 1
End If

nodeVersion = ""
Set nodeVersionExec = shell.Exec("cmd.exe /c node --version")
Do While nodeVersionExec.Status = 0
  WScript.Sleep 50
Loop
nodeVersion = Trim(nodeVersionExec.StdOut.ReadAll())
If nodeVersionExec.ExitCode <> 0 Or nodeVersion = "" Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "无法读取 Node.js 版本。请确认 node 可正常运行。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If Left(nodeVersion, 1) = "v" Or Left(nodeVersion, 1) = "V" Then
  nodeVersion = Mid(nodeVersion, 2)
End If

nodeMajor = 0
On Error Resume Next
nodeMajor = CInt(Split(nodeVersion, ".")(0))
On Error GoTo 0
If nodeMajor < 24 Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "Node.js 主版本过低：" & nodeVersion & vbCrLf & _
         "请升级到 Node.js 24 或更高版本后重新执行 start.vbs。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If shell.Run("cmd.exe /c where powershell >nul 2>nul", 0, True) <> 0 Then
  MsgBox "accr-ui 启动失败。" & vbCrLf & vbCrLf & _
         "没有找到 PowerShell。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If Not fso.FolderExists(logDir) Then
  shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""New-Item -ItemType Directory -Force -Path '" & Replace(logDir, "'", "''") & "' | Out-Null""", 0, True
End If

If Not fso.FolderExists(manifestDir) Then
  shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""New-Item -ItemType Directory -Force -Path '" & Replace(manifestDir, "'", "''") & "' | Out-Null""", 0, True
End If

shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""$ports = 12306,8792; foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } }""", 0, True
shell.Run "cmd.exe /c """ & agentRunnerPath & """", 0, False

escapedHostPath = Replace(hostPath, "\\", "\\\\")
manifestJson = "{" & vbCrLf & _
  "  ""name"": """ & hostName & """," & vbCrLf & _
  "  ""description"": ""accr-ui Windows Lite Native Host""," & vbCrLf & _
  "  ""path"": """ & escapedHostPath & """," & vbCrLf & _
  "  ""type"": ""stdio""," & vbCrLf & _
  "  ""allowed_origins"": [""chrome-extension://" & extensionId & "/""]" & vbCrLf & _
  "}"

Set manifestFile = fso.CreateTextFile(manifestPath, True)
manifestFile.Write manifestJson
manifestFile.Close

regCommand = "reg add ""HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\" & hostName & """ /ve /t REG_SZ /d """ & manifestPath & """ /f"
edgeRegCommand = "reg add ""HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\" & hostName & """ /ve /t REG_SZ /d """ & manifestPath & """ /f"
If shell.Run(regCommand, 0, True) <> 0 Then
  MsgBox "accr-ui 注册失败。" & vbCrLf & vbCrLf & _
         "无法写入当前用户的 Chrome Native Messaging 注册表。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If shell.Run(edgeRegCommand, 0, True) <> 0 Then
  MsgBox "accr-ui 注册失败。" & vbCrLf & vbCrLf & _
         "无法写入当前用户的 Edge Native Messaging 注册表。", _
         16, "accr-ui"
  WScript.Quit 1
End If

If IsGuideCompleted() Then
  WScript.Quit 0
End If

If IsExtensionInstalled() Then
  Call WriteGuideState(True)
  WScript.Quit 0
End If

Call WriteGuideState(False)
shell.Run "chrome://extensions/", 1, False
If fso.FileExists(guidePath) Then
  shell.Run Chr(34) & guidePath & Chr(34), 1, False
End If
WScript.Quit 0
`;
}

function stopVbs() {
  return `Set shell = CreateObject("WScript.Shell")

ports = Array("12306", "8792")

For Each serverPort In ports
  command = "powershell -NoProfile -Command ""$conn = Get-NetTCPConnection -LocalPort " & serverPort & " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop }; exit 0"""
  exitCode = shell.Run(command, 0, True)
  If exitCode <> 0 Then
    MsgBox "accr-ui 停止失败，端口：" & serverPort, _
           16, "accr-ui"
    WScript.Quit exitCode
  End If
Next

WScript.Quit 0
`;
}

export function nativeHostBat() {
  return `@echo off
setlocal enabledelayedexpansion
set "PACKAGE_DIR=%~dp0"
if "%PACKAGE_DIR:~-1%"=="\\" set "PACKAGE_DIR=%PACKAGE_DIR:~0,-1%"
for %%I in ("%PACKAGE_DIR%\\..") do set "INSTALL_ROOT=%%~fI"
set "LOG_DIR=%INSTALL_ROOT%\\logs"
set "NODE_SCRIPT=%PACKAGE_DIR%\\native-server\\runtime.cjs"

set "WEBMCP_REPO_ROOT=%INSTALL_ROOT%"
set "WEBMCP_AGENT_V2_BASE_URL=http://127.0.0.1:8792"
set "WEBMCP_NATIVE_MCP_URL=http://127.0.0.1:12306/mcp"
set "WEBMCP_AGENT_V2_WINDOWS_START_SCRIPT=%PACKAGE_DIR%\\run_agent_backend.bat"
set "CLAUDE_AGENT_V2_WORKDIR=%INSTALL_ROOT%\\workspace"
set "CLAUDE_AGENT_V2_HOST=127.0.0.1"
set "CLAUDE_AGENT_V2_PORT=8792"
set "CLAUDE_ENABLE_EXTENSION_MCP=true"

if not exist "%LOG_DIR%" md "%LOG_DIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%i"
set "WRAPPER_LOG=%LOG_DIR%\\native_host_wrapper_windows_%TIMESTAMP%.log"
set "STDERR_LOG=%LOG_DIR%\\native_host_stderr_windows_%TIMESTAMP%.log"

echo Wrapper script called at %DATE% %TIME% > "%WRAPPER_LOG%"
echo PACKAGE_DIR: %PACKAGE_DIR% >> "%WRAPPER_LOG%"
echo NODE_SCRIPT: %NODE_SCRIPT% >> "%WRAPPER_LOG%"

set "NODE_EXEC="
for /f "delims=" %%i in ('where node.exe 2^>nul') do (
    if not defined NODE_EXEC (
        set "NODE_EXEC=%%i"
    )
)

if not defined NODE_EXEC if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE_EXEC=%ProgramFiles%\\nodejs\\node.exe"
if not defined NODE_EXEC if exist "%ProgramFiles(x86)%\\nodejs\\node.exe" set "NODE_EXEC=%ProgramFiles(x86)%\\nodejs\\node.exe"
if not defined NODE_EXEC if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" set "NODE_EXEC=%LOCALAPPDATA%\\Programs\\nodejs\\node.exe"

if not defined NODE_EXEC (
    echo ERROR: Node.js executable not found! >> "%WRAPPER_LOG%"
    exit /B 1
)

for /f "delims=" %%i in ('"!NODE_EXEC!" --version 2^>nul') do (
    if not defined NODE_VERSION (
        set "NODE_VERSION=%%i"
    )
)

if defined NODE_VERSION if /i "!NODE_VERSION:~0,1!"=="v" set "NODE_VERSION=!NODE_VERSION:~1!"

for /f "tokens=1 delims=." %%i in ("!NODE_VERSION!") do (
    if not defined NODE_MAJOR (
        set "NODE_MAJOR=%%i"
    )
)

if not defined NODE_MAJOR (
    echo ERROR: Failed to detect Node.js version for !NODE_EXEC! >> "%WRAPPER_LOG%"
    exit /B 1
)

if !NODE_MAJOR! LSS 24 (
    echo ERROR: Node.js 24+ is required, found !NODE_VERSION! at !NODE_EXEC! >> "%WRAPPER_LOG%"
    exit /B 1
)

if not exist "%NODE_SCRIPT%" (
    echo ERROR: Native server runtime not found at %NODE_SCRIPT% >> "%WRAPPER_LOG%"
    exit /B 1
)

set "WEBMCP_AGENT_V2_COMMAND=""!NODE_EXEC!"" ""%PACKAGE_DIR%\\agent-backend-v2\\server.cjs"""
if exist "%PACKAGE_DIR%\\vendor\\claude-agent-sdk\\cli.js" (
    set "CLAUDE_CODE_EXECUTABLE_PATH=%PACKAGE_DIR%\\vendor\\claude-agent-sdk\\cli.js"
)

if not exist "%INSTALL_ROOT%\\workspace" mkdir "%INSTALL_ROOT%\\workspace"
echo Using Node executable: !NODE_EXEC! >> "%WRAPPER_LOG%"
echo Executing: "!NODE_EXEC!" "%NODE_SCRIPT%" >> "%WRAPPER_LOG%"
call "!NODE_EXEC!" "%NODE_SCRIPT%" 2>> "%STDERR_LOG%"
endlocal
`;
}

const SAFE_BAT_ENV_VALUE_PATTERN = /^[A-Za-z0-9:/?#\[\]@&'()*+,;=._~-]+$/;

function validateOptionalBatEnvValue(envName, value) {
  if (!value) {
    return null;
  }

  if (!SAFE_BAT_ENV_VALUE_PATTERN.test(value)) {
    throw new Error(
      `Unsafe value for ${envName}. Only URL-safe characters for Windows Lite feed injection are allowed.`
    );
  }

  return value;
}

function optionalBatEnvSetLines({
  windowsLiteZipUrl,
  liteProjectUrl,
} = {}) {
  const lines = [];
  const safeWindowsLiteZipUrl = validateOptionalBatEnvValue(
    'WEBMCP_WINDOWS_LITE_ZIP_URL',
    windowsLiteZipUrl
  );
  const safeLiteProjectUrl = validateOptionalBatEnvValue('WEBMCP_LITE_PROJECT_URL', liteProjectUrl);

  if (safeWindowsLiteZipUrl) {
    lines.push(`set "WEBMCP_WINDOWS_LITE_ZIP_URL=${safeWindowsLiteZipUrl}"`);
  }

  if (safeLiteProjectUrl) {
    lines.push(`set "WEBMCP_LITE_PROJECT_URL=${safeLiteProjectUrl}"`);
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export function agentBackendBat(options = {}) {
  const optionalEnvLines = optionalBatEnvSetLines(options);

  return `@echo off
setlocal enabledelayedexpansion
set "PACKAGE_DIR=%~dp0"
if "%PACKAGE_DIR:~-1%"=="\\" set "PACKAGE_DIR=%PACKAGE_DIR:~0,-1%"
for %%I in ("%PACKAGE_DIR%\\..") do set "INSTALL_ROOT=%%~fI"
set "LOG_DIR=%INSTALL_ROOT%\\logs"
set "WORKSPACE_DIR=%INSTALL_ROOT%\\workspace"
set "AGENT_ENTRY=%PACKAGE_DIR%\\agent-backend-v2\\server.cjs"

if not exist "%LOG_DIR%" md "%LOG_DIR%"
if not exist "%WORKSPACE_DIR%" md "%WORKSPACE_DIR%"

set "TIMESTAMP=unknown"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%i"
set "AGENT_LOG=%LOG_DIR%\\agent_backend_windows_%TIMESTAMP%.log"

set "NODE_EXEC="
for /f "delims=" %%i in ('where node.exe 2^>nul') do (
    if not defined NODE_EXEC (
        set "NODE_EXEC=%%i"
    )
)

if not defined NODE_EXEC if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE_EXEC=%ProgramFiles%\\nodejs\\node.exe"
if not defined NODE_EXEC if exist "%ProgramFiles(x86)%\\nodejs\\node.exe" set "NODE_EXEC=%ProgramFiles(x86)%\\nodejs\\node.exe"
if not defined NODE_EXEC if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" set "NODE_EXEC=%LOCALAPPDATA%\\Programs\\nodejs\\node.exe"

if not defined NODE_EXEC (
    echo ERROR: Node.js executable not found > "%AGENT_LOG%"
    exit /B 1
)

for /f "delims=" %%i in ('"!NODE_EXEC!" --version 2^>nul') do (
    if not defined NODE_VERSION (
        set "NODE_VERSION=%%i"
    )
)

if defined NODE_VERSION if /i "!NODE_VERSION:~0,1!"=="v" set "NODE_VERSION=!NODE_VERSION:~1!"

for /f "tokens=1 delims=." %%i in ("!NODE_VERSION!") do (
    if not defined NODE_MAJOR (
        set "NODE_MAJOR=%%i"
    )
)

if not defined NODE_MAJOR (
    echo ERROR: Failed to detect Node.js version for !NODE_EXEC! > "%AGENT_LOG%"
    exit /B 1
)

if !NODE_MAJOR! LSS 24 (
    echo ERROR: Node.js 24+ is required, found !NODE_VERSION! at !NODE_EXEC! > "%AGENT_LOG%"
    exit /B 1
)

if not exist "%AGENT_ENTRY%" (
    echo ERROR: Agent backend entry not found at %AGENT_ENTRY% > "%AGENT_LOG%"
    exit /B 1
)

set "WEBMCP_REPO_ROOT=%INSTALL_ROOT%"
set "CLAUDE_AGENT_V2_WORKDIR=%WORKSPACE_DIR%"
set "CLAUDE_AGENT_V2_HOST=127.0.0.1"
set "CLAUDE_AGENT_V2_PORT=8792"
set "CLAUDE_ENABLE_EXTENSION_MCP=true"
set "CLAUDE_EXTENSION_MCP_URL=http://127.0.0.1:12306/mcp"
${optionalEnvLines}if exist "%PACKAGE_DIR%\\vendor\\claude-agent-sdk\\cli.js" (
    set "CLAUDE_CODE_EXECUTABLE_PATH=%PACKAGE_DIR%\\vendor\\claude-agent-sdk\\cli.js"
)

echo Starting bundled agent-backend-v2 at %DATE% %TIME% > "%AGENT_LOG%"
echo Using Node executable: !NODE_EXEC! >> "%AGENT_LOG%"
echo Executing: "!NODE_EXEC!" "%AGENT_ENTRY%" >> "%AGENT_LOG%"
start "" /b cmd.exe /c ""!NODE_EXEC!" "%AGENT_ENTRY%" >> "%AGENT_LOG%" 2>&1"
endlocal
`;
}

function readme(extensionId) {
  return `# accr-ui Windows Lite 试用包

这是一个不使用 exe/msi 安装器的 Windows 便携试用包。

## 使用前提

- Windows 电脑已安装 Chrome 或 Edge。
- Windows 电脑已安装 Node.js 24 或更高版本，并且 \`node\` 在 PATH 中可用。
- 公司策略允许运行 \`vbs\` / \`bat\`，并允许写入当前用户的 Chrome Native Messaging 注册表。

## 安装方式

1. 解压整个 zip，不要只解压单个文件。
2. 双击 \`install.vbs\`。
3. 安装器会先检查 Node.js 24+ 和 Git。
4. 选择安装目录并完成安装。
5. 安装器会打开本地引导页，按提示在 Chrome 或 Edge 中加载安装目录下的 \`extension\` 文件夹。

本包生成的扩展 ID：

\`\`\`text
${extensionId}
\`\`\`

\`install.vbs\` 会静默拉起 \`install.hta\` 安装界面；安装完成后，会把这个扩展 ID 写入 Chrome / Edge 的 Native Messaging 白名单。

## 停止服务

如需手工修复或重新注册环境，可运行安装目录中的：

\`\`\`text
runtime\\start.vbs
\`\`\`

它会重新注册 Native Messaging 并尝试拉起本地服务。

如需停止本地服务，双击安装目录中的：

\`\`\`text
runtime\\stop.vbs
\`\`\`

它会尝试停止 \`12306\` 和 \`8792\` 两个本地端口对应的进程。

## 目录说明

- \`extension/\`：Chrome 扩展构建产物。
- \`native-server/\`：Chrome Native Messaging host 和本地 MCP bridge，已打包为最小运行时。
- \`agent-backend-v2/\`：本地 Agent 后端，已打包为 \`server.cjs\`，使用本机 Node.js 启动。
- \`vendor/claude-agent-sdk/\`：随包携带的 Claude Agent SDK 运行时资产。
- \`install.vbs\`：推荐双击入口，静默拉起安装界面，不显示黑框。
- \`install.hta\`：可视化安装界面本体，负责环境检查、解压 \`payload.zip\` 和注册。
- \`payload.zip\`：真正的安装内容压缩包。
- 安装完成后的 \`extension/\`：浏览器扩展目录，供用户加载。
- 安装完成后的 \`runtime/\`：本地服务、脚本和运行时。
- 安装完成后的 \`workspace/\`：本地工作区数据目录。
- 安装完成后的 \`logs/\`：运行日志目录。

## 注意

- 安装完成后，原始解压目录可以删除，后续请使用安装目录中的内容。
- 如果移动了安装目录，请重新执行安装或运行安装目录中的 \`start.vbs\`，因为 Native Messaging 注册里记录的是绝对路径。
- 这个包是 Windows Lite 试用形态，不是正式安装器。
- 如果公司禁用了 VBS/BAT、注册表写入或 Chrome Native Messaging，这个包也会被策略拦截。
`;
}

async function main() {
  const extensionOutput = path.join(rootDir, 'apps', 'extension', '.output', 'chrome-mv3');
  if (!existsSync(extensionOutput)) {
    throw new Error('Missing extension build output. Run pnpm build:extension first.');
  }

  const windowsLiteBetaState = await readWindowsLiteBetaState();
  const windowsLiteBetaBuildNumber = getNextWindowsLiteBetaBuildNumber(windowsLiteBetaState);
  const windowsLiteCurrentVersion = buildWindowsLiteBetaDisplayName(windowsLiteBetaBuildNumber);
  const windowsLiteReleaseNotesMarkdown = await readFile(windowsLiteReleaseNotesPath, 'utf8');

  await resetDirectory(tempDir);
  await resetDirectory(packageDir);
  await rm(zipPath, { force: true });
  const payloadDir = path.join(tempDir, 'payload');
  await mkdir(payloadDir, { recursive: true });

  run('pnpm', ['build:extension']);
  run('pnpm', ['--filter', '@mcp-b/native-server', 'build']);
  const nativeBundleDir = path.join(tempDir, 'native-server');
  const nativeTsupConfig = path.join(tempDir, 'native-server.tsup.config.mjs');
  await writeFile(
    nativeTsupConfig,
    `export default {
  entry: ['apps/native-server/src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  splitting: false,
  sourcemap: false,
  shims: true,
  outDir: ${JSON.stringify(nativeBundleDir)},
  noExternal: [/.*/],
};
`,
    'utf8'
  );
  run('pnpm', ['exec', 'tsup', '--config', nativeTsupConfig]);

  const agentBundleDir = path.join(tempDir, 'agent-backend-v2');
  const agentTsupConfig = path.join(tempDir, 'agent-backend-v2.tsup.config.mjs');
  await writeFile(
    agentTsupConfig,
    `export default {
  entry: ['apps/agent-backend-v2/src/server.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  splitting: false,
  sourcemap: false,
  shims: true,
  outDir: ${JSON.stringify(agentBundleDir)},
  noExternal: [/.*/],
};
`,
    'utf8'
  );
  run('pnpm', ['exec', 'tsup', '--config', agentTsupConfig]);

  const manifestKey = ONLINE_UPDATE_EXTENSION_MANIFEST_KEY;
  const extensionId = ONLINE_UPDATE_EXTENSION_ID;

  await copyDereferenced(extensionOutput, path.join(payloadDir, 'extension'));
  const manifestPath = path.join(payloadDir, 'extension', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const windowsLiteManifest = applyWindowsLiteBetaManifest(
    {
      ...manifest,
      key: manifestKey,
    },
    windowsLiteBetaBuildNumber
  );
  await writeFile(manifestPath, `${JSON.stringify(windowsLiteManifest, null, 2)}\n`);

  const runtimeDir = path.join(payloadDir, 'runtime');
  await mkdir(path.join(runtimeDir, 'native-server'), { recursive: true });
  for (const asset of buildRuntimeCopyPlan({ rootDir, tempDir, payloadDir, runtimeDir })) {
    await copyDereferenced(asset.from, asset.to);
  }

  await mkdir(path.join(payloadDir, 'logs'), { recursive: true });
  await mkdir(path.join(payloadDir, 'workspace'), { recursive: true });
  await writeUtf16LeFile(path.join(runtimeDir, 'start.vbs'), startVbs(extensionId));
  await writeUtf16LeFile(path.join(runtimeDir, 'stop.vbs'), stopVbs());
  await writeFile(path.join(runtimeDir, 'run_native_host.bat'), nativeHostBat(), 'utf8');
  await writeFile(
    path.join(runtimeDir, 'run_agent_backend.bat'),
    agentBackendBat({
      windowsLiteZipUrl: process.env.WEBMCP_WINDOWS_LITE_ZIP_URL,
      liteProjectUrl: process.env.WEBMCP_LITE_PROJECT_URL,
    }),
    'utf8'
  );
  await writeFile(
    path.join(runtimeDir, 'guide.html'),
    guideHtml({ platform: 'Windows', startScriptName: 'install.vbs' }),
    'utf8'
  );
  await writeFile(
    path.join(runtimeDir, 'release-notes.html'),
    releaseNotesHtml({
      currentVersion: windowsLiteCurrentVersion,
      markdown: windowsLiteReleaseNotesMarkdown,
    }),
    'utf8'
  );
  await writeUtf16LeFile(
    path.join(runtimeDir, 'open-chrome-extensions.vbs'),
    openBrowserPageVbs({
      title: '打开 Chrome 扩展页',
      targetUrl: 'chrome://extensions/',
    })
  );
  await writeUtf16LeFile(
    path.join(runtimeDir, 'open-edge-extensions.vbs'),
    openBrowserPageVbs({
      title: '打开 Edge 扩展页',
      targetUrl: 'edge://extensions/',
    })
  );
  await writeFile(path.join(payloadDir, 'guide-state.json'), guideStateJson(), 'utf8');
  await writeFile(path.join(payloadDir, 'README.zh-CN.md'), readme(extensionId), 'utf8');
  await writeFile(path.join(payloadDir, 'extension-id.txt'), `${extensionId}\n`, 'utf8');

  const payloadZipPath = path.join(packageDir, 'payload.zip');
  const payloadArchiveInvocation = buildPayloadArchiveInvocation({ outputPath: payloadZipPath });
  console.log(`$ ${payloadArchiveInvocation.command} ${payloadArchiveInvocation.args.join(' ')}`);
  execFileSync(payloadArchiveInvocation.command, payloadArchiveInvocation.args, {
    cwd: payloadDir,
    stdio: 'inherit',
  });
  await writeUtf8BomFile(path.join(packageDir, 'install.ps1'), installPs1(extensionId));
  await writeUtf16LeFile(path.join(packageDir, 'install.vbs'), installVbs());

  await mkdir(releaseDir, { recursive: true });
  const archiveInvocation = buildArchiveInvocation({ zipPath, packageName });
  console.log(`$ ${archiveInvocation.command} ${archiveInvocation.args.join(' ')}`);
  execFileSync(archiveInvocation.command, archiveInvocation.args, {
    cwd: releaseDir,
    stdio: 'inherit',
  });

  await writeWindowsLiteBetaState(windowsLiteBetaBuildNumber);

  await rm(tempDir, { recursive: true, force: true });

  console.log(
    `Windows Lite beta version: ${windowsLiteCurrentVersion}`
  );
  console.log(`Created ${zipPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
