# Browser-Only App Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app has no sign-in form: a signed-in browser page connects it through a deep link, a QR, or a typed short code, and a hidden dev mode keeps the old forms while this is built and if deep links fail.

**Architecture:** A *link code* is a short single-use code issued to an already signed-in browser session and redeemed by the app through the existing `POST /api/auth/magic-link/redeem`. A *device request* (new, small) lets the app show a code and have a signed-in phone or browser approve it; the app polls for the session. Both end in the existing long-lived, revocable session.

**Tech Stack:** Node/Express/zod/vitest (backend, Postgres + MemoryStore), React 19 + Radix + Vite (web, panels-ui), Rust/Tauri 2/reqwest (src-tauri), `qrcode` (pure JS, SVG output) for QR rendering.

**Spec:** [docs/architecture/APP-SIGN-IN.md](../../architecture/APP-SIGN-IN.md) (approved 2026-11-11). Dev mode was added at approval time; it is specified below.

## Global Constraints

- Link/device codes: **single use, expire in 5 minutes, stored hashed, never logged, rate-limited** (`linkLimiter`).
- Typed code: **8 chars from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`** (no `I L O 0 1`), displayed `ABCD-2345`; input is case-insensitive and ignores `-` and spaces.
- The **device poll secret is separate from the user code**; the session is delivered **once**.
- Approval screen **names the device** (label + requesting IP) and requires a press of Approve.
- A deep link **never signs in by itself**: it opens the Connect screen with server and code filled; the player presses Connect (shows the server host).
- The app never sees a password, an emailed code or an SSO redirect, **except in dev mode**.
- **Wire change ⇒ MINOR bump**: `PROTOCOL_VERSION` 1 → 2 in `shared/src/consts/index.ts` and `tauri-client/src-tauri/src/consts.rs` (a test already asserts they match), release version next is `0.4.0`.
- TypeScript everywhere except `src-tauri`; per-module folders (`components/ hooks/ consts/ types/ lib/`); LF endings; ESLint + Prettier + `cargo fmt` + `clippy` clean.
- Update docs and `CHANGELOG.md` `[Unreleased]` in the same change as the code (CLAUDE.md §17).

### Dev mode (decided at approval)

`VTT_DEV_SIGNIN=1` in the app's environment (read once at start by Rust, exposed as `dev_signin_enabled`) shows a collapsed **"Developer sign-in"** block under the Connect screen holding: the old email+password form, the emailed/handed-over code box, and a **"Paste a connect link"** box (accepts a full `vtt-chat://connect?...` URL). It uses the same endpoints as before, so no server flag exists. Off by default in every build; documented in `DEVELOPING.md`. It is also the escape hatch if deep links fail on some OS during the build-out. The server-side equivalent already exists: `vtt-admin user code <email>` issues a code redeemable in the typed-code box.

## Review Focus

- Code reuse: a link code redeemed twice, or after 5 minutes, must fail (`invalid_token`), and a typed code with lower case, spaces or a hyphen must still work.
- Someone who sees the user code on the app's screen must not be able to collect the session (poll needs the secret).
- A device request approved by user A, then polled twice: the second poll gets nothing (single delivery).
- A deep link naming a hostile server must not auto-sign-in or send anything until the player presses Connect.
- Sign-in with a changed consent version (`needsConsent`) must be accepted on the web before a code is issued, not stranded in the app.
- A server below the app's protocol (426) or an unreachable server must show a plain message on the Connect screen, not a spinner forever.

---

### Task 1: Short codes and link-code issuance (backend)

**Files:**
- Modify: `backend/src/lib/auth/crypto.ts` (add `generateShortCode`, `normaliseShortCode`)
- Modify: `backend/src/types/index.ts:95` (`MagicLinkPurpose` gains `'link'`), `backend/src/consts/index.ts` (`LINK_CODE_TTL_MINUTES = 5`, `SHORT_CODE_ALPHABET`, `SHORT_CODE_LENGTH = 8`)
- Modify: `backend/src/lib/auth/accountService.ts` (`issueLinkCode`, redeem normalises short codes)
- Modify: `backend/src/lib/http/authRoutes.ts` (`POST /link-codes`, behind `auth`)
- Modify: `backend/migrations/` new `0024_link_purpose.sql` only if `magic_links.purpose` has a CHECK constraint (check `0001_init.sql`)
- Test: `backend/src/lib/auth/crypto.test.ts` (create if absent), `backend/src/lib/domain.test.ts`, `backend/src/lib/http/http.test.ts`

