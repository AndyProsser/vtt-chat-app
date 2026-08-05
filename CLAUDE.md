# **CLAUDE.md — Development Guide for VTT Chat App (Rust LiveKit + Multi‑Window + Page Restrictions + Status Page)**

**Repository:** `vtt-chat-app`
**Purpose:**
This document defines the architecture, constraints, modules, and development expectations for the **VTT Chat App**, a cross‑platform desktop application that overlays voice + chat functionality on top of **D&D Beyond Maps VTT**, using **Tauri**, **Rust LiveKit client**, and a native backend stack deployable on a **blank Ubuntu Server**.
It also defines a **public status page**, **multi‑window client**, **page restrictions**, **basic ad‑blocking**, and a **system‑level Admin CLI**.

Claude must follow this document when generating code, architecture, or implementation details.

## **1. High‑Level Concept**

VTT Chat App is a **cross‑platform desktop client + native backend** that:

- Loads **D&D Beyond (DDB)** inside a Tauri WebView
- Uses **DDB’s own authentication (cobalt cookie)** for SSO
- Extracts **character + campaign metadata** directly from DDB
- Injects a **minimal voice + chat overlay** into the DDB Maps VTT canvas
- Uses a **Rust‑based LiveKit client** for stable, cross‑platform WebRTC
- Supports **multi‑window browsing** (rules, sheets, references)
- Restricts browsing to **DDB + Wizards + allowed list**
- Provides **basic ad‑blocking**
- Connects to a **LiveKit server** running natively on Ubuntu
- Provides **DM‑only controls** (groups, audio FX, bookmarks, campaign mapping)
- Provides a **public status page** for players/DMs
- Provides a **CLI‑only admin tool** for system‑level operations only
- Supports a **future plugin** for:
  - session recording
  - transcription
  - AI summaries (local or cloud)
- Replaces Discord entirely for DDB campaigns

The system is intentionally **lightweight**, **modular**, and **easy to deploy**.

## **2. Mono‑Repo Structure**

Claude must assume **one unified repository** containing all modules:

```text
vtt-chat-app/
│
├── backend/               # NodeJS Express API + system-level CLI admin
├── livekit/               # LiveKit server config + helpers
├── tauri-client/          # Cross-platform Tauri desktop app
│   ├── src-tauri/         # Rust: Tauri shell — windows, page restriction, ad-block, hotkeys
│   ├── rust-livekit/      # Native Rust LiveKit client
│   └── overlay-ui/        # TS/React overlay injected into DDB Maps
├── ddb/                   # DDB auth + extraction module (shared TS types + extraction logic)
├── ai/                    # Recording, transcription, AI summary plugin
├── status/                # Public status page (React + Radix)
├── shared/                # Cross-module TS types, event contracts, validators
├── infra/                 # Ubuntu deployment scripts + systemd units
└── docs/                  # Architecture, setup, CLI usage
```

All modules live in this mono‑repo.
Old repos (`vtt-chat`, `vtt-chat-extension`) are archived and not depended on — see §15 for how they may still be consulted.

## **3. Tech Stack & Code Conventions**

Claude must follow these conventions across the mono‑repo. These exist so the codebase reads the same way regardless of which module you're in.

### Languages

- **TypeScript** for all application code: `backend/`, `ddb/`, `ai/`, `status/`, `tauri-client/overlay-ui/`, `shared/`.
- **Rust** is confined to `tauri-client/` — the Tauri shell (`src-tauri/`) and the native LiveKit client (`rust-livekit/`). Do not introduce Rust backend services; the backend stays NodeJS/Express (§7).

### UI

- **React 19 + Radix UI** for every UI surface — the injected DDB overlay (`overlay-ui/`) and the public status page (`status/`). One UI stack, not two. Do not introduce a second frontend framework for the overlay to save bundle size — consistency wins over marginal size gains here.
- Keep components small and composable. No monolithic screen components.

### Monorepo tooling

- **npm workspaces.** Each TypeScript module (`backend/`, `ddb/`, `ai/`, `status/`, `tauri-client/overlay-ui/`, `shared/`) is its own npm package with its own `package.json`, listed under `workspaces` in the root `package.json`.
- `rust-livekit/` and `tauri-client/src-tauri/` are Cargo crates, managed as a Cargo workspace inside `tauri-client/`. They are not npm packages.

### Per-module folder convention

Every TypeScript package separates concerns into dedicated folders. Never mix logic, markup, and constants into one file:

