# **CLAUDE.md — Development Guide for VTT Chat App (Self‑Hosted Voice + Records, System‑Tray Client)**

**Repository:** `vtt-chat-app`
**Purpose:**
This document defines the architecture, constraints, modules, and development expectations for
the **VTT Chat App**: a **self‑hosted, audio‑first voice + chat + session‑records system for
tabletop groups**, made of a small **system‑tray desktop client** (Tauri + a Rust LiveKit client),
a **mobile web app**, and a **native backend** that anyone can deploy on a blank Ubuntu Server.

Claude must follow this document when generating code, architecture, or implementation details.

> **Direction change — 2026‑10‑29 (decided), repo rewritten 2026‑11‑05.** This project used to be a
> Tauri _browser_ that loaded D&D Beyond and injected a voice overlay into Maps VTT. That design is
> gone. There is no embedded browser, no page restriction, no ad‑blocking, no overlay injection,
> and no dependency on D&D Beyond. The old material lives in [`docs/archive/`](../docs/archive/README.md)
> and is **not** a requirement. If you find a surviving reference to the overlay, the allowlist, or
> the cobalt cookie in code, it is a leftover and should be removed — not a pattern to follow. (ROADMAP Stage 1 removed the known ones.)

This directory (`.claude/`) also holds two files worth checking at the start of nontrivial work:

- [`.claude/memory.md`](memory.md) — durable, cross-machine facts and lessons about this repo
  that aren't derivable from the code or git history. Committed to git specifically so it
  survives moving between Andy's machines, unlike Claude Code's per-machine auto-memory.
- [`.claude/intent.md`](intent.md) — current goals and in-flight, session-spanning threads,
  including the list of design topics still open.

Andy's **Memory Hub** (cross‑project memory, `memory.prosser.online`) may also be connected in a
session. If it is, call `memory_focus` at the start of nontrivial work. The repo files above stay
the repo‑scoped, git‑committed record; the hub is cross‑project.

See also `~/.claude/CLAUDE.md` (loaded automatically alongside this file) for Andy's account-wide
tone, working-style, and cross-project preferences — this file only covers what's specific to
`vtt-chat-app`.

## **1. High‑Level Concept**

VTT Chat App replaces the "everyone sits in one Discord channel with open mics" setup for a
tabletop group, and adds the thing Discord can't: **a searchable record of every session, with AI
summaries**. It is deliberately **not** attached to any VTT — it works alongside whatever the group
plays on (D&D Beyond Maps, Foundry, Roll20, paper).

- **Audio first.** Open‑mic group voice, reliable and quiet on idle.
- **Records are core.** Server‑side recording → transcription → AI summaries is a first‑class
  part of the design, not a plugin. See [`docs/architecture/RECORDING-AND-SUMMARIES.md`](../docs/architecture/RECORDING-AND-SUMMARIES.md).
- **Tiny client.** A system‑tray app with floating React panels. Players leave it hidden ~90% of
  the time. It serves only its **own** React pages — it never loads or injects third‑party web content.
- **Rust owns audio.** Capture, echo cancellation, noise suppression, mixing, playback, and the
  recording‑cue player all live in Rust. Audio never passes through a webview. This is the main
  reason the client is an app rather than a web page.
- **Minimal chat + table content.** DM/player whispers, handouts/maps/images, text snippets,
  loot drops, a DM soundboard.
- **Campaigns are private.** A campaign has a designated DM and access control. A General channel
  exists beside campaign channels.
