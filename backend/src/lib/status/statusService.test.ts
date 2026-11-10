import { MemoryJobQueue } from '@vtt-chat-app/ai';
import { describe, expect, it } from 'vitest';

import { StatusService } from './statusService.js';

const base = {
  onlinePlayers: () => 3,
  activeRecordings: () => 1,
  downloads: { linux: 'https://x/l' },
};

describe('StatusService', () => {
  it('reports services, counts and downloads, and is ok when every probe passes', async () => {
    const s = new StatusService({
      ...base,
      probes: [{ name: 'database', run: async () => undefined }],
    });
    const snap = await s.snapshot();
    expect(snap.ok).toBe(true);
    expect(snap.services).toEqual([
      { name: 'backend', ok: true },
      { name: 'database', ok: true },
    ]);
    expect(snap.players.online).toBe(3);
    expect(snap.recording.active).toBe(1);
    expect(snap.downloads.linux).toBe('https://x/l');
    expect(snap.pipeline).toBeNull();
  });

  it('marks a failing probe down without leaking the error text', async () => {
    const s = new StatusService({
      ...base,
      probes: [
        {
          name: 'livekit',
          run: async () => {
            throw new Error('connect ECONNREFUSED 10.0.0.5:7880');
          },
        },
      ],
    });
    const snap = await s.snapshot();
    expect(snap.ok).toBe(false);
    expect(JSON.stringify(snap)).not.toContain('10.0.0.5');
    expect(snap.services.find((x) => x.name === 'livekit')?.ok).toBe(false);
  });

  it('summarises the records pipeline', async () => {
    const jobs = new MemoryJobQueue();
    await jobs.enqueue({ kind: 'process', recordingId: 'r1' }, 100);
    const s = new StatusService({ ...base, probes: [], jobs });
    expect((await s.snapshot()).pipeline).toEqual({ queued: 1, running: 0, failed: 0, last: null });
  });

  it('reuses a snapshot inside the cache window', async () => {
    let calls = 0;
    let clock = 1000;
    const s = new StatusService({
      ...base,
      now: () => clock,
      cacheMs: 5000,
      probes: [{ name: 'db', run: async () => void calls++ }],
    });
    await s.snapshot();
    clock += 1000;
    await s.snapshot();
    expect(calls).toBe(1);
    clock += 5000;
    await s.snapshot();
    expect(calls).toBe(2);
  });

  it('shows the free share of the recordings disk and fails the check when it runs low', async () => {
    const roomy = new StatusService({
      ...base,
      probes: [],
      storage: async () => ({ totalBytes: 1000, freeBytes: 600 }),
    });
    const ok = await roomy.snapshot();
    expect(ok.storage).toEqual({ freePercent: 60, low: false });
    expect(ok.ok).toBe(true);

    const tight = new StatusService({
      ...base,
      probes: [],
      storage: async () => ({ totalBytes: 1000, freeBytes: 50 }),
    });
    const low = await tight.snapshot();
    expect(low.storage).toEqual({ freePercent: 5, low: true });
    expect(low.ok).toBe(false);
    expect(low.services.find((x) => x.name === 'storage')?.ok).toBe(false);
  });

  it('leaves storage out when there is nothing to measure', async () => {
    const s = new StatusService({ ...base, probes: [], storage: async () => null });
    expect((await s.snapshot()).storage).toBeNull();
  });
});
