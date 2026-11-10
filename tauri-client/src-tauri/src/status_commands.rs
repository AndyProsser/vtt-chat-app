//! Carries out status changes (see `status.rs` for the rules): joins or leaves voice, closes or opens the
//! microphone, tells the panels and the tray, and (later) the other players.

use std::sync::Mutex;

use rust_livekit::SharedClient;
use tauri::{AppHandle, Emitter, Manager};

use crate::mic_gate::MicGate;
use crate::status::{Context, Effect, Status, StatusModel};

/// Panels listen to this for the current status (`"online" | "away" | "offline"`).
pub const STATUS_EVENT: &str = "status:changed";
/// The player pressed unmute (hotkey) while not in voice: the main window should offer to join.
pub const OFFER_CONNECT_EVENT: &str = "status:offer-connect";

#[derive(Default)]
pub struct StatusState(pub Mutex<StatusModel>);

fn context(app: &AppHandle) -> Context {
    Context {
        user_muted: app.state::<MicGate>().user_muted(),
        in_voice: app.state::<SharedClient>().lock().unwrap().is_some(),
    }
}

pub fn current(app: &AppHandle) -> Status {
    app.state::<StatusState>().0.lock().unwrap().status()
}

fn announce(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, current(app));
    crate::tray::refresh_menu(app);
    // Everyone at the table sees the status, so tell the server too.
    crate::session::announce_voice_state(app, None);
}

/// Changes status and makes voice and the microphone follow. `automatic` marks an Away chosen by the
/// idle timer or the screen lock. A failed voice join puts the status back to Offline.
pub async fn apply_status(app: &AppHandle, target: Status, automatic: bool) -> Result<(), String> {
    let effects = {
        let ctx = context(app);
        app.state::<StatusState>()
            .0
            .lock()
            .unwrap()
            .set(target, ctx, automatic)
    };
    announce(app);
    run(app, effects).await
}

async fn run(app: &AppHandle, effects: Vec<Effect>) -> Result<(), String> {
    for effect in effects {
        let result = match effect {
            Effect::ConnectVoice => crate::commands::voice_connect(app.clone(), app.state()).await,
            Effect::DisconnectVoice => {
                crate::commands::livekit_disconnect(app.clone(), app.state()).await
            }
            Effect::SetMuted(muted) => {
                crate::hotkeys::apply_microphone_mute(app, muted);
                Ok(())
            }
        };
        if let Err(err) = result {
            if effect == Effect::ConnectVoice {
                // Could not join: do not claim to be online.
                *app.state::<StatusState>().0.lock().unwrap() = StatusModel::default();
                announce(app);
            }
            return Err(err);
        }
    }
    Ok(())
}

/// Called whenever the player unmutes. While Away that is "I'm back": the status turns Online.
pub fn on_unmute(app: &AppHandle) {
    let changed = app
        .state::<StatusState>()
        .0
        .lock()
        .unwrap()
        .unmute()
        .is_some();
    if changed {
        announce(app);
    }
}

/// Idle ended or the screen unlocked: an automatic Away ends by itself.
pub async fn on_activity(app: &AppHandle) {
    let effects = {
        let ctx = context(app);
        app.state::<StatusState>().0.lock().unwrap().activity(ctx)
    };
    if !effects.is_empty() {
        announce(app);
        let _ = run(app, effects).await;
    }
}

/// Signed out or session ended: voice is already gone, so the status is simply Offline again.
pub fn reset(app: &AppHandle) {
    *app.state::<StatusState>().0.lock().unwrap() = StatusModel::default();
    announce(app);
}

#[tauri::command]
pub fn status_get(app: AppHandle) -> Status {
    current(&app)
}

#[tauri::command]
pub async fn status_set(app: AppHandle, status: Status) -> Result<(), String> {
    apply_status(&app, status, false).await
}

/// The tray's status items: runs on the async runtime because joining voice is a network call.
pub fn apply_from_menu(app: &AppHandle, status: Status) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = apply_status(&app, status, false).await {
            eprintln!("[src-tauri] status change failed: {err}");
            let _ = app.emit(
                crate::account_commands::ACCOUNT_ERROR_EVENT,
                serde_json::json!({"code":"voice","message":err}),
            );
        }
    });
}
