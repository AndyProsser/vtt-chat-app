import { describe, expect, it } from 'vitest';

import type { LocalAiStatus, LocalModelStatus } from '../../types/localAi.js';
import {
  holdForModel,
  holdForWhisper,
  keepTrying,
  OllamaModelKeeper,
  WhisperReadiness,
} from './keepers.js';
import {
  getOllamaModelMaxContext,
  getOllamaRunningContext,
  ollamaHasModel,
  pullOllamaModel,
} from './ollamaModel.js';
import { createLocalAiReporter, describeLocalAi, needsAttention, shownState } from './status.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const ndjson = (...lines: unknown[]): Response =>
  new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const noSleep = async (): Promise<void> => undefined;

/** A fake Ollama: `/api/tags` lists `models`; `/api/pull` answers with `pull()` and then has the model. */
function fakeOllama(models: string[], pull: () => Response = () => ndjson({ status: 'success' })) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url.replace('http://ollama', ''));
    if (url.endsWith('/api/tags')) return json({ models: models.map((name) => ({ name })) });
    if (url.endsWith('/api/pull')) {
      const response = pull();
      const { model } = JSON.parse(String(init?.body)) as { model: string };
      if (response.ok) models.push(model);
      return response;
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('ollamaHasModel', () => {
  it('finds a model by its exact name, and an untagged one as :latest', async () => {
    const { fetchImpl } = fakeOllama(['llama3.2:3b', 'qwen3:latest']);
    expect(await ollamaHasModel('http://ollama/', 'llama3.2:3b', fetchImpl)).toBe(true);
    expect(await ollamaHasModel('http://ollama', 'qwen3', fetchImpl)).toBe(true);
    expect(await ollamaHasModel('http://ollama', 'llama3.2:1b', fetchImpl)).toBe(false);
  });

  it('throws when Ollama answers with an error', async () => {
    const fetchImpl = (async () => json({}, 500)) as typeof fetch;
    await expect(ollamaHasModel('http://ollama', 'm', fetchImpl)).rejects.toThrow('500');
  });
});

describe('getOllamaRunningContext', () => {
  const fakePs = (models: { name: string; context_length: number }[]) =>
    (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/ps')) return json({ models });
      return json({}, 404);
    }) as typeof fetch;

  it("returns the matching model's context_length, matching an untagged name as :latest", async () => {
    const fetchImpl = fakePs([
      { name: 'llama3.2:3b', context_length: 4096 },
      { name: 'qwen3:latest', context_length: 32768 },
    ]);
    expect(await getOllamaRunningContext('http://ollama', 'llama3.2:3b', fetchImpl)).toBe(4096);
    expect(await getOllamaRunningContext('http://ollama', 'qwen3', fetchImpl)).toBe(32768);
  });

  it('returns undefined when the model is not currently loaded', async () => {
    const fetchImpl = fakePs([{ name: 'qwen3:latest', context_length: 32768 }]);
    expect(
      await getOllamaRunningContext('http://ollama', 'llama3.2:3b', fetchImpl),
    ).toBeUndefined();
  });

  it('throws when Ollama answers with an error', async () => {
    const fetchImpl = (async () => json({}, 500)) as typeof fetch;
    await expect(getOllamaRunningContext('http://ollama', 'm', fetchImpl)).rejects.toThrow('500');
  });
});

describe('getOllamaModelMaxContext', () => {
  const fakeShow = (modelInfo: Record<string, unknown>) =>
    (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/show')) return json({ model_info: modelInfo });
      return json({}, 404);
    }) as typeof fetch;

  it('reads whichever model_info key ends in .context_length, any family', async () => {
    expect(
      await getOllamaModelMaxContext(
        'http://ollama',
        'gemma4',
        fakeShow({ 'general.architecture': 'gemma4', 'gemma4.context_length': 131072 }),
      ),
    ).toBe(131072);
    expect(
      await getOllamaModelMaxContext(
        'http://ollama',
        'qwen3',
        fakeShow({ 'general.architecture': 'qwen3', 'qwen3.context_length': 32768 }),
      ),
    ).toBe(32768);
  });

  it('returns undefined when model_info has no such key', async () => {
    expect(
      await getOllamaModelMaxContext(
        'http://ollama',
        'm',
        fakeShow({ 'general.architecture': 'm' }),
      ),
    ).toBeUndefined();
  });

  it('throws when Ollama answers with an error', async () => {
    const fetchImpl = (async () => json({}, 500)) as typeof fetch;
    await expect(getOllamaModelMaxContext('http://ollama', 'm', fetchImpl)).rejects.toThrow('500');
  });
});

