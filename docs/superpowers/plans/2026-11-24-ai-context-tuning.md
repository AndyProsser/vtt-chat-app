# AI context-window tuning via `vtt-admin status` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vtt-admin status` tells the operator whether the AI pipeline's assumed context window matches
reality (live-queried for Ollama, a maintained table for Claude), grades the mismatch asymmetrically
(assuming too much → `fail`; unused headroom → `warn`), and a `--tune` flag applies the determined value.

**Architecture:** The worker (which already talks to Ollama and already reports its local-AI state into the
database for `status` to read) gains a small periodic check against Ollama's native `/api/ps` and `/api/show`,
written into the existing `LocalAiStatus` record. Separately, the worker's own native-Ollama calls stop
pinning a hardcoded `num_ctx` and start following `ai.llm.context` fresh every call, so a `--tune`'d setting
takes effect on the very next generate call with no restart. `vtt-admin status` reads the stored check,
grades it against `contextWindowTokens()`, and `--tune` writes `ai.llm.context` through the existing settings
path. For Claude, a small per-model table replaces today's one flat cloud default inside `contextWindowTokens`
itself — no setting to tune, just a fact about the model.

**Tech Stack:** TypeScript, Vitest, the existing `ai`/`backend` npm workspaces; no new dependencies.

**Spec:** [docs/superpowers/specs/2026-11-24-ai-context-tuning-design.md](../specs/2026-11-24-ai-context-tuning-design.md)

## Global Constraints

- `contextWindowTokens()`'s existing rules for `local`/`remote`/`openai` are unchanged by this plan except
  where a task explicitly says so (Task 4, Claude only).
- No task may add a live network call inside `ai/src/lib/records/processRecording.ts` or
  `ai/src/lib/summarise.ts` — the chunking plan's hot path stays exactly as hardened. All new network calls
  live in `ai/src/cli/worker.ts` (a periodic, independent timer) or `backend`'s `vtt-admin status` itself.
- No task may make `vtt-admin status`'s default run perform a live generate call against any backend — only
  `GET /api/ps` and `GET /api/show` (read-only, no generation).
- `vtt-admin` (the `backend` process) never calls Ollama directly. It only ever reads what the worker already
  wrote to `instance_settings.local_ai` (`ai/src/lib/localAi/status.ts`), the same channel the existing
  "local AI" probe already uses — because `backend` has no `OLLAMA_URL`/model configured at all today
  (`infra/compose/compose.yml` sets those on `worker` only).
- Every new or changed public function in the `ai` package gets re-exported the same way its neighbours
  already are (via the nearest barrel `index.ts`), so `backend` can import it from `@vtt-chat-app/ai`.
- LF line endings, Prettier, ESLint — same as every other task in this repo; run `npx prettier --check` on
  touched files before each commit (a prior plan's tasks found gaps `eslint`/`tsc` don't catch).

## Review Focus

- **A fresh `local` install, nothing configured, no job has run yet.** `vtt-admin status` must not warn or
  fail — it must say "not checked yet" (or equivalent), distinctly from a real mismatch. Covered in Task 5's
  tests.
- **An operator switches `ai.llm.kind` (e.g. `local` → `remote`) without restarting the worker.** The stored
  `OllamaContextStatus` is from the *previous* kind until the worker checks again; grading must recognise a
  kind mismatch as "not current," not silently compare against stale data from a different backend. Covered
  in Task 5's tests.
