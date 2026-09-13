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

**One command:** `npm run dev` from the repo root builds and launches everything below — LiveKit dev server (if `livekit-server` is on your `PATH`; skipped with a warning otherwise, since voice just won't connect), the backend, the overlay bundle, then the Tauri client in the foreground. Ctrl+C stops all of it, LiveKit and the backend included. It's a plain Node script (`scripts/dev.ts`, run via `node`'s built-in TypeScript support — no build step, no extra dependency), so it works the same way on Windows, macOS, and Linux; the four platform-specific prerequisites above still apply, this just orchestrates them.

**Manual, four steps in order** — useful if you want one piece running under a debugger, or don't want the others restarted every time:

1. **LiveKit dev server** — `livekit-server --dev` (no config needed; prints `devkey`/`secret` as the API key/secret and binds `ws://127.0.0.1:7880`, which are `backend/`'s defaults below). For two-party testing across machines, run it on a shared dev box instead of localhost: `livekit-server --dev --bind 0.0.0.0` behind a systemd unit (`Restart=on-failure`), and point `LIVEKIT_URL` at `ws://<dev-host>:7880` from each machine's `backend/` env.
2. **Backend** — `cd backend && npm run build && npm start` (listens on `:4000`). Override via env vars if needed: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_JWT_SECRET`, `PORT`.
3. **Build the overlay bundle** — `cd tauri-client/overlay-ui && npm run build` (produces `dist/overlay.js`, which `src-tauri` reads from disk at startup — rebuild this after any overlay change, then relaunch the app).
4. **Tauri app** — `cd tauri-client && cargo run --bin vtt-chat-app`. Opens a window on D&D Beyond and injects the overlay; watch the terminal for `cookies_for_url failed`/`overlay bundle not found` if something's off.

## Building a patched WebKitGTK (NVIDIA crash workaround)

**Only relevant if the app segfaults on startup or when loading a page with video, on Linux with an NVIDIA GPU.** See [`docs/WEBKITGTK-NVIDIA-EGL-CRASH.md`](docs/WEBKITGTK-NVIDIA-EGL-CRASH.md) for the full investigation — in short, a stock `webkit2gtk-4.1` (2.52.3 through at least 2.52.6) crashes on certain video-playing pages on the NVIDIA 580 driver branch, via a null-pointer bug in `AcceleratedBackingStore::update()` (upstream [WebKit bug 321683](https://bugs.webkit.org/show_bug.cgi?id=321683)) that then cascades into a second crash in NVIDIA's own driver. The fix is a 3-line WebKitGTK patch, not yet released by any distro.

Everyone else can ignore this section — it only matters if you're actually hitting the crash.

### 1. Prerequisites

- **Podman** (not Docker) — `sudo apt install podman` on Ubuntu. This uses [Igalia's `webkit-container-sdk`](https://github.com/Igalia/webkit-container-sdk), upstream's own recommended way to build the GTK port, so the whole toolchain (cmake, ninja, every `-dev` package) stays inside the container rather than on your host.
- ~30GB free disk, a few hours of build time (compiling all of WebKit is slow regardless of hardware — ~1h50m on an 8-core/31GB machine).

### 2. Build it, outside this repo

Pick a scratch directory *outside* `vtt-chat-app` — a full WebKit checkout + build tree is tens of GB and has nothing to do with this project's own code:

```bash
mkdir -p ~/Development/webkitgtk-321683-build && cd ~/Development/webkitgtk-321683-build

# WebKit source, at the tag matching your installed webkit2gtk version
git clone --depth 1 --branch webkitgtk-2.52.6 https://github.com/WebKit/WebKit.git
cd WebKit
git apply /path/to/vtt-chat-app/docs/patches/webkitgtk-321683-null-backing-store.patch

# The container SDK
cd ..
git clone https://github.com/Igalia/webkit-container-sdk.git
source webkit-container-sdk/register-sdk-on-host.sh
wkdev-create --create-home   # needs sudo once, for host GPU-container integration
wkdev-enter --name wkdev     # drops you into the container shell

# Inside the container:
cd "${HOST_HOME}/Development/webkitgtk-321683-build/WebKit"
./Tools/Scripts/build-webkit --gtk --release --cmakeargs="-DUSE_GTK4=OFF -DUSE_LIBRICE=OFF"
```

Notes on the flags: `-DUSE_GTK4=OFF` is required — without it you get `webkitgtk-6.0` (GTK4), not the `webkit2gtk-4.1` (GTK3) API Tauri actually links against. `-DUSE_LIBRICE=OFF` works around a `librice` dependency missing from this container image (WebRTC ICE candidate gathering inside WebKit's own GL stack — irrelevant to this app, since LiveKit's native Rust client handles audio, not WebKit's WebRTC).

A successful build ends with `WebKit is now built (...)`. and produces `WebKitBuild/GTK/Release/lib/libwebkit2gtk-4.1.so.0.*`.

### 3. Use it

```bash
./scripts/dev-with-patched-webkitgtk.sh
```

Runs the normal `npm run dev` stack with `LD_LIBRARY_PATH` pointed at that patched build instead of your system's `webkit2gtk-4.1` — nothing on your system is modified or replaced. If your build lives somewhere other than the default `~/Development/webkitgtk-321683-build/...` path, set `WEBKIT_PATCHED_LIB_DIR` first.

### 4. Confirm it actually fixed something (optional)

```bash
source ~/Development/webkitgtk-321683-build/webkit-container-sdk/register-sdk-on-host.sh
wkdev-enter --exec --name wkdev -- bash -c '
  cd "${HOST_HOME}/Development/webkitgtk-321683-build/WebKit"
  ./Tools/Scripts/run-minibrowser --release --gtk "https://www.youtube.com/watch?v=jNQXAC9IVRw"
'
```

Should run indefinitely without crashing; the stock system build reliably segfaults on this URL within 5-10 seconds (`journalctl -k | grep -i segfault` confirms either way).

## Shell Behaviour (Stage 2)

Once the app is running, the Tauri shell enforces a few things that are easy to mistake for bugs:

**The microphone starts muted.** This is true push-to-talk — nothing is transmitted until you hold the PTT key. The overlay shows `Mic muted` / `Mic live`.

| Shortcut | Action | Works when |
| --- | --- | --- |
| Left Ctrl (hold) | Push to talk | App window focused, all platforms |
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
