# shared

Cross-module TypeScript types, event contracts, and validators — see [CLAUDE.md §3](../CLAUDE.md) and [docs/CONVENTIONS.md](../docs/CONVENTIONS.md).

**Status:** Stage 1 subset implemented — DDB identity types, session/LiveKit token contracts, the Tauri IPC connection-state type, and zod schemas for the `/api/session` contract. Bookmark types land in Stage 4.

## Responsibilities

- DDB character/campaign type shapes (consumed by `ddb/`, `backend/`, `overlay-ui/`)
- Bookmark types (session-start, session-end, chapter, battle, custom — see [CLAUDE.md §10](../CLAUDE.md))
- Tauri IPC event payload types (consumed by `src-tauri/`, `rust-livekit/`, `overlay-ui/`)
- REST/WS contract types shared between `backend/` and its consumers
- Validators for the above (e.g. zod schemas), so runtime validation and compile-time types stay in sync

## Rule

`shared/` depends on nothing else in this mono-repo. Every other TypeScript package may depend on it. If you find yourself wanting `shared/` to import from `backend/` or `ddb/`, the type belongs in the other direction, or it isn't actually shared.
