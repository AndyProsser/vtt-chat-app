/** `account_status` — never carries the session token. */
export interface AccountStatus {
  signedIn: boolean;
  server: string | null;
  campaignId: string | null;
  userId: string | null;
  displayName: string | null;
  campaigns: { id: string; name: string; role: string }[];
}

export interface AccountError {
  code: string;
  message: string;
}

export interface Member {
  userId: string;
  displayName: string;
  role: 'dm' | 'player';
  character: {
    name: string;
    avatarUrl?: string | null;
    race?: string | null;
    className?: string | null;
    level?: number | null;
  } | null;
  online: boolean;
  inVoice: boolean;
  muted: boolean;
}

export interface ChatLine {
  id: string;
  from: { userId: string; name: string };
  /** Present for a whisper: the one other person who can read it. */
  to?: { userId: string; name: string };
  text: string;
  at: number;
}

/** One forwarded server event (`sync:event`). */
export interface SyncEvent {
  t: string;
  d: unknown;
  seq?: number;
}

export interface Hydration {
  snapshot: SyncEvent | null;
  events: SyncEvent[];
}

/** The campaign's recording as the server last told us; `null` when nothing is recording. */
export interface RecordingView {
  recordingId: string;
  capturing: boolean;
  /** Epoch ms on the server's clock; `null` if the server did not say. */
  startedAt: number | null;
}

export type RecordingAction = 'start' | 'pause' | 'resume' | 'stop';

export interface Party {
  id: string;
  name: string;
}

/** Voice groups as the server last told us (`party.state`). */
export interface PartyView {
  parties: Party[];
  /** userId → party id; absent means "not in a group". */
  assignments: Record<string, string>;
  split: boolean;
}

/** A loot or handout notice shown inline in chat; `after` is the chat line it follows. */
export interface TableCard {
  id: string;
  kind: 'loot' | 'handout';
  title: string;
  quantity?: number;
  /** A pile of coin rather than an item (`title` is then the currency). */
  coin?: boolean;
  itemType?: ItemType;
  rarity?: Rarity | null;
  claimedBy?: string | null;
  claimedFor?: ClaimedFor | null;
  split?: LootSplit | null;
  removed?: boolean;
  after: string | null;
}

export type TimelineEntry = { type: 'line'; line: ChatLine } | { type: 'card'; card: TableCard };

export interface TableState {
  members: Member[];
  chat: ChatLine[];
  cards: TableCard[];
  recording: RecordingView | null;
  parties: PartyView;
}

export interface SoundButton {
  id: string;
  label: string;
  soundId: string;
  mode: 'oneshot' | 'loop';
  volume: number;
  note: string;
}
export interface SoundBoard {
  id: string;
  name: string;
  buttons: SoundButton[];
}
export interface SoundScene {
  id: string;
  name: string;
}
export interface SoundLibrary {
  boards: SoundBoard[];
  scenes: SoundScene[];
}

export interface Handout {
  id: string;
  title: string;
  kind: 'image' | 'map' | 'pdf' | 'text';
  body: string | null;
  hasFile: boolean;
  visibility: 'dm' | 'all' | 'some';
}

export type ItemType =
  | 'weapon'
  | 'ammunition'
  | 'armor'
  | 'shield'
  | 'potion'
  | 'scroll'
  | 'ring'
  | 'rod'
  | 'staff'
  | 'wand'
  | 'wondrous'
  | 'gear'
  | 'tool'
  | 'mount'
  | 'trade'
  | 'gem'
  | 'art'
  | 'coin'
  | 'other';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'very rare' | 'legendary' | 'artifact';

/** One thing in a random roll or a custom drop, before the DM drops it. */
export interface LootDraft {
  name: string;
  kind: 'item' | 'coin';
  quantity: number;
  description?: string;
  itemType: ItemType;
  rarity: Rarity | null;
  srdId?: string;
  /** Give it straight to this player when dropped (client-side choice; not part of a roll). */
  assignTo?: string;
}

export interface SrdItem {
  id: string;
  name: string;
  type: ItemType;
  magic: boolean;
  rarity: Rarity | null;
  attunement?: boolean;
  valueGp?: number;
  blurb?: string;
}

export type ClaimedFor = 'self' | 'party' | 'split' | 'assigned';
export interface LootSplit {
  shares: { userId: string; amount: number }[];
  remainder: number;
}

export interface LootItem {
  id: string;
  kind: 'item' | 'coin';
  itemType: ItemType;
  rarity: Rarity | null;
  srdId: string | null;
  name: string;
  description: string;
  quantity: number;
  claimedBy: string | null;
  claimedFor: ClaimedFor | null;
  split: LootSplit | null;
}

export type RsvpStatus = 'yes' | 'late' | 'no';

export interface SessionView {
  session: {
    id: string;
    startsAt: number;
    /** Minutes the session is expected to run. */
    durationMinutes: number;
    title: string;
    notes: string;
    cancelledAt: number | null;
  };
  rsvps: { userId: string; status: RsvpStatus }[];
  counts: Record<RsvpStatus, number>;
  mine: RsvpStatus | null;
}
