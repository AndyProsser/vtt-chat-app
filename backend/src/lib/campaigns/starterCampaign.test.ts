import { beforeEach, describe, expect, it } from 'vitest';

import { STARTER_CAMPAIGN_NAMES } from '../../consts/index.js';
import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { MemoryStore } from '../store/memoryStore.js';
import { CampaignService } from './campaignService.js';
import { pickStarterCampaignName, StarterCampaigns } from './starterCampaign.js';

describe('pickStarterCampaignName', () => {
  it('is deterministic for an injected random source, including the edges', () => {
    expect(pickStarterCampaignName(() => 0)).toBe(STARTER_CAMPAIGN_NAMES[0]);
    expect(pickStarterCampaignName(() => 0.9999999)).toBe(STARTER_CAMPAIGN_NAMES.at(-1));
    expect(pickStarterCampaignName(() => 0.5, ['a', 'b', 'c', 'd'])).toBe('c');
  });

  it('has a decent pool of distinct, short names', () => {
    expect(STARTER_CAMPAIGN_NAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(STARTER_CAMPAIGN_NAMES).size).toBe(STARTER_CAMPAIGN_NAMES.length);
    for (const name of STARTER_CAMPAIGN_NAMES) expect(name.length).toBeLessThanOrEqual(60);
  });
});

let store: MemoryStore;
let campaigns: CampaignService;
let starter: StarterCampaigns;

const user = (id: string, isAdmin: boolean): User => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  passwordHash: null,
  isAdmin,
  consentVersion: '1',
  consentAt: 1,
  createdAt: 1,
});

async function addUser(id: string, isAdmin: boolean): Promise<User> {
  const u = user(id, isAdmin);
  await store.putUser(u);
  return u;
}

beforeEach(() => {
  store = new MemoryStore();
  campaigns = new CampaignService({ store });
  starter = new StarterCampaigns({ store, campaigns, random: () => 0 });
});

describe('ensureStarterCampaign', () => {
  it('makes the first Admin the DM of a named campaign', async () => {
    const admin = await addUser('admin', true);
    const made = await starter.ensureStarterCampaign(admin);
    expect(made?.name).toBe(STARTER_CAMPAIGN_NAMES[0]);
    const memberships = await store.listMembershipsForUser('admin');
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ campaignId: made?.id, role: 'dm' });
  });

  it('does nothing for a non-admin', async () => {
    const player = await addUser('player', false);
    expect(await starter.ensureStarterCampaign(player)).toBeUndefined();
    expect(await store.countCampaigns()).toBe(0);
  });

  it('does nothing when the admin already has a campaign', async () => {
    const admin = await addUser('admin', true);
    await campaigns.createCampaign(admin, 'Mine');
    expect(await starter.ensureStarterCampaign(admin)).toBeUndefined();
    expect(await store.countCampaigns()).toBe(1);
  });

  it('does nothing when the instance already has a campaign', async () => {
    const first = await addUser('first', true);
    const second = await addUser('second', true);
    await campaigns.createCampaign(first, 'Theirs');
    expect(await starter.ensureStarterCampaign(second)).toBeUndefined();
    expect(await store.countCampaigns()).toBe(1);
  });

  it('is idempotent across repeated and concurrent calls', async () => {
    const admin = await addUser('admin', true);
    await Promise.all([1, 2, 3, 4].map(() => starter.ensureStarterCampaign(admin)));
    await starter.ensureStarterCampaign(admin);
    expect(await store.countCampaigns()).toBe(1);
  });

  it('uses the stored admin flag, not a stale copy', async () => {
    const admin = await addUser('admin', true);
    await store.putUser({ ...admin, isAdmin: false });
    expect(await starter.ensureStarterCampaign(admin)).toBeUndefined();
  });
});

describe('sign-in path', () => {
  it('creates the starter campaign once for the first Admin, however often they sign in', async () => {
    const accounts = new AccountService({ store });
    const admin = await accounts.register({
      email: 'a@example.com',
      displayName: 'A',
      acceptedConsentVersion: (await store.getSettings()).consentVersion,
    });
    expect(admin.isAdmin).toBe(true);
    expect(await store.countCampaigns()).toBe(0);
    await accounts.signInUser(admin);
    await accounts.signInUser(admin);
    expect(await store.countCampaigns()).toBe(1);
    expect(await store.listMembershipsForUser(admin.id)).toHaveLength(1);
  });

  it('can be switched off', async () => {
    const accounts = new AccountService({ store, starterCampaigns: null });
    const admin = await addUser('admin', true);
    await accounts.signInUser(admin);
    expect(await store.countCampaigns()).toBe(0);
  });
});
