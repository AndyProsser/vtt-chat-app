//! Pitch shifting by two crossfading, delay-modulated read heads (the classic "dual tap" shifter).
//! No look-ahead and no FFT: latency is about half the window, and the cost is a few multiplies per
//! sample, which suits live speech on a laptop.

use std::f32::consts::PI;

pub struct PitchShifter {
    ratio: f32,
    buffer: Vec<f32>,
    write: usize,
    /// Read-head phase 0..1; the second head is half a cycle behind.
    phase: f32,
    window: f32,
}

impl PitchShifter {
    /// `ratio` > 1 raises the pitch, < 1 lowers it; `window` is the delay-line length in samples
    /// (longer is smoother and lower-pitched voices need more; shorter is lower latency).
    pub fn new(ratio: f32, window: usize) -> Self {
        Self {
            ratio,
            buffer: vec![0.0; window * 2],
            write: 0,
            phase: 0.0,
            window: window as f32,
        }
    }

    /// Algorithmic delay in samples on average (the heads sweep 0..window, crossfaded).
    pub fn latency_samples(&self) -> usize {
        (self.window / 2.0) as usize
    }

    fn read(&self, delay: f32) -> f32 {
        let len = self.buffer.len();
        let pos = (self.write as f32 - 1.0 - delay).rem_euclid(len as f32);
        let i0 = pos.floor() as usize % len;
        let i1 = (i0 + 1) % len;
        let frac = pos - pos.floor();
        self.buffer[i0] * (1.0 - frac) + self.buffer[i1] * frac
    }

    pub fn process(&mut self, input: &[f32], output: &mut [f32]) {
        debug_assert_eq!(input.len(), output.len());
        // How fast the delay sweeps per sample: reading faster than writing (ratio > 1) shortens it.
        let step = (1.0 - self.ratio) / self.window;
        for (x, y) in input.iter().zip(output.iter_mut()) {
            self.buffer[self.write] = *x;
            let d1 = self.phase * self.window;
            let d2 = ((self.phase + 0.5) % 1.0) * self.window;
            // Hann-shaped gains, 180° apart, sum to 1 and are zero where a head wraps.
            let g1 = 0.5 - 0.5 * (2.0 * PI * self.phase).cos();
            let g2 = 1.0 - g1;
            *y = self.read(d1) * g1 + self.read(d2) * g2;
            self.phase = (self.phase + step).rem_euclid(1.0);
            self.write = (self.write + 1) % self.buffer.len();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn sine(freq: f32, seconds: f32, amp: f32) -> Vec<f32> {
        (0..(48_000.0 * seconds) as usize)
            .map(|i| amp * (2.0 * PI * freq * i as f32 / 48_000.0).sin())
            .collect()
    }

    /// Dominant frequency from rising zero crossings over the second half (steady state).
    pub fn estimate_freq(samples: &[f32]) -> f32 {
        let tail = &samples[samples.len() / 2..];
        let crossings = tail.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        crossings as f32 / (tail.len() as f32 / 48_000.0)
    }

    pub fn run(shifter: &mut PitchShifter, input: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0; input.len()];
        for (i, o) in input.chunks(480).zip(out.chunks_mut(480)) {
            shifter.process(i, o);
        }
        out
    }

    #[test]
    fn a_ratio_of_one_over_two_halves_the_pitch() {
        let out = run(&mut PitchShifter::new(0.5, 1536), &sine(440.0, 1.0, 0.5));
        let f = estimate_freq(&out);
        assert!((f - 220.0).abs() < 12.0, "got {f} Hz");
    }

    #[test]
    fn a_ratio_of_two_doubles_the_pitch() {
        let out = run(&mut PitchShifter::new(2.0, 1536), &sine(300.0, 1.0, 0.5));
        let f = estimate_freq(&out);
        assert!((f - 600.0).abs() < 25.0, "got {f} Hz");
    }

    #[test]
    fn a_ratio_of_one_passes_the_pitch_through() {
        let out = run(&mut PitchShifter::new(1.0, 1536), &sine(440.0, 1.0, 0.5));
        assert!((estimate_freq(&out) - 440.0).abs() < 8.0);
    }

    #[test]
    fn silence_stays_silent_and_loud_input_does_not_clip() {
        let silent = run(&mut PitchShifter::new(0.7, 1536), &vec![0.0; 9_600]);
        assert!(silent.iter().all(|s| *s == 0.0));
        let loud = run(&mut PitchShifter::new(0.7, 1536), &sine(200.0, 1.0, 0.95));
        assert!(loud.iter().all(|s| s.abs() <= 1.0), "output must stay in range");
    }

    #[test]
    fn latency_is_about_half_the_window() {
        assert_eq!(PitchShifter::new(0.8, 1536).latency_samples(), 768); // 16 ms at 48 kHz
    }
}
