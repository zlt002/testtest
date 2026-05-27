// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildRegisterPayload,
  buildUpdatePayload,
  createEmptyUserScriptFormValues,
  mapScriptToFormValues,
  userScriptFormSchema,
} from './userscripts.shared';

describe('userscripts.shared', () => {
  it('createEmptyUserScriptFormValues returns stable defaults', () => {
    expect(createEmptyUserScriptFormValues()).toEqual({
      id: '',
      matches: [''],
      excludeMatches: [],
      runAt: 'document_start',
      allFrames: false,
      world: 'MAIN',
      worldId: '',
    });

    expect(createEmptyUserScriptFormValues('userscript-001')).toEqual({
      id: 'userscript-001',
      matches: [''],
      excludeMatches: [],
      runAt: 'document_start',
      allFrames: false,
      world: 'MAIN',
      worldId: '',
    });
  });

  it('mapScriptToFormValues normalizes missing optional fields', () => {
    const result = mapScriptToFormValues({
      id: 'userscript-demo',
      matches: ['https://example.com/*'],
    });

    expect(result).toEqual({
      id: 'userscript-demo',
      matches: ['https://example.com/*'],
      excludeMatches: [],
      runAt: 'document_start',
      allFrames: false,
      world: 'MAIN',
      worldId: '',
    });
  });

  it('mapScriptToFormValues preserves configured optional fields', () => {
    const result = mapScriptToFormValues({
      id: 'userscript-demo',
      matches: ['https://example.com/*'],
      excludeMatches: ['https://example.com/admin/*'],
      runAt: 'document_end',
      allFrames: true,
      world: 'USER_SCRIPT',
      worldId: 'workspace-a',
    });

    expect(result).toEqual({
      id: 'userscript-demo',
      matches: ['https://example.com/*'],
      excludeMatches: ['https://example.com/admin/*'],
      runAt: 'document_end',
      allFrames: true,
      world: 'USER_SCRIPT',
      worldId: 'workspace-a',
    });
  });

  it('buildRegisterPayload trims fields and omits empty optional values', () => {
    const payload = buildRegisterPayload(
      {
        id: '  userscript-demo  ',
        matches: [' https://example.com/* ', '   '],
        excludeMatches: [' https://example.com/admin/* ', ''],
        runAt: 'document_idle',
        allFrames: true,
        world: 'USER_SCRIPT',
        worldId: '  workspace-a  ',
      },
      'console.log("demo")'
    );

    expect(payload).toEqual({
      id: 'userscript-demo',
      matches: ['https://example.com/*'],
      excludeMatches: ['https://example.com/admin/*'],
      js: [{ code: 'console.log("demo")' }],
      runAt: 'document_idle',
      allFrames: true,
      world: 'USER_SCRIPT',
      worldId: 'workspace-a',
    });
  });

  it('buildUpdatePayload keeps id outside updates and omits empty optionals', () => {
    const payload = buildUpdatePayload(
      {
        id: '  userscript-demo  ',
        matches: [' https://example.com/* ', ''],
        excludeMatches: ['   '],
        runAt: 'document_end',
        allFrames: false,
        world: 'MAIN',
        worldId: '   ',
      },
      'console.log("updated")'
    );

    expect(payload).toEqual({
      id: 'userscript-demo',
      updates: {
        matches: ['https://example.com/*'],
        js: [{ code: 'console.log("updated")' }],
        runAt: 'document_end',
        allFrames: false,
        world: 'MAIN',
        worldId: undefined,
        excludeMatches: undefined,
      },
    });
  });

  it('schema accepts valid normalized values', () => {
    const parsed = userScriptFormSchema.parse({
      ...createEmptyUserScriptFormValues('userscript-schema-check'),
      matches: ['https://example.com/*'],
    });

    expect(parsed.id).toBe('userscript-schema-check');
    expect(parsed.matches).toEqual(['https://example.com/*']);
  });

  it('schema rejects whitespace-only id after trim', () => {
    const result = userScriptFormSchema.safeParse({
      ...createEmptyUserScriptFormValues(),
      id: '   ',
      matches: ['https://example.com/*'],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected parse failure');
    }
    expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('schema rejects whitespace-only match entries after trim', () => {
    const result = userScriptFormSchema.safeParse({
      ...createEmptyUserScriptFormValues('userscript-schema-check'),
      matches: ['   '],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected parse failure');
    }
    expect(result.error.issues[0]?.path).toEqual(['matches', 0]);
  });
});
