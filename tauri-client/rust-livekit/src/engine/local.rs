//! Sounds the app plays for itself (recording cues, the DM's soundboard monitor). When the mixer engine
//! is running they go *through its playout mixer* instead of a second sound-card stream, which is what
//! lets the echo canceller know about them. With no mixer running they play the old way.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::playout::Playout;
use crate::voice_fx::BLOCK;

static CURRENT: Mutex<Option<Arc<Mutex<Playout>>>> = Mutex::new(None);

/// Called by the mixer engine when it starts (with its playout) and stops (with `None`).
pub fn set(playout: Option<Arc<Mutex<Playout>>>) {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = playout;
}

/// The running mixer's playout, if the mixer engine is in use.
pub fn current() -> Option<Arc<Mutex<Playout>>> {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Plays `samples` (mono, 48 kHz) as stream `stream` in real time and returns when they have all been
/// handed over. Paced because a stream holds only 200 ms. `false` when the mixer is not running.
pub fn play_blocking(stream: &str, samples: &[f32]) -> bool {
    let Some(playout) = current() else {
        return false;
    };
    for chunk in samples.chunks(BLOCK) {
        let mut block = chunk.to_vec();
        block.resize(BLOCK, 0.0);
        playout
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(stream, &block);
        std::thread::sleep(Duration::from_millis(10));
    }
    // Let the last of it reach the speakers before the caller treats the sound as finished.
    std::thread::sleep(Duration::from_millis(80));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    // The registry is process-wide, so tests that touch it must not run at the same time.
    static SERIAL: StdMutex<()> = StdMutex::new(());

    #[test]
    fn without_a_mixer_nothing_is_played_here() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        set(None);
        assert!(!play_blocking("local:cue", &[0.1; 480]));
    }

    #[test]
    fn with_a_mixer_the_sound_reaches_its_playout_in_order_and_in_time() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let playout = Arc::new(Mutex::new(Playout::new()));
        set(Some(playout.clone()));
        let started = std::time::Instant::now();
        let drained = Arc::clone(&playout);
        // Drain as a sound card would, so the 200 ms cap is not what limits the test.
        let drain = std::thread::spawn(move || {
            let mut peak = 0.0f32;
            for _ in 0..60 {
                let block = drained.lock().unwrap().next_block();
                peak = block.iter().fold(peak, |m, s| m.max(s.abs()));
                std::thread::sleep(Duration::from_millis(10));
            }
            peak
        });
        assert!(play_blocking("local:cue", &vec![0.4; BLOCK * 20]));
        assert!(
            started.elapsed() >= Duration::from_millis(200),
            "paced, not dumped"
        );
        assert!(drain.join().unwrap() > 0.3);
        assert!(playout.lock().unwrap().peak_seen("local:cue") > 0.3);
        set(None);
    }
}
