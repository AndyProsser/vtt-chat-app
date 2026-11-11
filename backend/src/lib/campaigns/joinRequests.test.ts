import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DAY_MS, MAX_OPEN_JOIN_REQUESTS } from '../../consts/index.js';
import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import { openTestBackend } from '../store/testing.js';
import { CampaignService } from './campaignService.js';
import { JoinRequestService } from './joinRequests.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

let store: Store;
let now = 1_000_000;
let campaigns: CampaignService;
let joins: JoinRequestService;
let sent: { to: string; type: string; data: unknown }[];
let notes: { ids: string[]; kind: string; title: string; campaignId: string | null }[];
let rosters: string[];

let dm: User;
let ann: User;
let bob: User;
let admin: User;
let campaignId: string;

async function makeUser(name: string, isAdmin = false): Promise<User> {
  const u: User = {
    id: backend.newId(),
    email: `${name}@x.test`,
    displayName: name,
    passwordHash: null,
    isAdmin,
    consentVersion: '1',
    consentAt: 1,
    createdAt: 1,
  };
  await store.putUser(u);
  return u;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
}

beforeEach(async () => {
  store = await backend.reset();
  now = 1_000_000;
  sent = [];
  notes = [];
  rosters = [];
  const clock = { now: () => now };
  campaigns = new CampaignService({ store, clock, newId: backend.newId });
  joins = new JoinRequestService({
    store,
    clock,
    newId: backend.newId,
    hooks: {
      sendToUser: (to, type, data) => sent.push({ to, type, data }),
      notify: async (ids, n) => {
        notes.push({ ids, kind: n.kind, title: n.title, campaignId: n.campaignId });
      },
      rosterChanged: (id) => void rosters.push(id),
    },
  });
  admin = await makeUser('admin', true);
  dm = await makeUser('dm');
  ann = await makeUser('ann');
  bob = await makeUser('bob');
  await store.putSettings({ ...(await store.getSettings()), campaignCreation: 'open' });
  campaignId = (await campaigns.createCampaign(dm, 'Strahd')).id;
});

describe('the directory', () => {
  it('lists open campaigns with name, DM and player count, minus the ones you are in', async () => {
    const other = await campaigns.createCampaign(ann, 'Ann’s table');
    const list = await joins.listOpen(ann.id);
    expect(list).toEqual([
      { id: campaignId, name: 'Strahd', dmName: 'dm', playerCount: 0, myRequest: null },
    ]);
    expect(list.some((c) => c.id === other.id)).toBe(false);
    expect(JSON.stringify(list)).not.toContain('ann');
  });

  it('is empty when the instance master switch is off', async () => {
    await store.putSettings({ ...(await store.getSettings()), campaignDirectory: 'off' });
    expect(await joins.listOpen(ann.id)).toEqual([]);
  });

  it('hides a campaign whose DM switched Allow join off', async () => {
    await joins.setAllowJoin(campaignId, dm.id, false);
    expect(await joins.listOpen(ann.id)).toEqual([]);
    await joins.setAllowJoin(campaignId, dm.id, true);
    expect(await joins.listOpen(ann.id)).toHaveLength(1);
  });

  it('shows the caller their own pending and declined state, and clears a decline after 7 days', async () => {
    await joins.request(ann, campaignId);
    expect((await joins.listOpen(ann.id))[0]?.myRequest).toMatchObject({ status: 'pending' });
    expect((await joins.listOpen(bob.id))[0]?.myRequest).toBeNull();
    const pending = (await joins.listForDm(campaignId, dm.id)).requests[0];
    await joins.decide(campaignId, pending!.id, dm.id, false);
    const declined = (await joins.listOpen(ann.id))[0]?.myRequest;
    expect(declined).toMatchObject({ status: 'declined', retryAfter: now + 7 * DAY_MS });
    now += 7 * DAY_MS + 1;
    expect((await joins.listOpen(ann.id))[0]?.myRequest).toBeNull();
  });
});

