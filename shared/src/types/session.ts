import type { DdbIdentity } from './ddb.js';

/** Body of `POST /api/session` — the identity `ddb/` already extracted client-side. */
export interface SessionRequest {
  identity: DdbIdentity;
}

export interface LiveKitConnectionInfo {
  url: string;
  token: string;
  roomName: string;
}

/** Response from `POST /api/session` — an app-session JWT plus a ready-to-use LiveKit token. */
export interface SessionResponse {
  appSessionToken: string;
  liveKit: LiveKitConnectionInfo;
}

/** Claims encoded in the app-session JWT `backend/` issues and later verifies. */
export interface AppSessionClaims {
  ddbUserId: string;
  campaignId: string;
  isDm: boolean;
}
