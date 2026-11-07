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
  mediaId: string | null;
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

/**
 * Storage for the table features (Stage 6): uploaded files' metadata, handouts, and — as they are
 * built — loot and the soundboard. Postgres is the real one; the in-memory one backs tests.
 */
export interface TableStore {
  putMedia(file: MediaFile): Promise<void>;
  getMedia(id: string): Promise<MediaFile | undefined>;
  deleteMedia(id: string): Promise<void>;
  /** Bytes of files attached to a campaign's handouts, for its storage quota. */
  campaignHandoutBytes(campaignId: string): Promise<number>;

  putHandout(handout: Handout): Promise<void>;
  getHandout(id: string): Promise<Handout | undefined>;
  /** The handouts this viewer may see: all of them for the DM, otherwise shared-with-everyone or shared-with-them. */
  listHandouts(campaignId: string, viewer: Viewer): Promise<Handout[]>;
  deleteHandout(id: string): Promise<void>;
}

/** Whether a viewer may see a handout. The in-memory store uses it; the Postgres store mirrors it in SQL. */
export function canSeeHandout(handout: Handout, viewer: Viewer): boolean {
  if (viewer.isDm) return true;
  if (handout.visibility === 'all') return true;
  return handout.visibility === 'some' && handout.recipients.includes(viewer.userId);
}
