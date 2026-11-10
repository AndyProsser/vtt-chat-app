//! The live link to the backend, owned by Rust so it works with every panel closed: signs in,
//! follows the campaign over the WebSocket, and drives the consent flow, the capture gate and the
//! tray through [`crate::shell::Shell`]. Panels are caches of this state (STATE-AND-RESILIENCE.md).

use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use rust_livekit::cue::policy::Cue;
use rust_sync::{
    audio_state_frame, ConnectInfo, ConnectInfoProvider, SyncClient, SyncConfig, SyncEvent,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::mic_gate::MicGate;
use crate::recording::Indicator;
use crate::shell::{BoxFuture, Platform, Shell, SignedOut};
use crate::tray;

pub const SESSION_SIGNED_OUT_EVENT: &str = "session:signed-out";
pub const SYNC_CONNECTION_EVENT: &str = "sync:connection";
pub const RECORDING_INDICATOR_EVENT: &str = "recording:indicator";

/// What the tray shows, kept apart from the audio path so any thread can update it.
#[derive(Debug, Default)]
pub struct TrayModel {
    connected: bool,
    indicator: Option<Indicator>,
}

type ClientSlot = Arc<Mutex<Option<SyncClient>>>;

struct ActiveSession {
    slot: ClientSlot,
    campaign_id: String,
    voice: Arc<Mutex<(bool, bool, crate::status::Status)>>,
    events: tauri::async_runtime::JoinHandle<()>,
}

/// Tauri state: at most one signed-in session.
#[derive(Default)]
pub struct SessionState(Mutex<Option<ActiveSession>>);

pub struct TauriPlatform {
    app: AppHandle,
    slot: ClientSlot,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IndicatorPayload<'a> {
    campaign_id: &'a str,
    indicator: &'static str,
}

fn indicator_name(indicator: Indicator) -> &'static str {
    match indicator {
        Indicator::None => "none",
        Indicator::Recording => "recording",
        Indicator::Paused => "paused",
    }
}

impl Platform for TauriPlatform {
    fn play_cue(&self, cue: Cue) -> BoxFuture<bool> {
        Box::pin(async move {
            // Cues play on this machine only, never through the SFU, and even while muted.
            tauri::async_runtime::spawn_blocking(
                move || match rust_livekit::cue::play_cue_blocking(cue) {
                    Ok(()) => true,
                    Err(err) => {
                        eprintln!("[src-tauri] consent cue could not be played: {err}");
                        false
                    }
                },
            )
            .await
            .unwrap_or(false)
        })
    }

    fn send_frame(&self, frame: String) {
        if let Some(client) = self.slot.lock().unwrap().as_ref() {
            client.send(frame);
        }
    }

    fn set_capture_gate(&self, held: bool) {
        let gate = self.app.state::<MicGate>();
        let effective = gate.set_gate(held);
        crate::hotkeys::push_mute_to_client(&self.app, effective);
        refresh_tray(&self.app);
    }

    fn set_indicator(&self, campaign_id: &str, indicator: Indicator) {
        self.app
            .state::<Mutex<TrayModel>>()
            .lock()
            .unwrap()
            .indicator = Some(indicator);
        let _ = self.app.emit(
            RECORDING_INDICATOR_EVENT,
            IndicatorPayload {
                campaign_id,
                indicator: indicator_name(indicator),
            },
        );
        refresh_tray(&self.app);
    }

    fn connection_changed(&self, connected: bool) {
        self.app
            .state::<Mutex<TrayModel>>()
            .lock()
            .unwrap()
            .connected = connected;
        let _ = self.app.emit(SYNC_CONNECTION_EVENT, connected);
        refresh_tray(&self.app);
    }

    fn signed_out(&self, reason: SignedOut) {
        let reason = match reason {
            SignedOut::Revoked => "revoked",
            SignedOut::IncompatibleServer => "incompatible-server",
        };
        let _ = self.app.emit(SESSION_SIGNED_OUT_EVENT, reason);
        if matches!(reason, "revoked") {
            crate::account_commands::on_revoked(&self.app);
        }
    }
}

/// Recomputes the tray icon and tooltip from the one state the audio path also uses.
pub fn refresh_tray(app: &AppHandle) {
    let model = app.state::<Mutex<TrayModel>>();
    let (connected, indicator) = {
        let m = model.lock().unwrap();
        (m.connected, m.indicator.unwrap_or(Indicator::None))
    };
    let mic_closed = app.state::<MicGate>().effective();
    tray::apply(app, tray::tray_state(connected, mic_closed, indicator));
}

/// `https://host` → `wss://host/ws`, `http://host:4000` → `ws://host:4000/ws`.
pub fn websocket_url(api_base: &str) -> Result<String, String> {
    let base = api_base.trim().trim_end_matches('/');
    let rest = base
        .strip_prefix("https://")
        .map(|r| ("wss://", r))
        .or_else(|| base.strip_prefix("http://").map(|r| ("ws://", r)))
        .ok_or_else(|| "the server address must start with http:// or https://".to_string())?;
    if rest.1.is_empty() {
        return Err("the server address has no host".into());
    }
    Ok(format!("{}{}/ws", rest.0, rest.1))
}

