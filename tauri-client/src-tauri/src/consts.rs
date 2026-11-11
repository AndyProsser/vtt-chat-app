//! Tauri event names emitted to the panel pages. Mirrored in `shared/src/consts/index.ts` — Rust
//! can't import the TS package (CLAUDE.md §3), so the names are duplicated and must be kept in
//! step by hand.

pub const PANEL_TOGGLE_EVENT: &str = "panel:toggle";
pub const MICROPHONE_STATE_EVENT: &str = "livekit:microphone";
pub const SPEAKERS_STATE_EVENT: &str = "livekit:speakers";

/// The wire-protocol version this app speaks. Mirrors `PROTOCOL_VERSION` in `shared/src/consts/index.ts`
/// (a test below fails if they differ). Bump both in the same change that alters a REST or WebSocket contract;
/// that is also a MINOR version bump (docs/architecture/VERSIONING-AND-DEPLOYMENT.md).
pub const PROTOCOL_VERSION: u32 = 1;
/// Sent on every request to the server, which answers `426 update_required` if it speaks another version.
pub const PROTOCOL_HEADER: &str = "x-vtt-protocol";

#[cfg(test)]
mod protocol_tests {
    #[test]
    fn the_protocol_version_matches_the_shared_typescript_constant() {
        let ts = include_str!("../../../shared/src/consts/index.ts");
        let line = ts
            .lines()
            .find(|l| l.starts_with("export const PROTOCOL_VERSION"))
            .expect("shared/src/consts/index.ts defines PROTOCOL_VERSION");
        let n: u32 = line
            .split('=')
            .nth(1)
            .and_then(|v| v.trim().trim_end_matches(';').parse().ok())
            .expect("a number");
        assert_eq!(n, super::PROTOCOL_VERSION);
    }
}
