# Sync Protocol (Draft)

How the clients and the server stay in step. **Status: draft defaults chosen by Claude, accepted by
Andy as a starting point (2026-11-05) — expected to change once real traffic is measured.**

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

1. Client reconnects and sends `resume { lastSeq }`.
2. If `lastSeq` is still inside the replay buffer → server replays the gap.
3. Otherwise → server sends a **snapshot** (campaign, roster, recording status, unread
   notifications) and the client replaces its cache.

Defaults: buffer the last **500 events or 10 minutes per campaign stream**, whichever is smaller.
Reconnect uses exponential backoff with jitter, capped at 30 s.

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

## Open

- Max frame size and rate limits per connection.
- Whether chat history paging uses WS or REST.
- Exact `stats.report` fields once measured in the Stage 2 spike.
