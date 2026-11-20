import type { AiSettings, BardId } from '@vtt-chat-app/shared';

import type {
  Recording,
  RecordingEvent,
  RecordingStatus,
  RecordingTrack,
  SearchHit,
  Segment,
  StoredSummary,
  TrackTranscript,
} from '../../types/index.js';
import type { VocabularyTerm } from '../vocabulary.js';

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

  /**
   * Tells the campaign's members that a recording's summary is ready: one stored notification each,
   * delivered live if they are connected and in their next snapshot if not. Safe to call twice.
   */
  notifySummaryReady(recordingId: string, at: number): Promise<void>;

  // --- Reading history (the records API) ---
  /** A campaign's recordings, newest first. */
  listRecordingsForCampaign(campaignId: string): Promise<Recording[]>;
  listSummaries(recordingId: string): Promise<StoredSummary[]>;
  /** Removes a recording and everything derived from it (tracks, transcripts, summaries, jobs). */
  deleteRecording(recordingId: string): Promise<void>;
  /**
   * Full-text search over one campaign's summaries and, with `includeTranscript`, what was said and typed.
   * Private tracks are never searched, and DM-only summaries (the scribe's notes among them) only when
   * `includeDmOnly` is set.
   */
  search(
    campaignId: string,
    query: string,
    options: { includeDmOnly: boolean; includeTranscript: boolean; limit: number },
  ): Promise<SearchHit[]>;

  getSummary(
    recordingId: string,
    kind: string,
    subject: string,
  ): Promise<StoredSummary | undefined>;
  putSummary(summary: StoredSummary): Promise<void>;

  /** Notes that a track's audio file has been deleted. */
  markTrackPurged(trackId: string, at: number): Promise<void>;
  /**
   * Processed recordings that stopped before `stoppedBefore` and still have audio on disk: what the
   * retention sweep may purge. Newest last; at most `limit`.
   */
  listPurgeableRecordings(stoppedBefore: number, limit: number): Promise<Recording[]>;

  /** Notes (once) that the campaign's DM was warned about this recording's audio. */
  markAudioNotice(recordingId: string, at: number): Promise<void>;
  /**
   * Tells the campaign's DM, with one stored notification, that the recording's raw audio will be deleted
   * on `purgeAt` unless they delete it themselves sooner.
   */
  notifyAudioPurgeSoon(recordingId: string, purgeAt: number, at: number): Promise<void>;

  /**
   * The names this campaign uses, for Whisper's prompt and the corrections (Stage 12): the Game Master's approved
   * glossary (with aliases) first, then characters, players, the Game Master's scene names, handout and loot titles.
   */
  campaignVocabulary(campaignId: string): Promise<VocabularyTerm[]>;
  /** The campaign's chosen storyteller (`campaigns.bard`); the Tavern Bard when the campaign is gone. */
  campaignBard(campaignId: string): Promise<BardId>;
  /** The Game Master's notes page, as written (empty when there is none). Only the Chronicler and the Tipsy Minstrel may read it. */
  gmNotes(campaignId: string): Promise<string>;
  campaignName(campaignId: string): Promise<string | undefined>;
  /** Account ids of the campaign's players (every member but the DM): who gets a character summary. */
  playerIds(campaignId: string): Promise<string[]>;
  getAiSettings(): Promise<AiSettings>;
}