describe('request', () => {
  it('stores a cleaned message, tells the DM live and by notification', async () => {
    expect(await joins.request(ann, campaignId, ' hi‮ there\u0000 ')).toEqual({
      status: 'pending',
    });
    const stored = await store.listJoinRequestsForCampaign(campaignId, 'pending');
    expect(stored).toMatchObject([{ userId: ann.id, message: 'hi there' }]);
    expect(sent).toEqual([
      {
        to: dm.id,
        type: 'join.request',
        data: expect.objectContaining({
          campaignId,
          status: 'pending',
          displayName: 'ann',
          message: 'hi there',
        }),
      },
    ]);
    expect(notes).toEqual([
      { ids: [dm.id], kind: 'join_request', title: 'ann wants to join Strahd', campaignId },
    ]);
  });

  it('gives a duplicate the same answer and does not notify again', async () => {
    await joins.request(ann, campaignId);
    expect(await joins.request(ann, campaignId, 'again')).toEqual({ status: 'pending' });
    expect(await store.listJoinRequestsForCampaign(campaignId)).toHaveLength(1);
    expect(notes).toHaveLength(1);
  });

  it('refuses over-long messages (280 characters) but accepts exactly 280', async () => {
    expect(await codeOf(joins.request(ann, campaignId, 'x'.repeat(281)))).toBe('invalid_input');
    expect(await codeOf(joins.request(ann, campaignId, 'x'.repeat(280)))).toBeUndefined();
  });

  it('answers not_found for a missing campaign, Allow join off, and the master switch off alike', async () => {
    expect(await codeOf(joins.request(ann, backend.newId()))).toBe('not_found');
    await joins.setAllowJoin(campaignId, dm.id, false);
    expect(await codeOf(joins.request(ann, campaignId))).toBe('not_found');
    await joins.setAllowJoin(campaignId, dm.id, true);
    await store.putSettings({ ...(await store.getSettings()), campaignDirectory: 'off' });
    expect(await codeOf(joins.request(ann, campaignId))).toBe('not_found');
    expect(await store.listJoinRequestsForCampaign(campaignId)).toEqual([]);
  });

  it('refuses a member of the campaign, the DM included', async () => {
    expect(await codeOf(joins.request(dm, campaignId))).toBe('conflict');
  });

  it('refuses a repeat for 7 days after a decline, then allows it', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    await joins.decide(campaignId, r!.id, dm.id, false);
    expect(await codeOf(joins.request(ann, campaignId))).toBe('conflict');
    now += 7 * DAY_MS + 1;
    expect(await codeOf(joins.request(ann, campaignId))).toBeUndefined();
  });

  it('allows asking again straight after withdrawing', async () => {
    await joins.request(ann, campaignId);
    await joins.withdraw(ann, campaignId);
    expect(await store.countOpenJoinRequestsByUser(ann.id)).toBe(0);
    expect(await codeOf(joins.request(ann, campaignId))).toBeUndefined();
  });

  it('caps open requests at five per person, and a withdrawal frees a slot', async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_OPEN_JOIN_REQUESTS + 1; i++) {
      const owner = await makeUser(`owner${i}`);
      ids.push((await campaigns.createCampaign(owner, `Table ${i}`)).id);
    }
    for (const id of ids.slice(0, MAX_OPEN_JOIN_REQUESTS)) await joins.request(ann, id);
    expect(await codeOf(joins.request(ann, ids[MAX_OPEN_JOIN_REQUESTS]!))).toBe('conflict');
    // A repeat of an open one is still the neutral answer, not a refusal.
    expect(await codeOf(joins.request(ann, ids[0]!))).toBeUndefined();
    await joins.withdraw(ann, ids[0]!);
    expect(await codeOf(joins.request(ann, ids[MAX_OPEN_JOIN_REQUESTS]!))).toBeUndefined();
  });

  it('lets a person who already has a campaign ask for another', async () => {
    const mine = await campaigns.createCampaign(ann, 'Mine');
    expect(mine.id).not.toBe(campaignId);
    expect(await codeOf(joins.request(ann, campaignId))).toBeUndefined();
  });
});

