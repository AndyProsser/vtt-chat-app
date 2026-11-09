use std::sync::mpsc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};

use super::policy::Cue;
use super::synth;
use crate::error::LiveKitError;

/// Plays `cue` on the default output device and returns when it has finished.
///
/// Opens its own short-lived output stream rather than going through the voice playout, so it is
/// independent of whether a room is joined. One consequence, noted in AUDIO-SPIKE-RESULTS.md: the
/// echo canceller doesn't see the cue as far-end audio, so a cue played while the mic is open could
/// leak into it. Cues are about half a second long and the start cue gates capture, so this is
/// acceptable; revisit if acoustic tests say otherwise.
pub fn play_cue_blocking(cue: Cue) -> Result<(), LiveKitError> {
    // With the mixer engine running, the cue plays through it, where the echo canceller can see it.
    if crate::engine::local::play_blocking(
        "local:cue",
        &synth::render(cue, crate::voice_fx::SAMPLE_RATE),
    ) {
        return Ok(());
    }
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| LiveKitError::Audio("no default output device".into()))?;
    let supported = device
        .default_output_config()
        .map_err(|err| LiveKitError::Audio(err.to_string()))?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    // Rendered at the device's own rate, so there is nothing to resample.
    let samples = synth::render(cue, sample_rate);
    let duration = Duration::from_secs_f64(samples.len() as f64 / f64::from(sample_rate));

    let (done_tx, done_rx) = mpsc::channel::<()>();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, channels, samples, done_tx),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, channels, samples, done_tx),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, channels, samples, done_tx),
        other => Err(LiveKitError::Audio(format!(
            "unsupported output sample format: {other:?}"
        ))),
    }?;
    stream
        .play()
        .map_err(|err| LiveKitError::Audio(err.to_string()))?;

    // The callback reports completion; the timeout is only a guard against a stalled device.
    let _ = done_rx.recv_timeout(duration + Duration::from_millis(750));
    // Let the device drain its last buffer before the stream is dropped, or the tail is clipped.
    std::thread::sleep(Duration::from_millis(60));
    Ok(())
}

/// Fire-and-forget: plays on a background thread so a hotkey or event handler never blocks.
pub fn play_cue(cue: Cue) {
    std::thread::spawn(move || {
        if let Err(err) = play_cue_blocking(cue) {
            eprintln!("[rust-livekit] could not play the {cue:?} cue: {err}");
        }
    });
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    samples: Vec<f32>,
    done: mpsc::Sender<()>,
) -> Result<cpal::Stream, LiveKitError>
where
    T: Sample + SizedSample + FromSample<f32> + Send + 'static,
{
    let mut position = 0usize;
    let mut finished = false;
    device
        .build_output_stream(
            *config,
            move |data: &mut [T], _| {
                for frame in data.chunks_mut(channels) {
                    let sample = samples.get(position).copied().unwrap_or(0.0);
                    position += 1;
                    let value = T::from_sample(sample);
                    for slot in frame.iter_mut() {
                        *slot = value;
                    }
                }
                if position >= samples.len() && !finished {
                    finished = true;
                    let _ = done.send(());
                }
            },
            |err| eprintln!("[rust-livekit] cue output stream error: {err}"),
            None,
        )
        .map_err(|err| LiveKitError::Audio(err.to_string()))
}
