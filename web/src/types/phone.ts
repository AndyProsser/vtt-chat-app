import type { ChatKind } from '@vtt-chat-app/shared';

/** What the phone app reads from the server. Only the fields it uses. */

export type Role = 'dm' | 'player';

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
  character: { name: string } | null;
  online: boolean;
}

export interface CampaignItem {
  id: string;
  name: string;
  role: Role;
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
}

export interface Utterance {
  speaker: { id: string; name: string };
  startMs: number;
  endMs: number;
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
