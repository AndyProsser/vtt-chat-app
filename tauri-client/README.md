# tauri-client

The cross-platform Tauri desktop client — see [CLAUDE.md §8.1](../CLAUDE.md) and [docs/architecture/OVERVIEW.md](../docs/architecture/OVERVIEW.md).

**Status:** scaffold only — not yet implemented.

This is a Cargo workspace (for `src-tauri/` and `rust-livekit/`) that also hosts one npm package (`overlay-ui/`) built and bundled into the Tauri app.

## Submodules

- **[src-tauri/](src-tauri/README.md)** — the Tauri shell: window management, page restriction, ad-blocking, global hotkeys, and the command bridge to `rust-livekit`.
- **[rust-livekit/](rust-livekit/README.md)** — native LiveKit client: WebRTC, audio device control, track/group management.
- **[overlay-ui/](overlay-ui/README.md)** — the React + Radix UI Shadow DOM overlay injected into DDB Maps.

## Why One Client, Not a Client + Extension

Unlike the archived `vtt-chat-extension`, this app does DDB cookie detection and DOM extraction itself, inside the WebView — no separate browser extension to build or distribute. See [CLAUDE.md §15–16](../CLAUDE.md).

## Cross-Platform Targets

Windows (WebView2), macOS (WebKit), Linux GNOME/KDE (WebKitGTK) — see [CLAUDE.md §12](../CLAUDE.md). `rust-livekit` is responsible for consistent audio behavior across all three.
