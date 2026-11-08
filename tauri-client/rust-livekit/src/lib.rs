pub mod cue;
mod error;
pub mod link_stats;
mod reconnect;
pub mod sound;
pub mod voice_fx;

pub use error::LiveKitError;
pub use reconnect::{gap_indicates_resume, Backoff};

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::track::{LocalAudioTrack, LocalTrack};
use livekit::{AudioProcessingOptions, PlatformAudio};
use tokio::sync::{mpsc::UnboundedReceiver, Notify};

/// Mirrors `shared`'s `LiveKitConnectionState` IPC type — kept dependency-free here since
/// this crate must not depend on anything else in the mono-repo (see README).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConnectionState {
    pub connected: bool,
    pub room_name: Option<String>,
    pub participant_identities: Vec<String>,
}

pub type StateChangeCallback = Arc<dyn Fn(ConnectionState) + Send + Sync>;

/// Fired from `RoomEvent::ActiveSpeakersChanged`, carrying the complete current speaker set
/// (identities), never a delta. Separate from `StateChangeCallback` on purpose: speaker sets
/// change several times per second, and folding them into connection state would replace the
/// participant roster on every utterance.
pub type SpeakersChangeCallback = Arc<dyn Fn(Vec<String>) + Send + Sync>;

/// Where and how to join. Returned by a [`ConnectInfoProvider`] on every (re)join so a token that
/// expired while the machine slept can be re-fetched instead of replayed.
#[derive(Debug, Clone)]
pub struct ConnectInfo {
    pub url: String,
    pub token: String,
}

pub type ConnectInfoFuture = Pin<Box<dyn Future<Output = Result<ConnectInfo, String>> + Send>>;
pub type ConnectInfoProvider = Arc<dyn Fn() -> ConnectInfoFuture + Send + Sync>;

/// How often the sleep/wake detector runs, and how late a tick must be before it counts as a
/// resume. A tick that fires 15 s late means the process was frozen, not merely busy.
const HEARTBEAT_TICK: Duration = Duration::from_secs(5);
const RESUME_THRESHOLD: Duration = Duration::from_secs(10);

struct ActiveRoom {
    room: Arc<Room>,
    microphone_track: LocalAudioTrack,
}

/// A voice session that keeps itself alive: if the network drops or the machine sleeps, it
/// rejoins in the background with backoff until [`LiveKitClient::disconnect`] is called.
///
/// Audio device I/O, echo cancellation, noise suppression and gain control are WebRTC's own
/// platform audio layer (`PlatformAudio`) — the same engine on every OS. Muting stops the
/// recording device itself, so the OS microphone indicator turns off.
pub struct LiveKitClient {
    audio: PlatformAudio,
    /// Source of truth for "should audio leave this machine". Survives rejoins.
    microphone_muted: Arc<AtomicBool>,
    active: Arc<Mutex<Option<ActiveRoom>>>,
    stop: Arc<Notify>,
    stopping: Arc<AtomicBool>,
    supervisor: tokio::task::JoinHandle<()>,
}

impl LiveKitClient {
    /// Joins with a fixed `url`/`token`. Rejoins reuse the same token, so this suits short
    /// sessions and tests; real use passes a provider via [`Self::connect_with_provider`].
    pub async fn connect(
        url: &str,
        token: &str,
        on_state_change: StateChangeCallback,
        on_speakers_change: SpeakersChangeCallback,
    ) -> Result<Self, LiveKitError> {
        let info = ConnectInfo {
            url: url.to_string(),
            token: token.to_string(),
        };
        let provider: ConnectInfoProvider = Arc::new(move || {
            let info = info.clone();
            Box::pin(async move { Ok(info) })
        });
        Self::connect_with_provider(provider, on_state_change, on_speakers_change).await
    }