**Interfaces:**
- Produces: `generateShortCode(): string` (8 chars, alphabet above, no separator); `normaliseShortCode(input: string): string` (uppercase, strips `-` and whitespace); `AccountService.issueLinkCode(userId: string): Promise<{ code: string; expiresAt: number }>`; `POST /api/auth/link-codes` → `200 { code: "ABCD-2345", expiresAt }` (authenticated session required, 401 otherwise).

- [ ] **Step 1: Write failing tests**
  - `crypto.test.ts`: `generateShortCode()` is 8 chars all in the alphabet; 1000 calls are not all equal; `normaliseShortCode(' abcd-2345 ')` → `'ABCD2345'`.
  - `domain.test.ts`: `issueLinkCode` then `redeemMagicLink(normalise(code))` signs in as that user; a second redeem rejects `invalid_token`; after `clock` advances 5 min + 1 ms redeem rejects `invalid_token`; redeeming with lower case and a hyphen works.
  - `http.test.ts`: `POST /api/auth/link-codes` without a session → 401; with one → 200, body `code` matches `/^[A-Z2-9]{4}-[A-Z2-9]{4}$/`; redeeming it via `/magic-link/redeem` returns a *different* session token than the caller's and `user.id` equal.
- [ ] **Step 2: Run** `npm test -w backend -- crypto domain http` → FAIL (functions undefined).
- [ ] **Step 3: Implement** the helpers with `crypto.randomInt` per character (no modulo bias). `issueLinkCode` stores a magic link with `purpose: 'link'`, `email` of the user, `tokenHash = hashSecret(normalised)`, TTL from the constant. `redeemMagicLink` hashes `normaliseShortCode(token)` first when the input matches the short-code shape, else the raw token (emailed tokens unchanged). The route returns the code formatted `XXXX-XXXX`.
- [ ] **Step 4: Run** the same command → PASS; then `npm run lint -w backend && npm run typecheck -w backend` if those scripts exist.
- [ ] **Step 5: Commit** `feat(auth): link codes — a signed-in browser can issue a 5-minute code for the app`

### Task 2: Device requests (backend)

**Files:**
- Create: `backend/migrations/0024_device_requests.sql` (table `device_requests`: `id`, `user_code_hash`, `poll_secret_hash`, `device_label`, `request_ip`, `created_at`, `expires_at`, `approved_user_id` nullable, `delivered_at` nullable)
- Modify: `backend/src/types/index.ts` (`DeviceRequest`), `backend/src/lib/store/store.ts`, `memoryStore.ts`, `postgresStore.ts` (`putDeviceRequest`, `getDeviceRequestByCodeHash`, `getDeviceRequest(id)`, `deleteExpiredDeviceRequests(now)`), `store.contract.test.ts`
- Create: `backend/src/lib/auth/deviceFlow.ts` (service over the store; keeps `accountService.ts` from growing)
- Modify: `backend/src/lib/http/authRoutes.ts` (four routes), `backend/src/lib/app.ts` (construct and pass the service)
- Test: `backend/src/lib/auth/deviceFlow.test.ts`, `http.test.ts`

**Interfaces:**
- Consumes: `generateShortCode`, `normaliseShortCode` (Task 1), `AccountService.startSession` equivalent via a new public `accounts.signInUser(user, deviceLabel)` (expose the existing private `startSession`).
- Produces (all `application/json`):
  - `POST /api/auth/device` `{ deviceLabel?: string }` → `201 { requestId, userCode: "ABCD-2345", pollSecret, expiresAt }` (unauthenticated, `linkLimiter` by IP)
  - `GET /api/auth/device/:userCode` (authenticated) → `{ deviceLabel, requestIp, createdAt }` for the approval screen; unknown/expired → 404 `invalid_token`
  - `POST /api/auth/device/approve` `{ userCode }` (authenticated) → `204`; 404 `invalid_token` if unknown/expired/already approved
  - `POST /api/auth/device/poll` `{ requestId, pollSecret }` → `202 { pending: true }` until approved, then `200 { user, sessionToken, needsConsent }` once; afterwards and on a bad secret/expiry → `401/404 invalid_token`

