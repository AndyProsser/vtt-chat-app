# tauri-client

The cross-platform **system-tray** client — see [CLAUDE.md §8.1](../.claude/CLAUDE.md) and [docs/architecture/OVERVIEW.md](../docs/architecture/OVERVIEW.md).

**Status:** mid-pivot. `rust-livekit/` (audio) is reusable and is the focus of [ROADMAP Stage 2](../ROADMAP.md#stage-2--audio--records-spike). `src-tauri/` and `overlay-ui/` still contain the previous design's browser/overlay code and are slated for removal/replacement in [Stage 1](../ROADMAP.md#stage-1--pivot-cleanup).

A tiny app that lives in the tray, with floating React panels the user opens when they want them. It serves **only its own pages** — no embedded browser, no remote origins, no injected content. Players leave it hidden ~90% of the time, so it is built to be quiet: near-zero idle CPU, autostart, auto-update, auto-rejoin, crash recovery, and a tray icon that always shows live / muted / recording / disconnected.

This is a Cargo workspace (`src-tauri/` and `rust-livekit/`) that also hosts one npm package (`panels-ui/`, currently still named `overlay-ui/`) bundled into the app.

## Submodules

- **[src-tauri/](src-tauri/README.md)** — the Tauri shell: tray, panel windows, hotkeys, autostart, updater, and the command bridge to `rust-livekit`.
- **[rust-livekit/](rust-livekit/README.md)** — the audio engine and LiveKit client: capture, echo cancellation, noise suppression, mixer, per-player gain, the local cue/soundboard player, auto-rejoin.
- **[overlay-ui/](overlay-ui/README.md)** — _legacy_; becomes `panels-ui/` — the React + Radix panels.

## Why Rust Owns Audio

Audio never passes through a webview. That is the main reason this is an app and not a web page: native capture and playback, real echo cancellation, device control (including releasing the capture device on mute so OS mic indicators turn off), and a cue player that is independent of the SFU and absent from recordings.

## Cross-Platform Targets

Priority: **Windows** (WebView2; most players) > **Linux** (WebKitGTK, GNOME/KDE; Andy) > macOS (WebKit; possibly later). See [CLAUDE.md §12](../.claude/CLAUDE.md). Tray and global-shortcut support varies by desktop (GNOME needs an AppIndicator extension; Wayland blocks global shortcuts) and the client degrades gracefully rather than failing silently. `rust-livekit` is responsible for consistent audio behaviour across all three.
