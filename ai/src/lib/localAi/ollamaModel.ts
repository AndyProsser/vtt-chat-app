/** The two Ollama calls the worker needs to keep the summary model present: "is it there?" and "fetch it". */

const CHECK_TIMEOUT_MS = 10_000;

const trim = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

/** Whether the local Ollama already has `model`. Throws when Ollama does not answer. */
export async function ollamaHasModel(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(`${trim(baseUrl)}/api/tags`, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ollama answered ${response.status}`);
  const body = (await response.json()) as { models?: { name?: unknown; model?: unknown }[] };
  // Ollama lists a model pulled without a tag as "<name>:latest".
  const wanted = model.includes(':') ? model : `${model}:latest`;
  return (body.models ?? []).some((m) => m.name === wanted || m.model === wanted);
}

/**
 * What `model` is actually being served right now, from `GET /api/ps` (models currently loaded). `undefined`
 * when the model isn't in the list — not loaded, not an error. Throws only when the request itself fails.
 */
export async function getOllamaRunningContext(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  const response = await fetchImpl(`${trim(baseUrl)}/api/ps`, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ollama answered ${response.status}`);
  const body = (await response.json()) as {
    models?: { name?: unknown; model?: unknown; context_length?: unknown }[];
  };
  const wanted = model.includes(':') ? model : `${model}:latest`;
  const found = (body.models ?? []).find((m) => m.name === wanted || m.model === wanted);
  return typeof found?.context_length === 'number' ? found.context_length : undefined;
}

/**
 * `model`'s own trained maximum context, from `POST /api/show` — static model metadata, answerable without
 * loading or generating anything, so safe to call routinely. `undefined` when `model_info` has no
 * `<family>.context_length` key (the family prefix varies per model, so this matches by suffix). Throws
 * only when the request itself fails.
 */
export async function getOllamaModelMaxContext(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | undefined> {
  const response = await fetchImpl(`${trim(baseUrl)}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ollama answered ${response.status}`);
  const body = (await response.json()) as { model_info?: Record<string, unknown> };
  const key = Object.keys(body.model_info ?? {}).find((k) => k.endsWith('.context_length'));
  const value = key ? body.model_info?.[key] : undefined;
  return typeof value === 'number' ? value : undefined;
}

export interface PullOptions {
  /** Called with 0 to 100 as the download advances (many times a second; throttle in the caller). */
  onProgress?: (percent: number) => void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Asks Ollama to download `model` and resolves when it is there. Ollama streams one JSON object per line: layer
 * progress (`digest`, `total`, `completed`), then `{"status":"success"}`, or `{"error":"..."}`. The built-in
 * fetch gives up when the stream is silent for five minutes, which is how a stalled download ends (and is retried).
 */
export async function pullOllamaModel(
  baseUrl: string,
  model: string,
  options: PullOptions = {},
): Promise<void> {
  const response = await (options.fetchImpl ?? fetch)(`${trim(baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`ollama refused to pull ${model} (status ${response.status})`);
  }

  const layers = new Map<string, { total: number; completed: number }>();
  let finished = false;
  const onLine = (line: string): void => {
    if (line.trim() === '') return;
    const message = JSON.parse(line) as {
      status?: unknown;
      error?: unknown;
      digest?: unknown;
      total?: unknown;
      completed?: unknown;
    };
    if (typeof message.error === 'string') {
      throw new Error(`ollama could not pull ${model}: ${message.error}`);
    }
    if (message.status === 'success') finished = true;
    if (typeof message.digest === 'string' && typeof message.total === 'number') {
      layers.set(message.digest, {
        total: message.total,
        completed: typeof message.completed === 'number' ? message.completed : 0,
      });
      let total = 0;
      let completed = 0;
      for (const layer of layers.values()) {
        total += layer.total;
        completed += layer.completed;
      }
      if (total > 0) options.onProgress?.(Math.min(100, Math.floor((completed / total) * 100)));
    }
  };

  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(onLine);
  }
  onLine(pending + decoder.decode());
  if (!finished) throw new Error(`ollama stopped before ${model} was downloaded`);
}
