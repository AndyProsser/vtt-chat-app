/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { CampaignService } from '../campaigns/campaignService.js';
import { MemoryScheduleStore } from '../schedule/memoryScheduleStore.js';
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
let schedule: MemoryScheduleStore;
let campaignId: string;
let users: Record<'dm' | 'alice' | 'bob', User>;
let tokens: Record<string, string>;

beforeEach(async () => {
  const store = new MemoryStore();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  schedule = new MemoryScheduleStore();
  hub = new Hub({ store, accounts, replay: new MemoryReplayBuffer(), schedule });
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
});
afterEach(() => hub.close());

async function join(id: string, who: keyof typeof users): Promise<Conn> {
  const conn = new Conn(id);
  hub.accept(conn);
  await hub.receive(id, frame('auth', { token: tokens[who] }));
  await hub.receive(id, frame('resume', { campaignId }));
  return conn;
}
const note = (userId: string, title: string, readAt: number | null = null) =>
  schedule.addNotification({
    id: `n-${title}`,
    userId,
    campaignId,
    kind: 'x',
    title,
    body: '',
    data: {},
    createdAt: Date.now(),
    readAt,
    pushedAt: null,
  });

describe('notifications in the hub', () => {
  it('a snapshot carries the viewer’s own unread notifications — missed while the app was closed — and nobody else’s', async () => {
    await note(users.alice.id, 'for alice');
    await note(users.alice.id, 'already read', 1);
    await note(users.bob.id, 'for bob');
    const alice = await join('a', 'alice');
    expect(alice.of('snapshot')[0]?.d.notifications.map((n: any) => n.title)).toEqual([
      'for alice',
    ]);
    const dm = await join('dm', 'dm');
    expect(dm.of('snapshot')[0]?.d.notifications).toEqual([]);
  });

  it('sendToUser reaches every device of that person and no one else', async () => {
    const phone = await join('a2', 'alice');
    const laptop = await join('a', 'alice');
    const bob = await join('b', 'bob');
    hub.sendToUser(users.alice.id, 'notification', { id: 'n1', title: 'hi' });
    expect(phone.of('notification')).toHaveLength(1);
    expect(laptop.of('notification')).toHaveLength(1);
    expect(bob.of('notification')).toHaveLength(0);
  });
});
