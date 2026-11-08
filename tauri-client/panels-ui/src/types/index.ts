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

export interface TableState {
  members: Member[];
  chat: ChatLine[];
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

export interface LootItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  claimedBy: string | null;
}

export type RsvpStatus = 'yes' | 'late' | 'no';

export interface SessionView {
  session: {
    id: string;
    startsAt: number;
    title: string;
    notes: string;
    cancelledAt: number | null;
  };
  rsvps: { userId: string; status: RsvpStatus }[];
  counts: Record<RsvpStatus, number>;
  mine: RsvpStatus | null;
}
