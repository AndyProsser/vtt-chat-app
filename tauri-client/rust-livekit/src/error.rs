use thiserror::Error;

#[derive(Debug, Error)]
pub enum LiveKitError {
    #[error("room connection failed: {0}")]
    Room(#[from] livekit::RoomError),
    #[error("audio device error: {0}")]
    Audio(String),
}
