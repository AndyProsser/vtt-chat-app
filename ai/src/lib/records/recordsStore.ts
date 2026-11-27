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
  JobModels,
} from '../../types/index.js';
import type { LlmUsage } from '../../consts/claude.js';
import type { MemoryEntry } from '../memory.js';
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

  /**
   * A chapter's scribe's notes, cached only so a job that dies partway through a long, many-chapter
   * recording resumes from the chapter it reached instead of chapter one every time (0.6.5 interim
   * reliability fix). Separate from `summaries`: a half-finished chapter must never be visible through
   * the records API, where only the complete, combined notes (`getSummary(id, 'notes', '')`) are.
   */
  getChapterNotesCache(recordingId: string, subject: string): Promise<string | undefined>;
  putChapterNotesCache(recordingId: string, subject: string, text: string): Promise<void>;

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
  /** The campaign's memory (Stage 12 F), every entry. */
  listMemory(campaignId: string): Promise<MemoryEntry[]>;
  /** Removes the entries whose name or an alias is `name` (any case); how many went. For `vtt-admin memory forget`. */
  forgetMemory(campaignId: string, name: string): Promise<number>;
  /** Whether this recording has already taught the memory (so a retry or a reprocess does not count a session twice). */
  memoryApplied(recordingId: string): Promise<boolean>;
  /**
   * Saves new and changed entries and marks the recording as applied, in one step. `false`, and nothing saved, when it
   * was already applied. Saving zero entries still marks it.
   */
  saveMemory(
    campaignId: string,
    recordingId: string,
    entries: readonly MemoryEntry[],
    now: number,
  ): Promise<boolean>;
  /** Adds what a job used of Claude to the job's total (`vtt-admin jobs list` shows it). */
  addJobUsage(jobId: string, usage: LlmUsage): Promise<void>;
  /** Notes which models a job used (`vtt-admin jobs list` and `status` show them); the latest attempt's answer replaces the last. */
  setJobModels(jobId: string, models: JobModels): Promise<void>;
  campaignName(campaignId: string): Promise<string | undefined>;
  /** Account ids of the campaign's players (every member but the DM): who gets a character summary. */
  playerIds(campaignId: string): Promise<string[]>;
  getAiSettings(): Promise<AiSettings>;
  /**
   * Whether any table is recording right now (started, not stopped, and started within the last 12 hours, so a
   * recording left open by a crash cannot hold processing back for ever).
   */
  anyRecordingLive(now: number): Promise<boolean>;
  /**
   * The backend's online-user count, mirrored into Postgres (`instance_runtime`) so the worker can
   * read it without depending on Valkey or the backend process. A disposable, best-effort signal —
   * never presence's own source of truth. A genuine read failure should throw, so the caller (the
   * activity governor) decides the fail-safe direction.
   */
  onlineUserCount(): Promise<number>;
}