    /// Joins once (returning an error if that first attempt fails), then supervises the session
    /// in the background. Starts **muted** with the capture device released: an unattended open
    /// mic is a hot-mic risk, and push-to-talk should be silent until the key is held.
    pub async fn connect_with_provider(
        provider: ConnectInfoProvider,
        on_state_change: StateChangeCallback,
        on_speakers_change: SpeakersChangeCallback,
    ) -> Result<Self, LiveKitError> {
        let audio = PlatformAudio::new().map_err(|err| LiveKitError::Audio(err.to_string()))?;
        // `start_recording` fails until a device has been selected explicitly (measured on
        // Windows — docs/architecture/AUDIO-SPIKE-RESULTS.md).
        if let Some(device) = audio.recording_devices().next() {
            audio
                .set_recording_device(&device.id)
                .map_err(|err| LiveKitError::Audio(err.to_string()))?;
        }
        audio
            .configure_audio_processing(AudioProcessingOptions::default())
            .map_err(|err| LiveKitError::Audio(err.to_string()))?;

        let microphone_muted = Arc::new(AtomicBool::new(true));
        let active: Arc<Mutex<Option<ActiveRoom>>> = Arc::new(Mutex::new(None));
        let stop = Arc::new(Notify::new());
        let stopping = Arc::new(AtomicBool::new(false));

        let first = join_once(&provider, &audio, &microphone_muted).await?;
        emit_state(&first.0.room, &on_state_change);

        let session = Session {
            provider,
            audio: audio.clone(),
            microphone_muted: microphone_muted.clone(),
            active: active.clone(),
            stop: stop.clone(),
            stopping: stopping.clone(),
            on_state_change,
            on_speakers_change,
        };
        let supervisor = tokio::spawn(session.supervise(first));

        Ok(Self {
            audio,
            microphone_muted,
            active,
            stop,
            stopping,
            supervisor,
        })
    }

    /// Mute releases the capture device (OS mic indicator off); unmute re-acquires it. Measured
    /// on Windows: ~4 ms to mute, ~25 ms to unmute. The flag is recorded first so a rejoin that
    /// happens mid-call comes back in the right state.
    pub fn set_microphone_muted(&self, muted: bool) {
        self.microphone_muted.store(muted, Ordering::Relaxed);
        let guard = lock(&self.active);
        apply_mute(
            &self.audio,
            guard.as_ref().map(|a| &a.microphone_track),
            muted,
        );
    }

    pub fn is_microphone_muted(&self) -> bool {
        self.microphone_muted.load(Ordering::Relaxed)
    }

    /// A cheap handle for measuring link quality from another task (the client itself sits behind
    /// a lock that must not be held across an `await`).
    pub fn link_probe(&self) -> LinkProbe {
        LinkProbe {
            active: self.active.clone(),
        }
    }

    /// Leaves for good and stops the rejoin supervisor.
    pub async fn disconnect(self) -> Result<(), LiveKitError> {
        self.stopping.store(true, Ordering::Relaxed);
        self.stop.notify_waiters();
        let active = lock(&self.active).take();
        if let Some(active) = active {
            active.room.close().await?;
        }
        let _ = self.audio.stop_recording();
        self.supervisor.abort();
        Ok(())
    }
}

/// Measures the current link quality; see [`LiveKitClient::link_probe`].
#[derive(Clone)]
pub struct LinkProbe {
    active: Arc<Mutex<Option<ActiveRoom>>>,
}

impl LinkProbe {
    /// `None` when not in a room (or between rejoins) or nothing has been measured yet.
    pub async fn read(&self) -> Option<link_stats::LinkStats> {
        let room = lock(&self.active).as_ref().map(|a| a.room.clone())?;
        let stats = room.get_stats().await.ok()?;
        link_stats::summarise(&stats.publisher_stats)
    }
}

/// Everything the supervisor task owns.
struct Session {
    provider: ConnectInfoProvider,
    audio: PlatformAudio,
    microphone_muted: Arc<AtomicBool>,
    active: Arc<Mutex<Option<ActiveRoom>>>,
    stop: Arc<Notify>,
    stopping: Arc<AtomicBool>,
    on_state_change: StateChangeCallback,
    on_speakers_change: SpeakersChangeCallback,
}

type Joined = (ActiveRoom, UnboundedReceiver<RoomEvent>);

enum SessionEnd {
    /// The server or network ended the session — rejoin.
    Lost,
    /// The machine slept — rejoin immediately, skipping the backoff.
    Resumed,
    /// `disconnect()` was called.
    Stopped,
}

