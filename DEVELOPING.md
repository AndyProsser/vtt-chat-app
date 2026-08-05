# Developer Setup Guide

This project runs on **native services, not containers** — see [CLAUDE.md §4](CLAUDE.md). That applies to local development too: Postgres, Redis, LiveKit, and Caddy run directly on your machine, not in Docker.

**Status:** the mono-repo is currently a scaffold — module folders and documentation exist, implementation has not started. This guide describes the environment you'll need once modules are built; it will be filled in with real run/build/test commands as each module lands.

Primary target: **Ubuntu Server / Ubuntu desktop**. Other Linux distros and macOS should work for development; Windows via WSL2 is untested but likely fine for the non-Tauri modules.

## Requirements

- **Node.js 26+** with npm — required to run anything in this repo at all, including `npm install` at the root (this repo uses npm workspaces — see [CLAUDE.md §3](CLAUDE.md)). npm ships with Node; no separate install. Verified against Node 26.5.1 / npm 12.0.2.
- **Rust** (stable, via [rustup](https://rustup.rs)) — needed for `tauri-client/src-tauri/` and `tauri-client/rust-livekit/`. `rustup` installs `cargo`/`rustc` but **not** a linker — `cargo build` will fail at the final link step without one:
  - **Windows:** install the "Desktop development with C++" workload from [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (the default `x86_64-pc-windows-msvc` target needs `link.exe` from it). Installing VS Code is not sufficient — it's a different product. Without this, `cargo build` fails with ``error: linker `link.exe` not found`` even though `cargo check`/`cargo clippy` on library targets still work.
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
