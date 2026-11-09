//! The sound card, through cpal. Each stream lives on its own thread (cpal streams must stay on the
//! thread that made them) and is closed by stopping that thread, so stopping the input really releases
//! the microphone and the OS "microphone in use" light goes out.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::duplex::Duplex;
use crate::devices::{DeviceEntry, DeviceList};

/// A running stream; dropping or [`stop`](Running::stop)ping it closes the device.
pub struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
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

impl Drop for Running {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The input and output devices the system offers. cpal identifies devices by name, so the name is the
/// id (which is also how the app remembers a choice on Linux, where the platform ids are empty).
pub fn list_devices() -> DeviceList {
    let host = cpal::default_host();
    let entries = |devices: Option<Vec<cpal::Device>>| -> Vec<DeviceEntry> {
        devices
            .unwrap_or_default()
            .iter()
            .filter_map(|d| d.name().ok())
            .map(|name| DeviceEntry {
                id: name.clone(),
                name,
            })
            .collect()
    };
    DeviceList {
        inputs: entries(host.input_devices().ok().map(Iterator::collect)),
        outputs: entries(host.output_devices().ok().map(Iterator::collect)),
    }
}

fn find(devices: impl Iterator<Item = cpal::Device>, name: &str) -> Option<cpal::Device> {
    devices
        .into_iter()
        .find(|d| d.name().is_ok_and(|n| n == name))
}

/// Starts the microphone (`device` by name, or the system default) feeding `duplex.on_input`.
pub fn start_input(device: Option<&str>, duplex: Arc<Duplex>) -> Result<Running, String> {
    spawn(
        "engine-input",
        device.map(str::to_string),
        duplex,
        build_input,
    )
}

/// Starts the speakers (`device` by name, or the system default) pulling from `duplex.on_output`.
pub fn start_output(device: Option<&str>, duplex: Arc<Duplex>) -> Result<Running, String> {
    spawn(
        "engine-output",
        device.map(str::to_string),
        duplex,
        build_output,
    )
}

type Builder = fn(Option<String>, Arc<Duplex>) -> Result<cpal::Stream, String>;

fn spawn(
    name: &str,
    device: Option<String>,
    duplex: Arc<Duplex>,
    build: Builder,
) -> Result<Running, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let thread_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let stream = match build(device, duplex) {
                Ok(stream) => stream,
                Err(message) => {
                    let _ = ready_tx.send(Err(message));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(()));
            while !thread_stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(20));
            }
            drop(stream);
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(Running {
            stop,
            thread: Some(thread),
        }),
        Ok(Err(message)) => {
            let _ = thread.join();
            Err(message)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("the audio device did not start in time".into())
        }
    }
}

fn build_input(device: Option<String>, duplex: Arc<Duplex>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = match device.as_deref() {
        Some(name) => find(host.input_devices().map_err(|e| e.to_string())?, name)
            .ok_or_else(|| format!("no microphone called “{name}”"))?,
        None => host.default_input_device().ok_or("no microphone found")?,
    };
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let (channels, rate) = (config.channels() as usize, config.sample_rate().0);
    let on_error = |err| eprintln!("[engine] input stream error: {err}");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut told = false;
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !told {
                        told = true;
                        duplex.set_input_latency_ms(buffer_ms(data.len(), channels, rate));
                    }
                    duplex.on_input(data, channels, rate)
                },
                on_error,
                None,
            )
        }
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                let f: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                duplex.on_input(&f, channels, rate)
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _| {
                let f: Vec<f32> = data
                    .iter()
                    .map(|s| (*s as f32 - 32768.0) / 32768.0)
                    .collect();
                duplex.on_input(&f, channels, rate)
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

fn build_output(device: Option<String>, duplex: Arc<Duplex>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = match device.as_deref() {
        Some(name) => find(host.output_devices().map_err(|e| e.to_string())?, name)
            .ok_or_else(|| format!("no speakers called “{name}”"))?,
        None => host.default_output_device().ok_or("no speakers found")?,
    };
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let (channels, rate) = (config.channels() as usize, config.sample_rate().0);
    let on_error = |err| eprintln!("[engine] output stream error: {err}");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut told = false;
            device.build_output_stream(
                &config.into(),
                move |data: &mut [f32], _| {
                    if !told {
                        told = true;
                        duplex.set_output_latency_ms(buffer_ms(data.len(), channels, rate));
                    }
                    duplex.on_output(data, channels, rate)
                },
                on_error,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let mut scratch = Vec::new();
            device.build_output_stream(
                &config.into(),
                move |data: &mut [i16], _| {
                    scratch.resize(data.len(), 0.0);
                    duplex.on_output(&mut scratch, channels, rate);
                    for (o, s) in data.iter_mut().zip(&scratch) {
                        *o = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                    }
                },
                on_error,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let mut scratch = Vec::new();
            device.build_output_stream(
                &config.into(),
                move |data: &mut [u16], _| {
                    scratch.resize(data.len(), 0.0);
                    duplex.on_output(&mut scratch, channels, rate);
                    for (o, s) in data.iter_mut().zip(&scratch) {
                        *o = ((s.clamp(-1.0, 1.0) * 32767.0) + 32768.0) as u16;
                    }
                },
                on_error,
                None,
            )
        }
        other => return Err(format!("unsupported speaker format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

/// A device callback's buffer, in milliseconds. The path from speaker to microphone crosses about two of
/// these on each side, so this is the canceller's starting guess for the delay, not a measurement.
fn buffer_ms(samples: usize, channels: usize, rate: u32) -> u32 {
    (samples / channels.max(1)) as u32 * 2000 / rate.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_buffer_converts_to_milliseconds_with_two_buffers_of_slack() {
        // 480 frames at 48 kHz is 10 ms; the estimate counts two of them.
        assert_eq!(buffer_ms(960, 2, 48_000), 20);
        assert_eq!(buffer_ms(0, 2, 48_000), 0);
    }

    /// Needs a microphone and speakers: `cargo test -p rust-livekit -- --ignored devices_start`.
    #[test]
    #[ignore = "needs a microphone and speakers"]
    fn devices_start_run_and_release() {
        let duplex = Duplex::new(Default::default(), Box::new(|_| {}));
        let input = start_input(None, duplex.clone()).expect("microphone");
        let output = start_output(None, duplex.clone()).expect("speakers");
        std::thread::sleep(Duration::from_millis(1500));
        assert!(duplex.level.get() >= 0.0);
        input.stop();
        output.stop();
    }

    #[test]
    fn listing_devices_does_not_fail_without_a_sound_card() {
        let _ = list_devices();
    }
}
