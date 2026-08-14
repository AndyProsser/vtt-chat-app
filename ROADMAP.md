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

**Resolved (was: known issue, Linux) — plain email/password login.** Earlier testing saw the Wizards login page's plain email/password form fail under WebKitGTK with a `403`/"Site Maintenance" response, with evidence pointing at Akamai Bot Manager risk-scoring. Retested 2026-08-13 with WebKitGTK's real, unmodified UA and it succeeded — most likely a transient risk-score/rate-limit condition on Wizards' side rather than a client-side bug, consistent with the original investigation's leading theory. Full investigation history (UA-spoof attempts, HAR analysis) is in git history for `docs/architecture/DDB-AUTH.md` if this resurfaces. OAuth (Google confirmed working, see below) remains available regardless.

---

## Stage 2 — Audio Continuity, Hotkeys, Page Restriction & Ad-Block

**Status:** 🟡 In Progress — implemented and building clean; manual in-app verification outstanding (see below)
**Depends on:** Stage 1

Round out the Tauri shell requirements that don't depend on the overlay having real features yet. Design: [docs/superpowers/specs/2026-08-09-stage-2-shell-hardening-design.md](docs/superpowers/specs/2026-08-09-stage-2-shell-hardening-design.md), including the 2026-08-11 amendments that supersede parts of the original body.

**Deliverables:**

- 🟢 Audio survives window navigation/switching — `SharedClient` is Tauri app-level state (`.manage()`), not window state, so in-window navigation structurally cannot touch it. Code-verified; manual test outstanding.
- 🟡 Hotkeys: PTT (Left Ctrl), mute (Ctrl+Shift+M), overlay toggle (Ctrl+Shift+O) — two delivery paths, see the platform matrix below
- 🟢 Page-restriction allowlist (`consts::ALLOWED_DOMAINS`, subdomain-inclusive) enforced in `on_navigation` *and* `on_new_window`, cancelling to a shared blocked page (`blocked_page.rs`)
- 🟢 Ad-block: `safety_net.rs`'s `blockedHosts` extended with six near-universal ad/analytics domains, kept visibly separate from the AdGuard-sourced DDB-specific list
- 🟢 Microphone starts muted (true push-to-talk) — `rust-livekit` now retains the `LocalAudioTrack` and gates capture on an `AtomicBool`

**Done when:** navigating around DDB (Maps, Character Sheet, Rules) in one window doesn't interrupt an active voice call, blocked domains actually fail to load, and PTT/mute work via hotkey without the overlay focused.

**Hotkey platform matrix — the "without the overlay focused" bar is met everywhere; "without the *app* focused" is not.**

| Binding | Windows / macOS / Linux X11 | Linux Wayland |
| --- | --- | --- |
| Left Ctrl (PTT) | app-focused only | app-focused only |
| Ctrl+Shift+M (mute) | global | app-focused only |
| Ctrl+Shift+O (overlay) | global | app-focused only |

Two findings behind that table, both from running the app rather than from documentation:

1. **Push-to-talk can never be an OS-level global shortcut.** `global-hotkey` has no scancode mapping for bare modifier keys — confirmed live with Right Ctrl, which failed with `Unknown scancode for key: ControlRight` on every platform, not just Wayland. The injected in-page handler reads the key by `event.code` without trouble, so PTT is app-focused by design now; the global registration was removed rather than left to fail noisily at each launch. Decided 2026-08-11 to keep one binding rather than add a second, chord-based global PTT. **Rebound to Left Ctrl 2026-08-14** — easier to hold with a mouse in the right hand; the same bare-modifier scancode limitation applies regardless of which side.
2. **Global shortcuts silently no-op on Wayland.** `global-hotkey`/`tao`'s shortcut thread is X11-specific and [disabled on Wayland](https://github.com/tauri-apps/tao/pull/543), so registration *succeeds* and then never fires — there is no error to log. The [XDG `GlobalShortcuts` portal](https://github.com/aaddrick/claude-desktop-debian/blob/main/docs/learnings/wayland-global-shortcuts-portal.md) is the only real Wayland route and is reported as a no-op on GNOME 50, which is this project's dev machine (GNOME Shell 50.1, Wayland). Not attempted for that reason. The app logs the degradation explicitly at startup.

