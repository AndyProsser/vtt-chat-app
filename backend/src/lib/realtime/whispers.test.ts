/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { CampaignService } from '../campaigns/campaignService.js';
import { openTestBackend } from '../store/testing.js';
import { Hub, type Connection } from './hub.js';
import { MemoryReplayBuffer } from './replayBuffer.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

class Conn implements Connection {
  sent: { t: string; seq?: number; d: any }[] = [];
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

interface Table {
  hub: Hub;
  store: Awaited<ReturnType<typeof backend.reset>>;
  campaignId: string;
  users: Record<'dm' | 'alice' | 'bob' | 'carol' | 'outsider', User>;
  tokens: Record<string, string>;
}

let t: Table;
let publicChat: {
  campaignId: string;
  senderId: string;
  senderName: string;
  text: string;
  at: number;
}[];

beforeEach(async () => {
  publicChat = [];
  const store = await backend.reset();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  const hub = new Hub({
    store,
    accounts,
    replay: new MemoryReplayBuffer(),
    onPublicChat: (campaignId, line) => publicChat.push({ campaignId, ...line }),
  });
  const users = {} as Table['users'];
  const tokens: Record<string, string> = {};
  for (const name of ['dm', 'alice', 'bob', 'carol', 'outsider'] as const) {
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
  const campaign = await campaigns.createCampaign(users.dm, 'Table');
  const { code } = await campaigns.createInvite(users.dm, campaign.id);
  for (const name of ['alice', 'bob', 'carol'] as const)
    await campaigns.joinWithInvite(users[name], code);
  t = { hub, store, campaignId: campaign.id, users, tokens };
});
afterEach(() => t.hub.close());

async function join(id: string, who: keyof Table['users'], resume: object = {}): Promise<Conn> {
  const conn = new Conn(id);
  t.hub.accept(conn);
  await t.hub.receive(id, frame('auth', { token: t.tokens[who] }));
  await t.hub.receive(id, frame('resume', { campaignId: t.campaignId, ...resume }));
  return conn;
}
const say = (id: string, text: string, to?: string) =>
  t.hub.receive(
    id,
    frame('chat.message', { campaignId: t.campaignId, text, ...(to ? { to } : {}) }),
  );

describe('chat for the recording', () => {
  it('tells the recording about public lines, and never about a whisper', async () => {
    await join('dm', 'dm');
    await join('a', 'alice');
    await join('b', 'bob');
    await say('a', 'Anyone smell brine?');
    await say('a', 'psst, the baron is lying', t.users.bob.id);
    await say('dm', 'The water moves against the current.');
    expect(publicChat.map((l) => l.text)).toEqual([
      'Anyone smell brine?',
      'The water moves against the current.',
    ]);
    expect(publicChat[0]).toMatchObject({
      campaignId: t.campaignId,
      senderId: t.users.alice.id,
    });
    expect(JSON.stringify(publicChat)).not.toContain('baron');
  });
});

describe('whispers', () => {
  it('reach the sender and the recipient only', async () => {
    const [dm, alice, bob, carol] = [
      await join('dm', 'dm'),
      await join('a', 'alice'),
      await join('b', 'bob'),
      await join('c', 'carol'),
    ];
    await say('a', 'psst, the baron is lying', t.users.bob.id);

    for (const conn of [alice, bob]) {
      expect(conn.of('chat.whisper')).toHaveLength(1);
      expect(conn.of('chat.whisper')[0]?.d).toMatchObject({
        text: 'psst, the baron is lying',
        from: { userId: t.users.alice.id },
        to: { userId: t.users.bob.id },
      });
    }
    // Not the DM (player-to-player whispers are private to the two), not a third player.
    for (const conn of [dm, carol]) {
      expect(conn.of('chat.whisper')).toHaveLength(0);
      expect(JSON.stringify(conn.sent)).not.toContain('the baron is lying');
    }
  });

  it('go to the DM when a player whispers the DM, and back', async () => {
    const dm = await join('dm', 'dm');
    const alice = await join('a', 'alice');
    const bob = await join('b', 'bob');
    await say('a', 'can I search the room?', t.users.dm.id);
    await say('dm', 'roll perception', t.users.alice.id);
    expect(dm.of('chat.whisper')).toHaveLength(2);
    expect(alice.of('chat.whisper')).toHaveLength(2);
    expect(bob.of('chat.whisper')).toHaveLength(0);
  });

  it('are delivered on every device of the two people, and not on anyone else’s', async () => {
    const phone = await join('a2', 'alice');
    const laptop = await join('a', 'alice');
    const bob = await join('b', 'bob');
    const carol = await join('c', 'carol');
    await say('b', 'hello alice', t.users.alice.id);
    expect(phone.of('chat.whisper')).toHaveLength(1);
    expect(laptop.of('chat.whisper')).toHaveLength(1);
    expect(bob.of('chat.whisper')).toHaveLength(1);
    expect(carol.of('chat.whisper')).toHaveLength(0);
  });

  it('never enter the shared replay stream, so nobody is replayed someone else’s whisper', async () => {
    await join('a', 'alice');
    await join('b', 'bob');
    await say('a', 'secret one', t.users.bob.id);
    await say('a', 'public line');

    // Carol reconnects mid-stream and asks for a replay: she must get the public line, not the whisper.
    const carol = await join('c', 'carol', {
      lastSeq: 0,
      epoch: await (t.hub as any).options.replay.epoch(t.campaignId),
    });
    expect(carol.of('chat.message').map((f) => f.d.text)).toEqual(['public line']);
    expect(JSON.stringify(carol.sent)).not.toContain('secret one');
    expect(carol.of('chat.whispers')[0]?.d.whispers).toEqual([]);
  });

  it('come back to their two people after a reconnect, in a snapshot or alongside a replay, and to no one else', async () => {
    await join('a', 'alice');
    await join('b', 'bob');
    await say('a', 'secret one', t.users.bob.id);

    const bobAgain = await join('b2', 'bob'); // no cursor: a snapshot
    expect(bobAgain.of('snapshot')[0]?.d.recentWhispers.map((w: any) => w.text)).toEqual([
      'secret one',
    ]);

    const epoch = await (t.hub as any).options.replay.epoch(t.campaignId);
    const aliceReplay = await join('a2', 'alice', { lastSeq: 0, epoch }); // a replay
    expect(aliceReplay.of('chat.whispers')[0]?.d.whispers.map((w: any) => w.text)).toEqual([
      'secret one',
    ]);

    const carol = await join('c', 'carol');
    expect(carol.of('snapshot')[0]?.d.recentWhispers).toEqual([]);
    const dm = await join('dm', 'dm');
    expect(dm.of('snapshot')[0]?.d.recentWhispers).toEqual([]);
  });

  it('carry a stable id, so a client that receives the same whisper twice keeps one', async () => {
    const bob = await join('b', 'bob');
    await join('a', 'alice');
    await say('a', 'hi', t.users.bob.id);
    const live = bob.of('chat.whisper')[0]?.d;
    const again = await join('b2', 'bob');
    expect(again.of('snapshot')[0]?.d.recentWhispers[0].id).toBe(live.id);
  });

  it('are refused for yourself, a non-member and an unknown id — with the same answer', async () => {
    const alice = await join('a', 'alice');
    await say('a', 'x', t.users.alice.id);
    await say('a', 'x', t.users.outsider.id);
    await say('a', 'x', 'no-such-user');
    const errors = alice.of('error').filter((f) => f.d.code === 'invalid_recipient');
    expect(errors).toHaveLength(3);
    expect(new Set(errors.map((e) => e.d.message)).size).toBe(1);
    expect(alice.of('chat.whisper')).toHaveLength(0);
  });
});

describe('table chat is durable and viewer-filtered', () => {
  it('stores public lines and each whisper, and filters history by who is asking', async () => {
    await join('a', 'alice');
    await join('b', 'bob');
    await say('a', 'public line');
    await say('a', 'for bob only', t.users.bob.id);
    const id = t.campaignId;
    const text = async (who: keyof Table['users']) =>
      (await t.store.listChat(id, t.users[who].id, { limit: 50 })).map((m) => m.text);
    expect(await text('alice')).toEqual(['public line', 'for bob only']);
    expect(await text('bob')).toEqual(['public line', 'for bob only']);
    expect(await text('carol')).toEqual(['public line']);
    expect(await text('dm')).toEqual(['public line']);
  });

  it('pages backwards with `before` and keeps only the newest N when pruned', async () => {
    const id = t.campaignId;
    for (let i = 1; i <= 10; i += 1) {
      await t.store.putChatMessage({
        id: backend.newId(),
        campaignId: id,
        senderId: t.users.alice.id,
        senderName: 'alice',
        recipientId: null,
        text: `m${i}`,
        at: i * 1000,
        kind: 'chat',
      });
    }
    const page = await t.store.listChat(id, t.users.bob.id, { limit: 3, before: 8000 });
    expect(page.map((m) => m.text)).toEqual(['m5', 'm6', 'm7']);
    expect(await t.store.pruneChat(id, 4)).toBe(6);
    expect((await t.store.listChat(id, t.users.bob.id, { limit: 50 })).map((m) => m.text)).toEqual([
      'm7',
      'm8',
      'm9',
      'm10',
    ]);
  });
});
