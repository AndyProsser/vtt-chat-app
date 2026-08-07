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

## Network Topology (Ports, STUN/TURN)

See [docs/architecture/OVERVIEW.md](../docs/architecture/OVERVIEW.md#network-topology-stunturn--ports) for the reasoning. Since LiveKit is a central SFU (players connect to it, never to each other), STUN alone covers the common case; TURN is an optional fallback, not a default requirement.

| Port(s)                                   | Protocol | Required? | Purpose                                                                                                                                                                        |
| ----------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `7880`                                    | TCP      | Required  | Client API + WebSocket signaling (sits behind Caddy)                                                                                                                           |
| `50000–60000`                             | UDP      | Required  | WebRTC media (ICE host candidates). Range is configurable in `livekit.yaml` — narrow it for a smaller port-scan surface on a small deployment.                                 |
| `7881`                                    | TCP      | Required  | LiveKit's own ICE-over-TCP fallback, used automatically when a client can't establish UDP (VPNs, some corporate networks). Not a TURN port.                                    |
| `7882`                                    | UDP      | Optional  | Single-port UDP ICE mux, alternative to the `50000–60000` range.                                                                                                               |
| `3478`                                    | UDP      | Optional  | Built-in TURN/UDP + STUN, only if the built-in TURN server is enabled.                                                                                                         |
| `5349` (or `443` without a load balancer) | TLS      | Optional  | Built-in TURN/TLS, the recommended fallback for restrictive networks (hotel wifi, firewalls that only permit 443 outbound). Native LiveKit feature — no external TURN service. |

`stun_servers` in `livekit.yaml` defaults to LiveKit's built-in list; `stun.cloudflare.com:3478` can be added alongside it for redundancy at no cost. Enabling the built-in TURN server is an explicit config toggle (`turn.enabled: true` + cert/domain for TLS) — leave it off unless the "done when" bar of a stage actually needs it for a restrictive-network player.

## Depends On

Nothing in-repo — this is configuration for the external LiveKit binary. `backend/` and `tauri-client/rust-livekit/` are the code that talks to it.
