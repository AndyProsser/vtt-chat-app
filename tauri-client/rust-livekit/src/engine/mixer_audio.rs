//! The mixer engine as a call uses it: our microphone feeds a LiveKit audio source, every remote
//! voice is pulled into the playout mixer, and the sound card is opened and closed by this type.

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;

use super::capture::Level;
use super::duplex::Duplex;
use super::io::{self, Running};
use super::processing::ProcessingOptions;
use crate::devices::DeviceList;
use crate::voice_fx::capture::to_i16;
use crate::voice_fx::{Voice, BLOCK, SAMPLE_RATE};

/// The playout key for someone's speaking voice. Their volume is set under this key.
pub fn voice_key(identity: &str) -> String {
    identity.to_string()
}

/// The key for a person's other published sound (the DM's soundboard), kept apart from their voice so
/// turning someone down does not silence the table's sound effects.
pub fn extra_key(identity: &str, track: &str) -> String {
    format!("{identity}/{track}")
}

pub struct MixerAudio {
    duplex: Arc<Duplex>,
    source: NativeAudioSource,
    runtime: tokio::runtime::Handle,
    input: Mutex<Option<Running>>,
    output: Mutex<Option<Running>>,
    wanted_input: Mutex<Option<String>>,
    wanted_output: Mutex<Option<String>>,
    /// Remote audio being pulled into the mixer, by playout key.
    pulls: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl MixerAudio {
    pub fn new(runtime: tokio::runtime::Handle) -> Arc<Self> {
        let source = NativeAudioSource::new(
            // WebRTC's own processing already ran in `Duplex`; the source must not process again.
            AudioSourceOptions {
                echo_cancellation: false,
                noise_suppression: false,
                auto_gain_control: false,
            },
            SAMPLE_RATE,
            1,
            100,
        );
        // Blocks leave the sound-card callback on a channel, so the callback never waits on the network.
        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let feed = source.clone();
        let handle = runtime.clone();
        std::thread::Builder::new()
            .name("engine-feed".into())
            .spawn(move || {
                while let Ok(block) = rx.recv() {
                    debug_assert_eq!(block.len(), BLOCK);
                    let frame = AudioFrame {
                        data: to_i16(&block).into(),
                        sample_rate: SAMPLE_RATE,
                        num_channels: 1,
                        samples_per_channel: BLOCK as u32,
                    };
                    if let Err(err) = handle.block_on(feed.capture_frame(&frame)) {
                        eprintln!("[engine] could not send audio: {err}");
                    }
                }
            })
            .expect("feeder thread");
        let duplex = Duplex::new(
            ProcessingOptions::default(),
            Box::new(move |block: &[f32]| {
                let _ = tx.send(block.to_vec());
            }),
        );
        Arc::new(Self {
            duplex,
            source,
            runtime,
            input: Mutex::new(None),
            output: Mutex::new(None),
            wanted_input: Mutex::new(None),
            wanted_output: Mutex::new(None),
            pulls: Mutex::new(HashMap::new()),
        })
    }

    pub fn rtc_source(&self) -> RtcAudioSource {
        RtcAudioSource::Native(self.source.clone())
    }

    pub fn duplex(&self) -> &Arc<Duplex> {
        &self.duplex
    }

    pub fn level(&self) -> Level {
        self.duplex.level.clone()
    }

    pub fn devices(&self) -> DeviceList {
        io::list_devices()
    }

    /// Opens the microphone (`true`) or releases it (`false`: the OS indicator goes out).
    pub fn set_capturing(&self, on: bool) -> Result<(), String> {
        let mut input = self.input.lock().unwrap();
        if on && input.is_none() {
            let name = self.wanted_input.lock().unwrap().clone();
            *input = Some(io::start_input(name.as_deref(), self.duplex.clone())?);
        } else if !on {
            if let Some(running) = input.take() {
                running.stop();
            }
            self.source.clear_buffer();
        }
        Ok(())
    }

    /// Opens the speakers (`true`) or closes them (`false`).
    pub fn set_playing(&self, on: bool) -> Result<(), String> {
        let mut output = self.output.lock().unwrap();
        if on && output.is_none() {
            let name = self.wanted_output.lock().unwrap().clone();
            *output = Some(io::start_output(name.as_deref(), self.duplex.clone())?);
        } else if !on {
            if let Some(running) = output.take() {
                running.stop();
            }
        }
        Ok(())
    }

    /// Chooses devices by name (`None`: leave that side alone); a running stream moves to the new one.
    pub fn use_devices(&self, input: Option<&str>, output: Option<&str>) -> Result<(), String> {
        if let Some(name) = input {
            *self.wanted_input.lock().unwrap() = Some(name.to_string());
            if self.input.lock().unwrap().is_some() {
                self.set_capturing(false)?;
                self.set_capturing(true)?;
            }
        }
        if let Some(name) = output {
            *self.wanted_output.lock().unwrap() = Some(name.to_string());
            if self.output.lock().unwrap().is_some() {
                self.set_playing(false)?;
                self.set_playing(true)?;
            }
        }
        Ok(())
    }

    pub fn set_voice(&self, voice: Voice) {
        self.duplex.capture.lock().unwrap().set_voice(voice);
    }

    pub fn set_mic_gain(&self, gain: f32) {
        self.duplex.capture.lock().unwrap().set_gain(gain);
    }

    /// One person's volume (their voice only), 0 to 2.
    pub fn set_player_volume(&self, identity: &str, gain: f32) {
        self.duplex
            .playout
            .lock()
            .unwrap()
            .set_gain(&voice_key(identity), gain);
    }

    /// Everything's volume together.
    pub fn set_master_volume(&self, gain: f32) {
        self.duplex.playout.lock().unwrap().set_master(gain);
    }

    /// Room events that concern audio: start or stop pulling a remote voice into the mixer.
    pub fn on_room_event(&self, event: &RoomEvent) {
        match event {
            RoomEvent::TrackSubscribed {
                track: RemoteTrack::Audio(audio),
                publication,
                participant,
            } => {
                let identity = participant.identity().to_string();
                let key = if publication.source() == TrackSource::Microphone {
                    voice_key(&identity)
                } else {
                    extra_key(&identity, &publication.name())
                };
                self.pull(key, audio.clone());
            }
            RoomEvent::TrackUnsubscribed {
                track: RemoteTrack::Audio(_),
                publication,
                participant,
            } => {
                let identity = participant.identity().to_string();
                let key = if publication.source() == TrackSource::Microphone {
                    voice_key(&identity)
                } else {
                    extra_key(&identity, &publication.name())
                };
                self.stop_pull(&key);
            }
            RoomEvent::ParticipantDisconnected(participant) => {
                let identity = participant.identity().to_string();
                let prefix = format!("{identity}/");
                let keys: Vec<String> = self
                    .pulls
                    .lock()
                    .unwrap()
                    .keys()
                    .filter(|k| **k == identity || k.starts_with(&prefix))
                    .cloned()
                    .collect();
                for key in keys {
                    self.stop_pull(&key);
                }
            }
            _ => {}
        }
    }

    fn pull(&self, key: String, track: RemoteAudioTrack) {
        self.stop_pull(&key);
        let playout = self.duplex.playout.clone();
        let pull_key = key.clone();
        let task = self.runtime.spawn(async move {
            let mut stream = NativeAudioStream::new(track.rtc_track(), SAMPLE_RATE as i32, 1);
            while let Some(frame) = stream.next().await {
                let samples: Vec<f32> = frame
                    .data
                    .iter()
                    .map(|s| *s as f32 / i16::MAX as f32)
                    .collect();
                playout.lock().unwrap().push(&pull_key, &samples);
            }
        });
        self.pulls.lock().unwrap().insert(key, task);
    }

    fn stop_pull(&self, key: &str) {
        if let Some(task) = self.pulls.lock().unwrap().remove(key) {
            task.abort();
        }
        self.duplex.playout.lock().unwrap().clear_audio(key);
    }

    /// Leaving the room: stop everything remote and clear what was waiting to play.
    pub fn left_room(&self) {
        let keys: Vec<String> = self.pulls.lock().unwrap().keys().cloned().collect();
        for key in keys {
            self.stop_pull(&key);
        }
    }

    /// Closes the sound card entirely.
    pub fn shutdown(&self) {
        let _ = self.set_capturing(false);
        let _ = self.set_playing(false);
        self.left_room();
    }
}
