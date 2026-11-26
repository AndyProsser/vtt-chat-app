# Adaptive audio-pipeline concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transcribe a recording's tracks concurrently instead of one at a time, bounded by how
busy the instance actually is (presence first, CPU load as a backup clamp), so Whisper stops
waiting on a single serial track loop while players present on the instance are never meaningfully
contended with for CPU.

**Architecture:** A small concurrency pool (`dynamicPool.ts`) dispatches the *existing, unchanged*
per-track transcription call (`transcribeAudioFile`/`transcribeTrackFile`) across several tracks at
once instead of in a sequential loop; the same pool, fixed at limit 1, also serialises the actual
Whisper HTTP call across those concurrent tracks, so Whisper itself still sees only one request at
a time. How many tracks may run at once comes from a governor that reads a cheap, disposable
mirror of the backend's online-user count (new) and, only once that count is ≥ 1, a CPU-load
backup check — both cached briefly, same pattern as the existing `quietGate`.

**Tech Stack:** TypeScript, Node's `node:os` (`availableParallelism`, `loadavg`), Postgres (a new
singleton table), Vitest.

**Spec:** [docs/superpowers/specs/2026-11-26-adaptive-audio-pipeline-concurrency-design.md](../specs/2026-11-26-adaptive-audio-pipeline-concurrency-design.md)

## Global Constraints

- Single-box, homelab scale (8 vCPU reference hardware) — no cross-job (cross-recording)
  concurrency; the worker's one-job-at-a-time loop (`ai/src/lib/jobs/worker.ts`) is untouched.
- Exactly one Whisper transcription request in flight at a time, system-wide, regardless of how
  many tracks are concurrently being prepared.
- `ai/` (the worker) has no Valkey dependency and must not gain one for this — the presence mirror
  goes through Postgres, which the worker already connects to via `RecordsStore`.
- Presence itself (`backend/src/lib/realtime/presence.ts`) stays in-memory/ephemeral; the new
  mirror is a disposable, best-effort derived signal only, never a second source of truth, never
  needed for recovery (a fresh migration or restore defaulting it to 0 is always safe).
- An unreadable or stale presence read must fail toward "someone's online" (the conservative
  tier) — the opposite of `quietGate`'s own fail-open convention for its own, different signal.
- "A failing window fails its whole track" (existing `speechWindows.ts` behaviour) is preserved
  unchanged — this plan does not touch window-level transcription at all.
- A track already in flight is never cancelled or preempted when concurrency drops; only the
  *next* track's dispatch is held back.
- Concurrency while someone is online is a backup-clamped default, not pinned to 1: CPU load only
  pulls it down to 1, it is never the thing that raises it above the active default.

## Review Focus

- A recording with exactly one non-private track — must behave exactly as today (pool of size 1),
  no divide-by-zero or off-by-one on the "tracks remaining" count.
- The presence-mirror read throwing (Postgres briefly unreachable) right as a job starts — must be
  treated as presence ≥ 1 (conservative), not presence 0.
- One track's window fails partway through while other tracks are still mid-flight — the other
  tracks' transcripts must still be saved (`saveTrackTranscript`) before the job's error surfaces,
  so a retry only has to redo the failed track.
- The governor's answer changes (someone logs in) while several tracks are already dispatched —
  the pool must stop *starting new* tracks at the old, higher count without touching tracks already
  running.
- A retry of a partially-completed job (some tracks already have `transcribedAt` set) — the "tracks
  remaining" count the governor sizes against must exclude those, and exclude private tracks,
  not the recording's raw track count.

---

### Task 1: `dynamicPool` — the shared concurrency primitive

**Files:**
- Create: `ai/src/lib/records/dynamicPool.ts`
- Test: `ai/src/lib/records/dynamicPool.test.ts`

**Interfaces:**
- Produces: `createDynamicPool(options: DynamicPoolOptions): DynamicPool`, where
  ```ts
  export interface DynamicPoolOptions {
    /** Re-read before each dispatch; may return a different number each call. */
    currentLimit: () => Promise<number>;
    /** Awaited once a slot is granted, before the task itself runs. Absent = no wait. */
    gate?: () => Promise<void>;
  }
  export interface DynamicPool {
    /** Runs `task` once a slot is free (per the live `currentLimit`); resolves/rejects with it. */
    run<T>(task: () => Promise<T>): Promise<T>;
  }
  ```

- [ ] **Step 1: Write the failing test — respects a changing limit**

