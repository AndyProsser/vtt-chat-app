//! What happens to each 10 ms block of microphone before it is sent: volume, a level reading, WebRTC's
//! cleaning (echo, noise, level), and last the DM's character voice.
//!
//! The order matters. The canceller must see the microphone as it came in, because the echo in it is a
//! copy of what we played; a pitch-shifted echo is no longer a copy and would not be cancelled. So the
//! voice effect runs *after* cleaning, which is exactly what the platform path could not do.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use crate::voice_fx::{Voice, VoiceFx, BLOCK};

use super::processing::Processing;

/// A microphone level the interface can read at any time: 0 (silent) to 1 (full scale), on a decibel
/// scale from −60 dB, falling away gently so a meter does not flicker.
#[derive(Clone, Default)]
pub struct Level(Arc<AtomicU32>);

impl Level {
    pub fn get(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    fn update(&self, block: &[f32]) {
        let peak = block.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        let now = if peak <= 0.001 {
            0.0
        } else {
            ((20.0 * peak.log10() + 60.0) / 60.0).clamp(0.0, 1.0)
        };
        let shown = now.max(self.get() * 0.9);
        self.0.store(shown.to_bits(), Ordering::Relaxed);
    }
}

pub struct CapturePipeline {
    gain: f32,
    level: Level,
    processing: Arc<Mutex<Processing>>,
    fx: VoiceFx,
}

impl CapturePipeline {
    pub fn new(processing: Arc<Mutex<Processing>>, level: Level) -> Self {
        Self {
            gain: 1.0,
            level,
            processing,
            fx: VoiceFx::new(Voice::Normal),
        }
    }

    /// Microphone volume: 1 as the device gives it, up to 4 for a quiet one. Applied before cleaning, so
    /// the gain-control stage sees the level the player chose.
    pub fn set_gain(&mut self, gain: f32) {
        self.gain = gain.clamp(0.0, 4.0);
    }

    /// Changing voice starts a fresh effect: the shifters hold a little state that must not leak across.
    pub fn set_voice(&mut self, voice: Voice) {
        if voice != self.fx.voice() {
            self.fx = VoiceFx::new(voice);
        }
    }

    pub fn voice(&self) -> Voice {
        self.fx.voice()
    }

    /// Extra delay the chosen voice adds, in milliseconds.
    pub fn latency_ms(&self) -> f32 {
        self.fx.latency_ms()
    }

    pub fn process(&mut self, block: &[f32]) -> Vec<f32> {
        debug_assert_eq!(block.len(), BLOCK);
        let scaled: Vec<f32> = block
            .iter()
            .map(|s| (s * self.gain).clamp(-1.0, 1.0))
            .collect();
        self.level.update(&scaled);
        let cleaned = self.processing.lock().unwrap().clean(&scaled);
        let mut out = vec![0.0; BLOCK];
        self.fx.process(&cleaned, &mut out);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::super::processing::ProcessingOptions;
    use super::*;

    fn off() -> ProcessingOptions {
        ProcessingOptions {
            echo_cancellation: false,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        }
    }

    fn pipeline(options: ProcessingOptions) -> (CapturePipeline, Level, Arc<Mutex<Processing>>) {
        let processing = Arc::new(Mutex::new(Processing::new(options)));
        let level = Level::default();
        (
            CapturePipeline::new(processing.clone(), level.clone()),
            level,
            processing,
        )
    }

    fn sine(amp: f32, freq: f32, start: usize) -> Vec<f32> {
        (0..BLOCK)
            .map(|i| {
                amp * (2.0 * std::f32::consts::PI * freq * (start + i) as f32 / 48_000.0).sin()
            })
            .collect()
    }

    fn peak(x: &[f32]) -> f32 {
        x.iter().fold(0.0f32, |m, s| m.max(s.abs()))
    }

    #[test]
    fn microphone_gain_scales_the_sound_and_never_clips() {
        let (mut p, _, _) = pipeline(off());
        let quiet = sine(0.1, 300.0, 0);
        p.set_gain(2.0);
        let mut out = Vec::new();
        for i in 0..5 {
            out = p.process(&sine(0.1, 300.0, i * BLOCK));
        }
        assert!(
            (peak(&out) - 0.2).abs() < 0.02,
            "doubled: {} vs {}",
            peak(&out),
            peak(&quiet)
        );
        p.set_gain(4.0);
        assert!(peak(&p.process(&sine(0.9, 300.0, 0))) <= 1.0);
        p.set_gain(99.0);
        p.set_gain(0.0);
        assert!(p
            .process(&sine(0.5, 300.0, 0))
            .iter()
            .all(|s| s.abs() < 1e-3));
    }

    #[test]
    fn the_level_meter_follows_loudness_and_falls_away_slowly() {
        let (mut p, level, _) = pipeline(off());
        assert_eq!(level.get(), 0.0);
        p.process(&sine(0.5, 300.0, 0));
        let loud = level.get();
        assert!(loud > 0.8 && loud <= 1.0, "−6 dB should read high: {loud}");
        p.process(&vec![0.0; BLOCK]);
        let after = level.get();
        assert!(after < loud && after > loud * 0.5, "falls gently: {after}");
        for _ in 0..200 {
            p.process(&vec![0.0; BLOCK]);
        }
        assert!(level.get() < 0.01);
    }

    #[test]
    fn a_character_voice_is_applied_and_switching_back_restores_the_plain_voice() {
        let (mut p, _, _) = pipeline(off());
        p.set_voice(Voice::Giant);
        assert_eq!(p.voice(), Voice::Giant);
        assert!(p.latency_ms() > 0.0);
        p.set_voice(Voice::Normal);
        assert_eq!(p.latency_ms(), 0.0);
        let input = sine(0.3, 300.0, 0);
        let out = p.process(&input);
        assert!(out.iter().zip(&input).all(|(a, b)| (a - b).abs() < 2e-4));
    }

    /// The point of the whole design: with a character voice on, the speakers are still cancelled.
    #[test]
    fn echo_is_cancelled_even_while_a_character_voice_is_on() {
        fn residual(echo_cancellation: bool) -> f32 {
            let mut options = off();
            options.echo_cancellation = echo_cancellation;
            let (mut p, _, processing) = pipeline(options);
            processing.lock().unwrap().set_delay_ms(60);
            p.set_voice(Voice::Giant);
            let mut state = 7u32;
            let mut history: Vec<f32> = Vec::new();
            let mut tail = Vec::new();
            for b in 0..1_200usize {
                let played: Vec<f32> = (0..BLOCK)
                    .map(|i| {
                        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                        let noise = (state >> 8) as f32 / (1 << 23) as f32 - 1.0;
                        let on = ((b * BLOCK + i) / 4_800) % 4 != 3;
                        if on {
                            0.3 * noise
                        } else {
                            0.0
                        }
                    })
                    .collect();
                processing.lock().unwrap().played(&played);
                history.extend_from_slice(&played);
                let end = history.len();
                let mic: Vec<f32> = (0..BLOCK)
                    .map(|i| {
                        (end - BLOCK + i)
                            .checked_sub(48 * 50)
                            .map_or(0.0, |j| history[j] * 0.5)
                    })
                    .collect();
                let out = p.process(&mic);
                if b >= 1_100 {
                    tail.extend(out);
                }
            }
            (tail.iter().map(|s| s * s).sum::<f32>() / tail.len() as f32).sqrt()
        }
        let with = residual(true);
        let without = residual(false);
        assert!(
            without > 0.03,
            "the echo should be audible without it: {without}"
        );
        assert!(with < without * 0.25, "with {with}, without {without}");
    }
}
