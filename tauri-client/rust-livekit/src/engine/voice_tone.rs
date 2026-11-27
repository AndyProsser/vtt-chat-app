//! Voice presets: the tone of the voice that is sent. Everything before this stage takes something away
//! (echo, noise, the low rumble); this one gives a little back, so a good headset has something to reproduce.
//! It is an equaliser (a low shelf for body, a dip for boxiness, a lift for presence, a high shelf for air)
//! followed by a gentle compressor that evens out loud and quiet words, and a soft limiter so the boost
//! can never clip.
//!
//! It runs after the noise filter and before the level meter and the DM's character voice, on the 10 ms,
//! 48 kHz mono blocks the engine already works in. It is a few biquads and one envelope follower per
//! block: far below the cost of the echo canceller. docs/architecture/AUDIO-MIXER.md.

use std::f32::consts::PI;

use crate::voice_fx::{BLOCK, SAMPLE_RATE};

/// How the voice should sound to everyone else. `Off` sends the cleaned microphone untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VoicePreset {
    Off,
    /// A little body and a little brightness: the microphone, only less dull.
    #[default]
    Natural,
    /// More low end and a softer top: a warm, close voice.
    Warm,
    /// The most polish: a firm low end, boxiness cut, clear presence, more even level.
    Broadcast,
}

impl VoicePreset {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "off" => Some(Self::Off),
            "natural" => Some(Self::Natural),
            "warm" => Some(Self::Warm),
            "broadcast" => Some(Self::Broadcast),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Natural => "natural",
            Self::Warm => "warm",
            Self::Broadcast => "broadcast",
        }
    }

    fn bands(self) -> &'static [Band] {
        // Retuned 2026-11-27 after Andy's first listen (dev.2): "quite high-pitched", "could all go a little
        // deeper", Broadcast best. EQ cannot change pitch, only balance, so the fix is more low end and body
        // (150 to 250 Hz) and less lift above 3 kHz.
        match self {
            Self::Off => &[],
            Self::Natural => &[
                Band::LowShelf { hz: 160.0, db: 3.5 },
                Band::Peak {
                    hz: 250.0,
                    db: 1.5,
                    q: 0.8,
                },
                Band::Peak {
                    hz: 3_000.0,
                    db: 1.0,
                    q: 0.9,
                },
                Band::HighShelf {
                    hz: 9_000.0,
                    db: -1.0,
                },
            ],
            Self::Warm => &[
                Band::LowShelf { hz: 170.0, db: 5.5 },
                Band::Peak {
                    hz: 250.0,
                    db: 2.0,
                    q: 0.9,
                },
                Band::Peak {
                    hz: 3_500.0,
                    db: 0.5,
                    q: 0.9,
                },
                Band::HighShelf {
                    hz: 8_000.0,
                    db: -2.5,
                },
            ],
            Self::Broadcast => &[
                Band::LowShelf { hz: 150.0, db: 5.0 },
                Band::Peak {
                    hz: 250.0,
                    db: 1.5,
                    q: 0.9,
                },
                Band::Peak {
                    hz: 3_500.0,
                    db: 2.5,
                    q: 0.8,
                },
                Band::HighShelf {
                    hz: 10_000.0,
                    db: 1.0,
                },
            ],
        }
    }

    /// Compressor: above `threshold_db` the level rises by 1 dB for every `ratio` dB in; `makeup_db` is added after.
    fn compressor(self) -> Option<Compression> {
        match self {
            Self::Off => None,
            Self::Natural => Some(Compression {
                threshold_db: -22.0,
                ratio: 1.8,
                makeup_db: 1.0,
            }),
            Self::Warm => Some(Compression {
                threshold_db: -22.0,
                ratio: 2.2,
                makeup_db: 1.5,
            }),
            Self::Broadcast => Some(Compression {
                threshold_db: -24.0,
                ratio: 2.5,
                makeup_db: 2.5,
            }),
        }
    }
}

#[derive(Clone, Copy)]
enum Band {
    LowShelf { hz: f32, db: f32 },
    HighShelf { hz: f32, db: f32 },
    Peak { hz: f32, db: f32, q: f32 },
}

#[derive(Clone, Copy)]
struct Compression {
    threshold_db: f32,
    ratio: f32,
    makeup_db: f32,
}

/// One biquad filter section (RBJ cookbook), direct form II transposed.
#[derive(Clone)]
struct Biquad {
    b: [f32; 3],
    a: [f32; 2],
    z: [f32; 2],
}

