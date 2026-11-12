import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import {
  MemoryJobQueue,
  MemoryRecordsStore,
  PostgresRecordsStore,
  PURGE_RECORDING_JOB,
  type RecordsStore,
} from '@vtt-chat-app/ai';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { openTestBackend } from '../store/testing.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

const CONFIG: BackendConfig = {
  port: 0,
  liveKitUrl: 'ws://livekit.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 's',
  databaseUrl: undefined,
  valkeyUrl: undefined,
  recordingsDir: undefined,
  liveKitApiUrl: 'http://livekit.test',
  webDir: undefined,
  clientDownloads: {},
};

let server: Server;
let base: string;
let records: RecordsStore;
let jobs: MemoryJobQueue;

interface Person {
  id: string;
  token: string;
}

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

async function person(name: string): Promise<Person> {
  const { body } = await call('POST', '/api/auth/register', undefined, {
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  return { id: body.user.id, token: body.sessionToken };
}

let dm: Person;
let player: Person;
let outsider: Person;
let campaign: string;
let otherCampaign: string;

beforeEach(async () => {
  const store = await backend.reset();
  records =
    backend.kind === 'postgres' && backend.pool
      ? new PostgresRecordsStore(backend.pool)
      : new MemoryRecordsStore();
  jobs = new MemoryJobQueue();
  const app = createApp({ config: CONFIG, store, records, jobs });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dm = await person('dm'); // the first account is the Admin
  player = await person('player');
  outsider = await person('outsider');
  campaign = (await call('POST', '/api/campaigns', dm.token, { name: 'Strahd' })).body.campaign.id;
  otherCampaign = (await call('POST', '/api/campaigns', dm.token, { name: 'Other' })).body.campaign
    .id;
  const { code } = (await call('POST', `/api/campaigns/${campaign}/invites`, dm.token, {})).body;
  await call('POST', '/api/campaigns/join', player.token, { code });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A processed recording with two speakers, a whisper that must never surface, and both summaries. */
async function seed(campaignId = campaign, startedAt = 1_000) {
  const id = backend.newId();
  await records.putRecording({
    id,
    campaignId,
    startedAt,
    stoppedAt: startedAt + 10,
    status: 'processed',
  });
  await records.addRecordingEvent({ recordingId: id, at: startedAt, event: 'started' });
  await records.addRecordingEvent({ recordingId: id, at: startedAt + 10, event: 'stopped' });
  const track = (speaker: string, name: string, offset: number, isPrivate = false) => ({
    id: backend.newId(),
    recordingId: id,
    speakerId: speaker,
    speakerName: name,
    filePath: `/a/${speaker}.ogg`,
    startOffsetMs: offset,
    private: isPrivate,
    transcribedAt: null,
  });
  const alice = track('a', 'Aria', 0);
  const bob = track('b', 'Bruno', 2_000);
  const whisper = track('c', 'Carol', 0, true);
  for (const t of [alice, bob, whisper]) await records.putTrack(t);
  await records.saveTrackTranscript(
    alice.id,
    [{ startMs: 0, endMs: 1_500, text: 'I open the iron door' }],
    5,
  );
  await records.saveTrackTranscript(
    bob.id,
    [{ startMs: 500, endMs: 2_000, text: 'The dragon wakes' }],
    5,
  );
  const summary = (kind: 'session' | 'dm-only', visibility: 'members' | 'dm', text: string) =>
    records.putSummary({
      recordingId: id,
      kind,
      subject: '',
      visibility,
      text,
      modelCalls: 1,
      createdAt: 9,
    });
  await summary('session', 'members', 'The party opened a door and woke a dragon.');
  await summary('dm-only', 'dm', 'Secret: the dragon is actually the baron in disguise.');
  return id;
}

describe('access control', () => {
  it('needs a sign-in', async () => {
    const id = await seed();
    for (const path of ['', '/search?q=dragon', `/${id}`, `/${id}/transcript`]) {
      expect((await call('GET', `/api/campaigns/${campaign}/recordings${path}`)).status).toBe(401);
    }
  });

  it('is closed to someone who is not in the campaign', async () => {
    const id = await seed();
    for (const path of ['', '/search?q=dragon', `/${id}`, `/${id}/transcript`]) {
      const r = await call('GET', `/api/campaigns/${campaign}/recordings${path}`, outsider.token);
      expect(r.status, path).toBe(403);
    }
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/recordings/${id}`, outsider.token)).status,
    ).toBe(403);
  });

  it('does not reveal a recording through a different campaign’s URL', async () => {
    const id = await seed(otherCampaign);
    const asDmOfBoth = await call('GET', `/api/campaigns/${campaign}/recordings/${id}`, dm.token);
    expect(asDmOfBoth.status).toBe(404);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/recordings/${id}/transcript`, dm.token))
        .status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/recordings/not-a-uuid`, dm.token)).status,
    ).toBe(404);
  });
});

describe('reading history', () => {
  it('lists a campaign’s recordings, newest first, with only the summaries you may read', async () => {
    const older = await seed(campaign, 1_000);
    const newer = await seed(campaign, 5_000);
    await seed(otherCampaign, 9_000);

    const asPlayer = await call('GET', `/api/campaigns/${campaign}/recordings`, player.token);
    expect(asPlayer.body.recordings.map((r: { id: string }) => r.id)).toEqual([newer, older]);
    expect(asPlayer.body.recordings[0].summaries).toEqual(['session']);

    const asDm = await call('GET', `/api/campaigns/${campaign}/recordings`, dm.token);
    expect(asDm.body.recordings[0].summaries.sort()).toEqual(['dm-only', 'session']);
  });

  it('tells the DM, and only the DM, whether the raw audio is still kept', async () => {
    const id = await seed();
    const dmView = () =>
      call('GET', `/api/campaigns/${campaign}/recordings`, dm.token).then(
        (r) => r.body.recordings[0],
      );
    expect((await dmView()).audio).toBe('kept');
    for (const t of await records.listTracks(id)) await records.markTrackPurged(t.id, 7);
    expect((await dmView()).audio).toBe('purged');
    const asPlayer = await call('GET', `/api/campaigns/${campaign}/recordings`, player.token);
    expect(asPlayer.body.recordings[0].audio).toBeUndefined();
  });

  it('DM-only summaries are returned to the DM alone', async () => {
    const id = await seed();
    const asPlayer = (
      await call('GET', `/api/campaigns/${campaign}/recordings/${id}`, player.token)
    ).body;
    expect(asPlayer.summaries.map((s: { kind: string }) => s.kind)).toEqual(['session']);
    expect(JSON.stringify(asPlayer)).not.toContain('baron');

    const asDm = (await call('GET', `/api/campaigns/${campaign}/recordings/${id}`, dm.token)).body;
    expect(asDm.summaries.map((s: { kind: string }) => s.kind).sort()).toEqual([
      'dm-only',
      'session',
    ]);
    expect(asDm.events.map((e: { event: string }) => e.event)).toEqual(['started', 'stopped']);
  });

  it('serves the merged transcript with speakers, and never a private track', async () => {
    const id = await seed();
    const { body } = await call(
      'GET',
      `/api/campaigns/${campaign}/recordings/${id}/transcript`,
      player.token,
    );
    expect(
      body.utterances.map((u: { speaker: { name: string }; text: string }) => [
        u.speaker.name,
        u.text,
      ]),
    ).toEqual([
      ['Aria', 'I open the iron door'],
      ['Bruno', 'The dragon wakes'],
    ]);
    expect(body.utterances[1].startMs).toBe(2_500); // Bruno's track began 2 s in, his line 0.5 s after that
    expect(JSON.stringify(body)).not.toContain('Carol');
  });

  it('puts typed chat on the transcript timeline, marked typed, never a whisper or an ooc line', async () => {
    const id = await seed();
    const chat = (at: number, detail: Record<string, unknown>) =>
      records.addRecordingEvent({ recordingId: id, at: 1_000 + at, event: 'chat', detail });
    await chat(1_000, { senderId: 'a', senderName: 'Aria', text: 'I nock an arrow', kind: 'chat' });
    await chat(1_100, { senderId: 'c', senderName: 'Carol', text: 'psst zircon', to: 'a' });
    await chat(1_200, { senderId: 'a', senderName: 'Aria', text: 'pizza is here', kind: 'ooc' });
    const { body } = await call(
      'GET',
      `/api/campaigns/${campaign}/recordings/${id}/transcript`,
      player.token,
    );
    expect(
      body.utterances.map((u: { speaker: { name: string }; text: string; typed?: boolean }) => [
        u.speaker.name,
        u.text,
        u.typed ?? false,
      ]),
    ).toEqual([
      ['Aria', 'I open the iron door', false],
      ['Aria', 'I nock an arrow', true],
      ['Bruno', 'The dragon wakes', false],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/zircon|pizza/);
  });
});

describe('search', () => {
  const search = (token: string, q: string, c = campaign) =>
    call('GET', `/api/campaigns/${c}/recordings/search?q=${encodeURIComponent(q)}`, token);

  it('finds a spoken line with who said it and when', async () => {
    const id = await seed();
    const { status, body } = await search(player.token, 'dragon');
    expect(status).toBe(200);
    const hit = body.hits.find(
      (h: { source: string; speakerName?: string }) => h.source === 'transcript',
    );
    expect(hit).toMatchObject({ recordingId: id, speakerName: 'Bruno', atMs: 2_500 });
    expect(hit.snippet.toLowerCase()).toContain('dragon');
  });

  it('finds a typed chat line, marked as chat with who typed it and when, and never a whisper', async () => {
    const id = await seed();
    await records.addRecordingEvent({
      recordingId: id,
      at: 1_000 + 4_000,
      event: 'chat',
      detail: { senderId: 'a', senderName: 'Aria', text: 'anyone smell brimstone?' },
    });
    await records.addRecordingEvent({
      recordingId: id,
      at: 1_000 + 5_000,
      event: 'chat',
      detail: { senderId: 'c', senderName: 'Carol', text: 'brimstone is a lie', to: 'a' },
    });
    // An out-of-character line is dropped before it reaches the timeline; search refuses one anyway.
    await records.addRecordingEvent({
      recordingId: id,
      at: 1_000 + 6_000,
      event: 'chat',
      detail: { senderId: 'a', senderName: 'Aria', text: 'brimstone pizza ooc', kind: 'ooc' },
    });
    const { body } = await search(player.token, 'brimstone');
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      recordingId: id,
      source: 'chat',
      speakerName: 'Aria',
      atMs: 4_000,
    });
    expect(JSON.stringify(body)).not.toContain('Carol');
  });

  it('finds summaries too', async () => {
    await seed();
    const { body } = await search(player.token, 'party door');
    expect(
      body.hits.some(
        (h: { source: string; kind?: string }) => h.source === 'summary' && h.kind === 'session',
      ),
    ).toBe(true);
  });

  it('searches DM-only summaries for the DM and never for a player', async () => {
    await seed();
    const asDm = await search(dm.token, 'baron');
    expect(asDm.body.hits.some((h: { kind?: string }) => h.kind === 'dm-only')).toBe(true);
    const asPlayer = await search(player.token, 'baron');
    expect(asPlayer.body.hits).toEqual([]);
  });

  it('never finds what was said on a private track', async () => {
    const id = await seed();
    const tracks = await records.listTracks(id);
    const whisper = tracks.find((t) => t.private);
    // Even if text were somehow attached to it, the search must not surface it.
    if (backend.kind === 'memory') {
      (records as MemoryRecordsStore).segments.set(whisper!.id, [
        { startMs: 0, endMs: 1, text: 'secret plan about the dragon' },
      ]);
    }
    const { body } = await search(dm.token, 'secret plan');
    expect(body.hits).toEqual([]);
  });

  it('stays inside the campaign', async () => {
    await seed(otherCampaign);
    expect((await search(player.token, 'dragon')).body.hits).toEqual([]);
  });

  it('rejects an empty or one-letter query, and treats query syntax as plain text', async () => {
    await seed();
    expect((await search(player.token, 'a')).status).toBe(400);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/recordings/search`, player.token)).status,
    ).toBe(400);
    const odd = await search(player.token, "dragon' OR 1=1 --; & | !");
    expect(odd.status).toBe(200);
  });
});

