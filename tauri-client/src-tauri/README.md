# src-tauri

The Tauri shell (Rust). See [CLAUDE.md §8.1](../../CLAUDE.md).

**Status:** Stage 1 subset implemented — window creation, cobalt cookie detection/emission, overlay bundle injection, and the `livekit_connect`/`livekit_disconnect` commands. Multi-window, page restriction, ad-block, and hotkeys are Stage 2+.

## Responsibilities

- Multi-window management (open, detach, drag, resize; windows share one `rust-livekit` instance)
- Page restriction — allowlist navigation to `*.dndbeyond.com/*`, `*.wizards.com/*`, and a configured allowed list; block everything else
- Basic ad-blocking — request interception, block known ad/tracker/analytics domains, block autoplay video ads
- Overlay injection lifecycle — inject `overlay-ui` only on Maps VTT (with optional Character Sheet toggle and debug "everywhere" mode)
- Cobalt cookie detection (see [docs/architecture/DDB-AUTH.md](../../docs/architecture/DDB-AUTH.md))
- Global hotkeys — PTT, mute, group switch, overlay toggle
- Tauri commands bridging Rust ↔ JS (`overlay-ui` and `rust-livekit`)

## Language / Tooling

Rust, part of the Cargo workspace rooted at `tauri-client/`. `rustfmt` + `clippy` clean, per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Depends On

- `rust-livekit/` — via Tauri commands
- `overlay-ui/` — injected as the WebView overlay
