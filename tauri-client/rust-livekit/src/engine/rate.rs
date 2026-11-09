//! Streaming sample-rate conversion by linear interpolation. It keeps its position between calls, so the
//! device's irregular chunk sizes join up without clicks. Linear interpolation is not hi-fi (a little
//! aliasing when going down), which is fine for speech; most devices run at 48 kHz and skip it entirely.

pub struct Rate {
    /// Input samples consumed per output sample.
    step: f64,
    passthrough: bool,
    pending: Vec<f32>,
    pos: f64,
}

impl Rate {
    pub fn new(from_hz: u32, to_hz: u32) -> Self {
        Self {
            step: f64::from(from_hz) / f64::from(to_hz),
            passthrough: from_hz == to_hz,
            pending: Vec::new(),
            pos: 0.0,
        }
    }

    /// Appends the converted `input` to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.passthrough {
            out.extend_from_slice(input);
            return;
        }
        self.pending.extend_from_slice(input);
        // Needs one sample of look-ahead to interpolate.
        while self.pos + 1.0 < self.pending.len() as f64 {
            let i = self.pos as usize;
            let frac = (self.pos - i as f64) as f32;
            out.push(self.pending[i] * (1.0 - frac) + self.pending[i + 1] * frac);
            self.pos += self.step;
        }
        let used = (self.pos as usize).min(self.pending.len());
        self.pending.drain(..used);
        self.pos -= used as f64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(len: usize, hz: f32, rate: f32) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate).sin())
            .collect()
    }

    #[test]
    fn equal_rates_pass_straight_through() {
        let mut r = Rate::new(48_000, 48_000);
        let mut out = Vec::new();
        r.process(&[0.1, 0.2], &mut out);
        assert_eq!(out, vec![0.1, 0.2]);
    }

    #[test]
    fn the_output_length_follows_the_ratio_over_many_irregular_chunks() {
        let mut r = Rate::new(44_100, 48_000);
        let input = sine(44_100, 440.0, 44_100.0);
        let mut out = Vec::new();
        for chunk in input.chunks(441 + 7) {
            r.process(chunk, &mut out);
        }
        assert!((out.len() as i64 - 48_000).abs() <= 3, "{}", out.len());
    }

    #[test]
    fn chunk_boundaries_make_no_difference() {
        let input = sine(8_820, 300.0, 44_100.0);
        let mut whole = Vec::new();
        Rate::new(44_100, 48_000).process(&input, &mut whole);
        let mut pieces = Vec::new();
        let mut r = Rate::new(44_100, 48_000);
        for chunk in input.chunks(333) {
            r.process(chunk, &mut pieces);
        }
        let n = whole.len().min(pieces.len());
        assert!(n > 9_000);
        assert!(whole[..n]
            .iter()
            .zip(&pieces[..n])
            .all(|(a, b)| (a - b).abs() < 1e-5));
    }

    #[test]
    fn a_tone_keeps_its_frequency_going_down_and_up() {
        // 441 Hz at 44.1k is exactly 100 samples a cycle; at 48k it is 108.8 samples a cycle.
        let mut out = Vec::new();
        Rate::new(44_100, 48_000).process(&sine(44_100, 441.0, 44_100.0), &mut out);
        let crossings = out.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        assert!((crossings as i64 - 441).abs() <= 2, "{crossings}");
        let mut down = Vec::new();
        Rate::new(48_000, 16_000).process(&sine(48_000, 441.0, 48_000.0), &mut down);
        let crossings = down
            .windows(2)
            .filter(|w| w[0] <= 0.0 && w[1] > 0.0)
            .count();
        assert!((crossings as i64 - 441).abs() <= 2, "{crossings}");
    }
}
