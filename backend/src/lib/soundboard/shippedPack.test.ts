import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MAX_SOUND_BYTES } from '../../consts/index.js';
import { MemoryMediaStorage } from '../media/mediaStorage.js';
import { MemoryTableStore } from '../table/memoryTableStore.js';
import { DEFAULT_CATALOGUE_DIR, seedCatalogue, type CatalogueManifest } from './catalogue.js';
import { MemorySoundStore } from './memorySoundStore.js';

const dir = fileURLToPath(DEFAULT_CATALOGUE_DIR);
const PACK_BUDGET_BYTES = 60 * 1024 * 1024; // the design's size budget (starter-sounds-design.md)

describe('the starter pack that ships with the server', () => {
  it('loads, and every scene and button points at a sound in the pack', async () => {
    const sounds = new MemorySoundStore();
    const result = await seedCatalogue({
      dir,
      sounds,
      table: new MemoryTableStore(),
      media: new MemoryMediaStorage(),
    });
    expect(result.sounds).toBeGreaterThan(0);
    const ids = new Set((await sounds.listSounds(null)).map((s) => s.id));
    for (const scene of await sounds.listScenes(null))
      for (const layer of scene.layers) expect(ids.has(layer.soundId), scene.name).toBe(true);
    for (const board of await sounds.listBoards(null))
      for (const b of board.buttons) expect(ids.has(b.soundId), b.label).toBe(true);
  });

  it('keeps each clip under the upload limit, the whole pack under budget, and credits every clip', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(dir, 'catalogue.json'), 'utf8'),
    ) as CatalogueManifest;
    const credits = await readFile(path.join(dir, 'SOURCES.md'), 'utf8').catch(() => '');
    let total = 0;
    for (const file of new Set(manifest.sounds.flatMap((s) => s.takes))) {
      const { size } = await stat(path.join(dir, file));
      expect(size, file).toBeLessThanOrEqual(MAX_SOUND_BYTES);
      total += size;
      if (manifest.sounds.length > 0) expect(credits, file).toContain(`\`${file}\``);
    }
    expect(total).toBeLessThanOrEqual(PACK_BUDGET_BYTES);
  });
});
