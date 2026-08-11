use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample};
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::AudioSourceOptions;
use tokio::sync::mpsc;

use super::FRAME_DURATION_MS;
use crate::error::LiveKitError;

const NUM_CHANNELS: u32 = 1;

/// Opens the default input device, downmixes to mono, and forwards 10ms frames to a
/// freshly created `NativeAudioSource`. The source is built from whatever sample rate the
/// device actually negotiates (not a hardcoded rate) — `capture_frame` rejects every frame
/// outright if its rate doesn't exactly match the source's, so the two must never be chosen
/// independently. Runs the cpal stream on a dedicated OS thread — `cpal::Stream` isn't `Send`
/// on every platform, so it must be created and kept alive on the thread that owns it.
///
/// `muted` gates capture locally: while set, assembled frames are dropped instead of pushed
/// to the source. This is the source of truth for whether audio actually leaves this machine.
/// `LocalAudioTrack::mute()` is *also* set by the caller, but only as advisory remote state —
/// it carries a server round-trip, so relying on it alone would clip the first ~100-200ms of
/// every push-to-talk press. See the Stage 2 spec, Amendment B.
pub fn spawn_microphone_capture(
    runtime: tokio::runtime::Handle,
    muted: Arc<AtomicBool>,
) -> Result<(NativeAudioSource, std::thread::JoinHandle<()>), LiveKitError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| LiveKitError::Audio("no default input device".into()))?;
    let supported_config = device
        .default_input_config()
        .map_err(|err| LiveKitError::Audio(err.to_string()))?;

    let sample_rate = supported_config.sample_rate().0;
    let input_channels = supported_config.channels() as usize;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();

    let source = NativeAudioSource::new(
        AudioSourceOptions::default(),
        sample_rate,
        NUM_CHANNELS,
        1_000,
    );

    let samples_per_frame = (sample_rate / 1000 * FRAME_DURATION_MS) as usize;
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<i16>>();

    let capture_source = source.clone();
    let handle = std::thread::spawn(move || {
        let stream = match build_stream(&device, &config, sample_format, input_channels, tx) {
            Ok(stream) => stream,
            Err(err) => {
                eprintln!("[rust-livekit] failed to build input stream: {err}");
                return;
            }
        };
        if let Err(err) = stream.play() {
            eprintln!("[rust-livekit] failed to start input stream: {err}");
            return;
        }

        let mut pending: Vec<i16> = Vec::with_capacity(samples_per_frame);
        while let Some(chunk) = rx.blocking_recv() {
            pending.extend_from_slice(&chunk);
            while pending.len() >= samples_per_frame {
                let frame_samples: Vec<i16> = pending.drain(..samples_per_frame).collect();
                // Drain first, then drop — skipping the drain would let `pending` grow
                // without bound for the whole time the mic is muted.
                if muted.load(Ordering::Relaxed) {
                    continue;
                }
                let frame = AudioFrame {
                    data: frame_samples.into(),
                    sample_rate,
                    num_channels: NUM_CHANNELS,
                    samples_per_channel: samples_per_frame as u32,
                };
                if let Err(err) = runtime.block_on(capture_source.capture_frame(&frame)) {
                    eprintln!("[rust-livekit] capture_frame failed: {err}");
                }
            }
        }
        // Stream is dropped (and stops) once this thread exits.
    });

    Ok((source, handle))
}

fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    input_channels: usize,
    tx: mpsc::UnboundedSender<Vec<i16>>,
) -> Result<cpal::Stream, LiveKitError> {
    let err_fn = |err: cpal::StreamError| eprintln!("[rust-livekit] input stream error: {err}");

    match sample_format {
        cpal::SampleFormat::I16 => {
            build_typed_stream::<i16>(device, config, input_channels, tx, err_fn)
        }
        cpal::SampleFormat::U16 => {
            build_typed_stream::<u16>(device, config, input_channels, tx, err_fn)
        }
        cpal::SampleFormat::F32 => {
            build_typed_stream::<f32>(device, config, input_channels, tx, err_fn)
        }
        other => Err(LiveKitError::Audio(format!(
            "unsupported input sample format: {other:?}"
        ))),
    }
}

fn build_typed_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    input_channels: usize,
    tx: mpsc::UnboundedSender<Vec<i16>>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, LiveKitError>
where
    T: Sample + cpal::SizedSample + Send + 'static,
    i16: FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mono: Vec<i16> = if input_channels <= 1 {
                    data.iter().map(|s| i16::from_sample(*s)).collect()
                } else {
                    data.chunks(input_channels)
                        .map(|frame| {
                            let sum: i32 = frame.iter().map(|s| i16::from_sample(*s) as i32).sum();
                            (sum / input_channels as i32) as i16
                        })
                        .collect()
                };
                let _ = tx.send(mono);
            },
            err_fn,
            None,
        )
        .map_err(|err| LiveKitError::Audio(err.to_string()))
}
