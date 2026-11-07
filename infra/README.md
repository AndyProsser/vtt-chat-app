# infra

Ubuntu Server deployment: install script, systemd units, config generation — see [CLAUDE.md §5](../.claude/CLAUDE.md) and [docs/architecture/DEPLOYMENT-AND-TRANSPORT.md](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md).

**Status:** Docker Compose bundle ([compose/](compose/README.md)) and the native installer ([install.sh](install.sh)) both work and have been run end to end. The native installer targets **Ubuntu 24.04 LTS only** (it needs the distro's `valkey-server` and `caddy` packages, which 22.04 lacks).

**Goal: someone who is not Andy can deploy their own instance from these docs, with no cloud account.**

## Responsibilities

- `install.sh` — the **native** (advanced-user) tier. On a blank Ubuntu 24.04: Postgres, Valkey and Caddy from apt; Node.js 26 LTS and LiveKit server as checksum-verified downloads; the backend built from this checkout; generated secrets (`/etc/vtt/vtt.env`, mode 640, never printed); hardened systemd units; a `vtt-admin` command. Idempotent — re-running keeps secrets and data. `--with-records` adds ffmpeg, whisper.cpp (built from source), Ollama and the records worker (`--skip-ollama` if the LLM runs elsewhere). **LiveKit Egress is not installed natively** (upstream ships it only as a container image), so native recording needs the Compose `egress` service. `--dry-run` prints the plan; `--no-start` installs without starting services.

  ```bash
  sudo infra/install.sh --domain vtt.example.com [--public-ip 203.0.113.7] [--with-records]
  ```

- [`compose/`](compose/README.md) — the primary Docker Compose bundle for a VM/server (voice works; Egress/AI come with Stage 5). `dev/` — throwaway Postgres + Valkey for tests.
- Optional one-line `curl` installer (not built; the installer needs a repository checkout today)
- First-run bootstrap of the instance (first DM) — shape depends on the identity decision

## Operator Firewall / Port-Forwarding Checklist

Only the operator opens anything; players configure nothing. **Opening a UDP range for voice is accepted** (decided 2026-11-05). Full reasoning in [DEPLOYMENT-AND-TRANSPORT.md](../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md#ports-the-operator-must-provide); the short list:

- **Must forward:** `443/tcp` and `80/tcp` (Caddy), the LiveKit media **UDP range** (default `50000–60000`, configurable), `7881/tcp` (LiveKit ICE-over-TCP fallback).
- **Optional:** `3478/udp` + `5349/tls` (or `443`) for LiveKit's **built-in** TURN, for restrictive networks — off by default.
- **Cloudflare Tunnel cannot carry WebRTC media.** If used at all, it fronts the HTTPS/WSS paths only; the media ports always need direct forwarding. Cloud TURN is an optional advanced add-on, never a requirement.
- `install.sh` does **not** touch the firewall; it prints the ports to open (and the `ufw` commands). That choice — LAN-only for a private group, or open for a public one — is the operator's.

## Sizing

Voice is light; **transcription and summarisation are the heavy parts** and run after the session by default. Minimum specs will be written once the Stage 2 spike has measured them.

## Explicitly Out of Scope

- Kubernetes/Helm and other orchestrators (Compose is the container target)
- Anything gameplay-related — that's DM-managed inside the app

## Depends On

Nothing in-repo at build time; it orchestrates the native services that `backend/`, `ai/`, `livekit/` and the Admin CLI run on.
