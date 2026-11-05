//! Stage 2 probe: what does WebRTC's platform audio layer (the ADM) give us on this machine,
//! without a server or a second participant?
//!
//! Reports the devices, which echo-cancellation / noise-suppression / gain implementations are
//! active, and — the number the hot-mic design hinges on — how long it takes to **release and
//! re-acquire the capture device** (CLAUDE.md §8.1, "Hot-mic honesty"). Watch the OS microphone
//! indicator while it runs: it should switch off during each "released" pause.
//!
//!   cargo run --example audio_probe -- [cycles=5] [released_ms=1500] [software|hardware]
//!
//! The last argument picks the echo-cancellation implementation to request (default: software,
//! WebRTC's own — the same engine on every OS, which is what "consistent across platforms" needs).

use std::env;
use std::time::{Duration, Instant};

use livekit::{AudioProcessingOptions, PlatformAudio};

fn main() {
    let args: Vec<String> = env::args().collect();
    let cycles: u32 = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(5);
    let released_ms: u64 = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(1500);
    let prefer_hardware = args.get(3).map(|v| v == "hardware").unwrap_or(false);

    let audio = match PlatformAudio::new() {
        Ok(audio) => audio,
        Err(err) => {
            eprintln!("PlatformAudio::new failed: {err}");
            std::process::exit(1);
        }
    };

    println!("os: {} / {}", std::env::consts::OS, std::env::consts::ARCH);
    println!("recording devices:");
    for device in audio.recording_devices() {
        println!("  [{}] {}", device.index, device.name);
    }
    println!("playout devices:");
    for device in audio.playout_devices() {
        println!("  [{}] {}", device.index, device.name);
    }

    if let Some(device) = audio.recording_devices().next() {
        if let Err(err) = audio.set_recording_device(&device.id) {
            eprintln!("set_recording_device failed: {err}");
        }
    }

    let options = AudioProcessingOptions {
        prefer_hardware_processing: prefer_hardware,
        ..Default::default()
    };
    if let Err(err) = audio.configure_audio_processing(options) {
        eprintln!("configure_audio_processing failed: {err}");
    }
    println!(
        "processing: aec={:?} ns={:?} agc={:?} (hardware available: aec={} ns={} agc={})",
        audio.active_aec_type(),
        audio.active_ns_type(),
        audio.active_agc_type(),
        audio.is_hardware_aec_available(),
        audio.is_hardware_ns_available(),
        audio.is_hardware_agc_available(),
    );

    println!("\nrelease/re-acquire cycles ({cycles}x, {released_ms} ms released each):");
    let mut start_ms = Vec::new();
    let mut stop_ms = Vec::new();
    for cycle in 1..=cycles {
        let t = Instant::now();
        let started = audio.start_recording();
        let start_took = t.elapsed();

        std::thread::sleep(Duration::from_millis(1500));

        let t = Instant::now();
        let stopped = audio.stop_recording();
        let stop_took = t.elapsed();

        println!(
            "  #{cycle}: start_recording {:>6.1} ms ({}), stop_recording {:>6.1} ms ({})",
            start_took.as_secs_f64() * 1000.0,
            match &started {
                Ok(()) => "ok".to_string(),
                Err(err) => format!("FAILED: {err}"),
            },
            stop_took.as_secs_f64() * 1000.0,
            if stopped.is_ok() { "ok" } else { "FAILED" },
        );
        start_ms.push(start_took.as_secs_f64() * 1000.0);
        stop_ms.push(stop_took.as_secs_f64() * 1000.0);

        std::thread::sleep(Duration::from_millis(released_ms));
    }

    let summarize = |label: &str, values: &[f64]| {
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = sorted[sorted.len() / 2];
        println!(
            "{label}: min {:.1} / median {:.1} / max {:.1} ms",
            sorted[0],
            median,
            sorted[sorted.len() - 1]
        );
    };
    println!();
    summarize("start_recording (unmute cost)", &start_ms);
    summarize("stop_recording (mute cost)   ", &stop_ms);
}
