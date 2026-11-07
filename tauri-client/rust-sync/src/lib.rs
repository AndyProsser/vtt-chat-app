//! The Rust client for the backend's WebSocket (`/ws`): the live channel for presence, speaking,
//! mute state, connection stats and chat. See `docs/architecture/SYNC-PROTOCOL.md`.
//!
//! Split so the rules are testable without a network:
//!
//! - [`protocol`] — the wire format, mirroring `backend/src/lib/realtime/protocol.ts`
//! - [`session`] — a pure state machine (authenticate first, resume from the last sequence number,
//!   never reconnect once revoked)
//! - [`client`] — the tokio loop that owns the socket, reconnects with backoff, and feeds the state machine
//!
//! Like `rust-livekit`, this is a leaf crate: no dependency on Tauri or anything else in the repo.

mod backoff;
pub mod client;
pub mod protocol;
pub mod session;

pub use backoff::Backoff;
pub use client::{ConnectInfo, ConnectInfoFuture, ConnectInfoProvider, SyncClient, SyncConfig};
pub use protocol::{
    command_frame, is_table_command, whisper_frame,
    audio_state_frame, auth_frame, chat_frame, recording_ack_frame, resume_frame, speaking_frame,
    stats_frame, ParseError, RecordingChange, RecordingInfo, ServerEvent, PROTOCOL_VERSION,
};
pub use session::{Action, Session, SyncEvent};
