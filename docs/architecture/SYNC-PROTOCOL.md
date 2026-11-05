# Sync Protocol (Draft)

How the clients and the server stay in step. **Status: draft defaults chosen by Claude, accepted by
Andy as a starting point (2026-11-05) — expected to change once real traffic is measured.** Implemented in `backend/src/lib/realtime/` against in-memory stores; the Valkey-backed buffer is written (`ValkeyReplayBuffer`) but only tested against a fake server. The Rust client is `tauri-client/rust-sync/` (verified once against the real backend).

Builds on the archived "Plan B" (bounded replay buffer + snapshot fallback); see
[docs/archive/](../archive/README.md). Principles come from
[STATE-AND-RESILIENCE.md](STATE-AND-RESILIENCE.md): the server is truth, clients are caches, hidden
is the default.

## Shape of the traffic

Sessions run 4–8 hours, with **7–30 days between them**, and chat outside sessions is rare
(scheduling, updates, summary-ready, loot, level-up guidance). That drives the design:

- Most clients reconnect after **days offline**, not seconds → the normal path is **snapshot**.
  The replay buffer exists only for blips (network drop, sleep/wake) during a live session.
- Idle (no audio) traffic must be almost nothing: online/offline only.
- Live (audio connected) traffic is frequent and small: speaking, typing, mute, stats.

## Transport split

| Carries | Channel | Why |
| --- | --- | --- |
| Speaking, typing, mute/audio state, presence, chat, whispers, recording status, notifications, connection stats | **WebSocket** (owned by the Rust core, not the webview) | Many small, frequent events; one ordered stream |
| Create user, password/profile change, create campaign, file/handout upload | **REST** | Rare, large, request/response |
| Character sync (DDB import) | REST to start; WS later if it proves chatty | Rare |
| Audio | **LiveKit** (UDP) | Media |
| LiveKit data events | Only where a WS round-trip is a poor fit | Default is WS |

## Envelope

JSON text frames, versioned from day one:

```json
{ "v": 1, "t": "chat.message", "id": "01J…", "seq": 18234, "ts": 1762300000000, "d": { } }
```

- `v` protocol version; the server refuses unknown majors with a clear "update the app" error.
- `t` dotted type (`presence.update`, `speaking.start`, `recording.status`, `stats.report`, …).
- `id` client-generated ULID, used to dedupe retried sends.
- `seq` assigned by the server per campaign stream; absent on client→server frames.
- `ts` server time for server frames.

## Auth handshake

Connect, then send the first frame `auth` with the session token within 5 s or be dropped. The
token is **not** put in the URL (it would land in proxy logs). Revoked or expired sessions get an
`auth.revoked` frame and close; the client then returns to the sign-in screen. This is the
remote-revocation path ([CLAUDE.md §11](../../.claude/CLAUDE.md)).

## Reconnect and replay

1. Client reconnects and sends `resume { campaignId, lastSeq, epoch }`.
2. If `epoch` is the stream's current epoch **and** `lastSeq` is still inside the replay buffer → server replays the gap.
3. Otherwise → server sends a **snapshot** (campaign, roster, recording status, unread
   notifications) and the client replaces its cache.

Defaults: buffer the last **500 events or 10 minutes per campaign stream**, whichever is smaller.

**Epochs.** A sequence number only means something within one event stream. Whenever the stream is lost — the backend restarts with an in-memory buffer, Valkey is flushed — numbering starts again from 1, and a client holding "seq 3" from the old stream would be told it is up to date with a *different* stream, silently skipping events. So every stream has an **epoch** (a random id created with the stream). `snapshot` and `resumed` carry it, the client stores it beside its sequence number and sends both back, and a missing or different epoch always gets a snapshot. (Found while designing the Valkey buffer; fixed in both the TypeScript hub and the Rust client.)
Reconnect uses exponential backoff with jitter, capped at 30 s.

## Recording frames

