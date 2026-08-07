# infra

Ubuntu Server deployment: install script, systemd units, config generation — see [CLAUDE.md §4](../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

- `install.sh` — installs and configures native prerequisites (Postgres, Redis, Caddy, LiveKit server, Node.js) on a blank Ubuntu Server. No Docker.
- systemd unit files for `backend/`, the LiveKit server, and any AI stack components
- Automatic configuration generation (env files, Caddy reverse-proxy config)
- Optional one-line curl installer

## Operator Firewall / Port-Forwarding Checklist

See [docs/architecture/OVERVIEW.md](../docs/architecture/OVERVIEW.md#network-topology-stunturn--ports) and [livekit/README.md](../livekit/README.md#network-topology-ports-stunturn) for the full reasoning and port table. Only the operator hosting the server needs to open anything — players never forward ports or configure anything special.

- **Must forward to the server:** `7880/tcp` (API/WS, normally reached via Caddy), `50000–60000/udp` (LiveKit media), `7881/tcp` (LiveKit's ICE/TCP fallback). These are required regardless of whether Caddy or Cloudflare Tunnel fronts the HTTPS paths — Cloudflare Tunnel cannot carry WebRTC media or the TCP ICE fallback, so it is never a substitute for forwarding these.
- **Optional:** `3478/udp` + `5349/tls` (or `443` without a load balancer) only if the built-in LiveKit TURN server is enabled for restrictive-network fallback (off by default).
- **Cloudflare Tunnel**, if used, is scoped to the HTTPS signaling/API/status-page paths only (in front of Caddy) — never to LiveKit's UDP or TCP media ports.
- `install.sh` should configure `ufw` (if active) to allow the required ports from the operator's intended audience (e.g. LAN-only for a private homelab deployment, or the world for a public campaign server) — this is an operator-time decision, not something the script should hardcode.

## Explicitly Out of Scope

- Containers of any kind — see [CLAUDE.md §4, §13](../CLAUDE.md)
- Anything gameplay-related (rooms, bookmarks, campaign mapping) — that's DM-managed inside the app, not an infra concern

## Depends On

Nothing in-repo at build time; it orchestrates the native services that `backend/`, `livekit/`, and the Admin CLI (part of `backend/`) run on top of.
