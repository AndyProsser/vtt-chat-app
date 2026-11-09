//! Small building blocks for the character voices: an echo, a swaying delay (vibrato) and a low-pass.

use std::f32::consts::PI;

use super::SAMPLE_RATE;

/// A feedback echo (a comb filter): `wet` of the delayed, fed-back signal is added to the dry one.
pub struct Echo {
    buffer: Vec<f32>,
    pos: usize,
    feedback: f32,
    wet: f32,
}

impl Echo {
    pub fn new(delay_ms: f32, feedback: f32, wet: f32) -> Self {
        let len = ((delay_ms * SAMPLE_RATE as f32 / 1000.0) as usize).max(1);
        Self {
            buffer: vec![0.0; len],
            pos: 0,
            feedback,
            wet,
        }
    }

    pub fn process(&mut self, x: f32) -> f32 {
        let delayed = self.buffer[self.pos];
        self.buffer[self.pos] = x + delayed * self.feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        x + delayed * self.wet
    }
}

/// A delay that sways slowly, which bends the pitch up and down like a wavering voice.
pub struct Wobble {
    buffer: Vec<f32>,
    write: usize,
    phase: f32,
    step: f32,
    base: f32,
    depth: f32,
}

impl Wobble {
    /// `rate_hz` sways per second, each moving the delay by `depth_ms` either side of `base_ms`.
    pub fn new(rate_hz: f32, base_ms: f32, depth_ms: f32) -> Self {
        let per_ms = SAMPLE_RATE as f32 / 1000.0;
        let len = ((base_ms + depth_ms) * per_ms) as usize + 4;
        Self {
            buffer: vec![0.0; len],
            write: 0,
            phase: 0.0,
            step: rate_hz / SAMPLE_RATE as f32,
            base: base_ms * per_ms,
            depth: depth_ms * per_ms,
        }
    }

    /// Average delay this adds, in samples.
    pub fn latency_samples(&self) -> usize {
        self.base as usize
    }

    pub fn process(&mut self, x: f32) -> f32 {
        let len = self.buffer.len();
        self.buffer[self.write] = x;
        let delay = self.base + self.depth * (2.0 * PI * self.phase).sin();
        let pos = (self.write as f32 - delay).rem_euclid(len as f32);
        let i0 = pos.floor() as usize % len;
        let frac = pos - pos.floor();
        let y = self.buffer[i0] * (1.0 - frac) + self.buffer[(i0 + 1) % len] * frac;
        self.write = (self.write + 1) % len;
        self.phase = (self.phase + self.step) % 1.0;
        y
    }
}

/// A one-pole low-pass: softens the top end.
pub struct LowPass {
    a: f32,
    state: f32,
}

impl LowPass {
    pub fn new(cutoff_hz: f32) -> Self {
        let a = 1.0 - (-2.0 * PI * cutoff_hz / SAMPLE_RATE as f32).exp();
        Self { a, state: 0.0 }
    }

    pub fn process(&mut self, x: f32) -> f32 {
        self.state += self.a * (x - self.state);
        self.state
    }
}
