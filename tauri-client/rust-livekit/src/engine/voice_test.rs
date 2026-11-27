//! The voice test: record a few seconds of your own voice through the real capture chain, then play it back
//! under any voice-tone preset, as often as you like. It exists so the voice can be tuned by ear without a
//! second person or a server: you hear what the cleaned microphone sounds like, and what each preset does to
//! the very same words.
//!
//! What is recorded is the voice just *before* the tone stage (after volume, echo cancellation, noise
//! filtering and gain control, as set in Settings), so every preset is applied to identical audio on replay.
//! It does not include the Opus encode, the network, or anyone else's playback, so it shows what is sent,
//! not exactly what a friend receives. It never opens the call's microphone: it runs its own short-lived
//! streams, and the clip lives in memory only (never written to disk, never sent anywhere).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::voice_fx::BLOCK;

use super::denoise::NoiseFilter;
use super::duplex::Duplex;
use super::io;
use super::processing::ProcessingOptions;
use super::voice_tone::{VoicePreset, VoiceTone};

/// The shortest and longest recording, in seconds.
pub const MIN_SECONDS: u32 = 3;
pub const MAX_SECONDS: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Recording,
    /// A clip is held and can be played.
    Ready,
    Playing,
}

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Recording => "recording",
            Self::Ready => "ready",
            Self::Playing => "playing",
        }
    }
}

/// The player's own audio settings, applied to the recording exactly as they are in a call.
#[derive(Debug, Clone)]
pub struct TestSettings {
    pub input: Option<String>,
    pub output: Option<String>,
    pub mic_gain: f32,
    pub auto_gain: bool,
    pub noise_filter: NoiseFilter,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    pub phase: Phase,
    /// Milliseconds into the recording or the playback.
    pub elapsed_ms: u32,
    /// The length of the recording being made, or of the clip held.
    pub total_ms: u32,
    /// How loud the voice is right now while recording, 0 to 1.
    pub level: f32,
    /// What went wrong last (a device that would not open), cleared by the next start.
    pub error: Option<String>,
}

struct Inner {
    phase: Phase,
    clip: Vec<f32>,
    started: Instant,
    total_ms: u32,
    level: super::capture::Level,
    error: Option<String>,
    /// Stops whichever thread is running.
    stop: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct VoiceTest {
    inner: Arc<Mutex<Inner>>,
}

impl Default for VoiceTest {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                phase: Phase::Idle,
                clip: Vec::new(),
                started: Instant::now(),
                total_ms: 0,
                level: Default::default(),
                error: None,
                stop: Arc::new(AtomicBool::new(false)),
            })),
        }
    }
}

/// Applies a preset to a recorded clip, block by block, as the call would. The last block is padded with
/// silence; a clip that is empty stays empty.
pub fn render(clip: &[f32], preset: VoicePreset) -> Vec<f32> {
    let mut tone = VoiceTone::new(preset);
    let mut out = Vec::with_capacity(clip.len() + BLOCK);
    for chunk in clip.chunks(BLOCK) {
        let mut block = [0.0f32; BLOCK];
        block[..chunk.len()].copy_from_slice(chunk);
        out.extend(tone.process(&block));
    }
    out
}

fn clamp_seconds(seconds: u32) -> u32 {
    seconds.clamp(MIN_SECONDS, MAX_SECONDS)
}

impl VoiceTest {
    pub fn status(&self) -> Status {
        let inner = self.inner.lock().unwrap();
        let elapsed = match inner.phase {
            Phase::Recording | Phase::Playing => inner.started.elapsed().as_millis() as u32,
            _ => 0,
        };
        Status {
            phase: inner.phase,
            elapsed_ms: elapsed.min(inner.total_ms),
            total_ms: inner.total_ms,
            level: if inner.phase == Phase::Recording {
                inner.level.get()
            } else {
                0.0
            },
            error: inner.error.clone(),
        }
    }

