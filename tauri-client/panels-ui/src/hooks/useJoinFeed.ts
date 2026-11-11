import { useEffect } from 'react';

import { useJoinStore } from '../lib/joinStore.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountAddCampaign, onSyncEvent } from '../lib/tauriBridge.js';
import { joinDecision } from '../lib/joinRequests.js';
import { useAccount } from './useAccount.js';

/**
 * Feeds the join store: the DM's list is read once when the window opens, then `join.request` frames
 * keep it current; a `join.decided` frame refreshes the account's campaign list on approval. Only live
 * frames count (never the replayed tail), and there is no timer: an idle window does nothing.
 */
export function useJoinFeed(): void {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const campaignId = status?.campaignId ?? null;
  const dm = campaignId !== null && isDm(members, status?.userId ?? null);

  useEffect(() => {
    let cancelled = false;
    const unlisten = onSyncEvent((event) => {
      if (cancelled) return;
      useJoinStore.getState().apply(event);
      if (joinDecision(event)?.approved) {
        void accountAddCampaign('refresh', '').catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const store = useJoinStore.getState();
    if (!dm || campaignId === null) {
      store.clearInbox();
      return;
    }
    void store.load(campaignId).catch(() => undefined);
  }, [dm, campaignId]);
}
