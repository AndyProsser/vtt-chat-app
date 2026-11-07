import {
  canSeeHandout,
  type Handout,
  type MediaFile,
  type TableStore,
  type Viewer,
} from './tableStore.js';

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryTableStore implements TableStore {
  readonly media = new Map<string, MediaFile>();
  readonly handouts = new Map<string, Handout>();

  putMedia = async (f: MediaFile) => void this.media.set(f.id, copy(f));
  getMedia = async (id: string) => {
    const f = this.media.get(id);
    return f ? copy(f) : undefined;
  };
  deleteMedia = async (id: string) => void this.media.delete(id);

  campaignHandoutBytes = async (campaignId: string) => {
    let total = 0;
    for (const h of this.handouts.values()) {
      if (h.campaignId === campaignId && h.mediaId) total += this.media.get(h.mediaId)?.bytes ?? 0;
    }
    return total;
  };

  putHandout = async (h: Handout) => void this.handouts.set(h.id, copy(h));
  getHandout = async (id: string) => {
    const h = this.handouts.get(id);
    return h ? copy(h) : undefined;
  };
  listHandouts = async (campaignId: string, viewer: Viewer) =>
    [...this.handouts.values()]
      .filter((h) => h.campaignId === campaignId && canSeeHandout(h, viewer))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(copy);
  deleteHandout = async (id: string) => void this.handouts.delete(id);
}
