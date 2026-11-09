//! WebRTC's audio processing (echo cancellation, noise suppression, high-pass, gain control) applied
//! to samples we hold, instead of inside the platform audio layer. The mixer engine owns both sides of
//! the sound card, so it can tell the canceller exactly what was played (the "reverse" stream) and
//! clean the microphone against it, which is what lets echo cancellation work for a character voice
//! and for everything the app plays itself.

use livekit::webrtc::native::apm::AudioProcessingModule;

use crate::voice_fx::{BLOCK, SAMPLE_RATE};

/// Which of WebRTC's stages to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessingOptions {
    pub echo_cancellation: bool,
    pub noise_suppression: bool,
    pub gain_control: bool,
    pub high_pass: bool,
}

impl Default for ProcessingOptions {
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            noise_suppression: true,
            gain_control: true,
            high_pass: true,
        }
    }
}

/// One canceller shared by the capture side (`clean`) and the playback side (`played`). 10 ms mono
/// blocks at 48 kHz in, the same out.
pub struct Processing {
    apm: AudioProcessingModule,
}

fn to_i16(block: &[f32]) -> Vec<i16> {
    block
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect()
}

impl Processing {
    pub fn new(options: ProcessingOptions) -> Self {
        Self {
            apm: AudioProcessingModule::new(
                options.echo_cancellation,
                options.gain_control,
                options.high_pass,
                options.noise_suppression,
            ),
        }
    }

    /// Tells the canceller how long after being played a sound reaches the microphone (output buffer
    /// plus input buffer, in milliseconds). A good estimate converges faster; a wrong one only slows it.
    pub fn set_delay_ms(&mut self, delay_ms: i32) {
        let _ = self.apm.set_stream_delay_ms(delay_ms.clamp(0, 500));
    }

    /// The block that is about to leave the speakers. Must be called for every playback block, in order.
    pub fn played(&mut self, block: &[f32]) {
        debug_assert_eq!(block.len(), BLOCK);
        let mut samples = to_i16(block);
        let _ = self
            .apm
            .process_reverse_stream(&mut samples, SAMPLE_RATE as i32, 1);
    }

    /// A block from the microphone, returned with echo, noise and (optionally) level problems removed.
    pub fn clean(&mut self, block: &[f32]) -> Vec<f32> {
        debug_assert_eq!(block.len(), BLOCK);
        let mut samples = to_i16(block);
        let _ = self.apm.process_stream(&mut samples, SAMPLE_RATE as i32, 1);
        samples
            .iter()
            .map(|s| *s as f32 / i16::MAX as f32)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic noise with a speech-like on/off envelope (words and pauses), so the canceller has
    /// something to learn from and silence to be judged against.
    struct Talker {
        state: u32,
        t: usize,
    }
    impl Talker {
        fn new(seed: u32) -> Self {
            Self { state: seed, t: 0 }
        }
        fn block(&mut self) -> Vec<f32> {
            (0..BLOCK)
                .map(|_| {
                    self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
                    let noise = (self.state >> 8) as f32 / (1 << 23) as f32 - 1.0;
                    // ~300 ms of voice, ~100 ms of pause; a slow low tone gives it some body.
                    let on = (self.t / 4_800) % 4 != 3;
                    let tone =
                        (self.t as f32 * 2.0 * std::f32::consts::PI * 180.0 / 48_000.0).sin();
                    self.t += 1;
                    if on {
                        0.25 * noise + 0.2 * tone
                    } else {
                        0.0
                    }
                })
                .collect()
        }
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    /// What the microphone hears of the speakers: the played sound, later and quieter.
    struct Room {
        history: Vec<f32>,
        delay: usize,
        gain: f32,
    }
    impl Room {
        fn hear(&mut self, played: &[f32]) -> Vec<f32> {
            self.history.extend_from_slice(played);
            let end = self.history.len();
            (0..played.len())
                .map(|i| {
                    let at = end - played.len() + i;
                    at.checked_sub(self.delay)
                        .map_or(0.0, |j| self.history[j] * self.gain)
                })
                .collect()
        }
    }

    /// Plays `seconds` of a talker through a room into the microphone (nobody speaking near the mic)
    /// and returns the level of what the processed microphone still contains over the last second.
    fn residual_echo(options: ProcessingOptions, seconds: usize) -> (f32, f32) {
        let mut apm = Processing::new(options);
        apm.set_delay_ms(60);
        let mut far = Talker::new(7);
        let mut room = Room {
            history: Vec::new(),
            delay: 48 * 50, // 50 ms
            gain: 0.5,
        };
        let blocks = seconds * 100;
        let mut raw_tail = Vec::new();
        let mut clean_tail = Vec::new();
        for i in 0..blocks {
            let played = far.block();
            apm.played(&played);
            let mic = room.hear(&played);
            let clean = apm.clean(&mic);
            if i >= blocks - 100 {
                raw_tail.extend_from_slice(&mic);
                clean_tail.extend_from_slice(&clean);
            }
        }
        (rms(&raw_tail), rms(&clean_tail))
    }

    #[test]
    fn with_echo_cancellation_the_speakers_are_mostly_removed_from_the_microphone() {
        let options = ProcessingOptions {
            echo_cancellation: true,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        };
        let (raw, clean) = residual_echo(options, 12);
        eprintln!(
            "echo test: raw {raw:.4}, clean {clean:.4} ({:.1} dB)",
            20.0 * (clean / raw).log10()
        );
        assert!(
            raw > 0.05,
            "the room should be audible in the microphone: {raw}"
        );
        assert!(
            clean < raw * 0.25,
            "echo should drop by at least 12 dB: raw {raw}, clean {clean}"
        );
    }

    #[test]
    fn without_it_the_echo_stays() {
        let options = ProcessingOptions {
            echo_cancellation: false,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        };
        let (raw, clean) = residual_echo(options, 3);
        assert!(clean > raw * 0.8, "raw {raw}, clean {clean}");
    }

    #[test]
    fn speech_next_to_the_microphone_survives_while_the_speakers_are_cancelled() {
        let mut apm = Processing::new(ProcessingOptions {
            echo_cancellation: true,
            noise_suppression: false,
            gain_control: false,
            high_pass: false,
        });
        apm.set_delay_ms(60);
        let mut far = Talker::new(7);
        let mut near = Talker::new(99);
        let mut room = Room {
            history: Vec::new(),
            delay: 48 * 50,
            gain: 0.5,
        };
        let (mut want, mut got) = (Vec::new(), Vec::new());
        for i in 0..1_500 {
            let played = far.block();
            apm.played(&played);
            let me = near.block();
            let echo = room.hear(&played);
            let mic: Vec<f32> = me.iter().zip(&echo).map(|(a, b)| a + b).collect();
            let clean = apm.clean(&mic);
            if i >= 1_000 {
                want.extend_from_slice(&me);
                got.extend_from_slice(&clean);
            }
        }
        // Not silenced: the near voice is still clearly there after the echo is taken out.
        assert!(
            rms(&got) > rms(&want) * 0.3,
            "want {} got {}",
            rms(&want),
            rms(&got)
        );
    }
}
