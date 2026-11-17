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

## Where we are and what is next

### Stages 0 to 8 are closed (2026-11-15)

Everything through Stage 8 is built and has been used for real: the one-command install on a real Ubuntu VM behind Cloudflare, the
desktop app and an iPhone against it, a recording with human voices through the local AI, the update feed against live GitHub,
and two clients' voice. From here, a problem found in any of these stages is a **bug** (fixed in a patch release), and new work
belongs to a future stage (9 onwards). A few checks were never run on their own hardware (Windows, macOS, Android, a second person's
install); if one fails it is a bug report, not an open stage.

| Stage                  | State                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0, 0.5, 1              | 🟢 Closed                                                                                                                              |
| 2 Audio spike          | 🟢 Closed; measured on the dev PC                                                                                                      |
| 3 Server core          | 🟢 Closed; both install tiers, chat persistence                                                                                        |
| 3b Deployment buildout | 🟢 Closed; images, handshake, updates (including the live GitHub feed), web onboarding, Devices, the real-VM run                       |
| 4 Tray client          | 🟢 Closed; used on Linux against the real server                                                                                       |
| 5 Records and AI       | 🟢 Closed; a real recording with human voices on the VM's CPU AI works (slow; the GPU PC is the fast path)                             |
| 6 Table features       | 🟢 Closed. **Voice whispers are dropped** (decided 2026-11-14): players whisper by text; the DM speaks to one player in a private talk |
| 7 Web app              | 🟢 Closed; checked in a headless browser and on an iPhone                                                                              |
| 8 Operations           | 🟢 Closed; Admin CLI, status page, backup and restore                                                                                  |

**Done 2026-11-12 to 14 (since the last stock-take):** the browser Account page (profile, recording notice, collapsed password,
Devices with revoke); **request to join** a campaign (opt-in directory, DM approves); the DM's notes and schedule in the web
chat; a typeface for each `/say-<language>` line; Enter sends and Ctrl+Enter makes a new line in both apps; web layout that
scales; **scene changes start chapters** and the summaries are told what the table heard (`RECORD_CUES`, names only, scene
changes by default); a recommended CPU-only setup with a gaming PC as the fast path; the blank-install rehearsal, backup and
restore, and a 90-minute soak; a graceful server shutdown; `.rpm` for real releases; and the **one-command operator install**
(`infra/get.sh`) with `vtt-admin logs/restart/ps/backup/restore/update`.

**Releases:** 0.4.1 to 0.4.5 shipped from what the real VM and real use found (0.4.0 and 0.4.4 were tagged but never published as
releases; the 0.4.5 changelog covers both).

**Next:**

1. **Bug fixes** as they turn up, in patch releases.
2. **Stage 9, hardening and production readiness** (below), in progress. **0.5.2 was released on 2026-11-17** with the
   first part of it (the test VM ran `v0.5.2-dev.4` before the release). Built 2026-11-16 and 17: the idle CPU fix, no
   one-shot containers, old images removed on update, CPU transcription 2 to 11 times faster, summaries as a scribe's
   notes and a bard's tale, who-reads-what for records, container hardening with pinned images and HSTS, the app's own audio engine as the
   default, and the Windows popup freeze fix. Still to do: confirm the popup fix on Windows, a real recorded session
   through the new pipeline on the VM, measure the audio engine (headsets, latency, CPU), macOS parity, the long soak,
   packaging and signing.
3. The open design topics in [.claude/intent.md](.claude/intent.md), as Stage 10 and later.

### Stock-take, 2026-11-11 (end of day)

A long day: 83 commits, four dev builds (`v0.4.0-dev.1` to `-dev.4`), and the first real run of the deployment
buildout. In short: **the system now deploys from published images, signs people in through the web, and the web app and
the desktop app are two faces of one product.** Nothing below has been through a second person yet.

**Completed from this roadmap (Stage 3b, the deployment buildout):**

- Server **images on GHCR**, built by tag (`images.yml`), pulled by the Compose bundle by release line. Ran for four tags; the
  Compose bundle was brought up locally from the published images ("first local deploy"), which found and fixed
  four real bugs (`UPDATES_INCLUDE_DEV`, the macOS updater archive name, `TRUST_PROXY` under Compose, a missing
  protocol check on the old sign-in calls).
- **Version handshake** (REST) with `PROTOCOL_VERSION` 2, plus the desktop app now **warns when it and the server differ in
  MAJOR.MINOR**. **Server-chosen client builds** and the **update feed sync** run against live GitHub, and the sync now also waits
  until all three installers are uploaded before offering a release (found when it offered half a release).
- **Web onboarding and app sign-in** (item 7): browser-only sign-in. Andy confirmed locally that the app connects through the
  browser and the `vtt-chat://` link signs it in with no prompt.

**Added since the roadmap was written (not on it):**

| Area                        | What now exists                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One web app**             | A landing page at `/`, `/download` (per-OS steps, sign-in required), `/full-app`, and the chat web app at `/app` as the same product on phones and desktops; one 640px column, the Default look, light/dark               |
| **Sessions in the browser** | A secure, long-lived cookie (HttpOnly, SameSite, `__Host-`) that slides with the operator's offline limit; Origin checks on cookie writes and the WebSocket; OIDC fits later without rework                               |
| **Getting an account**      | Visitor sign-up requests (off by default, approved in `vtt-admin signup`), short typeable `ABCD-EFGH` codes, a starter campaign for the first Admin                                                                       |
| **Chat commands**           | `/say`, `/say-<language>`, `/do`, `/ooc`, `/tell`, `/w`, `/dm`, `/late`, `/cant`, `/work`, `/brb`, `/afk`, `/back` with autocomplete in **both** apps; OOC never recorded; one shared parser                              |
| **Web chat**                | Members rail with status and hover/tap details, burger menu and "Get the app" promo, icon tabs matching the desktop                                                                                                       |
| **Desktop app**             | New Default theme (violet, ember, teal) matched in the web; connect screen in the web look; system certificate store trusted; Settings reorganised (Profile with theme, photo, version and updates; Audio; Notifications) |
| **Design and tooling**      | Artwork banners and a faint chat watermark; `npm run app`; `trust-local-ca.sh`; a headless-browser layout check; a palette drift test between web and desktop                                                             |

