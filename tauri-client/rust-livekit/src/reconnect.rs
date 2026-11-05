//! Pure pieces of the auto-rejoin logic, kept free of I/O so they are unit-testable.

use std::time::{Duration, SystemTime};

/// Exponential backoff with a cap. `next_delay` takes the jitter as an argument (a fraction in
/// `0.0..=1.0`) so tests are deterministic; the caller supplies something cheap and random.
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

    /// Delay before the next attempt: `base * 2^attempt`, capped, then reduced by up to 50 % by
    /// `jitter` so a room full of clients dropped at once don't all retry in lock-step.
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

/// Did the machine sleep (or the process get frozen) between two heartbeat ticks?
///
/// A heartbeat that should fire every `tick` instead fires much later: the wall clock advanced by
/// far more than `tick`. After a gap like that the media connection is almost certainly dead even
/// if the SDK hasn't noticed yet, so the client tears down and rejoins immediately rather than
/// waiting for a timeout. A backwards clock step (NTP) is not a resume.
pub fn gap_indicates_resume(
    previous_tick: SystemTime,
    now: SystemTime,
    tick: Duration,
    threshold: Duration,
) -> bool {
    match now.duration_since(previous_tick) {
        Ok(elapsed) => elapsed > tick + threshold,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_then_caps() {
        let mut backoff = Backoff::new(Duration::from_secs(1), Duration::from_secs(10));
        let delays: Vec<u64> = (0..6).map(|_| backoff.next_delay(0.0).as_secs()).collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 10, 10]);
    }

    #[test]
    fn backoff_jitter_only_shortens_by_up_to_half() {
        let mut backoff = Backoff::new(Duration::from_secs(8), Duration::from_secs(30));
        assert_eq!(backoff.next_delay(1.0), Duration::from_secs(4));
        let mut backoff = Backoff::new(Duration::from_secs(8), Duration::from_secs(30));
        assert_eq!(backoff.next_delay(0.0), Duration::from_secs(8));
        // Out-of-range jitter is clamped, not trusted.
        let mut backoff = Backoff::new(Duration::from_secs(8), Duration::from_secs(30));
        assert_eq!(backoff.next_delay(5.0), Duration::from_secs(4));
    }

    #[test]
    fn backoff_reset_starts_over() {
        let mut backoff = Backoff::default();
        backoff.next_delay(0.0);
        backoff.next_delay(0.0);
        backoff.reset();
        assert_eq!(backoff.next_delay(0.0), Duration::from_secs(1));
    }

    #[test]
    fn backoff_does_not_overflow_after_many_failures() {
        let mut backoff = Backoff::default();
        for _ in 0..1_000 {
            assert!(backoff.next_delay(0.0) <= Duration::from_secs(30));
        }
    }

    #[test]
    fn detects_a_resume_gap() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        let tick = Duration::from_secs(5);
        let threshold = Duration::from_secs(10);
        // Normal tick, slightly late: not a resume.
        assert!(!gap_indicates_resume(
            start,
            start + Duration::from_secs(6),
            tick,
            threshold
        ));
        // Exactly at the limit: not a resume.
        assert!(!gap_indicates_resume(
            start,
            start + Duration::from_secs(15),
            tick,
            threshold
        ));
        // A long sleep: resume.
        assert!(gap_indicates_resume(
            start,
            start + Duration::from_secs(600),
            tick,
            threshold
        ));
    }

    #[test]
    fn clock_stepping_backwards_is_not_a_resume() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert!(!gap_indicates_resume(
            start,
            start - Duration::from_secs(30),
            Duration::from_secs(5),
            Duration::from_secs(10)
        ));
    }
}
