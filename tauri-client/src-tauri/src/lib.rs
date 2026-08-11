mod allowlist;
mod blocked_page;
mod cobalt;
mod commands;
mod consts;
mod homepage_redirect;
mod hotkeys;
mod safety_net;

use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// The page shown when the allowlist cancels a navigation. Echoes the blocked URL back so a
/// blocked click isn't a silent dead end (escaped by `blocked_page`, which treats it as
/// untrusted).
fn blocked_navigation_url(blocked: &Url) -> Url {
    blocked_page::url(&blocked_page::BlockedPage {
        title: "Blocked — VTT Chat App",
        heading: "Out of bounds.",
        message: "VTT Chat App only browses D&D Beyond and Wizards of the Coast. \
                  That link points somewhere else, so it wasn't opened.",
        detail: Some(blocked.as_str().to_string()),
        link_url: consts::DDB_URL,
        link_label: "Back to your characters",
    })
}

/// Reads the built `overlay-ui` bundle at runtime (not `include_str!`) so `src-tauri` can be
/// compiled before `overlay-ui` has a `dist/` output — see Stage 1 build-order notes in
/// docs/architecture/OVERVIEW.md. Stage 5's real packaging will need Tauri's resource/asset
/// resolution instead of a manifest-relative dev path.
fn load_overlay_script() -> Option<String> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = std::path::Path::new(manifest_dir).join("../overlay-ui/dist/overlay.js");
    match std::fs::read_to_string(&path) {
        Ok(script) => Some(script),
        Err(err) => {
            eprintln!(
                "[src-tauri] overlay bundle not found at {path:?} ({err}); starting without it"
            );
            None
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(rust_livekit::SharedClient::default())
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::hotkey_action
        ])
        .setup(|app| {
            let nav_handle = app.handle().clone();
            let new_window_handle = app.handle().clone();
            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(consts::DDB_URL.parse()?),
            )
            .title("VTT Chat App")
            .inner_size(1280.0, 800.0)
            .initialization_script(safety_net::SCRIPT)
            .on_navigation(move |url| {
                // Crash avoidance runs first: the DDB homepage is an *allowed* domain, so the
                // allowlist below would happily let it through into the WebKitGTK segfault.
                if homepage_redirect::is_ddb_homepage(url) {
                    if let Some(main_window) = nav_handle.get_webview_window("main") {
                        let _ = main_window.navigate(homepage_redirect::url());
                    }
                    return false;
                }

                if !allowlist::is_allowed(url) {
                    eprintln!("[src-tauri] blocked navigation to {url}");
                    if let Some(main_window) = nav_handle.get_webview_window("main") {
                        let _ = main_window.navigate(blocked_navigation_url(url));
                    }
                    return false;
                }

                true
            })
            // `window.open()` must never spawn an OS window here — real multi-window is Stage 4.
            // Both allowed and blocked targets are redirected into the existing main window, so
            // they converge on the same allowlist decision as any ordinary navigation.
            .on_new_window(move |url, _features| {
                if let Some(main_window) = new_window_handle.get_webview_window("main") {
                    let target = if allowlist::is_allowed(&url) {
                        url
                    } else {
                        eprintln!("[src-tauri] blocked new-window request to {url}");
                        blocked_navigation_url(&url)
                    };
                    let _ = main_window.navigate(target);
                }
                tauri::webview::NewWindowResponse::Deny
            });

            if let Some(overlay_script) = load_overlay_script() {
                builder = builder.initialization_script(&overlay_script);
            }

            builder.build()?;

            hotkeys::register_global_shortcuts(app.handle());
            cobalt::spawn_cobalt_cookie_watcher(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
