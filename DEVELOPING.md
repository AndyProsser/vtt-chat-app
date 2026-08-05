# Developer Setup Guide

This project runs on **native services, not containers** — see [CLAUDE.md §4](CLAUDE.md). That applies to local development too: Postgres, Redis, LiveKit, and Caddy run directly on your machine, not in Docker.

**Status:** the mono-repo is currently a scaffold — module folders and documentation exist, implementation has not started. This guide describes the environment you'll need once modules are built; it will be filled in with real run/build/test commands as each module lands.

Primary target: **Ubuntu Server / Ubuntu desktop**. Other Linux distros and macOS should work for development; Windows via WSL2 is untested but likely fine for the non-Tauri modules.

## Requirements

- **Node.js 26+** and npm (this repo uses npm workspaces — see [CLAUDE.md §3](CLAUDE.md))
- **Rust** (stable, via [rustup](https://rustup.rs)) — needed for `tauri-client/src-tauri/` and `tauri-client/rust-livekit/`
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

- TypeScript: ESLint + Prettier + EditorConfig (`npm run lint`, `npm run format` at the root).
- Rust: `cargo fmt` and `cargo clippy` inside `tauri-client/`.

VS Code is the recommended editor; enable format-on-save with Prettier and rust-analyzer.

## Need Help?

- Check [CLAUDE.md](CLAUDE.md) for the architecture spec and module boundaries.
- Check [docs/architecture/](docs/architecture/) for system diagrams and the DDB auth flow.
- Open an issue if something in this guide is wrong or missing — it should track reality as modules get built.
