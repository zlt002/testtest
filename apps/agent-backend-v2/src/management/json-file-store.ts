import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readJsonObjectFile(filepath: string) {
  try {
    return normalizeObject(JSON.parse(await readFile(filepath, 'utf8')));
  } catch {
    return {};
  }
}

export async function updateJsonObjectFile(
  filepath: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
) {
  const current = await readJsonObjectFile(filepath);
  const next = normalizeObject(await updater(current));
  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
