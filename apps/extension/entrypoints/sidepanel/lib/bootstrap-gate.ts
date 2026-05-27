import { useEffect, useMemo, useRef, useState } from 'react';
import { createAgentV2Client } from './agent-v2/client';
import {
  type BootstrapModelAccessResult,
  loadBootstrapModelAccess,
} from './model-access-bootstrap';
import { config } from './config';

const ACCR_SYNC_URL = 'http://127.0.0.1:8792/api/accr-sync/run';
const FALLBACK_MODEL_CONFIG = {
  modelProvider: 'openai' as const,
  openaiModelName: 'gpt-4o-mini',
  openaiApiKey: undefined,
  openaiBaseUrl: undefined,
  anthropicModelName: undefined,
  anthropicApiKey: undefined,
  anthropicBaseUrl: undefined,
  providerVariant: 'standard' as const,
};

export type BootstrapSyncResult = {
  ok: boolean;
  status: string;
  mode?: string;
  error?: string;
};

export type BootstrapGateResult =
  | {
      status: 'ready';
      sync: BootstrapSyncResult;
      modelAccess: BootstrapModelAccessResult;
    }
  | {
      status: 'sync_failed';
      sync: BootstrapSyncResult;
      modelAccess: BootstrapModelAccessResult;
    }
  | {
      status: 'blocked';
      blockedReason: 'model_config';
      sync: BootstrapSyncResult;
      modelAccess: BootstrapModelAccessResult;
    };

export type BootstrapGateViewState =
  | {
      status: 'running';
      title: string;
      description: string;
      retry: () => Promise<BootstrapGateResult | void>;
    }
  | {
      status: 'ready';
      retry: () => Promise<BootstrapGateResult | void>;
    }
  | {
      status: 'sync_failed';
      title: string;
      description: string;
      detail?: string;
      retry: () => Promise<BootstrapGateResult | void>;
    }
  | {
      status: 'blocked';
      title: string;
      description: string;
      detail?: string;
      retry: () => Promise<BootstrapGateResult | void>;
    };

function toViewState(
  result: BootstrapGateResult | null,
  retry: () => Promise<BootstrapGateResult | void>
): BootstrapGateViewState {
  if (!result) {
    return {
      status: 'running',
      title: '正在检查使用环境',
      description: '正在同步技能并检查模型配置，请稍候。',
      retry,
    };
  }

  if (result.status === 'ready') {
    return {
      status: 'ready',
      retry,
    };
  }

  if (result.status === 'sync_failed') {
    return {
      status: 'sync_failed',
      title: '技能同步失败',
      description: '无法完成远端技能同步，请重新检查。',
      detail: result.sync.error ?? '远端同步失败',
      retry,
    };
  }

  return {
    status: 'blocked',
    title: '模型不可用',
    description: '技能已同步，但当前模型不可用，需要配置官方 Key。',
    detail:
      result.modelAccess.viewState.summary === '当前模型暂不可用。'
        ? undefined
        : result.modelAccess.viewState.summary,
    retry,
  };
}

export async function runBootstrapGate(input: {
  syncRemote: () => Promise<BootstrapSyncResult>;
  loadModelAccess: () => Promise<BootstrapModelAccessResult>;
}): Promise<BootstrapGateResult> {
  const [sync, modelAccess] = await Promise.all([input.syncRemote(), input.loadModelAccess()]);

  if (!sync.ok) {
    return {
      status: 'sync_failed',
      sync,
      modelAccess,
    };
  }

  if (
    modelAccess.viewState.overallStatus === 'needs_config' ||
    modelAccess.viewState.overallStatus === 'unavailable'
  ) {
    return {
      status: 'blocked',
      blockedReason: 'model_config',
      sync,
      modelAccess,
    };
  }

  return {
    status: 'ready',
    sync,
    modelAccess,
  };
}

export async function syncRemoteAccr(): Promise<BootstrapSyncResult> {
  try {
    const response = await fetch(ACCR_SYNC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'remote',
        trigger: 'extension-action-click',
      }),
    });

    const payload = (await response.json().catch(() => null)) as BootstrapSyncResult | null;

    if (response.ok && payload?.ok && payload.status === 'completed') {
      return payload;
    }

    return {
      ok: false,
      status: payload?.status ?? 'failed',
      mode: payload?.mode,
      error: payload?.error ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useBootstrapGateState(): BootstrapGateViewState {
  const [result, setResult] = useState<BootstrapGateResult | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const client = useMemo(
    () =>
      createAgentV2Client({
        baseUrl: config.api.agentV2BaseUrl,
        endpoint: config.api.agentV2Endpoint,
      }),
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function retry() {
    const runId = ++runIdRef.current;
    setResult(null);

    const nextResult = await runBootstrapGate({
      syncRemote: syncRemoteAccr,
      loadModelAccess: () =>
        loadBootstrapModelAccess({
          client,
          fallbackLocalConfig: FALLBACK_MODEL_CONFIG,
        }),
    });

    if (!mountedRef.current || runId !== runIdRef.current) {
      return;
    }

    setResult(nextResult);
    return nextResult;
  }

  useEffect(() => {
    void retry();
  }, []);

  return toViewState(result, retry);
}
