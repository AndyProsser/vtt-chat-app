use std::sync::Arc;

use rust_livekit::{ConnectionState, LiveKitClient, SharedClient};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveKitStatePayload {
    connected: bool,
    room_name: Option<String>,
    participant_identities: Vec<String>,
}

impl From<ConnectionState> for LiveKitStatePayload {
    fn from(state: ConnectionState) -> Self {
        Self {
            connected: state.connected,
            room_name: state.room_name,
            participant_identities: state.participant_identities,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeakersPayload {
    speaking_identities: Vec<String>,
}

#[tauri::command]
pub async fn livekit_connect(
    app: AppHandle,
    state: State<'_, SharedClient>,
    url: String,
    token: String,
) -> Result<(), String> {
    let emit_app = app.clone();
    let callback: rust_livekit::StateChangeCallback = Arc::new(move |connection_state| {
        let payload: LiveKitStatePayload = connection_state.into();
        let _ = emit_app.emit("livekit:state", payload);
    });

    let speakers_emit_app = app.clone();
    let speakers_callback: rust_livekit::SpeakersChangeCallback =
        Arc::new(move |speaking_identities| {
            let _ = speakers_emit_app.emit(
                crate::consts::SPEAKERS_STATE_EVENT,
                SpeakersPayload {
                    speaking_identities,
                },
            );
        });

    let client = LiveKitClient::connect(&url, &token, callback, speakers_callback)
        .await
        .map_err(|err| err.to_string())?;

    *state.lock().unwrap() = Some(client);
    Ok(())
}

#[tauri::command]
pub async fn livekit_disconnect(state: State<'_, SharedClient>) -> Result<(), String> {
    let client = state.lock().unwrap().take();
    if let Some(client) = client {
        client.disconnect().await.map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Delivery path 2 for hotkeys (Stage 2 spec, Amendment A): the key handler injected by
/// `safety_net.rs` calls this when it sees one of the bindings. Needed because the OS-level
/// global-shortcut plugin silently does nothing on Wayland.
///
/// This is the one place untrusted page script reaches the hotkey system, so the action name is
/// parsed against a closed set — an unrecognized name is an error, never a default.
#[tauri::command]
pub fn hotkey_action(app: AppHandle, action: String) -> Result<(), String> {
    let parsed = crate::hotkeys::HotkeyAction::from_name(&action)
        .ok_or_else(|| format!("unknown hotkey action: {action}"))?;
    crate::hotkeys::dispatch(&app, parsed);
    Ok(())
}

/// Delivery path for the overlay's mute button (Stage 3a spec §5) — shares
/// `hotkeys::apply_microphone_mute` with the hotkey path so a click and a keypress can't
/// leave the overlay showing stale mic state.
#[tauri::command]
pub fn set_microphone_muted(app: AppHandle, muted: bool) -> Result<(), String> {
    crate::hotkeys::apply_microphone_mute(&app, muted);
    Ok(())
}
