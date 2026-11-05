//! The local recording-cue player (CLAUDE.md §8.2, §8.4).
//!
//! Cues are played **on this machine only** — never through the SFU — so they are absent from the
//! recording and its transcript, still work while the mic is muted, and don't depend on the server
//! being healthy. `policy` decides *when*; `synth` makes the sound; `play` puts it on the speakers.

mod play;
pub mod policy;
pub mod synth;

pub use play::{play_cue, play_cue_blocking};
pub use policy::{decide, Acknowledgement, Cue, Decision, RecordingStatus, Source};
