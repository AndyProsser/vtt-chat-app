//! Our own microphone capture, used only while a character voice is on: cpal → mono 48 kHz →
//! [`VoiceFx`] → LiveKit's `NativeAudioSource`. (WebRTC's platform capture, used for the normal
//! voice, gives no access to samples, so an effect cannot be inserted there.)

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;

use super::{Voice, VoiceFx, BLOCK, SAMPLE_RATE};

/// Interleaved device samples → mono at 48 kHz (channels averaged, linear resample).
pub fn to_mono_48k(input: &[f32], channels: usize, rate: u32) -> Vec<f32> {
    let channels = channels.max(1);
    let mono: Vec<f32> = input
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    if rate == SAMPLE_RATE || mono.is_empty() {
        return mono;
    }
    let ratio = rate as f64 / SAMPLE_RATE as f64;
    let out_len = (mono.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos as usize;
            let i1 = (i0 + 1).min(mono.len() - 1);
            let frac = (pos - i0 as f64) as f32;
            mono[i0] * (1.0 - frac) + mono[i1] * frac
        })
        .collect()
}

/// Collects samples into whole 10 ms blocks.
#[derive(Default)]
pub struct Blocker {
    pending: VecDeque<f32>,
}

impl Blocker {
    pub fn push(&mut self, samples: &[f32]) {
        self.pending.extend(samples.iter().copied());
    }

    pub fn next_block(&mut self) -> Option<Vec<f32>> {
        (self.pending.len() >= BLOCK).then(|| self.pending.drain(..BLOCK).collect())
    }
}

pub fn to_i16(block: &[f32]) -> Vec<i16> {
    block
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect()
}

/// A running capture; dropping or [`stop`](FxCapture::stop)ping it releases the microphone.
pub struct FxCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl FxCapture {
    /// Starts capturing the default input device through `voice` into `source`. `runtime` drives
    /// the async `capture_frame` from the capture thread.
    pub fn start(
        source: NativeAudioSource,
        voice: Voice,
        runtime: tokio::runtime::Handle,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let thread_stop = stop.clone();
        let thread = std::thread::Builder::new()
            .name("voice-fx-capture".into())
            .spawn(move || run(source, voice, runtime, thread_stop, ready_tx))
            .map_err(|e| e.to_string())?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(message)
            }
            Err(_) => Err("the microphone did not start in time".into()),
        }
    }

    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for FxCapture {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn run(
    source: NativeAudioSource,
    voice: Voice,
    runtime: tokio::runtime::Handle,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) {
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    // The stream is not `Send`, so it is built, played and dropped on this thread.
    let stream = match open_input(samples.clone()) {
        Ok(stream) => stream,
        Err(message) => {
            let _ = ready.send(Err(message));
            return;
        }
    };
    let _ = ready.send(Ok(()));

    let mut fx = VoiceFx::new(voice);
    let mut blocker = Blocker::default();
    let mut out = vec![0.0f32; BLOCK];
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(5));
        let drained: Vec<f32> = std::mem::take(&mut *samples.lock().unwrap());
        blocker.push(&drained);
        while let Some(block) = blocker.next_block() {
            fx.process(&block, &mut out);
            let frame = AudioFrame {
                data: to_i16(&out).into(),
                sample_rate: SAMPLE_RATE,
                num_channels: 1,
                samples_per_channel: BLOCK as u32,
            };
            if let Err(err) = runtime.block_on(source.capture_frame(&frame)) {
                eprintln!("[voice-fx] could not send audio: {err}");
            }
        }
    }
    drop(stream);
    source.clear_buffer();
}

fn open_input(sink: Arc<Mutex<Vec<f32>>>) -> Result<cpal::Stream, String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("no microphone found")?;
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let (channels, rate) = (config.channels() as usize, config.sample_rate());
    let on_error = |err| eprintln!("[voice-fx] input stream error: {err}");
    let push = move |mono: Vec<f32>| {
        let mut sink = sink.lock().unwrap();
        // Never let a stalled consumer grow the queue without bound (1 s is plenty).
        if sink.len() < SAMPLE_RATE as usize {
            sink.extend(mono);
        }
    };
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config.into(),
            move |data: &[f32], _| push(to_mono_48k(data, channels, rate)),
            on_error,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            config.into(),
            move |data: &[i16], _| {
                let f: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                push(to_mono_48k(&f, channels, rate))
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            config.into(),
            move |data: &[u16], _| {
                let f: Vec<f32> = data
                    .iter()
                    .map(|s| (*s as f32 - 32768.0) / 32768.0)
                    .collect();
                push(to_mono_48k(&f, channels, rate))
            },
            on_error,
            None,
        ),
        other => return Err(format!("unsupported microphone format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_is_averaged_to_mono_and_48k_passes_through() {
        assert_eq!(
            to_mono_48k(&[1.0, 0.0, 0.5, 0.5], 2, 48_000),
            vec![0.5, 0.5]
        );
        assert_eq!(
            to_mono_48k(&[0.1, 0.2, 0.3], 1, 48_000),
            vec![0.1, 0.2, 0.3]
        );
    }

    #[test]
    fn a_44_1k_input_is_resampled_to_the_right_length_and_keeps_its_shape() {
        let input: Vec<f32> = (0..4410).map(|i| i as f32 / 4410.0).collect(); // a ramp, 0.1 s
        let out = to_mono_48k(&input, 1, 44_100);
        assert!((out.len() as i64 - 4800).abs() <= 2, "{}", out.len());
        assert!(out.windows(2).all(|w| w[1] >= w[0]), "a ramp stays a ramp");
        assert!((out[out.len() - 1] - 1.0).abs() < 0.01);
    }

    #[test]
    fn nothing_in_nothing_out() {
        assert!(to_mono_48k(&[], 2, 44_100).is_empty());
    }

    #[test]
    fn blocker_releases_only_whole_ten_millisecond_blocks_in_order() {
        let mut b = Blocker::default();
        b.push(&vec![0.5; 300]);
        assert!(b.next_block().is_none());
        b.push(&vec![0.25; 700]);
        let first = b.next_block().unwrap();
        assert_eq!(first.len(), BLOCK);
        assert_eq!(first[0], 0.5);
        assert_eq!(first[479], 0.25);
        assert!(b.next_block().is_some(), "1000 samples hold two blocks");
        assert!(b.next_block().is_none());
    }

    #[test]
    fn conversion_to_i16_clamps_and_scales() {
        assert_eq!(
            to_i16(&[0.0, 1.0, -1.0, 2.0, -3.0]),
            vec![0, 32767, -32767, 32767, -32767]
        );
    }

    /// Needs a real microphone: `cargo test -p rust-livekit -- --ignored microphone`.
    #[test]
    #[ignore = "needs a microphone"]
    fn the_default_microphone_starts_runs_and_releases() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let source = NativeAudioSource::new(
            livekit::webrtc::audio_source::AudioSourceOptions::default(),
            SAMPLE_RATE,
            1,
            100,
        );
        let capture = FxCapture::start(source, Voice::Giant, runtime.handle().clone())
            .expect("the microphone should start");
        std::thread::sleep(Duration::from_millis(1500));
        capture.stop();
    }
}
