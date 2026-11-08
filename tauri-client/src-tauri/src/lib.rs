mod account;
mod account_commands;
mod bridge;
mod commands;
mod consts;
mod hotkeys;
mod mic_gate;
mod platform;
mod recording;
mod session;
mod shell;
mod soundboard;
mod tray;
mod windows;

/// The tray shell: no windows and no remote content. It holds the audio client and the signed-in
/// session as app-level state, registers the global shortcuts and installs the tray icon. Local
/// panel windows arrive next (ROADMAP Stage 4); audio and the consent flow never depend on them.
pub fn run() {
    platform::apply_platform_fixes();
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(rust_livekit::SharedClient::default())
        .manage(mic_gate::MicGate::default())
        .manage(session::SessionState::default())
        .manage(account_commands::AccountState::default())
        .manage(bridge::PanelFeed::default())
        .manage(soundboard::Soundboard::default())
        .manage(std::sync::Mutex::new(session::TrayModel::default()))
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::voice_connect,
            commands::hotkey_action,
            commands::set_microphone_muted,
            commands::panel_hydrate,
            commands::sync_command,
            commands::chat_send,
            windows::panel_open,
            windows::window_ready,
            account_commands::account_status,
            account_commands::account_sign_in,
            account_commands::account_select_campaign,
            account_commands::account_sign_out,
            account_commands::recording_control,
            account_commands::campaign_api,
            account_commands::campaign_file
        ])
        .setup(|app| {
            hotkeys::register_global_shortcuts(app.handle());
            if let Err(err) = tray::install(app.handle()) {
                // No tray (e.g. GNOME without the AppIndicator extension): say so, keep running.
                eprintln!("[src-tauri] could not create the tray icon: {err}");
            }
            account_commands::resume(app.handle());
            if let Err(err) = windows::open_main(app.handle()) {
                eprintln!("[src-tauri] could not open the main window: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Closing the last panel must not quit: the app lives in the tray. Only an explicit
            // `exit(code)` (the tray's Quit) ends it.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
