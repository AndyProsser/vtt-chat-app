# livekit

Configuration and helper scripts for the native **LiveKit server** and **LiveKit Egress** binaries — see [CLAUDE.md §8.5](../.claude/CLAUDE.md).

**Status:** scaffold only — not yet implemented. Dev work currently uses `livekit-server --dev`.

Not an application package (no `package.json`, no npm workspace membership). It holds:

- LiveKit server config (`livekit.yaml`)
- **Egress** config for per-speaker track recording to local storage
- Helper scripts for room creation and participant-metadata conventions
- Systemd unit reference (the canonical unit files live in [infra/](../infra/))

## Responsibilities

- Rooms: General, Campaign, and DM-managed party splits (DM in every group, players isolated)
- Participant metadata conventions
- **Recording via Egress**: per-speaker tracks, never a single mixed file; private/whisper groups excluded at the routing layer (see [RECORDING-AND-SUMMARIES.md](../docs/architecture/RECORDING-AND-SUMMARIES.md))
- Data events only where a backend WebSocket round-trip is a poor fit (default: use the backend WS layer)

## Network Topology (Ports, STUN/TURN)

Reasoning is in [docs/architecture/DEPLOYMENT-AND-TRANSPORT.md](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md). Since LiveKit is a central SFU (players connect to it, never to each other), STUN alone covers the common case; TURN is an optional fallback.

| Port(s) | Protocol | Required? | Purpose |
| --- | --- | --- | --- |
| `7880` | TCP | Required | Client API + WebSocket signalling (sits behind Caddy) |
| `50000–60000` | UDP | Required | WebRTC media. Configurable in `livekit.yaml` — narrow it for a small group |
| `7881` | TCP | Required | ICE-over-TCP fallback when a client can't use UDP. Not a TURN port |
| `7882` | UDP | Optional | Single-port UDP mux, alternative to the range |
| `3478` | UDP | Optional | Built-in TURN/UDP + STUN, only if built-in TURN is enabled |
| `5349` (or `443`) | TLS | Optional | Built-in TURN/TLS, the self-host fallback for restrictive networks |

`stun_servers` defaults to LiveKit's built-in list. Enabling built-in TURN is an explicit toggle (`turn.enabled: true` + cert/domain). **Cloud TURN (e.g. Cloudflare) is an optional advanced add-on** configured as an extra ICE server; it must never be required, and Cloudflare Tunnel cannot carry media at all.

## Depends On

Nothing in-repo — this is configuration for external binaries. `backend/` and `tauri-client/rust-livekit/` are the code that talks to it.
