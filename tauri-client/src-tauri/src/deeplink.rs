//! `vtt-chat://connect?server=<enc>&code=<ABCD-2345>` — the join page's "Open the app" link. It only
//! *pre-fills* Settings (server address and, optionally, a connect code); it never signs in or
//! connects by itself, so a link from a stranger cannot do anything the user did not then confirm
//! (docs/architecture/JOIN-FLOW.md, APP-SIGN-IN.md).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::account::{normalise_link_code, normalise_server};

pub const SCHEME: &str = "vtt-chat";
pub const CONNECT_EVENT: &str = "deeplink:connect";

/// What a connect link carries: the server, and a link code in display form (`ABCD-2345`) if present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectLink {
    pub server: String,
    pub code: Option<String>,
}

/// A well-formed connect link to an http(s) server. A `code` that is present but malformed voids the
/// whole link.
pub fn connect_from_link(link: &str) -> Option<ConnectLink> {
    let url = url::Url::parse(link).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("connect") {
        return None;
    }
    let server = url.query_pairs().find(|(k, _)| k == "server")?.1;
    let server = normalise_server(&server).ok()?;
    let code = match url.query_pairs().find(|(k, _)| k == "code") {
        None => None,
        Some((_, raw)) => {
            let plain = normalise_link_code(&raw)?;
            Some(format!("{}-{}", &plain[..4], &plain[4..]))
        }
    };
    Some(ConnectLink { server, code })
}

/// A link that arrived before any window could take it (or while Settings was closed).
#[derive(Default)]
pub struct PendingConnect(Mutex<Option<ConnectLink>>);

/// Handles links the OS passed us (first launch, or a second launch forwarded to this instance):
/// remembers the link, opens Settings and tells it. Never signs in.
pub fn handle(app: &AppHandle, links: impl IntoIterator<Item = String>) {
    let Some(link) = links.into_iter().find_map(|l| connect_from_link(&l)) else {
        return;
    };
    *app.state::<PendingConnect>().0.lock().unwrap() = Some(link.clone());
    if let Err(err) = crate::windows::open(app, "settings") {
        eprintln!("[src-tauri] could not open settings for a connect link: {err}");
    }
    let _ = app.emit(CONNECT_EVENT, link);
}

/// Settings asks for the link that opened it (once).
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
