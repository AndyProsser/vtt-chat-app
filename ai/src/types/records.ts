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

export type RecordingEventName = 'started' | 'paused' | 'resumed' | 'stopped' | 'interrupted';

export interface RecordingEvent {
  recordingId: string;
  at: number;
  event: RecordingEventName;
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
