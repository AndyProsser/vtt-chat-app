//! Plays the mixer, on its own clock. The mixer runs at 48 kHz mono in 10 ms blocks (WebRTC's block),
//! and every block goes to up to two places:
//!
//! - the **sink**: the DM's published "soundboard" track, so every player hears the effect through
//!   the call itself. That is what fixes the echo: WebRTC knows what it plays, so a player on speakers
//!   is not heard saying it back, which a separate local player never allowed (docs/architecture/TABLE-FEATURES.md);
//! - the **monitor**: the local speakers/headphones, so the DM hears it too (it can be turned off).
//!
//! One background thread owns the clock and the output stream (cpal streams must stay on the thread
//! that made them). It sleeps on a channel when nothing plays, and the output device is opened only
//! while something plays: "quiet when idle".

use std::collections::VecDeque;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};

use super::mixer::Mixer;
use crate::error::LiveKitError;

/// The rate the whole sound path runs at, and the length of one block.
pub const SAMPLE_RATE: u32 = 48_000;
pub const BLOCK: usize = 480;
const BLOCK_TIME: Duration = Duration::from_millis(10);

/// How long the monitor output stays open after the last sound ends.
const LINGER: Duration = Duration::from_secs(3);
/// The monitor never queues more than this much (a stalled device must not grow memory).
const MONITOR_MAX_SAMPLES: usize = SAMPLE_RATE as usize / 5;

/// Receives each 480-sample block of the mix (called on the sound thread; must not block for long).
pub type SoundSink = Arc<dyn Fn(&[f32]) + Send + Sync>;

/// How many blocks are due given the time since the first one, and how many were already made.
/// Capped, so a long stall (the machine slept) skips ahead rather than bursting out seconds of audio.
pub fn due_blocks(elapsed: Duration, produced: u64) -> u64 {
    const CATCH_UP: u64 = 5;
    let should_have = (elapsed.as_micros() / BLOCK_TIME.as_micros()) as u64 + 1;
    should_have.saturating_sub(produced).min(CATCH_UP)
}

/// 48 kHz samples waiting for the monitor stream, read out at the device's own rate.
#[derive(Default)]
pub struct MonitorRing {
    samples: VecDeque<f32>,
    /// Fractional read position between `samples[0]` and `samples[1]`.
    phase: f64,
}

impl MonitorRing {
    pub fn push_block(&mut self, block: &[f32]) {
        self.samples.extend(block.iter().copied());
        while self.samples.len() > MONITOR_MAX_SAMPLES {
            self.samples.pop_front();
        }
    }

