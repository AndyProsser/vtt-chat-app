pub mod cue;
pub mod devices;
mod error;
pub mod link_stats;
mod reconnect;
pub mod sound;
pub mod voice_fx;
mod voice_path;

pub use error::LiveKitError;
pub use reconnect::{gap_indicates_resume, Backoff};
pub use voice_fx::Voice;

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

use crate::voice_path::VoicePath;

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
    /// Published the first time a character voice is chosen; kept (muted) after that.
    fx_track: Option<LocalAudioTrack>,
    /// The DM's sound effects, published the first time one plays (see `VoicePath`).
    sound_track: Option<LocalAudioTrack>,
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
    voice_path: Arc<VoicePath>,
    active: Arc<Mutex<Option<ActiveRoom>>>,
    stop: Arc<Notify>,
    stopping: Arc<AtomicBool>,
    supervisor: tokio::task::JoinHandle<()>,
}

/// The devices the system offers, without a call (for the settings screen when not in voice).
pub fn list_audio_devices() -> Result<devices::DeviceList, LiveKitError> {
    let audio = PlatformAudio::new().map_err(|err| LiveKitError::Audio(err.to_string()))?;
    Ok(devices::list(&audio))
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

        let voice_path = VoicePath::new(tokio::runtime::Handle::current());
        let (first_room, first_events) =
            join_once(&provider, &audio, &microphone_muted, &voice_path).await?;
        emit_state(&first_room.room, &on_state_change);
        // Visible at once, not whenever the supervisor task first runs: whoever joined may ask for the
        // state or the mute right away.
        let room = first_room.room.clone();
        *lock(&active) = Some(first_room);

        let session = Session {
            provider,
            audio: audio.clone(),
            microphone_muted: microphone_muted.clone(),
            voice_path: voice_path.clone(),
            active: active.clone(),
            stop: stop.clone(),
            stopping: stopping.clone(),
            on_state_change,
            on_speakers_change,
        };
        let supervisor = tokio::spawn(session.supervise(room, first_events));

        Ok(Self {
            audio,
            microphone_muted,
            voice_path,
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
        if let Err(message) = self.voice_control().reapply() {
            eprintln!("[rust-livekit] {message}");
        }
    }

    /// Where the connection stands right now. A window that opens after the join (or was not listening
    /// yet) asks for this instead of waiting for the next change event.
    pub fn connection_state(&self) -> ConnectionState {
        match lock(&self.active).as_ref() {
            Some(active) => ConnectionState {
                connected: true,
                room_name: Some(active.room.name()),
                participant_identities: active
                    .room
                    .remote_participants()
                    .keys()
                    .map(|identity| identity.to_string())
                    .collect(),
            },
            None => ConnectionState {
                connected: false,
                room_name: None,
                participant_identities: Vec::new(),
            },
        }
    }

    /// The microphones and speakers the system offers.
    pub fn audio_devices(&self) -> devices::DeviceList {
        devices::list(&self.audio)
    }

    /// Switches to the chosen microphone and speaker (by id, from [`Self::audio_devices`]); works mid-call.
    pub fn use_devices(&self, input: Option<&str>, output: Option<&str>) -> Result<(), String> {
        devices::apply(&self.audio, input, output)
    }

    /// A handle for changing the character voice from another task (the client sits behind a lock
    /// that must not be held across an `await`).
    pub fn voice_control(&self) -> VoiceControl {
        VoiceControl {
            audio: self.audio.clone(),
            microphone_muted: self.microphone_muted.clone(),
            voice_path: self.voice_path.clone(),
            active: self.active.clone(),
        }
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

/// Changes the DM's character voice; see [`LiveKitClient::voice_control`].
#[derive(Clone)]
pub struct VoiceControl {
    audio: PlatformAudio,
    microphone_muted: Arc<AtomicBool>,
    voice_path: Arc<VoicePath>,
    active: Arc<Mutex<Option<ActiveRoom>>>,
}

impl VoiceControl {
    /// Makes the microphone paths match the mute flag and the chosen voice.
    fn reapply(&self) -> Result<(), String> {
        let guard = lock(&self.active);
        self.voice_path.apply(
            &self.audio,
            guard.as_ref().map(|a| &a.microphone_track),
            guard.as_ref().and_then(|a| a.fx_track.as_ref()),
            self.microphone_muted.load(Ordering::Relaxed),
        )
    }

    /// The DM's character voice. Anything but `Voice::Normal` switches this player to our own
    /// microphone capture (no echo cancellation; headphones advised) until `Normal` is chosen again.
    /// An error means the effect could not start and the normal voice is in use.
    pub async fn set_voice_effect(&self, voice: Voice) -> Result<(), LiveKitError> {
        self.voice_path.set_voice(voice);
        if voice != Voice::Normal {
            let missing = lock(&self.active)
                .as_ref()
                .filter(|a| a.fx_track.is_none())
                .map(|a| a.room.clone());
            if let Some(room) = missing {
                let track = publish_fx_track(&room, &self.voice_path).await?;
                if let Some(active) = lock(&self.active).as_mut() {
                    active.fx_track = Some(track);
                }
            }
        }
        self.reapply().map_err(LiveKitError::Audio)
    }

    /// Makes sure the soundboard track is published, and returns where to send the effects mix. Only
    /// the DM calls this. Works with no room (a DM who has not joined voice): the sink then goes nowhere
    /// until the next join publishes the track.
    pub async fn sound_sink(&self) -> Result<sound::SoundSink, LiveKitError> {
        self.voice_path.want_sound();
        let missing = lock(&self.active)
            .as_ref()
            .filter(|a| a.sound_track.is_none())
            .map(|a| a.room.clone());
        if let Some(room) = missing {
            let track = publish_sound_track(&room, &self.voice_path).await?;
            if let Some(active) = lock(&self.active).as_mut() {
                active.sound_track = Some(track);
            }
        }
        Ok(self.voice_path.sound_sink())
    }

    pub fn voice_effect(&self) -> Voice {
        self.voice_path.voice()
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
    voice_path: Arc<VoicePath>,
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
    /// `first` is the room already stored in `active` by `connect`; later rejoins store theirs here.
    async fn supervise(self, first_room: Arc<Room>, first_events: UnboundedReceiver<RoomEvent>) {
        let mut backoff = Backoff::default();
        let mut joined: Option<(Option<ActiveRoom>, Arc<Room>, UnboundedReceiver<RoomEvent>)> =
            Some((None, first_room, first_events));

        loop {
            if let Some((stored, room, events)) = joined.take() {
                backoff.reset();
                if let Some(active_room) = stored {
                    *lock(&self.active) = Some(active_room);
                }
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
            match join_once(
                &self.provider,
                &self.audio,
                &self.microphone_muted,
                &self.voice_path,
            )
            .await
            {
                Ok((next, events)) => {
                    emit_state(&next.room, &self.on_state_change);
                    let room = next.room.clone();
                    joined = Some((Some(next), room, events));
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
    voice_path: &Arc<VoicePath>,
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

    // A rejoin keeps a chosen character voice: publish its track again before applying the state.
    let fx_track = if voice_path.voice() != Voice::Normal {
        Some(publish_fx_track(&room, voice_path).await?)
    } else {
        None
    };

    // Re-apply the mute state: a fresh track and a fresh device session must not undo it.
    if let Err(message) = voice_path.apply(
        audio,
        Some(&microphone_track),
        fx_track.as_ref(),
        microphone_muted.load(Ordering::Relaxed),
    ) {
        eprintln!("[rust-livekit] {message}");
    }

    let sound_track = if voice_path.sound_wanted() {
        Some(publish_sound_track(&room, voice_path).await?)
    } else {
        None
    };

    Ok((
        ActiveRoom {
            room,
            microphone_track,
            fx_track,
            sound_track,
        },
        events,
    ))
}

/// The name of the DM's effects track; the backend never records a track with this name.
pub const SOUNDBOARD_TRACK_NAME: &str = "soundboard";

async fn publish_sound_track(
    room: &Arc<Room>,
    voice_path: &Arc<VoicePath>,
) -> Result<LocalAudioTrack, LiveKitError> {
    let track =
        LocalAudioTrack::create_audio_track(SOUNDBOARD_TRACK_NAME, voice_path.sound_rtc_source());
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track.clone()),
            TrackPublishOptions {
                source: TrackSource::Unknown,
                ..Default::default()
            },
        )
        .await?;
    Ok(track)
}

async fn publish_fx_track(
    room: &Arc<Room>,
    voice_path: &Arc<VoicePath>,
) -> Result<LocalAudioTrack, LiveKitError> {
    let track = LocalAudioTrack::create_audio_track("voice-fx", voice_path.rtc_source());
    room.local_participant()
        .publish_track(
            LocalTrack::Audio(track.clone()),
            TrackPublishOptions {
                source: TrackSource::Unknown,
                ..Default::default()
            },
        )
        .await?;
    Ok(track)
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

#[cfg(test)]
mod live_tests {
    use std::sync::Arc;

    /// Regression: the UI's mute button is a synchronous Tauri command, which runs on the main thread
    /// with no Tokio context. Unmuting once panicked there ("there is no reactor running") and, being
    /// inside a C callback, aborted the whole app. Run against a dev server:
    /// `VTT_TEST_URL=ws://127.0.0.1:7880 VTT_TEST_TOKEN=<voice token> cargo test -p rust-livekit -- --ignored mute_from_a_plain_thread`
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server and a voice token"]
    async fn mute_from_a_plain_thread() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let client = Arc::new(
            crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}))
                .await
                .expect("connect"),
        );
        let c = Arc::clone(&client);
        std::thread::spawn(move || {
            c.set_microphone_muted(true);
            c.set_microphone_muted(false);
        })
        .join()
        .expect("muting and unmuting from a plain thread must not panic");
        Arc::into_inner(client)
            .expect("the thread has finished")
            .disconnect()
            .await
            .ok();
    }

    /// Regression: listing devices for the settings screen (no call yet) must not stop a later join.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server and a voice token"]
    async fn listing_devices_before_joining_does_not_break_the_join() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let _ = crate::list_audio_devices().expect("list the devices");
        let client =
            crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}))
                .await
                .expect("join after listing devices");
        client.disconnect().await.ok();
    }

    /// Choosing the first listed devices right after a join (what a saved choice does) must not hang or fail.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server and a voice token"]
    async fn choosing_devices_after_joining_works() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let client =
            crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}))
                .await
                .expect("join");
        let list = client.audio_devices();
        eprintln!("inputs: {:?}", list.inputs);
        eprintln!("outputs: {:?}", list.outputs);
        let input = list.inputs.first().map(|d| d.id.clone());
        let output = list.outputs.first().map(|d| d.id.clone());
        client
            .use_devices(input.as_deref(), output.as_deref())
            .expect("switch to the first devices");
        client.disconnect().await.ok();
    }

    /// Leaving voice and joining again in the same run (the Connect button) must work.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server and a voice token"]
    async fn leaving_and_rejoining_works() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let join =
            || crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}));
        join().await.expect("first join").disconnect().await.ok();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let again = join().await.expect("the second join");
        again.set_microphone_muted(false);
        again.disconnect().await.ok();
    }

    /// The connection state can be read at any time, not only from change events.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server and a voice token"]
    async fn connection_state_can_be_read_after_joining() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let client =
            crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}))
                .await
                .expect("join");
        let state = client.connection_state();
        assert!(state.connected);
        assert!(state.room_name.is_some());
    }
}
