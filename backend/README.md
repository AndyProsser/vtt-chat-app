# backend

Node.js + Express + TypeScript API. The only server-side application component (aside from the LiveKit server and native infra services) — see [CLAUDE.md §8.3](../CLAUDE.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

- Issue LiveKit tokens
- Store campaign → room mapping and DM bookmarks
- REST endpoints for audio FX, group management, chat logs, bookmarks, room metadata
- Recording control, transcription job, and AI summary endpoints (delegates to `ai/`)
- Serve the public status page and client downloads
- Verify DDB-derived identity handed off from the Tauri client (via `ddb/`)

## Folder Layout

Follows [docs/CONVENTIONS.md](../docs/CONVENTIONS.md):

```text
src/
├── consts/
├── types/
├── lib/           # organized by domain: lib/rooms/, lib/bookmarks/, lib/audio/, etc.
└── index.ts
```

## Depends On

- `shared/` — cross-module types and contracts
- `ddb/` — DDB identity verification
- `ai/` — recording/transcription/summary job dispatch

## Non-Goals

Does not manage anything the Admin CLI is scoped to (system health, backups, service restarts) — see [CLAUDE.md §6](../CLAUDE.md). The Admin CLI is a separate tool that talks to this backend and to Postgres/Redis/LiveKit directly for system-level operations only.