    /// Records `seconds` (3 to 10) from the microphone. Replaces any clip already held. Returns at once; the
    /// recording runs on its own thread and [`status`](Self::status) says how it is going.
    pub fn record(&self, seconds: u32, settings: TestSettings) -> Result<(), String> {
        let seconds = clamp_seconds(seconds);
        let stop = {
            let mut inner = self.inner.lock().unwrap();
            if matches!(inner.phase, Phase::Recording | Phase::Playing) {
                return Err("the voice test is already running".into());
            }
            inner.phase = Phase::Recording;
            inner.clip.clear();
            inner.error = None;
            inner.started = Instant::now();
            inner.total_ms = seconds * 1000;
            inner.stop = Arc::new(AtomicBool::new(false));
            inner.stop.clone()
        };

        let this = self.clone();
        std::thread::Builder::new()
            .name("voice-test-record".into())
            .spawn(move || this.run_recording(seconds, settings, stop))
            .map_err(|e| {
                self.fail(e.to_string());
                "could not start the voice test".to_string()
            })?;
        Ok(())
    }

    fn run_recording(&self, seconds: u32, settings: TestSettings, stop: Arc<AtomicBool>) {
        let tap = Arc::new(Mutex::new(Vec::<f32>::new()));
        let duplex = Duplex::new(
            // The same processing as a call: WebRTC's noise suppression only when RNNoise is off.
            ProcessingOptions {
                gain_control: settings.auto_gain,
                noise_suppression: settings.noise_filter == NoiseFilter::Off,
                ..Default::default()
            },
            Box::new(|_| {}),
        );
        {
            let mut capture = duplex.capture.lock().unwrap();
            capture.set_noise_filter(settings.noise_filter);
            capture.set_gain(settings.mic_gain);
            capture.set_tap(Some(tap.clone()));
        }
        // The meter the interface reads is this duplex's own.
        self.inner.lock().unwrap().level = duplex.level.clone();

        let input = match io::start_input(settings.input.as_deref(), duplex.clone()) {
            Ok(running) => running,
            Err(message) => return self.fail(format!("could not open the microphone: {message}")),
        };
        let deadline = Duration::from_secs(u64::from(seconds));
        let began = Instant::now();
        while began.elapsed() < deadline && !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(20));
        }
        input.stop();
        duplex.capture.lock().unwrap().set_tap(None);

        let clip = std::mem::take(&mut *tap.lock().unwrap());
        let mut inner = self.inner.lock().unwrap();
        if stop.load(Ordering::Relaxed) || clip.is_empty() {
            // Stopped early (or nothing arrived): keep what there is, if anything.
            inner.total_ms =
                (clip.len() as u64 * 1000 / u64::from(crate::voice_fx::SAMPLE_RATE)) as u32;
        }
        inner.phase = if clip.is_empty() {
            Phase::Idle
        } else {
            Phase::Ready
        };
        inner.clip = clip;
    }

    /// Plays the held clip through the speakers under `preset`.
    pub fn play(&self, preset: VoicePreset, output: Option<String>) -> Result<(), String> {
        let (clip, stop) = {
            let mut inner = self.inner.lock().unwrap();
            match inner.phase {
                Phase::Ready => {}
                Phase::Idle => return Err("record something first".into()),
                _ => return Err("the voice test is already running".into()),
            }
            inner.phase = Phase::Playing;
            inner.error = None;
            inner.started = Instant::now();
            inner.total_ms =
                (inner.clip.len() as u64 * 1000 / u64::from(crate::voice_fx::SAMPLE_RATE)) as u32;
            inner.stop = Arc::new(AtomicBool::new(false));
            (inner.clip.clone(), inner.stop.clone())
        };

        let this = self.clone();
        std::thread::Builder::new()
            .name("voice-test-play".into())
            .spawn(move || {
                let rendered = render(&clip, preset);
                let result = play_blocks(&rendered, output.as_deref(), &stop);
                let mut inner = this.inner.lock().unwrap();
                if let Err(message) = result {
                    inner.error = Some(message);
                }
                inner.phase = Phase::Ready;
            })
            .map_err(|e| {
                self.inner.lock().unwrap().phase = Phase::Ready;
                e.to_string()
            })?;
        Ok(())
    }

    /// Stops a recording early (keeping what was heard) or a playback.
    pub fn stop(&self) {
        self.inner
            .lock()
            .unwrap()
            .stop
            .store(true, Ordering::Relaxed);
    }

    /// Forgets the clip.
    pub fn clear(&self) {
        self.stop();
        let mut inner = self.inner.lock().unwrap();
        if inner.phase == Phase::Ready {
            inner.phase = Phase::Idle;
        }
        inner.clip.clear();
        inner.total_ms = 0;
    }

    fn fail(&self, message: String) {
        let mut inner = self.inner.lock().unwrap();
        inner.error = Some(message);
        inner.phase = if inner.clip.is_empty() {
            Phase::Idle
        } else {
            Phase::Ready
        };
    }
}

