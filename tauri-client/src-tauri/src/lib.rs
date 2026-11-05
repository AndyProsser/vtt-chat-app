mod commands;
mod consts;
mod hotkeys;

/// Stage 1 shell: no windows, no remote content. It holds the audio client as app-level state and
/// registers the global shortcuts. The tray icon and the local panel windows arrive in Stage 4
/// (see ROADMAP.md); until then there is nothing to navigate, so there is nothing to restrict.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(rust_livekit::SharedClient::default())
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::hotkey_action,
            commands::set_microphone_muted
        ])
        .setup(|app| {
            hotkeys::register_global_shortcuts(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
