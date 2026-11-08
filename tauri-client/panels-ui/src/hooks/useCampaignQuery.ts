import { useCallback, useEffect, useState } from 'react';

import { accountErrorMessage, campaignApi, onSyncEvent } from '../lib/tauriBridge.js';

export interface Query<T> {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
}

/**
 * GETs `path` (relative to the campaign) and reloads whenever a live event whose name starts with one
 * of `refreshOn` arrives — the server pushes the *fact* that something changed and the REST read
 * returns what this viewer may see, so visibility rules live in one place (the server).
 */
export function useCampaignQuery<T>(path: string, refreshOn: string[]): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const key = refreshOn.join('|');

  useEffect(() => {
    let cancelled = false;
    campaignApi<T>('GET', path)
      .then((d) => !cancelled && (setData(d), setError(undefined)))
      .catch((e) => !cancelled && setError(accountErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    const prefixes = key.split('|').filter(Boolean);
    const unlisten = onSyncEvent((e) => {
      if (prefixes.some((p) => e.t.startsWith(p))) reload();
    });
    return () => void unlisten.then((fn) => fn());
  }, [key, reload]);

  return { data, error, reload };
}
