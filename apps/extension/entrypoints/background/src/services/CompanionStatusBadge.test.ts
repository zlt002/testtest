// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createCompanionBadgeState,
  getCompanionReachability,
  shouldContinueCompanionWarmup,
} from './CompanionStatusBadge';

describe('createCompanionBadgeState', () => {
  it('shows pending while companion status is refreshing', () => {
    expect(createCompanionBadgeState({ state: 'checking' })).toEqual({
      text: '...',
      color: '#6b7280',
      title: 'accr-ui: 正在连接本地服务',
    });
  });

  it('shows OK when both MCP and Agent are reachable', () => {
    expect(createCompanionBadgeState({ state: 'ready', mcpReachable: true, agentReachable: true }))
      .toEqual({
        text: 'OK',
        color: '#16a34a',
        title: 'accr-ui: 本地智能体和 MCP 服务已连接',
      });
  });

  it('shows MCP when only the browser MCP bridge is reachable', () => {
    expect(createCompanionBadgeState({ state: 'ready', mcpReachable: true, agentReachable: false }))
      .toEqual({
        text: 'MCP',
        color: '#ca8a04',
        title: 'accr-ui: MCP 服务已连接，本地智能体不可用',
      });
  });

  it('shows OFF when the browser MCP bridge is unreachable', () => {
    expect(createCompanionBadgeState({ state: 'ready', mcpReachable: false, agentReachable: true }))
      .toEqual({
        text: 'OFF',
        color: '#dc2626',
        title: 'accr-ui: MCP 服务不可用',
      });
  });
});

describe('shouldContinueCompanionWarmup', () => {
  it('keeps refreshing during startup while services are not fully ready', () => {
    expect(shouldContinueCompanionWarmup({ text: 'OFF', color: '#dc2626', title: '' }, 1, 5)).toBe(
      true
    );
    expect(shouldContinueCompanionWarmup({ text: 'MCP', color: '#ca8a04', title: '' }, 1, 5)).toBe(
      true
    );
  });

  it('stops refreshing when services are fully ready or attempts are exhausted', () => {
    expect(shouldContinueCompanionWarmup({ text: 'OK', color: '#16a34a', title: '' }, 1, 5)).toBe(
      false
    );
    expect(shouldContinueCompanionWarmup({ text: 'OFF', color: '#dc2626', title: '' }, 5, 5)).toBe(
      false
    );
  });
});

describe('getCompanionReachability', () => {
  it('treats a successful discovery response with mcpUrl as MCP reachable', () => {
    expect(
      getCompanionReachability({
        agentBaseUrl: 'http://127.0.0.1:8792',
        agentApiBaseUrl: 'http://127.0.0.1:8792/api/agent-v2',
        mcpUrl: 'http://127.0.0.1:12306/mcp',
        capabilities: {
          agent: 'local_claude_sdk',
        },
      })
    ).toEqual({
      mcpReachable: true,
      agentReachable: true,
    });
  });
});