- **Self‑host first.** One operator can stand up their own instance on a blank Ubuntu Server with
  **zero cloud reliance**. Anyone should be able to do this, not just Andy. See §2 and
  [`docs/architecture/DEPLOYMENT-AND-TRANSPORT.md`](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

The system is intentionally **lightweight**, **modular**, and **easy to deploy**.

## **2. Guiding Principles (read before proposing anything)**

1. **Self‑host first, zero cloud reliance.** The default install runs entirely on the operator's
   own server: LiveKit SFU, recording, Whisper, and a local LLM. Nothing in the default path may
   require an account with a third party.
2. **Cloud is an opt‑in adapter for advanced users.** Cloudflare (TURN, Realtime SFU, Workers AI,
   Pages for the SPA) and cloud LLM/transcription APIs are _optional integrations_ behind a
   clear seam. They must never be load‑bearing for the default install, and the code path must work
   with every one of them disabled. Do not write code that assumes Cloudflare.
3. **The server is the source of truth** for recording state, campaign membership, and history.
   Clients are caches (see [`STATE-AND-RESILIENCE.md`](../docs/architecture/STATE-AND-RESILIENCE.md)).
4. **Consent is visible.** Anything that records must be unmistakable to every participant (§8.4).
5. **Quiet when idle.** Near‑zero CPU, memory that doesn't grow, and no wake‑ups while hidden.
6. **Reliable beats perfect.** Incomplete tray support on a given Linux desktop is acceptable;
   losing a recording, or silently failing to rejoin, is not.

## **3. Mono‑Repo Structure**

Claude must assume **one unified repository** containing all modules:

```text
vtt-chat-app/
│
├── backend/               # NodeJS Express API + WebSocket + system-level CLI admin
├── livekit/               # LiveKit server + egress config + helpers
├── tauri-client/          # Cross-platform Tauri tray app
│   ├── src-tauri/         # Rust: Tauri shell — tray, panels, hotkeys, autostart, updater
│   ├── rust-livekit/      # Native Rust client: audio engine + LiveKit + cue player
│   ├── rust-sync/         # Native Rust WebSocket client: presence, chat, resume/replay
│   └── panels-ui/         # TS/React panels (chat, handouts, loot, RSVP, DM soundboard)
│                          #   (replaced the old overlay-ui/ in Stage 1)
├── web/                   # Browser pages: the invite/join page (built); mobile SPA planned
├── ai/                    # Records pipeline worker: transcode, Whisper, diarize, summarise
├── ddb/                   # OPTIONAL D&D Beyond character import (public pages)
├── status/                # Public status page (React + Radix)
├── shared/                # Cross-module TS types, event contracts, validators
├── infra/                 # Ubuntu deployment scripts + systemd units
└── docs/                  # Architecture, setup, CLI usage (docs/archive/ = old design)
```

All modules live in this mono‑repo.
Old repos (`vtt-chat`, `vtt-chat-extension`) are archived and not depended on — see §15–16.

## **4. Tech Stack & Code Conventions**

Claude must follow these conventions across the mono‑repo. These exist so the codebase reads the
same way regardless of which module you're in.

### Languages

- **TypeScript** for all application code: `backend/`, `ai/`, `ddb/`, `status/`, `web/`,
  `tauri-client/panels-ui/`, `shared/`.
- **Rust** is confined to `tauri-client/` — the Tauri shell (`src-tauri/`) and the native audio +
  LiveKit client (`rust-livekit/`). Do not introduce Rust backend services; the backend stays
  NodeJS/Express. External native binaries the backend orchestrates (LiveKit, Whisper.cpp,
  ffmpeg) are not "our Rust" and are fine.

### UI

- **React 19 + Radix UI** for every UI surface — tray panels, mobile SPA, status page. One UI
  stack. Client state is **Zustand**.
- UI must be **simple but stylish** (never a plain engineering sample), and **light/dark mode
  follows the OS preference by default**. This is non‑negotiable.
- Keep components small and composable. No monolithic screen components.

### Monorepo tooling

- **npm workspaces.** Each TypeScript module is its own npm package with its own `package.json`,
  listed under `workspaces` in the root `package.json`.
- `rust-livekit/`, `rust-sync/` and `tauri-client/src-tauri/` are Cargo crates, managed as a Cargo workspace
  inside `tauri-client/`. They are not npm packages.

### Per-module folder convention

Every TypeScript package separates concerns into dedicated folders. Never mix logic, markup, and
constants into one file:

```text
src/
├── components/      # React components — UI only, minimal logic
├── hooks/           # Reusable React hooks
├── consts/          # Constants, enums, config defaults
├── types/           # TypeScript types/interfaces local to this module
├── styles/          # CSS / Radix theme tokens
└── lib/             # Non-React logic: API clients, services, state
```

Types and contracts shared _across_ modules (campaign/channel/message shapes, recording state,
Tauri IPC event payloads, WS contracts) live in `shared/`, not duplicated per-module.

### Formatting & linting

- ESLint (flat config) + Prettier + EditorConfig for TypeScript, enforced in CI. **LF line endings
  everywhere.**
- `rustfmt` + `clippy` for Rust code.

### Secrets

Never print secret plaintext into a tool call or chat. Generate to a file via script, encrypt or
protect in place. Never commit real credentials.

## **5. Deployment Model (Docker Compose primary, native supported)**

Claude must design the backend to run on Ubuntu Server (VM or host), **both** in containers and natively:

### **Services (the same set in every deployment tier)**

- **Caddy** (reverse proxy + TLS)
- **Postgres** (persistent storage)
- **Valkey** (ephemeral state + pub/sub; Redis-protocol, so plain Redis also works — decided 2026-11-05, see SYNC-PROTOCOL.md)
- **NodeJS Express backend**
- **LiveKit server** + **LiveKit Egress** (recording)
- **Whisper.cpp** (transcription) and **ffmpeg** (transcoding)
- **Ollama** (LLM for summaries)

### **Deployment tiers — decided 2026‑11‑07**

1. **Docker Compose on a VM or real server — the primary, documented path.** Anyone should be able
   to stand up an instance this way. This is also the supported way to run LiveKit **Egress**,
   which upstream ships as a container image.
2. **Native install (bash script + systemd) — for advanced users.** Same services, no containers.
   Supported and kept working, but not the path the quick start leads with.
3. **LXC (e.g. Proxmox) — optional, for operators who know what they're doing.** Not a separate
   artifact: it's the native install inside a container. Documented gotchas only (UDP buffer
   sysctls live on the host; GPU passthrough is fiddly). Docker‑in‑LXC is not recommended.

