import { describe, expect, it } from 'vitest';

import { MemoryStore } from '../store/memoryStore.js';
import { AvatarSweeper, AVATAR_GRACE_MS } from './avatarSweeper.js';
import type { MediaStorage } from './mediaStorage.js';

describe('AvatarSweeper', () => {
  it('removes old unused portraits and leaves used, fresh and unrelated files alone', async () => {
    const store = new MemoryStore();
    const files = new Map<string, Buffer>(
      ['used', 'old-unused', 'fresh-unused', 'handout-file'].map((id) => [id, Buffer.from('x')]),
    );
    const media: MediaStorage = {
      put: async () => undefined,
      get: async (id) => files.get(id),
      delete: async (id) => void files.delete(id),
    };
    const now = 10 * AVATAR_GRACE_MS;
    await store.putUser({
      id: 'u1',
      email: 'a@x.test',
      displayName: 'A',
      passwordHash: null,
      isAdmin: false,
      consentVersion: '1',
      consentAt: 1,
      createdAt: 1,
      avatarUrl: 'avatar:used',
    });
    await store.recordAvatarFile('used', 'u1', 1);
    await store.recordAvatarFile('old-unused', 'u1', 1);
    await store.recordAvatarFile('fresh-unused', 'u1', now - 1000);
    // 'handout-file' was never recorded as a portrait.

    expect(await new AvatarSweeper(store, media, () => now).sweep()).toBe(1);
    expect([...files.keys()].sort()).toEqual(['fresh-unused', 'handout-file', 'used']);
    expect(await new AvatarSweeper(store, media, () => now).sweep()).toBe(0);
  });
});
