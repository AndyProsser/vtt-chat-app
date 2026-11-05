/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON frames */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '../../types/index.js';
import { AccountService } from '../auth/accountService.js';
import { CampaignService } from '../campaigns/campaignService.js';
import { MemoryStore } from '../store/memoryStore.js';
import { CloseCode, Hub, type Connection } from './hub.js';
import { PresenceTracker } from './presence.js';
import { parseClientFrame, PROTOCOL_VERSION } from './protocol.js';
import { MemoryAckStore } from '../recording/ackStore.js';
import { RecordingState } from '../recording/recordingState.js';
import { MemoryReplayBuffer } from './replayBuffer.js';
import { replayBufferContract } from './replayContract.js';

// ---------- protocol ----------

const frame = (t: string, d?: unknown, extra: object = {}): string =>
  JSON.stringify({ v: PROTOCOL_VERSION, t, ...(d === undefined ? {} : { d }), ...extra });

describe('parseClientFrame', () => {
  it('accepts a valid frame', () => {
    const result = parseClientFrame(frame('auth', { token: 'abc' }, { id: 'x1' }));
    expect(result).toMatchObject({
      ok: true,
      frame: { type: 'auth', id: 'x1', data: { token: 'abc' } },
    });
  });

  it('rejects bad JSON, bad envelopes, other versions, unknown types and bad data', () => {
    expect(parseClientFrame('{nope')).toMatchObject({ ok: false, code: 'bad_frame' });
    expect(parseClientFrame('[]')).toMatchObject({ ok: false, code: 'bad_frame' });
    expect(parseClientFrame(JSON.stringify({ v: 2, t: 'auth', d: { token: 'x' } }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
    expect(parseClientFrame(frame('nope'))).toMatchObject({ ok: false, code: 'unknown_type' });
    expect(parseClientFrame(frame('auth', { token: 5 }))).toMatchObject({
      ok: false,
      code: 'bad_data',
    });
    expect(parseClientFrame(frame('chat.message', { campaignId: 'c', text: '' }))).toMatchObject({
      ok: false,
      code: 'bad_data',
    });
  });

  it('does not treat inherited property names as frame types', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(parseClientFrame(frame(name))).toMatchObject({ ok: false, code: 'unknown_type' });
    }
  });

  it('rejects out-of-range stats', () => {
    const bad = frame('stats.report', {
      campaignId: 'c',
      rttMs: -1,
      jitterMs: 0,
      packetLossPct: 0,
    });
    expect(parseClientFrame(bad)).toMatchObject({ ok: false, code: 'bad_data' });
    const worse = frame('stats.report', {
      campaignId: 'c',
      rttMs: 1,
      jitterMs: 0,
      packetLossPct: 101,
    });
    expect(parseClientFrame(worse)).toMatchObject({ ok: false, code: 'bad_data' });
  });
});

// ---------- replay buffer ----------

replayBufferContract('in-memory', (options) => new MemoryReplayBuffer(options));

// ---------- presence ----------

describe('PresenceTracker', () => {
  it('reports online/offline transitions only on the first and last connection', () => {
    const p = new PresenceTracker();
    expect(p.connect('c', 'u', 'conn1')).toBe(true);
    expect(p.connect('c', 'u', 'conn2')).toBe(false);
    expect(p.disconnect('c', 'u', 'conn1')).toBe(false);
    expect(p.isOnline('c', 'u')).toBe(true);
    expect(p.disconnect('c', 'u', 'conn2')).toBe(true);
    expect(p.isOnline('c', 'u')).toBe(false);
  });

  it('only tracks speaking and stats for people in voice, and clears them on leaving', () => {
    const p = new PresenceTracker();
    p.connect('c', 'u', 'x');
    expect(p.setSpeaking('c', 'u', true)).toBe(false); // not in voice yet
    p.setAudio('c', 'u', true, false);
    expect(p.setSpeaking('c', 'u', true)).toBe(true);
    expect(p.setSpeaking('c', 'u', true)).toBe(false); // unchanged → no redundant broadcast
    expect(p.setStats('c', 'u', { rttMs: 1, jitterMs: 1, packetLossPct: 0, at: 1 })).toBe(true);
    p.setAudio('c', 'u', false, true);
    expect(p.snapshot('c')[0]).toMatchObject({ inVoice: false, speaking: false, stats: null });
  });

  it('forgets everything about a user once they go offline', () => {
    const p = new PresenceTracker();
    p.connect('c', 'u', 'x');
    p.setAudio('c', 'u', true, false);
    p.setSpeaking('c', 'u', true);
    p.disconnect('c', 'u', 'x');
    p.connect('c', 'u', 'y');
    expect(p.snapshot('c')[0]).toMatchObject({ inVoice: false, speaking: false });
  });
});

// ---------- hub ----------

class FakeConn implements Connection {
  sent: Array<{ t: string; seq?: number; d: any }> = [];
  closed: { code: number; reason: string } | null = null;
  constructor(readonly id: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  of(t: string): Array<{ t: string; seq?: number; d: any }> {
    return this.sent.filter((f) => f.t === t);
  }
  last(t: string) {
    return this.of(t).at(-1);
  }
}

interface Table {
  store: MemoryStore;
  accounts: AccountService;
  campaigns: CampaignService;
  hub: Hub;
  replay: MemoryReplayBuffer;
  dm: User;
  player: User;
  outsider: User;
  campaignId: string;
  token: Record<'dm' | 'player' | 'outsider', string>;
}

let counter = 0;

async function setup(
  hubOptions: { authTimeoutMs?: number; maxBadFrames?: number } = {},
): Promise<Table> {
  const store = new MemoryStore();
  const newId = (): string => `id-${++counter}`;
  const accounts = new AccountService({ store, newId });
  const campaigns = new CampaignService({ store, newId });
  const replay = new MemoryReplayBuffer();
  const hub = new Hub({ store, accounts, replay, ...hubOptions });

  const make = async (name: string): Promise<[User, string]> => {
    const user = await accounts.register({
      email: `${name}@example.com`,
      displayName: name,
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    const { sessionToken } = await accounts.signInWithPassword(user.email, 'correct horse battery');
    return [user, sessionToken];
  };
  const [dm, dmToken] = await make('dm'); // first account = Admin, may create a campaign
  const [player, playerToken] = await make('player');
  const [outsider, outsiderToken] = await make('outsider');

  const campaign = await campaigns.createCampaign(dm, 'Table');
  const { code } = await campaigns.createInvite(dm, campaign.id);
  await campaigns.joinWithInvite(player, code);

  return {
    store,
    accounts,
    campaigns,
    hub,
    replay,
    dm,
    player,
    outsider,
    campaignId: campaign.id,
    token: { dm: dmToken, player: playerToken, outsider: outsiderToken },
  };
}

async function connect(t: Table, id: string, who: 'dm' | 'player' | 'outsider', subscribe = true) {
  const conn = new FakeConn(id);
  t.hub.accept(conn);
  await t.hub.receive(id, frame('auth', { token: t.token[who] }));
  if (subscribe) await t.hub.receive(id, frame('resume', { campaignId: t.campaignId }));
  return conn;
}

describe('Hub: authentication', () => {
  let t: Table;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(() => t.hub.close());

  it('accepts a valid token', async () => {
    const conn = await connect(t, 'c1', 'player', false);
    expect(conn.last('auth.ok')?.d).toEqual({ userId: t.player.id });
    expect(conn.closed).toBeNull();
  });

  it('rejects a bad token and closes', async () => {
    const conn = new FakeConn('c1');
    t.hub.accept(conn);
    await t.hub.receive('c1', frame('auth', { token: 'nope.nope' }));
    expect(conn.of('auth.revoked')).toHaveLength(1);
    expect(conn.closed?.code).toBe(CloseCode.Unauthorized);
  });

  it('closes a connection that sends anything before authenticating', async () => {
    const conn = new FakeConn('c1');
    t.hub.accept(conn);
    await t.hub.receive('c1', frame('resume', { campaignId: t.campaignId }));
    expect(conn.closed?.code).toBe(CloseCode.Unauthorized);
    expect(conn.of('snapshot')).toHaveLength(0);
  });

  it('drops a connection that never authenticates', () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConn('c1');
      t.hub.accept(conn);
      vi.advanceTimersByTime(4_999);
      expect(conn.closed).toBeNull();
      vi.advanceTimersByTime(2);
      expect(conn.closed?.code).toBe(CloseCode.AuthTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a connection that authenticated in time', async () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConn('c1');
      t.hub.accept(conn);
      await t.hub.receive('c1', frame('auth', { token: t.token.player }));
      vi.advanceTimersByTime(60_000);
      expect(conn.closed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a second auth frame, and a bad protocol version closes the socket', async () => {
    const conn = await connect(t, 'c1', 'player', false);
    await t.hub.receive('c1', frame('auth', { token: t.token.player }));
    expect(conn.last('error')?.d.code).toBe('already_authenticated');

    await t.hub.receive('c1', JSON.stringify({ v: 99, t: 'resume' }));
    expect(conn.closed?.code).toBe(CloseCode.BadRequest);
  });

  it('drops a connection that sends too many malformed frames', async () => {
    const strict = await setup({ maxBadFrames: 3 });
    const conn = await connect(strict, 'c1', 'player', false);
    for (let i = 0; i < 5; i += 1) await strict.hub.receive('c1', '{not json');
    expect(conn.closed?.code).toBe(CloseCode.TooManyErrors);
    strict.hub.close();
  });
});

describe('Hub: subscriptions, presence and the snapshot', () => {
  let t: Table;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(() => t.hub.close());

  it('refuses a non-member and sends them nothing about the campaign', async () => {
    const conn = await connect(t, 'o1', 'outsider');
    expect(conn.last('error')?.d.code).toBe('forbidden');
    expect(conn.of('snapshot')).toHaveLength(0);

    // …and a non-member's chat/speaking frames are rejected, not relayed.
    const player = await connect(t, 'p1', 'player');
    await t.hub.receive('o1', frame('chat.message', { campaignId: t.campaignId, text: 'hi' }));
    expect(player.of('chat.message')).toHaveLength(0);
  });

  it('sends a snapshot on first subscribe and announces presence to the others', async () => {
    const dm = await connect(t, 'd1', 'dm');
    const snapshot = dm.last('snapshot')?.d;
    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.members.find((m: any) => m.userId === t.dm.id)).toMatchObject({
      role: 'dm',
      online: true,
    });
    expect(snapshot.members.find((m: any) => m.userId === t.player.id)).toMatchObject({
      online: false,
    });

    await connect(t, 'p1', 'player');
    expect(dm.last('presence.update')?.d).toEqual({
      campaignId: t.campaignId,
      userId: t.player.id,
      online: true,
    });
  });

  it('announces offline only when the last connection closes', async () => {
    const dm = await connect(t, 'd1', 'dm');
    await connect(t, 'p1', 'player');
    await connect(t, 'p2', 'player'); // same user, second device
    dm.sent.length = 0;

    t.hub.closed('p1');
    expect(dm.of('presence.update')).toHaveLength(0);
    t.hub.closed('p2');
    expect(dm.last('presence.update')?.d).toMatchObject({ userId: t.player.id, online: false });
  });

  it('treats an idle (no-voice) client as online with no voice state', async () => {
    await connect(t, 'p1', 'player');
    const dm = await connect(t, 'd1', 'dm');
    const player = dm.last('snapshot')?.d.members.find((m: any) => m.userId === t.player.id);
    expect(player).toMatchObject({ online: true, inVoice: false, speaking: false });
  });

  it('shows the active character, not just the account name', async () => {
    await t.campaigns.addCharacter(t.player, t.campaignId, {
      name: 'Aria',
      className: null,
      race: null,
      level: null,
      avatarUrl: null,
      sourceUrl: null,
    });
    const dm = await connect(t, 'd1', 'dm');
    const member = dm.last('snapshot')?.d.members.find((m: any) => m.userId === t.player.id);
    expect(member.character).toMatchObject({ name: 'Aria' });
  });
});

describe('Hub: live events', () => {
  let t: Table;
  let dm: FakeConn;
  let player: FakeConn;
  beforeEach(async () => {
    t = await setup();
    dm = await connect(t, 'd1', 'dm');
    player = await connect(t, 'p1', 'player');
    dm.sent.length = 0;
    player.sent.length = 0;
  });
  afterEach(() => t.hub.close());

  const voice = (muted = false) =>
    t.hub.receive('p1', frame('audio.state', { campaignId: t.campaignId, inVoice: true, muted }));

  it('relays speaking changes but not repeats, and never buffers them for replay', async () => {
    await voice();
    dm.sent.length = 0;
    const speak = (speaking: boolean) =>
      t.hub.receive('p1', frame('speaking.set', { campaignId: t.campaignId, speaking }));
    await speak(true);
    await speak(true);
    await speak(false);
    expect(dm.of('speaking.update').map((f) => f.d.speaking)).toEqual([true, false]);
    expect(await t.replay.latestSeq(t.campaignId)).toBe(0);
  });

  it('ignores speaking from a client that is not in voice', async () => {
    await t.hub.receive('p1', frame('speaking.set', { campaignId: t.campaignId, speaking: true }));
    expect(dm.of('speaking.update')).toHaveLength(0);
  });

  it('requires "resume" before any campaign frame', async () => {
    const other = await connect(t, 'x1', 'player', false);
    await t.hub.receive('x1', frame('speaking.set', { campaignId: t.campaignId, speaking: true }));
    expect(other.last('error')?.d.code).toBe('not_subscribed');
  });

  it('sends connection stats to the DM only', async () => {
    await voice();
    dm.sent.length = 0;
    player.sent.length = 0;
    await t.hub.receive(
      'p1',
      frame('stats.report', { campaignId: t.campaignId, rttMs: 40, jitterMs: 5, packetLossPct: 1 }),
    );
    expect(dm.last('stats.update')?.d).toMatchObject({
      userId: t.player.id,
      stats: { rttMs: 40, jitterMs: 5, packetLossPct: 1 },
    });
    expect(player.of('stats.update')).toHaveLength(0);
  });

  it('includes stats in a snapshot for the DM but never for a player', async () => {
    await voice();
    await t.hub.receive(
      'p1',
      frame('stats.report', { campaignId: t.campaignId, rttMs: 40, jitterMs: 5, packetLossPct: 1 }),
    );
    const lateDm = await connect(t, 'd2', 'dm');
    const latePlayer = await connect(t, 'p2', 'player');
    const dmView = lateDm.last('snapshot')?.d.members.find((m: any) => m.userId === t.player.id);
    const playerView = latePlayer
      .last('snapshot')
      ?.d.members.find((m: any) => m.userId === t.player.id);
    expect(dmView.stats).toMatchObject({ rttMs: 40 });
    expect('stats' in playerView).toBe(false);
  });

  it('stops being the DM’s stats recipient after a swap', async () => {
    await voice();
    await t.campaigns.swapDm(t.dm, t.campaignId, t.player.id);
    dm.sent.length = 0;
    player.sent.length = 0;
    // The (former) DM goes into voice and reports; the new DM (the old player) should receive it.
    await t.hub.receive(
      'd1',
      frame('audio.state', { campaignId: t.campaignId, inVoice: true, muted: false }),
    );
    await t.hub.receive(
      'd1',
      frame('stats.report', { campaignId: t.campaignId, rttMs: 9, jitterMs: 1, packetLossPct: 0 }),
    );
    expect(player.of('stats.update')).toHaveLength(1);
    expect(dm.of('stats.update')).toHaveLength(0);
  });

  it('relays chat to everyone with a sequence number, using the character name', async () => {
    await t.campaigns.addCharacter(t.player, t.campaignId, {
      name: 'Aria',
      className: null,
      race: null,
      level: null,
      avatarUrl: null,
      sourceUrl: null,
    });
    await t.hub.receive('p1', frame('chat.message', { campaignId: t.campaignId, text: 'Hello!' }));
    for (const conn of [dm, player]) {
      expect(conn.last('chat.message')).toMatchObject({
        seq: 1,
        d: { text: 'Hello!', from: { userId: t.player.id, name: 'Aria' } },
      });
    }
  });

  it('rate-limits chat floods per connection', async () => {
    for (let i = 0; i < 15; i += 1) {
      await t.hub.receive('p1', frame('chat.message', { campaignId: t.campaignId, text: `m${i}` }));
    }
    expect(dm.of('chat.message')).toHaveLength(10);
    expect(player.of('error').some((f) => f.d.code === 'rate_limited')).toBe(true);
  });

  it('keeps one connection’s frames in order even when handled asynchronously', async () => {
    const sends = [1, 2, 3, 4, 5].map((n) =>
      t.hub.receive('p1', frame('chat.message', { campaignId: t.campaignId, text: `m${n}` })),
    );
    await Promise.all(sends);
    expect(dm.of('chat.message').map((f) => f.d.text)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('announces roster changes', () => {
    t.hub.announceRosterChanged(t.campaignId);
    expect(dm.last('roster.changed')?.d).toEqual({ campaignId: t.campaignId });
  });
});

describe('Hub: reconnect, replay and snapshot', () => {
  let t: Table;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(() => t.hub.close());

  async function say(from: 'p1', text: string): Promise<void> {
    await t.hub.receive(from, frame('chat.message', { campaignId: t.campaignId, text }));
  }

  it('replays only what a reconnecting client missed', async () => {
    const dm = await connect(t, 'd1', 'dm');
    const first = await connect(t, 'p1', 'player');
    await say('p1', 'one');
    await say('p1', 'two');
    const lastSeen = first.last('chat.message')?.seq ?? 0;
    const epoch = first.last('snapshot')?.d.epoch as string;
    t.hub.closed('p1'); // the player's network drops
    await say('p1', 'ignored: p1 is gone').catch(() => undefined);
    await t.hub.receive('d1', frame('chat.message', { campaignId: t.campaignId, text: 'three' }));
    await t.hub.receive('d1', frame('chat.message', { campaignId: t.campaignId, text: 'four' }));
    expect(dm.of('chat.message')).toHaveLength(4);

    const back = new FakeConn('p2');
    t.hub.accept(back);
    await t.hub.receive('p2', frame('auth', { token: t.token.player }));
    await t.hub.receive(
      'p2',
      frame('resume', { campaignId: t.campaignId, lastSeq: lastSeen, epoch }),
    );

    expect(back.of('snapshot')).toHaveLength(0);
    expect(back.of('chat.message').map((f) => f.d.text)).toEqual(['three', 'four']);
    expect(back.last('resumed')?.d).toMatchObject({ replayed: 2, seq: 4 });
  });

  it('falls back to a snapshot (with recent chat) when the client is too far behind', async () => {
    const small = await setup();
    // Replace the hub with one using a tiny buffer.
    small.hub.close();
    const replay = new MemoryReplayBuffer({ maxEvents: 2 });
    const hub = new Hub({ store: small.store, accounts: small.accounts, replay });
    const table = { ...small, hub, replay };
    await connect(table, 'p1', 'player');
    for (let i = 1; i <= 5; i += 1) {
      await hub.receive(
        'p1',
        frame('chat.message', { campaignId: small.campaignId, text: `m${i}` }),
      );
    }
    const back = new FakeConn('p9');
    hub.accept(back);
    await hub.receive('p9', frame('auth', { token: small.token.player }));
    await hub.receive(
      'p9',
      frame('resume', {
        campaignId: small.campaignId,
        lastSeq: 1,
        epoch: await replay.epoch(small.campaignId),
      }),
    );
    const snapshot = back.last('snapshot')?.d;
    expect(snapshot).toBeDefined();
    expect(snapshot.seq).toBe(5);
    expect(snapshot.recentChat.map((m: any) => m.text)).toEqual(['m4', 'm5']);
    hub.close();
  });

  it('hands out the stream epoch so a client can prove which stream its sequence number is from', async () => {
    const conn = await connect(t, 'p1', 'player');
    const snapshot = conn.last('snapshot')?.d;
    expect(snapshot.epoch).toBe(await t.replay.epoch(t.campaignId));
  });

  it('does not replay across a server restart: same sequence number, different stream', async () => {
    await connect(t, 'd1', 'dm');
    const first = await connect(t, 'p1', 'player');
    await t.hub.receive('p1', frame('chat.message', { campaignId: t.campaignId, text: 'before' }));
    const lastSeen = first.last('chat.message')?.seq ?? 0;
    const oldEpoch = first.last('snapshot')?.d.epoch as string;
    t.hub.close();

    // "Restart": a brand-new hub and buffer over the same store. Seq 1 now means something else.
    const replay = new MemoryReplayBuffer();
    const hub = new Hub({ store: t.store, accounts: t.accounts, replay });
    const table = { ...t, hub, replay };
    await connect(table, 'd2', 'dm');
    const other = await connect(table, 'p2', 'player');
    await hub.receive('p2', frame('chat.message', { campaignId: t.campaignId, text: 'after' }));
    expect(other.last('chat.message')?.seq).toBe(lastSeen); // same number, different event

    const back = new FakeConn('p3');
    hub.accept(back);
    await hub.receive('p3', frame('auth', { token: t.token.player }));
    await hub.receive(
      'p3',
      frame('resume', { campaignId: t.campaignId, lastSeq: lastSeen, epoch: oldEpoch }),
    );
    expect(back.of('snapshot')).toHaveLength(1);
    expect(back.of('chat.message')).toHaveLength(0);
    hub.close();
  });

  it('sends a snapshot when the client has no sequence number', async () => {
    const conn = await connect(t, 'p1', 'player'); // resume without lastSeq
    expect(conn.of('snapshot')).toHaveLength(1);
  });
});

describe('Hub: revocation', () => {
  let t: Table;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(() => t.hub.close());

  it('drops a live socket when its session is revoked remotely', async () => {
    const dm = await connect(t, 'd1', 'dm');
    const player = await connect(t, 'p1', 'player');
    const session = (await t.accounts.listSessions(t.player.id))[0];
    t.hub.revokeSession(session?.id ?? '');

    expect(player.of('auth.revoked')).toHaveLength(1);
    expect(player.closed?.code).toBe(CloseCode.Unauthorized);
    expect(dm.last('presence.update')?.d).toMatchObject({ userId: t.player.id, online: false });
  });

  it('notices a revoked session on the periodic recheck', async () => {
    const player = await connect(t, 'p1', 'player');
    await t.accounts.revokeAllSessions(t.player.id);
    await t.hub.recheckSessions();
    expect(player.closed?.code).toBe(CloseCode.Unauthorized);
  });

  it('keeps healthy connections open through a recheck', async () => {
    const player = await connect(t, 'p1', 'player');
    await t.hub.recheckSessions();
    expect(player.closed).toBeNull();
  });
});

// ---------- recording status and consent acknowledgement ----------

describe('RecordingState', () => {
  it('walks start → pause → resume → stop and reports the current state', () => {
    const recording = new RecordingState(() => 'rec-1');
    expect(recording.current('c')).toBeNull();
    expect(recording.start('c')).toEqual({
      campaignId: 'c',
      recordingId: 'rec-1',
      event: 'STARTED',
    });
    expect(recording.current('c')).toEqual({ recordingId: 'rec-1', status: 'IN-PROGRESS' });
    expect(recording.isCapturing('c')).toBe(true);

    expect(recording.pause('c').event).toBe('PAUSED');
    expect(recording.current('c')?.status).toBe('PAUSED');
    expect(recording.isCapturing('c')).toBe(false);

    expect(recording.resume('c').event).toBe('RESUMED');
    expect(recording.stop('c').event).toBe('STOPPED');
    expect(recording.current('c')).toBeNull();
  });

  it('rejects impossible transitions with a conflict, and keeps campaigns apart', () => {
    const recording = new RecordingState();
    expect(() => recording.pause('c')).toThrow(/not being recorded/);
    expect(() => recording.stop('c')).toThrow();
    recording.start('c');
    expect(() => recording.start('c')).toThrow(/already/);
    expect(() => recording.resume('c')).toThrow(/not paused/);
    recording.pause('c');
    expect(() => recording.pause('c')).toThrow(/already paused/);
    expect(recording.current('other')).toBeNull();
  });

  it('gives each recording its own id', () => {
    const recording = new RecordingState();
    const first = recording.start('c').recordingId;
    recording.stop('c');
    expect(recording.start('c').recordingId).not.toBe(first);
  });
});

describe('MemoryAckStore', () => {
  it('remembers an ack until it expires', async () => {
    let now = 0;
    const acks = new MemoryAckStore({ ttlMs: 1000, now: () => now });
    await acks.ack('c', 'r', 'u');
    expect(await acks.hasAcked('c', 'r', 'u')).toBe(true);
    expect(await acks.hasAcked('c', 'r', 'someone-else')).toBe(false);
    expect(await acks.hasAcked('c', 'other-recording', 'u')).toBe(false);
    expect(await acks.ackedBy('c', 'r')).toEqual(['u']);
    now = 1001;
    expect(await acks.hasAcked('c', 'r', 'u')).toBe(false);
    expect(await acks.ackedBy('c', 'r')).toEqual([]);
  });
});

describe('Hub: recording consent flow', () => {
  let t: Table;
  let dm: FakeConn;
  let player: FakeConn;
  let now: number;

  beforeEach(async () => {
    now = 1_000_000;
    t = await setup();
    t.hub.close();
    // Rebuild the hub with a controllable clock so ack expiry can be driven.
    const recording = new RecordingState(() => 'rec-1');
    const acks = new MemoryAckStore({ ttlMs: 30 * 60_000, now: () => now });
    t.hub = new Hub({
      store: t.store,
      accounts: t.accounts,
      replay: t.replay,
      recording,
      acks,
      now: () => now,
    });
    dm = await connect(t, 'd1', 'dm');
    player = await connect(t, 'p1', 'player');
    dm.sent.length = 0;
    player.sent.length = 0;
  });
  afterEach(() => t.hub.close());

  const start = () => t.hub.announceRecording(t.hub.recording.start(t.campaignId));
  const ack = (conn: string, recordingId = 'rec-1') =>
    t.hub.receive(conn, frame('recording.ack', { campaignId: t.campaignId, recordingId }));

  it('tells everyone in the campaign about each change', () => {
    start();
    t.hub.announceRecording(t.hub.recording.pause(t.campaignId));
    t.hub.announceRecording(t.hub.recording.resume(t.campaignId));
    t.hub.announceRecording(t.hub.recording.stop(t.campaignId));
    for (const conn of [dm, player]) {
      expect(conn.of('recording.status').map((f) => f.d.status)).toEqual([
        'STARTED',
        'PAUSED',
        'RESUMED',
        'STOPPED',
      ]);
      expect(conn.of('recording.status')[0]?.d.recordingId).toBe('rec-1');
    }
  });

  it('does not tell people outside the campaign', async () => {
    const outsider = await connect(t, 'o1', 'outsider');
    outsider.sent.length = 0;
    start();
    expect(outsider.of('recording.status')).toHaveLength(0);
  });

  it('tells a late joiner the current state, unacknowledged, so they hear the cue before capture', async () => {
    start();
    const late = await connect(t, 'p2', 'player');
    expect(late.last('recording.state')?.d).toEqual({
      campaignId: t.campaignId,
      recording: { recordingId: 'rec-1', status: 'IN-PROGRESS', acknowledged: false },
    });
  });

  it('remembers an ack, so a quick reconnect is told not to replay the cue', async () => {
    start();
    await ack('p1');
    t.hub.closed('p1'); // the network blips
    const back = await connect(t, 'p2', 'player');
    expect(back.last('recording.state')?.d.recording).toMatchObject({ acknowledged: true });
  });

  it('asks for the cue again once the ack has expired', async () => {
    start();
    await ack('p1');
    t.hub.closed('p1');
    now += 31 * 60_000;
    const back = await connect(t, 'p2', 'player');
    expect(back.last('recording.state')?.d.recording).toMatchObject({ acknowledged: false });
  });

  it('keeps acknowledgements per player, not per campaign', async () => {
    start();
    await ack('p1');
    const dmView = await connect(t, 'd2', 'dm');
    expect(dmView.last('recording.state')?.d.recording).toMatchObject({ acknowledged: false });
  });

  it('sends the recording state after a replay too, so a missed change is not missed', async () => {
    // The player is mid-session with a cursor, drops, and a recording starts while they are away.
    // (The beforeEach cleared the player's frames, so ask the buffer for the stream's epoch.)
    const epoch = await t.replay.epoch(t.campaignId);
    t.hub.closed('p1');
    start();
    const back = new FakeConn('p2');
    t.hub.accept(back);
    await t.hub.receive('p2', frame('auth', { token: t.token.player }));
    await t.hub.receive('p2', frame('resume', { campaignId: t.campaignId, lastSeq: 0, epoch }));
    expect(back.of('resumed')).toHaveLength(1); // replay path, not a snapshot
    expect(back.last('recording.state')?.d.recording).toMatchObject({
      recordingId: 'rec-1',
      acknowledged: false,
    });
  });

  it('reports a paused recording as paused, and a stopped one as none', async () => {
    start();
    t.hub.announceRecording(t.hub.recording.pause(t.campaignId));
    const during = await connect(t, 'p2', 'player');
    expect(during.last('recording.state')?.d.recording).toMatchObject({ status: 'PAUSED' });
    t.hub.announceRecording(t.hub.recording.stop(t.campaignId));
    const after = await connect(t, 'p3', 'player');
    expect(after.last('recording.state')?.d.recording).toBeNull();
  });

  it('shows the DM who has heard the cue, and nobody else', async () => {
    start();
    dm.sent.length = 0;
    player.sent.length = 0;
    await ack('p1');
    expect(dm.last('recording.ack.update')?.d).toEqual({
      campaignId: t.campaignId,
      recordingId: 'rec-1',
      userId: t.player.id,
    });
    expect(player.of('recording.ack.update')).toHaveLength(0);
  });

  it('rejects an ack for a recording that is not the current one', async () => {
    start();
    await ack('p1', 'some-old-recording');
    expect(player.last('error')?.d.code).toBe('stale_recording');
    // …and nothing was stored: a reconnect still gets the cue.
    t.hub.closed('p1');
    const back = await connect(t, 'p2', 'player');
    expect(back.last('recording.state')?.d.recording).toMatchObject({ acknowledged: false });
  });

  it('rejects an ack once the recording has stopped', async () => {
    start();
    t.hub.announceRecording(t.hub.recording.stop(t.campaignId));
    await ack('p1');
    expect(player.last('error')?.d.code).toBe('stale_recording');
  });

  it('requires a campaign subscription to ack', async () => {
    start();
    const loose = await connect(t, 'x1', 'player', false);
    await t.hub.receive(
      'x1',
      frame('recording.ack', { campaignId: t.campaignId, recordingId: 'rec-1' }),
    );
    expect(loose.last('error')?.d.code).toBe('not_subscribed');
  });
});
