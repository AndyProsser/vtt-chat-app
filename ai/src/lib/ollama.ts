import {
  DEFAULT_OLLAMA_URL,
  LOCAL_GENERATE_TIMEOUT_MS,
  SCRIBE_SAMPLING,
  type Sampling,
} from '../consts/index.js';
import type { GenerateText } from '../types/index.js';
import { longFetch } from './longFetch.js';

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  /**
   * Context window to request. Ollama's default is small; a long chunk silently truncates without this. A
   * function is resolved fresh on every call, not once here — so a setting change (`ai.llm.context`) takes
   * effect on the very next request, no restart needed.
   */
  numCtx?: number | (() => Promise<number | undefined>);
  /**
   * How long Ollama keeps the model loaded after this request (e.g. "2m", "0"). Unset: the server's
   * OLLAMA_KEEP_ALIVE. Short keeps an idle server from holding (V)RAM between jobs.
   */
  keepAlive?: string;
  /** How to sample; default the scribe's (low temperature, no presence penalty). Never the model's own defaults. */
  sampling?: Sampling;
  /** How long one call may run before it is aborted. Default {@link LOCAL_GENERATE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * A `GenerateText` backed by a local Ollama server (the default summariser; nothing leaves the
 * machine). Non-streaming: the job queue wants the whole answer, not tokens.
 */
export function createOllamaGenerate(options: OllamaOptions): GenerateText {
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? longFetch;
  const sampling = options.sampling ?? SCRIBE_SAMPLING;

  return async (prompt) => {
    const numCtx = typeof options.numCtx === 'function' ? await options.numCtx() : options.numCtx;
    const timeoutMs = options.timeoutMs ?? LOCAL_GENERATE_TIMEOUT_MS;
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          prompt,
          stream: false,
          // Reasoning models (Qwen3, DeepSeek-R1…) would otherwise think aloud first: minutes of tokens
          // nobody reads. Models that cannot think ignore it.
          think: false,
          ...(options.keepAlive !== undefined ? { keep_alive: options.keepAlive } : {}),
          options: {
            temperature: sampling.temperature,
            presence_penalty: sampling.presencePenalty,
            ...(numCtx ? { num_ctx: numCtx } : {}),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // `AbortSignal.timeout` rejects with a `TimeoutError` whose own message ("The operation was
      // aborted due to timeout") says nothing about which timeout or why — name it, so a job's
      // failure reason is legible without reading this file.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(
          `local Ollama call exceeded its ${Math.round(timeoutMs / 60_000)}-minute timeout (LOCAL_GENERATE_TIMEOUT_MS)`,
          { cause: error },
        );
      }
      throw error;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `ollama request failed with status ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    const body = (await response.json()) as { response?: unknown };
    if (typeof body.response !== 'string') {
      throw new Error('ollama response had no "response" text');
    }
    return body.response;
  };
}
