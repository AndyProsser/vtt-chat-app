//! Chooses between the two microphone paths (see `voice_fx::plan`) and runs the effect one.

use std::sync::{Arc, Mutex};

use livekit::track::LocalAudioTrack;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::PlatformAudio;

use crate::voice_fx::capture::FxCapture;
use crate::voice_fx::plan::plan;
use crate::voice_fx::{Voice, SAMPLE_RATE};

pub(crate) struct VoicePath {
    voice: Mutex<Voice>,
    source: NativeAudioSource,
    /// The running effect capture and the voice it was started with.
    capture: Mutex<Option<(Voice, FxCapture)>>,
    runtime: tokio::runtime::Handle,
}

impl VoicePath {
    pub(crate) fn new(runtime: tokio::runtime::Handle) -> Arc<Self> {
        let source = NativeAudioSource::new(
            // Noise suppression and gain only: echo cancellation needs the speaker reference, which
            // this path does not have (the documented cost of a character voice).
            AudioSourceOptions {
                echo_cancellation: false,
                noise_suppression: true,
                auto_gain_control: true,
            },
            SAMPLE_RATE,
            1,
            100,
        );
        Arc::new(Self {
            voice: Mutex::new(Voice::Normal),
            source,
            capture: Mutex::new(None),
            runtime,
        })
    }

    pub(crate) fn voice(&self) -> Voice {
        *self.voice.lock().unwrap()
    }

    pub(crate) fn set_voice(&self, voice: Voice) {
        *self.voice.lock().unwrap() = voice;
    }

    pub(crate) fn rtc_source(&self) -> RtcAudioSource {
        RtcAudioSource::Native(self.source.clone())
    }

    /// Makes the running paths match `plan(muted, voice)`. If the effect microphone cannot start,
    /// falls back to the normal voice (a silent DM is worse than the wrong voice) and says so.
    pub(crate) fn apply(
        &self,
        audio: &PlatformAudio,
        mic: Option<&LocalAudioTrack>,
        fx: Option<&LocalAudioTrack>,
        muted: bool,
    ) -> Result<(), String> {
        let wanted = plan(muted, self.voice());
        let mut error = None;
        let mut fx_on = wanted.fx_mic;
        if wanted.fx_mic {
            let voice = self.voice();
            let mut capture = self.capture.lock().unwrap();
            let current = capture.as_ref().map(|(v, _)| *v);
            if current != Some(voice) {
                if let Some((_, old)) = capture.take() {
                    old.stop();
                }
                match FxCapture::start(self.source.clone(), voice, self.runtime.clone()) {
                    Ok(started) => *capture = Some((voice, started)),
                    Err(message) => {
                        error = Some(message);
                        fx_on = false;
                    }
                }
            }
        } else if let Some((_, old)) = self.capture.lock().unwrap().take() {
            old.stop();
        }
        let platform_on = wanted.platform_mic || (wanted.fx_mic && !fx_on);
        if error.is_some() {
            self.set_voice(Voice::Normal);
        }

        if platform_on {
            if let Err(err) = audio.start_recording() {
                eprintln!("[rust-livekit] could not start the capture device: {err}");
            }
            if let Some(t) = mic {
                t.unmute();
            }
        } else {
            if let Some(t) = mic {
                t.mute();
            }
            if let Err(err) = audio.stop_recording() {
                eprintln!("[rust-livekit] could not release the capture device: {err}");
            }
        }
        if let Some(t) = fx {
            if fx_on {
                t.unmute();
            } else {
                t.mute();
            }
        }
        error.map_or(Ok(()), Err)
    }
}
