import { randomUUID } from 'node:crypto';

import { PROCESS_RECORDING_JOB, type JobQueue, type RecordsStore } from '@vtt-chat-app/ai';
import type { ChatKind } from '@vtt-chat-app/shared';

import type { AckStore } from './ackStore.js';
import type { RecordingChange } from './recordingState.js';

export interface RecorderTrack {
  /** The LiveKit identity: the account id of whoever is speaking. */
  identity: string;
  trackSid: string;
  /** The DM's sound-effects track: kept as a private file, never transcribed. */
  effects?: boolean;
}

/** An egress LiveKit still has on record for a room, found again after a restart. */
export interface OrphanEgress {
  egressId: string;
  recordingId: string;
  identity: string;
  effects: boolean;
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
  /** Every track egress LiveKit has on record for `room`, so a restart can find what it left running. */
  orphans?(room: string): Promise<OrphanEgress[]>;
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
  effects: boolean;
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

  /**
   * Call with every table frame the realtime layer sends. Sound effects and scenes are noted in the
   * recording's timeline (so a transcript can say "…a door creaked here") — only while audio is being
   * captured, and only as metadata: the effects themselves are never part of the recording.
   */
  onTableEvent(campaignId: string, type: string, data: unknown): void {
    const detail = soundDetail(type, data);
    if (!detail) return;
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live?.capturing) return;
      await this.deps.records.addRecordingEvent({
        recordingId: live.recordingId,
        at: this.now(),
        event: detail.event,
        detail: detail.detail,
      });
    });
  }

  /**
   * A line typed into the public chat. While a recording is open (capturing or paused) it goes into the
   * recording's timeline, so the transcript can show it among the spoken lines. Whispers never get here, and
   * out-of-character (`ooc`) lines are dropped here: this is the one filter that keeps them out of the
   * transcript, summaries and search (CHAT-COMMANDS.md).
   */
  onChat(
    campaignId: string,
    line: {
      senderId: string;
      senderName: string;
      text: string;
      at: number;
      kind?: ChatKind;
    },
  ): void {
    if (line.kind === 'ooc') return;
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live) return;
      await this.deps.records.addRecordingEvent({
        recordingId: live.recordingId,
        at: line.at,
        event: 'chat',
        // The kind travels with the line so the worker can refuse an `ooc` one too (defence in depth).
        detail: {
          senderId: line.senderId,
          senderName: line.senderName,
          text: line.text,
          ...(line.kind ? { kind: line.kind } : {}),
        },
      });
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
   * A recording the database says is running, but this process knows nothing about, was cut off by a
   * restart. Two things must not happen: the egresses it started must not keep recording invisibly (the
   * app would show "not recording" while the server still captured every voice), and the audio already
   * captured must not be lost. So each one's egresses are stopped, their files kept as tracks, the
   * recording is closed as stopped and processing is queued. Only when LiveKit cannot be asked is the
   * recording marked failed, loudly, as before.
   */
  async recoverInterrupted(): Promise<number> {
    let n = 0;
    for (const r of await this.deps.records.listRecordings(1000)) {
      if (r.status !== 'recording' || this.live.has(r.campaignId)) continue;
      n += 1;
      await this.recoverOne(r.id, r.campaignId, r.startedAt);
    }
    return n;
  }

  private async recoverOne(recordingId: string, campaignId: string, startedAt: number) {
    const { records } = this.deps;
    this.log(`recording ${recordingId} was interrupted by a restart`);
    let found: OrphanEgress[];
    try {
      found = (await this.deps.recorder.orphans?.(campaignId)) ?? [];
    } catch (error) {
      this.log(
        `could not recover recording ${recordingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await records.setRecordingStatus(recordingId, 'failed');
      await records.addRecordingEvent({ recordingId, at: this.now(), event: 'interrupted' });
      return;
    }
    const mine = found.filter((o) => o.recordingId === recordingId);
    if (mine.length === 0) {
      await records.setRecordingStatus(recordingId, 'failed');
      await records.addRecordingEvent({ recordingId, at: this.now(), event: 'interrupted' });
      return;
    }
    const live: Live = {
      recordingId,
      startedAt,
      capturing: false,
      segments: new Map(mine.map((o) => [o.egressId, o])),
    };
    await records.addRecordingEvent({ recordingId, at: this.now(), event: 'interrupted' });
    await this.finishSegments(campaignId, live, true);
    await records.addRecordingEvent({ recordingId, at: this.now(), event: 'stopped' });
    await records.putRecording({
      id: recordingId,
      campaignId,
      startedAt,
      stoppedAt: this.now(),
      status: 'stopped',
    });
    await this.deps.jobs.enqueue({ kind: PROCESS_RECORDING_JOB, recordingId }, this.now());
    this.log(`recording ${recordingId}: recovered ${mine.length} egress(es); processing queued`);
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
      const filepath = `${this.deps.dir.replace(/\/+$/, '')}/${live.recordingId}/${track.identity}${track.effects ? '-effects' : ''}@{time}`;
      const egressId = await this.deps.recorder.start(campaignId, track.trackSid, filepath);
      live.segments.set(track.trackSid, {
        egressId,
        identity: track.identity,
        effects: track.effects === true,
      });
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
        speakerName: segment.effects
          ? 'Sound effects'
          : await this.deps.speakerName(campaignId, segment.identity),
        filePath: result.file,
        startOffsetMs: Math.max(0, (result.startedAtMs ?? live.startedAt) - live.startedAt),
        // Effects are kept for listening only: private tracks are never transcribed or shown.
        private: segment.effects,
        transcribedAt: null,
      });
    }
  }
}

/** The timeline entry for a soundboard frame, or `undefined` for any other frame. */
function soundDetail(
  type: string,
  data: unknown,
): { event: 'sound' | 'scene'; detail: Record<string, unknown> } | undefined {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  switch (type) {
    case 'sound.play':
      return {
        event: 'sound',
        detail: {
          action: 'play',
          soundId: d.soundId,
          takeId: d.takeId,
          mode: d.mode,
          volume: d.volume,
          ...(typeof d.layerId === 'string' ? { layerId: d.layerId } : {}),
        },
      };
    case 'scene.started':
      return { event: 'scene', detail: { action: 'start', sceneId: d.sceneId, name: d.name } };
    case 'scene.stopped':
      return { event: 'scene', detail: { action: 'stop', sceneId: d.sceneId } };
    default:
      return undefined;
  }
}
