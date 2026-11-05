import { describe, expect, it } from 'vitest';

import {
  keyValueFromRedisClient,
  ValkeyReplayBuffer,
  type KeyValue,
  type RedisClientLike,
} from './valkeyReplayBuffer.js';
import { replayBufferContract } from './replayContract.js';

/**
 * An in-memory stand-in with Redis semantics for the commands the buffer uses: strings with
 * INCR/SET NX, lists with RPUSH/LTRIM/LRANGE. It lets the whole contract suite run without a
 * server; the same suite must be run against a real Valkey once one is available.
 */
class FakeRedis implements RedisClientLike {
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly ttls = new Map<string, number>();
  commands: string[] = [];

  async incr(key: string): Promise<number> {
    this.commands.push('INCR');
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }
  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: string, mode: 'NX'): Promise<'OK' | null> {
    this.commands.push(`SET ${mode}`);
    if (this.strings.has(key)) return null;
    this.strings.set(key, value);
    return 'OK';
  }
  async rpush(key: string, value: string): Promise<number> {
    this.commands.push('RPUSH');
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }
  async ltrim(key: string, start: number, stop: number): Promise<unknown> {
    this.commands.push('LTRIM');
    const list = this.lists.get(key) ?? [];
    const from = start < 0 ? Math.max(list.length + start, 0) : start;
    const to = stop < 0 ? list.length + stop : stop;
    this.lists.set(key, list.slice(from, to + 1));
    return 'OK';
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const to = stop < 0 ? list.length + stop : stop;
    return list.slice(start, to + 1);
  }
  async pexpire(key: string, ms: number): Promise<number> {
    this.commands.push('PEXPIRE');
    this.ttls.set(key, ms);
    return 1;
  }
}

function buffer(
  options: ConstructorParameters<typeof ValkeyReplayBuffer>[1],
  redis = new FakeRedis(),
) {
  return new ValkeyReplayBuffer(keyValueFromRedisClient(redis), options);
}

// Each call gets its own empty "server", exactly as each in-memory buffer starts empty.
replayBufferContract('valkey (fake server)', (options) => buffer(options));

describe('ValkeyReplayBuffer specifics', () => {
  it('survives a backend restart: a new buffer over the same server keeps stream and epoch', async () => {
    const redis = new FakeRedis();
    const first = buffer({}, redis);
    const epoch = await first.epoch('a');
    await first.append('a', 't', 1);
    await first.append('a', 't', 2);

    const afterRestart = buffer({}, redis); // same Valkey, new process
    expect(await afterRestart.epoch('a')).toBe(epoch);
    expect((await afterRestart.since('a', 1, epoch))?.map((e) => e.seq)).toEqual([2]);
    expect((await afterRestart.append('a', 't', 3)).seq).toBe(3); // numbering continues
  });

  it('gets a new epoch if the server lost its data, so old clients take a snapshot', async () => {
    const redis = new FakeRedis();
    const before = buffer({}, redis);
    const oldEpoch = await before.epoch('a');
    await before.append('a', 't', 1);

    const flushed = new FakeRedis(); // Valkey restarted without persistence
    const after = buffer({}, flushed);
    expect(await after.epoch('a')).not.toBe(oldEpoch);
    expect(await after.since('a', 1, oldEpoch)).toBeUndefined();
  });

  it('puts a TTL on every key it creates, so abandoned campaigns do not accumulate', async () => {
    const redis = new FakeRedis();
    const b = buffer({ keyTtlMs: 12_345 }, redis);
    await b.append('a', 't', 1);
    expect([...redis.ttls.values()]).toEqual([12_345, 12_345, 12_345]);
    expect([...redis.ttls.keys()].sort()).toEqual([
      'replay:a:epoch',
      'replay:a:events',
      'replay:a:seq',
    ]);
  });

  it('caps the stored list so memory is bounded however long a session runs', async () => {
    const redis = new FakeRedis();
    const b = buffer({ maxEvents: 10 }, redis);
    for (let i = 0; i < 100; i += 1) await b.append('a', 't', i);
    expect(redis.lists.get('replay:a:events')).toHaveLength(10);
  });

  it('uses only plain Redis-protocol commands (no scripts, nothing Valkey-specific)', async () => {
    const redis = new FakeRedis();
    await buffer({}, redis).append('a', 't', 1);
    expect(new Set(redis.commands)).toEqual(
      new Set(['SET NX', 'INCR', 'RPUSH', 'LTRIM', 'PEXPIRE']),
    );
  });

  it('tolerates a corrupt entry in the list instead of failing every replay', async () => {
    const redis = new FakeRedis();
    const b = buffer({}, redis);
    const epoch = await b.epoch('a');
    await b.append('a', 't', 1);
    redis.lists.get('replay:a:events')?.splice(0, 0, '{not json');
    await b.append('a', 't', 2);
    expect((await b.since('a', 0, epoch))?.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('puts events in order even if concurrent appends landed out of order', async () => {
    const redis = new FakeRedis();
    const b = buffer({}, redis);
    const epoch = await b.epoch('a');
    await b.append('a', 't', 'one');
    await b.append('a', 't', 'two');
    await b.append('a', 't', 'three');
    const list = redis.lists.get('replay:a:events') ?? [];
    list.reverse(); // simulate RPUSH reordering under a race
    expect((await b.since('a', 0, epoch))?.map((e) => e.d)).toEqual(['one', 'two', 'three']);
  });

  it('works through the structural KeyValue interface, not a specific client', async () => {
    const kv: KeyValue = keyValueFromRedisClient(new FakeRedis());
    expect(await kv.setIfAbsent('k', 'v1')).toBe(true);
    expect(await kv.setIfAbsent('k', 'v2')).toBe(false);
    expect(await kv.get('k')).toBe('v1');
  });
});