describe('pullOllamaModel', () => {
  it('reports progress across layers and resolves on success', async () => {
    const seen: number[] = [];
    const { fetchImpl } = fakeOllama([], () =>
      ndjson(
        { status: 'pulling manifest' },
        { status: 'pulling a', digest: 'a', total: 900, completed: 450 },
        { status: 'pulling a', digest: 'a', total: 900, completed: 900 },
        { status: 'pulling b', digest: 'b', total: 100 },
        { status: 'pulling b', digest: 'b', total: 100, completed: 100 },
        { status: 'success' },
      ),
    );
    await pullOllamaModel('http://ollama', 'm', { fetchImpl, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([50, 100, 90, 100]);
  });

  it('rejects with the reason Ollama gives', async () => {
    const { fetchImpl } = fakeOllama([], () => ndjson({ error: 'pull model manifest: not found' }));
    await expect(pullOllamaModel('http://ollama', 'nope', { fetchImpl })).rejects.toThrow(
      'manifest: not found',
    );
  });

  it('rejects when the stream ends without success (a dropped connection)', async () => {
    const { fetchImpl } = fakeOllama([], () => ndjson({ status: 'pulling manifest' }));
    await expect(pullOllamaModel('http://ollama', 'm', { fetchImpl })).rejects.toThrow('stopped');
  });
});

describe('OllamaModelKeeper', () => {
  it('does not download a model that is already there, and checks only once', async () => {
    const { fetchImpl, calls } = fakeOllama(['m:1']);
    const reports: LocalModelStatus[] = [];
    const keeper = new OllamaModelKeeper({
      baseUrl: 'http://ollama',
      model: 'm:1',
      fetchImpl,
      report: (s) => reports.push(s),
    });
    await keeper.ensure();
    await keeper.ensure();
    expect(calls).toEqual(['/api/tags']);
    expect(reports).toEqual([{ state: 'ready' }]);
  });

  it('downloads a missing model once, however many callers wait for it', async () => {
    const { fetchImpl, calls } = fakeOllama([]);
    const reports: LocalModelStatus[] = [];
    const keeper = new OllamaModelKeeper({
      baseUrl: 'http://ollama',
      model: 'm:1',
      fetchImpl,
      report: (s) => reports.push(s),
    });
    await Promise.all([keeper.ensure(), keeper.ensure()]);
    expect(calls).toEqual(['/api/tags', '/api/pull']);
    expect(reports.map((r) => r.state)).toEqual(['downloading', 'ready']);
  });

  it('reports a failed download and tries again on the next call', async () => {
    let attempt = 0;
    const { fetchImpl } = fakeOllama([], () =>
      ++attempt === 1
        ? ndjson({ error: 'no space left on device' })
        : ndjson({ status: 'success' }),
    );
    const reports: LocalModelStatus[] = [];
    const keeper = new OllamaModelKeeper({
      baseUrl: 'http://ollama',
      model: 'm:1',
      fetchImpl,
      report: (s) => reports.push(s),
    });
    await expect(keeper.ensure()).rejects.toThrow('no space left');
    expect(reports.at(-1)).toMatchObject({ state: 'failed' });
    await keeper.ensure();
    expect(reports.at(-1)).toEqual({ state: 'ready' });
  });

  it('reports waiting, and does not try to download, when Ollama is not there', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      throw new Error('getaddrinfo ENOTFOUND ollama');
    }) as typeof fetch;
    const reports: LocalModelStatus[] = [];
    const keeper = new OllamaModelKeeper({
      baseUrl: 'http://ollama',
      model: 'm:1',
      fetchImpl,
      report: (s) => reports.push(s),
    });
    await expect(keeper.ensure()).rejects.toThrow('not answering');
    expect(urls).toEqual(['http://ollama/api/tags']);
    expect(reports).toEqual([{ state: 'waiting', detail: 'getaddrinfo ENOTFOUND ollama' }]);
  });

  it('refreshes the status while downloading, but no more often than asked', async () => {
    let clock = 0;
    const { fetchImpl } = fakeOllama([], () => {
      const lines = [10, 20, 30, 40].map((completed) => ({ digest: 'a', total: 100, completed }));
      return ndjson(...lines, { status: 'success' });
    });
    const reports: LocalModelStatus[] = [];
    const keeper = new OllamaModelKeeper({
      baseUrl: 'http://ollama',
      model: 'm:1',
      fetchImpl,
      now: () => (clock += 10_000),
      reportEveryMs: 20_000,
      report: (s) => reports.push(s),
    });
    await keeper.ensure();
    expect(reports.filter((r) => r.state === 'downloading').length).toBeLessThan(5);
    expect(reports.at(-1)).toEqual({ state: 'ready' });
  });
});

