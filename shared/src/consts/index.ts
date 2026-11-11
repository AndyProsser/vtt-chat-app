/**
 * Tauri event names emitted by `src-tauri` and listened for in `panels-ui`.
 *
 * Mirrored in `tauri-client/src-tauri/src/consts.rs` — Rust is confined to `tauri-client/` and
 * can't import this package (CLAUDE.md §3), so the two sides are kept in sync by hand. Change
 * one, change the other.
 */
export const LIVEKIT_STATE_EVENT = 'livekit:state';
export const LIVEKIT_MICROPHONE_EVENT = 'livekit:microphone';
export const LIVEKIT_SPEAKERS_EVENT = 'livekit:speakers';
export const PANEL_TOGGLE_EVENT = 'panel:toggle';

/**
 * The wire-protocol version between the server and the desktop app (REST and WebSocket contracts, token and
 * recording/consent shapes). Bump it in the same change that alters any of them; that is also a MINOR version
 * bump (docs/architecture/VERSIONING-AND-DEPLOYMENT.md). Client and server must match on it.
 *
 * Mirrored in `tauri-client/src-tauri/src/consts.rs` (PROTOCOL_VERSION): keep the two in step by hand.
 */
export const PROTOCOL_VERSION = 1;
/** The header the app sends on every request so the server can refuse a client it cannot talk to. */
export const PROTOCOL_HEADER = 'x-vtt-protocol';
