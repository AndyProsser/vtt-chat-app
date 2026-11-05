# shared

Cross-module TypeScript types, event contracts, and validators — see [CLAUDE.md §4](../.claude/CLAUDE.md) and [docs/CONVENTIONS.md](../docs/CONVENTIONS.md).

**Status:** contains the previous design's types — DDB identity (`types/ddb.ts`), the session/LiveKit token contract (`types/session.ts`), the Tauri IPC connection-state type (`types/ipc.ts`) and zod schemas for `POST /api/session` (`lib/schemas.ts`). The DDB-identity pieces are legacy and go in [ROADMAP Stage 1](../ROADMAP.md#stage-1--pivot-cleanup); the LiveKit-token and IPC pieces are reusable.

## Responsibilities

- Campaign / channel / membership / message shapes (consumed by `backend/`, `panels-ui/`, `web/`)
- **Recording state** (`active`, `startedAt`, `id`) and the consent-acknowledgement contract
- Transcript and summary types (including the DM-only / private flags)
- Tauri IPC event payload types (consumed by `src-tauri/`, `rust-livekit/`, `panels-ui/`)
- REST/WS contract types shared between `backend/` and its consumers
- Validators for the above (zod), so runtime validation and compile-time types stay in sync

## Rule

`shared/` depends on nothing else in this mono-repo. Every other TypeScript package may depend on it. If you find yourself wanting `shared/` to import from `backend/` or `ddb/`, the type belongs in the other direction, or it isn't actually shared.