    /// Fills `out` at `device_rate` (linear interpolation); silence when the queue runs dry.
    pub fn pull(&mut self, out: &mut [f32], device_rate: u32) {
        let step = SAMPLE_RATE as f64 / device_rate as f64;
        for slot in out.iter_mut() {
            if self.samples.len() < 2 {
                *slot = 0.0;
                continue;
            }
            let (a, b) = (self.samples[0], self.samples[1]);
            *slot = a + (b - a) * self.phase as f32;
            self.phase += step;
            let whole = self.phase.floor() as usize;
            self.phase -= whole as f64;
            for _ in 0..whole.min(self.samples.len()) {
                self.samples.pop_front();
            }
        }
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

enum Command {
    Play {
        id: String,
        clip: Arc<Vec<f32>>,
        looping: bool,
        gain: f32,
    },
    Stop(String),
    StopAll,
    Master(f32),
    Sink(Option<SoundSink>),
    Monitor(bool),
}

/// A handle to the sound thread; cheap to clone and share.
#[derive(Clone)]
pub struct SoundEngine {
    tx: mpsc::Sender<Command>,
}

impl SoundEngine {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("soundboard".into())
            .spawn(move || run(rx))
            .expect("spawn soundboard thread");
        Self { tx }
    }

    /// `clip` must be mono at [`SAMPLE_RATE`].
    pub fn play(&self, id: &str, clip: Arc<Vec<f32>>, looping: bool, gain: f32) {
        let _ = self.tx.send(Command::Play {
            id: id.to_string(),
            clip,
            looping,
            gain,
        });
    }

    pub fn stop(&self, id: &str) {
        let _ = self.tx.send(Command::Stop(id.to_string()));
    }

    pub fn stop_all(&self) {
        let _ = self.tx.send(Command::StopAll);
    }

    pub fn set_master(&self, master: f32) {
        let _ = self.tx.send(Command::Master(master));
    }

    /// Where to send the mix for the whole table to hear (the published soundboard track), or none.
    pub fn set_sink(&self, sink: Option<SoundSink>) {
        let _ = self.tx.send(Command::Sink(sink));
    }

    /// Whether this machine's own speakers play it too.
    pub fn set_monitor(&self, on: bool) {
        let _ = self.tx.send(Command::Monitor(on));
    }
}

fn run(rx: mpsc::Receiver<Command>) {
    let mut mixer = Mixer::new();
    let ring = Arc::new(Mutex::new(MonitorRing::default()));
    let mut sink: Option<SoundSink> = None;
    let mut monitor = true;
    let mut stream: Option<cpal::Stream> = None;
    let mut started: Option<Instant> = None;
    let mut produced: u64 = 0;
    let mut idle_since: Option<Instant> = None;
    let mut block = vec![0.0f32; BLOCK];

    loop {
        // Asleep on the channel when nothing plays and no stream is open; ticking otherwise.
        let command = if let (false, Some(t0)) = (mixer.is_idle(), started) {
            let next = BLOCK_TIME * (produced as u32 + 1);
            let wait = next
                .saturating_sub(t0.elapsed())
                .max(Duration::from_millis(1));
            match rx.recv_timeout(wait) {
                Ok(c) => Some(c),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        } else if stream.is_some() {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(c) => Some(c),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        } else {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => return,
            }
        };

        match command {
            Some(Command::Play {
                id,
                clip,
                looping,
                gain,
            }) => mixer.play(&id, clip, looping, gain),
            Some(Command::Stop(id)) => mixer.stop(&id),
            Some(Command::StopAll) => mixer.stop_all(),
            Some(Command::Master(v)) => mixer.set_master(v),
            Some(Command::Sink(s)) => sink = s,
            Some(Command::Monitor(on)) => {
                monitor = on;
                if !on {
                    stream = None;
                    *ring.lock().unwrap_or_else(|e| e.into_inner()) = MonitorRing::default();
                }
            }
            None => {}
        }

        if mixer.is_idle() {
            started = None;
            produced = 0;
            if stream.is_some() {
                let since = *idle_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= LINGER {
                    stream = None; // drops the stream and releases the device
                    idle_since = None;
                }
            }
            continue;
        }

        idle_since = None;
        let t0 = *started.get_or_insert_with(Instant::now);
        for _ in 0..due_blocks(t0.elapsed(), produced) {
            mixer.fill(&mut block);
            if let Some(sink) = &sink {
                sink(&block);
            }
            if monitor {
                ring.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push_block(&block);
            }
            produced += 1;
        }
        if monitor && stream.is_none() {
            match open(Arc::clone(&ring)) {
                Ok(s) => stream = Some(s),
                Err(err) => {
                    eprintln!("[rust-livekit] soundboard monitor unavailable: {err}");
                    monitor = false; // the table still hears it through the sink
                }
            }
        }
    }
}

fn open(ring: Arc<Mutex<MonitorRing>>) -> Result<cpal::Stream, LiveKitError> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| LiveKitError::Audio("no default output device".into()))?;
    let supported = device
        .default_output_config()
        .map_err(|e| LiveKitError::Audio(e.to_string()))?;
    let channels = supported.channels() as usize;
    let rate = supported.sample_rate().0;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, channels, rate, ring),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, channels, rate, ring),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, channels, rate, ring),
        other => Err(LiveKitError::Audio(format!(
            "unsupported output sample format: {other:?}"
        ))),
    }?;
    stream
        .play()
        .map_err(|e| LiveKitError::Audio(e.to_string()))?;
    Ok(stream)
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    rate: u32,
    ring: Arc<Mutex<MonitorRing>>,
) -> Result<cpal::Stream, LiveKitError>
where
    T: Sample + SizedSample + FromSample<f32> + Send + 'static,
{
    let mut scratch: Vec<f32> = Vec::new();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let frames = data.len() / channels;
                scratch.resize(frames, 0.0);
                // `try_lock`: if the sound thread holds the ring for an instant, play silence rather
                // than block the audio callback.
                match ring.try_lock() {
                    Ok(mut r) => r.pull(&mut scratch, rate),
                    Err(_) => scratch.fill(0.0),
                }
                for (frame, value) in data.chunks_mut(channels).zip(&scratch) {
                    let v = T::from_sample(*value);
                    for slot in frame.iter_mut() {
                        *slot = v;
                    }
                }
            },
            |err| eprintln!("[rust-livekit] soundboard output stream error: {err}"),
            None,
        )
        .map_err(|e| LiveKitError::Audio(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_are_made_on_the_clock_and_a_stall_does_not_burst() {
        assert_eq!(due_blocks(Duration::ZERO, 0), 1);
        assert_eq!(due_blocks(Duration::from_millis(9), 1), 0);
        assert_eq!(due_blocks(Duration::from_millis(10), 1), 1);
        assert_eq!(due_blocks(Duration::from_millis(35), 1), 3);
        assert_eq!(due_blocks(Duration::from_secs(30), 0), 5, "capped catch-up");
    }

    #[test]
    fn the_monitor_passes_48k_straight_through() {
        let mut ring = MonitorRing::default();
        ring.push_block(&[0.1, 0.2, 0.3, 0.4, 0.5]);
        let mut out = [0.0; 3];
        ring.pull(&mut out, 48_000);
        assert_eq!(out, [0.1, 0.2, 0.3]);
    }

    #[test]
    fn the_monitor_resamples_to_the_device_rate() {
        let mut ring = MonitorRing::default();
        ring.push_block(&(0..4800).map(|i| i as f32 / 4800.0).collect::<Vec<_>>());
        let mut out = vec![0.0; 2205]; // 44.1 kHz for 0.05 s
        ring.pull(&mut out, 44_100);
        assert!(out.windows(2).all(|w| w[1] >= w[0]), "a ramp stays a ramp");
        assert!((out[2204] - 0.4999).abs() < 0.01, "{}", out[2204]);
        // 2205 output samples at 44.1 kHz consume 2400 input samples.
        assert!(
            (ring.len() as i64 - (4800 - 2400)).abs() <= 2,
            "{}",
            ring.len()
        );
    }

    #[test]
    fn an_empty_monitor_plays_silence_and_a_stalled_one_stays_bounded() {
        let mut ring = MonitorRing::default();
        let mut out = [1.0; 4];
        ring.pull(&mut out, 48_000);
        assert_eq!(out, [0.0; 4]);
        for _ in 0..100 {
            ring.push_block(&[0.5; BLOCK]);
        }
        assert!(ring.len() <= MONITOR_MAX_SAMPLES);
        assert!(!ring.is_empty());
    }

    /// Plays half a second of tone through the whole path: `cargo test -p rust-livekit -- --ignored live_`.
    /// The sink must receive 10 ms blocks on a steady clock; whether the speakers are audible is for a
    /// person to judge.
    #[test]
    #[ignore = "needs an audio output device"]
    fn live_tone_goes_to_the_sink_and_the_speakers() {
        let blocks = Arc::new(Mutex::new(0usize));
        let seen = Arc::clone(&blocks);
        let engine = SoundEngine::spawn();
        engine.set_sink(Some(Arc::new(move |b: &[f32]| {
            assert_eq!(b.len(), BLOCK);
            *seen.lock().unwrap() += 1;
        })));
        let tone: Vec<f32> = (0..SAMPLE_RATE / 2)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.2)
            .collect();
        engine.play("tone", Arc::new(tone), false, 1.0);
        std::thread::sleep(Duration::from_millis(900));
        let n = *blocks.lock().unwrap();
        assert!(
            (45..=55).contains(&n),
            "expected ~50 blocks of 10 ms, got {n}"
        );
        engine.stop_all();
    }

    /// The whole injection path against a real LiveKit server: a DM client publishes the soundboard
    /// track and the engine feeds it a 440 Hz tone. Run `node scripts/dev/listen-soundboard.ts` first
    /// (it waits for the track and reports what it heard), then:
    /// `VTT_TEST_URL=ws://127.0.0.1:7880 VTT_TEST_TOKEN=<dm voice token> cargo test -p rust-livekit -- --ignored the_soundboard_track`
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a LiveKit server, a DM token and the listener script"]
    async fn the_soundboard_track_reaches_other_participants() {
        let url = std::env::var("VTT_TEST_URL").expect("VTT_TEST_URL");
        let token = std::env::var("VTT_TEST_TOKEN").expect("VTT_TEST_TOKEN");
        let client =
            crate::LiveKitClient::connect(&url, &token, Arc::new(|_| {}), Arc::new(|_| {}))
                .await
                .expect("connect");
        let sink = client
            .voice_control()
            .sound_sink()
            .await
            .expect("publish the soundboard track");
        let engine = SoundEngine::spawn();
        engine.set_monitor(false);
        engine.set_sink(Some(sink));
        let tone: Vec<f32> = (0..SAMPLE_RATE * 6)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.4)
            .collect();
        // Give the listener time to subscribe, then play.
        tokio::time::sleep(Duration::from_secs(4)).await;
        engine.play("tone", Arc::new(tone), false, 1.0);
        tokio::time::sleep(Duration::from_secs(8)).await;
        engine.stop_all();
        client.disconnect().await.ok();
    }
}
