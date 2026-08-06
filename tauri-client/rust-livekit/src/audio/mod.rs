mod capture;
mod playback;

pub use capture::spawn_microphone_capture;
pub use playback::spawn_remote_playback;

/// LiveKit convention: push audio in 10ms frames.
pub(crate) const FRAME_DURATION_MS: u32 = 10;
