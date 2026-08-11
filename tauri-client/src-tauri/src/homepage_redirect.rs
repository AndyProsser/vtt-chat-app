use tauri::Url;

use crate::blocked_page::{self, BlockedPage};

/// Native-level fallback for the WebKitGTK homepage crash (see safety_net.rs and
/// docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md) — the JS mitigation
/// alone was confirmed insufficient (the crash trigger turned out not to be the autoplaying
/// video, but a bug in NVIDIA's proprietary EGL driver — see
/// docs/WEBKITGTK-NVIDIA-EGL-CRASH.md), so `lib.rs` intercepts navigation to the bare DDB
/// homepage via `on_navigation` and sends the window here instead, before the crash-prone page
/// ever loads.
///
/// The page itself is built by `blocked_page.rs`, shared with the Stage 2 page-restriction
/// blocker — this module owns only the matching rule and this copy.
pub fn url() -> Url {
    blocked_page::url(&BlockedPage {
        title: "VTT Chat App",
        heading: "Natural 1.",
        message: "The D&D Beyond homepage doesn't play nicely with this app on Linux yet, \
                  so we've sent you here instead.",
        detail: None,
        link_url: "https://www.dndbeyond.com/characters",
        link_label: "Continue to your characters",
    })
}

/// Matches the bare DDB marketing homepage: `www.dndbeyond.com` at `/` or a bare two-letter
/// locale path (DDB redirects `/` to `/en`, `/fr`, etc.) — not `/characters`, `/games/...`, or
/// any other real app page, which should navigate normally.
pub fn is_ddb_homepage(url: &Url) -> bool {
    let is_ddb_host = matches!(
        url.host_str(),
        Some("www.dndbeyond.com") | Some("dndbeyond.com")
    );
    if !is_ddb_host {
        return false;
    }
    let path = url.path();
    path == "/"
        || (path.len() == 3
            && path.starts_with('/')
            && path[1..].bytes().all(|b| b.is_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(url: &str) -> Url {
        url.parse().expect("test URL is valid")
    }

    #[test]
    fn matches_bare_homepage_and_locale_paths() {
        assert!(is_ddb_homepage(&parse("https://www.dndbeyond.com/")));
        assert!(is_ddb_homepage(&parse("https://dndbeyond.com/")));
        assert!(is_ddb_homepage(&parse("https://www.dndbeyond.com/en")));
        assert!(is_ddb_homepage(&parse("https://www.dndbeyond.com/fr")));
    }

    #[test]
    fn does_not_match_real_app_pages() {
        assert!(!is_ddb_homepage(&parse(
            "https://www.dndbeyond.com/characters"
        )));
        assert!(!is_ddb_homepage(&parse(
            "https://www.dndbeyond.com/games/123"
        )));
        assert!(!is_ddb_homepage(&parse("https://www.dndbeyond.com/abc")));
    }

    #[test]
    fn does_not_match_other_hosts() {
        assert!(!is_ddb_homepage(&parse("https://www.wizards.com/")));
        assert!(!is_ddb_homepage(&parse("https://example.com/")));
    }
}
