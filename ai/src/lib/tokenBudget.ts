import { DEFAULT_CLOUD_CONTEXT_TOKENS, DEFAULT_LOCAL_CONTEXT_TOKENS } from '../consts/index.js';
import type { AiSettings } from '@vtt-chat-app/shared';

/** A rough token count for a prompt before sending it: characters divided by about 3.5, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * The real window a summary call has to work with: the operator's own setting for a local or remote
 * server (the OpenAI-compatible API cannot ask it directly), or the measured default when unset. Claude
 * and OpenAI ignore any configured value and use a conservative built-in default instead, so a setting
 * left over from switching away from a local/remote backend never shrinks a cloud model's real budget.
 */
export function contextWindowTokens(llm: AiSettings['llm']): number {
  if (llm.kind === 'claude' || llm.kind === 'openai') return DEFAULT_CLOUD_CONTEXT_TOKENS;
  return llm.context ?? DEFAULT_LOCAL_CONTEXT_TOKENS;
}
