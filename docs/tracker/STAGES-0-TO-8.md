# Stages 0 to 8: foundations to operations

> **Moved from [ROADMAP.md](../../ROADMAP.md) on 2026-11-21, kept as written.** Detail, deliverables and decisions for the stages closed on 2026-11-15. The roadmap keeps a one-line summary of this stage; this file is the detail: the design, the decisions and who made them, and the build record. What has really run is in [BUILD-STATUS.md](../BUILD-STATUS.md). Index: [README.md](README.md).

## Stage 0 — Foundations

**Status:** 🟢 Done (carried over unchanged)

npm workspaces, root docs, per-module scaffolds, Cargo workspace in `tauri-client/`, CI (ESLint + Prettier + `tsc` for TS; `cargo fmt` + `clippy` for Rust), and the per-module folder convention.

**Note:** `typescript` is pinned to `^6.0.3` because `typescript-eslint` doesn't yet support TypeScript 7's compiler internals. `eslint-plugin-react`/`-hooks` are left out until their peer ranges support the repo's ESLint major; re-add them when real panel components land (Stage 4).

---

## Stage 0.5 — State & Resilience Architecture

**Status:** 🟢 Done (revised 2026-11-05 for the tray app)

The rules every stateful surface follows — leaf isolation, write discipline, bounded retention, the recovery contract, WebSocket reliability — in [docs/architecture/STATE-AND-RESILIENCE.md](../architecture/STATE-AND-RESILIENCE.md). The 2026-11-05 revision adds **"hidden is the default"**: tray state is Rust-owned, a panel hydrates from a snapshot every time it opens, and nothing runs while no panel is visible.

---

## Stage 1 — Pivot Cleanup

**Status:** 🟢 Complete 2026-11-05 — docs and code teardown done (v0.2.0)
**Depends on:** —

Make the repo match the new design, so nobody (human or Claude) builds on legacy patterns.

**Deliverables:**

- 🟢 Rewrite `.claude/CLAUDE.md`, `README.md`, `ROADMAP.md`, `DEVELOPING.md`, `CONTRIBUTING.md`, `docs/CONVENTIONS.md`, the architecture docs, and every module README
- 🟢 New design docs: [RECORDING-AND-SUMMARIES.md](../architecture/RECORDING-AND-SUMMARIES.md), [DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md)
- 🟢 Move everything specific to the old design into [docs/archive/](../archive/README.md) (WebKitGTK investigation, old specs/plans, DDB-AUTH)
- 🟢 **Remove legacy code** from `tauri-client/src-tauri/`: `allowlist.rs`, `blocked_page.rs`, `homepage_redirect.rs`, `safety_net.rs`, `cobalt.rs`, overlay injection, the `remote-ddb` capability, the DDB URL/domain consts, and the `dev-with-patched-webkitgtk` plumbing
- 🟢 **Replace `tauri-client/overlay-ui/`** with `panels-ui/` — keep the build/test scaffolding, the Radix/Zustand setup and the leaf-isolation helpers; delete the Shadow DOM mount, corner/expand stores, `CompactPanel`/`ExpandedPanel`, and `OverlayCornerMenu`
- 🟢 **Reshape `backend/`**: remove the DDB-identity `POST /api/session` contract (keep LiveKit token issuance); update `shared/` schemas accordingly
- 🟢 **Demote `ddb/`** to the optional character-import module (public pages only); remove the cobalt-cookie/JWT code or move it to `docs/archive/` (moved to `docs/archive/ddb-legacy/`)
- 🟢 Update `scripts/dev.ts`, `package.json` workspaces and CI for the new module set; strip the WebKitGTK/NVIDIA notes from `DEVELOPING.md`'s tooling assumptions (done in prose; confirm in the scripts)
- 🟢 A `tauri.conf.json` with **no remote origins**: strict CSP, local pages only (the tray and panel windows themselves are Stage 4; the shell is windowless until then)

**Done when:** `npm run lint`, `typecheck`, `build`, `test` and `cargo clippy` pass, and `grep -ri "cobalt\|allowlist\|dndbeyond\|overlay"` over `src/` returns nothing but the optional `ddb/` module.

---

