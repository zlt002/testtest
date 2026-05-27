// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { SessionTabSummary } from './session-tab-selection';
import {
  getSessionTabSelectionScopeKey,
  includeTabInSessionSelection,
  resolveSessionPrimaryTabIdForScope,
  resolveSessionTabSelectionForScope,
  shouldPersistSessionTabSelection,
  shouldRestoreSessionTabSelection,
} from './session-tab-selection-state';

const activeTab: SessionTabSummary = {
  tabId: 11,
  windowId: 1,
  title: 'Active',
  url: 'https://example.com/active',
  active: true,
};

const inactiveTab: SessionTabSummary = {
  tabId: 12,
  windowId: 1,
  title: 'Inactive',
  url: 'https://example.com/inactive',
  active: false,
};

describe('session tab selection state', () => {
  it('does not restore before current-window tabs finish loading', () => {
    expect(
      shouldRestoreSessionTabSelection({
        scopeKey: getSessionTabSelectionScopeKey({
          conversationId: 'draft-1',
        }),
        resolvedScopeKey: null,
        isWindowTabsLoaded: false,
      })
    ).toBe(false);
  });

  it('restores after current-window tabs finish loading for a new scope', () => {
    expect(
      shouldRestoreSessionTabSelection({
        scopeKey: getSessionTabSelectionScopeKey({
          conversationId: 'draft-1',
        }),
        resolvedScopeKey: null,
        isWindowTabsLoaded: true,
      })
    ).toBe(true);
  });

  it('restores stored selection after tabs are available instead of defaulting early', () => {
    expect(
      resolveSessionTabSelectionForScope({
        sessionId: 'session-1',
        windowTabs: [activeTab, inactiveTab],
        storedSelectedTabIds: [12, 99],
        previousScopeKey: null,
        currentSelectedTabIds: [],
      })
    ).toEqual([12]);
  });

  it('defaults to the active tab when no stored selection exists', () => {
    expect(
      resolveSessionTabSelectionForScope({
        sessionId: 'session-1',
        windowTabs: [inactiveTab, activeTab],
        storedSelectedTabIds: null,
        previousScopeKey: null,
        currentSelectedTabIds: [],
      })
    ).toEqual([11]);
  });

  it('restores an explicit empty stored selection without falling back to defaults', () => {
    expect(
      resolveSessionTabSelectionForScope({
        sessionId: 'session-1',
        windowTabs: [activeTab, inactiveTab],
        storedSelectedTabIds: [],
        previousScopeKey: 'draft:draft-1',
        currentSelectedTabIds: [12],
      })
    ).toEqual([]);
  });

  it('carries the draft selection into the resolved session when no stored selection exists yet', () => {
    expect(
      resolveSessionTabSelectionForScope({
        sessionId: 'session-1',
        windowTabs: [activeTab, inactiveTab],
        storedSelectedTabIds: null,
        previousScopeKey: 'draft:draft-1',
        currentSelectedTabIds: [12, 99],
      })
    ).toEqual([12]);
  });

  it('preserves the stored primaryTabId during restore when that tab is still selected', () => {
    expect(
      resolveSessionPrimaryTabIdForScope({
        windowTabs: [inactiveTab, activeTab],
        selectedTabIds: [11, 12],
        storedPrimaryTabId: 12,
      })
    ).toBe(12);
  });

  it('falls back to the current derivation rule when stored primaryTabId is no longer valid', () => {
    expect(
      resolveSessionPrimaryTabIdForScope({
        windowTabs: [inactiveTab, activeTab],
        selectedTabIds: [11],
        storedPrimaryTabId: 12,
      })
    ).toBe(11);
  });

  it('adds the source tab into session selection in current window order', () => {
    expect(
      includeTabInSessionSelection({
        windowTabs: [inactiveTab, activeTab],
        selectedTabIds: [12],
        tabId: 11,
      })
    ).toEqual([12, 11]);
  });

  it('ignores source tabs that are already selected or unavailable', () => {
    expect(
      includeTabInSessionSelection({
        windowTabs: [activeTab, inactiveTab],
        selectedTabIds: [11],
        tabId: 11,
      })
    ).toEqual([11]);

    expect(
      includeTabInSessionSelection({
        windowTabs: [activeTab, inactiveTab],
        selectedTabIds: [11],
        tabId: 99,
      })
    ).toEqual([11]);
  });

  it('does not persist before the current scope finishes restore', () => {
    expect(
      shouldPersistSessionTabSelection({
        sessionId: 'session-1',
        scopeKey: 'session:session-1',
        resolvedScopeKey: null,
      })
    ).toBe(false);
  });

  it('persists only after the current scope finishes restore', () => {
    expect(
      shouldPersistSessionTabSelection({
        sessionId: 'session-1',
        scopeKey: 'session:session-1',
        resolvedScopeKey: 'session:session-1',
      })
    ).toBe(true);
  });
});
