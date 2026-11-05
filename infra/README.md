# infra

Ubuntu Server deployment: install script, systemd units, config generation — see [CLAUDE.md §5](../.claude/CLAUDE.md) and [docs/architecture/DEPLOYMENT-AND-TRANSPORT.md](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

**Status:** scaffold only — not yet implemented. Targeted by [ROADMAP Stage 3](../ROADMAP.md#stage-3--server-core).

**Goal: someone who is not Andy can deploy their own instance from these docs, with no cloud account.**

## Responsibilities

- `install.sh` — installs and configures, on a blank Ubuntu Server: Caddy, Postgres, Redis, Node.js, **LiveKit server + Egress**, ffmpeg, **Whisper.cpp**, **Ollama**. No Docker.
- systemd unit files for `backend/`, the `ai/` worker, LiveKit, Egress, and the AI stack
- Automatic generation of config and secrets (env files, Caddy config) — secrets generated to files, never echoed
- Optional one-line `curl` installer
- First-run bootstrap of the instance (first DM) — shape depends on the identity decision

## Operator Firewall / Port-Forwarding Checklist

Only the operator opens anything; players configure nothing. **Opening a UDP range for voice is accepted** (decided 2026-11-05). Full reasoning in [DEPLOYMENT-AND-TRANSPORT.md](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md#ports-the-operator-must-provide); the short list:

- **Must forward:** `443/tcp` and `80/tcp` (Caddy), the LiveKit media **UDP range** (default `50000–60000`, configurable), `7881/tcp` (LiveKit ICE-over-TCP fallback).
- **Optional:** `3478/udp` + `5349/tls` (or `443`) for LiveKit's **built-in** TURN, for restrictive networks — off by default.
- **Cloudflare Tunnel cannot carry WebRTC media.** If used at all, it fronts the HTTPS/WSS paths only; the media ports always need direct forwarding. Cloud TURN is an optional advanced add-on, never a requirement.
- `install.sh` configures `ufw` (if active) from the operator's answer — LAN-only for a private group, or open for a public one. It must not hardcode this.

## Sizing

Voice is light; **transcription and summarisation are the heavy parts** and run after the session by default. Minimum specs will be written once the Stage 2 spike has measured them.

## Explicitly Out of Scope

- Containers (unless Andy reopens it — an optional container bundle for other self-hosters is an open question in [.claude/intent.md](../.claude/intent.md))
- Anything gameplay-related — that's DM-managed inside the app

## Depends On

Nothing in-repo at build time; it orchestrates the native services that `backend/`, `ai/`, `livekit/` and the Admin CLI run on.