```text
src/
├── components/      # React components — UI only, minimal logic
├── hooks/           # Reusable React hooks
├── consts/          # Constants, enums, config defaults
├── types/           # TypeScript types/interfaces local to this module
├── styles/          # CSS / Radix theme tokens
└── lib/             # Non-React logic: API clients, extraction, state, services
```

Types and contracts shared *across* modules (DDB character/campaign shapes, bookmark types, Tauri IPC event payloads) live in `shared/`, not duplicated per-module.

### Formatting & linting

- ESLint (flat config) + Prettier + EditorConfig for TypeScript, enforced in CI.
- `rustfmt` + `clippy` for Rust code.

## **4. Deployment Model (Ubuntu Server)**

Claude must design the backend to run **natively** on Ubuntu Server (VM or host):

### **Required native services**

- **Caddy** (reverse proxy + TLS)
- **Postgres** (persistent storage)
- **Redis** (ephemeral state + pub/sub)
- **NodeJS Express backend**
- **LiveKit server** (native binary)
- **Optional AI stack**:
  - **Ollama** (local LLM)
  - **Whisper.cpp** (local transcription)
  - **Cloud AI** (OpenAI/Claude)

### **No Docker required**

The system must run without containers.

### **Deployment method**

Claude must support:

- `bash` install script
- systemd service files
- automatic dependency installation
- automatic configuration generation
- optional “one‑line installer” via curl

## **5. Public Status Page**

Claude must implement a **simple, public, read‑only status page** served by the backend.

### Must display:

- LiveKit server health
- Backend health
- Redis/Postgres health
- Number of connected players
- DM connected (yes/no)
- Current campaign
- Current room
- Current map
- Download links for:
  - Windows client
  - macOS client
  - Linux client

### Purpose:

DM can say:

> “Hey guys, grab the new voice chat app here.”

Players visit → download → launch → login to DDB → done.

## **6. Revised Admin CLI (System‑Level Only)**

Claude must implement a **CLI tool** that manages **system operations only**.

### **Admin CLI must NOT manage:**

- rooms
- bookmarks
- campaign mapping
- group routing
- DM controls
- anything gameplay‑related

These are **DM‑managed inside the app**.

### **Admin CLI must manage:**

- backup/restore/delete campaigns
- backup/restore/delete recordings
- backup/restore/delete transcripts
- backup/restore/delete summaries
- system health checks
- service restart
- log inspection
- storage cleanup
- AI job queue inspection
- LiveKit server status
- backend status
- Redis/Postgres status

## **7. Core Technologies**

Claude must use:

- **Tauri** (Rust + WebView) for the desktop client
- **Rust LiveKit client** for audio + WebRTC
- **React + Radix UI** for DDB integration overlay
- **NodeJS Express** for backend API
- **Redis** for ephemeral state
- **Postgres** for persistent data
- **Caddy** for HTTPS + reverse proxy
- **DDB Auth** via cobalt cookie → JWT exchange
- **Shadow DOM overlay** injected into DDB Maps
- **Native hotkeys** via Tauri global shortcuts
- **Optional AI stack** (local or cloud)

## **8. Functional Requirements**

### **8.1 Tauri Client**

Claude must implement:

#### **Multi‑window support**

- Multiple windows can be opened
- Windows can be detached, dragged, resized
- Windows share the same Rust LiveKit client
- Windows communicate via Tauri events
- Windows can load:
  - DDB Maps
  - Character Sheets
  - Rules
  - DM Tools
  - Allowed external URLs

#### **Page restriction**

Only allow navigation to:

- `*.dndbeyond.com/*`
- `*.wizards.com/*`
- `*.dndbeyond.com/auth/*`
- Allowed list defined in config
- Block all other URLs

#### **Basic ad‑blocking**

Claude must implement:

- Request interception
- Block known ad domains
- Block trackers
- Block analytics
- Block autoplay video ads

#### **Overlay injection**

- Inject overlay only on Maps VTT
- Optional toggle for Character Sheet
- Optional “overlay everywhere” debug mode
- Overlay removed when leaving Maps (unless toggled)

#### **Audio continuity**

Switching windows or pages **must not disrupt audio**.
Rust LiveKit client runs once in the Tauri backend.

#### **Identity extraction**

- cobalt cookie detection
- JWT exchange
- character list
- selected character
- campaign ID
- map ID
- DM role
- token conditions

#### **DM controls**

- group routing
- audio FX
- bookmarks
- campaign mapping
- overlay toggles

#### **Global hotkeys**

- PTT
- mute
- group switch
- overlay toggle

### **8.2 Rust LiveKit Client**

