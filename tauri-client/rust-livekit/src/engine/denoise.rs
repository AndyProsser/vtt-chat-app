//! Background-noise removal for the microphone: RNNoise, in its pure-Rust form (`nnnoiseless`), run on the
//! app's own 10 ms blocks. RNNoise is a small neural network trained on speech and noise; it removes steady
//! sounds (fans, air conditioning, hum) and many short ones (keyboard and mouse clicks) while keeping the
//! voice. It runs after WebRTC's echo cancellation and before the character voice, so it never sees (or
//! has to guess about) the player's own playback or a shifted voice.
//!
//! `Strong` also closes a gate between words. RNNoise reports how likely each block is speech; a key press
//! or mouse click looks like speech for a single block, speech keeps looking like speech, so the gate looks
//! 20 ms ahead and opens only for sound that is speech-like for three blocks running. Everything
//! else is turned down (not silenced), with a short hold so word endings are not clipped. That is what
//! takes out typing and clicks that RNNoise alone lets through. The look-ahead costs 20 ms in `Strong`
//! only. docs/architecture/AUDIO-MIXER.md.

use nnnoiseless::DenoiseState;

use crate::voice_fx::BLOCK;

/// RNNoise works on samples in the range of 16-bit audio, not -1 to 1.
const SCALE: f32 = 32_768.0;

/// How hard to filter. The words are the player's: Light keeps more of the room, Strong is for a loud one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NoiseFilter {
    Off,
    /// Part of the room's sound stays, so it is gentler on a quiet voice.
    Light,
    #[default]
    Standard,
    /// Standard, plus a gate between words.
    Strong,
}

impl NoiseFilter {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "off" => Some(Self::Off),
            "light" => Some(Self::Light),
            "standard" => Some(Self::Standard),
            "strong" => Some(Self::Strong),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Light => "light",
            Self::Standard => "standard",
            Self::Strong => "strong",
        }
    }

    /// How much of the filtered sound is used (the rest is the original).
    fn wet(self) -> f32 {
        match self {
            Self::Off => 0.0,
            Self::Light => 0.6,
            Self::Standard | Self::Strong => 1.0,
        }
    }
}

/// Speech probability at which `Strong` treats a block as speech-like (real speech is mostly above 0.9;
/// a key press is a brief 0.2 to 0.9).
const GATE_THRESHOLD: f32 = 0.5;
/// Blocks the gate stays open after the last speech-like stretch (100 ms), so words are not clipped.
const GATE_HOLD_BLOCKS: u32 = 10;
/// Blocks of look-ahead (20 ms): a block is judged with the two after it.
const LOOKAHEAD: usize = 2;
/// Of a block and the two after it, this many must be speech-like for the gate to open (all three: a click
/// looks like speech for two blocks, because RNNoise answers one block late).
const SUSTAINED: usize = 3;
/// Gain of a closed gate: about -20 dB, not silence, so the line never sounds dead.
const GATE_FLOOR: f32 = 0.1;
/// How far the gate gain may move in one block (it opens at once and closes over about 30 ms).
const GATE_CLOSE_STEP: f32 = 0.3;

pub struct Denoiser {
    state: Box<DenoiseState<'static>>,
    level: NoiseFilter,
    hold: u32,
    gate: f32,
    /// Blocks waiting for the look-ahead (`Strong` only): the filtered block, the original, the speech
    /// probability.
    pending: std::collections::VecDeque<(Vec<f32>, f32)>,
    /// The first block RNNoise returns is a fade-in from nothing; it is dropped, so there is one block
    /// (10 ms) of silence-then-voice at the start of a call rather than a click.
    first: bool,
}

impl Denoiser {
    pub fn new(level: NoiseFilter) -> Self {
        Self {
            state: DenoiseState::new(),
            level,
            hold: 0,
            gate: 1.0,
            pending: std::collections::VecDeque::new(),
            first: true,
        }
    }

    pub fn level(&self) -> NoiseFilter {
        self.level
    }

    pub fn set_level(&mut self, level: NoiseFilter) {
        self.level = level;
        self.hold = 0;
        self.gate = 1.0;
        self.pending.clear();
    }

    /// One 10 ms block in, one out (in `Strong`, the block from 20 ms earlier, so the first two are silent).
    pub fn process(&mut self, block: &[f32]) -> Vec<f32> {
        debug_assert_eq!(block.len(), BLOCK);
        if self.level == NoiseFilter::Off {
            return block.to_vec();
        }
        let input: Vec<f32> = block.iter().map(|s| s * SCALE).collect();
        let mut clean = vec![0.0f32; BLOCK];
        let speech = self.state.process_frame(&mut clean, &input);
        if std::mem::take(&mut self.first) {
            return block.to_vec();
        }
        let wet = self.level.wet();
        let mixed: Vec<f32> = block
            .iter()
            .zip(&clean)
            .map(|(dry, wetted)| wet * (wetted / SCALE) + (1.0 - wet) * dry)
            .collect();
        if self.level != NoiseFilter::Strong {
            return mixed;
        }
        // Look ahead: hold each block back until the next two have been heard, then decide its gate.
        self.pending.push_back((mixed, speech));
        if self.pending.len() <= LOOKAHEAD {
            return vec![0.0; BLOCK];
        }
        let ahead = self
            .pending
            .iter()
            .take(LOOKAHEAD + 1)
            .filter(|(_, p)| *p >= GATE_THRESHOLD)
            .count();
        let (oldest, _) = self.pending.pop_front().expect("just checked the length");
        let gate = self.next_gate(ahead >= SUSTAINED);
        oldest.iter().map(|s| (s * gate).clamp(-1.0, 1.0)).collect()
    }

