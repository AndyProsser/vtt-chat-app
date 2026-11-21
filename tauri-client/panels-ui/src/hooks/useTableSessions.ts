import { nextSession, type RsvpChoice } from '@vtt-chat-app/shared';
import { useCallback, useEffect, useState } from 'react';

import { tableRsvp, tableSessions } from '../lib/tauriBridge.js';
import type { SessionView } from '../types/index.js';

export interface NextSession {
  id: string;
  title: string;
  startsAt: number;
  mine: RsvpChoice | null;
}

/**
 * The next session of each of the person's tables, for the campaign switcher. Read while the switcher is open (one
 * request per table, through `table_api`, which is not tied to the table the app is in) and answerable from there.
 * A table whose sessions cannot be read just shows none: the switcher must work without them.
 */
export function useTableSessions(campaignIds: readonly string[], enabled: boolean) {
  const [next, setNext] = useState<Record<string, NextSession | undefined>>({});
  const key = campaignIds.join(',');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Promise.allSettled(campaignIds.map((id) => tableSessions(id))).then((results) => {
      if (!alive) return;
      const out: Record<string, NextSession | undefined> = {};
      results.forEach((r, i) => {
        const id = campaignIds[i] as string;
        const s: SessionView | undefined =
          r.status === 'fulfilled' ? nextSession(r.value.sessions, Date.now()) : undefined;
        out[id] = s
          ? { id: s.session.id, title: s.session.title, startsAt: s.session.startsAt, mine: s.mine }
          : undefined;
      });
      setNext(out);
    });
    return () => {
      alive = false;
    };
  }, [enabled, key]);

  /** Answers for one table; the row updates at once and goes back if the server refuses. */
  const rsvp = useCallback(async (campaignId: string, sessionId: string, status: RsvpChoice) => {
    let before: RsvpChoice | null = null;
    setNext((cur) => {
      const s = cur[campaignId];
      if (!s) return cur;
      before = s.mine;
      return { ...cur, [campaignId]: { ...s, mine: status } };
    });
    try {
      await tableRsvp(campaignId, sessionId, status);
    } catch (e) {
      setNext((cur) => {
        const s = cur[campaignId];
        return s ? { ...cur, [campaignId]: { ...s, mine: before } } : cur;
      });
      throw e;
    }
  }, []);

  return { next, rsvp };
}
