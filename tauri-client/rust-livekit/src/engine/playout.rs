//! The playback mixer: every voice and local sound is a named stream of 48 kHz mono samples with its own
//! volume. The sound card asks for one 10 ms block at a time and gets the sum, kept below full scale.
//! Pure arithmetic with no device, so it is fully unit-tested.

use std::collections::{HashMap, VecDeque};

use crate::voice_fx::BLOCK;

/// A stream waits for this much audio before it starts, so a trickle does not play as a stutter.
const PREROLL: usize = BLOCK * 2;
/// The most a stream may hold (200 ms). Beyond it the oldest audio is dropped, so a stalled output
/// device can never make memory or delay grow without bound.
const MAX_BUFFERED: usize = BLOCK * 20;
/// The loudest a single stream may be turned up (the DM may boost one player).
pub const MAX_GAIN: f32 = 2.0;

struct Stream {
    buffered: VecDeque<f32>,
    gain: f32,
    /// False until `PREROLL` has arrived, and again after the stream runs dry.
    playing: bool,
}

pub struct Playout {
    streams: HashMap<String, Stream>,
    master: f32,
}

impl Default for Playout {
    fn default() -> Self {
        Self::new()
    }
}

impl Playout {
    pub fn new() -> Self {
        Self {
            streams: HashMap::new(),
            master: 1.0,
        }
    }

    /// Adds samples to `stream`, creating it (at full volume) the first time.
    pub fn push(&mut self, stream: &str, samples: &[f32]) {
        let s = self.streams.entry(stream.to_string()).or_insert(Stream {
            buffered: VecDeque::new(),
            gain: 1.0,
            playing: false,
        });
        s.buffered.extend(samples.iter().copied());
        if s.buffered.len() > MAX_BUFFERED {
            let excess = s.buffered.len() - MAX_BUFFERED;
            s.buffered.drain(..excess);
        }
        if s.buffered.len() >= PREROLL {
            s.playing = true;
        }
    }

    /// One stream's volume: 0 silent, 1 as received, up to [`MAX_GAIN`]. Remembered even before the
    /// stream has any audio, so a saved volume applies the moment that person starts talking.
    pub fn set_gain(&mut self, stream: &str, gain: f32) {
        let gain = gain.clamp(0.0, MAX_GAIN);
        self.streams
            .entry(stream.to_string())
            .or_insert(Stream {
                buffered: VecDeque::new(),
                gain,
                playing: false,
            })
            .gain = gain;
    }

    pub fn gain(&self, stream: &str) -> f32 {
        self.streams.get(stream).map_or(1.0, |s| s.gain)
    }

    /// Everything's volume together.
    pub fn set_master(&mut self, master: f32) {
        self.master = master.clamp(0.0, MAX_GAIN);
    }

    /// Forgets a stream and its audio (someone left). Its volume is forgotten too.
    pub fn remove(&mut self, stream: &str) {
        self.streams.remove(stream);
    }

    /// Drops buffered audio but keeps volumes (a sound stopped, or the call was rejoined).
    pub fn clear_audio(&mut self, stream: &str) {
        if let Some(s) = self.streams.get_mut(stream) {
            s.buffered.clear();
            s.playing = false;
        }
    }

    /// The next 10 ms for the speakers.
    pub fn next_block(&mut self) -> [f32; BLOCK] {
        let mut out = [0.0f32; BLOCK];
        for s in self.streams.values_mut() {
            if !s.playing {
                continue;
            }
            for slot in out.iter_mut() {
                match s.buffered.pop_front() {
                    Some(x) => *slot += x * s.gain,
                    None => {
                        // Ran dry: wait for a fresh pre-roll rather than play the trickle.
                        s.playing = false;
                        break;
                    }
                }
            }
        }
        for slot in out.iter_mut() {
            *slot = soft_limit(*slot * self.master);
        }
        out
    }

    pub fn stream_count(&self) -> usize {
        self.streams.len()
    }
}

