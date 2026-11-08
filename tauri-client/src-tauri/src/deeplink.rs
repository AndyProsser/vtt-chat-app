//! `vtt-chat://connect?server=https%3A%2F%2Fhost` — the invite page's "Open the app" link. It only
//! *pre-fills the server address* in Settings; it never signs in or connects by itself, so a link
//! from a stranger cannot do anything the user did not then confirm (docs/architecture/JOIN-FLOW.md).

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::account::normalise_server;

pub const SCHEME: &str = "vtt-chat";
pub const SERVER_EVENT: &str = "deeplink:server";

/// The server a link points at, if it is a well-formed connect link to an http(s) server.
pub fn server_from_link(link: &str) -> Option<String> {
    let url = url::Url::parse(link).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("connect") {
        return None;
    }
    let server = url.query_pairs().find(|(k, _)| k == "server")?.1;
    normalise_server(&server).ok()
}

/// A link that arrived before any window could take it (or while Settings was closed).
#[derive(Default)]
pub struct PendingServer(Mutex<Option<String>>);

/// Handles links the OS passed us (first launch, or a second launch forwarded to this instance):
/// remembers the server, opens Settings and tells it.
pub fn handle(app: &AppHandle, links: impl IntoIterator<Item = String>) {
    let Some(server) = links.into_iter().find_map(|l| server_from_link(&l)) else {
        return;
    };
    *app.state::<PendingServer>().0.lock().unwrap() = Some(server.clone());
    if let Err(err) = crate::windows::open(app, "settings") {
        eprintln!("[src-tauri] could not open settings for a connect link: {err}");
    }
    let _ = app.emit(SERVER_EVENT, server);
}

/// Settings asks for the server a link supplied (once).
#[tauri::command]
pub fn take_pending_server(app: AppHandle) -> Option<String> {
    app.state::<PendingServer>().0.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_connect_link_yields_a_normalised_server() {
        assert_eq!(
            server_from_link("vtt-chat://connect?server=https%3A%2F%2Fplay.example.com%2F"),
            Some("https://play.example.com".into())
        );
        assert_eq!(
            server_from_link("vtt-chat://connect?server=http%3A%2F%2F192.168.1.5%3A3000"),
            Some("http://192.168.1.5:3000".into())
        );
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
            "not a url",
            "",
        ] {
            assert_eq!(server_from_link(bad), None, "{bad}");
        }
    }
}
