# backend

Node.js + Express + TypeScript API and WebSocket layer. The only server-side application component (aside from the LiveKit binaries and native infra services) — see [CLAUDE.md §8.3](../.claude/CLAUDE.md).

**Status:** one legacy piece exists — `POST /api/session`, which accepts a client-supplied **DDB identity** and issues an app-session JWT + a LiveKit token. That contract belongs to the previous design and is being replaced ([ROADMAP Stage 1](../ROADMAP.md#stage-1--pivot-cleanup)); the LiveKit token issuance (`lib/session/liveKitToken.ts`) is reusable. Everything else below is scaffold.

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
