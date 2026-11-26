# AI Summary Pipeline Reliability — Interim Fix (0.6.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the records/summary pipeline from burning hours of local-CPU compute on a job that
can't realistically finish, and stop misreporting a remote model's own abort as "the server is
unreachable."

**Architecture:** Two real root causes (a hardcoded 60-minute timeout that's the only backstop on
a local Ollama call; a repeat-limit abort misclassified as "unreachable") get narrow, independent
fixes. A new per-job size gate, computed from recording duration before providers are built,
stops local-CPU fallback from ever being attempted on a job too big to finish. A shorter local
timeout and smaller default chunks add defense in depth. A deliberately-flagged prompt change
trims what the scribe is asked to produce, which directly shortens generation time.

**Tech Stack:** TypeScript (`ai/`, `shared/`, `backend/`), Vitest.

**Spec:** [docs/superpowers/specs/2026-11-26-ai-pipeline-reliability-design.md](../specs/2026-11-26-ai-pipeline-reliability-design.md)

## Global Constraints

- CLAUDE.md §5: the documented "wait forever" behaviour when an operator sets
  `ai.fallback.enabled = false` must not change — that path never has a fallback function at all,
  regardless of this plan's new gate.
- CLAUDE.md §5: Whisper-on-CPU transcription fallback is unaffected; the new size gate applies
  only to the LLM (`generate`/`story`) roles, never to `transcribe`.
- `ai/src/lib/providers/failover.ts` is not modified by this plan — every fix reuses its existing
  `fallbackAfterMs` wait-then-switch behaviour; only what a job's fallback slot holds changes.
- Monorepo: `ai/` and `backend/` consume `@vtt-chat-app/shared` via compiled `dist/`. Any task that
  changes `shared/` ends with `npm run build -w shared` before a later task's tests can see it.
- LF line endings; existing ESLint/Prettier conventions apply as usual.

## Review Focus

- A recording with `stoppedAt === null` reaching `processRecording` (shouldn't happen for a job
  that's processing, but the code must fail safe — treat duration as unknown and disallow local
  fallback — rather than produce `NaN` or throw on the subtraction). Task 6.
- `ai.fallback.max-local-minutes` set to `0`: must mean "local fallback is never allowed" (except
  a literally zero-duration recording), not be read as "no limit." Task 4.
- A chunk that aborts on repeat-limit on its retry too, several chunks into a multi-chunk
  `takeNotes` run (not chunk 0): the final error must name the right part index, not always "part
  1." Task 3.
- `llmFallbackAllowed: false` together with `ai.fallback.enabled` globally `false`: must still hit
  the existing "wait forever" path (no fallback function of either kind), never the new "too
  large" throw. Task 5.
- The repeat-limit detector must not swallow an ordinary, unrelated 5xx ("busy", "bad gateway")
  into the wrong bucket — a real outage must still classify as `ProviderUnavailableError` so
  failover can act on it. Task 1.

---

## Task 1: A shared "the model aborted" detector, used where classification happens

**Files:**
- Create: `ai/src/lib/providers/errors.test.ts`
- Modify: `ai/src/lib/providers/errors.ts`
- Modify: `ai/src/lib/providers/openaiCompat.ts`
- Modify: `ai/src/lib/fitNotes.ts`
- Test: `ai/src/lib/providers/providers.test.ts`, `ai/src/lib/fitNotes.test.ts` (existing, must stay green)

**Interfaces:**
- Produces: `isModelAbortMessage(message: string): boolean`, exported from
  `ai/src/lib/providers/errors.ts`. True for text matching `/repeat limit|prediction aborted/i`
  (the exact pattern `fitNotes.ts` already uses as a local, unexported `isRepeatAbort`).
- Consumes: nothing new. Task 3 will import this same export.

- [ ] **Step 1: Write the failing tests for `isModelAbortMessage`**

