import { describe, expect, it } from 'vitest';

import {
  applyStatsEvent,
  describeLink,
  HISTORY_LENGTH,
  linkQuality,
  type LinkStatsView,
} from './linkQuality.js';

const s = (rttMs: number, jitterMs: number, packetLossPct: number): LinkStatsView => ({
  rttMs,
  jitterMs,
  packetLossPct,
  at: 1,
});

describe('linkQuality', () => {
  it('is good for a clean link, fair or poor as any one number worsens', () => {
    expect(linkQuality(s(40, 5, 0))).toBe('good');
    expect(linkQuality(s(150, 5, 0))).toBe('fair');
    expect(linkQuality(s(40, 35, 0))).toBe('fair');
    expect(linkQuality(s(40, 5, 3))).toBe('fair');
    expect(linkQuality(s(300, 5, 0))).toBe('poor');
    expect(linkQuality(s(40, 60, 0))).toBe('poor');
    expect(linkQuality(s(40, 5, 8))).toBe('poor');
  });
  it('is unknown with no measurement', () => {
    expect(linkQuality(undefined)).toBe('unknown');
  });
});

describe('describeLink', () => {
  it('words the three numbers, and a dash when nothing is known', () => {
    expect(describeLink(s(42.4, 5.2, 0.3))).toBe('42 ms · jitter 5 ms · 0.3% loss');
    expect(describeLink(undefined)).toBe('—');
  });
});

describe('applyStatsEvent', () => {
  it('seeds from a snapshot (DM only gets stats) and follows stats.update', () => {
    let map = applyStatsEvent(new Map(), {
      t: 'snapshot',
      d: {
        members: [
          { userId: 'a', stats: s(40, 5, 0) },
          { userId: 'b', stats: null },
        ],
      },
    });
    expect([...map.keys()]).toEqual(['a']);
    map = applyStatsEvent(map, { t: 'stats.update', d: { userId: 'b', stats: s(90, 9, 1) } });
    expect(map.get('b')?.rttMs).toBe(90);
  });
  it('ignores unrelated events and returns the same map', () => {
    const map = new Map<string, LinkStatsView>();
    expect(applyStatsEvent(map, { t: 'chat.message', d: {} })).toBe(map);
  });
  it('ignores a malformed stats object', () => {
    const map = new Map<string, LinkStatsView>();
    expect(
      applyStatsEvent(map, { t: 'stats.update', d: { userId: 'a', stats: { rttMs: 'x' } } }),
    ).toBe(map);
  });
});

describe('link history for the sparkline', () => {
  const update = (map: ReadonlyMap<string, LinkStatsView>, rtt: number, at: number) =>
    applyStatsEvent(map, {
      t: 'stats.update',
      d: { userId: 'a', stats: { rttMs: rtt, jitterMs: 1, packetLossPct: 0, at } },
    });

  it('keeps each latency sample, oldest first', () => {
    let map: ReadonlyMap<string, LinkStatsView> = new Map();
    for (const [i, rtt] of [30, 40, 50].entries()) map = update(map, rtt, i + 1);
    expect(map.get('a')?.history).toEqual([30, 40, 50]);
  });

  it('keeps only the most recent samples', () => {
    let map: ReadonlyMap<string, LinkStatsView> = new Map();
    for (let i = 0; i < HISTORY_LENGTH + 10; i += 1) map = update(map, i, i + 1);
    const history = map.get('a')?.history ?? [];
    expect(history).toHaveLength(HISTORY_LENGTH);
    expect(history.at(-1)).toBe(HISTORY_LENGTH + 9);
  });

  it('does not double-count a roster snapshot repeating the last sample', () => {
    const map = update(new Map(), 30, 5);
    const again = applyStatsEvent(map, {
      t: 'roster.update',
      d: {
        members: [{ userId: 'a', stats: { rttMs: 30, jitterMs: 1, packetLossPct: 0, at: 5 } }],
      },
    });
    expect(again.get('a')?.history).toEqual([30]);
  });

  it('records the quality of each sample so the trace can show recovery', () => {
    let map: ReadonlyMap<string, LinkStatsView> = new Map();
    map = applyStatsEvent(map, {
      t: 'stats.update',
      d: { userId: 'a', stats: { rttMs: 400, jitterMs: 1, packetLossPct: 0, at: 1 } },
    });
    map = update(map, 30, 2);
    expect(map.get('a')?.qualities).toEqual(['poor', 'good']);
  });
});
