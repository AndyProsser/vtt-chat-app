import { randomUUID } from 'node:crypto';

import { PROCESS_RECORDING_JOB, type JobQueue, type RecordsStore } from '@vtt-chat-app/ai';

import type { AckStore } from './ackStore.js';
import type { RecordingChange } from './recordingState.js';

export interface RecorderTrack {
  /** The LiveKit identity: the account id of whoever is speaking. */
  identity: string;
  trackSid: string;
}

export interface EgressResult {
  state: 'active' | 'complete' | 'failed';
  /** Where Egress wrote the file (a path on the Egress host, shared with the worker). */
  file?: string;
  startedAtMs?: number;
  error?: string;
}

/** What the capture logic needs from LiveKit. The real one is `liveKitRecorder.ts`; tests use a fake. */
export interface TrackRecorder {
  listAudioTracks(room: string): Promise<RecorderTrack[]>;
  /** Starts recording one track to `filepath` and returns the egress id. */
  start(room: string, trackSid: string, filepath: string): Promise<string>;
  stop(egressId: string): Promise<void>;
  result(egressId: string): Promise<EgressResult>;
}

export interface CaptureDeps {
  recorder: TrackRecorder;
  records: RecordsStore;
  jobs: JobQueue;
  acks: AckStore;
  /** Directory the Egress service writes into (shared with the worker). */
  dir: string;
  /** The name a transcript shows for this account in this campaign. */
  speakerName: (campaignId: string, accountId: string) => Promise<string>;
  now?: () => number;
  newId?: () => string;
  log?: (line: string) => void;
  /** How long to wait for an egress to finish writing after it is stopped. */
  finalizeTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Segment {
  egressId: string;
  identity: string;
}

interface Live {
  recordingId: string;
  startedAt: number;
  capturing: boolean;
  /** Tracks being written right now, by track sid. */
  segments: Map<string, Segment>;
}

/**
 * Turns the server's recording flag into audio on disk and a job to process it.
 *
 * - **Who is recorded:** a player's track is recorded only after that player has acknowledged the
 *   start cue (CLAUDE.md §8.4), so a late joiner is never captured before hearing it. The
 *   reconciler runs on start, on every acknowledgement, and on a timer (late-published and
 *   re-published tracks need no webhooks).
 * - **Pause = stop, resume = start** (decided): pausing ends every file; resuming starts new ones.
 *   A speaker therefore has several tracks per recording; each carries its own start offset.
 * - **Stop** finalises every file into a `recording_tracks` row and queues one `process-recording` job.
 *
 * Nothing here ever throws into the realtime layer: a LiveKit/Egress outage is logged and retried by
 * the next tick, and the recording flag clients see is unaffected.
 */
export class RecordingCapture {
  private readonly live = new Map<string, Live>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly log: (line: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: CaptureDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
    this.log = deps.log ?? (() => undefined);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Call from the realtime layer on every recording change. */
  onRecordingChange(change: RecordingChange): void {
    const { campaignId, recordingId } = change;
    this.enqueue(campaignId, async () => {
      switch (change.event) {
        case 'STARTED':
          return this.started(campaignId, recordingId);
        case 'PAUSED':
          return this.paused(campaignId);
        case 'RESUMED':
          return this.resumed(campaignId);
        case 'STOPPED':
          return this.stopped(campaignId);
      }
    });
  }

  /** Call when a player has acknowledged the start cue: their track may now be recorded. */
  onAck(campaignId: string): void {
    this.enqueue(campaignId, () => this.reconcile(campaignId));
  }

  /** Re-checks every live recording on a timer. */
  startTicking(intervalMs = 5000): void {
    this.timer ??= setInterval(() => {
      for (const campaignId of this.live.keys()) this.onAck(campaignId);
    }, intervalMs);
    this.timer.unref();
  }

  /** Stops the timer and waits for work in flight. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.chains.values());
  }

  /** Resolves when everything queued so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.all(this.chains.values());
  }

  /**
   * A recording the database says is running, but this process knows nothing about, was cut off by
   * a restart. Its files may exist but were never registered, so mark it rather than leave it
   * "recording" forever.
   */
  async recoverInterrupted(): Promise<number> {
    let n = 0;
    for (const r of await this.deps.records.listRecordings(1000)) {
      if (r.status !== 'recording' || this.live.has(r.campaignId)) continue;
      await this.deps.records.setRecordingStatus(r.id, 'failed');
      await this.deps.records.addRecordingEvent({
        recordingId: r.id,
        at: this.now(),
        event: 'interrupted',
      });
      this.log(`recording ${r.id} was interrupted by a restart`);
      n += 1;
    }
    return n;
  }

  // ---- internals ----

  /** Work for one campaign runs strictly in order; errors are logged, never thrown. */
  private enqueue(campaignId: string, work: () => Promise<void>): void {
    const previous = this.chains.get(campaignId) ?? Promise.resolve();
    const next = previous.then(work).catch((error: unknown) => {
      this.log(
        `capture error (${campaignId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    this.chains.set(campaignId, next);
    void next.then(() => {
      if (this.chains.get(campaignId) === next) this.chains.delete(campaignId);
    });
  }

  private async event(
    recordingId: string,
    event: 'started' | 'paused' | 'resumed' | 'stopped',
  ): Promise<void> {
    await this.deps.records.addRecordingEvent({ recordingId, at: this.now(), event });
  }

  private async started(campaignId: string, recordingId: string): Promise<void> {
    const startedAt = this.now();
    await this.deps.records.putRecording({
      id: recordingId,
      campaignId,
      startedAt,
      stoppedAt: null,
      status: 'recording',
    });
    await this.event(recordingId, 'started');
    this.live.set(campaignId, { recordingId, startedAt, capturing: true, segments: new Map() });
    await this.reconcile(campaignId);
  }

  private async paused(campaignId: string): Promise<void> {
    const live = this.live.get(campaignId);
    if (!live) return;
    live.capturing = false;
    await this.event(live.recordingId, 'paused');
    await this.finishSegments(campaignId, live, true);
  }

  private async resumed(campaignId: string): Promise<void> {
    const live = this.live.get(campaignId);
    if (!live) return;
    live.capturing = true;
    await this.event(live.recordingId, 'resumed');
    await this.reconcile(campaignId);
  }

  private async stopped(campaignId: string): Promise<void> {
    const live = this.live.get(campaignId);
    if (!live) return;
    live.capturing = false;
    this.live.delete(campaignId);
    await this.finishSegments(campaignId, live, true);
    await this.event(live.recordingId, 'stopped');
    await this.deps.records.putRecording({
      id: live.recordingId,
      campaignId,
      startedAt: live.startedAt,
      stoppedAt: this.now(),
      status: 'stopped',
    });
    await this.deps.jobs.enqueue(
      { kind: PROCESS_RECORDING_JOB, recordingId: live.recordingId },
      this.now(),
    );
    this.log(`recording ${live.recordingId} stopped; processing queued`);
  }

  /** Starts a file for every acknowledged speaker who is publishing and isn't being recorded yet. */
  private async reconcile(campaignId: string): Promise<void> {
    const live = this.live.get(campaignId);
    if (!live) return;
    // Files that ended by themselves (the speaker left): register them and forget the segment.
    await this.finishSegments(campaignId, live, false);
    if (!live.capturing) return;

    const tracks = await this.deps.recorder.listAudioTracks(campaignId);
    for (const track of tracks) {
      if (live.segments.has(track.trackSid)) continue;
      // The consent rule: not captured until this player has heard the start cue.
      if (!(await this.deps.acks.hasAcked(campaignId, live.recordingId, track.identity))) continue;
      const filepath = `${this.deps.dir.replace(/\/+$/, '')}/${live.recordingId}/${track.identity}@{time}`;
      const egressId = await this.deps.recorder.start(campaignId, track.trackSid, filepath);
      live.segments.set(track.trackSid, { egressId, identity: track.identity });
      this.log(`recording ${live.recordingId}: capturing ${track.identity}`);
    }
  }

  /**
   * Turns finished egresses into `recording_tracks` rows. With `stopAll`, first asks every active
   * egress to stop and waits for its file; otherwise only collects the ones that already ended.
   */
  private async finishSegments(campaignId: string, live: Live, stopAll: boolean): Promise<void> {
    const timeout = this.deps.finalizeTimeoutMs ?? 5 * 60_000;
    const poll = this.deps.pollMs ?? 500;
    for (const [sid, segment] of [...live.segments]) {
      if (stopAll) await this.deps.recorder.stop(segment.egressId).catch(() => undefined);
      const deadline = this.now() + timeout;
      let result = await this.deps.recorder.result(segment.egressId);
      while (stopAll && result.state === 'active' && this.now() < deadline) {
        await this.sleep(poll);
        result = await this.deps.recorder.result(segment.egressId);
      }
      if (result.state === 'active') continue; // still running; collect it on a later tick
      live.segments.delete(sid);
      if (result.state === 'failed' || !result.file) {
        this.log(
          `recording ${live.recordingId}: egress for ${segment.identity} failed: ${result.error ?? 'no file'}`,
        );
        continue;
      }
      await this.deps.records.putTrack({
        id: this.newId(),
        recordingId: live.recordingId,
        speakerId: segment.identity,
        speakerName: await this.deps.speakerName(campaignId, segment.identity),
        filePath: result.file,
        startOffsetMs: Math.max(0, (result.startedAtMs ?? live.startedAt) - live.startedAt),
        private: false,
        transcribedAt: null,
      });
    }
  }
}