```ts
import { describe, expect, it } from 'vitest';
import { isModelAbortMessage } from './errors.js';

describe('isModelAbortMessage', () => {
  it('recognises Ollama\'s own wording for a model that aborted on its own output', () => {
    expect(isModelAbortMessage('prediction aborted, token repeat limit reached')).toBe(true);
    expect(isModelAbortMessage('model runner has unexpectedly stopped: repeat limit')).toBe(true);
  });
  it('is false for an ordinary failure, so a real outage keeps its own classification', () => {
    expect(isModelAbortMessage('fetch failed')).toBe(false);
    expect(isModelAbortMessage('busy')).toBe(false);
    expect(isModelAbortMessage('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w ai -- errors.test.ts`
Expected: FAIL — `isModelAbortMessage` is not exported from `errors.ts`.

- [ ] **Step 3: Implement `isModelAbortMessage` in `ai/src/lib/providers/errors.ts`**

Export `export function isModelAbortMessage(message: string): boolean` using exactly the regex
`fitNotes.ts`'s local `isRepeatAbort` already uses (`/repeat limit|prediction aborted/i`), with a
one-line comment explaining what it's for (the thing Ollama throws when it gives up on its own
generation, distinct from the server being unreachable).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w ai -- errors.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `openaiCompat.ts`'s classification**

In `providers.test.ts`, inside `describe('createOpenAiGenerate', ...)`, add:

```ts
it('treats a repeat-limit abort as the model\'s own problem, not "unreachable"', async () => {
  const fetchImpl = vi.fn(async () =>
    json({ error: 'model runner has unexpectedly stopped: prediction aborted, token repeat limit reached' }, 500),
  );
  const generate = createOpenAiGenerate({ baseUrl: 'http://x', model: 'm', fetchImpl: asFetch(fetchImpl) });
  const error = await generate('p').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ProviderUnavailableError);
  expect((error as Error).message).toMatch(/repeat limit/);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -w ai -- providers.test.ts`
Expected: FAIL — today every 5xx becomes `ProviderUnavailableError`.

- [ ] **Step 7: Implement the classification change in `openaiCompat.ts`'s `post()`**

After computing `detail` (the response body text) for a non-ok response: if
`isModelAbortMessage(detail)`, throw `new Error(message)` (the same `message` string already
built) unconditionally — before the existing `isTransientStatus(response.status) ? ... : ...`
branch, so it takes priority over the status-code check.

- [ ] **Step 8: Run to verify it passes, and that ordinary 5xx classification is unchanged**

Run: `npm test -w ai -- providers.test.ts`
Expected: PASS, including the existing `it.each([408, 429, 500, 502, 503])('treats HTTP %i as
unavailable', ...)` case (its body is `{ error: 'busy' }`, which `isModelAbortMessage` does not
match).

- [ ] **Step 9: Point `fitNotes.ts` at the shared detector**

Replace `fitNotes.ts`'s local `isRepeatAbort` function and its regex with an import of
`isModelAbortMessage` from `../providers/errors.js`, used identically everywhere `isRepeatAbort`
was called. No behaviour change.

- [ ] **Step 10: Run to verify `fitNotes.ts`'s existing tests are unaffected**

Run: `npm test -w ai -- fitNotes.test.ts`
Expected: PASS, unchanged — including `'clips a group by code when the model keeps aborting on
it (a repeat-limit abort), and goes on'` and `'does not hide a model that cannot be reached...'`.

- [ ] **Step 11: Run the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add ai/src/lib/providers/errors.ts ai/src/lib/providers/errors.test.ts \
  ai/src/lib/providers/openaiCompat.ts ai/src/lib/providers/providers.test.ts ai/src/lib/fitNotes.ts
