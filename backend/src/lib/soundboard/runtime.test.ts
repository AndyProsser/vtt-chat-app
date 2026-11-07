/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed event payloads */
import { beforeEach, describe, expect, it } from 'vitest';

import { SoundboardRuntime } from './runtime.js';
import { MemorySoundStore } from './memorySoundStore.js';
import type { Scene, Sound } from './soundStore.js';

const DM = 'dm-1';
let sounds: MemorySoundStore;
let events: { campaignId: string; type: string; data: any; only?: string[] }[];
let timers: { fn: () => void; ms: number; cleared: boolean }[];
let rnd: number[];
let runtime: SoundboardRuntime;
let ids = 0;

const take = (id: string, soundId: string, level = 1) => ({
  id,
  soundId,
  mediaId: `m-${id}`,
  level,
  position: 0,
});
const sound = (id: string, takes = 1, ownerId = DM): Sound => ({
  id,
  ownerId,
  name: id,
  category: 'effect',
  tags: [],
  createdAt: 1,
  takes: Array.from({ length: takes }, (_, i) => take(`${id}-t${i}`, id)),
});

beforeEach(async () => {
  sounds = new MemorySoundStore();
  events = [];
  timers = [];
  rnd = [];
  ids = 0;
  runtime = new SoundboardRuntime({
    sounds,
    events: {
      emit: (campaignId, type, data, only) =>
        events.push({ campaignId, type, data, ...(only ? { only: [...only] } : {}) }),
    },
    now: () => 5000,
    random: () => rnd.shift() ?? 0,
    newId: () => `p${++ids}`,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  await sounds.putSound(sound('door', 3));
  await sounds.putSound(sound('rain'));
  await sounds.putSound(sound('drip'));
  await sounds.putSound(sound('foreign', 1, 'other-dm'));
});

const types = () => events.map((e) => e.type);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('playing sounds', () => {
  it('a one-shot is announced with the take the server picked, and is not remembered', async () => {
    rnd = [0.99]; // last of three takes
    const rec = await runtime.play('c', DM, { soundId: 'door', volume: 0.5 });
    expect(rec.takeId).toBe('door-t2');
    expect(events[0]).toMatchObject({
      type: 'sound.play',
      data: { playId: 'p1', takeId: 'door-t2', volume: 0.5, mode: 'oneshot' },
    });
    expect(runtime.snapshot('c', 'anyone').loops).toEqual([]);
  });

  it('a button pressed again can play a different take', async () => {
    rnd = [0.1, 0.9];
    const a = await runtime.play('c', DM, { soundId: 'door' });
    const b = await runtime.play('c', DM, { soundId: 'door' });
    expect(a.takeId).not.toBe(b.takeId);
  });

  it('a loop is remembered for late joiners until it is stopped', async () => {
    const rec = await runtime.play('c', DM, { soundId: 'rain', mode: 'loop' });
    expect(runtime.snapshot('c', 'late').loops.map((l) => l.playId)).toEqual([rec.playId]);
    runtime.stop('c', rec.playId);
    expect(runtime.snapshot('c', 'late').loops).toEqual([]);
    expect(types()).toEqual(['sound.play', 'sound.stop']);
  });

  it('a targeted sound reaches only those people, and only they see its loop on joining', async () => {
    await runtime.play('c', DM, { soundId: 'rain', mode: 'loop', to: ['alice'] });
    expect(events[0]?.only).toEqual(['alice']);
    expect(runtime.snapshot('c', 'alice').loops).toHaveLength(1);
    expect(runtime.snapshot('c', 'bob').loops).toHaveLength(0);
  });

  it('refuses a sound that is not in the DM’s own library', async () => {
    await expect(runtime.play('c', DM, { soundId: 'foreign' })).rejects.toThrow(
      /not in your library/,
    );
    await expect(runtime.play('c', DM, { soundId: 'nope' })).rejects.toThrow(/not in your library/);
    await expect(runtime.play('c', DM, { soundId: 'door', takeId: 'bogus' })).rejects.toThrow(
      /no such take/,
    );
    expect(events).toEqual([]);
  });

  it('stop with no id ends every loop', async () => {
    await runtime.play('c', DM, { soundId: 'rain', mode: 'loop' });
    await runtime.play('c', DM, { soundId: 'drip', mode: 'loop' });
    runtime.stop('c');
    expect(runtime.snapshot('c', 'x').loops).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'sound.stop', data: { playId: null } });
  });
});

