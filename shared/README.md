# shared

Cross-module TypeScript types, event contracts, and validators — see [CLAUDE.md §4](../.claude/CLAUDE.md) and [docs/CONVENTIONS.md](../docs/CONVENTIONS.md).

**Status:** currently holds only the Tauri IPC types (`types/ipc.ts`) and event names (`consts/`). The previous design's DDB-identity and session types and their zod schemas were removed in Stage 1. The contracts listed below are added as the stages that need them land.

## Responsibilities

- Campaign / channel / membership / message shapes (consumed by `backend/`, `panels-ui/`, `web/`)
- **Recording state** (`active`, `startedAt`, `id`) and the consent-acknowledgement contract
- Transcript and summary types (including the DM-only / private flags)
- Tauri IPC event payload types (consumed by `src-tauri/`, `rust-livekit/`, `panels-ui/`)
- REST/WS contract types shared between `backend/` and its consumers
- Validators for the above (zod), so runtime validation and compile-time types stay in sync

## Rule

`shared/` depends on nothing else in this mono-repo. Every other TypeScript package may depend on it. If you find yourself wanting `shared/` to import from `backend/` or `ddb/`, the type belongs in the other direction, or it isn't actually shared.