    /// The gate's gain for this block: open at once for sustained speech, held, then closed gradually.
    fn next_gate(&mut self, speech: bool) -> f32 {
        if speech {
            self.hold = GATE_HOLD_BLOCKS;
            self.gate = 1.0;
        } else if self.hold > 0 {
            self.hold -= 1;
        } else {
            self.gate = (self.gate - GATE_CLOSE_STEP).max(GATE_FLOOR);
        }
        self.gate
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// Deterministic white noise in -1..1.
    struct Noise(u32);
    impl Noise {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (self.0 >> 8) as f32 / (1 << 23) as f32 - 1.0
        }
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    /// A fan or air conditioner: noise with its energy at low frequencies (two one-pole filters, about
    /// 600 Hz), the way a real one sounds. (Plain white hiss is not a fan, and RNNoise, trained on real
    /// rooms, treats it as speech-like.)
    fn fan(seconds: usize) -> Vec<f32> {
        let mut noise = Noise(7);
        let (mut a, mut b) = (0.0f32, 0.0f32);
        let raw: Vec<f32> = (0..48_000 * seconds)
            .map(|_| {
                a += 0.08 * (noise.next() - a);
                b += 0.08 * (a - b);
                b
            })
            .collect();
        scaled(&raw, 0.02) // about -34 dBFS: a noticeable air conditioner
    }

    /// The signal scaled so its overall level (rms) is `target`.
    fn scaled(x: &[f32], target: f32) -> Vec<f32> {
        let gain = target / rms(x).max(1e-9);
        x.iter().map(|s| s * gain).collect()
    }

    /// Keyboard: a short burst of decaying noise every 150 ms.
    fn typing(seconds: usize) -> Vec<f32> {
        let mut noise = Noise(11);
        (0..48_000 * seconds)
            .map(|i| {
                let phase = i % 7_200;
                if phase < 300 {
                    0.4 * noise.next() * (1.0 - phase as f32 / 300.0)
                } else {
                    0.0
                }
            })
            .collect()
    }

    /// Something voice-like: a 120 Hz glottal pulse train through three formant resonances, in
    /// syllables with pauses. Not a person, but it has what the network looks for.
    fn speech(seconds: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; 48_000 * seconds];
        let formants = [(700.0f32, 90.0f32), (1_200.0, 110.0), (2_600.0, 160.0)];
        let mut state = [[0.0f32; 2]; 3];
        for (i, sample) in out.iter_mut().enumerate() {
            let t = i as f32 / 48_000.0;
            let f0 = 120.0 + 8.0 * (2.0 * PI * 5.0 * t).sin();
            let pulse = if (t * f0).fract() < 0.03 { 1.0 } else { 0.0 };
            let syllable = (t % 0.4) < 0.25;
            let mut y = 0.0;
            for (k, (freq, bw)) in formants.iter().enumerate() {
                let r = (-PI * bw / 48_000.0).exp();
                let a1 = -2.0 * r * (2.0 * PI * freq / 48_000.0).cos();
                let a2 = r * r;
                let out_k = pulse - a1 * state[k][0] - a2 * state[k][1];
                state[k][1] = state[k][0];
                state[k][0] = out_k;
                y += out_k;
            }
            *sample = if syllable { y } else { 0.0 };
        }
        // Loud talking is around -20 dBFS while it lasts; the syllables are 62% of the time.
        scaled(&out, 0.1 * 0.62_f32.sqrt())
    }

    fn run(level: NoiseFilter, signal: &[f32]) -> Vec<f32> {
        let mut d = Denoiser::new(level);
        signal
            .as_chunks::<BLOCK>()
            .0
            .iter()
            .flat_map(|b| d.process(b))
            .collect()
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.max(1e-9).log10()
    }

    /// Level of the last second, after the network has settled.
    fn settled(x: &[f32]) -> f32 {
        rms(&x[x.len() - 48_000..])
    }

    #[test]
    fn off_changes_nothing() {
        let signal = speech(1);
        assert_eq!(run(NoiseFilter::Off, &signal), signal);
    }

    #[test]
    fn a_steady_fan_is_taken_down_a_long_way() {
        let signal = fan(4);
        let out = run(NoiseFilter::Standard, &signal);
        let cut = db(settled(&out) / settled(&signal));
        eprintln!("fan: {cut:.1} dB");
        assert!(
            cut < -30.0,
            "a fan should drop by more than 30 dB: {cut:.1}"
        );
    }

