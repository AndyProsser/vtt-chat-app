import { validateAiSettings, type AiSettings } from '@vtt-chat-app/shared';

import {
  BARD_SAMPLING,
  DEFAULT_CLAUDE_MODEL,
  SCRIBE_SAMPLING,
  type Sampling,
} from '../../consts/index.js';
import type { GenerateText, Segment, TranscribeWav } from '../../types/index.js';
import { createClaudeGenerate } from './claude.js';
import { createFailover, type Failover } from './failover.js';
import { createOpenAiGenerate, createOpenAiTranscribe } from './openaiCompat.js';

/** OpenAI's API (Stage 12 CL, the OpenAI connector). Fixed on purpose: `openai` means OpenAI; any other server is `remote`. */
export const OPENAI_BASE_URL = 'https://api.openai.com';

export interface ProviderDeps {
  /** Secrets come from the environment, never from the database. */
  env?: {
    WHISPER_API_KEY?: string | undefined;
    LLM_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
  };
  /** The always-configured local backends: the default, and the fallback for a remote one. */
  /** Builds the local transcriber for the operator's configured language. */
  localTranscribe: (language: string, prompt?: string) => TranscribeWav;
  localGenerate: GenerateText;
  /** The local story-teller (the bard): its own model or sampling; without it the scribe's generator tells the tales. */
  localStory?: GenerateText;
  /** Whisper's starting prompt for this job (the campaign's names), when the operator has it on. */
  transcriptionPrompt?: string | undefined;
  /** Called after each Claude call, so the job can add up its tokens (Stage 12 CL). */
  onUsage?: (usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  }) => void;
  /** Called when a job moves to the local backend because the remote was unreachable. */
  onFallback?: (what: 'transcription' | 'llm', reason: string) => void;
  /** Whether the LLM (never transcription) may fall back to local CPU for this job; default `true`. */
  llmFallbackAllowed?: boolean;
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
  // Whether this job may finish the LLM (never Whisper — CLAUDE.md §5) on local CPU if the remote
  // is unavailable; false when the recording is too large for that (processRecording.ts decides,
  // from its duration against `ai.fallback.max-local-minutes`). Omitted deps default to allowed,
  // so every caller that hasn't been updated for this keeps today's behaviour exactly.
  const llmFallbackAllowed = deps.llmFallbackAllowed ?? true;
  const language = settings.transcription.language;
  const localTranscribe = deps.localTranscribe(language, deps.transcriptionPrompt);
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
            ...(deps.transcriptionPrompt ? { prompt: deps.transcriptionPrompt } : {}),
            ...(deps.env?.WHISPER_API_KEY ? { apiKey: deps.env.WHISPER_API_KEY } : {}),
            ...common,
          }),
          fallback.enabled ? localTranscribe : undefined,
          { ...timing, onFallback: (reason) => deps.onFallback?.('transcription', reason) },
        )
      : createFailover(localTranscribe, undefined, timing);

  // One remote model plays both roles (a remote is usually a bigger model that does both well), sampling as each role
  // does. Each role has its own failover, so each falls back to its own local model.
  const claudeKey = deps.env?.ANTHROPIC_API_KEY;
  if (settings.llm.kind === 'claude' && !claudeKey) {
    // No key: there is nothing to wait for, so this job runs on the local model from the start.
    deps.onFallback?.('llm', 'ai.llm.kind is claude but ANTHROPIC_API_KEY is not set');
  }
  const openaiKey = deps.env?.OPENAI_API_KEY;
  if (settings.llm.kind === 'openai' && !openaiKey) {
    deps.onFallback?.('llm', 'ai.llm.kind is openai but OPENAI_API_KEY is not set');
  }
  // The cost of a call, when the operator gave prices (OpenAI has no built-in table: its prices are the operator's).
  const { priceIn, priceOut } = settings.llm;
  const priced = (usage: { model: string; inputTokens: number; outputTokens: number }) => ({
    ...usage,
    ...(priceIn !== null && priceOut !== null
      ? { costUsd: (usage.inputTokens * priceIn + usage.outputTokens * priceOut) / 1_000_000 }
      : {}),
  });
  const remoteAs = (sampling: Sampling): GenerateText | undefined => {
    if (settings.llm.kind === 'openai') {
      // OpenAI's own API, fixed address, no sampling settings (its current models refuse them); the roles differ by prompt.
      return openaiKey
        ? createOpenAiGenerate({
            baseUrl: OPENAI_BASE_URL,
            apiKey: openaiKey,
            model: settings.llm.model ?? '',
            noSampling: true,
            ...common,
            ...(deps.onUsage ? { onUsage: (u) => deps.onUsage?.(priced(u)) } : {}),
          })
        : undefined;
    }
    if (settings.llm.kind === 'claude') {
      // Claude takes no sampling settings (its current models refuse `temperature`); the roles differ by prompt.
      return claudeKey
        ? createClaudeGenerate({
            apiKey: claudeKey,
            model: settings.llm.model ?? DEFAULT_CLAUDE_MODEL,
            ...(deps.onUsage ? { onUsage: (u) => deps.onUsage?.(priced(u)) } : {}),
          })
        : undefined;
    }
    return settings.llm.kind === 'remote' && settings.llm.url !== null
      ? createOpenAiGenerate({
          baseUrl: settings.llm.url,
          model: settings.llm.model ?? 'default',
          sampling,
          noThinking: true,
          ...(deps.env?.LLM_API_KEY ? { apiKey: deps.env.LLM_API_KEY } : {}),
          ...common,
          // Priced only when the operator has given prices for this backend too; otherwise tokens alone,
          // same as openai/claude above — and the same reply this near-full-window check needs (Task 4).
          ...(deps.onUsage ? { onUsage: (u) => deps.onUsage?.(priced(u)) } : {}),
        })
      : undefined;
  };
  // Thrown instead of actually running locally when the job is too large for that (size gate):
  // never a real fallback, so `role()` leaves `onFallback` out when this is the one in play —
  // otherwise `createFailover` would log "fell back to local" for a job that never did.
  const tooLarge = async (): Promise<string> => {
    throw new Error(
      'the recording is too long to fall back to the local model (ai.fallback.max-local-minutes); configure a remote LLM or wait for it to come back',
    );
  };
  // A remote kind was asked for but could not be built (no key/URL) — that is a fallback in
  // everything but name (the `onFallback` calls above already say so), so the size gate applies
  // to it exactly as it would to a remote that's actually down. `ai.llm.kind: 'local'` is a
  // deliberate, always-fine choice and is never gated.
  const llmIntendedRemote = settings.llm.kind !== 'local';
  const role = (
    local: GenerateText,
    remote: GenerateText | undefined,
  ): Failover<string, string> => {
    if (remote) {
      return createFailover(
        remote,
        fallback.enabled ? (llmFallbackAllowed ? local : tooLarge) : undefined,
        {
          ...timing,
          ...(llmFallbackAllowed
            ? { onFallback: (reason: string) => deps.onFallback?.('llm', reason) }
            : {}),
        },
      );
    }
    if (llmIntendedRemote && !llmFallbackAllowed)
      return createFailover(tooLarge, undefined, timing);
    return createFailover(local, undefined, timing);
  };

  return {
    transcribe,
    generate: role(deps.localGenerate, remoteAs(SCRIBE_SAMPLING)),
    story: role(deps.localStory ?? deps.localGenerate, remoteAs(BARD_SAMPLING)),
  };
}
