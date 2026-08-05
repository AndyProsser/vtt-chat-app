# status

The public, read-only status page — see [CLAUDE.md §5](../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

Display, with no login required:

- LiveKit / backend / Redis / Postgres health
- Number of connected players, DM connected (yes/no)
- Current campaign, room, and map
- Download links for the Windows, macOS, and Linux clients

Purpose: a DM can post a link and players can go from "never heard of this app" to "connected" without any setup beyond installing the client and logging into DDB — see [CLAUDE.md §5](../CLAUDE.md).

## Tech

React 19 + Radix UI + TypeScript, npm workspace package, served by `backend/` through Caddy.

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
