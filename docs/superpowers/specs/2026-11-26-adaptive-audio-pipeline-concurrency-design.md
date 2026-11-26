# Adaptive audio-pipeline concurrency — Design

**Status:** approved design, not yet planned or built.

## Intent and why

Found while checking a different request (2026-11-26): the records pipeline has no parallelism
anywhere. The worker claims and finishes one job (one recording) end to end before claiming the
next, and *within* a job, tracks are transcribed one at a time, and within a track, speech windows
are transcribed one at a time (`ai/src/lib/jobs/worker.ts`, `ai/src/lib/records/processRecording.ts`,
`ai/src/lib/speechWindows.ts`). `ROADMAP.md` already carries Andy's own 2026-11-25 measurement
notes on this (Whisper on a GPU answers in well under a second; the VM's own ffmpeg slicing is what
takes the time), but nothing was designed or built from them.

Andy's own framing of the actual gap, from a real session: one track drops a clip every ~30 s,
another every ~20 s, a third varies 10–45 s. Whisper finishes each in a fraction of that, so across
an 11-track session it spends almost all its time waiting on the next clip, not transcribing. The
fix is **not** more Whisper throughput — it's keeping the clip queue fed, by preparing several
tracks' clips at once instead of one track, one window, at a time.

Separately, Andy wants this parallelism to scale with how busy the instance actually is: back off
hard for players who are online (even just chatting, not recording — protect the webapp/voice/chat
responsiveness, which all share this box's CPU with ffmpeg/Whisper/Ollama), and use the box flat
out when genuinely nobody is around.

## Goals

- Keep the Whisper consumer continuously fed during a recording's processing job, by preparing
  clips from several tracks concurrently instead of one track/window at a time.
- Scale how much concurrency that's allowed to use based on whether anyone is actually present on
  the instance right now, so background processing never meaningfully degrades voice/chat
  responsiveness for people who are there.
- When nobody is present at all, use the box's full CPU budget so background processing gets done
  as fast as possible.
- Preserve today's guarantees: recordings are still processed strictly one table at a time, in
  order, and the existing hard pause while any table is actively recording still holds — and now
  actually covers the new parallel clip-prep work too (see "A gap this closes," below).

## Non-goals (this round)

- Running more than one recording's `process-recording` job at once. Andy confirmed: tables stay a
  strict, ordered, one-at-a-time queue. Only the work *inside* one job gets parallel.
- Multiple Whisper transcription requests in flight at once. The bottleneck Andy identified is
  clip *preparation* (ffmpeg), not Whisper's own throughput — ROADMAP's own GPU measurement found
  the server answers one request at a time anyway. One Whisper consumer, fed by a parallel
  producer side, is the whole idea.
- Per-campaign presence granularity. A single, instance-wide "is anyone online" count is enough at
  homelab scale; a multi-campaign operator isolating load per campaign is a future idea, not this.
- Touching the LLM/chapter-summarisation stage's own concurrency (`CHAPTER_CONCURRENCY`, fixed at
  2 today). Andy: "the rest of the pipeline may or may not benefit" — left alone for now.

## Anti-goals

- No new formal state machine for "how busy is the instance." CLAUDE.md §15 already rejected a
  lifecycle-with-states pattern once (session state machine); the governor here is a cheap,
  stateless-per-check function — sample presence and CPU, derive a concurrency number — not a
  tracked, persisted lifecycle of its own.
- No general-purpose job-priority/scheduler framework. This is a narrow throttle on one pipeline
  stage, not infrastructure for future unrelated workloads.

## Constraints

- Homelab/single-box scale (CLAUDE.md §2): reference hardware is Andy's 8 vCPU VM running every
  service — Caddy, Postgres, Valkey, LiveKit, Ollama, Whisper, backend and worker all share it.
  No Kubernetes-style autoscaling, no second worker host assumed.
- Self-host-first: nothing here may depend on a cloud service.
- `ai/` (the worker) has no Valkey dependency today — only `backend/` does (`iovalkey`). Don't add
  one for this if Postgres already covers it, which it does (see below).
- Presence is deliberately in-memory-only in the backend today (`presence.ts`'s own doc comment:
  "needs no persistence and no fallback store"). A mirror for the worker to read is new, disposable
  state — never a second source of truth for presence itself, never relied on for recovery.
- Preserve existing error semantics: "a failing window fails the whole track" (today's explicit
  behaviour and doc comment in `speechWindows.ts`) — a transcript with a silent hole is worse than
  a retryable job failure.
- The ready-clip queue must be disk-bounded — flagged already in ROADMAP as the risk to watch.

## A gap this closes, found along the way

