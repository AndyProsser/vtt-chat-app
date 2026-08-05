# rust-livekit

Native Rust LiveKit client — the only thing that talks WebRTC in this app. See [CLAUDE.md §8.2](../../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

- Native WebRTC connection to the LiveKit server
- Native audio device control and echo cancellation
- Track and group (channel) management
- Native audio FX
- Native recording (future)
- Long-session stability — this runs for the lifetime of the app, not per-window, so switching or closing Tauri windows never interrupts audio (see [CLAUDE.md §8.1 "Audio continuity"](../../CLAUDE.md))
- Exposes Tauri commands consumed by `src-tauri/` and, indirectly, `overlay-ui/`

## Language / Tooling

Rust, part of the Cargo workspace rooted at `tauri-client/`. `rustfmt` + `clippy` clean, per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Depends On

Nothing else in-repo. This is a leaf crate — `src-tauri/` depends on it, not the other way around.
