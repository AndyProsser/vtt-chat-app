import { describe, expect, it } from 'vitest';

import { MemoryTableStore } from '../table/memoryTableStore.js';
import type { MediaFile } from '../table/tableStore.js';
import { HANDOUT_MEDIA_GRACE_MS, HandoutMediaSweeper } from './handoutMediaSweeper.js';
import type { MediaStorage } from './mediaStorage.js';

const file = (id: string, kind: MediaFile['kind'], createdAt: number): MediaFile => ({
  id,
  ownerId: null,
  kind,
  mime: kind === 'pdf' ? 'application/pdf' : 'image/png',
  bytes: 10,
  sha256: 'x',
  originalName: `${id}.bin`,
  createdAt,
});

describe('HandoutMediaSweeper', () => {
  it('removes old pictures and PDFs no handout uses, and leaves everything else', async () => {
    const table = new MemoryTableStore();
    const now = 10 * HANDOUT_MEDIA_GRACE_MS;
    const files = new Map<string, Buffer>();
    for (const id of ['used', 'orphan-image', 'orphan-pdf', 'fresh-orphan', 'a-sound']) {
      files.set(id, Buffer.from('x'));
    }
    await table.putMedia(file('used', 'image', 1));
    await table.putMedia(file('orphan-image', 'image', 1));
    await table.putMedia(file('orphan-pdf', 'pdf', 1));
    await table.putMedia(file('fresh-orphan', 'image', now - 1000));
    await table.putMedia(file('a-sound', 'audio', 1));
    await table.putHandout({
      id: 'h1',
      campaignId: 'c1',
      createdBy: 'u',
      kind: 'image',
      title: 'Map',
      body: null,
      mediaIds: ['used'],
      createdAt: 1,
      recipients: [],
    } as never);
    const media: MediaStorage = {
      put: async () => undefined,
      get: async (id) => files.get(id),
      delete: async (id) => void files.delete(id),
    };

    expect(await new HandoutMediaSweeper(table, media, () => now).sweep()).toBe(2);
    expect([...files.keys()].sort()).toEqual(['a-sound', 'fresh-orphan', 'used']);
    // The operator's sweep after deleting a campaign has no grace: even a fresh orphan goes.
    expect(await new HandoutMediaSweeper(table, media, () => now).sweep(0)).toBe(1);
    expect([...files.keys()].sort()).toEqual(['a-sound', 'used']);
  });
});