/// Linear up to 0.8, then a smooth curve that approaches full scale and never passes it.
fn soft_limit(x: f32) -> f32 {
    const KNEE: f32 = 0.8;
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        x.signum() * (KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(level: f32, blocks: usize) -> Vec<f32> {
        vec![level; BLOCK * blocks]
    }

    #[test]
    fn two_voices_are_summed_and_each_has_its_own_volume() {
        let mut p = Playout::new();
        p.push("amy", &tone(0.2, 3));
        p.push("bob", &tone(0.1, 3));
        p.set_gain("bob", 0.5);
        let block = p.next_block();
        assert!((block[0] - (0.2 + 0.05)).abs() < 1e-6);
    }

    #[test]
    fn a_volume_set_before_the_person_speaks_applies_when_they_do() {
        let mut p = Playout::new();
        p.set_gain("amy", 0.0);
        p.push("amy", &tone(0.5, 3));
        assert!(p.next_block().iter().all(|s| *s == 0.0));
        assert_eq!(p.gain("amy"), 0.0);
    }

    #[test]
    fn gain_is_clamped_to_the_range() {
        let mut p = Playout::new();
        p.set_gain("amy", 9.0);
        assert_eq!(p.gain("amy"), MAX_GAIN);
        p.set_gain("amy", -1.0);
        assert_eq!(p.gain("amy"), 0.0);
    }

    #[test]
    fn a_trickle_waits_for_its_pre_roll_and_a_dry_stream_waits_again() {
        let mut p = Playout::new();
        p.push("amy", &tone(0.3, 1)); // below pre-roll
        assert!(p.next_block().iter().all(|s| *s == 0.0));
        p.push("amy", &tone(0.3, 1)); // now two blocks
        assert!(p.next_block()[0] > 0.0);
        assert!(p.next_block()[0] > 0.0);
        assert!(
            p.next_block().iter().all(|s| *s == 0.0),
            "dry: silence, not a stale tail"
        );
        p.push("amy", &tone(0.3, 1));
        assert!(
            p.next_block().iter().all(|s| *s == 0.0),
            "one block is below pre-roll again"
        );
    }

    #[test]
    fn a_stalled_output_cannot_make_a_stream_grow_without_bound() {
        let mut p = Playout::new();
        for _ in 0..1_000 {
            p.push("amy", &tone(0.1, 1));
        }
        assert!(p.streams["amy"].buffered.len() <= MAX_BUFFERED);
    }

    #[test]
    fn the_mix_never_exceeds_full_scale_however_many_loud_voices() {
        let mut p = Playout::new();
        for who in ["a", "b", "c", "d", "e"] {
            p.set_gain(who, 2.0);
            p.push(who, &tone(0.9, 3));
        }
        let block = p.next_block();
        assert!(block.iter().all(|s| s.abs() <= 1.0));
        assert!(
            block[0] > 0.95,
            "still loud, just not clipped: {}",
            block[0]
        );
    }

    #[test]
    fn quiet_audio_passes_through_untouched() {
        let mut p = Playout::new();
        p.push("amy", &tone(0.3, 3));
        assert_eq!(p.next_block()[0], 0.3);
    }

    #[test]
    fn master_scales_everything_and_remove_forgets_a_person() {
        let mut p = Playout::new();
        p.push("amy", &tone(0.4, 3));
        p.set_master(0.5);
        assert!((p.next_block()[0] - 0.2).abs() < 1e-6);
        p.remove("amy");
        assert_eq!(p.stream_count(), 0);
        assert!(p.next_block().iter().all(|s| *s == 0.0));
    }

    #[test]
    fn clearing_audio_keeps_the_volume() {
        let mut p = Playout::new();
        p.set_gain("amy", 0.7);
        p.push("amy", &tone(0.4, 3));
        p.clear_audio("amy");
        assert!(p.next_block().iter().all(|s| *s == 0.0));
        assert_eq!(p.gain("amy"), 0.7);
    }
}
