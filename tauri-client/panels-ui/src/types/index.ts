/** `account_status` — never carries the session token. */
export interface AccountStatus {
  signedIn: boolean;
  server: string | null;
  campaignId: string | null;
  userId: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  campaigns: { id: string; name: string; role: string }[];
}

export interface AccountError {
  code: string;
  message: string;
}

export interface Member {
  userId: string;
  displayName: string;
  /** The person's own portrait, used when their character has none. */
  avatarUrl?: string | null;
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
  /** Their own choice: online, away (in the room, mic closed) or offline (out of voice; chat stays on). */
  status: 'online' | 'away' | 'offline';
}

export interface ChatLine {
  id: string;
  from: { userId: string; name: string };
  /** Present for a whisper: the one other person who can read it. */
  to?: { userId: string; name: string };
  text: string;
  at: number;
  /** What the line is (CHAT-COMMANDS.md); a line from a server that predates kinds is `chat`. */
  kind: 'chat' | 'say' | 'do' | 'ooc';
  /** The language key of a `say` line. */
  lang?: string;
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
  /** The operator's grace period in seconds (how long the DM may be away), when the server said. */
  graceSeconds?: number;
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
  /** What a loot item is, when the server sent it (shown when the card is opened). */
  description?: string;
  /** A pile of coin rather than an item (`title` is then the currency). */
  coin?: boolean;
  itemType?: ItemType;
  rarity?: Rarity | null;
  claimedBy?: string | null;
  claimedFor?: ClaimedFor | null;
  split?: LootSplit | null;
  /** A handout's kind, so its card can show a picture or the start of the text. */
  handoutKind?: 'image' | 'map' | 'pdf' | 'text';
  /** The start of a text handout, for the card's three-line preview. */
  excerpt?: string;
  /** How many pictures a picture handout holds. */
  fileCount?: number;
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
export interface SoundRecord {
  id: string;
  name: string;
  category?: string;
}
export type SoundScene = import('../lib/sceneDraft.js').SceneRecord;
export interface SoundLibrary {
  sounds: SoundRecord[];
  boards: SoundBoard[];
  scenes: SoundScene[];
}

export interface Handout {
  id: string;
  title: string;
  kind: 'image' | 'map' | 'pdf' | 'text';
  body: string | null;
  hasFile: boolean;
  /** Pictures in a picture handout (1 for a PDF, 0 for a note). */
  fileCount: number;
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

/** What `account_device_start` answers (`expiresAt` is the server's clock: informational only). */
export interface DeviceStart {
  requestId: string;
  userCode: string;
  pollSecret: string;
  expiresAt: number;
  approveUrl: string;
}

/** A `vtt-chat://connect` link the OS handed to the app: it fills the form, never signs in. */
export interface ConnectLink {
  server: string;
  code: string | null;
}

/** The person's own request on an open table (`GET /api/campaigns/open`); times are epoch ms. */
export interface MyJoinRequest {
  id: string;
  status: 'pending' | 'declined';
  createdAt: number;
  /** Declined only: when they may ask again. */
  retryAfter?: number;
}

export interface OpenCampaignCard {
  id: string;
  name: string;
  dmName: string;
  playerCount: number;
  myRequest: MyJoinRequest | null;
}

/** One row of the DM's list of requests. */
export interface JoinRequestRow {
  id: string;
  campaignId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  message: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** Allow join is off: the request is kept but cannot be approved. */
  closed: boolean;
}

/** The DM's view of the current campaign's join requests. */
export interface JoinInbox {
  campaignId: string | null;
  allowJoin: boolean;
  requests: JoinRequestRow[];
}
