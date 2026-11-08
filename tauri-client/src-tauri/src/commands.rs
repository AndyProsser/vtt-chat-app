use std::sync::Arc;

use rust_livekit::{ConnectionState, LiveKitClient, SharedClient};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::mic_gate::MicGate;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveKitStatePayload {
    connected: bool,
    room_name: Option<String>,
    participant_identities: Vec<String>,
}

impl LiveKitStatePayload {
    /// What panels see after the player leaves voice on purpose (the client is gone, so it cannot
    /// report its own disconnect).
    fn left_voice() -> Self {
        Self {
            connected: false,
            room_name: None,
            participant_identities: Vec::new(),
        }
    }
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
pub async fn livekit_connect(app: AppHandle, url: String, token: String) -> Result<(), String> {
    connect_voice(&app, &url, &token).await
}

/// Joins the campaign's voice room. Called by the account flow right after sign-in, and by the
/// command above; audio runs in Rust whether or not any panel exists.
pub async fn connect_voice(app: &AppHandle, url: &str, token: &str) -> Result<(), String> {
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

    let client = LiveKitClient::connect(url, token, callback, speakers_callback)
        .await
        .map_err(|err| err.to_string())?;

    *app.state::<SharedClient>().lock().unwrap() = Some(client);
    // A new room starts with the player's current mute and the consent gate applied, and the
    // server's roster learns they are in voice.
    let effective = app.state::<MicGate>().effective();
    crate::hotkeys::push_mute_to_client(app, effective);
    crate::session::announce_voice_state(app, Some(true));
    crate::session::refresh_tray(app);
    Ok(())
}

#[tauri::command]
pub async fn livekit_disconnect(
    app: AppHandle,
    state: State<'_, SharedClient>,
) -> Result<(), String> {
    let client = state.lock().unwrap().take();
    if let Some(client) = client {
        client.disconnect().await.map_err(|err| err.to_string())?;
    }
    crate::session::announce_voice_state(&app, Some(false));
    let _ = app.emit("livekit:state", LiveKitStatePayload::left_voice());
    Ok(())
}

/// Joins voice using the signed-in account (the Connect button and the tray item). Chat keeps
/// working without it, so this is separate from sign-in. Already connected is not an error.
#[tauri::command]
pub async fn voice_connect(
    app: AppHandle,
    accounts: State<'_, crate::account_commands::AccountState>,
) -> Result<(), String> {
    if app.state::<SharedClient>().lock().unwrap().is_some() {
        return Ok(());
    }
    let (server, token, campaign_id) = accounts.credentials().await.map_err(|e| e.message)?;
    let (url, voice_token) = crate::account::AccountClient::new(&server)
        .voice_token(&token, &campaign_id)
        .await
        .map_err(|e| e.message)?;
    connect_voice(&app, &url, &voice_token).await
}

/// Delivery path 2 for hotkeys: a panel page's key handler calls this when it sees one of the
/// bindings. Needed because the OS-level global-shortcut plugin silently does nothing on Wayland.
///
/// This is the one place panel script reaches the hotkey system, so the action name is
/// parsed against a closed set — an unrecognized name is an error, never a default.
#[tauri::command]
pub fn hotkey_action(app: AppHandle, action: String) -> Result<(), String> {
    let parsed = crate::hotkeys::HotkeyAction::from_name(&action)
        .ok_or_else(|| format!("unknown hotkey action: {action}"))?;
    crate::hotkeys::dispatch(&app, parsed);
    Ok(())
}

/// Delivery path for a panel's mute button — shares
/// `hotkeys::apply_microphone_mute` with the hotkey path so a click and a keypress can't
/// leave a panel showing stale mic state.
#[tauri::command]
pub fn set_microphone_muted(app: AppHandle, muted: bool) -> Result<(), String> {
    crate::hotkeys::apply_microphone_mute(&app, muted);
    Ok(())
}

/// A panel opening asks for the current snapshot and the events since it (see `bridge`).
#[tauri::command]
pub fn panel_hydrate(feed: State<'_, crate::bridge::PanelFeed>) -> serde_json::Value {
    feed.hydrate()
}

/// A DM's soundboard or party command, relayed untouched. Only known command names are accepted
/// (`rust_sync::is_table_command`); the server still checks the sender is the DM.
#[tauri::command]
pub fn sync_command(
    state: State<'_, crate::session::SessionState>,
    t: String,
    data: serde_json::Value,
) -> Result<(), String> {
    crate::session::send_for_campaign(&state, |campaign_id| {
        let mut data = data;
        data.as_object_mut()?
            .insert("campaignId".into(), campaign_id.into());
        rust_sync::command_frame(&t, data)
    })
}

/// Sends chat, or a whisper when `to` is given.
#[tauri::command]
pub fn chat_send(
    state: State<'_, crate::session::SessionState>,
    text: String,
    to: Option<String>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty message".into());
    }
    crate::session::send_for_campaign(&state, |campaign_id| {
        Some(match &to {
            Some(to) => rust_sync::whisper_frame(campaign_id, to, &text),
            None => rust_sync::chat_frame(campaign_id, &text),
        })
    })
}

/// The tray's "Connect / disconnect voice": joins if not in voice, leaves if in it. Runs on the async
/// runtime because both directions are network calls.
pub fn toggle_voice(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let in_voice = app.state::<SharedClient>().lock().unwrap().is_some();
        let result = if in_voice {
            livekit_disconnect(app.clone(), app.state::<SharedClient>()).await
        } else {
            voice_connect(app.clone(), app.state()).await
        };
        if let Err(err) = result {
            eprintln!("[src-tauri] voice toggle failed: {err}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaving_voice_reports_a_disconnected_empty_room() {
        let payload = LiveKitStatePayload::left_voice();
        assert!(!payload.connected);
        assert!(payload.room_name.is_none());
        assert!(payload.participant_identities.is_empty());
    }
}
