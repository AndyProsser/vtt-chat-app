//! Client updates. The app checks the server it is signed in to (`<server>/updates/latest.json`,
//! served from the operator's `UPDATES_DIR`) and installs a newer build **only when the player
//! clicks** — never mid-session on its own, because a restart drops them out of the room.
//!
//! What makes an update trustworthy is the **signature**, checked against the public key in
//! `tauri.conf.json`; the server and the transport are not trusted. That is why plain `http://` LAN
//! servers are allowed here (`dangerousInsecureTransportProtocol`): a forged update fails the
//! signature check. See docs/architecture/CLIENT-UPDATES.md.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::account_commands::AccountState;
use crate::supervisor::{CHILD_ENV, RESTART_EXIT_CODE};

/// Where a server publishes its client updates.
pub fn update_endpoint(server: &str) -> String {
    format!("{}/updates/latest.json", server.trim_end_matches('/'))
}

/// An update found by [`update_check`], waiting for the player to accept it.
#[derive(Default)]
pub struct PendingUpdate(tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub current: String,
}

fn build_updater(app: &AppHandle, server: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = url::Url::parse(&update_endpoint(server)).map_err(|e| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// Asks the server whether a newer build exists. `Ok(None)` means up to date (or the server offers
/// no updates).
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    accounts: State<'_, AccountState>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let server = accounts
        .server()
        .await
        .ok_or("sign in to a server first: updates come from it")?;
    let update = build_updater(&app, &server)?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
        current: u.current_version.clone(),
    });
    *pending.0.lock().await = update;
    Ok(info)
}

/// Downloads, verifies the signature of, and installs the update found by [`update_check`], then
/// restarts the app.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .await
        .take()
        .ok_or("there is no update waiting; check for updates first")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    restart_after_update(&app);
    Ok(())
}

/// Under the crash-recovery supervisor the app must exit with the restart code (a plain restart
/// would start an unsupervised copy); standalone, restart normally.
fn restart_after_update(app: &AppHandle) {
    if std::env::var_os(CHILD_ENV).is_some() {
        app.exit(RESTART_EXIT_CODE);
    } else {
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_endpoint_is_under_the_server_whatever_its_trailing_slash_or_path() {
        assert_eq!(
            update_endpoint("https://play.example.com"),
            "https://play.example.com/updates/latest.json"
        );
        assert_eq!(
            update_endpoint("http://192.168.1.5:3000/"),
            "http://192.168.1.5:3000/updates/latest.json"
        );
        assert_eq!(
            update_endpoint("https://example.com/vtt"),
            "https://example.com/vtt/updates/latest.json"
        );
    }
}
