//! Crash recovery: the app restarts itself if it dies.
//!
//! A tray app that is meant to run for a whole session, hidden, must not stay dead after a crash
//! nobody saw (libwebrtc is native code; a segfault takes the process with it). So in release
//! builds `main` runs a tiny **supervisor** process that starts the real app as a child and
//! restarts it when it exits abnormally. A clean exit (the tray's Quit, code 0) ends both. The
//! supervisor only waits on the child, so it costs nothing while the app runs. Saved sign-in resumes
//! on its own at start, so a restart puts the player back in the room.

use std::process::Command;
use std::time::{Duration, Instant};

/// Set on the supervised child so it knows not to supervise again.
pub const CHILD_ENV: &str = "VTT_SUPERVISED_CHILD";
/// Force supervision on (it is on by default only in release builds) or `VTT_NO_SUPERVISE` to opt out.
pub const FORCE_ENV: &str = "VTT_SUPERVISE";
pub const OPT_OUT_ENV: &str = "VTT_NO_SUPERVISE";

/// More than this many crashes within [`WINDOW`] means something is badly wrong: stop restarting
/// rather than loop forever (the tray icon is gone, but a crash loop would be worse).
const MAX_CRASHES: usize = 5;
const WINDOW: Duration = Duration::from_secs(5 * 60);
const MAX_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, PartialEq, Eq)]
pub enum Next {
    Restart(Duration),
    GiveUp,
}

/// Records a crash at `now` and decides what to do: back off 1 s, 2 s, 4 s … (capped), and give up
/// after [`MAX_CRASHES`] in a [`WINDOW`]. Older crashes age out, so a long-lived app that crashes
/// once a day is restarted promptly every time.
pub fn next_step(history: &mut Vec<Instant>, now: Instant) -> Next {
    history.retain(|t| now.duration_since(*t) < WINDOW);
    history.push(now);
    if history.len() > MAX_CRASHES {
        return Next::GiveUp;
    }
    let exponent = (history.len() - 1) as u32;
    Next::Restart(Duration::from_secs(1u64 << exponent).min(MAX_DELAY))
}

/// Whether this process should supervise instead of running the app.
pub fn should_supervise(is_child: bool, release_build: bool, force: bool, opted_out: bool) -> bool {
    !is_child && !opted_out && (release_build || force)
}

/// Runs the app as a child until it exits cleanly or keeps crashing. Returns the process exit code.
pub fn run_supervised() -> i32 {
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(err) => {
            eprintln!("[supervisor] cannot find my own executable ({err}); running unsupervised");
            return -1;
        }
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut crashes = Vec::new();
    loop {
        let status = Command::new(&exe).args(&args).env(CHILD_ENV, "1").status();
        match status {
            Ok(s) if s.success() => return 0,
            Ok(s) => eprintln!("[supervisor] the app exited abnormally ({s})"),
            Err(err) => eprintln!("[supervisor] could not start the app: {err}"),
        }
        match next_step(&mut crashes, Instant::now()) {
            Next::Restart(delay) => {
                eprintln!("[supervisor] restarting in {delay:?}");
                std::thread::sleep(delay);
            }
            Next::GiveUp => {
                eprintln!("[supervisor] too many crashes in a row; giving up");
                return 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_exponentially_then_caps() {
        let start = Instant::now();
        let mut history = Vec::new();
        let delays: Vec<_> = (0..5)
            .map(|i| next_step(&mut history, start + Duration::from_secs(i)))
            .collect();
        assert_eq!(
            delays,
            [1, 2, 4, 8, 16].map(|s| Next::Restart(Duration::from_secs(s)))
        );
    }

    #[test]
    fn gives_up_after_too_many_crashes_in_the_window() {
        let start = Instant::now();
        let mut history = Vec::new();
        for i in 0..MAX_CRASHES as u64 {
            assert!(matches!(
                next_step(&mut history, start + Duration::from_secs(i)),
                Next::Restart(_)
            ));
        }
        assert_eq!(
            next_step(&mut history, start + Duration::from_secs(10)),
            Next::GiveUp
        );
    }

    #[test]
    fn old_crashes_age_out_so_an_occasional_crash_restarts_quickly() {
        let start = Instant::now();
        let mut history = Vec::new();
        for day in 0..20u64 {
            assert_eq!(
                next_step(&mut history, start + Duration::from_secs(day * 86_400)),
                Next::Restart(Duration::from_secs(1))
            );
        }
    }

    #[test]
    fn supervises_release_builds_and_when_forced_but_never_the_child_or_when_opted_out() {
        assert!(should_supervise(false, true, false, false));
        assert!(
            !should_supervise(false, false, false, false),
            "dev builds run plainly"
        );
        assert!(should_supervise(false, false, true, false));
        assert!(
            !should_supervise(true, true, true, false),
            "the child never supervises"
        );
        assert!(!should_supervise(false, true, true, true), "opt-out wins");
    }
}
