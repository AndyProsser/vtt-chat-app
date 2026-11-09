//! The DM's character voices: a name, a recipe, and a block processor.

use std::f32::consts::PI;

use super::dsp::{Echo, LowPass, Wobble};
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
    /// Huge and cavernous: an octave down with a rough growl and a long echo.
    Dragon,
    /// Booming and layered: the voice lowered, an octave-down voice under it, in a big hall.
    God,
    /// Slow, swaying pitch and a dulled, slurred tone.
    Drunk,
    /// Commanding: a little lower, firmly compressed, with a touch of room.
    Authoritative,
}

impl Voice {
    pub const ALL: [Voice; 9] = [
        Voice::Normal,
        Voice::Giant,
        Voice::Imp,
        Voice::Robot,
        Voice::Demon,
        Voice::Dragon,
        Voice::God,
        Voice::Drunk,
        Voice::Authoritative,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Voice::Normal => "normal",
            Voice::Giant => "giant",
            Voice::Imp => "imp",
            Voice::Robot => "robot",
            Voice::Demon => "demon",
            Voice::Dragon => "dragon",
            Voice::God => "god",
            Voice::Drunk => "drunk",
            Voice::Authoritative => "authoritative",
        }
    }

    pub fn from_name(name: &str) -> Option<Voice> {
        Voice::ALL
            .into_iter()
            .find(|v| v.name().eq_ignore_ascii_case(name.trim()))
    }
}

const ROBOT_HZ: f32 = 70.0;
const ROBOT_DRY: f32 = 0.3;
const DEMON_DRIVE: f32 = 2.5;
/// Dragon: a rough growl is the voice multiplied by a slow rumble.
const GROWL_HZ: f32 = 28.0;
const GROWL_DEPTH: f32 = 0.35;
const DRAGON_DRIVE: f32 = 2.0;
/// Authoritative: how hard the voice is pushed into the soft limiter.
const AUTHORITY_DRIVE: f32 = 1.6;

/// Turns blocks of the DM's microphone into the chosen voice. Create one per voice; switching voice
/// means a new `VoiceFx` (the shifters carry a little state that must not leak between voices).
pub struct VoiceFx {
    voice: Voice,
    shifter: Option<PitchShifter>,
    /// The second, lower voice layered under the first (God).
    sub: Option<PitchShifter>,
    echo: Option<Echo>,
    wobble: Option<Wobble>,
    tone: Option<LowPass>,
    /// Ring-modulator / growl phase in cycles.
    phase: f32,
}

impl VoiceFx {
    pub fn new(voice: Voice) -> Self {
        let shifter = match voice {
            Voice::Giant => Some(PitchShifter::new(0.72, 1920)),
            Voice::Imp => Some(PitchShifter::new(1.4, 1024)),
            Voice::Demon => Some(PitchShifter::new(0.6, 2048)),
            Voice::Dragon => Some(PitchShifter::new(0.5, 2048)),
            Voice::God => Some(PitchShifter::new(0.8, 1920)),
            Voice::Authoritative => Some(PitchShifter::new(0.9, 1920)),
            Voice::Normal | Voice::Robot | Voice::Drunk => None,
        };
        let sub = (voice == Voice::God).then(|| PitchShifter::new(0.5, 2048));
        let echo = match voice {
            Voice::Dragon => Some(Echo::new(70.0, 0.4, 0.35)),
            Voice::God => Some(Echo::new(95.0, 0.5, 0.3)),
            Voice::Authoritative => Some(Echo::new(32.0, 0.2, 0.18)),
            _ => None,
        };
        let wobble = (voice == Voice::Drunk).then(|| Wobble::new(0.9, 14.0, 9.0));
        let tone = (voice == Voice::Drunk).then(|| LowPass::new(3200.0));
        Self {
            voice,
            shifter,
            sub,
            echo,
            wobble,
            tone,
            phase: 0.0,
        }
    }

    pub fn voice(&self) -> Voice {
        self.voice
    }

