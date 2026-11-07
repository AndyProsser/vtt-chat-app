import { randomUUID } from 'node:crypto';

import { Valkey } from 'iovalkey';
import { afterAll, describe, expect, it } from 'vitest';

import { replayBufferContract } from './replayContract.js';
import {
  keyValueFromRedisClient,
  ValkeyReplayBuffer,
  type RedisClientLike,
} from './valkeyReplayBuffer.js';

/**
 * The same contract the in-memory and fake-Redis buffers pass, against a real Valkey. Runs only
 * when TEST_VALKEY_URL is set:
 *
 *   TEST_VALKEY_URL=redis://127.0.0.1:56379 npm test -w @vtt-chat-app/backend
 */
const url = process.env.TEST_VALKEY_URL;

describe.skipIf(url === undefined)('ValkeyReplayBuffer on a real server', () => {
  const client = new Valkey(url ?? 'redis://127.0.0.1:6379', { lazyConnect: true });
  afterAll(async () => {
    await client.quit().catch(() => undefined);
  });

  // A unique key prefix per buffer plays the part of "each call gets its own empty server".
  const create = (options: ConstructorParameters<typeof ValkeyReplayBuffer>[1] = {}) =>
    new ValkeyReplayBuffer(keyValueFromRedisClient(client as unknown as RedisClientLike), {
      ...options,
      keyPrefix: `test-${randomUUID()}`,
    });

  replayBufferContract('valkey (real server)', create);

  it('really expires keys it creates', async () => {
    const prefix = `ttl-${randomUUID()}`;
    const buffer = new ValkeyReplayBuffer(
      keyValueFromRedisClient(client as unknown as RedisClientLike),
      { keyTtlMs: 5_000, keyPrefix: prefix },
    );
    await buffer.append('a', 't', 1);
    const ttl = await client.pttl(`${prefix}:a:events`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
  });
});
