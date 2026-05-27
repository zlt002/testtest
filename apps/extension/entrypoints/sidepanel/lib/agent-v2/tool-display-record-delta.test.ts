// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { ToolDisplayRecord } from './types';
import { collectIncrementalToolDisplayRecords } from './tool-display-record-delta';

function tool(overrides: Partial<ToolDisplayRecord> = {}): ToolDisplayRecord {
  return {
    id: 'tool-1',
    toolName: 'write',
    status: 'running',
    preview: 'writing index.html',
    input: {
      file_path: 'docs/index.html',
      content: '<html>draft</html>',
    },
    ...overrides,
  };
}

describe('collectIncrementalToolDisplayRecords', () => {
  it('treats the first hydrated tool list as baseline history', () => {
    const seenSignatures = new Map<string, string>();

    const nextTools = collectIncrementalToolDisplayRecords(
      [tool({ status: 'done' })],
      seenSignatures,
      false
    );

    expect(nextTools).toEqual([]);
    expect(seenSignatures.size).toBe(1);
    expect(seenSignatures.has('tool-1')).toBe(true);
  });

  it('returns newly appended tools after hydration', () => {
    const seenSignatures = new Map<string, string>();
    collectIncrementalToolDisplayRecords([tool({ status: 'done' })], seenSignatures, false);

    const nextTools = collectIncrementalToolDisplayRecords(
      [
        tool({ id: 'tool-1', status: 'done' }),
        tool({
          id: 'tool-2',
          status: 'running',
          input: {
            file_path: 'docs/landing.html',
            content: '<html>next</html>',
          },
        }),
      ],
      seenSignatures,
      true
    );

    expect(nextTools).toHaveLength(1);
    expect(nextTools[0]?.id).toBe('tool-2');
  });

  it('returns existing tools again when their content or status changes after hydration', () => {
    const seenSignatures = new Map<string, string>();
    collectIncrementalToolDisplayRecords([tool()], seenSignatures, false);

    const nextTools = collectIncrementalToolDisplayRecords(
      [
        tool({
          status: 'done',
          preview: 'completed index.html',
          input: {
            file_path: 'docs/index.html',
            content: '<html>final</html>',
          },
        }),
      ],
      seenSignatures,
      true
    );

    expect(nextTools).toHaveLength(1);
    expect(nextTools[0]?.status).toBe('done');
  });
});
