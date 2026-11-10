import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { RecordingTrack } from '../../types/index.js';
import { openTestDb, TEST_DATABASE_URL, type TestDb } from '../testing.js';
import { PostgresRecordsStore } from './postgresRecordsStore.js';

/** Real-database behaviour: the privacy trigger, atomic transcripts, and read isolation. */
describe.skipIf(TEST_DATABASE_URL === undefined)('PostgresRecordsStore', () => {
  let db: TestDb;
  let store: PostgresRecordsStore;
  let recordingId: string;

  const track = (extra: Partial<RecordingTrack> = {}): RecordingTrack => ({
    id: randomUUID(),
    recordingId,
    speakerId: 'alice',
    speakerName: 'Aria',
    filePath: '/a.ogg',
    startOffsetMs: 0,
    private: false,
    transcribedAt: null,
    ...extra,
  });

  // top-level await is not available inside describe; open lazily
  beforeEach(async () => {
    db ??= await openTestDb();
    await db.reset();
    store = new PostgresRecordsStore(db.pool);
    recordingId = randomUUID();
    await store.putRecording({
      id: recordingId,
      campaignId: await db.campaign('Strahd'),
      startedAt: 1,
      stoppedAt: 2,
      status: 'stopped',
    });
  });
  afterAll(async () => {
    await db?.close();
  });

  it('round-trips a transcript with its offsets and marks the track transcribed', async () => {
    const t = track({ startOffsetMs: 2500 });
    await store.putTrack(t);
    await store.saveTrackTranscript(
      t.id,
      [
        { startMs: 0, endMs: 1500, text: 'I open the door.' },
        { startMs: 2000, endMs: 3000, text: 'It creaks.' },
      ],
      9000,
    );
    const [transcript] = await store.listTranscripts(recordingId);
    expect(transcript?.startOffsetMs).toBe(2500);
    expect(transcript?.segments.map((s) => s.text)).toEqual(['I open the door.', 'It creaks.']);
    expect((await store.listTracks(recordingId))[0]?.transcribedAt).toBe(9000);
  });

  it('keeps the timeline in order, with the detail of sound and scene events', async () => {
    await store.addRecordingEvent({ recordingId, at: 10, event: 'started' });
    await store.addRecordingEvent({
      recordingId,
      at: 20,
      event: 'sound',
      detail: { action: 'play', soundId: 's1', mode: 'oneshot' },
    });
    await store.addRecordingEvent({
      recordingId,
      at: 30,
      event: 'scene',
      detail: { action: 'start', name: 'Crypt' },
    });
    expect(await store.listRecordingEvents(recordingId)).toEqual([
      { recordingId, at: 10, event: 'started' },
      {
        recordingId,
        at: 20,
        event: 'sound',
        detail: { action: 'play', soundId: 's1', mode: 'oneshot' },
      },
      { recordingId, at: 30, event: 'scene', detail: { action: 'start', name: 'Crypt' } },
    ]);
  });

  it('replaces an earlier transcript rather than appending to it', async () => {
    const t = track();
    await store.putTrack(t);
    await store.saveTrackTranscript(t.id, [{ startMs: 0, endMs: 1, text: 'old' }], 1);
    await store.saveTrackTranscript(t.id, [{ startMs: 0, endMs: 1, text: 'new' }], 2);
    expect((await store.listTranscripts(recordingId))[0]?.segments).toEqual([
      { startMs: 0, endMs: 1, text: 'new' },
    ]);
  });

  it('refuses to store a transcript for a private track, and leaves nothing behind', async () => {
    const whisper = track({ private: true });
    await store.putTrack(whisper);
    await expect(
      store.saveTrackTranscript(whisper.id, [{ startMs: 0, endMs: 1, text: 'secret' }], 1),
    ).rejects.toThrow(/private/);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM transcript_segments');
    expect(rows[0].n).toBe(0);
  });

  it('the database itself rejects a segment for a private track, even bypassing the store', async () => {
    const whisper = track({ private: true });
    await store.putTrack(whisper);
    await expect(
      db.pool.query(
        "INSERT INTO transcript_segments (track_id, seq, start_ms, end_ms, text) VALUES ($1, 0, 0, 1, 'x')",
        [whisper.id],
      ),
    ).rejects.toThrow(/private/);
  });

  it('never lists a private track, even if it was flagged private after being transcribed', async () => {
    const t = track();
    await store.putTrack(t);
    await store.saveTrackTranscript(t.id, [{ startMs: 0, endMs: 1, text: 'hello' }], 1);
    await store.putTrack({ ...t, private: true, transcribedAt: 1 });
    expect(await store.listTranscripts(recordingId)).toEqual([]);
  });

  it('is atomic: a failure part-way through leaves the previous transcript intact', async () => {
    const t = track();
    await store.putTrack(t);
    await store.saveTrackTranscript(t.id, [{ startMs: 0, endMs: 1, text: 'keep me' }], 1);
    await expect(
      // a non-numeric time makes the second insert fail after the delete and the first insert
      store.saveTrackTranscript(
        t.id,
        [
          { startMs: 0, endMs: 1, text: 'fine' },
          { startMs: Number.NaN, endMs: 1, text: 'bad' },
        ],
        2,
      ),
    ).rejects.toThrow();
    expect((await store.listTranscripts(recordingId))[0]?.segments[0]?.text).toBe('keep me');
  });

  it('upserts summaries per (recording, kind, subject) and enforces that dm-only means dm', async () => {
    const base = { recordingId, subject: '', modelCalls: 1, createdAt: 1 };
    await store.putSummary({ ...base, kind: 'session', visibility: 'members', text: 'one' });
    await store.putSummary({ ...base, kind: 'session', visibility: 'members', text: 'two' });
    expect((await store.getSummary(recordingId, 'session', ''))?.text).toBe('two');
    await expect(
      store.putSummary({ ...base, kind: 'dm-only', visibility: 'members', text: 'leak' }),
    ).rejects.toThrow();
  });

  it('reads campaign name and AI settings (with defaults for a fresh database)', async () => {
    expect((await store.getAiSettings()).fallback.afterSeconds).toBe(600);
    const rec = await store.getRecording(recordingId);
    expect(await store.campaignName(rec?.campaignId ?? '')).toBe('Strahd');
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)('notifySummaryReady on Postgres', () => {
  it('stores one unread notification per member of the campaign, and none for other campaigns', async () => {
    const d = await openTestDb();
    try {
      const store = new PostgresRecordsStore(d.pool);
      const campaign = await d.campaign('Strahd');
      const elsewhere = await d.campaign('Other');
      const user = async (name: string, campaignId: string) => {
        const id = randomUUID();
        await d.pool.query(
          `INSERT INTO users (id, email, display_name, consent_version, consent_at, created_at) VALUES ($1, $2, $3, '1', 1, 1)`,
          [id, `${name}@x.test`, name],
        );
        await d.pool.query(
          `INSERT INTO memberships (campaign_id, user_id, role, joined_at) VALUES ($1, $2, 'player', 1)`,
          [campaignId, id],
        );
        return id;
      };
      const alice = await user('alice', campaign);
      const bob = await user('bob', campaign);
      const carol = await user('carol', elsewhere);
      const recordingId = randomUUID();
      await store.putRecording({
        id: recordingId,
        campaignId: campaign,
        startedAt: 1,
        stoppedAt: 2,
        status: 'processed',
      });
      await store.notifySummaryReady(recordingId, 99);
      const { rows } = await d.pool.query(
        `SELECT user_id, kind, read_at, pushed_at, data->>'recordingId' AS rec FROM notifications ORDER BY user_id`,
      );
      expect(rows.map((r) => r.user_id).sort()).toEqual([alice, bob].sort());
      expect(
        rows.every(
          (r) =>
            r.kind === 'summary.ready' &&
            r.read_at === null &&
            r.pushed_at === null &&
            r.rec === recordingId,
        ),
      ).toBe(true);
      expect(rows.some((r) => r.user_id === carol)).toBe(false);
    } finally {
      await d.close();
    }
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)('audio purge warnings on Postgres', () => {
  it('warns the campaign’s DM and nobody else, once, with the date the audio goes', async () => {
    const d = await openTestDb();
    try {
      const store = new PostgresRecordsStore(d.pool);
      const campaign = await d.campaign('Strahd');
      const user = async (name: string, role: 'dm' | 'player') => {
        const id = randomUUID();
        await d.pool.query(
          `INSERT INTO users (id, email, display_name, consent_version, consent_at, created_at) VALUES ($1, $2, $3, '1', 1, 1)`,
          [id, `${name}@x.test`, name],
        );
        await d.pool.query(
          `INSERT INTO memberships (campaign_id, user_id, role, joined_at) VALUES ($1, $2, $3, 1)`,
          [campaign, id, role],
        );
        return id;
      };
      const dm = await user('dana', 'dm');
      await user('alice', 'player');
      const recordingId = randomUUID();
      await store.putRecording({
        id: recordingId,
        campaignId: campaign,
        startedAt: 1,
        stoppedAt: 2,
        status: 'processed',
      });

      await store.markAudioNotice(recordingId, 500);
      await store.markAudioNotice(recordingId, 900); // the first warning stands
      expect((await store.getRecording(recordingId))?.audioNoticeAt).toBe(500);

      await store.notifyAudioPurgeSoon(recordingId, 12345, 500);
      const { rows } = await d.pool.query(
        `SELECT user_id, kind, (data->>'purgeAt')::bigint AS purge_at FROM notifications`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: dm, kind: 'audio.purge' });
      expect(Number(rows[0].purge_at)).toBe(12345);
    } finally {
      await d.close();
    }
  });
});
