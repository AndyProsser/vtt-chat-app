use std::sync::Arc;

use rust_livekit::{ConnectionState, LiveKitClient, SharedClient};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::mic_gate::MicGate;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveKitStatePayload {
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

    let prefs = crate::account::data_dir(app)
        .map(|dir| crate::audio_prefs::AudioPrefs::load(&dir))
        .unwrap_or_default();
    // The app's own audio engine when chosen in Settings (or by VTT_AUDIO_BACKEND=mixer for testing).
    let backend = if prefs.uses_mixer() {
        rust_livekit::AudioBackend::Mixer
    } else {
        rust_livekit::AudioBackend::from_env()
    };
    let (url_owned, token_owned) = (url.to_string(), token.to_string());
    let provider: rust_livekit::ConnectInfoProvider = Arc::new(move || {
        let info = rust_livekit::ConnectInfo {
            url: url_owned.clone(),
            token: token_owned.clone(),
        };
        Box::pin(async move { Ok(info) })
    });
    let client = LiveKitClient::connect_with_backend(
        provider,
        callback,
        speakers_callback,
        backend,
        prefs.auto_gain_on(),
    )
    .await
    .map_err(|err| err.to_string())?;

    // The microphone and speaker the player chose last time (a missing device keeps the default).
    if let Err(message) = client.use_devices(prefs.input.as_deref(), prefs.output.as_deref()) {
        eprintln!("[src-tauri] {message}");
    }
    if let Some(mixer) = client.mixer() {
        mixer.set_mic_gain(prefs.mic_gain.unwrap_or(1.0));
        for (user, volume) in &prefs.volumes {
            mixer.set_player_volume(user, *volume);
        }
    }
    let probe = client.link_probe();
    *app.state::<SharedClient>().lock().unwrap() = Some(client);
    start_stats_reporter(app, probe);
    // A new room starts with the player's current mute and the consent gate applied, and the
    // server's roster learns they are in voice.
    let effective = app.state::<MicGate>().effective();
    crate::hotkeys::push_mute_to_client(app, effective);
    crate::session::announce_voice_state(app, Some(true));
    crate::session::refresh_tray(app);
    Ok(())
}

/// The microphones and speakers the system offers, and which are chosen. Works with or without a call.
#[tauri::command]
pub fn audio_devices(
    app: AppHandle,
    state: State<'_, SharedClient>,
) -> Result<serde_json::Value, String> {
    let list = match state.lock().unwrap().as_ref() {
        Some(client) => client.audio_devices(),
        None => rust_livekit::list_audio_devices().map_err(|e| e.to_string())?,
    };
    let prefs = crate::account::data_dir(&app)
        .map(|dir| crate::audio_prefs::AudioPrefs::load(&dir))
        .unwrap_or_default();
    let entries = |v: &[rust_livekit::devices::DeviceEntry]| -> Vec<serde_json::Value> {
        v.iter()
            .map(|d| serde_json::json!({ "id": d.id, "name": d.name }))
            .collect()
    };
    Ok(serde_json::json!({
        "inputs": entries(&list.inputs),
        "outputs": entries(&list.outputs),
        "chosenInput": prefs.input,
        "chosenOutput": prefs.output,
    }))
}

/// Chooses the microphone (`input`) or speaker (`output`); `id` null goes back to the system default
/// (on the next call). Saved, and applied now if a call is running.
#[tauri::command]
pub fn audio_device_choose(
    app: AppHandle,
    state: State<'_, SharedClient>,
    kind: String,
    id: Option<String>,
) -> Result<(), String> {
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    let prefs = crate::audio_prefs::AudioPrefs::load(&dir).with(&kind, id.clone())?;
    prefs.save(&dir).map_err(|e| e.to_string())?;
    if let Some(client) = state.lock().unwrap().as_ref() {
        let (input, output) = match kind.as_str() {
            "input" => (id.as_deref(), None),
            _ => (None, id.as_deref()),
        };
        client.use_devices(input, output)?;
    }
    Ok(())
}

/// Where voice stands now, for a window that was not listening when the join happened (the app joins
/// at start-up, before any window exists). Includes the player's mute so the buttons match too.
#[tauri::command]
pub fn livekit_snapshot(
    app: AppHandle,
    state: State<'_, SharedClient>,
) -> (LiveKitStatePayload, crate::hotkeys::MicrophoneStatePayload) {
    let connection = state
        .lock()
        .unwrap()
        .as_ref()
        .map(|client| client.connection_state())
        .unwrap_or_else(|| rust_livekit::ConnectionState {
            connected: false,
            room_name: None,
            participant_identities: Vec::new(),
        });
    let gate = app.state::<MicGate>();
    (
        connection.into(),
        crate::hotkeys::MicrophoneStatePayload {
            muted: gate.user_muted(),
            gated: gate.gate_held(),
        },
    )
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
    let _ = app.emit(VOICE_EFFECT_EVENT, "normal"); // the next session starts with the normal voice
    Ok(())
}

/// Event carrying the current character voice's name (`"normal"` when none).
pub const VOICE_EFFECT_EVENT: &str = "voice:effect";

