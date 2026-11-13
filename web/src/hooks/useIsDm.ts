import { usePhoneStore } from '../lib/phone/phoneStore.js';

/** Is this person the DM of the open campaign? Decides which tools the tabs show; the server decides what is allowed. */
export function useIsDm(campaignId: string): boolean {
  return usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId)?.role === 'dm');
}
