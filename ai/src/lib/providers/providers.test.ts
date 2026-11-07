import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ProviderUnavailableError } from './errors.js';
import { createFailover } from './failover.js';
import {
  createOpenAiGenerate,
  createOpenAiTranscribe,
  parseVerboseTranscription,
} from './openaiCompat.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const asFetch = (fn: unknown): typeof fetch => fn as typeof fetch;

async function wavFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'prov-'));
  const file = path.join(dir, 'window.wav');
  await writeFile(file, Buffer.from('RIFF....WAVEfmt '));
  return file;
}

describe('parseVerboseTranscription', () => {
  it('converts seconds to milliseconds and trims text', () => {
    expect(
      parseVerboseTranscription({ segments: [{ start: 0.5, end: 2.25, text: ' Hello. ' }] }, 0.8),
    ).toEqual([{ startMs: 500, endMs: 2250, text: 'Hello.' }]);
  });

  it('drops non-speech markers and segments the server rates as probably silence', () => {
    const out = parseVerboseTranscription(
      {
        segments: [
          { start: 0, end: 1, text: '[BLANK_AUDIO]' },
          { start: 1, end: 2, text: 'Thank you.', no_speech_prob: 0.95 },
          { start: 2, end: 3, text: 'I attack.', no_speech_prob: 0.02 },
          { start: 3, end: 4, text: 'No probability reported.' },
        ],
      },
      0.8,
    );
    expect(out.map((s) => s.text)).toEqual(['I attack.', 'No probability reported.']);
  });

  it('rejects a text-only reply, because without timestamps it cannot be merged', () => {
    expect(() => parseVerboseTranscription({ text: 'hello' }, 0.8)).toThrow(/verbose_json/);
  });

  it('skips malformed entries', () => {
    expect(parseVerboseTranscription({ segments: [{ text: 'x' }, { start: 'a' }] }, 0.8)).toEqual(
      [],
    );
  });
});