/// Picks the DM's character voice (`normal`, `giant`, `imp`, `robot`, `demon`). It only changes this
/// player's own outgoing voice, so there is nothing for the server to authorise; the app shows the
/// control to the DM alone. Anything but `normal` uses our own microphone capture without echo
/// cancellation (headphones advised) — docs/architecture/DM-VOICE-EFFECT.md.
#[tauri::command]
pub async fn voice_effect_set(app: AppHandle, name: String) -> Result<(), String> {
    let voice = rust_livekit::Voice::from_name(&name)
        .ok_or_else(|| format!("unknown voice “{}”", name.trim()))?;
    let control = app
        .state::<SharedClient>()
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.voice_control())
        .ok_or("join voice first: a character voice changes what the table hears")?;
    let result = control.set_voice_effect(voice).await;
    // Report what is actually in use (a failed effect falls back to the normal voice).
    let _ = app.emit(VOICE_EFFECT_EVENT, control.voice_effect().name());
    result.map_err(|e| e.to_string())
}

/// The character voice in use right now.
#[tauri::command]
pub fn voice_effect_get(app: AppHandle) -> String {
    app.state::<SharedClient>()
        .lock()
        .unwrap()
        .as_ref()
        .map_or("normal", |c| c.voice_control().voice_effect().name())
        .to_string()
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

/// How often a player's link quality is reported to the server (SYNC-PROTOCOL.md, stats tier).
const STATS_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

/// Which reporter task is current; a newer one makes an older one stop.
static STATS_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Reports link quality every [`STATS_INTERVAL`] while this voice session lasts. It exists only in
/// voice (nothing runs when disconnected), and ends when the client goes away or a newer reporter
/// starts after a reconnect.
fn start_stats_reporter(app: &AppHandle, probe: rust_livekit::LinkProbe) {
    use std::sync::atomic::Ordering;
    let generation = STATS_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(STATS_INTERVAL);
        loop {
            tick.tick().await;
            if STATS_GENERATION.load(Ordering::SeqCst) != generation
                || app.state::<SharedClient>().lock().unwrap().is_none()
            {
                return;
            }
            if let Some(stats) = probe.read().await {
                crate::session::send_link_stats(&app, stats);
            }
        }
    });
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

/// Which audio engine is chosen (`engine`, used from the next call) and which one this call uses
/// (`active`; `null` when not in voice).
#[tauri::command]
pub fn audio_engine(app: AppHandle, state: State<'_, SharedClient>) -> serde_json::Value {
    let prefs = crate::account::data_dir(&app)
        .map(|dir| crate::audio_prefs::AudioPrefs::load(&dir))
        .unwrap_or_default();
    let active = state.lock().unwrap().as_ref().map(|client| {
        if client.mixer().is_some() {
            "mixer"
        } else {
            "platform"
        }
    });
    serde_json::json!({
        "engine": if prefs.uses_mixer() { "mixer" } else { "platform" },
        "active": active,
        "micGain": prefs.mic_gain.unwrap_or(1.0),
        "autoGain": prefs.auto_gain_on(),
        "volumes": prefs.volumes,
    })
}

/// Chooses the audio engine for the next call: `"mixer"` or `"platform"`.
#[tauri::command]
pub fn audio_engine_set(app: AppHandle, engine: String) -> Result<(), String> {
    if engine != "mixer" && engine != "platform" {
        return Err("unknown audio engine".into());
    }
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    let mut prefs = crate::audio_prefs::AudioPrefs::load(&dir);
    prefs.engine = Some(engine);
    prefs.save(&dir).map_err(|e| e.to_string())
}

/// Turns automatic microphone volume on or off. Takes effect the next time the player joins voice.
#[tauri::command]
pub fn auto_gain_set(app: AppHandle, on: bool) -> Result<(), String> {
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    let mut prefs = crate::audio_prefs::AudioPrefs::load(&dir);
    prefs.auto_gain = Some(on);
    prefs.save(&dir).map_err(|e| e.to_string())
}

/// Microphone volume, 0 to 4 (mixer engine). Saved, and applied now if the mixer is running.
#[tauri::command]
pub fn mic_gain_set(
    app: AppHandle,
    state: State<'_, SharedClient>,
    gain: f32,
) -> Result<(), String> {
    let gain = gain.clamp(0.0, 4.0);
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    let mut prefs = crate::audio_prefs::AudioPrefs::load(&dir);
    prefs.mic_gain = Some(gain);
    prefs.save(&dir).map_err(|e| e.to_string())?;
    if let Some(mixer) = state.lock().unwrap().as_ref().and_then(|c| c.mixer()) {
        mixer.set_mic_gain(gain);
    }
    Ok(())
}

/// How loud the microphone is right now, 0 to 1, or `null` when the mixer engine is not running.
#[tauri::command]
pub fn mic_level(state: State<'_, SharedClient>) -> Option<f32> {
    state
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|c| c.mixer())
        .map(|m| m.level().get())
}

/// One person's volume, 0 to 2 (mixer engine). Saved by account id, and applied now if running.
#[tauri::command]
pub fn player_volume_set(
    app: AppHandle,
    state: State<'_, SharedClient>,
    user_id: String,
    gain: f32,
) -> Result<(), String> {
    if user_id.is_empty() || user_id.len() > 64 {
        return Err("unknown person".into());
    }
    let gain = gain.clamp(0.0, 2.0);
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    let mut prefs = crate::audio_prefs::AudioPrefs::load(&dir);
    if (gain - 1.0).abs() < 0.01 {
        prefs.volumes.remove(&user_id);
    } else {
        prefs.volumes.insert(user_id.clone(), gain);
    }
    prefs.save(&dir).map_err(|e| e.to_string())?;
    if let Some(mixer) = state.lock().unwrap().as_ref().and_then(|c| c.mixer()) {
        mixer.set_player_volume(&user_id, gain);
    }
    Ok(())
}
