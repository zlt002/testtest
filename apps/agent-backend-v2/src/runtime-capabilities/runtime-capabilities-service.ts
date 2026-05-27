import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const AuthSourceSchema = z.enum(['user_claude_settings', 'project_model_config']);

export const RuntimeCapabilitiesSchema = z.object({
  selectedAuthSource: AuthSourceSchema.default('user_claude_settings'),
});

export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  selectedAuthSource: 'user_claude_settings',
};

const LegacyRuntimeCapabilitiesSchema = z
  .object({
    inheritUserClaudeSettings: z.boolean().optional(),
  })
  .passthrough();

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

async function readConfig(configPath: string): Promise<RuntimeCapabilities> {
  try {
    const payload = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (
      payload &&
      typeof payload === 'object' &&
      'selectedAuthSource' in (payload as Record<string, unknown>)
    ) {
      return RuntimeCapabilitiesSchema.parse(payload);
    }

    const legacy = LegacyRuntimeCapabilitiesSchema.safeParse(payload);
    if (legacy.success) {
      return {
        selectedAuthSource:
          legacy.data.inheritUserClaudeSettings === false
            ? 'project_model_config'
            : 'user_claude_settings',
      };
    }

    return RuntimeCapabilitiesSchema.parse(payload);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_RUNTIME_CAPABILITIES };
    }
    throw error;
  }
}

async function writeConfig(configPath: string, config: RuntimeCapabilities): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function createRuntimeCapabilitiesService(options: { configPath: string }) {
  let updateQueue = Promise.resolve<RuntimeCapabilities | undefined>(undefined);

  return {
    async getCapabilities(): Promise<RuntimeCapabilities> {
      return readConfig(options.configPath);
    },

    async updateCapabilities(
      patch: Partial<RuntimeCapabilities>
    ): Promise<RuntimeCapabilities> {
      const runUpdate = async (): Promise<RuntimeCapabilities> => {
        const current = await readConfig(options.configPath);
        const next = RuntimeCapabilitiesSchema.parse({
          ...current,
          ...omitUndefined(patch),
        });
        await writeConfig(options.configPath, next);
        return next;
      };

      const nextUpdate = updateQueue.then(runUpdate, runUpdate);
      updateQueue = nextUpdate.catch(() => undefined);
      return nextUpdate;
    },
  };
}
