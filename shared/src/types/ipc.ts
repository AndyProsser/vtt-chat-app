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

/**
 * Payload of the `livekit:microphone` Tauri event, emitted by `src-tauri`'s hotkey dispatch
 * whenever push-to-talk or the mute toggle changes the microphone gate (Stage 2).
 *
 * Separate from `LiveKitConnectionState` on purpose: mute changes on every push-to-talk press,
 * so folding it into the connection-state payload would churn the participant list alongside it.
 */
export interface MicrophoneStatePayload {
  muted: boolean;
}
