# VTT Chat App

> Self-hosted voice, chat and **session records with AI summaries** for tabletop groups. A tiny tray app for players, a mobile web app, and a server you run yourself — no cloud account required.

**Status:** The player and DM experience is built (voice, chat, handouts, loot, recording with transcripts and AI summaries, status, noise filtering) and runs on a developer's machine; the server installs from Docker Compose or a native script. **It has not yet been installed by anyone but its author**, and much has not been run against real infrastructure. **[docs/BUILD-STATUS.md](docs/BUILD-STATUS.md) says exactly what is built, what is verified, and what is next.** Start with the **[operator guide](docs/guides/OPERATOR-GUIDE.md)** (to host) or the **[user guide](docs/guides/USER-GUIDE.md)** (to play). See [CLAUDE.md](.claude/CLAUDE.md) for the spec and [ROADMAP.md](ROADMAP.md) for the plan.

---

## Quick Start (for a DM)

You need a small Ubuntu Server (a VM is fine: 4 vCPU and 8 GB of memory is plenty, even with recording), a domain name, and the
ability to open a few ports. About half an hour.

1. **Point a domain at the server.** Add a DNS "A" record (for example `vtt.example.com`) pointing at the server's public IP. The
   website may sit behind Cloudflare's proxy; voice goes straight to the server.
2. **Open the ports** at your router or cloud firewall: `80/tcp`, `443/tcp`, `7881/tcp` and `50000-50200/udp` (the last two carry voice).
3. **SSH in and run one command.** It asks for your domain and email, installs everything (Docker included) and prints a sign-in code:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/infra/get.sh | sudo bash
   ```

4. **Sign in** at `https://your-domain`, choose "I have a sign-in code", and you are in with a starter campaign where you are the DM.
5. **Invite your players** from the app (a link or a short code). They can use the web chat straight away, or install the desktop app
   from `https://your-domain/download` for voice.