    /// Extra delay this voice adds, in milliseconds.
    pub fn latency_ms(&self) -> f32 {
        let samples = [
            self.shifter.as_ref().map(PitchShifter::latency_samples),
            self.sub.as_ref().map(PitchShifter::latency_samples),
            self.wobble.as_ref().map(Wobble::latency_samples),
        ]
        .into_iter()
        .flatten()
        .max()
        .unwrap_or(0);
        samples as f32 * 1000.0 / SAMPLE_RATE as f32
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
            Voice::Dragon => {
                self.shifter.as_mut().unwrap().process(input, output);
                let step = GROWL_HZ / SAMPLE_RATE as f32;
                let norm = DRAGON_DRIVE.tanh();
                let echo = self.echo.as_mut().unwrap();
                for y in output.iter_mut() {
                    let rumble = 1.0 - GROWL_DEPTH * (0.5 + 0.5 * (2.0 * PI * self.phase).sin());
                    self.phase = (self.phase + step) % 1.0;
                    let growled = (*y * rumble * DRAGON_DRIVE).tanh() / norm;
                    *y = soft_ceiling(echo.process(growled));
                }
            }
            Voice::God => {
                let mut low = vec![0.0; input.len()];
                self.shifter.as_mut().unwrap().process(input, output);
                self.sub.as_mut().unwrap().process(input, &mut low);
                let echo = self.echo.as_mut().unwrap();
                for (y, l) in output.iter_mut().zip(&low) {
                    *y = soft_ceiling(echo.process(*y * 0.65 + l * 0.45));
                }
            }
            Voice::Drunk => {
                let wobble = self.wobble.as_mut().unwrap();
                let tone = self.tone.as_mut().unwrap();
                for (x, y) in input.iter().zip(output.iter_mut()) {
                    *y = tone.process(wobble.process(*x));
                }
            }
            Voice::Authoritative => {
                self.shifter.as_mut().unwrap().process(input, output);
                let norm = AUTHORITY_DRIVE.tanh();
                let echo = self.echo.as_mut().unwrap();
                for y in output.iter_mut() {
                    // Pushed into a soft limiter, so quiet and loud speech come out nearer in level.
                    let squeezed = (*y * AUTHORITY_DRIVE).tanh() / norm;
                    *y = soft_ceiling(echo.process(squeezed));
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

/// A gentle ceiling so layered or echoed voices can never pass full scale.
fn soft_ceiling(x: f32) -> f32 {
    x.tanh()
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
        assert!(
            carrier < 0.2,
            "the plain voice should be mostly gone: {carrier}"
        );
    }

    #[test]
    fn demon_is_deep_loud_and_never_clips() {
        let input = sine(200.0, 1.0, 0.9);
        let out = run(Voice::Demon, &input);
        assert!(out.iter().all(|s| s.abs() <= 1.0));
        assert!((estimate_freq(&out) - 120.0).abs() < 12.0);
        assert!(
            out.iter().cloned().fold(0.0f32, f32::max) > 0.3,
            "not silent"
        );
    }

    fn peak(x: &[f32]) -> f32 {
        x.iter().fold(0.0f32, |m, s| m.max(s.abs()))
    }

    #[test]
    fn dragon_is_deeper_than_the_demon_and_stays_in_range() {
        let input = sine(200.0, 1.5, 0.8);
        let out = run(Voice::Dragon, &input);
        assert!(peak(&out) <= 1.0);
        assert!(peak(&out) > 0.2, "not silent");
        let dragon = estimate_freq(&out[out.len() / 3..]);
        assert!((dragon - 100.0).abs() < 15.0, "dragon {dragon}");
    }

    #[test]
    fn god_layers_a_lowered_voice_over_a_much_lower_one() {
        let out = run(Voice::God, &sine(300.0, 1.5, 0.5));
        let steady = &out[out.len() / 2..];
        assert!(strength(steady, 240.0) > 0.08, "main voice missing");
        // The octave-down voice lands a little above 150 Hz (the shifter is not exact at this ratio).
        let sub = (145..=175)
            .step_by(5)
            .map(|f| strength(steady, f as f32))
            .fold(0.0f32, f32::max);
        assert!(sub > 0.05, "sub voice missing: {sub}");
        assert!(peak(&out) <= 1.0);
    }

    #[test]
    fn drunk_wobbles_in_pitch_but_stays_near_the_speaker() {
        let input = sine(300.0, 3.0, 0.5);
        let out = run(Voice::Drunk, &input);
        let slice = |i: usize| estimate_freq(&out[i * 4_800 + 24_000..(i + 1) * 4_800 + 24_000]);
        let freqs: Vec<f32> = (0..10).map(slice).collect();
        let (lo, hi) = freqs
            .iter()
            .fold((f32::MAX, f32::MIN), |(l, h), f| (l.min(*f), h.max(*f)));
        assert!(hi - lo > 6.0, "pitch should drift: {lo}..{hi}");
        assert!(lo > 255.0 && hi < 345.0, "but stay near 300 Hz: {lo}..{hi}");
    }

    #[test]
    fn authoritative_is_a_little_lower_and_never_clips() {
        let out = run(Voice::Authoritative, &sine(300.0, 1.0, 0.9));
        assert!(peak(&out) <= 1.0);
        let f = estimate_freq(&out[out.len() / 3..]);
        assert!((f - 270.0).abs() < 15.0, "authoritative {f}");
    }

    #[test]
    fn every_voice_keeps_silence_silent_and_reports_a_sane_latency() {
        for v in Voice::ALL {
            assert!(run(v, &vec![0.0; 4_800]).iter().all(|s| *s == 0.0), "{v:?}");
            assert!(
                VoiceFx::new(v).latency_ms() < 50.0,
                "{v:?} adds too much delay"
            );
        }
    }
}
