# Stage 3a: Overlay Shell & Voice UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stage 3a per its approved design — page-scoped overlay mounting (`full` on Maps VTT, `pill` elsewhere), speaking indicators, a UI mute control, and churn diagnostics wired into a real selector — plus the TypeScript test runner (Vitest) this stage introduces.

**Architecture:** `rust-livekit` gains a second event callback (`SpeakersChangeCallback`) fired from a new `RoomEvent::ActiveSpeakersChanged` arm; `src-tauri` relays it as a new `livekit:speakers` Tauri event and adds a `set_microphone_muted` command that shares its apply/emit logic with the existing hotkey path; `overlay-ui` gains a `speakingStore` (domain state, wholesale-replace + no-op-guarded per the state rules), a `pageMode` classifier + SPA-navigation subscription, and the component tree split into `FullPanel`/`MicPill` chosen by `usePageMode()`. This is also the overlay's first genuinely interactive control (`MuteButton`), so it's the moment `@radix-ui/themes` — a dependency since Stage 1 but never actually imported — gets wired in for real: `main.tsx` wraps the render tree in Radix's `Theme` provider and injects its stylesheet into the Shadow DOM alongside the existing `theme.css`, and `MuteButton` uses Radix's `Button` rather than a plain `<button>`, fulfilling CLAUDE.md §3/§19's "React 19 + Radix UI for every UI surface" mandate that Stage 1/2's components had been deviating from. Confirmed and accepted before this task: Radix's `tokens.css` + `components.css` (~600KB) get inlined into the injected bundle, roughly doubling `overlay.js`'s current 654KB — injected via `initialization_script` on every DDB page load, not just Maps.

**Tech Stack:** Rust (`livekit` 0.8.2, `tauri` 2, `tauri-plugin-global-shortcut`), TypeScript (React 19, Zustand 5, Vite 7, `@radix-ui/themes` 3), Vitest 3 + jsdom (new).

**Design doc:** [docs/superpowers/specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md](../specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md) — read it before starting; this plan implements it section by section but doesn't repeat its rationale.

## Global Constraints

