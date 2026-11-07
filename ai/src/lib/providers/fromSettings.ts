import { validateAiSettings, type AiSettings } from '@vtt-chat-app/shared';

import type { GenerateText, Segment, TranscribeWav } from '../../types/index.js';
import { createFailover, type Failover } from './failover.js';
import { createOpenAiGenerate, createOpenAiTranscribe } from './openaiCompat.js';

export interface ProviderDeps {
  /** Secrets come from the environment, never from the database. */
  env?: { WHISPER_API_KEY?: string | undefined; LLM_API_KEY?: string | undefined };
  /** The always-configured local backends: the default, and the fallback for a remote one. */
  localTranscribe: TranscribeWav;
  localGenerate: GenerateText;
  /** Called when a job moves to the local backend because the remote was unreachable. */
  onFallback?: (what: 'transcription' | 'llm', reason: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface JobProviders {
  transcribe: Failover<string, Segment[]>;
  generate: Failover<string, string>;
}

/**
 * Builds the transcription and summary backends for **one job** from the operator's settings.
 * A new set per job matters: a job that fell back stays on local to the end, and the next job
 * tries the remote again (failover.ts).
 */
export function buildJobProviders(settings: AiSettings, deps: ProviderDeps): JobProviders {
  const problems = validateAiSettings(settings);
  if (problems.length > 0) throw new Error(`AI settings are not usable: ${problems.join('; ')}`);

  const { fallback } = settings;
  const timing = {
    retryIntervalMs: fallback.retrySeconds * 1000,
    fallbackAfterMs: fallback.enabled ? fallback.afterSeconds * 1000 : undefined,
    ...(deps.signal ? { signal: deps.signal } : {}),
  };
  const common = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};

  const transcribe =
    settings.transcription.kind === 'remote' && settings.transcription.url !== null
      ? createFailover(
          createOpenAiTranscribe({
            baseUrl: settings.transcription.url,
            model: settings.transcription.model ?? 'whisper-1',
            language: settings.transcription.language,
            ...(deps.env?.WHISPER_API_KEY ? { apiKey: deps.env.WHISPER_API_KEY } : {}),
            ...common,
          }),
          fallback.enabled ? deps.localTranscribe : undefined,
          { ...timing, onFallback: (reason) => deps.onFallback?.('transcription', reason) },
        )
      : createFailover(deps.localTranscribe, undefined, timing);

  const generate =
    settings.llm.kind === 'remote' && settings.llm.url !== null
      ? createFailover(
          createOpenAiGenerate({
            baseUrl: settings.llm.url,
            model: settings.llm.model ?? 'default',
            ...(deps.env?.LLM_API_KEY ? { apiKey: deps.env.LLM_API_KEY } : {}),
            ...common,
          }),
          fallback.enabled ? deps.localGenerate : undefined,
          { ...timing, onFallback: (reason) => deps.onFallback?.('llm', reason) },
        )
      : createFailover(deps.localGenerate, undefined, timing);

  return { transcribe, generate };
}
