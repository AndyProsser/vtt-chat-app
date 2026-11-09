//! The mixer engine: our own capture and playback around WebRTC's audio processing (see
//! docs/architecture/AUDIO-MIXER.md). Built in layers, each testable without a sound card.

pub mod capture;
pub mod duplex;
pub mod io;
#[cfg(test)]
mod live_tests;
pub mod mixer_audio;
pub mod playout;
pub mod processing;
pub mod rate;
