import { BACKGROUND_MESSAGE_TYPES, NATIVE_HOST } from '@mcp-b/transports';
import { ensureCompanionReady, type CompanionDiscovery } from './NativeHostManager';

type CompanionBadgeInput =
  | { state: 'checking' }
  | {
      state: 'ready';
      mcpReachable: boolean;
      agentReachable: boolean;
    };

export interface CompanionBadgeState {
  text: string;
  color: string;
  title: string;
}

const BADGE_REFRESH_INTERVAL_MS = 30_000;
const BADGE_WARMUP_INTERVAL_MS = 2_000;
const BADGE_WARMUP_MAX_ATTEMPTS = 45;

export function createCompanionBadgeState(input: CompanionBadgeInput): CompanionBadgeState {
  if (input.state === 'checking') {
    return {
      text: '...',
      color: '#6b7280',
      title: 'accr-ui: 正在连接本地服务',
    };
  }

  if (!input.mcpReachable) {
    return {
      text: 'OFF',
      color: '#dc2626',
      title: 'accr-ui: MCP 服务不可用',
    };
  }

  if (!input.agentReachable) {
    return {
      text: 'MCP',
      color: '#ca8a04',
      title: 'accr-ui: MCP 服务已连接，本地智能体不可用',
    };
  }

  return {
    text: 'OK',
    color: '#16a34a',
    title: 'accr-ui: 本地智能体和 MCP 服务已连接',
  };
}

export function shouldContinueCompanionWarmup(
  state: CompanionBadgeState,
  attempt: number,
  maxAttempts: number
): boolean {
  return state.text !== 'OK' && attempt < maxAttempts;
}

async function applyCompanionBadgeState(state: CompanionBadgeState): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: state.text });
    await chrome.action.setBadgeBackgroundColor({ color: state.color });
    await chrome.action.setTitle({ title: state.title });
  } catch (error) {
    console.warn('[companion-status] Failed to update action badge:', error);
  }
}

export function getCompanionReachability(discovery: CompanionDiscovery): {
  mcpReachable: boolean;
  agentReachable: boolean;
} {
  return {
    mcpReachable:
      typeof discovery.mcpUrl === 'string' && discovery.mcpUrl.length > 0
        ? true
        : discovery.nativeHost?.connected === true ||
          discovery.nativeHost?.server.isRunning === true,
    agentReachable: discovery.capabilities !== null,
  };
}

export async function refreshCompanionStatusBadge(): Promise<CompanionBadgeState> {
  const checking = createCompanionBadgeState({ state: 'checking' });
  await applyCompanionBadgeState(checking);

  try {
    const discovery = await ensureCompanionReady(NATIVE_HOST.DEFAULT_PORT);
    const reachability = getCompanionReachability(discovery);
    const state = createCompanionBadgeState({ state: 'ready', ...reachability });
    await applyCompanionBadgeState(state);
    return state;
  } catch (error) {
    console.warn('[companion-status] Companion status refresh failed:', error);
    const state = createCompanionBadgeState({
      state: 'ready',
      mcpReachable: false,
      agentReachable: false,
    });
    await applyCompanionBadgeState(state);
    return state;
  }
}

function scheduleCompanionWarmupRefresh(attempt = 0): void {
  setTimeout(() => {
    void refreshCompanionStatusBadge().then((state) => {
      if (shouldContinueCompanionWarmup(state, attempt + 1, BADGE_WARMUP_MAX_ATTEMPTS)) {
        scheduleCompanionWarmupRefresh(attempt + 1);
      }
    });
  }, attempt === 0 ? 0 : BADGE_WARMUP_INTERVAL_MS);
}

export function initCompanionStatusBadge(): void {
  scheduleCompanionWarmupRefresh();

  chrome.runtime.onInstalled?.addListener(() => {
    scheduleCompanionWarmupRefresh();
  });
  chrome.runtime.onStartup?.addListener(() => {
    scheduleCompanionWarmupRefresh();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED) {
      void refreshCompanionStatusBadge();
    }
    return false;
  });

  setInterval(() => {
    void refreshCompanionStatusBadge();
  }, BADGE_REFRESH_INTERVAL_MS);
}
