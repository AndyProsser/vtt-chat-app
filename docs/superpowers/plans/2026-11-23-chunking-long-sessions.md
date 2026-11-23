# Chunking for long sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session of any length keeps the scribe's notes, the tale, the Chronicler's brief and campaign
memory inside the summary model's real context window, with the risk made visible rather than silently
losing the end of a long session — closing Stage 13's one remaining MUST bar (READINESS.md C5).

**Architecture:** Replace the character-length proxy the pipeline already uses to decide "does this fit?"
with a token estimate compared against the backend's _real_ window (an operator setting for a local/remote
server, a safe built-in default for Claude/OpenAI). Reuse the condense loop and the per-chapter structure
that already exist (`buildCondensePrompt`, chapter notes) rather than building a new map-reduce mechanism —
today's session 4 run showed that machinery working once the recording bug was fixed. Add what's genuinely
missing: a true token check, visible logging when a call runs close to the window, and pacing for the one
place the pipeline already fires several model calls at once (chapter notes), which queued badly on a
single-GPU remote server today.

**Tech Stack:** TypeScript (`ai/`, `shared/`, `backend/`), existing Vitest suites, Docker Compose.

**Spec:** [docs/architecture/QUALITY-VALIDATION.md § Fitting a long session in the model's window](../../architecture/QUALITY-VALIDATION.md#fitting-a-long-session-in-the-models-window),
read together with [RECORDING-AND-SUMMARIES.md](../../architecture/RECORDING-AND-SUMMARIES.md) (what the
scribe/bard/Chronicler/memory steps already do) and [READINESS.md](../../READINESS.md) bar C5. Two open
design questions from the spec are already decided (Andy, 2026-11-22): the context-window setting is an
operator value for local/remote only (Claude/OpenAI get a safe built-in default, no setting); chapters stay
the chunk boundary (no new map-reduce-from-chapter-tales mechanism — the existing condense loop already
achieves the spec's "no single prompt holds the whole session" goal by shortening the notes themselves).

## Global Constraints

- Self-host first (CLAUDE.md §2): nothing here may require a cloud account; the token-budget default for
  local/remote must work with no setting at all (falls back to 8,192, today's measured Ollama default).
- No protocol/wire change: this is `ai/`, `shared/` (settings) and `backend/` CLI only; stays a 0.6.x patch.
- `ai.llm.context` follows the existing settings pattern exactly (`ai.llm.price-in`/`price-out`): a
  `number | null` in `AiSettings`, `"none"` parses to `null`, documented in `AI_SETTING_KEYS`.
- Token estimate is `characters / 3.5`, per the spec, checked against the real count from `usage.prompt_tokens`
  (the connector already captures this via `onUsage`) wherever a call reports it — never invent a second
  estimation method.
- A prompt over ~70% of the window takes the chunked (condense) path; this ratio is the one new magic
  number this plan introduces, named and declared once (`CONDENSE_THRESHOLD` or similar), not scattered as
  a literal.
- Degrade by shortening wording, never by dropping facts outright: the condense prompt already carries this
  rule ("Facts are kept, wording is not") — don't weaken it when wiring the new trigger.

## Review Focus

- **A session on a server with no `ai.llm.context` set at all** (today's actual default): the pipeline must
  still behave exactly as before this change (8,192 fallback), not silently stop chunking because the
  setting was never configured. Covered in Task 1/3.
- **A single chapter's own notes, by themselves, already close to the window** (an unusually dense scene):
  the condense loop must still trigger from a single oversized group, not only when many chapters are
  joined. Covered in Task 2's test with one long note.
- **Claude/OpenAI configured as the LLM kind**: the operator's `ai.llm.context` value (if ever set from an
  earlier local/remote config) must be ignored and the cloud default used instead — a stale setting must
  never shrink a cloud model's real budget. Covered in Task 1.
- **The remote GPU unreachable mid-batch** (chapter notes already has a fallback-to-local path elsewhere in
  the codebase): pacing chapter notes must not swallow or reorder that existing fallback/error behaviour.
  Covered in Task 5's test using the existing fake-failure test pattern in `processRecording.test.ts`.
- **A job whose prompt usage report never arrives** (a provider that doesn't send `usage` at all, e.g. some
  OpenAI-compatible servers): the near-full warning must simply not fire, never throw or fail the job.
  Covered in Task 4.

---

## File structure

- **Create** `ai/src/lib/tokenBudget.ts` — token estimation and context-window resolution; no model calls,
  pure functions, easy to unit test in isolation.
- **Modify** `ai/src/consts/index.ts` — the two default-window constants and the condense-trigger ratio.
- **Modify** `shared/src/types/aiSettings.ts`, `shared/src/lib/aiSettings.ts` — the `ai.llm.context` setting.
- **Modify** `backend/src/cli/admin.ts` — show the new setting (mirrors `price-in`/`price-out` rows).
- **Modify** `ai/src/lib/summarise.ts` — `writeFromNotes`'s condense loop switches from a character-length
  check to a token-budget check; `takeNotes` gains the same for its own per-stretch cap.
- **Modify** `ai/src/lib/records/processRecording.ts` — resolve the window once per job from settings, pass
  it down to `takeNotes`/`writeFromNotes`; pace the chapter-notes `Promise.all` and log progress.
- **Modify** `infra/compose/compose.yml`, `infra/compose/remote-ai/compose.yml` — `OLLAMA_CONTEXT_LENGTH`
  passthrough (the operator's lever, spec point 6).
- **Modify** `docs/guides/OPERATOR-GUIDE.md` — document `ai.llm.context` alongside `OLLAMA_CONTEXT_LENGTH`.

---

### Task 1: Token budget primitives and the `ai.llm.context` setting

**Files:**

- Create: `ai/src/lib/tokenBudget.ts`
- Test: `ai/src/lib/tokenBudget.test.ts`
- Modify: `ai/src/consts/index.ts`
- Modify: `shared/src/types/aiSettings.ts:56-60` (the `llm` field of `AiSettings`)
- Modify: `shared/src/lib/aiSettings.ts` (`DEFAULT_AI_SETTINGS.llm`, `AI_SETTING_KEYS`, the `ai.llm.*` switch
  cases, add `'ai.llm.context'`)
- Test: `shared/src/lib/aiSettings.test.ts`
- Modify: `backend/src/cli/admin.ts` (wherever `ai.llm.price-in`/`price-out` are listed for `settings show`)
- Test: `backend/src/cli/admin.test.ts`

**Interfaces:**

- Produces: `estimateTokens(text: string): number` (chars/3.5, rounded up) and
  `contextWindowTokens(llm: AiSettings['llm']): number` — both exported from `ai/src/lib/tokenBudget.ts`,
  used by Task 2 and Task 3.
- Produces: `DEFAULT_LOCAL_CONTEXT_TOKENS = 8192` and `DEFAULT_CLOUD_CONTEXT_TOKENS = 100_000` in
  `ai/src/consts/index.ts`, and `CONDENSE_THRESHOLD = 0.7`.
- Produces: `AiSettings['llm'].context: number | null` and `'ai.llm.context'` in `AI_SETTING_KEYS`, used by
  Task 3 to read the operator's configured value.

- [ ] **Step 1: Write the failing tests for `estimateTokens` and `contextWindowTokens`**

```ts
// ai/src/lib/tokenBudget.test.ts
import { describe, expect, it } from 'vitest';
import { contextWindowTokens, estimateTokens } from './tokenBudget.js';

describe('estimateTokens', () => {
  it('is about one token per 3.5 characters, rounded up', () => {
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('a'.repeat(36))).toBe(11);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('contextWindowTokens', () => {
  it('uses the operator value for local/remote, or the 8,192 default when unset', () => {
    expect(contextWindowTokens({ kind: 'local', context: null } as never)).toBe(8192);
    expect(contextWindowTokens({ kind: 'remote', context: 40_960 } as never)).toBe(40_960);
  });
  it('ignores a configured context for claude/openai and uses the cloud default', () => {
    expect(contextWindowTokens({ kind: 'claude', context: 8192 } as never)).toBe(100_000);
    expect(contextWindowTokens({ kind: 'openai', context: null } as never)).toBe(100_000);
  });
});
```

- [ ] **Step 2: Run and verify both fail** (`npx vitest run ai/src/lib/tokenBudget.test.ts` — module not found)

- [ ] **Step 3: Add `DEFAULT_LOCAL_CONTEXT_TOKENS`, `DEFAULT_CLOUD_CONTEXT_TOKENS`, `CONDENSE_THRESHOLD` to `ai/src/consts/index.ts`**,
      next to the other `DEFAULT_*` constants, each with a one-line comment giving its source (8,192: Ollama's
      measured default, QUALITY-VALIDATION.md 2026-11-21; 100,000: conservative against Claude/OpenAI's real,
      much larger windows; 0.7: the spec's own "over about 70% takes the chunked path").

- [ ] **Step 4: Implement `estimateTokens` and `contextWindowTokens` in `ai/src/lib/tokenBudget.ts`**,
      importing the three constants from Task 3's step. `contextWindowTokens` takes the whole `llm` settings
      object (not separate args) so later callers don't have to destructure it themselves.

- [ ] **Step 5: Run and verify both pass**

- [ ] **Step 6: Write the failing settings tests**

```ts
// shared/src/lib/aiSettings.test.ts (new cases alongside the existing ai.llm.price-in ones)
it('sets and clears ai.llm.context', () => {
  let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', '40960');
  expect(s.llm.context).toBe(40960);
  s = setAiSetting(s, 'ai.llm.context', 'none');
  expect(s.llm.context).toBeNull();
});
it('rejects a non-numeric or negative ai.llm.context', () => {
  expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', '-1')).toThrow(SettingError);
  expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', 'lots')).toThrow(SettingError);
});
```

- [ ] **Step 7: Run and verify both fail**

- [ ] **Step 8: Add the setting.** In `shared/src/types/aiSettings.ts`, add `context: number | null` to the
      `llm` field (alongside `priceIn`/`priceOut`), with a doc comment: tokens the local or remote server
      actually exposes (`OLLAMA_CONTEXT_LENGTH` or equivalent); ignored for `claude`/`openai`. In
      `shared/src/lib/aiSettings.ts`: add `context: null` to `DEFAULT_AI_SETTINGS.llm`; add
      `'ai.llm.context': 'tokens the local or remote server exposes (e.g. 40960), or "none" for the 8,192 default; ignored for claude/openai'`
      to `AI_SETTING_KEYS`; add a `case 'ai.llm.context':` using the same `parsePrice`-style pattern but allowing
      only non-negative integers (write a small `parseContext` alongside `parsePrice`, since a token count is a
      whole number and a price is not).

- [ ] **Step 9: Run and verify both pass**

- [ ] **Step 10: Add `ai.llm.context` to the CLI's settings display**, in `backend/src/cli/admin.ts`, in the
      same block that already prints `ai.llm.price-in`/`price-out`. One line, same format as those two. Add a
      test in `backend/src/cli/admin.test.ts` mirroring the existing price-in/out assertions.

- [ ] **Step 11: Run `npx vitest run ai/src/lib/tokenBudget.test.ts shared/src/lib/aiSettings.test.ts backend/src/cli/admin.test.ts` and verify all pass**

- [ ] **Step 12: Commit**

```bash
git add ai/src/lib/tokenBudget.ts ai/src/lib/tokenBudget.test.ts ai/src/consts/index.ts \
  shared/src/types/aiSettings.ts shared/src/lib/aiSettings.ts shared/src/lib/aiSettings.test.ts \
  backend/src/cli/admin.ts backend/src/cli/admin.test.ts
git commit -m "feat(ai): token budget estimate and the ai.llm.context setting"
```

---

### Task 2: A token-aware condense trigger in `summarise.ts`

**Files:**

- Modify: `ai/src/lib/summarise.ts` (`takeNotes`'s per-stretch cap loop, `writeFromNotes`'s condense loop)
- Test: `ai/src/lib/summarise.test.ts` (or `pipeline.test.ts`, wherever the existing condense-loop tests live)

**Interfaces:**

- Consumes: `estimateTokens`, `contextWindowTokens` (Task 1); `CONDENSE_THRESHOLD` (Task 1).
- Consumes: `NotesOptions.maxWords` (today's per-chapter cap sharing, unchanged) and adds
  `NotesOptions.llm?: AiSettings['llm']` and `SummariseOptions.llm?: AiSettings['llm']` — when given, the
  token check runs; when omitted, behaviour is unchanged (existing callers/tests that don't pass it keep
  working, satisfying the Review Focus item on a server with nothing configured — note the _fallback inside
  `contextWindowTokens`_ already covers "configured but not overridden"; this optional field covers "caller
  didn't wire it at all yet", which stays true until Task 3 updates the one real caller).
- Produces: the condense loop in `writeFromNotes` now keeps shortening until
  `estimateTokens(notes.join('\n\n')) <= contextWindowTokens(llm) * CONDENSE_THRESHOLD`, instead of
  `notes.join('\n\n').length <= chunkChars`. `groupByBudget`'s packing stays character-based (it only
  decides how notes are grouped for one condense call, not whether condensing is needed) — do not change
  its signature.

- [ ] **Step 1: Write the failing test: one short note never condenses, one oversized note does**

```ts
// a single note already over 70% of a small window condenses even alone
it('condenses even a single oversized note, not only many joined notes', async () => {
  const bigNote = 'word '.repeat(2000); // comfortably over 70% of an 8,192-token window estimate
  const condense = vi.fn(async () => 'word '.repeat(100));
  const result = await writeFromNotes({ scribe: condense, bard: condense }, [bigNote], {
    kind: 'dm-only',
    context: {},
    llm: { kind: 'local', context: null } as never,
  });
  expect(condense).toHaveBeenCalled();
});

it('does not condense when nothing is configured and the notes are small', async () => {
  const condense = vi.fn();
  await writeFromNotes({ scribe: condense, bard: condense }, ['a short note'], {
    kind: 'dm-only',
    context: {},
  });
  expect(condense).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify the first fails** (today's char-based `chunkChars` default, 12,000, would not
      trigger on this note; the token estimate should)

- [ ] **Step 3: Implement the change in `writeFromNotes`** (`ai/src/lib/summarise.ts`): replace
      `if (notes.join('\n\n').length <= chunkChars) break;` with a token check using `options.llm` (default to
      `{ kind: 'local', context: null }` when `options.llm` is undefined, so the fallback window, 8,192, still
      applies — this is what keeps the second test passing: a short note's estimate stays comfortably under
      70% of 8,192). Keep `groupByBudget(notes, chunkChars)` as the packing step inside the loop, unchanged.

- [ ] **Step 4: Apply the same change to `takeNotes`'s per-stretch loop** (the one that already compares
      `notesWords(merged) > cap`): this one is word-based today (yesterday's per-chapter cap sharing) and stays
      word-based — it is not part of this task. Only `writeFromNotes`'s loop changes in this task; note in a
      comment why the two use different units (word cap: a stable, cheap length target set once per chapter;
      token check: the real fit-in-window decision before a single model call).

- [ ] **Step 5: Run and verify both new tests pass, then run the full existing suite for this file**
      (`npx vitest run ai/src/lib/summarise.test.ts ai/src/lib/pipeline.test.ts`) to confirm nothing that relied
      on the old `chunkChars` default broke — if an existing test asserted condensing at a specific character
      count, update it to assert on the token estimate instead (same behaviour, same test intent).

- [ ] **Step 6: Commit**

```bash
git add ai/src/lib/summarise.ts ai/src/lib/summarise.test.ts ai/src/lib/pipeline.test.ts
git commit -m "feat(ai): writeFromNotes condenses by a real token estimate, not a character count"
```

---

### Task 3: Wire the real context window through `processRecording.ts`

**Files:**

- Modify: `ai/src/lib/records/processRecording.ts`
- Modify: `ai/src/lib/records/processRecording.test.ts`

**Interfaces:**

- Consumes: `options.llm` on `NotesOptions`/`SummariseOptions` (Task 2); `settings.llm` is already in scope
  in this file (used today for `settings.transcription.glossary`, `settings.tale.*`).
- Produces: every `takeNotes`/`writeFromNotes` call in this file now passes `{ ..., llm: settings.llm }`,
  so the real operator-configured (or defaulted) window applies everywhere, not just where a test wires it
  by hand.

- [ ] **Step 1: Write the failing test**: a fake scribe that returns oversized notes, with
      `settings.llm.context` set small, should trigger a condense call that a larger configured context would
      not. Add to `processRecording.test.ts` near the existing notes-taking tests, reusing that file's existing
      fake-job-deps pattern.

- [ ] **Step 2: Run and verify it fails** (the call site doesn't pass `llm` yet, so the old default window
      applies regardless of the test's small `settings.llm.context`)

- [ ] **Step 3: Pass `llm: settings.llm` at every `takeNotes`/`writeFromNotes` call site in this file.**
      There are two: inside `notesOf` (wraps `takeNotes`) and inside the per-kind loop (`writeFromNotes`). Both
      already have `settings` in closure scope.

- [ ] **Step 4: Run and verify the new test passes, then run the whole file's suite**
      (`npx vitest run ai/src/lib/records/processRecording.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/records/processRecording.ts ai/src/lib/records/processRecording.test.ts
git commit -m "feat(ai): processRecording passes the operator's real context window to the summary steps"
```

---

### Task 4: Log when a call runs close to the window

**Files:**

- Modify: `ai/src/lib/summarise.ts` (wherever `onUsage`-style reporting already threads through, or add a
  lightweight `onNearFullWindow` option alongside it — check `ai/src/lib/providers/fromSettings.ts`'s
  existing `onUsage` plumbing first and reuse that path rather than inventing a parallel one)
- Modify: `ai/src/lib/records/processRecording.ts` (the `onUsage` callback already wired for cost tracking)
- Test: `ai/src/lib/records/processRecording.test.ts`

**Interfaces:**

- Consumes: the existing `onUsage: (usage: { model; inputTokens; outputTokens }) => void` callback
  (`ai/src/lib/providers/openaiCompat.ts:191`, already wired end to end for Claude/OpenAI cost tracking) and
  `contextWindowTokens` (Task 1).
- Produces: a `deps.log` line (this file already has a `log` function for job progress) of the shape
  `` `recording ${id}: a prompt used ${pct}% of the ${window}-token window` `` whenever
  `inputTokens >= contextWindowTokens(settings.llm) * CONDENSE_THRESHOLD`, visible today via
  `docker compose logs worker` and the validation harness's own log capture — no job-table schema change in
  this task (noted as a deliberate, smaller first step; a `vtt-admin jobs list` column is a natural follow-up,
  not required to close READINESS.md C5).

- [ ] **Step 1: Write the failing test**: an `onUsage` call with `inputTokens` at 95% of a small configured
      window produces exactly one matching log line; one at 50% produces none; one with no `usage` reported at
      all (the callback never fires) produces none and does not throw — covers the Review Focus item on a
      provider that sends no usage data.

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement the check** where the existing `onUsage` callback is defined in
      `processRecording.ts`, next to (not replacing) its existing cost-tracking body.

- [ ] **Step 4: Run and verify it passes**

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/records/processRecording.ts ai/src/lib/records/processRecording.test.ts
git commit -m "feat(ai): log when a summary call runs close to the context window"
```

---

### Task 5: Pace the chapter-notes concurrency and log its progress

**Files:**

- Modify: `ai/src/lib/records/processRecording.ts` (the chapter notes `Promise.all`, found today:
  `chapters.map(async (c) => ({ title, notes: await notesOf(c.subject, c.utterances, c.context, chapterMaxWords) }))`)
- Test: `ai/src/lib/records/processRecording.test.ts`

**Interfaces:**

- Produces: no new exported name — a small inline concurrency limiter is enough (this codebase has no
  `p-limit` dependency and none is needed for a fixed, small cap). A `const CHAPTER_CONCURRENCY = 2;`
  constant in this file, with a one-line comment: found 2026-11-22, 10 chapters fired at once queued for 13
  minutes with no progress output on a single-GPU remote Ollama.
- Consumes: nothing new; this task only changes how the existing `notesOf` calls are scheduled and adds one
  `log(...)` call per completed chapter.

- [ ] **Step 1: Write the failing test**: with `CHAPTER_CONCURRENCY` effectively 2 (either exported for the
      test or verified indirectly), a fake scribe that resolves in call order proves no more than 2 are ever
      in flight at once for, say, 5 chapters (a counter incremented on call-start and decremented on
      call-finish, asserted to never exceed 2). Also assert a log line appears after each chapter completes
      (`"recording X: chapter N notes ready"` or similar, matching this file's existing log-string style).

- [ ] **Step 2: Run and verify it fails** (today's `Promise.all` runs all of them at once)

- [ ] **Step 3: Replace the `Promise.all(chapters.map(...))` with a small batching loop** (process
      `CHAPTER_CONCURRENCY` chapters at a time via `Promise.all` on each batch, in a `for` loop over chunks of
      `chapters`), logging one line per completed chapter as each batch settles. Keep the result shape (an array
      of `{ title, notes }` in the original chapter order) identical — this is purely a scheduling change.

- [ ] **Step 4: Run and verify the test passes, then run the whole file's suite**

- [ ] **Step 5: Commit**

```bash
git add ai/src/lib/records/processRecording.ts ai/src/lib/records/processRecording.test.ts
git commit -m "fix(ai): pace chapter notes-taking instead of firing them all at once, with progress logging"
```

---

### Task 6: The operator's lever — `OLLAMA_CONTEXT_LENGTH` and docs

**Files:**

- Modify: `infra/compose/compose.yml` (the `ollama` service's `environment:`)
- Modify: `infra/compose/remote-ai/compose.yml` (the same, for the remote-GPU variant)
- Modify: `docs/guides/OPERATOR-GUIDE.md` (the settings table, near `ai.llm.length` per the existing entry)

**Interfaces:** none (Compose and documentation only; no code).

- [ ] **Step 1: Add `OLLAMA_CONTEXT_LENGTH: ${OLLAMA_CONTEXT_LENGTH:-}` to both compose files' `ollama`
      service**, matching the existing style for other optional passthrough env vars in those files (e.g.
      `RECORD_SOUNDBOARD`), so it is unset (Ollama's own default) unless the operator puts it in `.env`.

- [ ] **Step 2: Document it in OPERATOR-GUIDE.md**, next to `ai.llm.length`: two steps to raise the window —
      `OLLAMA_CONTEXT_LENGTH` in `.env` (raises what Ollama actually serves, at a VRAM/speed cost) **and**
      `vtt-admin settings set ai.llm.context <same number>` (tells the app what that real window is, since the
      OpenAI-compatible API cannot ask Ollama for it) — both are needed, and a mismatch between them is safe
      (whichever is smaller just limits conservatively) but wastes either VRAM or headroom.

- [ ] **Step 3: Commit**

```bash
git add infra/compose/compose.yml infra/compose/remote-ai/compose.yml docs/guides/OPERATOR-GUIDE.md
git commit -m "docs(infra): document and wire the OLLAMA_CONTEXT_LENGTH operator lever"
```

---

## Self-review

1. **Spec coverage:** point 1 (token budget) → Task 1/2; point 2 (whole-session cap via condense) → Task 2/3
   (reuses the existing condense loop rather than building a new mechanism, per Andy's decision); point 3
   (map-reduce tale) → deliberately not built as a separate mechanism (decided: the condense loop already
   satisfies the "no single prompt holds the whole session" goal); point 4 (Chronicler/memory read condensed
   notes) → already true today (both read `notes`, which Task 2/3 make token-aware); point 5 (detect
   truncation) → Task 4 (a lighter, log-only version — a `vtt-admin jobs list` column is a follow-up, not a
   gap in this plan's own scope); point 6 (operator lever) → Task 6.
2. **Step scan:** each code step names the exact file, the exact signature or line, and the test that proves
   it; no step says "handle edge cases" without a concrete one.
3. **Type consistency:** `NotesOptions.llm` / `SummariseOptions.llm` (Task 2) is the same `AiSettings['llm']`
   shape produced in Task 1 and consumed as `settings.llm` in Task 3 — one type, one name, throughout.
4. **Review Focus:** all five items map to a task and a named test (listed inline above); none were added
   without a step.
5. **Proportion:** six tasks for a six-point spec plus one new finding (pacing), each a few steps; no task
   duplicates another's work.