- [ ] **Step 1: Write failing tests** (`deviceFlow.test.ts` + http): start → poll is pending; approve by user A → poll returns A's session once; second poll → `invalid_token`; poll with wrong secret never reveals state (same error as unknown id); approve after 5 min → `invalid_token`; the user code alone (no secret) cannot poll; approving twice → second fails; the store contract test covers both stores for the four methods.
- [ ] **Step 2: Run** `npm test -w backend -- deviceFlow store.contract http` → FAIL.
- [ ] **Step 3: Implement** `DeviceFlow` with `start`, `describe`, `approve`, `poll`; hash user code and secret with `hashSecret`, compare secrets with `equalHashes`; cleanup of expired rows in `start` (no timer). Migration is additive and idempotent per existing migration style.
- [ ] **Step 4: Run** full `npm test -w backend` → PASS; lint/typecheck.
- [ ] **Step 5: Commit** `feat(auth): device requests — the app shows a code, a signed-in browser approves it`

### Task 3: Web — keep the session after joining; Connect step

**Files:**
- Modify: `web/src/components/AccountForm.tsx` (`onJoined(token: string)`), `JoinPage.tsx`, `web/src/lib/api.ts` (stop the immediate `logout` after join; add `createLinkCode(token)`)
- Create: `web/src/components/ConnectApp.tsx` (replaces step 2 text of `GetTheApp.tsx`; props `{ token: string; server: string }`), `web/src/components/QrCode.tsx` (props `{ text: string; label: string }`, renders `qrcode` SVG), `web/src/lib/connect.ts` (`connectLink(server, code): string` → `vtt-chat://connect?server=<enc>&code=<code>`)
- Modify: `web/package.json` (add `qrcode` and `@types/qrcode`, exact versions, ≥2 weeks old)
- Test: `web/src/lib/connect.test.ts`, `web/src/components/ConnectApp.test.tsx` if a component test setup exists, else logic-only in `connect.ts`

**Interfaces:**
- Consumes: `POST /api/auth/link-codes` (Task 1).
- Produces: `connectLink(server: string, code: string): string`; `<ConnectApp token server />` shows: **Open VTT Chat** button (the deep link), the QR of the *same deep link*, the typed code in groups of four, a "New code" button (re-issues after expiry), and the OS-detected download as today. Signs the token out (`/logout`) when the page unloads or after 10 minutes.

- [ ] **Step 1: Write failing tests** for `connectLink` (encodes server, includes code, round-trips through `new URL`) and for the component's states (loading, code shown formatted `ABCD-2345`, expired → "New code").
- [ ] **Step 2: Run** `npm test -w web` → FAIL.
- [ ] **Step 3: Implement.** Light/dark via existing Radix theme; no new global styles beyond a small `connect.css` in `styles/`.
- [ ] **Step 4: Run** `npm test -w web && npm run lint -w web && npm run build -w web` → PASS.
- [ ] **Step 5: Commit** `feat(web): the join page connects the app (open link, QR, typed code)`

### Task 4: Web — `/connect` approval page

**Files:**
- Create: `web/src/components/ConnectDevicePage.tsx` (route `/connect?c=ABCD-2345`), `web/src/components/LoginForm.tsx` (email+password, plus "email me a code" when `GET /api/auth/providers` says `mail`), `web/src/lib/device.ts` (`describeDevice`, `approveDevice`)
- Modify: `web/src/main.tsx` (route), `backend` static fallback only if `/connect` is not already served by the SPA catch-all (check `app.ts` web serving; add it if not), `web/src/lib/api.ts`
- Test: `web/src/lib/device.test.ts`

**Interfaces:**
- Consumes: `GET /api/auth/device/:userCode`, `POST /api/auth/device/approve`, `POST /api/auth/login` (Task 2, existing).
- Produces: page flow: not signed in → `LoginForm`; signed in → "**Connect this device?** Linux · Andy-PC · from 203.0.113.4" with **Approve** and **Cancel**; success → "Done. Return to the app."; expired/unknown → "That code has expired. Start again in the app."

