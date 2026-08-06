use tauri::{AppHandle, Emitter, Manager};

use crate::consts::{COBALT_COOKIE_POLL_INTERVAL_SECS, DDB_COBALT_COOKIE_NAME, DDB_URL};

/// Polls the "main" window's cookie jar for the `CobaltSession` cookie and emits it to the
/// webview whenever it appears or changes. Runs on a background async task, not the UI thread —
/// `cookies_for_url` has a documented Windows deadlock risk if called on the main thread
/// (see docs/architecture/DDB-AUTH.md).
pub fn spawn_cobalt_cookie_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_seen: Option<String> = None;
        let url: tauri::Url = DDB_URL.parse().expect("DDB_URL must be a valid URL");

        loop {
            if let Some(window) = app.get_webview_window("main") {
                match window.cookies_for_url(url.clone()) {
                    Ok(cookies) => {
                        if let Some(cookie) = cookies
                            .iter()
                            .find(|cookie| cookie.name() == DDB_COBALT_COOKIE_NAME)
                        {
                            let value = cookie.value().to_string();
                            if last_seen.as_deref() != Some(value.as_str()) {
                                last_seen = Some(value.clone());
                                let _ = window.emit(
                                    "ddb:cobalt-cookie",
                                    serde_json::json!({ "cookieValue": value }),
                                );
                            }
                        }
                    }
                    Err(err) => eprintln!("[src-tauri] cookies_for_url failed: {err}"),
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(
                COBALT_COOKIE_POLL_INTERVAL_SECS,
            ))
            .await;
        }
    });
}
