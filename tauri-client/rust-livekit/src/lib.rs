mod audio;
mod error;

pub use error::LiveKitError;

use std::sync::{Arc, Mutex};

use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::track::{LocalAudioTrack, LocalTrack, RemoteTrack};
use livekit::webrtc::prelude::RtcAudioSource;

/// Mirrors `shared`'s `LiveKitConnectionState` IPC type — kept dependency-free here since
/// this crate must not depend on anything else in the mono-repo (see README).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConnectionState {
    pub connected: bool,
    pub room_name: Option<String>,
    pub participant_identities: Vec<String>,
}

pub type StateChangeCallback = Arc<dyn Fn(ConnectionState) + Send + Sync>;

pub struct LiveKitClient {
    room: Arc<Room>,
    _event_task: tokio::task::JoinHandle<()>,
    _capture_thread: std::thread::JoinHandle<()>,
}

impl LiveKitClient {
    /// Connects to `url` with `token`, publishes the default microphone as a local audio
    /// track, and plays back every remote participant's audio as it subscribes. `on_state_change`
    /// fires once immediately and again on every participant join/leave/disconnect.
    pub async fn connect(
        url: &str,
        token: &str,
        on_state_change: StateChangeCallback,
    ) -> Result<Self, LiveKitError> {
        let (room, mut events) = Room::connect(url, token, RoomOptions::default()).await?;
        let room = Arc::new(room);

        emit_state(&room, &on_state_change);

        let (capture_source, capture_thread) =
            audio::spawn_microphone_capture(tokio::runtime::Handle::current())?;
        let capture_track = LocalAudioTrack::create_audio_track(
            "microphone",
            RtcAudioSource::Native(capture_source),
        );
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(capture_track),
                TrackPublishOptions {
                    source: TrackSource::Microphone,
                    ..Default::default()
                },
            )
            .await?;

        let event_room = room.clone();
        let event_cb = on_state_change.clone();
        let event_task = tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                match event {
                    RoomEvent::TrackSubscribed {
                        track: RemoteTrack::Audio(audio_track),
                        ..
                    } => {
                        if let Err(err) = audio::spawn_remote_playback(audio_track) {
                            eprintln!("[rust-livekit] failed to start remote playback: {err}");
                        }
                        emit_state(&event_room, &event_cb);
                    }
                    RoomEvent::ParticipantConnected(_)
                    | RoomEvent::ParticipantDisconnected(_)
                    | RoomEvent::Disconnected { .. } => {
                        emit_state(&event_room, &event_cb);
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            room,
            _event_task: event_task,
            _capture_thread: capture_thread,
        })
    }

    pub async fn disconnect(self) -> Result<(), LiveKitError> {
        self.room.close().await?;
        Ok(())
    }
}

fn emit_state(room: &Room, on_state_change: &StateChangeCallback) {
    let participant_identities = room
        .remote_participants()
        .keys()
        .map(|identity| identity.to_string())
        .collect();
    on_state_change(ConnectionState {
        connected: true,
        room_name: Some(room.name()),
        participant_identities,
    });
}

/// Kept for callers that want to hold a shared, swappable client handle (e.g. Tauri's
/// managed state, which needs `Mutex<Option<LiveKitClient>>` across command invocations).
pub type SharedClient = Arc<Mutex<Option<LiveKitClient>>>;
