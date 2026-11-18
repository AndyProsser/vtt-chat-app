import type { TableStore } from '../table/tableStore.js';
import type { MediaStorage } from './mediaStorage.js';

/** A new upload has a day to become a handout before it counts as abandoned. */
export const HANDOUT_MEDIA_GRACE_MS = 24 * 3_600_000;

/**
 * Deletes pictures and PDFs no handout uses any more: the files of a campaign that was deleted (the handouts go
 * with the campaign, their files do not) and uploads that never became a handout. Sound clips and portraits
 * are never considered (the portrait sweeper and the sound library own those).
 */
export class HandoutMediaSweeper {
  constructor(
    private readonly table: TableStore,
    private readonly media: MediaStorage,
    private readonly now: () => number = Date.now,
  ) {}

  /** `graceMs` 0 sweeps everything unused at once (the operator just deleted a campaign). */
  async sweep(graceMs: number = HANDOUT_MEDIA_GRACE_MS): Promise<number> {
    const ids = await this.table.listUnusedHandoutMedia(this.now() - graceMs);
    for (const id of ids) {
      await this.media.delete(id);
      await this.table.deleteMedia(id);
    }
    return ids.length;
  }
}
