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