Claude must implement:

- Native WebRTC
- Native audio device control
- Native echo cancellation
- Native track management
- Native group routing
- Native audio FX
- Native recording (future)
- Native long‑session stability
- Tauri commands bridging Rust ↔ JS

### **8.3 Backend (NodeJS Express)**

Claude must implement:

- Issue LiveKit tokens
- Store campaign → room mapping
- Store DM bookmarks
- Provide REST endpoints for:
  - audio FX
  - group management
  - chat logs
  - bookmarks
  - room metadata
  - recording control
  - transcription jobs
  - AI summary generation
- Serve the **public status page**
- Serve **client downloads**

### **8.4 LiveKit (Native)**

Claude must implement:

- Room creation
- Participant metadata
- Group audio isolation
- Audio FX routing
- Data events for chat + bookmarks
- Recording pipeline (server‑side or client‑side)

### **8.5 DDB Auth / Extraction**

Claude must implement:

- cobalt cookie detection
- POST `/v1/cobalt-token`
- JWT parsing
- Character Service calls
- DOM extraction for:
  - character metadata
  - campaign metadata
  - DM role
  - token conditions

### **8.6 AI Plugin (Recording + Transcription + Summary)**

Claude must implement:

#### **Recording**

- LiveKit server‑side recording OR
- Client‑side recording uploaded to backend

#### **Transcription**

- Local transcription via Whisper.cpp
- Cloud transcription via OpenAI Whisper API
- Store transcripts in Postgres

#### **AI Summaries**

- Local LLM via Ollama
- Cloud LLM via OpenAI/Claude
- Generate:
  - session summaries
  - chapter summaries
  - character‑specific summaries
  - DM‑only summaries
- Summaries anchored to DM bookmarks

#### **CLI Controls**

- backup/restore/delete recordings
- backup/restore/delete transcripts
- backup/restore/delete summaries

### **8.7 Admin CLI (System‑Level Only)**

Claude must implement:

- backup/restore/delete campaigns
- backup/restore/delete recordings
- backup/restore/delete transcripts
- backup/restore/delete summaries
- system health checks
- service restart
- log inspection
- storage cleanup
- AI job queue inspection
- LiveKit server status
- backend status
- Redis/Postgres status

## **9. Overlay Requirements**

Claude must implement the overlay using:

- A single injected root `<div>`
- A **shadow DOM** to avoid CSS collisions
- A left‑panel UI containing:
  - voice controls
  - group selector
  - minimal chat
  - speaking indicators
  - DM controls (if DM)

Overlay must be collapsible via:

- UI button
- hotkey

Overlay must **not** interfere with DDB canvas pointer events.

## **10. Session Model**

Claude must implement a **continuous timeline** with:

- DM‑placed bookmarks marking key points — e.g. session‑start, session‑end, chapter, battle, or custom DM‑defined markers
- Exportable logs
- AI summaries anchored to bookmarks

There is **no session start/end state** — bookmarks are typed markers on a single timeline, not a lifecycle. Detailed bookmark categories and management UI are scoped later; the rule here is only that bookmarks are markers, never a state machine (see §16 for why this differs from the prior system).

## **11. Identity Model**

Claude must implement:

### **Players**

- Log into DDB normally
- App extracts identity automatically
- No separate login

### **DM**

- Same as players
- DM role detected via DDB campaign metadata
- DM manages:
  - rooms
  - bookmarks
  - campaign mapping
  - group routing
  - audio FX

### **Operator**

- Uses CLI only
- No web login
- No passwords
- No MFA
- No auth complexity

There is no Spectator role in this build. The prior system's read‑only watch mode is deferred — it can be considered later as its own scoped addition, not folded in ad hoc.

## **12. Cross‑Platform Requirements**

Claude must ensure compatibility with:

- Windows → WebView2 (Chromium)
- macOS → WebKit
- Linux GNOME → WebKitGTK
- Linux KDE → WebKitGTK

Rust LiveKit client must provide **consistent audio behaviour across all OSes**.

## **13. Non‑Goals**

Claude must **not** implement:

- Browser extensions
- Docker
- Admin web UI
- Complex UI panels
- Campaign management inside the client
- Rust backend services (Rust stays confined to `tauri-client/` — see §3)
- Anything beyond voice + minimal chat + DM controls + optional AI plugin

## **14. Development Style**

Claude must:

- Generate modular, deterministic code
- Avoid monolithic files
- Prefer small, composable modules
- Use clear separation of concerns
- Avoid unnecessary abstractions
- Document assumptions explicitly
- Provide architecture diagrams when helpful
- Avoid hallucinating DDB internals — use DOM extraction + API calls only

