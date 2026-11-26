import { describe, expect, test } from 'vitest';

import { createActivityGovernor } from './activityGovernor.js';

describe('createActivityGovernor', () => {
  test('at presence 0, uses up to cpuCount regardless of load, capped by tracks remaining', async () => {
    const governor = createActivityGovernor({
      records: { onlineUserCount: async () => 0 },
      settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
      loadavg: () => [7.9], // would read as "busy" if it mattered
      cpuCount: () => 8,
    });
    expect(await governor.trackConcurrency(11)).toBe(8); // capped by cpuCount, not tracksRemaining
    expect(await governor.trackConcurrency(3)).toBe(3); // capped by tracksRemaining, not cpuCount
  });

  test('at presence >= 1 under the CPU threshold, uses activeConcurrency', async () => {
    const governor = createActivityGovernor({
      records: { onlineUserCount: async () => 1 },
      settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
      loadavg: () => [1.0], // 1 of 8 cores, well under 70%
      cpuCount: () => 8,
    });
    expect(await governor.trackConcurrency(11)).toBe(2);
  });

  test('at presence >= 1 over the CPU threshold, clamps to 1', async () => {
    const governor = createActivityGovernor({
      records: { onlineUserCount: async () => 2 },
      settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
      loadavg: () => [6.5], // >70% of 8 cores
      cpuCount: () => 8,
    });
    expect(await governor.trackConcurrency(11)).toBe(1);
  });

  test('treats a presence read failure as presence >= 1, not presence 0', async () => {
    const governor = createActivityGovernor({
      records: {
        onlineUserCount: async () => {
          throw new Error('db unreachable');
        },
      },
      settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
      loadavg: () => [1.0], // quiet CPU — if this were treated as presence 0, it would return 8
      cpuCount: () => 8,
    });
    expect(await governor.trackConcurrency(11)).toBe(2); // the active-tier default, not 8
  });

  test('reuses a recent answer instead of re-reading on every call', async () => {
    let calls = 0;
    const governor = createActivityGovernor({
      records: {
        onlineUserCount: async () => {
          calls++;
          return 0;
        },
      },
      settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
      loadavg: () => [0],
      cpuCount: () => 8,
      goodForMs: 5000,
    });
    await governor.trackConcurrency(8);
    await governor.trackConcurrency(8);
    expect(calls).toBe(1);
  });
});
