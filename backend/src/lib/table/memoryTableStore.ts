import {
  canSeeHandout,
  type Handout,
  type ClaimedFor,
  type GlossaryTerm,
  type GmNoteFile,
  type GmNotes,
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
  readonly gmNotes = new Map<string, GmNotes>();
  readonly gmNoteFiles = new Map<string, GmNoteFile>();
  readonly glossary = new Map<string, GlossaryTerm>();

  putMedia = async (f: MediaFile) => void this.media.set(f.id, copy(f));
  getMedia = async (id: string) => {
    const f = this.media.get(id);
    return f ? copy(f) : undefined;
  };
  deleteMedia = async (id: string) => void this.media.delete(id);

  listUnusedHandoutMedia = async (olderThan: number) => {
    const used = new Set([
      ...[...this.handouts.values()].flatMap((h) => h.mediaIds),
      ...[...this.gmNoteFiles.values()].map((f) => f.mediaId),
    ]);
    return [...this.media.values()]
      .filter(
        (m) =>
          (m.kind === 'image' || m.kind === 'pdf') && m.createdAt < olderThan && !used.has(m.id),
      )
      .map((m) => m.id);
  };

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
    for (const f of this.gmNoteFiles.values()) {
      if (f.campaignId === campaignId) total += this.media.get(f.mediaId)?.bytes ?? 0;
    }
    return total;
  };

  getGmNotes = async (campaignId: string) => {
    const n = this.gmNotes.get(campaignId);
    return n ? copy(n) : undefined;
  };
  putGmNotes = async (n: GmNotes) => void this.gmNotes.set(n.campaignId, copy(n));
  listGmNoteFiles = async (campaignId: string) =>
    [...this.gmNoteFiles.values()]
      .filter((f) => f.campaignId === campaignId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(copy);
  getGmNoteFile = async (id: string) => {
    const f = this.gmNoteFiles.get(id);
    return f ? copy(f) : undefined;
  };
  putGmNoteFile = async (f: GmNoteFile) => void this.gmNoteFiles.set(f.id, copy(f));
  deleteGmNoteFile = async (id: string) => void this.gmNoteFiles.delete(id);

  listGlossary = async (campaignId: string) =>
    [...this.glossary.values()]
      .filter((t) => t.campaignId === campaignId)
      .sort(
        (a, b) =>
          a.term.toLowerCase().localeCompare(b.term.toLowerCase()) || a.id.localeCompare(b.id),
      )
      .map(copy);
  getGlossaryTerm = async (id: string) => {
    const t = this.glossary.get(id);
    return t ? copy(t) : undefined;
  };
  putGlossaryTerm = async (t: GlossaryTerm) => {
    const clash = [...this.glossary.values()].some(
      (o) =>
        o.id !== t.id &&
        o.campaignId === t.campaignId &&
        o.term.toLowerCase() === t.term.toLowerCase(),
    );
    if (clash) return false;
    this.glossary.set(t.id, copy(t));
    return true;
  };
  deleteGlossaryTerm = async (id: string) => void this.glossary.delete(id);

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
    item.confirmed = false;
    return copy(item);
  };
  takeFromParty = async (id: string, userId: string, at: number) => {
    const item = this.loot.get(id);
    if (!item || item.claimedFor !== 'party') return undefined;
    item.claimedBy = userId;
    item.claimedAt = at;
    item.claimedFor = 'self';
    item.confirmed = false;
    return copy(item);
  };
  returnFromParty = async (id: string) => {
    const item = this.loot.get(id);
    if (!item || item.claimedFor !== 'party') return undefined;
    item.claimedBy = null;
    item.claimedAt = null;
    item.claimedFor = null;
    item.split = null;
    item.confirmed = false;
    return copy(item);
  };
  changeClaim = async (id: string, userId: string, from: ClaimedFor[], to: 'party' | null) => {
    const item = this.loot.get(id);
    if (!item || item.claimedBy !== userId || !item.claimedFor || !from.includes(item.claimedFor))
      return undefined;
    if (to === null) {
      item.claimedBy = null;
      item.claimedAt = null;
      item.claimedFor = null;
      item.split = null;
    } else {
      item.claimedFor = to;
    }
    item.confirmed = false;
    return copy(item);
  };
  confirmLoot = async (id: string, userId: string, confirmed: boolean) => {
    const item = this.loot.get(id);
    if (!item || item.claimedBy === null) return undefined;
    if (item.claimedFor === 'split') {
      const share = item.split?.shares.find((s) => s.userId === userId);
      if (!share) return undefined;
      share.confirmed = confirmed;
    } else if (item.claimedFor === 'party' || item.claimedBy === userId) {
      item.confirmed = confirmed;
    } else return undefined;
    return copy(item);
  };
  redropLoot = async (id: string, at: number) => {
    const item = this.loot.get(id);
    if (!item || item.claimedBy !== null) return undefined;
    item.droppedAt = at;
    return copy(item);
  };
  deleteLoot = async (id: string) => void this.loot.delete(id);
}
