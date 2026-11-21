import Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_CLAUDE_MODEL, DEFAULT_PROVIDER_TIMEOUT_MS } from '../../consts/index.js';
import type { GenerateText } from '../../types/index.js';
import { isTransientStatus, ProviderUnavailableError } from './errors.js';

export interface ClaudeOptions {
  apiKey: string;
  /** A Claude model id; default {@link DEFAULT_CLAUDE_MODEL}. */
  model?: string;
  timeoutMs?: number;
  /** Called after every successful call, so the job can add up what it used. */
  onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void;
  /** Injected for tests. */
  client?: Pick<Anthropic, 'messages'>;
}

/** Room for the longest thing a role writes (the notes of a long session, about 3,000 words). */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * A {@link GenerateText} backed by the Claude Messages API (Stage 12 CL), through the official SDK.
 *
 * Roles differ by prompt, not by sampling: Claude's current models take no `temperature`, so none is sent. Thinking
 * runs at low effort (a summary is not hard reasoning, and thinking tokens are billed as output). Failure follows the
 * same rule as any remote: an unreachable or overloaded API, and a refusal, are {@link ProviderUnavailableError}, so
 * the job waits and then finishes on the local model; anything else (a bad key, a bad request) is a plain error.
 */
export function createClaudeGenerate(options: ClaudeOptions): GenerateText {
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    });
  return async (prompt) => {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionError) {
        throw new ProviderUnavailableError('cannot reach the Anthropic API', { cause: error });
      }
      if (error instanceof Anthropic.APIError) {
        const message = `Claude ${error.status ?? ''} ${error.message}`.trim();
        // 529 is Anthropic's "overloaded".
        throw error.status !== undefined &&
          (isTransientStatus(error.status) || error.status === 529)
          ? new ProviderUnavailableError(message, { cause: error })
          : new Error(message, { cause: error });
      }
      throw error;
    }
    options.onUsage?.({
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category ?? 'unspecified';
      throw new ProviderUnavailableError(`Claude declined the request (${category})`);
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (text.trim() === '') {
      throw new Error(
        response.stop_reason === 'max_tokens'
          ? 'Claude ran out of output tokens before writing anything'
          : 'Claude reply had no text',
      );
    }
    return text;
  };
}