describe('WhisperReadiness', () => {
  it('is waiting until /health answers, then ready for good', async () => {
    let up = false;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (!up) throw new Error('connect ECONNREFUSED');
      return json({ status: 'ok' });
    }) as typeof fetch;
    const reports: LocalModelStatus[] = [];
    const whisper = new WhisperReadiness({
      baseUrl: 'http://whisper:8080/',
      fetchImpl,
      report: (s) => reports.push(s),
    });
    await expect(whisper.ensure()).rejects.toThrow('not ready');
    up = true;
    await whisper.ensure();
    await whisper.ensure();
    expect(calls).toBe(2);
    expect(reports.map((r) => r.state)).toEqual(['waiting', 'ready']);
  });

  it('treats a 503 (the model is still loading) as not ready', async () => {
    const fetchImpl = (async () => json({ status: 'loading model' }, 503)) as typeof fetch;
    await expect(
      new WhisperReadiness({ baseUrl: 'http://whisper:8080', fetchImpl }).ensure(),
    ).rejects.toThrow('503');
  });
});

describe('keepTrying', () => {
  it('retries with growing pauses until it works', async () => {
    let failures = 3;
    const pauses: number[] = [];
    const target = {
      ensure: async () => {
        if (failures-- > 0) throw new Error('not yet');
      },
      invalidate: () => undefined,
    };
    const ok = await keepTrying(target, { sleep: async (ms) => void pauses.push(ms) });
    expect(ok).toBe(true);
    expect(pauses).toEqual([15_000, 30_000, 60_000]);
  });

  it('caps the pause, and gives up when told to', async () => {
    let clock = 0;
    const pauses: number[] = [];
    const target = {
      ensure: async () => {
        throw new Error('never');
      },
      invalidate: () => undefined,
    };
    const ok = await keepTrying(target, {
      sleep: async (ms) => {
        pauses.push(ms);
        clock += ms;
      },
      now: () => clock,
      maxDelayMs: 40_000,
      giveUpAfterMs: 120_000,
    });
    expect(ok).toBe(false);
    expect(pauses).toEqual([15_000, 30_000, 40_000, 40_000]);
  });

  it('stops when the worker is shutting down', async () => {
    const abort = new AbortController();
    const target = {
      ensure: async () => {
        abort.abort();
        throw new Error('down');
      },
      invalidate: () => undefined,
    };
    expect(await keepTrying(target, { signal: abort.signal, sleep: noSleep })).toBe(false);
  });
});

