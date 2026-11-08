//! The DM's character voices: a name, a recipe, and a block processor.

use std::f32::consts::PI;

use super::pitch::PitchShifter;
use super::SAMPLE_RATE;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Voice {
    /// The DM's own voice; the effect path is not used at all.
    Normal,
    /// Slower and deeper.
    Giant,
    /// Small and shrill.
    Imp,
    /// Metallic: a ring modulator over the voice.
    Robot,
    /// Very deep and growling: a low pitch driven into soft clipping.
    Demon,
}

impl Voice {
    pub const ALL: [Voice; 5] = [Voice::Normal, Voice::Giant, Voice::Imp, Voice::Robot, Voice::Demon];

    pub fn name(self) -> &'static str {
        match self {
            Voice::Normal => "normal",
            Voice::Giant => "giant",
            Voice::Imp => "imp",
            Voice::Robot => "robot",
            Voice::Demon => "demon",
        }
    }

    pub fn from_name(name: &str) -> Option<Voice> {
        Voice::ALL.into_iter().find(|v| v.name().eq_ignore_ascii_case(name.trim()))
    }
}

const ROBOT_HZ: f32 = 70.0;
const ROBOT_DRY: f32 = 0.3;
const DEMON_DRIVE: f32 = 2.5;

/// Turns blocks of the DM's microphone into the chosen voice. Create one per voice; switching voice
/// means a new `VoiceFx` (the shifters carry a little state that must not leak between voices).
pub struct VoiceFx {
    voice: Voice,
    shifter: Option<PitchShifter>,
    /// Ring-modulator phase in cycles.
    phase: f32,
}

impl VoiceFx {
    pub fn new(voice: Voice) -> Self {
        let shifter = match voice {
            Voice::Giant => Some(PitchShifter::new(0.72, 1920)),
            Voice::Imp => Some(PitchShifter::new(1.4, 1024)),
            Voice::Demon => Some(PitchShifter::new(0.6, 2048)),
            Voice::Normal | Voice::Robot => None,
        };
        Self { voice, shifter, phase: 0.0 }
    }

    pub fn voice(&self) -> Voice {
        self.voice
    }

    /// Extra delay this voice adds, in milliseconds.
    pub fn latency_ms(&self) -> f32 {
        self.shifter
            .as_ref()
            .map_or(0.0, |s| s.latency_samples() as f32 * 1000.0 / SAMPLE_RATE as f32)
    }

    pub fn process(&mut self, input: &[f32], output: &mut [f32]) {
        debug_assert_eq!(input.len(), output.len());
        match self.voice {
            Voice::Normal => output.copy_from_slice(input),
            Voice::Giant | Voice::Imp => self.shifter.as_mut().unwrap().process(input, output),
            Voice::Demon => {
                self.shifter.as_mut().unwrap().process(input, output);
                let norm = DEMON_DRIVE.tanh();
                for s in output.iter_mut() {
                    *s = (*s * DEMON_DRIVE).tanh() / norm;
                }
            }
            Voice::Robot => {
                let step = ROBOT_HZ / SAMPLE_RATE as f32;
                for (x, y) in input.iter().zip(output.iter_mut()) {
                    let carrier = (2.0 * PI * self.phase).sin();
                    *y = x * (ROBOT_DRY + (1.0 - ROBOT_DRY) * carrier);
                    self.phase = (self.phase + step) % 1.0;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::pitch::tests::{estimate_freq, sine};
    use super::*;

    fn run(voice: Voice, input: &[f32]) -> Vec<f32> {
        let mut fx = VoiceFx::new(voice);
        let mut out = vec![0.0; input.len()];
        for (i, o) in input.chunks(480).zip(out.chunks_mut(480)) {
            fx.process(i, o);
        }
        out
    }

    /// Signal strength at `freq` (Goertzel), normalised to a unit-amplitude sine = 1.0.
    fn strength(samples: &[f32], freq: f32) -> f32 {
        let w = 2.0 * PI * freq / SAMPLE_RATE as f32;
        let (mut s1, mut s2) = (0.0f32, 0.0f32);
        for x in samples {
            let s0 = x + 2.0 * w.cos() * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        let power = s1 * s1 + s2 * s2 - 2.0 * w.cos() * s1 * s2;
        2.0 * power.sqrt() / samples.len() as f32
    }

    #[test]
    fn voices_have_names_that_round_trip_and_unknown_names_are_none() {
        for v in Voice::ALL {
            assert_eq!(Voice::from_name(v.name()), Some(v));
        }
        assert_eq!(Voice::from_name(" Giant "), Some(Voice::Giant));
        assert_eq!(Voice::from_name("chipmunk"), None);
    }

    #[test]
    fn normal_is_untouched_and_adds_no_latency() {
        let input = sine(300.0, 0.2, 0.5);
        assert_eq!(run(Voice::Normal, &input), input);
        assert_eq!(VoiceFx::new(Voice::Normal).latency_ms(), 0.0);
    }

    #[test]
    fn giant_is_lower_and_imp_is_higher_than_the_speaker() {
        let input = sine(300.0, 1.0, 0.5);
        let giant = estimate_freq(&run(Voice::Giant, &input));
        let imp = estimate_freq(&run(Voice::Imp, &input));
        assert!((giant - 216.0).abs() < 15.0, "giant {giant}");
        assert!((imp - 420.0).abs() < 25.0, "imp {imp}");
    }

    #[test]
    fn robot_moves_the_energy_to_sidebands_around_the_voice() {
        let out = run(Voice::Robot, &sine(440.0, 1.0, 0.5));
        let steady = &out[out.len() / 2..];
        let carrier = strength(steady, 440.0);
        let low = strength(steady, 440.0 - ROBOT_HZ);
        let high = strength(steady, 440.0 + ROBOT_HZ);
        assert!(low > 0.1 && high > 0.1, "sidebands {low} {high}");
        assert!(carrier < 0.2, "the plain voice should be mostly gone: {carrier}");
    }

    #[test]
    fn demon_is_deep_loud_and_never_clips() {
        let input = sine(200.0, 1.0, 0.9);
        let out = run(Voice::Demon, &input);
        assert!(out.iter().all(|s| s.abs() <= 1.0));
        assert!((estimate_freq(&out) - 120.0).abs() < 12.0);
        assert!(out.iter().cloned().fold(0.0f32, f32::max) > 0.3, "not silent");
    }

    #[test]
    fn every_voice_keeps_silence_silent_and_reports_a_sane_latency() {
        for v in Voice::ALL {
            assert!(run(v, &vec![0.0; 4_800]).iter().all(|s| *s == 0.0), "{v:?}");
            assert!(VoiceFx::new(v).latency_ms() < 50.0, "{v:?} adds too much delay");
        }
    }
}
