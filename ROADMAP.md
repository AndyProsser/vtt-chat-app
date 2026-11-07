# Roadmap

**Purpose:** Stage-by-stage build order for VTT Chat App, derived from [.claude/CLAUDE.md](.claude/CLAUDE.md). Each stage lists its goal, what it depends on, its deliverables, and what "done" means. Detailed task breakdowns are written per-stage (via a proper implementation plan) when that stage actually starts — this document tracks shape and sequence, not tickets, so it stays accurate instead of going stale.

**Status legend:** 🟢 Done · 🟡 In Progress · ⚪ Not Started · ⚫ Superseded

> **Where things actually stand:** [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md) (built vs verified, and what needs the dev box).
>
> **Rewritten 2026-11-05.** The project changed direction on 2026-10-29: from a Tauri _browser_ that injected a voice overlay into D&D Beyond Maps, to a **self-hosted, audio-first system-tray app with server-side recording and AI summaries**. The old Stages 1–3a are summarised under [Legacy record](#legacy-record-the-ddb-overlay-design) with what carried over. The old stage documents are in [docs/archive/](docs/archive/README.md).
>
> **The design is not signed off.** The architecture sketch is unreviewed, several topics are open ([.claude/intent.md](.claude/intent.md)), and Stage 2 exists precisely to de-risk the hardest unknowns before anything else is built. Treat stages from 3 onward as shape, not commitment.

**Sequencing rule:** prove the riskiest cross-cutting unknowns first — audio quality and recording on real machines — before investing in feature breadth. State discipline ([Stage 0.5](#stage-05--state--resilience-architecture)) is locked in before any stateful UI is built.

**Principles every stage inherits** (from [CLAUDE.md §2](.claude/CLAUDE.md)): self-host first with zero cloud reliance; cloud is an optional advanced adapter; the server is the source of truth; consent is visible; quiet when idle.

---

## Stage 0 — Foundations

**Status:** 🟢 Done (carried over unchanged)

npm workspaces, root docs, per-module scaffolds, Cargo workspace in `tauri-client/`, CI (ESLint + Prettier + `tsc` for TS; `cargo fmt` + `clippy` for Rust), and the per-module folder convention.

**Note:** `typescript` is pinned to `^6.0.3` because `typescript-eslint` doesn't yet support TypeScript 7's compiler internals. `eslint-plugin-react`/`-hooks` are left out until their peer ranges support the repo's ESLint major; re-add them when real panel components land (Stage 4).

---

## Stage 0.5 — State & Resilience Architecture

**Status:** 🟢 Done (revised 2026-11-05 for the tray app)

The rules every stateful surface follows — leaf isolation, write discipline, bounded retention, the recovery contract, WebSocket reliability — in [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md). The 2026-11-05 revision adds **"hidden is the default"**: tray state is Rust-owned, a panel hydrates from a snapshot every time it opens, and nothing runs while no panel is visible.

---

## Stage 1 — Pivot Cleanup

**Status:** 🟢 Complete 2026-11-05 — docs and code teardown done (v0.2.0)
**Depends on:** —

Make the repo match the new design, so nobody (human or Claude) builds on legacy patterns.

**Deliverables:**

- 🟢 Rewrite `.claude/CLAUDE.md`, `README.md`, `ROADMAP.md`, `DEVELOPING.md`, `CONTRIBUTING.md`, `docs/CONVENTIONS.md`, the architecture docs, and every module README
- 🟢 New design docs: [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md), [DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md)
- 🟢 Move everything specific to the old design into [docs/archive/](docs/archive/README.md) (WebKitGTK investigation, old specs/plans, DDB-AUTH)
- 🟢 **Remove legacy code** from `tauri-client/src-tauri/`: `allowlist.rs`, `blocked_page.rs`, `homepage_redirect.rs`, `safety_net.rs`, `cobalt.rs`, overlay injection, the `remote-ddb` capability, the DDB URL/domain consts, and the `dev-with-patched-webkitgtk` plumbing
- 🟢 **Replace `tauri-client/overlay-ui/`** with `panels-ui/` — keep the build/test scaffolding, the Radix/Zustand setup and the leaf-isolation helpers; delete the Shadow DOM mount, corner/expand stores, `CompactPanel`/`ExpandedPanel`, and `OverlayCornerMenu`
- 🟢 **Reshape `backend/`**: remove the DDB-identity `POST /api/session` contract (keep LiveKit token issuance); update `shared/` schemas accordingly
- 🟢 **Demote `ddb/`** to the optional character-import module (public pages only); remove the cobalt-cookie/JWT code or move it to `docs/archive/` (moved to `docs/archive/ddb-legacy/`)
- 🟢 Update `scripts/dev.ts`, `package.json` workspaces and CI for the new module set; strip the WebKitGTK/NVIDIA notes from `DEVELOPING.md`'s tooling assumptions (done in prose; confirm in the scripts)
- 🟢 A `tauri.conf.json` with **no remote origins**: strict CSP, local pages only (the tray and panel windows themselves are Stage 4; the shell is windowless until then)

**Done when:** `npm run lint`, `typecheck`, `build`, `test` and `cargo clippy` pass, and `grep -ri "cobalt\|allowlist\|dndbeyond\|overlay"` over `src/` returns nothing but the optional `ddb/` module.

---

## Stage 2 — Audio & Records Spike

**Status:** 🟡 In Progress — first findings logged in [AUDIO-SPIKE-RESULTS.md](docs/architecture/AUDIO-SPIKE-RESULTS.md) (platform audio layer chosen as the base; release-on-mute measured on Windows). Built without a live server: platform-audio client with release-on-mute and auto-rejoin, the `ai/` pipeline library, and the Part B runbook/scripts. **Still needs a live run:** acoustic AEC/CPU/latency, rejoin and sleep/wake, and Part B on a Linux server.
**Depends on:** Stage 1 (the Rust crate part can start immediately; it doesn't need the cleanup)

The riskiest unknowns are all "does this actually work on real machines with open mics?" — answer them with the smallest possible thing before any tray or React work.

**Part A — Headless client.** A headless Rust binary (extends `rust-livekit/examples/`): capture → echo cancellation → noise suppression → LiveKit room join → playback, with per-player gain. No Tauri, no UI.

**Part B — Server records smoke test.** Stand up LiveKit + **Egress** on a dev server; record per-speaker tracks from Part A; run ffmpeg → Whisper.cpp on them; summarise a transcript with Ollama. Throwaway scripts are fine.

**Deliverables:**

- Part A running on **Windows and Linux** with open mics and speakers (no headphones), measured for echo, noise, CPU and latency
- **Capture-device release on mute**: does it work on both OSes, and what is the unmute latency? Decides the hot-mic design (CLAUDE.md §8.1)
- **Auto-rejoin** after network drop and after sleep/wake
- Part B: per-speaker recording end-to-end; Whisper.cpp throughput on the dev server (real-time factor per `small`/`medium` model); a first summary
- Sizing numbers for [DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md) and [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md)

**Done when:** two machines on different OSes hold a clean open-mic conversation, a server-side recording of it produces a correctly speaker-attributed transcript and a readable summary, and the measured numbers are written into the design docs.

**What carries over:** `rust-livekit` already does capture (`cpal`), `NativeAudioSource`, publish/subscribe and playback; the `loopback` example proved that pipeline against a real server (2026-08-09). This stage adds AEC/NS, gain, rejoin, and everything server-side.

---

## Stage 3 — Server Core

**Status:** 🟡 In Progress — identity/campaign domain, REST layer and in-memory WebSocket hub built and tested (Rust WebSocket client built (`rust-sync`, not yet wired into the shell); Valkey replay buffer written but tested only against a fake; recording state + consent acknowledgement built (server + Rust coordinator, verified once against the real backend); no Postgres adapter, CLI or install script yet); schema written but untested
**Depends on:** Stage 2 (and the open identity decision, below)

**Decided with Andy (2026-11-05):** the identity & access model ([CLAUDE.md §11](.claude/CLAUDE.md#11-identity--access-model--direction-decided-2026-11-05-details-open)) and the sync protocol ([SYNC-PROTOCOL.md](docs/architecture/SYNC-PROTOCOL.md), draft). Remaining open: Admin quick-access extras, OIDC specifics, and the assumed defaults (invite expiry 7 days, magic-link lifetime 15 minutes, minimum password length 10).

**Deliverables:**

- Identity, instance bootstrap (first DM), campaigns, membership and access control; General channel + private campaign channels
- LiveKit token issuance per channel; room layout (General / Campaign / party splits)
- Postgres schema (campaigns, memberships, channels, messages, recordings, transcripts, summaries); Redis for ephemeral state
- WebSocket layer with a bounded replay buffer and snapshot fallback (per STATE-AND-RESILIENCE)
- **Docker Compose bundle** (primary) + Caddy + systemd + `infra/install.sh` (native, advanced) — voice only to start (records come in Stage 5). Both generate the same config; LiveKit on host networking in Compose
- UDP port documentation and an operator checklist, tested by a **second person** deploying from the docs

**Done when:** someone other than Andy can `docker compose up` on a blank Ubuntu VM (and, separately, run the native install script), bootstrap a campaign, and have two clients join its voice room.

---

## Stage 4 — Tray Client

**Status:** 🟡 In Progress — the Rust core is wired and verified: tray icon with live / muted / recording / paused / disconnected states, mic gate (player mute + consent gate), signed-in session over `rust-sync`, the consent flow (verified live against a real backend). **Not built:** panels (`panels-ui` is still a placeholder), sign-in UI, channel switcher, autostart, auto-update, the 4-hour soak. See [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md)
**Depends on:** Stage 2 (audio engine), Stage 3 (server to connect to)

**Deliverables:**

- Tray icon with live / muted / recording / disconnected states, driven from the Rust core
- Floating panels (`panels-ui/`), position/size remembered; **no panel needed for audio to work**
- Hotkeys (PTT, mute, panel toggle) with the platform limits documented — bare-modifier PTT is app-focused only; Wayland global shortcuts no-op
- Autostart, auto-update, crash recovery, auto-rejoin; near-zero idle CPU verified
- First panels: connection/roster, mute/PTT, channel switcher
- Light/dark follows the OS; simple but stylish

**Done when:** a player installs the app, signs in, joins the campaign, hides it, and plays a 4-hour session without touching it again — surviving a Wi-Fi drop and a laptop sleep — with idle CPU at ~0 and the tray icon always telling the truth.

---

## Stage 5 — Records & AI Summaries (Core)

**Status:** 🟡 In Progress — the processing half is built and verified live (Egress files → durable job queue → worker → Whisper/LLM, local or remote with fallback → transcripts and summaries in Postgres; Admin CLI `jobs` / `recording`). **Not built:** the link from a finished Egress recording to the database rows, the records API and history panel, search, and the cloud-adapter extras. See [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md)
**Depends on:** Stage 3, Stage 4 (Stage 2 Part B already proved the pipeline shape)

**Deliverables:**

- Recording control from the DM's panel; recording state in server metadata
- **Consent cue**: local start/stop cues, late-joiner gating, rejoin suppression, per-player acknowledgement with expiry, persistent indicator (tray + panel)
- Egress per-speaker recording; private/whisper audio excluded at the routing layer
- `ai/` pipeline: transcode → Whisper.cpp per track → merge by timestamp → Ollama summaries (session, chapter, character-specific, DM-only), with a retryable job queue
- Records API + a history/summary panel; search across a campaign's history
- Optional cloud adapters (OpenAI Whisper, cloud LLM) behind explicit operator config
- Resolve the open records questions: markers vs. topic shifts, pause/resume, retention default

**Done when:** a real session is recorded with every player hearing the cue, produces a speaker-attributed transcript and summaries entirely on the self-hosted box, DM-only summaries are verifiably DM-only, and nothing from a whisper appears in any artifact.

---

## Stage 6 — Table Features

**Status:** ⚪ Not Started
**Depends on:** Stage 5

**Deliverables:**

- Chat, DM/player whispers, handouts/maps/images, text snippets (bounded retention, per STATE-AND-RESILIENCE)
- Loot drops with pickers
- DM soundboard: own and per-player audio, instant and background effects
- Party split: DM in all groups, players isolated; DM drag between groups
- Session scheduling in the tray: reminders and RSVP (can make it / late / can't)
- In-session and post-session history access

**Done when:** a full session runs with whispers, a handout, a loot drop, a party split and soundboard effects, all surviving a reconnect without duplicates.

---

## Stage 7 — Mobile SPA

**Status:** ⚪ Not Started
**Depends on:** Stage 3 (API), Stage 6 (content)

`web/`: a basic mobile-first SPA designed more for messages than gaming — messages, RSVP, handouts, history/summaries, and possibly basic listen/talk (open question). Served by the box by default; Cloudflare Pages is an optional adapter.

**Done when:** a player on a phone can read the chat and summaries, RSVP, and open a handout.

---

## Stage 8 — Operations: Admin CLI & Status Page

**Status:** ⚪ Not Started
**Depends on:** Stage 5

**Deliverables:**

- **Admin CLI** (system-level only): backup/restore/delete campaigns, recordings, transcripts, summaries; reprocess a recording; health checks; service restart; log inspection; storage cleanup and retention; AI job-queue inspection; LiveKit/Egress/backend/Redis/Postgres status; instance bootstrap
- **Public status page** (`status/`): service health incl. the records pipeline, connected players, recording-active flag, client download links

**Explicitly out of scope for the CLI:** campaign contents, channels, markers, soundboard — those are DM-managed in the app (CLAUDE.md §7).

**Done when:** an operator can back up and restore a campaign, reprocess a recording, and see every service's health, without a browser or a password.

---

## Stage 9 — Cross-Platform Hardening & Production Readiness

**Status:** ⚪ Not Started
**Depends on:** Stage 5 (can overlap Stages 6–8)

**Deliverables:**

- Verified audio parity on Windows, Linux (GNOME + KDE) and, if a player appears, macOS
- Tray behaviour documented per desktop (GNOME AppIndicator, Wayland limits) with graceful degradation
- Real 8+ hour soak with churn, memory profiled against the Stage 0.5 rules
- A real server-restart-mid-recording drill: recording recovers or fails loudly, never silently
- Security pass: consent-cue bypass attempts, private-audio leakage into records, token/session expiry, ACL checks on every records endpoint
- Packaging: installers per OS, signed where practical, updater verified

**Done when:** a full real campaign session runs on all supported platforms without manual intervention.

---

## Stage 10 — Optional Integrations (Advanced Users)

**Status:** ⚪ Not Started
**Depends on:** Stage 5; none of it is on the critical path

Each item is independent, off by default, and must never be assumed by application code:

- D&D Beyond character import from public pages (`ddb/`)
- Cloudflare TURN (extra ICE server); Cloudflare Realtime SFU as an alternative to LiveKit (a large design of its own); Cloudflare Pages for static hosting
- Cloud transcription / LLM providers beyond Stage 5's first adapters
- OIDC/Authelia SSO, if the identity decision allows
- Remote AI backends (Whisper/LLM on another machine, e.g. a GPU PC) are a Stage 5 provider-interface concern, not Stage 10

---

## Legacy record: the DDB-overlay design

For anyone wondering what happened to the first four stages. Details are in [docs/archive/](docs/archive/README.md).

| Old stage                                                 | Outcome                       | What carried over                                                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Foundations                                           | 🟢 kept                       | Everything                                                                                                                                                                                                             |
| 0.5 — State & resilience                                  | 🟢 kept, revised              | Everything; added "hidden is the default"                                                                                                                                                                              |
| 1 — Walking skeleton: DDB auth + voice                    | ⚫ superseded                 | `rust-livekit` audio capture/publish/subscribe/playback and the `loopback` harness; LiveKit token issuance in `backend/`. The DDB-auth half was never verified against live traffic (no second account) and is dropped |
| 2 — Hotkeys, page restriction, ad-block                   | ⚫ superseded                 | The **hotkey findings**: bare-modifier PTT can't be a global shortcut; Wayland global shortcuts silently no-op. Page restriction and ad-block are gone with the embedded browser                                       |
| 3a — Overlay UI (Plans A/B/C)                             | ⚫ superseded                 | Plan B's Rust-owned WebSocket model with a bounded replay buffer is the candidate for client↔server sync. Plan A (overlay) and Plan C (D&D conditions) are obsolete                                                    |
| 3b — DDB DOM extraction                                   | ⚫ dropped                    | —                                                                                                                                                                                                                      |
| 3.5 — Text chat                                           | ⚫ folded into Stage 6        | —                                                                                                                                                                                                                      |
| 4 — Multi-window & DM controls                            | ⚫ replaced by Stages 4 and 6 | Group/party model                                                                                                                                                                                                      |
| 5–8 — Persistence, status page, CLI, AI plugin, hardening | ⚫ reshaped                   | Became Stages 3, 5, 8, 9. **The AI plugin is no longer "optional, future" — it is core (Stage 5).**                                                                                                                    |

Two other things that ended with the old design, deliberately recorded so they aren't rediscovered:

- **The WebKitGTK/NVIDIA EGL crash** (a null-pointer path in WebKitGTK's accelerated backing store, then NVIDIA's proprietary EGL driver) and the blank-render follow-on were investigated at length and are archived. They affected only the embedded DDB browser. Panels are local React pages, so they should not matter to the tray app; if a panel ever shows a blank render on Linux+NVIDIA, start from the archive.
- **The animated-Maps-background blank render** was never root-caused and is moot.

## Out of Scope

Per [CLAUDE.md §13](.claude/CLAUDE.md) — not planned at any stage: an embedded browser or any page injection, browser extensions, a Docker-only deployment (native stays supported), an admin web UI, VTT features (maps, tokens, dice, sheets), video, Rust backend services, a hard dependency on any cloud service, a Spectator role, or a formal session state machine.

## See Also

- [.claude/CLAUDE.md](.claude/CLAUDE.md) — full architecture spec and constraints
- [.claude/intent.md](.claude/intent.md) — current threads and the open design topics
- [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) — system diagram and module responsibilities
- [docs/architecture/RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md)
- [docs/architecture/DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md)
- [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md)
