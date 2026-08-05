# VTT Chat App

> Voice + chat, built for D&D Beyond Maps VTT. Replaces Discord for DDB campaigns — no separate app, no separate login.

**Status:** Early scaffold — architecture and documentation are in place; implementation has not started yet. See [CLAUDE.md](CLAUDE.md) for the full spec.

---

## What Is This?

VTT Chat App is a cross-platform desktop client that loads **D&D Beyond** inside a native window, authenticates using DDB's own login (no separate account), and injects a minimal voice + chat overlay directly onto the Maps VTT canvas. A native Rust LiveKit client handles audio; a lightweight backend on a single Ubuntu server handles everything else.

- **One login.** DDB's cobalt cookie is the credential — the app extracts your identity, character, and campaign automatically.
- **Voice lives where you play.** The overlay sits on top of the Maps canvas, not in a separate app or browser tab.
- **DM has the controls.** Group routing, audio FX, and campaign mapping are DM-managed inside the app — nothing in a separate admin panel.
- **Timeline, not sessions.** There's no session start/end lifecycle — the DM drops bookmarks (chapter, battle, custom) on a continuous timeline as the campaign goes.
- **Self-hosted, no containers.** Deploys onto a blank Ubuntu Server with native services — Postgres, Redis, LiveKit, Caddy — no Docker required.

## Tech Stack

- **Desktop client** — Tauri (Rust + WebView)
- **Voice / WebRTC** — Rust LiveKit client (native, in-process)
- **DDB overlay UI** — React 19 + Radix UI + TypeScript
- **Backend** — Node.js + Express + TypeScript
- **Realtime** — LiveKit server (native binary)
- **Database** — PostgreSQL
- **Cache / pub-sub** — Redis
- **Reverse proxy** — Caddy
- **Deployment** — native Ubuntu Server services, systemd — no Docker

See [CLAUDE.md §3](CLAUDE.md) for code conventions (per-module folder layout, monorepo tooling, etc).

## Repository Structure

```text
vtt-chat-app/
├── backend/               # Node.js/Express API + system-level CLI admin
├── livekit/               # LiveKit server config + helpers
├── tauri-client/          # Cross-platform Tauri desktop app
│   ├── src-tauri/         # Rust: Tauri shell — windows, page restriction, ad-block, hotkeys
│   ├── rust-livekit/      # Native Rust LiveKit client
│   └── overlay-ui/        # TS/React overlay injected into DDB Maps
├── ddb/                   # DDB auth + extraction module
├── ai/                    # Recording, transcription, AI summary plugin
├── status/                # Public status page (React + Radix)
├── shared/                # Cross-module TS types, event contracts, validators
├── infra/                 # Ubuntu deployment scripts + systemd units
└── docs/                  # Architecture and setup documentation
```

Each module has its own `README.md` describing its purpose and current status.

## Documentation

- [CLAUDE.md](CLAUDE.md) — full architecture spec and build constraints
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute, PR process
- [DEVELOPING.md](DEVELOPING.md) — local dev environment setup
- [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) — system diagram + module responsibilities
- [docs/architecture/DDB-AUTH.md](docs/architecture/DDB-AUTH.md) — cobalt cookie → JWT exchange flow
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — folder/style conventions in detail

## Prior Art

This project is inspired by two earlier, archived projects — [vtt-chat](https://github.com/AndyProsser/vtt-chat) and [vtt-chat-extension](https://github.com/AndyProsser/vtt-chat-extension) — but is a deliberate simplification, not a continuation. See [CLAUDE.md §15–16](CLAUDE.md) for what changed and why.

## A Note to Wizards of the Coast & D&D Beyond

VTT Chat App is a fan-built project, made by players who love this game and just want to make playing it a little easier. It's not affiliated with, endorsed by, or intended to compete with Wizards of the Coast or D&D Beyond — our only goal is to add a bit of voice and chat magic on top of the game we already play there.

The app reads D&D Beyond data that the logged-in user already has access to, using their own session, purely to sync identity and character info into the overlay so players don't have to re-enter anything by hand.

We know this relies on unofficial access to DDB, and we're genuinely happy to work with you on it. If anything here ever raises a legal, product, or technical concern for Wizards of the Coast or D&D Beyond, please reach out — we'll gladly make whatever changes are needed, no argument. And if an official, supported way to integrate ever becomes available, we'd love to move to it.

You're welcome to open an issue on this repository any time, or get in touch directly — we're happy to talk.

_Dungeons & Dragons and D&D Beyond are trademarks of Wizards of the Coast LLC._

## License

[GNU AGPL v3.0](LICENSE)
