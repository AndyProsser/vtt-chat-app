# backend

Node.js + Express + TypeScript API and WebSocket layer. The only server-side application component (aside from the LiveKit binaries and native infra services) — see [CLAUDE.md §8.3](../.claude/CLAUDE.md).

**Status:** skeleton. It serves `GET /api/health` and holds the reusable LiveKit token minting (`lib/session/liveKitToken.ts`). The previous design's DDB-identity `POST /api/session` was removed in Stage 1 (archived in [docs/archive/ddb-legacy/](../docs/archive/ddb-legacy/README.md)); real auth and the rest arrive in [ROADMAP Stage 3](../ROADMAP.md#stage-3--server-core). Everything else below is scaffold.

## Responsibilities

- **Identity and campaign access control** — _design open_, see [CLAUDE.md §11](../.claude/CLAUDE.md). No auth code until that is decided.
- LiveKit token issuance per channel (General, Campaign, party splits)
- Campaigns, channels, membership, ACL
- Chat, whispers, handouts, loot, session schedule / RSVP, history
- **Recording control and state** — server truth, in room/session metadata (see [RECORDING-AND-SUMMARIES.md](../docs/architecture/RECORDING-AND-SUMMARIES.md))
- WebSocket layer for state/chat/presence with a bounded replay buffer and snapshot fallback ([STATE-AND-RESILIENCE.md](../docs/architecture/STATE-AND-RESILIENCE.md))
- Records API: recordings, transcripts, summaries, search; dispatch to `ai/`
- Serve the public status page and client downloads
- Host the system-level **Admin CLI**

## Folder Layout

Follows [docs/CONVENTIONS.md](../docs/CONVENTIONS.md), with `lib/` organised by domain:

```text
src/
├── consts/
├── types/
├── lib/           # lib/campaigns/, lib/recordings/, lib/chat/, lib/session/, ...
└── index.ts
```

## Depends On

- `shared/` — cross-module types and contracts
- `ai/` — records job dispatch

Deliberately does **not** depend on `ddb/` — that module is an optional import, not part of the core path.

## Non-Goals

Does not manage anything the Admin CLI is scoped to (system health, backups, restarts) — see [CLAUDE.md §7](../.claude/CLAUDE.md). No cloud dependency in the default path.
