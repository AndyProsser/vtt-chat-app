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

let hub: Hub;
let store: Awaited<ReturnType<typeof backend.reset>>;
let campaignId: string;
let users: Record<'dm' | 'alice' | 'bob', User>;
let tokens: Record<string, string>;
let publicChat: { text: string; kind: string }[];

beforeEach(async () => {
  publicChat = [];
  store = await backend.reset();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  hub = new Hub({
    store,
    accounts,
    replay: new MemoryReplayBuffer(),
    onPublicChat: (_c, line) => publicChat.push(line),
  });
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
  const campaign = await campaigns.createCampaign(users.dm, 'Table');
  campaignId = campaign.id;
  const { code } = await campaigns.createInvite(users.dm, campaign.id);
  for (const name of ['alice', 'bob'] as const) await campaigns.joinWithInvite(users[name], code);
});
afterEach(() => hub.close());

async function join(id: string, who: keyof typeof users, resume: object = {}): Promise<Conn> {
  const conn = new Conn(id);
  hub.accept(conn);
  await hub.receive(id, frame('auth', { token: tokens[who] }));
  await hub.receive(id, frame('resume', { campaignId, ...resume }));
  return conn;
}
const chat = (id: string, extra: object) =>
  hub.receive(id, frame('chat.message', { campaignId, text: 'hello', ...extra }));

describe('chat kind and language', () => {
  it('round-trips kind and lang through the broadcast, the store and the REST listing shape', async () => {
    const a = await join('a', 'alice');
    const b = await join('b', 'bob');
    await chat('a', { kind: 'say', lang: 'elvish', text: 'Mae govannen' });
    await chat('a', { kind: 'do', text: 'bows' });
    await chat('a', { kind: 'ooc', text: 'brb' });
    for (const conn of [a, b]) {
      expect(conn.of('chat.message').map((f) => f.d)).toMatchObject([
        { kind: 'say', lang: 'elvish', text: 'Mae govannen' },
        { kind: 'do', text: 'bows' },
        { kind: 'ooc', text: 'brb' },
      ]);
    }
    expect('lang' in b.of('chat.message')[1]!.d).toBe(false);
    const listed = await store.listChat(campaignId, users.bob.id, { limit: 10 });
    expect(listed.map((m) => [m.kind, m.lang])).toEqual([
      ['say', 'elvish'],
      ['do', undefined],
      ['ooc', undefined],
    ]);
  });

  it('carries kind and lang in the snapshot (recent chat) and in a resume replay', async () => {
    const early = await join('early', 'bob');
    const epoch = early.of('snapshot')[0]?.d.epoch as string;
    await join('a', 'alice');
    await chat('a', { kind: 'say', lang: 'dwarvish', text: 'Drinks on me' });
    await chat('a', { kind: 'ooc', text: 'brb' });

    const fresh = await join('fresh', 'dm');
    expect(fresh.of('snapshot')[0]?.d.recentChat).toMatchObject([
      { kind: 'say', lang: 'dwarvish' },
      { kind: 'ooc' },
    ]);

    const back = await join('back', 'bob', { lastSeq: 0, epoch });
    expect(back.of('chat.message').map((f) => f.d)).toMatchObject([
      { kind: 'say', lang: 'dwarvish' },
      { kind: 'ooc' },
    ]);
  });

  it('treats a missing kind as chat (an old client)', async () => {
    const b = await join('b', 'bob');
    await join('a', 'alice');
    await chat('a', {});
    expect(b.of('chat.message')[0]?.d.kind).toBe('chat');
    expect((await store.listChat(campaignId, users.bob.id, { limit: 5 }))[0]?.kind).toBe('chat');
    expect(publicChat[0]?.kind).toBe('chat');
  });

  it('refuses an unknown kind, an unknown language, and a language on a non-say line', async () => {
    const a = await join('a', 'alice');
    await chat('a', { kind: 'shout' });
    await chat('a', { kind: 'say', lang: 'klingon' });
    await chat('a', { kind: 'say', lang: 'dwarven' }); // an alias is not a wire key
    await chat('a', { kind: 'ooc', lang: 'elvish' });
    await chat('a', { lang: 'elvish' });
    expect(a.of('error').map((f) => f.d.code)).toEqual([
      'invalid_kind',
      'invalid_lang',
      'invalid_lang',
      'invalid_lang',
      'invalid_lang',
    ]);
    expect(a.of('chat.message')).toHaveLength(0);
    expect(await store.listChat(campaignId, users.alice.id, { limit: 5 })).toHaveLength(0);
    expect(publicChat).toHaveLength(0);
  });

  it('hands the recording hook the kind, so ooc can be dropped there', async () => {
    await join('a', 'alice');
    await chat('a', { kind: 'ooc', text: 'running late' });
    await chat('a', { kind: 'say', lang: 'common', text: 'hello' });
    expect(publicChat).toEqual([
      expect.objectContaining({ kind: 'ooc', text: 'running late' }),
      expect.objectContaining({ kind: 'say', text: 'hello' }),
    ]);
  });

  it('leaves whispers alone: kind and lang are ignored, the line stays chat and private', async () => {
    const a = await join('a', 'alice');
    const b = await join('b', 'bob');
    const dm = await join('dm', 'dm');
    await chat('a', { to: users.bob.id, kind: 'ooc', lang: 'nonsense', text: 'psst' });
    expect(a.of('error')).toHaveLength(0);
    expect(b.of('chat.whisper')[0]?.d).toMatchObject({ text: 'psst' });
    expect('kind' in b.of('chat.whisper')[0]!.d).toBe(false);
    expect(dm.of('chat.whisper')).toHaveLength(0);
    expect(publicChat).toHaveLength(0);
    const stored = await store.listChat(campaignId, users.bob.id, { limit: 5 });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'chat', recipientId: users.bob.id });
    expect(stored[0]?.lang).toBeUndefined();
  });
});