- [ ] **Step 1: Write failing tests** for `describeDevice`/`approveDevice` against a mocked fetch (success, 404 → typed error `expired`).
- [ ] **Step 2: Run** `npm test -w web` → FAIL. **Step 3: Implement.** **Step 4: Run** tests, lint, build → PASS.
- [ ] **Step 5: Commit** `feat(web): /connect approves a device from any signed-in browser or phone`

### Task 5: Rust — device flow, link codes, dev switch

**Files:**
- Modify: `tauri-client/src-tauri/src/account.rs` (add `device_start(&self) -> Result<DeviceStart>`, `device_poll(&self, request_id, poll_secret) -> Result<Option<LoginOutcome>>`; existing `redeem_code` stays), `account_commands.rs` (`account_device_start`, `account_device_poll`, `dev_signin_enabled`; `account_sign_in`, `account_sign_in_code`, `account_request_code`, `account_open_sso` return an error `dev_only` unless dev mode is on), `deeplink.rs`, `lib.rs` (register commands), `consts.rs` (`PROTOCOL_VERSION` handled in Task 8)
- Test: unit tests in the same files

**Interfaces:**
- Consumes: Task 2 endpoints.
- Produces (Tauri commands): `account_device_start(server: String) -> { requestId, userCode, pollSecret, expiresAt, approveUrl }` where `approveUrl = {server}/connect?c={userCode}`; `account_device_poll(server, requestId, pollSecret) -> AccountStatus | null` (null while pending; maps `invalid_token` to the error `expired`); `dev_signin_enabled() -> bool` (true iff env `VTT_DEV_SIGNIN` is `1`); `deeplink::connect_from_link(link: &str) -> Option<ConnectLink { server: String, code: Option<String> }>` and the event `deeplink:connect` carrying `{ server, code }`, **replacing** `deeplink:server`/`server_from_link`/`PendingServer` payload (keep the pending-until-window-asks behaviour; `take_pending_connect` replaces `take_pending_server`).

- [ ] **Step 1: Write failing tests**: `connect_from_link("vtt-chat://connect?server=https%3A%2F%2Fp.example.com&code=ABCD-2345")` → server normalised, code `ABCD-2345`; without `code` → `code: None`; a `code` that is not 8 alphabet chars (after stripping `-`) → `None` for the whole link; the existing bad-link table still yields `None`; `dev_signin_enabled` follows the env var (inject the reader as a parameter for testability); with dev mode off, `account_sign_in` returns `dev_only`.
- [ ] **Step 2: Run** `cargo test -p src-tauri deeplink account` (from `tauri-client/`) → FAIL.
- [ ] **Step 3: Implement.** `device_start` sends the existing `x-device-label` value via `device_label()`; no polling loop in Rust (the panel polls every 2 s).
- [ ] **Step 4: Run** `cargo test -p src-tauri && cargo fmt --all --check && cargo clippy -p src-tauri -- -D warnings` → PASS.
- [ ] **Step 5: Commit** `feat(app): connect through the browser — device codes and connect links; password forms are dev-only`

### Task 6: Panels UI — the Connect screen

**Files:**
- Create: `tauri-client/panels-ui/src/components/settings/ConnectScreen.tsx` (server field, **Connect**, code + QR + "Open in browser" + typed-code box, expiry countdown without a running timer while hidden: derive from `expiresAt` on render and poll only while the window is visible), `components/settings/DevSignIn.tsx` (collapsed block, the old forms and "Paste a connect link"), `hooks/useDeviceConnect.ts`, `components/QrCode.tsx` (own copy: panels-ui is a separate package; same props as web)
- Modify: `components/settings/AccountSection.tsx` (the signed-out branch renders `ConnectScreen`; the password/code/SSO form moves into `DevSignIn`), `lib/tauriBridge.ts` (`accountDeviceStart`, `accountDevicePoll`, `devSigninEnabled`, `onConnectLink`, `takePendingConnect`), `hooks/useAccount.ts` (drop `signIn`/`signInWithCode` from the default surface; keep them for `DevSignIn`), `types/index.ts`, `package.json` (`qrcode`)
- Test: `hooks/useDeviceConnect.test.ts` (state machine over a mocked bridge)

**Interfaces:**
- Consumes: Task 5 commands/events.
- Produces: `useDeviceConnect(server)` → `{ phase: 'idle' | 'waiting' | 'expired' | 'error', userCode?, approveUrl?, start(), cancel() }`; on a `deeplink:connect` event the screen fills server+code and **waits for the player to press Connect**; typed code → `account.signInWithCode`.

