# Build Status

Where the build actually stands, so the next session (or the next machine) can pick up without re-deriving it. Kept deliberately honest: **"built" is not "verified".** Update this file in the same change as the work it describes; the plan itself is in [ROADMAP.md](../ROADMAP.md) and the live threads in [.claude/intent.md](../.claude/intent.md).

- **As of:** 2026-11-05 (end of the first long build session) · **Version:** 0.2.0 · **Branch:** `main`, up to date with `origin` at `9ef6992`
- **Built on a Windows machine away from the normal dev box.** No Linux, no Postgres, no Valkey, no LiveKit server, no `ffmpeg`/`whisper.cpp`/`ollama` were available. Everything below that needs them is marked **UNVERIFIED**.

## How to check the repo is healthy

```bash
npm install
npm run lint && npm run build && npm run typecheck && npm test && npm run format:check
cd tauri-client && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

Last run, all green: **180 JS tests** (backend 146, ai 24, panels-ui 10) and **70 Rust tests** (rust-livekit 21, rust-sync 24 unit + 7 integration, src-tauri 18). Not run: anything in CI (the workflow exists, nothing has run it since the pivot).

## Status by component

Legend: 🟢 built and tested · 🟡 built, only partly verified · ⚪ not started

| Component                                                           | State | Verified how                                                             | Notes                                                                                                   |
| ------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Docs / pivot (Stage 1)                                              | 🟢    | read-through                                                             | Old design archived in `docs/archive/`                                                                  |
| Toolchain                                                           | 🟢    | CI-equivalent run locally                                                | TypeScript 7 in workspaces; root pinned to TS ~6.0 **only** for `typescript-eslint` (see DEVELOPING.md) |
| `backend` accounts, sessions, magic links                           | 🟢    | 36 unit tests                                                            | In-memory store only                                                                                    |
| `backend` campaigns, invites, characters, DM swap                   | 🟢    | unit + HTTP tests                                                        | Atomic swap tested; Postgres transaction behaviour **UNVERIFIED**                                       |
| `backend` REST (`/api/auth`, `/api/campaigns`)                      | 🟢    | 17 HTTP tests over real sockets                                          | Rate limiting, safe errors, member-only voice tokens                                                    |
| `backend` WebSocket hub (`/ws`)                                     | 🟢    | hub tests + real-socket tests + Rust client run once against it          | Presence, speaking, DM-only stats, chat, replay/snapshot, revocation                                    |
| `backend` replay buffer (memory)                                    | 🟢    | shared contract suite                                                    |                                                                                                         |
| `backend` replay buffer (Valkey)                                    | 🟡    | same contract suite, **against a fake Redis I wrote**                    | Must be re-run against a real Valkey; not wired into `index.ts`                                         |
| `backend` recording state + consent acks                            | 🟡    | unit + hub + real-socket tests; one real Rust↔Node run                   | In memory; no durable record, no Egress link                                                            |
| `backend` Postgres schema                                           | 🟡    | **not applied anywhere**                                                 | `backend/migrations/0001_init.sql`; no adapter written                                                  |
| `backend` OIDC, SMTP sender, Admin CLI, chat persistence            | ⚪    |                                                                          | CLI deliberately deferred by Andy                                                                       |
| `rust-livekit` voice client                                         | 🟡    | compiles; backoff/resume logic unit-tested; `audio_probe` run on Windows | **Never joined a real LiveKit room.** Release-on-mute measured (~4 ms mute, ~25 ms unmute)              |
| `rust-livekit` auto-rejoin / sleep-wake                             | 🟡    | pure parts unit-tested                                                   | Supervisor loop needs a live server                                                                     |
| `rust-livekit` cue player                                           | 🟡    | policy + synthesis unit-tested                                           | **Never heard on speakers** (`cargo run -p rust-livekit --example cue_demo`)                            |
| `rust-sync` WebSocket client                                        | 🟢    | 31 tests + run against the real backend                                  | Windows only                                                                                            |
| `src-tauri` consent coordinator                                     | 🟡    | 12 unit tests                                                            | Pure logic; **not driven by the shell**                                                                 |
| `src-tauri` shell (tray, windows, autostart, updater)               | ⚪    |                                                                          | Windowless today; Stage 4                                                                               |
| `panels-ui`                                                         | 🟡    | 10 unit tests                                                            | A placeholder connection panel only                                                                     |
| `ai` pipeline library                                               | 🟢    | 24 tests with fakes                                                      | Whisper JSON, merge (drops private tracks), chunking, map-reduce summaries, Ollama client               |
| `ai` `records-smoke` runner + `infra/records-smoke`                 | 🟡    | filename parsing only                                                    | **Never run on real audio**                                                                             |
| `livekit/*.dev.yaml`                                                | 🟡    | none                                                                     | Egress config unverified                                                                                |
| `web` (mobile SPA), `status` page, `infra/install.sh`, `ddb` import | ⚪    |                                                                          | Stages 7, 8, 3, 10                                                                                      |

## What has run against the real thing (not a fake)

1. The Rust sync client ↔ the real Node backend, twice: connect → auth → snapshot → audio state → chat; and the full recording-consent loop (start while connected → ack → fresh reconnect told "already acknowledged").
2. `audio_probe` on Windows 11: device enumeration, which AEC/NS/AGC are active, release/re-acquire timing. (OS mic indicator **not** eyeballed.)

Everything else is unit/integration-tested against fakes or in-memory stand-ins.

## Needs the DEV box (do these first when back)

In dependency order:

1. **Apply `backend/migrations/0001_init.sql`** to a scratch Postgres and fix what it finds. Then write the Postgres `Store` adapter and re-run the domain + HTTP tests against it.
2. **Run `replayContract.ts` against a real Valkey** (and check LiveKit server + Egress run on Valkey; check which Ubuntu LTS packages it). Then wire a `VALKEY_URL` switch into `backend/src/index.ts`.
3. **Two-machine voice test** with open mics and speakers on a real LiveKit server (use `livekit/livekit.dev.yaml`): echo, noise, CPU, latency, per-OS active AEC. Watch the OS mic indicator during `audio_probe -- 5 3000`. Then decide the playout trade-off below.
4. **Rejoin tests:** drop the network, sleep/wake the laptop mid-call; token refresh through the connect-info provider.
5. **Listen to the cues** (`cue_demo`) and judge them.
6. **Part B on a Linux server:** LiveKit + Egress + Redis/Valkey + ffmpeg + whisper.cpp + Ollama; follow [infra/records-smoke/](../infra/records-smoke/README.md). Record real-time factors for `small`/`medium` on CPU (and GPU if any) in `RECORDING-AND-SUMMARIES.md` and `DEPLOYMENT-AND-TRANSPORT.md`. The Egress config may need correcting.
7. Linux/macOS builds of `rust-livekit` and `rust-sync` (best-effort per Andy).
8. CI: push and see the workflow actually run; it has not since the pivot.

## Assumptions made without Andy's confirmation

Each is one constant or setting; change freely.

| Assumption                                                                                                                                              | Where                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Playback uses WebRTC's audio layer as-is (**no per-player gain, no soundboard mixer yet**); revisit with our own mixer only if acoustic tests demand it | `AUDIO-SPIKE-RESULTS.md`                |
| Recording-start acknowledgement expires after **30 min**                                                                                                | `backend/src/lib/recording/ackStore.ts` |
| Invite expiry **7 days**; magic link **15 min**; min password **10**; scrypt N=2^15                                                                     | `backend/src/consts/index.ts`           |
| Rate limits: 10 logins/15 min per IP+email; 10 chat msgs/10 s; 20 invite tries/15 min                                                                   | `backend/src/lib/app.ts`, `hub.ts`      |
| Replay buffer 500 events / 10 min; stats every 5 s in a voice session; idle = online/offline only                                                       | `SYNC-PROTOCOL.md`                      |
| Whisper default: CPU-only `small` (quantised), GPU `large-v3-turbo` — unmeasured                                                                        | `RECORDING-AND-SUMMARIES.md`            |
| Panel-toggle hotkey is **Ctrl+Shift+P** (was Ctrl+Shift+O)                                                                                              | `src-tauri/src/hotkeys.rs`              |
| Cues are synthesised tones; **a spoken "Session recording in progress" clip is not built** and needs an asset decision                                  | `rust-livekit/src/cue/`                 |

## Open decisions

- Purge-rule defaults for stale raw audio (next session / age / free storage) and whether the DM is warned first
- Admin quick-access screen beyond connection status (suggested: invite create/revoke + QR, device list, pending summary confirmations, storage/pipeline health)
- Mobile SPA scope · optional container bundle · server sizing (answered by the spike) · cloud-adapter seams
- Retire the two old Memory Hub records (`vtt-chat-app-architecture-and-decisions`, `vtt-chat-app-state-resilience-and-overlay-gotchas`) — waiting on Andy's review

## Next buildable without the DEV box

- Wire `rust-sync` + the consent coordinator into `src-tauri` (Stage 4): start/stop on sign-in, execute coordinator commands, gate the mic in `hotkeys::apply_microphone_mute`, forward events to panels
- Report connection stats (RTT/jitter/loss) from `rust-livekit` to feed the DM status screen
- Postgres adapter written against the `Store` interface (testable only once Postgres exists)
- Real panels in `panels-ui` (roster, mute/PTT, recording indicator, DM recording control, connection-status screen)
- Durable recording records (start/stop/pause timestamps as session bookmarks) ahead of Stage 5

## Bugs found by tests so far (and fixed)

| Found by                                      | Bug                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP test                                     | Oversize request bodies returned 500; now 413                                                                                                                                           |
| Protocol test                                 | A frame type like `constructor` resolved to an inherited property and could crash the parser; now `Object.hasOwn`                                                                       |
| Design review while writing the Valkey buffer | Sequence numbers were not scoped to a stream, so after a restart a client could be told it was caught up with a _different_ stream; streams now carry an epoch (TS hub and Rust client) |
| Probe                                         | `start_recording` fails until a recording device is selected explicitly                                                                                                                 |

## Commits this session

`5341995` pivot docs · `1a5d593` v0.2.0 + TS7/Vite8/Vitest5 · `2c64227` Stage 1 teardown · `23655e4` Stage 2 groundwork · `a1fbe3f` cue player · `e29e8a7` identity/campaign domain · `01bba47` REST + Valkey decision · `bd3c70d` WebSocket hub · `c52f610` rust-sync · `8869813` stream epoch + Valkey buffer · `9ef6992` recording-consent loop
