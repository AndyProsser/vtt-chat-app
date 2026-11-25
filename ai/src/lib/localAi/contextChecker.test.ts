import { describe, expect, it } from 'vitest';

import { createOllamaContextChecker } from './contextChecker.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

function fakeOllama(
  models: { name: string; context_length: number }[],
  modelInfo: Record<string, unknown>,
) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/ps')) return json({ models });
    if (url.endsWith('/api/show')) return json({ model_info: modelInfo });
    return json({}, 404);
  }) as typeof fetch;
}

describe('createOllamaContextChecker', () => {
  it('resolves live and modelMax when both endpoints answer', async () => {
    const fetchImpl = fakeOllama([{ name: 'qwen3:latest', context_length: 8192 }], {
      'qwen3.context_length': 32768,
    });
    const result = await createOllamaContextChecker({
      kind: 'local',
      baseUrl: 'http://ollama',
      model: 'qwen3',
      fetchImpl,
      now: () => 42,
    });
    expect(result).toEqual({
      kind: 'local',
      model: 'qwen3',
      live: 8192,
      modelMax: 32768,
      unreachable: false,
      checkedAt: 42,
    });
  });

  it('resolves with live absent when the model is not currently loaded, modelMax still present', async () => {
    const fetchImpl = fakeOllama([], { 'qwen3.context_length': 32768 });
    const result = await createOllamaContextChecker({
      kind: 'local',
      baseUrl: 'http://ollama',
      model: 'qwen3',
      fetchImpl,
      now: () => 42,
    });
    expect(result).toEqual({
      kind: 'local',
      model: 'qwen3',
      modelMax: 32768,
      unreachable: false,
      checkedAt: 42,
    });
  });

  it('resolves unreachable: true, never throws, when a request fails', async () => {
    const fetchImpl = (async () => json({}, 500)) as typeof fetch;
    const result = await createOllamaContextChecker({
      kind: 'remote',
      baseUrl: 'http://gpu:11434',
      model: 'qwen3',
      fetchImpl,
      now: () => 42,
    });
    expect(result).toEqual({ kind: 'remote', model: 'qwen3', unreachable: true, checkedAt: 42 });
  });

  it('resolves unreachable: true when the server is not Ollama at all (404 on both)', async () => {
    const fetchImpl = (async () => json({}, 404)) as typeof fetch;
    const result = await createOllamaContextChecker({
      kind: 'remote',
      baseUrl: 'http://vllm:8000',
      model: 'some-model',
      fetchImpl,
      now: () => 42,
    });
    expect(result).toEqual({
      kind: 'remote',
      model: 'some-model',
      unreachable: true,
      checkedAt: 42,
    });
  });
});

/** An Ollama that starts with nothing loaded and loads the model (at `served` tokens) when asked to generate. */
function idleOllama(served: number, opts: { generateStatus?: number } = {}) {
  const calls: { url: string; body?: string }[] = [];
  let loaded = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (url.endsWith('/api/ps')) {
      return json({ models: loaded ? [{ name: 'qwen3:8b', context_length: served }] : [] });
    }
    if (url.endsWith('/api/show')) return json({ model_info: { 'qwen3.context_length': 40960 } });
    if (url.endsWith('/api/generate')) {
      if ((opts.generateStatus ?? 200) !== 200) return json({ error: 'nope' }, opts.generateStatus);
      loaded = true;
      return json({ done: true });
    }
    return json({}, 404);
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    generates: () => calls.filter((c) => c.url.endsWith('/api/generate')),
  };
}

const REMOTE = { kind: 'remote', baseUrl: 'http://gpu:11434', model: 'qwen3:8b' } as const;

describe('createOllamaContextChecker: loading an idle remote model to read its window', () => {
  it('loads an idle remote model with an empty request, then reads what it is served at', async () => {
    const o = idleOllama(12288);
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      now: () => 100,
      probeIfIdle: true,
    });
    expect(result).toMatchObject({
      kind: 'remote',
      live: 12288,
      modelMax: 40960,
      unreachable: false,
    });
    expect(o.generates()).toHaveLength(1);
    const body = JSON.parse(o.generates()[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('qwen3:8b');
    expect(body.prompt).toBeUndefined(); // an empty request loads the model and generates nothing
    expect(body.keep_alive).toBeDefined(); // and does not leave it in memory for long
  });

  it('does not load a model that is already loaded', async () => {
    const o = idleOllama(12288);
    await o.fetchImpl('http://gpu:11434/api/generate', { method: 'POST', body: '{}' }); // load it
    const before = o.generates().length;
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      probeIfIdle: true,
    });
    expect(result.live).toBe(12288);
    expect(o.generates().length).toBe(before);
  });

  it('never loads the local model: the app sets that one’s window itself', async () => {
    const o = idleOllama(8192);
    const result = await createOllamaContextChecker({
      kind: 'local',
      baseUrl: 'http://ollama:11434',
      model: 'qwen3:8b',
      fetchImpl: o.fetchImpl,
      probeIfIdle: true,
    });
    expect(result.live).toBeUndefined();
    expect(o.generates()).toHaveLength(0);
  });

  it('does not load anything unless asked to', async () => {
    const o = idleOllama(12288);
    const result = await createOllamaContextChecker({ ...REMOTE, fetchImpl: o.fetchImpl });
    expect(result.live).toBeUndefined();
    expect(o.generates()).toHaveLength(0);
  });

  it('reuses a recent reading of the same model instead of loading a gaming PC’s GPU again', async () => {
    const o = idleOllama(12288);
    const previous = {
      kind: 'remote',
      model: 'qwen3:8b',
      live: 12288,
      unreachable: false,
      checkedAt: 1_000,
    } as const;
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      now: () => 1_000 + 3_600_000, // an hour later
      probeIfIdle: true,
      previous,
    });
    expect(result.live).toBe(12288);
    expect(result.liveAt).toBe(1_000); // the reading is an hour old, and says so
    expect(o.generates()).toHaveLength(0);
  });

  it('loads again once the last reading is more than a day old', async () => {
    const o = idleOllama(16384);
    const previous = {
      kind: 'remote',
      model: 'qwen3:8b',
      live: 12288,
      unreachable: false,
      checkedAt: 0,
    } as const;
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      now: () => 25 * 3_600_000,
      probeIfIdle: true,
      previous,
    });
    expect(result.live).toBe(16384);
    expect(result.liveAt).toBeUndefined();
    expect(o.generates()).toHaveLength(1);
  });

  it('loads again when the model was changed, whatever the old reading was', async () => {
    const o = idleOllama(12288);
    const previous = {
      kind: 'remote',
      model: 'other:7b',
      live: 4096,
      unreachable: false,
      checkedAt: 1_000,
    } as const;
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      now: () => 2_000,
      probeIfIdle: true,
      previous,
    });
    expect(result.live).toBe(12288);
    expect(o.generates()).toHaveLength(1);
  });

  it('still answers, with the model’s maximum, when loading fails', async () => {
    const o = idleOllama(12288, { generateStatus: 500 });
    const result = await createOllamaContextChecker({
      ...REMOTE,
      fetchImpl: o.fetchImpl,
      probeIfIdle: true,
    });
    expect(result.unreachable).toBe(false);
    expect(result.live).toBeUndefined();
    expect(result.modelMax).toBe(40960);
  });
});