git commit -m "fix(ai): stop classifying a model's own repeat-limit abort as 'unreachable'"
```

---

## Task 2: Local Ollama calls keep their real failure detail, and get their own shorter timeout

**Files:**
- Modify: `ai/src/lib/ollama.ts`
- Modify: `ai/src/consts/index.ts`
- Test: `ai/src/lib/pipeline.test.ts` (`describe('createOllamaGenerate', ...)`)

**Interfaces:**
- Produces: `OllamaOptions.timeoutMs?: number` (default: new constant
  `LOCAL_GENERATE_TIMEOUT_MS` from `ai/src/consts/index.ts`); the error thrown on a non-ok
  response now includes the response body's detail text (previously discarded), so
  `isModelAbortMessage` (Task 1) has something to match against for local calls too.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test for surfacing the response detail**

In `pipeline.test.ts`'s `describe('createOllamaGenerate', ...)`:

```ts
it('keeps the real reason in the error, not just the status', async () => {
  const bad = (async () =>
    new Response('model runner has unexpectedly stopped: prediction aborted, token repeat limit reached', {
      status: 500,
    })) as unknown as typeof fetch;
  await expect(createOllamaGenerate({ model: 'm', fetchImpl: bad })('p')).rejects.toThrow(
    /repeat limit/,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w ai -- pipeline.test.ts -t createOllamaGenerate`
Expected: FAIL — today's error is just `"ollama request failed with status 500"`.

- [ ] **Step 3: Implement — capture the response body in the thrown `Error`**

In `createOllamaGenerate`'s non-ok branch, mirror `openaiCompat.ts`'s existing pattern: read
`const detail = (await response.text().catch(() => '')).slice(0, 300);` and include it in the
thrown message, e.g. `` `ollama request failed with status ${response.status}${detail ? `: ${detail}` : ''}` ``.
Confirm the existing `'fails clearly on HTTP errors and malformed bodies'` test (body `'nope'`,
expects `/500/`) still matches — it does, since the new message still contains `500`.

- [ ] **Step 4: Run to verify both pass**

Run: `npm test -w ai -- pipeline.test.ts -t createOllamaGenerate`
Expected: PASS

- [ ] **Step 5: Write the failing test for the dedicated timeout**

```ts
it('gives the fetch a signal, so a call that never resolves can be aborted', async () => {
  let seenSignal: AbortSignal | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seenSignal = init.signal as AbortSignal;
    return new Response(JSON.stringify({ response: 'ok' }), { status: 200 });
  }) as unknown as typeof fetch;
  await createOllamaGenerate({ model: 'm', fetchImpl })('p');
  expect(seenSignal).toBeInstanceOf(AbortSignal);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -w ai -- pipeline.test.ts -t createOllamaGenerate`
Expected: FAIL — `createOllamaGenerate` passes no `signal` today.

- [ ] **Step 7: Add `LOCAL_GENERATE_TIMEOUT_MS` and wire it in**

In `ai/src/consts/index.ts`, add (near the other provider constants):
`export const LOCAL_GENERATE_TIMEOUT_MS = 20 * 60_000;` with a one-line comment: a local CPU call
that hasn't finished in this long is treated as a sign something is already wrong — failing here
costs 20 minutes, not `longFetch`'s full 60.

In `ollama.ts`: add `timeoutMs?: number` to `OllamaOptions`, import the new constant, and add
`signal: AbortSignal.timeout(options.timeoutMs ?? LOCAL_GENERATE_TIMEOUT_MS)` to the `doFetch`
call's `init`.

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -w ai -- pipeline.test.ts -t createOllamaGenerate`
Expected: PASS

- [ ] **Step 9: Run the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add ai/src/lib/ollama.ts ai/src/consts/index.ts ai/src/lib/pipeline.test.ts
git commit -m "fix(ai): local Ollama calls keep their real error detail and get a 20-minute timeout"
```

---

## Task 3: Retry a model-abort once in note-taking, then fail clearly; smaller default chunks

**Files:**
- Modify: `ai/src/lib/summarise.ts`
- Modify: `ai/src/consts/index.ts`
- Test: `ai/src/lib/pipeline.test.ts` (`describe('summarise', ...)`)

**Interfaces:**
- Consumes: `isModelAbortMessage` from Task 1 (`ai/src/lib/providers/errors.js`).
- Produces: no new exports — `takeNotes`'s existing contract is unchanged; only its handling of a
  thrown abort error changes.

- [ ] **Step 1: Write the failing test — retries once, same backend, then succeeds**

```ts
it('retries a model-abort once on the same backend before giving up', async () => {
  let calls = 0;
  const scribe = async (prompt: string): Promise<string> => {
    calls += 1;
    if (calls === 1) throw new Error('prediction aborted, token repeat limit reached');
    return notesOr('notes')(prompt);
  };
  const result = await takeNotes(scribe, manyLines(3), {});
  expect(result.notes[0]).toContain('notes');
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w ai -- pipeline.test.ts -t "retries a model-abort"`
Expected: FAIL — today the first throw propagates straight out of `takeNotes` uncaught.

- [ ] **Step 3: Write the failing test — aborts twice, fails with a clear, specific message**

```ts
it('names the part and the reason when a model-abort recurs, instead of a generic failure', async () => {
  const scribe = async (): Promise<string> => {
    throw new Error('prediction aborted, token repeat limit reached');
  };
  await expect(takeNotes(scribe, manyLines(3), {})).rejects.toThrow(
    /part 1 of 1.*aborted generation/i,
  );
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -w ai -- pipeline.test.ts -t "names the part"`
Expected: FAIL — today's thrown message (when notes are unreadable after `NOTES_READ_ATTEMPTS`)
has different wording, and an abort error isn't caught at all today, so it propagates as the raw
`"prediction aborted..."` message, not one naming the part.

- [ ] **Step 5: Implement the retry-once-then-clear-failure in `takeNotes`**

In `summarise.ts`'s `takeNotes`, wrap the per-chunk prompt call (the `read(prompt)` invocation
inside the `for (const [index, chunk] of chunks.entries())` loop) so that: on
`isModelAbortMessage` matching the thrown error's message, retry the identical `read(prompt)`
call once; if it aborts again, throw
`` new Error(`the scribe's notes for part ${index + 1} of ${chunks.length} could not be written: the model aborted generation (repeat limit) — check its context size or repeat-penalty settings`) ``
instead of letting the raw error propagate. Any other thrown error (not matching
`isModelAbortMessage`) is unaffected — it propagates immediately, exactly as today.

- [ ] **Step 6: Run to verify both pass**

Run: `npm test -w ai -- pipeline.test.ts -t summarise`
Expected: PASS

- [ ] **Step 7: Shrink the default chunk size**

In `ai/src/consts/index.ts`, change `DEFAULT_CHUNK_CHARS` from `12_000` to `6_000`, and update its
doc comment's worked figures (`~12k chars is roughly 3k tokens` → `~6k chars is roughly 1.5k
tokens`) to match, keeping the comment's reasoning about input+output fitting the 8k local
context.

- [ ] **Step 8: Run the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS — no test asserts the old `12_000` value (confirmed by inspection: every test that
cares about chunking passes its own `chunkChars` explicitly).

- [ ] **Step 9: Commit**

```bash
git add ai/src/lib/summarise.ts ai/src/consts/index.ts ai/src/lib/pipeline.test.ts
git commit -m "fix(ai): retry a model-abort once before failing clearly; halve the default chunk size"
```

---

## Task 4: New setting `ai.fallback.max-local-minutes`

**Files:**
- Modify: `shared/src/types/aiSettings.ts`
- Modify: `shared/src/lib/aiSettings.ts`
- Test: `shared/src/lib/aiSettings.test.ts`

**Interfaces:**
- Produces: `AiFallbackSetting.maxLocalMinutes: number` (default `20`), setting key
  `ai.fallback.max-local-minutes` in `AI_SETTING_KEYS`.
- Consumed by: Task 6 (`processRecording.ts` reads `settings.fallback.maxLocalMinutes`).

- [ ] **Step 1: Write the failing tests**

In `aiSettings.test.ts`, near the other `ai.fallback.*` tests:

```ts
it('defaults ai.fallback.max-local-minutes to 20', () => {
  expect(DEFAULT_AI_SETTINGS.fallback.maxLocalMinutes).toBe(20);
});

it('sets ai.fallback.max-local-minutes', () => {
  const next = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.fallback.max-local-minutes', '45');
  expect(next.fallback.maxLocalMinutes).toBe(45);
});

it('rejects ai.fallback.max-local-minutes below 1', () => {
  expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.fallback.max-local-minutes', '0')).toThrow(
    SettingError,
  );
});

it('normalises a missing or junk ai.fallback.max-local-minutes to the default', () => {
  expect(normaliseAiSettings({ fallback: {} }).fallback.maxLocalMinutes).toBe(20);
  expect(
    normaliseAiSettings({ fallback: { maxLocalMinutes: 'lots' } }).fallback.maxLocalMinutes,
  ).toBe(20);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w shared -- aiSettings.test.ts`
Expected: FAIL — the field, key and cases do not exist yet.

- [ ] **Step 3: Implement**

`aiSettings.ts` (types): add `maxLocalMinutes: number;` to `AiFallbackSetting`, with a one-line
doc comment ("the longest recording the LLM may fall back to the local model for; above it, if
remote is unavailable, the job fails instead of running on CPU").

`aiSettings.ts` (lib): add `maxLocalMinutes: 20` to `DEFAULT_AI_SETTINGS.fallback`; add
`'ai.fallback.max-local-minutes': 'whole number of minutes, at least 1'` to `AI_SETTING_KEYS`; add
a `case 'ai.fallback.max-local-minutes':` in `setAiSetting` using
`next.fallback.maxLocalMinutes = parseSeconds(value, 1);` (the existing helper already validates
"whole number, at least N" — its name is specific to seconds elsewhere, but its behaviour is
exactly what's needed here too); add `maxLocalMinutes: int(f.maxLocalMinutes,
d.fallback.maxLocalMinutes, 1)` to `normaliseAiSettings`'s `fallback` block.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w shared -- aiSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Run the whole `shared` suite, then build it**

Run: `npm test -w shared && npm run build -w shared`
Expected: PASS, then a successful build (dependents read `shared`'s compiled `dist/`, not its
source).

- [ ] **Step 6: Commit**

```bash
git add shared/src/types/aiSettings.ts shared/src/lib/aiSettings.ts shared/src/lib/aiSettings.test.ts
git commit -m "feat(shared): add ai.fallback.max-local-minutes, the size gate for local LLM fallback"
```

---

## Task 5: Size-gated LLM fallback in `buildJobProviders`

**Files:**
- Modify: `ai/src/lib/providers/fromSettings.ts`
- Test: `ai/src/lib/providers/fromSettings.test.ts`

**Interfaces:**
- Consumes: new `ProviderDeps.llmFallbackAllowed?: boolean` (default `true` when omitted, so
  every existing caller and test that never sets it keeps today's behaviour exactly).
- Produces: behaviour change only, inside `role()`.

- [ ] **Step 1: Write the failing test — too large, remote down, fails instead of using local**

In `fromSettings.test.ts`:

```ts
it('fails instead of falling back to local when the job is too large for it', async () => {
  const settings = setAiSetting(remote(), 'ai.fallback.after-seconds', '0');
  const onFallback = vi.fn();
  const p = buildJobProviders(settings, {
    ...base,
    llmFallbackAllowed: false,
    onFallback,
    fetchImpl: (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch,
  });
  await expect(p.generate.call('prompt')).rejects.toThrow(/too large|max-local-minutes/i);
  expect(localGenerate).not.toHaveBeenCalled();
  expect(onFallback).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w ai -- fromSettings.test.ts`
Expected: FAIL — `llmFallbackAllowed` doesn't exist yet; today this falls back to local and
succeeds, and `onFallback` is called.

- [ ] **Step 3: Write the failing test — a small job (the default) is unaffected**

```ts
it('still falls back to local when the job is small enough (the default)', async () => {
  const settings = setAiSetting(remote(), 'ai.fallback.after-seconds', '0');
  const p = buildJobProviders(settings, {
    ...base,
    fetchImpl: (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch,
  });
  expect(await p.generate.call('prompt')).toBe('local summary');
});
```

- [ ] **Step 4: Run to verify it currently passes (it should — this pins today's behaviour as the no-op default) and the Step 1 test still fails**

Run: `npm test -w ai -- fromSettings.test.ts`
Expected: the Step 3 test PASSes already; the Step 1 test still FAILs.

- [ ] **Step 5: Implement `role()`'s gate in `fromSettings.ts`**

Add `llmFallbackAllowed` to `ProviderDeps` (optional `boolean`). In `buildJobProviders`, read
`const llmFallbackAllowed = deps.llmFallbackAllowed ?? true;` near the other destructured
options. Change `role()`:

```ts
const tooLarge = async (): Promise<string> => {
  throw new Error(
    'the recording is too long to fall back to the local model (ai.fallback.max-local-minutes); configure a remote LLM or wait for it to come back',
  );
};
const role = (local: GenerateText, remote: GenerateText | undefined): Failover<string, string> =>
  remote
    ? createFailover(remote, fallback.enabled ? (llmFallbackAllowed ? local : tooLarge) : undefined, {
        ...timing,
        ...(llmFallbackAllowed
          ? { onFallback: (reason: string) => deps.onFallback?.('llm', reason) }
          : {}),
      })
    : createFailover(local, undefined, timing);
```

Leaving `onFallback` out entirely when `llmFallbackAllowed` is false matters: `createFailover`
fires it whenever it switches to *whichever* function is in the fallback slot, so without this it
would log "llm fell back to local" (and record local as used) for a job that never actually ran
locally.

- [ ] **Step 6: Run to verify both new tests pass, and nothing else in the file breaks**

Run: `npm test -w ai -- fromSettings.test.ts`
Expected: PASS, all tests — including every existing one, none of which sets
`llmFallbackAllowed`.

- [ ] **Step 7: Commit**

```bash
git add ai/src/lib/providers/fromSettings.ts ai/src/lib/providers/fromSettings.test.ts
git commit -m "feat(ai): gate LLM fallback-to-local on whether this job is small enough for it"
```

---

## Task 6: Wire the gate from recording duration in `processRecording.ts`

**Files:**
- Modify: `ai/src/lib/records/processRecording.ts`
- Test: `ai/src/lib/records/processRecording.test.ts`

**Interfaces:**
- Consumes: `settings.fallback.maxLocalMinutes` (Task 4), `ProviderDeps.llmFallbackAllowed`
  (Task 5).

- [ ] **Step 1: Write the failing test — a recording too long for local fails cleanly**

In `processRecording.test.ts`, alongside the existing `'uses the remote backend named in the
settings and falls back to local when it is down'` test:

```ts
it('fails instead of grinding on local CPU when the recording is too long for it', async () => {
  await records.putRecording({ ...recording, stoppedAt: 30 * 60_000 }); // a 30-minute recording
  records.aiSettings = setAiSetting(
    setAiSetting(
      setAiSetting(
        setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'remote'),
        'ai.llm.url',
        'http://gpu:11434',
      ),
      'ai.fallback.after-seconds',
      '0',
    ),
    'ai.fallback.max-local-minutes',
    '10', // the recording (30 min) is well over this
  );
  const log: string[] = [];
  const h = handler({
    log: (l) => log.push(l),
    buildProviders: (settings, d) =>
      buildJobProviders(settings, {
        ...d,
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      }),
  });
  await expect(h.run(job())).rejects.toThrow(/too long|max-local-minutes/i);
  expect(log.join('\n')).not.toContain('fell back to local');
  expect(prompts).toHaveLength(0); // local was never actually asked to summarise
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w ai -- processRecording.test.ts -t "too long for it"`
Expected: FAIL — today this recording would fall back to local and succeed, same as the existing
"falls back to local when it is down" test.

- [ ] **Step 3: Implement the gate in `processRecording.ts`**

Right after `await deps.records.setRecordingStatus(recording.id, 'processing');` and before
`build(settings, {...})` is called, add:

```ts
// How long this is allowed to grind on local CPU for the LLM (never Whisper — see CLAUDE.md §5):
// unknown duration (stoppedAt somehow still null) fails safe, same as "too long".
const durationMinutes =
  recording.stoppedAt !== null
    ? (recording.stoppedAt - recording.startedAt) / 60_000
    : Number.POSITIVE_INFINITY;
const llmFallbackAllowed = durationMinutes <= settings.fallback.maxLocalMinutes;
```

Add `llmFallbackAllowed` to the options object passed to `build(settings, {...})`.

- [ ] **Step 4: Run to verify the new test passes**

Run: `npm test -w ai -- processRecording.test.ts -t "too long for it"`
Expected: PASS

- [ ] **Step 5: Run the existing fallback test and the whole file**

Run: `npm test -w ai -- processRecording.test.ts`
Expected: PASS — the existing `'uses the remote backend named in the settings and falls back to
local when it is down'` test's fixture recording (`stoppedAt: 10` — effectively instant) is far
under the default `maxLocalMinutes` (20), so it keeps falling back exactly as before.

- [ ] **Step 6: Run the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add ai/src/lib/records/processRecording.ts ai/src/lib/records/processRecording.test.ts
git commit -m "feat(ai): compute whether this recording is small enough for local LLM fallback"
```

---

## Task 7: Surface the setting in `vtt-admin settings`

**Files:**
- Modify: `backend/src/cli/admin.ts`
- Test: `backend/src/cli/admin.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Find the existing test(s) asserting the `ai.fallback.*` rows appear in `vtt-admin settings`
output (same section as `ai.fallback.enabled`, `ai.fallback.after-seconds`,
`ai.fallback.retry-seconds`) and add `ai.fallback.max-local-minutes` with its default (`20`) to
the expected rows.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w backend -- admin.test.ts`
Expected: FAIL — the row is missing.

- [ ] **Step 3: Implement**

In `settingValues()`, add `['ai.fallback.max-local-minutes', String(s.ai.fallback.maxLocalMinutes)],`
next to the other `ai.fallback.*` rows. `SETTING_SECTIONS`'s `'Fallback to local AI'` predicate
(`k.startsWith('ai.fallback.')`) already matches it — no change needed there.

- [ ] **Step 4: Run to verify it passes, and check for a column-width ripple**

Run: `npm test -w backend -- admin.test.ts`
Expected: PASS. `ai.fallback.max-local-minutes` (27 characters) is shorter than the current
longest key (`ai.processing.cpu-threshold-percent`, 36 characters), so the table's column width
should be unaffected — but if any other exact-spacing assertion in this file still breaks, dump
the actual rendered text with a temporary `console.log(JSON.stringify(text))` (as done for the
`ai.processing.*` additions earlier) to see the real spacing before re-pinning any string.

- [ ] **Step 5: Run the whole `backend` suite**

Run: `npm test -w backend`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/cli/admin.ts backend/src/cli/admin.test.ts
git commit -m "feat(backend): surface ai.fallback.max-local-minutes in vtt-admin settings"
```

---

## Task 8: Tighten the scribe's note-taking prompt toward impactful events

**Files:**
- Modify: `ai/src/lib/prompts.ts`
- Test: `ai/src/lib/pipeline.test.ts` (the `describe('prompts', ...)` block, existing)

**Interfaces:** none new — wording only, inside `buildNotesPrompt`.

This task has no new mechanical assertion to write first (a prompt's wording can't be proven
right by a unit test the way code can) — its contract is "the instructions change, and every
existing pinned substring the current tests check for stays present." Treat the existing tests
as the gate: red if the edit drops something they check, green once it doesn't.

- [ ] **Step 1: Confirm what's currently pinned**

Re-read `pipeline.test.ts`'s `'asks the scribe for the record and the bard for the tale'` test
(the one exercising `buildNotesPrompt`). It requires the result to match `/one bullet per thing/`
and `/fumbles/`, and to contain `## Memorable quotes`, the Game Master line, and the transcript
line. None of these are in the instructions being changed below, but note them before editing so
the edit is written around them, not discovered to have broken them afterward.

- [ ] **Step 2: Run the existing test as a baseline**

Run: `npm test -w ai -- pipeline.test.ts -t "asks the scribe"`
Expected: PASS (baseline, before any edit).

- [ ] **Step 3: Edit `buildNotesPrompt`'s instruction list in `prompts.ts`**

Replace these two lines:
- `'Write a summary of events and actions, not a line-by-line retelling: these notes must end up noticeably shorter than the transcript above. Merge a back-and-forth about one small thing into a single line, and leave out table talk that is not part of the game. Never drop a distinct event, decision, roll that mattered, or quote to save space; shorten the telling of it instead.'`
- `'Keep the small things as well as the big ones: a failed roll, a bad idea, a plan that went wrong, a joke or a boast made in character, a lucky escape. A line is still worth keeping even when it is brief.'`

with wording that prioritises what's consequential over exhaustiveness: turning points, decisions
with consequences, named NPCs/places/items, memorable lines, and dice results that mattered
(critical hits, natural ones, fumbles — keep "fumbles" as a literal word so the existing test
still matches), while explicitly allowing routine or minor beats to be condensed to one line or
left out rather than insisting none be dropped. Keep every other instruction (layout, headings,
"one bullet per thing", ground rules, GM/cue/loot rules) unchanged.

Add a one-line code comment directly above the changed lines: this is a deliberate, 0.6.5-only
relaxation of Stage 12 D's "never a weaker fallback" decision, to keep note-taking calls short
enough to finish reliably on local CPU; revisit once the Campaign Graph (0.7+) can be thorough
about facts without needing exhaustive prose.

- [ ] **Step 4: Run to verify the existing test still passes**

Run: `npm test -w ai -- pipeline.test.ts -t "asks the scribe"`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Run the whole `prompts` describe block, then the whole `ai` suite**

Run: `npm test -w ai`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ai/src/lib/prompts.ts
git commit -m "fix(ai): ask the scribe to focus on what's consequential, for 0.6.5's interim bar"
```

---

## Task 9: Docs

**Files:**
- Modify: `CHANGELOG.md`, `docs/BUILD-STATUS.md`, `ROADMAP.md`, `.claude/intent.md`

No tests — documentation only, per CLAUDE.md §17 ("update the relevant doc in the same change as
the code it describes").

- [ ] **Step 1: `CHANGELOG.md`**

Under `## [Unreleased]` → `### Fixed`, add an entry in the project's existing voice: local-CPU
summarisation no longer silently runs for hours on a job too large for it — such a job now fails
cleanly instead, and a remote model aborting on its own output (a "repeat limit") is now reported
as its own distinct problem rather than mistaken for the server being unreachable.

- [ ] **Step 2: `docs/BUILD-STATUS.md`**

Note the new `ai.fallback.max-local-minutes` setting and its default (20 minutes), flagged
explicitly as an untuned starting guess pending real local-CPU throughput data (per the design
doc §8); note the smaller default chunk size (6,000 characters, was 12,000); note the local
generate timeout (20 minutes) alongside the existing 60-minute one.

- [ ] **Step 3: `ROADMAP.md`**

One line under the current stage, in the project's existing one-line-per-stage style, naming this
as the 0.6.5 interim reliability fix (distinct from the Campaign Graph, which stays a 0.7+ item).

- [ ] **Step 4: `.claude/intent.md`**

Add a short note under the open design topics for 0.7+ (the Campaign Graph): the design doc's §7
hints — `NOTE_SECTIONS`/`StructuredNotes` as a ready-made schema seed, `memory.ts`'s flat-entry
carryover as the graph's natural precedent, this fix's smaller chunks as smaller addressable
units for a future chunk-by-chunk extraction pass, and Task 8's prompt relaxation as a stop-gap
specifically worth revisiting once the graph exists — so these survive to when that design
conversation starts, rather than living only in a dated spec file.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/BUILD-STATUS.md ROADMAP.md .claude/intent.md
git commit -m "docs: note the 0.6.5 AI pipeline reliability fix and Campaign Graph hints"
```