    #[test]
    fn typing_is_reduced_and_strong_reduces_it_more() {
        let signal = typing(4);
        let standard = db(settled(&run(NoiseFilter::Standard, &signal)) / settled(&signal));
        let strong = db(settled(&run(NoiseFilter::Strong, &signal)) / settled(&signal));
        eprintln!("typing: standard {standard:.1} dB, strong {strong:.1} dB");
        // RNNoise alone only dents loud clicks; the gate in Strong is what removes them.
        assert!(standard < -1.0, "standard: {standard:.1}");
        assert!(
            strong < standard - 6.0,
            "the gate should take typing between words down further: strong {strong:.1} vs standard {standard:.1}"
        );
    }

    #[test]
    fn a_voice_comes_through_and_light_keeps_more_of_the_room_than_standard() {
        let signal = speech(4);
        let kept = |level| db(settled(&run(level, &signal)) / settled(&signal));
        let standard = kept(NoiseFilter::Standard);
        let light = kept(NoiseFilter::Light);
        eprintln!("voice kept: standard {standard:.1} dB, light {light:.1} dB");
        assert!(
            standard > -12.0,
            "the voice must not be eaten: {standard:.1} dB"
        );
        assert!(
            light >= standard - 0.5,
            "light {light:.1} vs standard {standard:.1}"
        );
    }

    #[test]
    fn the_level_names_round_trip_and_reject_unknowns() {
        for level in [
            NoiseFilter::Off,
            NoiseFilter::Light,
            NoiseFilter::Standard,
            NoiseFilter::Strong,
        ] {
            assert_eq!(NoiseFilter::from_name(level.name()), Some(level));
        }
        assert_eq!(NoiseFilter::from_name("loud"), None);
    }

    #[test]
    fn switching_the_level_live_keeps_the_audio_flowing() {
        let signal = speech(1);
        let mut d = Denoiser::new(NoiseFilter::Off);
        let mut out = Vec::new();
        for (i, block) in signal.as_chunks::<BLOCK>().0.iter().enumerate() {
            if i == 40 {
                d.set_level(NoiseFilter::Strong);
            }
            out.extend(d.process(block));
        }
        assert_eq!(out.len(), signal.len());
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    /// A check on real speech and real-sounding noise, run by hand (it needs a recording):
    /// `ffmpeg -i speech.wav -ar 48000 -ac 1 -f f32le speech.raw`, then
    /// `VTT_SPEECH_RAW=speech.raw cargo test -p rust-livekit real_speech -- --ignored --nocapture`.
    /// It prints how much of the voice survives and how far the room falls, and (with `VTT_DENOISE_OUT`
    /// set to a folder) writes `.raw` files of the input and each level to listen to.
    #[test]
    #[ignore = "needs VTT_SPEECH_RAW, a mono 48 kHz f32 recording of speech"]
    fn real_speech_survives_and_the_room_falls() {
        let path = std::env::var("VTT_SPEECH_RAW").expect("VTT_SPEECH_RAW");
        let bytes = std::fs::read(path).expect("the recording");
        let voice: Vec<f32> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes(*c))
            .collect();
        let voice = scaled(&voice, 0.08); // about -22 dBFS, ordinary talking
        let seconds = voice.len() / 48_000 + 1;
        let room = fan(seconds);
        let keys = typing(seconds);
        let mixed: Vec<f32> = voice
            .iter()
            .zip(room.iter().zip(&keys))
            .map(|(v, (f, k))| v + f + 0.25 * k)
            .collect();
        for level in [
            NoiseFilter::Light,
            NoiseFilter::Standard,
            NoiseFilter::Strong,
        ] {
            let clean_voice = run(level, &voice);
            let kept = db(rms(&clean_voice) / rms(&voice));
            let room_only = run(level, &room);
            let room_cut = db(rms(&room_only[24_000..]) / rms(&room[24_000..]));
            let keys_only = run(level, &keys);
            let keys_cut = db(rms(&keys_only) / rms(&keys));
            eprintln!(
                "{:>8}: voice kept {kept:+.1} dB, room {room_cut:+.1} dB, typing {keys_cut:+.1} dB",
                level.name()
            );
            if let Ok(dir) = std::env::var("VTT_DENOISE_OUT") {
                let write = |name: &str, x: &[f32]| {
                    let bytes: Vec<u8> = x.iter().flat_map(|s| s.to_le_bytes()).collect();
                    std::fs::write(format!("{dir}/{name}.raw"), bytes).expect("write");
                };
                write(&format!("mixed-{}", level.name()), &run(level, &mixed));
            }
        }
        if let Ok(dir) = std::env::var("VTT_DENOISE_OUT") {
            let bytes: Vec<u8> = mixed.iter().flat_map(|s| s.to_le_bytes()).collect();
            std::fs::write(format!("{dir}/mixed-input.raw"), bytes).expect("write");
        }
    }
}
