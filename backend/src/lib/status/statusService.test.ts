import { MemoryJobQueue } from '@vtt-chat-app/ai';
import { describe, expect, it } from 'vitest';

import { StatusService } from './statusService.js';

const base = {
  onlinePlayers: () => 3,
  activeRecordings: () => 1,
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
    expect(snap).not.toHaveProperty('downloads');
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

  it('shows the local AI models as the worker reported them, without the error text', async () => {
    const s = new StatusService({
      ...base,
      probes: [],
      now: () => 60_000,
      localAi: async () => ({
        at: 50_000,
        llm: { state: 'downloading', percent: 43, detail: 'internal detail' },
        whisper: { state: 'ready' },
      }),
    });
    const snap = await s.snapshot();
    expect(snap.localAi).toEqual({
      summaryModel: { state: 'downloading', percent: 43 },
      whisper: { state: 'ready' },
    });
    expect(snap.ok).toBe(true);
    expect(JSON.stringify(snap)).not.toContain('internal detail');
  });

  it('is not ok when the summary model download failed or stopped reporting', async () => {
    const failed = new StatusService({
      ...base,
      probes: [],
      localAi: async () => ({ at: 0, llm: { state: 'failed', detail: 'x' }, whisper: null }),
    });
    expect((await failed.snapshot()).services).toContainEqual({ name: 'summary model', ok: false });

    const stalled = new StatusService({
      ...base,
      probes: [],
      now: () => 10 * 60_000,
      localAi: async () => ({ at: 0, llm: { state: 'downloading', percent: 12 }, whisper: null }),
    });
    const snap = await stalled.snapshot();
    expect(snap.ok).toBe(false);
    expect(snap.localAi?.summaryModel).toEqual({ state: 'stalled', percent: 12 });
  });

  it('reports no local AI when no worker has (and when reading it fails)', async () => {
    expect((await new StatusService({ ...base, probes: [] }).snapshot()).localAi).toBeNull();
    const broken = new StatusService({
      ...base,
      probes: [],
      localAi: async () => {
        throw new Error('no such column');
      },
    });
    expect((await broken.snapshot()).localAi).toBeNull();
    expect((await broken.snapshot()).ok).toBe(true);
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