**Still to do, in the order I would take it:**

1. **A second person, on a blank VM** (Stage 3b #6 and the Stage 3 "done when"): the real test of the images, the operator
   guide, `wss://` through Caddy with a real certificate, LiveKit audio over UDP, and the new landing and download pages.
2. **See it running.** The web screens were exercised in a real headless browser on 2026-11-12 (about 330 checks, seven bugs
   fixed; `web/e2e/ui-smoke.mjs`). Still unseen in a real window: the desktop app's new screens (connect, Settings, rail,
   chat commands, join requests). On the list: a real phone and iOS Safari, deep links on
   Windows and macOS and the Linux AppImage, voice over `https://localhost` with the trusted CA, the Windows and macOS builds.
3. **Close the version and sign-in gaps:** done 2026-11-12 are the WebSocket protocol check, the CI guard that fails an
   unrecorded wire change, and signing out an expired `/app` tab (Stage 3b #3). The web **Account page** (profile, password, devices
   with revoke, recording notice) is built 2026-11-13 (#8) but not yet seen in a real browser.
4. **Decide the undecided:** how a signed-in person with **no campaign** gets into one (request-to-join from an opt-in list,
   DM approves in the app); whether quick-reply commands should be customisable; per-character languages and polyglot
   masking (needs server-side masking; only designed as a seam).
5. **Recording and AI: proven end to end on 2026-11-12** on the Compose stack with synthetic speech (66 of 66 checks: consent, per-speaker
   attribution, typed lines in, OOC and whispers out, DM-only summaries, search, a killed worker, the remote-AI fallback;
   [BUILD-STATUS.md](docs/BUILD-STATUS.md)). Still to do there: real human voices and room noise, a multi-hour session, a CPU-only
   server, and the second-person deploy.
6. **The old list below** (listening tests, the 4-hour soak, D&D Beyond on
   real sheets, Windows and macOS away detection) still stands and is unchanged.

**As of 2026-11-09 the player experience was essentially complete:** sign in, join, talk, chat, whisper, loot, RSVP, hear the DM's scenes and stingers, browse past sessions, with recording and consent working end to end. What was left then, and still is, is **verification on real machines**, a few UI/UX refinements, and release work.

```mermaid
flowchart LR
  A[Verify on the dev PC] --> B[Real-service first runs]
  A --> C[UI polish]
  B --> D[Soak and hardening]
  C --> D
  D --> E[Mobile SPA and release]
```

**Built 2026-11-09 (unverified in a real window or against real services):**

- **D&D Beyond character sync** ([DDB-SYNC.md](docs/architecture/DDB-SYNC.md)): link on the Campaign → Character screen, "Sync now", hourly refresh of name, race, class, level and portrait. Off unless `DDB_SYNC=1`. **Never run against the live service**; the parser is the one place to adjust.
- **Session history window**: recordings, summaries (DM-only ones only for the DM), transcript, search, DM delete.
- **Public status page** at `/status` and `/api/status`, built and served in both install tiers.
- **Mixer audio engine** ([AUDIO-MIXER.md](docs/architecture/AUDIO-MIXER.md)): our own capture and playback around WebRTC's echo cancellation, **the default since 0.5.2** (the platform path is the fallback: Settings → Audio → Compatibility audio, or `VTT_AUDIO_BACKEND=platform`). Gives per-person volume, microphone volume, a real level meter, and echo cancellation that still works with a character voice and for sounds the app plays itself. Used on Linux and Windows; latency, drift, CPU and Bluetooth/USB headsets are not measured.
- **Polish:** four new DM voices (Dragon, God, Drunk, Authoritative: **tuned by tests on synthetic tones, not by ear**), a keyboard way to move people between groups (Enter on a focused person in the rail), `--category` and `ambience/` or `music/` folders in the sound importer, and a daily sweep of portraits nobody uses.
- **Emailed sign-in codes** (`SMTP_URL`), **single sign-on** (OIDC) and a **code sign-in** in the app ([SIGN-IN-OPTIONS.md](docs/architecture/SIGN-IN-OPTIONS.md)). SSO was tested against a fake provider only.

**Guides (started 2026-11-10):** an [Operator guide](docs/guides/OPERATOR-GUIDE.md) (install, first run, configure, operate, back up, update, fix) and a [User guide](docs/guides/USER-GUIDE.md) (players and DMs) are drafted in [docs/guides/](docs/guides/README.md). They describe what is built; the steps nobody but the author has run are marked. **They are kept true in the same commit as any feature that changes them**, and the second-person deploy test (Stage 3) is also the test of the operator guide.

**Build queue (worked through 2026-11-10 onward, one commit each, tests first):**

| #   | Item                                                                                                                                                                                     | Why now                                                                                          | Status                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| A   | **First-run bootstrap:** `vtt-admin user create <email> --name … [--admin]`                                                                                                              | The operator guide needs a way to make the first account; today it takes a hand-written API call | built                                              |
| B   | **Closed-window experience:** unread badge on the tray icon, OS notifications while the window is hidden (whispers only while in voice with a recording active), session reminders shown | Players keep the app hidden ~90% of the time                                                     | built                                              |
| C   | **Storage and purge (disk figures done 2026-11-10; purge done earlier):** disk use on the status page and in `vtt-admin`, and a purge of raw audio once a summary is confirmed           | Recordings fill a disk with no warning                                                           | built                                              |
| D   | **Backup and restore scripts** (Compose and, from 2026-11-10, native: `infra/backup-native.sh`, `infra/restore-native.sh`)                                                               | The guide currently says "use pg_dump by hand"                                                   | built                                              |
| E   | **Handouts:** remove or reorder a picture after creation                                                                                                                                 | Today a set is deleted and rebuilt                                                               | built                                              |
| F   | **Search finds typed chat lines** from recordings                                                                                                                                        | Typed lines are in transcripts but not searchable                                                | built                                              |
| G   | **Away on Windows and macOS:** screen-lock detection (only the idle timer works there)                                                                                                   | Parity with Linux                                                                                | built, unverified on Windows/macOS                 |
| H   | **Noise filter follow-ups:** a hum notch filter; decide the default level after listening; PipeWire/PulseAudio backends                                                                  | Needs your ears first for the default                                                            | built (default level and backends need the dev PC) |

**Next steps, in order:**

0. **Deployment buildout ([Stage 3b](#stage-3b--deployment-buildout-added-2026-11-11)):** published images, version handshake, server-chosen client builds, then web onboarding. This comes first: the goal is a deployable system to test end to end before refining.

1. **On the dev PC:** run the app and try everything listed above plus unmute, rail drag, portrait upload, device switching and the scene editor. Link a real public D&D Beyond sheet and read what comes back. Point SMTP and an Authelia at the backend once.
2. **UI/UX fine-tuning** from what step 1 turns up, starting with **listening to the four new voices** and the importer's ambience and music loops (run `npm run sounds:import -- --from <dir> --category ambience`).
3. **Purge rules (built 2026-11-10):** age-based retention, the DM's "delete the audio" button, and a disk-low rule with a 3-day warning. Purge at the next session start built 2026-11-13 (operator setting, off by default). Then the recorded 4-hour soak (Stage 9). The server-restart-mid-recording drill is done (2026-11-10).
4. **Second-person deploy test** from the docs on a blank VM (Stage 3).
5. **Mobile SPA** (Stage 7): built, with history search, a handout viewer (flip and zoom) and an install manifest added 2026-11-10; open it on a real phone (`/app`) and try it on iOS Safari.
6. **D&D Beyond:** AC, passive perception, max HP and ability scores are built (2026-11-10, worked out by us); one real sheet compared 2026-11-11 (fixed Draconic Resilience HP and AC); compare a Barbarian or Monk next. Later: saves, skills.
7. **Audio engine default: decided 2026-11-17, the mixer** (used on Linux and Windows). The platform path stays as "Compatibility audio". Still to do: measure latency, CPU, hour-long drift, Bluetooth and USB headsets; remove the platform path once a few real sessions have not needed it.
8. **Try the optional sound-card backends and RNNoise** once the mixer is validated: cpal 0.18's `pipewire`, `pulseaudio` and `jack` cargo features (off today; Linux uses ALSA, which PipeWire serves; they need the PipeWire/PulseAudio dev libraries in the Docker image and CI), (RNNoise itself is built: [AUDIO-MIXER.md](docs/architecture/AUDIO-MIXER.md); it needs a listening test; the 50/60 Hz hum notch filters are built ahead of it). cpal is now 0.18.2 (decided 2026-11-09); see [AUDIO-MIXER.md](docs/architecture/AUDIO-MIXER.md).
9. **Status (Online, Away, Offline) is built** ([STATUS-AND-PRESENCE.md](docs/architecture/STATUS-AND-PRESENCE.md), 2026-11-10): tray submenu, a dot beside the settings cog, Settings → Profile, automatic Away from screen lock or idle, shared with the table, and no voice join at launch. Still to do: try it on the dev PC, the Windows and macOS screen-lock signals.
10. **Closed-window experience and the full soak.** A 21 h debug-build run with the window open (2026-11-10) held steady memory, threads and file handles, with 0-20% CPU from chat and speaking indicators; that is working load, not idle. The tray unread badge and OS notifications while the window is closed are built, with per-kind switches and quiet hours in Settings (2026-11-10; decided 2026-11-10: whisper notifications fire only while the player is connected to voice and a recording is active, i.e. in-game). Still to do: measure true idle (window closed, chat quiet) in a release build as part of a full soak under varied conditions.

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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ In Progress — first findings logged in [AUDIO-SPIKE-RESULTS.md](docs/architecture/AUDIO-SPIKE-RESULTS.md) (platform audio layer chosen as the base; release-on-mute measured on Windows). Built without a live server: platform-audio client with release-on-mute and auto-rejoin, the `ai/` pipeline library, and the Part B runbook/scripts. **Still needs a live run:** acoustic AEC/CPU/latency, rejoin and sleep/wake, and Part B on a Linux server.
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Nearly done — built and verified against real services: identity/campaign domain, REST, WebSocket hub with a Valkey-backed replay buffer, Postgres store and migrations, recording state and consent acknowledgements, the Admin CLI (`vtt-admin`), and **both install tiers** (Docker Compose; native `infra/install.sh` on Ubuntu 24.04). **Remaining:** the "done when" test — a second person deploying from the docs on a blank VM
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

## Stage 3b — Deployment Buildout (added 2026-11-11)

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Built; the real-VM run (#6) is the gate. The one-command installer `infra/get.sh` was added 2026-11-14
**Depends on:** Stage 3 (the Compose bundle), Stage 4 (the tray client and its updater)
**Design:** [VERSIONING-AND-DEPLOYMENT.md](docs/architecture/VERSIONING-AND-DEPLOYMENT.md)

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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Feature-complete for players as of 2026-11-09; 🟡 fine-tuning and verification remain. One compact RPG-themed main window (avatar rail with speaking glow, quality-coloured connection sparkline, group sections and hover cards; themed chat with whispers; record state and consent; mute and level meter; voice connect), Settings as a popover (Profile with theme, photo, version and updates; Campaign; Sessions; Audio; Notifications; reorganised 2026-11-11), Handouts and Party-inventory windows, the DM **Scene Deck** (Voice, Stinger and Scene panels with favourites, custom scenes and per-type levels), loot with the SRD catalogue and treasure generator, scheduling with RSVP, account and character avatars, sound through the call, signed auto-update, start-with-computer, crash recovery and the DM connection screen. Voice runs on **LiveKit Rust SDK 0.10.1** (Linux builds need `clang`; see [DEVELOPING.md](DEVELOPING.md)). **Built since, unverified in a real window:** the session history window, the keyboard way to move people between groups, four more DM voices, and the opt-in mixer audio engine (per-person volume, microphone volume, a real level meter). **Not built:** a recorded 4-hour soak (`tauri-client/scripts/soak.sh` is ready), and checking the D&D Beyond sync's extra stats against real sheets. **Needs a human:** listen-tests of effects, character voices and the mixer engine, and a pass through the real window (unmute, rail drag, portrait upload, device switching, scene editor). Back up the updater key (`~/.tauri/vtt-chat-updater.key`) and give it a password before real releases. Detail of what is built vs verified: [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md). Design: [main-window spec](docs/superpowers/specs/2026-11-08-main-window-design.md).
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ In Progress — the processing half is built and verified live (Egress files → durable job queue → worker → Whisper/LLM, local or remote with fallback → transcripts and summaries in Postgres; Admin CLI `jobs` / `recording`). **Records API built** (read, search, DM-only enforced at the API, DM delete). **History window built 2026-11-09 (unverified in a real window).** **Built 2026-11-10:** the DM confirms → purge raw audio, and a disk-low purge rule with a 3-day warning (the next-session rule is not built). **Not built:** extra cloud providers (Stage 10). Scene cues and chapters built 2026-11-14. The recording loop itself — DM start/stop → per-speaker capture gated on the consent acknowledgement → processing — is closed and verified live. See [docs/BUILD-STATUS.md](docs/BUILD-STATUS.md)
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Built end to end for players (server 2026-11-07, client 2026-11-08 to 09); 🟡 the full-session test below is not yet run. Server: chat and private whispers, handouts/maps/images/text snippets, loot with atomic claims, the DM soundboard (a mini thaumaturgy.app), session schedule + RSVP + reminders + stored notifications, and party split — see [TABLE-FEATURES.md](docs/architecture/TABLE-FEATURES.md). Client: chat and whispers, handouts, loot and party inventory, the Scene Deck, scheduling and RSVP, and party split in the rail (Stage 4). **Built 2026-11-11:** chat commands (in character, out of character, language styles, whispers by name, quick late/can't). **Dropped by decision (2026-11-14):** voice whispers; the party split already isolates one player with the DM. **Not built:** the end-to-end "full session" test below.
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

**Status:** 🟢 **Closed 2026-11-15.** Anything found from here is a bug fix, not stage work. _History:_ Now **the web app on any device** (2026-11-11): the same app on phones and in desktop browsers, reached from the site's Chat link, sharing the Home look and the desktop's Default palette, with a members rail, chat commands and a secure cookie session. First cut built 2026-11-10 ([MOBILE-WEB-APP.md](docs/architecture/MOBILE-WEB-APP.md)): sign-in, chat with whispers, sessions with RSVP, handouts, history with summaries, transcripts and search, a handout viewer, and an install manifest. Exercised in a phone-sized headless browser; **not tried on a real phone**. No voice, by decision (the tray app owns audio)
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

---

## Stage 9 — Cross-Platform Hardening & Production Readiness

**Status:** 🟡 In progress (started 2026-11-16 on the `stage-9-hardening` branch; its first part shipped in **0.5.2** on 2026-11-17; the health-check, transcription and purge fixes went to `main` for 0.5.1): the idle-CPU fix and the removal of
the one-shot containers, the records performance and summary work, and the container hardening are built (see the
deliverables); the platform checks, the long soak and signing are not started
**Depends on:** Stage 5 (can overlap Stages 6–8)

**Deliverables:**

- Verified audio parity on Windows, Linux (GNOME + KDE) and, if a player appears, macOS
- Tray behaviour documented per desktop (GNOME AppIndicator, Wayland limits) with graceful degradation
- Real 8+ hour soak with churn, memory profiled against the Stage 0.5 rules
- A real server-restart-mid-recording drill: recording recovers or fails loudly, never silently — **built and drilled 2026-11-10** (`infra/records-smoke/restart-drill.sh`; recovery stops the leftover egresses and keeps the audio; see [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md)); a `kill -9` of the packaged backend is still to try
- Security pass: consent-cue bypass attempts, private-audio leakage into records, token/session expiry, ACL checks on every records endpoint — **done 2026-11-10** for the REST surface and live sockets (access matrix; found and fixed a player who left still receiving chat and voice); the Egress capture and whisper paths were already covered by tests
- Packaging: installers per OS, signed where practical, updater verified
- **Records that a CPU-only server can keep up with, and that people want to read** — **built 2026-11-16 and 17** for 0.5.2.
  Whisper works only on the part of each clip that holds sound, and the no-AVX image uses OpenBLAS (a 2010 Xeon: 19.3×
  the audio's length down to 1.68×). Summaries are two passes, a scribe's notes then a bard's tale, with the notes taken
  once per stretch of recording (about a quarter of the model time on a long session). New CPU defaults: `small.en` and
  `qwen3.5:4b`. Players read the tales; the DM also has a key-points brief and the scribe's notes behind a toggle; the
  transcript is DM-only at the API and shown by the desktop app only with dev builds on. End-to-end test 49/49 on the dev
  PC (GPU). **Not yet run:** a real session on the VM's CPU defaults, and a transcript long enough to need several
  pieces of notes. Design: [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md).
- **Container hardening** — **built 2026-11-17** for 0.5.2, running on the test VM: every Compose service drops all
  capabilities but the few it needs and cannot gain privileges; Whisper, Ollama and cloudflared are pinned to tested
  versions; the installer turns on HSTS once it has seen a valid certificate. Left alone on purpose: the `ufw` rule that
  lets Docker's ranges reach LiveKit's signalling port, and Valkey without a password on loopback
  ([DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md)).
- **Updates clean up after themselves** — **built 2026-11-16**: an update removes VTT Chat images older than the
  previous version (the test VM had collected 19 GB).
- **Fewer moving parts at start-up: the one-shot containers are folded into the services that need them** (Andy's idea,
  2026-11-15) — **built 2026-11-16** on the `stage-9-hardening` branch for 0.5.2. `media-init`, `recordings-init`, `models-init` and
  `ollama-pull` are gone: volume ownership comes from the images, the Whisper container fetches its own model
  (`whisper-start.sh`), and the worker pulls the summary model in the background and reports it to `vtt-admin status` and the
  status page. Checked on the dev PC: a fresh stack is healthy in 6 s, an in-place upgrade of the dev stack (GPU override)
  removes the old one-shots and comes up clean, failed downloads show as `FAIL local AI`, backup and restore still work. It
  also found and fixed a real bug: on a Compose install the worker could not delete raw audio (wrong user). Design, rules and
  the before/after: [DEPLOYMENT-AND-TRANSPORT.md](docs/architecture/DEPLOYMENT-AND-TRANSPORT.md#start-up-and-idle-cost).
  The Compose end-to-end records test passes on the new images (46 of 46), after it found and we fixed a shipped bug: since
  0.4.3 no audio reached Whisper over HTTP (see the changelog). **Not yet run:** the compatibility Whisper image, and the real VM.
- **Idle CPU on the server** (added 2026-11-16, Andy saw about 15% on the test VM) — **cause found and fixed 2026-11-16** on
  the same branch. It was not our code (backend 0.17% of a core, worker 0.10%): it was Docker running 43 health-check
  commands a minute, two of them expensive, about a quarter of a core of a 2010 Xeon. Health checks now poll every 2 s only while a container starts and once a minute after that, with cheap
  commands (needs Docker Engine 25+). On the dev PC: 43 → 6 commands a minute. On `main` since `v0.5.1-dev.2`. **Measured on the VM 2026-11-16:**
  the containers fell from 26.7% to 6.4% of a core and the machine from 52.8% to about 35%. The rest is the Docker daemon
  (27%), which a profile traces to a host monitoring agent listing 52 images every 30 s, not to this stack; with the images pruned and the agent at 5 min the machine idles at 8.8% of one core.
- **Old images after updates** (found 2026-11-16) — the VM held 52 images, 19 GB, eight past versions of each of ours. **Built
  2026-11-16** (Andy: yes, automatically): an update removes VTT Chat's own images older than the version it replaced, once
  the new one is healthy; `--keep-images` skips it.

**Done when:** a full real campaign session runs on all supported platforms without manual intervention.

---

## Stage 10 — Optional Integrations (Advanced Users)

**Status:** ⚪ Not Started
**Depends on:** Stage 5; none of it is on the critical path

Each item is independent, off by default, and must never be assumed by application code:

- **Release pipeline** (`.github/workflows/release.yml`, [RELEASING.md](docs/guides/RELEASING.md)): a `v*` tag builds signed installers for Linux, Windows and macOS (Apple silicon) into a draft release; `infra/fetch-release.sh` hands them to `vtt-admin updates publish`. **Never run;** no OS code signing yet.
- **Package-manager distribution** (winget, AUR, Homebrew tap, signed APT/DNF repos): **a future idea, not started or decided**. Options, effort and the questions to settle first are in [PACKAGE-DISTRIBUTION.md](docs/architecture/PACKAGE-DISTRIBUTION.md)
- D&D Beyond character sync from public pages (`ddb/`) — **built, unverified** ([DDB-SYNC.md](docs/architecture/DDB-SYNC.md)); extra stats built 2026-11-10, also unverified
- Cloudflare TURN (extra ICE server); Cloudflare Realtime SFU as an alternative to LiveKit (a large design of its own); Cloudflare Pages for static hosting
- Cloud transcription / LLM providers beyond Stage 5's first adapters
- **Web push for the phone web app (Apple Push and the other browsers' push services)**: **a future idea, not started.** Notifications while the web app is closed, for players who have added it to their home screen (iOS 16.4 or later needs the home-screen install; Android and desktop browsers can do it from a tab). It needs a service worker, server-side VAPID keys, a subscription store and a permission prompt, and it reuses the notification kinds the server already stores (session reminders, join decisions, whispers). The catch to settle first: delivery goes through Apple's and Google's push services, a third party in the path, so it must be opt-in per operator and never assumed (principle 2); the tray app stays the no-third-party answer. See [MOBILE-WEB-APP.md](docs/architecture/MOBILE-WEB-APP.md).
- OIDC/Authelia SSO — **built, tested against a fake provider only** ([SIGN-IN-OPTIONS.md](docs/architecture/SIGN-IN-OPTIONS.md))
- Remote AI backends (Whisper/LLM on another machine, e.g. a GPU PC) are a Stage 5 provider-interface concern, not Stage 10

### Loot management and chat history (asked by Andy, 2026-11-17)

**Status:** ⚪ Not Started. Andy's requests from real use of the 0.5.2 loot panel and chat; written up, not yet designed in detail. It sits here rather than in a new stage, and unlike the rest of Stage 10 it is **not optional**: it fixes and extends Stage 6 table features. The open questions at the end need Andy's answer before the build plan.

#### 1. Chat survives a server restart, and older chat loads on scroll

**What happens now:** after a server restart the desktop chat is empty. **Why (found 2026-11-17):** the server already keeps chat in Postgres (`chat_messages`, trimmed to `CHAT_RETENTION_MESSAGES` = 5000 per campaign) and has a paged `GET /api/campaigns/:id/chat?before=…`, which the phone web app uses. But the desktop fills its chat from the WebSocket snapshot's `recentChat`, which is read from the **replay buffer** (`hub.ts` `snapshot()`, last 50 events), and the replay buffer is short-lived by design. The loot and handout cards in chat come from the same buffer, so they vanish too.

- The snapshot's recent chat comes from **Postgres**, not the replay buffer: the last 20 to 50 messages the viewer may see.
- Scrolling up asks for older messages a page at a time (the existing `before` cursor), until there are no more.
- Loot and handout cards are rebuilt from their own tables with the chat they sit in, so a restart keeps them in place.
- **Done when:** restart the server mid-session; every client shows the same recent chat and cards afterwards, and can scroll back past 24 hours.

#### 2. Give: a simple picker, not an inline list

- **Give** opens a small drop-down menu of the campaign's players: avatar, then character name with the player's name beside it. Picking one gives the item. It does not unfold a list inside the row (today it does, first screenshot).
- The **same Give control** is on the loot card in chat, and it shows on the **collapsed** card, to the left of the expand arrow (today it shows only when the card is expanded).

#### 3. Filters and what each person sees

| Who    | Filters, in order                | Default   | Sees                                                                        |
| ------ | -------------------------------- | --------- | --------------------------------------------------------------------------- |
| DM     | Available \| Taken \| All        | Available | everything                                                                  |
| Player | All \| Own \| Party \| Available | Available | **only** available, party-stash and their own items; never another player's |

- Give, take, store, split and return update the open list straight away, with no manual refresh. On the DM's Available view an item that was just given or split **fades out** (rather than vanishing at once) so the DM can see it went.
- **Players can take from the party stash.** Today only the player who stored an item can move it again; any player of the campaign may take a party item for themselves.

#### 4. Re-drop available loot into chat

- The DM can **re-drop** an item that is still **Available**, posting its card into chat again for anyone who missed it. An item that is held (by a player or the party) **cannot** be re-dropped.
- An item is one thing however many times it is dropped: when it is given, taken or returned, **every** card for it in chat updates.

#### 5. "Added to my sheet": notification and confirmed flag

- A player who is **given** an item (or coin) gets a notification, so they know to add it to their character sheet. It is stored like the other notifications, so a player who was not in the session sees it next time.
- Each item a player holds has a **confirmed** flag the player ticks once it is on their sheet. Unconfirmed items stand out in their loot panel, for the player who forgot or was away.
- **The flag resets whenever the item moves:** own → party, party → own, or back to available (returned or dropped).

```mermaid
stateDiagram-v2
  [*] --> Available: DM drops
  Available --> Own: player takes / DM gives (notify)
  Available --> Party: player stores
  Party --> Own: any player takes
  Own --> Party: store
  Own --> Available: return
  Party --> Available: return
  Available --> Available: DM re-drops (cards update)
  note right of Own: confirmed resets on every move
```

#### Release fit

Parts 1 to 3 change no wire contract (the server reads chat from a different place; the paged REST call exists; filters and the picker are client-side; letting any player take from the party is a server rule) and can ship in a **0.5.x** patch. Parts 4 and 5 add to the wire (a re-drop event, a confirmed field and its call, a new notification kind), so they are a `shared/` contract change and ride the **0.6.0 / protocol 4** bump Stage 11 already plans. Both apps (desktop and phone web) get the same behaviour. [LOOT.md](docs/architecture/LOOT.md) and [TABLE-FEATURES.md](docs/architecture/TABLE-FEATURES.md) are updated with the build.

#### Open questions for Andy

1. **Who confirms a party-stash item?** Proposed: nobody; confirmed applies to a player's own items only, since the party stash is not on anyone's sheet.
2. **Split coin:** does each player's share get its own confirmed flag and its own "you were given" notification?
3. **Can the DM give to the party stash?** Today the DM can only give to a named player.
4. **Does the DM see the confirmed flags** (e.g. a tick on Taken items) to chase up a player?
5. **Notify on take as well as give?** A player who takes an item did it themselves; proposed: notify on give only.
6. **Chat page size:** 50 on load, then 50 per scroll-up? (Andy suggested 20 to 50.)

## Stage 11 — Storytelling: Roles, Personas and Campaign Memory (idea, 2026-11-17)

**Status:** ⚪ Not Started. **An idea captured so it is not lost: not designed, not decided.** Andy has more detail to add; ask before designing or building any of it.
**Depends on:** Stage 5 (the records pipeline); builds on the scribe and bard split of 0.5.2 ([RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md))

The pipeline becomes a line of named roles, each with its own job and its own persona, each reading the one before it:

```mermaid
flowchart LR
  T[Transcribe] --> H["Historian (the scribe)<br/>what happened, accurately"]
  H --> S["Storyteller (the bard)<br/>the tale, in the campaign's tone"]
  H --> C["Chronicler<br/>the Game Master's notes"]
  M[(Campaign memory)] <--> S
  M <--> C
```

- **Historian (today's scribe):** the accurate record of the session. Accuracy lives here, as now.
- **Storyteller (today's bard):** tells the tale. **Its persona is chosen by the Game Master** to suit the tone of the campaign (today there is one fixed voice: heroic, dryly funny).
- **Chronicler:** writes the Game Master's notes (today's GM brief is the nearest thing).
- **Persistent campaign memory:** what the campaign has already met (places, non-player characters, creatures) is kept between sessions, so the Storyteller can notice that the party has been here or met this person before, and refer back to it.

### What this is for (Andy, 2026-11-17): the test every part of it must pass

**Playing the game comes first.** The summaries add flavour, humour and texture; they are not a second job. Three things follow, and any feature here that fails them is cut or hidden:

- **Do not overwhelm the Game Master or the players** with options or with content. Few choices, good defaults, one tale. More output is not better output.
- **Keep the table connected to the story.** Many tables go weeks between sessions; the tale and the memory are what carry everyone back in.
- **Give the Game Master superpowers of recall.** The obscure fact, the name and trade of the throwaway NPC: "Gary the Grumpy Gnome", invented on the spot, whom the players go looking for five sessions later. Finding Gary is the measure of the campaign memory.

### Andy's notes (two memos, 2026-11-17)

More detail from Andy's own notes ("VTT Chat Chronicler" and "VTT Chat Transcription Tweaks"). Still ideas, recorded so the design starts from them.

**The roles, and what each hands on**

| Role                               | Job                                                                                                                          | Hands on                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listener** (Whisper)             | Capture what was said, accurately and neutrally. Never interprets.                                                           | The timed transcript                                                                                                                                |
| **Scribe, the campaign historian** | Work out what actually happened. "Arguably the most important AI in the chain." Dry and factual: no story, no embellishment. | **Structured facts**: events, decisions, combat outcomes, NPC interactions, new locations, loot, quests, secrets revealed, character development    |
| **Bard, the storyteller**          | Retell it. Reads the scribe's facts, never the transcript (as today).                                                        | The tale, in a chosen persona                                                                                                                       |
| **Chronicler**                     | What the Game Master needs to run the next session. A role of its own, not a bard.                                           | NPCs, open plot threads, items obtained, locations discovered, future hooks, **continuity warnings** ("the party promised to return within 7 days") |

**Bard personas** (several may retell the same session): the Tavern Bard (grandiose, makes the heroes legendary), the Dry Historian (accurate, like a record), the Drunken Bard (an unreliable narrator: forgets, jokes, credits the wrong hero), the Sarcastic Bard (dry, pokes fun at the players' decisions), the Bored Court Scribe (understates everything).

**Campaign memory:** one store per campaign of characters, NPCs, locations, factions, quests and magic items. The scribe updates it after every session; the bard is given the relevant parts before it writes, so weeks later it can say "once again the party crossed paths with Lord Ravenshade".

**Better hearing of fantasy words, without fine-tuning Whisper** (CPU-only, low overhead):

- A **glossary per campaign**: characters, NPCs, locations, spells, monsters, deities, homebrew terms, with aliases.
- **Whisper's starting prompt built from the glossary**: short, relevant, most-used terms first.
- **Vocabulary learning**: recurring names found in transcripts are offered for the glossary, and added only when a person approves.
- **Corrections after transcription**: dictionary replacements and fuzzy matching for misheard terms.
- **`small.en` against `medium.en`** for accuracy and CPU cost on old Xeons.

**Andy's order of work:** (1) better Whisper terminology, (2) a strong scribe extraction step, (3) persistent campaign memory, (4) several bard personas. A larger model comes last: "the architecture will improve the storytelling far more than moving from a 4B model to an 8B or 14B".

**Where this meets what is built** (Claude's reading, 2026-11-17; to check when the work starts):

- Half of the chain exists since 0.5.2: one reading of the transcript by a scribe, tales by a bard from the notes only, a Game Master brief from the same notes. The notes are **plain lines today, not structured facts**.
- Whisper is given **no vocabulary today**. The server already knows each campaign's character names, player names, scene titles, loot and handout titles, so a first glossary costs nothing to collect. Whether the Whisper server takes a starting prompt per request has to be checked before promising it.
- The scribe already receives who the Game Master is and the scene cues; the prompts already tell it to keep names as spoken.

### Decided by Andy, 2026-11-17

1. **A persona never changes the facts; it may embellish them.** The Drunken Bard bends this a little further and may make up a few things to make events sound more interesting, but **the essence of the truth is always there**.
2. **The scribe's output does not have to be strict**, only readable by the next step; the more structured the better. Worth testing with it: Whisper `medium.en` and the summary model `qwen3.5:8b` (the test VM was raised to 8 vCPU and 24 GB of memory for this).
3. **Game Master secrets are kept from the table, unless the Game Master picks the Drunken Bard.** With every other persona nothing Game-Master-only reaches a tale. With the drunkard **any secret may slip**: the Game Master chose that persona, so they have decided it is fine. It decides who reads the tales and how closely: what did the drunkard let slip, and what did they make up? "The drunkard is an agent of chaos with an insider's view." The persona picker must say this plainly where it is chosen.
4. **GM Notes: a plain Markdown notebook for the Game Master** (optional). A background notebook and ideas board: plot hooks, key NPCs and events. **Unstructured by design**, so each Game Master makes it their own, with some **starter headings** to prompt a novice. **Attachments allowed: pictures and PDFs.** It is where the secrets live.
5. **One tale per session, one bard.** Most sessions end with the party back at the tavern: "The Bard" is telling the tale of mighty adventures, and the heroes just happen to be sitting at one of the tables.

6. **GM Notes waits for 0.6.** No stop-gap view over private handouts in 0.5.x.
7. **When the scribe's output cannot be read by the next step, retry**, up to making the scribe read the transcript again. The scribe's data is what makes the rest of the pipeline rich, so it is worth the model time; a weaker fallback is not.

### Build order, split by the wire protocol (planned 2026-11-17)

Andy's rule for sequencing: do everything that needs **no protocol change** in **0.5.x** first, and collect what does into **one** bump to protocol 4, which is **0.6.0** ([VERSIONING-AND-DEPLOYMENT.md](docs/architecture/VERSIONING-AND-DEPLOYMENT.md): a new or changed REST route, WebSocket frame or event, or a changed body, bumps it; server-only and screen-only work does not). `intent.md` already reserves 0.6.0 for the first such change, and the soundboard work was expected to be it, so the two should land together.

The dividing line is simple: **everything the pipeline does by itself on the server is 0.5.x; everything a person sets, reads or corrects from an app needs 0.6.**

| Step | 0.5.x: no protocol change                                                                                                                                                                                            | Why it needs no bump        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| A    | **Measure `medium.en` and `qwen3.5:8b`** on the VM (8 vCPU, 24 GB) against today's defaults, on a real session. Change the defaults only if they earn it.                                                            | Server settings             |
| B    | **Automatic glossary into Whisper**: character and player names, scene titles, loot and handout titles the server already holds, as Whisper's starting prompt. First check the Whisper server takes one per request. | Inside the worker           |
| C    | **Corrections after transcription** from the same glossary (dictionary, then fuzzy matching).                                                                                                                        | Inside the worker           |
| D    | **Structured scribe output**: headed lists (events, decisions, combat, NPCs, locations, loot, quests, secrets, character moments) that the next steps read. Still shown to the Game Master as the scribe's notes.    | Same summary kind, new text |
| E    | **Chronicler replaces the GM brief's content** (NPCs, open threads, items, locations, hooks, continuity warnings).                                                                                                   | Same summary kind, new text |
| F    | **Campaign memory, kept by the server**: the scribe updates it, the bard and the Chronicler read it. Nobody edits it yet.                                                                                            | New tables only             |
| G    | **Personas, one per server**: an operator setting (`vtt-admin settings`) picks the bard's voice for every campaign. All five personas written and tested here.                                                       | An existing kind of setting |

| Step | 0.6.0: protocol 4, one bump                                                                                                                                     | What changes on the wire |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| H    | **The Game Master picks the persona for their campaign**, in the app, with the drunkard's warning.                                                              | A campaign setting       |
| I    | **GM Notes page** with starter headings and attachments. Read by the Chronicler; read by the bard only for the drunkard.                                        | New routes               |
| J    | **Glossary the Game Master can edit**, and **vocabulary learning** with approval.                                                                               | New routes               |
| K    | **Campaign memory the Game Master can read and correct.**                                                                                                       | New routes               |
| L    | The **soundboard work** already waiting for this bump, and any tidy-up of the records API (the `notes` kind, the transcript rule) that 0.5.2 added without one. | As designed there        |

Order inside 0.5.x follows Andy's priorities: A, B, C (hearing), then D and E (the scribe and Chronicler), then F (memory), then G (personas). Each step is a patch release that can ship by itself.

**One thing 0.5.x cannot do properly:** the drunkard's leaks need secrets to leak, and before the GM Notes page (step I) the only secrets the server holds are what the Chronicler worked out and the Game Master's private handouts. So in 0.5.x the drunkard can embellish and can slip things from those, and gets its real "insider's view" in 0.6.

Still open (ask Andy before designing):

- What a persona is: a preset list, free text from the Game Master, or both; per campaign only, or changeable per session.
- What campaign memory holds, who can read and correct it (the models will get names wrong), and how it stays small enough for a CPU-only server.
- Whether memory is written by the Historian, the Chronicler, or a step of its own, and how it treats private audio and whispers (never recorded today; that rule stays).
- How the Chronicler differs from today's GM brief, and what happens to the brief and the scribe's notes.
- Cost on the default CPU install: every extra role is more model time per session.

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
- [docs/architecture/PACKAGE-DISTRIBUTION.md](docs/architecture/PACKAGE-DISTRIBUTION.md) — package-manager distribution (future idea)
