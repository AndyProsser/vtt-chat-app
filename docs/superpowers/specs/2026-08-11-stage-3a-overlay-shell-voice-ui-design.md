# Stage 3a: Overlay Shell & Voice UI

**Stage:** [Stage 3](../../../ROADMAP.md#stage-3--overlay-ui-ddb-extraction--chat), first of three parts — see [Decomposition](#decomposition) below.
**Depends on:** Stage 2 (shell hardening), Stage 0.5 (state & resilience rules).
**Status:** Approved 2026-08-11.

## Decomposition

Stage 3 as written in `ROADMAP.md` bundles three subsystems that share a stage number but not a dependency chain, and pulls in two items whose mechanisms live in other stages. Splitting it (decided 2026-08-11):

| Part | Contents | Depends on |
| --- | --- | --- |
| **3a** (this spec) | Page-scoped overlay mounting, speaking indicators, voice controls, churn diagnostics wired up | Stage 2 |
| **3b** | DDB DOM extraction — character metadata, campaign metadata, token conditions | Stage 2; independent of 3a |
| **3c** | Chat, bounded retention, refresh recovery, reconnect/backoff/event-replay | 3a; needs the chat-transport question resolved first |

Two items are explicitly **not** in any of them:

- **The group selector moves to Stage 4.** Stage 3 lists the selector UI; Stage 4 lists group routing, the mechanism it drives. Building a selector with nothing to select is busywork.
- **The chat transport is an open architectural question, deferred to 3c.** [CLAUDE.md §8.4](../../../CLAUDE.md) says LiveKit carries "data events for chat + bookmarks". Stage 3 and [STATE-AND-RESILIENCE.md](../../architecture/STATE-AND-RESILIENCE.md#websocket-reliability) instead describe a WebSocket layer with a *server-side* bounded replay buffer. Those are different architectures and the docs currently assert both. Compounding it, `backend/` has no WebSocket layer today and Postgres/Redis are Stage 5 deliverables, so a server-side replay buffer has nowhere durable to live yet. 3c resolves this deliberately; 3a does not touch it.

## Scope

**In:** overlay mounting scoped by page type, the "overlay everywhere" debug mode, speaking indicators, mute control from the UI, and a TypeScript test runner.

**Out:** chat, DDB DOM extraction, group selector, refresh recovery, WebSocket reconnect/replay, audio device selection, mic-level meters.

Mic-level meters are called out because they are tempting adjacent work and were a named failure in the prior system — a per-frame `requestAnimationFrame` analysis loop that ran whenever the mic was on, regardless of whether anything displayed the level. If one is ever added, [STATE-AND-RESILIENCE.md §Timers & Animation](../../architecture/STATE-AND-RESILIENCE.md#timers--animation) governs it. Not in this stage.

## 1. Page classification

New `overlay-ui/src/lib/pageMode.ts`:

```ts
export type OverlayMode = 'full' | 'pill';
export function classifyPage(url: URL): OverlayMode;
```

- A Maps VTT page (`/games/<id>`) → `full`: roster, speaking indicators, mute control, and later chat.
- Any other allowed DDB page → `pill`: mic state and a mute button, nothing else.
- `localStorage['vtt-overlay-everywhere']` set → forces `full` everywhere. This is CLAUDE.md §9's "overlay everywhere" debug mode. A `localStorage` flag rather than a new Tauri command: a debug toggle shouldn't need a shell round-trip or an IPC surface that ships to users.

**Why a pill instead of nothing off-Maps.** ROADMAP's wording is "overlay injection scoped to Maps VTT only", but a session is joined from the character page and push-to-talk is app-focused-only (Stage 2). A strictly Maps-only overlay would leave a player mid-session with no mic-state feedback and no mute control while reading a rules page — they would have to navigate back to Maps to mute. The pill is the smallest thing that closes that hole while keeping the full panel off pages where a participant list is clutter. Decided 2026-08-11.

**The `/games/<id>` pattern is taken from the Stage 3 known-issue note in `ROADMAP.md`**, which recorded it from a real Maps VTT page. It is not inferred from DDB internals (CLAUDE.md §14), but it *is* load-bearing and single-sourced, so implementation verifies it against a real Maps load before the stage closes.

### SPA route changes

`initialization_script` re-runs on document load but not on a client-side route change. If DDB Maps routes client-side, an overlay mounted as `pill` on a character sheet would stay a pill after navigating into a game.

`pageMode.ts` therefore exposes a subscription that fires on: `popstate`, and patched `history.pushState`/`replaceState` (patch dispatches a custom event, then delegates to the original). `usePageMode()` re-classifies on each and returns the current mode.

Whether DDB actually needs this is unconfirmed — it may hard-navigate between sections. The mechanism is small and correct either way, so it is built rather than gambled on; confirming which path DDB takes is an implementation-time observation, not a blocker.

## 2. Speaking state: `rust-livekit` → overlay

`LiveKitClient`'s event loop gains a `RoomEvent::ActiveSpeakersChanged { speakers }` arm. Verified present in the `livekit` 0.8.2 crate before designing around it, alongside `Participant::is_speaking()` / `audio_level()`.

It emits a **new** `livekit:speakers` event carrying `{ speakingIdentities: string[] }` — the complete current speaker set, not a delta.

**It must not be folded into `livekit:state`.** Speaker sets change several times per second. Routing them through the connection-state payload would replace the participant roster on every utterance, invalidating every selector watching it — the precise cascade [STATE-AND-RESILIENCE.md](../../architecture/STATE-AND-RESILIENCE.md#why-this-differs-from-the-prior-system) attributes ~900 React commits/sec to in the prior system. This is the same split already applied to `livekit:microphone` in Stage 2, for the same reason.

LiveKit throttles active-speaker updates server-side, so no client-side rate limiting is specified. If implementation observes it arriving faster than roughly 10Hz, throttle in Rust (at the emit site, where it costs one place) rather than in the overlay.

## 3. Stores and selectors

New `overlay-ui/src/lib/speakingStore.ts` — domain state, a cache of `rust-livekit`'s truth:

```ts
interface SpeakingStore {
  speakingIdentities: Set<string>;
  applySpeakers: (identities: string[]) => void;
}
```

- `applySpeakers` **replaces wholesale** (the event carries the full set) and **no-op guards** on set equality — same size and same members means no write at all. Required at first-write time per [§Write Discipline](../../architecture/STATE-AND-RESILIENCE.md#write-discipline), not deferred as an optimization.
- No stale-entry accumulation is possible: a participant who stops speaking is simply absent from the next full set, so there is no removal path to forget. This is why the event carries the whole set rather than deltas.

Leaves consume `useIsSpeaking(identity: string): boolean` — one primitive selector for one key, per [§Leaf Isolation](../../architecture/STATE-AND-RESILIENCE.md#leaf-isolation-mandatory-for-highfrequencyperparticipant-data). A participant re-renders only when their own speaking state flips, never when someone else's does.

`microphoneStore` and `overlayVisibilityStore` are reused unchanged from Stage 2.

## 4. Components

```text
OverlayRoot
  ├─ usePageMode() → 'full' | 'pill'
  ├─ full → FullPanel
  │           ├─ ConnectionStatus   (existing)
  │           ├─ MicrophoneStatus   (existing)
  │           ├─ MuteButton         (new)
  │           └─ ParticipantList    (existing, extended)
  │                └─ ParticipantRow  (new) → SpeakingDot (new, memoized leaf)
  └─ pill → MicPill
              ├─ MicrophoneStatus   (existing)
              └─ MuteButton         (new)
```

`SpeakingDot` takes **only** `participantId` and subscribes to `useIsSpeaking(id)`. It must never receive a composed participant object — the anti-pattern named explicitly in [§Leaf Isolation](../../architecture/STATE-AND-RESILIENCE.md#leaf-isolation-mandatory-for-highfrequencyperparticipant-data) and enforced by the [CONTRIBUTING.md state checklist](../../../CONTRIBUTING.md#state--resilience-checklist).

`ParticipantList` currently renders raw identity strings (`ddbUserId`). It keeps doing so in 3a; 3b enriches rows with real character names once DDB extraction exists.

Overlay pointer-events stay off the DDB canvas per CLAUDE.md §9 — but `MuteButton` is the overlay's first interactive control, so the current blanket `pointer-events: none` on `.vtt-overlay` needs narrowing: `none` on the container, `auto` on interactive children only.

## 5. Mute from the UI

New `set_microphone_muted(muted: bool)` Tauri command.

The mute-applying logic currently inline in `hotkeys::dispatch` — lock `SharedClient`, call `set_microphone_muted`, emit `livekit:microphone` — is factored into one function that both the command and the hotkey path call. Without that, a click and a keypress are two code paths that can drift, and the emit is exactly the step that would get forgotten in one of them, leaving the overlay showing stale mic state.

## 6. Churn diagnostics

`lib/churnDiagnostics.ts` and `hooks/useChurnDiagnostics.ts` have been no-ops since Stage 0.5, which scoped them as "no-op until Stage 3 wires it into real selectors". 3a is that moment: `useIsSpeaking` calls `useChurnDiagnostics('isSpeaking:<identity>')`, giving per-participant render counts under `window.__VTT_CHURN_DIAGNOSTICS__`.

This is the instrument for 3c's "simulated multi-hour session" done-when bar, so it needs to exist and be trustworthy before that measurement matters.

## 7. Testing

**3a introduces Vitest** — the repo has no TypeScript test runner today (`cargo test` covers Rust only). Added to `overlay-ui` with a root `test` script, wired into CI alongside the existing lint/typecheck/build steps.

Covered:

- `classifyPage` — Maps URLs, non-Maps DDB pages, the debug flag override.
- `speakingStore.applySpeakers` — the no-op guard (same set → no write), and wholesale replacement.
- `microphoneStore.applyMuted` — the existing no-op guard, currently untested.

Not covered by automated tests, and stated rather than skipped silently: that `useIsSpeaking` actually isolates re-renders in a real React tree. That is what the churn-diagnostics counters are for, and it is verified by observation in 3c's long-session run.

**Manual verification for this stage:** the overlay renders as a pill on a character sheet and a full panel on a real Maps VTT page; the `/games/<id>` pattern matches a real Maps URL; speaking dots light up for the correct participant during a two-party call; the mute button and Right Ctrl agree on mic state; and the debug flag forces the full panel off-Maps.

## Known risk carried in from Stage 3's ROADMAP notes

Maps with an **animated background render blank under WebKitGTK** on affected Linux hardware — reproduced in Epiphany independently of this app, and now believed to share a root cause with the [NVIDIA EGL driver bug](../../WEBKITGTK-NVIDIA-EGL-CRASH.md) behind the Stage 1 homepage crash. This threatens 3a's ability to *verify* full-panel mode on a real animated map, though not the overlay code itself: the overlay is a Shadow DOM sibling of the canvas, not a consumer of it. If a blank map blocks verification, the cheap check recorded in `ROADMAP.md` is to re-open with `__EGL_VENDOR_LIBRARY_FILENAMES` pointed at Mesa and see whether the background appears.

## Open questions carried into implementation

1. Whether DDB Maps routes client-side (making the SPA subscription load-bearing) or hard-navigates (making it redundant but harmless). Observable on the first real Maps navigation.
2. Whether `/games/<id>` is the complete Maps VTT URL shape, or whether other paths also host a map.
3. Whether LiveKit's server-side active-speaker throttling is slow enough to need no client-side limiting. Measure before adding any.
