# Tracker-Blocking + Autoplay-Video Safety Net (Minimal, Pre-Stage-2)

**Date:** 2026-08-08
**Status:** Approved
**Stage:** Stage 1 follow-up — defense-in-depth for the WebKitGTK homepage-video crash documented in [ROADMAP.md](../../../ROADMAP.md#stage-1--walking-skeleton-auth--voice-end-to-end) and [DDB-AUTH.md](../../architecture/DDB-AUTH.md); not Stage 2's full ad-blocker.

## Problem

`consts::DDB_URL` already avoids the marketing homepage (points at `/characters`) to sidestep a confirmed WebKitGTK segfault triggered by the homepage's autoplaying `<video class="SiteWide_backgroundVideo">` hero banners. But Stage 2's page-restriction allowlist (`*.dndbeyond.com/*`) will let the app navigate anywhere on the domain, including back to `/` via any logo/home link — so the crash risk returns the moment general browsing is allowed. Separately, live AdGuard captures on real DDB pages show a consistent set of third-party trackers loading on every page, and more on the homepage specifically.

## Goals

- Stop the specific `<video class="SiteWide_backgroundVideo">` elements from ever loading, on any page, so the WebKitGTK crash can't recur regardless of what page the app lands on later.
- Block the AdGuard-confirmed tracker domains as a minimal, real (not guessed) start on CLAUDE.md §8.1's ad-blocking requirement.
- Apply on all platforms (Windows/macOS don't crash on the video, but blocking trackers and an autoplaying background video has no downside there either).

## Non-goals

- Real Stage 2 ad-blocking: no network-level request interception (WebKitGTK content filters, WebView2 resource-request filters, WKWebView content rule lists). That needs platform-specific native code per backend and is a separate, larger build.
- Page-restriction allowlisting — also Stage 2, unrelated to this change.
- A static-image substitute for the removed video — DDB's markup has no `poster` attribute to use, and the surrounding `SiteWide_gradientWrapper` div already provides a designed gradient background once the video is gone.
- A curated/comprehensive ad-tech blocklist. This blocks exactly the domains observed via live AdGuard traces (see below) — not a guessed list of common ad networks.

## Design

Both pieces are plain JS, injected via the same `initialization_script` mechanism `tauri-client/src-tauri/src/lib.rs` already uses for the overlay bundle — added as a second `initialization_script` call, not merged into the overlay bundle itself (keeps `overlay-ui` free of concerns unrelated to the DDB Maps overlay). Runs at document-start on every navigation, before the page's own scripts execute, on all platforms.

### 1. Tracker blocking

Domains, confirmed via live AdGuard filtering-log captures on a character-sheet page and the homepage (not guessed):

- `googletagmanager.com` — Google Tag Manager
- `gsght.com` — third-party SDK
- `datadoghq-browser-agent.com` — Datadog RUM
- `ketchcdn.com` — consent-management/analytics beacon
- `optimizely.com` — A/B testing (homepage)
- `hotjar.com` — session-recording/heatmaps (homepage)

Mechanism: override `window.fetch`, `XMLHttpRequest.prototype.open`, and the `.src` property setter on `HTMLScriptElement`/`HTMLImageElement`/`HTMLIFrameElement` prototypes; reject/no-op when the target URL's hostname equals or ends with (subdomain-inclusive) one of the six domains above — e.g. `www.googletagmanager.com` and `static.hotjar.com` both match. This is the same pattern already prototyped once during the Akamai investigation (and reverted there only because it was the wrong fix for that specific problem, not because the mechanism itself failed) — known limitation: it can't catch a resource whose `src` attribute is set directly by the HTML parser from server-rendered markup (attribute-parse path, not the JS property setter), only ones a script sets via `.src =` or fetch/XHR. All six domains above are loaded via classic analytics `<script>`-injection snippets (property-setter path), so this is expected to be sufficient for this specific list.

### 2. Video neutralization

A `MutationObserver` on `document.documentElement` (`subtree: true, childList: true`) watches for any inserted `<video class="SiteWide_backgroundVideo">` element. On match: remove its `<source>` children, clear `src`, call `.load()` to abort any in-flight fetch. Scoped tightly by that exact class name so it can't affect a real gameplay-relevant video if one ever appears elsewhere in DDB's markup.

This exists specifically because the tracker-blocking mechanism above can't reliably catch it — DDB's `<source src="...">` elements are set by the HTML parser from static server-rendered markup, not by a script property setter. A `MutationObserver` fires as elements are inserted into the DOM regardless of how their attributes were set, which is why it's the right tool for this one case instead of extending mechanism 1 to cover it.

## Root Cause, Revised After Testing

Live-testing the JS mitigation against the real homepage (`consts::DDB_URL` temporarily pointed at `/`) showed the video-stripping worked exactly as designed — zero requests to any `cdn.media.amplience.net/v/...` video path — **and the app still segfaulted anyway.** So the autoplaying background video was not the sole (and possibly not even the real) cause. The crash consistently happens during a burst of dozens of concurrent thumbnail image requests from the same CDN (`/i/wizardsprod/...`); a plain image-heavy page (Wikipedia's Dragon article, tested earlier in the original investigation) doesn't crash under similar concurrency, so the leading open theory is an image-codec decode issue (e.g. AVIF/WebP, since DDB's CDN does `fmt=auto` content negotiation) rather than anything JS-blockable. Root cause remains unconfirmed — this is now a documented gap, not a solved mystery.

## Implemented: Navigation-Level Redirect

Because the JS mitigation alone was proven insufficient, the contingency was built: `tauri-client/src-tauri/src/homepage_redirect.rs`'s `is_ddb_homepage()` matches navigation to `www.dndbeyond.com`/`dndbeyond.com` at `/` or a bare two-letter locale path (DDB redirects `/` → `/en`, etc.) — not `/characters`, `/games/...`, or any other real page. `lib.rs`'s `on_navigation` hook on the main window intercepts a match, cancels it (`return false`), and calls `.navigate()` to send the window to a self-contained `data:` URL page instead (`homepage_redirect::url()`) — HTML + a bundled poster image (`src-tauri/assets/homepage-redirect-poster.png`, base64-embedded via `include_bytes!`, no new asset-serving pipeline) with a link onward to `/characters`. Because this runs at `on_navigation` (native, pre-load), the crash-prone page never loads at all — confirmed via network log: zero requests to `www.dndbeyond.com` or its CDN when the redirect fires.

The `base64` crate was added as a dependency for this (encoding the bundled PNG and the final HTML into `data:` URLs) — the only new dependency this change introduces.

## Testing (as performed)

- `cargo build --bin vtt-chat-app`, `cargo fmt --check`, `cargo clippy` — all clean.
- Manual: `consts::DDB_URL` temporarily pointed at the bare homepage — confirmed via `G_MESSAGES_DEBUG=all` network log that zero requests reach `www.dndbeyond.com` or its CDN, and the process runs the full test duration with no crash (redirected to the local fallback page instead). URL reverted to `/characters` after.
- Manual: `/characters` still loads and runs cleanly for the full test duration — no regression from the added `initialization_script` or `on_navigation` hook.