- No composed "projection" object may be passed to a leaf component — high-frequency/per-participant data flows through a dedicated leaf subscribing to one primitive selector for one key ([STATE-AND-RESILIENCE.md § Leaf Isolation](../../architecture/STATE-AND-RESILIENCE.md#leaf-isolation-mandatory-for-highfrequencyperparticipant-data)).
- Every store write must no-op-guard on whether the value actually changed before writing — required at first-write time, not added later ([STATE-AND-RESILIENCE.md § Write Discipline](../../architecture/STATE-AND-RESILIENCE.md#write-discipline)).
- Domain state (cache of `rust-livekit`/backend truth) and UI-only state must not share a store ([STATE-AND-RESILIENCE.md § Store Boundaries](../../architecture/STATE-AND-RESILIENCE.md#store-boundaries)).
- TypeScript everywhere except `tauri-client/src-tauri/` and `tauri-client/rust-livekit/`; Rust confined to those two crates (CLAUDE.md §3).
- Each TypeScript package keeps `components/`, `hooks/`, `consts/`, `types/`, `styles/`, `lib/` separated — don't mix logic, markup, and constants in one file (CLAUDE.md §3, `docs/CONVENTIONS.md`).
- Cross-module types/contracts (Tauri IPC event payloads) live in `shared/`, not duplicated per module, except where Rust can't import TS (`tauri-client/`), which duplicates by hand with a comment pointing at the TS source of truth — the existing pattern in `consts.rs`.
- `rustfmt` + `clippy -D warnings` clean for Rust; ESLint + Prettier clean for TypeScript, on every task.
- Mic-level meters are explicitly **out of scope** for this stage (named failure mode from the prior system — unconditional `requestAnimationFrame` loop). Do not add one.
- Chat, DDB DOM extraction, group selector, refresh recovery, and WebSocket reconnect/replay are **out of scope** — those are 3b/3c/Stage 4.

---

## Task 1: Vitest test runner + characterize the existing untested no-op guard

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/microphoneStore.test.ts`
- Create: `tauri-client/overlay-ui/vitest.config.ts`
- Modify: `tauri-client/overlay-ui/package.json`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: `useMicrophoneStore` from `tauri-client/overlay-ui/src/lib/microphoneStore.ts` (existing, unchanged — `{ muted: boolean; applyMuted: (muted: boolean) => void }`).
- Produces: a working `npm test` script at the root and in `overlay-ui`, and a `vitest.config.ts` every later task's tests load via (`environment: 'jsdom'`, `include: ['src/**/*.test.ts']`). Later tasks assume this exists and don't re-configure it.

The design's Testing section (§7) calls out `microphoneStore.applyMuted`'s no-op guard as "currently untested" — this task closes that gap while standing up the runner, so the first test proves real behavior rather than being a throwaway smoke test.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/microphoneStore.test.ts
import { describe, expect, it } from 'vitest';

import { useMicrophoneStore } from './microphoneStore.js';

describe('microphoneStore', () => {
  it('starts muted', () => {
    expect(useMicrophoneStore.getState().muted).toBe(true);
  });

  it('applyMuted replaces the value', () => {
    useMicrophoneStore.getState().applyMuted(false);
    expect(useMicrophoneStore.getState().muted).toBe(false);

    useMicrophoneStore.getState().applyMuted(true);
    expect(useMicrophoneStore.getState().muted).toBe(true);
  });

  it('applyMuted no-ops when the value is unchanged', () => {
    useMicrophoneStore.getState().applyMuted(true);
    const before = useMicrophoneStore.getState();

    useMicrophoneStore.getState().applyMuted(true);
    expect(useMicrophoneStore.getState()).toBe(before);
  });
});
```

- [ ] **Step 2: Run it to confirm there's no runner yet**

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: FAIL — `npm error Missing script: "test"` (no `test` script, no Vitest installed, no config).

- [ ] **Step 3: Add Vitest + jsdom and the `test` script**

Edit `tauri-client/overlay-ui/package.json`:

```json
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

```json
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^6.0.3",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  },
```

- [ ] **Step 4: Add the Vitest config**

```ts
// tauri-client/overlay-ui/vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.js';

// Merges into the existing Vite config (the IIFE build in vite.config.ts is untouched by this —
// `test` is a separate key `vite build` never reads) so Vitest resolves the same aliases/plugins
// the app build does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  }),
);
```

- [ ] **Step 5: Install and run**

Run: `npm install` (from repo root, so the new devDependencies resolve into the workspace)
Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — 3 tests.

- [ ] **Step 6: Add the root `test` script**

Edit `package.json` (root), in `"scripts"`, alongside the existing `lint`/`typecheck`/`build` entries:

```json
    "test": "npm run test --workspaces --if-present",
```

Run: `npm test`
Expected: PASS — same 3 tests, run through the root workspace script (other workspaces have no `test` script yet, so `--if-present` skips them silently).

- [ ] **Step 7: Commit**

```bash
git add tauri-client/overlay-ui/package.json tauri-client/overlay-ui/vitest.config.ts \
        tauri-client/overlay-ui/src/lib/microphoneStore.test.ts package.json package-lock.json
git commit -m "test(overlay-ui): add Vitest and cover microphoneStore's no-op guard"
```

---

## Task 2: Shared IPC contract for the speakers event

**Files:**
- Modify: `shared/src/consts/index.ts`
- Modify: `shared/src/types/ipc.ts`

**Interfaces:**
- Produces: `LIVEKIT_SPEAKERS_EVENT` (string const) and `SpeakingStatePayload` (`{ speakingIdentities: string[] }`), both re-exported from `@vtt-chat-app/shared`. Task 4 (Rust emit side) and Task 9 (TS listen side) depend on these exact names.

Pure declarations — no logic to unit test. Verified by the package's own build/typecheck, which every consumer's typecheck also exercises.

- [ ] **Step 1: Add the event name constant**

Edit `shared/src/consts/index.ts`:

```ts
export const COBALT_COOKIE_EVENT = 'ddb:cobalt-cookie';
export const LIVEKIT_STATE_EVENT = 'livekit:state';
export const LIVEKIT_MICROPHONE_EVENT = 'livekit:microphone';
export const LIVEKIT_SPEAKERS_EVENT = 'livekit:speakers';
export const OVERLAY_TOGGLE_EVENT = 'overlay:toggle';
```

- [ ] **Step 2: Add the payload type**

Edit `shared/src/types/ipc.ts`, appended after `MicrophoneStatePayload`:

```ts
/**
 * Payload of the `livekit:speakers` Tauri event, emitted by `rust-livekit` (via `src-tauri`)
 * on every `RoomEvent::ActiveSpeakersChanged`. Carries the complete current speaker set, not a
 * delta — a participant who stops speaking is simply absent from the next payload.
 *
 * Separate from `LiveKitConnectionState` for the same reason as `MicrophoneStatePayload`: this
 * changes several times per second, and folding it into connection state would churn the
 * participant roster on every utterance.
 */
export interface SpeakingStatePayload {
  speakingIdentities: string[];
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build --workspace shared`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/src/consts/index.ts shared/src/types/ipc.ts
git commit -m "feat(shared): add livekit:speakers IPC contract"
```

---

## Task 3: `rust-livekit` — active-speaker event → `SpeakersChangeCallback`

**Files:**
- Modify: `tauri-client/rust-livekit/src/lib.rs`
- Modify: `tauri-client/rust-livekit/examples/loopback.rs`

**Interfaces:**
- Consumes: `livekit::prelude::{Participant, RoomEvent}` (already in scope via the existing `use livekit::prelude::*;`). `Participant::identity(&self) -> ParticipantIdentity`, and `ParticipantIdentity: Display` (verified against the vendored `livekit` 0.8.2 source — `crates.io/livekit-0.8.2/src/room/id.rs`, `src/room/participant/mod.rs`).
- Produces: `pub type SpeakersChangeCallback = Arc<dyn Fn(Vec<String>) + Send + Sync>;` and a new third parameter on `LiveKitClient::connect`. Task 4 (`commands.rs`) and this task's own `loopback.rs` update are the only two callers in the mono-repo.

This crate has no unit tests today (`audio/capture.rs`, `audio/playback.rs` are exercised only by the `loopback.rs` example against a real server, per the Stage 1 notes in `ROADMAP.md`) — this task follows that existing pattern rather than inventing a new one. Verification is `cargo build`/`cargo clippy`, not `cargo test`.

- [ ] **Step 1: Add the callback type**

Edit `tauri-client/rust-livekit/src/lib.rs`, directly below `StateChangeCallback`:

```rust
pub type StateChangeCallback = Arc<dyn Fn(ConnectionState) + Send + Sync>;

/// Fired from `RoomEvent::ActiveSpeakersChanged`, carrying the complete current speaker set
/// (identities), never a delta. See the Stage 3a design §2 for why this is a separate callback
/// from `StateChangeCallback` rather than folded into `ConnectionState`: speaker sets change
/// several times per second, and routing them through connection-state would replace the
/// participant roster on every utterance.
pub type SpeakersChangeCallback = Arc<dyn Fn(Vec<String>) + Send + Sync>;
```

- [ ] **Step 2: Accept it in `connect` and clone it for the event task**

Edit the `connect` signature and the two lines immediately above `tokio::spawn`:

```rust
    pub async fn connect(
        url: &str,
        token: &str,
        on_state_change: StateChangeCallback,
        on_speakers_change: SpeakersChangeCallback,
    ) -> Result<Self, LiveKitError> {
```

```rust
        let event_room = room.clone();
        let event_cb = on_state_change.clone();
        let speakers_cb = on_speakers_change.clone();
        let event_task = tokio::spawn(async move {
```

- [ ] **Step 3: Add the match arm**

In the `while let Some(event) = events.recv().await { match event { ... } }` block, add a new arm alongside the existing ones:

```rust
                    RoomEvent::ActiveSpeakersChanged { speakers } => {
                        let speaking_identities = speakers
                            .into_iter()
                            .map(|participant| participant.identity().to_string())
                            .collect();
                        speakers_cb(speaking_identities);
                    }
```

- [ ] **Step 4: Update the two `loopback.rs` call sites**

Edit `tauri-client/rust-livekit/examples/loopback.rs` — both `LiveKitClient::connect(...)` calls gain a no-op speakers callback (the example prints connection state only; wiring speaker printing isn't in scope here):

```rust
    let client_a = LiveKitClient::connect(
        url,
        token_a,
        Arc::new(|s| print_state("A", s)),
        Arc::new(|_speakers| {}),
    )
    .await
    .expect("identity A failed to connect");
```

```rust
    let client_b = LiveKitClient::connect(
        url,
        token_b,
        Arc::new(|s| print_state("B", s)),
        Arc::new(|_speakers| {}),
    )
    .await
    .expect("identity B failed to connect");
```

- [ ] **Step 5: Build and lint**

Run (from `tauri-client/`): `cargo build --workspace --all-targets`
Expected: PASS (this compiles the example too, catching any call-site mismatch).

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: PASS.

Run: `cargo fmt --all -- --check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tauri-client/rust-livekit/src/lib.rs tauri-client/rust-livekit/examples/loopback.rs
git commit -m "feat(rust-livekit): emit active-speaker identities via SpeakersChangeCallback"
```

---

## Task 4: `src-tauri` — relay `livekit:speakers`, add `set_microphone_muted`, share the mute-apply path

**Files:**
- Modify: `tauri-client/src-tauri/src/consts.rs`
- Modify: `tauri-client/src-tauri/src/hotkeys.rs`
- Modify: `tauri-client/src-tauri/src/commands.rs`
- Modify: `tauri-client/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `rust_livekit::SpeakersChangeCallback` (Task 3), `shared`'s `LIVEKIT_SPEAKERS_EVENT` name mirrored by hand as `SPEAKERS_STATE_EVENT` (Rust can't import the TS package — same rationale as the existing `MICROPHONE_STATE_EVENT`/`OVERLAY_TOGGLE_EVENT` pair in `consts.rs`).
- Produces: `hotkeys::apply_microphone_mute(app: &AppHandle, muted: bool)` (used by both `dispatch` and the new command) and the `set_microphone_muted` Tauri command, which Task 11's `MuteButton` invokes by name (`"set_microphone_muted"`, `{ muted: boolean }`).

This is the design's §5 ("Mute from the UI") and the Rust half of §2. No new unit tests — `dispatch`'s existing behavior (and its 5 existing tests in `hotkeys.rs`) is preserved exactly; `mute_state_for` is untouched.

- [ ] **Step 1: Add the mirrored event name constant**

Edit `tauri-client/src-tauri/src/consts.rs`:

```rust
pub const OVERLAY_TOGGLE_EVENT: &str = "overlay:toggle";
pub const MICROPHONE_STATE_EVENT: &str = "livekit:microphone";
/// Mirrors `shared`'s `LIVEKIT_SPEAKERS_EVENT` — same duplication rationale as the two above.
pub const SPEAKERS_STATE_EVENT: &str = "livekit:speakers";
```

- [ ] **Step 2: Factor the mute-apply logic out of `dispatch`**

Edit `tauri-client/src-tauri/src/hotkeys.rs`. Replace the body of `dispatch` and add `apply_microphone_mute` immediately after it:

```rust
/// Applies a mute state directly and emits `livekit:microphone`. The one place that touches the
/// microphone gate — both the hotkey path (`dispatch`, below) and the UI mute button
/// (`commands::set_microphone_muted`) call this, so a click and a keypress can't drift: without
/// this, the emit is exactly the step that would get forgotten in one of the two paths, leaving
/// the overlay showing stale mic state.
pub fn apply_microphone_mute(app: &AppHandle, muted: bool) {
    let state = app.state::<SharedClient>();
    let guard = match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[src-tauri] LiveKit client mutex poisoned; recovering to apply mute");
            poisoned.into_inner()
        }
    };
    let Some(client) = guard.as_ref() else {
        return;
    };

    client.set_microphone_muted(muted);
    let _ = app.emit(MICROPHONE_STATE_EVENT, MicrophoneStatePayload { muted });
}

/// Applies an action. A no-op for microphone actions when not connected — hotkeys are live
/// before any room is joined, and pressing PTT then shouldn't be an error.
pub fn dispatch(app: &AppHandle, action: HotkeyAction) {
    if action == HotkeyAction::ToggleOverlay {
        let _ = app.emit(OVERLAY_TOGGLE_EVENT, ());
        return;
    }

    let currently_muted = {
        let state = app.state::<SharedClient>();
        let guard = match state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("[src-tauri] LiveKit client mutex poisoned; recovering to apply hotkey");
                poisoned.into_inner()
            }
        };
        let Some(client) = guard.as_ref() else {
            return;
        };
        client.is_microphone_muted()
    };

    let Some(muted) = mute_state_for(action, currently_muted) else {
        return;
    };

    apply_microphone_mute(app, muted);
}
```

`MicrophoneStatePayload` stays exactly as already defined in this file (it's still private to the module, and `apply_microphone_mute` is in the same module).

- [ ] **Step 3: Run existing Rust tests to confirm nothing broke**

Run (from `tauri-client/`): `cargo test --package src-tauri hotkeys::`
Expected: PASS — all 5 existing `hotkeys.rs` tests unchanged (`mute_state_for` wasn't touched).

- [ ] **Step 4: Wire the speakers callback and add `set_microphone_muted` in `commands.rs`**

Edit `tauri-client/src-tauri/src/commands.rs`:

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveKitStatePayload {
    connected: bool,
    room_name: Option<String>,
    participant_identities: Vec<String>,
}

impl From<ConnectionState> for LiveKitStatePayload {
    fn from(state: ConnectionState) -> Self {
        Self {
            connected: state.connected,
            room_name: state.room_name,
            participant_identities: state.participant_identities,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeakersPayload {
    speaking_identities: Vec<String>,
}

#[tauri::command]
pub async fn livekit_connect(
    app: AppHandle,
    state: State<'_, SharedClient>,
    url: String,
    token: String,
) -> Result<(), String> {
    let emit_app = app.clone();
    let callback: rust_livekit::StateChangeCallback = Arc::new(move |connection_state| {
        let payload: LiveKitStatePayload = connection_state.into();
        let _ = emit_app.emit("livekit:state", payload);
    });

    let speakers_emit_app = app.clone();
    let speakers_callback: rust_livekit::SpeakersChangeCallback =
        Arc::new(move |speaking_identities| {
            let _ = speakers_emit_app.emit(
                crate::consts::SPEAKERS_STATE_EVENT,
                SpeakersPayload { speaking_identities },
            );
        });

    let client = LiveKitClient::connect(&url, &token, callback, speakers_callback)
        .await
        .map_err(|err| err.to_string())?;

    *state.lock().unwrap() = Some(client);
    Ok(())
}
```

Then, after the existing `hotkey_action` command at the end of the file:

```rust
/// Delivery path for the overlay's mute button (Stage 3a spec §5) — shares
/// `hotkeys::apply_microphone_mute` with the hotkey path so a click and a keypress can't
/// leave the overlay showing stale mic state.
#[tauri::command]
pub fn set_microphone_muted(app: AppHandle, muted: bool) -> Result<(), String> {
    crate::hotkeys::apply_microphone_mute(&app, muted);
    Ok(())
}
```

- [ ] **Step 5: Register the new command**

Edit `tauri-client/src-tauri/src/lib.rs`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::hotkey_action,
            commands::set_microphone_muted
        ])
```

- [ ] **Step 6: Build, lint, full test**

Run (from `tauri-client/`): `cargo build --workspace --all-targets`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: PASS.

Run: `cargo fmt --all -- --check`
Expected: PASS.

Run: `cargo test --all`
Expected: PASS — 19 existing tests, unchanged count (no new Rust tests added this task, per the note in Task 3 about this codebase's existing test boundary).

- [ ] **Step 7: Commit**

```bash
git add tauri-client/src-tauri/src/consts.rs tauri-client/src-tauri/src/hotkeys.rs \
        tauri-client/src-tauri/src/commands.rs tauri-client/src-tauri/src/lib.rs
git commit -m "feat(src-tauri): relay livekit:speakers and add set_microphone_muted command"
```

---

## Task 5: `pageMode.ts` — `classifyPage`

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/pageMode.ts`
- Create: `tauri-client/overlay-ui/src/lib/pageMode.test.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

**Interfaces:**
- Produces: `export type OverlayMode = 'full' | 'pill'`, `export function classifyPage(url: URL): OverlayMode`, `export const OVERLAY_EVERYWHERE_STORAGE_KEY: string`. Task 6 (`usePageMode`) and Task 15 (`OverlayRoot`) consume `OverlayMode` and `classifyPage`.

Implements design §1's classification rule (not the SPA-subscription half — that's Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/pageMode.test.ts
import { afterEach, describe, expect, it } from 'vitest';

import { classifyPage, OVERLAY_EVERYWHERE_STORAGE_KEY } from './pageMode.js';

afterEach(() => {
  localStorage.removeItem(OVERLAY_EVERYWHERE_STORAGE_KEY);
});

describe('classifyPage', () => {
  it('classifies a Maps VTT URL as full', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/games/1234'))).toBe('full');
  });

  it('classifies a Maps VTT URL with a trailing path as full', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/games/1234/session'))).toBe('full');
  });

  it('classifies a non-Maps DDB page as pill', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters/999'))).toBe('pill');
  });

  it('classifies the bare characters list as pill', () => {
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters'))).toBe('pill');
  });

  it('forces full everywhere when the debug flag is set', () => {
    localStorage.setItem(OVERLAY_EVERYWHERE_STORAGE_KEY, '1');
    expect(classifyPage(new URL('https://www.dndbeyond.com/characters'))).toBe('full');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- pageMode`
Expected: FAIL — cannot find module `./pageMode.js`.

- [ ] **Step 3: Implement `classifyPage`**

```ts
// tauri-client/overlay-ui/src/lib/pageMode.ts
export type OverlayMode = 'full' | 'pill';

const MAPS_PATH_PATTERN = /^\/games\/[^/]+/;

/**
 * `localStorage` key for CLAUDE.md §9's "overlay everywhere" debug mode. A `localStorage` flag
 * rather than a Tauri command: a debug toggle shouldn't need a shell round-trip or an IPC
 * surface that ships to users. See the Stage 3a design §1.
 */
export const OVERLAY_EVERYWHERE_STORAGE_KEY = 'vtt-overlay-everywhere';

function isOverlayEverywhereEnabled(): boolean {
  try {
    return localStorage.getItem(OVERLAY_EVERYWHERE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Classifies a page as `full` (Maps VTT — roster, speaking indicators, mute, later chat) or
 * `pill` (any other allowed DDB page — mic state + mute only). The `/games/<id>` pattern is
 * taken from the Stage 3 known-issue note in ROADMAP.md, recorded from a real Maps VTT page —
 * it is not inferred from DDB internals (CLAUDE.md §14), and implementation verifies it against
 * a real Maps load before this stage closes (see the design's "Manual verification").
 */
export function classifyPage(url: URL): OverlayMode {
  if (isOverlayEverywhereEnabled()) return 'full';
  return MAPS_PATH_PATTERN.test(url.pathname) ? 'full' : 'pill';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- pageMode`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts`:

```ts
export * from './backendClient.js';
export * from './churnDiagnostics.js';
export * from './microphoneStore.js';
export * from './overlayVisibilityStore.js';
export * from './pageMode.js';
export * from './store.js';
export * from './tauriBridge.js';
```

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/pageMode.ts tauri-client/overlay-ui/src/lib/pageMode.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add classifyPage for full/pill overlay mode"
```

---

## Task 6: SPA-navigation subscription + `usePageMode`

**Files:**
- Modify: `tauri-client/overlay-ui/src/lib/pageMode.ts`
- Create: `tauri-client/overlay-ui/src/hooks/usePageMode.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/index.ts`

**Interfaces:**
- Consumes: `classifyPage`, `OverlayMode` (Task 5).
- Produces: `export function subscribeToPageModeChanges(listener: () => void): () => void` (from `lib/pageMode.ts`) and `export function usePageMode(): OverlayMode` (new hook). Task 15 (`OverlayRoot`) consumes `usePageMode`.

Per the design §1 "SPA route changes": `initialization_script` re-runs on document load but not on a client-side route change, so this patches `history.pushState`/`replaceState` once and listens for `popstate`. Not automated-tested — the design's Testing section (§7) scopes automated coverage to `classifyPage`, not this DOM-dependent subscription mechanism; it's covered by the stage's manual verification instead (does the pill flip to a full panel on navigating into a real Maps game).

- [ ] **Step 1: Add the subscription to `pageMode.ts`**

Append to `tauri-client/overlay-ui/src/lib/pageMode.ts`:

```ts
const PAGE_MODE_CHANGE_EVENT = 'vtt-page-mode-check';
let historyPatched = false;

function patchHistoryOnce(): void {
  if (historyPatched) return;
  historyPatched = true;

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (
      this: History,
      ...args: Parameters<History[typeof method]>
    ): ReturnType<History[typeof method]> {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(PAGE_MODE_CHANGE_EVENT));
      return result;
    };
  }
}

/**
 * Fires `listener` on `popstate` and on patched `pushState`/`replaceState`, covering both a
 * hard navigation and DDB routing client-side. Whether DDB actually needs the patched-history
 * half is unconfirmed (see the Stage 3a design's "Open questions") — the mechanism is small and
 * correct either way, so it's built rather than gambled on.
 */
export function subscribeToPageModeChanges(listener: () => void): () => void {
  patchHistoryOnce();
  window.addEventListener('popstate', listener);
  window.addEventListener(PAGE_MODE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(PAGE_MODE_CHANGE_EVENT, listener);
  };
}
```

- [ ] **Step 2: Add the hook**

```ts
// tauri-client/overlay-ui/src/hooks/usePageMode.ts
import { useEffect, useState } from 'react';

import { classifyPage, subscribeToPageModeChanges, type OverlayMode } from '../lib/pageMode.js';

/** Re-classifies on navigation — see `subscribeToPageModeChanges` for what triggers it. */
export function usePageMode(): OverlayMode {
  const [mode, setMode] = useState<OverlayMode>(() =>
    classifyPage(new URL(window.location.href)),
  );

  useEffect(() => {
    const recompute = () => setMode(classifyPage(new URL(window.location.href)));
    recompute();
    return subscribeToPageModeChanges(recompute);
  }, []);

  return mode;
}
```

- [ ] **Step 3: Add the barrel export**

Edit `tauri-client/overlay-ui/src/hooks/index.ts`:

```ts
export * from './useChurnDiagnostics.js';
export * from './useConnected.js';
export * from './useMicrophoneMuted.js';
export * from './useOverlayBridge.js';
export * from './useOverlayVisible.js';
export * from './usePageMode.js';
export * from './useParticipantIdentities.js';
```

- [ ] **Step 4: Verify the build and existing tests are unaffected**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — same tests as Task 5 (8 total so far), unaffected.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/pageMode.ts tauri-client/overlay-ui/src/hooks/usePageMode.ts \
        tauri-client/overlay-ui/src/hooks/index.ts
git commit -m "feat(overlay-ui): add usePageMode with SPA-navigation re-classification"
```

---

## Task 7: `speakingStore`

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/speakingStore.ts`
- Create: `tauri-client/overlay-ui/src/lib/speakingStore.test.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

**Interfaces:**
- Produces: `useSpeakingStore` (Zustand store, `{ speakingIdentities: Set<string>; applySpeakers: (identities: string[]) => void }`). Task 8 (`useIsSpeaking`) and Task 10 (`useOverlayBridge`) consume it.

Implements design §3.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/speakingStore.test.ts
import { describe, expect, it } from 'vitest';

import { useSpeakingStore } from './speakingStore.js';

describe('speakingStore', () => {
  it('starts with no one speaking', () => {
    expect(useSpeakingStore.getState().speakingIdentities.size).toBe(0);
  });

  it('applySpeakers replaces the set wholesale', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['alice', 'bob']));

    useSpeakingStore.getState().applySpeakers(['carol']);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['carol']));
  });

  it('applySpeakers no-ops when the set is unchanged', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    const before = useSpeakingStore.getState();

    useSpeakingStore.getState().applySpeakers(['bob', 'alice']);
    expect(useSpeakingStore.getState()).toBe(before);
  });

  it('applySpeakers writes when membership changes even if size matches', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    const before = useSpeakingStore.getState();

    useSpeakingStore.getState().applySpeakers(['alice', 'carol']);
    expect(useSpeakingStore.getState()).not.toBe(before);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['alice', 'carol']));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- speakingStore`
Expected: FAIL — cannot find module `./speakingStore.js`.

- [ ] **Step 3: Implement the store**

```ts
// tauri-client/overlay-ui/src/lib/speakingStore.ts
import { create } from 'zustand';

interface SpeakingStore {
  speakingIdentities: Set<string>;
  applySpeakers: (identities: string[]) => void;
}

function setsAreEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Domain state — a cache of `rust-livekit`'s active-speaker set, mirroring the `livekit:speakers`
 * event. Kept out of `useLiveKitStore` because it changes several times per second: folding it in
 * would replace the participant roster on every utterance, invalidating every selector watching
 * it — see docs/architecture/STATE-AND-RESILIENCE.md#why-this-differs-from-the-prior-system.
 *
 * `applySpeakers` replaces wholesale (the event carries the full set, never a delta) and
 * no-op-guards on set equality, per §Write Discipline. No stale-entry accumulation is possible:
 * a participant who stops speaking is simply absent from the next full set.
 */
export const useSpeakingStore = create<SpeakingStore>((set) => ({
  speakingIdentities: new Set(),
  applySpeakers: (identities) =>
    set((state) => {
      const next = new Set(identities);
      return setsAreEqual(state.speakingIdentities, next) ? state : { speakingIdentities: next };
    }),
}));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- speakingStore`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts`:

```ts
export * from './backendClient.js';
export * from './churnDiagnostics.js';
export * from './microphoneStore.js';
export * from './overlayVisibilityStore.js';
export * from './pageMode.js';
export * from './speakingStore.js';
export * from './store.js';
export * from './tauriBridge.js';
```

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/speakingStore.ts tauri-client/overlay-ui/src/lib/speakingStore.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add speakingStore with wholesale-replace + no-op guard"
```

---

## Task 8: `useIsSpeaking`, wired into churn diagnostics

**Files:**
- Create: `tauri-client/overlay-ui/src/hooks/useIsSpeaking.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/index.ts`

**Interfaces:**
- Consumes: `useSpeakingStore` (Task 7), `useChurnDiagnostics` (existing, `tauri-client/overlay-ui/src/hooks/useChurnDiagnostics.ts`).
- Produces: `export function useIsSpeaking(identity: string): boolean`. Task 12 (`SpeakingDot`) consumes it.

This is the moment `churnDiagnostics.ts`/`useChurnDiagnostics.ts` stop being no-ops, per Stage 0.5's "no-op until Stage 3 wires it into real selectors" (design §6). Render-isolation itself isn't unit-tested — the design's Testing section states this explicitly and defers verification to the churn-diagnostics counters observed manually.

- [ ] **Step 1: Implement the hook**

```ts
// tauri-client/overlay-ui/src/hooks/useIsSpeaking.ts
import { useSpeakingStore } from '../lib/speakingStore.js';
import { useChurnDiagnostics } from './useChurnDiagnostics.js';

/**
 * Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md.
 * A participant re-renders only when their own speaking state flips, never when someone else's
 * does, because the selector reads one boolean out of the shared `Set`.
 */
export function useIsSpeaking(identity: string): boolean {
  useChurnDiagnostics(`isSpeaking:${identity}`);
  return useSpeakingStore((state) => state.speakingIdentities.has(identity));
}
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/hooks/index.ts`:

```ts
export * from './useChurnDiagnostics.js';
export * from './useConnected.js';
export * from './useIsSpeaking.js';
export * from './useMicrophoneMuted.js';
export * from './useOverlayBridge.js';
export * from './useOverlayVisible.js';
export * from './usePageMode.js';
export * from './useParticipantIdentities.js';
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — unaffected (12 tests so far).

- [ ] **Step 4: Commit**

```bash
git add tauri-client/overlay-ui/src/hooks/useIsSpeaking.ts tauri-client/overlay-ui/src/hooks/index.ts
git commit -m "feat(overlay-ui): add useIsSpeaking, wiring churn diagnostics into a real selector"
```

---

## Task 9: `tauriBridge` — listen for speakers, invoke the mute command

**Files:**
- Modify: `tauri-client/overlay-ui/src/lib/tauriBridge.ts`

**Interfaces:**
- Consumes: `LIVEKIT_SPEAKERS_EVENT`, `SpeakingStatePayload` (Task 2, `@vtt-chat-app/shared`); Rust command `set_microphone_muted` (Task 4).
- Produces: `export function onSpeakersChanged(handler: (payload: SpeakingStatePayload) => void): Promise<UnlistenFn>` and `export function setMicrophoneMuted(muted: boolean): Promise<void>`. Task 10 (`useOverlayBridge`) consumes the former; Task 11 (`MuteButton`) consumes the latter.

Thin IPC wrappers, same shape as the existing `onMicrophoneState`/`connectLiveKit` in this file — not unit-tested, consistent with those.

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/lib/tauriBridge.ts`:

```ts
import type {
  CobaltCookieDetectedPayload,
  LiveKitConnectionState,
  MicrophoneStatePayload,
  SpeakingStatePayload,
} from '@vtt-chat-app/shared';
import {
  COBALT_COOKIE_EVENT,
  LIVEKIT_MICROPHONE_EVENT,
  LIVEKIT_SPEAKERS_EVENT,
  LIVEKIT_STATE_EVENT,
  OVERLAY_TOGGLE_EVENT,
} from '@vtt-chat-app/shared';
```

Append, after `onOverlayToggle`:

```ts
/** Emitted on every `RoomEvent::ActiveSpeakersChanged` — carries the complete current speaker set. */
export function onSpeakersChanged(
  handler: (payload: SpeakingStatePayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeakingStatePayload>(LIVEKIT_SPEAKERS_EVENT, (event) => handler(event.payload));
}
```

Append, after `disconnectLiveKit`:

```ts
export function setMicrophoneMuted(muted: boolean): Promise<void> {
  return invoke('set_microphone_muted', { muted });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/tauriBridge.ts
git commit -m "feat(overlay-ui): add onSpeakersChanged and setMicrophoneMuted IPC wrappers"
```

---

## Task 10: Wire `speakingStore` into `useOverlayBridge`

**Files:**
- Modify: `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`

**Interfaces:**
- Consumes: `useSpeakingStore` (Task 7), `onSpeakersChanged` (Task 9).

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`:

```ts
import { extractDdbIdentity } from '@vtt-chat-app/ddb';
import { useEffect } from 'react';

import { requestSession } from '../lib/backendClient.js';
import { useMicrophoneStore } from '../lib/microphoneStore.js';
import { useOverlayVisibilityStore } from '../lib/overlayVisibilityStore.js';
import { useSpeakingStore } from '../lib/speakingStore.js';
import { useLiveKitStore } from '../lib/store.js';
import {
  connectLiveKit,
  onCobaltCookieDetected,
  onLiveKitState,
  onMicrophoneState,
  onOverlayToggle,
  onSpeakersChanged,
} from '../lib/tauriBridge.js';

/**
 * Wires the whole Stage 1 pipeline: cobalt cookie event -> ddb/ identity extraction -> backend
 * session request -> rust-livekit connect, plus applying `livekit:state` events back into the
 * store. Call once from the overlay root — see docs/architecture/DDB-AUTH.md for the flow.
 *
 * Stage 2 adds the two hotkey-driven events: `livekit:microphone` (push-to-talk / mute toggle)
 * and `overlay:toggle`. Stage 3a adds `livekit:speakers`, into its own store for the same
 * reason `livekit:microphone` isn't folded into `useLiveKitStore` — see `speakingStore`.
 */
export function useOverlayBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);
  const applyMuted = useMicrophoneStore((state) => state.applyMuted);
  const toggleVisibility = useOverlayVisibilityStore((state) => state.toggle);
  const applySpeakers = useSpeakingStore((state) => state.applySpeakers);

  useEffect(() => {
    let cancelled = false;

    const unlistenState = onLiveKitState((state) => {
      if (!cancelled) applyState(state);
    });

    const unlistenMicrophone = onMicrophoneState(({ muted }) => {
      if (!cancelled) applyMuted(muted);
    });

    const unlistenOverlayToggle = onOverlayToggle(() => {
      if (!cancelled) toggleVisibility();
    });

    const unlistenSpeakers = onSpeakersChanged(({ speakingIdentities }) => {
      if (!cancelled) applySpeakers(speakingIdentities);
    });

    const unlistenCookie = onCobaltCookieDetected(({ cookieValue }) => {
      void (async () => {
        try {
          const identity = await extractDdbIdentity(cookieValue);
          const session = await requestSession(identity);
          await connectLiveKit(session.liveKit.url, session.liveKit.token);
        } catch (err) {
          console.error('[overlay-ui] failed to establish LiveKit session', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      void unlistenState.then((unlisten) => unlisten());
      void unlistenMicrophone.then((unlisten) => unlisten());
      void unlistenOverlayToggle.then((unlisten) => unlisten());
      void unlistenSpeakers.then((unlisten) => unlisten());
      void unlistenCookie.then((unlisten) => unlisten());
    };
  }, [applyState, applyMuted, toggleVisibility, applySpeakers]);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — unaffected.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts
git commit -m "feat(overlay-ui): apply livekit:speakers events into speakingStore"
```

---

## Task 11: Wire in Radix Themes + `MuteButton` + pointer-events narrowing

**Files:**
- Modify: `tauri-client/overlay-ui/src/main.tsx`
- Create: `tauri-client/overlay-ui/src/components/MuteButton.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useMicrophoneMuted` (existing), `setMicrophoneMuted` (Task 9), `Theme`/`Button` from `@radix-ui/themes` (dependency since Stage 1, `^3.2.0` in `package.json`, actual installed version `3.3.0` — confirmed present in `node_modules`, never previously imported anywhere in `overlay-ui`).
- Produces: `export const MuteButton`. Task 14 (`FullPanel`, `MicPill`) consumes it. `main.tsx` now renders `<Theme>` as the root of the React tree — every component rendered inside `OverlayRoot` from this task onward is inside a Radix theme context.

Implements design §4/§5, plus the Radix-adoption decision made before this task started (see this plan's Architecture section): `@radix-ui/themes` is a dependency that's never been imported — Stage 1/2's components all used plain HTML elements, deviating from CLAUDE.md §3/§19's "React 19 + Radix UI for every UI surface." This is the overlay's first interactive control, so it's also the first point where that matters. Confirmed and accepted: Radix's `tokens.css` + `components.css` (~600KB total, verified via `wc -c` against the installed package) get inlined into `overlay-ui`'s injected bundle — `styles.css` (Radix's usual single-import recommendation) is *not* used here, specifically to avoid also pulling in `utilities.css`/`layout.css`, which this stage's components don't use.

Radix's `Theme` component renders a wrapping `<div class="radix-themes">` (confirmed via `node_modules/@radix-ui/themes/dist/esm/components/theme.d.ts` — `React.ForwardRefExoticComponent<... React.RefAttributes<HTMLDivElement>>`), which becomes a new ancestor of `.vtt-overlay` inside the Shadow DOM. Because `.vtt-overlay`'s existing `position: fixed` takes it out of flow regardless of this new ancestor, and neither `.vtt-overlay` nor its content have changed size/position rules, this shouldn't change the overlay's on-page footprint — but the design's existing "manual verification" bar for this stage (does the overlay avoid intercepting DDB canvas clicks) now also covers the `Theme` wrapper, so this task adds a defensive CSS rule (`pointer-events: none` on `.radix-themes` itself, not just `.vtt-overlay`) rather than assuming the wrapper is inert.

- [ ] **Step 1: Wire the Radix Theme provider and stylesheet into `main.tsx`**

```tsx
// tauri-client/overlay-ui/src/main.tsx
import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { OverlayRoot } from './components/OverlayRoot.js';
import overlayStyles from './styles/theme.css?inline';
import radixComponents from '@radix-ui/themes/components.css?inline';
import radixTokens from '@radix-ui/themes/tokens.css?inline';

const HOST_ELEMENT_ID = 'vtt-chat-overlay-host';

function mount(): void {
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  document.body.appendChild(host);

  // Shadow DOM keeps DDB's page CSS from bleeding into the overlay and vice versa (CLAUDE.md §9).
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Radix's stylesheets have to be injected into the shadow tree directly, same as theme.css —
  // there's no document <head> to hang a <link> off inside a Shadow DOM, and Radix's CSS custom
  // properties/component styles are useless to components rendered outside the tree they're
  // attached to. Only tokens.css + components.css: this stage doesn't use Radix's Flex/Grid/Box
  // (layout.css) or style-prop utility classes (utilities.css).
  const radixStyleTag = document.createElement('style');
  radixStyleTag.textContent = radixTokens + radixComponents;
  shadowRoot.appendChild(radixStyleTag);

  const styleTag = document.createElement('style');
  styleTag.textContent = overlayStyles;
  shadowRoot.appendChild(styleTag);

  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  createRoot(reactRoot).render(
    <Theme appearance="dark" accentColor="gray" hasBackground={false}>
      <OverlayRoot />
    </Theme>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
```

`hasBackground={false}` because `.vtt-overlay` already supplies its own translucent panel background (`styles/theme.css`) — Radix's own background would otherwise paint behind it. `appearance="dark"` matches the overlay's existing dark palette; `accentColor="gray"` is a neutral default with nothing yet that needs a brand accent.

- [ ] **Step 2: Implement `MuteButton` with Radix's `Button`**

```tsx
// tauri-client/overlay-ui/src/components/MuteButton.tsx
import { Button } from '@radix-ui/themes';
import { memo, useCallback } from 'react';

import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import { setMicrophoneMuted } from '../lib/tauriBridge.js';

/**
 * The overlay's first interactive control, and the first to use Radix's `Button` rather than a
 * plain element — see `main.tsx` for the `Theme` provider this depends on, and `styles/theme.css`
 * for the `pointer-events` narrowing this required. Leaf-isolated per
 * docs/architecture/STATE-AND-RESILIENCE.md, same as `MicrophoneStatus`, which it sits next to.
 */
export const MuteButton = memo(function MuteButton() {
  const muted = useMicrophoneMuted();

  const handleClick = useCallback(() => {
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[overlay-ui] failed to set microphone mute state', err);
    });
  }, [muted]);

  return (
    <Button
      type="button"
      size="1"
      color={muted ? 'gray' : 'green'}
      variant={muted ? 'soft' : 'solid'}
      onClick={handleClick}
    >
      {muted ? 'Unmute' : 'Mute'}
    </Button>
  );
});
```

`color`/`variant` are Radix `Button` enum props (`color`: any Radix accent name including `'gray'`/`'green'`; `variant`: `'classic' | 'solid' | 'soft' | 'surface' | 'outline' | 'ghost'` — confirmed via `node_modules/@radix-ui/themes/dist/esm/components/_internal/base-button.props.d.ts`), not CSS classes — no new class name needed for the button itself.

- [ ] **Step 3: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts`:

```ts
export * from './ConnectionStatus.js';
export * from './MicrophoneStatus.js';
export * from './MuteButton.js';
export * from './OverlayRoot.js';
export * from './ParticipantList.js';
```

- [ ] **Step 4: Narrow pointer-events defensively**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
/* Radix's Theme wrapper is now an ancestor of .vtt-overlay inside the Shadow DOM. It should be
   inert by default (no layout size of its own — its only child is position:fixed), but this
   makes it explicit rather than assumed: pointer-events is inherited, so declaring none here
   and opting back in on .vtt-overlay's interactive descendants covers both this wrapper and the
   container in one place. */
.radix-themes {
  pointer-events: none;
}

.vtt-overlay button {
  pointer-events: auto;
}
```

No `.vtt-mute-button`-specific styling is needed — Radix's `Button` supplies its own look via `components.css`, driven by the `color`/`variant`/`size` props set in Step 2.

- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS. Note the new `dist/overlay.js` size in the implementer report — expected to roughly double from the pre-Radix baseline (654KB) given the ~600KB of inlined Radix CSS; this is the accepted cost from this plan's Architecture section, not a regression to fix.

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/main.tsx tauri-client/overlay-ui/src/components/MuteButton.tsx \
        tauri-client/overlay-ui/src/components/index.ts tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): wire in Radix Theme provider and add MuteButton using Radix Button"
```

---

## Task 12: `SpeakingDot` + `ParticipantRow`

**Files:**
- Create: `tauri-client/overlay-ui/src/components/SpeakingDot.tsx`
- Create: `tauri-client/overlay-ui/src/components/ParticipantRow.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useIsSpeaking` (Task 8).
- Produces: `export const SpeakingDot: React.FC<{ participantId: string }>`, `export const ParticipantRow: React.FC<{ identity: string }>`. Task 13 (`ParticipantList`) consumes `ParticipantRow`.

Implements design §4. `SpeakingDot` takes **only** `participantId` — never a composed participant object, per `STATE-AND-RESILIENCE.md`'s leaf-isolation rule and the `CONTRIBUTING.md` state checklist.

- [ ] **Step 1: Implement `SpeakingDot`**

```tsx
// tauri-client/overlay-ui/src/components/SpeakingDot.tsx
import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md#leaf-isolation. Takes only
 * `participantId` — never a composed participant object — so a participant re-renders only
 * when their own speaking state flips.
 */
export const SpeakingDot = memo(function SpeakingDot({
  participantId,
}: {
  participantId: string;
}) {
  const speaking = useIsSpeaking(participantId);
  return (
    <span className={speaking ? 'vtt-speaking-dot vtt-speaking-dot-active' : 'vtt-speaking-dot'} />
  );
});
```

- [ ] **Step 2: Implement `ParticipantRow`**

```tsx
// tauri-client/overlay-ui/src/components/ParticipantRow.tsx
import { memo } from 'react';

import { SpeakingDot } from './SpeakingDot.js';

/**
 * Renders one participant's identity plus their `SpeakingDot`. Still a raw `ddbUserId` string
 * in 3a — 3b enriches this with a real character name once DDB extraction exists.
 */
export const ParticipantRow = memo(function ParticipantRow({ identity }: { identity: string }) {
  return (
    <li className="vtt-participant-row">
      <SpeakingDot participantId={identity} />
      <span>{identity}</span>
    </li>
  );
});
```

- [ ] **Step 3: Add the barrel exports**

Edit `tauri-client/overlay-ui/src/components/index.ts`:

```ts
export * from './ConnectionStatus.js';
export * from './MicrophoneStatus.js';
export * from './MuteButton.js';
export * from './OverlayRoot.js';
export * from './ParticipantList.js';
export * from './ParticipantRow.js';
export * from './SpeakingDot.js';
```

- [ ] **Step 4: Style the row and the dot**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-participant-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.vtt-speaking-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #444c56;
}

.vtt-speaking-dot-active {
  background: #7ee787;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/components/SpeakingDot.tsx tauri-client/overlay-ui/src/components/ParticipantRow.tsx \
        tauri-client/overlay-ui/src/components/index.ts tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add leaf-isolated SpeakingDot and ParticipantRow"
```

---

## Task 13: `ParticipantList` renders `ParticipantRow`

**Files:**
- Modify: `tauri-client/overlay-ui/src/components/ParticipantList.tsx`

**Interfaces:**
- Consumes: `ParticipantRow` (Task 12).

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/ParticipantList.tsx
import { memo } from 'react';

import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';
import { ParticipantRow } from './ParticipantRow.js';

/** Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — subscribes to one field only. */
export const ParticipantList = memo(function ParticipantList() {
  const participantIdentities = useParticipantIdentities();

  if (participantIdentities.length === 0) {
    return <div className="vtt-participants-empty">No one else here yet</div>;
  }

  return (
    <ul className="vtt-participants">
      {participantIdentities.map((identity) => (
        <ParticipantRow key={identity} identity={identity} />
      ))}
    </ul>
  );
});
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/components/ParticipantList.tsx
git commit -m "feat(overlay-ui): render ParticipantRow per identity in ParticipantList"
```

---

## Task 14: `FullPanel` + `MicPill`

**Files:**
- Create: `tauri-client/overlay-ui/src/components/FullPanel.tsx`
- Create: `tauri-client/overlay-ui/src/components/MicPill.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`

**Interfaces:**
- Consumes: `ConnectionStatus`, `MicrophoneStatus`, `MuteButton`, `ParticipantList` (existing/Task 11).
- Produces: `export function FullPanel()`, `export function MicPill()`. Task 15 (`OverlayRoot`) consumes both.

Implements the composition in design §4.

- [ ] **Step 1: Implement `FullPanel`**

```tsx
// tauri-client/overlay-ui/src/components/FullPanel.tsx
import { ConnectionStatus } from './ConnectionStatus.js';
import { MicrophoneStatus } from './MicrophoneStatus.js';
import { MuteButton } from './MuteButton.js';
import { ParticipantList } from './ParticipantList.js';

/** The overlay's full mode — Maps VTT pages, or anywhere with the "overlay everywhere" debug
 * flag set. See the Stage 3a design §1. */
export function FullPanel() {
  return (
    <>
      <ConnectionStatus />
      <MicrophoneStatus />
      <MuteButton />
      <ParticipantList />
    </>
  );
}
```

- [ ] **Step 2: Implement `MicPill`**

```tsx
// tauri-client/overlay-ui/src/components/MicPill.tsx
import { MicrophoneStatus } from './MicrophoneStatus.js';
import { MuteButton } from './MuteButton.js';

/** The overlay's pill mode — non-Maps allowed DDB pages, so a player mid-session isn't left
 * without mute or mic-state feedback while push-to-talk stays app-focused-only. See the
 * Stage 3a design §1, "Why a pill instead of nothing off-Maps". */
export function MicPill() {
  return (
    <>
      <MicrophoneStatus />
      <MuteButton />
    </>
  );
}
```

- [ ] **Step 3: Add the barrel exports**

Edit `tauri-client/overlay-ui/src/components/index.ts`:

```ts
export * from './ConnectionStatus.js';
export * from './FullPanel.js';
export * from './MicPill.js';
export * from './MicrophoneStatus.js';
export * from './MuteButton.js';
export * from './OverlayRoot.js';
export * from './ParticipantList.js';
export * from './ParticipantRow.js';
export * from './SpeakingDot.js';
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/components/FullPanel.tsx tauri-client/overlay-ui/src/components/MicPill.tsx \
        tauri-client/overlay-ui/src/components/index.ts
git commit -m "feat(overlay-ui): add FullPanel and MicPill compositions"
```

---

## Task 15: `OverlayRoot` chooses `FullPanel`/`MicPill` via `usePageMode`

**Files:**
- Modify: `tauri-client/overlay-ui/src/components/OverlayRoot.tsx`

**Interfaces:**
- Consumes: `usePageMode` (Task 6), `FullPanel`, `MicPill` (Task 14).

This closes out the design's component tree (§4) and its page-classification requirement (§1).

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/OverlayRoot.tsx
import { useOverlayBridge } from '../hooks/useOverlayBridge.js';
import { useOverlayVisible } from '../hooks/useOverlayVisible.js';
import { usePageMode } from '../hooks/usePageMode.js';
import { FullPanel } from './FullPanel.js';
import { MicPill } from './MicPill.js';

export function OverlayRoot() {
  // Called before the visibility check on purpose: the bridge owns the Tauri event listeners,
  // including the `overlay:toggle` one that makes the overlay visible again. Unmounting it while
  // hidden would leave nothing listening for the key that brings it back — and would tear down
  // the LiveKit session wiring along with it.
  useOverlayBridge();
  const visible = useOverlayVisible();
  const mode = usePageMode();

  if (!visible) return null;

  return <div className="vtt-overlay">{mode === 'full' ? <FullPanel /> : <MicPill />}</div>;
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — full suite (12 tests: 3 microphoneStore + 5 pageMode + 4 speakingStore).

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS — produces `dist/overlay.js`.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/components/OverlayRoot.tsx
git commit -m "feat(overlay-ui): mount FullPanel or MicPill based on usePageMode"
```

---

## Task 16: Wire `npm test` into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the root `test` script (Task 1, Step 6).

Per design §7: "wired into CI alongside the existing lint/typecheck/build steps."

- [ ] **Step 1: Add the CI step**

Edit `.github/workflows/ci.yml`, in the `typescript` job:

```yaml
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm run build
      - run: npm test
```

- [ ] **Step 2: Verify locally**

Run: `npm test`
Expected: PASS — 12 tests (matches Task 15's local run; CI exercises the same script).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run npm test in the TypeScript CI job"
```

---

## Task 17: Docs + final full verification

**Files:**
- Modify: `ROADMAP.md`
- Modify: `CONTRIBUTING.md`
- Modify: `DEVELOPING.md`
- Modify: `tauri-client/overlay-ui/README.md`

Per CLAUDE.md §17: update docs in the same change as the code they describe, not batched for later. This task closes that out for Stage 3a specifically (§16 already established the pattern of updating `ROADMAP.md`/`CONTRIBUTING.md` inline with a stage's implementation, as Stage 2's entry shows).

- [ ] **Step 1: Update `ROADMAP.md`'s Stage 3 section**

Edit the Stage 3 table row for 3a and the "Deliverables" list. Replace:

```markdown
| **3a** | Page-scoped overlay mounting, speaking indicators, voice controls, churn diagnostics wired up — [design](docs/superpowers/specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md) | ⚪ Not Started |
```

with:

```markdown
| **3a** | Page-scoped overlay mounting, speaking indicators, voice controls, churn diagnostics wired up — [design](docs/superpowers/specs/2026-08-11-stage-3a-overlay-shell-voice-ui-design.md), [plan](docs/superpowers/plans/2026-08-11-stage-3a-overlay-shell-voice-ui-plan.md) | 🟡 In Progress — implemented and building clean; manual in-app verification outstanding (see below) |
```

Then, after the existing "Known risk carried in from Stage 3's ROADMAP notes" section, add:

```markdown
**3a implemented, manual verification outstanding.** `classifyPage`/`usePageMode`, `speakingStore`, the `livekit:speakers` event (Rust: new `RoomEvent::ActiveSpeakersChanged` arm and `SpeakersChangeCallback`; relayed by `src-tauri`), `MuteButton`/`set_microphone_muted` (sharing its apply/emit path with the hotkey handler), and the `FullPanel`/`MicPill` split are all in place, Vitest-covered where the design specifies (`classifyPage`, `speakingStore.applySpeakers`, `microphoneStore.applyMuted`), and pass `cargo fmt`/`clippy`/`build`/`test` and `npm run lint`/`format:check`/`typecheck`/`build`/`test`. **Not yet verified (manual, needs a real session):** the overlay actually renders as a pill on a character sheet and a full panel on a real Maps VTT page; the `/games/<id>` pattern matches a real Maps URL; whether DDB routes Maps client-side (making the SPA-navigation subscription load-bearing) or hard-navigates; speaking dots lighting up for the correct participant during a two-party call; the mute button and Right Ctrl agreeing on mic state; the debug flag forcing the full panel off-Maps; and whether LiveKit's server-side active-speaker throttling needs a client-side cap (design §2 — add one at the Rust emit site only if observed firing faster than ~10Hz).
```

- [ ] **Step 2: Update `CONTRIBUTING.md`'s PR-testing note**

Edit `CONTRIBUTING.md`, in "Pull Requests":

```markdown
- Note any manual testing you did (this project doesn't have a full test suite yet — call out what you verified by hand).
```

replace with:

```markdown
- Run `npm test` for any change touching `overlay-ui/` (or another workspace with a `test` script) and note any manual testing you did beyond that — most modules still don't have automated coverage, so call out what you verified by hand.
```

- [ ] **Step 3: Update `DEVELOPING.md`'s Code Style section**

Edit `DEVELOPING.md`:

```markdown
- TypeScript: ESLint + Prettier + EditorConfig (`npm run lint`, `npm run format` at the root).
- Rust: `cargo fmt` and `cargo clippy` inside `tauri-client/`.
```

replace with:

```markdown
- TypeScript: ESLint + Prettier + EditorConfig (`npm run lint`, `npm run format` at the root). `npm test` runs Vitest for any workspace that has tests (currently `overlay-ui` only).
- Rust: `cargo fmt` and `cargo clippy` inside `tauri-client/`.
```

- [ ] **Step 4: Update `overlay-ui/README.md`'s status line**

Edit `tauri-client/overlay-ui/README.md`:

```markdown
**Status:** Stage 1 subset implemented — minimal Shadow DOM root (`ConnectionStatus` + `ParticipantList`, leaf-isolated per [STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md)), built via Vite into a single injectable `dist/overlay.js`. Voice controls, group selector, chat, and DM controls are Stage 3.
```

replace with:

```markdown
**Status:** Stage 3a implemented (manual verification outstanding — see [ROADMAP.md](../../ROADMAP.md#stage-3--overlay-ui-ddb-extraction--chat)). Page-scoped Shadow DOM root — `FullPanel` (Maps VTT: `ConnectionStatus`, `MicrophoneStatus`, `MuteButton`, `ParticipantList` with per-row `SpeakingDot`) or `MicPill` (everywhere else allowed) chosen by `usePageMode()`, all leaf-isolated per [STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md). Built via Vite into a single injectable `dist/overlay.js`, tested via Vitest. Group selector moved to Stage 4; chat and DDB DOM extraction are 3b/3c.
```

- [ ] **Step 5: Run the full verification suite**

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS — 12 tests.

Run (from `tauri-client/`): `cargo fmt --all -- --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo build --workspace --all-targets && cargo test --all`
Expected: PASS — fmt clean, clippy clean, build clean, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md CONTRIBUTING.md DEVELOPING.md tauri-client/overlay-ui/README.md
git commit -m "docs: mark Stage 3a implemented, pending manual in-app verification"
```

---

## After This Plan

Manual verification (a real DDB session, ideally on the animated-map-affected Linux hardware to also probe the known WebKitGTK risk) closes out Stage 3a per the "Not yet verified" note added in Task 17. Once verified, flip `ROADMAP.md`'s 3a status to 🟢 Done and update the note. 3b (DDB DOM extraction) and 3c (chat, refresh recovery, reconnect/replay) are independent follow-on plans — 3b has no dependency on this plan's output beyond Stage 2; 3c depends on this plan's `speakingStore`/leaf-isolation pattern as a template plus the still-open chat-transport decision named in the Stage 3a design.
