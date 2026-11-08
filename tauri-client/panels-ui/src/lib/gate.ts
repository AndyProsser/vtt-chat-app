import type { AccountStatus } from '../types/index.js';

export type Gate = 'loading' | 'sign-in' | 'choose-campaign' | 'no-campaign' | 'ready';

/**
 * What the main window shows before the table: it is only useful signed in to a campaign, so
 * anything short of that is a step the player has to finish first, here, not behind a settings cog.
 */
export function gateState(status: AccountStatus | undefined): Gate {
  if (!status) return 'loading';
  if (!status.signedIn) return 'sign-in';
  if (status.campaignId !== null) return 'ready';
  return status.campaigns.length > 0 ? 'choose-campaign' : 'no-campaign';
}
