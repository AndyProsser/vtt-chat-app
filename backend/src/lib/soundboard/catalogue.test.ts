import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryMediaStorage } from '../media/mediaStorage.js';
import { MemoryTableStore } from '../table/memoryTableStore.js';
import { seedCatalogue, type CatalogueManifest } from './catalogue.js';
import { MemorySoundStore } from './memorySoundStore.js';

const OGG = (n: number) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, n)]);

let dir: string;
let sounds: MemorySoundStore;
let table: MemoryTableStore;
let media: MemoryMediaStorage;

async function pack(manifest: CatalogueManifest, files: Record<string, Buffer>) {
  dir = await mkdtemp(path.join(tmpdir(), 'catalogue-'));
  await writeFile(path.join(dir, 'catalogue.json'), JSON.stringify(manifest));
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), bytes);
  }
}
const seed = () => seedCatalogue({ dir, sounds, table, media, now: () => 1000 });

const BASE: CatalogueManifest = {
  version: 1,
  sounds: [
    { key: 'rain', name: 'Rain', category: 'ambience', takes: ['a/rain.ogg'], level: 0.8 },
    { key: 'door', name: 'Door', category: 'effect', takes: ['a/d1.ogg', 'a/d2.ogg'] },
  ],
  boards: [
    {
      key: 'doors',
      name: 'Doors',
      buttons: [{ label: 'Creak', sound: 'door', mode: 'oneshot', volume: 0.9 }],
    },
  ],
  scenes: [
    {
      key: 'rainfall',
      name: 'Rainfall',
      layers: [{ sound: 'rain', mode: 'loop', volume: 0.7 }],
    },
  ],
};
const FILES = { 'a/rain.ogg': OGG(1), 'a/d1.ogg': OGG(2), 'a/d2.ogg': OGG(3) };

beforeEach(() => {
  sounds = new MemorySoundStore();
  table = new MemoryTableStore();
  media = new MemoryMediaStorage();
});

describe('seeding the shared catalogue', () => {
  it('writes owner-less sounds, boards and scenes, with their clips stored once', async () => {
    await pack(BASE, FILES);
    const result = await seed();
    expect(result).toMatchObject({ sounds: 2, boards: 1, scenes: 1 });
    const shared = await sounds.listSounds(null);
    expect(shared.map((s) => s.name)).toEqual(['Rain', 'Door']);
    expect(shared[1]?.takes).toHaveLength(2);
    expect(shared[0]?.takes[0]?.level).toBe(0.8);
    expect((await sounds.listBoards(null))[0]?.buttons[0]?.soundId).toBe(shared[1]?.id);
    const scene = (await sounds.listScenes(null))[0];
    expect(scene?.layers[0]?.soundId).toBe(shared[0]?.id);
    expect(media.files.size).toBe(3);
    expect(await sounds.listSounds('someone')).toEqual([]);
  });

  it('is idempotent: a second start changes nothing and keeps the same ids', async () => {
    await pack(BASE, FILES);
    await seed();
    const first = await sounds.listSounds(null);
    await seed();
    expect(await sounds.listSounds(null)).toEqual(first);
    expect(media.files.size).toBe(3);
  });

  it('follows a changed pack: edits, additions and removals, dropping clips no longer used', async () => {
    await pack(BASE, FILES);
    await seed();
    const next: CatalogueManifest = {
      ...BASE,
      sounds: [{ key: 'rain', name: 'Heavy rain', category: 'ambience', takes: ['a/rain2.ogg'] }],
      boards: [],
      scenes: [],
    };
    await pack(next, { 'a/rain2.ogg': OGG(9) });
    await seed();
    const shared = await sounds.listSounds(null);
    expect(shared.map((s) => s.name)).toEqual(['Heavy rain']);
    expect(await sounds.listBoards(null)).toEqual([]);
    expect(await sounds.listScenes(null)).toEqual([]);
    expect(media.files.size).toBe(1);
  });

  it("never touches a DM's own library", async () => {
    await pack(BASE, FILES);
    await sounds.putSound({
      id: 'mine',
      ownerId: 'dm-1',
      name: 'Mine',
      category: 'effect',
      tags: [],
      takes: [],
      createdAt: 1,
    });
    await seed();
    expect((await sounds.listSounds('dm-1')).map((s) => s.id)).toEqual(['mine']);
  });

  it('refuses a pack that names a missing clip or an unknown sound, and writes nothing', async () => {
    await pack(BASE, { 'a/rain.ogg': OGG(1) });
    await expect(seed()).rejects.toThrow(/a\/d1\.ogg/);
    expect(await sounds.listSounds(null)).toEqual([]);
    await pack(
      { ...BASE, scenes: [{ key: 's', name: 'S', layers: [{ sound: 'nope', mode: 'loop' }] }] },
      FILES,
    );
    await expect(seed()).rejects.toThrow(/nope/);
  });

  it('does nothing without a pack directory', async () => {
    dir = path.join(tmpdir(), 'no-such-catalogue-dir');
    expect(await seed()).toEqual({ sounds: 0, boards: 0, scenes: 0 });
  });
});