| Frame | Direction | Meaning |
| --- | --- | --- |
| `recording.status` `{campaignId, recordingId, status}` | server → all in campaign | A transition just happened: `STARTED`, `PAUSED`, `RESUMED` or `STOPPED`. Not buffered for replay. |
| `recording.state` `{campaignId, recording}` | server → one client | Sent after every `snapshot` **and** `resumed`: `null`, or `{recordingId, status: IN-PROGRESS|PAUSED, acknowledged}` for that viewer. |
| `recording.ack` `{campaignId, recordingId}` | client → server | "I heard the start cue." Stale ids are refused (`stale_recording`). |
| `recording.ack.update` `{campaignId, recordingId, userId}` | server → DMs | Who has heard it. |

See [RECORDING-AND-SUMMARIES.md](RECORDING-AND-SUMMARIES.md#the-consent-loop-as-built-2026-11-05) for the full loop.

## Presence and stats tiers

| Client state | What it sends | Cadence |
| --- | --- | --- |
| App running, **no audio** | online/offline only (WS ping/pong is the heartbeat) | 30–60 s ping |
| **In a voice session** | `stats.report` (RTT, jitter, packet loss, audio level health, reconnect count) | every **5 s** |
| In a voice session | `speaking.*`, `audio.state` (mute/unmute) | on change |

- Stats are delivered only to subscribed DM/Admin clients (the connection-status screen), never
  broadcast to all players.
- The server keeps only the latest sample per user plus a short rolling window for the screen; it is
  not a metrics database.
- Speaking and audio-state events are also written to the recording's timeline metadata
  ([RECORDING-AND-SUMMARIES.md](RECORDING-AND-SUMMARIES.md)).

## Offline delivery

Notifications (summary ready, schedule changes, loot, level-up guidance) are **stored server-side**
and delivered in the snapshot on next connect. An optional email nudge (needs SMTP) can cover
players whose app isn't running; it is never required.

## Where live state lives (Redis/Valkey, with a fallback)

Three tiers, chosen by how much it hurts to lose the data:

| State | Examples | Lives in | If the store is down |
| --- | --- | --- | --- |
| Live connection state | who is online, speaking, typing, mute, latest stats sample | **in the backend process** (a map per socket), mirrored to Redis/Valkey only if configured | Nothing lost: clients are still connected and re-announce on reconnect. The process is the truth for its own sockets. |
| Short-lived shared state | replay buffer (500 events / 10 min), per-recording cue acknowledgements (TTL), pub/sub between `backend` and the `ai` worker | **Redis/Valkey**, with an **in-memory implementation behind the same interface** | Falls back to memory: a backend restart then forces a snapshot instead of a replay, and acknowledgements are re-asked (one extra cue). Annoying, never wrong. |
| Durable facts | accounts, sessions, memberships, consent, recording status and its **timeline metadata** (speaking indicators, mute, join/leave), notifications | **Postgres** | This is the real failure; the server says so and stops accepting changes rather than guess. |

**Postgres is not the fallback for live state.** Speaking events and 5-second stats samples would turn into constant writes for data that is worthless a minute later. The exception is the recording timeline: those events are part of the record, so they are batched and written to Postgres during a recording whatever Redis is doing.

**Decided (Andy, 2026-11-05): Valkey.** Redis stays a drop-in alternative. The code speaks the Redis protocol and use only strings, hashes, sets, TTLs and pub/sub, so either server works with the same client. Valkey is the BSD-licensed fork (Linux Foundation) made after Redis changed its licence; for a project whose point is that anyone can self-host it, Valkey is the default the install script sets up; plain Redis is accepted where Valkey isn't packaged. A Redis-compatible server is needed anyway because LiveKit Egress requires one for recording ([DEPLOYMENT-AND-TRANSPORT.md](DEPLOYMENT-AND-TRANSPORT.md)). **Unverified:** that LiveKit server and Egress run cleanly against Valkey, and which Ubuntu LTS ships a `valkey` package. Check both in the Stage 2 smoke test.

A single-node install (the default) works with no Redis-compatible server for the backend at all; it is needed for Egress, and used by the backend once the `ai` worker is a separate process.

## Open

- Max frame size and rate limits per connection.
- Whether chat history paging uses WS or REST.
- Exact `stats.report` fields once measured in the Stage 2 spike.
