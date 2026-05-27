import { useCallback, useEffect, useState } from 'react';
import type { SystemUpdateInfo } from './types';

const SYSTEM_UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000;

type SystemUpdateClient = {
  getSystemUpdateInfo(): Promise<SystemUpdateInfo>;
};

let inflight: Promise<SystemUpdateInfo | null> | null = null;

async function runSystemUpdateCheck(
  client: SystemUpdateClient
): Promise<SystemUpdateInfo | null> {
  if (inflight) {
    return inflight;
  }
  inflight = client
    .getSystemUpdateInfo()
    .catch(() => ({ updateAvailable: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useSystemUpdateCheck(client: SystemUpdateClient) {
  const [info, setInfo] = useState<SystemUpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await runSystemUpdateCheck(client);
    setInfo(next);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const next = await runSystemUpdateCheck(client);
      if (!cancelled) {
        setInfo(next);
        setLoading(false);
      }
    };

    void load();
    const intervalId = window.setInterval(() => void load(), SYSTEM_UPDATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [client]);

  return {
    info,
    loading,
    error: null,
    updateAvailable: Boolean(info?.updateAvailable),
    refresh,
  };
}
