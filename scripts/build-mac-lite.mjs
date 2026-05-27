import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ONLINE_UPDATE_EXTENSION_ID,
  ONLINE_UPDATE_EXTENSION_MANIFEST_KEY,
} from './lite-extension-identity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const tempDir = path.join(rootDir, '.tmp', 'mac-lite');
const packageName = 'accr-ui-mac-lite-arm64';
const packageDir = path.join(releaseDir, packageName);
const zipPath = path.join(releaseDir, `${packageName}.zip`);
const NATIVE_HOST_NAME = 'com.chromemcp.nativehost';

export function buildMacManifestDirs(homeDir) {
  return [
    path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
    path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
    path.join(
      homeDir,
      'Library',
      'Application Support',
      'Google',
      'Chrome for Testing',
      'NativeMessagingHosts'
    ),
    path.join(homeDir, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
  ];
}

export function buildNativeHostManifest(hostPath, extensionId) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'accr Mac Lite Native Host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
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

export function guideStateJson() {
  return '{\n  "completed": false\n}\n';
}

export function guideHtml({ platform, startScriptName }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>accr Lite 安装指引</title>
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
    .hero, .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }
    .hero { padding: 28px; margin-bottom: 20px; }
    .panel { padding: 24px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .sub { color: var(--muted); line-height: 1.6; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin: 20px 0 24px;
    }
    .step {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      background: #fbfcff;
      min-height: 132px;
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
    code {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      background: #eff4ff;
      border: 1px solid #d7e4ff;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .callout {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid #c7eed8;
      background: #f0fdf4;
      color: var(--ok);
      line-height: 1.6;
    }
    .meta {
      display: grid;
      gap: 10px;
      margin-top: 20px;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 20px;
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
    #done-note[hidden] { display: none; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>欢迎使用 accr Lite</h1>
      <p class="sub">这是 ${platform} 便携试用包的首次安装指引。按下面步骤完成一次扩展加载，后续再次执行 <code>${startScriptName}</code> 时，如果系统检测到扩展已经加载成功，就不会再重复打开这个页面。</p>
      <div class="callout">你需要在 Chrome 或 Edge 的扩展管理页里选择当前目录下的 <code>extension</code> 文件夹，这一步最关键。</div>
    </section>
    <section class="panel">
      <h2>安装步骤</h2>
      <div class="grid">
        <article class="step">
          <strong>1</strong>
          <h3>打开扩展管理页</h3>
          <p>启动脚本会优先帮你打开已安装当前扩展的 Chrome 或 Edge 扩展页。如果没打开，请手动在浏览器地址栏输入 <code>chrome://extensions/</code>。</p>
        </article>
        <article class="step">
          <strong>2</strong>
          <h3>开启开发者模式</h3>
          <p>在扩展页右上角找到“开发者模式”，把它打开。</p>
        </article>
        <article class="step">
          <strong>3</strong>
          <h3>加载已解压的扩展程序</h3>
          <p>点击“加载已解压的扩展程序”，不要选错成压缩包或上一级目录。</p>
        </article>
        <article class="step">
          <strong>4</strong>
          <h3>选择 extension 文件夹</h3>
          <p>在当前 Lite 包目录中，选择 <code>extension</code> 文件夹作为扩展目录。</p>
        </article>
      </div>
      <div class="meta">
        <p>如果安装后依旧有异常，优先查看 <code>logs</code> 目录。</p>
        <p>如果你移动了整个解压目录，请重新执行 <code>${startScriptName}</code>，因为 Native Messaging 注册使用的是绝对路径。</p>
        <p>启动脚本会在下次运行时读取 Chrome / Edge 配置并更新 <code>guide-state.json</code>，检测到扩展已经从当前目录加载后，就不再展示本页。</p>
      </div>
      <div class="actions">
        <button id="done-button" type="button">我已完成安装</button>
        <button id="retry-button" class="secondary" type="button">再看一遍安装步骤</button>
      </div>
      <p id="done-note" class="callout" hidden>已经完成就可以关闭这个页面了。下次再次执行 <code>${startScriptName}</code> 时，脚本会自动识别扩展是否已从当前目录加载成功，并尽量不再打扰你。</p>
    </section>
  </main>
  <script>
    const note = document.getElementById('done-note');
    document.getElementById('done-button').addEventListener('click', () => {
      note.hidden = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
    document.getElementById('retry-button').addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  </script>
</body>
</html>
`;
}

function shellEnvLiteral(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function updateFeedEnvBlock(updateSource = {}) {
  const lines = [];
  if (updateSource.updatePackageUrl) {
    lines.push(`export WEBMCP_MAC_LITE_ZIP_URL="${shellEnvLiteral(updateSource.updatePackageUrl)}"`);
  }
  if (updateSource.updateProjectUrl) {
    lines.push(`export WEBMCP_LITE_PROJECT_URL="${shellEnvLiteral(updateSource.updateProjectUrl)}"`);
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export function startCommand(extensionId, updateSource = {}) {
  const manifest = JSON.stringify(buildNativeHostManifest('$HOST_PATH', '$EXTENSION_ID'), null, 2);
  const updateEnvBlock = updateFeedEnvBlock(updateSource);

  return `#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

HOST_NAME="${NATIVE_HOST_NAME}"
EXTENSION_ID="${extensionId}"
PACKAGE_DIR="$(pwd)"
HOST_PATH="$PACKAGE_DIR/run_native_host.command"
PORTS=(12306 8792)
AGENT_LOG_DIR="$PACKAGE_DIR/logs"
AGENT_WORKSPACE_DIR="$PACKAGE_DIR/workspace"
AGENT_ENTRY="$PACKAGE_DIR/agent-backend-v2/server.cjs"
CLAUDE_CLI_PATH="$PACKAGE_DIR/vendor/claude-agent-sdk/cli.js"
GUIDE_STATE_PATH="$PACKAGE_DIR/guide-state.json"
GUIDE_PATH="$PACKAGE_DIR/guide.html"
EXTENSION_DIR="$PACKAGE_DIR/extension"
MANIFEST_DIRS=(
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
)
PREFERENCE_ROOTS=(
  "$HOME/Library/Application Support/Microsoft Edge"
  "$HOME/Library/Application Support/Google/Chrome"
  "$HOME/Library/Application Support/Google/Chrome for Testing"
  "$HOME/Library/Application Support/Chromium"
)
PREFERENCE_BROWSER_APPS=(
  "Microsoft Edge:$HOME/Library/Application Support/Microsoft Edge"
  "Google Chrome:$HOME/Library/Application Support/Google/Chrome"
)
${updateEnvBlock}

write_guide_state() {
  local completed="$1"
  cat > "$GUIDE_STATE_PATH" <<JSON
{
  "completed": $completed
}
JSON
}

is_guide_completed() {
  [ -f "$GUIDE_STATE_PATH" ] && grep -Fq '"completed": true' "$GUIDE_STATE_PATH"
}

is_extension_installed() {
  local root
  local profile_dir
  local preferences_path
  for root in "\${PREFERENCE_ROOTS[@]}"; do
    [ -d "$root" ] || continue
    for profile_dir in "$root"/*; do
      [ -d "$profile_dir" ] || continue
      preferences_path="$profile_dir/Preferences"
      [ -f "$preferences_path" ] || continue
      if grep -Fq "$EXTENSION_ID" "$preferences_path" && grep -Fq "$EXTENSION_DIR" "$preferences_path"; then
        return 0
      fi
    done
  done
  return 1
}

browser_has_extension() {
  local root="$1"
  local profile_dir
  local preferences_path
  [ -d "$root" ] || return 1
  for profile_dir in "$root"/*; do
    [ -d "$profile_dir" ] || continue
    preferences_path="$profile_dir/Preferences"
    [ -f "$preferences_path" ] || continue
    if grep -Fq "$EXTENSION_ID" "$preferences_path" && grep -Fq "$EXTENSION_DIR" "$preferences_path"; then
      return 0
    fi
  done
  return 1
}

append_open_browser_app() {
  local candidate="$1"
  local existing
  for existing in "\${OPEN_BROWSER_APPS[@]:-}"; do
    if [ "$existing" = "$candidate" ]; then
      return 0
    fi
  done
  OPEN_BROWSER_APPS+=("$candidate")
}

open_browser_extensions_page() {
  local browser_app="$1"
  if [ "$browser_app" = "Microsoft Edge" ]; then
    osascript \
      -e 'tell application "Microsoft Edge" to activate' \
      -e 'tell application "Microsoft Edge" to set URL of active tab of front window to "edge://extensions/"' \
      >/dev/null 2>&1
    return $?
  fi

  if [ "$browser_app" = "Google Chrome" ]; then
    open -a "Google Chrome" "chrome://extensions/" >/dev/null 2>&1
    return $?
  fi

  return 1
}

if [ ! -f "$PACKAGE_DIR/extension/manifest.json" ]; then
  echo "[ERROR] Missing extension/manifest.json. Please use a complete release package."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -f "$HOST_PATH" ]; then
  echo "[ERROR] Missing run_native_host.command. Please use a complete release package."
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found in PATH. Install Node.js 22 or later first."
  read -r -p "Press Enter to close..."
  exit 1
fi

mkdir -p "$PACKAGE_DIR/logs" "$PACKAGE_DIR/workspace"
chmod +x "$HOST_PATH" "$PACKAGE_DIR/stop.command" 2>/dev/null || true

for port in "\${PORTS[@]}"; do
  PIDS="$(lsof -ti tcp:"$port" || true)"
  if [ -n "$PIDS" ]; then
    kill $PIDS || true
    echo "Stopped existing service on port $port."
  fi
done

NODE_EXEC="$(command -v node || true)"
if [ -z "$NODE_EXEC" ]; then
  for candidate in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_EXEC="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_EXEC" ]; then
  echo "[ERROR] Could not resolve Node.js executable."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ -f "$AGENT_ENTRY" ]; then
  AGENT_TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
  AGENT_LOG="$AGENT_LOG_DIR/agent_backend_macos_$AGENT_TIMESTAMP.log"
  (
    export WEBMCP_REPO_ROOT="$PACKAGE_DIR"
    export CLAUDE_AGENT_V2_WORKDIR="$AGENT_WORKSPACE_DIR"
    export CLAUDE_AGENT_V2_HOST="127.0.0.1"
    export CLAUDE_AGENT_V2_PORT="8792"
    export CLAUDE_ENABLE_EXTENSION_MCP="true"
    export CLAUDE_EXTENSION_MCP_URL="http://127.0.0.1:12306/mcp"
    if [ -f "$CLAUDE_CLI_PATH" ]; then
      export CLAUDE_CODE_EXECUTABLE_PATH="$CLAUDE_CLI_PATH"
    fi
    nohup "$NODE_EXEC" "$AGENT_ENTRY" >> "$AGENT_LOG" 2>&1 &
  )
  echo "Started bundled agent-backend-v2 in background."
fi

for MANIFEST_DIR in "\${MANIFEST_DIRS[@]}"; do
  MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
  mkdir -p "$MANIFEST_DIR"
  if [ -f "$MANIFEST_PATH" ]; then
    echo "Removing existing native host manifest: $MANIFEST_PATH"
    rm -f "$MANIFEST_PATH"
  fi
  cat > "$MANIFEST_PATH" <<JSON
${manifest}
JSON
done

if is_guide_completed; then
  exit 0
fi

if is_extension_installed; then
  write_guide_state true
  exit 0
fi

write_guide_state false
OPEN_BROWSER_APPS=()
for browser_mapping in "\${PREFERENCE_BROWSER_APPS[@]}"; do
  BROWSER_APP_NAME="\${browser_mapping%%:*}"
  BROWSER_ROOT="\${browser_mapping#*:}"
  if browser_has_extension "$BROWSER_ROOT"; then
    append_open_browser_app "$BROWSER_APP_NAME"
  fi
done
append_open_browser_app "Microsoft Edge"
append_open_browser_app "Google Chrome"
OPENED_BROWSER=0
for BROWSER_APP in "\${OPEN_BROWSER_APPS[@]}"; do
  if open_browser_extensions_page "$BROWSER_APP"; then
    OPENED_BROWSER=1
    break
  fi
done
if [ "$OPENED_BROWSER" -ne 1 ]; then
  if ! open "chrome://extensions/" 2>/dev/null; then
    echo "[WARN] Could not open chrome://extensions/ automatically. Please open Chrome or Edge manually."
  fi
fi
if [ -f "$GUIDE_PATH" ]; then
  open "$GUIDE_PATH" 2>/dev/null || true
fi
`;
}

function stopCommand() {
  return `#!/bin/bash
set -euo pipefail

PORTS=(12306 8792)

for port in "\${PORTS[@]}"; do
  PIDS="$(lsof -ti tcp:"$port" || true)"
  if [ -n "$PIDS" ]; then
    kill $PIDS || true
    echo "Stopped service on port $port."
  fi
done

echo "accr Mac Lite stop completed."
`;
}

function nativeHostCommand(updateSource = {}) {
  const updateEnvBlock = updateFeedEnvBlock(updateSource);

  return `#!/bin/bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PACKAGE_DIR/logs"
NODE_SCRIPT="$PACKAGE_DIR/native-server/runtime.cjs"

export WEBMCP_REPO_ROOT="$PACKAGE_DIR"
export WEBMCP_AGENT_V2_BASE_URL="http://127.0.0.1:8792"
export WEBMCP_NATIVE_MCP_URL="http://127.0.0.1:12306/mcp"
export CLAUDE_AGENT_V2_WORKDIR="$PACKAGE_DIR/workspace"
export CLAUDE_AGENT_V2_HOST="127.0.0.1"
export CLAUDE_AGENT_V2_PORT="8792"
export CLAUDE_ENABLE_EXTENSION_MCP="true"
export WEBMCP_AGENT_V2_COMMAND="node \\"$PACKAGE_DIR/agent-backend-v2/server.cjs\\""
${updateEnvBlock}
if [ -f "$PACKAGE_DIR/vendor/claude-agent-sdk/cli.js" ]; then
  export CLAUDE_CODE_EXECUTABLE_PATH="$PACKAGE_DIR/vendor/claude-agent-sdk/cli.js"
fi

mkdir -p "$LOG_DIR" "$PACKAGE_DIR/workspace"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
WRAPPER_LOG="$LOG_DIR/native_host_wrapper_macos_$TIMESTAMP.log"
STDERR_LOG="$LOG_DIR/native_host_stderr_macos_$TIMESTAMP.log"

{
  echo "Wrapper script called at $(date)"
  echo "PACKAGE_DIR: $PACKAGE_DIR"
  echo "NODE_SCRIPT: $NODE_SCRIPT"
} > "$WRAPPER_LOG"

NODE_EXEC="$(command -v node || true)"
if [ -z "$NODE_EXEC" ]; then
  for candidate in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_EXEC="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_EXEC" ]; then
  echo "ERROR: Node.js executable not found" >> "$WRAPPER_LOG"
  exit 1
fi

if [ ! -f "$NODE_SCRIPT" ]; then
  echo "ERROR: Native server runtime not found at $NODE_SCRIPT" >> "$WRAPPER_LOG"
  exit 1
fi

echo "Using Node executable: $NODE_EXEC" >> "$WRAPPER_LOG"
echo "Executing: $NODE_EXEC $NODE_SCRIPT" >> "$WRAPPER_LOG"
exec "$NODE_EXEC" "$NODE_SCRIPT" 2>> "$STDERR_LOG"
`;
}

function readme(extensionId) {
  return `# accr Mac Lite 试用包

这是一个不使用 dmg/pkg 安装器的 macOS 便携试用包。

## 使用前提

- macOS 机器已安装 Chrome。
- macOS 机器已安装 Node.js 22 或更高版本，并且 \`node\` 在 PATH 中可用。
- 当前用户允许写入 Chrome 或 Edge 的 Native Messaging manifest 目录。

## 启动方式

第一次解压后，如果系统提示脚本无法打开，可以在终端进入解压目录后执行：

\`\`\`bash
chmod +x start.command stop.command run_native_host.command
\`\`\`

然后双击：

\`\`\`text
start.command
\`\`\`

\`start.command\` 会优先打开已经安装当前扩展的 Edge 或 Chrome 扩展页。打开后，开启“开发者模式”，点击“加载已解压的扩展程序”，选择本目录下的 \`extension\` 文件夹。

\`start.command\` 会先清理旧端口占用，并在后台预启动包内的 \`agent-backend-v2\`。

本包生成的扩展 ID：

\`\`\`text
${extensionId}
\`\`\`

\`start.command\` 会把这个扩展 ID 写入 Native Messaging 白名单。

## 停止服务

如需停止本地服务，双击：

\`\`\`text
stop.command
\`\`\`

它会尝试停止 \`12306\` 和 \`8792\` 两个本地端口对应的进程。

## 目录说明

- \`extension/\`：Chrome / Edge 扩展构建产物。
- \`native-server/\`：Chrome / Edge Native Messaging host 和本地 MCP bridge，已打包为最小运行时。
- \`agent-backend-v2/\`：本地 Agent 后端，已打包为 \`server.cjs\`，使用本机 Node.js 启动。
- \`vendor/claude-agent-sdk/\`：Claude Agent SDK 运行时目录，包含 \`cli.js\`、manifest 和 vendor 资源。
- \`run_native_host.command\`：Chrome / Edge 实际调用的 native host 入口。
- \`workspace/\`：本地工作区数据目录。
- \`logs/\`：运行日志目录。

## 注意

- 如果移动了整个文件夹，请重新双击 \`start.command\`，因为 Native Messaging manifest 里记录的是绝对路径。
- 这个包是 Mac Lite 试用形态，不是正式安装器。
`;
}

async function main() {
  const updateSource = {
    updatePackageUrl: process.env.WEBMCP_MAC_LITE_ZIP_URL?.trim() || '',
    updateProjectUrl: process.env.WEBMCP_LITE_PROJECT_URL?.trim() || '',
  };
  const extensionOutput = path.join(rootDir, 'apps', 'extension', '.output', 'chrome-mv3');
  if (!existsSync(extensionOutput)) {
    throw new Error('Missing extension build output. Run pnpm build:extension first.');
  }

  await rm(tempDir, { recursive: true, force: true });
  await rm(packageDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });

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

  await copyDereferenced(extensionOutput, path.join(packageDir, 'extension'));
  const manifestPath = path.join(packageDir, 'extension', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.key = manifestKey;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await mkdir(path.join(packageDir, 'native-server'), { recursive: true });
  await copyDereferenced(
    path.join(tempDir, 'native-server', 'index.cjs'),
    path.join(packageDir, 'native-server', 'runtime.cjs')
  );
  await copyDereferenced(
    path.join(tempDir, 'agent-backend-v2'),
    path.join(packageDir, 'agent-backend-v2')
  );
  await copyDereferenced(
    path.join(rootDir, 'apps', 'agent-backend-v2', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
    path.join(packageDir, 'vendor', 'claude-agent-sdk')
  );

  await mkdir(path.join(packageDir, 'logs'), { recursive: true });
  await mkdir(path.join(packageDir, 'workspace'), { recursive: true });
  await writeFile(path.join(packageDir, 'start.command'), startCommand(extensionId, updateSource), 'utf8');
  await writeFile(path.join(packageDir, 'stop.command'), stopCommand(), 'utf8');
  await writeFile(
    path.join(packageDir, 'run_native_host.command'),
    nativeHostCommand(updateSource),
    'utf8'
  );
  await writeFile(path.join(packageDir, 'guide.html'), guideHtml({ platform: 'macOS', startScriptName: 'start.command' }), 'utf8');
  await writeFile(path.join(packageDir, 'guide-state.json'), guideStateJson(), 'utf8');
  await writeFile(path.join(packageDir, 'README.zh-CN.md'), readme(extensionId), 'utf8');
  await writeFile(path.join(packageDir, 'extension-id.txt'), `${extensionId}\n`, 'utf8');

  await chmod(path.join(packageDir, 'start.command'), 0o755);
  await chmod(path.join(packageDir, 'stop.command'), 0o755);
  await chmod(path.join(packageDir, 'run_native_host.command'), 0o755);

  await mkdir(releaseDir, { recursive: true });
  run('zip', ['-qr', zipPath, packageName], { cwd: releaseDir });

  await rm(tempDir, { recursive: true, force: true });

  console.log(`Created ${zipPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
