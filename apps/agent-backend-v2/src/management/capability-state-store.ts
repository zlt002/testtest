import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { readJsonObjectFile, updateJsonObjectFile } from './json-file-store.ts';
import type { CapabilityType } from './capability-catalog-service.ts';

type CapabilityStateFile = {
  skills?: Record<string, boolean>;
  commands?: Record<string, boolean>;
};

function stateFilePath(rootDir: string) {
  return join(rootDir, '.claude', 'capability-state.json');
}

function stateBucketKey(type: CapabilityType) {
  return type === 'skill' ? 'skills' : 'commands';
}

function normalizeBooleanMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, boolean>;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim())
      .map(([key, enabled]) => [key.trim(), Boolean(enabled)])
  );
}

function normalizeStateFile(value: Record<string, unknown>): CapabilityStateFile {
  return {
    skills: normalizeBooleanMap(value.skills),
    commands: normalizeBooleanMap(value.commands),
  };
}

function capabilityKey(rootDir: string, filepath: string) {
  return relative(resolve(rootDir), resolve(filepath)).replace(/\\/g, '/');
}

export async function readCapabilityState(rootDir = homedir()) {
  const payload = await readJsonObjectFile(stateFilePath(resolve(rootDir)));
  return normalizeStateFile(payload);
}

export function resolveCapabilityEnabled(input: {
  type: CapabilityType;
  rootDir: string;
  filepath: string;
  state: CapabilityStateFile;
}) {
  const bucket = input.type === 'skill' ? input.state.skills : input.state.commands;
  const key = capabilityKey(input.rootDir, input.filepath);
  return bucket?.[key] !== false;
}

export async function setCapabilityEnabledState(input: {
  type: CapabilityType;
  rootDir?: string;
  filepath: string;
  enabled: boolean;
}) {
  const rootDir = resolve(input.rootDir || homedir());
  const filepath = resolve(input.filepath);
  const key = capabilityKey(rootDir, filepath);
  const bucketKey = stateBucketKey(input.type);

  await updateJsonObjectFile(stateFilePath(rootDir), (current) => {
    const normalized = normalizeStateFile(current);
    const bucket = { ...(normalized[bucketKey] || {}) } as Record<string, boolean>;
    if (input.enabled) {
      delete bucket[key];
    } else {
      bucket[key] = false;
    }
    return {
      ...current,
      [bucketKey]: bucket,
    };
  });

  return { enabled: Boolean(input.enabled) };
}