`ai.pause-while-recording` (`quietGate.ts`) today only gates the Whisper and LLM *network calls*,
not the ffmpeg clip-slicing step before them. That's harmless while slicing is single-threaded (at
most one ffmpeg process fighting a live recording for CPU), but the whole point of this design is
to run several ffmpeg processes at once — so the new parallel clip-prep producer must also sit
behind the same hard gate. Otherwise "quiet while recording" would get weaker than it is today,
not stronger.

## Approaches considered

### What signal decides how much concurrency is allowed

- **A — CPU load.** The worker watches its own host's load average and throttles off that alone.
  Zero new wiring, but purely reactive: voice and idle chat cost very little CPU themselves, so
  load only climbs once the AI work has already piled up — it can't anticipate "a player just
  joined," only notice after the fact.
- **B — Presence-based.** Extend the exact pattern `quietGate` already uses: the backend mirrors
  its in-memory online-user count into Postgres on change (a cheap write; `presence.ts`'s
  `onlineUsers()` is already an O(campaigns × users) scan, fine to call on every connect/disconnect
  in `hub.ts`), and the worker reads it the same way `anyRecordingLive` already reads the
  `recordings` table — no new dependency, same shape as an existing, understood mechanism.
  Proactive and matches intent directly, at the cost of one new (intentionally disposable) table.
- **C — B as the primary driver, A as a backup clamp, active only once B says someone's around.**
  Decided (Andy): B drives the scale; A only matters when presence ≥ 1, and is ignored entirely at
  presence 0 — "if presence is 0, make the CPU hurt."

**Picked: C.**

## The parts of the how, as decided

### The concurrency governor

A single pure-ish function, re-evaluated on a short cache (mirroring `quietGate`'s
`goodForMs`/`pollMs` pattern — a few seconds' staleness is fine, nobody needs this instant):

```
presence == 0  → concurrency = min(cpuCoreCount, trackCount)      // CPU ignored entirely
presence >= 1  → concurrency = clamp(activeDefault, loadFactor)    // CPU is the backup clamp
```

Where `activeDefault` is a conservative operator-configurable default (proposed: **2**, i.e. a
small, real improvement over today's forced-serial behaviour without meaningfully contending with
a box that also has to answer a WebSocket or serve a voice packet), and `loadFactor` further
reduces it toward 1 as the host's own normalised load average climbs past an operator-configurable
threshold (proposed default: 70% of available cores). These are operator settings
(`ai.processing.*`, alongside the existing `ai.fallback.*`/`ai.llm.*` pattern), not hardcoded, so
Andy can retune them against real measurements without a code change.

This governor sits **behind** the existing `quietGate` hard pause, not instead of it: while any
recording is live anywhere, the gate stays fully closed (as today, now also covering clip-prep) —
the governor only decides concurrency for the regime where the gate is open but someone is still
online and not recording.

### The presence signal

- `backend/src/lib/realtime/hub.ts`'s existing calls into `presence.connect`/`disconnect` gain a
  fire-and-forget write of `presence.onlineUsers()` to a new, small table (e.g.
  `instance_runtime(online_users int, updated_at timestamptz)`, singleton row) — never on the hot
  WS path's critical section, never retried hard, never a reason to fail a connection.
- `RecordsStore` gains a method alongside `anyRecordingLive` (e.g. `onlineUserCount(now): Promise<number>`)
  that the worker reads, cached the same short way `quietGate` already caches its own checks.
- This table is explicitly disposable: a fresh migration or restore defaults it to 0 (nobody
  online), which is always safe — the worst case is one extra cautious interval before the next
  real presence change corrects it.

### The clip-preparation pipeline (the actual ask)

Today, `processRecording.ts`'s track loop is: for each track in turn, fully transcribe it (which
itself, inside `transcribeTrackFile`/`transcribeWindows`, slices and transcribes one window at a
time) before moving to the next track. **Revised during planning** (2026-11-26) to a leaner
mechanism than the queue first sketched here, after noticing it reaches the same outcome with far
less new code and zero changes to the existing, already-tested `transcribeTrackFile`/
`transcribeWindows`:

- **Run several tracks' existing `transcribeTrackFile` calls concurrently**, bounded by the
  governor's current concurrency number, instead of one at a time. Each track's own internals are
  completely unchanged — still its own serial detect-silence → slice-window → transcribe-window
  loop — so "a failing window fails its whole track" and every existing unit test for that path
  stay exactly as they are.
- **A single shared mutex around the Whisper call** (`transcribeWav`), so that however many tracks
  are concurrently running, only one of them is ever actually mid-Whisper-request at a time — this
  is the literal "one Whisper consumer" from the original sketch, just expressed as a mutex instead
  of a queue-plus-consumer.
