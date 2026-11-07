import { normaliseAiSettings, type AiSettings } from '@vtt-chat-app/shared';
import pg from 'pg';

import type {
  Recording,
  RecordingEvent,
  RecordingEventName,
  RecordingStatus,
  RecordingTrack,
  Segment,
  StoredSummary,
  SummaryKind,
  TrackTranscript,
} from '../../types/index.js';
import type { RecordsStore } from './recordsStore.js';

type Row = Record<string, unknown>;

/** BIGINT arrives as a string by default; epoch milliseconds fit a JS number exactly. */
export function createPool(connectionString: string, extra: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    ...extra,
    types: {
      getTypeParser: (oid, format) =>
        oid === 20 ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format),
    },
  });
}

const toRecording = (r: Row): Recording => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  startedAt: r.started_at as number,
  stoppedAt: (r.stopped_at as number | null) ?? null,
  status: r.status as RecordingStatus,
});

const toTrack = (r: Row): RecordingTrack => ({
  id: r.id as string,
  recordingId: r.recording_id as string,
  speakerId: r.speaker_id as string,
  speakerName: r.speaker_name as string,
  filePath: r.file_path as string,
  startOffsetMs: r.start_offset_ms as number,
  private: r.private as boolean,
  transcribedAt: (r.transcribed_at as number | null) ?? null,
});

/** The records tables of `backend/migrations/0003_records.sql`. */
export class PostgresRecordsStore implements RecordsStore {
  constructor(private readonly pool: pg.Pool) {}

  async getRecording(id: string): Promise<Recording | undefined> {
    const { rows } = await this.pool.query<Row>('SELECT * FROM recordings WHERE id = $1', [id]);
    return rows[0] ? toRecording(rows[0]) : undefined;
  }

  async putRecording(r: Recording): Promise<void> {
    await this.pool.query(
      `INSERT INTO recordings (id, campaign_id, started_at, stopped_at, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET campaign_id = $2, started_at = $3, stopped_at = $4, status = $5`,
      [r.id, r.campaignId, r.startedAt, r.stoppedAt, r.status],
    );
  }

  async setRecordingStatus(id: string, status: RecordingStatus): Promise<void> {
    await this.pool.query('UPDATE recordings SET status = $2 WHERE id = $1', [id, status]);
  }

  async addRecordingEvent(e: RecordingEvent): Promise<void> {
    await this.pool.query(
      'INSERT INTO recording_events (recording_id, at, event) VALUES ($1, $2, $3)',
      [e.recordingId, e.at, e.event],
    );
  }

  async listRecordingEvents(recordingId: string): Promise<RecordingEvent[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT at, event FROM recording_events WHERE recording_id = $1 ORDER BY at, id',
      [recordingId],
    );
    return rows.map((r) => ({
      recordingId,
      at: r.at as number,
      event: r.event as RecordingEventName,
    }));
  }

  async listTracks(recordingId: string): Promise<RecordingTrack[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM recording_tracks WHERE recording_id = $1 ORDER BY speaker_id, id',
      [recordingId],
    );
    return rows.map(toTrack);
  }

  async putTrack(t: RecordingTrack): Promise<void> {
    await this.pool.query(
      `INSERT INTO recording_tracks
         (id, recording_id, speaker_id, speaker_name, file_path, start_offset_ms, private, transcribed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET speaker_id = $3, speaker_name = $4, file_path = $5,
         start_offset_ms = $6, private = $7, transcribed_at = $8`,
      [
        t.id,
        t.recordingId,
        t.speakerId,
        t.speakerName,
        t.filePath,
        t.startOffsetMs,
        t.private,
        t.transcribedAt,
      ],
    );
  }

  async saveTrackTranscript(trackId: string, segments: Segment[], now: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM transcript_segments WHERE track_id = $1', [trackId]);
      for (const [seq, s] of segments.entries()) {
        // The trigger rejects this for a private track; the exception rolls the whole thing back.
        await client.query(
          'INSERT INTO transcript_segments (track_id, seq, start_ms, end_ms, text) VALUES ($1, $2, $3, $4, $5)',
          [trackId, seq, s.startMs, s.endMs, s.text],
        );
      }
      const marked = await client.query(
        'UPDATE recording_tracks SET transcribed_at = $2 WHERE id = $1 AND NOT private',
        [trackId, now],
      );
      if (marked.rowCount === 0) throw new Error(`track ${trackId} is private or missing`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listTranscripts(recordingId: string): Promise<TrackTranscript[]> {
    const { rows: tracks } = await this.pool.query<Row>(
      `SELECT * FROM recording_tracks
       WHERE recording_id = $1 AND NOT private AND transcribed_at IS NOT NULL
       ORDER BY speaker_id, id`,
      [recordingId],
    );
    const out: TrackTranscript[] = [];
    for (const track of tracks.map(toTrack)) {
      const { rows } = await this.pool.query<Row>(
        'SELECT start_ms, end_ms, text FROM transcript_segments WHERE track_id = $1 ORDER BY seq',
        [track.id],
      );
      out.push({
        speaker: { id: track.speakerId, name: track.speakerName },
        startOffsetMs: track.startOffsetMs,
        segments: rows.map((r) => ({
          startMs: r.start_ms as number,
          endMs: r.end_ms as number,
          text: r.text as string,
        })),
      });
    }
    return out;
  }

  async listRecordings(limit: number): Promise<Recording[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM recordings ORDER BY started_at DESC, id LIMIT $1',
      [limit],
    );
    return rows.map(toRecording);
  }

  async resetForReprocess(recordingId: string, options: { transcripts: boolean }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM summaries WHERE recording_id = $1', [recordingId]);
      if (options.transcripts) {
        await client.query(
          `DELETE FROM transcript_segments WHERE track_id IN
             (SELECT id FROM recording_tracks WHERE recording_id = $1)`,
          [recordingId],
        );
        await client.query(
          'UPDATE recording_tracks SET transcribed_at = NULL WHERE recording_id = $1',
          [recordingId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSummary(
    recordingId: string,
    kind: string,
    subject: string,
  ): Promise<StoredSummary | undefined> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM summaries WHERE recording_id = $1 AND kind = $2 AND subject = $3',
      [recordingId, kind, subject],
    );
    const r = rows[0];
    return r
      ? {
          recordingId,
          kind: r.kind as SummaryKind,
          subject: r.subject as string,
          visibility: r.visibility as StoredSummary['visibility'],
          text: r.text as string,
          modelCalls: r.model_calls as number,
          createdAt: r.created_at as number,
        }
      : undefined;
  }

  async putSummary(s: StoredSummary): Promise<void> {
    await this.pool.query(
      `INSERT INTO summaries (id, recording_id, kind, subject, visibility, text, model_calls, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (recording_id, kind, subject)
       DO UPDATE SET visibility = $4, text = $5, model_calls = $6, created_at = $7`,
      [s.recordingId, s.kind, s.subject, s.visibility, s.text, s.modelCalls, s.createdAt],
    );
  }

  async campaignName(campaignId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<Row>('SELECT name FROM campaigns WHERE id = $1', [
      campaignId,
    ]);
    return rows[0]?.name as string | undefined;
  }

  async getAiSettings(): Promise<AiSettings> {
    const { rows } = await this.pool.query<Row>('SELECT ai FROM instance_settings WHERE id = 1');
    return normaliseAiSettings(rows[0]?.ai);
  }
}
