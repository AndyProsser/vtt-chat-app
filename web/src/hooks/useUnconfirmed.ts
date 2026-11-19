import { unconfirmedCount } from '@vtt-chat-app/shared';

import { lootItems } from '../lib/phone/phoneApi.js';
import { usePhoneStore } from '../lib/phone/phoneStore.js';
import { useIsDm } from './useIsDm.js';
import { useLoad } from './useLoad.js';

/** The number on the Loot tab: items this player still has to add to their game sheet (always 0 for the DM). */
export function useUnconfirmed(campaignId: string): number {
  const rev = usePhoneStore((s) => s.lootRev);
  const selfId = usePhoneStore((s) => s.userId) ?? null;
  const dm = useIsDm(campaignId);
  const { data } = useLoad(
    () => (dm ? Promise.resolve([]) : lootItems(campaignId)),
    `unconfirmed:${campaignId}:${dm}:${rev}`,
  );
  return unconfirmedCount(data ?? [], selfId);
}
