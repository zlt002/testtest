import type { NetworkEvidenceItem } from '@mcp-b/dom-analysis-contracts';

const CDP_PROTOCOL_VERSION = '1.3';
const MAX_NETWORK_EVIDENCE_PER_TAB = 200;

type DebuggerApi = Pick<
  typeof chrome.debugger,
  'attach' | 'detach' | 'sendCommand' | 'onEvent' | 'onDetach'
>;

type CreateDomAnalysisCdpServiceOptions = {
  debuggerApi?: DebuggerApi;
  now?: () => number;
};

type NetworkEvidenceWindow = {
  startTime: number;
  endTime: number;
};

type TabCaptureState = {
  evidenceByRequestId: Map<string, NetworkEvidenceItem>;
  requestTimestampById: Map<string, number>;
  requestOrder: string[];
};

function hasUsableDebuggerApi(debuggerApi: DebuggerApi | undefined): debuggerApi is DebuggerApi {
  return Boolean(
    debuggerApi &&
      typeof debuggerApi.attach === 'function' &&
      typeof debuggerApi.detach === 'function' &&
      typeof debuggerApi.sendCommand === 'function' &&
      debuggerApi.onEvent &&
      typeof debuggerApi.onEvent.addListener === 'function' &&
      typeof debuggerApi.onEvent.removeListener === 'function' &&
      debuggerApi.onDetach &&
      typeof debuggerApi.onDetach.addListener === 'function' &&
      typeof debuggerApi.onDetach.removeListener === 'function'
  );
}

export type DomAnalysisCdpService = ReturnType<typeof createDomAnalysisCdpService>;

function toMilliseconds(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 1000);
}

function getInitiatorHint(initiator: unknown): string | null {
  if (!initiator || typeof initiator !== 'object') {
    return null;
  }

  const candidate = initiator as {
    type?: unknown;
    url?: unknown;
  };
  if (typeof candidate.type === 'string' && candidate.type.trim()) {
    return candidate.type;
  }
  if (typeof candidate.url === 'string' && candidate.url.trim()) {
    return candidate.url;
  }
  return null;
}

function normalizeRequestStartTime(
  params: { wallTime?: number; timestamp?: number },
  now: () => number
): number {
  return toMilliseconds(params.wallTime) ?? toMilliseconds(params.timestamp) ?? now();
}

function upsertRequestOrder(order: string[], requestId: string) {
  if (!order.includes(requestId)) {
    order.push(requestId);
  }
}

function trimTabEvidence(state: TabCaptureState) {
  while (state.requestOrder.length > MAX_NETWORK_EVIDENCE_PER_TAB) {
    const oldestRequestId = state.requestOrder.shift();
    if (!oldestRequestId) {
      break;
    }
    state.evidenceByRequestId.delete(oldestRequestId);
    state.requestTimestampById.delete(oldestRequestId);
  }
}

