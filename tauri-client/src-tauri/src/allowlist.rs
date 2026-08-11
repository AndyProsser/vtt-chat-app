use tauri::Url;

use crate::consts::ALLOWED_DOMAINS;

/// Page restriction (CLAUDE.md §8.1): only `*.dndbeyond.com/*` and `*.wizards.com/*` may load,
/// plus whatever `consts::ALLOWED_DOMAINS` lists. Everything else is cancelled and replaced
/// with the blocked page.
///
/// Deliberately not built on `homepage_redirect::is_ddb_homepage` — that matches an exact pair
/// of hosts for one specific page, whereas this is a wildcard-subdomain rule over a list.
pub fn is_allowed(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => match url.host_str() {
            Some(host) => ALLOWED_DOMAINS
                .iter()
                .any(|domain| host_matches(host, domain)),
            // A URL with no host can't be checked against the allowlist, so it can't be allowed.
            None => false,
        },
        // The blocked page and the homepage redirect are themselves `data:` URLs, so blocking
        // this scheme would make navigating *to* the blocked page trigger another block —
        // an infinite redirect. `about:` covers `about:blank` during window setup.
        //
        // The hole this leaves is narrow: a remote page can't perform a top-level navigation to
        // a `data:` URL (engines including WebKit forbid it), and a `data:` document is opaque —
        // no cookies, no DDB session access. Revisit if Stage 4's multi-window work gives pages
        // a new way to reach these schemes.
        "data" | "about" => true,
        // mailto:, tel:, file:, custom protocol handlers — none are browsable app pages.
        _ => false,
    }
}

/// Subdomain-inclusive host match. `dndbeyond.com` matches itself and `www.dndbeyond.com`, but
/// not `notdndbeyond.com` (no dot boundary) or `dndbeyond.com.evil.test` (wrong side).
fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str) -> bool {
        is_allowed(&url.parse().expect("test URL is valid"))
    }

    #[test]
    fn allows_listed_domains_and_their_subdomains() {
        assert!(allowed("https://www.dndbeyond.com/characters"));
        assert!(allowed("https://dndbeyond.com/"));
        assert!(allowed("https://media.dndbeyond.com/img.png"));
        assert!(allowed("https://www.dndbeyond.com/auth/login"));
        assert!(allowed("https://company.wizards.com/"));
        assert!(allowed("http://www.dndbeyond.com/characters"));
    }

    #[test]
    fn blocks_lookalike_hosts() {
        assert!(!allowed("https://notdndbeyond.com/"));
        assert!(!allowed("https://dndbeyond.com.evil.test/"));
        assert!(!allowed("https://evil.test/dndbeyond.com"));
        assert!(!allowed("https://wizards.com.evil.test/"));
    }

    #[test]
    fn blocks_unrelated_sites() {
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("https://discord.com/"));
    }

    #[test]
    fn allows_internal_schemes_so_the_blocked_page_can_render() {
        assert!(allowed("data:text/html;base64,PGgxPmhpPC9oMT4="));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn blocks_non_browsable_schemes() {
        assert!(!allowed("mailto:someone@example.com"));
        assert!(!allowed("tel:+61000000000"));
        assert!(!allowed("file:///etc/passwd"));
    }

    /// OAuth providers are *not* allowlisted in this stage — a known, deliberate gap that
    /// breaks OAuth login on Linux until the real redirect chain is captured. See the Stage 2
    /// spec, Amendment C. This test documents the current behaviour so that closing the gap
    /// is a visible, intentional change rather than a silent one.
    #[test]
    fn oauth_providers_are_currently_blocked() {
        assert!(!allowed("https://accounts.google.com/o/oauth2/auth"));
        assert!(!allowed("https://appleid.apple.com/auth/authorize"));
        assert!(!allowed("https://steamcommunity.com/openid/login"));
    }
}
