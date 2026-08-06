use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample};
use futures::StreamExt;
use livekit::track::RemoteAudioTrack;
use livekit::webrtc::audio_stream::native::NativeAudioStream;

use crate::error::LiveKitError;

/// Subscribes to `track`'s decoded frames and plays them on the default output device.
/// Mirrors `capture`'s dedicated-thread pattern for the same `cpal::Stream` Send reasons.
pub fn spawn_remote_playback(track: RemoteAudioTrack) -> Result<(), LiveKitError> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| LiveKitError::Audio("no default output device".into()))?;
    let supported_config = device
        .default_output_config()
        .map_err(|err| LiveKitError::Audio(err.to_string()))?;

    let output_sample_rate = supported_config.sample_rate().0;
    let output_channels = supported_config.channels() as usize;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();

    let buffer: Arc<Mutex<VecDeque<i16>>> = Arc::new(Mutex::new(VecDeque::new()));
    let decode_buffer = buffer.clone();

    let rtc_track = track.rtc_track();
    tokio::spawn(async move {
        let mut audio_stream = NativeAudioStream::new(rtc_track, output_sample_rate as i32, 1);
        // Bound retention so a slow/absent output device can't grow this unbounded.
        let max_len = output_sample_rate as usize * 2; // ~2s
        while let Some(frame) = audio_stream.next().await {
            let mut buf = decode_buffer.lock().unwrap();
            buf.extend(frame.data.as_ref().iter().copied());
            if buf.len() > max_len {
                let drop_count = buf.len() - max_len;
                buf.drain(..drop_count);
            }
        }
    });

    std::thread::spawn(move || {
        let stream =
            match build_output_stream(&device, &config, sample_format, output_channels, buffer) {
                Ok(stream) => stream,
                Err(err) => {
                    eprintln!("[rust-livekit] failed to build output stream: {err}");
                    return;
                }
            };
        if let Err(err) = stream.play() {
            eprintln!("[rust-livekit] failed to start output stream: {err}");
            return;
        }
        // Keep the stream (and this thread) alive for as long as the track is subscribed.
        loop {
            std::thread::park();
        }
    });

    Ok(())
}

fn build_output_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    output_channels: usize,
    buffer: Arc<Mutex<VecDeque<i16>>>,
) -> Result<cpal::Stream, LiveKitError> {
    let err_fn = |err: cpal::StreamError| eprintln!("[rust-livekit] output stream error: {err}");

    match sample_format {
        cpal::SampleFormat::I16 => {
            build_typed_output::<i16>(device, config, output_channels, buffer, err_fn)
        }
        cpal::SampleFormat::U16 => {
            build_typed_output::<u16>(device, config, output_channels, buffer, err_fn)
        }
        cpal::SampleFormat::F32 => {
            build_typed_output::<f32>(device, config, output_channels, buffer, err_fn)
        }
        other => Err(LiveKitError::Audio(format!(
            "unsupported output sample format: {other:?}"
        ))),
    }
}

fn build_typed_output<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    output_channels: usize,
    buffer: Arc<Mutex<VecDeque<i16>>>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, LiveKitError>
where
    T: Sample + cpal::SizedSample + FromSample<i16> + Send + 'static,
{
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let mut buf = buffer.lock().unwrap();
                for frame in data.chunks_mut(output_channels) {
                    let sample = buf.pop_front().unwrap_or(0);
                    let converted = T::from_sample(sample);
                    for slot in frame.iter_mut() {
                        *slot = converted;
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|err| LiveKitError::Audio(err.to_string()))
}
