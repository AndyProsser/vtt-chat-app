# Stage 2: Shell Hardening — Hotkeys, Page Restriction, Ad-Block, Audio Continuity

**Stage:** [Stage 2](../../../ROADMAP.md#stage-2-audio-continuity-hotkeys-page-restriction-ad-block) — global hotkeys, page-restriction allowlist, ad-block extension, audio-continuity verification.
**Depends on:** Stage 1 (auth + voice end-to-end, done).

## Why one spec for four deliverables

Stage 2 bundles four items in `CLAUDE.md` §8.1. They aren't independent subsystems the way "chat + billing + analytics" would be — they're narrowly-scoped shell features sharing one theme (hardening the single-window WebView shell before Stage 3 builds real overlay UI on top of it), and three of the four touch the same `lib.rs` `setup()`/`on_navigation` closure. One spec, one plan.

## Architecture overview

```
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
