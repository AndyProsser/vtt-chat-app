import { validateAiSettings, type AiSettings } from '@vtt-chat-app/shared';

import type { GenerateText, Segment, TranscribeWav } from '../../types/index.js';
import { createFailover, type Failover } from './failover.js';
import { createOpenAiGenerate, createOpenAiTranscribe } from './openaiCompat.js';

export interface ProviderDeps {
  /** Secrets come from the environment, never from the database. */
  env?: { WHISPER_API_KEY?: string | undefined; LLM_API_KEY?: string | undefined };
  /** The always-configured local backends: the default, and the fallback for a remote one. */
  /** Builds the local transcriber for the operator's configured language. */
  localTranscribe: (language: string) => TranscribeWav;
  localGenerate: GenerateText;
  /** The local story-teller (the bard), when it is a different model from `localGenerate`; else that one. */
  localStory?: GenerateText;
  /** Called when a job moves to the local backend because the remote was unreachable. */
  onFallback?: (what: 'transcription' | 'llm', reason: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface JobProviders {
  transcribe: Failover<string, Segment[]>;
  /** The scribe: notes and the Game Master's brief. */
  generate: Failover<string, string>;
  /** The bard: the tales. A remote LLM does both jobs; locally it may be a second model. */
  story: Failover<string, string>;
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
  const language = settings.transcription.language;
  const localTranscribe = deps.localTranscribe(language);
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
          fallback.enabled ? localTranscribe : undefined,
          { ...timing, onFallback: (reason) => deps.onFallback?.('transcription', reason) },
        )
      : createFailover(localTranscribe, undefined, timing);

  // One remote model plays both roles (a remote is usually a bigger model that does both well). Each role has its
  // own failover, so each falls back to its own local model.
  const remote =
    settings.llm.kind === 'remote' && settings.llm.url !== null
      ? createOpenAiGenerate({
          baseUrl: settings.llm.url,
          model: settings.llm.model ?? 'default',
          ...(deps.env?.LLM_API_KEY ? { apiKey: deps.env.LLM_API_KEY } : {}),
          ...common,
        })
      : undefined;
  const role = (local: GenerateText): Failover<string, string> =>
    remote
      ? createFailover(remote, fallback.enabled ? local : undefined, {
          ...timing,
          onFallback: (reason) => deps.onFallback?.('llm', reason),
        })
      : createFailover(local, undefined, timing);

  return {
    transcribe,
    generate: role(deps.localGenerate),
    story: role(deps.localStory ?? deps.localGenerate),
  };
}
