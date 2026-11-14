import { randomUUID } from 'node:crypto';

import {
  PROCESS_RECORDING_JOB,
  PURGE_RECORDING_JOB,
  type JobQueue,
  type RecordsStore,
} from '@vtt-chat-app/ai';
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
  /**
   * Whether `audio-purge-next-session` is on (read at each recording start, so the CLI takes effect
   * at once). Absent means off.
   */
  purgeOnNextSession?: () => Promise<boolean>;
  /**
   * Which table cues are noted in the timeline (the operator's `RECORD_CUES`): `scene` changes, the DM's character
   * `voice`, party `groups` and individual `sounds` (by name; never their audio). Absent means scene changes only.
   */
  cues?: ReadonlySet<'scene' | 'voice' | 'groups' | 'sounds'>;
  /** The display name and category of one of the DM's sounds, for the timeline (ids mean nothing to a summary). */
  describeSound?: (soundId: string) => Promise<{ name: string; category: string } | undefined>;
  /** The names of the sounds in a scene's layers (the ambience), noted when the scene starts. */
  describeScene?: (sceneId: string) => Promise<string[]>;
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
  /** Loops running that were noted by name, so their stop can be named. */
  loops: Map<string, string>;
  /** The last voice groups noted (a fingerprint), so an unchanged `party.state` is not noted twice. */
  groups: string;
  /** The DM's character voice as last noted. */
  voice: string;
}

