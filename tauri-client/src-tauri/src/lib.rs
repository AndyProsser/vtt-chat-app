mod cobalt;
mod commands;
mod consts;
mod homepage_redirect;
mod safety_net;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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
        .manage(rust_livekit::SharedClient::default())
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(consts::DDB_URL.parse()?),
            )
            .title("VTT Chat App")
            .inner_size(1280.0, 800.0)
            .initialization_script(safety_net::SCRIPT)
            .on_navigation(move |url| {
                if homepage_redirect::is_ddb_homepage(url) {
                    if let Some(main_window) = app_handle.get_webview_window("main") {
                        let _ = main_window.navigate(homepage_redirect::url());
                    }
                    return false;
                }
                true
            });

            if let Some(overlay_script) = load_overlay_script() {
                builder = builder.initialization_script(&overlay_script);
            }

            builder.build()?;

            cobalt::spawn_cobalt_cookie_watcher(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