The application code must not care which tier it runs under — everything is configured by
environment/config, and the container bundle and the install script produce the same config.

### **AI backends: local or remote — decided 2026‑11‑07**

Transcription (Whisper) and summarisation (LLM) sit behind provider interfaces and may each run:

- **Locally on the server (default, always configured).** Whisper on CPU is acceptable (`small`/
  quantised to start); no GPU is required. Sessions are ~weekly, so a slow 4–8 h CPU transcript is
  acceptable. The local backend is always set up and is the fallback for a remote one. If the
  server **has a usable GPU**, local uses it, and the Admin is told a remote backend may be
  unnecessary.
- **On a remote instance the operator controls** — e.g. a GPU in a gaming PC on the LAN — reached
  by a configured URL, speaking the **OpenAI‑compatible API** (`/v1/audio/transcriptions` for
  Whisper, the OpenAI‑style chat endpoint for the LLM; Ollama exposes one). A remote that is off or
  asleep means jobs **wait, then fall back to local CPU `small`** after a configurable timeout;
  the fallback can be disabled (wait forever instead). Never "the recording is lost".
- **On a third‑party cloud** — an opt‑in adapter (principle 2), through the same OpenAI‑compatible
  interface.

Any non‑local backend means session content leaves the server, so it needs an explicit operator
setting and is surfaced in the UI (§8.4). Private/whisper audio is never sent anywhere.

### **Deployment method**

Claude must support:

- `bash` install script
- systemd service files
- automatic dependency installation
- automatic configuration generation
- optional "one‑line installer" via curl

### **Network**

- **Voice needs UDP reachability.** The operator forwards/opens a UDP port range to the server for
  LiveKit media (plus `7881/tcp` as the ICE‑over‑TCP fallback). Decided 2026‑11‑05: this is
  acceptable. Cloudflare Tunnel cannot carry it and is never a substitute.
