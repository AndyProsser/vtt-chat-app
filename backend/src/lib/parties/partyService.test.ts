/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed event payloads */
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryStore } from '../store/memoryStore.js';
import type { AudioRouter, RoomParticipant } from './audioRouter.js';
import { PartyService } from './partyService.js';

const C = 'camp';

class FakeRouter implements AudioRouter {
  people: RoomParticipant[] = [];
  calls: { listener: string; sids: string[]; subscribe: boolean }[] = [];
  fail = false;
  async participants(): Promise<RoomParticipant[]> {
    if (this.fail) throw new Error('livekit down');
    return this.people.map((p) => ({ ...p }));
  }
  async setSubscription(
    _room: string,
    listener: string,
    sids: string[],
    subscribe: boolean,
  ): Promise<void> {
    this.calls.push({ listener, sids: [...sids].sort(), subscribe });
  }
}

let store: MemoryStore;
let router: FakeRouter;
let events: { type: string; data: any }[];
let service: PartyService;
let log: string[];

const member = (userId: string, role: 'dm' | 'player') =>
  store.putMembership({
    campaignId: C,
    userId,
    role,
    activeCharacterId: null,
    suspendedCharacterId: null,
    joinedAt: 1,
  });

beforeEach(async () => {
  store = new MemoryStore();
  router = new FakeRouter();
  events = [];
  log = [];
  service = new PartyService({
    store,
    router,
    emit: (_c, type, data) => events.push({ type, data }),
    log: (l) => log.push(l),
  });
  await member('dm', 'dm');
  for (const p of ['alice', 'bob', 'carol']) await member(p, 'player');
  router.people = [
    { identity: 'dm', audioTrackSids: ['t-dm'] },
    { identity: 'alice', audioTrackSids: ['t-alice'] },
    { identity: 'bob', audioTrackSids: ['t-bob'] },
    { identity: 'carol', audioTrackSids: ['t-carol'] },
  ];
});

const callsFor = (listener: string) => router.calls.filter((c) => c.listener === listener);

describe('enforcing a split in LiveKit', () => {
  it('cuts players off from other groups but never from the DM, and never touches the DM’s own listening', async () => {
    const cellar = await service.create(C, 'Cellar');
    const roof = await service.create(C, 'Roof');
    await service.move(C, 'alice', cellar.id);
    await service.move(C, 'bob', cellar.id);
    await service.move(C, 'carol', roof.id);

    // The net effect of all calls so far: alice and bob (cellar) must not hear carol (roof), and carol must
    // not hear them. (Moving people one at a time cuts and restores in between; only the end state matters.)
    const cutOff = (listener: string): Set<string> => {
      const cut = new Set<string>();
      for (const c of callsFor(listener)) {
        for (const sid of c.sids) {
          if (c.subscribe) cut.delete(sid);
          else cut.add(sid);
        }
      }
      return cut;
    };
    expect(cutOff('alice')).toEqual(new Set(['t-carol']));
    expect(cutOff('bob')).toEqual(new Set(['t-carol']));
    expect(cutOff('carol')).toEqual(new Set(['t-alice', 't-bob']));
    expect(callsFor('dm')).toEqual([]); // the DM hears everyone, all the time
    for (const call of router.calls) expect(call.sids).not.toContain('t-dm'); // everyone keeps hearing the DM
  });

  it('applies only what changed, not everything again', async () => {
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id); // alice cut off from bob + carol; bob + carol cut off from alice
    router.calls.length = 0;
    await service.reconcile(C); // nothing changed
    expect(router.calls).toEqual([]);
    await service.move(C, 'bob', a.id); // bob joins alice: they hear each other again
    expect(
      callsFor('alice')
        .filter((c) => c.subscribe)
        .flatMap((c) => c.sids),
    ).toEqual(['t-bob']);
    expect(
      callsFor('bob')
        .filter((c) => c.subscribe)
        .flatMap((c) => c.sids),
    ).toEqual(['t-alice']);
  });

  it('a track published later is cut off at the next check', async () => {
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id);
    router.calls.length = 0;
    router.people.push({ identity: 'dave', audioTrackSids: ['t-dave'] }); // joins, main table
    await service.reconcile(C);
    expect(
      callsFor('alice')
        .filter((c) => !c.subscribe)
        .flatMap((c) => c.sids),
    ).toEqual(['t-dave']);
  });

  it('ending the split re-subscribes everyone to everything they had been cut off from', async () => {
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id);
    router.calls.length = 0;
    await service.reset(C);
    const resub = (l: string) =>
      callsFor(l)
        .filter((c) => c.subscribe)
        .flatMap((c) => c.sids)
        .sort();
    expect(resub('alice')).toEqual(['t-bob', 't-carol']);
    expect(resub('bob')).toEqual(['t-alice']);
    expect(resub('carol')).toEqual(['t-alice']);
    router.calls.length = 0;
    await service.reconcile(C); // and then it is quiet: no work for an unsplit table
    expect(router.calls).toEqual([]);
  });

  it('deleting a party returns its players to the main table', async () => {
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id);
    router.calls.length = 0;
    await service.delete(C, a.id);
    expect(
      callsFor('alice')
        .filter((c) => c.subscribe)
        .flatMap((c) => c.sids)
        .sort(),
    ).toEqual(['t-bob', 't-carol']);
  });

  it('a LiveKit outage is logged and does not break the party state clients see', async () => {
    router.fail = true;
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id);
    expect(log.join('\n')).toContain('livekit down');
    expect(service.snapshot(C).assignments).toEqual({ alice: a.id });
    expect(events.at(-1)?.type).toBe('party.state');
  });

  it('with no router at all, groups are tracked and announced but nothing is enforced', async () => {
    const bare = new PartyService({
      store,
      router: undefined,
      emit: (_c, type, data) => events.push({ type, data }),
    });
    const a = await bare.create(C, 'A');
    await bare.move(C, 'alice', a.id);
    expect(bare.snapshot(C).split).toBe(true);
  });
});

