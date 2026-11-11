import { useCallback, useEffect, useState } from 'react';

import { ApiError, createLinkCode } from '../lib/api.js';
import { deadlineFor, isExpired, secondsLeft } from '../lib/linkCode.js';

export type LinkCodeState =
  | { status: 'loading' }
  | { status: 'ready'; code: string; linkToken: string; expired: boolean; secondsLeft: number }
  | { status: 'error'; sessionEnded: boolean };

interface Issued {
  code: string;
  linkToken: string;
  deadline: number;
}

/** Issues connect credentials (long deep-link token + short typed code) for this session; `refresh` replaces it (also used after expiry). */
export function useLinkCode(): { state: LinkCodeState; refresh: () => void } {
  const [issued, setIssued] = useState<Issued>();
  const [failure, setFailure] = useState<{ sessionEnded: boolean }>();
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    createLinkCode().then(
      (res) => {
        if (cancelled) return;
        const received = Date.now();
        setFailure(undefined);
        setIssued({
          code: res.code,
          // an older server has no long token; the short code then rides the deep link as before
          linkToken: res.linkToken ?? res.code,
          deadline: deadlineFor(received),
        });
        setNow(received);
      },
      (e: unknown) => {
        if (!cancelled) setFailure({ sessionEnded: e instanceof ApiError && e.status === 401 });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Tick only while a live code is showing; cleared on expiry and unmount.
  const live = issued !== undefined && !isExpired(issued.deadline, now);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const refresh = useCallback(() => {
    setIssued(undefined);
    setFailure(undefined);
    setAttempt((n) => n + 1);
  }, []);

  const state: LinkCodeState = issued
    ? {
        status: 'ready',
        code: issued.code,
        linkToken: issued.linkToken,
        expired: isExpired(issued.deadline, now),
        secondsLeft: secondsLeft(issued.deadline, now),
      }
    : failure
      ? { status: 'error', sessionEnded: failure.sessionEnded }
      : { status: 'loading' };
  return { state, refresh };
}
