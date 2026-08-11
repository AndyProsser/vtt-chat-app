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

**Status:** 🟢 Done (two-real-identity verification deferred — see note below)
**Depends on:** Stage 0

Prove the riskiest integration — DDB auth, native audio, and overlay injection — works end-to-end before building any real feature UI. No chat, no bookmarks, no DM tools, no multi-window yet.

**Deliverables:**

- 🟢 Cobalt cookie detection in the Tauri WebView (`tauri-client/src-tauri/`) — async `WebviewWindow::cookies_for_url` polling, per the now-resolved [DDB-AUTH.md](docs/architecture/DDB-AUTH.md)
- 🟢 Cobalt → JWT exchange + Character Service call (`ddb/`), per [docs/architecture/DDB-AUTH.md](docs/architecture/DDB-AUTH.md)
- 🟢 Backend endpoint that accepts extracted identity and issues an app session + LiveKit token (`backend/`)
- 🟢 Rust LiveKit client (`tauri-client/rust-livekit/`) joins a room, publishes the default mic (via `cpal`), and plays back subscribed remote tracks
- 🟢 Minimal overlay (`tauri-client/overlay-ui/`) — a single Shadow DOM root showing "connected" + the live participant list, with leaf-isolated selectors per Stage 0.5
- 🟢 Native LiveKit server running in dev mode — running as a systemd service (`livekit-dev.service`, `livekit-server --dev --bind 0.0.0.0`) on Andy's dev VM (see [DEVELOPING.md](DEVELOPING.md#running-stage-1-locally) for connecting to it); run end-to-end against the real Rust LiveKit client via the loopback harness below

**Done when:** two instances of the app, logged into DDB as two different users in the same campaign, can hear each other over LiveKit, with identity correctly extracted from DDB for both.

**Verified locally:** `npm run lint`, `format:check`, `typecheck`, and `build` pass across every TS workspace; `cargo fmt --check`, `cargo clippy`, and a full `cargo build` (real linking, not just `cargo check`) pass for both Rust crates on Windows; the built binary launches, opens a window, and injects the overlay bundle without crashing.

