import { randomUUID } from 'node:crypto';

import { DomainError } from '../errors.js';

/** The status events every client hears (RECORDING-AND-SUMMARIES.md). */
export type RecordingEvent = 'STARTED' | 'PAUSED' | 'RESUMED' | 'STOPPED';

/** What a client joining mid-recording is told: the *current* state, not the transitions it missed. */
export type RecordingCurrent = 'IN-PROGRESS' | 'PAUSED';

export interface RecordingChange {
  campaignId: string;
  recordingId: string;
  event: RecordingEvent;
  /** Epoch ms (server clock) when the recording started; the same for every change of one recording. */
  startedAt: number;
}

interface Active {
  id: string;
  paused: boolean;
  startedAt: number;
}

/**
 * Whether a campaign is recording, and its id. **The server owns this** (CLAUDE.md §10): a flag
 * plus an id, not a lifecycle the clients have to keep in step. Clients are told each change as it
 * happens and the current state when they join.
 *
 * In memory for now; the durable record (start/stop/pause timestamps as session bookmarks) and the
 * link to LiveKit Egress arrive with the records pipeline (ROADMAP Stage 5).
 */
export class RecordingState {
  private readonly active = new Map<string, Active>();

  constructor(
    private readonly newId: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  start(campaignId: string): RecordingChange {
    if (this.active.has(campaignId)) {
      throw new DomainError('conflict', 'this campaign is already being recorded');
    }
    const recordingId = this.newId();
    const startedAt = this.now();
    this.active.set(campaignId, { id: recordingId, paused: false, startedAt });
    return { campaignId, recordingId, event: 'STARTED', startedAt };
  }

  pause(campaignId: string): RecordingChange {
    const recording = this.require(campaignId);
    if (recording.paused) throw new DomainError('conflict', 'the recording is already paused');
    recording.paused = true;
    return {
      campaignId,
      recordingId: recording.id,
      event: 'PAUSED',
      startedAt: recording.startedAt,
    };
  }

  resume(campaignId: string): RecordingChange {
    const recording = this.require(campaignId);
    if (!recording.paused) throw new DomainError('conflict', 'the recording is not paused');
    recording.paused = false;
    return {
      campaignId,
      recordingId: recording.id,
      event: 'RESUMED',
      startedAt: recording.startedAt,
    };
  }

  stop(campaignId: string): RecordingChange {
    const recording = this.require(campaignId);
    this.active.delete(campaignId);
    return {
      campaignId,
      recordingId: recording.id,
      event: 'STOPPED',
      startedAt: recording.startedAt,
    };
  }

  /** The current recording, or `null` if the campaign isn't being recorded. */
  current(
    campaignId: string,
  ): { recordingId: string; status: RecordingCurrent; startedAt: number } | null {
    const recording = this.active.get(campaignId);
    if (!recording) return null;
    return {
      recordingId: recording.id,
      status: recording.paused ? 'PAUSED' : 'IN-PROGRESS',
      startedAt: recording.startedAt,
    };
  }

  /** How many campaigns are being recorded right now (paused counts: the recording is open). */
  activeCount(): number {
    return this.active.size;
  }

  /** True only while audio is actually being captured (started or resumed, not paused). */
  isCapturing(campaignId: string): boolean {
    const recording = this.active.get(campaignId);
    return recording !== undefined && !recording.paused;
  }

  private require(campaignId: string): Active {
    const recording = this.active.get(campaignId);
    if (!recording) throw new DomainError('conflict', 'this campaign is not being recorded');
    return recording;
  }
}
