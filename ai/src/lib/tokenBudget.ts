import { DEFAULT_CLOUD_CONTEXT_TOKENS, DEFAULT_LOCAL_CONTEXT_TOKENS } from '../consts/index.js';
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
 * `fallbackEnabled` (the operator's `ai.fallback.enabled`) clamps every other kind to that same fixed
 * local number too: a job configured for claude/openai/remote can fail over mid-job to the local model,
 * which still only honours its own fixed window regardless of what the call was sized for.
 */
export function contextWindowTokens(llm: AiSettings['llm'], fallbackEnabled = false): number {
  if (llm.kind === 'local') return DEFAULT_LOCAL_CONTEXT_TOKENS;
  const resolved =
    llm.kind === 'claude' || llm.kind === 'openai'
      ? DEFAULT_CLOUD_CONTEXT_TOKENS
      : (llm.context ?? DEFAULT_LOCAL_CONTEXT_TOKENS);
  return fallbackEnabled ? Math.min(resolved, DEFAULT_LOCAL_CONTEXT_TOKENS) : resolved;
}
