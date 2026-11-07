/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { CampaignService } from '../campaigns/campaignService.js';
import { MemorySoundStore } from '../soundboard/memorySoundStore.js';
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

let hub: Hub;
let campaignId: string;
let users: Record<'dm' | 'alice' | 'bob' | 'outsider', User>;
let tokens: Record<string, string>;
let sounds: MemorySoundStore;

const sound = (id: string, ownerId: string) => ({
  id,
  ownerId,
  name: id,
  category: 'effect' as const,
  tags: [],
  createdAt: 1,
  takes: [{ id: `${id}-t0`, soundId: id, mediaId: `m-${id}`, level: 1, position: 0 }],
});

async function build(withSounds = true) {
  const store = new MemoryStore();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  sounds = new MemorySoundStore();
  hub = new Hub({
    store,
    accounts,
    replay: new MemoryReplayBuffer(),
    ...(withSounds ? { sounds } : {}),
  });
  users = {} as typeof users;
  tokens = {};
  for (const name of ['dm', 'alice', 'bob', 'outsider'] as const) {
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
  const campaign = await campaigns.createCampaign(users.dm, 'T');
  campaignId = campaign.id;
  const { code } = await campaigns.createInvite(users.dm, campaignId);
  for (const n of ['alice', 'bob'] as const) await campaigns.joinWithInvite(users[n], code);
  await sounds.putSound(sound('door', users.dm.id));
  await sounds.putSound(sound('rain', users.dm.id));
  await sounds.putSound(sound('theirs', users.outsider.id));
  await sounds.putScene({
    id: 'cave',
    ownerId: users.dm.id,
    name: 'Cave',
    createdAt: 1,
    layers: [
      {
        id: 'l1',
        soundId: 'rain',
        mode: 'loop',
        volume: 0.6,
        minIntervalSec: null,
        maxIntervalSec: null,
      },
    ],
  });
}

async function join(id: string, who: keyof typeof users, subscribe = true): Promise<Conn> {
  const conn = new Conn(id);
  hub.accept(conn);
  await hub.receive(id, frame('auth', { token: tokens[who] }));
  if (subscribe) await hub.receive(id, frame('resume', { campaignId }));
  return conn;
}
const send = (id: string, t: string, d: object = {}) =>
  hub.receive(id, frame(t, { campaignId, ...d }));

beforeEach(() => build());
afterEach(() => hub.close());

describe('the DM’s soundboard frames', () => {
  it('a DM trigger is heard by everyone at the table, with the take chosen by the server', async () => {
    const [dm, alice, bob] = [
      await join('dm', 'dm'),
      await join('a', 'alice'),
      await join('b', 'bob'),
    ];
    await send('dm', 'sound.play', { soundId: 'door', volume: 0.8 });
    for (const c of [dm, alice, bob]) {
      expect(c.of('sound.play')).toHaveLength(1);
      expect(c.of('sound.play')[0]?.d).toMatchObject({
        soundId: 'door',
        takeId: 'door-t0',
        mode: 'oneshot',
        volume: 0.8,
      });
    }
  });

  it('a player’s attempt is refused, and nobody hears anything', async () => {
    const dm = await join('dm', 'dm');
    const alice = await join('a', 'alice');
    for (const [t, d] of [
      ['sound.play', { soundId: 'door' }],
      ['scene.start', { sceneId: 'cave' }],
      ['sound.stop', {}],
      ['scene.stop', {}],
      ['sound.volume', { master: 0 }],
    ] as const) {
      await send('a', t, d);
    }
    expect(alice.of('error').map((f) => f.d.code)).toEqual(Array(5).fill('forbidden'));
    expect(dm.of('sound.play')).toHaveLength(0);
    expect(dm.of('scene.started')).toHaveLength(0);
  });

  it('a DM cannot play another account’s sound', async () => {
    const dm = await join('dm', 'dm');
    await send('dm', 'sound.play', { soundId: 'theirs' });
    expect(dm.of('error')[0]?.d.code).toBe('not_found');
    expect(dm.of('sound.play')).toHaveLength(0);
  });

  it('a targeted sound reaches only the chosen player (and not the DM or others)', async () => {
    const [dm, alice, bob] = [
      await join('dm', 'dm'),
      await join('a', 'alice'),
      await join('b', 'bob'),
    ];
    await send('dm', 'sound.play', { soundId: 'door', to: [users.alice.id] });
    expect(alice.of('sound.play')).toHaveLength(1);
    expect(bob.of('sound.play')).toHaveLength(0);
    expect(dm.of('sound.play')).toHaveLength(0);
  });

  it('someone who is not subscribed to the campaign cannot use it at all', async () => {
    const outsider = await join('o', 'outsider', false);
    await send('o', 'sound.play', { soundId: 'theirs' });
    expect(outsider.of('error')[0]?.d.code).toBe('not_subscribed');
  });

  it('refuses cleanly when the server has no soundboard', async () => {
    hub.close();
    await build(false);
    const dm = await join('dm', 'dm');
    await send('dm', 'sound.play', { soundId: 'door' });
    expect(dm.of('error')[0]?.d.code).toBe('unavailable');
  });
});

describe('catching up', () => {
  it('a late joiner is told the running loop and scene; once stopped, a new joiner hears none', async () => {
    await join('dm', 'dm');
    await send('dm', 'scene.start', { sceneId: 'cave' });
    await send('dm', 'sound.play', { soundId: 'door', mode: 'loop' });

    const late = await join('a', 'alice');
    const state = late.of('sound.state')[0]?.d;
    expect(state.scene).toEqual({ sceneId: 'cave', name: 'Cave' });
    expect(state.loops.map((l: any) => l.soundId).sort()).toEqual(['door', 'rain']);

    await send('dm', 'sound.stop'); // stops everything
    const later = await join('b', 'bob');
    expect(later.of('sound.state')[0]?.d).toMatchObject({ loops: [], scene: null });
  });

  it('a reconnecting client with a replay is also told what is playing', async () => {
    await join('dm', 'dm');
    await send('dm', 'sound.play', { soundId: 'rain', mode: 'loop' });
    const epoch = await (hub as any).options.replay.epoch(campaignId);
    const back = new Conn('a');
    hub.accept(back);
    await hub.receive('a', frame('auth', { token: tokens.alice }));
    await hub.receive('a', frame('resume', { campaignId, lastSeq: 0, epoch }));
    expect(back.of('sound.state')[0]?.d.loops).toHaveLength(1);
  });

  it('volume changes are broadcast and remembered', async () => {
    await join('dm', 'dm');
    const alice = await join('a', 'alice');
    await send('dm', 'sound.volume', { master: 0.5, player: { userId: users.bob.id, gain: 0.2 } });
    expect(alice.of('sound.volume').map((f) => f.d)).toEqual([
      { campaignId, master: 0.5 },
      { campaignId, player: { userId: users.bob.id, gain: 0.2 } },
    ]);
    const late = await join('b', 'bob');
    expect(late.of('sound.state')[0]?.d).toMatchObject({
      master: 0.5,
      gains: { [users.bob.id]: 0.2 },
    });
  });

  it('when the last person leaves the table the scene is forgotten', async () => {
    await join('dm', 'dm');
    await send('dm', 'scene.start', { sceneId: 'cave' });
    hub.closed('dm');
    const next = await join('a', 'alice');
    expect(next.of('sound.state')[0]?.d).toMatchObject({ loops: [], scene: null });
  });
});
