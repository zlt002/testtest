import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..', 'release', 'accr-ui-windows-lite-x64');
const serverPath = path.join(packageDir, 'agent-backend-v2', 'server.cjs');
const port = Number(process.env.WEBMCP_RELEASE_SMOKE_PORT || 18797);
const runAgentSmoke = process.env.WEBMCP_RELEASE_SMOKE_AGENT === '1';

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCapabilities(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/capabilities`);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error('Timed out waiting for capabilities');
}

async function runAgentQuery(baseUrl, workdir) {
  const response = await fetch(`${baseUrl}/api/agent-v2/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '请只回复“accr smoke ok”。',
      projectPath: workdir,
      permissionMode: 'bypassPermissions',
      effort: 'low',
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent smoke request failed with status ${response.status}`);
  }

  const body = await response.text();
  if (!body.includes('"type":"run.completed"')) {
    throw new Error(`Agent smoke did not complete. Response body:\n${body.slice(0, 4000)}`);
  }
}

const workdir = await mkdtemp(path.join(tmpdir(), 'accr-release-smoke-'));
await mkdir(workdir, { recursive: true });

const child = spawn(process.execPath, [serverPath], {
  cwd: packageDir,
  env: {
    ...process.env,
    CLAUDE_AGENT_V2_HOST: '127.0.0.1',
    CLAUDE_AGENT_V2_PORT: String(port),
    CLAUDE_AGENT_V2_WORKDIR: workdir,
    CLAUDE_EXTENSION_MCP_URL: 'http://127.0.0.1:12306/mcp',
    CLAUDE_ENABLE_EXTENSION_MCP: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const capabilities = await waitForCapabilities(baseUrl);
  console.log('[smoke] capabilities ok:', JSON.stringify(capabilities));

  if (runAgentSmoke) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('WEBMCP_RELEASE_SMOKE_AGENT=1 requires ANTHROPIC_API_KEY');
    }
    await runAgentQuery(baseUrl, workdir);
    console.log('[smoke] agent query ok');
  } else {
    console.log(
      '[smoke] skipped real agent query; set WEBMCP_RELEASE_SMOKE_AGENT=1 with ANTHROPIC_API_KEY to enable it'
    );
  }
} finally {
  child.kill('SIGTERM');
}
