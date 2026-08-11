/// Mirrors `ddb/src/consts/index.ts`'s `DDB_COBALT_COOKIE_NAME` — duplicated here since Rust
/// is confined to `tauri-client/` and can't import the TS `ddb/` package (CLAUDE.md §3).
pub const DDB_COBALT_COOKIE_NAME: &str = "CobaltSession";
/// `/characters`, not the bare domain — the marketing homepage reliably segfaults WebKitGTK
/// on at least one Linux+NVIDIA dev setup (reproduced in Epiphany too, so it's a WebKitGTK
/// issue, not app code). Root cause was confirmed 2026-08-09 as a bug in NVIDIA's proprietary
/// EGL driver; there is **no viable in-app workaround** (the EGL-vendor switch that avoids the
/// crash drops rendering to ~0.2 FPS — see docs/WEBKITGTK-NVIDIA-EGL-CRASH.md), so this
/// constant and homepage_redirect.rs remain the actual mitigation. `/characters` does not
/// crash on affected hardware and is the page this app wants anyway.
/// `lib.rs`'s `on_navigation` hook also redirects away from the bare homepage natively, so
/// this constant isn't the only line of defense if a link ever points back there.
pub const DDB_URL: &str = "https://www.dndbeyond.com/characters";

pub const COBALT_COOKIE_POLL_INTERVAL_SECS: u64 = 3;

/// Page-restriction allowlist (CLAUDE.md §8.1) — each entry matches the domain itself and all
/// its subdomains. `dndbeyond.com` covers `*.dndbeyond.com/auth/*` too, so that isn't listed
/// separately.
///
/// A compile-time constant rather than a config file: there is no config/persistence layer
/// until Stage 5, and inventing one here would build it against an unknown future shape.
/// Adding a domain is a code change and a rebuild, which is acceptable while the allowed set
/// is this small and this static.
///
/// **Known gap:** OAuth providers (Google/Apple/Steam, and any Auth0 tenant in between) are not
/// listed, so OAuth login is blocked. Deliberate — see the Stage 2 spec, Amendment C. Closing
/// it needs a live HAR capture of a real OAuth login, not guessed domains.
pub const ALLOWED_DOMAINS: &[&str] = &["dndbeyond.com", "wizards.com"];

/// Tauri event names emitted to the overlay. Mirrored in `shared/src/consts/index.ts` — Rust
/// can't import the TS package (CLAUDE.md §3), same duplication rationale as the cookie name.
pub const OVERLAY_TOGGLE_EVENT: &str = "overlay:toggle";
pub const MICROPHONE_STATE_EVENT: &str = "livekit:microphone";
/// Mirrors `shared`'s `LIVEKIT_SPEAKERS_EVENT` — same duplication rationale as the two above.
pub const SPEAKERS_STATE_EVENT: &str = "livekit:speakers";
