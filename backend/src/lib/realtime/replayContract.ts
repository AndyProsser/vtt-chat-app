import { describe, expect, it } from 'vitest';

import type { ReplayBuffer } from './replayBuffer.js';

export interface BufferFactoryOptions {
  maxEvents?: number;
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * The behaviour every `ReplayBuffer` must have, as one suite run against each implementation. The
 * in-memory and Valkey-backed buffers are interchangeable only because they pass the same tests.
 */
export function replayBufferContract(
  name: string,
  create: (options?: BufferFactoryOptions) => ReplayBuffer | Promise<ReplayBuffer>,
): void {
  describe(`ReplayBuffer contract: ${name}`, () => {
    it('numbers events per campaign from 1', async () => {
      const buffer = await create();
      expect((await buffer.append('a', 't', 1)).seq).toBe(1);
      expect((await buffer.append('a', 't', 2)).seq).toBe(2);
      expect((await buffer.append('b', 't', 1)).seq).toBe(1);
      expect(await buffer.latestSeq('a')).toBe(2);
      expect(await buffer.latestSeq('nobody')).toBe(0);
    });

    it('keeps the event type and data intact', async () => {
      const buffer = await create();
      await buffer.append('a', 'chat.message', { text: 'hi', nested: { n: [1, 2] } });
      const [event] = await buffer.recent('a', 10);
      expect(event).toMatchObject({
        seq: 1,
        t: 'chat.message',
        d: { text: 'hi', nested: { n: [1, 2] } },
      });
    });

    it('replays exactly what a reconnecting client missed', async () => {
      const buffer = await create();
      const epoch = await buffer.epoch('a');
      for (let i = 1; i <= 5; i += 1) await buffer.append('a', 't', i);
      expect((await buffer.since('a', 3, epoch))?.map((e) => e.seq)).toEqual([4, 5]);
      expect(await buffer.since('a', 5, epoch)).toEqual([]);
      expect((await buffer.since('a', 0, epoch))?.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    });

    it('keeps one campaign’s stream apart from another’s', async () => {
      const buffer = await create();
      await buffer.append('a', 't', 'a1');
      await buffer.append('b', 't', 'b1');
      await buffer.append('b', 't', 'b2');
      expect((await buffer.recent('a', 10)).map((e) => e.d)).toEqual(['a1']);
      expect((await buffer.recent('b', 10)).map((e) => e.d)).toEqual(['b1', 'b2']);
    });

    it('returns the most recent events, oldest first, up to the limit', async () => {
      const buffer = await create();
      for (let i = 1; i <= 5; i += 1) await buffer.append('a', 't', i);
      expect((await buffer.recent('a', 2)).map((e) => e.seq)).toEqual([4, 5]);
      expect(await buffer.recent('empty', 5)).toEqual([]);
    });

    it('asks for a snapshot when the gap has been trimmed away', async () => {
      const buffer = await create({ maxEvents: 3 });
      const epoch = await buffer.epoch('a');
      for (let i = 1; i <= 6; i += 1) await buffer.append('a', 't', i); // keeps 4,5,6
      expect(await buffer.since('a', 3, epoch)).toHaveLength(3); // next needed is 4: still there
      expect(await buffer.since('a', 2, epoch)).toBeUndefined(); // needs 3: gone
      expect(await buffer.since('a', 0, epoch)).toBeUndefined();
    });

    it('asks for a snapshot when the client is ahead of the stream', async () => {
      const buffer = await create();
      const epoch = await buffer.epoch('a');
      await buffer.append('a', 't', 1);
      expect(await buffer.since('a', 40, epoch)).toBeUndefined();
    });

    it('asks for a snapshot when the epoch is wrong or missing', async () => {
      const buffer = await create();
      const epoch = await buffer.epoch('a');
      await buffer.append('a', 't', 1);
      expect(await buffer.since('a', 0, 'some-other-stream')).toBeUndefined();
      expect(await buffer.since('a', 0, undefined)).toBeUndefined();
      expect(await buffer.since('a', 0, epoch)).toHaveLength(1);
    });

    it('keeps the same epoch for the life of the stream, and a different one per campaign', async () => {
      const buffer = await create();
      const first = await buffer.epoch('a');
      await buffer.append('a', 't', 1);
      expect(await buffer.epoch('a')).toBe(first);
      expect(await buffer.epoch('b')).not.toBe(first);
    });

    it('gives a fresh stream a new epoch, so old sequence numbers can’t be mistaken for new ones', async () => {
      // Two buffers stand in for "before and after a restart / flush".
      const before = await create();
      const after = await create();
      const oldEpoch = await before.epoch('a');
      await before.append('a', 't', 'old');
      await after.append('a', 't', 'new-1');
      await after.append('a', 't', 'new-2');
      // The client saw seq 1 of the OLD stream. Seq 1 exists in the new stream too, but it is a
      // different event; replaying "after 1" would silently skip it.
      expect(await after.since('a', 1, oldEpoch)).toBeUndefined();
    });

    it('forgets events older than the age limit', async () => {
      let now = 0;
      const buffer = await create({ maxAgeMs: 1000, now: () => now });
      const epoch = await buffer.epoch('a');
      await buffer.append('a', 't', 1);
      now = 500;
      await buffer.append('a', 't', 2);
      now = 1200; // event 1 is now 1200 ms old
      expect((await buffer.since('a', 1, epoch))?.map((e) => e.seq)).toEqual([2]);
      expect(await buffer.since('a', 0, epoch)).toBeUndefined(); // event 1 is gone
    });
  });
}
