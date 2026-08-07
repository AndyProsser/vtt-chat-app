# Stage 1 Two-Party Voice Testing: Dedicated Dev VM Pattern + Dev-Mode Fake Identity

**Date:** 2026-08-07
**Status:** Approved
**Stage:** Stage 1 (Walking Skeleton) — closes the remaining "two instances hear each other" done-when bar in [ROADMAP.md](../../../ROADMAP.md#stage-1--walking-skeleton-auth--voice-end-to-end)

## Problem

Stage 1's done-when bar requires two app instances, logged into DDB as two different users in the same campaign, hearing each other over LiveKit. Two things currently block that:

1. **Only one real DDB account exists.** There's no way to run a second real identity through the cobalt-cookie → JWT → Character Service pipeline without creating a second DDB account.
2. **The dev backend/LiveKit stack is hardcoded to `localhost`.** `overlay-ui`'s `BACKEND_SESSION_URL` and `DEVELOPING.md`'s instructions both assume everything runs on one machine, so there's no way to have a shared, persistent target that survives across app relaunches or is reachable from more than one machine.

Separately, CLAUDE.md §4 mandates native (non-Docker) services for the backend stack. Installing Postgres/Redis/LiveKit directly on a contributor's daily-driver machine is a reasonable thing to want to avoid, even in dev.

## Goals

- Let one developer run two app instances that actually join the same LiveKit room and hear each other, without a second DDB account.
- Give contributors an optional, host-agnostic pattern for running dev-mode backend services on a disposable VM instead of their local machine.
- Keep the dev-identity bypass structurally impossible to ship in a release build.

## Non-goals

- A UI toggle for fake identity, or making it work in release builds — this is a throwaway dev tool.
- Any Stage 5 infra (Postgres, Redis, Caddy, systemd install script, status page). The VM pattern here is deliberately minimal: LiveKit + backend only.
- A specific VM/hypervisor recommendation. Any contributor's disposable Ubuntu Server VM works — local (VirtualBox, UTM, multipass, libvirt) or remote (homelab, cloud). Real host details are always personal to whoever's dev environment it is and never belong in this repo.

## Design

### 1. Optional dedicated dev VM (`DEVELOPING.md`)

A new "Optional: Dedicated Dev VM" section, host-agnostic throughout (`<your-vm-host>` placeholders, never a real hostname/IP):

- **Rationale:** avoid installing Postgres/Redis/LiveKit natively on your own machine; a disposable VM gives you the same native-services setup CLAUDE.md §4 requires without touching your daily driver.
- **SSH key access:** generate a key pair if you don't have one (`ssh-keygen -t ed25519`), copy it to the VM (`ssh-copy-id user@<your-vm-host>`), confirm passwordless login works, and — recommended once confirmed — disable `PasswordAuthentication` in the VM's `sshd_config` and reload `sshd`. This is about not typing a password every time you redeploy, not about hardening a production box.
- **Install:** LiveKit server (native binary) and Node.js (version matching the root `package.json` engines field) on the VM.
- **Run:** each as a systemd unit (`livekit-dev.service`, `vtt-backend-dev.service`), using the same dev key/secret (`devkey`/`secret`) `backend/src/lib/config.ts` already falls back to when `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` aren't set, and `livekit-server`'s `--dev` mode bound to `0.0.0.0` so it's LAN-reachable (not just loopback). No Postgres/Redis/Caddy — `backend/`'s Stage 1 code has no dependency on either yet.
- **Firewall:** if `ufw` is active, allow backend (`4000/tcp`) and LiveKit (`7880-7882/tcp+udp`) from the VM's LAN subnet only, not `0.0.0.0/0`.
- **Point the client at it:** covered in §2 below.

### 2. Config wiring (`overlay-ui`)

`tauri-client/overlay-ui/src/consts/index.ts` currently hardcodes:

```ts
export const BACKEND_SESSION_URL = 'http://localhost:4000/api/session';
```

Change to a build-time env var with the same default:

```ts
export const BACKEND_SESSION_URL =
  import.meta.env.VITE_BACKEND_SESSION_URL ?? 'http://localhost:4000/api/session';
```

To target a dev VM: `VITE_BACKEND_SESSION_URL=http://<your-vm-host>:4000/api/session npm run build` in `overlay-ui/`, then relaunch the Tauri app — same "rebuild overlay, relaunch app" workflow already documented in `DEVELOPING.md` for any overlay change. No change needed to LiveKit URL wiring: it already flows dynamically from the backend's session response (`SessionResponse.liveKit.url`, sourced from `config.liveKitUrl` in `backend/src/lib/config.ts`), so once the deployed backend's `LIVEKIT_URL` env var points at the VM's LiveKit instance, the client picks it up automatically without any overlay-side change.

### 3. Dev-mode fake identity

Room membership is keyed by `identity.campaign.id` (`backend/src/lib/app.ts:29` uses it as the LiveKit `roomName`), so a second participant must present a `DdbIdentity` whose `campaign.id` matches whatever real campaign the first (real) instance is actually in that session. Everything else about the fake identity is free-form — it never touches DDB.

**Trigger:** a new env var, `VTT_DEV_FAKE_IDENTITY=<realCampaignId>`, read once at `src-tauri` startup.

**Gating:** the entire code path is wrapped in `#[cfg(debug_assertions)]` in `tauri-client/src-tauri/src/lib.rs` / a new `dev.rs` module — structurally compiled out of `--release` builds. Reading the env var is itself inside that `cfg` block, so even setting it in a release build has no effect; it's not merely "ignored by default," the code doesn't exist.

**Behavior when set:**

- `src-tauri` skips `cobalt::spawn_cobalt_cookie_watcher` and instead emits a one-shot `dev:fake-identity` event carrying a `DdbIdentity`-shaped payload (the same shared type real identities use, from `shared/src/types/ddb.ts`) built from the env var plus hardcoded placeholder values:

  ```rust
  DdbIdentity {
      ddb_user_id: "dev-fake-user",
      selected_character: { id: "dev-fake-character", name: "Dev Test Bot", campaign_id: <env value> },
      campaign: { id: <env value>, name: "Dev Test Campaign", dm_user_id: "dev-fake-dm" },
      is_dm: false,
  }
  ```

  Serialized with `#[serde(rename_all = "camelCase")]` (matching the existing `LiveKitStatePayload` pattern in `commands.rs`) so the emitted JSON matches `DdbIdentity`'s camelCase fields on the TS side.
- `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts` gains a second listener, `onDevFakeIdentity` (new export in `tauriBridge.ts`, mirroring `onCobaltCookieDetected`), that receives the `DdbIdentity` directly and calls `requestSession` + `connectLiveKit` — skipping `extractDdbIdentity`/`ddb/` entirely, since there's no cookie to exchange. Everything downstream (backend session issuance, LiveKit token minting, room join) is the real code path real identities use; only the DDB-auth step is replaced.
- When `VTT_DEV_FAKE_IDENTITY` is unset (the default, including all release builds), behavior is unchanged from today.

**Usage:** launch your real app against your real DDB account as usual, note its actual campaign ID (visible in the overlay once connected, or logged), then launch a second instance with `VTT_DEV_FAKE_IDENTITY=<that campaign ID> cargo run --bin vtt-chat-app`. Both should land in the same LiveKit room; the overlay's participant list and audio confirm it.

## Testing

- Manual: run one real instance + one fake-identity instance locally, confirm both appear in each other's participant list and audio round-trips.
- Manual: repeat pointed at a dev VM instead of localhost, confirming the `VITE_BACKEND_SESSION_URL` override works end-to-end.
- No new automated tests — this is dev tooling, not shipped behavior. `cargo build --release` should be checked to confirm the fake-identity code and its env var read are absent from the binary (e.g. `strings` check for `VTT_DEV_FAKE_IDENTITY` in the release binary, or simply trust `#[cfg(debug_assertions)]` — Rust's own compilation guarantee).

## Docs to update

- `DEVELOPING.md` — new "Optional: Dedicated Dev VM" section (§1 above), plus a short note under "Running Stage 1 Locally" pointing at `VTT_DEV_FAKE_IDENTITY` for two-party testing without a second DDB account.
- `ROADMAP.md` — Stage 1's "Native LiveKit server running in dev mode" deliverable can flip to 🟢 once this lands and is verified; the done-when bar's "two instances... hear each other" note can reference the fake-identity path as the supported way to verify it without a second DDB account.
- No change to `CLAUDE.md` — this is dev tooling, not a shift in architecture or requirements.