describe('scenes', () => {
  const scene = (layers: Scene['layers']): Scene => ({
    id: 'cave',
    ownerId: DM,
    name: 'Cave',
    layers,
    createdAt: 1,
  });
  const loop = {
    id: 'l1',
    soundId: 'rain',
    mode: 'loop' as const,
    volume: 0.7,
    minIntervalSec: null,
    maxIntervalSec: null,
  };
  const random = {
    id: 'l2',
    soundId: 'drip',
    mode: 'random' as const,
    volume: 1,
    minIntervalSec: 10,
    maxIntervalSec: 30,
  };

  it('starting a scene starts its loops, schedules its random layers and is part of the snapshot', async () => {
    await sounds.putScene(scene([loop, random]));
    rnd = [0, 0.5]; // loop take pick, then the random layer's interval draw
    await runtime.startScene('c', DM, 'cave');
    expect(types()).toEqual(['scene.started', 'sound.play']);
    expect(events[1]?.data).toMatchObject({ mode: 'loop', layerId: 'l1', volume: 0.7 });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(20_000); // 10 + 0.5 * (30 - 10) seconds
    expect(runtime.snapshot('c', 'late')).toMatchObject({
      scene: { sceneId: 'cave', name: 'Cave' },
    });
    expect(runtime.snapshot('c', 'late').loops).toHaveLength(1);
  });

  it('a random layer drops its sound in when the timer fires, then schedules the next', async () => {
    await sounds.putScene(scene([random]));
    await runtime.startScene('c', DM, 'cave');
    events.length = 0;
    timers[0]?.fn();
    await flush();
    expect(events.map((e) => e.type)).toEqual(['sound.play']);
    expect(events[0]?.data).toMatchObject({ mode: 'oneshot', layerId: 'l2' });
    expect(timers).toHaveLength(2); // rescheduled
  });

  it('starting another scene stops the first one’s loops and timers', async () => {
    await sounds.putScene(scene([loop, random]));
    await sounds.putScene({ ...scene([loop]), id: 'tavern', name: 'Tavern' });
    await runtime.startScene('c', DM, 'cave');
    await runtime.startScene('c', DM, 'tavern');
    expect(timers[0]?.cleared).toBe(true);
    expect(types()).toContain('scene.stopped');
    expect(runtime.snapshot('c', 'x').scene?.sceneId).toBe('tavern');
    expect(runtime.snapshot('c', 'x').loops).toHaveLength(1); // only the new scene's loop
  });

  it('a timer that fires after the scene was replaced does nothing', async () => {
    await sounds.putScene(scene([random]));
    await runtime.startScene('c', DM, 'cave');
    const stale = timers[0];
    runtime.stopScene('c');
    events.length = 0;
    stale?.fn();
    await flush();
    expect(events).toEqual([]);
  });

  it('a layer whose sound was deleted just drops out; another DM’s scene is refused', async () => {
    await sounds.putScene(scene([{ ...loop, soundId: 'gone' }, random]));
    await runtime.startScene('c', DM, 'cave');
    expect(runtime.snapshot('c', 'x').loops).toEqual([]);
    await sounds.putScene({ ...scene([]), id: 'theirs', ownerId: 'other-dm' });
    await expect(runtime.startScene('c', DM, 'theirs')).rejects.toThrow(/not in your library/);
  });

  it('reset (nobody left at the table) clears timers and state', async () => {
    await sounds.putScene(scene([loop, random]));
    await runtime.startScene('c', DM, 'cave');
    runtime.reset('c');
    expect(timers[0]?.cleared).toBe(true);
    expect(runtime.snapshot('c', 'x')).toMatchObject({ loops: [], scene: null });
  });
});

describe('volume', () => {
  it('keeps and announces the master volume and per-player gains, clamped', () => {
    runtime.setMaster('c', 2);
    runtime.setPlayerGain('c', 'alice', 5);
    runtime.setPlayerGain('c', 'bob', -1);
    expect(runtime.snapshot('c', 'x')).toMatchObject({ master: 1, gains: { alice: 2, bob: 0 } });
    expect(events.map((e) => e.type)).toEqual(['sound.volume', 'sound.volume', 'sound.volume']);
  });
});
