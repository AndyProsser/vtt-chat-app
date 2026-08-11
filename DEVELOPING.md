# Developer Setup Guide

This project runs on **native services, not containers** — see [CLAUDE.md §4](CLAUDE.md). That applies to local development too: Postgres, Redis, LiveKit, and Caddy run directly on your machine, not in Docker.

**Status:** Stage 1 (walking skeleton — DDB auth, native audio, overlay injection) is implemented; see [ROADMAP.md](ROADMAP.md). Later stages are still scaffold-only.

Primary target: **Ubuntu Server / Ubuntu desktop**. Other Linux distros and macOS should work for development; Windows via WSL2 is untested but likely fine for the non-Tauri modules.

## Requirements

- **Node.js 26+** with npm — required to run anything in this repo at all, including `npm install` at the root (this repo uses npm workspaces — see [CLAUDE.md §3](CLAUDE.md)). npm ships with Node; no separate install. Verified against Node 26.5.1 / npm 12.0.2.
- **Rust** (stable, via [rustup](https://rustup.rs)) — needed for `tauri-client/src-tauri/` and `tauri-client/rust-livekit/`. `rustup` installs `cargo`/`rustc` but **not** a linker — `cargo build` will fail at the final link step without one:
  - **Windows:** install the "Desktop development with C++" workload from [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (the default `x86_64-pc-windows-msvc` target needs `link.exe` from it). Installing VS Code is not sufficient — it's a different product. Without this, `cargo build` fails with ``error: linker `link.exe` not found`` even though `cargo check`/`cargo clippy` on library targets still work. Separately, `rust-livekit`'s prebuilt `libwebrtc_sys` static lib is built against the static CRT (`/MT`), while rustc defaults to the dynamic CRT (`/MD`) on this target — this fails to link with `LNK2038` RuntimeLibrary-mismatch errors unless static CRT linkage is forced. Already handled by `tauri-client/.cargo/config.toml` (`target-feature=+crt-static`); no action needed, just don't remove that file.
  - **Linux:** `build-essential` (`apt install build-essential`) provides `cc`/`ld`.
  - **macOS:** the Xcode Command Line Tools (below) provide `clang`.
- **Tauri prerequisites** for your OS — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) (WebView2 on Windows, WebKitGTK on Linux, Xcode command line tools on macOS)
- **PostgreSQL** (native install, e.g. `apt install postgresql`)
- **Redis** (native install, e.g. `apt install redis-server`)
- **LiveKit server** (native binary — see [livekit/README.md](livekit/README.md))
- **Caddy** (native install, for the reverse proxy)

## Clone and Install

```bash
git clone https://github.com/AndyProsser/vtt-chat-app.git
cd vtt-chat-app
npm install
```

`npm install` at the root installs dependencies for every workspace package listed in the root `package.json`.

## Running Stage 1 Locally

Four things need to be running, in this order:

1. **LiveKit dev server** — `livekit-server --dev` (no config needed; prints `devkey`/`secret` as the API key/secret and binds `ws://127.0.0.1:7880`, which are `backend/`'s defaults below). For two-party testing across machines, run it on a shared dev box instead of localhost: `livekit-server --dev --bind 0.0.0.0` behind a systemd unit (`Restart=on-failure`), and point `LIVEKIT_URL` at `ws://<dev-host>:7880` from each machine's `backend/` env.
2. **Backend** — `cd backend && npm run build && npm start` (listens on `:4000`). Override via env vars if needed: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_JWT_SECRET`, `PORT`.
3. **Build the overlay bundle** — `cd tauri-client/overlay-ui && npm run build` (produces `dist/overlay.js`, which `src-tauri` reads from disk at startup — rebuild this after any overlay change, then relaunch the app).
4. **Tauri app** — `cd tauri-client && cargo run --bin vtt-chat-app`. Opens a window on D&D Beyond and injects the overlay; watch the terminal for `cookies_for_url failed`/`overlay bundle not found` if something's off.

## Shell Behaviour (Stage 2)

Once the app is running, the Tauri shell enforces a few things that are easy to mistake for bugs:

**The microphone starts muted.** This is true push-to-talk — nothing is transmitted until you hold the PTT key. The overlay shows `Mic muted` / `Mic live`.

| Shortcut | Action | Works when |
| --- | --- | --- |
| Right Ctrl (hold) | Push to talk | App window focused, all platforms |
| Ctrl+Shift+M | Toggle mute | Globally on Windows/macOS/Linux X11; app-focused on Wayland |
| Ctrl+Shift+O | Show/hide overlay | Globally on Windows/macOS/Linux X11; app-focused on Wayland |

On a Wayland session the app prints a startup line saying OS-level shortcuts are unavailable — that's expected, not a failure. `global-hotkey` is X11-only. Push-to-talk is app-focused on every platform because bare modifier keys can't be registered as global shortcuts at all. See [ROADMAP.md](ROADMAP.md#stage-2--audio-continuity-hotkeys-page-restriction--ad-block) for the details.

**Navigation is restricted** to `*.dndbeyond.com` and `*.wizards.com` (see `tauri-client/src-tauri/src/consts.rs`). Anything else lands on a blocked page showing the URL that was refused; the terminal logs `blocked navigation to <url>`.

> **Known issue:** this blocks OAuth login (Steam/Google/Apple), which is the recommended login path on Linux. If you're stuck at login, that's why — the redirect chain hasn't been captured and allowlisted yet.

## Per-Module Setup

Each module has its own `README.md` with module-specific setup once it's implemented:

- [backend/README.md](backend/README.md)
- [tauri-client/README.md](tauri-client/README.md)
- [ddb/README.md](ddb/README.md)
- [ai/README.md](ai/README.md)
- [status/README.md](status/README.md)
- [livekit/README.md](livekit/README.md)
- [infra/README.md](infra/README.md)

## Code Style

- TypeScript: ESLint + Prettier + EditorConfig (`npm run lint`, `npm run format` at the root). `npm test` runs Vitest for any workspace that has tests (currently `overlay-ui` only).
- Rust: `cargo fmt` and `cargo clippy` inside `tauri-client/`.

VS Code is the recommended editor; enable format-on-save with Prettier and rust-analyzer.

## Need Help?

- Check [CLAUDE.md](CLAUDE.md) for the architecture spec and module boundaries.
- Check [docs/architecture/](docs/architecture/) for system diagrams and the DDB auth flow.
- Open an issue if something in this guide is wrong or missing — it should track reality as modules get built.
