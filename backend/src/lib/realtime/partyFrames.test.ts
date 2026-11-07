/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { CampaignService } from '../campaigns/campaignService.js';
import type { AudioRouter } from '../parties/audioRouter.js';
import { PartyService } from '../parties/partyService.js';
import { MemoryStore } from '../store/memoryStore.js';
import { Hub, type Connection } from './hub.js';
import { MemoryReplayBuffer } from './replayBuffer.js';

class Conn implements Connection {
  sent: { t: string; d: any }[] = [];
  constructor(readonly id: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {}
  of(t: string) {
    return this.sent.filter((f) => f.t === t);
  }
}
const frame = (t: string, d: unknown): string => JSON.stringify({ v: 1, t, d });
const router: AudioRouter = {
  participants: async () => [],
  setSubscription: async () => undefined,
};

let hub: Hub;
let campaignId: string;
let users: Record<'dm' | 'alice' | 'bob', User>;
let tokens: Record<string, string>;

async function build(withParties = true) {
  const store = new MemoryStore();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  const ref: { hub?: Hub } = {};
  const parties = new PartyService({
    store,
    router,
    emit: (c, t, d) => ref.hub?.broadcastToCampaign(c, t, d),
  });
  hub = new Hub({
    store,
    accounts,
    replay: new MemoryReplayBuffer(),
    ...(withParties ? { parties } : {}),
  });
  ref.hub = hub;
  users = {} as typeof users;
  tokens = {};
  for (const name of ['dm', 'alice', 'bob'] as const) {
    users[name] = await accounts.register({
      email: `${name}@example.com`,
      displayName: name,
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    tokens[name] = (
      await accounts.signInWithPassword(users[name].email, 'correct horse battery')
    ).sessionToken;
  }
  campaignId = (await campaigns.createCampaign(users.dm, 'T')).id;
  const { code } = await campaigns.createInvite(users.dm, campaignId);
  for (const n of ['alice', 'bob'] as const) await campaigns.joinWithInvite(users[n], code);
}
async function join(id: string, who: keyof typeof users): Promise<Conn> {
  const conn = new Conn(id);
  hub.accept(conn);
  await hub.receive(id, frame('auth', { token: tokens[who] }));
  await hub.receive(id, frame('resume', { campaignId }));
  return conn;
}
const send = (id: string, t: string, d: object = {}) =>
  hub.receive(id, frame(t, { campaignId, ...d }));

beforeEach(() => build());
afterEach(() => hub.close());

describe('voice-group frames', () => {
  it('the DM splits the table and everyone is told the full state', async () => {
    const [dm, alice, bob] = [
      await join('dm', 'dm'),
      await join('a', 'alice'),
      await join('b', 'bob'),
    ];
    await send('dm', 'party.create', { name: 'Cellar' });
    const partyId = dm.of('party.state').at(-1)?.d.parties[0].id;
    await send('dm', 'party.move', { userId: users.alice.id, partyId });
    for (const c of [dm, alice, bob]) {
      expect(c.of('party.state').at(-1)?.d).toMatchObject({
        split: true,
        assignments: { [users.alice.id]: partyId },
      });
    }
  });

  it('a player’s attempt is refused and changes nothing', async () => {
    const alice = await join('a', 'alice');
    const dm = await join('dm', 'dm');
    for (const [t, d] of [
      ['party.create', { name: 'x' }],
      ['party.move', { userId: users.bob.id, partyId: null }],
      ['party.reset', {}],
    ] as const) {
      await send('a', t, d);
    }
    expect(alice.of('error').map((f) => f.d.code)).toEqual(['forbidden', 'forbidden', 'forbidden']);
    expect(dm.of('party.state').filter((f) => f.d.split)).toHaveLength(0);
  });

  it('the DM cannot be put in a party, and an unknown party is refused', async () => {
    const dm = await join('dm', 'dm');
    await send('dm', 'party.create', { name: 'A' });
    const partyId = dm.of('party.state').at(-1)?.d.parties[0].id;
    await send('dm', 'party.move', { userId: users.dm.id, partyId });
    await send('dm', 'party.move', { userId: users.alice.id, partyId: 'nope' });
    expect(dm.of('error').map((f) => f.d.code)).toEqual(['invalid_input', 'not_found']);
  });

  it('a late joiner or a reconnect is told who is where', async () => {
    const dm = await join('dm', 'dm');
    await send('dm', 'party.create', { name: 'Roof' });
    const partyId = dm.of('party.state').at(-1)?.d.parties[0].id;
    await send('dm', 'party.move', { userId: users.alice.id, partyId });
    const late = await join('b', 'bob');
    expect(late.of('party.state')[0]?.d).toMatchObject({
      split: true,
      assignments: { [users.alice.id]: partyId },
    });
  });

  it('is forgotten when the last person leaves the table', async () => {
    await join('dm', 'dm');
    await send('dm', 'party.create', { name: 'Gone' });
    hub.closed('dm');
    const next = await join('a', 'alice');
    expect(next.of('party.state')[0]?.d).toMatchObject({ split: false, parties: [] });
  });

  it('refuses cleanly when voice groups are not enabled', async () => {
    hub.close();
    await build(false);
    const dm = await join('dm', 'dm');
    await send('dm', 'party.create', { name: 'x' });
    expect(dm.of('error')[0]?.d.code).toBe('unavailable');
  });
});
