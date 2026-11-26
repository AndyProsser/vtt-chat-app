# AI Summary Pipeline Reliability — Interim Fix (0.6.5) — Design

**Status:** approved and built (2026-11-26); see the implementation plan and
[BUILD-STATUS.md](../../BUILD-STATUS.md#ai-summary-pipeline-reliability-interim-2026-11-26).
**Scope:** an interim reliability fix for the records/summary pipeline (`ai/`). Not the Campaign
Graph (0.7+) — this only stops a local-CPU job from grinding for hours and *still* failing
anyway; running for hours and succeeding is fine and expected.

## 1. Why

A real test recording (1h6m, 11 tracks, sent to the VM's CPU-only Ollama as a GPU-vs-CPU timing
comparison) failed for good after exhausting all 5 job attempts. Investigating why turned up two
concrete bugs, not infrastructure flakiness:

1. **The recurring "fetch failed" at almost exactly the 1-hour mark, three times across this job's
   attempts**, is `ai/src/lib/longFetch.ts`'s hardcoded `AI_REQUEST_TIMEOUT_MS = 60 * 60_000` —
   the *only* timeout that actually applies to a local Ollama call (`ollama.ts`'s
   `createOllamaGenerate` calls `longFetch` directly, with no `AbortSignal` of its own). When one
   note-taking chunk needs longer than an hour to generate on CPU, this timeout kills the
   connection. It is not a Docker/keep-alive bug — it is "this chunk is too slow for CPU," with no
   policy anywhere that asks whether CPU can realistically finish before relying on it.
2. **"Token repeat limit reached" is misclassified.** Ollama returns that abort as an HTTP 5xx.
   `ai/src/lib/providers/errors.ts`'s `isTransientStatus` treats *any* 5xx as "the backend is
   unreachable" (`ProviderUnavailableError`) — the same bucket as a genuinely dead server — so it
   silently triggers the same permanent remote→local fallback as an outage. There is already a
   good, narrow fix for this at the final condense step (`fitNotes.ts`'s `isRepeatAbort`), but the
   main note-taking pass (`takeNotes` in `summarise.ts`) has no equivalent, and the classification
   problem is further upstream in `openaiCompat.ts`'s `post()`, before `takeNotes` ever sees it.

Andy's direction (verbatim, condensed): local CPU should only be relied on when there's no remote
*and* the job is small; a queue failure is preferable to burning hours on CPU with other options
available; the repeat-limit issue is a remote/model problem that should get operator attention, not
a silent fallback; long-running calls should be avoided by chunking smaller with review passes, not
tolerated via a long timeout. For 0.6.5 specifically, "good enough" is the bar — a DM's 5-minute
recap, not the full Campaign Graph (0.7+).

**Refined after the first build and review, same day:** the "job is small" framing turned out to
describe the wrong thing — recording length doesn't predict whether a job will get *stuck*, only
how long it legitimately takes. Andy's revised, final direction: uphold CLAUDE.md §5's "never
lost" promise — a job should never be refused for being long; it should run for as long as it
genuinely takes (explicitly: 8+ hours overnight is fine, nobody's waiting). What he actually wants
caught is a job that's *stuck*, not merely slow, and ideally extended rather than failed if it's
still making progress. True mid-call progress-watching (streaming tokens from Ollama rather than
waiting for the whole response) would need a bigger change than an interim fix warrants — flagged
as a real 0.7+ possibility. What's buildable now, and what §5d/§5e below settle on: no upfront
duration gate by default, classification and retry (§5a–§5c) to catch a genuinely stuck call, and
a per-call liveness bound (§5e) generous enough not to kill legitimate slow work — which delivers
the same practical outcome (a slow job keeps going; a stuck one fails that attempt and resumes on
retry from its already-completed chapters) without the architecture change real streaming would need.

## 2. Goals

- A job is never refused up front for being long; it runs for as long as it genuinely takes
  (including many hours), by default — CLAUDE.md §5's "never lost" promise, upheld, not narrowed.
- A single call that is genuinely *stuck* (not merely slow) is caught and fails that attempt,
  rather than blocking the worker indefinitely; the job resumes from its already-completed
  chapters on retry, so a stuck call costs that one attempt, not the whole recording.
- A remote model choking on content (repeat-limit / prediction-aborted) is distinguishable, in the
  logs and in `vtt-admin jobs list failed`, from a remote server that is actually unreachable.
- No single model call can silently run for the full hour before anyone finds out it won't finish.
- The existing job-retry machinery (5 attempts, resumable per-stage) is unchanged; this only changes
  what happens *within* an attempt.

## 3. Non-goals

- The Campaign Graph itself (structured fact storage, cross-session querying) — 0.7+. §7 below
  notes what this work incidentally sets up for it.
- Automatic re-chunking / job optimisation when a repeat-limit abort recurs (Andy's "trigger a job
  optimisation process" idea) — flagged as real but out of scope for an interim fix; §6.
- Cross-chapter LLM concurrency (parallel summarisation calls) — a separate, already-flagged-out-of-
  scope item from the audio-pipeline-concurrency work.
- Changing the "wait forever" behaviour when the operator has `ai.fallback.enabled = false` —
  that's documented, intended behaviour (CLAUDE.md §5) and stays untouched.

## 4. Root cause recap (for the plan's Review Focus)

| Symptom | Mechanism | File |
|---|---|---|
| "fetch failed" at ~60 min | `longFetch`'s Agent `headersTimeout`/`bodyTimeout`, the only timeout on a local Ollama call | `ai/src/lib/longFetch.ts`, `ai/src/lib/ollama.ts` |
| Remote "token repeat limit" → silent permanent fallback to local | any 5xx classified as `ProviderUnavailableError` | `ai/src/lib/providers/errors.ts`, `openaiCompat.ts` `post()` |
| Local repeat-limit detail lost | `ollama.ts` discards the response body on a non-ok status | `ai/src/lib/ollama.ts` |
| No size check before relying on local CPU | `createFailover`'s fallback has no concept of job size | `ai/src/lib/providers/fromSettings.ts`, `failover.ts` |

## 5. Approach

### 5a. A shared "the model aborted" detector

Extract `fitNotes.ts`'s local `isRepeatAbort` regex (`/repeat limit|prediction aborted/i`) into an
exported `isModelAbortMessage(message: string): boolean` in `ai/src/lib/providers/errors.ts`, so
every call site recognises the same signal instead of each guessing at it.

### 5b. Stop misclassifying it as "unreachable"

In `openaiCompat.ts`'s `post()`: when a non-ok response's detail text matches
`isModelAbortMessage`, throw a plain `Error` (never `ProviderUnavailableError`), regardless of
`isTransientStatus(status)`. This is the fix for root cause #2 — a repeat-limit abort no longer
looks like "the server is down" to `createFailover`, so it no longer silently triggers permanent
fallback to local.

In `ollama.ts`: capture the response body detail (mirroring `openaiCompat.ts`'s existing pattern)
in the thrown `Error`'s message instead of discarding it. Today a local Ollama failure says only
"ollama request failed with status 500" — the actual reason (e.g. "model runner has unexpectedly
stopped…") is silently dropped, which is also why nothing could ever pattern-match it.

### 5c. Retry a model-abort once, on the same backend, then fail clearly

`summarise.ts`'s `takeNotes` reads each transcript chunk through `ask()`/`read()`. Give it the same
retry-once-then-give-up shape `fitNotes.ts`'s `shorten()` already has: on `isModelAbortMessage`,
retry the identical call once (same backend — this is a content/model problem, not a connectivity
one); if it aborts again, throw a clear, specific error ("the remote model aborted generation
(repeat limit) for part N of M — check its context size or repeat-penalty settings") instead of a
generic "fetch failed"/"unreachable". That message is itself the "operator attention" Andy asked
for: it is immediately legible in `vtt-admin jobs list failed`, distinct from a real outage.

### 5d. A size gate on local-CPU fallback for the LLM only

New operator setting, alongside the existing `ai.fallback.*` group:

- `ai.fallback.max-local-minutes` (`AiFallbackSetting.maxLocalMinutes: number`) — the longest
  recording (wall-clock duration, `stoppedAt - startedAt`) for which the job may fall back to
  local Ollama for summarisation/notes. Above it, if remote is unavailable (or exhausts the
  existing `fallbackAfterMs` grace period), the job fails outright with a clear "too large for
  local" message rather than running on CPU. Proposed default **20 minutes** — a deliberately
  conservative starting guess (nobody has a confirmed CPU-tokens/sec number yet; §8 flags this).
  Operator-tunable the same way every other `ai.*` setting is.
- **Duration, not transcript size, and why**: the natural implementation would gate on the merged
  transcript's word count (closer to the real compute cost), but that number isn't known until
  *after* transcription (step 1) finishes — and `buildJobProviders` builds the transcribe and
  generate/story failovers together, in one call, before step 1 starts. Recording duration is
  known from the moment the job starts (`recording.startedAt`/`stoppedAt`, read immediately), so
  it avoids restructuring that call into two phases for an interim fix. It's a looser proxy (a
  quiet long session transcribes to less than a dense short one) but it also matches how Andy
  framed it ("if the job is small") more directly than a word count would.
- **Scoped to the LLM only, not transcription.** Whisper-on-CPU is explicitly fine per CLAUDE.md
  §5 ("no GPU required… a slow 4–8h CPU transcript is acceptable"); it's specifically the
  summarisation stage that's the acute pain here. `fallback.enabled` continues to govern
  transcription exactly as today; the new setting only affects the `generate`/`story` roles.

**Revised after review (2026-11-26, same day): the default is now `null` — no limit.** The
first pass defaulted to 20 minutes, which the final review correctly flagged as effectively
disabling LLM fallback for every real session (3–5 hours), contradicting CLAUDE.md §5's
documented "never lost" promise. Andy's call: keep that promise. A job is never refused up front
by default; `ai.fallback.max-local-minutes` becomes an **opt-in** cap for an operator who
specifically wants queue-failure-over-CPU-grinding behaviour (0 = never fall back to local at
all; a number = that many minutes; `null`/"none", the default = no limit). What actually protects
against the original bug (a job silently grinding for nothing) is 5a–5c (classification and
retry) and 5e (the per-call timeout) below, not an upfront duration guess — those catch a
genuinely *stuck* call; a merely *slow* one is allowed to keep going for as long as it takes,
including Andy's explicit "8+ hours overnight is fine."

Wiring: `processRecording.ts` computes `llmFallbackAllowed` from the recording's duration right
after `getRecording()` (the very start of `runJob`, well before `buildJobProviders` is called):
`llmFallbackAllowed` is `true` whenever `maxLocalMinutes` is `null`, or whenever the duration is
at or under a configured cap. `stoppedAt === null` (shouldn't happen for a job that's processing,
but if it does) is treated as an infinite duration — safe (and a no-op) under the default of no
cap, and fails safe the same way "too long" would if an operator has set one. `buildJobProviders`/
`fromSettings.ts`'s `role()` helper uses the flag to decide what backs the failover's fallback
slot:

```
remote
  ? createFailover(remote, fallback.enabled ? (llmFallbackAllowed ? local : tooLarge) : undefined, {...})
  : createFailover(local, undefined, timing)
```

where `tooLarge` is a function that immediately throws the clear "too large for local" error.
**`failover.ts` itself is untouched** — `fallbackAfterMs`'s existing wait-then-switch behaviour is
reused as-is; only *what* it switches to changes. This also means the documented "wait forever
when `fallback.enabled` is false" behaviour (CLAUDE.md §5) is completely unaffected: that path
never has a `fallback` function at all, gated or not.

One wrinkle: `createFailover` fires its `onFallback` callback whenever it switches to *whichever*
function is in the fallback slot, real or `tooLarge`. Left alone, that would make
`processRecording.ts` log "llm fell back to local" (and record local as a model the job used)
for a job that's actually about to fail without ever calling local. `role()` only wires
`onFallback` through to `deps.onFallback` when `llmFallbackAllowed` is true; when it isn't, the
option is left out, so `createFailover` is a no-op there and the only record of what happened is
`tooLarge`'s own thrown error — the job's real, honest failure reason.

### 5e. A dedicated per-call timeout for local calls — a liveness bound, not a size gate

Give `createOllamaGenerate` its own `timeoutMs` (default **45 minutes**, revised up from an
initial 20 after review — a single 6,000-char chunk (5f) was measured close to 20 minutes on the
project's own no-AVX test VM, RECORDING-AND-SUMMARIES.md, leaving too little margin), via
`AbortSignal.timeout`, rather than relying solely on `longFetch`'s blanket 60-minute Agent
timeout. This is **not** "fail fast on a slow job": with 5d defaulting to no overall limit, a
slow-but-working job is expected to run for hours, call after call. It is a bound on any *one*
call's liveness — the worker processes one job at a time, so a genuinely hung call (a wedged
model, an OOM stall) would otherwise block the worker indefinitely; 45 minutes catches that
without being mistaken for "the job is too slow," which it is explicitly allowed to be.

### 5f. Smaller chunks, by default

Halve `DEFAULT_CHUNK_CHARS` (`ai/src/consts/index.ts`), **12,000 → 6,000** characters. This is
"lots of small jobs" (Andy's own framing) applied to the one lever that most directly bounds a
single call's wall-clock risk: generation time is roughly proportional to *output* tokens, and the
scribe's notes "can run nearly as long as the piece itself" (existing comment in
`DEFAULT_CHUNK_CHARS`'s own doc comment) — so halving the input roughly halves the worst-case
output, and thus the worst-case time, per call. It roughly doubles the number of chunks for a given
transcript, which costs a little overhead on a healthy remote GPU and buys real headroom on CPU.
Simple global constant change; no need to special-case it per backend.

### 5g. Tighter note-taking: focus on what's impactful (recommended, flagged)

Andy asked whether making the scribe focus harder on interesting/impactful events, rather than
everything, would compress pipeline work further. It would, directly: `buildNotesPrompt`
(`prompts.ts`) currently instructs the scribe to "never drop a distinct event… keep the small
things as well as the big ones" — deliberately exhaustive. (Stage 12 D's actual "decision 7" is a
different thing: the retry ladder for *unreadable* notes, untouched by this — the fix below
relaxes how exhaustive a *readable* answer must be, not that ladder.) That's *why* a chunk's notes
can run as long as the chunk itself. Shortening what the scribe is asked to produce shortens
generation time directly (output tokens are the dominant cost) and reduces how often `fitNotes`'s
condense loop needs extra rounds afterward.

This is a real trade-off against an explicit earlier decision, not a free win — **my recommendation
is to take it anyway, for 0.6.5 specifically**, because it matches the bar Andy set for this
release in his own words: "a DM's 5-minute recap… not perfect, but good enough," with the fuller,
campaign-spanning fidelity explicitly deferred to the Campaign Graph (0.7+). Concretely: amend
`buildNotesPrompt`'s instructions to ask the scribe to prioritise what's consequential —
turning points, named NPCs/places/items, decisions with consequences, memorable lines, dice
results that mattered — and allow routine or minor beats to be condensed to a single line or left
out, rather than insisting none be dropped. Clearly commented as a deliberate, reviewable,
revisit-at-0.7 relaxation of this completeness instruction — not of decision 7, which stays as it was.

If Andy would rather leave this one for a separate, closer look at prompt quality, it's the one
step in this plan that can be dropped without weakening anything else here.

## 6. Other mitigations considered, not taken now

- **Automatic re-chunking on a repeat-limit abort** (split the offending chunk in half and retry):
  genuinely addresses "job optimisation," but is a meaningfully bigger change (needs to re-derive
  chunk boundaries mid-`takeNotes`, decide how notes from the two halves recombine) for a problem
  5c already makes visible and operator-actionable. Worth a follow-up once there's real data on how
  often it would fire.
- **Per-operator-configurable chunk size by backend** (smaller chunks specifically when
  `ai.llm.kind` resolves to local): more precise than 5f's flat halving, but adds a knob before
  there's evidence the flat change isn't enough. Flat halving first; revisit if CPU jobs still
  struggle.
- **Streaming generation** (so a job can bail out mid-generation instead of waiting for the whole
  response): would help, but `takeNotes`/`writeFromNotes` are written around a single
  request/response `GenerateText` function throughout the pipeline; changing that shape is a bigger
  lift than an interim fix warrants.

## 7. Hints for the Campaign Graph (0.7+) — noted, not built now

- `ai/src/lib/notes.ts`'s `NOTE_SECTIONS` (events, decisions, combat, npcs, locations, loot, quests,
  secrets, moments, quotes) is already a small, fixed schema of fact categories. It's a reasonable
  seed for the graph's entity/fact types rather than a from-scratch design.
- `ai/src/lib/memory.ts` (`buildMemoryPrompt`/`applyMemoryUpdate`/`relevantMemory`) already extracts
  durable facts from a session's notes and carries them forward as a flat list, re-surfaced by
  relevance next time. That's graph-lite: the Campaign Graph is naturally this mechanism's
  evolution (a connected structure instead of a flat list), not a parallel system.
- Smaller chunks (5f) are also smaller, more addressable units of "what happened in this slice" —
  if the graph ends up extracting structured facts chunk-by-chunk rather than from a whole
  session's notes, the finer chunking this fix introduces is a head start, not just a reliability
  measure.
- 5g's trade-off (less exhaustive prose notes) is specifically the kind of cost the Campaign Graph
  is meant to make unnecessary: cheap, schema'd fact extraction doesn't need to narrate everything
  to be thorough about facts. Once the graph exists, 5g may be safe to relax or drop — it's a
  stop-gap, not a direction.
- The newly-distinct "the model aborted generation" signal (5a–5c) is also useful telemetry once
  the graph is being designed: whether short, constrained, schema'd extraction calls turn out more
  resistant to this failure mode than today's open-ended narrative ones would be worth checking
  against real data before the graph's call shape is settled.

## 8. Open numbers (my calls, easily changed)

- `ai.fallback.max-local-minutes` default: **`null` (no limit) — revised after review**, per
  Andy's explicit direction ("I want this to complete even if it takes 8+ hours"; "the promise
  [of never losing a recording] upheld"). The setting itself stays as an opt-in cap for an
  operator who wants the opposite (fail fast rather than ever grind on local CPU) — 0 means never,
  a number means that many minutes.
- Local generate timeout (5e): **45 minutes** (revised up from an initial 20 after review — a real
  figure for the project's own no-AVX Xeon VM already exists in
  [RECORDING-AND-SUMMARIES.md](../../architecture/RECORDING-AND-SUMMARIES.md) ("Sampling"
  measurements): the summary model read 3.2 and wrote 1.8 tokens/s there (a modern CPU: roughly
  50–100/8–12), so a single 6,000-char chunk (5f) is itself close to 20 minutes on that hardware —
  too little margin for a liveness bound that must not be mistaken for "the job is too slow,"
  which 5d now explicitly allows it to be).
- `DEFAULT_CHUNK_CHARS` (5f): **6,000** characters (half of today's 12,000).

## 9. What's left to the plan

Exact test names, file-by-file diffs, and commit boundaries are for `writing-plans`. The pieces
above (5a–5g) are mostly independent and can be ordered for incremental, test-covered commits;
5d (the size gate) is the one with real cross-file wiring (`shared/`, `fromSettings.ts`,
`processRecording.ts`, `backend/src/cli/admin.ts` for `vtt-admin settings` visibility) and should
land as its own task.
