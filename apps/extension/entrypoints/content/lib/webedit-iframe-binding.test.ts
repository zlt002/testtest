// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  matchWebEditIframeReadyEvent,
  shouldDelayWebEditIframeHandshake,
} from './webedit-iframe-binding';

describe('webedit iframe binding', () => {
  it('matches ready events by source window and origin together', () => {
    const sourceWindow = {};

    expect(
      matchWebEditIframeReadyEvent(
        {
          source: sourceWindow,
          origin: 'https://webedit.midea.com',
          data: {
            channel: 'mcp-iframe',
            type: 'mcp',
            direction: 'server-to-client',
            payload: 'mcp-server-ready',
          },
        },
        {
          sourceWindow,
          origin: 'https://webedit.midea.com',
        }
      )
    ).toEqual({
      matched: true,
      matchedBy: 'source+origin',
    });
  });

  it('does not treat source-only or origin-only as a ready match', () => {
    const sourceWindow = {};

    expect(
      matchWebEditIframeReadyEvent(
        {
          source: sourceWindow,
          origin: 'https://doc.midea.com',
          data: {
            channel: 'mcp-iframe',
            type: 'mcp',
            direction: 'server-to-client',
            payload: 'mcp-server-ready',
          },
        },
        {
          sourceWindow,
          origin: 'https://webedit.midea.com',
        }
      )
    ).toEqual({
      matched: false,
      matchedBy: 'source-only',
    });
  });

  it('delays handshake when the src origin and runtime origin do not match', () => {
    expect(
      shouldDelayWebEditIframeHandshake({
        srcOrigin: 'https://webedit.midea.com',
        runtimeOrigin: 'https://doc.midea.com',
      })
    ).toBe(true);
  });
});
