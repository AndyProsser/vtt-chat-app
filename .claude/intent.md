# Intent

Current goals and session-spanning threads for this repo — the "what are we doing right now and
why" that would otherwise live only in one machine's conversation history. Distinct from
`ROADMAP.md` (tracking-only, per `CLAUDE.md` §17 — detailed decisions belong in `docs/`, not
here or there). See also [memory.md](memory.md) for durable facts rather than active threads.

Update this file as threads open, progress, or close — stale entries here are worse than none.

## Active threads

- **Pivot: from DDB-overlay browser to self-hosted audio/records tray app.**
  Decided 2026-10-29; decisions confirmed and the docs rewritten 2026-11-05. The project had been
  paused; it is active again as of 2026-11-05.
  - **Done (docs):** `CLAUDE.md`, `ROADMAP.md`, `README.md`, `DEVELOPING.md`, `CONTRIBUTING.md`,
    `docs/CONVENTIONS.md`, all module READMEs, `docs/architecture/OVERVIEW.md` and
    `STATE-AND-RESILIENCE.md` revised; new `RECORDING-AND-SUMMARIES.md` and
    `DEPLOYMENT-AND-TRANSPORT.md`; the old design archived under `docs/archive/`.
  - **Done (code, Stage 1):** legacy `src-tauri` modules and the `remote-ddb` capability removed;
    `overlay-ui` → `panels-ui` (placeholder panel); `backend` `POST /api/session` removed (now
    `GET /api/health` + LiveKit token minting); `ddb/` is an empty stub; old DDB/session code is in
    `docs/archive/ddb-legacy/`; strict CSP, no remote origins. Toolchain moved to TS 7 / v0.2.0.
  - **Done (2026-11-05, away from the dev box):** Stages 2 and 3 groundwork — platform-audio voice
    client, cue player, records pipeline library, identity/campaign domain, REST, WebSocket hub, Rust
    sync client, recording-consent loop. **Built is not verified:** see
    [docs/BUILD-STATUS.md](../docs/BUILD-STATUS.md) for what has and hasn't run against real
    infrastructure.
  - **Next (when the dev box is back):** the verification list in BUILD-STATUS.md (Postgres, Valkey,
    two-machine voice test, Part B on a Linux server). Then Stage 4 (tray shell wiring).

- **Stage 9 hardening for 0.5.2, on the `stage-9-hardening` branch (started 2026-11-16).** Andy asked for a hardening,
  performance and optimisation pass, built on a separate branch (not `main`) because many changes are expected.
  - **Done:** the idle-CPU cause (Docker health checks, not our code) and fix; the four one-shot containers removed.
    Details and measurements: `docs/architecture/DEPLOYMENT-AND-TRANSPORT.md` ("Start-up and idle cost"), BUILD-STATUS.md.
  - **0.5.1 (on `main`, tagged `v0.5.1-dev.2`):** the health-check fix, the transcription fix and the purge fix, picked
    from the branch. The branch itself is 0.5.2 (Andy, 2026-11-16: no protocol change, so it stays on 0.5).
  - **VM re-measured 2026-11-16 on `0.5.1-dev.2`:** containers 26.7% → 6.4% of a core, machine 52.8% → ~35%. The remaining
    27% is `dockerd`/`containerd` serving Andy's host monitoring agent (image list + inspects every 30 s over 52 images),
    not this stack. Andy pruned the images and had the agent's interval raised to 5 min (2026-11-16); updates now remove
    old VTT Chat images themselves (keep the running and the replaced version; `--keep-images` opts out).
  - **0.5.1 was released from `main` on 2026-11-16** (tag `v0.5.1`, draft until Andy publishes). 0.5.2 dev builds are tagged
    from this branch (`v0.5.2-dev.N`).
  - **Next:** run a whole records job on the VM's new images; then the rest of Stage 9 (platform parity, the 8-hour soak, packaging), which needs real machines.
  - **Summaries are a story, not minutes (Andy, 2026-11-16):** "a heroic retelling of key events, even the dumb ones that
    were an epic fail"; "glorious feats and humiliating fumbles", "dry wit and gallows humour"; short, not War and Peace;
    "the full transcript is searchable, but the story is what will be remembered". Built as **scribe then bard** (Andy
    agreed): facts extracted as fully as possible first, the tale told from the notes.
  - **Who reads what (Andy, 2026-11-17):** players get the tale only; the GM gets the tale and the scribe's notes; the
    transcript is for the operator (to reprocess) and for the GM in dev mode ("install dev builds enabled"). Built:
    notes stored (kind `notes`), transcript and its search hits DM-only at the API, the desktop app shows them only with
    dev builds on, the phone has no transcript view. The tale need not include every player or NPC, just the key ones.
    The DM brief stays (Andy: it is quicker to scan than the notes); the notes are folded behind a button. Dev mode is
    enforced by the app, not the server (Andy). Stays 0.5.2 although a 0.5.1 player's transcript request is now
    refused (Andy accepts the error: nobody uses the app yet).
  - **Summary model: `qwen3.5:4b` for both roles** (confirmed by Andy 2026-11-17, in place of granite4.1:3b).
    `OLLAMA_STORY_MODEL` can split the roles.
  - **Security pass (2026-11-17, Andy: go ahead, but keep LiveKit open to the LAN and remember not every install has
    HTTPS or Cloudflare):** containers drop capabilities, Whisper/Ollama/cloudflared pinned, HSTS written by the
    installer only after a real certificate is seen. The `ufw` rule for 7880 and Valkey's missing password were left
    alone on purpose (DEPLOYMENT-AND-TRANSPORT.md).
  - **0.6.0 is reserved** for the first change that bumps `PROTOCOL_VERSION` (the soundboard work is expected to).

