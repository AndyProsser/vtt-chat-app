import { DEFAULT_OLLAMA_URL } from '../consts/index.js';
import type { GenerateText } from '../types/index.js';
import { longFetch } from './longFetch.js';

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  /** Context window to request. Ollama's default is small; a long chunk silently truncates without this. */
  numCtx?: number;
  /**
   * How long Ollama keeps the model loaded after this request (e.g. "2m", "0"). Unset: the server's
   * OLLAMA_KEEP_ALIVE. Short keeps an idle server from holding (V)RAM between jobs.
   */
  keepAlive?: string;
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

  return async (prompt) => {
    const response = await doFetch(`${baseUrl}/api/generate`, {
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
        options: options.numCtx ? { num_ctx: options.numCtx } : undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(`ollama request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { response?: unknown };
    if (typeof body.response !== 'string') {
      throw new Error('ollama response had no "response" text');
    }
    return body.response;
  };
}