```ts
test('does not start a new task past the current limit, even as it changes', async () => {
  let limit = 2;
  const pool = createDynamicPool({ currentLimit: async () => limit });
  let running = 0;
  let maxRunning = 0;
  const started = Array.from({ length: 5 }, () => deferred());
  const tasks = started.map((d) =>
    pool.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await d.promise;
      running--;
    }),
  );
  await tick(); // let the first wave start
  expect(maxRunning).toBe(2);
  limit = 1;
  started[0]!.resolve();
  await tick();
  expect(maxRunning).toBe(2); // a slot freed, but the new limit holds the next dispatch to 1
  started.slice(1).forEach((d) => d.resolve());
  await Promise.all(tasks);
});
```

(`deferred()` and `tick()` are small test-local helpers — a deferred promise, and a microtask
flush.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w ai -- dynamicPool`
Expected: FAIL — `createDynamicPool` is not defined.

- [ ] **Step 3: Implement `createDynamicPool`**

A FIFO queue of pending `run` calls; a dispatch loop that, whenever a slot might be free, re-reads
`currentLimit()` and starts the next queued task only if currently-running count is below it;
decrements on completion (success or failure) and re-triggers the dispatch loop.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w ai -- dynamicPool`
Expected: PASS

- [ ] **Step 5: Write and pass a second test — the gate is awaited before each task, not once**

```ts
test('awaits the gate before every task, not just the first', async () => {
  const gateCalls: number[] = [];
  const pool = createDynamicPool({
    currentLimit: async () => 2,
    gate: async () => {
      gateCalls.push(Date.now());
    },
  });
  await Promise.all([pool.run(async () => {}), pool.run(async () => {})]);
  expect(gateCalls).toHaveLength(2);
});
```

Run: `npm test -w ai -- dynamicPool`
Expected: PASS after any needed fix.

- [ ] **Step 6: Write and pass a third test — used as a fixed mutex (limit always 1)**

```ts
test('serialises every task when the limit is fixed at 1', async () => {
  const pool = createDynamicPool({ currentLimit: async () => 1 });
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3].map((n) =>
      pool.run(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 5));
      }),
    ),
  );
  expect(order).toEqual([1, 2, 3]);
});
```

Run: `npm test -w ai -- dynamicPool`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add ai/src/lib/records/dynamicPool.ts ai/src/lib/records/dynamicPool.test.ts
git commit -m "feat(ai): a dynamic concurrency pool, limit re-read on every dispatch"
```

---

### Task 2: `ai.processing.*` settings

**Files:**
- Modify: `shared/src/lib/aiSettings.ts`
- Test: `shared/src/lib/aiSettings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AiSettings['processing']` gains `activeConcurrency: number` (default **2**) and
  `cpuThresholdPercent: number` (default **70**), alongside the existing `pauseWhileRecording`.
  New keys in `AI_SETTING_KEYS`: `ai.processing.active-concurrency`,
  `ai.processing.cpu-threshold-percent`. These are read by Task 4's governor.

- [ ] **Step 1: Write the failing tests**

```ts
it('sets ai.processing.active-concurrency', () => {
  const next = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.processing.active-concurrency', '3');
  expect(next.processing.activeConcurrency).toBe(3);
});

it('rejects ai.processing.active-concurrency below 1', () => {
  expect(() =>
    setAiSetting(DEFAULT_AI_SETTINGS, 'ai.processing.active-concurrency', '0'),
  ).toThrow(SettingError);
});

it('sets ai.processing.cpu-threshold-percent within 1 to 100', () => {
  const next = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.processing.cpu-threshold-percent', '55');
  expect(next.processing.cpuThresholdPercent).toBe(55);
});

it('rejects ai.processing.cpu-threshold-percent above 100', () => {
  expect(() =>
    setAiSetting(DEFAULT_AI_SETTINGS, 'ai.processing.cpu-threshold-percent', '101'),
  ).toThrow(SettingError);
});

it('normalises processing settings missing from an older stored record', () => {
  const normalised = normaliseAiSettings({ processing: { pauseWhileRecording: true } });
  expect(normalised.processing.activeConcurrency).toBe(2);
  expect(normalised.processing.cpuThresholdPercent).toBe(70);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w shared -- aiSettings`
Expected: FAIL — the new keys/fields don't exist yet.

- [ ] **Step 3: Implement**

Add the two fields to `DEFAULT_AI_SETTINGS.processing` (`activeConcurrency: 2`,
`cpuThresholdPercent: 70`); add both keys to `AI_SETTING_KEYS` with help text matching the existing
style (see `ai.fallback.after-seconds` for the "whole number" phrasing, `ai.llm.context` for the
"token" phrasing); add `setAiSetting` cases using a new `parseWholeNumberInRange(value, min, max)`
helper (or reuse/extend `parseSeconds`'s pattern) for both; extend `normaliseAiSettings`'s `pr`
block with the same `int(..., min)` helper already used there, clamped to the 1–100 range for the
percentage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w shared -- aiSettings`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/src/lib/aiSettings.ts shared/src/lib/aiSettings.test.ts
git commit -m "feat(shared): ai.processing.active-concurrency and cpu-threshold-percent settings"
```

---

### Task 3: The presence mirror (migration, store method, hub wiring)

**Files:**
- Create: `backend/migrations/0047_instance_runtime.sql`
- Modify: `backend/src/lib/store/store.ts` (the `Store` interface), `backend/src/lib/store/postgresStore.ts`,
  `backend/src/lib/store/memoryStore.ts`, `backend/src/lib/realtime/hub.ts`
- Modify: `ai/src/lib/records/recordsStore.ts`, `ai/src/lib/records/postgresRecordsStore.ts`,
  `ai/src/lib/records/memoryRecordsStore.ts`
- Test: `backend/src/lib/store/store.contract.test.ts` (the existing shared contract suite that
  already runs the same assertions against both `postgresStore.ts` and `memoryStore.ts` — add
  `recordOnlineCount`/read-back there rather than a one-off test), `backend/src/lib/realtime/realtime.test.ts`
  (confirmed: this is the file that already exercises `createHub`/connect/disconnect, not a separate
  `hub.test.ts`), `ai/src/lib/records/postgresRecordsStore.test.ts` (uses
  `describe.skipIf(TEST_DATABASE_URL === undefined)`, confirmed the existing guard pattern there —
  reuse it, don't invent a new one)

**Interfaces:**
- Produces: `Store.recordOnlineCount(count: number, now: number): Promise<void>` (backend side,
  fire-and-forget from `hub.ts`); `RecordsStore.onlineUserCount(now: number): Promise<number>`
  (worker side, consumed by Task 4's governor) — throws on a genuine read failure, so the governor
  decides the fail-safe direction, matching how `anyRecordingLive`'s own callers behave.

- [ ] **Step 1: Write the failing tests**

In `store.contract.test.ts` (runs against both `postgresStore.ts` and `memoryStore.ts`): a fresh
store's `recordOnlineCount` followed by a read-back returns what was just written (exact read
accessor name matches whatever this file's existing contract-test shape uses to expose store
state — follow its established pattern rather than inventing a new one).
In `ai/src/lib/records/postgresRecordsStore.test.ts`, inside the existing
`describe.skipIf(TEST_DATABASE_URL === undefined)('PostgresRecordsStore', ...)` block: a fresh
instance's `onlineUserCount(now())` is `0`; after writing the same `instance_runtime` row a backend
write would produce, `onlineUserCount` returns that value.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w backend -- store.contract` and `npm test -w ai -- postgresRecordsStore`
Expected: FAIL — no such table/method.

- [ ] **Step 3: Write the migration**

```sql
-- A disposable mirror of the backend's in-memory online-user count (presence.ts), so the worker
-- can read "is anyone around" without the worker depending on Valkey or the backend process.
-- Never a source of truth for presence itself; a fresh install or restore safely defaults to 0.
CREATE TABLE instance_runtime (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  online_users INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO instance_runtime (id) VALUES (1);
```

Name it `backend/migrations/0047_instance_runtime.sql`, following `0046_job_models.sql`'s comment
style.

- [ ] **Step 4: Implement `Store.recordOnlineCount` and `RecordsStore.onlineUserCount`**

`recordOnlineCount` upserts the singleton row (`UPDATE instance_runtime SET online_users = $1,
updated_at = $2 WHERE id = 1`) in both `postgresStore.ts` and `memoryStore.ts` (the latter a plain
in-memory field). `onlineUserCount` reads it (`SELECT online_users FROM instance_runtime WHERE id =
1`), same query shape as `anyRecordingLive`, in both `postgresRecordsStore.ts` and
`memoryRecordsStore.ts` (the latter again a plain field — note this is a *separate* class from
`memoryStore.ts` above; they share no code, both just need the same small addition).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w backend -- store.contract` and `npm test -w ai -- postgresRecordsStore`
Expected: PASS

- [ ] **Step 6: Write the failing test in `realtime.test.ts` — presence changes mirror the count**

```ts
it('mirrors the online-user count on connect and disconnect', async () => {
  const store = fakeStoreWithRecordOnlineCount();
  const hub = createHub({ store /* ...other required deps... */ });
  // drive one connection through resume()/whatever this test file's existing helper is
  await connectAs(hub, 'u1', 'campaign-1');
  expect(store.lastOnlineCount).toBe(1);
});
```

(Match `realtime.test.ts`'s existing helper names and fakes — read the top of that file for the
established pattern before writing this.)

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -w backend -- realtime`
Expected: FAIL — nothing calls `recordOnlineCount` yet.

- [ ] **Step 8: Wire it into `hub.ts`**

A small private method (e.g. `private mirrorOnlineCount(): void`) that calls
`this.options.store.recordOnlineCount(this.presence.onlineUsers(), this.now()).catch(() =>
undefined)` — fire-and-forget, never awaited on the hot path, never a reason a connect/disconnect
fails. Call it right after the existing `presence.connect(...)` and `presence.disconnect(...)`
call sites (the two spots already shown in the design doc's recon).

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -w backend -- realtime`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/migrations/0047_instance_runtime.sql backend/src/lib/store backend/src/lib/realtime/hub.ts backend/src/lib/realtime/realtime.test.ts ai/src/lib/records/recordsStore.ts ai/src/lib/records/postgresRecordsStore.ts ai/src/lib/records/postgresRecordsStore.test.ts ai/src/lib/records/memoryRecordsStore.ts
git commit -m "feat: mirror the online-user count into Postgres for the worker to read"
```

---

### Task 4: The activity governor

**Files:**
- Create: `ai/src/lib/records/activityGovernor.ts`
- Test: `ai/src/lib/records/activityGovernor.test.ts`

**Interfaces:**
- Consumes: `RecordsStore.onlineUserCount` (Task 3), `AiSettings['processing']` (Task 2),
  `DynamicPoolOptions['currentLimit']`'s shape (Task 1) — this module is what *produces* a
  `currentLimit` function for Task 5 to hand to a `dynamicPool`.
- Produces:
  ```ts
  export interface ActivityGovernorOptions {
    records: Pick<RecordsStore, 'onlineUserCount'>;
    settings: () => Promise<Pick<AiSettings, 'processing'>>;
    now?: () => number;
    loadavg?: () => number[]; // default: os.loadavg
    cpuCount?: () => number;  // default: os.availableParallelism
    pollMs?: number;
    goodForMs?: number;
  }
  /** `tracksRemaining` is how many of the recording's tracks still need transcribing this run. */
  export function createActivityGovernor(
    options: ActivityGovernorOptions,
  ): { trackConcurrency: (tracksRemaining: number) => Promise<number> };
  ```

- [ ] **Step 1: Write the failing test — presence 0 ignores CPU entirely**

```ts
test('at presence 0, uses up to cpuCount regardless of load, capped by tracks remaining', async () => {
  const governor = createActivityGovernor({
    records: { onlineUserCount: async () => 0 },
    settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
    loadavg: () => [7.9], // would read as "busy" if it mattered
    cpuCount: () => 8,
  });
  expect(await governor.trackConcurrency(11)).toBe(8); // capped by cpuCount, not tracksRemaining
  expect(await governor.trackConcurrency(3)).toBe(3); // capped by tracksRemaining, not cpuCount
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w ai -- activityGovernor`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the presence-0 branch**

`Math.min(cpuCount(), tracksRemaining)` when `onlineUserCount() === 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w ai -- activityGovernor`
Expected: PASS

- [ ] **Step 5: Write and pass the presence-≥1 tests — CPU is the backup clamp only here**

```ts
test('at presence >= 1 under the CPU threshold, uses activeConcurrency', async () => {
  const governor = createActivityGovernor({
    records: { onlineUserCount: async () => 1 },
    settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
    loadavg: () => [1.0], // 1 of 8 cores, well under 70%
    cpuCount: () => 8,
  });
  expect(await governor.trackConcurrency(11)).toBe(2);
});

test('at presence >= 1 over the CPU threshold, clamps to 1', async () => {
  const governor = createActivityGovernor({
    records: { onlineUserCount: async () => 2 },
    settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
    loadavg: () => [6.5], // >70% of 8 cores
    cpuCount: () => 8,
  });
  expect(await governor.trackConcurrency(11)).toBe(1);
});
```

Run: `npm test -w ai -- activityGovernor`
Expected: PASS after implementing `loadavg()[0] / cpuCount() >= cpuThresholdPercent/100 ? 1 :
activeConcurrency`, both still capped by `tracksRemaining`.

- [ ] **Step 6: Write and pass the fail-safe test — an unreadable presence signal means "someone's here"**

```ts
test('treats a presence read failure as presence >= 1, not presence 0', async () => {
  const governor = createActivityGovernor({
    records: {
      onlineUserCount: async () => {
        throw new Error('db unreachable');
      },
    },
    settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
    loadavg: () => [1.0], // quiet CPU — if this were treated as presence 0, it would return 8
    cpuCount: () => 8,
  });
  expect(await governor.trackConcurrency(11)).toBe(2); // the active-tier default, not 8
});
```

Run: `npm test -w ai -- activityGovernor`
Expected: PASS after wrapping the `onlineUserCount()` call in a try/catch that treats a throw as
`1`, same shape as `quietGate.ts`'s own `mustWait`.

- [ ] **Step 7: Write and pass the caching test — same short-cache shape as `quietGate`**

```ts
test('reuses a recent answer instead of re-reading on every call', async () => {
  let calls = 0;
  const governor = createActivityGovernor({
    records: {
      onlineUserCount: async () => {
        calls++;
        return 0;
      },
    },
    settings: async () => ({ processing: { activeConcurrency: 2, cpuThresholdPercent: 70 } }),
    loadavg: () => [0],
    cpuCount: () => 8,
    goodForMs: 5000,
  });
  await governor.trackConcurrency(8);
  await governor.trackConcurrency(8);
  expect(calls).toBe(1);
});
```

Run: `npm test -w ai -- activityGovernor`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ai/src/lib/records/activityGovernor.ts ai/src/lib/records/activityGovernor.test.ts
git commit -m "feat(ai): a presence-first, CPU-backup concurrency governor for track transcription"
```

---

### Task 5: Concurrent track transcription in `processRecording.ts`

**Files:**
- Modify: `ai/src/lib/records/processRecording.ts`, `ai/src/cli/worker.ts`
- Test: `ai/src/lib/records/processRecording.test.ts`

**Interfaces:**
- Consumes: `createDynamicPool` (Task 1), `createActivityGovernor` (Task 4) — both constructed in
  `worker.ts` and threaded into `ProcessRecordingDeps`, same way `createQuietGate`'s `gate` already
  is.
- Produces: `ProcessRecordingDeps` gains `trackConcurrency: (tracksRemaining: number) =>
  Promise<number>` (from the governor). `transcribeAudioFile`'s own signature is **unchanged** —
  still `(file, transcribeWav) => Promise<Segment[]>` — so every existing fake in
  `processRecording.test.ts` using that shape keeps working.

- [ ] **Step 1: Write the failing test — tracks run concurrently, bounded by `trackConcurrency`**

```ts
it('runs up to trackConcurrency() tracks at once, not one at a time', async () => {
  let running = 0;
  let maxRunning = 0;
  const gate = () => new Promise((r) => setTimeout(r, 10));
  const handler = createProcessRecordingHandler({
    ...baseDeps(/* 4 non-private tracks */),
    trackConcurrency: async () => 2,
    transcribeAudioFile: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await gate();
      running--;
      return [];
    },
  });
  await handler.run(job);
  expect(maxRunning).toBe(2);
});
```

(Base this on whichever existing test in the file already sets up a multi-track recording fixture
— several already do, per the earlier recon of this file's `transcribeAudioFile` fakes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w ai -- processRecording`
Expected: FAIL — tracks still run one at a time (`maxRunning` would be 1).

- [ ] **Step 3: Implement the concurrent dispatch**

Replace the step-1 `for (const track of await deps.records.listTracks(recording.id)) { ... }`
sequential loop with: filter to the tracks still needing work (not private, `transcribedAt ===
null`) exactly as today; build one shared `dynamicPool` whose `currentLimit` calls
`deps.trackConcurrency(tracksStillNeeding.length)` and whose `gate` is the existing `gate` (quiet
while recording — now also covering this dispatch, closing the gap the design doc flags); build a
second `dynamicPool` fixed at limit 1 wrapping `gated(providers.transcribe.call)` as the shared
Whisper mutex, passed as the `transcribeWav` each track's `transcribeAudioFile` call receives
instead of the raw gated function; dispatch every remaining track's existing
`deps.transcribeAudioFile(track.filePath, mutexedTranscribeWav)` call through the first pool,
`await`ing each with `Promise.allSettled` so one track's rejection doesn't cancel the others; for
every fulfilled result, call `saveTrackTranscript` immediately (not batched at the end); after all
settle, if any was rejected, throw (preserving "a failing window fails the whole track" and the
job's existing retry behaviour — a retry's `transcribedAt !== null` filter already skips the
tracks that succeeded).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w ai -- processRecording`
Expected: PASS

- [ ] **Step 5: Write and pass the failure-isolation test**

```ts
it('saves the tracks that succeeded even when another track fails', async () => {
  const saved: string[] = [];
  const handler = createProcessRecordingHandler({
    ...baseDeps(/* 3 non-private tracks: A, B, C */),
    trackConcurrency: async () => 3,
    transcribeAudioFile: async (file) => {
      if (file.includes('B')) throw new Error('whisper exploded');
      return [{ startMs: 0, endMs: 1000, text: 'ok' }];
    },
    records: {
      ...baseRecordsFake(),
      saveTrackTranscript: async (trackId) => {
        saved.push(trackId);
      },
    },
  });
  await expect(handler.run(job)).rejects.toThrow();
  expect(saved.sort()).toEqual(['track-a', 'track-c']);
});
```

Run: `npm test -w ai -- processRecording`
Expected: PASS (confirms the `Promise.allSettled` shape from Step 3 already does this; if not,
fix it here).

- [ ] **Step 6: Write and pass the single-track test (Review Focus)**

```ts
it('behaves exactly as before with a single non-private track', async () => {
  const handler = createProcessRecordingHandler({
    ...baseDeps(/* 1 track */),
    trackConcurrency: async (remaining) => {
      expect(remaining).toBe(1);
      return remaining;
    },
    transcribeAudioFile: async () => [{ startMs: 0, endMs: 500, text: 'hi' }],
  });
  await handler.run(job);
  // existing assertions this file already makes for the single-track happy path
});
```

Run: `npm test -w ai -- processRecording`
Expected: PASS

- [ ] **Step 7: Write and pass the retry/private-track test (Review Focus)**

```ts
it('sizes trackConcurrency by tracks still needing work, not the recording\'s raw track count', async () => {
  let seenRemaining: number | undefined;
  const handler = createProcessRecordingHandler({
    // 4 tracks total: 1 private (always skipped), 1 already transcribed (a prior partial attempt),
    // 2 still needing work — so trackConcurrency must be called with 2, not 4.
    ...baseDeps(/* that fixture */),
    trackConcurrency: async (remaining) => {
      seenRemaining = remaining;
      return remaining;
    },
    transcribeAudioFile: async () => [],
  });
  await handler.run(job);
  expect(seenRemaining).toBe(2);
});
```

Run: `npm test -w ai -- processRecording`
Expected: PASS

- [ ] **Step 8: Wire the governor into `worker.ts`**

Construct `createActivityGovernor({ records, settings: records.getAiSettings, ... })` once at
worker start (same place `createQuietGate` is constructed), and pass its `trackConcurrency` into
`createProcessRecordingHandler`'s deps.

- [ ] **Step 9: Run the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS, including every pre-existing `processRecording.test.ts` case — their
`transcribeAudioFile` fakes are untouched in shape, so they should need no changes beyond whatever
Steps 1–7 added.

- [ ] **Step 10: Commit**

```bash
git add ai/src/lib/records/processRecording.ts ai/src/lib/records/processRecording.test.ts ai/src/cli/worker.ts
git commit -m "feat(ai): transcribe a recording's tracks concurrently, bounded by the activity governor"
```

---

## Done when

- `npm test` is green across `shared`, `ai` and `backend`.
- `npm run lint && npm run build && npm run typecheck` are clean.
- A recording with several tracks, reprocessed locally, visibly overlaps tracks in the worker log
  instead of finishing them one at a time (manual spot-check on the dev VM — not a unit test, but
  worth a quick look before calling this done for real).
- `docs/BUILD-STATUS.md` and `CHANGELOG.md`'s `## [Unreleased]` get a line, per CLAUDE.md §17.
