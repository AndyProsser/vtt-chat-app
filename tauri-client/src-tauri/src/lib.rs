mod account;
mod account_commands;
mod autostart;
mod bridge;
mod clipboard;
mod commands;
mod consts;
mod deeplink;
mod hotkeys;
mod mic_gate;
mod platform;
mod recording;
mod session;
mod shell;
mod soundboard;
pub mod supervisor;
mod tray;
mod updater;
mod windows;

/// Passed to the app when the OS starts it at login.
const AUTOSTART_FLAG: &str = "--hidden";

/// Registers the `vtt-chat://` scheme and listens for links (also one that launched us).
fn register_links(app: &mut tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        deeplink::handle(&handle, event.urls().iter().map(|u| u.to_string()));
    });
    // Installed builds register the scheme with their package; on Linux and in dev it is done here.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    if let Err(err) = app.deep_link().register_all() {
        eprintln!("[src-tauri] could not register the vtt-chat:// link: {err}");
    }
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        deeplink::handle(app.handle(), urls.iter().map(|u| u.to_string()));
    }
}

/// The tray shell: no windows and no remote content. It holds the audio client and the signed-in
/// session as app-level state, registers the global shortcuts and installs the tray icon. Local
/// panel windows arrive next (ROADMAP Stage 4); audio and the consent flow never depend on them.
pub fn run() {
    platform::apply_platform_fixes();
    tauri::Builder::default()
        // Must be first: a second launch (a click on a `vtt-chat://` link, or autostart racing a
        // manual start) hands its arguments to the running instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            deeplink::handle(app, args);
            let _ = windows::open_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(rust_livekit::SharedClient::default())
        .manage(mic_gate::MicGate::default())
        .manage(session::SessionState::default())
        .manage(account_commands::AccountState::default())
        .manage(bridge::PanelFeed::default())
        .manage(deeplink::PendingServer::default())
        .manage(updater::PendingUpdate::default())
        .manage(soundboard::Soundboard::default())
        .manage(std::sync::Mutex::new(session::TrayModel::default()))
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::voice_connect,
            commands::voice_effect_set,
            commands::voice_effect_get,
            commands::hotkey_action,
            commands::set_microphone_muted,
            commands::panel_hydrate,
            commands::sync_command,
            commands::chat_send,
            windows::panel_open,
            windows::window_ready,
            deeplink::take_pending_server,
            updater::update_check,
            updater::update_install,
            autostart::autostart_enabled,
            autostart::autostart_set,
            account_commands::account_status,
            account_commands::account_sign_in,
            account_commands::account_select_campaign,
            account_commands::account_add_campaign,
            account_commands::account_sign_out,
            account_commands::recording_control,
            account_commands::campaign_api,
            account_commands::handout_upload,
            clipboard::clipboard_picture,
            account_commands::campaign_file
        ])
        .setup(|app| {
            hotkeys::register_global_shortcuts(app.handle());
            if let Err(err) = tray::install(app.handle()) {
                // No tray (e.g. GNOME without the AppIndicator extension): say so, keep running.
                eprintln!("[src-tauri] could not create the tray icon: {err}");
            }
            account_commands::resume(app.handle());
            register_links(app);
            // Autostart launches with `--hidden`: just the tray, no window in the user's face.
            if !std::env::args().any(|a| a == AUTOSTART_FLAG) {
                if let Err(err) = windows::open_main(app.handle()) {
                    eprintln!("[src-tauri] could not open the main window: {err}");
                }
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