const UNSHOWABLE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Display text for the timeline: no control or invisible characters, one line, bounded. */
export function cleanCueText(value: unknown, max = 80): string {
  if (typeof value !== 'string') return '';
  return value.replace(UNSHOWABLE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
  /** Per table, the people in a private aside right now (the DM and one player): never captured while it lasts. */
  private readonly asides = new Map<string, Set<string>>();
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

  /** Whether this kind of cue is noted (scene changes only, unless the operator chose more). */
  private cueOn(kind: 'scene' | 'voice' | 'groups' | 'sounds'): boolean {
    return (this.deps.cues ?? new Set(['scene'])).has(kind);
  }

  /**
   * Call with every table frame the realtime layer sends (`only` is the audience of a frame meant for some
   * people, not everyone). The soundboard's frames are noted in the recording's timeline, so a transcript and
   * its summaries can say "…in the Drowned Crypt, a door creaked": scene changes by default; individual effects
   * and loops only when the operator listed `sounds` in `RECORD_CUES`. Only while audio is being captured (not
   * while paused), only as metadata (the effects' audio is never part of the recording), and **never a sound
   * played to chosen people only**: that is private.
   */
  onTableEvent(campaignId: string, type: string, data: unknown, only?: ReadonlySet<string>): void {
    if (only) return;
    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    if (type !== 'sound.play' && type !== 'sound.stop' && !type.startsWith('scene.')) return;
    if (type.startsWith('sound.') && !this.cueOn('sounds')) return;
    if (type.startsWith('scene.') && !this.cueOn('scene')) return;
    const at = this.now(); // when it happened, not when the queue got to it
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live?.capturing) return;
      const note = (event: 'sound' | 'scene', detail: Record<string, unknown>) =>
        this.deps.records.addRecordingEvent({
          recordingId: live.recordingId,
          at,
          event,
          detail,
        });
      switch (type) {
        case 'scene.started': {
          const name = cleanCueText(d.name);
          if (!name) return;
          const ambience =
            typeof d.sceneId === 'string' && this.deps.describeScene
              ? await this.deps.describeScene(d.sceneId).catch(() => [])
              : [];
          const sounds = [...new Set(ambience.map((n) => cleanCueText(n)).filter(Boolean))].slice(
            0,
            8,
          );
          await note('scene', {
            action: 'start',
            sceneId: d.sceneId,
            name,
            ...(sounds.length > 0 ? { ambience: sounds } : {}),
          });
          return;
        }
        case 'scene.stopped':
          await note('scene', { action: 'stop', sceneId: d.sceneId });
          return;
        case 'sound.play': {
          const sound =
            typeof d.soundId === 'string' ? await this.deps.describeSound?.(d.soundId) : undefined;
          const name = cleanCueText(sound?.name);
          if (!name) return;
          const mode = d.mode === 'loop' ? 'loop' : 'oneshot';
          if (mode === 'loop' && typeof d.playId === 'string') live.loops.set(d.playId, name);
          await note('sound', {
            action: 'play',
            name,
            category: cleanCueText(sound?.category, 20),
            mode,
            ...(typeof d.layerId === 'string' ? { layerId: d.layerId } : {}),
          });
          return;
        }
        case 'sound.stop': {
          const playId = typeof d.playId === 'string' ? d.playId : undefined;
          const name = playId ? live.loops.get(playId) : undefined;
          if (playId) live.loops.delete(playId);
          else live.loops.clear();
          await note('sound', { action: 'stop', ...(name ? { name } : {}) });
          return;
        }
      }
    });
  }

  /**
   * Call after every change to the voice groups (`party.state`). A split or merge is a story moment, so it
   * is noted (who is in which group, by name) while capturing; an unchanged table is not noted again.
   */
  onPartyState(
    campaignId: string,
    state: {
      parties: { id: string; name: string }[];
      assignments: Record<string, string>;
      aside?: { dmId: string; playerId: string } | null;
    },
  ): void {
    this.noteAside(campaignId, state.aside ?? null);
    if (!this.cueOn('groups')) return;
    const at = this.now();
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live?.capturing) return;
      const groups: { id: string; name: string; members: string[] }[] = [];
      for (const party of state.parties) {
        const ids = Object.entries(state.assignments)
          .filter(([, partyId]) => partyId === party.id)
          .map(([userId]) => userId)
          .sort();
        if (ids.length === 0) continue; // an empty group is not a split
        const members = await Promise.all(
          ids.map(async (id) => cleanCueText(await this.deps.speakerName(campaignId, id), 60)),
        );
        groups.push({ id: party.id, name: cleanCueText(party.name, 60), members: members.sort() });
      }
      const fingerprint = JSON.stringify(groups);
      if (fingerprint === live.groups || (live.groups === '' && groups.length === 0)) return;
      live.groups = fingerprint;
      await this.deps.records.addRecordingEvent({
        recordingId: live.recordingId,
        at,
        event: 'group',
        detail: { groups: groups.map(({ name, members }) => ({ name, members })) },
      });
    });
  }

  /**
   * A private aside started or ended. While it runs the DM's and the player's files are stopped and not restarted: what
   * they say to each other is never recorded, and is not in a transcript or summary. The timeline notes it by name only.
   * The set is updated at once (the reconciler must not restart those tracks), the file work is queued.
   */
  private noteAside(campaignId: string, aside: { dmId: string; playerId: string } | null): void {
    const before = this.asides.get(campaignId);
    const after = aside ? new Set([aside.dmId, aside.playerId]) : undefined;
    const same =
      (!before && !after) ||
      (before && after && before.size === after.size && [...after].every((id) => before.has(id)));
    if (same) return;
    if (after) this.asides.set(campaignId, after);
    else this.asides.delete(campaignId);
    const at = this.now();
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live) return;
      if (aside) {
        await this.finishSegments(campaignId, live, true, new Set([aside.dmId, aside.playerId]));
        await this.deps.records.addRecordingEvent({
          recordingId: live.recordingId,
          at,
          event: 'aside',
          detail: {
            phase: 'start',
            player: cleanCueText(await this.deps.speakerName(campaignId, aside.playerId), 60),
          },
        });
      } else {
        await this.deps.records.addRecordingEvent({
          recordingId: live.recordingId,
          at,
          event: 'aside',
          detail: { phase: 'end' },
        });
        await this.reconcile(campaignId);
      }
    });
  }

  /**
   * The DM chose a character voice (`normal` ends it). Noted while capturing, by the DM's name; the same
   * voice twice in a row is noted once. The server learns of it from the DM's app (the voice runs in Rust).
   */
  onVoiceEffect(campaignId: string, accountId: string, voice: string): void {
    if (!this.cueOn('voice')) return;
    const clean = cleanCueText(voice, 24).toLowerCase();
    if (!clean) return;
    const at = this.now();
    this.enqueue(campaignId, async () => {
      const live = this.live.get(campaignId);
      if (!live?.capturing || live.voice === clean) return;
      live.voice = clean;
      await this.deps.records.addRecordingEvent({
        recordingId: live.recordingId,
        at,
        event: 'voice',
        detail: {
          voice: clean,
          by: cleanCueText(await this.deps.speakerName(campaignId, accountId), 60),
        },
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
      loops: new Map(),
      groups: '',
      voice: 'normal',
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
    this.live.set(campaignId, {
      recordingId,
      startedAt,
      capturing: true,
      segments: new Map(),
      loops: new Map(),
      groups: '',
      voice: 'normal',
    });
    await this.purgeEarlierAudio(campaignId, recordingId);
    await this.reconcile(campaignId);
  }

  /**
   * The optional "purge at the next session start" rule (RECORDING-AND-SUMMARIES.md): queues the ordinary
   * `purge-recording` job for this campaign's earlier recordings that are fully processed and still hold
   * audio. Never another campaign's, never one still queued/processing/failed, never the new one. A failure
   * here is logged and must not stop the new recording.
   */
  private async purgeEarlierAudio(campaignId: string, currentId: string): Promise<void> {
    try {
      if (!(await this.deps.purgeOnNextSession?.())) return;
      const { records, jobs } = this.deps;
      for (const r of await records.listRecordingsForCampaign(campaignId)) {
        if (r.id === currentId || r.campaignId !== campaignId || r.status !== 'processed') continue;
        const tracks = await records.listTracks(r.id);
        if (!tracks.some((t) => (t.purgedAt ?? null) === null)) continue;
        await jobs.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: r.id }, this.now());
        this.log(`new session started: queued a purge of the raw audio of recording ${r.id}`);
      }
    } catch (error) {
      this.log(`audio purge at session start failed: ${String(error)}`);
    }
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
    const aside = this.asides.get(campaignId);
    for (const track of tracks) {
      if (live.segments.has(track.trackSid)) continue;
      if (aside?.has(track.identity)) continue; // a private aside: not recorded
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
   * egress to stop and waits for its file; otherwise only collects the ones that already ended. `only` limits it to those speakers.
   */
  private async finishSegments(
    campaignId: string,
    live: Live,
    stopAll: boolean,
    only?: ReadonlySet<string>,
  ): Promise<void> {
    const timeout = this.deps.finalizeTimeoutMs ?? 5 * 60_000;
    const poll = this.deps.pollMs ?? 500;
    for (const [sid, segment] of [...live.segments]) {
      if (only && !only.has(segment.identity)) continue;
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
