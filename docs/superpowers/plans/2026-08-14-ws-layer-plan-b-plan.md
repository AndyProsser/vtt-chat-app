# Backend WebSocket Layer (Plan B: Foundational) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the general-purpose backend WebSocket layer — server (`backend/`), Rust client (`src-tauri`) owning the connection/reconnect state machine, relay to `overlay-ui` via a Tauri event — with **zero domain message types**. This is a pipe, not a feature: Plan C (conditions) is its first real consumer, and a future chat stage reuses the same layer. Resolves the chat-transport ambiguity `STATE-AND-RESILIENCE.md` and CLAUDE.md §8.4 currently disagree on, in favor of backend WS (not LiveKit data events) — see [docs/superpowers/specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md](../specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md).

**Architecture:** `backend/` gains a `ws` package (the `ws` library, attached to the same HTTP server Express already runs on) authenticated by the **existing** `appSessionToken` JWT (`verifyAppSessionToken`, already implemented, currently issued but never consumed beyond being returned to the client) passed as a query parameter on the WS upgrade request. Connections are tracked per `campaignId` (a claim already in the token) for broadcast scoping. A bounded, in-memory, per-campaign replay buffer keyed by `lastEventId` covers brief reconnects; Redis-backed durability is an explicit non-goal here, deferred to whenever Stage 5 sets up Redis for real. `src-tauri` gains a `tokio-tungstenite` WS client (already a transitive dependency via `livekit`'s own signaling — this adds no new crate to the build) that connects in parallel to `livekit_connect`, owns exponential-backoff reconnection, and relays every inbound message to the frontend as one generic `ws:message` Tauri event — `overlay-ui` doesn't get a typed dispatcher in this plan, just the raw wrapper Plan C builds on.

**Tech Stack:** Rust (`tokio-tungstenite` 0.29 promoted from transitive to direct dependency — verified present in `Cargo.lock` and the vendored source before this plan was written), Node/Express (`ws` — new direct dependency, matching the archived `vtt-chat`'s own choice, not socket.io/uWS), TypeScript/Zod (`shared/`), Vitest (new for `backend/`, mirroring how Stage 3a stood it up for `overlay-ui`).

## Global Constraints

- **Plan B ships zero domain message types.** No `condition:*` events, no chat events — those are Plan C and the future chat stage. This plan is validated by connecting, reconnecting, and replaying *generic* envelopes only.
- Auth reuses the existing `appSessionToken` (`backend/src/lib/session/appSession.ts`) — do not invent a second auth mechanism for the WS layer.
- Replay buffer is in-memory only in this plan (bounded, per-campaign) — no Redis. Do not add a Redis dependency here; that's explicitly Stage 5's job.
- Every store write must no-op-guard where a value could plausibly not change; every unbounded-growth collection needs an explicit retention limit decided at creation time ([STATE-AND-RESILIENCE.md § Bounded Retention](../../architecture/STATE-AND-RESILIENCE.md#bounded-retention)) — the replay buffer's cap is exactly this, sized and enforced in the same commit that creates it, not added later.
- Rust confined to `tauri-client/`; TypeScript everywhere else (CLAUDE.md §3). The WS *server* is `backend/` (Node/Express), never Rust — only the *client* side lives in Rust.
- `rustfmt`/`clippy -D warnings` clean for Rust; ESLint + Prettier clean for TypeScript; all touched workspaces' `typecheck`/`build`/`test` stay green on every task.

---

## Task 1: `WsEnvelope` type + Zod schema in `shared/`

**Files:**
- Create: `shared/src/types/ws.ts`
- Modify: `shared/src/types/index.ts`
- Modify: `shared/src/lib/schemas.ts`

**Interfaces:**
- Produces: `export interface WsEnvelope<TType extends string = string, TPayload = unknown>` and `export const wsEnvelopeSchema`. Task 6 (backend `ws/server.ts`) and Task 12 (`tauriBridge.ts` — via the Rust relay's JSON shape) both key off this shape.

No test — pure type/schema declarations, consistent with how Stage 3a's shared additions (`LIVEKIT_SPEAKERS_EVENT`/`SpeakingStatePayload`) were verified by build/typecheck alone, not a dedicated test.

- [ ] **Step 1: Add the envelope type**

```ts
// shared/src/types/ws.ts
/**
 * Generic envelope for every message on the backend WS layer (Plan B). Plan B itself defines
 * zero concrete `type`s — Plan C (conditions) and a future chat stage define the first real
 * ones, each as `WsEnvelope<'some:type', SomePayload>`. `id` is a server-assigned, monotonic
 * (per campaign) identifier used for replay-on-reconnect (`lastEventId`).
 */
export interface WsEnvelope<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  payload: TPayload;
}
```

- [ ] **Step 2: Export it from the types barrel**

Edit `shared/src/types/index.ts`:

```ts
export * from './ddb.js';
export * from './session.js';
export * from './ipc.js';
export * from './ws.js';
```

- [ ] **Step 3: Add the validation schema**

Edit `shared/src/lib/schemas.ts`, appended:

```ts
/** Validates any inbound WS envelope's shape — `payload` is intentionally `unknown` here;
 * per-`type` payload validation is each consumer's job (Plan C etc.), not this generic layer's. */
export const wsEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
});
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types/ws.ts shared/src/types/index.ts shared/src/lib/schemas.ts
git commit -m "feat(shared): add WsEnvelope type and validation schema for the WS layer"
```

---

## Task 2: `WS_MESSAGE_EVENT` Tauri event name

**Files:**
- Modify: `shared/src/consts/index.ts`

**Interfaces:**
- Produces: `WS_MESSAGE_EVENT` constant. Mirrored by hand in Rust `consts.rs` (Task 9) per the established cross-language duplication pattern (Rust can't import the TS package, CLAUDE.md §3). Task 12 (`tauriBridge.ts`) consumes it.

- [ ] **Step 1: Add the constant**

Edit `shared/src/consts/index.ts`:

```ts
export const COBALT_COOKIE_EVENT = 'ddb:cobalt-cookie';
export const LIVEKIT_STATE_EVENT = 'livekit:state';
export const LIVEKIT_MICROPHONE_EVENT = 'livekit:microphone';
export const LIVEKIT_SPEAKERS_EVENT = 'livekit:speakers';
export const OVERLAY_TOGGLE_EVENT = 'overlay:toggle';
/** Emitted by src-tauri's WS client relay (Plan B) for every inbound WsEnvelope, regardless of
 * `type` — there's no per-type Tauri event yet, since Plan B defines no domain types. */
export const WS_MESSAGE_EVENT = 'ws:message';
```

- [ ] **Step 2: Verify**

Run: `npm run build --workspace shared`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/src/consts/index.ts
git commit -m "feat(shared): add WS_MESSAGE_EVENT Tauri event name"
```

---

## Task 3: Stand up Vitest for `backend/`

**Files:**
- Create: `backend/vitest.config.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: a working `npm run test --workspace backend`. Task 4 (`replayBuffer`) is the first consumer.

`backend/` has no test runner today — this mirrors exactly how Stage 3a's Task 1 stood up Vitest for `overlay-ui`, minus the `jsdom`/`localStorage` polyfill concerns (backend is a plain Node environment, not a DOM one — `environment: 'node'`, Vitest's default, no `jsdom` dependency needed here).

- [ ] **Step 1: Add the `test` script and `vitest` devDependency**

Edit `backend/package.json`:

```json
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
```

```json
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^26.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^6.0.3",
    "vitest": "^3.2.0"
  }
```

(`@types/ws` is added here rather than in Task 6 because `npm install` only needs running once — Task 6 depends on it being present already.)

- [ ] **Step 2: Add the Vitest config**

```ts
// backend/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Install and add the root `test` wiring (already generic)**

Run: `npm install` (root — resolves the new devDependencies into the `backend` workspace)

The root `test` script (`npm run test --workspaces --if-present`, added in Stage 3a) already picks up any workspace with a `test` script — no change needed there.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/vitest.config.ts package.json package-lock.json
git commit -m "test(backend): stand up Vitest"
```

---

## Task 4: `replayBuffer` — bounded, per-campaign, in-memory

**Files:**
- Create: `backend/src/ws/replayBuffer.ts`
- Create: `backend/src/ws/replayBuffer.test.ts`

**Interfaces:**
- Produces: `export function createReplayBuffer(maxEntriesPerCampaign: number)` returning `{ register(campaignId: string, envelope: WsEnvelope): void; replay(campaignId: string, lastEventId: string | undefined): { envelopes: WsEnvelope[]; truncated: boolean } }`. Task 6 (`ws/server.ts`) consumes it.

`truncated: true` means `lastEventId` wasn't found in the buffer (evicted, or never existed) — the caller (Task 6) falls back to telling the client to do a full state resync rather than attempting a partial replay against unknown state, per [STATE-AND-RESILIENCE.md § WebSocket Reliability](../../architecture/STATE-AND-RESILIENCE.md#websocket-reliability).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/ws/replayBuffer.test.ts
import { describe, expect, it } from 'vitest';

import { createReplayBuffer } from './replayBuffer.js';
import type { WsEnvelope } from '@vtt-chat-app/shared';

function envelope(id: string): WsEnvelope {
  return { id, type: 'test:event', payload: { id } };
}

describe('replayBuffer', () => {
  it('replay with no lastEventId returns everything registered so far, not truncated', () => {
    const buffer = createReplayBuffer(10);
    buffer.register('campaign-1', envelope('a'));
    buffer.register('campaign-1', envelope('b'));

    const result = buffer.replay('campaign-1', undefined);
    expect(result.truncated).toBe(false);
    expect(result.envelopes.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('replay from a known lastEventId returns only what came after it', () => {
    const buffer = createReplayBuffer(10);
    buffer.register('campaign-1', envelope('a'));
    buffer.register('campaign-1', envelope('b'));
    buffer.register('campaign-1', envelope('c'));

    const result = buffer.replay('campaign-1', 'a');
    expect(result.truncated).toBe(false);
    expect(result.envelopes.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('replay from the most recent id returns nothing, not truncated', () => {
    const buffer = createReplayBuffer(10);
    buffer.register('campaign-1', envelope('a'));

    const result = buffer.replay('campaign-1', 'a');
    expect(result.truncated).toBe(false);
    expect(result.envelopes).toEqual([]);
  });

  it('replay for an unknown campaign returns empty, not truncated (nothing to lose)', () => {
    const buffer = createReplayBuffer(10);
    const result = buffer.replay('never-seen', undefined);
    expect(result.truncated).toBe(false);
    expect(result.envelopes).toEqual([]);
  });

  it('replay from an evicted lastEventId is truncated', () => {
    const buffer = createReplayBuffer(2);
    buffer.register('campaign-1', envelope('a'));
    buffer.register('campaign-1', envelope('b'));
    buffer.register('campaign-1', envelope('c')); // evicts 'a', cap is 2

    const result = buffer.replay('campaign-1', 'a');
    expect(result.truncated).toBe(true);
    expect(result.envelopes).toEqual([]);
  });

  it('is bounded per campaign — oldest entries drop once the cap is exceeded', () => {
    const buffer = createReplayBuffer(2);
    buffer.register('campaign-1', envelope('a'));
    buffer.register('campaign-1', envelope('b'));
    buffer.register('campaign-1', envelope('c'));

    const result = buffer.replay('campaign-1', undefined);
    expect(result.envelopes.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('campaigns are isolated from each other', () => {
    const buffer = createReplayBuffer(10);
    buffer.register('campaign-1', envelope('a'));
    buffer.register('campaign-2', envelope('z'));

    expect(buffer.replay('campaign-1', undefined).envelopes.map((e) => e.id)).toEqual(['a']);
    expect(buffer.replay('campaign-2', undefined).envelopes.map((e) => e.id)).toEqual(['z']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace backend -- replayBuffer`
Expected: FAIL — cannot find module `./replayBuffer.js`.

- [ ] **Step 3: Implement**

```ts
// backend/src/ws/replayBuffer.ts
import type { WsEnvelope } from '@vtt-chat-app/shared';

export interface ReplayResult {
  envelopes: WsEnvelope[];
  /** True when `lastEventId` wasn't found (evicted or never existed) — the caller must fall
   * back to a full state resync, not attempt a partial replay against unknown state. */
  truncated: boolean;
}

export interface ReplayBuffer {
  register(campaignId: string, envelope: WsEnvelope): void;
  replay(campaignId: string, lastEventId: string | undefined): ReplayResult;
}

/**
 * Bounded, in-memory, per-campaign event log for brief-disconnect replay — see
 * docs/architecture/STATE-AND-RESILIENCE.md#websocket-reliability. Explicitly not Redis-backed:
 * that's Stage 5's job once Redis actually exists in this deployment; a process restart loses
 * this buffer entirely, same as the old system's superseded in-memory-only EventLog, which is
 * an accepted limitation for this plan (Plan B), not a bug to fix here.
 */
export function createReplayBuffer(maxEntriesPerCampaign: number): ReplayBuffer {
  const byCampaign = new Map<string, WsEnvelope[]>();

  return {
    register(campaignId, envelope) {
      const entries = byCampaign.get(campaignId) ?? [];
      entries.push(envelope);
      if (entries.length > maxEntriesPerCampaign) {
        entries.splice(0, entries.length - maxEntriesPerCampaign);
      }
      byCampaign.set(campaignId, entries);
    },

    replay(campaignId, lastEventId) {
      const entries = byCampaign.get(campaignId) ?? [];
      if (lastEventId === undefined) {
        return { envelopes: entries.slice(), truncated: false };
      }

      const index = entries.findIndex((entry) => entry.id === lastEventId);
      if (index === -1) {
        // Empty buffer for this campaign (nothing registered yet, or campaign unknown) is not
        // truncation — there's nothing to have lost. Only a *non-empty* buffer missing the id
        // means it was evicted.
        return { envelopes: [], truncated: entries.length > 0 };
      }

      return { envelopes: entries.slice(index + 1), truncated: false };
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace backend -- replayBuffer`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ws/replayBuffer.ts backend/src/ws/replayBuffer.test.ts
git commit -m "feat(backend): add bounded per-campaign replay buffer"
```

---

## Task 5: WS-specific consts

**Files:**
- Modify: `backend/src/consts/index.ts`

**Interfaces:**
- Produces: `WS_PATH`, `WS_HEARTBEAT_INTERVAL_MS`, `WS_REPLAY_BUFFER_SIZE`. Task 6 consumes all three.

- [ ] **Step 1: Add the constants**

Edit `backend/src/consts/index.ts`:

```ts
export const DEFAULT_PORT = 4000;

/** Matches `livekit-server --dev`'s printed defaults — see DEVELOPING.md. */
export const DEV_LIVEKIT_URL = 'ws://127.0.0.1:7880';
export const DEV_LIVEKIT_API_KEY = 'devkey';
export const DEV_LIVEKIT_API_SECRET = 'secret';

export const APP_SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 12;

/** Path the WS layer (Plan B) listens on, and the ping/pong interval that reaps dead
 * connections — matches the archived vtt-chat's precedent (30s). */
export const WS_PATH = '/ws';
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
/** Bounded replay buffer cap per campaign — see replayBuffer.ts. Deliberately small for a v1
 * in-memory buffer; revisit once this is Redis-backed (Stage 5). */
export const WS_REPLAY_BUFFER_SIZE = 200;
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/consts/index.ts
git commit -m "feat(backend): add WS path/heartbeat/replay-buffer-size consts"
```

---

## Task 6: `ws/server.ts` — the WS server itself

**Files:**
- Create: `backend/src/ws/server.ts`
- Modify: `backend/package.json` (add `ws` dependency)

**Interfaces:**
- Consumes: `createReplayBuffer` (Task 4), `WS_PATH`/`WS_HEARTBEAT_INTERVAL_MS`/`WS_REPLAY_BUFFER_SIZE` (Task 5), `verifyAppSessionToken` (existing, `lib/session/appSession.ts`), `wsEnvelopeSchema` (Task 1).
- Produces: `export function attachWsServer(httpServer: http.Server, config: BackendConfig): void`. Task 7 (`index.ts`) consumes it.

Auth: the client connects to `ws://host:port/ws?token=<appSessionToken>&lastEventId=<optional>`. The token is verified during the HTTP upgrade, before the WS connection is accepted — simpler than a post-connect auth message (this is a trusted first-party client, not a public API, so there's no reason to accept-then-auth). An invalid/missing token rejects the upgrade with `401`.

- [ ] **Step 1: Add the `ws` dependency**

Edit `backend/package.json`:

```json
  "dependencies": {
    "@vtt-chat-app/shared": "*",
    "express": "^5.1.0",
    "jose": "^6.0.0",
    "livekit-server-sdk": "^2.13.0",
    "ws": "^8.18.0"
  },
```

Run: `npm install` (root)

- [ ] **Step 2: Implement**

```ts
// backend/src/ws/server.ts
import type { WsEnvelope } from '@vtt-chat-app/shared';
import { wsEnvelopeSchema } from '@vtt-chat-app/shared';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { WS_HEARTBEAT_INTERVAL_MS, WS_PATH, WS_REPLAY_BUFFER_SIZE } from '../consts/index.js';
import type { BackendConfig } from '../lib/config.js';
import { verifyAppSessionToken } from '../lib/session/appSession.js';
import { createReplayBuffer, type ReplayBuffer } from './replayBuffer.js';

interface TrackedConnection {
  socket: WebSocket;
  campaignId: string;
  isAlive: boolean;
}

let nextEnvelopeId = 0;

function generateEnvelopeId(): string {
  nextEnvelopeId += 1;
  return `${Date.now()}-${nextEnvelopeId}`;
}

/**
 * Attaches the WS layer (Plan B) to the same HTTP server Express runs on. Ships zero domain
 * message types — this only handles connect/auth/heartbeat/reconnect-replay for whatever
 * `type`s later plans (Plan C, a future chat stage) define and broadcast through
 * `broadcastToCampaign`, exported here for those consumers to import directly.
 */
export function attachWsServer(httpServer: HttpServer, config: BackendConfig): void {
  const wss = new WebSocketServer({ noServer: true });
  const replayBuffer = createReplayBuffer(WS_REPLAY_BUFFER_SIZE);
  const connectionsByCampaign = new Map<string, Set<TrackedConnection>>();

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? '', 'http://internal');
    if (url.pathname !== WS_PATH) return;

    const token = url.searchParams.get('token');
    if (token === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    verifyAppSessionToken(token, config.appJwtSecret)
      .then((claims) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          const connection: TrackedConnection = { socket: ws, campaignId: claims.campaignId, isAlive: true };
          let campaignConnections = connectionsByCampaign.get(claims.campaignId);
          if (campaignConnections === undefined) {
            campaignConnections = new Set();
            connectionsByCampaign.set(claims.campaignId, campaignConnections);
          }
          campaignConnections.add(connection);

          ws.on('pong', () => {
            connection.isAlive = true;
          });

          ws.on('close', () => {
            campaignConnections?.delete(connection);
          });

          ws.on('message', (raw: Buffer) => {
            const parsed = wsEnvelopeSchema.safeParse(JSON.parse(raw.toString('utf8')));
            if (!parsed.success) return;
            // Plan B defines no domain types to act on — just re-broadcast to the rest of the
            // campaign and register for replay, same as a server-originated broadcast would.
            broadcastToCampaign(connectionsByCampaign, replayBuffer, claims.campaignId, parsed.data, connection);
          });

          const lastEventId = url.searchParams.get('lastEventId') ?? undefined;
          const { envelopes, truncated } = replayBuffer.replay(claims.campaignId, lastEventId);
          if (truncated) {
            ws.send(JSON.stringify({ id: generateEnvelopeId(), type: 'ws:resync-required', payload: {} }));
          } else {
            for (const envelope of envelopes) ws.send(JSON.stringify(envelope));
          }
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      });
  });

  const heartbeat = setInterval(() => {
    for (const connections of connectionsByCampaign.values()) {
      for (const connection of connections) {
        if (!connection.isAlive) {
          connection.socket.terminate();
          continue;
        }
        connection.isAlive = false;
        connection.socket.ping();
      }
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
  httpServer.on('close', () => clearInterval(heartbeat));
}

function broadcastToCampaign(
  connectionsByCampaign: Map<string, Set<TrackedConnection>>,
  replayBuffer: ReplayBuffer,
  campaignId: string,
  envelope: WsEnvelope,
  exclude?: TrackedConnection,
): void {
  const withId: WsEnvelope = { ...envelope, id: envelope.id || generateEnvelopeId() };
  replayBuffer.register(campaignId, withId);

  const connections = connectionsByCampaign.get(campaignId);
  if (connections === undefined) return;

  const serialized = JSON.stringify(withId);
  for (const connection of connections) {
    if (connection === exclude) continue;
    if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(serialized);
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/ws/server.ts backend/package.json package-lock.json
git commit -m "feat(backend): add attachWsServer — auth, heartbeat, campaign-scoped broadcast+replay"
```

---

## Task 7: Wire `attachWsServer` into `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `attachWsServer` (Task 6).

`createApp` (`lib/app.ts`) stays a pure Express-app factory — the HTTP server itself moves here, explicit, so both Express and the WS layer can attach to the same instance. Previously `createApp(config).listen(...)` created the `http.Server` implicitly inside `.listen()`; `attachWsServer` needs that same server instance before `.listen()` is called.

- [ ] **Step 1: Implement**

Edit `backend/src/index.ts`:

```ts
export * from './types/index.js';
export * from './consts/index.js';
export * from './lib/index.js';
export * from './ws/replayBuffer.js';

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createApp, loadConfig } from './lib/index.js';
import { attachWsServer } from './ws/server.js';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  const httpServer = createServer(createApp(config));
  attachWsServer(httpServer, config);
  httpServer.listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace backend`
Expected: PASS.

Run: `npm run build --workspace backend`
Expected: PASS.

Run manually (from `backend/`): `npm run build && npm start`, then in another terminal confirm the server still answers `POST /api/session` as before (unchanged behavior) and that connecting to `ws://localhost:4000/ws` (no token) gets rejected rather than hanging — e.g. `npx wscat -c ws://localhost:4000/ws` should fail to connect. Stop the server afterward.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): attach the WS layer to the same HTTP server Express runs on"
```

---

## Task 8: Rust — promote `tokio-tungstenite` to a direct dependency

**Files:**
- Modify: `tauri-client/src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `tokio_tungstenite`, `futures_util` available to `src-tauri`. Task 11 (`ws_client.rs`) consumes both.

Both crates are already in `Cargo.lock` as transitive dependencies (via `livekit`'s own WebSocket signaling) at the exact versions checked below — this adds no new crate to the build, only promotes existing ones to direct dependencies. Verified against the vendored source before this plan was written (`tokio-tungstenite` 0.29.0: `connect_async<R: IntoClientRequest>(request: R) -> Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response), Error>`; `WebSocketStream` implements `Stream<Item = Result<Message, WsError>>` + `Sink<Message>`; `Message::text(impl Into<Utf8Bytes>)` constructor; `Message::Text(Utf8Bytes)` where `Utf8Bytes: AsRef<str>`).

- [ ] **Step 1: Add the dependencies**

Edit `tauri-client/src-tauri/Cargo.toml`:

```toml
[dependencies]
base64 = "0.22"
futures-util = { version = "0.3", default-features = false, features = ["sink", "std"] }
rust-livekit = { path = "../rust-livekit" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = "2"
tauri-plugin-global-shortcut = "2"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time"] }
tokio-tungstenite = "0.29"
```

- [ ] **Step 2: Verify**

Run (from `tauri-client/`): `cargo build --workspace --all-targets`
Expected: PASS — no new crates compiled beyond what was already in the dependency graph (confirm by checking the build output doesn't download/compile anything new; `Cargo.lock` should be unchanged aside from possibly reordering, since these versions were already locked).

- [ ] **Step 3: Commit**

```bash
git add tauri-client/src-tauri/Cargo.toml tauri-client/Cargo.lock
git commit -m "feat(src-tauri): promote tokio-tungstenite/futures-util to direct dependencies"
```

---

## Task 9: Rust — WS event + backoff consts

**Files:**
- Modify: `tauri-client/src-tauri/src/consts.rs`

**Interfaces:**
- Produces: `WS_MESSAGE_EVENT`, `WS_RECONNECT_BASE_DELAY_MS`, `WS_RECONNECT_MAX_ATTEMPTS`. Task 11 consumes all three.

- [ ] **Step 1: Add the constants**

Edit `tauri-client/src-tauri/src/consts.rs`:

```rust
/// Mirrors `shared`'s `LIVEKIT_SPEAKERS_EVENT` — same duplication rationale as the two above.
pub const SPEAKERS_STATE_EVENT: &str = "livekit:speakers";
/// Mirrors `shared`'s `WS_MESSAGE_EVENT` (Plan B) — same duplication rationale.
pub const WS_MESSAGE_EVENT: &str = "ws:message";

/// Reconnect backoff for the WS client (Plan B) — matches the archived vtt-chat's own
/// parameters (1s base, doubling, capped at 5 attempts) rather than inventing new numbers.
pub const WS_RECONNECT_BASE_DELAY_MS: u64 = 1_000;
pub const WS_RECONNECT_MAX_ATTEMPTS: u32 = 5;
```

- [ ] **Step 2: Verify**

Run (from `tauri-client/`): `cargo build --workspace --all-targets`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/src-tauri/src/consts.rs
git commit -m "feat(src-tauri): add WS event name and reconnect-backoff consts"
```

---

## Task 10: Rust — `ws_client.rs`

**Files:**
- Create: `tauri-client/src-tauri/src/ws_client.rs`
- Modify: `tauri-client/src-tauri/src/lib.rs` (add `mod ws_client;`)

**Interfaces:**
- Consumes: `tokio_tungstenite::connect_async`, `futures_util::{StreamExt, SinkExt}`, `consts::{WS_MESSAGE_EVENT, WS_RECONNECT_BASE_DELAY_MS, WS_RECONNECT_MAX_ATTEMPTS}`.
- Produces: `pub fn backoff_delay(attempt: u32) -> std::time::Duration` (pure, tested) and `pub fn spawn(app: tauri::AppHandle, url: String)` (starts the connect/reconnect loop as a background Tokio task). Task 12 (`commands.rs`) consumes `spawn`.

The reconnect loop itself has no automated test — consistent with this codebase's existing boundary (`rust-livekit`'s actual network code isn't unit-tested either, verified manually/via the loopback harness instead; see the Stage 3a plan's Task 3 for the precedent). Only the pure backoff calculation is tested here.

- [ ] **Step 1: Write the failing test for `backoff_delay`**

```rust
// tauri-client/src-tauri/src/ws_client.rs (top of file, before the connect logic)
use std::time::Duration;

use crate::consts::WS_RECONNECT_BASE_DELAY_MS;

/// Exponential backoff: `base * 2^(attempt - 1)`, 1-indexed (attempt 1 = base delay). Matches
/// the archived vtt-chat's own reconnect math.
pub fn backoff_delay(attempt: u32) -> Duration {
    let multiplier = 2u64.saturating_pow(attempt.saturating_sub(1));
    Duration::from_millis(WS_RECONNECT_BASE_DELAY_MS.saturating_mul(multiplier))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_attempt_is_the_base_delay() {
        assert_eq!(backoff_delay(1), Duration::from_millis(WS_RECONNECT_BASE_DELAY_MS));
    }

    #[test]
    fn delay_doubles_each_attempt() {
        assert_eq!(backoff_delay(2), Duration::from_millis(WS_RECONNECT_BASE_DELAY_MS * 2));
        assert_eq!(backoff_delay(3), Duration::from_millis(WS_RECONNECT_BASE_DELAY_MS * 4));
        assert_eq!(backoff_delay(4), Duration::from_millis(WS_RECONNECT_BASE_DELAY_MS * 8));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `tauri-client/`): `cargo test --package src-tauri ws_client::`
Expected: FAIL to compile — `mod ws_client;` isn't declared in `lib.rs` yet, and the module doesn't exist as a file target.

Actually create the file with just the content above first, then re-run:

Run: `cargo test --package src-tauri ws_client::`
Expected: FAIL — `ws_client` isn't a module of the crate yet (not declared in `lib.rs`).

- [ ] **Step 3: Declare the module**

Edit `tauri-client/src-tauri/src/lib.rs`:

```rust
mod allowlist;
mod blocked_page;
mod cobalt;
mod commands;
mod consts;
mod homepage_redirect;
mod hotkeys;
mod safety_net;
mod ws_client;
```

- [ ] **Step 4: Run it to verify the test passes**

Run (from `tauri-client/`): `cargo test --package src-tauri ws_client::`
Expected: PASS — 2 tests.

- [ ] **Step 5: Implement the connect/reconnect/relay loop**

Append to `tauri-client/src-tauri/src/ws_client.rs`, below the `#[cfg(test)]` block:

```rust
use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::consts::{WS_MESSAGE_EVENT, WS_RECONNECT_MAX_ATTEMPTS};

/// Starts the WS client as a background task: connects, relays every inbound text message to
/// the frontend as `WS_MESSAGE_EVENT` (Plan B defines no per-type Tauri events — `overlay-ui`
/// filters by the envelope's own `type` field), and reconnects with exponential backoff on
/// disconnect, up to `WS_RECONNECT_MAX_ATTEMPTS` before giving up entirely for this session.
pub fn spawn(app: AppHandle, url: String) {
    tokio::spawn(async move {
        let mut attempt: u32 = 0;

        loop {
            match connect_async(&url).await {
                Ok((stream, _response)) => {
                    attempt = 0;
                    let (mut write, mut read) = stream.split();

                    while let Some(message) = read.next().await {
                        match message {
                            Ok(Message::Text(text)) => {
                                let _ = app.emit(WS_MESSAGE_EVENT, text.as_ref());
                            }
                            Ok(Message::Close(_)) => break,
                            Ok(_) => {}
                            Err(err) => {
                                eprintln!("[src-tauri] WS read error: {err}");
                                break;
                            }
                        }
                    }

                    // Drain the write half cleanly; ignore errors, the connection is already
                    // going away either way.
                    let _ = write.close().await;
                }
                Err(err) => {
                    eprintln!("[src-tauri] WS connect failed: {err}");
                }
            }

            attempt += 1;
            if attempt > WS_RECONNECT_MAX_ATTEMPTS {
                eprintln!(
                    "[src-tauri] WS reconnect gave up after {WS_RECONNECT_MAX_ATTEMPTS} attempts"
                );
                break;
            }
            tokio::time::sleep(backoff_delay(attempt)).await;
        }
    });
}
```

- [ ] **Step 6: Verify**

Run (from `tauri-client/`): `cargo fmt --all -- --check`
Expected: PASS (run `cargo fmt --all` first if not, then re-check).

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: PASS.

Run: `cargo build --workspace --all-targets`
Expected: PASS.

Run: `cargo test --package src-tauri ws_client::`
Expected: PASS — still 2 tests (the connect loop itself isn't unit-tested, per this task's stated boundary).

- [ ] **Step 7: Commit**

```bash
git add tauri-client/src-tauri/src/ws_client.rs tauri-client/src-tauri/src/lib.rs
git commit -m "feat(src-tauri): add ws_client — connect, relay, exponential-backoff reconnect"
```

---

## Task 11: Rust — `ws_connect` command

**Files:**
- Modify: `tauri-client/src-tauri/src/commands.rs`
- Modify: `tauri-client/src-tauri/src/lib.rs` (register the command)

**Interfaces:**
- Consumes: `ws_client::spawn` (Task 10).
- Produces: `#[tauri::command] pub fn ws_connect(app: AppHandle, url: String) -> Result<(), String>`. Task 12 (`tauriBridge.ts`) invokes it by name.

Fire-and-forget by design — `ws_client::spawn` owns its own reconnect loop for the app's lifetime; there's no `ws_disconnect` command in this plan (nothing in the app currently tears down the LiveKit connection outside of the whole app closing either, so this matches existing precedent — revisit if a real disconnect need shows up later).

- [ ] **Step 1: Add the command**

Edit `tauri-client/src-tauri/src/commands.rs`, appended after `set_microphone_muted`:

```rust
/// Starts the WS client (Plan B) as a background task — see `ws_client::spawn`. Called once
/// `overlay-ui` has an `appSessionToken` from the backend session response, in parallel with
/// `livekit_connect`.
#[tauri::command]
pub fn ws_connect(app: AppHandle, url: String) -> Result<(), String> {
    crate::ws_client::spawn(app, url);
    Ok(())
}
```

- [ ] **Step 2: Register it**

Edit `tauri-client/src-tauri/src/lib.rs`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::livekit_connect,
            commands::livekit_disconnect,
            commands::hotkey_action,
            commands::set_microphone_muted,
            commands::ws_connect
        ])
```

- [ ] **Step 3: Verify**

Run (from `tauri-client/`): `cargo fmt --all -- --check`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: PASS.

Run: `cargo build --workspace --all-targets`
Expected: PASS.

Run: `cargo test --all`
Expected: PASS — 22 tests (20 existing + 2 new `ws_client` tests).

- [ ] **Step 4: Commit**

```bash
git add tauri-client/src-tauri/src/commands.rs tauri-client/src-tauri/src/lib.rs
git commit -m "feat(src-tauri): add ws_connect command"
```

---

## Task 12: TS — `wsConnect`/`onWsMessage` in `tauriBridge.ts`

**Files:**
- Modify: `tauri-client/overlay-ui/src/lib/tauriBridge.ts`

**Interfaces:**
- Produces: `export function wsConnect(url: string): Promise<void>` and `export function onWsMessage(handler: (payload: string) => void): Promise<UnlistenFn>`. Task 13 (`backendWsUrl` helper + `useOverlayBridge` wiring) consumes both.

`onWsMessage`'s handler receives the raw JSON string, not a parsed `WsEnvelope` — Plan B has no domain types to validate against yet, so parsing/validating is each consumer's job (Plan C etc.), matching the same "generic pipe" boundary the backend side keeps.

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
  WS_MESSAGE_EVENT,
} from '@vtt-chat-app/shared';
```

Append, after `onSpeakersChanged`:

```ts
/** Emitted by the Rust WS client (Plan B) for every inbound message, regardless of type — the
 * payload is the raw JSON string; there's no per-type Tauri event since Plan B defines no
 * domain message types. Consumers parse/validate their own shape (see Plan C). */
export function onWsMessage(handler: (payload: string) => void): Promise<UnlistenFn> {
  return listen<string>(WS_MESSAGE_EVENT, (event) => handler(event.payload));
}
```

Append, after `setMicrophoneMuted`:

```ts
export function wsConnect(url: string): Promise<void> {
  return invoke('ws_connect', { url });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/tauriBridge.ts
git commit -m "feat(overlay-ui): add wsConnect/onWsMessage IPC wrappers"
```

---

## Task 13: TS — `backendWsUrl` + wire into `useOverlayBridge`

**Files:**
- Modify: `tauri-client/overlay-ui/src/lib/backendClient.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`

**Interfaces:**
- Consumes: `BACKEND_SESSION_URL` (existing, `consts/index.ts`), `wsConnect` (Task 12).
- Produces: `export function backendWsUrl(token: string): string`.

Derives the WS URL from the existing `BACKEND_SESSION_URL` config value rather than adding a second env var to keep in sync by hand — same host/port, `http(s):` swapped for `ws(s):`, path replaced with `WS_PATH`.

- [ ] **Step 1: Add `backendWsUrl`**

Edit `tauri-client/overlay-ui/src/lib/backendClient.ts`, appended:

```ts
import { WS_PATH } from '@vtt-chat-app/shared';

import { BACKEND_SESSION_URL } from '../consts/index.js';

/** Derives the Plan B WS URL from the existing session-endpoint config — same host/port,
 * `http(s):` swapped for `ws(s):`, path replaced with `WS_PATH`. Avoids a second env var that
 * would need to be kept in sync with `BACKEND_SESSION_URL` by hand. */
export function backendWsUrl(appSessionToken: string): string {
  const sessionUrl = new URL(BACKEND_SESSION_URL);
  const wsProtocol = sessionUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${wsProtocol}//${sessionUrl.host}${WS_PATH}`);
  url.searchParams.set('token', appSessionToken);
  return url.toString();
}
```

(Add this `import { WS_PATH } from '@vtt-chat-app/shared';` alongside the file's existing imports at the top, not as a second import block — see the existing `import type { DdbIdentity, SessionResponse } from '@vtt-chat-app/shared';` line to merge into.)

- [ ] **Step 2: Wire into `useOverlayBridge`**

Edit `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts` — the cobalt-cookie handler currently does:

```ts
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
```

Replace with:

```ts
    const unlistenCookie = onCobaltCookieDetected(({ cookieValue }) => {
      void (async () => {
        try {
          const identity = await extractDdbIdentity(cookieValue);
          const session = await requestSession(identity);
          await connectLiveKit(session.liveKit.url, session.liveKit.token);
          await wsConnect(backendWsUrl(session.appSessionToken));
        } catch (err) {
          console.error('[overlay-ui] failed to establish LiveKit session', err);
        }
      })();
    });
```

And add `backendWsUrl` to the `backendClient.js` import and `wsConnect` to the `tauriBridge.js` import at the top of the file:

```ts
import { backendWsUrl, requestSession } from '../lib/backendClient.js';
```

```ts
import {
  connectLiveKit,
  onCobaltCookieDetected,
  onLiveKitState,
  onMicrophoneState,
  onOverlayToggle,
  onSpeakersChanged,
  wsConnect,
} from '../lib/tauriBridge.js';
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/backendClient.ts tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts
git commit -m "feat(overlay-ui): connect the WS layer alongside LiveKit on cobalt-cookie detection"
```

---

## Task 14: Final full verification

**Files:** none (verification only).

- [ ] **Step 1: TypeScript gate suite**

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS (aside from the pre-existing untracked `.claude/settings.local.json` noise).

Run: `npm run typecheck`
Expected: PASS across every workspace, including `backend` and `shared`'s new additions.

Run: `npm run build`
Expected: PASS across every workspace.

Run: `npm test`
Expected: PASS — `backend`'s new `replayBuffer` suite (7 tests) plus `overlay-ui`'s existing suite, unchanged count from before this plan (no new `overlay-ui` tests were added — Tasks 12-13 are thin IPC wrappers, consistent with this codebase's existing precedent of not unit-testing those).

- [ ] **Step 2: Rust gate suite**

Run (from `tauri-client/`): `cargo fmt --all -- --check`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets --all-features -- -D warnings`
Expected: PASS.

Run: `cargo build --workspace --all-targets`
Expected: PASS.

Run: `cargo test --all`
Expected: PASS — 22 tests.

- [ ] **Step 3: Manual smoke test (not automatable in this environment — no live backend+DDB session)**

Record as a known follow-up, not something to fake-verify here: with `npm run dev` running the full stack, confirm the terminal shows the WS client connecting (or a clear reconnect/backoff log line if the backend isn't up yet), and that killing/restarting the backend process triggers a visible reconnect rather than the app silently giving up after `WS_RECONNECT_MAX_ATTEMPTS`.

- [ ] **Step 4: Commit if the verification step itself required any fixes**

If Step 1-2 were clean, there's nothing to commit here.