impl Session {
    async fn supervise(self, first: Joined) {
        let mut backoff = Backoff::default();
        let mut joined = Some(first);

        loop {
            if let Some((active_room, events)) = joined.take() {
                backoff.reset();
                let room = active_room.room.clone();
                *lock(&self.active) = Some(active_room);
                let end = self.run_until_lost(&room, events).await;

                // The room is gone either way; make that visible before doing anything slow.
                lock(&self.active).take();
                (self.on_state_change)(ConnectionState::default());
                let _ = room.close().await;

                match end {
                    SessionEnd::Stopped => return,
                    SessionEnd::Resumed => {}
                    SessionEnd::Lost => {
                        if !self.sleep_or_stop(backoff.next_delay(jitter())).await {
                            return;
                        }
                    }
                }
            } else if !self.sleep_or_stop(backoff.next_delay(jitter())).await {
                return;
            }

            if self.stopping.load(Ordering::Relaxed) {
                return;
            }
            match join_once(&self.provider, &self.audio, &self.microphone_muted).await {
                Ok(next) => {
                    emit_state(&next.0.room, &self.on_state_change);
                    joined = Some(next);
                }
                Err(err) => eprintln!("[rust-livekit] rejoin attempt failed: {err}"),
            }
        }
    }

    /// Returns `false` if `disconnect()` was called while waiting.
    async fn sleep_or_stop(&self, delay: Duration) -> bool {
        tokio::select! {
            _ = tokio::time::sleep(delay) => !self.stopping.load(Ordering::Relaxed),
            _ = self.stop.notified() => false,
        }
    }

    async fn run_until_lost(
        &self,
        room: &Arc<Room>,
        mut events: UnboundedReceiver<RoomEvent>,
    ) -> SessionEnd {
        let mut heartbeat = tokio::time::interval(HEARTBEAT_TICK);
        let mut last_tick = SystemTime::now();

        loop {
            tokio::select! {
                _ = self.stop.notified() => return SessionEnd::Stopped,
                _ = heartbeat.tick() => {
                    let now = SystemTime::now();
                    let resumed = gap_indicates_resume(last_tick, now, HEARTBEAT_TICK, RESUME_THRESHOLD);
                    last_tick = now;
                    if resumed {
                        return SessionEnd::Resumed;
                    }
                }
                event = events.recv() => {
                    let Some(event) = event else { return SessionEnd::Lost };
                    match event {
                        RoomEvent::ParticipantConnected(_)
                        | RoomEvent::ParticipantDisconnected(_) => {
                            emit_state(room, &self.on_state_change);
                        }
                        RoomEvent::Disconnected { .. } => return SessionEnd::Lost,
                        RoomEvent::ActiveSpeakersChanged { speakers } => {
                            let speaking_identities = speakers
                                .into_iter()
                                .map(|participant| participant.identity().to_string())
                                .collect();
                            (self.on_speakers_change)(speaking_identities);
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

async fn join_once(
    provider: &ConnectInfoProvider,
    audio: &PlatformAudio,
    microphone_muted: &Arc<AtomicBool>,
) -> Result<Joined, LiveKitError> {
    let info = provider().await.map_err(LiveKitError::Provider)?;
    let (room, events) = Room::connect(&info.url, &info.token, RoomOptions::default()).await?;
    let room = Arc::new(room);

    let microphone_track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(microphone_track.clone()),
            TrackPublishOptions {
                source: TrackSource::Microphone,
                ..Default::default()
            },
        )
        .await?;

    // Re-apply the mute state: a fresh track and a fresh device session must not undo it.
    apply_mute(
        audio,
        Some(&microphone_track),
        microphone_muted.load(Ordering::Relaxed),
    );

    Ok((
        ActiveRoom {
            room,
            microphone_track,
        },
        events,
    ))
}

fn apply_mute(audio: &PlatformAudio, track: Option<&LocalAudioTrack>, muted: bool) {
    if muted {
        if let Some(track) = track {
            track.mute();
        }
        if let Err(err) = audio.stop_recording() {
            eprintln!("[rust-livekit] could not release the capture device: {err}");
        }
    } else {
        if let Err(err) = audio.start_recording() {
            eprintln!("[rust-livekit] could not start the capture device: {err}");
        }
        if let Some(track) = track {
            track.unmute();
        }
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

/// A poisoned lock here only means a callback panicked; the data (an `Option`) is still valid,
/// and refusing to mute because of it would be the wrong failure mode.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Cheap jitter in `0.0..1.0` without a `rand` dependency — it only has to decorrelate clients.
fn jitter() -> f64 {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    f64::from(nanos % 1000) / 1000.0
}

/// Kept for callers that want to hold a shared, swappable client handle (e.g. Tauri's
/// managed state, which needs `Mutex<Option<LiveKitClient>>` across command invocations).
pub type SharedClient = Arc<Mutex<Option<LiveKitClient>>>;
