import { unconfirmedCount } from '@vtt-chat-app/shared';

import type { LootItem } from '../types/index.js';
import { useAccount } from './useAccount.js';
import { useCampaignQuery } from './useCampaignQuery.js';

/** The number beside the inventory icon: items this player still has to add to their game sheet (0 for the DM). */
export function useUnconfirmed(dm: boolean): number {
  const { status } = useAccount();
  const { data } = useCampaignQuery<{ loot: LootItem[] }>('loot', ['loot.']);
  return dm ? 0 : unconfirmedCount(data?.loot ?? [], status?.userId ?? null);
}
