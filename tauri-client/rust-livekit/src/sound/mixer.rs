//! The soundboard's mixer: pure sample arithmetic, no device, so it is fully unit-tested.
//!
//! Every voice is a decoded mono clip already at the output rate. A voice plays once or loops until
//! stopped; the master gain (the DM's table volume times this player's own gain) is applied last.

use std::sync::Arc;

struct Voice {
    id: String,
    clip: Arc<Vec<f32>>,
    position: usize,
    looping: bool,
    gain: f32,
    /// Started by a scene layer rather than a stinger button, so the scene level applies to it.
    scene: bool,
}

#[derive(Default)]
pub struct Mixer {
    voices: Vec<Voice>,
    master: f32,
    /// The DM's live level for stingers and for scenes, 0 to 1 each; applied to every voice of that kind as it
    /// plays, so moving a slider changes what is already sounding.
    levels: (f32, f32),
}

impl Mixer {
    pub fn new() -> Self {
        Self {
            voices: Vec::new(),
            master: 1.0,
            levels: (1.0, 1.0),
        }
    }

    /// Starts a voice. A second `play` with the same id replaces the first (the server never reuses
    /// an id for a different sound, so this is only a replayed event).
    pub fn play(&mut self, id: &str, clip: Arc<Vec<f32>>, looping: bool, gain: f32) {
        self.play_in(id, clip, looping, gain, false);
    }

    /// As [`Mixer::play`], saying whether a scene layer started it (so the scene level, not the stinger level, applies).
    pub fn play_in(
        &mut self,
        id: &str,
        clip: Arc<Vec<f32>>,
        looping: bool,
        gain: f32,
        scene: bool,
    ) {
        self.voices.retain(|v| v.id != id);
        if clip.is_empty() {
            return;
        }
        self.voices.push(Voice {
            id: id.to_string(),
            clip,
            position: 0,
            looping,
            gain: gain.max(0.0),
            scene,
        });
    }

    pub fn stop(&mut self, id: &str) {
        self.voices.retain(|v| v.id != id);
    }

    pub fn stop_all(&mut self) {
        self.voices.clear();
    }

    /// 0 = silent, 1 = as recorded, up to 2 (the DM may boost one player).
    pub fn set_master(&mut self, master: f32) {
        self.master = master.clamp(0.0, 2.0);
    }

    /// The DM's level for stingers and for scenes (0 to 1 each), applied to sounds already playing too.
    pub fn set_levels(&mut self, stingers: f32, scenes: f32) {
        self.levels = (stingers.clamp(0.0, 1.0), scenes.clamp(0.0, 1.0));
    }

    pub fn is_idle(&self) -> bool {
        self.voices.is_empty()
    }

    pub fn voice_count(&self) -> usize {
        self.voices.len()
    }

    /// Adds the next `out.len()` samples of every voice into `out` (which is overwritten).
    pub fn fill(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let levels = self.levels;
        for voice in &mut self.voices {
            let level = if voice.scene { levels.1 } else { levels.0 };
            for slot in out.iter_mut() {
                if voice.position >= voice.clip.len() {
                    if voice.looping {
                        voice.position = 0;
                    } else {
                        break;
                    }
                }
                *slot += voice.clip[voice.position] * voice.gain * level;
                voice.position += 1;
            }
        }
        self.voices
            .retain(|v| v.looping || v.position < v.clip.len());
        for slot in out.iter_mut() {
            // Hard-limited rather than wrapped: several loud voices must not produce a crack.
            *slot = (*slot * self.master).clamp(-1.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(values: &[f32]) -> Arc<Vec<f32>> {
        Arc::new(values.to_vec())
    }

    #[test]
    fn the_stinger_and_scene_levels_apply_live_to_what_is_already_playing() {
        let mut mixer = Mixer::new();
        mixer.play_in("rain", clip(&[0.4]), true, 1.0, true);
        mixer.play_in("door", clip(&[0.4]), true, 1.0, false);
        let mut out = [0.0; 1];
        mixer.set_levels(1.0, 0.0); // the scene is turned right down while it plays
        mixer.fill(&mut out);
        assert_eq!(out, [0.4]);
        mixer.set_levels(0.5, 1.0);
        mixer.fill(&mut out);
        assert!((out[0] - 0.6).abs() < 1e-6);
    }

    #[test]
    fn a_one_shot_plays_once_and_then_the_mixer_is_idle() {
        let mut mixer = Mixer::new();
        mixer.play("a", clip(&[0.5, 0.25]), false, 1.0);
        let mut out = [9.0; 4];
        mixer.fill(&mut out);
        assert_eq!(out, [0.5, 0.25, 0.0, 0.0]);
        assert!(mixer.is_idle());
    }

    #[test]
    fn a_loop_wraps_until_stopped() {
        let mut mixer = Mixer::new();
        mixer.play("rain", clip(&[0.1, 0.2]), true, 1.0);
        let mut out = [0.0; 5];
        mixer.fill(&mut out);
        assert_eq!(out, [0.1, 0.2, 0.1, 0.2, 0.1]);
        assert!(!mixer.is_idle());
        mixer.stop("rain");
        assert!(mixer.is_idle());
    }

    #[test]
    fn voices_sum_and_gains_multiply() {
        let mut mixer = Mixer::new();
        mixer.play("a", clip(&[0.2]), false, 1.0);
        mixer.play("b", clip(&[0.2]), false, 0.5);
        mixer.set_master(0.5);
        let mut out = [0.0; 1];
        mixer.fill(&mut out);
        assert!((out[0] - 0.15).abs() < 1e-6, "{}", out[0]);
    }

    #[test]
    fn loud_sums_are_limited_not_wrapped() {
        let mut mixer = Mixer::new();
        mixer.play("a", clip(&[0.9]), false, 1.0);
        mixer.play("b", clip(&[0.9]), false, 1.0);
        let mut out = [0.0; 1];
        mixer.fill(&mut out);
        assert_eq!(out[0], 1.0);
    }

    #[test]
    fn master_is_bounded_and_zero_silences() {
        let mut mixer = Mixer::new();
        mixer.play("a", clip(&[0.5; 2]), false, 1.0);
        mixer.set_master(0.0);
        let mut out = [1.0; 2];
        mixer.fill(&mut out);
        assert_eq!(out, [0.0, 0.0]);
        mixer.set_master(99.0);
        mixer.play("b", clip(&[0.4]), false, 1.0);
        mixer.fill(&mut out);
        assert!((out[0] - 0.8).abs() < 1e-6, "clamped to 2x: {}", out[0]);
    }

    #[test]
    fn replaying_an_id_replaces_it_and_empty_clips_are_ignored() {
        let mut mixer = Mixer::new();
        mixer.play("a", clip(&[0.1]), true, 1.0);
        mixer.play("a", clip(&[0.3]), true, 1.0);
        assert_eq!(mixer.voice_count(), 1);
        mixer.play("e", clip(&[]), true, 1.0);
        assert_eq!(mixer.voice_count(), 1);
        mixer.stop_all();
        assert!(mixer.is_idle());
    }
}
