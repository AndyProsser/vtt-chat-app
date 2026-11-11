mod account;
mod account_commands;
mod attention;
mod audio_prefs;
mod autostart;
mod away_watch;
mod bridge;
mod clipboard;
mod commands;
mod consts;
mod deeplink;
mod hotkeys;
mod main_layout;
mod mic_gate;
mod notify_prefs;
mod platform;
mod recording;
mod session;
mod shell;
mod soundboard;
mod status;
mod status_commands;
pub mod supervisor;
mod tray;
mod updater;
mod version_check;
mod windows;

/// What the window-state plugin remembers for the main window. On Linux it remembers nothing about size,
/// position or maximised state: Wayland ignores a program's requests for a position, the saved size grew by
/// the title bar on each reopen, and a remembered "maximised" put the narrow chat column full screen. There the
/// window always opens at the default from `main_layout`.
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    #[cfg(target_os = "linux")]
    {
        StateFlags::all()
            - StateFlags::SIZE
            - StateFlags::POSITION
            - StateFlags::MAXIMIZED
            - StateFlags::FULLSCREEN
    }
    #[cfg(not(target_os = "linux"))]
    {
        StateFlags::all()
    }
}

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            // The main window remembers where it was. The occasional panels do not: a remembered
            // position can be on a monitor that is gone or span two, so they always open centred
            // over the main window instead (windows.rs).
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .with_denylist(&[
                    "panel-settings",
                    "panel-handouts",
                    "panel-handout",
                    "panel-history",
                    "panel-inventory",
                ])
                .build(),
        )
        .manage(rust_livekit::SharedClient::default())
        .manage(mic_gate::MicGate::default())
        .manage(status_commands::StatusState::default())
        .manage(attention::Unread::default())
        .manage(attention::LastNotified::default())
        .manage(attention::SelfId::default())
        .manage(session::SessionState::default())
        .manage(account_commands::AccountState::default())
        .manage(bridge::PanelFeed::default())
        .manage(deeplink::PendingConnect::default())
        .manage(updater::PendingUpdate::default())
        .manage(soundboard::Soundboard::default())
        .manage(std::sync::Mutex::new(session::TrayModel::default()))
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::voice_connect,
            commands::livekit_snapshot,
            commands::voice_effect_set,
            commands::voice_effect_get,
            commands::hotkey_action,
            commands::set_microphone_muted,
            commands::panel_hydrate,
            commands::sync_command,
            commands::chat_send,
            windows::panel_open,
            windows::handout_view_open,
            windows::window_ready,
            deeplink::take_pending_connect,
            updater::update_check,
            version_check::server_version_check,
            updater::update_install,
            updater::update_dev_builds_get,
            updater::update_dev_builds_set,
            autostart::autostart_enabled,
            autostart::autostart_set,
            account_commands::account_status,
            account_commands::account_sign_in,
            account_commands::account_select_campaign,
            account_commands::account_add_campaign,
            account_commands::account_rename,
            commands::audio_engine,
            commands::audio_engine_set,
            commands::mic_gain_set,
            commands::auto_gain_set,
            commands::noise_filter_set,
            commands::mic_level,
            status_commands::status_get,
            status_commands::status_set,
            away_watch::away_minutes_get,
            away_watch::away_minutes_set,
            notify_prefs::notify_prefs_get,
            notify_prefs::notify_prefs_set,
            commands::player_volume_set,
            account_commands::auth_providers,
            account_commands::account_open_sso,
            account_commands::account_open_connect,
            account_commands::account_open_home,
            account_commands::account_request_code,
            account_commands::account_sign_in_code,
            account_commands::account_connect_with_code,
            account_commands::account_device_start,
            account_commands::account_device_poll,
            account_commands::dev_signin_enabled,
            account_commands::ddb_api,
            account_commands::records_search,
            account_commands::account_set_avatar,
            account_commands::avatar_upload,
            account_commands::avatar_image,
            commands::audio_devices,
            commands::audio_device_choose,
            account_commands::account_sign_out,
            account_commands::recording_control,
            account_commands::campaign_api,
            account_commands::handout_upload,
            account_commands::handout_add_image,
            clipboard::clipboard_picture,
            soundboard::soundboard_monitor_set,
            soundboard::soundboard_levels_set,
            account_commands::campaign_file
        ])
        .setup(|app| {
            hotkeys::register_global_shortcuts(app.handle());
            if let Err(err) = tray::install(app.handle()) {
                // No tray (e.g. GNOME without the AppIndicator extension): say so, keep running.
                eprintln!("[src-tauri] could not create the tray icon: {err}");
            }
            away_watch::start(app.handle());
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
        .on_window_event(|window, event| {
            // Looking at the main window again clears the tray's unread dot.
            if window.label() == windows::MAIN_LABEL {
                if let tauri::WindowEvent::Focused(true) = event {
                    attention::clear(tauri::Manager::app_handle(window));
                }
            }
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