**Loopback audio test (2026-08-09):** `tauri-client/rust-livekit/examples/loopback.rs` — a standalone harness (no DDB, no Tauri window) that connects two `LiveKitClient`s to the same room under two synthetic identities, using the same public API `src-tauri/` uses, against the dev VM's real `livekit-server --dev` instance. First run caught a real bug: `spawn_microphone_capture` hardcoded the LiveKit `NativeAudioSource` to 48kHz while opening the input device at whatever rate it actually negotiated, so every captured frame was silently rejected (`capture_frame failed: InvalidState`) and no audio ever reached the track. Fixed by having the capture function build the audio source itself from the device's real negotiated rate (`tauri-client/rust-livekit/src/audio/capture.rs`, `src/lib.rs`), so the two can't drift apart. Re-run confirmed clean: both identities connected, each subscribed to the other's track, zero capture errors, and Andy confirmed hearing his own voice played back through the headset. This proves the capture → publish → subscribe → playback pipeline works end-to-end against a real server — it does not by itself satisfy the "done when" bar above, which still needs two distinct DDB-authenticated identities. **Not yet verified:** an actual DDB login (no second test account available this session — cobalt-token/Character Service field names in `ddb/` are inferred from archived docs and flagged for live-traffic verification), or the two-account "done when" bar itself — that needs a second DDB account, which is on you per the setup in [DEVELOPING.md](DEVELOPING.md#running-stage-1-locally).

**Notes:** the [DDB-AUTH.md open questions](docs/architecture/DDB-AUTH.md#resolved-cookie-access-exchange--refresh-stage-1) are resolved — see that section for the cookie access mechanism and JWT refresh strategy this stage implements.

**Deferred verification:** the literal "Done when" bar above (two distinct DDB-authenticated identities hearing each other) has not been run — no second DDB account was available this session. The loopback harness proves the capture → publish → subscribe → playback pipeline end-to-end against a real LiveKit server with synthetic identities, which covers the audio/WebRTC risk this stage exists to de-risk; the DDB-auth half of the pipeline (cobalt cookie → JWT → Character Service) is implemented per [DDB-AUTH.md](docs/architecture/DDB-AUTH.md) but unverified against live DDB traffic. Stage marked done on that basis; run the real two-identity test opportunistically once a second DDB account is available, and fix forward if it surfaces a bug rather than treating this note as closing the gap.

**Known issue (Linux) — root cause found and fixed 2026-08-09:** loading the bare `dndbeyond.com` marketing homepage reliably segfaulted WebKitGTK on at least one Linux+NVIDIA dev setup — reproduced independently in Epiphany (GNOME Web) on the same machine, so it's a WebKitGTK/graphics-stack issue, not app code. **It is a bug in NVIDIA's proprietary EGL driver, not a codec issue.** `WebKitWebProcess` segfaults inside `libnvidia-eglcore`, reached via `libEGL_nvidia` from `libwebkit2gtk-4.1`, while compositing pages that play video. Both earlier theories were wrong: it is neither the `<video>` element specifically (as the JS mitigation already showed) nor an AVIF/WebP image-codec decode issue.

Bisected against WebKitGTK 2.52.3 / NVIDIA 580.173.02 / GTX 1080 (Pascal) on Wayland, reproduced in stock `MiniBrowser`. Local HTML5 video (H.264 and VP9, up to 4K), MSE, canvas/WebGL video upload, YouTube Shorts and the YouTube *embed* player all play fine; YouTube *watch* pages and the DDB homepage crash. Forcing software VP9 decode still crashed, and hardware NVDEC decoding still works in the fixed configuration — so the decoder was never involved. Of the toggles tried (`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_GST_DISABLE_GL_SINK`, `WEBKIT_DMABUF_RENDERER_FORCE_SHM`, `WEBKIT_SKIA_ENABLE_CPU_RENDERING`, `WEBKIT_DMABUF_RENDERER_DISABLE_GBM`, `GDK_BACKEND=x11`, NVIDIA shader cache off) **only selecting a different EGL vendor library avoided it.** Matches a [reported NVIDIA 580-branch `libnvidia-eglcore` regression](https://forums.developer.nvidia.com/t/libnvidia-glvkspirv-egl-core-regression-on-580-105-08-crashes-fractal-when-playing-videos-or-gifs/352749); since [580 is the last branch supporting Maxwell/Pascal/Volta](https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW), affected machines cannot upgrade past it.

**No viable in-app fix — workaround tried, measured, and rejected.** Switching WebKit's EGL vendor library (`__EGL_VENDOR_LIBRARY_FILENAMES` → Mesa) does prevent the crash, and was briefly implemented as `egl_workaround.rs`. It was reverted after benchmarking, because the cost is not "software compositing" but a broken renderer:

| Config | UI FPS (page with no video) | Video | Crash |
| --- | --- | --- | --- |
| NVIDIA EGL (stock) | 62 | plays, 0 frames dropped | segfaults on some pages |
| Mesa EGL | 0.2 | decodes, UI frozen | none |
| Mesa EGL + zink over NVIDIA Vulkan | 62 | 0 frames presented | none |

Mesa cannot initialise a working path on this device at all (`libEGL warning: failed to create dri2 screen`, `driver (null)`); `LIBGL_ALWAYS_SOFTWARE=1` and `GALLIUM_DRIVER=llvmpipe` behave identically. Routing GL over NVIDIA's Vulkan driver via zink restores full speed and avoids the crash, but breaks `<video>` (`Failed to create EGL image from DMABuf`) — any page with a video element drops to ~1.5 FPS with no frames presented. **Do not re-add an EGL-vendor workaround without re-running these numbers.**

**What actually mitigates this** is what was already here: `consts::DDB_URL` pointing at `/characters`, `homepage_redirect.rs` + `on_navigation` in `lib.rs`, and `safety_net.rs`. Verified 2026-08-09 that `https://www.dndbeyond.com/characters` does **not** crash under stock NVIDIA EGL on affected hardware, so the app's normal path is unaffected; the crash needs content the Stage 2 page-restriction allowlist wouldn't permit anyway. Keep the homepage redirect — it is load-bearing, not belt-and-braces. **Open avenue:** NVIDIA `580.142` is available in `resolute/restricted` (vs. the installed `580.173.02`) and may predate the regression — untested, and the only known route to both no-crash and full performance. See [docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md](docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md) for the full history including both disproved theories.

**Known issue (Linux, unresolved):** the Wizards login page's plain email/password form gets a `403`/"Site Maintenance" (WAF-style block) under WebKitGTK. Two UA-spoof attempts (Chrome, then Firefox) were tried and both reverted — a HAR capture of the real failing request shows the shape of Akamai Bot Manager risk-scoring, not a fixable client bug, and the leading theory is that heavy repeated testing from one source IP escalated the risk score independent of UA. App currently uses WebKitGTK's real, unmodified UA. Paused for a cool-down before retesting — see [DDB-AUTH.md#known-issue-login-form-fails-under-webkitgtk-akamai-bot-manager](docs/architecture/DDB-AUTH.md#known-issue-login-form-fails-under-webkitgtk-akamai-bot-manager) for the full history. **Steam/Google/Apple OAuth is the standing recommended login path on Linux regardless of how this resolves.**

---

## Stage 2 — Audio Continuity, Hotkeys, Page Restriction & Ad-Block

**Status:** 🟡 In Progress — implemented and building clean; manual in-app verification outstanding (see below)
**Depends on:** Stage 1

Round out the Tauri shell requirements that don't depend on the overlay having real features yet. Design: [docs/superpowers/specs/2026-08-09-stage-2-shell-hardening-design.md](docs/superpowers/specs/2026-08-09-stage-2-shell-hardening-design.md), including the 2026-08-11 amendments that supersede parts of the original body.

**Deliverables:**

- 🟢 Audio survives window navigation/switching — `SharedClient` is Tauri app-level state (`.manage()`), not window state, so in-window navigation structurally cannot touch it. Code-verified; manual test outstanding.
- 🟡 Hotkeys: PTT (Right Ctrl), mute (Ctrl+Shift+M), overlay toggle (Ctrl+Shift+O) — two delivery paths, see the platform matrix below
- 🟢 Page-restriction allowlist (`consts::ALLOWED_DOMAINS`, subdomain-inclusive) enforced in `on_navigation` *and* `on_new_window`, cancelling to a shared blocked page (`blocked_page.rs`)
- 🟢 Ad-block: `safety_net.rs`'s `blockedHosts` extended with six near-universal ad/analytics domains, kept visibly separate from the AdGuard-sourced DDB-specific list
- 🟢 Microphone starts muted (true push-to-talk) — `rust-livekit` now retains the `LocalAudioTrack` and gates capture on an `AtomicBool`

**Done when:** navigating around DDB (Maps, Character Sheet, Rules) in one window doesn't interrupt an active voice call, blocked domains actually fail to load, and PTT/mute work via hotkey without the overlay focused.

**Hotkey platform matrix — the "without the overlay focused" bar is met everywhere; "without the *app* focused" is not.**

| Binding | Windows / macOS / Linux X11 | Linux Wayland |
| --- | --- | --- |
| Right Ctrl (PTT) | app-focused only | app-focused only |
| Ctrl+Shift+M (mute) | global | app-focused only |
| Ctrl+Shift+O (overlay) | global | app-focused only |

Two findings behind that table, both from running the app rather than from documentation:

1. **Push-to-talk can never be an OS-level global shortcut.** `global-hotkey` has no scancode mapping for bare modifier keys — registering Right Ctrl fails with `Unknown scancode for key: ControlRight` on every platform, not just Wayland. The injected in-page handler reads `event.code === 'ControlRight'` without trouble, so PTT is app-focused by design now; the global registration was removed rather than left to fail noisily at each launch. Decided 2026-08-11 to keep one binding rather than add a second, chord-based global PTT.
2. **Global shortcuts silently no-op on Wayland.** `global-hotkey`/`tao`'s shortcut thread is X11-specific and [disabled on Wayland](https://github.com/tauri-apps/tao/pull/543), so registration *succeeds* and then never fires — there is no error to log. The [XDG `GlobalShortcuts` portal](https://github.com/aaddrick/claude-desktop-debian/blob/main/docs/learnings/wayland-global-shortcuts-portal.md) is the only real Wayland route and is reported as a no-op on GNOME 50, which is this project's dev machine (GNOME Shell 50.1, Wayland). Not attempted for that reason. The app logs the degradation explicitly at startup.

**Known issue — OAuth login is blocked by the allowlist (deliberate, ship-and-fix-forward).** [DDB-AUTH.md](docs/architecture/DDB-AUTH.md) names Steam/Google/Apple OAuth as the recommended login path on Linux, and those redirect to domains outside `dndbeyond.com`/`wizards.com` (plus, most likely, an Auth0 tenant in between). None are allowlisted, so **completing an OAuth login on Linux may now be impossible.** Accepted deliberately rather than pre-empted with guessed domains: closing it needs a live HAR capture of a real OAuth login, held to the same evidence standard as the ad-block list. `allowlist.rs` has a test asserting the current blocked behaviour, so closing the gap is a visible change. Fast-follow.

**Verified:** `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test --all` (19 tests), and a full `cargo build` of the binary all pass; `npm run lint`, `format:check`, `typecheck`, and `build` pass across every TS workspace. The built binary launches on Linux/Wayland, loads `/characters`, registers the mute/overlay shortcuts without error, and logs the Wayland degradation.

**Not yet verified (manual, needs a real session):** hotkeys actually firing end-to-end (PTT opening the mic, mute toggling, overlay hiding/showing); a disallowed URL actually landing on the blocked page; `target="_blank"` stripping against a real DDB link; whether `on_new_window` or the JS strip is the path that actually catches new-window requests on this WebKitGTK build; and audio surviving navigation across allowed DDB pages during a live call.

---

## Stage 3 — Overlay UI, DDB Extraction & Chat

**Status:** ⚪ Not Started — split into 3a/3b/3c (2026-08-11)
**Depends on:** Stage 2, Stage 0.5

The first real test of the state architecture: speaking indicators, presence, and chat are exactly the "rapidly-changing, long-running" surfaces Stage 0.5 exists for.

**Split into three parts**, because the original stage bundled three subsystems that share a stage number but not a dependency chain — and because chat's transport is an unresolved architectural question that shouldn't gate the overlay work behind it:

| Part | Contents | Status |
| --- | --- | --- |
| **3a** | Page-scoped overlay mounting, speaking indicators, voice controls, churn diagnostics wired up — [design](docs/superpowers/specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md), [plan](docs/superpowers/plans/2026-08-11-stage-3a-overlay-shell-voice-ui-plan.md) | 🟡 In Progress — implemented and building clean; manual in-app verification outstanding (see below) |
| **3b** | DDB DOM extraction — character metadata, campaign metadata, token conditions | ⚪ Not Started |
| **3c** | Chat, bounded retention, refresh recovery, reconnect/backoff/event-replay | ⚪ Not Started |

Two items moved or deferred out of the stage:

- **The group selector moves to Stage 4**, where group routing — the mechanism it drives — already lives. A selector with nothing to select is busywork.
- **The chat transport is an open architectural question, deferred to 3c.** [CLAUDE.md §8.4](CLAUDE.md) says LiveKit carries "data events for chat + bookmarks"; this stage and [STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md#websocket-reliability) instead describe a WebSocket layer with a *server-side* bounded replay buffer. The docs currently assert both. Compounding it, `backend/` has no WebSocket layer and Postgres/Redis are Stage 5 deliverables, so a server-side replay buffer has nowhere durable to live yet. 3c resolves this deliberately rather than by whichever gets built first.

**Deliverables (unchanged in total, now distributed across 3a/3b/3c):**

- Full Shadow DOM overlay: voice controls, speaking indicators (leaf-isolated per Stage 0.5), minimal chat
- DOM extraction for character metadata, campaign metadata, token conditions (`ddb/` + `overlay-ui/`)
- Overlay injection scoped to Maps VTT, with the "overlay everywhere" debug toggle — 3a additionally renders a minimal mic pill on other allowed pages, so a player mid-session isn't left without mute or mic-state feedback while reading rules (push-to-talk is app-focused-only, per Stage 2)
- Refresh recovery implemented and manually verified: reload the WebView mid-session, confirm domain state (roster, presence, chat) comes back atomically and UI-only state (panel state) restores separately
- Reconnect/backoff + bounded event-replay on the WebSocket layer (per [STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md#websocket-reliability))

**Done when:** a simulated multi-hour session (can be sped up / synthetic load in dev) with continuous speaking-state churn shows stable memory in the overlay's WebView, and a mid-session refresh recovers full state within a couple seconds with no duplicate messages or stuck indicators. This bar belongs to 3c — 3a and 3b close on their own narrower criteria, recorded in their specs.

**Known issue (Linux), unconfirmed root cause:** on a real Maps VTT page (`/games/<id>`), maps with an *animated background* render nothing — static maps, tokens, and other in-map animations are all unaffected; it's specifically the animated map background that goes blank. Reproduced in Epiphany independently of this app, so it's WebKitGTK, not app code. Leading theory: DDB implements animated map backgrounds the same way as the homepage's hero banners — a looping `<video>` element — and this is the same underlying WebKitGTK media-rendering issue as the Stage 1 homepage crash above, just failing silently (blank) here instead of segfaulting there. `safety_net.rs`'s video-stripping is scoped only to the homepage's specific `SiteWide_backgroundVideo` class, so it isn't touching Maps VTT at all — this is WebKitGTK's native behavior on this content, not a side effect of our own mitigation. This directly threatens this stage's "overlay injection scoped to Maps VTT" deliverable for any campaign using an animated map — not yet investigated further; logged here for whoever picks up Stage 3.

**Likely the same root cause (2026-08-09):** the Stage 1 homepage crash above is now confirmed as a bug in NVIDIA's proprietary EGL driver, which supports the "same underlying media-rendering issue" theory — a blank animated map background is what a failed video-frame import looks like when it fails silently instead of fatally. Note this is *not* fixed: the EGL-vendor workaround was tried and reverted (see Stage 1 above), so nothing has changed on affected hardware. Cheapest check when someone has a real campaign with an animated map: open it, then re-open with `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json` set, and see whether the background appears. If it does, that confirms the shared cause and the fix is upstream, not here. Full context: [docs/WEBKITGTK-NVIDIA-EGL-CRASH.md](docs/WEBKITGTK-NVIDIA-EGL-CRASH.md).

**3a implemented, manual verification outstanding.** `classifyPage`/`usePageMode`, `speakingStore`, the `livekit:speakers` event (Rust: new `RoomEvent::ActiveSpeakersChanged` arm and `SpeakersChangeCallback`; relayed by `src-tauri`), `MuteButton`/`set_microphone_muted` (sharing its apply/emit path with the hotkey handler), and the `FullPanel`/`MicPill` split are all in place, Vitest-covered where the design specifies (`classifyPage`, `speakingStore.applySpeakers`, `microphoneStore.applyMuted`), and pass `cargo fmt`/`clippy`/`build`/`test` and `npm run lint`/`format:check`/`typecheck`/`build`/`test`. This is also the overlay's first genuinely interactive control, so it's the point where `@radix-ui/themes` — a dependency since Stage 1 but never actually imported — finally gets wired in for real (`main.tsx` wraps the render tree in Radix's `Theme` provider; `MuteButton` uses Radix's `Button`), fulfilling CLAUDE.md §3/§19's Radix mandate that Stage 1/2's components had been deviating from. Accepted cost: Radix's `tokens.css` + `components.css` inline into the injected bundle, growing `overlay.js` from 654.84KB to 1,195.63KB (gzip 195.95KB → 269.54KB) — injected via `initialization_script` on every DDB page load, not just Maps. **Not yet verified (manual, needs a real session):** the overlay actually renders as a pill on a character sheet and a full panel on a real Maps VTT page; the `/games/<id>` pattern matches a real Maps URL; whether DDB routes Maps client-side (making the SPA-navigation subscription load-bearing) or hard-navigates; speaking dots lighting up for the correct participant during a two-party call; the mute button and Right Ctrl agreeing on mic state; the debug flag forcing the full panel off-Maps; the Radix `Theme` wrapper not intercepting DDB canvas clicks; and whether LiveKit's server-side active-speaker throttling needs a client-side cap (see the design's §2 — add one at the Rust emit site only if observed firing faster than ~10Hz).

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
