//! The DM's character voices (docs/architecture/DM-VOICE-EFFECT.md). Pure signal processing on mono
//! 48 kHz blocks, with no audio devices and no LiveKit in it, so it is unit-tested on synthetic tones.

mod effects;
mod pitch;

pub use effects::{Voice, VoiceFx};
pub use pitch::PitchShifter;

/// The sample rate the whole voice path runs at (what WebRTC wants).
pub const SAMPLE_RATE: u32 = 48_000;
/// One block is 10 ms, WebRTC's frame size.
pub const BLOCK: usize = 480;
