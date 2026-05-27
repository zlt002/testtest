import { z } from 'zod';

const trimmedRequiredString = (message: string) => z.string().trim().min(1, message);

export const userScriptFormSchema = z.object({
  id: trimmedRequiredString('ID is required'),
  matches: z
    .array(trimmedRequiredString('Match is required'))
    .min(1, 'At least one match is required'),
  excludeMatches: z.array(trimmedRequiredString('Exclude match is required')).optional(),
  runAt: z.enum(['document_start', 'document_end', 'document_idle']).default('document_start'),
  allFrames: z.boolean().default(false),
  world: z.enum(['MAIN', 'USER_SCRIPT']).default('MAIN'),
  worldId: z.string().optional(),
});

export type UserScriptFormValues = z.infer<typeof userScriptFormSchema>;
export type UserScriptRegisterPayload = {
  id: string;
  matches: string[];
  js: Array<{ code: string }>;
  excludeMatches?: string[];
  allFrames: boolean;
  runAt: UserScriptFormValues['runAt'];
  world: UserScriptFormValues['world'];
  worldId?: string;
};
export type UserScriptUpdatePayload = {
  id: string;
  updates: Omit<UserScriptRegisterPayload, 'id'>;
};
export type StoredUserScriptCodePayload = string | { content?: string } | null | undefined;
export type UserScriptArrayFieldName = 'matches' | 'excludeMatches';

type UserScriptFormSource = {
  id: string;
  matches?: string[];
  excludeMatches?: string[];
  runAt?: UserScriptFormValues['runAt'];
  allFrames?: boolean;
  world?: UserScriptFormValues['world'];
  worldId?: string;
};

function normalizePatternList(values?: string[]): string[] | undefined {
  const normalized = values?.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function createEmptyUserScriptFormValues(id = ''): UserScriptFormValues {
  return {
    id,
    matches: [''],
    excludeMatches: [],
    runAt: 'document_start',
    allFrames: false,
    world: 'MAIN',
    worldId: '',
  };
}

export function mapScriptToFormValues(script: UserScriptFormSource): UserScriptFormValues {
  return {
    id: script.id,
    matches: script.matches && script.matches.length > 0 ? script.matches : [''],
    excludeMatches: script.excludeMatches ?? [],
    runAt: script.runAt ?? 'document_start',
    allFrames: script.allFrames ?? false,
    world: script.world ?? 'MAIN',
    worldId: script.worldId ?? '',
  };
}

export function extractStoredUserScriptCode(payload: StoredUserScriptCodePayload): string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload.content === 'string') {
    return payload.content;
  }
  return undefined;
}

export function hasStoredUserScriptCode(payload: StoredUserScriptCodePayload): boolean {
  return (extractStoredUserScriptCode(payload)?.trim().length ?? 0) > 0;
}

export function getArrayFieldErrorMessage(fieldError: unknown): string | undefined {
  if (!fieldError || typeof fieldError !== 'object') {
    return undefined;
  }

  const message = (fieldError as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

export function getArrayFieldItemErrorMessage(fieldError: unknown, index: number): string | undefined {
  if (!fieldError || typeof fieldError !== 'object') {
    return undefined;
  }

  const itemError = (fieldError as Record<number, unknown>)[index];
  if (!itemError || typeof itemError !== 'object') {
    return undefined;
  }

  const message = (itemError as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

export async function readStoredUserScriptCode(storageKey: string): Promise<string | undefined> {
  const stored = await new Promise<Record<string, StoredUserScriptCodePayload>>((resolve, reject) => {
    try {
      chrome.storage.local.get(storageKey, (items) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          reject(lastErr);
          return;
        }
        resolve(items as Record<string, StoredUserScriptCodePayload>);
      });
    } catch (error) {
      reject(error);
    }
  });

  return extractStoredUserScriptCode(stored[storageKey]);
}

export function buildRegisterPayload(
  values: UserScriptFormValues,
  code: string
): UserScriptRegisterPayload {
  return {
    id: values.id.trim(),
    matches: normalizePatternList(values.matches) ?? [],
    js: [{ code }],
    excludeMatches: normalizePatternList(values.excludeMatches),
    allFrames: values.allFrames,
    runAt: values.runAt,
    world: values.world,
    worldId: values.worldId?.trim() || undefined,
  };
}

export function buildUpdatePayload(
  values: UserScriptFormValues,
  code: string
): UserScriptUpdatePayload {
  return {
    id: values.id.trim(),
    updates: {
      matches: normalizePatternList(values.matches) ?? [],
      js: [{ code }],
      excludeMatches: normalizePatternList(values.excludeMatches),
      allFrames: values.allFrames,
      runAt: values.runAt,
      world: values.world,
      worldId: values.worldId?.trim() || undefined,
    },
  };
}