6. **Record a session** (optional): re-run the installer with `--with-records`, or see
   [turning on recording](docs/guides/OPERATOR-GUIDE.md#6-turn-on-recording-and-ai-summaries). A recording is always announced to the table.

Afterwards `vtt-admin` works from any directory: `vtt-admin status`, `vtt-admin user code <email> signin`, `vtt-admin logs`,
`vtt-admin backup`, `vtt-admin update`. Everything else is in the **[operator guide](docs/guides/OPERATOR-GUIDE.md)**.

## What Is This?

The usual way a group plays online: everyone joins one Discord channel and leaves their mics open. That works. What it doesn't give you is a record of what happened. VTT Chat App keeps the same open-mic experience and adds that record.

- **Open-mic voice that stays out of the way.** A system-tray app, hidden ~90% of the time, with near-zero idle CPU, auto-rejoin, autostart and a tray icon that always shows whether you're live, muted or being recorded.
- **Session records are core.** The server records each speaker separately, transcribes with Whisper, and writes AI summaries — session, chapter, per-character and DM-only — with a visible, audible consent cue every time recording starts.
- **Self-host first.** One VM or server, **Docker Compose** (or a native install for advanced users), **no cloud account**. LiveKit, recording, Whisper and an LLM run on your box — or Whisper/the LLM can point at a GPU machine you own. Anyone can deploy their own instance.
- **Cloud is optional.** Cloudflare (TURN, SFU, Workers AI, Pages) and cloud LLM/transcription are _advanced-user adapters_, off by default and never required.
- **Minimal table tools.** DM/player whispers, handouts and images, loot drops, a DM soundboard, party splits, and session reminders with RSVP.
- **Campaigns are private.** A designated DM and access control per campaign, plus a General channel.
- **Not tied to a VTT.** It works alongside whatever you play on — D&D Beyond, Foundry, Roll20, or paper. (Optional D&D Beyond character import is planned for later.)

## Tech Stack

- **Desktop client** — Tauri tray app (Rust + React panels)
- **Audio / WebRTC** — Rust audio engine + LiveKit client, native and in-process (never in a webview)
- **UI** — React 19 + Radix UI + Zustand + TypeScript; light/dark follows the OS
- **Backend** — Node.js + Express + TypeScript
- **Realtime / recording** — LiveKit server + Egress (native binaries)
- **Records pipeline** — ffmpeg, Whisper.cpp, Ollama (all local by default)
- **Database / cache** — PostgreSQL, Redis
- **Reverse proxy** — Caddy
- **Deployment** — Docker Compose on a VM/server (primary); native Ubuntu services under systemd for advanced users

See [CLAUDE.md §4](.claude/CLAUDE.md) for code conventions.

## Repository Structure

```text
vtt-chat-app/
├── backend/               # Node.js/Express API + WebSocket + system-level CLI admin
├── livekit/               # LiveKit server + Egress config and helpers
├── tauri-client/          # Cross-platform Tauri tray app
│   ├── src-tauri/         # Rust: tray, panels, hotkeys, autostart, updater
│   ├── rust-livekit/      # Rust: audio engine + LiveKit client + cue player
│   └── panels-ui/         # TS/React panels (replaces legacy overlay-ui/)
├── web/                   # Invite page and the phone app (/app)
├── ai/                    # Records pipeline: transcode, Whisper, diarize, summarise
├── ddb/                   # OPTIONAL D&D Beyond character import
├── status/                # Public status page (React + Radix)
├── shared/                # Cross-module TS types, event contracts, validators
├── infra/                 # Ubuntu deployment scripts + systemd units
└── docs/                  # Architecture and setup (docs/archive/ = previous design)
```

Each module has its own `README.md` describing its purpose and current status.

## Documentation

- [docs/guides/OPERATOR-GUIDE.md](docs/guides/OPERATOR-GUIDE.md) — install, configure, operate, back up, update and fix a server (draft)
- [docs/guides/USER-GUIDE.md](docs/guides/USER-GUIDE.md) — joining a table, voice, chat, handouts, loot, recording, the DM's tools (draft)
- [CLAUDE.md](.claude/CLAUDE.md) — full architecture spec and build constraints
- [ROADMAP.md](ROADMAP.md) — staged build order
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute, PR process
- [DEVELOPING.md](DEVELOPING.md) — local dev environment setup
- [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) — system diagram + module responsibilities
- [docs/architecture/RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md) — recording, consent cue, transcription, summaries
- [docs/architecture/DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md) — self-host topology, ports, TURN, optional cloud adapters
- [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md) — state boundaries and recovery rules for long sessions
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — folder/style conventions in detail
- [docs/archive/](docs/archive/README.md) — the previous (DDB-overlay) design, kept for reference

## Self-Hosting at a Glance

You will need a server you control (VM or host) running Ubuntu, a domain name for TLS, and the ability to open a **UDP port range** for voice. You do not need a Cloudflare account or a cloud LLM. Docker Compose is the recommended install; a native install is available for advanced users. Both installs are in [infra/](infra/README.md) (Compose: [infra/compose](infra/compose/README.md); native: [infra/install.sh](infra/install.sh)); the topology and port table are in [DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

## Recording & Privacy

Recording is server-side and always announced: every client plays a "recording in progress" cue when it starts, late joiners hear it before their audio is captured, and the tray icon shows a recording state. Whispers and private channels are never recorded. Nothing leaves your server unless you explicitly enable a cloud adapter. Details in [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md).

## Prior Art

This project descends from [vtt-chat](https://github.com/AndyProsser/vtt-chat) and [vtt-chat-extension](https://github.com/AndyProsser/vtt-chat-extension) (both archived), and from its own first design — a Tauri browser that embedded D&D Beyond (see [docs/archive/](docs/archive/README.md)). Each step was a deliberate simplification. See [CLAUDE.md §15–16](.claude/CLAUDE.md).

## Third-Party Notice

VTT Chat App is a fan-built project. It is not affiliated with, endorsed by, or intended to compete with Wizards of the Coast or D&D Beyond. It does not embed or scrape D&D Beyond. If the optional character-import feature is built, it will read only publicly available character pages, and we will happily change or remove it if that ever raises a concern — open an issue any time.

_Dungeons & Dragons and D&D Beyond are trademarks of Wizards of the Coast LLC._

## License

[GNU AGPL v3.0](LICENSE)
