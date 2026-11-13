// One person at the table for compose-e2e.ts, behaving like the real apps do: the WebSocket protocol
// (docs/architecture/SYNC-PROTOCOL.md) for presence, chat and the recording-consent loop, and a real
// LiveKit participant publishing a microphone track.

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';

import { SAMPLE_RATE } from './tts.ts';

export type Frame = { t: string; d: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FRAME = SAMPLE_RATE / 100; // 10 ms

export class TableClient {
  readonly frames: Frame[] = [];
  private ws!: WebSocket;
  private waiters: { match: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  room?: Room;
  private source?: AudioSource;
  private queue: { samples: Int16Array; offset: number; done: () => void }[] = [];
  private pumping = false;
  /** Acknowledge every recording start automatically, after `cueMs` (the cue playing). */
  autoAck = true;
  cueMs = 1500;
  /** The server closed the connection (a backend restart, usually): the scene cannot be trusted. */
  dropped = false;
  private closing = false;
  /** The recordings this person has acknowledged, with when (epoch ms). */
  readonly acks = new Map<string, number>();

  readonly name: string;
  readonly userId: string;
  readonly campaignId: string;
  private readonly token: string;
  private readonly log: (line: string) => void;

  // Plain fields, not parameter properties: Node runs this file by stripping types only.
  constructor(
    name: string,
    userId: string,
    token: string,
    campaignId: string,
    log: (line: string) => void,
  ) {
    this.name = name;
    this.userId = userId;
    this.token = token;
    this.campaignId = campaignId;
    this.log = log;
  }

  async connect(apiBase: string): Promise<void> {
    this.ws = new WebSocket(`${apiBase.replace(/^http/, 'ws')}/ws`);
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error(`${this.name}: websocket failed`)), {
        once: true,
      });
    });
    this.ws.addEventListener('message', (e) => this.onFrame(JSON.parse(String(e.data)) as Frame));
    this.ws.addEventListener('close', () => {
      if (!this.closing) this.dropped = true;
    });
    this.send('auth', { token: this.token });
    await this.waitFor((f) => f.t === 'auth.ok', 10_000, 'auth.ok');
    this.send('resume', { campaignId: this.campaignId });
    await this.waitFor((f) => f.t === 'recording.state', 10_000, 'recording.state');
  }

  send(t: string, d: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, t, d }));
  }

  waitFor(match: (f: Frame) => boolean, timeoutMs: number, what: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.name}: no ${what} within ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  /** Sends `recording.ack` for `recordingId` (what the app does when the start cue has played). */
  ack(recordingId: string): void {
    this.send('recording.ack', { campaignId: this.campaignId, recordingId });
    this.acks.set(recordingId, Date.now());
    this.log(`${this.name} acknowledged the start cue`);
  }

  private onFrame(frame: Frame): void {
    this.frames.push(frame);
    if (frame.t === 'error') this.log(`${this.name}: server error ${JSON.stringify(frame.d)}`);
    // The consent loop as the apps run it: a start (or a snapshot saying "not yet acknowledged") plays
    // the cue, then acknowledges.
    const d = frame.d ?? {};
    let pending: string | undefined;
    if (frame.t === 'recording.status' && d.status === 'STARTED') pending = String(d.recordingId);
    if (frame.t === 'recording.state') {
      const r = d.recording as { recordingId?: string; acknowledged?: boolean } | null;
      if (r && r.acknowledged === false && r.recordingId) pending = r.recordingId;
    }
    if (pending && this.autoAck) {
      const id = pending;
      setTimeout(() => this.ack(id), this.cueMs);
    }
    for (const w of [...this.waiters]) {
      if (w.match(frame)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(frame);
      }
    }
  }

  /** Joins the campaign's voice room and publishes a microphone track that carries `speak()`. */
  async joinVoice(url: string, token: string): Promise<void> {
    const room = new Room();
    await room.connect(url, token, { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(SAMPLE_RATE, 1);
    const track = LocalAudioTrack.createAudioTrack('microphone', source);
    await room.localParticipant!.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    this.room = room;
    this.source = source;
    this.send('audio.state', { campaignId: this.campaignId, inVoice: true, muted: false });
    void this.pump();
  }

  /** Speaks `samples` into the microphone track in real time; resolves when the last sample is sent. */
  speak(samples: Int16Array): Promise<void> {
    this.send('speaking.set', { campaignId: this.campaignId, speaking: true });
    return new Promise<void>((resolve) => {
      this.queue.push({ samples, offset: 0, done: resolve });
    }).then(() => this.send('speaking.set', { campaignId: this.campaignId, speaking: false }));
  }

  /** A continuous 10 ms stream: queued speech, else silence (as an open microphone sends). */
  private async pump(): Promise<void> {
    this.pumping = true;
    const t0 = performance.now();
    let sent = 0;
    const silence = new Int16Array(FRAME);
    while (this.pumping && this.source) {
      const due = Math.floor((performance.now() - t0) / 10) + 5;
      while (sent < due && this.source) {
        const head = this.queue[0];
        let data = silence;
        if (head) {
          data = new Int16Array(FRAME);
          data.set(head.samples.subarray(head.offset, head.offset + FRAME));
          head.offset += FRAME;
          if (head.offset >= head.samples.length) {
            this.queue.shift();
            head.done();
          }
        }
        await this.source.captureFrame(new AudioFrame(data, SAMPLE_RATE, 1, FRAME));
        sent += 1;
      }
      await sleep(10);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.pumping = false;
    try {
      await this.room?.disconnect();
    } catch {
      /* already gone */
    }
    this.ws?.close();
  }
}
