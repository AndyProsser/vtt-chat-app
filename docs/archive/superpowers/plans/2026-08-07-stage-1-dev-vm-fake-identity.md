# Stage 1 Closeout: Dev VM Pattern + Dev-Mode Fake Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last open Stage 1 deliverable in [ROADMAP.md](../../../ROADMAP.md) — "Native LiveKit server running in dev mode" — by implementing the approved design in [docs/superpowers/specs/2026-08-07-dev-vm-and-fake-identity-design.md](../specs/2026-08-07-dev-vm-and-fake-identity-design.md): a build-time-configurable backend URL, a `#[cfg(debug_assertions)]`-gated dev-only fake-identity bypass, and host-agnostic dev-VM docs, so two app instances can join the same LiveKit room without a second real DDB account.

**Architecture:** Three independent slices of the same design spec — (1) `overlay-ui` reads its backend URL from a Vite build-time env var instead of a hardcoded constant, (2) `src-tauri` gains a `dev`-only module that, when `VTT_DEV_FAKE_IDENTITY=<campaignId>` is set, emits a synthetic `DdbIdentity`-shaped event instead of starting the real cobalt-cookie watcher, and `overlay-ui` listens for it and feeds it into the exact same session/LiveKit-connect path real identities use, and (3) `DEVELOPING.md` documents the optional dedicated dev-VM pattern, host-agnostically. No new runtime dependencies. No test framework is being introduced — this repo currently verifies TS via `tsc --noEmit`/ESLint/build and Rust via `cargo fmt`/`clippy`/`cargo build` (see `ROADMAP.md`'s "Verified locally" notes for Stage 0 and Stage 1); each task's steps use those same tools plus the manual checks the design doc itself specifies for behavior a compiler can't verify (event wiring, release-binary exclusion).

**Tech Stack:** Rust (`tauri`, `serde`/`serde_json`, already deps of `src-tauri`), TypeScript (`overlay-ui`, Vite `import.meta.env`), Markdown docs.

## Global Constraints

- The dev-mode fake-identity code path must be structurally absent from `--release` builds — wrapped in `#[cfg(debug_assertions)]`, not just an early return (per the design's "Gating" section).
- No real VM hostname, IP, or personal infrastructure detail may appear anywhere in the repo — `DEVELOPING.md` uses `<your-vm-host>` placeholders throughout (per the design's "Non-goals" and CLAUDE.md's general docs discipline).
- `DdbIdentity` and its nested types are defined once in `shared/src/types/ddb.ts`; the Rust-side fake identity is a separate serde struct (Rust can't import the TS type — CLAUDE.md §3 confines Rust to `tauri-client/`) but its field names and `camelCase` serialization must match exactly, the same pattern `commands.rs`'s `LiveKitStatePayload` already uses.
- No feature-flag UI, no release-build behavior change — this is dev tooling only (per the design's "Non-goals").
- Follow the per-module folder convention (CLAUDE.md §3) — no new folders needed here, all changes land in existing `lib/`, `hooks/`, and crate-root locations already in use.

---

### Task 1: `overlay-ui` — build-time-configurable backend session URL

**Files:**
- Modify: `tauri-client/overlay-ui/src/consts/index.ts`

**Interfaces:**
- Produces: `BACKEND_SESSION_URL` (unchanged export name and type — `string`), now sourced from `import.meta.env.VITE_BACKEND_SESSION_URL` at build time, falling back to today's hardcoded value. No consumer (`backendClient.ts`) needs to change.

- [ ] **Step 1: Change the constant to read from the Vite env var**

Replace the entire contents of `tauri-client/overlay-ui/src/consts/index.ts`:

```ts
// Vite inlines `import.meta.env.VITE_*` at build time — see DEVELOPING.md's "Optional: Dedicated
// Dev VM" section for how to point a build at a non-localhost backend
// (`VITE_BACKEND_SESSION_URL=http://<your-vm-host>:4000/api/session npm run build`).
export const BACKEND_SESSION_URL =
  (import.meta.env.VITE_BACKEND_SESSION_URL as string | undefined) ??
  'http://localhost:4000/api/session';
```

- [ ] **Step 2: Typecheck**

Run: `cd tauri-client/overlay-ui && npm run typecheck`
Expected: passes with no errors. (`import.meta.env` is already typed via `vite/client` in `vite-env.d.ts`; the `as string | undefined` cast avoids introducing an implicit `any` that `@typescript-eslint/no-explicit-any` would otherwise leave unflagged but sloppy.)

- [ ] **Step 3: Lint**

Run: `npm run lint` (from repo root, or `cd tauri-client/overlay-ui && npx eslint src`)
Expected: no new errors.

- [ ] **Step 4: Build with the default (no env var set) and confirm the fallback still works**

Run: `cd tauri-client/overlay-ui && npm run build`
Then: `grep -o "http://localhost:4000/api/session" dist/overlay.js`
Expected: build succeeds, and the default URL string is present in the built bundle (confirms the `??` fallback compiled in, unchanged from today's behavior when no env var is set).

- [ ] **Step 5: Build with the env var set and confirm it's picked up**

Run: `cd tauri-client/overlay-ui && VITE_BACKEND_SESSION_URL=http://example-dev-vm:4000/api/session npm run build`
Then: `grep -o "http://example-dev-vm:4000/api/session" dist/overlay.js`
Expected: the overridden URL appears in the built bundle. Afterwards, rebuild once more with no env var (`npm run build`) to leave `dist/` in its default state for later tasks/manual testing.

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/consts/index.ts
git commit -m "feat(overlay-ui): read backend session URL from VITE_BACKEND_SESSION_URL at build time"
```

---

### Task 2: `src-tauri` — dev-only fake-identity module

**Files:**
- Create: `tauri-client/src-tauri/src/dev.rs`
- Modify: `tauri-client/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `tauri::AppHandle` (already used throughout `lib.rs`/`cobalt.rs`/`commands.rs`).
- Produces: `dev::try_spawn_fake_identity(app: &AppHandle) -> bool` — emits a one-shot `dev:fake-identity` Tauri event (payload shape below) and returns `true` if `VTT_DEV_FAKE_IDENTITY` is set; returns `false` (no emit) otherwise. Only compiled when `debug_assertions` is on. Event payload matches `DdbIdentity` from `shared/src/types/ddb.ts` (`ddbUserId`, `selectedCharacter: { id, name, campaignId }`, `campaign: { id, name, dmUserId }`, `isDm`) via `#[serde(rename_all = "camelCase")]` on Rust structs named `DevFakeIdentity`/`DevFakeCharacter`/`DevFakeCampaign` — consumed by Task 3's `onDevFakeIdentity` in `tauriBridge.ts`, which types the event payload as `DdbIdentity`.

- [ ] **Step 1: Create `dev.rs`**

```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Env var read once at startup; when set, its value becomes `campaign.id` for a synthetic
/// identity (LiveKit room membership is keyed by `campaign.id` — see
/// docs/superpowers/specs/2026-08-07-dev-vm-and-fake-identity-design.md), letting a second app
/// instance join the same room as a real logged-in instance without a second DDB account.
const DEV_FAKE_IDENTITY_ENV_VAR: &str = "VTT_DEV_FAKE_IDENTITY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFakeCharacter {
    id: String,
    name: String,
    campaign_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFakeCampaign {
    id: String,
    name: String,
    dm_user_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFakeIdentity {
    ddb_user_id: String,
    selected_character: DevFakeCharacter,
    campaign: DevFakeCampaign,
    is_dm: bool,
}

/// If `VTT_DEV_FAKE_IDENTITY` is set, emits a one-shot `dev:fake-identity` event carrying a
/// `DdbIdentity`-shaped payload (see `shared/src/types/ddb.ts`) built from the env var plus
/// hardcoded placeholder values, and returns `true`. Returns `false` (no-op, nothing emitted) if
/// the env var is unset — the caller falls back to the real cobalt-cookie watcher in that case.
pub fn try_spawn_fake_identity(app: &AppHandle) -> bool {
    let Ok(campaign_id) = std::env::var(DEV_FAKE_IDENTITY_ENV_VAR) else {
        return false;
    };

    let identity = DevFakeIdentity {
        ddb_user_id: "dev-fake-user".to_string(),
        selected_character: DevFakeCharacter {
            id: "dev-fake-character".to_string(),
            name: "Dev Test Bot".to_string(),
            campaign_id: campaign_id.clone(),
        },
        campaign: DevFakeCampaign {
            id: campaign_id,
            name: "Dev Test Campaign".to_string(),
            dm_user_id: "dev-fake-dm".to_string(),
        },
        is_dm: false,
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("dev:fake-identity", identity);
    }

    true
}
```

- [ ] **Step 2: Wire the module into `lib.rs`, gated to debug builds**

In `tauri-client/src-tauri/src/lib.rs`, change the top module declarations from:

```rust
mod cobalt;
mod commands;
mod consts;
```

to:

```rust
mod cobalt;
mod commands;
mod consts;
#[cfg(debug_assertions)]
mod dev;
```

Then add this helper function above `pub fn run()` (it always exists — in release builds its body is just `false`, so nothing about its *presence* depends on `debug_assertions`, only its behavior does, keeping `mod dev`'s absence from a release binary self-contained to that one line above):

```rust
/// Dispatches to `dev::try_spawn_fake_identity` in debug builds only; always `false` in release
/// builds, where the `dev` module doesn't exist at all (see `#[cfg(debug_assertions)] mod dev;`
/// above). `_app` is unused in release builds, hence the leading underscore.
fn spawn_fake_identity_if_configured(_app: &tauri::AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        return dev::try_spawn_fake_identity(_app);
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}
```

Finally, in the `.setup(|app| { ... })` closure, change:

```rust
            builder.build()?;

            cobalt::spawn_cobalt_cookie_watcher(app.handle().clone());

            Ok(())
```

to:

```rust
            builder.build()?;

            if !spawn_fake_identity_if_configured(app.handle()) {
                cobalt::spawn_cobalt_cookie_watcher(app.handle().clone());
            }

            Ok(())
```

- [ ] **Step 3: Format and lint**

Run: `cd tauri-client && cargo fmt --all -- --check`
Expected: passes (run `cargo fmt --all` first if it doesn't, then re-check).

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: no warnings/errors.

- [ ] **Step 4: Debug build compiles**

Run: `cd tauri-client && cargo build`
Expected: succeeds. This is a debug build, so `dev` module and the fake-identity path are compiled in.

- [ ] **Step 5: Release build compiles and excludes the fake-identity path**

Run: `cd tauri-client && cargo build --release`
Expected: succeeds.

Then confirm the env var name is structurally absent from the release binary (Linux/macOS; on Windows use a hex editor or skip — the `#[cfg(debug_assertions)]` guarantee is the real proof, this is just a spot-check):

Run: `strings target/release/vtt-chat-app | grep VTT_DEV_FAKE_IDENTITY`
Expected: no output (grep finds nothing) — confirms the string, and therefore the code path, isn't in the release binary.

- [ ] **Step 6: Manual smoke test of the emit path**

Run: `cd tauri-client && VTT_DEV_FAKE_IDENTITY=smoke-test-campaign cargo run --bin vtt-chat-app`
Expected: app launches, opens on DDB as usual (the fake identity replaces the cobalt-cookie *watcher*, not the WebView navigation). No crash. Full end-to-end confirmation (overlay actually reacting to the event) happens in Task 3's manual test, since nothing listens for `dev:fake-identity` yet at this point — this step only confirms `try_spawn_fake_identity` doesn't panic or fail to emit.

- [ ] **Step 7: Commit**

```bash
git add tauri-client/src-tauri/src/dev.rs tauri-client/src-tauri/src/lib.rs
git commit -m "feat(src-tauri): add debug-only VTT_DEV_FAKE_IDENTITY bypass for two-party dev testing"
```

---

### Task 3: `overlay-ui` — listen for `dev:fake-identity` and reuse the session pipeline

**Files:**
- Modify: `tauri-client/overlay-ui/src/lib/tauriBridge.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`

**Interfaces:**
- Consumes: `dev:fake-identity` Tauri event from Task 2, payload typed as `DdbIdentity` (from `@vtt-chat-app/shared`); `requestSession` (`backendClient.ts`, unchanged signature `(identity: DdbIdentity) => Promise<SessionResponse>`); `connectLiveKit` (`tauriBridge.ts`, unchanged).
- Produces: `onDevFakeIdentity(handler: (identity: DdbIdentity) => void): Promise<UnlistenFn>` — new export from `tauriBridge.ts`, mirrors the existing `onCobaltCookieDetected` shape exactly.

- [ ] **Step 1: Add `onDevFakeIdentity` to `tauriBridge.ts`**

Replace the top import line and add the new function. Full new contents of `tauri-client/overlay-ui/src/lib/tauriBridge.ts`:

```ts
import type {
  CobaltCookieDetectedPayload,
  DdbIdentity,
  LiveKitConnectionState,
} from '@vtt-chat-app/shared';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function onCobaltCookieDetected(
  handler: (payload: CobaltCookieDetectedPayload) => void,
): Promise<UnlistenFn> {
  return listen<CobaltCookieDetectedPayload>('ddb:cobalt-cookie', (event) =>
    handler(event.payload),
  );
}

/**
 * Listens for the dev-only `dev:fake-identity` event, emitted by `src-tauri` exclusively when
 * `VTT_DEV_FAKE_IDENTITY` is set in a debug build (never in release — see
 * docs/superpowers/specs/2026-08-07-dev-vm-and-fake-identity-design.md). Payload is a real
 * `DdbIdentity`, so callers feed it into the same session/connect path `onCobaltCookieDetected`
 * ultimately does, just skipping DDB extraction.
 */
export function onDevFakeIdentity(
  handler: (identity: DdbIdentity) => void,
): Promise<UnlistenFn> {
  return listen<DdbIdentity>('dev:fake-identity', (event) => handler(event.payload));
}

export function onLiveKitState(
  handler: (state: LiveKitConnectionState) => void,
): Promise<UnlistenFn> {
  return listen<LiveKitConnectionState>('livekit:state', (event) => handler(event.payload));
}

export function connectLiveKit(url: string, token: string): Promise<void> {
  return invoke('livekit_connect', { url, token });
}

export function disconnectLiveKit(): Promise<void> {
  return invoke('livekit_disconnect');
}
```

- [ ] **Step 2: Wire it into `useOverlayBridge.ts`, factoring out the shared session/connect call**

Replace the full contents of `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`:

```ts
import { extractDdbIdentity } from '@vtt-chat-app/ddb';
import type { DdbIdentity } from '@vtt-chat-app/shared';
import { useEffect } from 'react';

import { requestSession } from '../lib/backendClient.js';
import { useLiveKitStore } from '../lib/store.js';
import {
  connectLiveKit,
  onCobaltCookieDetected,
  onDevFakeIdentity,
  onLiveKitState,
} from '../lib/tauriBridge.js';

async function establishLiveKitSession(identity: DdbIdentity): Promise<void> {
  const session = await requestSession(identity);
  await connectLiveKit(session.liveKit.url, session.liveKit.token);
}

/**
 * Wires the whole Stage 1 pipeline: cobalt cookie event -> ddb/ identity extraction -> backend
 * session request -> rust-livekit connect, plus applying `livekit:state` events back into the
 * store. Call once from the overlay root — see docs/architecture/DDB-AUTH.md for the flow.
 *
 * Also listens for `dev:fake-identity` (debug builds only, only emitted when `src-tauri` sees
 * `VTT_DEV_FAKE_IDENTITY` set — see
 * docs/superpowers/specs/2026-08-07-dev-vm-and-fake-identity-design.md). That path skips DDB
 * extraction entirely and feeds a synthetic identity straight into the same session + connect
 * logic real identities use.
 */
export function useOverlayBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);

  useEffect(() => {
    let cancelled = false;

    const unlistenState = onLiveKitState((state) => {
      if (!cancelled) applyState(state);
    });

    const unlistenCookie = onCobaltCookieDetected(({ cookieValue }) => {
      void (async () => {
        try {
          const identity = await extractDdbIdentity(cookieValue);
          await establishLiveKitSession(identity);
        } catch (err) {
          console.error('[overlay-ui] failed to establish LiveKit session', err);
        }
      })();
    });

    const unlistenDevFakeIdentity = onDevFakeIdentity((identity) => {
      establishLiveKitSession(identity).catch((err) => {
        console.error(
          '[overlay-ui] failed to establish LiveKit session (dev fake identity)',
          err,
        );
      });
    });

    return () => {
      cancelled = true;
      void unlistenState.then((unlisten) => unlisten());
      void unlistenCookie.then((unlisten) => unlisten());
      void unlistenDevFakeIdentity.then((unlisten) => unlisten());
    };
  }, [applyState]);
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd tauri-client/overlay-ui && npm run typecheck`
Expected: passes.

Run: `npm run lint` (from repo root)
Expected: no new errors.

- [ ] **Step 4: Build the overlay bundle**

Run: `cd tauri-client/overlay-ui && npm run build`
Expected: succeeds, produces `dist/overlay.js`.

- [ ] **Step 5: Full workspace verification**

Run from repo root: `npm run lint && npm run format:check && npm run typecheck && npm run build`
Expected: all pass across every TS workspace package (matches the verification bar Stage 0/1 already record in `ROADMAP.md`).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/tauriBridge.ts tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts
git commit -m "feat(overlay-ui): wire dev:fake-identity into the session/LiveKit-connect pipeline"
```

---

### Task 4: Documentation — `DEVELOPING.md` dev-VM section + fake-identity note

**Files:**
- Modify: `DEVELOPING.md`

**Interfaces:** None (docs only).

- [ ] **Step 1: Add a note about `VTT_DEV_FAKE_IDENTITY` under "Running Stage 1 Locally"**

In `DEVELOPING.md`, immediately after the existing numbered list (steps 1–4) in the "Running Stage 1 Locally" section, insert:

```markdown
**Testing two participants without a second DDB account:** launch one real instance logged into
DDB as usual, note its campaign ID (visible in the overlay once connected, or in the terminal
log), then launch a second instance with `VTT_DEV_FAKE_IDENTITY=<that campaign ID> cargo run --bin
vtt-chat-app` from `tauri-client/`. The second instance skips DDB auth entirely and joins the same
LiveKit room as a synthetic participant — debug builds only, structurally absent from `--release`
(see `tauri-client/src-tauri/src/dev.rs`). Both instances' overlays should show each other in the
participant list, with audio round-tripping.
```

- [ ] **Step 2: Add the "Optional: Dedicated Dev VM" section**

Insert a new `##` section in `DEVELOPING.md` directly after "Running Stage 1 Locally" and before "Per-Module Setup":

```markdown
## Optional: Dedicated Dev VM

CLAUDE.md §4 mandates native (non-Docker) services. Installing Postgres/Redis/LiveKit directly on
your daily-driver machine is a reasonable thing to want to avoid even in dev — a disposable Ubuntu
Server VM (local: VirtualBox, UTM, multipass, libvirt; remote: homelab, cloud — any hypervisor
works, this repo has no opinion on which) gives you the same native-services setup without
touching your own machine. This is entirely optional; running everything on `localhost` per the
section above works fine too.

Throughout this section, `<your-vm-host>` is a placeholder — substitute your VM's actual
hostname/IP locally. **Never commit a real hostname or IP to this repo**; VM details are personal
to whoever's dev environment it is.

### SSH access

```bash
ssh-keygen -t ed25519        # skip if you already have a key pair
ssh-copy-id user@<your-vm-host>
ssh user@<your-vm-host>      # confirm passwordless login works
```

Once confirmed, it's worth disabling password auth entirely — edit `/etc/ssh/sshd_config` on the
VM, set `PasswordAuthentication no`, then `sudo systemctl reload sshd`. This is about not typing a
password on every redeploy, not about hardening a production box — don't treat this VM as one.

### Install

On the VM: LiveKit server (native binary — see [livekit/README.md](livekit/README.md)) and
Node.js matching the root `package.json`'s `engines` field.

### Run as systemd services

Two units, `livekit-dev.service` and `vtt-backend-dev.service`. Neither needs Postgres, Redis, or
Caddy — Stage 1's `backend/` code has no dependency on either yet, and this VM pattern is
deliberately minimal (Stage 5 covers the full native-Ubuntu deployment, including those services).

- LiveKit: run `livekit-server --dev --bind 0.0.0.0` so it's LAN-reachable instead of
  loopback-only. `--dev` mode prints the `devkey`/`secret` API key pair, which is also
  `backend/src/lib/config.ts`'s fallback when `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` aren't set —
  no extra config needed to match them up.
- Backend: `cd backend && npm run build && npm start`, with `LIVEKIT_URL` pointed at the VM's own
  LiveKit instance (e.g. `ws://127.0.0.1:7880` if backend and LiveKit run on the same VM).

### Firewall

If `ufw` is active on the VM, allow the backend and LiveKit ports from your LAN subnet only, not
`0.0.0.0/0`:

```bash
sudo ufw allow from <your-lan-subnet> to any port 4000 proto tcp
sudo ufw allow from <your-lan-subnet> to any port 7880:7882 proto tcp
sudo ufw allow from <your-lan-subnet> to any port 7880:7882 proto udp
```

### Point the client at it

Build the overlay against the VM's backend instead of `localhost`:

```bash
cd tauri-client/overlay-ui
VITE_BACKEND_SESSION_URL=http://<your-vm-host>:4000/api/session npm run build
```

Then relaunch the Tauri app as usual — same "rebuild overlay, relaunch app" workflow as any other
overlay change. No LiveKit URL change needed on the client side: it flows dynamically from the
backend's session response, so once the VM's backend has `LIVEKIT_URL` pointed at the VM's LiveKit
instance, the client picks it up automatically.
```

- [ ] **Step 3: Proofread against CLAUDE.md's docs discipline**

Re-read the two new sections and confirm: no real hostname/IP anywhere (only `<your-vm-host>` /
`<your-lan-subnet>` placeholders), no Postgres/Redis/Caddy mentioned as required for this VM
pattern, and the `VTT_DEV_FAKE_IDENTITY` note matches what Task 2/3 actually built (env var name,
event name, command).

- [ ] **Step 4: Commit**

```bash
git add DEVELOPING.md
git commit -m "docs: add optional dedicated dev-VM section and VTT_DEV_FAKE_IDENTITY note to DEVELOPING.md"
```

---

### Task 5: Manual two-party verification and `ROADMAP.md` closeout (requires a human — not subagent-completable)

This task cannot be delegated to a subagent: it requires actually running `livekit-server --dev`,
the built backend, and two live Tauri app instances on a real machine with real audio hardware,
which isn't available in this execution environment. Whoever runs this step should do it
themselves, not have an agent assert it passed.

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Start the dev stack**

In three separate terminals (per `DEVELOPING.md`'s "Running Stage 1 Locally"):

```bash
livekit-server --dev
cd backend && npm run build && npm start
cd tauri-client/overlay-ui && npm run build
```

- [ ] **Step 2: Launch a real instance and note its campaign ID**

```bash
cd tauri-client && cargo run --bin vtt-chat-app
```

Log into DDB in the opened window, confirm the overlay shows "connected", and note the campaign
ID it reports (overlay UI or terminal log).

- [ ] **Step 3: Launch a fake-identity instance pointed at the same campaign**

```bash
cd tauri-client && VTT_DEV_FAKE_IDENTITY=<campaign-id-from-step-2> cargo run --bin vtt-chat-app
```

- [ ] **Step 4: Confirm both sides**

Both windows' overlays should list each other in the participant list, and audio should
round-trip (speak into one instance's mic, hear it from the other's speakers). This is Stage 1's
"done when" bar from `ROADMAP.md`.

- [ ] **Step 5: Update `ROADMAP.md`**

Only after Step 4 actually passes, in `ROADMAP.md`'s Stage 1 section:

- Flip `⚪ Native LiveKit server running in dev mode — up to you locally (\`livekit-server
  --dev\`); not yet run end-to-end against the app` to `🟢`, updating the trailing clause to
  reflect what was actually verified (e.g. note the fake-identity path was used, or a second real
  DDB account, whichever applies).
- Update the "Verified locally" paragraph's "Not yet verified" list to remove the LiveKit
  connection / two-account bar, since it's now closed — but keep the DDB cobalt-token/Character
  Service field-name caveat if that specific piece (real DDB login field-name verification) is
  still unconfirmed; don't overclaim past what Step 4 actually proved.
- Flip Stage 1's `**Status:**` line from `🟡 In Progress` to `🟢 Done` only if every other Stage 1
  deliverable is also confirmed still accurate at that point.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: close out Stage 1 — dev VM + fake identity path verified end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** design doc §1 (dev VM docs) → Task 4; §2 (config wiring) → Task 1; §3 (fake
  identity, Rust + TS) → Tasks 2–3; "Testing" section → Task 5; "Docs to update" → Tasks 4 and 5
  Step 5. All covered.
- **Placeholder scan:** no TBDs; every step has literal file contents or exact commands.
- **Type consistency:** `DdbIdentity`/`DdbCharacterSummary`/`DdbCampaignSummary` field names in
  Task 2's Rust structs match `shared/src/types/ddb.ts` exactly (`ddbUserId`, `selectedCharacter`,
  `campaignId`, `campaign`, `dmUserId`, `isDm`); `onDevFakeIdentity`'s signature in Task 3 matches
  the event name and payload type Task 2 emits; `establishLiveKitSession` is defined once and used
  by both listeners in Task 3.
