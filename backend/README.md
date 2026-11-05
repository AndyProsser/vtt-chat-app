# backend

Node.js + Express + TypeScript API and WebSocket layer. The only server-side application component (aside from the LiveKit binaries and native infra services) — see [CLAUDE.md §8.3](../.claude/CLAUDE.md).

**Status:** the **domain layer** for identity and campaigns exists and is unit-tested (36 tests) against an in-memory store, but **there is no HTTP/WebSocket surface for it yet** — the app still only serves `GET /api/health`. Built from the decisions in [CLAUDE.md §11](../.claude/CLAUDE.md):

- `lib/auth/` — accounts (first account = Admin; recording consent captured at sign-up with its text version), scrypt passwords, magic links (sign-in and reset, single-use, expiring), long-lived **remotely revocable sessions** with a configurable offline limit (default 30 days) kept alive by client pings.
- `lib/campaigns/` — campaigns (creation `closed` to the Admin or `open` to anyone), **multi-use expiring invites**, characters (one active per player), and the **DM swap** (old DM becomes a player, characters parked and restored).
- `lib/store/` — a `Store` interface with an in-memory implementation. The Postgres adapter is **not written**; [migrations/0001_init.sql](migrations/0001_init.sql) is the schema, **untested** (no Postgres was available).
- `lib/session/liveKitToken.ts` — LiveKit token minting, not yet wired behind auth.

Still to build ([ROADMAP Stage 3](../ROADMAP.md#stage-3--server-core)): the Postgres adapter, the REST routes (rare, heavy actions) and WebSocket layer ([SYNC-PROTOCOL.md](../docs/architecture/SYNC-PROTOCOL.md)), OIDC, the email sender (optional SMTP), and the Admin CLI.

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
