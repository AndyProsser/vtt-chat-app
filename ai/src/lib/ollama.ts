import { DEFAULT_OLLAMA_URL } from '../consts/index.js';
import type { GenerateText } from '../types/index.js';

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  /** Context window to request. Ollama's default is small; a long chunk silently truncates without this. */
  numCtx?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * A `GenerateText` backed by a local Ollama server (the default summariser; nothing leaves the
 * machine). Non-streaming: the job queue wants the whole answer, not tokens.
 */
export function createOllamaGenerate(options: OllamaOptions): GenerateText {
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  return async (prompt) => {
    const response = await doFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        prompt,
        stream: false,
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
