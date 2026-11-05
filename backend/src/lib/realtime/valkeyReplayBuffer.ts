import { randomUUID } from 'node:crypto';

import { selectReplay, type BufferedEvent, type ReplayBuffer } from './replayBuffer.js';

/**
 * The handful of commands the buffer needs. Deliberately tiny, and deliberately Redis-protocol
 * only (no scripts, no Valkey-specific commands), so Valkey, Redis and the test fake all satisfy
 * it. A real client is adapted with {@link keyValueFromRedisClient}.
 */
export interface KeyValue {
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  /** Sets `key` only if absent. Returns `true` if it was set. */
  setIfAbsent(key: string, value: string): Promise<boolean>;
  rpush(key: string, value: string): Promise<void>;
  /** Keeps only the last `count` list items. */
  keepLast(key: string, count: number): Promise<void>;
  /** The whole list, oldest first. */
  list(key: string): Promise<string[]>;
  expire(key: string, ttlMs: number): Promise<void>;
}

/** The subset of an ioredis/iovalkey-style client that {@link keyValueFromRedisClient} calls. */
export interface RedisClientLike {
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'NX'): Promise<'OK' | null>;
  rpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  pexpire(key: string, ms: number): Promise<number>;
}

export function keyValueFromRedisClient(client: RedisClientLike): KeyValue {
  return {
    incr: (key) => client.incr(key),
    get: (key) => client.get(key),
    setIfAbsent: async (key, value) => (await client.set(key, value, 'NX')) === 'OK',
    rpush: async (key, value) => {
      await client.rpush(key, value);
    },
    keepLast: async (key, count) => {
      await client.ltrim(key, -count, -1);
    },
    list: (key) => client.lrange(key, 0, -1),
    expire: async (key, ttlMs) => {
      await client.pexpire(key, ttlMs);
    },
  };
}

export interface ValkeyReplayBufferOptions {
  maxEvents?: number;
  maxAgeMs?: number;
  /** How long an idle campaign's keys linger. Pure cleanup: correctness doesn't depend on it. */
  keyTtlMs?: number;
  now?: () => number;
  keyPrefix?: string;
}

/**
 * The replay buffer on Valkey (or Redis): survives a backend restart, so clients reconnecting to
 * a restarted backend can still be replayed instead of all being sent snapshots. Same contract as
 * the in-memory buffer — they share one test suite and one gap-decision function.
 *
 * Layout, per campaign: a sequence counter, a capped list of JSON events, and the stream's epoch.
 * If Valkey loses its data, the epoch is regenerated, so every client takes a snapshot instead of
 * trusting numbers from the dead stream.
 */
export class ValkeyReplayBuffer implements ReplayBuffer {
  private readonly maxEvents: number;
  private readonly maxAgeMs: number;
  private readonly keyTtlMs: number;
  private readonly now: () => number;
  private readonly prefix: string;

  constructor(
    private readonly kv: KeyValue,
    options: ValkeyReplayBufferOptions = {},
  ) {
    this.maxEvents = options.maxEvents ?? 500;
    this.maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
    this.keyTtlMs = options.keyTtlMs ?? 7 * 24 * 60 * 60_000;
    this.now = options.now ?? Date.now;
    this.prefix = options.keyPrefix ?? 'replay';
  }

  async epoch(campaignId: string): Promise<string> {
    const key = this.key(campaignId, 'epoch');
    // Create-if-absent then read: two backends racing both end up agreeing on the winner.
    await this.kv.setIfAbsent(key, randomUUID());
    const epoch = await this.kv.get(key);
    if (epoch === null) throw new Error('replay epoch vanished immediately after being set');
    return epoch;
  }

  async append(campaignId: string, t: string, d: unknown): Promise<BufferedEvent> {
    // Make sure the stream has an epoch before it has events, so an event is never orphaned.
    await this.epoch(campaignId);
    const seq = await this.kv.incr(this.key(campaignId, 'seq'));
    const event: BufferedEvent = { seq, ts: this.now(), t, d };

    const events = this.key(campaignId, 'events');
    await this.kv.rpush(events, JSON.stringify(event));
    await this.kv.keepLast(events, this.maxEvents);
    for (const name of ['events', 'seq', 'epoch'] as const) {
      await this.kv.expire(this.key(campaignId, name), this.keyTtlMs);
    }
    return event;
  }

  async since(
    campaignId: string,
    lastSeq: number,
    epoch: string | undefined,
  ): Promise<BufferedEvent[] | undefined> {
    if (epoch === undefined || epoch !== (await this.epoch(campaignId))) return undefined;
    return selectReplay(await this.retained(campaignId), await this.latestSeq(campaignId), lastSeq);
  }

  async latestSeq(campaignId: string): Promise<number> {
    const value = await this.kv.get(this.key(campaignId, 'seq'));
    return value === null ? 0 : Number(value);
  }

  async recent(campaignId: string, limit: number): Promise<BufferedEvent[]> {
    return (await this.retained(campaignId)).slice(-limit);
  }

  /** Events still within the age limit, oldest first. Parsed defensively: one bad entry can't break replay. */
  private async retained(campaignId: string): Promise<BufferedEvent[]> {
    const cutoff = this.now() - this.maxAgeMs;
    const events: BufferedEvent[] = [];
    for (const raw of await this.kv.list(this.key(campaignId, 'events'))) {
      try {
        const event = JSON.parse(raw) as BufferedEvent;
        if (typeof event.seq === 'number' && event.ts >= cutoff) events.push(event);
      } catch {
        // Skip an unreadable entry rather than fail the whole replay.
      }
    }
    // Concurrent appends can push out of order; sequence numbers are the truth.
    return events.sort((a, b) => a.seq - b.seq);
  }

  private key(campaignId: string, name: 'seq' | 'events' | 'epoch'): string {
    return `${this.prefix}:${campaignId}:${name}`;
  }
}
