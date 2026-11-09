//! The two sound-card callbacks, written as plain functions so they can be driven without a sound card.
//!
//! `on_input` takes whatever the microphone delivers (any rate, any channel count), turns it into 10 ms
//! blocks, runs them through the capture pipeline and hands the result to the sink (LiveKit). `on_output`
//! fills the speakers' buffer from the playout mixer and tells the echo canceller exactly what it played.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use crate::voice_fx::capture::Blocker;
use crate::voice_fx::{BLOCK, SAMPLE_RATE};

use super::capture::{CapturePipeline, Level};
use super::playout::Playout;
use super::processing::{Processing, ProcessingOptions};
use super::rate::Rate;

type Sink = Box<dyn FnMut(&[f32]) + Send>;

struct InputSide {
    rate: Option<(u32, Rate)>,
    blocker: Blocker,
}

struct OutputSide {
    rate: Option<(u32, Rate)>,
    /// Mono samples at the device rate, made but not yet delivered.
    ready: VecDeque<f32>,
}

/// How often (in 10 ms blocks) the canceller is told the current delay.
const DELAY_UPDATE_BLOCKS: u32 = 100;

pub struct Duplex {
    pub playout: Arc<Mutex<Playout>>,
    pub processing: Arc<Mutex<Processing>>,
    pub capture: Arc<Mutex<CapturePipeline>>,
    pub level: Level,
    sink: Mutex<Sink>,
    input: Mutex<InputSide>,
    output: Mutex<OutputSide>,
    /// Device buffer latencies, set by whoever opens the streams.
    input_latency_ms: AtomicU32,
    output_latency_ms: AtomicU32,
    blocks: AtomicU32,
}

impl Duplex {
    pub fn new(options: ProcessingOptions, sink: Sink) -> Arc<Self> {
        let processing = Arc::new(Mutex::new(Processing::new(options)));
        let level = Level::default();
        Arc::new(Self {
            playout: Arc::new(Mutex::new(Playout::new())),
            capture: Arc::new(Mutex::new(CapturePipeline::new(
                processing.clone(),
                level.clone(),
            ))),
            processing,
            level,
            sink: Mutex::new(sink),
            input: Mutex::new(InputSide {
                rate: None,
                blocker: Blocker::default(),
            }),
            output: Mutex::new(OutputSide {
                rate: None,
                ready: VecDeque::new(),
            }),
            input_latency_ms: AtomicU32::new(20),
            output_latency_ms: AtomicU32::new(30),
            blocks: AtomicU32::new(0),
        })
    }

    pub fn set_device_latency_ms(&self, input: u32, output: u32) {
        self.set_input_latency_ms(input);
        self.set_output_latency_ms(output);
    }

    pub fn set_input_latency_ms(&self, ms: u32) {
        self.input_latency_ms.store(ms, Ordering::Relaxed);
    }

    pub fn set_output_latency_ms(&self, ms: u32) {
        self.output_latency_ms.store(ms, Ordering::Relaxed);
    }

    /// Microphone samples, interleaved, at the device's rate.
    pub fn on_input(&self, data: &[f32], channels: usize, rate: u32) {
        let channels = channels.max(1);
        let mono: Vec<f32> = data
            .chunks_exact(channels)
            .map(|f| f.iter().sum::<f32>() / channels as f32)
            .collect();
        let mut input = self.input.lock().unwrap();
        if input.rate.as_ref().map(|(r, _)| *r) != Some(rate) {
            input.rate = Some((rate, Rate::new(rate, SAMPLE_RATE)));
        }
        let mut converted = Vec::with_capacity(mono.len() + 16);
        input
            .rate
            .as_mut()
            .unwrap()
            .1
            .process(&mono, &mut converted);
        input.blocker.push(&converted);
        while let Some(block) = input.blocker.next_block() {
            let cleaned = self.capture.lock().unwrap().process(&block);
            (self.sink.lock().unwrap())(&cleaned);
        }
    }

