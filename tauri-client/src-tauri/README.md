# src-tauri

The Tauri shell (Rust). See [CLAUDE.md §8.1](../../.claude/CLAUDE.md).

**Status:** a windowless tray shell (2026-11-07): tray icon, mic gate, signed-in session and the consent flow are wired and verified; panels, sign-in UI, autostart and updater are not built. The previous design's allowlist, blocked page, homepage redirect, safety net, cobalt watcher, overlay injection and `remote-ddb` capability were removed in Stage 1. What remains: the app-level audio client, the Tauri commands, the hotkey plumbing, a strict CSP and a capability set with no remote origins. Stage 4 builds the tray and the panel windows.

Reusable from the old shell: `SharedClient` as app-level (`.manage()`) state so audio is independent of any window; the hotkey plumbing and its platform findings (see [DEVELOPING.md](../../DEVELOPING.md#shell-behaviour-hotkeys-carried-over)); the Tauri-command bridge to `rust-livekit`.

## Recording-consent coordinator

`src/recording.rs` is the client's half of the consent loop as a **pure state machine** (server events and "cue finished/failed" in; commands out: play a cue, hold/release the capture gate, send the acknowledgement, set the tray/panel indicator). It is driven by `src/shell.rs`. Rules and rationale: [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md#the-consent-loop-as-built-2026-11-05).

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

## The shell (Stage 4, in progress)

| Module        | What it does                                                                                                                                                                                                                                                                                               | Tested by                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `shell.rs`    | `Shell<P: Platform>`: turns server events into effects. Closes the capture gate **before** a start cue plays, plays cues one at a time, acknowledges only what was heard, re-announces voice state on every connect, signs out on revoke. Generic over `Platform` so none of it needs a window or speakers | 9 unit tests with a recording fake; `scripts/consent-live.sh` against a real backend |
| `mic_gate.rs` | The microphone is open only if the player is unmuted **and** the consent gate is released; neither can open the other                                                                                                                                                                                      | 5 unit tests                                                                         |
| `tray.rs`     | `tray_state(connected, mic_closed, indicator)` and a rendered icon per state (Disconnected / Muted / Live / Recording / Paused — recording and paused differ by shape, not only colour); the Tauri tray with Mute/Quit                                                                                     | 6 unit tests; the real app launched and created its tray                             |
| `session.rs`  | `session_sign_in` / `session_sign_out` commands: owns the `rust-sync` client, runs the `Shell`, implements `Platform` for the real app (cue through `rust-livekit`, tray, events to panels)                                                                                                                | `websocket_url` unit tests; live script                                              |

Events to panels: `sync:connection`, `recording:indicator`, `session:signed-out`, `livekit:microphone` (`{ muted, gated }`).

**Live check:** `npm run build -w @vtt-chat-app/backend && tauri-client/scripts/consent-live.sh` runs the real sync client and the `Shell` against a real backend and asserts the whole consent order.