**Known issue — OAuth login is blocked by the allowlist (deliberate, ship-and-fix-forward), partially closed 2026-08-13.** [DDB-AUTH.md](docs/architecture/DDB-AUTH.md) names Steam/Google/Apple OAuth as the recommended login path on Linux, and those redirect to domains outside `dndbeyond.com`/`wizards.com` (plus, most likely, an Auth0 tenant in between). Accepted deliberately rather than pre-empted with guessed domains: closing it needs a live HAR capture (or, as it turned out, a live blocked-page screenshot) of a real OAuth login, held to the same evidence standard as the ad-block list. `accounts.google.com` is now allowlisted — confirmed live via a real "Sign in with Google" click that was blocked navigating to Google Identity Services' button endpoint. **Apple and Steam remain blocked**, same reasoning, until their own redirect chains are observed live; `allowlist.rs` has a test asserting each provider's current status so closing further gaps stays a visible change. Also unconfirmed: whether the rest of the Google flow (past the button, through consent and back) needs anything beyond this one domain — needs someone to actually complete a Google sign-in.

**Known issue found and fixed 2026-08-13 — ad-block false positive against DDB's own UI.** `optimizely.com` was in the ad-block list (sourced from the AdGuard filtering-log capture, like the rest of the DDB-specific entries) but blocking it broke DDB's own nav mega-menus (PLAY D&D / RULES / LIBRARY / COMMUNITY) — confirmed live: the panels toggled open but rendered as a zero-size box with no content, and reproducing only inside this app (not in stock Epiphany) pointed at app code rather than WebKitGTK. DDB evidently uses Optimizely to gate what renders inside these panels, not just as a passive analytics beacon. `optimizely.com` is no longer blocked; see `safety_net.rs` for the evidence note.

**Verified:** `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test --all` (20 tests), and a full `cargo build` of the binary all pass; `npm run lint`, `format:check`, `typecheck`, and `build` pass across every TS workspace. The built binary launches on Linux/Wayland, loads `/characters`, registers the mute/overlay shortcuts without error, and logs the Wayland degradation.

**Not yet verified (manual, needs a real session):** hotkeys actually firing end-to-end (PTT opening the mic, mute toggling, overlay hiding/showing); a disallowed URL actually landing on the blocked page; `target="_blank"` stripping against a real DDB link; whether `on_new_window` or the JS strip is the path that actually catches new-window requests on this WebKitGTK build; and audio surviving navigation across allowed DDB pages during a live call.

---

## Stage 3 — Overlay UI & DDB Extraction

**Status:** ⚪ Not Started — split into 3a/3b (2026-08-11), 3a redesigned and re-planned 2026-08-14
**Depends on:** Stage 2, Stage 0.5

The first real test of the state architecture: speaking indicators, presence, groups, and conditions are exactly the "rapidly-changing, long-running" surfaces Stage 0.5 exists for.

