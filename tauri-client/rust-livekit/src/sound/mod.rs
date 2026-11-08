//! The soundboard's local player (docs/architecture/TABLE-FEATURES.md): clips the DM triggers are
//! played **on this machine**, never through the SFU, so they are absent from recordings. `decode`
//! makes samples, `mixer` mixes them, `engine` puts them on the speakers.

pub mod decode;
mod engine;
pub mod mixer;

pub use decode::decode_to_mono;
pub use engine::{output_sample_rate, SoundEngine};
