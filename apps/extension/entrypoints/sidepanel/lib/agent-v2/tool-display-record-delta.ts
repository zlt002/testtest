import type { ToolDisplayRecord } from './types';

function toolDisplayRecordSignature(tool: ToolDisplayRecord) {
  return JSON.stringify([
    tool.status,
    tool.preview,
    tool.partialInputJson ?? null,
    tool.input ?? null,
    tool.result ?? null,
    tool.startedAt ?? null,
    tool.completedAt ?? null,
    tool.isError ?? false,
  ]);
}

export function collectIncrementalToolDisplayRecords(
  tools: ToolDisplayRecord[],
  seenSignatures: Map<string, string>,
  hasHydrated: boolean
): ToolDisplayRecord[] {
  const activeToolIds = new Set<string>();

  if (!hasHydrated) {
    for (const tool of tools) {
      activeToolIds.add(tool.id);
      seenSignatures.set(tool.id, toolDisplayRecordSignature(tool));
    }
    return [];
  }

  const nextTools: ToolDisplayRecord[] = [];
  for (const tool of tools) {
    activeToolIds.add(tool.id);
    const nextSignature = toolDisplayRecordSignature(tool);
    if (seenSignatures.get(tool.id) !== nextSignature) {
      nextTools.push(tool);
    }
    seenSignatures.set(tool.id, nextSignature);
  }

  for (const toolId of [...seenSignatures.keys()]) {
    if (!activeToolIds.has(toolId)) {
      seenSignatures.delete(toolId);
    }
  }

  return nextTools;
}
