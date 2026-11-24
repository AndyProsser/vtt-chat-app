import type { OllamaContextStatus } from '../../types/localAi.js';
import { getOllamaModelMaxContext, getOllamaRunningContext } from './ollamaModel.js';

export interface ContextCheckOptions {
  kind: 'local' | 'remote';
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
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
  const [live, modelMax] = await Promise.allSettled([
    getOllamaRunningContext(baseUrl, model, fetchImpl),
    getOllamaModelMaxContext(baseUrl, model, fetchImpl),
  ]);
  // Unreachable only when *neither* call got through at all; one endpoint failing while the other answers
  // (e.g. a server that implements /api/show but not /api/ps) still yields a real, partial result.
  if (live.status === 'rejected' && modelMax.status === 'rejected') {
    return { kind, model, unreachable: true };
  }
  return {
    kind,
    model,
    unreachable: false,
    ...(live.status === 'fulfilled' && live.value !== undefined ? { live: live.value } : {}),
    ...(modelMax.status === 'fulfilled' && modelMax.value !== undefined
      ? { modelMax: modelMax.value }
      : {}),
  };
}
