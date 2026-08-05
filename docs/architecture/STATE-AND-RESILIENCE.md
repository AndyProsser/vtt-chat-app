# State & Resilience Architecture

The rules in this document are mandatory for every stateful surface built in `tauri-client/overlay-ui/`, `status/`, and any Zustand/React code in `backend/` tooling UIs. They exist because the prior system ([`vtt-chat`](https://github.com/AndyProsser/vtt-chat)) lost **weeks** to memory growth and unrecoverable state during long sessions, and because this app is explicitly required to run **8+ hours** with constantly-changing indicators (speaking, presence, mic level) without degrading, and to recover cleanly from a page refresh or a DDB Maps glitch (a routine occurrence for DMs). See [CLAUDE.md §8.1 (audio continuity)](../../CLAUDE.md) and the brief in the roadmap's [Stage 0.5](../../ROADMAP.md).

This is a constraints document, not a tutorial — read it before writing any store, selector, or effect that touches per-participant or per-session state.

## Why This Differs From the Prior System

The old app's memory growth was **not** primarily classic leaked timers/refs (though one existed). The dominant failure was **coarse-grained store subscriptions causing cascading re-renders that never stabilized**:

- A presence reducer rebuilt a shared `sessionPresence` map object on every speaking-stop event, even when nothing had changed. One component subscribed to the whole map for a single participant's data, so every speaker going silent re-rendered the entire session chrome — measured at ~900+ React commits/sec, tearing down and rebuilding portal-based UI (tooltips, popovers) on every tick. Over 8+ hours this pushed browser memory into the multiple gigabytes.
- A mic-level meter ran a per-frame `requestAnimationFrame` audio-analysis loop whenever the mic was _on_, regardless of whether anything was displaying the level — keeping the render loop awake indefinitely.
- A session timer drove a 1-second `setState` tick that forced a full commit of unrelated sibling UI every second, for the life of the session.
- Chat/activity history grew as plain unbounded arrays with no retention limit.
- A CSS "hide" (`visibility: hidden`) was used instead of actually stopping an animation, so a compositor animation ran forever in the background.

Separately, a six-state session lifecycle (`IDLE → ACTIVE → PAUSED → COOLDOWN → ENDED → CLEANUP`) split its truth across Zustand, Redis, Postgres, and WebSocket broadcasts simultaneously. Keeping those four in sync required constant vigilance and produced recurring cross-layer consistency bugs. This system has no session state machine — see [CLAUDE.md §10, §15](../../CLAUDE.md) — and that choice is deliberate, not just a simplification for its own sake: fewer layers sharing one truth means fewer ways for them to disagree.

The rules below are the fixes that emerged from that postmortem, applied from day one instead of retrofitted after months of profiling.

## Store Boundaries

Every piece of client state is one of exactly two kinds. Don't blur them.

|                      | Domain state                                                           | UI-only state                                                                                                                |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Examples             | room/participant roster, presence, speaking, bookmarks, group routing  | panel open/closed, active tab, whisper target, overlay collapsed                                                             |
| Source of truth      | Backend (Postgres for durable, Redis for transient pub/sub)            | Client only                                                                                                                  |
| On reconnect/refresh | **Replaced wholesale** from a fresh snapshot — never merged or patched | Restored from a local persisted UI store, with per-field validity checks (e.g. clear a whisper target that no longer exists) |
| Ever sent to backend | Yes                                                                    | No                                                                                                                           |

A Zustand client store is a **cache** of domain state, not the source of truth. Treat it as stale from the moment a disconnect is detected until an explicit rehydration completes — never render off a domain store you know is stale.

## Leaf Isolation (mandatory for high-frequency/per-participant data)

Anything that changes per-participant and often — speaking on/off, mic level, presence online/offline, typing — must be consumed through a dedicated, memoized leaf component that subscribes to **one primitive selector for one key** (e.g. `isSpeaking(participantId)` → `boolean`), never through a parent object that bundles multiple participants' data.

```text
❌ <ParticipantRow participant={fullParticipantObject} />
   — re-renders on any change to any field of any participant sharing that object

✅ <SpeakingDot participantId={id} />
   — subscribes to useIsSpeaking(id), a single boolean primitive selector
   — re-renders only when this participant's speaking state changes
```

This was the single largest source of the old app's long-session degradation: threading per-participant transient state through a composed "projection" object handed down as a prop. Where full leaf extraction is impractical (e.g. a card that legitimately needs several fields), wrap it in `React.memo` and use a reference-preserving merge so unchanged nested objects keep their identity across writes.

## Write Discipline

Every store write (`set()` call, reducer branch) must check whether the value actually changed before writing. Unconditional replacement of a collection — even when nothing in it changed — invalidates every selector watching that collection and cascades re-renders through every subscriber. No-op guards are not an optimization to add later; they're required at first-write time.

## Timers & Animation

- Anything that ticks on an interval (mic level meters, duration displays) runs only while actually needed (visible, transmitting) — never unconditionally in the background.
- Cap polling-style loops around 30Hz; don't default to `requestAnimationFrame` (60fps) for anything that isn't itself a frame-synced visual.
- A value that updates every second and would force a full component commit (e.g. call duration) writes to the DOM via a ref imperatively — it does not go through React state.
- Stopping an animation means unmounting it or toggling the class that drives it — `visibility: hidden` does not stop CSS animations from running.

## Bounded Retention

Every collection that grows for the life of a long-running session (chat history, activity/event feed, per-participant speaking history) needs an explicit retention limit and pruning strategy decided at the time it's created — not added after it's observed growing unbounded in production. If something is keyed by participant or session ID and can outlive its subject (e.g. a stale presence entry after someone leaves), it needs a TTL or an explicit removal path, not just a creation path.

## Recovery Contract

This is what "refresh survives" and "DDB Maps glitch → quick recovery" mean concretely:

1. On reconnect (WebSocket drop, tab refresh, or DDB Maps reload), fetch authoritative snapshots for room/presence/bookmark state **in parallel**.
2. Replace the corresponding domain stores **atomically and wholesale** once all snapshots land — never render a partial mix of old and new domain state.
3. Restore UI-only state from the local UI store separately, validating each field against the freshly-loaded domain state (drop references to anything that no longer exists).
4. The only visible recovery UX is a non-blocking status toast ("Reconnecting…" / "Restored") — no blocking overlay, no optimistic rendering against state you know is stale.
5. Timeline boundary markers and similar durable events are written server-side and de-duplicated client-side, never re-created by the client on reconnect — so a refresh can't produce duplicates.

## WebSocket Reliability

- Reconnect with exponential backoff; re-authenticate the socket on reconnect rather than assuming session continuity.
- Maintain a bounded, server-side event-replay buffer keyed by `lastEventId` so a brief disconnect can resync by replaying only what was missed.
- If the buffer has evicted the client's `lastEventId` (long disconnect), fall back to a full snapshot resync per the Recovery Contract above — don't attempt partial replay against unknown state.
- This is intentionally _not_ full event sourcing. A bounded replay window plus snapshot fallback covers the real failure mode (brief network blips, DDB Maps reloads) without the complexity of a fully durable event log.

## Dev Tooling

Build a lightweight churn-diagnostics toggle into the overlay from the start (e.g. a debug flag that logs re-render counts per store subscription over a session). This is how the old app's worst re-render cascades were eventually found — build it in up front rather than reaching for it only after a session has already degraded in front of a DM.