describe('withdraw', () => {
  it('marks the request withdrawn, tells the DM, and is a no-op with nothing open', async () => {
    await joins.request(ann, campaignId);
    sent.length = 0;
    await joins.withdraw(ann, campaignId);
    expect((await store.listJoinRequestsForUser(ann.id))[0]?.status).toBe('withdrawn');
    expect(sent[0]).toMatchObject({ to: dm.id, type: 'join.request' });
    expect(sent[0]?.data).toMatchObject({ status: 'withdrawn' });
    expect(await codeOf(joins.withdraw(bob, campaignId))).toBeUndefined();
    expect((await joins.listForDm(campaignId, dm.id)).requests).toEqual([]);
  });
});

describe('the DM’s list and decisions', () => {
  it('lists pending plus recent decisions with who asked, DM only', async () => {
    await joins.request(ann, campaignId, 'let me in');
    now += 1000;
    await joins.request(bob, campaignId);
    const { requests, allowJoin } = await joins.listForDm(campaignId, dm.id);
    expect(allowJoin).toBe(true);
    expect(requests.map((r) => [r.displayName, r.status, r.closed])).toEqual([
      ['ann', 'pending', false],
      ['bob', 'pending', false],
    ]);
    expect(requests[0]?.message).toBe('let me in');
    await joins.decide(campaignId, requests[1]!.id, dm.id, false);
    now += 31 * DAY_MS;
    expect((await joins.listForDm(campaignId, dm.id)).requests.map((r) => r.displayName)).toEqual([
      'ann',
    ]);
  });

  it('approve adds one player membership, marks approved and notifies the requester', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    sent.length = 0;
    notes.length = 0;
    const out = await joins.decide(campaignId, r!.id, dm.id, true);
    expect(out.joined).toBe(true);
    expect(await store.getMembership(campaignId, ann.id)).toMatchObject({ role: 'player' });
    expect(await store.getJoinRequest(r!.id)).toMatchObject({
      status: 'approved',
      decidedBy: dm.id,
      decidedAt: now,
    });
    expect(sent).toEqual([
      {
        to: ann.id,
        type: 'join.decided',
        data: { campaignId, requestId: r!.id, approved: true },
      },
    ]);
    expect(notes).toEqual([
      { ids: [ann.id], kind: 'join_decision', title: "You're in Strahd", campaignId },
    ]);
    expect(rosters).toEqual([campaignId]);
    // The campaign leaves her directory now that she is in.
    expect(await joins.listOpen(ann.id)).toEqual([]);
  });

  it('decline records the decision, adds no membership, and notifies the requester', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    notes.length = 0;
    await joins.decide(campaignId, r!.id, dm.id, false);
    expect(await store.getMembership(campaignId, ann.id)).toBeUndefined();
    expect((await store.getJoinRequest(r!.id))?.status).toBe('declined');
    expect(notes).toMatchObject([{ ids: [ann.id], kind: 'join_decision', campaignId: null }]);
    expect(rosters).toEqual([]);
  });

  it('adds the membership exactly once when approve is clicked twice at once', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    const results = await Promise.allSettled([
      joins.decide(campaignId, r!.id, dm.id, true),
      joins.decide(campaignId, r!.id, dm.id, true),
    ]);
    expect(results.every((x) => x.status === 'fulfilled')).toBe(true);
    expect(
      (await store.listMemberships(campaignId)).filter((m) => m.userId === ann.id),
    ).toHaveLength(1);
    expect(notes.filter((n) => n.kind === 'join_decision')).toHaveLength(1);
  });

  it('treats a repeat of the same decision as harmless and the opposite one as a conflict', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    await joins.decide(campaignId, r!.id, dm.id, false);
    expect((await joins.decide(campaignId, r!.id, dm.id, false)).joined).toBe(false);
    expect(await codeOf(joins.decide(campaignId, r!.id, dm.id, true))).toBe('conflict');
    expect(await store.getMembership(campaignId, ann.id)).toBeUndefined();
  });

  it('refuses a withdrawn request and a request from another campaign', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    await joins.withdraw(ann, campaignId);
    expect(await codeOf(joins.decide(campaignId, r!.id, dm.id, true))).toBe('conflict');
    const elsewhere = await campaigns.createCampaign(dm, 'Elsewhere');
    expect(await codeOf(joins.decide(elsewhere.id, r!.id, dm.id, true))).toBe('not_found');
  });

  it('refuses everyone but the DM: a player, a stranger, and an Admin who is not the DM', async () => {
    await joins.request(ann, campaignId);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    await store.putMembership({
      campaignId,
      userId: bob.id,
      role: 'player',
      activeCharacterId: null,
      suspendedCharacterId: null,
      joinedAt: 1,
    });
    for (const who of [bob, admin, ann]) {
      expect(await codeOf(joins.decide(campaignId, r!.id, who.id, true))).toBe('forbidden');
      expect(await codeOf(joins.listForDm(campaignId, who.id))).toBe('forbidden');
      expect(await codeOf(joins.setAllowJoin(campaignId, who.id, false))).toBe('forbidden');
    }
    expect((await store.getJoinRequest(r!.id))?.status).toBe('pending');
  });

  it('keeps pending requests visible but closed, and unapprovable, while Allow join is off', async () => {
    await joins.request(ann, campaignId);
    await joins.setAllowJoin(campaignId, dm.id, false);
    const { requests, allowJoin } = await joins.listForDm(campaignId, dm.id);
    expect(allowJoin).toBe(false);
    expect(requests[0]).toMatchObject({ status: 'pending', closed: true });
    expect(await codeOf(joins.decide(campaignId, requests[0]!.id, dm.id, true))).toBe('conflict');
    // Declining still works while closed.
    expect(await codeOf(joins.decide(campaignId, requests[0]!.id, dm.id, false))).toBeUndefined();
    await joins.setAllowJoin(campaignId, dm.id, true);
    expect(await store.getMembership(campaignId, ann.id)).toBeUndefined();
  });

  it('closes pending requests when the instance master switch is off', async () => {
    await joins.request(ann, campaignId);
    await store.putSettings({ ...(await store.getSettings()), campaignDirectory: 'off' });
    const { requests } = await joins.listForDm(campaignId, dm.id);
    expect(requests[0]?.closed).toBe(true);
    expect(await codeOf(joins.decide(campaignId, requests[0]!.id, dm.id, true))).toBe('conflict');
  });

  it('approves a requester who joined by invite in the meantime without a second membership', async () => {
    await joins.request(ann, campaignId);
    const { code } = await campaigns.createInvite(dm, campaignId);
    await campaigns.joinWithInvite(ann, code);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;
    const out = await joins.decide(campaignId, r!.id, dm.id, true);
    expect(out.joined).toBe(false);
    expect(
      (await store.listMemberships(campaignId)).filter((m) => m.userId === ann.id),
    ).toHaveLength(1);
  });
});

describe('a DM swap', () => {
  it('moves the authority over pending requests to the new DM', async () => {
    await joins.request(bob, campaignId);
    const { code } = await campaigns.createInvite(dm, campaignId);
    await campaigns.joinWithInvite(ann, code);
    const [r] = (await joins.listForDm(campaignId, dm.id)).requests;

    await campaigns.swapDm(dm, campaignId, ann.id);

    expect(await codeOf(joins.decide(campaignId, r!.id, dm.id, true))).toBe('forbidden');
    expect(await codeOf(joins.listForDm(campaignId, dm.id))).toBe('forbidden');
    expect((await joins.listForDm(campaignId, ann.id)).requests).toHaveLength(1);
    expect(await codeOf(joins.decide(campaignId, r!.id, ann.id, true))).toBeUndefined();
    expect(await store.getMembership(campaignId, bob.id)).toMatchObject({ role: 'player' });
    // New requests now reach the new DM.
    sent.length = 0;
    await joins.request(await makeUser('cy'), campaignId);
    expect(sent[0]?.to).toBe(ann.id);
  });
});