**Split into two parts** (chat, formerly a third part here, has moved to its own [Stage 3.5](#stage-35--text-chat-deferred) — see below):

| Part | Contents | Status |
| --- | --- | --- |
| **3a** | Compact/expanded overlay views, avatar strip, groups, DM controls, conditions, WS sync layer — [original design](docs/superpowers/specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md), [original plan](docs/superpowers/plans/2026-08-11-stage-3a-overlay-shell-voice-ui-plan.md) (mounting/speaking-indicator groundwork, implemented); redesigned per [2026-08-14 design](docs/superpowers/specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md) and re-planned as [Plan A](docs/superpowers/plans/2026-08-14-overlay-compact-view-plan-a-plan.md) (compact/expanded UI), [Plan B](docs/superpowers/plans/2026-08-14-ws-layer-plan-b-plan.md) (WS sync layer), [Plan C](docs/superpowers/plans/2026-08-14-conditions-plan-c-plan.md) (conditions) | 🟡 In Progress — original mounting/speaking-indicator groundwork implemented (see below); Plans A/B/C written, self-reviewed, and committed 2026-08-14, execution not yet started |
| **3b** | DDB DOM extraction — character metadata, campaign metadata | ⚪ Not Started |

**What changed 2026-08-14, and why:** live-testing the original 3a groundwork (mounting bug, z-index, PTT rebind — see below) surfaced the next real question — what the overlay should actually look like once it has more than one participant, groups, and DM controls to show. That became a full brainstorm ([spec](docs/superpowers/specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md)): a horizontal avatar-strip compact view (mute icon first, separator, then avatars, condition dots on hover), a per-corner-persisted vertical expanded view toggled per-window-instance (never persisted across refresh, to avoid ever hiding critical state), right-click-revealed group management (DM drag/drop between groups, groups voice-isolated, empty groups hidden from players, DM broadcasts to all groups by default with an override, a dedicated Whisper group that locks the DM to it until released), and a two-tier D&D-5e condition model (audio-effect conditions like silenced/drunk-confused always DM-only; everything else player-editable by default, DM-lockable). Two things surfaced mid-design that reshaped the plan split itself:

- **Conditions need real-time sync across clients, which nothing in the codebase provides yet.** The natural mechanism is the backend WebSocket broadcast layer from the archived `vtt-chat` predecessor (see [CLAUDE.md §16](CLAUDE.md)) — adapted so **Rust owns the connection/state machine** (consistent with `rust-livekit` already owning LiveKit's) and **TS/JS stays pure UI**, reusing the already-issued-but-unconsumed `appSessionToken` for WS auth. This became **Plan B**, self-contained infrastructure with no chat dependency.
- **Chat's requirements are different enough from voice that it doesn't need to gate this stage** — chat moves to its own stage ([3.5](#stage-35--text-chat-deferred)), which will consume Plan B's WS layer once it exists rather than the other way around.

Plan A (compact/expanded UI, no WS dependency) and Plan C (conditions, consumes Plan B's `wsSend`/`onWsMessage` primitives) are written to execute in order A → B → C. All three are fully-specified TDD implementation plans (exact code, no placeholders, self-reviewed) but **none has been executed yet** — per-session instruction, planning work was completed and committed, then paused for review before implementation resumes.

One item moved out of the stage during the original split:

- **The group selector moves to Stage 4** in the original 3a/3b/3c split rationale — since then, group *management* (not just selection) has folded into 3a's own redesign above, since the compact/expanded views need groups to render at all. Stage 4's DM-controls deliverable now covers group routing's *audio* effects (isolation, routing) layered on top of the UI this stage builds.

**Deliverables (now distributed across 3a/3b):**

- Compact-view overlay: horizontal avatar strip, mute icon + separator, per-corner persisted position, condition dots (Plan A + Plan C)
- Expanded-view overlay: per-window-instance toggle, never persisted across refresh, full condition badges (Plan A + Plan C)
- Group management UI: DM drag/drop, hidden-when-empty, Whisper group (Plan A, per the 2026-08-14 spec — audio isolation itself is Stage 4)
- DM corner-menu controls: corner picker, condition-editing permission toggle (Plan A + Plan C)
- Conditions: fixed D&D-5e-based list, two-tier DM/player editing permission, synced via the WS layer (Plan C)
- WS sync layer: Rust-owned connection/state machine (`ws_client.rs`, `SharedWsSender`), generic send/receive Tauri bridge (`wsSend`/`onWsMessage`), backend `ws` server with Redis-Streams-backed bounded replay buffer, `appSessionToken`-based auth (Plan B)
- DOM extraction for character metadata, campaign metadata (`ddb/` + `overlay-ui/`) — token-condition extraction from DDB itself is unresolved (see Plan C's flagged assumption) and deferred until DDB's own condition data is better understood
- Overlay injection scoped to Maps VTT, with the "overlay everywhere" debug toggle — the original 3a groundwork additionally renders a minimal mic pill on other allowed pages, so a player mid-session isn't left without mute or mic-state feedback while reading rules (push-to-talk is app-focused-only, per Stage 2)
- Refresh recovery implemented and manually verified: reload the WebView mid-session, confirm domain state (roster, presence, conditions) comes back atomically and UI-only state (panel expand/collapse) restores separately
- Reconnect/backoff + bounded event-replay on the WebSocket layer (per [STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md#websocket-reliability)) — delivered by Plan B, decoupled from chat now that chat has its own stage

**Done when:** a simulated multi-hour session (can be sped up / synthetic load in dev) with continuous speaking-state and condition churn shows stable memory in the overlay's WebView, and a mid-session refresh recovers full state within a couple seconds with no duplicate events or stuck indicators. 3a and 3b close on their own narrower criteria, recorded in their specs/plans.

**Known issue (Linux), unconfirmed root cause:** on a real Maps VTT page (`/games/<id>`), maps with an *animated background* render nothing — static maps, tokens, and other in-map animations are all unaffected; it's specifically the animated map background that goes blank. Reproduced in Epiphany independently of this app, so it's WebKitGTK, not app code. Leading theory: DDB implements animated map backgrounds the same way as the homepage's hero banners — a looping `<video>` element — and this is the same underlying WebKitGTK media-rendering issue as the Stage 1 homepage crash above, just failing silently (blank) here instead of segfaulting there. `safety_net.rs`'s video-stripping is scoped only to the homepage's specific `SiteWide_backgroundVideo` class, so it isn't touching Maps VTT at all — this is WebKitGTK's native behavior on this content, not a side effect of our own mitigation. This directly threatens this stage's "overlay injection scoped to Maps VTT" deliverable for any campaign using an animated map — not yet investigated further; logged here for whoever picks up Stage 3.

**Likely the same root cause (2026-08-09):** the Stage 1 homepage crash above is now confirmed as a bug in NVIDIA's proprietary EGL driver, which supports the "same underlying media-rendering issue" theory — a blank animated map background is what a failed video-frame import looks like when it fails silently instead of fatally. Note this is *not* fixed: the EGL-vendor workaround was tried and reverted (see Stage 1 above), so nothing has changed on affected hardware. Cheapest check when someone has a real campaign with an animated map: open it, then re-open with `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json` set, and see whether the background appears. If it does, that confirms the shared cause and the fix is upstream, not here. Full context: [docs/WEBKITGTK-NVIDIA-EGL-CRASH.md](docs/WEBKITGTK-NVIDIA-EGL-CRASH.md).

**3a implemented, manual verification outstanding.** `classifyPage`/`usePageMode`, `speakingStore`, the `livekit:speakers` event (Rust: new `RoomEvent::ActiveSpeakersChanged` arm and `SpeakersChangeCallback`; relayed by `src-tauri`), `MuteButton`/`set_microphone_muted` (sharing its apply/emit path with the hotkey handler), and the `FullPanel`/`MicPill` split are all in place, Vitest-covered where the design specifies (`classifyPage`, `speakingStore.applySpeakers`, `microphoneStore.applyMuted`), and pass `cargo fmt`/`clippy`/`build`/`test` and `npm run lint`/`format:check`/`typecheck`/`build`/`test`. This is also the overlay's first genuinely interactive control, so it's the point where `@radix-ui/themes` — a dependency since Stage 1 but never actually imported — finally gets wired in for real (`main.tsx` wraps the render tree in Radix's `Theme` provider; `MuteButton` uses Radix's `Button`), fulfilling CLAUDE.md §3/§19's Radix mandate that Stage 1/2's components had been deviating from. Accepted cost: Radix's `tokens.css` + `components.css` inline into the injected bundle, growing `overlay.js` from 654.84KB to 1,195.63KB (gzip 195.95KB → 269.54KB) — injected via `initialization_script` on every DDB page load, not just Maps. **First real manual session, 2026-08-14 — two mounting bugs found and fixed.** The pill renders on `/characters` now, confirmed live, but only after two real, previously-invisible bugs surfaced (both masked all session by locally-persisting `dist/` build artifacts, same root cause as several CI-only bugs that day — see git history for `main.tsx`/`vite.config.ts` around 2026-08-14): (1) React's bundled CJS entry threw `process is not defined` on evaluation, since Vite's library-mode build wasn't statically replacing `process.env.NODE_ENV` the way its normal app build does — the overlay had likely never actually mounted in a real WebView since Stage 1; (2) `.vtt-overlay`'s `position: fixed` + max z-index lived several levels down inside the Shadow DOM, so DDB's own header still painted over it regardless of the z-index value (already maxed at 2147483647, nothing higher to set) — moved to the light-DOM host element itself, the standard fix for injected overlays. PTT rebound from Right Ctrl to **Left Ctrl** the same day (easier to hold with a mouse in the right hand).

**Not yet verified (manual, needs a real session):** a full panel on a real Maps VTT page; the `/games/<id>` pattern matches a real Maps URL; whether DDB routes Maps client-side (making the SPA-navigation subscription load-bearing) or hard-navigates; speaking dots lighting up for the correct participant during a two-party call; the debug flag forcing the full panel off-Maps; and whether LiveKit's server-side active-speaker throttling needs a client-side cap (see the design's §2 — add one at the Rust emit site only if observed firing faster than ~10Hz). **Also open:** the mute button and PTT both appeared inert during this session's test — matches the existing by-design no-op when no LiveKit client is connected yet (`hotkeys.rs`), but that's unconfirmed as the actual cause, and either way there's no UI feedback distinguishing "no-op, not connected" from "broken."

---

## Stage 3.5 — Text Chat (Deferred)

**Status:** ⚪ Not Started
**Depends on:** Stage 3 (specifically Plan B's WS sync layer)

Split out of the original Stage 3 on 2026-08-14 — chat's requirements are different enough from voice that it doesn't need to gate the overlay/conditions/groups work in Stage 3, and can be bolted on once the WS layer it needs already exists rather than co-designed with it. [CLAUDE.md §8.4](CLAUDE.md) says LiveKit carries "data events for chat + bookmarks"; this repo's actual direction (per Stage 3's Plan B) is a backend-owned WebSocket layer with a Redis-Streams-backed bounded replay buffer instead — this stage should resolve that discrepancy in `CLAUDE.md` when it starts, not before.

**Deliverables:**

- Minimal chat UI in the overlay (leaf-isolated per Stage 0.5), consuming Plan B's `wsSend`/`onWsMessage` primitives the same way Plan C's conditions do
- Chat message persistence/retention policy (bounded, same replay-buffer mechanism conditions use — no new backend transport)
- Refresh recovery for chat specifically: reload mid-session, confirm message history comes back without duplicates or gaps within the replay buffer's window

**Done when:** two participants in the same campaign can exchange chat messages that survive a mid-session refresh for at least the replay buffer's retention window, with no duplicate or dropped messages.

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
