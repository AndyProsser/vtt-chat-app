# rust-sync

The Rust client for the backend's **WebSocket** (`/ws`): the live channel for presence, speaking, mute state, connection stats and chat. Protocol and rationale: [SYNC-PROTOCOL.md](../../docs/architecture/SYNC-PROTOCOL.md). The server side is `backend/src/lib/realtime/`.

**Status:** built and tested offline, and **checked once against the real Node backend** (connect → authenticate → snapshot → audio state → chat round-trip, via `examples/sync_probe.rs`). Not yet wired into `src-tauri/` — that is Stage 4, when the tray shell and panels exist to consume it.

## Why Rust owns the socket

Same reasoning as audio: it must keep working with every panel closed, with near-zero idle cost, and it must be the same code on every OS. A panel is a cache of this connection's state, not the owner of it ([STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md)).

## Layout

| Module     | What it does                                                                                                                                                                                                                                                                                                              | Tested by                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `protocol` | Wire format, mirroring `backend/src/lib/realtime/protocol.ts`                                                                                                                                                                                                                                                             | unit tests                                          |
| `session`  | **Pure state machine, no I/O**: authenticate first; resume each campaign from its last sequence number; never move the cursor backwards on replayed events (but accept a snapshot that resets it lower — a restarted server); stop for good on revocation (`auth.revoked` or close code 4401) or an incompatible protocol | unit tests                                          |
| `client`   | The tokio loop: connects, asks a `ConnectInfoProvider` for the URL and token on every attempt, reconnects with jittered backoff (1 s → 30 s, reset after a completed handshake), reconnects when the link goes silent for 90 s (half-open after sleep or a NAT drop), honours subscriptions made while offline            | integration tests against an in-process fake server |
| `backoff`  | Exponential backoff with a cap                                                                                                                                                                                                                                                                                            | unit tests                                          |

Live frames sent while disconnected are **dropped on purpose** (`SyncClient::send`): speaking, mute and stats are only meaningful now. The app re-announces its state when it sees `SyncEvent::Connected`.

## Depends On

Nothing else in the repo — a leaf crate, like `rust-livekit`. TLS (`wss://`) uses rustls with the system's root certificates.

## Still to do

- Wire into `src-tauri/` (start/stop on sign-in, forward `SyncEvent`s to panels, and re-announce voice state on `Connected`)
- Report connection stats from the voice client (`rust-livekit`) for the DM's status screen
- Chat history paging, once chat is persisted server-side
