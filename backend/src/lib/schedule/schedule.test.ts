/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { openTestBackend } from '../store/testing.js';
import { MemoryScheduleStore } from './memoryScheduleStore.js';
import { PostgresScheduleStore } from './postgresScheduleStore.js';
import { NotificationRelay } from './relay.js';
import { ScheduleService } from './scheduleService.js';
import type { ScheduleStore } from './scheduleStore.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

const CONFIG: BackendConfig = {
  port: 0,
  liveKitUrl: 'ws://lk.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 's',
  databaseUrl: undefined,
  valkeyUrl: undefined,
  recordingsDir: undefined,
  mediaDir: undefined,
  liveKitApiUrl: 'http://lk.test',
  webDir: undefined,
  clientDownloads: {},
};
const HOUR = 3_600_000;
const MIN = 60_000;

let server: Server;
let base: string;
let schedule: ScheduleStore;
let dm: { id: string; token: string };
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let outsider: { id: string; token: string };
let campaign: string;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}
async function person(name: string) {
  const { body } = await call('POST', '/api/auth/register', undefined, {
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  return { id: body.user.id as string, token: body.sessionToken as string };
}
const inbox = async (p: { token: string }, q = '') =>
  (await call('GET', `/api/notifications${q}`, p.token)).body.notifications as any[];

beforeEach(async () => {
  const store = await backend.reset();
  schedule =
    backend.kind === 'postgres' && backend.pool
      ? new PostgresScheduleStore(backend.pool)
      : new MemoryScheduleStore();
  const app = createApp({ config: CONFIG, store, schedule });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dm = await person('dm');
  alice = await person('alice');
  bob = await person('bob');
  outsider = await person('outsider');
  campaign = (await call('POST', '/api/campaigns', dm.token, { name: 'A' })).body.campaign.id;
  const { code } = (await call('POST', `/api/campaigns/${campaign}/invites`, dm.token, {})).body;
  for (const p of [alice, bob]) await call('POST', '/api/campaigns/join', p.token, { code });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const sessions = (token: string) => call('GET', `/api/campaigns/${campaign}/sessions`, token);
const schedule_ = (token: string, body: object) =>
  call('POST', `/api/campaigns/${campaign}/sessions`, token, body);
const soon = (hours = 48) => Date.now() + hours * HOUR;

describe('scheduling', () => {
  it('the DM schedules; members see it with RSVP counts and are notified', async () => {
    const r = await schedule_(dm.token, {
      startsAt: soon(),
      title: 'Session 12',
      notes: 'Bring dice',
    });
    expect(r.status).toBe(201);
    for (const p of [alice, bob]) {
      const list = (await sessions(p.token)).body.sessions;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        session: { title: 'Session 12' },
        counts: { yes: 0, late: 0, no: 0 },
        mine: null,
      });
      expect((await inbox(p)).map((n) => n.kind)).toEqual(['session.scheduled']);
    }
    expect(await inbox(dm)).toEqual([]); // the DM made it; no need to tell them
  });

  it('keeps how long a session runs: three hours unless told otherwise, changeable, and sane', async () => {
    const plain = (await schedule_(dm.token, { startsAt: soon(), title: 'a' })).body.session;
    expect(plain.durationMinutes).toBe(180);
    const long = await schedule_(dm.token, { startsAt: soon(), title: 'b', durationMinutes: 240 });
    expect(long.body.session.durationMinutes).toBe(240);
    const patched = await call(
      'PATCH',
      `/api/campaigns/${campaign}/sessions/${long.body.session.id}`,
      dm.token,
      { durationMinutes: 90 },
    );
    expect(patched.body.session.durationMinutes).toBe(90);
    for (const bad of [0, 14, 721, 90.5, -60]) {
      expect(
        (await schedule_(dm.token, { startsAt: soon(), title: 'c', durationMinutes: bad })).status,
        String(bad),
      ).toBe(400);
    }
    const listed = (await sessions(alice.token)).body.sessions;
    expect(listed.every((v: any) => typeof v.session.durationMinutes === 'number')).toBe(true);
  });

  it('only the DM schedules, reschedules or cancels; outsiders are shut out', async () => {
    expect((await schedule_(alice.token, { startsAt: soon(), title: 'x' })).status).toBe(403);
    const id = (await schedule_(dm.token, { startsAt: soon(), title: 'x' })).body.session.id;
    expect(
      (
        await call('PATCH', `/api/campaigns/${campaign}/sessions/${id}`, alice.token, {
          title: 'y',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/sessions/${id}`, alice.token)).status,
    ).toBe(403);
    expect((await sessions(outsider.token)).status).toBe(403);
    expect((await call('GET', `/api/campaigns/${campaign}/sessions`)).status).toBe(401);
    expect(
      (
        await call('PATCH', `/api/campaigns/${campaign}/sessions/not-a-uuid`, dm.token, {
          title: 'y',
        })
      ).status,
    ).toBe(404);
  });

  it('rejects a time in the past, one absurdly far away, and a blank title', async () => {
    expect(
      (await schedule_(dm.token, { startsAt: Date.now() - 2 * HOUR, title: 'x' })).status,
    ).toBe(400);
    expect(
      (await schedule_(dm.token, { startsAt: Date.now() + 10 * 365 * 24 * HOUR, title: 'x' }))
        .status,
    ).toBe(400);
    expect((await schedule_(dm.token, { startsAt: soon(), title: '   ' })).status).toBe(400);
  });

  it('rescheduling and cancelling notify the table', async () => {
    const id = (await schedule_(dm.token, { startsAt: soon(), title: 'x' })).body.session.id;
    await call('PATCH', `/api/campaigns/${campaign}/sessions/${id}`, dm.token, {
      startsAt: soon(72),
    });
    await call('DELETE', `/api/campaigns/${campaign}/sessions/${id}`, dm.token);
    expect((await inbox(alice)).map((n) => n.kind)).toEqual([
      'session.scheduled',
      'session.updated',
      'session.cancelled',
    ]);
    expect(
      (
        await call('PUT', `/api/campaigns/${campaign}/sessions/${id}/rsvp`, alice.token, {
          status: 'yes',
        })
      ).status,
    ).toBe(409);
  });
});

describe('RSVP', () => {
  it('members answer yes / late / no, can change their mind, and everyone sees the tally', async () => {
    const id = (await schedule_(dm.token, { startsAt: soon(), title: 'x' })).body.session.id;
    const rsvp = (p: { token: string }, status: string) =>
      call('PUT', `/api/campaigns/${campaign}/sessions/${id}/rsvp`, p.token, { status });
    expect((await rsvp(alice, 'yes')).status).toBe(200);
    expect((await rsvp(bob, 'no')).status).toBe(200);
    expect((await rsvp(bob, 'late')).body).toMatchObject({
      counts: { yes: 1, late: 1, no: 0 },
      mine: 'late',
    });
    const seen = (await sessions(alice.token)).body.sessions[0];
    expect(seen.counts).toEqual({ yes: 1, late: 1, no: 0 });
    expect(seen.mine).toBe('yes');
    expect((await rsvp(alice, 'maybe')).status).toBe(400);
    expect((await rsvp(outsider, 'yes')).status).toBe(403);
  });

  it('tells the DM when a player cannot make it or will be late — and not when they are coming', async () => {
    const id = (await schedule_(dm.token, { startsAt: soon(), title: 'Big night' })).body.session
      .id;
    const rsvp = (p: { token: string }, status: string) =>
      call('PUT', `/api/campaigns/${campaign}/sessions/${id}/rsvp`, p.token, { status });
    await rsvp(alice, 'yes');
    expect(await inbox(dm)).toEqual([]);
    await rsvp(bob, 'no');
    const n = await inbox(dm);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'rsvp.changed', data: { status: 'no', userId: bob.id } });
  });
});

describe('reminders', () => {
  function service(now: number) {
    return new ScheduleService({ store: backend.store, schedule, now: () => now });
  }
  const create = async (startsAt: number) =>
    (await schedule_(dm.token, { startsAt, title: 'Game night' })).body.session.id as string;

  it('sends the 24-hour and 1-hour reminders once each, to everyone who has not declined', async () => {
    const start = Date.now() + 30 * HOUR;
    const id = await create(start);
    await call('PUT', `/api/campaigns/${campaign}/sessions/${id}/rsvp`, bob.token, {
      status: 'no',
    });
    const reminders = async (p: { token: string }) =>
      (await inbox(p)).filter((n) => n.kind === 'session.reminder');

    expect(await service(start - 25 * HOUR).sendDueReminders()).toBe(0); // too early
    expect(await service(start - 24 * HOUR + MIN).sendDueReminders()).toBe(1); // the 24 h one
    expect(await service(start - 24 * HOUR + 2 * MIN).sendDueReminders()).toBe(0); // not twice
    expect(await service(start - 30 * MIN + 0).sendDueReminders()).toBe(0); // the 1 h moment passed >10 min ago: skipped, not sent late
    expect(await service(start - HOUR + 5 * MIN).sendDueReminders()).toBe(1); // the 1 h one

    expect((await reminders(alice)).map((n) => n.title)).toEqual([
      'Game night starts in 24 hours',
      'Game night starts in 1 hour',
    ]);
    expect(await reminders(bob)).toEqual([]); // declined
    expect(await reminders(dm)).toHaveLength(2); // the DM is reminded too
  });

  it('a session created too late for a reminder does not get a stale one', async () => {
    const start = Date.now() + 3 * HOUR;
    await create(start);
    expect(await service(Date.now()).sendDueReminders()).toBe(0); // 24 h moment is long gone
  });

  it('rescheduling makes the reminders apply afresh, and a cancelled session sends none', async () => {
    const start = Date.now() + 30 * HOUR;
    const id = await create(start);
    await service(start - 24 * HOUR + MIN).sendDueReminders();
    const moved = start + 48 * HOUR;
    await call('PATCH', `/api/campaigns/${campaign}/sessions/${id}`, dm.token, { startsAt: moved });
    expect(await service(moved - 24 * HOUR + MIN).sendDueReminders()).toBe(1);
    await call('DELETE', `/api/campaigns/${campaign}/sessions/${id}`, dm.token);
    expect(await service(moved - HOUR + MIN).sendDueReminders()).toBe(0);
  });
});

describe('notifications', () => {
  it('are private to their owner and can be marked read', async () => {
    await schedule_(dm.token, { startsAt: soon(), title: 'x' });
    const [n] = await inbox(alice);
    expect((await call('POST', `/api/notifications/${n.id}/read`, bob.token)).status).toBe(404); // not bob's
    expect((await call('POST', `/api/notifications/${n.id}/read`, alice.token)).status).toBe(204);
    expect(await inbox(alice, '?unread=1')).toEqual([]);
    expect(await inbox(alice)).toHaveLength(1);
    expect((await call('GET', '/api/notifications')).status).toBe(401);
    expect((await call('POST', '/api/notifications/not-a-uuid/read', alice.token)).status).toBe(
      404,
    );
  });

  it('can all be marked read at once', async () => {
    await schedule_(dm.token, { startsAt: soon(), title: 'a' });
    await schedule_(dm.token, { startsAt: soon(), title: 'b' });
    expect((await call('POST', '/api/notifications/read-all', alice.token)).body.marked).toBe(2);
    expect(await inbox(alice, '?unread=1')).toEqual([]);
  });

  it('the relay pushes each one to its owner’s live sockets once, and offline people still find it stored', async () => {
    const sent: { userId: string; type: string; id: string }[] = [];
    const relay = new NotificationRelay({
      schedule,
      sendToUser: (userId, type, d: any) => sent.push({ userId, type, id: d.id }),
    });
    await schedule_(dm.token, { startsAt: soon(), title: 'x' });
    await relay.flush();
    expect(sent.map((s) => s.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(sent.every((s) => s.type === 'notification')).toBe(true);
    await relay.flush();
    expect(sent).toHaveLength(2); // not pushed again
    expect(await inbox(alice)).toHaveLength(1); // and still stored for the next snapshot
  });
});

describe('attendance after the session', () => {
  const past = async (hoursAgo: number, title = 'Old night') => {
    const id = `old-${title}-${hoursAgo}`;
    await schedule.putSession({
      id,
      campaignId: campaign,
      startsAt: Date.now() - hoursAgo * HOUR,
      durationMinutes: 180,
      title,
      notes: '',
      createdBy: dm.id,
      createdAt: Date.now() - 100 * HOUR,
      cancelledAt: null,
    });
    return id;
  };
  const rsvp = (id: string, status = 'late') =>
    call('PUT', `/api/campaigns/${campaign}/sessions/${id}/rsvp`, alice.token, { status });

  it('can still be corrected within four hours of the start', async () => {
    expect((await rsvp(await past(3))).status).toBe(200);
  });

  it('is locked once the session started more than four hours ago', async () => {
    expect((await rsvp(await past(5))).status).toBe(409);
  });

  it('cannot be cancelled once it has started, but a future one can', async () => {
    const started = await past(1, 'Started');
    const del = (id: string) =>
      call('DELETE', `/api/campaigns/${campaign}/sessions/${id}`, dm.token);
    expect((await del(started)).status).toBe(409);
    const future = (await schedule_(dm.token, { startsAt: soon(), title: 'Later' })).body.session
      .id;
    expect((await del(future)).status).toBe(204);
  });

  it('lets the DM rename and move a session after the fact', async () => {
    const id = await past(1, 'Typo');
    const res = await call('PATCH', `/api/campaigns/${campaign}/sessions/${id}`, dm.token, {
      title: 'Fixed',
      notes: 'Recap',
    });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({ title: 'Fixed', notes: 'Recap' });
  });

  it('lists only recent sessions by default, and older ones when asked', async () => {
    await past(50, 'Long ago');
    const recent = await schedule_(dm.token, { startsAt: soon(), title: 'Next' });
    expect(recent.status).toBe(201);
    const titles = (r: any) => r.body.sessions.map((s: any) => s.session.title);
    expect(titles(await sessions(alice.token))).toEqual(['Next']);
    const all = await call('GET', `/api/campaigns/${campaign}/sessions/past`, alice.token);
    expect(titles(all)).toEqual(['Long ago', 'Next']);
  });
});