export function createDomAnalysisCdpService(
  options: CreateDomAnalysisCdpServiceOptions = {}
) {
  const debuggerApi = options.debuggerApi ?? chrome.debugger;
  const now = options.now ?? (() => Date.now());
  const activeTabs = new Set<number>();
  const tabStates = new Map<number, TabCaptureState>();
  let listenersRegistered = false;

  const assertDebuggerApiAvailable = (): DebuggerApi => {
    if (hasUsableDebuggerApi(debuggerApi)) {
      return debuggerApi;
    }

    throw new Error('当前扩展未启用 chrome.debugger 权限，无法采集 DOM 网络证据');
  };

  const ensureTabState = (tabId: number): TabCaptureState => {
    const existingState = tabStates.get(tabId);
    if (existingState) {
      return existingState;
    }

    const state: TabCaptureState = {
      evidenceByRequestId: new Map(),
      requestTimestampById: new Map(),
      requestOrder: [],
    };
    tabStates.set(tabId, state);
    return state;
  };

  const handleRequestWillBeSent = (tabId: number, params: Record<string, unknown>) => {
    const requestId = typeof params.requestId === 'string' ? params.requestId : null;
    const request =
      params.request && typeof params.request === 'object'
        ? (params.request as { url?: unknown; method?: unknown })
        : null;
    if (!requestId || !request) {
      return;
    }

    const url = typeof request.url === 'string' ? request.url : null;
    const method = typeof request.method === 'string' ? request.method : null;
    if (!url || !method) {
      return;
    }

    const state = ensureTabState(tabId);
    const currentEvidence = state.evidenceByRequestId.get(requestId);
    const evidence: NetworkEvidenceItem = {
      requestId,
      url,
      method,
      status: currentEvidence?.status ?? null,
      resourceType: typeof params.type === 'string' ? params.type : null,
      startedAt: normalizeRequestStartTime(
        {
          wallTime: typeof params.wallTime === 'number' ? params.wallTime : undefined,
          timestamp: typeof params.timestamp === 'number' ? params.timestamp : undefined,
        },
        now
      ),
      finishedAt: currentEvidence?.finishedAt ?? null,
      initiatorHint: getInitiatorHint(params.initiator),
      responsePreview: null,
    };

    state.evidenceByRequestId.set(requestId, evidence);
    if (typeof params.timestamp === 'number') {
      state.requestTimestampById.set(requestId, params.timestamp);
    }
    upsertRequestOrder(state.requestOrder, requestId);
    trimTabEvidence(state);
  };

  const handleResponseReceived = (tabId: number, params: Record<string, unknown>) => {
    const requestId = typeof params.requestId === 'string' ? params.requestId : null;
    if (!requestId) {
      return;
    }

    const state = ensureTabState(tabId);
    const currentEvidence = state.evidenceByRequestId.get(requestId);
    if (!currentEvidence) {
      return;
    }

    const response =
      params.response && typeof params.response === 'object'
        ? (params.response as { status?: unknown })
        : null;
    currentEvidence.status = typeof response?.status === 'number' ? response.status : null;
    if (typeof params.type === 'string') {
      currentEvidence.resourceType = params.type;
    }
  };

  const handleLoadingFinished = (tabId: number, params: Record<string, unknown>) => {
    const requestId = typeof params.requestId === 'string' ? params.requestId : null;
    if (!requestId) {
      return;
    }

    const state = ensureTabState(tabId);
    const currentEvidence = state.evidenceByRequestId.get(requestId);
    if (!currentEvidence) {
      return;
    }

    const finishedTimestamp =
      typeof params.timestamp === 'number' ? params.timestamp : undefined;
    const startedTimestamp = state.requestTimestampById.get(requestId);
    if (typeof finishedTimestamp === 'number' && typeof startedTimestamp === 'number') {
      currentEvidence.finishedAt =
        currentEvidence.startedAt + Math.max(0, Math.round((finishedTimestamp - startedTimestamp) * 1000));
      return;
    }

    currentEvidence.finishedAt =
      toMilliseconds(finishedTimestamp) ?? Math.max(currentEvidence.startedAt, now());
  };

  const handleDebuggerEvent: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = (
    source,
    method,
    params
  ) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number' || !activeTabs.has(tabId) || !params) {
      return;
    }

    const payload = params as Record<string, unknown>;
    if (method === 'Network.requestWillBeSent') {
      handleRequestWillBeSent(tabId, payload);
      return;
    }

    if (method === 'Network.responseReceived') {
      handleResponseReceived(tabId, payload);
      return;
    }

    if (method === 'Network.loadingFinished') {
      handleLoadingFinished(tabId, payload);
    }
  };

  const handleDebuggerDetach: Parameters<typeof chrome.debugger.onDetach.addListener>[0] = (
    source
  ) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') {
      return;
    }

    activeTabs.delete(tabId);
    tabStates.delete(tabId);
    cleanupListenersIfIdle();
  };

  const ensureListeners = () => {
    if (listenersRegistered) {
      return;
    }

    const availableDebuggerApi = assertDebuggerApiAvailable();
    availableDebuggerApi.onEvent.addListener(handleDebuggerEvent);
    availableDebuggerApi.onDetach.addListener(handleDebuggerDetach);
    listenersRegistered = true;
  };

  const cleanupListenersIfIdle = () => {
    if (!listenersRegistered || activeTabs.size > 0) {
      return;
    }

    if (!hasUsableDebuggerApi(debuggerApi)) {
      listenersRegistered = false;
      return;
    }

    debuggerApi.onEvent.removeListener(handleDebuggerEvent);
    debuggerApi.onDetach.removeListener(handleDebuggerDetach);
    listenersRegistered = false;
  };

  return {
    async startCaptureForTab(tabId: number): Promise<void> {
      if (activeTabs.has(tabId)) {
        return;
      }

      const availableDebuggerApi = assertDebuggerApiAvailable();
      ensureListeners();
      ensureTabState(tabId);
      let attached = false;

      try {
        await availableDebuggerApi.attach({ tabId }, CDP_PROTOCOL_VERSION);
        attached = true;
        await availableDebuggerApi.sendCommand({ tabId }, 'Network.enable');
        activeTabs.add(tabId);
      } catch (error) {
        tabStates.delete(tabId);
        activeTabs.delete(tabId);

        if (attached) {
          await availableDebuggerApi.detach({ tabId }).catch(() => undefined);
        }

        cleanupListenersIfIdle();
        throw error;
      }
    },

    async stopCaptureForTab(tabId: number): Promise<void> {
      if (!activeTabs.has(tabId)) {
        tabStates.delete(tabId);
        cleanupListenersIfIdle();
        return;
      }

      const availableDebuggerApi = assertDebuggerApiAvailable();
      activeTabs.delete(tabId);
      await availableDebuggerApi.detach({ tabId });
      cleanupListenersIfIdle();
    },

    getNetworkEvidenceForTab(tabId: number, window: NetworkEvidenceWindow): NetworkEvidenceItem[] {
      const state = tabStates.get(tabId);
      if (!state) {
        return [];
      }

      return state.requestOrder
        .map((requestId) => state.evidenceByRequestId.get(requestId))
        .filter((item): item is NetworkEvidenceItem => Boolean(item))
        .filter((item) => {
          const endedAt = item.finishedAt ?? item.startedAt;
          return item.startedAt <= window.endTime && endedAt >= window.startTime;
        });
    },

    clearTab(tabId: number): void {
      tabStates.delete(tabId);
    },
  };
}

export const domAnalysisCdpService = createDomAnalysisCdpService();
