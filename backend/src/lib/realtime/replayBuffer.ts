export interface BufferedEvent {
  seq: number;
  ts: number;
  t: string;
  d: unknown;
}

/**
 * The bounded replay buffer from SYNC-PROTOCOL.md: the last N events or T minutes per campaign,
 * whichever is smaller. A client that reconnects inside the window gets the gap replayed; any other
 * client gets a snapshot. Only durable-ish events go in (chat, recording status) — replaying a stale
 * "is speaking" would be wrong, so live state travels in snapshots instead.
 *
 * The interface is what the rest of the code uses; this is the in-memory implementation. The
 * Valkey-backed one is the same contract (a capped list per campaign with a sequence counter).
 */
export interface ReplayBuffer {
  /** Stores an event and returns its sequence number (1, 2, 3 … per campaign). */
  append(campaignId: string, t: string, d: unknown): Promise<BufferedEvent>;
  /**
   * Events after `lastSeq`, oldest first. `undefined` means the gap can't be filled (the client
   * is too far behind, or is ahead of us after a server restart) and a snapshot is needed.
   */
  since(campaignId: string, lastSeq: number): Promise<BufferedEvent[] | undefined>;
  /** The newest sequence number for the campaign (0 if none yet). */
  latestSeq(campaignId: string): Promise<number>;
  /** The most recent events, newest last, for snapshots. */
  recent(campaignId: string, limit: number): Promise<BufferedEvent[]>;
}

export interface MemoryReplayBufferOptions {
  maxEvents?: number;
  maxAgeMs?: number;
  now?: () => number;
}

interface Stream {
  nextSeq: number;
  events: BufferedEvent[];
}

export class MemoryReplayBuffer implements ReplayBuffer {
  private readonly streams = new Map<string, Stream>();
  private readonly maxEvents: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(options: MemoryReplayBufferOptions = {}) {
    this.maxEvents = options.maxEvents ?? 500;
    this.maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  async append(campaignId: string, t: string, d: unknown): Promise<BufferedEvent> {
    const stream = this.stream(campaignId);
    const event: BufferedEvent = { seq: stream.nextSeq, ts: this.now(), t, d };
    stream.nextSeq += 1;
    stream.events.push(event);
    this.trim(stream);
    return event;
  }

  async since(campaignId: string, lastSeq: number): Promise<BufferedEvent[] | undefined> {
    const stream = this.stream(campaignId);
    this.trim(stream);
    const latest = stream.nextSeq - 1;
    if (lastSeq === latest) return [];
    // Ahead of us: the server restarted and lost its counter. Never claim "nothing missed".
    if (lastSeq > latest) return undefined;

    const oldest = stream.events[0];
    // The next event the client needs is lastSeq + 1; if that has been trimmed away, there's a hole.
    if (!oldest || oldest.seq > lastSeq + 1) return undefined;
    return stream.events.filter((event) => event.seq > lastSeq);
  }

  async latestSeq(campaignId: string): Promise<number> {
    return this.stream(campaignId).nextSeq - 1;
  }

  async recent(campaignId: string, limit: number): Promise<BufferedEvent[]> {
    const stream = this.stream(campaignId);
    this.trim(stream);
    return stream.events.slice(-limit);
  }

  private stream(campaignId: string): Stream {
    let stream = this.streams.get(campaignId);
    if (!stream) {
      stream = { nextSeq: 1, events: [] };
      this.streams.set(campaignId, stream);
    }
    return stream;
  }

  private trim(stream: Stream): void {
    const cutoff = this.now() - this.maxAgeMs;
    while (stream.events.length > 0) {
      const first = stream.events[0];
      if (first && (stream.events.length > this.maxEvents || first.ts < cutoff)) {
        stream.events.shift();
      } else {
        break;
      }
    }
  }
}