describe('deleting', () => {
  it('lets the DM delete a processed recording and everything under it', async () => {
    const id = await seed();
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/recordings/${id}`, dm.token)).status,
    ).toBe(204);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/recordings/${id}`, dm.token)).status,
    ).toBe(404);
    expect((await search_(dm.token, 'dragon')).body.hits).toEqual([]);
  });

  it('is the DM’s alone', async () => {
    const id = await seed();
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/recordings/${id}`, player.token)).status,
    ).toBe(403);
    expect(
      (await call('GET', `/api/campaigns/${campaign}/recordings/${id}`, player.token)).status,
    ).toBe(200);
  });

  describe('confirming that the audio can go', () => {
    const confirm = (id: string, token: string, c = campaign) =>
      call('POST', `/api/campaigns/${c}/recordings/${id}/audio/delete`, token);

    it('lets the DM have the raw audio deleted once the recording is processed, and queues the purge', async () => {
      const id = await seed();
      const res = await confirm(id, dm.token);
      expect(res.status).toBe(202);
      const queued = await jobs.list();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ kind: PURGE_RECORDING_JOB, recordingId: id });
    });

    it('is the DM’s alone, and only inside its own campaign', async () => {
      const id = await seed();
      expect((await confirm(id, player.token)).status).toBe(403);
      expect((await confirm(id, outsider.token)).status).toBe(403);
      expect((await confirm(id, dm.token, otherCampaign)).status).toBe(404);
      expect(await jobs.list()).toHaveLength(0);
    });

    it('refuses a recording that is not processed yet, because its audio is still the input', async () => {
      const id = await seed();
      await records.setRecordingStatus(id, 'processing');
      expect((await confirm(id, dm.token)).status).toBe(409);
      expect(await jobs.list()).toHaveLength(0);
    });

    it('refuses when the audio is already gone', async () => {
      const id = await seed();
      for (const t of await records.listTracks(id)) await records.markTrackPurged(t.id, 7);
      expect((await confirm(id, dm.token)).status).toBe(409);
    });

    it('tells the DM, and not the players, when the audio is due to be deleted anyway', async () => {
      const id = await seed();
      await records.markAudioNotice(id, 5_000);
      const view = async (token: string) =>
        (await call('GET', `/api/campaigns/${campaign}/recordings`, token)).body.recordings[0];
      expect((await view(dm.token)).audioDeletedOn).toBe(5_000 + 3 * 86_400_000);
      expect((await view(player.token)).audioDeletedOn).toBeUndefined();
    });
  });

  it('refuses while a recording is still running or being processed', async () => {
    const id = await seed();
    await records.setRecordingStatus(id, 'processing');
    expect(
      (await call('DELETE', `/api/campaigns/${campaign}/recordings/${id}`, dm.token)).status,
    ).toBe(409);
  });
});

const search_ = (token: string, q: string) =>
  call('GET', `/api/campaigns/${campaign}/recordings/search?q=${encodeURIComponent(q)}`, token);
