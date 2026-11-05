# status

The public, read-only status page — see [CLAUDE.md §6](../.claude/CLAUDE.md).

**Status:** scaffold only — not yet implemented ([ROADMAP Stage 8](../ROADMAP.md#stage-8--operations-admin-cli--status-page)).

## Responsibilities

Display, with no login required:

- LiveKit / backend / Redis / Postgres health
- **Records pipeline health** — AI queue depth, last job result, Egress status
- Number of connected players
- Whether a recording is currently active
- Download links for the Windows, macOS, and Linux clients

Purpose: a DM can post one link and a player can go from "never heard of this" to "installed and connecting"; an operator can see at a glance whether the records pipeline is healthy. (The old "current map / campaign / room" fields are gone with the DDB coupling.)

## Tech

React 19 + Radix UI + TypeScript, npm workspace package, served by `backend/` through Caddy. Light/dark follows the OS.

## Folder Layout

Per [docs/CONVENTIONS.md](../docs/CONVENTIONS.md):

```text
src/
├── components/
├── hooks/
├── consts/
├── types/
├── styles/
├── lib/           # health-check polling, download link config
└── index.ts
```

## Depends On

- `shared/` — health/status payload types
- `backend/` — the health/status endpoints this page polls