- **Stage 6 table features — server first, then UI.** Decided 2026-11-07, in build order:
  - **Whispers:** DM↔player and player↔player, **private to the two** (the DM cannot read player↔player).
    Never in the shared replay stream; delivered only to sender and recipient; persisted; history is
    viewer-filtered in the store itself.
  - **Handouts/maps/images:** files on a server volume (type + size limited, served through an
    authenticated API, per-handout visibility), metadata in Postgres. Text snippets are handouts with a body.
  - **Party split:** one LiveKit room, the DM controls who hears whom (per-participant subscription
    control); **all groups are recorded** as normal tracks; only private whispers are excluded. Isolation
    is cooperative, not cryptographic (a tampered client could self-subscribe) — fine at table trust level.
  - **Soundboard:** a mini version of [thaumaturgy.app](https://thaumaturgy.app/) with **the DM's own
    library**: sounds (with several takes so a button doesn't repeat), boards of buttons (one-shot or
    loop), scenes of up to 12 layers (looping or random), per-player volume. The DM's client decides
    what plays; the server relays validated DM events and keeps the "now playing" state for late
    joiners. Clients play locally (never through the SFU, so never in the recording).
  - Remaining small ones (loot with atomic claim, session schedule + RSVP + stored notifications) use
    plain defaults, listed in docs/architecture/TABLE-FEATURES.md when built.

## Design topics (1–4 are decided; 5–9 still open — ask Andy, don't resolve by writing code)

1. **Identity & access model** — _decided 2026-11-05:_ local accounts (email/password, magic
   links, optional OIDC); per-campaign DM + players; many characters per player, one active; DM
   **swap** (old DM becomes player, character suspended while DM and restored on swap-back, must
   be one quick action); invites by magic link / side-channel code / QR; first account = Admin;
   campaign creation CLOSED or OPEN; minimal admin UI (CLI-first; connection-status screen for
   DM/Admin); multi-use expiring invites; long-lived revocable sessions with offline-limit
   re-auth. Default offline/expiry limit **30 days** (CLI-configurable). **Open:** extra Admin
   quick-access actions beyond the connection-status screen (suggested: invite create/revoke + QR,
   device/session list with revoke, pending summary confirmations, storage/pipeline health).
   (CLAUDE.md §11.)
2. **Client ↔ server sync protocol** — _decided 2026-11-05:_ revive archived "Plan B" (Rust-owned
   WebSocket, bounded replay buffer, snapshot fallback). **WebSocket carries everything
   high-frequency or live:** events, presence, speaking, typing, audio-state changes, chat
   messages, recording status. **REST only for large, infrequent operations:** create user,
   password/profile changes, create campaign (character sync may go on WS). LiveKit carries media
   (and data events only where WS is a poor fit). **Draft defaults written** in
   [SYNC-PROTOCOL.md](../docs/architecture/SYNC-PROTOCOL.md) (Andy delegated; revisit after
   measuring): versioned envelope, auth as first frame, 500 events/10 min replay buffer,
   stats every 5 s in-session, online/offline only when idle.
   **Character data (decided):** import from a **public** DDB character URL ("copy character URL")
   for name, class, race, level, avatar only. Cobalt-cookie is out for players; an optional DM
   browser extension is a **possible future add-on** (Andy: yes, optional, later). Not in scope now;
   CLAUDE.md §13/§15 "no browser extension" applies until it's picked up.
3. **Records details** — _decided 2026-11-05_ (see RECORDING-AND-SUMMARIES.md): continuous
   campaign, start/stop/pause bookmarks, rich metadata for speaker attribution, no opt-out, only
   raw audio deleted after DM-confirmed summary, stale audio purged by rules (next session / age /
   free storage); cues on every status change incl. resume; Whisper model chosen by CPU-only vs
   GPU at setup (env/CLI override); standing consent collected at sign-up and stored in Postgres
   with consent-text version. **Open:** purge defaults. (Cue-ack storage is decided and built:
   server-side, 30-min expiry assumed — see RECORDING-AND-SUMMARIES.md "The consent loop as built".)
4. **Audio platform findings** — decided approach: manage per platform, aim for consistent
   behaviour; **Windows is the target, Linux and macOS are best-effort**. The Stage 2 spike still
   supplies the measurements (AEC/NS, device release on mute, unmute latency).
5. **Mobile SPA scope** — messages/RSVP/handouts only, or basic listen/talk too?
6. **Deployment tiers** — _decided 2026-11-07:_ Docker Compose on a VM/server is the primary
   path; native install is for advanced users; LXC is optional/at-your-own-risk. **AI backends
   (Whisper, LLM) may be local or a remote instance** (Andy's case: GPU in a gaming PC); a remote box
   being offline means jobs wait, then fall back to local CPU `small` (timeout + fallback both
   configurable). Remote AI speaks the **OpenAI-compatible API**; local AI is always configured as
   the fallback, uses a GPU if present (Admin told remote may be unnecessary). Docker first; native
   tier follows once Compose works. **Open:** compose layout details (LiveKit on host networking
   for UDP), Egress image/config.
   See CLAUDE.md §5.
7. **Server sizing** — minimum spec for voice + records; Whisper model default; what a GPU buys.
   Answered by the Stage 2 spike.
8. **Admin CLI shape** — instance bootstrap and invite flow depend on topic 1. Andy deferred the
   CLI (2026-11-05).
9. **Cloud-adapter seams** — which provider interfaces to define up front (transcription, LLM,
   TURN/ICE, storage) so adapters stay optional.

## Open questions / noticed in passing

- **Storytelling roles, personas and campaign memory (Andy's idea, 2026-11-17; ROADMAP Stage 11).** Pipeline as
  named roles with personas: Transcribe → Historian (scribe) → Storyteller (bard) → Chronicler (GM notes); the
  bard's persona is GM-configurable to suit the campaign's tone; a persistent campaign memory lets the bard connect
  places, NPCs and creatures the party has met before. **Andy has more detail to give: ask him for it before
  designing anything.** Only captured, not decided.

- **Retire the old hub records?** Memory Hub still holds `vtt-chat-app-architecture-and-decisions`
  and `vtt-chat-app-state-resilience-and-overlay-gotchas`, which describe the old design. Andy
  wants to review before they're dropped. (A `vtt-chat-app-pivot-decisions-2026-11` record has been
  written to the hub alongside; supersede the old ones only on Andy's say-so.)
- **Naming.** The app is now **"VTT Chat"** (renamed 2026-11-11: Task Manager, Linux menu, macOS bundle, installer
  files, the Linux package `vtt-chat`). The repo and the internal binary are still `vtt-chat-app`; the repo name is
  not urgent, flag if a rename is wanted before a public release. Treat release file names as an interface
  (see PACKAGE-DISTRIBUTION.md).
- **Package-manager distribution** (winget, AUR, Homebrew tap, signed APT/DNF repos) is a **future idea, not
  decided**: [docs/architecture/PACKAGE-DISTRIBUTION.md](../docs/architecture/PACKAGE-DISTRIBUTION.md). Don't build
  any of it unprompted.
- **License/IP notice** in `README.md` was reworded (no longer embeds or scrapes DDB). Worth a
  glance from Andy.

- **Deployment buildout (decided 2026-11-11, not built):** version rules (in force), server-chosen client builds with
  optional local mirror, container build workflow, and web-app-owned onboarding/auth (intent only; needs its own design).
  See [docs/architecture/VERSIONING-AND-DEPLOYMENT.md](../docs/architecture/VERSIONING-AND-DEPLOYMENT.md). Order: Wayland
  window fix, then server-controlled updates + container workflow, then web onboarding/auth, then the mobile flow.

## Resolved

- **WebKitGTK/NVIDIA homepage crash and blank-render investigation** (two bugs found and patched
  upstream-style; a third blank-render issue left unrooted) — moot with the embedded browser gone.
  Archived in `docs/archive/`. Revisit only if a _local_ panel ever blank-renders on Linux+NVIDIA.
- **Stage 3a Plans A/B/C** (overlay compact view, WS layer, conditions) — superseded; Plan B kept
  as a reference for topic 2.
- **Local player identity not exposed to the overlay** — moot; the overlay is gone.
- **`.claude/` restructure (2026-09-09).** Moved root `CLAUDE.md` → `.claude/CLAUDE.md` and added
  this file and `memory.md`, mirroring `HomeLab`.

## First run is browser-based (decided 2026-11-07)

Invite link → browser join page (create account, consent, join, app download + instructions) → the
app is install-and-sign-in only. See `docs/architecture/JOIN-FLOW.md`. The app needs a sign-in
screen, not a sign-up flow.
