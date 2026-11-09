//! The mixer engine: our own capture and playback around WebRTC's audio processing (see
//! docs/architecture/AUDIO-MIXER.md). Built in layers, each testable without a sound card.

pub mod capture;
pub mod duplex;
pub mod playout;
pub mod processing;
pub mod rate;