/// Starts the live session: WebSocket, consent flow, tray. Any previous session is replaced.
pub async fn start_session(
    app: AppHandle,
    state: &SessionState,
    api_base: String,
    session_token: String,
    campaign_id: String,
) -> Result<(), String> {
    let url = websocket_url(&api_base)?;
    // One session at a time: signing in again replaces the old one cleanly.
    stop_active(state).await;

    app.state::<crate::bridge::PanelFeed>().clear();
    let slot: ClientSlot = Arc::new(Mutex::new(None));
    let platform = Arc::new(TauriPlatform {
        app: app.clone(),
        slot: Arc::clone(&slot),
    });
    let shell = Shell::new(platform, campaign_id.clone());
    let voice = shell.voice_handle();
    let shell = Arc::new(tokio::sync::Mutex::new(shell));

    let (tx, mut rx) = mpsc::unbounded_channel::<SyncEvent>();
    let provider: ConnectInfoProvider = Arc::new(move || {
        let info = ConnectInfo {
            url: url.clone(),
            session_token: session_token.clone(),
        };
        Box::pin(async move { Ok(info) })
    });
    let client = SyncClient::start(provider, SyncConfig::default(), tx);
    client.subscribe(&campaign_id);
    *slot.lock().unwrap() = Some(client);

    let events = tauri::async_runtime::spawn({
        let shell = Arc::clone(&shell);
        let app = app.clone();
        async move {
            while let Some(event) = rx.recv().await {
                if let SyncEvent::Server(server_event) = &event {
                    if let Some((value, retain)) = crate::bridge::panel_event(server_event) {
                        app.state::<crate::bridge::PanelFeed>()
                            .record(&value, retain);
                        let _ = app.emit(crate::bridge::SYNC_EVENT, value);
                    }
                    match server_event {
                        rust_sync::ServerEvent::Snapshot { data, .. } => {
                            crate::soundboard::note_roster(&app, data).await;
                        }
                        rust_sync::ServerEvent::Table { t, data } => {
                            if t == "roster.update" {
                                crate::soundboard::note_roster(&app, data).await;
                            }
                            crate::soundboard::on_table(&app, t, data).await;
                        }
                        _ => {}
                    }
                }
                shell.lock().await.handle(event, SystemTime::now()).await;
            }
        }
    });

    *state.0.lock().unwrap() = Some(ActiveSession {
        slot,
        campaign_id,
        voice,
        events,
    });
    Ok(())
}

/// Ends the live session and returns the tray to "not connected".
pub async fn end_session(app: AppHandle, state: &SessionState) -> Result<(), String> {
    stop_active(state).await;
    crate::soundboard::stop_all(&app);
    app.state::<crate::bridge::PanelFeed>().clear();
    app.state::<MicGate>().set_gate(false);
    {
        let model = app.state::<Mutex<TrayModel>>();
        let mut m = model.lock().unwrap();
        m.connected = false;
        m.indicator = None;
    }
    refresh_tray(&app);
    Ok(())
}

async fn stop_active(state: &SessionState) {
    let active = state.0.lock().unwrap().take();
    if let Some(active) = active {
        active.events.abort();
        let client = active.slot.lock().unwrap().take();
        if let Some(client) = client {
            client.stop().await;
        }
    }
}

/// Tells the server whether this player is in voice and muted (their own mute, not the gate), so
/// the roster is right. A no-op when signed out.
/// Sends this player's link quality to the server (the DM's connection screen reads it). A no-op
/// when no session is live.
pub fn send_link_stats(app: &AppHandle, stats: rust_livekit::link_stats::LinkStats) {
    let state = app.state::<SessionState>();
    let guard = state.0.lock().unwrap();
    let Some(active) = guard.as_ref() else {
        return;
    };
    let frame = rust_sync::stats_frame(
        &active.campaign_id,
        stats.rtt_ms,
        stats.jitter_ms,
        stats.packet_loss_pct,
    );
    let slot = active.slot.lock().unwrap();
    if let Some(client) = slot.as_ref() {
        client.send(frame);
    }
}

pub fn announce_voice_state(app: &AppHandle, in_voice: Option<bool>) {
    let state = app.state::<SessionState>();
    let guard = state.0.lock().unwrap();
    let Some(active) = guard.as_ref() else {
        return;
    };
    let user_muted = app.state::<MicGate>().user_muted();
    let status = crate::status_commands::current(app);
    let in_voice = {
        let mut voice = active.voice.lock().unwrap();
        voice.1 = user_muted;
        voice.2 = status;
        if let Some(v) = in_voice {
            voice.0 = v;
        }
        voice.0
    };
    let frame = audio_state_frame(&active.campaign_id, in_voice, user_muted, status.as_str());
    let slot = active.slot.lock().unwrap();
    if let Some(client) = slot.as_ref() {
        client.send(frame);
    }
}

/// Sends a frame built for the active campaign. `build` gets the campaign id and may refuse by
/// returning `None`.
pub fn send_for_campaign(
    state: &SessionState,
    build: impl FnOnce(&str) -> Option<String>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let active = guard.as_ref().ok_or("not signed in")?;
    let frame = build(&active.campaign_id).ok_or("that is not something a panel may send")?;
    let slot = active.slot.lock().unwrap();
    slot.as_ref().ok_or("not connected")?.send(frame);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_websocket_address_from_the_server_address() {
        assert_eq!(
            websocket_url("https://vtt.example.com").unwrap(),
            "wss://vtt.example.com/ws"
        );
        assert_eq!(
            websocket_url("http://127.0.0.1:4000/").unwrap(),
            "ws://127.0.0.1:4000/ws"
        );
        assert_eq!(websocket_url("  https://h  ").unwrap(), "wss://h/ws");
    }

    #[test]
    fn rejects_an_address_that_is_not_http() {
        assert!(websocket_url("vtt.example.com").is_err());
        assert!(websocket_url("ftp://x").is_err());
        assert!(websocket_url("https://").is_err());
    }
}
