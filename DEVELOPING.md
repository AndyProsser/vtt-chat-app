# Developer Setup Guide

The app itself runs natively in development (`npm run dev`, `cargo run`), but the **backing services can come from Docker** — deployment is Docker Compose first, native for advanced users ([CLAUDE.md §5](.claude/CLAUDE.md)). For Postgres and Valkey, the quickest route is the throwaway dev bundle:

```bash
docker compose -f infra/dev/compose.yml up -d --wait
export TEST_DATABASE_URL=postgres://postgres:scratch@127.0.0.1:55432/vtt
export TEST_VALKEY_URL=redis://127.0.0.1:56379
npm test   # the store and replay suites now also run against the real servers
```

Without those variables the same suites run against the in-memory stand-ins, so CI and a bare checkout need no services. To run the backend itself on them: `DATABASE_URL=… VALKEY_URL=… npm start -w @vtt-chat-app/backend` (migrations apply on start).

**Status:** mid-pivot. The docs describe the new design (a self-hosted tray app + server with records and AI summaries); the **code is still the previous design** until [ROADMAP Stage 1](ROADMAP.md#stage-1--pivot-cleanup) removes it. Sections below are marked **(works today)** or **(planned)** so this guide doesn't pretend otherwise.

Primary server target: **Ubuntu Server**. Client targets, in priority order: **Windows**, **Ubuntu/Linux**, macOS.

## Requirements

- **Node.js 26+** with npm — required for everything, including `npm install` at the root (npm workspaces — [CLAUDE.md §4](.claude/CLAUDE.md)). Verified against Node 26.5.1 / npm 12.0.2.
- **Two TypeScript versions on purpose.** Every workspace compiles with **TypeScript 7** (`tsc` from its own `node_modules`). The **root** pins **TypeScript ~6.0** only because `typescript-eslint` needs the JS compiler API, which TS 7 doesn't ship (it requires `typescript <6.1`). Don't "fix" the root back to 7 until typescript-eslint supports it; it will fail to install.
- **Rust** (stable, via [rustup](https://rustup.rs)) — for `tauri-client/src-tauri/` and `tauri-client/rust-livekit/`. `rustup` installs `cargo`/`rustc` but **not** a linker:
  - **Windows:** install the "Desktop development with C++" workload from [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (the default `x86_64-pc-windows-msvc` target needs `link.exe`). VS Code is not sufficient. Separately, `rust-livekit`'s prebuilt `libwebrtc_sys` is built against the static CRT (`/MT`) while rustc defaults to `/MD`, which fails with `LNK2038` unless static CRT linkage is forced. That is handled by `tauri-client/.cargo/config.toml` (`target-feature=+crt-static`) — don't remove that file.
  - **Linux:** `build-essential`, the audio dev headers (`libasound2-dev`) for `cpal`, and **`clang`** (`sudo apt install clang`). The LiveKit Rust SDK (`livekit` 0.10, pinned in `tauri-client/rust-livekit/Cargo.toml`) builds its WebRTC layer (`webrtc-sys`) with `clang++`: libwebrtc is built against Chromium's libc++, and GCC ignores the `trivial_abi` annotations that make `unique_ptr`/`shared_ptr` cross the boundary correctly, so a GCC build compiles and then misbehaves. The build script stops with "clang++ is required" if it is missing. If your clang is installed under another name or path, set `CXX` to it. A from-scratch build compiles WebRTC glue and takes several minutes.
  - **macOS:** Xcode Command Line Tools.
- **Tauri prerequisites** for your OS — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) (WebView2 on Windows, WebKitGTK on Linux, Xcode CLT on macOS). The tray app's panels are local pages, so webview quirks matter far less than they did under the previous design.
- **Server-side services** (for backend/records work — a dev VM is the easiest way to get these):
  - PostgreSQL, Redis, Caddy
  - **LiveKit server** and **LiveKit Egress** (native binaries — [livekit/README.md](livekit/README.md))
  - **ffmpeg**, **Whisper.cpp**, **Ollama** (records pipeline — needed from Stage 2 Part B / Stage 5)

## Clone and Install **(works today)**

```bash
git clone https://github.com/AndyProsser/vtt-chat-app.git
cd vtt-chat-app
npm install
```

`npm install` at the root installs dependencies for every workspace package in the root `package.json`.

## Running Locally

### Today: the Stage 1 skeleton

`npm run dev` starts the LiveKit dev server (if `livekit-server` is on your `PATH`), the backend, builds `panels-ui`, then runs the Tauri client. The client has **no window yet** (the tray arrives in Stage 4), so what you can exercise is the backend (`GET /api/health`), the global shortcuts, and the audio crate. Ctrl+C stops everything. `scripts/dev.ts` is rewritten again in Stage 3.

For the audio path alone, `rust-livekit` has a standalone harness that needs no Tauri and no DDB:

```bash
cd tauri-client/rust-livekit
cargo run --example loopback -- <ws-url> <token-a> <token-b> [seconds]
```

It connects two clients to one room under two identities against a real LiveKit server — the capture → publish → subscribe → playback pipeline. A throwaway LiveKit server for it: `livekit-server --dev` (prints `devkey`/`secret`, binds `ws://127.0.0.1:7880`).

### Planned: the new dev loop **(planned — Stages 2–4)**

1. **Dev server** — a VM (or the machine itself) running the services above under systemd. Voice between two machines needs the LiveKit UDP range reachable; on a LAN dev VM that is just `livekit-server --dev --bind 0.0.0.0` behind a systemd unit with `Restart=on-failure`.
2. **Backend** — `cd backend && npm run build && npm start`; configure via env vars (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, …). Documented properly in Stage 3.
3. **Tray client** — `npm run app` from the repo root: builds the panels (`panels-ui`), then runs the app (`cargo run -p src-tauri`). It starts hidden in the tray; panels open from the tray menu. Close any installed copy first (the app is single-instance, so a second launch is forwarded to the first). Prefix `VTT_DEV_SIGNIN=1` for the developer sign-in forms.
4. **Records pipeline** — `ai/` worker against a recording from Egress (Stage 5).

`npm run dev` will be rewritten to orchestrate this in Stage 1/3.

## A test table: LiveKit, a seeded campaign and mock players

To see the app with other people at the table (roster, speaking glow, chat, loot, the DM connection screen) without gathering anyone:

```bash
docker compose -f infra/dev/compose.yml up -d --wait          # Postgres + Valkey (throwaway)
livekit-server --dev                                           # LiveKit on ws://127.0.0.1:7880 (key devkey / secret)
DATABASE_URL=postgres://postgres:scratch@127.0.0.1:55432/vtt VALKEY_URL=redis://127.0.0.1:56379 \
  node backend/dist/index.js                                   # the backend on :3000 (npm run build -w @vtt-chat-app/backend first)
# once: let players create campaigns too (the seed makes a second one with Aria as its DM)
node backend/dist/cli/main.js settings set campaign-creation open
npm run dev:seed                                               # a DM account, four players with characters, loot, a handout, a session
npm run dev:mock                                               # the four players come online, join voice, talk and chat (Ctrl+C to stop)
```

Then run the app **with the developer sign-in on** (`cd tauri-client && VTT_DEV_SIGNIN=1 cargo run -p src-tauri`) and sign in to `http://localhost:3000` as **`dm@vtt.test`**. Every account's password is generated into `.dev/accounts.json` (git-ignored, mode 0600) and never printed. `livekit-server` is a static binary: put it in `~/.local/bin` (releases at github.com/livekit/livekit). Resetting the database (`docker compose … down`) is fine: `dev:seed` signs in or re-creates everything with the same passwords.

The mock players are real LiveKit participants publishing synthetic "speech", so the speaking glow and the link-quality screen are driven by the real paths. They do not exercise Egress/recording (no Egress server in this setup).

### `VTT_DEV_SIGNIN`: the app's developer sign-in

A normal build has no sign-in form: the player connects through the browser (a link code or an approved device
request, [APP-SIGN-IN.md](docs/architecture/APP-SIGN-IN.md)). That is right for players and slow for a developer
who restarts against a scratch server all day, and the seeded accounts have passwords, not browsers. So with
`VTT_DEV_SIGNIN=1` in the app's environment:

- the Connect screen gains a collapsed **Developer sign-in** block (email and password, emailed code, SSO) and a
  box to paste a connect link;
- the matching Rust commands work. Without the variable they return `dev_only`, so a release build has no
  password path at all (it is not merely hidden in the UI).

Launch it as `VTT_DEV_SIGNIN=1 cargo run -p src-tauri`. Never set it for players. To try the real flow, leave it
off, press Connect and approve the code at `http://localhost:3000/connect?c=…`.

### Upgrading the LiveKit SDK

`rust-livekit` pins `livekit` to a minor version (currently 0.10). To move it: change the version in `tauri-client/rust-livekit/Cargo.toml`, run `cargo check --workspace --all-targets`, then the live tests against `livekit-server --dev`. They need a voice token for the dev DM and run one at a time, because two joins with the same identity evict each other:

```bash
export VTT_TEST_URL=ws://127.0.0.1:7880 VTT_TEST_TOKEN=<a voice token>
cd tauri-client
for t in connection_state choosing_devices mute_from leaving_and listing_devices; do
  cargo test -p rust-livekit -- --ignored $t
done
```

Prefer a release at least two weeks old, and keep `docs/architecture/AUDIO-SPIKE-RESULTS.md` honest if device or echo-cancellation behaviour changes.

## Shell Behaviour: Hotkeys **(carried over)**

Findings from the previous design that still hold, because they are about the OS, not the overlay:

| Binding                                      | Windows / macOS / Linux X11 | Linux Wayland    |
| -------------------------------------------- | --------------------------- | ---------------- |
| Push-to-talk (bare modifier, e.g. Left Ctrl) | app-focused only            | app-focused only |
| Mute / panel toggle (modified key)           | global                      | app-focused only |

- A bare modifier key can't be registered as an OS-global shortcut on any platform (`global-hotkey` has no scancode mapping for it), so global PTT needs a chord.
- Global shortcuts silently no-op on Wayland (`tao`'s shortcut thread is X11-only); the XDG GlobalShortcuts portal is the only real route and is unreliable on GNOME. The app should log this at startup and say so in the UI.
- GNOME needs an AppIndicator extension to show a tray icon at all; the tray client must degrade gracefully and explain itself.

## Known Issues

- **Linux, NVIDIA GPU, Wayland: the app dies on the first window** with `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display`. This is WebKitGTK's dmabuf renderer. The client sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself at startup (`src-tauri/src/platform.rs`) unless you already set it. If a window still crashes on your machine, try `GDK_BACKEND=x11`.

## Version numbers

One version covers the server and the client. **MAJOR** is a significant breaking, architectural change. **MINOR**
is any change to the API or signalling between server and client: if you change a contract in `shared/`, bump MINOR
(and `PROTOCOL_VERSION`) in the same change. **PATCH** is everything that does not touch the wire. Client and server
must match on MAJOR.MINOR and may differ on PATCH; while we are on `0.y.z`, `y` plays the MAJOR role. Rationale and
the planned server-chosen update flow: [docs/architecture/VERSIONING-AND-DEPLOYMENT.md](docs/architecture/VERSIONING-AND-DEPLOYMENT.md).

**Contract guard.** `npm test` fails (`backend/src/lib/wire/contract.test.ts`) if the wire contract (client frame
schemas, server event names, REST routes) differs from `shared/protocol.contract.json`. If the change is deliberate:
bump `PROTOCOL_VERSION` (`shared/src/consts/index.ts` and `tauri-client/src-tauri/src/consts.rs`), then run
`npm run protocol:update`. It refuses when the contract changed but the version did not, unless you pass
`-- --allow-same-version` (an additive field in an unreleased minor).

## Releasing

Two kinds of build, told apart by the tag name: a **release** (`v0.4.0`, built into a draft you review and
publish, offered to every player) and a **dev build** (`v0.4.0-dev.2`, `-rc.1`; published at once as a GitHub
pre-release, offered only to players who opted in). The full steps are in
[docs/guides/RELEASING.md](docs/guides/RELEASING.md); the short version:

- **Dev build:** `git tag v0.4.0-dev.1 && git push origin v0.4.0-dev.1`. No commit needed; the version comes from the tag.
- **Release:**
  1. Write the release's section in [CHANGELOG.md](CHANGELOG.md): move what is under `## [Unreleased]` into a new
     `## [X.Y.Z] - YYYY-MM-DD` section, and fill it out (Added, Changed, Fixed, Security, Known limits). It becomes the
     release notes, so write it for players and operators, not as a commit list.
  2. Set `X.Y.Z` in `tauri-client/src-tauri/tauri.conf.json` and `tauri-client/Cargo.toml` (`[workspace.package]`),
     run `cargo update --workspace` in `tauri-client/`.
  3. `tauri-client/scripts/release-version.sh vX.Y.Z` and `tauri-client/scripts/changelog-notes.sh X.Y.Z` must both pass.
  4. Commit, push, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
  5. When the three builds finish, review the draft release on GitHub (notes and file list), then publish it
     (`gh release edit vX.Y.Z --draft=false --latest`).
  6. Roll it out: `infra/fetch-release.sh vX.Y.Z ./release`, then `vtt-admin updates publish` on each server.
- The workflow refuses a release tag whose version files disagree with it, or that has no CHANGELOG section.
  CI also checks on every push that `tauri.conf.json` and `Cargo.toml` agree.

Keep adding to `## [Unreleased]` in CHANGELOG.md as you merge user-visible changes, so the release section is
mostly written before release day.

## Code Style

- TypeScript: ESLint + Prettier + EditorConfig (`npm run lint`, `npm run format` at the root). LF line endings. `npm test` runs Vitest for any workspace that has tests.
- Rust: `cargo fmt` and `cargo clippy` inside `tauri-client/`.

VS Code is the recommended editor; enable format-on-save with Prettier and rust-analyzer.

## Per-Module Setup

- [backend/README.md](backend/README.md)
- [tauri-client/README.md](tauri-client/README.md)
- [ai/README.md](ai/README.md)
- [web/](ROADMAP.md#stage-7--mobile-spa) (planned)
- [ddb/README.md](ddb/README.md) (optional)
- [status/README.md](status/README.md)
- [livekit/README.md](livekit/README.md)
- [infra/README.md](infra/README.md)

## Need Help?

- [CLAUDE.md](.claude/CLAUDE.md) — architecture spec and module boundaries.
- [docs/architecture/](docs/architecture/) — system diagram, records pipeline, deployment.
- [docs/archive/](docs/archive/README.md) — the previous design, including the WebKitGTK/NVIDIA investigation, should you ever see those errors from a local panel.
- Open an issue if something in this guide is wrong or missing — it should track reality as modules get built.
