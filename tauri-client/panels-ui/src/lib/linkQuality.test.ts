import { describe, expect, it } from 'vitest';

import { applyStatsEvent, describeLink, linkQuality, type LinkStatsView } from './linkQuality.js';

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
