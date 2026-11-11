//! Client updates. The app checks the server it is signed in to (`<server>/updates/latest.json`,
//! served from the operator's `UPDATES_DIR`) and installs a newer build **only when the player
//! clicks** — never mid-session on its own, because a restart drops them out of the room.
//!
//! What makes an update trustworthy is the **signature**, checked against the public key in
//! `tauri.conf.json`; the server and the transport are not trusted. That is why plain `http://` LAN
//! servers are allowed here (`dangerousInsecureTransportProtocol`): a forged update fails the
//! signature check. See docs/architecture/CLIENT-UPDATES.md.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::account_commands::AccountState;
use crate::supervisor::{CHILD_ENV, RESTART_EXIT_CODE};

/// Where a server publishes its client updates. Everyone reads the release feed; a player who opted in
/// to dev builds reads the dev feed, which the server keeps at the newer of the latest dev build and the
/// latest release (so they still move up to a release when one lands).
pub fn update_endpoint(server: &str, dev_builds: bool) -> String {
    let feed = if dev_builds {
        "dev/latest.json"
    } else {
        "latest.json"
    };
    format!("{}/updates/{feed}", server.trim_end_matches('/'))
}

/// Which updates this player wants. Releases only, unless they opt in to dev builds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePrefs {
    pub include_dev_builds: bool,
}

const PREFS_FILE: &str = "updates.json";

impl UpdatePrefs {
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(PREFS_FILE))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(
            dir.join(PREFS_FILE),
            serde_json::to_string_pretty(self).map_err(std::io::Error::other)?,
        )
    }
}

fn dev_builds_wanted(app: &AppHandle) -> bool {
    crate::account::data_dir(app)
        .map(|dir| UpdatePrefs::load(&dir).include_dev_builds)
        .unwrap_or(false)
}

#[tauri::command]
pub fn update_dev_builds_get(app: AppHandle) -> bool {
    dev_builds_wanted(&app)
}

#[tauri::command]
pub fn update_dev_builds_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    UpdatePrefs {
        include_dev_builds: enabled,
    }
    .save(&dir)
    .map_err(|e| e.to_string())
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

fn build_updater(
    app: &AppHandle,
    server: &str,
    dev_builds: bool,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint =
        url::Url::parse(&update_endpoint(server, dev_builds)).map_err(|e| e.to_string())?;
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
    let dev_builds = dev_builds_wanted(&app);
    eprintln!(
        "[updater] checking {}",
        update_endpoint(&server, dev_builds)
    );
    let update = build_updater(&app, &server, dev_builds)?
        .check()
        .await
        .map_err(|e| {
            eprintln!("[updater] check failed: {e}");
            e.to_string()
        })?;
    match &update {
        Some(u) => eprintln!(
            "[updater] {} is available (running {})",
            u.version, u.current_version
        ),
        None => eprintln!("[updater] up to date"),
    }
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
            update_endpoint("https://play.example.com", false),
            "https://play.example.com/updates/latest.json"
        );
        assert_eq!(
            update_endpoint("http://192.168.1.5:3000/", false),
            "http://192.168.1.5:3000/updates/latest.json"
        );
        assert_eq!(
            update_endpoint("https://example.com/vtt", false),
            "https://example.com/vtt/updates/latest.json"
        );
    }

    #[test]
    fn dev_builds_are_read_from_their_own_feed() {
        assert_eq!(
            update_endpoint("https://play.example.com/", true),
            "https://play.example.com/updates/dev/latest.json"
        );
    }

    #[test]
    fn players_get_releases_only_until_they_opt_in() {
        let dir = std::env::temp_dir().join(format!("vtt-upd-{}", std::process::id()));
        assert!(!UpdatePrefs::load(&dir).include_dev_builds);
        UpdatePrefs {
            include_dev_builds: true,
        }
        .save(&dir)
        .unwrap();
        assert!(UpdatePrefs::load(&dir).include_dev_builds);
        std::fs::remove_dir_all(&dir).ok();
    }
}
