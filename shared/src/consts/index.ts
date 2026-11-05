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