- Because each track only ever has **one clip sliced-but-not-yet-transcribed at a time** (same as
  today, per track), there is no unbounded backlog of prepared clips to cap — at most
  `concurrency` clips exist on disk at once, each a few MB. The disk-cap worry from ROADMAP's
  original note doesn't apply to this shape, so no clip-queue capacity setting is needed.
- A track whose turn comes up and finds the Whisper mutex held simply waits its turn, exactly as
  intended ("keep Whisper fed from whichever track has a ready clip next") — the staggered 20 s /
  30 s / 10–45 s clip cadence Andy described is exactly what this interleaves across.
- Segments are still saved **per track** (`saveTrackTranscript` once per track, as each one
  finishes) — independent of which order different tracks finished in, same as the failure-isolation
  rule below.

### Four things the builder check raised, settled here (my calls — check these while reading)

A fresh reviewer checked this doc against the code and raised four places a wrong guess would
matter. None needed Andy's own judgment — each follows directly from a principle already stated
either by Andy or by the existing code — so they're settled here rather than held open:

- **Fail-safe direction when the presence signal is unknown or stale** (a missing row, a write that
  never landed, a DB hiccup right after someone joins mid-job). `quietGate` fails *open* on its own
  unreadable signal ("a worker that cannot tell is a worker that carries on") — but copying that
  here would mean "can't tell → assume nobody's online → run at max," which is exactly the outcome
  this design exists to prevent. Given Andy's own stated priority order ("player UX should have
  priority"), this governor fails the *other* way: an unreadable or stale presence read is treated
  as presence ≥ 1 (the conservative tier), never as presence 0. This is a deliberate departure from
  `quietGate`'s own convention, not an oversight — say so in a comment where it's implemented.
- **Whether concurrency is fixed once per job or re-applied live.** Re-checked before *dispatching
  each new track* — so it can ramp down (stop starting new tracks) or up (start more) between
  dispatches — but it never preempts or cancels a track already running. This matches the worker's
  own existing philosophy (`runWorker`: "finishes the job in hand first, so a restart never abandons
  work mid-write") rather than introducing a new one. (Revised during planning: concurrency is
  tracked per-track, not per-window within a track — see "The clip-preparation pipeline.")
- **Failure isolation across concurrently-running track producers.** Other tracks' producers already
  in flight are let run to completion and saved (`saveTrackTranscript`) before the job's error is
  raised, rather than aborting the whole pool on the first failure. This directly reuses the
  pipeline's existing resumability design (`processRecording.ts`'s own doc comment: safe to re-run,
  each stage skipped when its output already exists) — a retry after a partial failure only has to
  redo the track(s) that actually failed, exactly like a retry already skips any track with
  `transcribedAt` set.
- **What `trackCount` means in `concurrency = min(cpuCoreCount, trackCount)` at presence 0.** The
  tracks still needing clip-prep *this run* — excluding private tracks (skipped entirely today) and
  any track a previous partial attempt already transcribed — not the recording's raw track count.
  Otherwise a retry, or a session with several private tracks, quietly under-parallelises without
  ever looking like a bug.

### Where this lives

New: `ai/src/lib/records/dynamicPool.ts` (the one concurrency primitive — used both to bound how
many tracks run at once and, with a fixed limit of 1, as the cross-track Whisper mutex), and the
concurrency-governor module (name and exact placement for the plan). Modified: `processRecording.ts`'s
step 1 (dispatches tracks through the pool instead of a sequential loop — `transcribeTrackFile` and
`transcribeWindows` themselves are untouched), `recordsStore.ts` + both implementations,
`quietGate.ts`'s caller (gate the new per-track dispatch, same `gate()` function, no change to
`quietGate.ts` itself), `hub.ts` (the presence mirror write), a new migration, and the `AiSettings`
shape (`shared/`) plus `vtt-admin settings` for the new `ai.processing.*` keys. Surfacing the current
concurrency tier in `vtt-admin status` (alongside the AI context-window section built 2026-11-24) is
a natural, cheap addition — proposed, not mandatory.

## What's left to the builder (writing-plans' job, not this doc's)

- Exact default numbers for `activeDefault` and the CPU-load threshold — proposed above, final
  tuning is measurement, not design. (No clip-queue cap setting is needed under the leaner
  mechanism planning settled on — see "The clip-preparation pipeline.")
- Whether to also fold in ROADMAP's other noted idea (cutting all of a track's windows in one
  ffmpeg pass instead of one process per window) — complementary to this design, not required by
  it; worth a line in the plan's scope-check rather than silently bundled in.
- Exact signatures, test list, and task breakdown.
