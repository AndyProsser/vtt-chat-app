import {
  canSeeHandout,
  type Handout,
  type ClaimedFor,
  type LootItem,
  type LootSplit,
  type MediaFile,
  type TableStore,
  type Viewer,
} from './tableStore.js';

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryTableStore implements TableStore {
  readonly media = new Map<string, MediaFile>();
  readonly handouts = new Map<string, Handout>();
  readonly loot = new Map<string, LootItem>();

  putMedia = async (f: MediaFile) => void this.media.set(f.id, copy(f));
  getMedia = async (id: string) => {
    const f = this.media.get(id);
    return f ? copy(f) : undefined;
  };
  deleteMedia = async (id: string) => void this.media.delete(id);

  ownerAudioBytes = async (ownerId: string) =>
    [...this.media.values()]
      .filter((m) => m.ownerId === ownerId && m.kind === 'audio')
      .reduce((n, m) => n + m.bytes, 0);

  campaignHandoutBytes = async (campaignId: string) => {
    let total = 0;
    for (const h of this.handouts.values()) {
      if (h.campaignId !== campaignId) continue;
      for (const id of h.mediaIds) total += this.media.get(id)?.bytes ?? 0;
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

  putLoot = async (item: LootItem) => void this.loot.set(item.id, copy(item));
  getLoot = async (id: string) => {
    const item = this.loot.get(id);
    return item ? copy(item) : undefined;
  };
  listLoot = async (campaignId: string) =>
    [...this.loot.values()]
      .filter((i) => i.campaignId === campaignId)
      .sort((a, b) => a.droppedAt - b.droppedAt)
      .map(copy);
  // No await between the check and the write, so this is atomic on the single JS thread.
  claimLoot = async (
    id: string,
    userId: string,
    at: number,
    claimedFor: ClaimedFor,
    split?: LootSplit,
  ) => {
    const item = this.loot.get(id);
    if (!item || item.claimedBy !== null) return undefined;
    item.claimedBy = userId;
    item.claimedAt = at;
    item.claimedFor = claimedFor;
    item.split = split ? copy(split) : null;
    return copy(item);
  };
  deleteLoot = async (id: string) => void this.loot.delete(id);
}
