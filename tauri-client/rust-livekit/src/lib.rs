mod audio;
mod error;

pub use error::LiveKitError;

use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Retained so the mic can be muted after publish — Stage 1 dropped this handle, which
    /// left nothing able to mute the track later.
    microphone_track: LocalAudioTrack,
    /// Source of truth for whether captured audio actually reaches the track. Shared with the
    /// capture thread; see `audio::spawn_microphone_capture`.
    microphone_muted: Arc<AtomicBool>,
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

        // Starts muted: true push-to-talk, silent until the PTT key is held. An unattended
        // open mic during a live session is a real hot-mic risk (Stage 2 spec §1).
        let microphone_muted = Arc::new(AtomicBool::new(true));

        let (capture_source, capture_thread) = audio::spawn_microphone_capture(
            tokio::runtime::Handle::current(),
            microphone_muted.clone(),
        )?;
        let capture_track = LocalAudioTrack::create_audio_track(
            "microphone",
            RtcAudioSource::Native(capture_source),
        );
        capture_track.mute();
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(capture_track.clone()),
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
            microphone_track: capture_track,
            microphone_muted,
            _event_task: event_task,
            _capture_thread: capture_thread,
        })
    }

    /// Gates the microphone. The atomic is set first and is what actually stops audio leaving
    /// this machine — instantly, with no server round-trip. The track's own mute flag is then
    /// mirrored so remote participants see accurate state; because it is only advisory here,
    /// its signalling latency can't clip the start of a push-to-talk press.
    pub fn set_microphone_muted(&self, muted: bool) {
        self.microphone_muted.store(muted, Ordering::Relaxed);
        if muted {
            self.microphone_track.mute();
        } else {
            self.microphone_track.unmute();
        }
    }

    pub fn is_microphone_muted(&self) -> bool {
        self.microphone_muted.load(Ordering::Relaxed)
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
