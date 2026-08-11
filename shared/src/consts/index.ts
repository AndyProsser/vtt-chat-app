/**
 * Tauri event names emitted by `src-tauri` and listened for in `overlay-ui`.
 *
 * Mirrored in `tauri-client/src-tauri/src/consts.rs` — Rust is confined to `tauri-client/` and
 * can't import this package (CLAUDE.md §3), so the two sides are kept in sync by hand. Change
 * one, change the other.
 */
export const COBALT_COOKIE_EVENT = 'ddb:cobalt-cookie';
export const LIVEKIT_STATE_EVENT = 'livekit:state';
export const LIVEKIT_MICROPHONE_EVENT = 'livekit:microphone';
export const OVERLAY_TOGGLE_EVENT = 'overlay:toggle';
