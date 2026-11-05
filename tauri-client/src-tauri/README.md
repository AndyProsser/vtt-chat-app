# src-tauri

The Tauri shell (Rust). See [CLAUDE.md §8.1](../../.claude/CLAUDE.md).

**Status:** a windowless shell. The previous design's allowlist, blocked page, homepage redirect, safety net, cobalt watcher, overlay injection and `remote-ddb` capability were removed in Stage 1. What remains: the app-level audio client, the Tauri commands, the hotkey plumbing, a strict CSP and a capability set with no remote origins. Stage 4 builds the tray and the panel windows.

Reusable from the old shell: `SharedClient` as app-level (`.manage()`) state so audio is independent of any window; the hotkey plumbing and its platform findings (see [DEVELOPING.md](../../DEVELOPING.md#shell-behaviour-hotkeys-carried-over)); the Tauri-command bridge to `rust-livekit`.

## Responsibilities (target)

- **Tray icon and state** — live / muted / recording / disconnected, driven from the Rust core, correct with zero panels open
- **Panel windows** — floating, user-positioned, local pages only; strict CSP and a capability set with **no remote origins**
- **Global hotkeys** — PTT / mute / panel toggle, with the platform limits documented (bare-modifier PTT is app-focused only; Wayland global shortcuts no-op)
- **Autostart, auto-update, crash recovery**
- **Recording-cue playback orchestration** (the playing itself is in `rust-livekit`)
- Tauri commands bridging Rust ↔ JS (`panels-ui` and `rust-livekit`)
- Graceful degradation where the tray isn't available (GNOME without AppIndicator)

## Language / Tooling

Rust, part of the Cargo workspace rooted at `tauri-client/`. `rustfmt` + `clippy` clean, per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Depends On

- `rust-livekit/` — the audio engine and LiveKit client
- `panels-ui/` — bundled as the panel pages
