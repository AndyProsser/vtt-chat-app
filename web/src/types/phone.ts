import type { ChatKind } from '@vtt-chat-app/shared';

/** What the phone app reads from the server. Only the fields it uses. */

export type Role = 'dm' | 'player';

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
  /** The person's own portrait, used when their character has none. */
  avatarUrl?: string | null;
  character: {
    name: string;
    avatarUrl?: string | null;
    race?: string | null;
    className?: string | null;
    level?: number | null;
  } | null;
  online: boolean;
  /** What they are connected with: the desktop app or this web app. Absent from an older server. */
  via?: 'web' | 'app' | null;
  /** Their own choice (online, away, or offline = out of voice, chat still on). Absent from old servers. */
  status?: 'online' | 'away' | 'offline';
}

export interface CampaignItem {
  id: string;
  name: string;
  role: Role;
  /** DM view of the campaign: it takes requests to join. Absent from an older server. */
  allowJoin?: boolean;
}

/** One line of the chat, public or whisper, from history or from the live stream. */
export interface ChatLine {
  id: string;
  at: number;
  fromId: string | null;
  fromName: string;
  /** Set for a whisper: who it was sent to. */
  toId: string | null;
  text: string;
  /** What kind of line: a missing kind from the server (old rows, old servers) is `chat`. */
  kind: ChatKind;
  /** Only on a `say` line: the language key (see CHAT_LANGUAGES). */
  lang?: string;
}

export type RsvpStatus = 'yes' | 'late' | 'no';

export interface SessionItem {
  session: {
    id: string;
    startsAt: number;
    durationMinutes: number;
    title: string;
    notes: string;
    cancelledAt: number | null;
  };
  counts: Record<RsvpStatus, number>;
  mine: RsvpStatus | null;
}

export type HandoutKind = 'text' | 'image' | 'map' | 'pdf';

export interface HandoutItem {
  id: string;
  title: string;
  kind: HandoutKind;
  body: string | null;
  fileCount: number;
  /** Who can see it: only the DM (a draft), everyone, or chosen players. Absent from an older server. */
  visibility?: 'dm' | 'all' | 'some';
  createdAt: number;
}

export interface RecordingItem {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  status: string;
  summaries: string[];
}

export interface SummaryItem {
  kind: string;
  subject: string | null;
  visibility: string;
  text: string;
  createdAt: number;
  /** A chapter summary: the scene the chapter began in. */
  title?: string;
}

export interface Utterance {
  speaker: { id: string; name: string };
  startMs: number;
  endMs: number;
  text: string;
  /** Typed into the table chat during the recording, not spoken. */
  typed?: boolean;
}

/** A scene the DM started during the recording, shown as a divider among the transcript lines. */
export interface SceneMarker {
  atMs: number;
  kind: 'scene';
  text: string;
}

export type LiveState = 'connecting' | 'live' | 'offline';

/** One match from the history search. The snippet is escaped text with the matches in <mark> tags. */
export interface SearchHit {
  recordingId: string;
  source: 'transcript' | 'summary' | 'chat';
  kind?: string;
  speakerName?: string;
  atMs?: number;
  snippet: string;
}

export type LootClaimedFor = 'self' | 'party' | 'split' | 'assigned';

/** One thing in the party's loot: what it is, and who (if anyone) took it. */
export interface LootItem {
  id: string;
  kind: 'item' | 'coin';
  itemType: string;
  rarity: string | null;
  name: string;
  description: string;
  quantity: number;
  droppedAt: number;
  claimedBy: string | null;
  claimedFor: LootClaimedFor | null;
  split: { shares: { userId: string; amount: number }[]; remainder: number } | null;
}
