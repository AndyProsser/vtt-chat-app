import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_MAX_NO_SPEECH_PROB, DEFAULT_PROVIDER_TIMEOUT_MS } from '../../consts/index.js';
import type { GenerateText, Segment, TranscribeWav } from '../../types/index.js';
import { isNonSpeech } from '../whisperJson.js';
import { isTransientStatus, ProviderUnavailableError } from './errors.js';
import { longFetch } from '../longFetch.js';

export interface OpenAiCompatOptions {
  /** Server root, e.g. `http://gaming-pc:8080` or `http://127.0.0.1:11434`. `/v1/...` is appended. */
  baseUrl: string;
  /** Sent as a bearer token when set. Local servers usually need none. */
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface OpenAiTranscribeOptions extends OpenAiCompatOptions {
  /** Fixed language code. A wrong auto-detect on a short window costs accuracy, so this is explicit. */
  language?: string;
  /** Drops segments the server rates as probably silence. Servers that don't report it are unaffected. */
  maxNoSpeechProb?: number;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

async function post(
  options: OpenAiCompatOptions,
  route: string,
  body: string | FormData,
  contentType?: string,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? longFetch;
  let response: Response;
  try {
    response = await doFetch(`${trimSlash(options.baseUrl)}${route}`, {
      method: 'POST',
      headers: {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    // Connection refused, DNS failure, reset, timeout: the backend is not there right now.
    throw new ProviderUnavailableError(`cannot reach ${options.baseUrl}${route}`, { cause: error });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    const message = `${route} failed with status ${response.status}${detail ? `: ${detail}` : ''}`;
    throw isTransientStatus(response.status)
      ? new ProviderUnavailableError(message)
      : new Error(message);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${route} returned a body that is not JSON`, { cause: error });
  }
}

interface VerboseSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  no_speech_prob?: unknown;
}

/**
 * Parses an OpenAI-style `verbose_json` transcription. Requires `segments`: without timestamps a
 * transcript cannot be merged across speakers, so a text-only reply is an error, not a fallback.
 */
export function parseVerboseTranscription(json: unknown, maxNoSpeechProb: number): Segment[] {
  const segments = (json as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) {
    throw new Error(
      'transcription reply has no "segments" (the server must support response_format=verbose_json)',
    );
  }
  const out: Segment[] = [];
  for (const raw of segments as VerboseSegment[]) {
    if (
      typeof raw.start !== 'number' ||
      typeof raw.end !== 'number' ||
      typeof raw.text !== 'string'
    ) {
      continue;
    }
    const text = raw.text.trim();
    if (isNonSpeech(text)) continue;
    if (typeof raw.no_speech_prob === 'number' && raw.no_speech_prob > maxNoSpeechProb) continue;
    out.push({ startMs: Math.round(raw.start * 1000), endMs: Math.round(raw.end * 1000), text });
  }
  return out;
}

/** A {@link TranscribeWav} backed by any server implementing `POST /v1/audio/transcriptions`. */
export function createOpenAiTranscribe(options: OpenAiTranscribeOptions): TranscribeWav {
  return async (wavPath) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([await readFile(wavPath)], { type: 'audio/wav' }),
      path.basename(wavPath),
    );
    form.append('model', options.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    // Deterministic output: a summary is built on this text, so no sampling randomness.
    form.append('temperature', '0');
    if (options.language) form.append('language', options.language);
    const json = await post(options, '/v1/audio/transcriptions', form);
    return parseVerboseTranscription(json, options.maxNoSpeechProb ?? DEFAULT_MAX_NO_SPEECH_PROB);
  };
}

export interface OpenAiGenerateOptions extends OpenAiCompatOptions {
  temperature?: number;
}

/** A {@link GenerateText} backed by any server implementing `POST /v1/chat/completions` (Ollama does). */
export function createOpenAiGenerate(options: OpenAiGenerateOptions): GenerateText {
  return async (prompt) => {
    const json = (await post(
      options,
      '/v1/chat/completions',
      JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: options.temperature ?? 0.2,
      }),
      'application/json',
    )) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('chat reply had no message content');
    return content;
  };
}
