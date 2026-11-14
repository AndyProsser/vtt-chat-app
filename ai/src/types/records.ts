import type { Segment, SummaryKind } from './index.js';

export type RecordingStatus = 'recording' | 'stopped' | 'processing' | 'processed' | 'failed';

export interface Recording {
  id: string;
  campaignId: string;
  startedAt: number;
  stoppedAt: number | null;
  status: RecordingStatus;
  /** When the DM was warned that this recording's audio will be deleted to free disk space, if ever. */
  audioNoticeAt?: number | null;
}

/** One speaker's audio for one recording, as written by LiveKit Egress. */
export interface RecordingTrack {
  id: string;
  recordingId: string;
  /** The account id of whoever spoke: "who said it" needs no diarisation. */
  speakerId: string;
  speakerName: string;
  filePath: string;
  /** When this track began, relative to the start of the recording. */
  startOffsetMs: number;
  /** Whispers and private-channel audio: never transcribed, never summarised. */
  private: boolean;
  transcribedAt: number | null;
  /** When the raw audio file was deleted (retention or `vtt-admin recording purge`); the text stays. */
  purgedAt?: number | null;
}

export type RecordingEventName =
  | 'started'
  | 'paused'
  | 'resumed'
  | 'stopped'
  | 'interrupted'
  /** The DM played or stopped a sound (metadata only: the audio is never recorded). */
  | 'sound'
  /** A scene started or stopped (`detail.name`, `detail.ambience`). */
  | 'scene'
  /** The DM changed their character voice (`detail.voice`, `detail.by`). */
  | 'voice'
  /** The table's voice groups changed (`detail.groups`: name and member names). */
  | 'group'
  /** The DM took a player aside for a private talk (`detail.phase`: start or end, `detail.player`); the audio is never recorded. */
  | 'aside'
  /** A line typed into the table's public chat (never a whisper): `detail` has senderId, senderName, text. */
  | 'chat';

export interface RecordingEvent {
  recordingId: string;
  at: number;
  event: RecordingEventName;
  /** For `sound`, `scene`, `voice` and `group`: what happened (names are display text, already cleaned). */
  detail?: Record<string, unknown>;
}

export type SummaryVisibility = 'members' | 'dm';

export interface StoredSummary {
  recordingId: string;
  kind: SummaryKind;
  /** The character, for `kind: 'character'`; empty otherwise. */
  subject: string;
  visibility: SummaryVisibility;
  text: string;
  modelCalls: number;
  createdAt: number;
}

export interface SearchHit {
  recordingId: string;
  source: 'transcript' | 'summary' | 'chat';
  /** For a summary hit, which summary. */
  kind?: SummaryKind;
  speakerName?: string;
  /** For a transcript hit: where in the recording the line was said. */
  atMs?: number;
  /** The matching text with the search terms marked `<mark>…</mark>`; already HTML-escaped around the marks. */
  snippet: string;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: string;
  recordingId: string | null;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  lockedUntil: number | null;
  /** The worker (`WORKER_ID`) holding the lease on a running job, when it said who it is. */
  lockedBy?: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type { Segment };
