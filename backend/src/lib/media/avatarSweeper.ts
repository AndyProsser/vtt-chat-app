import type { Store } from '../store/store.js';
import type { MediaStorage } from './mediaStorage.js';

/** A new upload has a day to be chosen before it counts as abandoned (a picture is uploaded, then saved). */
export const AVATAR_GRACE_MS = 24 * 3_600_000;

/**
 * Deletes uploaded portraits nobody uses: replaced or removed pictures, and uploads never saved. Only
 * pictures recorded at upload time are ever considered, so other files in media storage (handouts,
 * sound clips) and pictures from before the record existed are never touched.
 */
export class AvatarSweeper {
  constructor(
    private readonly store: Store,
    private readonly media: MediaStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async sweep(): Promise<number> {
    const ids = await this.store.listUnusedAvatarFiles(this.now() - AVATAR_GRACE_MS);
    for (const id of ids) {
      await this.media.delete(id);
      await this.store.deleteAvatarFile(id);
    }
    return ids.length;
  }
}
