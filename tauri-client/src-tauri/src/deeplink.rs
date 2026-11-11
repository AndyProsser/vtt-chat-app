//! `vtt-chat://connect?server=<enc>&code=<long token | ABCD-2345>` — the join page's "Open the app" link. It only
//! *pre-fills* Settings (server address and, optionally, a connect code); it never signs in or
//! connects by itself, so a link from a stranger cannot do anything the user did not then confirm
//! (docs/architecture/JOIN-FLOW.md, APP-SIGN-IN.md).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::account::{normalise_link_code, normalise_server};

pub const SCHEME: &str = "vtt-chat";
pub const CONNECT_EVENT: &str = "deeplink:connect";

/// What a connect link carries: the server, and a one-time credential if present: either a short link
/// code in display form (`ABCD-2345`) or a long single-use token, unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectLink {
    pub server: String,
    pub code: Option<String>,
}

/// A long link token as the join page's deep link carries it (43 base64url characters today): only
/// `[A-Za-z0-9_-]`, 20–128 long, passed through unchanged (case matters, nothing is stripped).
fn long_link_token(raw: &str) -> Option<String> {
    let ok = (20..=128).contains(&raw.len())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    ok.then(|| raw.to_string())
}

/// A well-formed connect link to an http(s) server. A `code` that is present but is neither a short
/// code nor a long token voids the whole link.
pub fn connect_from_link(link: &str) -> Option<ConnectLink> {
    let url = url::Url::parse(link).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("connect") {
        return None;
    }
    let server = url.query_pairs().find(|(k, _)| k == "server")?.1;
    let server = normalise_server(&server).ok()?;
    let code = match url.query_pairs().find(|(k, _)| k == "code") {
        None => None,
        Some((_, raw)) => Some(match normalise_link_code(&raw) {
            Some(plain) => format!("{}-{}", &plain[..4], &plain[4..]),
            None => long_link_token(&raw)?,
        }),
    };
    Some(ConnectLink { server, code })
}

/// A link that arrived before the main window could take it (it asks for it once it has loaded).
#[derive(Default)]
pub struct PendingConnect(Mutex<Option<ConnectLink>>);

/// Handles links the OS passed us (first launch, or a second launch forwarded to this instance):
/// remembers the link, brings up the main window (sign-in lives there, not in a second window) and
/// tells it. The main window then connects with the code by itself when the app is signed out.
pub fn handle(app: &AppHandle, links: impl IntoIterator<Item = String>) {
    let Some(link) = links.into_iter().find_map(|l| connect_from_link(&l)) else {
        return;
    };
    *app.state::<PendingConnect>().0.lock().unwrap() = Some(link.clone());
    if let Err(err) = crate::windows::open_main(app) {
        eprintln!("[src-tauri] could not open the main window for a connect link: {err}");
    }
    let _ = app.emit(CONNECT_EVENT, link);
}

/// The main window asks for the link that opened it (once).
#[tauri::command]
pub fn take_pending_connect(app: AppHandle) -> Option<ConnectLink> {
    app.state::<PendingConnect>().0.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_connect_link_yields_a_normalised_server_and_optional_code() {
        let link = connect_from_link("vtt-chat://connect?server=https%3A%2F%2Fplay.example.com%2F")
            .unwrap();
        assert_eq!(link.server, "https://play.example.com");
        assert_eq!(link.code, None);
        let link = connect_from_link(
            "vtt-chat://connect?server=http%3A%2F%2F192.168.1.5%3A3000&code=abcd-2345",
        )
        .unwrap();
        assert_eq!(link.server, "http://192.168.1.5:3000");
        assert_eq!(link.code.as_deref(), Some("ABCD-2345"));
    }

    #[test]
    fn a_long_token_passes_through_unchanged() {
        let token = "Zm9vYmFyLV9iYXo0NTY3ODkwQUJDREVGR0hJSktMTU4";
        let link = connect_from_link(&format!(
            "vtt-chat://connect?server=https%3A%2F%2Fx.com&code={token}"
        ))
        .unwrap();
        assert_eq!(
            link.code.as_deref(),
            Some(token),
            "case and hyphens are kept"
        );
        let hyphenated = "abcd-efgh_IJKL-mnop-qrst";
        let link = connect_from_link(&format!(
            "vtt-chat://connect?server=https%3A%2F%2Fx.com&code={hyphenated}"
        ))
        .unwrap();
        assert_eq!(link.code.as_deref(), Some(hyphenated));
    }

    #[test]
    fn a_token_of_the_wrong_length_or_alphabet_voids_the_link() {
        let long = "a".repeat(129);
        let short = "a".repeat(19);
        for code in [
            long.as_str(),
            short.as_str(),
            "abcdefghijklmnopqrst%20u",
            "abcdefghijklmnopqrst.",
        ] {
            let link = format!("vtt-chat://connect?server=https%3A%2F%2Fx.com&code={code}");
            assert!(connect_from_link(&link).is_none(), "{code}");
        }
    }

    #[test]
    fn a_malformed_code_voids_the_whole_link() {
        for code in ["ABCD-234I", "ABC", "ABCD-23456", "", "ABCD-2345%00"] {
            let link = format!("vtt-chat://connect?server=https%3A%2F%2Fx.com&code={code}");
            assert!(connect_from_link(&link).is_none(), "{code}");
        }
    }

    #[test]
    fn anything_else_is_ignored() {
        for bad in [
            "https://connect?server=https%3A%2F%2Fx.com",
            "vtt-chat://other?server=https%3A%2F%2Fx.com",
            "vtt-chat://connect",
            "vtt-chat://connect?server=",
            "vtt-chat://connect?server=ftp%3A%2F%2Fx.com",
            "vtt-chat://connect?server=javascript%3Aalert(1)",
            "vtt-chat://connect?code=ABCD-2345",
            "not a url",
            "",
        ] {
            assert!(connect_from_link(bad).is_none(), "{bad}");
        }
    }
}
