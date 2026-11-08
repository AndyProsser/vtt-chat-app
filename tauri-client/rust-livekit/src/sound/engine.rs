//! Puts the mixer on the speakers. One background thread owns the output stream (cpal streams must
//! stay on the thread that made them) and opens it only while something is playing: at rest there is
//! no stream, no device held open, and the thread sleeps on a channel — "quiet when idle".

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};

use super::mixer::Mixer;
use crate::error::LiveKitError;

/// How long the output stays open after the last sound ends (avoids reopening for a run of effects).
const LINGER: Duration = Duration::from_secs(3);

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
}

/// A handle to the sound thread; cheap to clone and share.
#[derive(Clone)]
pub struct SoundEngine {
    tx: mpsc::Sender<Command>,
}

/// The default output device's sample rate, which clips are resampled to; `None` if there is no device.
pub fn output_sample_rate() -> Option<u32> {
    cpal::default_host()
        .default_output_device()?
        .default_output_config()
        .ok()
        .map(|c| c.sample_rate().0)
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
}

fn run(rx: mpsc::Receiver<Command>) {
    let mixer = Arc::new(Mutex::new(Mixer::new()));
    let mut stream: Option<cpal::Stream> = None;
    let mut idle_since: Option<Instant> = None;

    loop {
        // Asleep on the channel when there is no stream; ticking only while one is open.
        let command = if stream.is_some() {
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

        if let Some(command) = command {
            let mut m = mixer.lock().unwrap_or_else(|e| e.into_inner());
            match command {
                Command::Play {
                    id,
                    clip,
                    looping,
                    gain,
                } => m.play(&id, clip, looping, gain),
                Command::Stop(id) => m.stop(&id),
                Command::StopAll => m.stop_all(),
                Command::Master(v) => m.set_master(v),
            }
            drop(m);
        }

        let idle = mixer.lock().unwrap_or_else(|e| e.into_inner()).is_idle();
        if !idle {
            idle_since = None;
            if stream.is_none() {
                match open(Arc::clone(&mixer)) {
                    Ok(s) => stream = Some(s),
                    Err(err) => {
                        eprintln!("[rust-livekit] soundboard output unavailable: {err}");
                        mixer.lock().unwrap_or_else(|e| e.into_inner()).stop_all();
                    }
                }
            }
        } else if stream.is_some() {
            let since = *idle_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= LINGER {
                stream = None; // drops the stream and releases the device
                idle_since = None;
            }
        }
    }
}

fn open(mixer: Arc<Mutex<Mixer>>) -> Result<cpal::Stream, LiveKitError> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| LiveKitError::Audio("no default output device".into()))?;
    let supported = device
        .default_output_config()
        .map_err(|e| LiveKitError::Audio(e.to_string()))?;
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, channels, mixer),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, channels, mixer),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, channels, mixer),
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
    mixer: Arc<Mutex<Mixer>>,
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
                // `try_lock`: if a command holds the mixer for an instant, play silence rather than
                // block the audio callback.
                match mixer.try_lock() {
                    Ok(mut m) => m.fill(&mut scratch),
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

    /// Opens the real output device and plays half a second of tone:
    /// `cargo test -p rust-livekit -- --ignored live_`. Proves the stream opens and drains; whether it
    /// is audible is for a person to judge.
    #[test]
    #[ignore = "needs an audio output device"]
    fn live_tone_plays_through_the_default_device() {
        let rate = output_sample_rate().expect("an output device");
        let tone: Vec<f32> = (0..rate / 2)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.2)
            .collect();
        let engine = SoundEngine::spawn();
        engine.play("tone", Arc::new(tone), false, 1.0);
        std::thread::sleep(Duration::from_millis(900));
        engine.stop_all();
    }
}
