//! Plays each recording cue once so you can judge them by ear: are they unmistakable, pleasant,
//! and clearly different from one another? No server needed.
//!
//!   cargo run -p rust-livekit --example cue_demo

use std::thread::sleep;
use std::time::Duration;

use rust_livekit::cue::{play_cue_blocking, Cue};

fn main() {
    for (label, cue) in [
        ("start  (rising triad)", Cue::Start),
        ("pause  (two low falling notes)", Cue::Pause),
        ("resume (two mid rising notes)", Cue::Resume),
        ("stop   (falling triad)", Cue::Stop),
    ] {
        println!("{label}");
        if let Err(err) = play_cue_blocking(cue) {
            eprintln!("  failed: {err}");
            std::process::exit(1);
        }
        sleep(Duration::from_millis(900));
    }
}