/// Feeds 10 ms blocks to a short-lived output stream in real time, then lets the last of it drain.
fn play_blocks(samples: &[f32], output: Option<&str>, stop: &AtomicBool) -> Result<(), String> {
    let duplex = Duplex::new(
        ProcessingOptions {
            echo_cancellation: false,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        },
        Box::new(|_| {}),
    );
    let running = io::start_output(output, duplex.clone())
        .map_err(|message| format!("could not open the speakers: {message}"))?;
    let began = Instant::now();
    // Three blocks ahead of the clock: the playout mixer waits for a short pre-roll before it starts.
    let mut pushed = 0usize;
    for (index, block) in samples.chunks(BLOCK).enumerate() {
        let due =
            Duration::from_millis(index as u64 * 10).saturating_sub(Duration::from_millis(30));
        while began.elapsed() < due {
            if stop.load(Ordering::Relaxed) {
                running.stop();
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if stop.load(Ordering::Relaxed) {
            break;
        }
        duplex.playout.lock().unwrap().push("voice-test", block);
        pushed += block.len();
    }
    debug_assert!(pushed <= samples.len());
    // The device still holds a little: let it play out before closing.
    let tail = Instant::now();
    while tail.elapsed() < Duration::from_millis(400) && !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(20));
    }
    running.stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(amp: f32, hz: f32, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / 48_000.0).sin())
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn rendering_off_returns_the_clip_unchanged_apart_from_padding() {
        let clip = sine(0.2, 300.0, BLOCK * 3 + 100);
        let out = render(&clip, VoicePreset::Off);
        assert_eq!(out.len(), BLOCK * 4);
        assert_eq!(&out[..clip.len()], &clip[..]);
        assert!(out[clip.len()..].iter().all(|s| *s == 0.0));
    }

    #[test]
    fn the_same_clip_sounds_different_under_each_preset() {
        // A body-range tone, quiet enough for the equaliser alone: Warm adds more low end than Natural.
        let clip = sine(0.01, 120.0, BLOCK * 60);
        let natural = rms(&render(&clip, VoicePreset::Natural)[BLOCK * 30..]);
        let warm = rms(&render(&clip, VoicePreset::Warm)[BLOCK * 30..]);
        let off = rms(&render(&clip, VoicePreset::Off)[BLOCK * 30..]);
        assert!(warm > natural && natural > off);
    }

    #[test]
    fn an_empty_clip_renders_to_nothing() {
        assert!(render(&[], VoicePreset::Broadcast).is_empty());
    }

    #[test]
    fn a_fresh_test_is_idle_and_cannot_play() {
        let test = VoiceTest::default();
        assert_eq!(test.status().phase, Phase::Idle);
        assert!(test.play(VoicePreset::Natural, None).is_err());
    }

    #[test]
    fn the_length_is_kept_between_three_and_ten_seconds() {
        assert_eq!(clamp_seconds(1), 3);
        assert_eq!(clamp_seconds(7), 7);
        assert_eq!(clamp_seconds(60), 10);
    }

    #[test]
    fn clearing_forgets_a_held_clip() {
        let test = VoiceTest::default();
        {
            let mut inner = test.inner.lock().unwrap();
            inner.clip = vec![0.1; BLOCK];
            inner.phase = Phase::Ready;
            inner.total_ms = 10;
        }
        assert_eq!(test.status().phase, Phase::Ready);
        test.clear();
        assert_eq!(test.status().phase, Phase::Idle);
        assert_eq!(test.status().total_ms, 0);
    }

    /// Needs a microphone and speakers: `cargo test -p rust-livekit -- --ignored voice_test_records`.
    #[test]
    #[ignore = "needs a microphone and speakers"]
    fn voice_test_records_and_plays_back() {
        let test = VoiceTest::default();
        test.record(
            3,
            TestSettings {
                input: None,
                output: None,
                mic_gain: 1.0,
                auto_gain: true,
                noise_filter: NoiseFilter::Standard,
            },
        )
        .expect("starts");
        while test.status().phase == Phase::Recording {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(test.status().phase, Phase::Ready);
        test.play(VoicePreset::Natural, None).expect("plays");
        while test.status().phase == Phase::Playing {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(test.status().phase, Phase::Ready);
    }
}
