import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TARGETS = {
  dev: 'apps/extension/.output/chrome-mv3-dev',
  build: 'apps/extension/.output/chrome-mv3',
  all: 'apps/extension/.output',
};

const targetName = process.argv[2];
const targetPath = TARGETS[targetName];

if (!targetPath) {
  console.error('Usage: node scripts/clean-extension-output.mjs <dev|build|all>');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolved = path.resolve(repoRoot, targetPath);
await rm(resolved, { recursive: true, force: true });
console.log(`Removed ${targetPath}`);
