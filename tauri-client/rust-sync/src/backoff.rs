use std::time::Duration;

/// Exponential backoff with a cap and jitter, for reconnecting. Same policy as the voice client
/// (`rust-livekit`); duplicated rather than shared because these crates are deliberately
/// independent leaves. `jitter` is a fraction in `0.0..=1.0`, passed in so tests are deterministic.
#[derive(Debug, Clone)]
pub struct Backoff {
    base: Duration,
    cap: Duration,
    attempt: u32,
}

impl Backoff {
    pub fn new(base: Duration, cap: Duration) -> Self {
        Self {
            base,
            cap,
            attempt: 0,
        }
    }

    pub fn next_delay(&mut self, jitter: f64) -> Duration {
        let exponent = self.attempt.min(16);
        self.attempt = self.attempt.saturating_add(1);
        let raw = self.base.saturating_mul(1u32 << exponent).min(self.cap);
        raw.mul_f64(1.0 - 0.5 * jitter.clamp(0.0, 1.0))
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new(Duration::from_secs(1), Duration::from_secs(30))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_then_caps_and_resets() {
        let mut b = Backoff::new(Duration::from_secs(1), Duration::from_secs(10));
        let delays: Vec<u64> = (0..6).map(|_| b.next_delay(0.0).as_secs()).collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 10, 10]);
        b.reset();
        assert_eq!(b.next_delay(0.0), Duration::from_secs(1));
    }

    #[test]
    fn jitter_only_shortens_and_is_clamped() {
        let mut b = Backoff::new(Duration::from_secs(8), Duration::from_secs(30));
        assert_eq!(b.next_delay(1.0), Duration::from_secs(4));
        let mut b = Backoff::new(Duration::from_secs(8), Duration::from_secs(30));
        assert_eq!(b.next_delay(9.0), Duration::from_secs(4));
    }
}
