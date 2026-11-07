# backend

Node.js + Express + TypeScript API and WebSocket layer. The only server-side application component (aside from the LiveKit binaries and native infra services) — see [CLAUDE.md §8.3](../.claude/CLAUDE.md).

**Status:** identity, campaigns, a REST layer and a **WebSocket hub** exist and are tested (169 tests, including real sockets), against in-memory stores **and** a real Postgres + Valkey (see below). With `DATABASE_URL` / `VALKEY_URL` set, state survives a restart; unset, it is in memory and lost. Built from the decisions in [CLAUDE.md §11](../.claude/CLAUDE.md) and [SYNC-PROTOCOL.md](../docs/architecture/SYNC-PROTOCOL.md):

- `lib/auth/` — accounts (first account = Admin; recording consent captured at sign-up with its text version), scrypt passwords, magic links (sign-in and reset, single-use, expiring), long-lived **remotely revocable sessions** with a configurable offline limit (default 30 days) kept alive by client pings.
- `lib/campaigns/` — campaigns (creation `closed` to the Admin or `open` to anyone), **multi-use expiring invites**, characters (one active per player), and the **DM swap** (old DM becomes a player, characters parked and restored).
- `lib/store/` — a `Store` interface with two implementations: `MemoryStore` (tests, no-database dev) and `PostgresStore` (`pg`). [migrations/](migrations/) is applied on start by `migrate.ts` (ordered `NNNN_name.sql` files, one transaction each, advisory-locked, tracked in `schema_migrations`; never edit a released migration — add a new file). Reads treat a malformed id as not-found, so a bogus token can't become a 500. The domain, HTTP and `Store` contract suites run on both stores; set `TEST_DATABASE_URL` for the Postgres run (`infra/dev/compose.yml` provides one).
- `lib/session/liveKitToken.ts` — LiveKit token minting, not yet wired behind auth.

- `lib/http/` — REST (`/api/auth`, `/api/campaigns`): sign-up, sign-in, magic links, sessions, invites, characters, DM swap, and member-only LiveKit voice tokens; rate limiting; safe error handling.
- `lib/realtime/` — the WebSocket protocol (`/ws`, versioned JSON frames), a transport-agnostic `Hub` (auth-first, per-campaign subscriptions, presence, speaking, DM-only connection stats, chat, replay/snapshot on reconnect, remote revocation), an in-memory `ReplayBuffer`, a **Valkey/Redis-backed `ValkeyReplayBuffer`** (same contract, same tests; see below), and the `ws` adapter.

- `lib/recording/` — `RecordingState` (the server-owned flag + id; start/pause/resume/stop with validated transitions) and `AckStore` (who has heard the start cue, with an expiry; in-memory, Valkey later). The DM controls it over `POST /api/campaigns/:id/recording`; the hub announces changes and tells joiners the current state. See [the consent loop](../docs/architecture/RECORDING-AND-SUMMARIES.md#the-consent-loop-as-built-2026-11-05).

## Records API

`/api/campaigns/:id/recordings` (members only): `GET /` list · `GET /search?q=` full-text search over transcripts and summaries · `GET /:rid` detail with session bookmarks and the summaries you may read · `GET /:rid/transcript` merged, speaker-attributed · `DELETE /:rid` (DM). **DM-only summaries are returned to the DM alone — in lists, detail and search** — and a recording is reachable only through its own campaign (another campaign's id is a 404). Private tracks never appear.

## Admin CLI (`vtt-admin`)

System operations only — gameplay stays in the app (CLAUDE.md §7). It talks to the database directly, so it needs `DATABASE_URL` and no sign-in: whoever can run it already controls the server. In Compose: `infra/compose/vtt-admin <command>`; natively: `node backend/dist/cli/main.js <command>`.

| Command                                                        | What it does                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `status`                                                       | Database, Valkey and LiveKit health; exits 1 if anything is down                                 |
| `settings show` / `keys` / `set <key> <value>`                 | Campaign creation, offline limit, invite expiry, consent version, and the **AI backend** (below) |
| `user list`                                                    | All accounts                                                                                     |
| `user admin <email> grant\|revoke`                             | Admin role; the last Admin cannot be removed                                                     |
| `user code <email> [signin\|reset]`                            | One-time code to hand over on a side channel (no SMTP needed)                                    |
| `user revoke-sessions <email>`                                 | Sign an account out on every device                                                              |
| `jobs list [state]` / `jobs retry <id>`                        | Inspect the records-pipeline queue; put a failed job back                                        |
| `recording list` / `recording reprocess <id> [--retranscribe]` | Redo summaries (and with the flag, transcripts) from the kept audio                              |

**AI backend settings** (`ai.*`, stored in `instance_settings.ai`): each of transcription and the LLM is `local` or `remote` (an OpenAI-compatible server URL + model), plus `ai.fallback.enabled / after-seconds / retry-seconds`. API keys are **not** stored — they come from `WHISPER_API_KEY` / `LLM_API_KEY` in the environment. `ai/`'s `buildJobProviders` turns these settings into the providers for one job.

Still to build ([ROADMAP Stage 3](../ROADMAP.md#stage-3--server-core)): the realtime and WebSocket suites still run on `MemoryStore` only, per-recording cue acknowledgements, OIDC, the email sender (optional SMTP), recording status events, chat persistence, and the Admin CLI.

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
