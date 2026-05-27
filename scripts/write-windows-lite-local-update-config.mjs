import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(rootDir, 'release', 'accr-ui-windows-lite-x64');

const configPath = path.join(targetDir, '.webmcp-update-source.json');
const config = {
  windowsLiteZipUrl: 'http://127.0.0.1:8866/accr-ui-windows-lite-x64.zip',
  projectUrl: 'http://127.0.0.1:8866/',
};

await mkdir(targetDir, { recursive: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(`Wrote Windows Lite local update config: ${configPath}`);
