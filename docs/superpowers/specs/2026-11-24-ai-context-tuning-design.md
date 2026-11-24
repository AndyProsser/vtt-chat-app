# AI context-window tuning via `vtt-admin status` — Design

**Status:** draft, awaiting approval
**Author:** Claude, with Andy, 2026-11-24
**Spec it argues from:** no formal spec; this grew out of a conversation following the
[chunking-long-sessions](../plans/2026-11-23-chunking-long-sessions.md) plan, whose final review found that
`ai.llm.context` is a value the operator types in, with no way for the app (or the operator) to check it
against what the backend actually has.

## Intent and why

The chunking plan gave the AI records pipeline a real token budget (`ai/src/lib/tokenBudget.ts`) instead of a
fixed character cap, and a `ai.llm.context` setting so an operator running a remote Ollama with a bigger
window could tell the app about it. Its own final review found a real gap: that setting is trusted or
ignored by *guesswork* (a fixed default for `local`, whatever the operator typed for `remote`), never checked
against the backend's actual configuration. Andy's framing: an operator who tunes their own Ollama instance's
VRAM/context allocation has no way to know whether the app's assumption now undershoots it (wasted capacity,
weaker summaries) or overshoots it (silent truncation — the exact failure the whole chunking plan exists to
prevent). The same mismatch risk exists for cloud (Claude/OpenAI): the app's built-in default could be wrong
for a model it doesn't recognise.

This plan gives the operator a way to **check** that, and, on request, **fix** it — surfaced through
`vtt-admin status`, which already has the right shape for this (a probe that reports ok/warn/fail per
subsystem) rather than a new command.

**Settled:** a live `/api/ps` query alone can only catch the app asking for *more* than Ollama actually
served (it echoes back whatever was last requested, never more) — it cannot discover unused headroom on its
own, since nothing ever asks for more than the app's own assumption to find out. Andy's call: add a second,
purely informational signal — `/api/show`'s **static** model metadata (the model's trained maximum context,
a fixed property of the model file, readable without loading or generating anything) — specifically to
surface unused headroom as a hint. See "Determining the real window and grading it" below for how the two
signals combine and what severity each disagreement gets.

## Goals

- `vtt-admin status` reports, for the configured LLM backend, whether the app's assumed context window
  matches what can actually be determined about the real one.
- **The severity is asymmetric, by Andy's explicit call:** the app assuming *more* than reality can deliver
  is a real, active risk (silent truncation) and fails the check (`fail`, non-zero exit). The app assuming
  *less* than reality allows (unused headroom — weaker summaries than the hardware/model could support) is
  a `warn`, not a `fail`: nothing is broken, but it's worth fixing. Can't determine anything at all → `warn`
  ("unknown," never silently trusted as fine, never treated as broken either). See "Determining the real
  window and grading it" for exactly how the two signals (live-served, static model max) combine.
- A `--tune` flag makes the determined value take effect for `local`/`remote`: it updates `ai.llm.context`
  to match, and — the part that gives `local` tuning any teeth — the worker's own Ollama calls start sending
  that number as `num_ctx` instead of a hardcoded one, so the very next job actually gets what was tuned.
- Still correct on a fresh install with nothing configured: the report explains the gap, it doesn't block
  anything, and the pipeline's existing fallback behaviour (from the chunking plan) stays intact if the LLM
  backend is unreachable at check time.

## Non-goals

- The bigger `vtt-admin test ai|voice|full` idea from the same conversation — a 10–30s "is it connectable"
  check plus a long-form audio-injection validation run. Parking that in ROADMAP.md as a future idea; this
  plan is the one narrow piece of it ("is AI connectable, and is our context-window assumption right") that
  Andy asked to fold into `status` now.
