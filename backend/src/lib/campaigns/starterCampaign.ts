import { STARTER_CAMPAIGN_NAMES } from '../../consts/index.js';
import type { Campaign, User } from '../../types/index.js';
import type { Store } from '../store/store.js';
import type { CampaignService } from './campaignService.js';

/** Picks one starter name. `random` returns [0, 1) (like `Math.random`); injectable so tests are deterministic. */
export function pickStarterCampaignName(
  random: () => number = Math.random,
  names: readonly string[] = STARTER_CAMPAIGN_NAMES,
): string {
  const index = Math.min(names.length - 1, Math.floor(random() * names.length));
  return names[Math.max(0, index)] ?? 'The First Campaign';
}

export interface StarterCampaignDeps {
  store: Store;
  campaigns: Pick<CampaignService, 'createCampaign'>;
  random?: () => number;
}

/**
 * Gets the very first Admin straight into something usable. A brand-new instance has no campaigns
 * and (decided 2026-11-11) an account with none would otherwise sit on "Not in a campaign yet", so
 * the first Admin is given one, with a dry-humour name, and made its DM. It goes through the normal
 * `createCampaign`, so membership and everything else is made exactly as for any campaign.
 *
 * Only when ALL hold: the user is an Admin, belongs to no campaign, and the instance has none.
 * Later accounts are a separate design and are deliberately not handled here.
 */
export class StarterCampaigns {
  private readonly store: Store;
  private readonly campaigns: Pick<CampaignService, 'createCampaign'>;
  private readonly random: () => number;
  /** Serialises calls in this process, so concurrent sign-ins cannot both pass the check. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(deps: StarterCampaignDeps) {
    this.store = deps.store;
    this.campaigns = deps.campaigns;
    this.random = deps.random ?? Math.random;
  }

  /** Returns the campaign it created, or `undefined` if the conditions did not hold. Safe to repeat. */
  ensureStarterCampaign(user: User): Promise<Campaign | undefined> {
    const run = this.tail.then(() => this.ensure(user));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async ensure(user: User): Promise<Campaign | undefined> {
    if (!user.isAdmin) return undefined;
    // Re-read the user: a caller's copy may predate an admin grant or revocation.
    const current = await this.store.getUser(user.id);
    if (!current?.isAdmin) return undefined;
    if ((await this.store.listMembershipsForUser(user.id)).length > 0) return undefined;
    if ((await this.store.countCampaigns()) > 0) return undefined;
    return this.campaigns.createCampaign(current, pickStarterCampaignName(this.random));
  }
}
