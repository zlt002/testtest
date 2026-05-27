// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createWebEditIframeCandidateRegistry,
  rankWebEditIframeCandidate,
  transitionWebEditIframeCandidate,
} from './webedit-iframe-candidates';

describe('webedit iframe candidates', () => {
  it('gives office-iframe higher priority than a generic webedit iframe', () => {
    expect(
      rankWebEditIframeCandidate({
        id: 'office-iframe',
        srcOrigin: 'https://doc.midea.com',
      })
    ).toBeGreaterThan(
      rankWebEditIframeCandidate({
        id: '',
        srcOrigin: 'https://webedit.midea.com',
      })
    );
  });

  it('puts a failed candidate into cooldown before it can be retried', () => {
    const registry = createWebEditIframeCandidateRegistry(() => 1_000);

    registry.upsert({
      key: 'office-iframe',
      state: 'ready_confirmed',
      priority: 100,
      failureCount: 0,
    });

    const cooledDown = transitionWebEditIframeCandidate(registry.get('office-iframe')!, {
      type: 'fail',
      reason: 'origin_mismatch',
      now: 1_000,
      cooldownMs: 5_000,
    });

    expect(cooledDown.state).toBe('cooldown');
    expect(cooledDown.retryAt).toBe(6_000);
    expect(cooledDown.failureCount).toBe(1);
  });

  it('keeps a cooldown candidate out of primary selection until retryAt', () => {
    const registry = createWebEditIframeCandidateRegistry(() => 1_000);

    registry.upsert({
      key: 'office-iframe',
      state: 'cooldown',
      priority: 100,
      failureCount: 1,
      retryAt: 6_000,
    });
    registry.upsert({
      key: 'webedit-src',
      state: 'eligible',
      priority: 80,
      failureCount: 0,
    });

    expect(registry.selectPrimary()?.key).toBe('webedit-src');
  });
});
