import { DEFAULT_AI_SETTINGS, setAiSetting, type AiSettings } from '@vtt-chat-app/shared';
import { describe, expect, it, vi } from 'vitest';

import { BARD_SAMPLING, SCRIBE_SAMPLING } from '../../consts/index.js';
import { buildJobProviders } from './fromSettings.js';

const localTranscribe =
  (): (() => Promise<{ startMs: number; endMs: number; text: string }[]>) => async () => [
    { startMs: 0, endMs: 1, text: 'local' },
  ];
const localGenerate = vi.fn(async () => 'local summary');
const base = { localTranscribe, localGenerate };

function remote(): AiSettings {
  let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.transcription.kind', 'remote');
  s = setAiSetting(s, 'ai.transcription.url', 'http://gpu:8080');
  s = setAiSetting(s, 'ai.llm.kind', 'remote');
  s = setAiSetting(s, 'ai.llm.url', 'http://gpu:11434');
  return setAiSetting(s, 'ai.llm.model', 'llama3.1:8b');
}

const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200 });

describe('buildJobProviders', () => {
  it('uses the local backends when settings say local', async () => {
    const p = buildJobProviders(DEFAULT_AI_SETTINGS, base);
    expect((await p.transcribe.call('x.wav'))[0]?.text).toBe('local');
    expect(await p.generate.call('prompt')).toBe('local summary');
  });

  it('refuses unusable settings (remote with no URL) up front', () => {
    const bad = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'remote');
    expect(() => buildJobProviders(bad, base)).toThrow(/not usable/);
  });

  it('talks to the configured remote and sends the key from the environment', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/chat/completions')
        ? json({ choices: [{ message: { content: 'remote summary' } }] })
        : json({ segments: [] }),
    );
    const p = buildJobProviders(remote(), {
      ...base,
      env: { LLM_API_KEY: 'sk-llm' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.generate.call('prompt')).toBe('remote summary');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gpu:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-llm');
    expect(JSON.parse(init.body as string).model).toBe('llama3.1:8b');
    expect(p.generate.backend()).toBe('primary');
  });

  it('reports tokens for a remote call too, so the near-full-window warning can fire there', async () => {
    const onUsage = vi.fn();
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/chat/completions')
        ? json({
            choices: [{ message: { content: 'remote summary' } }],
            usage: { prompt_tokens: 7000, completion_tokens: 120 },
          })
        : json({ segments: [] }),
    );
    const p = buildJobProviders(remote(), {
      ...base,
      onUsage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await p.generate.call('prompt');
    expect(onUsage).toHaveBeenCalledWith({
      model: 'llama3.1:8b',
      inputTokens: 7000,
      outputTokens: 120,
    });
  });

  it('has the one remote model sample as each role does: the scribe low, the bard freer', async () => {
    const bodies: { temperature: number }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return json({ choices: [{ message: { content: 'ok' } }] });
    });
    const p = buildJobProviders(remote(), {
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await p.generate.call('notes');
    await p.story.call('tale');
    expect(bodies.map((b) => b.temperature)).toEqual([
      SCRIBE_SAMPLING.temperature,
      BARD_SAMPLING.temperature,
    ]);
  });

  it('falls back to local when the remote is unreachable and the fallback is on', async () => {
    const settings = setAiSetting(remote(), 'ai.fallback.after-seconds', '0');
    const onFallback = vi.fn();
    const p = buildJobProviders(settings, {
      ...base,
      onFallback,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(await p.generate.call('prompt')).toBe('local summary');
    expect(p.generate.backend()).toBe('fallback');
    expect(onFallback).toHaveBeenCalledWith('llm', expect.stringContaining('unreachable'));
    // transcription is independent: it has not needed the fallback yet
    expect(p.transcribe.backend()).toBe('primary');
  });

  it('fails instead of falling back to local when the job is too large for it', async () => {
    const settings = setAiSetting(remote(), 'ai.fallback.after-seconds', '0');
    const onFallback = vi.fn();
    const p = buildJobProviders(settings, {
      ...base,
      llmFallbackAllowed: false,
      onFallback,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(p.generate.call('prompt')).rejects.toThrow(/too large|max-local-minutes/i);
    expect(localGenerate).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('still falls back to local when the job is small enough (the default)', async () => {
    const settings = setAiSetting(remote(), 'ai.fallback.after-seconds', '0');
    const p = buildJobProviders(settings, {
      ...base,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(await p.generate.call('prompt')).toBe('local summary');
  });

  it('with the fallback off, never uses the local backend for a remote setting', async () => {
    const settings = setAiSetting(remote(), 'ai.fallback.enabled', 'false');
    const ac = new AbortController();
    let calls = 0;
    const p = buildJobProviders(setAiSetting(settings, 'ai.fallback.retry-seconds', '1'), {
      ...base,
      signal: ac.signal,
      fetchImpl: (async () => {
        calls += 1;
        if (calls >= 2) ac.abort(new Error('stop waiting'));
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(p.generate.call('prompt')).rejects.toThrow('stop waiting');
    expect(localGenerate).not.toHaveBeenCalledWith('prompt');
  });

  it('with the fallback off, keeps waiting forever even when the job is also too large for local', async () => {
    // The two gates are independent: a closed size gate must never override the operator's
    // explicit "wait forever, don't ever use local" choice.
    const settings = setAiSetting(remote(), 'ai.fallback.enabled', 'false');
    const ac = new AbortController();
    let calls = 0;
    const p = buildJobProviders(setAiSetting(settings, 'ai.fallback.retry-seconds', '1'), {
      ...base,
      llmFallbackAllowed: false,
      signal: ac.signal,
      fetchImpl: (async () => {
        calls += 1;
        if (calls >= 2) ac.abort(new Error('stop waiting'));
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(p.generate.call('prompt')).rejects.toThrow('stop waiting');
    expect(localGenerate).not.toHaveBeenCalled();
  });

  describe('claude', () => {
    const claude = (): AiSettings => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'claude');

    it('is usable settings, and uses Claude when the key is set', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('the connector uses the SDK, not this fetch');
      });
      const p = buildJobProviders(claude(), {
        ...base,
        env: { ANTHROPIC_API_KEY: 'sk-ant' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(p.generate.backend()).toBe('primary');
    });

    it('runs on the local model from the start, and says so, when there is no key', async () => {
      const onFallback = vi.fn();
      const p = buildJobProviders(claude(), { ...base, onFallback });
      expect(await p.generate.call('prompt')).toBe('local summary');
      expect(await p.story.call('prompt')).toBe('local summary');
      expect(onFallback).toHaveBeenCalledWith('llm', expect.stringMatching(/ANTHROPIC_API_KEY/));
    });

    it('fails instead of running on local when the job is too large and the key is missing too', async () => {
      const p = buildJobProviders(claude(), { ...base, llmFallbackAllowed: false });
      await expect(p.generate.call('prompt')).rejects.toThrow(/too large|max-local-minutes/i);
      expect(localGenerate).not.toHaveBeenCalled();
    });
  });

  describe('openai', () => {
    const openai = (): AiSettings => {
      let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'openai');
      s = setAiSetting(s, 'ai.llm.model', 'some-model');
      s = setAiSetting(s, 'ai.llm.price-in', '0.5');
      return setAiSetting(s, 'ai.llm.price-out', '2');
    };

    it('needs a named model', () => {
      const s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'openai');
      expect(() => buildJobProviders(s, base)).toThrow(/no model is named/);
    });

    it('calls api.openai.com with the key, no sampling, and reports tokens with the operator cost', async () => {
      const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
      const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: JSON.parse(init.body as string),
          auth: (init.headers as Record<string, string>).Authorization!,
        });
        return json({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
        });
      });
      const onUsage = vi.fn();
      const p = buildJobProviders(openai(), {
        ...base,
        env: { OPENAI_API_KEY: 'sk-oa' },
        onUsage,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(await p.generate.call('prompt')).toBe('ok');
      expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(calls[0]!.auth).toBe('Bearer sk-oa');
      expect(calls[0]!.body).not.toHaveProperty('temperature');
      expect(calls[0]!.body).not.toHaveProperty('presence_penalty');
      expect(calls[0]!.body.model).toBe('some-model');
      expect(onUsage).toHaveBeenCalledWith({
        model: 'some-model',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        costUsd: 1.5,
      });
    });

    it('gives tokens only when no prices are set', async () => {
      const s = setAiSetting(
        setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'openai'),
        'ai.llm.model',
        'm',
      );
      const onUsage = vi.fn();
      const p = buildJobProviders(s, {
        ...base,
        env: { OPENAI_API_KEY: 'k' },
        onUsage,
        fetchImpl: (async () =>
          json({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          })) as unknown as typeof fetch,
      });
      await p.generate.call('x');
      expect(onUsage).toHaveBeenCalledWith({ model: 'm', inputTokens: 10, outputTokens: 5 });
    });

    it('runs locally from the start, and says so, with no key', async () => {
      const onFallback = vi.fn();
      const p = buildJobProviders(openai(), { ...base, onFallback });
      expect(await p.generate.call('x')).toBe('local summary');
      expect(onFallback).toHaveBeenCalledWith('llm', expect.stringMatching(/OPENAI_API_KEY/));
    });

    it('treats a refusal as unavailable', async () => {
      const p = buildJobProviders(
        {
          ...openai(),
          fallback: { ...DEFAULT_AI_SETTINGS.fallback, enabled: false, afterSeconds: 0 },
        },
        {
          ...base,
          env: { OPENAI_API_KEY: 'k' },
          signal: AbortSignal.abort(),
          fetchImpl: (async () =>
            json({
              choices: [{ message: { content: null, refusal: 'no' } }],
            })) as unknown as typeof fetch,
        },
      );
      await expect(p.generate.call('x')).rejects.toBeDefined();
    });
  });
});