impl Biquad {
    fn new(band: Band) -> Self {
        let fs = SAMPLE_RATE as f32;
        let (hz, db) = match band {
            Band::LowShelf { hz, db } | Band::HighShelf { hz, db } | Band::Peak { hz, db, .. } => {
                (hz, db)
            }
        };
        let a = 10f32.powf(db / 40.0);
        let w0 = 2.0 * PI * hz / fs;
        let (sin, cos) = (w0.sin(), w0.cos());
        let (b0, b1, b2, a0, a1, a2) = match band {
            Band::Peak { q, .. } => {
                let alpha = sin / (2.0 * q);
                (
                    1.0 + alpha * a,
                    -2.0 * cos,
                    1.0 - alpha * a,
                    1.0 + alpha / a,
                    -2.0 * cos,
                    1.0 - alpha / a,
                )
            }
            Band::LowShelf { .. } => {
                // Shelf slope 1: alpha = sin/2 * sqrt(2).
                let alpha = sin / 2.0 * 2f32.sqrt();
                let t = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + t),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - t),
                    (a + 1.0) + (a - 1.0) * cos + t,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - t,
                )
            }
            Band::HighShelf { .. } => {
                let alpha = sin / 2.0 * 2f32.sqrt();
                let t = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + t),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - t),
                    (a + 1.0) - (a - 1.0) * cos + t,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - t,
                )
            }
        };
        Self {
            b: [b0 / a0, b1 / a0, b2 / a0],
            a: [a1 / a0, a2 / a0],
            z: [0.0; 2],
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[0] * y + self.z[1];
        self.z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

/// Envelope times: quick enough to catch a loud syllable, slow enough not to pump on every word.
const ATTACK_MS: f32 = 5.0;
const RELEASE_MS: f32 = 150.0;
/// How far below the threshold the make-up gain fades in from nothing.
const MAKEUP_FADE_DB: f32 = 15.0;
/// Where the soft limiter starts to bend a peak (it never exceeds full scale).
const LIMIT_KNEE: f32 = 0.9;

pub struct VoiceTone {
    preset: VoicePreset,
    bands: Vec<Biquad>,
    compression: Option<Compression>,
    /// Smoothed level, in the linear domain.
    envelope: f32,
    attack: f32,
    release: f32,
}

impl VoiceTone {
    pub fn new(preset: VoicePreset) -> Self {
        let per_ms = SAMPLE_RATE as f32 / 1000.0;
        Self {
            preset,
            bands: preset.bands().iter().copied().map(Biquad::new).collect(),
            compression: preset.compressor(),
            envelope: 0.0,
            attack: 1.0 - (-1.0 / (ATTACK_MS * per_ms)).exp(),
            release: 1.0 - (-1.0 / (RELEASE_MS * per_ms)).exp(),
        }
    }

    pub fn preset(&self) -> VoicePreset {
        self.preset
    }

    pub fn set_preset(&mut self, preset: VoicePreset) {
        if preset != self.preset {
            *self = Self::new(preset);
        }
    }

    /// One block in, one block out, no added delay.
    pub fn process(&mut self, block: &[f32]) -> Vec<f32> {
        debug_assert_eq!(block.len(), BLOCK);
        if self.preset == VoicePreset::Off {
            return block.to_vec();
        }
        block
            .iter()
            .map(|&x| {
                let shaped = self.bands.iter_mut().fold(x, |s, band| band.process(s));
                soft_limit(self.compress(shaped))
            })
            .collect()
    }

    fn compress(&mut self, x: f32) -> f32 {
        let Some(c) = self.compression else {
            return x;
        };
        let level = x.abs();
        let coeff = if level > self.envelope {
            self.attack
        } else {
            self.release
        };
        self.envelope += (level - self.envelope) * coeff;
        let level_db = 20.0 * self.envelope.max(1e-6).log10();
        let over = (level_db - c.threshold_db).max(0.0);
        // The make-up gain fades in over the 15 dB below the threshold instead of switching on, so the room
        // between words (the reverb tail, the breath) is not lifted with the voice. A hard 12 dB switch did
        // exactly that in 0.6.6-dev.3 and was heard as "a bit much reverb" (Andy, 2026-11-27).
        let ramp =
            ((level_db - (c.threshold_db - MAKEUP_FADE_DB)) / MAKEUP_FADE_DB).clamp(0.0, 1.0);
        let gain_db = c.makeup_db * ramp - over * (1.0 - 1.0 / c.ratio);
        x * 10f32.powf(gain_db / 20.0)
    }
}

/// Passes anything below the knee unchanged and bends what is above it towards, never past, full scale.
fn soft_limit(x: f32) -> f32 {
    let a = x.abs();
    if a <= LIMIT_KNEE {
        x
    } else {
        x.signum()
            * (LIMIT_KNEE + (1.0 - LIMIT_KNEE) * ((a - LIMIT_KNEE) / (1.0 - LIMIT_KNEE)).tanh())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(amp: f32, hz: f32, blocks: usize) -> Vec<f32> {
        (0..BLOCK * blocks)
            .map(|i| amp * (2.0 * PI * hz * i as f32 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    fn run(tone: &mut VoiceTone, input: &[f32]) -> Vec<f32> {
        input.chunks(BLOCK).flat_map(|b| tone.process(b)).collect()
    }

    /// RMS over the last half, after the filters and the compressor have settled.
    fn settled_rms(x: &[f32]) -> f32 {
        let tail = &x[x.len() / 2..];
        (tail.iter().map(|s| s * s).sum::<f32>() / tail.len() as f32).sqrt()
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.log10()
    }

    #[test]
    fn off_passes_the_voice_through_untouched() {
        let mut tone = VoiceTone::new(VoicePreset::Off);
        let input = sine(0.3, 440.0, 4);
        assert_eq!(run(&mut tone, &input), input);
    }

    fn gain_at(preset: VoicePreset, hz: f32) -> f32 {
        // A quiet tone sits below the compressor's range, so only the equaliser acts.
        let mut tone = VoiceTone::new(preset);
        let input = sine(0.01, hz, 50);
        db(settled_rms(&run(&mut tone, &input)) / settled_rms(&input))
    }

    #[test]
    fn natural_adds_body_and_a_soft_top() {
        assert!(gain_at(VoicePreset::Natural, 100.0) >= 1.5);
        assert!(gain_at(VoicePreset::Natural, 250.0) >= 2.0);
        assert!(
            gain_at(VoicePreset::Natural, 12_000.0) < 0.0,
            "the top is no longer lifted"
        );
    }

    #[test]
    fn every_preset_is_deeper_than_it_is_bright() {
        for preset in [
            VoicePreset::Natural,
            VoicePreset::Warm,
            VoicePreset::Broadcast,
        ] {
            let body = gain_at(preset, 200.0);
            assert!(body >= 2.0, "{preset:?} adds only {body:.1} dB at 200 Hz");
            assert!(
                body > gain_at(preset, 3_500.0),
                "{preset:?} is brighter than it is deep"
            );
        }
    }

    #[test]
    fn warm_has_more_low_end_than_natural_and_broadcast_has_more_air() {
        assert!(gain_at(VoicePreset::Warm, 100.0) > gain_at(VoicePreset::Natural, 100.0));
        assert!(
            gain_at(VoicePreset::Broadcast, 12_000.0) > gain_at(VoicePreset::Natural, 12_000.0)
        );
        assert!(gain_at(VoicePreset::Warm, 12_000.0) < gain_at(VoicePreset::Natural, 12_000.0));
    }

    #[test]
    fn the_quiet_between_words_is_not_lifted() {
        // A tone 50 dB down stands for the room's tail. The compressor's make-up gain must not reach it, so
        // what the preset does to it is only what its equaliser does (no more than a dB or two at 1 kHz).
        for preset in [
            VoicePreset::Natural,
            VoicePreset::Warm,
            VoicePreset::Broadcast,
        ] {
            let mut tone = VoiceTone::new(preset);
            let input = sine(0.003, 1_000.0, 80);
            let gain = db(settled_rms(&run(&mut tone, &input)) / settled_rms(&input));
            assert!(gain < 1.5, "{preset:?} lifted the room by {gain:.1} dB");
        }
    }

    #[test]
    fn loud_and_quiet_speech_end_up_closer_together() {
        let spread = |preset| {
            let mut tone = VoiceTone::new(preset);
            let loud = settled_rms(&run(&mut tone, &sine(0.5, 1_000.0, 80)));
            let mut tone = VoiceTone::new(preset);
            let quiet = settled_rms(&run(&mut tone, &sine(0.05, 1_000.0, 80)));
            db(loud / quiet)
        };
        // 20 dB apart going in.
        assert!(spread(VoicePreset::Broadcast) < 17.0);
        assert!(spread(VoicePreset::Off) > 19.9);
    }

    #[test]
    fn silence_stays_silent() {
        let mut tone = VoiceTone::new(VoicePreset::Broadcast);
        let out = run(&mut tone, &vec![0.0; BLOCK * 10]);
        assert!(out.iter().all(|s| s.abs() < 1e-6));
    }

    #[test]
    fn a_loud_voice_never_clips() {
        for preset in [
            VoicePreset::Natural,
            VoicePreset::Warm,
            VoicePreset::Broadcast,
        ] {
            let mut tone = VoiceTone::new(preset);
            for hz in [100.0, 1_000.0, 4_000.0] {
                let out = run(&mut tone, &sine(1.0, hz, 40));
                assert!(
                    out.iter().all(|s| s.abs() <= 1.0),
                    "{preset:?} clipped at {hz} Hz"
                );
            }
        }
    }

    #[test]
    fn switching_preset_takes_effect_and_names_round_trip() {
        let mut tone = VoiceTone::new(VoicePreset::Off);
        tone.set_preset(VoicePreset::Warm);
        assert_eq!(tone.preset(), VoicePreset::Warm);
        for preset in [
            VoicePreset::Off,
            VoicePreset::Natural,
            VoicePreset::Warm,
            VoicePreset::Broadcast,
        ] {
            assert_eq!(VoicePreset::from_name(preset.name()), Some(preset));
        }
        assert_eq!(VoicePreset::from_name("louder"), None);
    }
}
