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
  character: { name: string; avatarUrl?: string | null } | null;
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
}

export type RecordingAction = 'start' | 'pause' | 'resume' | 'stop';

export interface TableState {
  members: Member[];
  chat: ChatLine[];
  recording: RecordingView | null;
}
