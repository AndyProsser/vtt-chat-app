import type { AiSettings } from '@vtt-chat-app/shared';

import type {
  Recording,
  RecordingEvent,
  RecordingStatus,
  RecordingTrack,
  Segment,
  StoredSummary,
  TrackTranscript,
} from '../../types/index.js';

/**
 * What the records pipeline needs from storage. Postgres is the real one; the in-memory one backs
 * the tests. Kept narrow on purpose: the privacy rule "a private track is never transcribed" is
 * enforced here (`listTranscripts` never returns private tracks) and again by a database trigger.
 */
export interface RecordsStore {
  getRecording(id: string): Promise<Recording | undefined>;
  putRecording(recording: Recording): Promise<void>;
  setRecordingStatus(id: string, status: RecordingStatus): Promise<void>;

  /** Session bookmarks: started / paused / resumed / stopped, in the order they happened. */
  addRecordingEvent(event: RecordingEvent): Promise<void>;
  listRecordingEvents(recordingId: string): Promise<RecordingEvent[]>;

  listTracks(recordingId: string): Promise<RecordingTrack[]>;
  putTrack(track: RecordingTrack): Promise<void>;
  /**
   * Replaces a track's transcript and marks it transcribed, atomically: a crash leaves either the
   * old state or the complete new one, never half a transcript. Throws for a private track.
   */
  saveTrackTranscript(trackId: string, segments: Segment[], now: number): Promise<void>;
  /** Transcripts of every **non-private** track that has been transcribed. */
  listTranscripts(recordingId: string): Promise<TrackTranscript[]>;

  /** Most recent recordings first, for the Admin CLI. */
  listRecordings(limit: number): Promise<Recording[]>;
  /**
   * Clears a recording's results so the next job redoes them: always the summaries, and with
   * `transcripts` the transcripts too (every track becomes untranscribed). Raw audio is untouched.
   */
  resetForReprocess(recordingId: string, options: { transcripts: boolean }): Promise<void>;

  getSummary(
    recordingId: string,
    kind: string,
    subject: string,
  ): Promise<StoredSummary | undefined>;
  putSummary(summary: StoredSummary): Promise<void>;

  campaignName(campaignId: string): Promise<string | undefined>;
  getAiSettings(): Promise<AiSettings>;
}