    /// Fills the speakers' buffer (interleaved, at the device's rate).
    pub fn on_output(&self, data: &mut [f32], channels: usize, rate: u32) {
        let channels = channels.max(1);
        let frames = data.len() / channels;
        let mut output = self.output.lock().unwrap();
        if output.rate.as_ref().map(|(r, _)| *r) != Some(rate) {
            output.rate = Some((rate, Rate::new(SAMPLE_RATE, rate)));
        }
        while output.ready.len() < frames {
            let block = self.playout.lock().unwrap().next_block();
            debug_assert_eq!(block.len(), BLOCK);
            self.processing.lock().unwrap().played(&block);
            let mut converted = Vec::with_capacity(BLOCK + 16);
            output
                .rate
                .as_mut()
                .unwrap()
                .1
                .process(&block, &mut converted);
            output.ready.extend(converted);

            let n = self.blocks.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(DELAY_UPDATE_BLOCKS) {
                let queued_ms = (output.ready.len() as u64 * 1000 / u64::from(rate)) as u32;
                let delay = self.input_latency_ms.load(Ordering::Relaxed)
                    + self.output_latency_ms.load(Ordering::Relaxed)
                    + queued_ms;
                self.processing.lock().unwrap().set_delay_ms(delay as i32);
            }
        }
        for frame in data.chunks_exact_mut(channels) {
            let s = output.ready.pop_front().unwrap_or(0.0);
            frame.fill(s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collecting() -> (Sink, Arc<Mutex<Vec<f32>>>) {
        let store = Arc::new(Mutex::new(Vec::new()));
        let s = store.clone();
        (
            Box::new(move |b: &[f32]| s.lock().unwrap().extend_from_slice(b)),
            store,
        )
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    fn no_processing() -> ProcessingOptions {
        ProcessingOptions {
            echo_cancellation: false,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        }
    }

    #[test]
    fn microphone_samples_at_any_rate_arrive_as_whole_ten_ms_blocks() {
        let (sink, got) = collecting();
        let d = Duplex::new(no_processing(), sink);
        // 44.1 kHz stereo in awkward chunks.
        for _ in 0..50 {
            d.on_input(&vec![0.1; 2 * 441 + 6], 2, 44_100);
        }
        let n = got.lock().unwrap().len();
        assert!(n > 0 && n % BLOCK == 0, "{n}");
        // About 50 × 10 ms.
        assert!((n as i64 - 24_000).abs() < 2_000, "{n}");
    }

    #[test]
    fn the_speakers_play_what_was_queued_and_silence_when_nothing_is() {
        let (sink, _) = collecting();
        let d = Duplex::new(no_processing(), sink);
        let mut out = vec![1.0f32; 2 * 960];
        d.on_output(&mut out, 2, 48_000);
        assert!(out.iter().all(|s| *s == 0.0), "nothing queued: silence");
        d.playout
            .lock()
            .unwrap()
            .push("amy", &vec![0.25; BLOCK * 6]);
        d.on_output(&mut out, 2, 48_000);
        assert!(
            out.iter().all(|s| (*s - 0.25).abs() < 1e-6),
            "both channels play it"
        );
    }

    #[test]
    fn a_44_1k_output_gets_the_right_amount_of_audio() {
        let (sink, _) = collecting();
        let d = Duplex::new(no_processing(), sink);
        let mut total_nonzero = 0;
        for _ in 0..40 {
            // Fed a block at a time, as the network would: a stream holds at most 200 ms.
            d.playout.lock().unwrap().push("amy", &vec![0.2; BLOCK]);
            let mut out = vec![0.0f32; 441]; // 10 ms mono at 44.1k
            d.on_output(&mut out, 1, 44_100);
            total_nonzero += out.iter().filter(|s| **s > 0.1).count();
        }
        assert!(total_nonzero > 40 * 441 - 600, "{total_nonzero}");
    }

    /// The whole loop with no hardware: speakers → a room → the microphone → cleaned → the sink.
    fn echo_through_the_loop(echo_cancellation: bool) -> f32 {
        let (sink, got) = collecting();
        let mut options = no_processing();
        options.echo_cancellation = echo_cancellation;
        let d = Duplex::new(options, sink);
        d.set_device_latency_ms(10, 40);
        let mut state = 11u32;
        let mut heard: Vec<f32> = Vec::new();
        for b in 0..1_500usize {
            let far: Vec<f32> = (0..BLOCK)
                .map(|i| {
                    state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                    let noise = (state >> 8) as f32 / (1 << 23) as f32 - 1.0;
                    if ((b * BLOCK + i) / 4_800) % 4 != 3 {
                        0.3 * noise
                    } else {
                        0.0
                    }
                })
                .collect();
            d.playout.lock().unwrap().push("far", &far);
            let mut speaker = vec![0.0f32; BLOCK];
            d.on_output(&mut speaker, 1, 48_000);
            heard.extend_from_slice(&speaker);
            let end = heard.len();
            let mic: Vec<f32> = (0..BLOCK)
                .map(|i| {
                    (end - BLOCK + i)
                        .checked_sub(48 * 50)
                        .map_or(0.0, |j| heard[j] * 0.5)
                })
                .collect();
            d.on_input(&mic, 1, 48_000);
        }
        let out = got.lock().unwrap();
        rms(&out[out.len() - 48_000..])
    }

    #[test]
    fn the_full_loop_cancels_the_speakers_out_of_the_microphone() {
        let with = echo_through_the_loop(true);
        let without = echo_through_the_loop(false);
        assert!(without > 0.03, "audible without cancellation: {without}");
        assert!(with < without * 0.25, "with {with}, without {without}");
    }
}
