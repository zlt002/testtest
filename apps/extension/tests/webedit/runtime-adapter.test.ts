// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createWebEditTestWindow, loadWebEditScript } from './load-webedit-script';

describe('webedit runtime adapter test harness', () => {
  it('loads runtime-adapter.js into an isolated window and exposes globals', async () => {
    const win = createWebEditTestWindow();

    await loadWebEditScript(win, 'apps/extension/public/webedit/runtime-adapter.js');

    expect(typeof win.__webeditRuntimeAdapter).toBe('object');
    expect(typeof win.__webeditRuntimeAdapter.readRangeMatrix).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.detectRuntimeMode).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.getDocumentApplication).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.readDocumentText).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.getDocumentSelection).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.inspectDocumentRuntime).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.listDocumentCapabilities).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.getFlowEditorWindow).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.inspectFlowRuntime).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.listFlowCapabilities).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.readFlowDefinition).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.beautifyFlow).toBe('function');
    expect(typeof win.__webeditRuntimeAdapter.addFlowElements).toBe('function');
  });
});
