import type { ItemType, Rarity } from '@vtt-chat-app/shared';

import type { MediaKind } from '../media/mediaStorage.js';

export interface MediaFile {
  id: string;
  ownerId: string | null;
  kind: MediaKind;
  mime: string;
  bytes: number;
  sha256: string;
  originalName: string;
  createdAt: number;
}

export type HandoutKind = 'image' | 'map' | 'pdf' | 'text';
/** dm: a draft only the DM sees · all: every member · some: the listed members. */
export type HandoutVisibility = 'dm' | 'all' | 'some';

export interface Handout {
  id: string;
  campaignId: string;
  title: string;
  kind: HandoutKind;
  /** Text snippets only. */
  body: string | null;
  /** Everything else: the uploaded file. */
  /** The files in order: one PDF, or up to twelve pictures; none for a note. */
  mediaIds: string[];
  visibility: HandoutVisibility;
  /** Who may see it when `visibility` is `some`. */
  recipients: string[];
  createdBy: string | null;
  createdAt: number;
}

/** Who is asking. The store applies visibility itself, so no caller can forget it. */
export interface Viewer {
  userId: string;
  isDm: boolean;
}

export type LootKind = 'item' | 'coin';
/** Where a grabbed item went: the player's own, the party's shared pool, or a split of coin. */
export type ClaimedFor = 'self' | 'party' | 'split' | 'assigned';
export interface LootSplit {
  shares: {
    userId: string;
    amount: number;
    /** The player has put their share on their game sheet. */ confirmed?: boolean;
  }[];
  /** Coin that did not divide evenly; it stays in the pool. */
  remainder: number;
}

export interface LootItem {
  id: string;
  campaignId: string;
  kind: LootKind;
  /** What it is, for the icon (`coin` for coin). */
  itemType: ItemType;
  /** SRD rarity for a magic item; `null` for mundane and custom-mundane items. */
  rarity: Rarity | null;
  /** The SRD item this was made from; `null` for a custom item. */
  srdId: string | null;
  name: string;
  description: string;
  quantity: number;
  droppedBy: string | null;
  droppedAt: number;
  /** Set when a player picks it up; `null` while it is still on the table. */
  claimedBy: string | null;
  claimedAt: number | null;
  claimedFor: ClaimedFor | null;
  /** Set only when a coin pile was split. */
  split: LootSplit | null;
  /** The holder (or, for the party stash, any player) has added it to the real game sheet. Reset on every move. */
  confirmed: boolean;
}

/**
 * Storage for the table features (Stage 6): uploaded files' metadata, handouts, and — as they are
 * built — loot and the soundboard. Postgres is the real one; the in-memory one backs tests.
 */
export interface TableStore {
  putMedia(file: MediaFile): Promise<void>;
  getMedia(id: string): Promise<MediaFile | undefined>;
  deleteMedia(id: string): Promise<void>;
  /**
   * Pictures and PDFs uploaded before `olderThan` that no handout uses: what is left when a whole campaign is
   * deleted (its handouts go, their files do not), and uploads that were never turned into a handout.
   */
  listUnusedHandoutMedia(olderThan: number): Promise<string[]>;
  /** Bytes of audio an account has uploaded to its sound library, for its quota. */
  ownerAudioBytes(ownerId: string): Promise<number>;
  /** Bytes of files attached to a campaign's handouts, for its storage quota. */
  campaignHandoutBytes(campaignId: string): Promise<number>;

  putHandout(handout: Handout): Promise<void>;
  getHandout(id: string): Promise<Handout | undefined>;
  /** The handouts this viewer may see: all of them for the DM, otherwise shared-with-everyone or shared-with-them. */
  listHandouts(campaignId: string, viewer: Viewer): Promise<Handout[]>;
  deleteHandout(id: string): Promise<void>;

  putLoot(item: LootItem): Promise<void>;
  getLoot(id: string): Promise<LootItem | undefined>;
  /** Every item dropped in a campaign, oldest first, claimed or not. */
  listLoot(campaignId: string): Promise<LootItem[]>;
  /**
   * Gives an unclaimed item to `userId`. **Atomic**: if two players claim at once, exactly one
   * gets the item and the other gets `undefined`. Returns the item as claimed, or `undefined`.
   */
  claimLoot(
    id: string,
    userId: string,
    at: number,
    claimedFor: ClaimedFor,
    split?: LootSplit,
  ): Promise<LootItem | undefined>;
  /**
   * Changes how an item the player took is held: `to` is `'party'` (stored in the shared stash) or
   * `null` (returned to the table, unclaimed). **Atomic** and only for the player who holds it, in one
   * of the `from` states; otherwise `undefined`.
   */
  changeClaim(
    id: string,
    userId: string,
    from: ClaimedFor[],
    to: 'party' | null,
  ): Promise<LootItem | undefined>;
  /**
   * Any player takes an item out of the party stash for themselves. **Atomic**: only while it is in
   * the stash, so of two players taking at once exactly one gets it; otherwise `undefined`.
   */
  takeFromParty(id: string, userId: string, at: number): Promise<LootItem | undefined>;
  /** Any player puts a party-stash item back on the table, unclaimed. **Atomic**, as above. */
  returnFromParty(id: string): Promise<LootItem | undefined>;
  /**
   * Sets the "added to my sheet" flag as `userId` sees it: on an item they hold, on the party stash (any player),
   * or on their own share of a split pile. `undefined` when the item is not one of those for them.
   */
  confirmLoot(id: string, userId: string, confirmed: boolean): Promise<LootItem | undefined>;
  /**
   * Moves an item still on the table to `at` in the chat: its card is drawn where it was dropped, so a re-drop is a
   * new drop time. **Atomic**, and only while nobody holds it; otherwise `undefined`.
   */
  redropLoot(id: string, at: number): Promise<LootItem | undefined>;
  deleteLoot(id: string): Promise<void>;
}

/** Whether a viewer may see a handout. The in-memory store uses it; the Postgres store mirrors it in SQL. */
export function canSeeHandout(handout: Handout, viewer: Viewer): boolean {
  if (viewer.isDm) return true;
  if (handout.visibility === 'all') return true;
  return handout.visibility === 'some' && handout.recipients.includes(viewer.userId);
}
