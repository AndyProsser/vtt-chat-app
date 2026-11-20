import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_MAX_NO_SPEECH_PROB,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  SCRIBE_SAMPLING,
  type Sampling,
} from '../../consts/index.js';
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
  /** Whisper's starting prompt (the campaign's names): what the speech is likely to be about. */
  prompt?: string;
  /** Drops segments the server rates as probably silence. Servers that don't report it are unaffected. */
  maxNoSpeechProb?: number;
  /**
   * Sends whisper.cpp's `audio_ctx` sized to each window. Whisper always encodes 30 s of audio, so a 6 s
   * line costs as much as a 30 s one; `audio_ctx` tells whisper.cpp to encode only the part that holds sound.
   * A whisper.cpp extension, so it is for the local Whisper only, and only for the models it was measured on
   * ({@link fitsAudioContext}). Measured 2026-11-16 on a table-like track (one line, then 5 s of quiet): 2.2 to 2.9 times
   * faster with word accuracy unchanged on `small`, `small.en` and `base.en`. **`large-v3-turbo` repeats itself** with a
   * shortened context ("Both arrows hit. Both arrows hit. Both arrows hit."), found by the end-to-end test the same day.
   */
  fitAudioContext?: boolean;
  /** Encoder positions kept past the end of the sound (50 a second). Default {@link AUDIO_CTX_MARGIN}. */
  audioContextMargin?: number;
}

/** Whisper's encoder covers 30 s in 1500 positions (50 a second). */
const AUDIO_CTX_FULL = 1500;
/** Extra positions past the end of the sound (about 5 s). 128 cost accuracy in the measurement; 256 did not, and 400 was no better. */
export const AUDIO_CTX_MARGIN = 256;
/** Below this the decoder gets erratic, however short the clip. */
const AUDIO_CTX_MIN = 384;

/** The `audio_ctx` for a clip of this length, or undefined when the full context is needed anyway. */
export function audioContextFor(seconds: number, margin = AUDIO_CTX_MARGIN): number | undefined {
  const fitted = Math.max(AUDIO_CTX_MIN, Math.ceil(seconds * 50) + margin);
  return fitted < AUDIO_CTX_FULL ? fitted : undefined;
}

/**
 * Whether a ggml model file is one the fitted context was measured safe on: the `base` and `small` models. Anything
 * else (the `large` family and `turbo` above all, `medium`, `tiny`, an unknown name) gets Whisper's full context.
 */
export const fitsAudioContext = (modelFile: string | undefined): boolean =>
  modelFile !== undefined && /^ggml-(base|small)(\.en)?[-.]/.test(modelFile);

/** Seconds of audio in a 16 kHz mono 16-bit WAV of this size (what ffmpeg cuts for Whisper), header ignored. */
const wavSeconds = (bytes: number): number => Math.max(0, bytes - 44) / 32_000;

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
    // A form is turned into its bytes here, with Node's own classes, and sent as plain bytes. `longFetch` is the
    // `undici` package's fetch, which does not recognise Node's built-in FormData and sent the text "[object FormData]"
    // instead of the audio: every HTTP transcription failed with "no 'file' field" (0.4.3 to 0.5.0; found by the
    // Compose end-to-end test on 2026-11-16).
    let payload: string | Uint8Array = '';
    let type = contentType;
    if (typeof body === 'string') {
      payload = body;
    } else {
      const encoded = new Response(body);
      type = encoded.headers.get('content-type') ?? undefined;
      payload = new Uint8Array(await encoded.arrayBuffer());
    }
    response = await doFetch(`${trimSlash(options.baseUrl)}${route}`, {
      method: 'POST',
      headers: {
        ...(type ? { 'Content-Type': type } : {}),
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: payload,
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
    const audio = await readFile(wavPath);
    form.append('file', new Blob([audio], { type: 'audio/wav' }), path.basename(wavPath));
    form.append('model', options.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    // Deterministic output: a summary is built on this text, so no sampling randomness.
    form.append('temperature', '0');
    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);
    const audioCtx = options.fitAudioContext
      ? audioContextFor(wavSeconds(audio.length), options.audioContextMargin)
      : undefined;
    if (audioCtx !== undefined) form.append('audio_ctx', String(audioCtx));
    const json = await post(options, '/v1/audio/transcriptions', form);
    return parseVerboseTranscription(json, options.maxNoSpeechProb ?? DEFAULT_MAX_NO_SPEECH_PROB);
  };
}

export interface OpenAiGenerateOptions extends OpenAiCompatOptions {
  /** How to sample; default the scribe's (low temperature, no presence penalty). Sent explicitly, so a server's own
   * defaults for the model (Ollama's Modelfile, say) never apply. */
  sampling?: Sampling;
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
        temperature: (options.sampling ?? SCRIBE_SAMPLING).temperature,
        presence_penalty: (options.sampling ?? SCRIBE_SAMPLING).presencePenalty,
      }),
      'application/json',
    )) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('chat reply had no message content');
    return content;
  };
}