## Stage 2 — Audio & Records Spike

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ In Progress — first findings logged in [AUDIO-SPIKE-RESULTS.md](../architecture/AUDIO-SPIKE-RESULTS.md) (platform audio layer chosen as the base; release-on-mute measured on Windows). Built without a live server: platform-audio client with release-on-mute and auto-rejoin, the `ai/` pipeline library, and the Part B runbook/scripts. **Still needs a live run:** acoustic AEC/CPU/latency, rejoin and sleep/wake, and Part B on a Linux server.
**Depends on:** Stage 1 (the Rust crate part can start immediately; it doesn't need the cleanup)

The riskiest unknowns are all "does this actually work on real machines with open mics?" — answer them with the smallest possible thing before any tray or React work.

**Part A — Headless client.** A headless Rust binary (extends `rust-livekit/examples/`): capture → echo cancellation → noise suppression → LiveKit room join → playback, with per-player gain. No Tauri, no UI.

**Part B — Server records smoke test.** Stand up LiveKit + **Egress** on a dev server; record per-speaker tracks from Part A; run ffmpeg → Whisper.cpp on them; summarise a transcript with Ollama. Throwaway scripts are fine.

**Deliverables:**

- Part A running on **Windows and Linux** with open mics and speakers (no headphones), measured for echo, noise, CPU and latency
- **Capture-device release on mute**: does it work on both OSes, and what is the unmute latency? Decides the hot-mic design (CLAUDE.md §8.1)
- **Auto-rejoin** after network drop and after sleep/wake
- Part B: per-speaker recording end-to-end; Whisper.cpp throughput on the dev server (real-time factor per `small`/`medium` model); a first summary
- Sizing numbers for [DEPLOYMENT-AND-TRANSPORT.md](../architecture/DEPLOYMENT-AND-TRANSPORT.md) and [RECORDING-AND-SUMMARIES.md](../architecture/RECORDING-AND-SUMMARIES.md)

**Done when:** two machines on different OSes hold a clean open-mic conversation, a server-side recording of it produces a correctly speaker-attributed transcript and a readable summary, and the measured numbers are written into the design docs.

**What carries over:** `rust-livekit` already does capture (`cpal`), `NativeAudioSource`, publish/subscribe and playback; the `loopback` example proved that pipeline against a real server (2026-08-09). This stage adds AEC/NS, gain, rejoin, and everything server-side.

---

## Stage 3 — Server Core

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Nearly done — built and verified against real services: identity/campaign domain, REST, WebSocket hub with a Valkey-backed replay buffer, Postgres store and migrations, recording state and consent acknowledgements, the Admin CLI (`vtt-admin`), and **both install tiers** (Docker Compose; native `infra/install.sh` on Ubuntu 24.04). **Remaining:** the "done when" test — a second person deploying from the docs on a blank VM
**Depends on:** Stage 2 (and the open identity decision, below)

**Decided with Andy (2026-11-05):** the identity & access model ([CLAUDE.md §11](../../.claude/CLAUDE.md#11-identity--access-model--direction-decided-2026-11-05-details-open)) and the sync protocol ([SYNC-PROTOCOL.md](../architecture/SYNC-PROTOCOL.md), draft). Remaining open: Admin quick-access extras, OIDC specifics, and the assumed defaults (invite expiry 7 days, magic-link lifetime 15 minutes, minimum password length 10).

**Deliverables:**

- Identity, instance bootstrap (first DM), campaigns, membership and access control; General channel + private campaign channels
- LiveKit token issuance per channel; room layout (General / Campaign / party splits)
- Postgres schema (campaigns, memberships, channels, messages, recordings, transcripts, summaries); Redis for ephemeral state
- WebSocket layer with a bounded replay buffer and snapshot fallback (per STATE-AND-RESILIENCE)
- **Docker Compose bundle** (primary) + Caddy + systemd + `infra/install.sh` (native, advanced) — voice only to start (records come in Stage 5). Both generate the same config; LiveKit on host networking in Compose
- UDP port documentation and an operator checklist, tested by a **second person** deploying from the docs

**Done when:** someone other than Andy can `docker compose up` on a blank Ubuntu VM (and, separately, run the native install script), bootstrap a campaign, and have two clients join its voice room.

---

## Stage 3b — Deployment Buildout (added 2026-11-11)

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Built; the real-VM run (#6) is the gate. The one-command installer `infra/get.sh` was added 2026-11-14
**Depends on:** Stage 3 (the Compose bundle), Stage 4 (the tray client and its updater)
**Design:** [VERSIONING-AND-DEPLOYMENT.md](../architecture/VERSIONING-AND-DEPLOYMENT.md)

**Goal:** the whole system deploys to a server from published images, so the full system can be tested end to end
(recording, summaries, real players), and only then refined. Versions, updates and onboarding are server-driven.

**Deliverables, in build order:**

| #   | Item                                                                                                                                                                                                                                                                    | Status                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Version rules** (MAJOR/MINOR/PATCH meaning, 0.y as the match tier) in CLAUDE.md, DEVELOPING.md and the design doc                                                                                                                                                     | 🟢 Done 2026-11-11                                                                                                                                               |
| 2   | **Container build workflow:** CI builds the backend and worker images on a release tag and pushes them to GHCR (full version + MAJOR.MINOR tags; dev tags never move `latest`); the Compose bundle pulls them by `VTT_VERSION` instead of building on the server        | 🟢 Run for dev.1 to dev.4; brought up locally from the images (2026-11-11), four bugs found and fixed                                                            |
| 3   | **Protocol version handshake:** `PROTOCOL_VERSION` in `shared/`, sent by the client and answered by the server, with "update required" on both sides; a CI test fails if a wire contract changes without it                                                             | 🟢 Done 2026-11-12: REST, WebSocket, and a CI guard that fails an unrecorded wire change                                                                         |
| 4   | **Server-chosen client builds:** the server offers the newest patch of its own MAJOR.MINOR, patches auto-approved, from GitHub releases (`UPDATES_SOURCE=github`)                                                                                                       | 🟢 Run against live GitHub (dev builds); waits for all three installers before offering a release                                                                |
| 5   | **Update mirror:** `UPDATES_SOURCE=mirror` sync job (verify signatures, newest patch plus one previous, cleanup), `vtt-admin updates sync/status`                                                                                                                       | 🟢 Done: tested against live GitHub (2026-11-15)                                                                                                                 |
| 6   | **Fresh-VM deploy test** from the images and the operator guide (the Stage 3 "done when"), with real LiveKit audio, `wss://` through Caddy and a Let's Encrypt certificate                                                                                              | 🟢 **Done on a real VM 2026-11-14 and tested since** (one-line install, real certificate, firewall, first Admin, voice and a recorded session)                   |
| 7   | **Web onboarding and app sign-in:** invite link → account → OS-specific install → "Open VTT Chat" hand-off (deep link, typed code, device code approved by scanning the app's QR or opening its link; no PKCE, see APP-SIGN-IN.md); the server owns the sign-in methods | 🟢 Built 2026-11-11 and tried locally by Andy: landing, sign-in (code, password), long link, the app connects with no prompt; other OSes and a phone untried     |
| 8   | **Mobile account and install flow:** security and profile (name, avatar) in the browser; the **Devices list with revoke** (`GET`/`DELETE /api/auth/sessions` already exist); add-to-home-screen steps for Android and iOS, then how to install the desktop app          | 🟢 Built 2026-11-13: the browser Account page (profile, recording notice, password, Devices with revoke); add-to-home-screen steps; not yet seen on a real phone |

**Done when:** an operator on a blank Ubuntu VM pulls the images, starts the stack, and a new player goes from an
invite link to a signed-in, preconfigured app without typing a server address; a client of the wrong MAJOR.MINOR is
told clearly to update; and a recorded session runs through to its summary.

---

## Stage 4 — Tray Client

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Feature-complete for players as of 2026-11-09; 🟡 fine-tuning and verification remain. One compact RPG-themed main window (avatar rail with speaking glow, quality-coloured connection sparkline, group sections and hover cards; themed chat with whispers; record state and consent; mute and level meter; voice connect), Settings as a popover (Profile with theme, photo, version and updates; Campaign; Sessions; Audio; Notifications; reorganised 2026-11-11), Handouts and Party-inventory windows, the DM **Scene Deck** (Voice, Stinger and Scene panels with favourites, custom scenes and per-type levels), loot with the SRD catalogue and treasure generator, scheduling with RSVP, account and character avatars, sound through the call, signed auto-update, start-with-computer, crash recovery and the DM connection screen. Voice runs on **LiveKit Rust SDK 0.10.1** (Linux builds need `clang`; see [DEVELOPING.md](../../DEVELOPING.md)). **Built since, unverified in a real window:** the session history window, the keyboard way to move people between groups, four more DM voices, and the opt-in mixer audio engine (per-person volume, microphone volume, a real level meter). **Not built:** a recorded 4-hour soak (`tauri-client/scripts/soak.sh` is ready), and checking the D&D Beyond sync's extra stats against real sheets. **Needs a human:** listen-tests of effects, character voices and the mixer engine, and a pass through the real window (unmute, rail drag, portrait upload, device switching, scene editor). Back up the updater key (`~/.tauri/vtt-chat-updater.key`) and give it a password before real releases. Detail of what is built vs verified: [docs/BUILD-STATUS.md](../BUILD-STATUS.md). Design: [main-window spec](specs/2026-11-08-main-window-design.md).
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ In Progress — the processing half is built and verified live (Egress files → durable job queue → worker → Whisper/LLM, local or remote with fallback → transcripts and summaries in Postgres; Admin CLI `jobs` / `recording`). **Records API built** (read, search, DM-only enforced at the API, DM delete). **History window built 2026-11-09 (unverified in a real window).** **Built 2026-11-10:** the DM confirms → purge raw audio, and a disk-low purge rule with a 3-day warning (the next-session rule is not built). **Not built:** extra cloud providers (Stage 10). Scene cues and chapters built 2026-11-14. The recording loop itself — DM start/stop → per-speaker capture gated on the consent acknowledgement → processing — is closed and verified live. See [docs/BUILD-STATUS.md](../BUILD-STATUS.md)
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Built end to end for players (server 2026-11-07, client 2026-11-08 to 09); 🟡 the full-session test below is not yet run. Server: chat and private whispers, handouts/maps/images/text snippets, loot with atomic claims, the DM soundboard (a mini thaumaturgy.app), session schedule + RSVP + reminders + stored notifications, and party split — see [TABLE-FEATURES.md](../architecture/TABLE-FEATURES.md). Client: chat and whispers, handouts, loot and party inventory, the Scene Deck, scheduling and RSVP, and party split in the rail (Stage 4). **Built 2026-11-11:** chat commands (in character, out of character, language styles, whispers by name, quick late/can't). **Dropped by decision (2026-11-14):** voice whispers; the party split already isolates one player with the DM. **Not built:** the end-to-end "full session" test below.
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Now **the web app on any device** (2026-11-11): the same app on phones and in desktop browsers, reached from the site's Chat link, sharing the Home look and the desktop's Default palette, with a members rail, chat commands and a secure cookie session. First cut built 2026-11-10 ([MOBILE-WEB-APP.md](../architecture/MOBILE-WEB-APP.md)): sign-in, chat with whispers, sessions with RSVP, handouts, history with summaries, transcripts and search, a handout viewer, and an install manifest. Exercised in a phone-sized headless browser; **not tried on a real phone**. No voice, by decision (the tray app owns audio)
**Depends on:** Stage 3 (API), Stage 6 (content)

`web/`: a basic mobile-first SPA designed more for messages than gaming — messages, RSVP, handouts, history/summaries, and possibly basic listen/talk (open question). Served by the box by default; Cloudflare Pages is an optional adapter.

**Done when:** a player on a phone can read the chat and summaries, RSVP, and open a handout. (Met in the headless run and on an iPhone, 2026-11-15.)

---

## Stage 8 — Operations: Admin CLI & Status Page

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Closed in code 2026-11-14. The Admin CLI (`vtt-admin`) is built and in use (Stage 3), with machine commands `logs`, `restart`, `ps`, `backup`, `restore`, `update` added; the public status page (`status/`, `/status` and `/api/status`) is built 2026-11-09, unverified on a real deployment
**Depends on:** Stage 5

**Deliverables:**

- **Admin CLI** (system-level only): backup/restore/delete campaigns, recordings, transcripts, summaries; reprocess a recording; health checks; service restart; log inspection; storage cleanup and retention; AI job-queue inspection; LiveKit/Egress/backend/Redis/Postgres status; instance bootstrap
- **Public status page** (`status/`): service health incl. the records pipeline, connected players, recording-active flag, client download links

**Explicitly out of scope for the CLI:** campaign contents, channels, markers, soundboard — those are DM-managed in the app (CLAUDE.md §7).

**Done when:** an operator can back up and restore a campaign, reprocess a recording, and see every service's health, without a browser or a password.
