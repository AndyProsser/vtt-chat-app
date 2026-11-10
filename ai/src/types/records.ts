import type { Segment, SummaryKind } from './index.js';

export type RecordingStatus = 'recording' | 'stopped' | 'processing' | 'processed' | 'failed';

export interface Recording {
  id: string;
  campaignId: string;
  startedAt: number;
  stoppedAt: number | null;
  status: RecordingStatus;
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
}

export type RecordingEventName =
  | 'started'
  | 'paused'
  | 'resumed'
  | 'stopped'
  | 'interrupted'
  /** The DM played a sound effect (metadata only: the audio is never recorded). */
  | 'sound'
  /** A scene started or stopped. */
  | 'scene'
  /** A line typed into the table's public chat (never a whisper): `detail` has senderId, senderName, text. */
  | 'chat';

export interface RecordingEvent {
  recordingId: string;
  at: number;
  event: RecordingEventName;
  /** For `sound` and `scene`: what was played (ids, mode, scene name). */
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
  source: 'transcript' | 'summary';
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
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type { Segment };