- **Built‑in LiveKit TURN** is the optional restrictive‑network fallback. **Cloud TURN
  (e.g. Cloudflare) is an optional advanced add‑on**, not part of the default install.

## **6. Public Status Page**

Claude must implement a **simple, public, read‑only status page** served by the backend.

### Must display

- LiveKit server health
- Backend health
- Redis/Postgres health
- Recording / AI pipeline health (queue depth, last job result)
- Number of connected players
- Whether a recording is currently active
- Download links for the Windows, macOS, and Linux clients

### Purpose

DM can say "grab the app here" and players can go from zero to connected. The status page also
tells an operator at a glance whether the records pipeline is healthy.

## **7. Admin CLI (System‑Level Only)**

Claude must implement a **CLI tool** that manages **system operations only**.

### **Admin CLI must NOT manage:**

- campaign contents, channels, messages
- bookmarks/markers
- group routing, soundboard
- anything gameplay‑related

These are **DM‑managed inside the app**.

### **Admin CLI must manage:**

- backup/restore/delete campaigns
- backup/restore/delete recordings, transcripts, summaries
- reprocess a recording (re‑transcribe / re‑summarise)
- system health checks
- service restart
- log inspection
- storage cleanup and retention
- AI job queue inspection
- LiveKit / Egress server status
- backend status
- Redis/Postgres status
- instance bootstrap (first DM / invite codes — exact shape depends on the identity decision, §11)

## **8. Functional Requirements**

### **8.1 Tray Client (Tauri)**

Claude must implement:

#### **Tray first**

- The app lives in the system tray; the tray icon shows state: **live / muted / recording / disconnected**
- Floating panels open from the tray or hotkeys; position/size are the user's preference
- Panels are **local React pages only** — no remote content, no injected pages, no webview
  navigation to the open web. A strict CSP and a Tauri capability set with **no remote origins**
  is part of the design, not an afterthought.
- Tray support differs by platform (GNOME needs an AppIndicator extension, Wayland limits global
  shortcuts). Degrade gracefully and say so in the UI; do not hide the app behind a tray icon the
  user can't see.

#### **Always‑ready**

- Autostart, auto‑update, **auto‑rejoin** after network loss or sleep/wake, crash recovery
- Near‑zero idle CPU; no timers or animations running while panels are hidden
- Clear tray state icon so a hidden app is never ambiguous

#### **Audio continuity**

Closing, hiding, or reopening panels **must not disrupt audio**. The Rust audio engine runs once in
the Tauri backend, independent of any window.

#### **Hot‑mic honesty**

- Mute **releases the capture device** (not just zeroed samples) so OS mic‑in‑use indicators turn
  off on every platform, at the cost of a slightly slower unmute. (Under evaluation — confirm the
  unmute latency is acceptable in the audio spike before committing.)
- Show mute state in the tray icon, not only in a panel.

#### **Global hotkeys**

- PTT / mute / panel toggle. Reality check carried over from the previous design: push‑to‑talk with
  a _bare modifier_ can't be an OS‑global shortcut, and global shortcuts silently no‑op on Wayland.
  See [`docs/archive/`](../docs/archive/README.md) (Stage 2 findings) — design around it rather than rediscover it.

### **8.2 Rust Audio + LiveKit Client**

Claude must implement:

- Native WebRTC, native audio device control
- **Echo cancellation and noise suppression** (open mics are the default use case)
- Per‑player gain; local mixer
- Native track management and group (channel/party) routing
- **Local cue player** (recording start/stop cues, soundboard effects) — plays on the client, never
  through the SFU, so it is absent from recordings and works while muted
- Long‑session stability
- Tauri commands/events bridging Rust ↔ JS

### **8.3 Backend (NodeJS Express)**

Claude must implement:

- Auth/identity and campaign access control (§11)
- Issue LiveKit tokens
- Campaigns, channels, membership, ACL
- Chat, whispers, handouts, loot, RSVP/session schedule, history
- **Recording control and state** (server truth, in room/session metadata)
- WebSocket layer for state/chat/presence with a bounded replay buffer
- Records API: recordings, transcripts, summaries, search
- Serve the **public status page** and **client downloads**

