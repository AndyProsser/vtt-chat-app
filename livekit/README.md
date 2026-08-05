# livekit

Configuration and helper scripts for the native LiveKit server binary — see [CLAUDE.md §8.4](../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

This is not an application package (no `package.json`, no npm workspace membership). It holds:

- LiveKit server config (`livekit.yaml` or equivalent)
- Helper scripts for room creation, participant metadata conventions, and data-event schemas used for chat + bookmarks
- Systemd unit reference (the canonical unit file lives in [infra/](../infra/), this folder documents the config it consumes)

## Responsibilities

- Room creation
- Participant metadata conventions
- Group audio isolation config
- Audio FX routing config
- Data events for chat + bookmarks
- Recording pipeline config (server-side or client-side, see [ai/README.md](../ai/README.md))

## Depends On

Nothing in-repo — this is configuration for the external LiveKit binary. `backend/` and `tauri-client/rust-livekit/` are the code that talks to it.
