//! Tauri event names emitted to the panel pages. Mirrored in `shared/src/consts/index.ts` — Rust
//! can't import the TS package (CLAUDE.md §3), so the names are duplicated and must be kept in
//! step by hand.

pub const PANEL_TOGGLE_EVENT: &str = "panel:toggle";
pub const MICROPHONE_STATE_EVENT: &str = "livekit:microphone";
pub const SPEAKERS_STATE_EVENT: &str = "livekit:speakers";