### **8.4 Records & AI Summaries (CORE)**

Server‑based. Full design in [`docs/architecture/RECORDING-AND-SUMMARIES.md`](../docs/architecture/RECORDING-AND-SUMMARIES.md).
Claude must implement:

#### **Recording**

- **LiveKit Egress on the server**, per‑speaker tracks (not a single mixed file), written to local
  object storage. Decided 2026‑11‑05: recording is server‑side, because Whisper, transcoding and
  summarisation also live there.

#### **Consent cue**

- Start cue ("Session recording in progress") and stop cue, played **locally** by every client
- Late joiners hear the start cue **before** their audio is captured
- A network‑blip rejoin does **not** replay the cue until the player's acknowledgement expires
- Acknowledgement tracked per player per recording; recording state is server truth
- A persistent in‑app indicator (tray icon + panel) while recording
- Start/stop sounds must be distinct from soundboard effects

#### **Pipeline**

- Transcode → transcribe (**Whisper.cpp, local by default**) → diarize **by track** (we know who
  spoke because tracks are per‑speaker) → summarise (**local LLM via Ollama by default**)
- Summaries: session, chapter, character‑specific, DM‑only
- Whispers / private‑channel audio and anything marked private must **never** be recorded,
  transcribed or summarised into a shared artifact
- Cloud transcription/LLM providers are optional, opt‑in adapters (principle 2). Sending session
  content off the server requires an explicit operator setting, and says so in the UI.

#### **Access**

- Players can read their campaign's history and summaries; DM‑only summaries are DM‑only
- Retention and deletion are operator‑controlled (CLI) and DM‑visible

### **8.5 LiveKit (Native)**

Claude must implement:

- Room creation; participant metadata
- Rooms: General, Campaign, and DM‑managed party splits (DM is in every group; players are isolated)
- Data events only where a WebSocket round‑trip is a poor fit (default: use the backend WS layer)
- Egress for recording

### **8.6 Table Features**

Claude must implement, after records are working (ROADMAP order):