- **`/api/show` succeeds (model known) but `/api/ps` says the model isn't currently loaded.** Grading must
  still work from `modelMax` alone (rules 2 and 3 in the design's grading list) without crashing on an absent
  `live` value. Covered in Task 1/5's tests.
- **`--tune` run a second time with nothing changed.** Must be a true no-op — report "already matches,"
  never duplicate-write the setting or print a spurious "changed" line. Covered in Task 6's tests.
- **A `remote` backend that answers the OpenAI-compatible API fine but 404s on `/api/ps`/`/api/show`** (a
  non-Ollama server, e.g. vLLM). Job processing must be entirely unaffected — this plan's periodic checker
  only ever feeds `status`'s report, never the pipeline's own request path. Covered in Task 2's tests.

---

### Task 1: Ollama introspection — `/api/ps`, `/api/show`, and the extended status types

**Files:**

- Modify: `ai/src/lib/localAi/ollamaModel.ts` (alongside `ollamaHasModel`/`pullOllamaModel`)
- Modify: `ai/src/types/localAi.ts` (the new `OllamaContextStatus` type, and `LocalAiStatus.llmContext`)
- Test: `ai/src/lib/localAi/ollamaModel.test.ts` (create if it does not exist; check first)

**Interfaces:**

- Produces:
  - `export interface OllamaContextStatus { kind: 'local' | 'remote'; model: string | null; live?: number; modelMax?: number; unreachable: boolean; }`
    in `ai/src/types/localAi.ts`, and `LocalAiStatus` gains `llmContext?: OllamaContextStatus | null`.
  - `export async function getOllamaRunningContext(baseUrl: string, model: string, fetchImpl?: typeof fetch): Promise<number | undefined>`
    — `GET {baseUrl}/api/ps`, matches `model` against the response's `name`/`model` fields the same way
    `ollamaHasModel` does (including the `:latest` suffix rule), returns that entry's `context_length`, or
    `undefined` when the model isn't in the list (not loaded — not an error). Throws only when the request
    itself fails (non-2xx, network error) — the caller decides what "unreachable" means.
  - `export async function getOllamaModelMaxContext(baseUrl: string, model: string, fetchImpl?: typeof fetch): Promise<number | undefined>`
    — `POST {baseUrl}/api/show` with JSON body `{ model }` (confirmed against Ollama's own docs: `/api/show`
    takes the model name as a POST body, unlike `/api/tags`'s plain `GET`), reads `model_info` for a key
    ending in `.context_length` (the family prefix varies per model — e.g. `gemma4.context_length`,
    `qwen3.context_length` — so match by suffix, never hardcode a family name), returns that number or
    `undefined` if no such key exists. Throws only on a request failure, same as above.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** for both functions in `ai/src/lib/localAi/ollamaModel.test.ts`,
      following `ollamaHasModel`'s existing test style (a fake `fetchImpl`, inline JSON responses):
      - `getOllamaRunningContext`: returns the matching model's `context_length` when present in `/api/ps`'s
        `models` list; returns `undefined` when the model is absent from the list; matches a bare model name
        against a `:latest`-suffixed entry, same as `ollamaHasModel`; throws when the server answers non-2xx.
      - `getOllamaModelMaxContext`: returns the number under whatever `model_info` key ends in
        `.context_length` (test with at least two different family prefixes, e.g. `gemma4.context_length` and
        `qwen3.context_length`, to prove it isn't hardcoded to one family); returns `undefined` when
        `model_info` has no such key; throws when the server answers non-2xx.

- [ ] **Step 2: Run and verify both sets fail**

      Run: `npx vitest run ai/src/lib/localAi/ollamaModel.test.ts`
      Expected: FAIL — `getOllamaRunningContext`/`getOllamaModelMaxContext` are not defined.

- [ ] **Step 3: Implement the two functions and the type changes.**

- [ ] **Step 4: Run and verify they pass**

      Run: `npx vitest run ai/src/lib/localAi/ollamaModel.test.ts`
      Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/localAi/ollamaModel.ts ai/src/lib/localAi/ollamaModel.test.ts ai/src/types/localAi.ts
git commit -m "feat(ai): query Ollama's running context and a model's trained max"
```

---

### Task 2: The worker reports the real Ollama context, independent of job processing

**Files:**

- Modify: `ai/src/cli/worker.ts` (a new periodic check, alongside the existing `OllamaModelKeeper`/reporter
  setup)
- Test: `ai/src/cli/worker.test.ts` (check whether this file exists; if the worker's startup wiring has no
  existing unit tests, add the new checker as a small, separately-tested pure function instead — see Step 3)

**Interfaces:**

- Consumes: `getOllamaRunningContext`/`getOllamaModelMaxContext` (Task 1), `createLocalAiReporter`'s existing
  `report` callback shape is for `llm`/`whisper` only — this needs a third channel. Add
  `reportContext: (status: OllamaContextStatus) => void` to `LocalAiReporter` (and to
  `createLocalAiReporter`'s returned object) in `ai/src/lib/localAi/status.ts`, writing into
  `LocalAiStatus.llmContext` the same way `llm`/`whisper` already write into their fields (reuse the existing
  `set`/`flush` machinery — it is keyed by field name already; add `'llmContext'` as a third key).
- Produces: a function `createOllamaContextChecker(options: { kind: 'local' | 'remote'; baseUrl: string; model: string; fetchImpl?: typeof fetch }): Promise<OllamaContextStatus>`
  in a new file `ai/src/lib/localAi/contextChecker.ts` — a pure, single-shot check (no settings-reading, no
  timer inside it; the **caller** resolves `kind`/`baseUrl`/`model` fresh each time it calls this, which
  matters for `local`: see below). Calls both Task 1 functions against `baseUrl`; catches a request failure
  from either and returns `{ kind, model, unreachable: true }` rather than throwing; otherwise returns
  `{ kind, model, live, modelMax, unreachable: false }` (either or both of `live`/`modelMax` may be absent
  without that being `unreachable` — "not currently loaded" and "unreachable" are different things, per
  Task 1).
- **Important: `local`'s model name is `OLLAMA_MODEL` (the env var `worker.ts` already resolves into its own
  `ollamaModel` variable at startup), never `settings.llm.model`** — that field only has meaning for
  `remote`/`claude`/`openai`. A local install can configure a second model for the bard
  (`OLLAMA_STORY_MODEL`); this task checks only the scribe's model (`ollamaModel`) — a deliberate scoping
  choice (most installs use one model for both roles; checking two and combining them, as `reportWorst`
  already does for readiness, is a reasonable follow-up, not required here) — note it as a one-line comment
  where the check is wired in, so it reads as a choice, not an oversight.
- The caller (worker.ts's new periodic callback) decides whether to call this at all: `settings.llm.kind`
  is `local` → call with `{ kind: 'local', baseUrl: ollamaUrl, model: ollamaModel }` (the two variables
  worker.ts's `main()` already has in scope); `kind` is `remote` and `settings.llm.url`/`settings.llm.model`
  are both non-null → call with `{ kind: 'remote', baseUrl: settings.llm.url, model: settings.llm.model }`;
  `remote` with a null `url` or `model`, or `kind` is `claude`/`openai` → don't call it at all, and report
  nothing (Task 5 handles those cases from `localAi.llmContext` being absent/stale, or the table/flat
  default — no stored check needed for them).

- [ ] **Step 1: Write the failing test** in `ai/src/lib/localAi/contextChecker.test.ts`: given a fake
      `fetchImpl` answering both endpoints, `createOllamaContextChecker({ kind: 'local', baseUrl, model, fetchImpl })`
      resolves to `{ kind: 'local', model, live: <n>, modelMax: <n>, unreachable: false }`; a fetch failure
      on either endpoint resolves to `{ kind, model, unreachable: true }` and never throws; the model not
      being in `/api/ps`'s list (but `/api/show` succeeds) resolves with `live` absent, `modelMax` present,
      `unreachable: false` (not the same as a request failure).

- [ ] **Step 2: Run and verify it fails**

      Run: `npx vitest run ai/src/lib/localAi/contextChecker.test.ts`
      Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createOllamaContextChecker` and the `reportContext` addition to `LocalAiReporter`/`createLocalAiReporter`.**
      Then wire it into `ai/src/cli/worker.ts`: a periodic callback that reads `settings = await records.getAiSettings()`,
      decides whether/how to call the checker per the rule above, and on a result calls `reporter.context(result)`
      (the new third channel from the reporter already constructed there). Run it on a plain interval timer
      (e.g. every 10–15 minutes — pick a constant, name it, comment the reasoning: cheap, read-only, no job
      dependency), started once at worker startup alongside the existing `OllamaModelKeeper` setup — but only
      in the normal long-running mode. `--once` (`drain the queue, then exit`) would start an interval that
      never gets to fire before the process exits, so under `--once` call the callback a single time directly
      instead of starting the interval. Catch and log any unexpected throw from the callback itself (it
      shouldn't throw per the checker's own contract, but a timer callback — or the `--once` direct call —
      must never crash the process).

- [ ] **Step 4: Run and verify it passes, then run the whole `ai` suite**

      Run: `npx vitest run ai/src/lib/localAi/contextChecker.test.ts ai/src/lib/localAi/status.test.ts`
      Expected: PASS, all cases, including existing `status.test.ts` cases for `llm`/`whisper` reporting
      (unaffected by the new third channel).

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/localAi/contextChecker.ts ai/src/lib/localAi/contextChecker.test.ts \
  ai/src/lib/localAi/status.ts ai/src/lib/localAi/status.test.ts ai/src/cli/worker.ts
git commit -m "feat(ai): the worker periodically checks Ollama's real context window"
```

---

### Task 3: The worker's native-Ollama calls follow `ai.llm.context`, not a hardcoded number

**Files:**

- Modify: `ai/src/lib/ollama.ts` (`OllamaOptions.numCtx` becomes dynamic)
- Modify: `ai/src/cli/worker.ts` (the `ollamaGenerate` factory passes a getter, not a fixed `8192`)
- Test: `ai/src/lib/ollama.test.ts`

**Interfaces:**

- Produces: `OllamaOptions.numCtx` changes from `number | undefined` to
  `number | (() => Promise<number | undefined>) | undefined`. `createOllamaGenerate`'s returned closure
  resolves it fresh on every call (`typeof options.numCtx === 'function' ? await options.numCtx() : options.numCtx`)
  before building the request body — not once at `createOllamaGenerate`'s own call time.
- Consumes: nothing new from Task 1/2. This task is independent of them; it only needs the already-existing
  `ai.llm.context` setting (from the chunking plan) and the already-existing `records.getAiSettings()`.

- [ ] **Step 1: Write the failing test** in `ai/src/lib/ollama.test.ts`: a `GenerateText` built with
      `numCtx: async () => 32_000` sends `num_ctx: 32000` in the request body; a second call after the getter
      is changed to return a different number (reassign a variable the getter closes over) sends the new
      number on the *next* call, without rebuilding the `GenerateText` — proving it is read per call, not
      once at construction. A plain numeric `numCtx` (today's existing usage) still works unchanged (no
      regression on the existing synchronous case).

- [ ] **Step 2: Run and verify it fails**

      Run: `npx vitest run ai/src/lib/ollama.test.ts`
      Expected: FAIL — the per-call getter is not honoured yet (today's code reads `options.numCtx` as a
      plain value only).

- [ ] **Step 3: Implement the change in `ollama.ts`.** Then in `worker.ts`, change the `ollamaGenerate`
      factory (today: `numCtx: 8192` literal) to
      `numCtx: async () => { const s = await records.getAiSettings(); return s.llm.kind === 'local' ? (s.llm.context ?? DEFAULT_LOCAL_CONTEXT_TOKENS) : undefined; }`
      (import `DEFAULT_LOCAL_CONTEXT_TOKENS` from `../consts/index.js`, already used elsewhere in this
      package) — preserving today's exact default (8192) when nothing is configured, satisfying "still
      correct on a fresh install." The `undefined` branch (kind isn't `local`) matches `createOllamaGenerate`'s
      existing behaviour of omitting `num_ctx` entirely when falsy.

- [ ] **Step 4: Run and verify it passes, then run the whole `ai` suite**

      Run: `npx vitest run ai/src/lib/ollama.test.ts && npm test -w ai`
      Expected: PASS, all cases, no regressions elsewhere.

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/ollama.ts ai/src/lib/ollama.test.ts ai/src/cli/worker.ts
git commit -m "fix(ai): the worker's num_ctx follows ai.llm.context, not a fixed 8192"
```

---

### Task 4: A Claude context-window table feeds `contextWindowTokens()` directly

**Files:**

- Modify: `ai/src/consts/claude.ts` (new table, next to `CLAUDE_PRICES`)
- Modify: `ai/src/lib/tokenBudget.ts` (the `claude` branch looks it up)
- Test: `ai/src/lib/tokenBudget.test.ts`, `ai/src/consts/claude.test.ts` (check whether this file exists; if
  `CLAUDE_PRICES` has no dedicated test file, add the new table's test to `ai/src/lib/tokenBudget.test.ts`
  instead, next to the existing `contextWindowTokens` tests)

**Interfaces:**

- Produces: `export const CLAUDE_CONTEXT_WINDOWS: Record<string, number>` and
  `export const CLAUDE_CONTEXT_WINDOWS_DATE = '<today's date>'` in `ai/src/consts/claude.ts`, mirroring
  `CLAUDE_PRICES`/`CLAUDE_PRICES_DATE`'s exact shape and doc-comment style. Values: look up the real context
  window for each of the three models already priced in `CLAUDE_PRICES` (`claude-haiku-5-5`,
  `claude-sonnet-5-5`, `claude-opus-5-5`) from Anthropic's own published model documentation as of today;
  do not guess a number — if it cannot be confirmed from official documentation, leave that model out of the
  table rather than inventing a value (an absent entry falls through to the existing flat default, which is
  always safe per the design's "`modelMax` unknown → unknown/warn, never a guessed fail").
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**: `contextWindowTokens({ kind: 'claude', model: 'claude-opus-5-5', ... })`
      returns `CLAUDE_CONTEXT_WINDOWS['claude-opus-5-5']`, not `DEFAULT_CLOUD_CONTEXT_TOKENS`, when that key
      exists in the table; `contextWindowTokens({ kind: 'claude', model: 'claude-not-a-real-model', ... })`
      still returns `DEFAULT_CLOUD_CONTEXT_TOKENS` (unchanged fallback for an unrecognised model); `kind: 'claude', model: null`
      also falls through to the flat default (no model named to look up).

- [ ] **Step 2: Run and verify it fails**

      Run: `npx vitest run ai/src/lib/tokenBudget.test.ts`
      Expected: FAIL — `contextWindowTokens` for a known Claude model currently returns the flat default
      unconditionally.

- [ ] **Step 3: Implement the table and the lookup** in `contextWindowTokens`'s `claude`/`openai` branch:
      `llm.kind === 'claude' ? (CLAUDE_CONTEXT_WINDOWS[llm.model ?? ''] ?? DEFAULT_CLOUD_CONTEXT_TOKENS) : llm.kind === 'openai' ? DEFAULT_CLOUD_CONTEXT_TOKENS : ...`
      (openai's branch is unchanged — no table, per the design's Non-goals).

- [ ] **Step 4: Run and verify it passes**

      Run: `npx vitest run ai/src/lib/tokenBudget.test.ts`
      Expected: PASS, all cases, including every pre-existing case in this file.

- [ ] **Step 5: Commit**

```bash
git add ai/src/consts/claude.ts ai/src/lib/tokenBudget.ts ai/src/lib/tokenBudget.test.ts
git commit -m "feat(ai): a per-model Claude context-window table replaces one flat cloud default"
```

---

### Task 5: `vtt-admin status` reports the context-window check, graded

**Files:**

- Modify: `backend/src/cli/admin.ts` (`AdminDeps.localAi`, the dispatcher passing `argv` through to
  `status`, a new row-producing function)
- Modify: `backend/src/cli/main.ts` (pass the already-read `localAi` value into `runAdmin`'s deps)
- Modify: `ai/src/lib/index.ts` (re-export `tokenBudget.ts` — `contextWindowTokens` is not public yet)
- Test: `backend/src/cli/admin.test.ts`

**Interfaces:**

- Consumes: `OllamaContextStatus`/`LocalAiStatus.llmContext` (Task 1/2), `contextWindowTokens` (Task 4's
  updated version), `CLAUDE_CONTEXT_WINDOWS` (Task 4) — all imported from `@vtt-chat-app/ai` once Task 4's
  commit and the `lib/index.ts` export land; this task does not need Task 2's worker wiring to actually run
  to be tested (tests inject `localAi` directly, same as every other `Ctx` field).
- Produces: a new function `aiContextRows(deps: Ctx, settings: AiSettings, localAi: LocalAiStatus | null): Row[]`
  in `admin.ts`, called from `status()` as a new section (title it `"AI"`), and folded into the existing
  `healthy` computation — `status()`'s exit-code logic must scan every row's badge for `'fail'`, not only
  the generic `probes` list's throws (today it only checks `probes`; this task changes that to also check
  `aiContextRows`'s output, e.g. by having `aiContextRows` return rows that `status()` includes when computing
  `healthy = services-ok && !rows.some(([badge]) => badge === 'fail')`).

  Grading inside `aiContextRows` (the design doc's exact rules):
  1. `settings.llm.kind` is `claude`: `ok` naming the table value if `CLAUDE_CONTEXT_WINDOWS` has the
     model, else `warn` "unknown, using the conservative default."
  2. `kind` is `openai`: always `warn`, "unknown" (never `fail` — Non-goals).
  3. `kind` is `local`/`remote`: if `localAi?.llmContext` is absent, or its `.kind` doesn't match
     `settings.llm.kind` (the "operator switched kind, no fresh check yet" case from Review Focus): `warn`,
     "not checked yet." Otherwise, against `configured = contextWindowTokens(settings.llm, false)`:
     - `llmContext.live` is a number and `< configured` → `fail`.
     - else `llmContext.modelMax` is a number and `< configured` → `fail`.
     - else `llmContext.modelMax` is a number and `> configured` → `warn`, naming both numbers (the hint).
     - else `llmContext.unreachable` → `warn`, "unknown."
     - else → `ok`.

- [ ] **Step 1: Write the failing tests** in `backend/src/cli/admin.test.ts`'s `describe('status'`) block
      (or a new nested describe, matching this file's existing style): one test per Review Focus item above
      plus the plain `fail`/`warn`/`ok` cases from the grading list — at minimum: fresh install (`local`,
      `localAi: null`) → `warn` "not checked"; `local` with `live < configured` → `fail`, exit code 1;
      `local` with `modelMax < configured` (and no `live`) → `fail`; `local` with `modelMax > configured` →
      `warn` with both numbers in the text; kind mismatch (`localAi.llmContext.kind === 'remote'` but
      `settings.llm.kind === 'local'`) → `warn` "not checked," not a comparison against stale data; `claude`
      with a tabled model → `ok`; `claude` with an untabled model → `warn`; `openai` → `warn`, never `fail`.

- [ ] **Step 2: Run and verify every new test fails**

      Run: `npx vitest run backend/src/cli/admin.test.ts -t "AI"`
      Expected: FAIL — `aiContextRows` does not exist; `status` does not yet read `deps.localAi` or
      `deps.store.getSettings()`.

- [ ] **Step 3: Implement `aiContextRows`, wire it into `status()`, add `localAi?: LocalAiStatus | null` to
      `AdminDeps`, change `runAdmin`'s dispatcher to call `status(deps, rest)` (today: `status(deps)` with no
      args — needed by Task 6, harmless to add now), and pass `localAi` through from `main.ts` (the value it
      already reads at line ~99, right next to where it is pushed into `probes` today).**

- [ ] **Step 4: Run and verify all new and existing `status` tests pass**

      Run: `npx vitest run backend/src/cli/admin.test.ts`
      Expected: PASS, all cases, including every pre-existing `status`/`status: the instance and the machine`
      test (unaffected by the new section).

- [ ] **Step 5: Commit**

```bash
git add backend/src/cli/admin.ts backend/src/cli/admin.test.ts backend/src/cli/main.ts ai/src/lib/index.ts
git commit -m "feat(backend): vtt-admin status reports the AI context-window check"
```

---

### Task 6: `--tune` applies the determined value

**Files:**

- Modify: `backend/src/cli/admin.ts` (`status()` reads a `--tune` flag; writes `ai.llm.context`)
- Test: `backend/src/cli/admin.test.ts`

**Interfaces:**

- Consumes: Task 5's `aiContextRows`/grading (reused, not duplicated — `--tune` must grade exactly the same
  way to decide what to apply) and the existing `applySetting`/`deps.store.putSettings` path `settings set`
  already uses.
- Produces: `status(deps, args)` recognises `--tune` in `args` (the `flag`/plain `args.includes` pattern
  already used elsewhere in this file). Behaviour per the design's `--tune` section: for `local`/`remote`,
  applies `llmContext.live` when known, else `llmContext.modelMax` when known, else does nothing and reports
  "nothing determined, could not tune"; writes `ai.llm.context` via `applySetting(current, 'ai.llm.context', String(value))`
  + `deps.store.putSettings(next)` only when the value to apply differs from the current setting (the
  Review Focus "run twice" case — second run reports "already matches," does not write again). For `claude`/
  `openai`, `--tune` is always a no-op, reported as such ("nothing to tune for this backend").

- [ ] **Step 1: Write the failing tests**: `--tune` with `local` and a known `live` value writes
      `ai.llm.context` to that value (assert via `deps.store.getSettings()` after the call, same pattern
      `settings set`'s own tests use); `--tune` with only `modelMax` known (no `live`, e.g. model not
      currently loaded) applies that instead; `--tune` run again immediately after reports "already matches"
      and does not call `putSettings` a second time (spy on it, or assert the settings object reference/value
      is unchanged — match this file's existing spy/assert style); `--tune` on `claude` reports the no-op
      message and does not touch settings at all; `--tune` with nothing determined (`localAi: null`) reports
      "could not tune" and exits non-zero... (confirm the right exit code against this file's existing
      convention for "nothing to do" vs. a real failure — a no-op is not a `fail`, so this should likely be 0
      with a `warn`-toned message, not 1; decide and document the choice in the ledger if the plan's own
      wording here is ambiguous).

- [ ] **Step 2: Run and verify it fails**

      Run: `npx vitest run backend/src/cli/admin.test.ts -t "tune"`
      Expected: FAIL — `--tune` is not read at all yet.

- [ ] **Step 3: Implement `--tune`.**

- [ ] **Step 4: Run and verify it passes, then run the whole `backend` suite**

      Run: `npx vitest run backend/src/cli/admin.test.ts && npm test -w backend`
      Expected: PASS, all cases, no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/cli/admin.ts backend/src/cli/admin.test.ts
git commit -m "feat(backend): vtt-admin status --tune applies the determined context window"
```

---

### Task 7: Docs — OPERATOR-GUIDE, CHANGELOG, and the two parked ideas in ROADMAP

**Files:**

- Modify: `docs/guides/OPERATOR-GUIDE.md` (document `vtt-admin status`'s new section and `--tune`, right next
  to the existing `ai.llm.context`/`OLLAMA_CONTEXT_LENGTH` passage this plan's predecessor added)
- Modify: `CHANGELOG.md` (`## [Unreleased]`, in the same change per CLAUDE.md §17)
- Modify: `ROADMAP.md` (park two ideas from the conversation that led to this plan: the bigger
  `vtt-admin test ai|voice|full` command, and external connectivity checking via a small Cloudflare Worker)

**Interfaces:** none (documentation only; no code).

- [ ] **Step 1: Document `vtt-admin status`'s new AI section and `--tune`** in OPERATOR-GUIDE.md: what it
      checks, the asymmetric severity (an undershoot is a real problem; unused headroom is a suggestion),
      and that `--tune` only has an effect for `local`/`remote` (Claude's table is automatic).

- [ ] **Step 2: Add the `## [Unreleased]` CHANGELOG entry** for this feature (Added: the status check and
      `--tune`; Fixed: the worker's `num_ctx` no longer ignores `ai.llm.context`).

- [ ] **Step 3: Add both parked ideas to ROADMAP.md** as short, one-line future items (not full stage
      write-ups): a `vtt-admin test ai|voice|full` validation command (10–30s connectivity tier plus a longer
      audio-injection tier), and external connectivity checking (a small Cloudflare Worker, Andy's own
      instinct from the conversation).

- [ ] **Step 4: Commit**

```bash
git add docs/guides/OPERATOR-GUIDE.md CHANGELOG.md ROADMAP.md
git commit -m "docs: document AI context tuning; park the test-command and connectivity ideas"
```

---

## Self-review

1. **Spec coverage:** Intent/Goals (the asymmetric check + hint) → Tasks 1, 2, 5; `--tune` → Tasks 3, 6;
   Non-goals (no table for OpenAI, no pipeline network calls, CLI-only) → respected throughout, explicitly
   named in Global Constraints; the Claude table → Task 4; the two parked ideas → Task 7.
2. **Step scan:** every code step names the exact file, signature and test; Task 1's `/api/show` step states
   the confirmed `POST` request shape rather than leaving it for the implementer to rediscover.
3. **Type consistency:** `OllamaContextStatus` (Task 1) is the one shape threaded through
   `LocalAiStatus.llmContext` (Task 1) → `createOllamaContextChecker`'s `report` (Task 2) →
   `aiContextRows`'s grading (Task 5) → `--tune` (Task 6), same field names throughout.
4. **Review Focus:** all five items map to a task and a named test, listed inline above.
5. **Proportion:** seven tasks for a six-point design doc (two of its "what's decided" items, `--tune` and
   the report, split for separate gating, matching the chunking plan's own precedent of splitting a report
   from the action that follows it); no task duplicates another's work.
