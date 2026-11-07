import { DEFAULT_AI_SETTINGS, setAiSetting, type AiSettings } from '@vtt-chat-app/shared';
import { describe, expect, it, vi } from 'vitest';

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
});
