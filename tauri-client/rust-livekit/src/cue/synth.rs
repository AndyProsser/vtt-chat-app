//! Synthesised earcons for the recording cues. Generated, not shipped as files: no assets to
//! bundle or license, and they are guaranteed to sound unlike soundboard effects (which are
//! recorded samples) — "start/stop sounds must be distinct from soundboard effects".

use std::f32::consts::TAU;

use super::policy::Cue;

/// Peak amplitude. Loud enough to be unmistakable, far from clipping.
const PEAK: f32 = 0.30;
/// Fade in/out per note, so there are no clicks.
const FADE_MS: f32 = 8.0;
const NOTE_MS: u32 = 140;
const GAP_MS: u32 = 25;

/// `(frequency in Hz, duration in ms)`; a frequency of 0 is silence.
fn notes(cue: Cue) -> &'static [(f32, u32)] {
    match cue {
        // Rising major triad: "recording has begun".
        Cue::Start => &[(523.25, NOTE_MS), (659.25, NOTE_MS), (783.99, NOTE_MS * 2)],
        // Falling major triad: "recording has ended".
        Cue::Stop => &[(783.99, NOTE_MS), (659.25, NOTE_MS), (523.25, NOTE_MS * 2)],
        // Two low, falling notes: "paused".
        Cue::Pause => &[(440.0, NOTE_MS), (329.63, NOTE_MS * 2)],
        // Two mid, rising notes: "recording again".
        Cue::Resume => &[(329.63, NOTE_MS), (440.0, NOTE_MS * 2)],
    }
}

/// Mono samples for `cue` at `sample_rate`, in `-1.0..=1.0`.
pub fn render(cue: Cue, sample_rate: u32) -> Vec<f32> {
    let rate = sample_rate as f32;
    let fade = (FADE_MS / 1000.0 * rate).max(1.0);
    let gap = (GAP_MS as f32 / 1000.0 * rate) as usize;
    let mut out = Vec::new();

    for &(freq, ms) in notes(cue) {
        let len = (ms as f32 / 1000.0 * rate) as usize;
        for i in 0..len {
            let t = i as f32;
            let envelope = (t / fade).min(1.0).min(((len - i) as f32) / fade).max(0.0);
            let sample = if freq > 0.0 {
                (TAU * freq * t / rate).sin()
            } else {
                0.0
            };
            out.push(sample * envelope * PEAK);
        }
        out.extend(std::iter::repeat_n(0.0, gap));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Cue; 4] = [Cue::Start, Cue::Pause, Cue::Resume, Cue::Stop];

    #[test]
    fn every_cue_renders_audible_non_clipping_audio() {
        for cue in ALL {
            let samples = render(cue, 48_000);
            assert!(samples.len() > 48_000 / 4, "{cue:?} is too short to notice");
            let peak = samples.iter().fold(0.0_f32, |p, s| p.max(s.abs()));
            assert!(peak > 0.2, "{cue:?} is too quiet (peak {peak})");
            assert!(peak <= PEAK + 1e-3, "{cue:?} exceeds the peak cap ({peak})");
        }
    }

    #[test]
    fn cues_start_and_end_at_silence_so_they_do_not_click() {
        for cue in ALL {
            let samples = render(cue, 44_100);
            assert!(samples.first().is_some_and(|s| s.abs() < 0.01));
            assert!(samples.last().is_some_and(|s| s.abs() < 0.01));
        }
    }

    #[test]
    fn cues_are_distinguishable_from_each_other() {
        let rendered: Vec<Vec<f32>> = ALL.iter().map(|&cue| render(cue, 48_000)).collect();
        for i in 0..rendered.len() {
            for j in (i + 1)..rendered.len() {
                assert_ne!(rendered[i], rendered[j], "{:?} == {:?}", ALL[i], ALL[j]);
            }
        }
    }

    #[test]
    fn length_scales_with_sample_rate() {
        let at_24k = render(Cue::Start, 24_000).len();
        let at_48k = render(Cue::Start, 48_000).len();
        let ratio = at_48k as f32 / at_24k as f32;
        assert!((ratio - 2.0).abs() < 0.05, "ratio {ratio}");
    }

    #[test]
    fn rendering_is_deterministic() {
        assert_eq!(render(Cue::Stop, 48_000), render(Cue::Stop, 48_000));
    }
}