## **15. Simplifications vs. Prior System**

This project is inspired by two archived predecessors — `vtt-chat` (a Docker‑deployed React/Node web app) and `vtt-chat-extension` (a three‑browser extension for DDB scraping) — but it is a deliberate simplification, not a port. Do not reintroduce the following, even if it looks useful:

- **No separate browser extension.** The prior system scraped DDB via a companion extension's `webRequest` interception, built and shipped for three browsers. This system does the equivalent inside the Tauri WebView directly — cobalt cookie detection + JWT exchange (§8.1, §8.5). One artifact, not two.
- **No Spectator role in v1.** The prior system had DM/Player/Spectator with a separate no‑account watch flow. This rebuild ships Player + DM only (§11).
- **No formal session state machine.** The prior system enforced a strict `IDLE → ACTIVE → PAUSED → COOLDOWN → ENDED` lifecycle, with every state change required to touch four layers (Postgres → Redis → WS broadcast → client store) in order. This rebuild uses a single continuous timeline with DM‑placed bookmarks (§10) — there is no session state to manage.
- **No Docker.** The prior system deployed via Docker Compose. This rebuild runs native services on Ubuntu Server (§4).

## **16. Prior Art (Reference Only)**

`vtt-chat` and `vtt-chat-extension` (both under `github.com/AndyProsser`) are archived and are not dependencies of this repo — nothing here should `import` from them or assume their code is present. They remain useful as **read‑only reference** for:

- DDB data‑extraction patterns and known DOM/API quirks (see the extension repo's `docs/DDB-DATA-EXTRACTION.md` and `docs/EXTENSION-INTEGRATION.md`)
- The trust‑delegation auth model (external platform session ⇒ app token) that this project adapts for its own cobalt‑cookie → JWT exchange (see the main repo's `docs/extension/GUEST-AUTH.md`)
- What a fuller feature set (inventory, chat commands, audio conditions) could look like *if* this project grows in that direction later

Consult them for ideas. Do not copy their architecture wholesale (Docker, the Express/Prisma monolith shape, the 4‑layer state machine, the browser extension) — see §15 for what is intentionally left behind.

## **17. Documentation Requirements**

Claude must keep the following documentation current as the project evolves. Update the relevant doc in the same change as the code it describes — don't batch documentation for later.

- `README.md` — project overview, quick start, links
- `CONTRIBUTING.md` — how to contribute, PR process, code style
- `DEVELOPING.md` — local dev environment setup
- `ROADMAP.md` — staged build order, dependencies, and definition-of-done per stage
- `docs/architecture/OVERVIEW.md` — system diagram + module responsibilities
- `docs/architecture/DDB-AUTH.md` — cobalt cookie → JWT exchange flow
- `docs/architecture/STATE-AND-RESILIENCE.md` — client state boundaries, leaf isolation, and recovery rules for long-running sessions
- `docs/CONVENTIONS.md` — folder/style conventions, detailed version of §3

Keep docs lean and current over exhaustive. A short doc that matches reality beats a long one that has drifted.

## **18. Strategic Goal**

Claude must understand the strategic goal:

> **This app replaces Discord for DDB campaigns.
> It is cross‑platform, lightweight, and deployable on a blank Ubuntu Server.
> It provides voice, chat, DM controls, recording, transcription, AI summaries, a public status page, multi‑window support, page restrictions, and basic ad‑blocking directly inside DDB Maps.**

This is the guiding principle for all design decisions.

## **19. Claude’s Output Expectations**

When asked to generate code or architecture, Claude must:

- Follow this document
- Use the module boundaries defined here
- Avoid adding features not listed
- Keep UI minimal
- Keep backend lightweight
- Keep Tauri app fast and simple
- Use DDB SSO via cobalt cookie
- Use **Rust LiveKit client** for all audio + WebRTC
- Use CLI for system‑level operations
- Provide a **public status page** and **client download links**
- Support **multi‑window Tauri**
- Support **page restrictions + ad‑blocking**
- Ensure **audio continuity across windows**
- Use **TypeScript** everywhere except the Tauri/Rust layer (§3)
- Use **React + Radix UI** for every UI surface — overlay and status page alike (§3)
- Use **npm workspaces**, one `package.json` per module (§3)
- Follow the **per‑module folder convention** — `components/`, `hooks/`, `consts/`, `types/`, `styles/`, `lib/` (§3)
