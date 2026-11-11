import { useCallback, useEffect, useState } from 'react';

import { createLinkCode, type LinkCode } from '../lib/api.js';
import { isExpired } from '../lib/linkCode.js';

export type LinkCodeState =
  | { status: 'loading' }
  | { status: 'ready'; code: string; expiresAt: number; expired: boolean }
  | { status: 'error' };

/** Issues a connect code for this session; `refresh` replaces it (also used after expiry). */
export function useLinkCode(token: string): { state: LinkCodeState; refresh: () => void } {
  const [issued, setIssued] = useState<LinkCode>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    createLinkCode(token).then(
      (res) => {
        if (cancelled) return;
        setFailed(false);
        setIssued(res);
        setNow(Date.now());
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  // Tick only while a live code is showing.
  const live = issued !== undefined && !isExpired(issued.expiresAt, now);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const refresh = useCallback(() => {
    setIssued(undefined);
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const state: LinkCodeState = issued
    ? {
        status: 'ready',
        code: issued.code,
        expiresAt: issued.expiresAt,
        expired: isExpired(issued.expiresAt, now),
      }
    : failed
      ? { status: 'error' }
      : { status: 'loading' };
  return { state, refresh };
}
