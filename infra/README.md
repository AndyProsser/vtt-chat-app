# infra

Ubuntu Server deployment: install script, systemd units, config generation — see [CLAUDE.md §4](../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

- `install.sh` — installs and configures native prerequisites (Postgres, Redis, Caddy, LiveKit server, Node.js) on a blank Ubuntu Server. No Docker.
- systemd unit files for `backend/`, the LiveKit server, and any AI stack components
- Automatic configuration generation (env files, Caddy reverse-proxy config)
- Optional one-line curl installer

## Explicitly Out of Scope

- Containers of any kind — see [CLAUDE.md §4, §13](../CLAUDE.md)
- Anything gameplay-related (rooms, bookmarks, campaign mapping) — that's DM-managed inside the app, not an infra concern

## Depends On

Nothing in-repo at build time; it orchestrates the native services that `backend/`, `livekit/`, and the Admin CLI (part of `backend/`) run on top of.