- [ ] **Step 1: Write failing tests**: idle → `start()` → waiting with a code; poll `null` keeps waiting; poll returning a status ends in signed-in and stops polling; `expired` error → phase `expired` with a "New code" action; `cancel()` stops polling; unreachable server → phase `error` with the message.
- [ ] **Step 2: Run** `npm test -w tauri-client/panels-ui` (use the workspace name in its `package.json`) → FAIL.
- [ ] **Step 3: Implement.** Radix, light/dark inherited; `DevSignIn` renders only when `devSigninEnabled()` resolves true.
- [ ] **Step 4: Run** tests, lint, typecheck, build → PASS.
- [ ] **Step 5: Commit** `feat(panels): Connect screen replaces the sign-in form (dev sign-in behind VTT_DEV_SIGNIN)`

### Task 7: Operator and device list polish

**Files:**
- Modify: `web/src/components/` account/devices: show `GET /api/auth/sessions` with a revoke button **only if** an account page already exists on the web (check `web/src/components/phone`); otherwise record it in `ROADMAP.md` item 8 and skip.
- Modify: `backend/src/cli/admin.ts` help text: mention that `user code` doubles as the dev/no-browser connect code.
- Test: existing admin tests unchanged.

- [ ] **Step 1:** check for an existing web account page; **Step 2:** add the Devices list + revoke with a test if present, else the roadmap note; **Step 3:** run `npm test -w web -w backend`; **Step 4: Commit** `docs/feat: devices list or roadmap note; user code help mentions connecting`

### Task 8: Protocol bump, docs, changelog, verification

**Files:**
- Modify: `shared/src/consts/index.ts` (`PROTOCOL_VERSION = 2`), `tauri-client/src-tauri/src/consts.rs` (`2`), `backend/src/lib/version.test.ts` expectations
- Modify docs: `docs/architecture/APP-SIGN-IN.md` (status → built, record the dev switch and final names), `JOIN-FLOW.md` (replace "app signs in with the same email and password" with the Connect step), `SIGN-IN-OPTIONS.md` (SSO and email codes now happen in the browser; the app's typed-code box is for link codes), `SYNC-PROTOCOL.md` (new endpoints), `VERSIONING-AND-DEPLOYMENT.md` §4 status, `DEVELOPING.md` (`VTT_DEV_SIGNIN`), `docs/guides/INSTALLING-THE-APP.md` (first-run steps), `docs/BUILD-STATUS.md`, `ROADMAP.md` (item 7 built/untried), `CHANGELOG.md` `[Unreleased]` (Added: connect through the browser; Changed: the app no longer has a sign-in form — wire change, needs matching 0.4 server and app; Known limits: deep links on Linux AppImage may need the typed code)
- Test: whole repo

- [ ] **Step 1:** bump both constants; run `npm test -w backend -- version` and `cargo test -p src-tauri consts` → PASS (they must agree).
- [ ] **Step 2:** docs and changelog as listed.
- [ ] **Step 3: Verify** `npm test --workspaces --if-present && npm run lint --workspaces --if-present`, `cargo test && cargo clippy -- -D warnings` in `tauri-client/`, `npm run build -w web -w status`, and a local end-to-end: run the backend with MemoryStore, register via the join page flow, press Connect in `VTT_DEV_SIGNIN`-off app build (`cargo build -p src-tauri`, then run), confirm the code appears, approve it at `/connect`, confirm the app signs in. Report anything not exercised.
- [ ] **Step 4: Commit** `feat(protocol): 0.4 wire change — browser-only app sign-in (PROTOCOL_VERSION 2)`; do **not** tag a release.

## Self-review notes

- Spec coverage: link codes (T1), device flow + phone QR approval (T2, T4, T6), deep link/QR/typed code on the join page (T3), Connect screen and removed forms (T5, T6), device naming on approval (T2, T4), server-bound/no-auto-signin deep link (T5, T6), MINOR + protocol bump (T8), `user code` kept (T7), dev mode (T5, T6). The spec's "Devices list with revoke" is T7 and conditional on an existing web account page (mobile account pages are roadmap item 8).
- Open call: the 5-minute TTL applies to both link codes and device requests; the typed code and the user code share one alphabet and format.
