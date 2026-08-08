# Roadmap

**Purpose:** Stage-by-stage build order for VTT Chat App, derived from [CLAUDE.md](CLAUDE.md). Each stage lists its goal, what it depends on, its deliverables, and what "done" means. Detailed task breakdowns are written per-stage (via a proper implementation plan) when that stage actually starts — this document tracks shape and sequence, not tickets, so it stays accurate instead of going stale.

**Status legend:** 🟢 Done · 🟡 In Progress · ⚪ Not Started

Sequencing rule: stages are ordered to prove the riskiest cross-cutting integration (DDB auth + native audio + overlay injection) as early as possible, before investing in feature breadth. State management discipline ([Stage 0.5](#stage-05--state--resilience-architecture)) is locked in before any stateful UI is built, not retrofitted after the fact — see [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md) for why.

---

## Stage 0 — Foundations

**Status:** 🟡 In Progress
**Depends on:** —

Repo scaffold, monorepo tooling, and baseline docs.

**Deliverables:**

- 🟢 npm workspaces + root `package.json`
- 🟢 Root docs: `README.md`, `CONTRIBUTING.md`, `DEVELOPING.md`
- 🟢 Architecture docs: `docs/architecture/OVERVIEW.md`, `docs/architecture/DDB-AUTH.md`, `docs/CONVENTIONS.md`
- 🟢 Per-module `README.md` stubs (`backend/`, `ddb/`, `ai/`, `status/`, `shared/`, `tauri-client/`, `livekit/`, `infra/`)
- 🟢 Cargo workspace initialized in `tauri-client/` (`src-tauri/` + `rust-livekit/` crates)
- 🟢 CI pipeline: ESLint + Prettier + `tsc --noEmit` for TS packages, `cargo fmt --check` + `cargo clippy` for Rust
- 🟢 Initial `shared/` package: empty but building, with the folder convention in place (§3 of CLAUDE.md) — and the same scaffold (`package.json`, `tsconfig.json`, folder convention) applied to `backend/`, `ddb/`, `ai/`, `status/`, `tauri-client/overlay-ui/` so every workspace package actually builds

**Done when:** `npm install` succeeds at the root, every workspace package builds (even if empty), and CI runs lint on a PR.

Verified locally: `npm install`, `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run build` all pass across every workspace package. `cargo fmt --check` and `cargo clippy` pass for both Rust crates. `cargo build`'s final linking step for the `src-tauri` binary is untested on this machine (missing the MSVC linker / VS Build Tools on Windows) — CI runs on `ubuntu-latest`, which has a linker preinstalled, so this should still go green there; needs a first real CI run to confirm.

**Note:** `typescript` is pinned to `^6.0.3`, not the `^7.0.2` from the prior commit — `typescript-eslint` (latest, 8.66.0) doesn't yet support TypeScript 7's compiler internals (peer range caps at `<6.1.0`). Revisit once `typescript-eslint` catches up. Similarly, `eslint-plugin-react`/`eslint-plugin-react-hooks` were left out of the ESLint config for now — `eslint-plugin-react`'s peer range caps at ESLint `^9.7`, short of the `^10.0.0` this repo pins, and there's no real JSX yet to lint. Add them back in Stage 3 when `overlay-ui`/`status` get real components, checking peer-range compatibility again at that point.

---

## Stage 0.5 — State & Resilience Architecture

**Status:** 🟢 Done
**Depends on:** Stage 0

No feature code — this locks in the rules every later stateful surface must follow, informed directly by the prior system's multi-week memory-leak and state-recovery postmortem.

**Deliverables:**

- 🟢 [`docs/architecture/STATE-AND-RESILIENCE.md`](docs/architecture/STATE-AND-RESILIENCE.md) — store boundaries (domain vs. UI-only), leaf-isolation pattern, write discipline, timer/animation rules, bounded retention, recovery contract, WebSocket reliability model
- 🟢 Code-review checklist item enforcing "no composed projection objects passed to leaf components" — see [CONTRIBUTING.md](CONTRIBUTING.md#state--resilience-checklist) (a lint rule can replace/augment this later; not required to close this stage)
- 🟢 Dev-mode churn-diagnostics flag scaffolded in `overlay-ui/` (`lib/churnDiagnostics.ts` + `hooks/useChurnDiagnostics.ts`) — no-op until Stage 3 wires it into real selectors

**Done when:** the document exists and is linked from `CLAUDE.md` §17 and `README.md`, and there's at least a manual checklist (lint rule can come later) reviewers use before merging new stores/selectors.

---

## Stage 1 — Walking Skeleton: Auth + Voice End-to-End

**Status:** 🟡 In Progress
**Depends on:** Stage 0

Prove the riskiest integration — DDB auth, native audio, and overlay injection — works end-to-end before building any real feature UI. No chat, no bookmarks, no DM tools, no multi-window yet.

**Deliverables:**

- 🟢 Cobalt cookie detection in the Tauri WebView (`tauri-client/src-tauri/`) — async `WebviewWindow::cookies_for_url` polling, per the now-resolved [DDB-AUTH.md](docs/architecture/DDB-AUTH.md)
- 🟢 Cobalt → JWT exchange + Character Service call (`ddb/`), per [docs/architecture/DDB-AUTH.md](docs/architecture/DDB-AUTH.md)
- 🟢 Backend endpoint that accepts extracted identity and issues an app session + LiveKit token (`backend/`)
- 🟢 Rust LiveKit client (`tauri-client/rust-livekit/`) joins a room, publishes the default mic (via `cpal`), and plays back subscribed remote tracks
- 🟢 Minimal overlay (`tauri-client/overlay-ui/`) — a single Shadow DOM root showing "connected" + the live participant list, with leaf-isolated selectors per Stage 0.5
- ⚪ Native LiveKit server running in dev mode — now running as a systemd service (`livekit-dev.service`, `livekit-server --dev --bind 0.0.0.0`) on Andy's dev VM (see [DEVELOPING.md](DEVELOPING.md#running-stage-1-locally) for connecting to it); not yet run end-to-end against the app

**Done when:** two instances of the app, logged into DDB as two different users in the same campaign, can hear each other over LiveKit, with identity correctly extracted from DDB for both.

**Verified locally:** `npm run lint`, `format:check`, `typecheck`, and `build` pass across every TS workspace; `cargo fmt --check`, `cargo clippy`, and a full `cargo build` (real linking, not just `cargo check`) pass for both Rust crates on Windows; the built binary launches, opens a window, and injects the overlay bundle without crashing. **Not yet verified:** an actual DDB login (no test account available this session — cobalt-token/Character Service field names in `ddb/` are inferred from archived docs and flagged for live-traffic verification), a real LiveKit connection, or the two-account "done when" bar above — those need the local dev services running and a second DDB account, which is on you per the setup in [DEVELOPING.md](DEVELOPING.md#running-stage-1-locally).

**Notes:** the [DDB-AUTH.md open questions](docs/architecture/DDB-AUTH.md#resolved-cookie-access-exchange--refresh-stage-1) are resolved — see that section for the cookie access mechanism and JWT refresh strategy this stage implements.

**Known issue (Linux):** loading the bare `dndbeyond.com` marketing homepage reliably segfaults WebKitGTK on at least one Linux+NVIDIA dev setup — reproduced independently in Epiphany (GNOME Web) on the same machine, so it's a WebKitGTK/graphics-stack issue, not app code. Likely cause: the homepage embeds several native `<video class="SiteWide_backgroundVideo">` autoplay hero banners (`video/mp4` + `video/webm` sources from `cdn.media.amplience.net`); WebKitGTK's GStreamer/VA-API video decode path is a known crash-prone area with NVIDIA's proprietary driver on Linux. `/characters` and individual character-sheet pages (the pages this app actually cares about) have no such video elements and load fine. `consts::DDB_URL` in `tauri-client/src-tauri/` points at `/characters` rather than the bare domain for this reason. Not yet confirmed via symbolized backtrace (gdb+debuginfod was still resolving symbols as of this writing); if it resurfaces, retest in Epiphany first to confirm it's environmental before assuming a regression in this app — and note Stage 2's autoplay-video-ad blocking (§8.1) would likely dodge this same crash class as a side effect.

**Known issue (Linux):** the Wizards login page's plain email/password form silently fails to submit under WebKitGTK's real UA (reproduced in Epiphany too) — Akamai Bot Manager fronting that domain plausibly distrusts WebKitGTK's fingerprint. A Chrome UA spoof made this *worse* (an active block page, live-tested and reverted); a **Firefox-on-Linux UA spoof works** and is applied app-wide via `consts::LINUX_UA_OVERRIDE` (`tauri-client/src-tauri/`). Steam/Google/Apple OAuth remains the documented fallback if this ever stops working. See [DDB-AUTH.md#known-issue-login-form-fails-under-webkitgtk-akamai-bot-manager](docs/architecture/DDB-AUTH.md#known-issue-login-form-fails-under-webkitgtk-akamai-bot-manager) for the full writeup.

---

## Stage 2 — Audio Continuity, Hotkeys, Page Restriction & Ad-Block

**Status:** ⚪ Not Started
**Depends on:** Stage 1

Round out the Tauri shell requirements that don't depend on the overlay having real features yet.

**Deliverables:**

- Audio survives window navigation/switching — Rust LiveKit client confirmed to run once per app instance, decoupled from any single window (§8.1)
- Global hotkeys: PTT, mute, overlay toggle
- Page-restriction allowlist (`*.dndbeyond.com/*`, `*.wizards.com/*`, configurable allowed list) with navigation blocking
- Basic ad-block: known ad/tracker/analytics domain blocking, autoplay video blocking

**Done when:** navigating around DDB (Maps, Character Sheet, Rules) in one window doesn't interrupt an active voice call, blocked domains actually fail to load, and PTT/mute work via hotkey without the overlay focused.

---

## Stage 3 — Overlay UI, DDB Extraction & Chat

**Status:** ⚪ Not Started
**Depends on:** Stage 2, Stage 0.5

The first real test of the state architecture: speaking indicators, presence, and chat are exactly the "rapidly-changing, long-running" surfaces Stage 0.5 exists for.

**Deliverables:**

- Full Shadow DOM overlay: voice controls, group selector, speaking indicators (leaf-isolated per Stage 0.5), minimal chat
- DOM extraction for character metadata, campaign metadata, token conditions (`ddb/` + `overlay-ui/`)
- Overlay injection scoped to Maps VTT only, with the "overlay everywhere" debug toggle
- Refresh recovery implemented and manually verified: reload the WebView mid-session, confirm domain state (roster, presence, chat) comes back atomically and UI-only state (panel state) restores separately
- Reconnect/backoff + bounded event-replay on the WebSocket layer (per [STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md#websocket-reliability))

**Done when:** a simulated multi-hour session (can be sped up / synthetic load in dev) with continuous speaking-state churn shows stable memory in the overlay's WebView, and a mid-session refresh recovers full state within a couple seconds with no duplicate messages or stuck indicators.

---

## Stage 4 — Multi-Window & DM Controls

**Status:** ⚪ Not Started
**Depends on:** Stage 3

**Deliverables:**

- Multi-window support: spawn, detach, drag, resize; windows share the one Rust LiveKit client and communicate via Tauri events
- Windows can load DDB Maps, Character Sheets, Rules, DM Tools, and allowed external URLs (subject to Stage 2's restriction list)
- DM controls: group routing, audio FX, campaign mapping, overlay toggles
- Bookmark model: DM-placed markers on the continuous timeline (session-start, chapter, battle, custom) — no session state machine, per [CLAUDE.md §10](CLAUDE.md)

**Done when:** a DM can open a second window for DM Tools while Maps stays open in the first, place a bookmark, route two players into a sub-group, and none of it interrupts ongoing audio.

---

## Stage 5 — Persistence, Status Page & Deployment Infra

**Status:** ⚪ Not Started
**Depends on:** Stage 4

Move from dev-mode services to the real native-Ubuntu deployment target, and ship the public status page.

**Deliverables:**

- Postgres schema for campaigns, rooms, bookmarks; Redis for ephemeral/pub-sub state
- Caddy reverse proxy + TLS config
- Network topology per [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md#network-topology-stunturn--ports): STUN-only default, LiveKit's built-in TURN/TLS-on-443 as an operator-toggleable fallback, required port-forwarding documented in [livekit/README.md](livekit/README.md#network-topology-ports-stunturn) and [infra/README.md](infra/README.md#operator-firewall--port-forwarding-checklist)
- Public status page (`status/`): LiveKit/backend/Redis/Postgres health, connected player count, DM-connected flag, current campaign/room/map, client download links (§5)
- `infra/`: bash install script, systemd units, config generation for a blank Ubuntu Server

**Done when:** a fresh Ubuntu Server VM can run the install script and end up with a working backend + LiveKit + status page + Caddy, no Docker, no manual steps beyond running the script.

---

## Stage 6 — Admin CLI (System-Level Only)

**Status:** ⚪ Not Started
**Depends on:** Stage 5

**Deliverables:**

- Backup/restore/delete for campaigns, recordings, transcripts, summaries
- System health checks, service restart, log inspection, storage cleanup
- LiveKit/backend/Redis/Postgres status checks
- AI job queue inspection (stubbed until Stage 7 exists)

**Explicitly out of scope for this CLI:** rooms, bookmarks, campaign mapping, group routing, DM controls — those stay DM-managed inside the app (§6).

**Done when:** an operator with shell access to the Ubuntu Server can back up and restore a campaign, and check the health of every native service, without touching a browser or a password.

---

## Stage 7 — AI Plugin (Optional, Future)

**Status:** ⚪ Not Started
**Depends on:** Stage 5, Stage 6

Off by default. Only build once the core app is stable and in real use — this is the most speculative stage.

**Deliverables:**

- Recording: LiveKit server-side or client-side, uploaded to backend
- Transcription: Whisper.cpp (local) or OpenAI Whisper API (cloud), stored in Postgres
- AI summaries: Ollama (local) or OpenAI/Claude (cloud) — session, chapter, character-specific, DM-only, anchored to bookmarks
- CLI controls for backup/restore/delete of recordings/transcripts/summaries (extends Stage 6)

**Done when:** a recorded session produces a transcript and a bookmark-anchored summary, entirely via local models, with cloud providers as an opt-in swap.

---

## Stage 8 — Cross-Platform Hardening & Production Readiness

**Status:** ⚪ Not Started
**Depends on:** Stage 5 (can run in parallel with Stage 6/7)

**Deliverables:**

- Verified parity across WebView2 (Windows), WebKit (macOS), WebKitGTK (Linux GNOME/KDE) — especially audio device behavior
- Real 8+ hour soak test with active speaking/presence churn, memory profiled against the Stage 0.5 rules
- A real restart-survival drill on the target deployment (not just simulated in tests)
- Security pass: page-restriction bypass attempts, ad-block false positives on DDB itself, token/session expiry handling

**Done when:** the app has run a full real campaign session (8+ hours) on all three platforms without manual intervention, and a server restart mid-session recovers cleanly per the Stage 3 recovery contract.

---

## Out of Scope

Per [CLAUDE.md §13](CLAUDE.md) — not planned at any stage: browser extensions, Docker, an admin web UI, in-client campaign management, Rust backend services, a Spectator role, or a formal session state machine.

## See Also

- [CLAUDE.md](CLAUDE.md) — full architecture spec and constraints
- [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) — system diagram + module responsibilities
- [docs/architecture/DDB-AUTH.md](docs/architecture/DDB-AUTH.md) — cobalt cookie → JWT flow
- [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md) — state management rules referenced throughout Stages 0.5–3
