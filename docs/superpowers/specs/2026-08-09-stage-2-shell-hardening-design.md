# Stage 2: Shell Hardening — Hotkeys, Page Restriction, Ad-Block, Audio Continuity

**Stage:** [Stage 2](../../../ROADMAP.md#stage-2-audio-continuity-hotkeys-page-restriction-ad-block) — global hotkeys, page-restriction allowlist, ad-block extension, audio-continuity verification.
**Depends on:** Stage 1 (auth + voice end-to-end, done).
**Status:** Approved 2026-08-11, with the amendments in [Amendments](#amendments-2026-08-11) applied. Where the amendments and the original body disagree, the amendments win.

## Why one spec for four deliverables

Stage 2 bundles four items in `CLAUDE.md` §8.1. They aren't independent subsystems the way "chat + billing + analytics" would be — they're narrowly-scoped shell features sharing one theme (hardening the single-window WebView shell before Stage 3 builds real overlay UI on top of it), and three of the four touch the same `lib.rs` `setup()`/`on_navigation` closure. One spec, one plan.

## Architecture overview

```text
main.rs
  └─ lib.rs::run()
       ├─ tauri-plugin-global-shortcut (new)  → hotkeys.rs (new)
       ├─ on_navigation (existing, extended)  → allowlist.rs (new), blocked_page.rs (new)
       ├─ on_new_window (new)                 → allowlist.rs (reused)
       ├─ initialization_script: safety_net::SCRIPT (existing, extended)
       │    └─ new: target="_blank" → strip target, fall through to on_navigation
       └─ [verification only] SharedClient app-state (existing, Stage 1)
```

No new Tauri IPC commands. Hotkeys act on `SharedClient`/the window directly via `AppHandle`, not through the overlay's existing `livekit_connect`/`livekit_disconnect` bridge — the overlay isn't involved in muting, except to receive the new `overlay:toggle` event.

## 1. Global hotkeys

**Plugin:** `tauri-plugin-global-shortcut` (official Tauri plugin). Verified before designing around it: `ShortcutEvent`/`ShortcutState::Pressed`/`Released`, supports Windows/macOS/Linux, keyboard shortcuts only (no mouse buttons — moot, see below).

**Bindings:**

| Shortcut | Event | Action |
| --- | --- | --- |
| Right Ctrl | `Pressed` | `set_microphone_muted(false)` |
| Right Ctrl | `Released` | `set_microphone_muted(true)` |
| Ctrl+Shift+M | `Pressed` | toggle based on `is_microphone_muted()` |
| Ctrl+Shift+O | `Pressed` | emit `overlay:toggle` event |

Hardcoded defaults, not user-configurable in this stage — configurability needs a persistence story that doesn't exist until Stage 5, and bolting a settings path on now would be built against an unknown future shape.

**Mic starts muted immediately after publish.** True push-to-talk: silent until Right Ctrl is held. Chosen over open-by-default because an unattended session during a live D&D game is a real hot-mic risk; PTT is the primary gate, not an emphasis tool on top of an open mic.

**`rust-livekit` gap, found while designing this (not yet in the codebase):** `LiveKitClient::connect()` creates the mic's `LocalAudioTrack`, publishes it, and drops the handle — nothing retains it, so nothing can mute it later. `LocalAudioTrack` does expose `mute()` / `unmute()` / `is_muted()` (confirmed against the `livekit` 0.8.2 crate docs), so the fix is small: `LiveKitClient` needs to hold the track and expose:

```rust
impl LiveKitClient {
    pub fn set_microphone_muted(&self, muted: bool);
    pub fn is_microphone_muted(&self) -> bool;
}
```

`hotkeys.rs` calls these through `SharedClient` (`Arc<Mutex<Option<LiveKitClient>>>`, already `.manage()`d in Stage 1) — a no-op if not currently connected.

**Overlay toggle touches `overlay-ui`, not just the shell.** Nothing currently tracks overlay visibility — `OverlayRoot` always renders unconditionally. Per [STATE-AND-RESILIENCE.md](../../architecture/STATE-AND-RESILIENCE.md)'s leaf-isolation rule (Stage 0.5), "is the overlay visible" is UI-only state and must **not** live in `useLiveKitStore` — that store's own doc comment already says it's a domain-state cache of `rust-livekit`, not a general-purpose store. New pieces:

- A new tiny UI-only `useOverlayVisibilityStore` (zustand, matching `store.ts`'s existing pattern).
- `tauriBridge.ts` gets `onOverlayToggle`, matching the existing `onLiveKitState` / `onCobaltCookieDetected` shape (`listen<T>('event:name', handler)`).
- A new hook wires the listener into the store; `OverlayRoot` reads visibility from the store rather than always rendering.

**Failure handling:** if a shortcut is already claimed by another app (e.g. another tool also binds Right Ctrl), registration failure is logged and the app continues — PTT not working is a degraded experience, not a startup-blocking error.

## 2. Page-restriction allowlist

**New `allowlist.rs`:**

```rust
pub fn is_allowed(url: &Url) -> bool
```

Suffix-matches the host against `dndbeyond.com` and `wizards.com` (the domain itself and all subdomains) per `CLAUDE.md`'s `*.dndbeyond.com/*` / `*.wizards.com/*`. This is genuinely new matching logic, not a reuse of `homepage_redirect.rs`'s `is_ddb_homepage` — that function checks an exact small set of hosts for one specific page, not a wildcard subdomain rule. Non-`http(s)` schemes (`mailto:`, `tel:`, etc.) are treated as not-allowed by default and fall through to the blocked page.

**Blocked-page mechanism generalized, not duplicated.** `homepage_redirect.rs`'s `data:` URL template (base64 HTML + poster image) is the pattern being reused for blocked-navigation UX, but as it stands it's hardcoded to one crash-avoidance message ("Natural 1..."). Factor the template-building into a new `blocked_page.rs` parameterized by title/poster/message, so `homepage_redirect.rs` calls it with its existing copy and `allowlist.rs` calls it with new copy ("This site isn't available in VTT Chat App..."). Avoids two near-identical `data:` URL builders.

**`lib.rs`'s existing `on_navigation` closure gets one more check**, after the existing homepage-redirect check: if `!allowlist::is_allowed(url)`, cancel navigation and `.navigate()` to the blocked page.

**New-window requests — resolving a Stage-2-vs-Stage-4 boundary.** `on_new_window` (Tauri's `WebviewWindowBuilder` API, confirmed to exist and take a `Fn(Url, NewWindowFeatures) -> NewWindowResponse<R>`) fires for `window.open()`. Tauri's own docs don't say whether `target="_blank"` anchor clicks route through it too — community reports suggest they may bypass it entirely. Design:

- `safety_net.rs` gets a capture-phase click listener that strips `target="_blank"` before the click completes, turning it into an ordinary same-window navigation that flows through the `on_navigation` check above. No separate allow/deny logic needed in JS.
- `on_new_window` itself: real multi-window doesn't exist until Stage 4, so it must never spawn an OS window here. Instead, navigate the *existing* main window — to the target if `allowlist::is_allowed`, to the blocked page if not. Both interception points converge on the same `is_allowed` + blocked-page mechanism as ordinary navigation.

**Known gap, not fixed in this stage — OAuth login domains.** [`DDB-AUTH.md`](../../architecture/DDB-AUTH.md) documents Steam/Google/Apple OAuth as the *recommended* login path (Akamai bot-scoring breaks the plain email/password form). OAuth necessarily redirects to domains outside `dndbeyond.com`/`wizards.com` — Google's, Apple's, or Steam's own login pages, and likely an Auth0 tenant domain in between. The exact redirect chain has not been captured live (only the *failing* plain-login flow has a HAR trace; the *working* OAuth flow does not). Enforcing the allowlist as scoped here **will break OAuth login** until that chain is traced and added. Ship anyway, log as a known issue in `ROADMAP.md`, fast-follow once a live OAuth HAR capture is done (same evidentiary standard as the tracker list below — confirmed domains only, not guessed).

## 3. Ad-block extension

`safety_net.rs`'s `blockedHosts` array (fetch/XHR/`src`-setter interception, already applied globally via unconditional `initialization_script`) gets a small addition: `doubleclick.net`, `googlesyndication.com`, `google-analytics.com`, `googletagservices.com`, `adservice.google.com`, `amazon-adsystem.com`. These are near-universal ad/analytics infrastructure blocked by virtually every mainstream ad-blocker regardless of site — a different category from the original list's DDB-specific domains, which were deliberately sourced only from live AdGuard captures on real DDB pages (see [the original design doc](2026-08-08-tracker-video-safety-net-design.md)) rather than guessed. No mechanism changes — same interception code, larger array.

**Explicitly not doing, logged as gaps rather than silently skipped:**

- **Generic CSS-selector ad-hiding.** Risks breaking DDB's real page layout, and is exactly the kind of guessing the original list's design doc rejected as a starting principle.
- **Broadening `SiteWide_backgroundVideo` neutralization into a general autoplay-video-ad blocker.** No live evidence yet of what (if any) third-party ad video appears on DDB pages. That neutralization exists to avoid the WebKitGTK/NVIDIA crash (see [`WEBKITGTK-NVIDIA-EGL-CRASH.md`](../../WEBKITGTK-NVIDIA-EGL-CRASH.md)), not as ad-blocking — conflating the two would blur two unrelated reasons for touching video elements.
- **Growing `blockedHosts` further with DDB-specific domains.** Needs a live authenticated capture on more page types (Maps VTT, Rules) with the same AdGuard-trace standard as the existing list. Logged in `ROADMAP.md` as an ongoing, evidence-gated task, not a one-time Stage 2 item.

## 4. Audio continuity — verification only

No new code. `SharedClient` (`Arc<Mutex<Option<LiveKitClient>>>`) has lived in Tauri app-level state since Stage 1 (`.manage(...)`), not window state — navigating within the single main window structurally cannot touch it. Real multi-window sharing is Stage 4's concern, not this stage's.

**Manual test, once page restriction exists:** connect to a LiveKit room, navigate the single main window across allowed DDB pages (character sheet → an allowed Rules/Maps page), confirm audio keeps flowing throughout. Written up in `ROADMAP.md` the same way as Stage 1's loopback test — what was run, what was observed, what's still unverified (a real Maps VTT page needs a live campaign, same caveat Stage 1 already carries for two-identity verification).

## Testing & error handling

- `hotkeys.rs` (mute-toggle decision logic) and `allowlist.rs` (`is_allowed`) are pure functions, decision logic separated from I/O — unit-testable without a running Tauri app, matching the pattern used (and since reverted for unrelated reasons) in `egl_workaround.rs`.
- Hotkey registration failure: logged, app continues. Not fatal.
- `blocked_page.rs`: no runtime failure modes beyond what `homepage_redirect.rs` already has — poster asset is embedded at compile time via `include_bytes!`, can't fail at runtime.
- Manual-only verification: hotkeys actually firing (PTT, mute-toggle, overlay-toggle), navigation actually blocked/redirected for a disallowed URL, `target="_blank"` stripping observed via a real DDB link, the OAuth gap reproduced once to confirm it's real (not just theorized), audio surviving in-window navigation.

## Open questions carried into implementation

1. **OAuth allowlist gap** (above) — needs a live HAR capture of a real OAuth login to close.
2. **Ad-block domain list growth** — needs a live AdGuard capture on Maps VTT / Rules pages to responsibly extend beyond what's here.
3. Whether `target="_blank"` actually bypasses `on_new_window` in practice on this Tauri/WebKitGTK version, or whether the JS-side strip is defense-in-depth for a case that would've worked anyway — unconfirmed either way from documentation alone, will become clear during implementation testing.

---

## Amendments (2026-08-11)

Three corrections found while validating the design against the actual target platform and the `livekit` crate's mute semantics. Sections 2 (allowlist), 3 (ad-block) and 4 (audio continuity) above are unchanged.

### A. Global hotkeys are unreachable on the dev machine — two delivery paths, not one

The design assumed `tauri-plugin-global-shortcut` works everywhere and that a claimed shortcut surfaces as a registration error to log. Neither holds on this project's primary Linux dev target.

The dev machine runs **GNOME Shell 50.1 on Wayland** (`XDG_SESSION_TYPE=wayland`, `XDG_CURRENT_DESKTOP=ubuntu:GNOME`). The plugin sits on `global-hotkey`/`tao`, whose global-shortcut thread is X11-specific and is [deliberately disabled on Wayland](https://github.com/tauri-apps/tao/pull/543) to avoid a `libX11` segfault. So on Wayland registration **silently no-ops** — §1's "registration failure is logged and the app continues" never fires, because there is no failure to observe. The only real Wayland route is the XDG `GlobalShortcuts` portal, which is mature on KDE but [reported as a no-op on GNOME 50](https://github.com/aaddrick/claude-desktop-debian/blob/main/docs/learnings/wayland-global-shortcuts-portal.md) — exactly this machine. The portal route was considered and rejected for this stage: meaningful extra complexity (`ashpd`, an async portal session, a user-facing permission dialog) for a path that cannot be verified locally.

`hotkeys.rs` therefore becomes an abstraction over two independent delivery paths feeding one set of action handlers:

```text
hotkeys.rs
  ├─ actions: push_to_talk(bool) | toggle_mute() | toggle_overlay()   ← pure, unit-testable
  ├─ path 1: tauri-plugin-global-shortcut         → true global (Windows/macOS/X11; no-op on Wayland)
  └─ path 2: injected key handler in safety_net.rs → Tauri command → same actions
             (app-focused only, but works on every platform including Wayland)
```

Path 2 is a capture-phase `keydown`/`keyup` listener on `document`, matching `event.code` (`ControlRight`; `KeyM`/`KeyO` with ctrl+shift), calling `preventDefault()` and invoking a Tauri command. It lives in `safety_net.rs`'s script rather than the overlay bundle because it must work on DDB pages where the overlay isn't mounted — the same reasoning §1 already uses to keep shell concerns out of `overlay-ui`.

**This supersedes the architecture overview's "No new Tauri IPC commands."** Path 2 requires them. Muting still does not route through the overlay's `livekit_connect`/`livekit_disconnect` bridge; these are new shell-level commands invoked by injected script, and the overlay's only involvement remains receiving `overlay:toggle`.

Both paths must be idempotent — on Windows/X11 a single Right Ctrl press can fire both, and `push_to_talk(false)` twice must be harmless.

**Effect on the stage's "Done when".** *"PTT/mute work via hotkey without the overlay focused"* is satisfied on every platform via path 2 (DDB page focused, overlay not). Without the **app** focused it is satisfied on Windows/macOS/X11 only, and remains an open gap on Wayland. `ROADMAP.md` records that split rather than marking the bar unqualifiedly passed.

### B. Mute is a local capture gate, mirrored to the track — not track mute alone

§1 specifies holding the `LocalAudioTrack` and calling `mute()`/`unmute()`. Necessary, but insufficient for push-to-talk on its own: track mute is a signalling operation carrying a server round-trip, so the first ~100–200 ms after the key goes down is clipped — precisely when the user starts speaking.

- `rust-livekit` holds an `Arc<AtomicBool>` shared with the capture thread in `audio/capture.rs`. When set, the thread skips `capture_frame` entirely. Local, instant, no round-trip.
- The same setter **also** calls `LocalAudioTrack::mute()`/`unmute()`, so remote participants see accurate mute state — which Stage 3's speaking indicators depend on.

The public API is as §1 specified — `set_microphone_muted(bool)` / `is_microphone_muted()`. The atomic is the source of truth for whether audio actually flows; the track flag is advisory remote state.

### C. OAuth allowlist gap — decided: ship and fix forward

The gap documented in §2 is accepted as-specced rather than pre-empted. The allowlist is enforced strictly in this stage. Concretely: **completing an OAuth login on Linux may be impossible after this stage lands**, until the redirect chain is captured and allowlisted. Logged as a known issue in `ROADMAP.md`, closed by a live OAuth HAR capture as a fast-follow — evidence-gated, per open question 1.