- External connectivity checking (is this server reachable from outside the operator's network). Parking
  that too — Andy's own instinct is a small Cloudflare Worker, done later, possibly as part of `status`.
- A maintained context-window table for OpenAI. The project already deliberately does not hardcode OpenAI
  model specifics (`OPERATOR-GUIDE.md`: "OpenAI changes its model names and prices often, so nothing is
  built in; you name the model, and give its prices if you want a dollar figure") — a context-window table
  for `openai` would contradict that standing decision. `openai` stays on the existing fixed cloud default,
  reported as `unknown` by this check (same as any other backend this can't determine), not a hard failure.
- Changing the public status page (CLAUDE.md §6). This is operator tuning detail, not player-facing; it
  belongs in `vtt-admin status` only.
- Making the AI pipeline itself (`processRecording.ts`, `summarise.ts`) perform a live network query per
  job. `contextWindowTokens()` stays the pure, synchronous function the chunking plan left it as; only
  `vtt-admin status` does any live querying, and only the worker's own `num_ctx` becomes tunable.

## Anti-goals (would make this a failure even if it technically works)

- A `status` run that makes a real generate call to "warm up" Ollama just to read its context length. The
  check has to stay cheap and safe to run routinely, the same way every other `status` probe is.
- `--tune` silently changing behaviour the operator didn't ask for. It only ever sets `ai.llm.context` to a
  value this check actually determined; it never guesses or invents a number.
- Reintroducing the silent-truncation bug the chunking plan's review just fixed, by making `local`'s
  `num_ctx` configurable in a way nothing validates against reality (e.g. letting an operator type an
  arbitrarily large number with no live check behind it).

## Constraints

- `contextWindowTokens()` (ai/src/lib/tokenBudget.ts) keeps its existing rule for `claude`/`openai` (fixed
  cloud default, `ai.llm.context` never trusted) and for `remote` (the operator's setting, clamped to the
  local fallback cap when `ai.fallback.enabled`). This plan does not reopen that.
- For `local`, `contextWindowTokens()` currently ignores `ai.llm.context` outright (the chunking plan's C1
  fix), because the worker pins a fixed `num_ctx: 8192` on every native Ollama call regardless of the
  setting. This plan removes that specific justification by making the worker's `num_ctx` itself follow
  `ai.llm.context` — once that's true, `local` no longer needs to ignore the setting; it can use it exactly
  like `remote` already does. **This supersedes that one line in tokenBudget.ts**, not the surrounding
  design.
- Ollama's live-queryable signal is `GET /api/ps` → `models[].context_length` ("context length for the
  running model" — confirmed against Ollama's own docs). It only lists models **currently loaded**; an idle
  model (unloaded after `OLLAMA_KEEP_ALIVE`) won't appear, so a live query can come back "not loaded, can't
  tell you right now" — a legitimate, expected outcome, not an error.
- `remote` may or may not actually be Ollama (CLAUDE.md: the OpenAI-compatible interface is meant to work
  with any compliant server). The live query against `/api/ps` is always opportunistic for `remote` — a
  non-2xx or connection failure there just means "can't determine," never a hard error.
- `vtt-admin status`'s dispatcher currently calls `status(deps)` with no arguments at all
  (`backend/src/cli/admin.ts`'s `runAdmin`); it needs to start passing through the rest of `argv` for
  `--tune` to be readable.
- The worker already re-reads `AiSettings` fresh per job (`runJob` calls `deps.records.getAiSettings()`), so
  a `--tune`'d setting takes effect on the very next job with no worker restart needed — **as long as** the
  worker's Ollama-backed `GenerateText` stops baking a fixed `numCtx` in at process start and reads it fresh
  per call instead. That's a real, bounded change to `ai/src/cli/worker.ts` and `ai/src/lib/ollama.ts`'s
  `OllamaOptions.numCtx`, not just a new CLI flag.
- **`vtt-admin` runs in the `backend` process/container, which has no path to Ollama at all today.**
  `OLLAMA_URL`/`OLLAMA_MODEL`/`OLLAMA_STORY_MODEL` are only set on the `worker` service
  (`infra/compose/compose.yml`); `backend/src/lib/config.ts` has no Ollama fields, and duplicating those
  env vars onto `backend` too would mean keeping two services' config in sync by hand. The project already
  has the right-shaped precedent for this: the worker reports its own local-AI state into
  `instance_settings.local_ai` (`ai/src/lib/localAi/status.ts`'s `writeLocalAiStatus`/`createLocalAiReporter`,
  read back by `vtt-admin status` via `readLocalAiStatus`) specifically *because* the backend has no direct
  line to the worker's own backends. This plan extends that existing channel rather than opening a new one:
  the **worker** (which already has `OLLAMA_URL`/model and already talks to Ollama every job) is what queries
  `/api/ps`, writing the live `context_length` into that same status record; `vtt-admin status` only ever
  reads the database, never calls Ollama directly. This decides the question of where the `/api/ps` call
  itself lives (settled as my own call, below) — my call, since the codebase already has this exact pattern
  for exactly this reason.
- Because the worker reports periodically (after each job, and on its own retry cadence from
  `OllamaModelKeeper`/`keepTrying`), the number `status` reads is "as of the last time the worker checked,"
  not instantaneous — same honesty the existing `local AI` probe already has (it shows a model's state "as
  the records worker last reported them"). `status`'s row says how old that report is; it does not block
  waiting for a fresh one. **`--tune` acts on that same last-reported number** rather than triggering an
  on-demand recheck (which would need new IPC between `vtt-admin`/backend and the worker process — out of
  scope here); if an operator just changed `OLLAMA_CONTEXT_LENGTH` and restarted Ollama, `--tune` picks up
  the new number once a job (or the worker's own retry loop) has run since the restart, not before. My call,
  flagged as a real limitation rather than buried.
- **The comparison ignores the fallback-enabled clamp.** `contextWindowTokens(llm, fallbackEnabled)` clamps
  `claude`/`openai`/`remote` down to the local fixed cap whenever `ai.fallback.enabled` is true — which is
  the *default* (`DEFAULT_AI_SETTINGS`). That clamp answers "what should a call be sized for, given it might
  fail over," a different question from "does our assumption about the *configured* backend match reality."
  Comparing against the clamped number would make a default, untouched `claude` install warn immediately
  (clamped to 8,192 vs. Claude's real ~100k+), contradicting the "still correct on a fresh install" goal.
  This check always compares against `contextWindowTokens(llm, false)` — my call, since using the clamped
  number here is a plain comparison-logic bug against the design's own stated requirement, not a real
  open question.
- **`remote` with `ai.llm.model` left `null`** (an explicitly valid state — `AiBackendSetting.model: null`
  means "the backend's own default"). With nothing configured to match against `/api/ps`'s list, the check
  reports "undetermined: no model named to match" rather than guessing at whichever single model happens to
  be loaded. My call — consistent with how this design already treats every other case it can't pin down
  (unknown, not a guess).

## Approaches considered

1. **Fold into `status`, two-tier (report / `--tune`) — chosen.** Reuses the existing probe model operators
   already know (`ok`/`warn`/`fail` rows), stays cheap by default, and only writes anything when explicitly
   asked. Matches exactly what Andy asked for in conversation.
2. **A separate `vtt-admin test ai` command with its own `--verify`/`--validation` tiers.** This was the
   original shape of the idea, but Andy explicitly asked to park the bigger test-command concept and fold
   just the context-window piece into `status` instead — building the separate command now would be doing
   the parked thing anyway.
3. **Live-query inside the pipeline itself, every job.** Rejected: turns a pure, synchronous budget
   calculation into a per-job network call with its own failure modes, right in the hot path the chunking
   plan just finished hardening. The worker's `num_ctx` becoming tunable (constraint above) gets the same
   real-world benefit — Ollama actually serves what was tuned — without touching `tokenBudget.ts`'s shape.

## What's decided

- Lives in `vtt-admin status`, as a new row (or small set of rows) alongside the existing probes, same
  severity model — now including `fail`, not just `ok`/`warn`, for the undershoot case.

### Determining the real window and grading it

For `local`/`remote` (Ollama-backed), two independent signals, both reported by the worker (see
Constraints) into the same status record:

- **Live-served** (`/api/ps` → `context_length`): what the running model instance is *actually* being
  served right now. Only present once the model has been loaded at least once; "not loaded yet" is a
  legitimate, distinct outcome, not an error.
- **Model max** (`/api/show` → `model_info["<family>.context_length"]`): the model's own trained ceiling —
  static, always answerable once the model is known to Ollama, loaded or not, and safe to read (no
  generation, satisfies the Anti-goals). This is the informational half Andy asked to add.

Grading, against `configured` = `contextWindowTokens(llm, false)` (the app's current assumption, fallback
clamp excluded — see Constraints):

1. **Live-served is known and `liveServed < configured`** → `fail`. The app is asking Ollama for more than
   it is actually handing back right now — active truncation risk, not hypothetical.
2. **Model max is known and `modelMax < configured`** → `fail`. The model cannot serve that many tokens at
   all, regardless of hardware — guaranteed to be wrong, worse than a live clamp.
3. **Model max is known and `modelMax > configured`** (and neither `fail` case applies) → `warn`: real
   headroom going unused. The hint text names the gap (e.g. "this model supports up to 131,072 tokens;
   configured for 8,192 — consider `vtt-admin status --tune`").
4. **Nothing determinable** (backend unreachable, or genuinely not Ollama) → `warn`, "unknown."
5. **Otherwise** (`liveServed == configured`, or only `modelMax == configured` and nothing else to flag) →
   `ok`.

For `claude`: a small, dated table next to `CLAUDE_PRICES` in `ai/consts/claude.ts` (same maintenance
pattern already established there) maps known model names to their real context window. Unlike
`local`/`remote`, this value **feeds `contextWindowTokens()` directly** — there is no operator-set lever to
`--tune` here; a known model's real window becomes the app's assumption outright (replacing today's one
flat `DEFAULT_CLOUD_CONTEXT_TOKENS` for every Claude model). `status` reports which table entry is in use
(`ok`), or that the configured model isn't in the table and the conservative flat default applies (`warn`,
"unknown," not `fail` — the flat default is deliberately conservative, so an unrecognised model is a gap in
our knowledge, not a known problem).

`openai` has no table (Non-goals) — always `warn`, "unknown," by design, never `fail`.

### `--tune`

Only meaningful for `local`/`remote`, where the determined window is genuinely operator-configurable data
(not a fixed model property). Applies the **live-served** value when known (it's the authoritative "what's
actually happening right now" number); falls back to the **model max** only when live-served isn't known
yet (e.g. model not currently loaded) and the operator is clearly trying to raise their configured value
toward the model's ceiling. Writes `ai.llm.context` (same path `settings set` already uses) and makes the
worker's native-Ollama `num_ctx` follow it. No-op, reported rather than silently skipped, when nothing at
all could be determined. For `claude`, `--tune` does nothing — the table already drives the real value
unconditionally, with no setting to write.

## What's left to the builder

- The exact `/api/ps` client function (new, alongside `ollamaHasModel`/`pullOllamaModel` in
  `ai/src/lib/localAi/ollamaModel.ts`, called from the **worker** — see Constraints), its signature, how it
  matches the configured model name against the response's `name`/`model` fields (same `:latest` suffix
  handling `ollamaHasModel` already does), and what it returns when the model isn't in the list (a distinct
  "not loaded" outcome, not the same as "unreachable"). Also the shape of the extension to `LocalAiStatus`/
  `LocalModelStatus` (`ai/src/types/localAi.ts`) that carries the live number through to `vtt-admin status`,
  and where in the worker's own loop the query runs (e.g. alongside `OllamaModelKeeper`'s existing checks).
- The exact mechanism for the worker's `num_ctx` to stop being fixed at startup and start following
  `ai.llm.context` per call (a thunk passed into `createOllamaGenerate`, a settings read inside the closure,
  or similar) — the constraint is "no worker restart needed," not a specific shape.
- Exact row wording and badge mapping for `status`'s output, consistent with its existing style
  (`backend/src/cli/admin.ts`'s `status()`/`instanceRows()`).
- The `/api/show` client function (same file/pattern as `/api/ps`'s), and where exactly it's called from —
  likely the worker too, alongside the `/api/ps` check, written into the same extended status record.
- The Claude context-window table's values and date-stamp (mirroring `CLAUDE_PRICES_DATE`), and the small
  change to `contextWindowTokens()`'s claude branch to look it up instead of returning the flat default
  unconditionally (falling back to the flat default for a model not in the table).
- Whether `--tune` needs confirmation before writing (existing `settings set` doesn't ask), and what exit
  code `status` returns when `--tune` had nothing to do versus successfully changed something.
- Test coverage for each graded outcome in "Determining the real window and grading it": live-served below
  configured (`fail`), model-max below configured (`fail`), model-max above configured (`warn`, with the
  hint text), model not currently loaded, backend not Ollama at all (404/connection refused), a known vs.
  unknown Claude model, openai (always `warn`/unknown), and `--tune` actually changing the setting and the
  next job's `num_ctx` (from live-served when known, from model-max when not).