describe('who can be moved', () => {
  it('only players of the campaign: not the DM, not a stranger', async () => {
    const a = await service.create(C, 'A');
    await expect(service.move(C, 'dm', a.id)).rejects.toThrow(/DM is in every group/);
    await expect(service.move(C, 'stranger', a.id)).rejects.toThrow(/not in this campaign/);
    await expect(service.move(C, 'alice', 'no-such-party')).rejects.toThrow(/no such party/);
  });

  it('creates a group with its first players already in it, announced as one change', async () => {
    const g = await service.create(C, 'Plan B', ['alice', 'bob']);
    expect(service.snapshot(C).assignments).toEqual({ alice: g.id, bob: g.id });
    expect(events.map((e) => e.type)).toEqual(['party.state']);
    expect(events[0]?.data).toMatchObject({ split: true, parties: [{ name: 'Plan B' }] });
  });

  it('creates nothing if any of those players cannot be moved', async () => {
    await expect(service.create(C, 'Oops', ['alice', 'dm'])).rejects.toThrow(
      /DM is in every group/,
    );
    await expect(service.create(C, 'Oops', ['stranger'])).rejects.toThrow(/not in this campaign/);
    expect(service.snapshot(C).parties).toEqual([]);
    expect(events).toEqual([]);
  });

  it('a player who leaves the campaign is taken out of their party', async () => {
    const a = await service.create(C, 'A');
    await service.move(C, 'alice', a.id);
    await service.forget(C, 'alice');
    expect(service.snapshot(C).assignments).toEqual({});
  });

  it('every change is announced to the table as the full state', async () => {
    const a = await service.create(C, 'Cellar');
    await service.move(C, 'alice', a.id);
    expect(events.map((e) => e.type)).toEqual(['party.state', 'party.state']);
    expect(events.at(-1)?.data).toMatchObject({
      split: true,
      parties: [{ name: 'Cellar' }],
      assignments: { alice: a.id },
    });
  });
});

describe('a private aside', () => {
  const heard = (listener: string, subscribe: boolean) =>
    callsFor(listener)
      .filter((c) => c.subscribe === subscribe)
      .flatMap((c) => c.sids)
      .sort();

  it('cuts the table off from the DM and the player, and the two off from the table, even with no split', async () => {
    await service.aside(C, 'dm', 'alice');
    expect(events.at(-1)?.data.aside).toEqual({ dmId: 'dm', playerId: 'alice' });
    expect(heard('dm', false)).toEqual(['t-bob', 't-carol']); // the DM loses bob and carol
    expect(heard('alice', false)).toEqual(['t-bob', 't-carol']);
    expect(heard('bob', false)).toEqual(['t-alice', 't-dm']);
    expect(heard('carol', false)).toEqual(['t-alice', 't-dm']);
  });

  it('ending it re-subscribes everyone', async () => {
    await service.aside(C, 'dm', 'alice');
    router.calls.length = 0;
    await service.aside(C, 'dm', null);
    expect(events.at(-1)?.data.aside).toBeNull();
    expect(heard('dm', true)).toEqual(['t-bob', 't-carol']);
    expect(heard('bob', true)).toEqual(['t-alice', 't-dm']);
  });

  it('refuses to take the DM aside, or someone who is not in the campaign', async () => {
    await expect(service.aside(C, 'dm', 'dm')).rejects.toThrow();
    await expect(service.aside(C, 'dm', 'nobody')).rejects.toThrow();
  });

  it('ends by itself when either person goes offline', async () => {
    await service.aside(C, 'dm', 'alice');
    await service.userOffline(C, 'bob'); // someone else: nothing happens
    expect(service.snapshot(C).aside).not.toBeNull();
    await service.userOffline(C, 'alice');
    expect(service.snapshot(C).aside).toBeNull();
    await service.aside(C, 'dm', 'alice');
    await service.userOffline(C, 'dm');
    expect(service.snapshot(C).aside).toBeNull();
  });
});

describe('a private talk and a lost voice connection', () => {
  it('ends by itself when the DM or the player has been out of the voice room past the grace', async () => {
    let now = 1_000;
    service = new PartyService({
      store,
      router,
      emit: (_c, type, data) => events.push({ type, data }),
      now: () => now,
      asideGraceMs: 20_000,
    });
    await service.aside(C, 'dm', 'alice');
    router.people = router.people.filter((p) => p.identity !== 'dm'); // the DM's app crashed
    now += 10_000;
    await service.reconcile(C);
    expect(service.snapshot(C).aside).not.toBeNull(); // a blip is forgiven
    now += 25_000;
    await service.reconcile(C);
    expect(service.snapshot(C).aside).toBeNull();
    expect(events.at(-1)?.data.aside).toBeNull();
  });

  it('a person who comes back in time keeps the talk going', async () => {
    let now = 1_000;
    service = new PartyService({
      store,
      router,
      emit: () => undefined,
      now: () => now,
      asideGraceMs: 20_000,
    });
    await service.aside(C, 'dm', 'alice');
    const dm = router.people.find((p) => p.identity === 'dm')!;
    router.people = router.people.filter((p) => p.identity !== 'dm');
    now += 15_000;
    await service.reconcile(C);
    router.people.push(dm);
    await service.reconcile(C);
    now += 15_000;
    await service.reconcile(C);
    expect(service.snapshot(C).aside).not.toBeNull();
  });
});
