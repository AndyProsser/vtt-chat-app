import { DEFAULT_CLOUD_CONTEXT_TOKENS, DEFAULT_LOCAL_CONTEXT_TOKENS } from '../consts/index.js';
import { CLAUDE_CONTEXT_WINDOWS } from '../consts/claude.js';
import type { AiSettings } from '@vtt-chat-app/shared';

/** A rough token count for a prompt before sending it: characters divided by about 3.5, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * The real window a summary call has to work with: the operator's own setting for a **remote**
 * OpenAI-compatible server (which honours it — the API just can't be asked directly), or the measured
 * default when unset. Claude and OpenAI ignore any configured value and use a conservative built-in
 * default instead, so a setting left over from switching away from a local/remote backend never shrinks
 * a cloud model's real budget. `local` also ignores it: the worker pins a fixed `num_ctx` on every native
 * Ollama call, which a per-request value overrides server-side, so raising `ai.llm.context` for `local`
 * could never actually raise what gets served — trusting it anyway would be the silent-truncation bug
 * this budget exists to prevent, not a smaller version of it.
 *
 * `local` honours `ai.llm.context` too (the worker sends it as `num_ctx` on every native Ollama call, not
 * a fixed 8,192 — see `ai/src/cli/worker.ts`), so this is the one real, operator-set number for `local`,
 * same as `remote`. There is nothing further for `local` to "fail over" to, so `fallbackEnabled` never
 * clamps it: the clamp below only ever narrows a call that might land on `local` through failover, never
 * `local` itself.
 *
 * `fallbackEnabled` (the operator's `ai.fallback.enabled`) clamps every other kind to that same local
 * number: a job configured for claude/openai/remote can fail over mid-job to the local model, which still
 * only honours its own real window (`ai.llm.context`, or the measured default when unset) regardless of
 * what the call was sized for.
 *
 * `claude`'s cloud default is itself per-model where known (`CLAUDE_CONTEXT_WINDOWS`, ai/consts/claude.ts) —
 * a fact about the model, not a setting, so there is nothing for the operator to configure or get wrong.
 * A model this table doesn't know (new, renamed, or no model named) falls back to the flat, conservative
 * cloud default, same as `openai` always does (no table there by design: see the design doc's Non-goals).
 */
export function contextWindowTokens(llm: AiSettings['llm'], fallbackEnabled = false): number {
  if (llm.kind === 'local') return llm.context ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
  const resolved =
    llm.kind === 'claude'
      ? (CLAUDE_CONTEXT_WINDOWS[llm.model ?? ''] ?? DEFAULT_CLOUD_CONTEXT_TOKENS)
      : llm.kind === 'openai'
        ? DEFAULT_CLOUD_CONTEXT_TOKENS
        : (llm.context ?? DEFAULT_LOCAL_CONTEXT_TOKENS);
  return fallbackEnabled ? Math.min(resolved, DEFAULT_LOCAL_CONTEXT_TOKENS) : resolved;
}