describe('holding a job for the local AI', () => {
  it('a summary waits for the model download instead of failing', async () => {
    const { fetchImpl, calls } = fakeOllama([]);
    const keeper = new OllamaModelKeeper({ baseUrl: 'http://ollama', model: 'm:1', fetchImpl });
    const generate = holdForModel(async (prompt) => `summary of ${prompt}`, keeper, {
      sleep: noSleep,
    });
    expect(await generate('the session')).toBe('summary of the session');
    expect(calls).toEqual(['/api/tags', '/api/pull']);
  });

  it('checks for the model again after a failed request (it may have been removed)', async () => {
    const { fetchImpl, calls } = fakeOllama(['m:1']);
    const keeper = new OllamaModelKeeper({ baseUrl: 'http://ollama', model: 'm:1', fetchImpl });
    let fail = true;
    const generate = holdForModel(
      async () => {
        if (fail) throw new Error('ollama request failed with status 404');
        return 'ok';
      },
      keeper,
      { sleep: noSleep },
    );
    await expect(generate('x')).rejects.toThrow('404');
    fail = false;
    expect(await generate('x')).toBe('ok');
    expect(calls).toEqual(['/api/tags', '/api/tags']);
  });

  it('a transcription waits for Whisper, and still runs (and fails honestly) if it never comes', async () => {
    let clock = 0;
    let healthChecks = 0;
    const fetchImpl = (async () => {
      healthChecks += 1;
      if (healthChecks < 3) throw new Error('connect ECONNREFUSED');
      return json({ status: 'ok' });
    }) as typeof fetch;
    const transcribe = holdForWhisper(
      async () => [{ startMs: 0, endMs: 1, text: 'hi' }],
      new WhisperReadiness({ baseUrl: 'http://whisper', fetchImpl }),
      { sleep: noSleep },
    );
    expect(await transcribe('a.wav')).toHaveLength(1);
    expect(healthChecks).toBe(3);

    const never = holdForWhisper(
      async () => {
        throw new Error('fetch failed');
      },
      new WhisperReadiness({
        baseUrl: 'http://whisper',
        fetchImpl: (async () => {
          throw new Error('down');
        }) as typeof fetch,
      }),
      { sleep: async (ms) => void (clock += ms), now: () => clock },
    );
    await expect(never('a.wav')).rejects.toThrow('fetch failed');
    expect(clock).toBeGreaterThanOrEqual(30 * 60_000);
  });
});

describe('the local AI status', () => {
  it('saves both halves together and survives a failed write', async () => {
    const written: LocalAiStatus[] = [];
    let failNext = true;
    const reporter = createLocalAiReporter({
      now: () => 5,
      retryMs: 1,
      write: async (status) => {
        if (failNext) {
          failNext = false;
          throw new Error('column "local_ai" does not exist');
        }
        written.push(status);
      },
    });
    reporter.llm({ state: 'ready' });
    reporter.whisper({ state: 'waiting' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written.at(-1)).toEqual({
      at: 5,
      llm: { state: 'ready' },
      whisper: { state: 'waiting' },
    });
  });

  it('reports the context check alongside llm/whisper, as a third field', async () => {
    const written: LocalAiStatus[] = [];
    const reporter = createLocalAiReporter({ now: () => 7, write: async (s) => written.push(s) });
    reporter.context({
      kind: 'local',
      model: 'qwen3',
      live: 8192,
      modelMax: 32768,
      unreachable: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(written.at(-1)).toEqual({
      at: 7,
      llm: null,
      whisper: null,
      llmContext: {
        kind: 'local',
        model: 'qwen3',
        live: 8192,
        modelMax: 32768,
        unreachable: false,
      },
    });
  });

  it('calls a download that stopped reporting stalled, and flags it with a failed one', () => {
    const downloading: LocalModelStatus = { state: 'downloading', percent: 40 };
    expect(shownState(downloading, 0, 60_000)).toBe('downloading');
    expect(shownState(downloading, 0, 6 * 60_000)).toBe('stalled');
    expect(shownState({ state: 'ready' }, 0, 9e9)).toBe('ready');
    expect(shownState(null, 0, 0)).toBeNull();
    expect(needsAttention('stalled')).toBe(true);
    expect(needsAttention('failed')).toBe(true);
    expect(needsAttention('downloading')).toBe(false);
    expect(needsAttention('waiting')).toBe(false);
  });

  it('describes itself in one line for vtt-admin', () => {
    expect(
      describeLocalAi(
        { at: 0, llm: { state: 'downloading', percent: 43 }, whisper: { state: 'ready' } },
        1000,
      ),
    ).toBe('summary model downloading (43%), Whisper ready');
    expect(
      describeLocalAi(
        { at: 0, llm: { state: 'failed', detail: 'no space left' }, whisper: null },
        1000,
      ),
    ).toBe('summary model download failed: no space left');
    expect(describeLocalAi({ at: 0, llm: null, whisper: null }, 0)).toBe('nothing reported');
  });
});
