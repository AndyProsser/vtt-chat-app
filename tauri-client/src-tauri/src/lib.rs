mod account;
mod account_commands;
mod commands;
mod consts;
mod hotkeys;
mod mic_gate;
mod recording;
mod session;
mod shell;
mod tray;

/// The tray shell: no windows and no remote content. It holds the audio client and the signed-in
/// session as app-level state, registers the global shortcuts and installs the tray icon. Local
/// panel windows arrive next (ROADMAP Stage 4); audio and the consent flow never depend on them.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(rust_livekit::SharedClient::default())
        .manage(mic_gate::MicGate::default())
        .manage(session::SessionState::default())
        .manage(account_commands::AccountState::default())
        .manage(std::sync::Mutex::new(session::TrayModel::default()))
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::hotkey_action,
            commands::set_microphone_muted,
            account_commands::account_status,
            account_commands::account_sign_in,
            account_commands::account_select_campaign,
            account_commands::account_sign_out
        ])
        .setup(|app| {
            hotkeys::register_global_shortcuts(app.handle());
            if let Err(err) = tray::install(app.handle()) {
                // No tray (e.g. GNOME without the AppIndicator extension): say so, keep running.
                eprintln!("[src-tauri] could not create the tray icon: {err}");
            }
            account_commands::resume(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