describe('createOpenAiTranscribe', () => {
  it('posts the audio as multipart with the settings that favour accuracy', async () => {
    const fetchImpl = vi.fn(async () => json({ segments: [{ start: 0, end: 1, text: 'hi' }] }));
    const transcribe = createOpenAiTranscribe({
      baseUrl: 'http://gpu-box:8080/',
      apiKey: 'sk-test',
      model: 'large-v3-turbo',
      language: 'en',
      fetchImpl: asFetch(fetchImpl),
    });
    expect(await transcribe(await wavFile())).toEqual([{ startMs: 0, endMs: 1000, text: 'hi' }]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gpu-box:8080/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('large-v3-turbo');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('temperature')).toBe('0');
    expect(form.get('language')).toBe('en');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('sends no Authorization header when there is no key', async () => {
    const fetchImpl = vi.fn(async () => json({ segments: [] }));
    await createOpenAiTranscribe({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl: asFetch(fetchImpl),
    })(await wavFile());
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('treats a refused connection as "unavailable", the case that may fail over', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      createOpenAiTranscribe({ baseUrl: 'http://off', model: 'm', fetchImpl: asFetch(fetchImpl) })(
        await wavFile(),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it.each([408, 429, 500, 502, 503])('treats HTTP %i as unavailable', async (status) => {
    const fetchImpl = vi.fn(async () => json({ error: 'busy' }, status));
    await expect(
      createOpenAiTranscribe({ baseUrl: 'http://x', model: 'm', fetchImpl: asFetch(fetchImpl) })(
        await wavFile(),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it.each([400, 401, 404])(
    'treats HTTP %i as a configuration error, not "unavailable"',
    async (s) => {
      const fetchImpl = vi.fn(async () => json({ error: 'nope' }, s));
      const error = await createOpenAiTranscribe({
        baseUrl: 'http://x',
        model: 'm',
        fetchImpl: asFetch(fetchImpl),
      })(await wavFile()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ProviderUnavailableError);
      expect((error as Error).message).toContain(String(s));
    },
  );
});

describe('createOpenAiGenerate', () => {
  it('posts a chat completion and returns the message content', async () => {
    const fetchImpl = vi.fn(async () => json({ choices: [{ message: { content: 'summary' } }] }));
    const generate = createOpenAiGenerate({
      baseUrl: 'http://ollama:11434',
      model: 'llama3.2:3b',
      fetchImpl: asFetch(fetchImpl),
    });
    expect(await generate('the transcript')).toBe('summary');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama:11434/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'llama3.2:3b',
      stream: false,
      messages: [{ role: 'user', content: 'the transcript' }],
    });
  });

  it('errors on a reply with no content', async () => {
    const generate = createOpenAiGenerate({
      baseUrl: 'http://x',
      model: 'm',
      fetchImpl: asFetch(async () => json({ choices: [] })),
    });
    await expect(generate('p')).rejects.toThrow(/no message content/);
  });
});

describe('createFailover', () => {
  const down = (): Promise<string> => Promise.reject(new ProviderUnavailableError('down'));

  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: vi.fn(async (ms: number) => {
        t += ms;
      }),
    };
  }

  it('uses the primary when it works and never touches the fallback', async () => {
    const fallback = vi.fn(async () => 'local');
    const f = createFailover(async () => 'remote', fallback, clock());
    expect(await f.call('x')).toBe('remote');
    expect(f.backend()).toBe('primary');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('waits and retries while the primary is down, then recovers without falling back', async () => {
    const c = clock();
    let attempts = 0;
    const primary = async (): Promise<string> => (++attempts < 4 ? down() : 'remote');
    const f = createFailover(primary, async () => 'local', {
      ...c,
      retryIntervalMs: 1000,
      fallbackAfterMs: 60_000,
    });
    expect(await f.call('x')).toBe('remote');
    expect(c.sleep).toHaveBeenCalledTimes(3);
    expect(f.backend()).toBe('primary');
  });

  it('falls back to local once the primary has been unreachable for the timeout', async () => {
    const c = clock();
    const onFallback = vi.fn();
    const f = createFailover(down, async () => 'local', {
      ...c,
      retryIntervalMs: 1000,
      fallbackAfterMs: 5000,
      onFallback,
    });
    expect(await f.call('x')).toBe('local');
    expect(f.backend()).toBe('fallback');
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('does not sleep past the fallback deadline', async () => {
    const c = clock();
    const f = createFailover(down, async () => 'local', {
      ...c,
      retryIntervalMs: 30_000,
      fallbackAfterMs: 2000,
    });
    await f.call('x');
    expect(c.sleep).toHaveBeenCalledWith(2000, undefined);
    expect(c.now()).toBe(2000);
  });

  it('stays on the fallback for the rest of the job, so a transcript is not stitched from two models', async () => {
    const c = clock();
    const primary = vi.fn(down);
    const f = createFailover(primary, async () => 'local', { ...c, fallbackAfterMs: 0 });
    await f.call('a');
    primary.mockClear();
    await f.call('b');
    expect(primary).not.toHaveBeenCalled();
  });

  it('a new job (new instance) tries the primary again', async () => {
    const make = () =>
      createFailover(
        async () => 'remote',
        async () => 'local',
        clock(),
      );
    expect(await make().call('x')).toBe('remote');
  });

  it('with the fallback switched off, keeps waiting past the timeout', async () => {
    const c = clock();
    let attempts = 0;
    const primary = async (): Promise<string> => (++attempts < 50 ? down() : 'remote');
    const f = createFailover(primary, async () => 'local', {
      ...c,
      retryIntervalMs: 60_000,
      fallbackAfterMs: undefined,
    });
    expect(await f.call('x')).toBe('remote');
    expect(f.backend()).toBe('primary');
  });

  it('with no fallback configured, waits for the primary', async () => {
    const c = clock();
    let attempts = 0;
    const f = createFailover(async () => (++attempts < 3 ? down() : 'remote'), undefined, c);
    expect(await f.call('x')).toBe('remote');
  });

  it('does not retry or fall back on a configuration error', async () => {
    const fallback = vi.fn(async () => 'local');
    const f = createFailover(
      async () => Promise.reject(new Error('404 bad model')),
      fallback,
      clock(),
    );
    await expect(f.call('x')).rejects.toThrow('404 bad model');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('measures the outage from the first failure, and resets once the primary answers', async () => {
    const c = clock();
    let phase = 0;
    const primary = async (): Promise<string> => {
      phase += 1;
      if (phase === 1 || phase === 3) return down();
      return 'remote';
    };
    const f = createFailover(primary, async () => 'local', {
      ...c,
      retryIntervalMs: 1000,
      fallbackAfterMs: 1500,
    });
    expect(await f.call('a')).toBe('remote'); // 1 down (1 s waited), 2 up
    expect(await f.call('b')).toBe('remote'); // outage clock restarted: 3 down, 4 up — no fallback
    expect(f.backend()).toBe('primary');
  });
});