- Chat, DM/player whispers, handouts/maps/images, text snippets
- Loot drops with pickers (so it is known an item was collected/recorded)
- DM soundboard: adjust own and player audio; sound effects, instant or background
- Session scheduling in the tray: upcoming‑session reminders and RSVP (can make it / late / can't)
- In‑session and post‑session history access

### **8.7 Optional Integrations**

Not part of the default install; never required:

- **D&D Beyond character import** — paste a public character URL (or a login token if that proves
  easy) to pull character name/class/portrait. Public pages only; no scraping beyond that. Lives in `ddb/`.
- **Cloudflare** (TURN, Realtime SFU, Workers AI, Pages) — advanced users
- **Cloud LLM / transcription APIs** — advanced users
- **Authelia / OIDC SSO** — if the identity decision (§11) supports it

## **9. Client Panel Requirements**

- Panels are small, quiet, and stylish; DM controls appear only for the DM
- Collapsible, remember position; **usable without a mouse for mute/PTT** (hotkeys + tray menu)
- Never required to be open for audio to work

## **10. Sessions, Recordings & Markers**

There is **no session state machine** (see §15). The model is:

- A **campaign** has a continuous history.
- A **recording** is a span with a start and stop, owned by the server. It is a flag plus a
  timestamped record — not a lifecycle with states to keep synchronised across four layers.
- **Scheduled sessions** (for RSVP/reminders) are calendar entries, independent of recordings.
- **Markers** — DM‑placed timestamps on the timeline (chapter, battle, custom) — are carried over
  from the previous design as the anchors for summaries. _Whether markers stay in scope is still to
  be confirmed during the records design (`intent.md`)._

## **11. Identity & Access Model — DIRECTION DECIDED 2026‑11‑05, DETAILS OPEN**

The previous design got identity for free from D&D Beyond. That is gone. Decided:

- **Local accounts are the default** (principle 1 — no third‑party IdP required). Sign‑in methods:
  **email + password**, **email tokens**, and **OIDC** (optional, for operators who run an IdP).
  Email tokens need outbound mail, so SMTP is an optional operator setting, never required.
- **Roles are per campaign.** Each campaign has its own DM and its own players. One account can be
  DM in one campaign and a player in another.
- **A player has many characters but one active character per campaign.** Switching (death, new
  character) changes the avatar/name shown. Characters are optional and come from the DDB import (§8.7).
- **Email tokens = magic links** for sign‑in and password reset (needs optional SMTP). Without SMTP,
  the DM/operator issues a one‑time code via the CLI or in‑app and passes it on a side channel.
- **DM swap, not "resign".** Transfer means the DM and a player **swap places** in one quick
  action. The old DM becomes a player (may stay or leave). While someone is DM, their character
  association is **suspended, not deleted**; swapping back restores it. It must be fast enough
  for one‑shot campaigns where the DM rotates every session. The DM role is just extra controls.
- **Joining:** the DM invites players by **emailed magic link, side‑channel code, or QR code**.
- **First account on a fresh instance becomes Admin.** The Admin (or the CLI) sets campaign
  creation to **CLOSED** (admin/operator only) or **OPEN** (anyone, including players).
- Campaigns are private; a General channel exists beside them. System operations are CLI‑only; there
  is no web admin UI. No Spectator role.

- **Admin UI is minimal and may grow.** Most admin work stays in the CLI; the app gets only a small
  "quick access" surface. First candidate: a **connection status screen** for the DM/Admin showing
  each player's connection stability, jitter and latency.
- **Invite codes expire but are multi‑use** (the DM sends one invite to the whole group). Expiry in
  days is CLI‑configurable.
- **Sessions are long‑lived, Discord‑style** — players should rarely sign in again. They are
  **remotely revocable**: clients ping periodically, and a client offline longer than a
  CLI‑configurable limit must re‑authenticate.

Still open (ask Andy — §14 — before writing auth code): the exact list of Admin quick‑access
actions beyond the status screen, default expiry/offline limits, and whether password sign‑in and
magic links share one session model. See `intent.md`.

## **12. Cross‑Platform Requirements**

Priority: **Windows** (most players) > **Linux/Ubuntu** (Andy) > macOS (possibly later).

- Windows → WebView2 (Chromium)
- Linux GNOME/KDE → WebKitGTK; tray and global‑shortcut limits as in §8.1
- macOS → WebKit

The Rust audio engine must provide **consistent audio behaviour across all OSes**. The first
deliverable after cleanup is a headless audio spike that proves this on Windows and Linux before
any tray or React work (ROADMAP Stage 2).

## **13. Non‑Goals**

Claude must **not** implement:

- An embedded browser, page restriction, ad‑blocking, or any injection into third‑party pages
- Browser extensions
- A **hard requirement** on Docker or any container runtime — the native install stays supported
- Admin web UI
- VTT features (maps, tokens, dice, initiative, character sheets) — this app stays separate from the VTT
- Video
- Rust backend services (Rust stays confined to `tauri-client/`)
- A hard dependency on any cloud service
- Anything beyond voice + minimal chat/table content + records + DM audio controls

## **14. Development Style**

Claude must:

- Ask clarifying questions whenever a request is ambiguous, underspecified, or involves a decision
  the user hasn't made yet (e.g. the open design topics in `intent.md`) — do not guess and proceed
  silently. This is the standard way of working on this project, not a one-off request.
- Generate modular, deterministic code
- Avoid monolithic files; prefer small, composable modules with clear separation of concerns
- Avoid unnecessary abstractions; scope for homelab/personal scale, not enterprise scale
- Document assumptions explicitly, **including the "why"** — lean toward more documentation of
  design rationale, in Markdown + Mermaid
- Prefer the lightweight, config‑driven, self‑hostable option and state its resource footprint
- Provide architecture diagrams when helpful

## **15. Simplifications vs. Prior Systems**

This project descends from `vtt-chat` (a Docker‑deployed React/Node web app), `vtt-chat-extension`
(a three‑browser extension for DDB scraping), and its own first design (a DDB‑embedding Tauri
browser). It is a deliberate simplification each time. Do not reintroduce:

- **No VTT coupling.** No DDB WebView, cobalt cookie auth, DOM extraction, token conditions, or
  Maps‑scoped anything. D&D Beyond is, at most, an optional character‑import source (§8.7).
- **No separate browser extension.**
- **No Spectator role in v1.**
- **No formal session state machine.** The prior system enforced `IDLE → ACTIVE → PAUSED → COOLDOWN
→ ENDED`, with every change touching four layers in order. Recording is a server‑owned flag
  with a timestamp record (§10).
- **No Docker‑only deployment.** Docker Compose is now the primary path (2026‑11‑07), but the
  application must keep running natively; the prior system's Docker coupling is what we avoid.
- **No cloud lock‑in.** The first redesign sketch listed Cloudflare components as if they were part
  of the stack; they are optional adapters only.

## **16. Prior Art (Reference Only)**

`vtt-chat` and `vtt-chat-extension` (both under `github.com/AndyProsser`) are archived and are not
dependencies of this repo — nothing here should `import` from them. They remain useful as
**read‑only reference** for the WebSocket reliability model (bounded replay buffer + snapshot
fallback) and, for the optional DDB import, DDB endpoint quirks. Do not copy their architecture
wholesale.

## **17. Documentation Requirements**

Claude must keep the following documentation current as the project evolves. Update the relevant
doc in the same change as the code it describes — don't batch documentation for later.

- `README.md` — project overview, quick start, links
- `CONTRIBUTING.md` — how to contribute, PR process, code style
- `DEVELOPING.md` — local dev environment setup
- `ROADMAP.md` — staged build order, dependencies, and definition-of-done per stage
- `docs/BUILD-STATUS.md` — what is built vs verified, what needs the dev box, unconfirmed assumptions (update with the work)
- `docs/architecture/OVERVIEW.md` — system diagram + module responsibilities
- `docs/architecture/RECORDING-AND-SUMMARIES.md` — recording, consent cue, transcription, summaries
- `docs/architecture/DEPLOYMENT-AND-TRANSPORT.md` — self‑host topology, ports, TURN options, optional cloud adapters
- `docs/architecture/AUDIO-SPIKE-RESULTS.md` — Stage 2 measured audio findings (running log)
- `docs/architecture/SYNC-PROTOCOL.md` — WebSocket/REST split, envelope, auth, replay, presence tiers
- `docs/architecture/STATE-AND-RESILIENCE.md` — client state boundaries, leaf isolation, and recovery rules
- `docs/CONVENTIONS.md` — folder/style conventions, detailed version of §4
- `docs/archive/` — the previous design; add to it, never edit it to look current

Keep docs lean and current over exhaustive. A short doc that matches reality beats a long one that
has drifted.

## **18. Strategic Goal**

> **A self-hosted voice, chat and session-records system for tabletop groups. Anyone can deploy it
> on a blank Ubuntu Server with no cloud account. A tiny tray app and a mobile web app for players;
> server-side recording, transcription and AI summaries for the whole campaign.**

This is the guiding principle for all design decisions.

## **19. Claude's Output Expectations**

When asked to generate code or architecture, Claude must:

- Follow this document and the module boundaries in §3
- Respect self‑host‑first: the default path works with every cloud adapter disabled
- Use the **Rust audio engine** for all audio + WebRTC; never route audio through a webview
- Keep the tray client tiny, quiet and fast; keep the backend lightweight
- Treat records (recording → transcript → summary) as core, with visible consent
- Use CLI for system‑level operations; provide the public status page and client download links
- Avoid adding features not listed; ask when a feature is ambiguous
- Use **TypeScript** everywhere except the Tauri/Rust layer (§4)
- Use **React + Radix UI** (with Zustand) for every UI surface; light/dark follows the OS
- Use **npm workspaces**, one `package.json` per module, and the **per‑module folder convention**
