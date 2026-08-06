/** Payload for the `livekit_connect` Tauri command, invoked by `overlay-ui` after session issuance. */
export interface LiveKitConnectCommandPayload {
  url: string;
  token: string;
}

/**
 * Payload of the `livekit:state` Tauri event, emitted by `rust-livekit` (via `src-tauri`)
 * whenever connection state or the participant list changes. Kept minimal for Stage 1 —
 * just enough for the overlay's "connected" + participant-list leaves.
 */
export interface LiveKitConnectionState {
  connected: boolean;
  roomName: string | null;
  participantIdentities: string[];
}

/** Payload of the `ddb:cobalt-cookie` Tauri event, emitted once `src-tauri` detects the cookie. */
export interface CobaltCookieDetectedPayload {
  cookieValue: string;
}
