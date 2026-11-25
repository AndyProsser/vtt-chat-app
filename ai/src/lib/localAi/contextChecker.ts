import type { OllamaContextStatus } from '../../types/localAi.js';
import { getOllamaModelMaxContext, getOllamaRunningContext } from './ollamaModel.js';

export interface ContextCheckOptions {
  kind: 'local' | 'remote';
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  now?: () => number;
  /**
   * For `remote` only: when the model is not loaded, load it (an empty request that generates nothing, kept for
   * `PROBE_KEEP_ALIVE`) so its real window can be read, because Ollama only reports a window for a loaded model and
   * a remote server's window is its own `OLLAMA_CONTEXT_LENGTH`, which nothing else can tell us. Never for `local`:
   * the app sets that window itself on every call.
   */
  probeIfIdle?: boolean;
  /** The last check, so an idle `remote` model's reading is reused (for `LIVE_REUSE_MS`) instead of loading it again. */
  previous?: OllamaContextStatus | null;
}

/** Long enough to read the window straight after loading, short enough not to hold someone's GPU. */
export const PROBE_KEEP_ALIVE = '30s';
/** How long a reading of a remote model's window stays good while the model sits idle: the window only changes when the operator changes it. */
export const LIVE_REUSE_MS = 24 * 3_600_000;
/** Loading a large model from disk can take a while. */
const PROBE_TIMEOUT_MS = 180_000;

async function loadModel(baseUrl: string, model: string, fetchImpl: typeof fetch): Promise<void> {
  try {
    await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: PROBE_KEEP_ALIVE }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    /* a failed load only means no live reading; the caller carries on with what it has */
  }
}

/**
 * A single, pure check of what `model` is actually being served at `baseUrl` (live, from `/api/ps`) and
 * what it is capable of (its trained max, from `/api/show`). Never throws: a request failure on either
 * endpoint resolves `unreachable: true` instead, since "can't tell you" is this check's own normal outcome,
 * not an exceptional one. The caller decides when/how often to call this and what `kind`/`baseUrl`/`model`
 * to pass — this function does no settings-reading of its own.
 */
export async function createOllamaContextChecker(
  options: ContextCheckOptions,
): Promise<OllamaContextStatus> {
  const { kind, baseUrl, model, fetchImpl } = options;
  const now = options.now ?? Date.now;
  const doFetch = fetchImpl ?? fetch;
  const [live, modelMax] = await Promise.allSettled([
    getOllamaRunningContext(baseUrl, model, fetchImpl),
    getOllamaModelMaxContext(baseUrl, model, fetchImpl),
  ]);
  // Unreachable only when *neither* call got through at all; one endpoint failing while the other answers
  // (e.g. a server that implements /api/show but not /api/ps) still yields a real, partial result.
  if (live.status === 'rejected' && modelMax.status === 'rejected') {
    return { kind, model, unreachable: true, checkedAt: now() };
  }
  let liveValue = live.status === 'fulfilled' ? live.value : undefined;
  let liveAt: number | undefined;
  if (options.probeIfIdle && kind === 'remote' && liveValue === undefined) {
    const prev = options.previous;
    const prevAt = prev ? (prev.liveAt ?? prev.checkedAt) : 0;
    if (
      prev?.kind === 'remote' &&
      prev.model === model &&
      prev.live !== undefined &&
      now() - prevAt < LIVE_REUSE_MS
    ) {
      liveValue = prev.live;
      liveAt = prevAt;
    } else {
      await loadModel(baseUrl, model, doFetch);
      liveValue = await getOllamaRunningContext(baseUrl, model, fetchImpl).catch(() => undefined);
    }
  }
  return {
    kind,
    model,
    unreachable: false,
    checkedAt: now(),
    ...(liveValue !== undefined ? { live: liveValue } : {}),
    ...(liveAt !== undefined ? { liveAt } : {}),
    ...(modelMax.status === 'fulfilled' && modelMax.value !== undefined
      ? { modelMax: modelMax.value }
      : {}),
  };
}
